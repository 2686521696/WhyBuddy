# 开源对标差距表：LangGraph / Instructor vs 自研实现（F1，2026-07-15）

> 结论先行：**三个子系统，三种裁决**——结构门「引库」（Instructor 完胜自研）、
> 重入/停泊「借语义」（LangGraph 的存档点设计值得抄图纸，但整框架不搬）、
> 信任层/发布闭环「不动」（开源界没有对标物，这是本仓的差异化）。
>
> 方法：pip 拉 langgraph 1.2.9 / instructor 1.15.4 源码逐行解剖（非读文档），
> 对照本仓 `services/persistence.py`、`slide_rule_session.py`、
> `sliderule_llm/client.py` 的实测行为。所有断言带 file:line。

---

## 一、结构门：`call_llm_json_with_shape` vs Instructor —— 裁决：**引库**

### 三栏差距

| | 我们有 | Instructor 有 |
|---|---|---|
| **双方都有** | 围栏剥离 + json.loads（`client.py:779-783`）；required_keys 存在性检查（`:826-836`）；瞬态错误重试（`:805-823`）；截断识别（finish_reason=length，`:873-877`） | 同上全部，且每项更深 |
| **只有我们有** | 多供应商故障转移链（`build_provider_configs :97-112`——instructor 不管这层，保留自研）；`v5_model_gate` 业务语义门（引用不悬挂）+ `v5_model_repair` 确定性修复（零 LLM）——**instructor 替代不了，保留** | — |
| **只有它有** | ①**错误回喂**：校验失败时把上一次的坏输出 + 具体报错拼成纠正消息发回模型（`v2/core/retry.py:249-257`），模型自我修正——我们的 shape 重试是盲重采样，同样的 prompt 再抽一次奖 ②**完整 Pydantic 校验**：类型/嵌套/枚举/约束/自定义校验器，我们只查 key 存在性（还是 falsy 判定——空串/空列表误判缺失，`client.py:833`）③**截断不当重试**：`IncompleteOutputException` 单独抛出永不循环（`function_calls.py:39-49`）——我们把截断当普通解析失败 ④**括号配平提取器**：字符级扫描抠 JSON 段（`v2/core/json.py:9-45`），碾压正则剥围栏 ⑤模式注册表：每个供应商自动选原生结构化输出/工具调用/JSON 兜底（约 50 种 Mode）⑥流式部分解析（Partial/jiter）⑦重试全程 token 记账 + 失败历史完整携带 | |

### 落地方案（2026-07-15 真机撞墙后修订：引库 → 借语义）
原判「引库 instructor」，实际接入时撞了本仓网关的两堵墙：
① WAF 按 User-Agent 拦——UA 含 "OpenAI/Python" 直接 403 "Your request
was blocked"（X-Stainless 系头无害，实测隔离验证）；② Cloudflare 524——
非流式响应 120 秒硬顶，五系统生成常超时，SDK 默认非流式必撞，而自研
客户端的流式传输天然免疫。**修订裁决：SDK 栈不引入，把 instructor 的
reask 核心语义（校验失败把「上次输出+具体报错」拼回消息让模型自我修正）
移植到自研流式客户端上**——`sliderule_llm/structured.py`，五系统生成层
首个消费方（无流式 sink 时优先走它，交互流式路径失败时由它救场）。
真机 3/3 一次通过（改造前同样三连必踩空正文/524）。分层不变：
本通道管 schema 级，`v5_model_gate/repair` 管业务语义级。

---

## 二、重入/停泊：会话持久化 vs LangGraph 存档点 —— 裁决：**借语义**

### 三栏差距

