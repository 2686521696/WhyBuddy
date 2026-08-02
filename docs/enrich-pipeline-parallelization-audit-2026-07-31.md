# ENRICH 链路并行化审查记录（2026-07-31）

只读代码审查，未改动任何代码。依据：代码结构阅读（`git` 提交追溯到具体行）+
当天两轮真实推演的实测耗时。范围限定在过门之后、装配之前的体验层生成
（`ENRICH`，见 `docs/SlideRule V5.7 架构图.md` 子图 10）——五系统模型生成本身
（单次 LLM 调用）不在本次审查的可并行范围内。

> **第二轮复核（照 V5.7 架构图逐节点核对）修正了本文档的结论。**
> ② 被证实是生产路径上的死代码，原「收益最大」的排序作废；另发现 5 处遗漏。
> 全部修正集中在文末「八、第二轮复核」，与之相关的原文已就地标注。
> **实施顺序以「八」为准，不要照「六」执行。**

## 结论摘要

一轮真实推演约 7 分钟，其中约 4 分钟（`ENRICH` 段）有并行空间、前 2.5 分钟
（五系统模型生成）没有。可并行的位置有 5 处，其中 4 处（①②③④）之间无跨阶段
数据依赖，可以按「消除工程浪费、不降质量」的产品纪律并行化；第 5 处（身份主题
生成）有硬顺序依赖，动不了。

审查过程中推翻了一条此前的判断（见「二、2」），并新确认两个真实缺陷（见
「四」）——这两个缺陷必须在并行化之前处理，否则并行化会把它们从"潜伏"变成
"必然触发"。

## 一、链路耗时实测

| 场景 | 阶段 | 耗时 |
| --- | --- | --- |
| 诊所话题 (`tmp/clinic/run.log`) | 五系统模型生成 | 155.5s |
| 诊所话题 | freeform 增强（含 1 张生图 + 1 次视觉 LLM 取色） | 244.2s |
| 诊所话题 | **总计** | **≈ 7 分钟** |
| 书店话题 | 五系统模型生成 | 160.6s |
| 书店话题 | 单张参照板生图 | 84.7s |
| 书店话题 | 单张生图（非参照板） | 60s |

## 二、现状核实：真正已经并发的只有一处，不是两处

### 1. 能力池 `SLIDERULE_PARALLEL_CAPS`（确认属实，位置：`services/v5_full_driver.py:110-146`）

一轮 `drive` 里多个能力（`intent.parse`、`evidence.search` 等）并行执行，
默认 ON（`_parallel_caps_enabled()`，109-146 行）。设计原则原文（110-131 行）：

> Product decision: no artificial speed-ups (no lower-quality shortcuts) — we
> only remove engineering waste... Design: "parallel execute, deterministic
> commit".

即"并行执行，按原选中顺序串行提交"——产物字节与串行模式一致。这一层作用于
`CORE` 控制平面的能力调度，**不覆盖** `ENRICH` 体验层生成。

### 2. ⚠️ 更正：出图提示词改写并未在生产路径并发

上一轮审查认为"`_refine_sheet_prompt_batch` 用 `ThreadPoolExecutor(max_workers=4)`
已经把提示词改写并发了，只有生图本身没并发"——**这个判断不成立**。

代码确实存在这样一个函数——`refine_sheet_prompts_parallel`
（`services/freeform_block.py:1334-1365`），机制与描述一致：
`ThreadPoolExecutor(max_workers=min(4, len(items)))`、单项失败返回 `None`
不抛出、`len(items)==1` 时直接走单发不起线程池。它是与两段式改造
（提交 `525f603`，07-31 03:29）同批加入的。

但全仓 `grep refine_sheet_prompts_parallel` 只有两处命中：定义本身，和
`tests/test_monitor_overview.py:436` 的测试调用。**生产路径零调用**：

