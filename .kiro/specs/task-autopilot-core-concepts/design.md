# 设计文档：任务自动驾驶核心概念

## 设计概述

本设计将“任务自动驾驶”抽象为一条从目标到交付的可解释链路：

`Destination -> Route -> Fleet -> Drive State -> Result`

在这条链路中：

- `Takeover Point` 提供人工协同入口
- `Replan` 提供偏航后的恢复机制
- `Confidence` 与 `Risk` 持续评估当前路线是否仍然可信

设计目标不是替换现有 `mission / workflow / task` 基座，而是在其上增加一层更适合产品叙事和界面表达的用户态模型。

## 核心对象

### 1. Destination

`Destination` 是用户真正想抵达的结果，不等同于一次原始输入文本。

建议包含：

- 目标描述
- 子目标
- 约束条件
- 成功标准
- 缺失信息
- 预期交付物

设计原则：

- 关注“想达到什么”，而不是“想调用什么功能”
- 可由自然语言输入解析而来
- 可被澄清和补充，但应保持语义稳定

### 2. Route

`Route` 是系统为达到 `Destination` 生成的一条可执行路线。

建议包含：

- 主路线
- 可选路线
- 阶段拆分
- 并行与串行安排
- 预期产物
- 风险点
- 接管点

设计原则：

- `Route` 面向用户解释“准备怎么完成任务”
- `Route` 不等于底层 DAG，但可投影到 `workflow`
- `Route` 可在执行中被更新，而不是一次性冻结

### 3. Drive State

`Drive State` 是任务执行过程中的用户态状态机，用于回答“系统现在在做什么”。

建议基础状态：

- `understanding`：理解目标
- `clarifying`：澄清缺口
- `planning`：规划路线
- `fleet-forming`：组织编队
- `executing`：执行路线
- `reviewing`：复核结果
- `blocked`：出现阻塞
- `takeover-required`：请求用户接管
- `replanning`：重新规划
- `delivered`：结果送达

设计原则：

- 面向产品和界面，不直接暴露底层细碎状态
- 应能映射到现有 runtime 与 workflow 阶段
- 应支持回放、审计和证据关联

### 4. Fleet

`Fleet` 是围绕当前 `Route` 被组织起来的一组角色化能力编队。

建议角色层：

- Planner
- Clarifier
- Researcher
- Generator
- Reviewer
- Auditor
- Operator

设计原则：

- 对外展示角色，不直接暴露 50+ 节点
- 对内可映射到 agent、skill、node、tool、executor
- 同一任务的 `Fleet` 可随 `Route` 和 `Drive State` 动态调整

### 5. Takeover Point

`Takeover Point` 是系统主动请求用户确认、输入或决策的路口。

典型场景：

- 目标方向不明确
- 缺少关键上下文
- 成本或权限需要授权
- 高风险动作需要确认
- 路线切换需要选择
- 最终结果需要确认交付

设计原则：

- 接管点应被显式建模，而不是零散散落在流程里
- 应记录触发原因、所需输入、影响范围和恢复方式
- 接管完成后应能返回原路线或触发 `Replan`

### 6. Replan

`Replan` 是在当前路线不再适合时，对 `Route` 的重新规划动作。

典型触发：

- 用户修改目标
- 风险升高
- 置信度下降
- 外部工具失败
- 中间结果不达标
- 关键资源不可用

设计原则：

- `Replan` 不是报错后的兜底，而是正式的运行时能力
- 应保留原路线、触发原因和新路线差异
- 应避免无边界重复重规划

### 7. Confidence

`Confidence` 是系统对当前理解、路线和结果的把握程度。

建议评估维度：

- 目标理解置信度
- 路线可行性置信度
- 执行完成度置信度
- 结果质量置信度

设计原则：

- `Confidence` 不应只是单一分数，也应支持阶段性解释
- 低置信度不一定失败，但应触发澄清、降级或接管策略
- 可作为界面提示和治理决策依据

