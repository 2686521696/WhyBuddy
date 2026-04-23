# Web-AIGC Runtime 主线检查点（2026-04-23）

## 范围

本文不是补 `specs`，也不是给单个节点补设计文档。

本文件只做一件事：整理当前主仓 `runtime` 主线已经真实打通的节点族谱，并按以下四个维度做中文检查点归档：

- `built-in`
- `extra adapters`
- `wait-resume`
- `audit-observability`

目标是明确当前 runtime 主线已经具备哪些真实能力，哪些节点已经进入主线执行面，哪些节点已经带上等待/恢复机制，以及哪些运行时事件已经进入 replay / audit 镜像。

## 一、总览结论

截至 2026-04-23，`web-aigc` runtime 主线已经不再是空骨架，而是具备了以下四层结构：

1. 一层内建 runtime adapter。
   覆盖最小流程控制、对话、结束节点、赋值节点和人工选择节点。

2. 一层 extra runtime adapter。
   负责把已经落地的 Web-AIGC 节点逐步接入主线 runtime，而不是只停留在独立 route 层。

3. 一层 wait / resume 控制面。
   已覆盖人工选择、参数采集、人工审批型 `mcp`、高风险 `transaction_flow`，以及 terminate / retry / escalate 等运行时控制入口。

4. 一层 runtime observability bridge。
   已把核心 runtime 事件镜像到 replay / audit，并形成节点成功、失败、等待输入、变量赋值、跳转、重试、升级、终止等最小可观测面。

这说明当前 runtime 主线已经从“定义阶段”进入“编排执行 + 控制恢复 + 观测治理”并行收口阶段。

## 二、Built-in 节点族谱

以下节点类型当前由 `workflow-runtime-engine` 直接内建注册，属于 runtime 主线自带能力：

- `echo`
- `llm`
- `dialogue`
- `variable_assignment`
- `param_collection`
- `flow_jump`
- `condition`
- `end`
- `root`
- `agent_task`
- `plan`
- `review`
- `audit`
- `summary`
- `selection`
- `confirm_judge`

### Built-in 分组说明

#### 1. 对话与内容最小执行面

- `llm`
- `dialogue`

说明：

- 这两类由统一 chat runtime adapter 驱动。
- `dialogue` 在主线中已经不是纯文本回包，而是带会话、消息、增强元数据的节点类型。

#### 2. 流程控制与结果收口

- `variable_assignment`
- `flow_jump`
- `condition`
- `end`

说明：

- 这是当前 runtime 主线的最小控制流骨架。
- 其中 `variable_assignment -> condition` 的联动已经有定向测试证据。

#### 3. 人工交互与等待输入

- `selection`
- `confirm_judge`
- `param_collection`

说明：

- 这三类 built-in 节点是 runtime 主线当前 wait / resume 的基础族谱。
- `selection / confirm_judge` 走的是 HITL choice adapter。
- `param_collection` 走的是结构化表单采集 adapter。

#### 4. 投影型透传节点

- `root`
- `agent_task`
- `plan`
- `review`
- `audit`
- `summary`

说明：

- 这批节点主要承担投影与流程兼容角色，不代表它们已经具备更复杂的业务执行语义。

## 三、Extra Adapters 节点族谱

以下节点类型当前已通过 `installWebAigcRuntimeExtraAdapters(...)` 接入 runtime 主线：

- `web_search`
- `web_qa`
- `get_location_info`
- `get_device_info`
- `audio_recognition`
- `graph_search`
- `knowledge_qa`
- `qa_search`
- `mcp`
- `static_webpage_read`
- `intent_recognition`
- `long_text_extraction`
- `ai_ppt`
- `excel_read`
- `transaction_flow`
- `dynamic_chart`
- `image_search`
- `orchestration_recognition_jump`
- `file_slicing`
- `file_translation`
- `file_generation`
- `ocr_recognition`
- `similarity_match`

### Extra Adapters 分组说明

#### 1. 搜索与问答族

- `web_search`
- `web_qa`
- `graph_search`
- `knowledge_qa`
- `qa_search`
- `similarity_match`

说明：

- 这一组已经不只在 route 层存在，而是可以进入 runtime 主线执行链。
- 其中 `web_qa`、`graph_search`、`knowledge_qa` 依赖主线下游检索或知识服务注入。

#### 2. 多模态与感知族

- `audio_recognition`
- `ocr_recognition`
- `image_search`
- `static_webpage_read`
- `get_device_info`
- `get_location_info`

说明：

- 这组节点已经具备 runtime adapter 包装，不再只是独立接口。
- 其中部分节点已在 runtime 集成测试中形成最小闭环证据。

#### 3. Office / 内容生产族

- `ai_ppt`
- `excel_read`
- `dynamic_chart`
- `file_slicing`
- `file_translation`
- `file_generation`
- `long_text_extraction`

说明：

- 这组是当前主线中最接近 Office 场景的节点族谱。
- `ai_ppt / excel_read / dynamic_chart / file_slicing / file_translation / file_generation` 已有一条串联运行的 runtime 集成测试证据。

#### 4. 工具与高风险动作族

- `mcp`
- `transaction_flow`
- `orchestration_recognition_jump`

说明：

- 这组三类节点不仅有 runtime adapter，而且具备更强的 wait / resume 或治理色彩。
- 它们是 runtime 主线从“执行”走向“治理”的关键节点族。

## 四、Wait-Resume 检查点

当前 runtime 主线里，已经形成明确 wait / resume 闭环的节点或控制入口如下：

### 1. Built-in 等待恢复节点

