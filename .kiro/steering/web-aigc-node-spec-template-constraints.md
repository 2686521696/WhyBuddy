---
inclusion: manual
---

# Web-AIGC 节点 Spec 统一模板约束

## 目的

本文档约束后续 52 个 `web-aigc` 节点 spec 的统一写法，避免每个节点各自定义命名、状态、输入输出、观测事件和承接边界。

本文档是 `.kiro/specs/web-aigc-platform-domain-model` 的直接落地产物，面向后续所有节点 spec 编写者使用。

## 适用范围

- 适用于所有 `web-aigc-node-*` spec。
- 适用于 `requirements.md`、`design.md`、`tasks.md` 三件套。
- 不适用于平台总模型 spec、观测总模型 spec、安全治理总模型 spec 这类“平台级总前提”文档。

## 强制命名约束

### spec 目录命名

- 目录名必须使用 `web-aigc-node-<node_type>`。
- `node_type` 必须与共享领域模型中的节点类型一致。
- 不允许在目录名中引入实现细节、团队缩写或临时版本号。

### 文档标题命名

- `requirements.md` 标题格式必须为：`# 需求文档：<节点中文名>`
- `design.md` 标题格式必须为：`# 设计文档：<节点中文名>`
- `tasks.md` 标题格式必须为：`# 任务清单：<节点中文名>`

### 节点类型命名

- 文档中引用节点类型时，统一使用反引号包裹的源节点标识，例如：`user_input`
- 不允许在不同节点 spec 中为同一节点创造别名。

## 三件套统一结构

## `requirements.md` 结构约束

每个节点 spec 的 `requirements.md` 必须包含以下部分，且顺序保持一致：

1. `# 需求文档：<节点中文名>`
2. `## 目标`
3. `## 需求`
4. 至少 3 条 `### 需求 N：...`

每条需求必须满足：

- 只描述外部可观察能力，不写实现细节。
- 必须使用“系统应...”或“节点应...”句式。
- 必须覆盖以下三类中的至少三项：
  - 节点进入条件或等待条件
  - 输入/配置/输出行为
  - 恢复、分支、失败、审计、观测中的至少一项

## `design.md` 结构约束

每个节点 spec 的 `design.md` 必须包含以下部分，且顺序保持一致：

1. `# 设计文档：<节点中文名>`
2. `## 设计概述`
3. `## 接口映射`
4. `## 运行流程`

如节点复杂度较高，可在末尾追加：

- `## 状态与分支`
- `## 观测与审计`
- `## 风险与边界`

### 接口映射强制项

`## 接口映射` 中至少要写清楚：

- `web-aigc` 原节点名
- Cube 承接入口
- 若涉及人工输入，必须写出 `server/routes/tasks.ts`
- 若涉及观测、审计、回放，必须写出对应承接面，例如 `replay / audit / monitoring`

### 运行流程强制项

`## 运行流程` 必须使用编号列表，且至少覆盖：

1. 节点何时进入执行或等待
2. 输入/判断/选择如何发生
3. 如何产出输出或决策结果
4. 如何恢复、推进或分流

## `tasks.md` 结构约束

每个节点 spec 的 `tasks.md` 必须满足：

- 只写可以被证明完成的实现任务，不写空泛目标。
- 每个任务项必须能映射到代码、测试或文档产物。
- 默认控制在 3 到 6 项。
- 任务措辞统一使用动词开头，例如：
  - `定义...`
  - `复用...`
  - `写入...`
  - `接入...`
  - `验证...`

### 勾选规则

- 只有在当前主工作区已有明确产物时才能勾选。
- “代码存在但未形成闭环”不能勾选。
- “只有契约，无路由/运行时/测试”不能勾选“接入”或“验证”类任务。
- “验证”类任务原则上要求至少有可追溯测试或明确的端到端证明。

## 统一领域模型约束

后续 52 个节点 spec 都必须复用平台领域模型，不允许自创第二套模型。

### 必须复用的统一实体

- 定义态：`graph_definition / graph_version / node_schema / edge_schema`
- 运行态：`graph_instance / node_run / edge_transition / session_link`
- 投影态：`workflow_link / mission_link / replay_link / audit_link`

### 必须复用的统一状态

- `PENDING`
- `EXECUTING`
- `WAITING_INPUT`
- `EXECUTED`
- `EXCEPTION`
- `FORCE_TERMINATED`