```
enrich_monitor_page_overviews (freeform_block.py:2165)
  └─ for page in ...pages（2193，串行 for 循环）
       └─ _generate_overview_sheet_b64 (1464)
            └─ _build_overview_sheet_prompt (1368)
                 └─ _refine_sheet_prompt_via_llm(facts, device=device)   ← 单发版（1414）
```

`_build_overview_sheet_prompt` 从未被改造为批量调用
`refine_sheet_prompts_parallel`，`enrich_monitor_page_overviews` 的循环仍是
"每页依次：改写提示词（单发阻塞 IO）→ 生图 → 桌面设计 → 手机设计"，四步全串行。

**影响**：①的实际工作量比"给生图包一层线程池"更大——还需要把
`enrich_monitor_page_overviews` 的循环重构成"先收集所有页的 facts → 一次性
调用 `refine_sheet_prompts_parallel` → 再逐页生图/设计"。好消息是复用件已经
在仓库里、已有测试覆盖，不用重新写并发原语。

## 三、可并行位置逐条核实

### ① 每页的参照板生图（收益最大，改动面见上一条更正）

`enrich_monitor_page_overviews` 的 for-page 循环里（`freeform_block.py:2193-2233`），
`_generate_overview_sheet_b64` 逐页串行调用，单张 60~85s，N 个 monitor 页
就是 N 倍。调用之间无数据依赖——同一份 `datamodel` 和主题，各生各的。

### ② `enrich_freeform_blocks` 的页 × 块双重循环

> ⚠️ **第二轮复核推翻：这段在生产路径上不处理任何区块，收益≈0。见「八、1」。**

`freeform_block.py:1893-1971`，`for page → for block(FreeformInsight)` 全串行，
每个区块一次独立 LLM 调用（可能带参照图+截图自检）。区块间无依赖，唯一共享
状态是预算计数器 `ref_used`/`shot_used`（见「四、2」）。

### ③ 同一页的桌面档与手机档设计

`freeform_block.py:2234-2297`，`generate_freeform_block(device=desktop)` 后
紧跟 `generate_freeform_block(device=phone)`（2278 行起），两次独立调用，共用
同一张参照板 `sheet_b64`。代码注释明写手机档约省 67s/页
（`device == "phone"` 分支的判定见 2257-2276 行）。

### ④ `enrich_freeform_blocks` 与 `enrich_monitor_page_overviews` 整段并行

调用序列见 `services/v5_capability_executor.py:338-353`，两句顺序执行，
写的是不同字段（`freeformContent` vs `freeformOverview`）。

**依赖排除，已核实、无遗漏**：
- `enrich_freeform_blocks` 只丢弃 `block.get("type") == "FreeformInsight"` 的块
  （`freeform_block.py:1924`）。
- `_monitor_overview_design_brief` 的 blockRef 清单只收
  `FREEFORM_EMBEDDABLE_BLOCK_TYPES`（`freeform_block.py:2095-2097`），实测取值
  = `schema_legal.py:294` 定义，等于 `('RankedList', 'ActivityFeed',
  'QuickActionPanel', 'WorkflowTimeline')`——`FreeformInsight` 不在其中。
- 两段读写的集合不相交；`page["blocks"]` 重新赋值在 CPython GIL 下是原子的，
  并发读到的要么是旧列表要么是新列表，两者对 blockRef 计算结果一致。

**新发现的前置依赖（此前未提及）**：`v5_capability_executor.py:330-353`
的调用序列是 `enrich_identity_theme` → `enrich_freeform_blocks` →
`enrich_monitor_page_overviews`，注释原文（330-331 行）"身份主题要先
生成——FreeformInsight 的配色会读 `appIdentity.generatedTheme`，顺序反了
就只能落回 8 预设"。即：**身份主题生成必须在 ②③④ 全部开始之前完整跑完**，
这是产品语义上的硬顺序依赖，不是可以并行掉的工程浪费。④ 的并行方案本身
不受影响（只涉及 `enrich_freeform_blocks`/`enrich_monitor_page_overviews`
互相并行，两者都排在 THEME 之后），但如果日后有人想把 THEME 也拉进并行池，
这里是边界。