- `selection`
- `confirm_judge`
- `param_collection`

当前状态：

- `selection / confirm_judge` 会进入 `node.waiting_input`，并在 `resume(...)` 后根据选择结果推进分支。
- `param_collection` 会在 checkpoint 中保存输入 schema，并在恢复时做表单归一化与校验。

### 2. Extra Adapter 等待恢复节点

- `mcp`
- `transaction_flow`

当前状态：

- `mcp` 在审批要求命中时进入 wait 状态，恢复时走人工批准或驳回分支。
- `transaction_flow` 已有独立的 wait / resume runtime 测试，说明该类高风险动作已进入主线控制面。

### 3. Runtime 控制入口

以下控制入口已经不属于单个节点 spec，而是 runtime 主线控制能力的一部分：

- `terminate`
- `retry`
- `escalate`
- 自动重试
- 自动升级
- loop 超限强制终止

当前状态：

- 已有显式 `terminate / retry / escalate` 控制入口测试。
- 已有自动重试、自动升级、实例级治理预算阻断等测试证据。
- loop 超 `maxIterations`、超 `maxDurationMs` 的强制终止也已经进入 runtime 主线测试面。

### 4. 当前 wait-resume 口径

当前更准确的表述是：

- runtime 主线已经具备“节点等待恢复 + 运行时控制恢复”两层能力。
- 但这不等于所有高风险节点都已经统一接入同一套人工审批编排中心。

## 五、Audit-Observability 检查点

当前 `web-aigc-runtime-observability` 已经覆盖的 runtime 事件镜像如下。

### 1. 已进入 replay 的事件

- `node.started`
- `node.completed`
- `variable.assigned`
- `node.waiting_input`
- `edge.transitioned`
- `edge.loop_iterated`
- `instance.retry_requested`
- `instance.escalated`
- `node.failed`
- `instance.terminated`

当前口径：

- replay 侧已经具备节点启动、节点完成、变量赋值、等待输入、边跳转、循环迭代、重试、升级、失败和终止的最小镜像能力。

### 2. 已进入 audit 的事件

- `node.failed` -> `AGENT_FAILED`
- `instance.terminated` -> `AGENT_FAILED`
- `node.completed` -> `AGENT_EXECUTED`
- `variable.assigned` -> `DECISION_MADE`
- `edge.transitioned` 且 `kind = jump` -> `DECISION_MADE`
- `node.waiting_input` -> `DECISION_MADE`
- `instance.retry_requested` -> `DECISION_MADE`
- `instance.escalated` -> `DECISION_MADE`

当前口径：

- runtime 成功、失败、等待、跳转、变量赋值和控制动作都已经进入 audit 最小镜像面。
- 这说明 runtime 主线现在已经具备“不是只会跑，还会留证据”的基础能力。

### 3. 当前观测边界

需要明确以下边界：

- 并不是所有节点输出里的 `observability` 字段都已经自动统一写进 runtime 事件。
- 当前 bridge 已经足够支撑最小 replay / audit 证据，但更完整的 lineage、全节点统一 telemetry 仍然属于后续收口范围。

## 六、已有测试证据摘要

### 1. Built-in 侧证据

已有明确测试覆盖以下能力：

- `param_collection` wait / resume
- `variable_assignment` 赋值与事件
- `selection / confirm_judge / end` 路径推进
- `terminate / retry / escalate`
- 自动重试与自动升级
- loop 强制终止

### 2. Extra Adapters 侧证据

已有明确 runtime 集成测试覆盖以下节点族：

- `audio_recognition`
- `ocr_recognition`
- `static_webpage_read`
- `graph_search`
- `image_search`
- `long_text_extraction`
- `intent_recognition`
- `similarity_match`

以及：

- `ai_ppt`
- `excel_read`
- `dynamic_chart`
- `file_slicing`
- `file_translation`
- `file_generation`

并且还有单独的 wait / resume 证据：

- `transaction_flow`
- `mcp`

### 3. Observability 侧证据

已有单独桥接测试覆盖以下事件：

- `node.completed`
- `variable.assigned`
- `node.waiting_input`
- `edge.transitioned`
- `instance.retry_requested`
- `instance.escalated`
- `instance.terminated`

## 七、当前 runtime 主线的更准确表述

截至 2026-04-23，当前 runtime 主线更准确的表述不是“只有引擎骨架”，而是：

1. built-in 层已经具备对话、控制流、人工选择和结果收口的最小执行骨架。
2. extra adapters 层已经把一批 Web-AIGC 节点接入主线执行面。
3. wait / resume 层已经形成节点等待恢复与运行时控制恢复两层能力。
4. audit / observability 层已经把关键 runtime 事件镜像到 replay / audit。

因此，runtime 主线当前应被视为“已打通最小平台执行主干”，而不是“仍停留在概念阶段”。

## 八、后续建议

如果继续推进，建议不是继续补 runtime specs，而是围绕以下方向继续主线收口：

1. 扩大 extra adapters 的统一 runtime 证据面。
2. 继续把高风险节点并入统一 wait / resume / approval 口径。
3. 把更多节点输出级 `observability` 字段收进统一 runtime 事件镜像。
4. 继续补 lineage 与更完整的 telemetry 主线证据。

## 结论

当前 `web-aigc` runtime 主线已经形成一张可落地的节点族谱：

- built-in 负责执行骨架
- extra adapters 负责能力扩展
- wait / resume 负责控制恢复
- audit / observability 负责运行留痕

这意味着后续重点不再是“runtime 有没有”，而是“runtime 主线如何继续统一、治理和扩面”。