### 8. Risk

`Risk` 是影响任务安全、质量、成本、时间和稳定性的风险集合。

建议风险类型：

- 目标歧义风险
- 数据缺失风险
- 成本超预算风险
- 权限与安全风险
- 工具依赖风险
- 结果质量风险
- 合规与审计风险

设计原则：

- `Risk` 应与路线阶段绑定，而不是只在结尾复盘
- 高风险动作需要关联 `Takeover Point`
- 风险变化应可触发 `Replan`

## 当前主线最小触发与联动原则

本节不定义未来态的统一策略引擎，而是收口当前主仓已经稳定存在于 shared / server / client 契约里的最小规则。

### 1. Risk 的当前触发口径

当前主线中的 `Risk` 先按 mission/runtime 状态做启发式推断，再投影到 autopilot summary：

- 运行失败、`operatorState = blocked` 或存在 blocker 时，`riskLevel = high`
- `mission.status = waiting` 时，`riskLevel = medium`
- 高进度运行态可以下降到 `low`
- `queued` 阶段允许保留为 `unknown`

这意味着当前 `Risk` 主要承担“路线建议、解释说明、接管/恢复提示”的读模型职责，而不是独立的策略引擎输入。

### 2. Confidence 的当前触发口径

当前主线中的 `Confidence` 同样由 mission 状态启发式推断：

- `done` 对应 `high`
- `failed`、blocked 对应 `low`
- `waiting` 与中高进度运行态默认保持 `medium`
- `queued` 阶段允许保留为 `unknown`

当前 `Confidence` 会进入 `destination.confidence` 与 `driveState.confidence`，优先服务解释、呈现与人工判断；它还没有被收敛成独立的全局自动降级/自动重规划策略。

### 3. Replan 的当前触发口径

当前主线中的 `Replan` 已经是正式读模型能力，但触发边界仍保持最小实现：

- 重试驱动的路线改写会投影为 `selectionStatus = replanned`
- 对应的选择模式会投影为 `selection.mode = runtime_replanned`
- `route.replan` 会保留 `active / reason / fromRouteId / toRouteId / triggeredBy`
- waiting、blocked、retry 等状态下，执行控制会显式暴露 `replan` action，并附带原因文本

因此，当前 `Replan` 已经不是抽象概念，而是 route summary、execution actions、recovery/explanation 三者共享的一条稳定语义。

### 4. Risk / Confidence / Replan 的当前联动规则

按当前主线直接代码与测试，可保守收口以下联动：

- `Risk -> Route`：高风险、`budget` 接管、`risk-acceptance` 接管会把路线模式推向 `deep`
- `Waiting / Takeover -> Drive State`：waiting 且存在 decision 时，驾驶状态收敛为 `takeover-required`；waiting 但没有显式 decision 时，收敛为 `clarifying`
- `Blocked / Retry -> Replan`：阻塞恢复或多次尝试场景会把路线选择状态收敛到 `replanned`，并把计划变更原因写入 `route.replan.reason` 与 `explanation.remainingSteps.replanChangeSummary`
- `Risk / Confidence -> Explanation`：风险点、置信度、重规划原因都会进入 explanation、recommendation details、remaining steps、evidence correlation 等摘要，供 projection、store 与 panel 统一消费

### 5. 当前明确不外推的边界

本 spec 只定义当前主线已经稳定落地的最小原则，不外推以下能力已经完成：

- 不把 `Confidence` 单独定义为可直接驱动自动接管或自动重规划的统一策略引擎
- 不把 `Risk + Confidence` 写成覆盖所有任务类型的全局治理矩阵
- 不把 `Replan` 外推为所有路线切换都已经具备同一条 runtime mutation 闭环

## 对象关系

### 主链路