### ⑤ 身份主题生成 vs 五系统模型生成（确认不可并行）

`enrich_identity_theme` 入参只有 `model` 和 `goal`，但产品逻辑上依赖模型
产出的实体/字段摘要，动不了。

## 四、两个真实缺陷（并行化前必须先处理）

### 缺陷 1：`LLM_MAX_CONCURRENT` 是死配置，无任何消费方

| 位置 | 内容 |
| --- | --- |
| `sliderule_llm/config.py:107` | `LlmConfig.max_concurrent` 字段定义 |
| `sliderule_llm/config.py:131` | 从 `LLM_MAX_CONCURRENT` 环境变量解析，默认 9999 |
| `sliderule_llm/client.py:90` | 构造 fallback `LlmConfig` 时硬编码 `max_concurrent=9999` |
| `sliderule_llm/pool.py:385` | 构造 key-pool `LlmConfig` 时硬编码 `max_concurrent=9999` |
| `tests/test_*.py`（6 处） | 构造测试夹具时填 `9999` |

全仓 `grep '\.max_concurrent'` 只命中 `tests/test_config.py:137`
（`assert cfg.max_concurrent == 7`）——这条测试验证的是解析器行为，不是
下游消费。全仓无 `Semaphore` 或任何并发限流原语。

**风险**：现在客户端对 LLM 调用没有任何并发上限，全靠服务商端点自己扛。
串行调用时这个洞不会暴露；一旦按 ①②③ 并行化，多个 worker 同时打向同一个
端点，`.env` 里 `LLM_TIMEOUT_MS=600000`（10 分钟）意味着一旦端点开始排队，
一批请求可能一起挂到超时才失败。**必须在并行化之前补上限流**（信号量或
线程池 `max_workers` 上限），否则并行化是在裸奔。

### 缺陷 2：预算计数器在并行下必然失效

两处同样的模式，`freeform_block.py:1937-1944`（区块级）与
`freeform_block.py:2213-2220`（页级）：

```python
use_ref = ref_used < max_ref_images      # 读
if use_ref:
    ref_used += 1                         # 改（非原子）
```

代码注释原文（1934-1936 行）：

> 成本预算：参考图/截图自检按"尝试"计费（参考图在 generate 开头就生成了——
> 失败的区块钱照样花了，必须扣预算；只在成功分支计数会让网关抖动时笼子完全
> 失效，生图次数退化为区块数×1，终检实测）。

即这个上限是真实事故换来的教训。N 个 worker 并行进入这段代码会全部读到
同一个旧值、全部判定"还有预算"，生图/截图次数直接突破 `SLIDERULE_ENRICH_
MAX_REF_IMAGES` / `SLIDERULE_ENRICH_MAX_SCREENSHOT_VERIFY` 设定的上限。
**必须改成派发前一次性分配**（先算出这批任务里哪几个有配额，再派发给
worker，worker 自己不再抢锁）。

区块级（`enrich_freeform_blocks`）与页级（`enrich_monitor_page_overviews`）
的预算计数器是各自独立的局部变量（两个函数各自 `ref_used = 0`），互不共享
——这与架构图 07-31 版注释"区块段与首页段各自独立读取（不是共享额度）"
一致，因此④（两段整段并行）不会引入两段之间的计数器竞态，风险只存在于
②③单段内部的多路并发。

## 五、其余核实

- **`_take` / `seen_row_keys`**：`_monitor_overview_design_brief` 的函数内
  闭包，每次调用新建，按页天然隔离，无跨页共享状态。
- **图片客户端线程安全**：`sliderule_llm/image_client.py` 用
  `urllib.request` 逐次发起请求，无模块级共享 client/session 对象、无全局
  可变计数器，天然线程安全。
