# ENRICH 链路并行化审查记录（2026-07-31）

只读代码审查，未改动任何代码。依据：代码结构阅读（`git` 提交追溯到具体行）+
当天两轮真实推演的实测耗时。范围限定在过门之后、装配之前的体验层生成
（`ENRICH`，见 `docs/SlideRule V5.7 架构图.md` 子图 10）——五系统模型生成本身
（单次 LLM 调用）不在本次审查的可并行范围内。

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

## 六、建议的实施顺序

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