| | 我们有 | LangGraph 有 |
|---|---|---|
| **双方都有** | 原子落盘（temp+os.replace，`persistence.py:193-200`）；单调版本并发守卫（lastTurnId 提数比较，`:66-78/:318-345`）；追加型事件日志防覆写（replay/reasoning id-union 合并，`:282-307`）；暂停等人（awaitReason 9 种 + 下轮 intake 清除恢复，`slide_rule_interactive_gates.py:592-610`）；失效级联（依赖图传递 stale，单调只增，`:488-506`） | checkpoint 链 + versions_seen + interrupt/resume |
| **只有我们有** | ①**语义级失效**：用户挑战某个结论 → 依赖图级联作废 + 图节点标 challenged（`invalidate_for_intervention :399-576`）——LangGraph 只有机械的版本比较，没有"这个结论被推翻了"的业务语义 ②坏记录隔离保全（单条损坏跳过但原样保留重写，`persistence.py:154-186`）③同轮进度判定（增量保存 vs 陈旧快照的超集检查，`:90-123`）④决策台账 SchedulingDecision（saw/chose/skipped/rationale 可审计可挑战）——**这些都是证据链体系的地基，保留** | — |
| **只有它有** | ①**每步存档**：我们整会话只有一份最新快照（`persistence.py:194`），无法回放到轮中态；它每个超步一个 checkpoint，父链成链（`base:139-146`），任意节点可恢复/可分叉（fork 开新支不覆写，`_loop.py:952-958`）②**任务粒度断点续跑**：pending writes 与快照分开存（`memory:73-77`），一步里 5 个任务挂了 1 个，重来只跑挂的那个（`_reapply_writes_to_succeeded_nodes`，`_loop.py:736-749`）——我们一轮 5 能力挂在第 4 个 = 整轮重跑，前 3 个 LLM 调用白烧 ③**versions_seen 防重执行台账**：按节点记"看过哪些版本"（`_algo.py:1260-1277`），恢复时已完成节点不重触发 ④interrupt 答案作为普通 pending write 注入、节点整体重跑 + 位置计数器对答案（`types.py:811-934`）⑤存档剪枝策略（keep_latest/delete） | |

### 落地方案（抄图纸，不搬框架）
不引 langgraph 依赖——我们的会话模型/门/台账已深度耦合自有 state，整体换框架
是伤筋动骨。抄三张图纸进现有 `persistence.py`：
1. **每轮存档 + 父链**：save_session 时同步落 `checkpoints/` 目录一份带
   parent_id 的轮级快照（复用现有原子写），得到回放/分叉能力——
   前端"挑战此结论"future 可以升级成"回到第 N 轮重来"
2. **能力粒度 pending 写**：drive loop 里每个能力执行完即落
   `pendingRuns`，轮内崩溃恢复时跳过已完成能力——直接省 LLM 钱
3. **versions_seen 语义**：产物版本 + 消费方"看过版本"台账，替代目前
   "stale 集合"单一机制的粗粒度重算
优先级 2 > 1 > 3（2 有直接成本收益，1 解锁产品能力，3 是优化）。

---

## 三、信任层 / 发布闭环 —— 裁决：**不动，继续深挖**

逐行翻完两个库：**都没有**「证据不够不许写结论」的门（gate）概念。
LangGraph 的 checkpoint 记录"发生了什么"，不裁决"该不该发生"；
instructor 校验"形状对不对"，不校验"内容有没有出处"。本仓独有且成体系：
trustLevel（gated_pass/audited）+ 覆盖门（coverage gate）+ 确定性结构门 +
发布闭环 6/6 证据 + 决策台账。这是北极星（"每步有证据、每道门真实执行"）
的落地，也是对外差异化叙事的根据地。唯一建议：把这套门的语义写成独立
文档对外输出（业界没有同类物 = 内容营销素材）。

---

## 附：F2 实验（agentic pick）与本分析的关系

差距表回答"地基怎么补"；F2 回答"驾驶权怎么让"。二者独立推进：
agentic pick（`services/v5_agentic_pick.py`，SLIDERULE_AGENTIC_PICK=on）
把「下一步干什么」从规则挑选升级为 LLM 提案 + 门验收（词表封闭、
重复护栏、收敛权仍归规则、决策进台账 source="llm"），十话题双模式
对比数据见 `data/agentic-pick-eval.md`（scripts/agentic_pick_eval.py 产出）。