- **`_installed_skills` / `_delta_sink` / `_last_call_error` /
  `last_generate_diagnostic`** 等全局状态：均在 `v5_llm_generate` 模块，
  `freeform_block.py` 不 import 它们（grep 零命中），freeform 侧并行不会
  碰到。
- **`lru_cache` 或其他模块级缓存**：freeform 相关代码路径未发现。

## 六、建议的实施顺序（⚠️ 已作废，以「八、7」为准）

1. **先补 `LLM_MAX_CONCURRENT` 的消费**（信号量/连接池上限）——这是并行化的前提，不是可选项。
2. **①参照板生图**：按「二、2」的更正重构 `enrich_monitor_page_overviews` 的
   for-page 循环——先批量收集 facts 调 `refine_sheet_prompts_parallel`，
   生图本身另包一层线程池。独立性最强，改动面虽比预想大，但复用件已在
   仓库里、已有测试。
3. **③同页桌面/手机双档**：两次调用共用同一张 `sheet_b64`，天然成对，约省
   67s/页。
4. **②freeform 区块循环**：收益最大，但要先把预算计数器改成派发前一次性
   分配（缺陷 2）。
5. **④两段整段并行**：依赖已排除、无新增地雷，但它会同时放大 ①②③ 的并发量，
   放最后做。

每一步改完都要真跑对比耗时，不要一次全上。

## 七、三条必须遵守的纪律（原样保留，未发现需要修正）

1. **产品纪律**：`v5_full_driver.py:112-113` 明写"no artificial speed-ups
   (no lower-quality shortcuts) — we only remove engineering waste"。
   ①②③④ 都属于消除工程浪费，符合这条；但如果为了快去砍生图或砍截图自检，
   就越线了。
2. **fail-open 语义不能破**：现在每一步失败都静默降级（退纯文字生成/退固定
   骨架），并行化必须保持"单个 worker 失败只影响那一格"。
   `refine_sheet_prompts_parallel` 已经是这么写的（失败位置返回 `None`），
   照抄它的形状即可。
3. **预算笼子不能失真**：见「四、2」，改成派发前一次性分配。

## 八、第二轮复核（照 V5.7 架构图逐节点核对，2026-07-31 晚）

第一轮只顺着 `enrich_*` 三个函数往下读，没有回到架构图把 `ENRICH` 子图的
节点逐个对照。补做之后发现 6 处遗漏，其中第 1 条推翻了原优先级排序。

### 1. ⚠️ ② 是生产路径上的死代码——原「收益最大」的判断作废

`enrich_freeform_blocks` 的整个循环体挂在
`if block.get("type") != "FreeformInsight": continue`（`freeform_block.py:1924`）
上，而 `FreeformInsight` **不会出现在 `page.blocks` 里**。四条独立证据：

| 证据 | 位置 |
| --- | --- |
| `FreeformInsight` 的 `generationEnabled: false` | `services/data/experience_block_catalog.json:536` |
| 生成契约把它列进 schema-only 名单并明令 "never emit them" | `services/schema_legal.py:429-435` |
| 演示域冻结夹具里 `FreeformInsight` 出现 **0** 次 | `services/data/builtin_domain_models.json` |
| 离线夹具再生成脚本只 import/调用 `enrich_monitor_page_overviews` | `scripts/enrich_builtin_domain_models.py:36, 83` |

**一处重要差别**：结构门**并不拒绝** `FreeformInsight`——`v5_model_gate.py:660-672`
有它的专门校验分支（要求 `props.designBrief` 非空）。所以这是**提示词层面
的禁止，不是结构上的不可能**：模型万一漏网吐出一个，门会放行，这段代码
会真的执行。因此它是"实践上的死代码"，删不得，但也不值得为它做并行化。