1. 用户输入被解析为 `Destination`
2. 系统围绕 `Destination` 生成 `Route`
3. 系统根据 `Route` 组织 `Fleet`
4. 执行过程中通过 `Drive State` 对外展示当前进展
5. 当出现不确定性时，使用 `Confidence` 与 `Risk` 做判断
6. 必要时触发 `Takeover Point` 或 `Replan`
7. 最终形成任务交付结果

### 决策链路

- `Risk` 升高时，不一定立刻中断，但必须进入评估
- `Confidence` 下降时，优先考虑澄清或补信息
- `Risk` 与 `Confidence` 共同决定：
  - 继续执行
  - 请求接管
  - 降级执行
  - 重新规划

## 与 mission / workflow / task 的关系

### 分层原则

- `Destination / Route / Drive State / Fleet` 属于产品层对象
- `mission / workflow / task / runtime` 属于工程层对象
- 两层通过映射关系共存，不要求立即重命名底层实现

### 建议映射

| 自动驾驶对象 | 中文语义 | 现有工程对象 | 说明 |
| ---- | ---- | ---- | ---- |
| `Destination` | 目的地 | `mission` | 表达用户想送达的结果，可映射为一个或一组 mission |
| `Route` | 路线 | `workflow` | 表达任务完成路径，可投影到 workflow 与阶段编排 |
| `Drive State` | 驾驶状态 | runtime state / phase state | 面向用户的状态抽象，屏蔽底层细节 |
| `Fleet` | 车队编队 | agents / skills / nodes / executors | 对外展示角色化编队，对内仍是能力组合 |
| `Takeover Point` | 接管点 | HITL / decision / approval | 统一承接确认、输入、授权、审批 |
| `Replan` | 重规划 | workflow revision / retry / reroute | 对路线的正式改写动作 |
| `task` | 执行单元 | `task` | 保留为更细粒度的执行项，不提升为第一产品对象 |

### 兼容策略

- 不要求现有 `task` 升级为用户主对象
- 不要求现有 `workflow` 被新的 `Route` 完整替代
- 优先做“映射、投影、解释”，再考虑深层重构

## 设计约束

- 不在本 spec 中定义具体 UI 布局
- 不在本 spec 中定义具体 runtime API
- 不在本 spec 中引入过多新术语，避免与现有模型断裂
- 后续 specs 必须复用本文件中的对象定义与映射口径

## 2026-04-24 审计说明

本轮审计以当前主仓已经落地的 `shared/mission/autopilot.ts`、`shared/mission/api.ts` 读模型与 projection 契约为主，以 steering 文档作为兼容层和产品层口径依据，结论如下。

### 已有直接代码支撑的核心概念

`shared/mission/autopilot.ts` 已经把本 spec 中的大部分核心对象做成了稳定的 autopilot 读模型：

- `MissionAutopilotSummary` 直接暴露了 `destination`、`route`、`driveState`、`fleet`、`takeover`、`execution`、`recovery`、`evidence`、`explanation`、`bindings`
- `MissionAutopilotDriveState` 已定义 `understanding / clarifying / planning / fleet-forming / executing / reviewing / blocked / takeover-required / replanning / delivered`
- `MissionAutopilotTakeoverType` 已定义 `clarification / approval / permission / budget / risk-acceptance / route-selection / delivery-review / exception / operator`
- `MissionAutopilotRiskLevel` 与 `MissionAutopilotConfidenceLevel` 已定义 `low / medium / high / unknown`
- `MissionAutopilotFleetRoleType` 已定义 `planner / clarifier / researcher / generator / reviewer / auditor / operator / executor / custom`
- `MissionAutopilotSummary["route"]` 已包含候选路线、选中路线、路线切换、证据与 `replan` 摘要

`buildMissionAutopilotSummary()` 进一步给出了从现有 mission-first 基座向产品层对象的真实投影：