不允许在节点 spec 中单独发明新的运行时主状态；如果有节点特有子状态，只能作为节点内部语义补充，不能替代主状态机。

## 输入/输出/配置契约约束

每个节点 spec 在设计中都必须明确三类契约：

### 输入契约

至少说明以下内容中的相关项：

- 上游变量输入
- 人工输入
- 会话输入
- 资源引用输入
- 默认值与缺省行为

### 输出契约

至少说明以下内容中的相关项：

- 写回上下文的字段
- 输出给下游边的结果
- 是否产生决策记录
- 是否产生审计/回放/lineage 关联

### 配置契约

至少说明以下内容中的相关项：

- 必填配置项
- 可选配置项
- 枚举项或选项结构
- 校验规则

## HITL 节点专项约束

若节点属于人工介入类节点，例如：

- `user_input`
- `selection`
- `param_collection`
- `confirm_judge`
- `intent_recognition`
- `command_list`
- `recommended_commands`

则 spec 必须额外写清：

- 等待态触发条件
- 提交载荷结构
- 恢复执行入口
- 是否支持自由文本
- 是否支持单选/多选
- 是否要求理由、备注或附加表单
- 是否要求记录 `sessionId / nodeId / interactionId / branchKey`

## 分支与边语义约束

只要节点会影响后续路径，design 中必须明确：

- 正常输出边
- 拒绝/异常边
- 审批通过边 / 驳回边
- 循环边或重试边（如适用）

不允许只写“推进不同分支”而不说明分支判定依据。

## 观测与审计约束

后续节点 spec 必须尽量对齐 `shared/web-aigc-observability.ts` 的统一事件目录。

### 至少需要说明的事件类型

按节点类型不同，至少说明会触发哪些事件：

- `node.started`
- `node.completed`
- `node.failed`
- `node.waiting_input`
- `edge.transitioned`
- `human.decision_submitted`
- `human.approved`
- `human.rejected`
- `instance.terminated`
- `external.vector_insert`

### 至少需要说明的关联键

如节点涉及观测或审计，必须说明使用哪些关联键：

- `workflowId`
- `missionId`
- `instanceId`
- `sessionId`
- `replayId`
- `auditEntryId`
- `lineageId`
- `nodeId`
- `edgeId`
- `decisionId`

## 与 Cube 承接面的映射约束

后续节点 spec 必须优先复用现有 Cube 承接面，不允许先假设新增一整套页面或接口。

### 默认优先承接面

- 任务与人工介入：`server/routes/tasks.ts`
- mission runtime：`server/tasks/mission-runtime.ts`
- mission persistence：`server/tasks/mission-store.ts`
- workflow projection：`server/routes/workflows.ts`
- replay：`server/routes/replay.ts`
- audit：`server/audit/audit-hooks.ts` 与 `/api/audit`

### 默认优先前端承接面

- 任务详情页
- mission / session 现有面板
- workflow context 面板

如果节点 spec 需要新页面，必须在 design 中明确说明为什么现有承接面无法复用。

## 不允许出现的写法

- 不允许只写“支持平台运行”而不写承接入口。
- 不允许只写“接入观测”而不写 sink、事件名或关联键。
- 不允许把“节点能力”写成“页面设计需求”。
- 不允许在 node spec 中重复定义平台总状态机。
- 不允许在 tasks 中直接写“完成开发”“联调通过”这类不可验证表述。

## 推荐任务模板

后续 52 个节点 spec 的 `tasks.md` 推荐优先采用以下骨架，再按节点差异裁剪：

1. `定义<节点>输入/输出/配置契约`
2. `复用现有 mission / task / decision 承接接口`
3. `写入节点等待、提交、恢复或分支事件`
4. `接入 replay / audit / lineage 中最必要的观测链路`
5. `验证该节点最关键的 1-2 个场景`

## 完成判定建议

一个节点 spec 至少满足以下条件，才建议进入“可执行”状态：

- 需求、设计、任务三件套完整
- 命名与状态模型未偏离平台总模型
- 已明确 Cube 承接面
- 已明确输入/输出/配置契约
- 已明确最小观测要求
- `tasks.md` 中不存在无法证明完成的勾选项

## 与本仓库当前阶段的关系

当前阶段目标不是一次性把 52 个节点全部实现，而是确保 52 个节点 spec 能共享一套稳定模板，便于并行拆解、低冲突落地、统一验收。

因此，后续所有节点 spec 均应优先满足“模板一致性”和“承接面一致性”，再讨论单节点的扩展能力。