**连带影响**：
- ② 的并行收益 ≈ 0，应从优先级列表移到最后或直接不做。
- ④（两段整段并行）随之失去大半价值——两段里有一段是空转。
- 实测的 244.2s「freeform 增强」几乎全部是 `enrich_monitor_page_overviews`
  的耗时，不是 `enrich_freeform_blocks`。原文档把这个数字归给"freeform"
  容易让人以为 ② 有 244s 可压。
- 「四、2」预算竞态的**区块级那一处**（`1937-1944`）同样落在死代码里；
  真正会在生产中触发的只有**页级那一处**（`2213-2220`）。

### 2. 生图客户端才是 ① 真正并行的对象，而它没有任何并发控制

第一轮盯着 `LLM_MAX_CONCURRENT`，却完全没有审查 `sliderule_llm/image_client.py`
——而 ① 并行的正是这个客户端。

| 事实 | 位置 |
| --- | --- |
| `RETRIES = 3`，`BACKOFF = 5`（线性 5/10/15 秒） | `image_client.py:22-23` |
| `_transient()` 把 **429** 列为可重试 | `image_client.py:95` |
| 重试用 `time.sleep(BACKOFF * attempt)`，**无 jitter** | `image_client.py:137` |
| 无任何并发上限、无连接池、无信号量 | 全文件 |

**风险**：并行后 N 个 worker 同时打向生图端点 → 一起收 429 → 各自 sleep
**完全相同**的时长 → 同一时刻一起醒来重试 → 再撞一次。没有抖动的线性退避
在并发下会让重试保持锁步，把一次拥塞放大成连环拥塞。

**因此「四、1」的结论要扩展**：并行化前要补的不只是 LLM 侧的并发闸，
生图侧同样需要（并发上限 + 退避加 jitter）。这两条是不同的端点、不同的
客户端、不同的配置项，不能只补一处。

### 3. 实测耗时来自一次「截图自检被关掉」的运行

`e2b_screenshot_available()`（`services/app_screenshot.py:99-101`）要求
**E2B key 与 `SLIDERULE_PUBLIC_APP_URL` 同时有值**。本地 `.env` 里后者是
注释掉的（注释原文："本地开发保持注释（localhost 沙盒够不到）"）。
实跑验证：`e2b_screenshot_available()` 返回 `False`。

**后果**：
- 244.2s 这个数字**不含任何 E2B 截图时间**，`shot_used` 与
  `allow_screenshot_verify` 在本地全程惰性——「四、2」里截图预算那一半
  在本地根本不会触发。
- 生产环境（配了公网地址）会多出一整个成本中心，而并行化会把它变成
  **N 个并发 E2B 沙盒**。`.env` 对 E2B 的注记是"⚠️ 按用量计费"，且每个
  一次性沙盒不配 `SLIDERULE_E2B_TEMPLATE` 时要现装 playwright（约 2 分钟）。
- **本文档的耗时画像不能直接外推到生产**。并行化的验收必须在配了
  `SLIDERULE_PUBLIC_APP_URL` 的环境上再测一轮。

### 4. 预算笼子就是并行宽度的天花板——收益估算需要下修

`_ENRICH_MAX_REF_IMAGES_DEFAULT = 4`（`freeform_block.py:144`）。即使一个应用
有 10 个 monitor 页，也只有前 4 页拿得到参照图，其余页 `use_ref=False` 走
纯文字生成（快得多）。所以：

- ① 的**有效并行宽度上限是 4，不是页数 N**。
- 原文「以 4 个 monitor 页估，并行度 4 大致能压到 1/3」恰好踩在笼子边界上，
  页数再多收益也不会线性增长。
- 顺带核实架构图「满配 9 张 = 主题 1 + 区块 4 + 首页 4」：主题侧确实只生
  1 张（`identity_theme_gen.py:235` 单次调用，不在循环里），与架构图一致；
  但"区块 4"那一档因为第 1 条（② 死代码）在当前灰度下实际取不到。

### 5. PALGUARD 节点第一轮完全没覆盖