- `destination` 由 `mission.title / sourceText / summary / events` 等字段聚合得到
- `route` 由 `workflowId`、mission stages、候选路线、路线切换和 `replan` 摘要聚合得到
- `driveState` 通过 `inferMissionAutopilotDriveState()` 从 `mission.status`、`currentStageKey`、`operatorState`、`blocker` 推导
- `fleet` 通过角色类型、`boundAgents`、`boundExecutors` 和当前焦点组织成角色编队
- `takeover` 通过 `mission.waitingFor`、`mission.decision`、`decisionId`、选项与紧急度聚合得到
- `driveState.riskLevel` 与 `driveState.confidence` 分别由 `inferRiskLevel()`、`inferConfidenceLevel()` 输出

`shared/mission/api.ts` 又把这套对象固定到了公共 projection 契约里：

- `MissionProjectionView` 已暴露 `autopilotSummary?: MissionAutopilotSummary`
- `MissionProjectionView` 已暴露 `orchestration?: MissionProjectionOrchestrationView`
- `MissionProjectionOrchestrationView` 已补充 `bindings`、`controlActions`、`wait`、`replan`

这说明 `Destination / Route / Drive State / Fleet / Takeover / Replan / Confidence / Risk` 不再只是概念描述，而已经进入当前仓库的共享类型与 projection 结构。

### 已有 steering 文档支撑的分层与映射口径

当前 steering 文档已经明确给出产品层对象与工程层对象并存的兼容策略：

- `.kiro/steering/task-autopilot-platform-narrative-2026-04-23.md` 已给出 `Destination / Route / Fleet / Drive State / Takeover Point / Evidence Pack / Replay` 的产品层对象表，并说明它们在当前主仓中的承接位置
- `.kiro/steering/task-autopilot-repo-alignment-2026-04-23.md` 已明确 `task-autopilot` 是上位产品抽象，不是第二套事实源；产品层保留 `Destination / Route / Drive State / Fleet / Takeover`，工程层继续保留 `mission / workflow / runtime / decision`
- `.kiro/steering/project-overview.md` 已明确产品语言可以升级为 `Destination / Route / Drive State / Fleet / Takeover / Evidence`，但工程代码仍优先保留 `Mission / Workflow / Runtime / Decision / Audit / Replay` 主干
- `.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md` 已把 `task-autopilot-core-concepts` 放在第一批依赖主线的前置位置，并要求后续目的地解析、路线规划、驾驶状态机与驾驶舱方向复用这套对象语言

基于这些现有文档，可以保守确认本 spec 已经具备：

- 统一中文语义
- 核心对象边界
- 主链路与决策关系
- `Destination -> mission`、`Route -> workflow`、`Drive State -> runtime state` 的映射口径
- `Fleet -> agents / skills / nodes / executors` 的映射口径
- `Takeover Point -> HITL / decision / approval` 的承接关系
- 作为后续 autopilot specs 前置约束的依赖地位

## 2026-04-25 收口补注

本轮按 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts` 与 `client/src/components/tasks/TaskAutopilotPanel.tsx` 复核后，确认本 spec 已经可以把 `Replan / Confidence / Risk` 收口到“当前主线最小触发与联动原则”。

可保守成立的直接事实如下：

- shared 读模型已经稳定暴露 `route.replan`、`driveState.riskLevel`、`driveState.confidence`、`destination.confidence`、`explanation.recommendationDetails`、`explanation.remainingSteps`
- projection 会继续对齐 `selectedRouteId / recommendedRouteId / selectionStatus / replan / correlation / explanation` 等字段
- client store 会把这些字段统一归一化并兼容多来源投影
- `TaskAutopilotPanel` 已能直接消费并展示 route、takeover、recovery、explanation、risk summary、plan change 与 route evidence

因此，本 spec 现在可以保守声明：

- `Risk` 与 `Confidence` 已具备最小的 shared/server/client 一致读模型口径
- `Replan` 已具备最小的 route / execution / recovery / explanation 联动口径
- 这些规则仍然是当前主线的“最小已实现契约”，不是未来态的统一自动治理引擎