架构图 `ENRICH` 子图里 `FREEFORM → PALGUARD → FREEFORM` 是一条 reask 环边，
第一轮审查漏掉了整个节点。补查结论：

- **线程安全，无需改动**：`services/palette_guard.py` 只有模块级不可变常量
  （`_HEX_RE` 编译正则、`HUE_TOLERANCE=25.0`、`NEUTRAL_CHROMA=0.04`、
  `_FAMILY_BUCKET=30.0`），无可变全局、无缓存、无锁。
- **但它让单任务耗时变成可变量**：违规时"带具体偏差重问"，一次 freeform
  生成的 LLM 往返次数不固定。并行批次的墙钟时间由**最慢那个 worker 的重问
  次数**决定，不是平均值——收益估算按平均耗时算会偏乐观。

### 6. DOMFIX 旁路：这些并行化对四个演示域零收益

架构图明写演示域意图（采购/请假/工单/入职）走 `DOMFIX` 冻结夹具旁路，
**运行时跳过 ENRICH 整层**。因此本文档讨论的全部并行化只对**新颖意图**
生效。夹具的增强是离线脚本 `scripts/enrich_builtin_domain_models.py` 预先
跑好冻结进 JSON 的——那个脚本本身是可以并行化的（它调用同一个
`enrich_monitor_page_overviews`），但它不在用户等待的关键路径上，优先级低。

### 7. 修正后的实施顺序（取代「六」）

0. **先加阶段耗时埋点**（「十、2」补充）——成功路径当前完全静默，没有埋点
   就无法验收"并行之后到底快了多少"。
1. **补三个并发闸**（不是一个）：
   - LLM 侧——消费 `LLM_MAX_CONCURRENT`（「四、1」）
   - 生图侧——并发上限 + 退避加 jitter（「八、2」）
   - E2B 侧——确认账户并发沙盒配额（「九、4」；「十、1」已证实生产真的在起沙盒）
2. **① 参照板生图**：唯一确认有实际收益的一项。按「二、2」重构
   `enrich_monitor_page_overviews` 的 for-page 循环（批量 facts →
   `refine_sheet_prompts_parallel` → 生图并行），并行宽度按笼子设为 4。
3. **③ 同页桌面/手机双档**：约省 67s/页，天然成对，无预算竞态。
4. ~~② freeform 区块循环~~ —— **不做**。生产路径空转（「八、1」）。
   若日后 `FreeformInsight` 的 `generationEnabled` 放开灰度，再回到这一条，
   届时必须先处理区块级预算竞态。
5. **④ 两段整段并行**：依赖已排除，但因 ② 空转而收益有限，最后考虑。

验收纪律追加一条：**必须在配了 `SLIDERULE_PUBLIC_APP_URL` 的环境上复测**
（「八、3」），本地关掉截图自检的耗时画像不足以验收。

## 九、补测截图自检开销（2026-08-01）

目标是照「八、3」把 `SLIDERULE_PUBLIC_APP_URL` 配上重测完整基线。**完整基线
没跑成**，原因见下；但把缺失的那一段用「实测固定开销 + 代码里的超时上限」
夹逼出了区间，并**推翻了一条文档里的常量说法**。

### 1. 完整基线在本环境跑不了（隧道方案已证伪）

截图自检要求 E2B 沙盒能回连到**正在跑增强的那个进程**。两处约束叠加：

- `preview_url = f"{base_url}/sliderule/freeform-preview/{preview_id}"`
  （`app_screenshot.py:148-149`），而 `preview_id` 存在
  `freeform_preview_store._store` 这个**进程内字典**里（:26）。
- 该路由由 uvicorn 进程提供（`routes/sliderule_full.py:1411`）。

因此 base_url 必须指向当前实例。两条路都堵死：

| 尝试 | 结果 |
| --- | --- |
| 指向生产 `miantuan.ai` | **错**。preview_id 只存在于本进程，生产那边查不到 → 沙盒 `waitForSelector` 超时 → 每次白跑一个沙盒还真计费 |
| 用 `fresh_topic_shot.py` 跑链路 | **同样错**。脚本是独立进程，`put_preview()` 写进自己的内存，uvicorn 看不见 |
| cloudflared quick tunnel | **不可行**，见下 |

隧道失败的根因是本容器的出口策略，不是工具选择问题：

- `region1.v2.argotunnel.com:7844`（数据面默认端口，TCP 与 UDP）：不通
- SSH 隧道（`localhost.run:22` / `serveo.net:22`）：端口不通，且无 ssh 客户端
- 用隐藏的 `TUNNEL_EDGE` 强制走边缘 443：TCP 连上了，但握手回包是
  `bogus greeting "HTTP/1.1 400 Bad Request"` —— 连上的是**本环境的出口
  代理**，它对 443 做 HTTP 语义拦截，隧道协议不是合法 HTTP 于是被回 400。

结论：**该环境的出口代理无法承载任何隧道数据面**，换 ngrok/localtunnel 会
撞同一堵墙（早先 `tunnel.ngrok.com:443` 的「直连通」是假象——只证明 TCP 能连
上代理）。完整基线必须在真正有公网入口的部署环境上跑。

### 2. ⚠️ 修正：「每次现装约 2 分钟」实测是 **29.1s**，差约 4 倍

`.env` 对 `SLIDERULE_E2B_TEMPLATE` 的注释写着"不填则每个一次性沙盒现装
（约 2 分钟/次）"。单独量了这段固定开销（不依赖应用可达性）：

| 步骤 | 实测 |
| --- | --- |
| 沙盒冷启动 | 0.2s |
| 首次代码往返 | 2.2s |
| playwright 就绪检查（确认**未**预装） | 1.2s |
| `npm install playwright` | 2.7s |
| `npx playwright install --with-deps chromium` | 22.7s |
| **固定开销合计** | **29.1s** |

探针与生产路径逐条同构，因此可比：`_create_sandbox` 走默认模板
`Sandbox.create(timeout=...)`（`app_screenshot.py:43-49`），`_ensure_playwright`
执行 `npm install playwright@{_PLAYWRIGHT_VERSION}` → `npx playwright install
--with-deps chromium`（:57-65），与探针所做完全一致。

**注意**：单次采样，E2B 侧镜像与网络状况会浮动；但 29.1s 与 120s 的差距远超
采样噪声。配 `SLIDERULE_E2B_TEMPLATE` 的收益因此也没有注释说的那么大
（省的是约 25s，不是约 2 分钟）。

顺带确认：默认模板里 playwright **确实没有预装**（就绪检查失败），注释这一
半是对的。

### 3. 生产画像的夹逼估算

单次截图自检 = 固定开销（实测 29.1s）+ 页面加载与截图。后者量不到，但代码里
有硬上限：`subprocess.run(..., timeout=40)`（`app_screenshot.py:161-165`），
其内 JS 为 `goto` 25s + `waitForSelector` 15s + 稳定等待 1.5s。故：

- 单次截图自检 ≈ **29s ~ 69s**
- 每次 enrich 最多 2 次（`_ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT = 2`）
- 即生产环境比本地基线**多出约 60s ~ 140s**

把它叠到「一」的实测上：本地量到的 freeform 段 244.2s，在配齐公网地址的生产
环境上大致对应 **约 305s ~ 385s**。这是估算不是实测，动手前仍需按「八、7」
在真部署环境复测。

### 4. 对并行化结论的影响

截图自检是**串行链路里第二贵的一段**（仅次于生图），且它跟生图一样是
"每个任务各自独立、彼此无依赖"。所以：

- ① 的收益在生产环境比本地基线显示的**更大**（本地那段被整个关掉了）。
- 但并行化会把 N 个一次性沙盒同时拉起来。E2B 按用量计费，且账户级并发上限
  未知——**并行化前需要确认 E2B 账户的并发沙盒配额**，这是除 LLM、生图之外
  的**第三个**需要设闸的地方（「八、2」只列了前两个）。
- 若要压这段，配 `SLIDERULE_E2B_TEMPLATE` 把 playwright 预烤进模板是纯收益
  （省约 25s/次且不改任何语义），优先级应排在并行化改造之前——它不碰代码。

## 十、生产日志验证（2026-08-01，Render API）

「九」留了一个悬念：生产到底有没有配 `SLIDERULE_PUBLIC_APP_URL`。若没配，则
「八、3」「九」整套「生产比本地多一段截图开销」的推断都不成立。拉了 Render
生产日志核实（`whybuddy-python` = `srv-d9ipnq7avr4c73b8sj2g`，窗口
2026-07-31 15:00~19:17）。

### 1. 结论：生产**开着**截图自检，「八、3」前提成立

日志里出现两条 `GET /api/sliderule/freeform-preview/{pid}`：

```
17:19:38  POST execute-capability
17:20:03  [freeform_block] JSON repaired mechanically (json-repair), reask 轮次被省下
17:20:36  GET  freeform-preview/5f109dbf…      ← 距 execute-capability 57s
17:22:11  POST drive-full-stream
17:28:41  POST execute-capability
17:30:14  GET  freeform-preview/10f6423e…      ← 距 execute-capability 92s
```

拿不到 user-agent（前端服务 `whybuddy` 不记访问日志），但三条证据闭合：

1. **那个 pid 人类无从获得**——`capture_freeform_preview_screenshot` 在
   `generate_freeform_block` **生成中途**调用，截的是"还没写入任何 session"
   的候选内容，应用从不把用户导航到该 URL。
2. **时点吻合**——两次都落在推演进行中，不是空闲时段。
3. **次数吻合预算**——`_ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT = 2`，两轮推演
   各命中一次。

而 `e2b_screenshot_available()` 要求 E2B key 与公网地址**同时**有值，该请求
能发生即证明两者在生产均已配置。

**故「九、3」的夹逼估算继续有效**：生产比本地基线多约 60~140s，本地量到的
244.2s 在生产大致对应 305~385s。

顺带印证：`[freeform_block] JSON repaired mechanically` 说明 V5.7 的 ✧7
（json-repair 先机械修复再 reask）在生产真实生效。

### 2. ⚠️ 完整基线仍拿不到——应用不打点

1000 行日志里 **902 行是 `GET /health`**，应用侧有效日志只有 4 行（3 条
startup + 1 条 freeform）。**各阶段耗时一条都没有**：`enrich_identity_theme` /
`enrich_freeform_blocks` / `enrich_monitor_page_overviews` 只在**失败或撞预算**
时才 `print`，成功路径完全静默。

这就是为什么耗时只能靠本地手工计时。**要拿生产基线，必须先加埋点**（每段
记 duration），否则日志里永远只有健康检查。这一条应排在并行化改造之前——
没有埋点就无法验收"并行之后到底快了多少"。

### 3. 顺带发现：Node 与 Python 两侧 LLM 配置不一致

| 服务 | llmHost | llmModel |
| --- | --- | --- |
| `whybuddy`（Node） | `api.openai.com` | `gpt-4o-mini` |
| `whybuddy-python` | `api.rcouyi.com` | `gpt-5.6-luna` |

Node 侧看起来是**默认值没被覆盖**（render.yaml 的 LLM 那组只下发给了 Python）。
按 V5.7 架构图 Node 定位是"薄代理到 Python 引擎"，若确实不自己发 LLM 请求则
无影响；但只要有任何一条 Node 侧自主调用 LLM 的路径，它打的就是
`api.openai.com` 而非配置的网关，且大概率静默降级。建议确认。

另有 32 行 `PydanticSerializationUnexpectedValue` 警告与 1 条
`[agentic-pick] loop N attempt N/N 失败`，与本轮结论无关，未展开。
