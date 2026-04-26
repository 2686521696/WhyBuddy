# 设计文档：任务自动驾驶 Runtime 编排层

## 设计概述

任务自动驾驶 Runtime 编排层的职责，不是替换现有 `Mission Runtime`、`workflow runtime` 或 `wait-resume / retry-escalate` 机制，而是把它们组织成一条可解释、可治理、可回放的自动驾驶主线。

这条主线可以概括为：

```text
Destination
  -> Route
  -> Fleet
  -> Execute
  -> Takeover / Retry / Escalate / Replan
  -> Deliver
```

其中：

- `Mission Runtime` 负责承载任务生命周期与六阶段推进；
- `workflow runtime` 负责承载阶段、节点、分支、等待与执行事实；
- `wait-resume` 负责承接结构化人工输入与恢复；
- `retry-escalate` 负责承接恢复性重试、人工升级与异常兜底；
- Runtime 编排层负责把上面这些能力连接起来，并稳定投影为自动驾驶语义。

## 设计目标

- 让 `Destination / Route / Fleet / Takeover` 不再只是概念或界面文案，而是可落到真实运行时的编排对象。
- 让 Mission 六阶段主线与 Route、Fleet、Takeover 形成可解释映射。
- 明确 `wait-resume`、`retry`、`escalate`、`replan` 的边界，避免恢复语义混乱。
- 为驾驶舱、回放、审计、治理提供统一的 runtime 解释层。
- 在不破坏当前主仓稳定性的前提下，采用“映射优先、投影优先、兼容优先”的落地路径。

## 总体分层

### 第一层：产品语义层

这一层负责用户可理解的自动驾驶对象：

- `Destination`
- `Route`
- `Fleet`
- `Takeover`
- `Drive State`

这一层解决的是“系统准备去哪、怎么走、谁来走、什么时候交还给人”。

### 第二层：Runtime 编排层

这一层负责绑定、控制与投影：

- `Destination` 到 Mission 的绑定；
- `Route` 到 workflow runtime 的绑定；
- `Fleet` 到 agents / skills / nodes / executors 的绑定；
- `Takeover` 到 waiting / decision / approval / resume / escalate 的绑定；
- `retry / replan / terminate` 的控制决策；
- 面向 cockpit / replay / audit 的统一投影。

这一层解决的是“用什么现有能力来把自动驾驶语义真正跑起来”。

### 第三层：执行事实层

这一层是当前主仓已经存在的执行真实来源：

- `Mission Runtime`
- `workflow runtime`
- `MissionDecision / HITL / approval`
- `WAITING_INPUT -> resume()`
- `retry / escalate / terminate`
- agents / nodes / adapters / executors
- logs / artifacts / callbacks / evidence

这一层解决的是“系统实际上做了什么”。

### 第四层：证据与消费层

这一层承接编排结果与执行事实：

- cockpit
- task detail
- replay
- audit
- telemetry

这一层解决的是“用户和运营如何看懂这一趟任务行驶过程”。

## 总体架构

```text
用户目标
  -> Destination Parser
  -> Runtime Orchestration Layer
      -> Destination Binder
      -> Route Runtime Mapper
      -> Fleet Binder
      -> Takeover Bridge
      -> Recovery Coordinator
      -> Projection Builder
  -> Mission Runtime
  -> workflow runtime
  -> wait-resume / decision / approval
  -> retry / escalate / terminate
  -> replay / audit / telemetry / cockpit
```

设计原则：

- 编排层是“组织层”，不是“替换层”。
- Mission Runtime 继续是任务生命周期事实主干。
- workflow runtime 继续是阶段、节点、等待、恢复的事实执行器。
- `Takeover` 必须复用已有等待与决策链路。
- `Route` 必须通过映射落地，而不是直接替代 workflow 图。
- `Fleet` 必须对外展示角色，对内保留到底层执行资源。

## 编排主线

## 1. 接收目标

用户输入首先被解析为 `Destination`。编排层在这一阶段负责：

- 创建或绑定 Mission；
- 归一化目标、约束、成功标准、缺失信息与预期交付物；
- 判断是否可以直接进入路线规划；
- 若信息不足，生成澄清类 `Takeover`。

与 Mission Runtime 的对应关系：

- `receive`：接收原始请求，创建 Mission 事实对象；
- `understand`：理解 `Destination`，补齐上下文与缺失信息；
- `plan`：准备路线规划与后续 runtime 绑定。

## 2. 选择路线

一旦 `Destination` 足够明确，编排层会选择当前生效的 `Route`。

这一阶段负责：

- 接收 Route Planner 生成的 Route Set；
- 选定主路线或处理用户路线确认；
- 生成 Route 到 workflow runtime 的映射；
- 生成风险点、接管点和重规划前置条件。

与现有 runtime 的关系：

- `Route` 是执行计划层对象；
- `workflow runtime` 是执行图与节点事实层；
- 编排层负责把前者映射到后者，而不是让两者直接互相取代。

## 3. 组建车队

在 Mission 的 `provision` 阶段，编排层根据 `Route` 选择并绑定 `Fleet`。

这一阶段负责：

- 把高层角色映射到底层 agent / skill / node / executor；
- 准备所需 adapter、权限、外部能力与资源配额；
- 根据 Route 模式和风险策略调整编队规模与治理强度；
- 把资源不足、权限不足、预算不足等问题转换为 `Takeover` 或升级信号。

## 4. 执行路线

在 Mission 的 `execute` 阶段，workflow runtime 负责真实执行，编排层负责：

- 跟踪当前 Route Stage 与 Route Step；
- 跟踪当前 Fleet 哪些角色在工作、阻塞或等待；
- 判断当前处于正常执行、等待接管、局部重试、重规划还是升级；
- 将真实运行信号投影为 `Drive State` 与前端可读状态。

## 5. 复核与交付

在 Mission 的 `finalize` 阶段，编排层负责：

- 把 review / audit / verify / revise 归并到 `reviewing` 和最终交付链路；
- 如需结果验收，生成交付类 `Takeover`；
- 如质量不达标，决定进入局部修正、重试还是重规划；
- 在交付完成后收口证据、工件与路线结果。

## 核心对象模型

建议为编排层定义一组兼容型对象，用于服务端 projection、view model 或聚合查询，而不是替代底层 schema。

### RuntimeOrchestrationRecord

```ts
type RuntimeOrchestrationRecord = {
  id: string;
  missionId: string;
  destinationId: string;
  selectedRouteId?: string;
  driveState: string;
  status: "preparing" | "running" | "waiting" | "replanning" | "done" | "failed";
  destinationBinding: DestinationRuntimeBinding;
  routeBinding?: RouteRuntimeBinding;
  fleetBinding?: FleetRuntimeBinding;
  takeoverQueue: TakeoverRuntimeBinding[];
  controlState: OrchestrationControlState;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
};
```

### DestinationRuntimeBinding

```ts
type DestinationRuntimeBinding = {
  missionId: string;
  goalSummary: string;
  constraintsSummary: string[];
  successCriteriaSummary: string[];
  missingInfo: string[];
  deliverablesSummary: string[];
  missionStageHint: "receive" | "understand" | "plan" | "provision" | "execute" | "finalize";
};
```

### RouteRuntimeBinding

```ts
type RouteRuntimeBinding = {
  routeId: string;
  routeMode: "fast" | "standard" | "deep" | "custom";
  workflowDefinitionId?: string;
  workflowInstanceId?: string;
  stageMappings: RouteStageRuntimeBinding[];
  stepMappings: RouteStepRuntimeBinding[];
  activeRouteStageId?: string;
  activeRouteStepId?: string;
  replanHistory: RouteReplanBinding[];
};
```

### FleetRuntimeBinding

```ts
type FleetRuntimeBinding = {
  fleetId: string;
  roles: FleetRoleRuntimeBinding[];
  activeRoleIds: string[];
  blockedRoleIds: string[];
  executorRefs: string[];
  capabilityRefs: string[];
};
```

### TakeoverRuntimeBinding

```ts
type TakeoverRuntimeBinding = {
  takeoverPointId: string;
  type: string;
  blocking: boolean;
  missionDecisionId?: string;
  runtimeDecisionRef?: string;
  waitingStateRef?: string;
  escalationRef?: string;
  routeId?: string;
  routeStepId?: string;
  status: "pending" | "active" | "resolved" | "expired" | "escalated" | "cancelled";
};
```

### OrchestrationControlState

```ts
type OrchestrationControlState = {
  lastAction:
    | "run"
    | "wait"
    | "resume"
    | "retry"
    | "escalate"
    | "terminate"
    | "replan";
  retryScope?: "node" | "step" | "route";
  retryBudgetRemaining?: number;
  blockedReason?: string;
  nextExpectedAction?: string;
};
```

这些对象的设计目标是：

- 对外提供稳定投影；
- 对内保持与现有事实对象的关联；
- 允许未来逐步下沉为更正式的服务端实体；
- 当前阶段不要求直接重构底层 Mission / workflow schema。

## 编排层关联接口路径

本节用于收口“编排层与 `Mission Runtime`、`workflow runtime`、`decision / approval`、`executor` 的关联接口路径”。这里的“接口路径”不是要求当前主仓已经存在一条全新的 orchestration API，而是要把现有可复用入口按编排层责任重新整理成一张稳定的接口矩阵，明确：

- 入口路径是什么；
- 输入输出最小契约是什么；
- 编排层在这里承担什么责任；
- 哪些字段由服务端投影承担，哪些字段仍停留在底层事实层；
- 当前阶段哪些能力是“直接复用既有接口”，哪些是“需要后续补独立接口面”。

### 1. 任务级聚合读取路径

当前任务侧已经稳定存在两条编排读取主路径：

| 编排入口 | 当前路径 | 输入 | 输出 | 字段来源 | 编排层责任边界 |
| --- | --- | --- | --- | --- | --- |
| 任务投影读取 | `GET /api/tasks/:id/projection` | `missionId` | `MissionProjectionView` | `Mission Runtime` + `workflow runtime` + projection link resolver + `buildMissionAutopilotSummary()` | 负责把 Mission / workflow / decision / executor 的既有事实聚合成 `autopilotSummary + orchestration`，不直接暴露 workflow runtime 原生控制面 |
| 任务会话读取 | `GET /api/tasks/:id/session` | `missionId` | `GetMissionSessionResponse` | `Mission Runtime` + session store + projection links | 负责把 replay/session 消费所需的 `sessionId / workflowId / replayId` 锚点稳定回传，不负责表达完整 orchestration control state |

建议把这两条路径视为编排层当前的一等只读接口面：

- `GET /api/tasks/:id/projection`
  - 输入：任务主键。
  - 输出：
    - `links`
    - `autopilotSummary`
    - `orchestration`
    - `workflow`
    - `graph`
    - `monitoring`
    - `session`
  - 责任：
    - `autopilotSummary` 负责产品语义层的 `destination / route / takeover / recovery / evidence / explanation / bindings`
    - `orchestration` 负责控制语义层的 `status / currentStage / bindings / controlActions / wait / replan`
  - 边界：
    - 不在这里直接暴露 workflow runtime 的节点级原生 state machine
    - 不在这里直接暴露 executor 原生 pause/resume/job detail 契约

- `GET /api/tasks/:id/session`
  - 输入：任务主键。
  - 输出：
    - `links`
    - `session`
    - `memoryEntries`
  - 责任：
    - 为 replay/session consumer 提供编排层已解析过的 link 锚点
  - 边界：
    - 不承担 route / takeover / control action 的高层聚合

### 2. 任务级控制写入路径

当前任务侧可以稳定复用两条控制写入路径：

| 编排入口 | 当前路径 | 输入 | 输出 | 字段来源 | 编排层责任边界 |
| --- | --- | --- | --- | --- | --- |
| operator action 提交 | `POST /api/tasks/:id/operator-actions` | `action / reason / requestedBy` | `SubmitMissionOperatorActionResponse` | `Mission Runtime` operator action record | 负责写入任务级 `pause / mark-blocked / retry / escalate / terminate` 等操作事实，并让后续 projection 消费它们 |
| decision / HITL 提交 | `POST /api/tasks/:id/decision` | `optionId / freeText / detail / progress / submittedBy / metadata` | `SubmitMissionDecisionResponse` | `MissionDecision` + `decisionHistory` | 负责把 takeover / clarification / route confirmation / param collection 结果写回任务事实层 |

建议编排层把这两条路径解释为：

- `POST /api/tasks/:id/operator-actions`
  - 面向编排层的语义：
    - `retry`
    - `escalate`
    - `terminate`
    - `pause`
    - `mark-blocked`
  - 输入字段来源：
    - 来自任务详情、运营控制面、恢复治理面板
  - 输出字段落点：
    - `MissionRecord.operatorActions[]`
    - 后续投影到 `orchestration.controlActions`、`route.replan`、`recovery.attemptedActions`、`evidence.correlation.operatorActionIds`
  - 边界：
    - 这是任务级控制入口，不等于 workflow runtime 原生控制入口
    - 当前没有把 executor 的 pause/resume/job-control 收敛进同一入口

- `POST /api/tasks/:id/decision`
  - 面向编排层的语义：
    - clarification
    - route confirmation
    - approval / permission confirmation
    - risk acceptance
    - param collection
  - 输入字段来源：
    - 来自 `DecisionPanel` / HITL 表单 / route choice submit
  - 输出字段落点：
    - `MissionRecord.decision`
    - `MissionRecord.decisionHistory[]`
    - `resolved.metadata.formData`
  - 编排层责任：
    - 把提交结果解释成 `takeover resolved / route selected / clarification completed`
    - 供 `autopilotSummary` 回写 `selectedRouteId / decisionIds / takeover status / explanation.recommendationDetails`
  - 边界：
    - 当前仍是 `decision` 入口承载 approval 语义，而非独立 approval API
    - approval 只在编排语义层可解释，不代表 task 侧已有单独 `approval` 资源接口

### 3. workflow runtime 控制路径

当前 workflow runtime 已有一组独立控制入口，编排层应明确把它们视为“底层执行控制面”，而不是任务侧 API 的别名：

| 编排入口 | 当前路径 | 输入 | 输出 | 字段来源 | 编排层责任边界 |
| --- | --- | --- | --- | --- | --- |
| 启动 runtime | `POST /api/workflows/:id/runtime/run` | workflow id + request body | workflow runtime state | workflow runtime engine | 负责实例启动，不直接生成任务级 summary |
| 恢复 runtime | `POST /api/workflows/:id/runtime/resume` | workflow id + `payload` | workflow runtime state | `WAITING_INPUT -> resume()` | 负责底层等待恢复；编排层只解释其高层结果 |
| 终止 runtime | `POST /api/workflows/:id/runtime/terminate` | workflow id + reason/comment | workflow runtime state | runtime engine terminate | 负责底层执行终止 |
| 重试 runtime | `POST /api/workflows/:id/runtime/retry` | workflow id + retry params | workflow runtime state | runtime engine retry | 负责底层重试事实 |
| 升级 runtime | `POST /api/workflows/:id/runtime/escalate` | workflow id + escalation params | workflow runtime state | runtime engine escalate | 负责底层升级事实 |

编排层对这组路径的责任边界应明确为：

- 编排层不直接替代这些入口。
- 编排层需要把任务级 `route / takeover / recovery / orchestration` 语义映射到它们。
- 当前任务侧通过 `projection` 间接消费这些结果，而不是把 `/api/workflows/:id/runtime/*` 直接透传给 task detail UI。

建议形成一张“编排动作 -> workflow runtime 控制面”的映射：

| 编排动作 | 首选底层落点 | 输入摘要 | 结果回流到 |
| --- | --- | --- | --- |
| `resume` | `POST /api/workflows/:id/runtime/resume` | HITL payload / clarified params / approval payload | `wait` 关闭、`driveState` 前移、`execution.currentStepStatus` 变化 |
| `retry` | `POST /api/workflows/:id/runtime/retry` | retry reason / scope / operator comment | `orchestration.replan`、`route.replan`、`recovery.attemptedActions` |
| `escalate` | `POST /api/workflows/:id/runtime/escalate` | escalation reason / ticket / operator comment | `recovery.state`、`takeover.status`、审计链路 |
| `terminate` | `POST /api/workflows/:id/runtime/terminate` | terminate reason / requestedBy | `orchestration.status=terminated`、`driveState=blocked or delivered` |

### 4. approval / takeover 关联路径

当前 approval 语义并没有一条任务级独立 REST 资源接口，而是通过两层路径拼接：

- 任务侧：
  - `POST /api/tasks/:id/decision`
  - `GET /api/tasks/:id/projection`
- workflow runtime 侧：
  - `POST /api/workflows/:id/runtime/resume`
  - 节点级 `approval_required` / `WAITING_INPUT` 事实

因此编排层对 approval 的当前接口定义应写成“桥接路径”，而不是“独立 approval API”：

```text
approval / permission / budget
  -> MissionDecision or waiting input
  -> POST /api/tasks/:id/decision
  -> if workflow runtime is suspended:
       POST /api/workflows/:id/runtime/resume
  -> GET /api/tasks/:id/projection 回收高层 summary
```

责任边界：

- approval 的“提交动作”当前由 `decision` 入口承载。
- approval 的“执行恢复动作”当前由 workflow runtime `resume` 入口承载。
- approval 的“高层结果解释”当前由 `autopilotSummary.takeover / recovery / explanation / evidence` 承载。
- 当前阶段不要求新增 `POST /api/tasks/:id/approvals/:approvalId` 这类独立路径，但文档必须明确这是一个后续可拆分的责任面。

### 5. executor 关联路径

executor 当前的接口面同样是“任务派发 + 任务投影回读”的桥接模式：

| 编排入口 | 当前路径 | 输入 | 输出 | 字段来源 | 编排层责任边界 |
| --- | --- | --- | --- | --- | --- |
| executor job 派发 | `POST /api/executor/jobs` | executor job request | `accepted / jobId / status` | executor service | 只负责接单与返回 `jobId` |
| executor job 引用回读 | `GET /api/tasks/:id/projection` | missionId | `bindings.executorJobId` + `workflow/monitoring/execution` 切片 | Mission Runtime + projection | 负责把 executor 结果折叠进任务视图 |

当前编排层对 executor 的最小责任边界应写为：

- 任务级编排只稳定承诺 `executorJobId` 级绑定与其在 summary/orchestration 中的索引回流。
- executor 原生 pause/resume/detail/status 并未并入任务级 orchestration API。
- 若后续要做完整 orchestration control surface，应新增一层 `ExecutorRuntimeBinding`，把 `jobId / executor type / latest executor status / artifact root / callback state` 纳入任务投影，而不是继续只停留在 `executorJobId`。

### 6. 首轮统一接口面建议

结合当前主仓事实，首轮编排层建议采用“任务级聚合读 + 任务级控制写 + workflow runtime 原生控制面 + executor 原生派发面”的四段式接口结构：

```text
任务级聚合读取
  GET /api/tasks/:id/projection
  GET /api/tasks/:id/session

任务级控制写入
  POST /api/tasks/:id/operator-actions
  POST /api/tasks/:id/decision

workflow runtime 原生控制
  POST /api/workflows/:id/runtime/run
  POST /api/workflows/:id/runtime/resume
  POST /api/workflows/:id/runtime/retry
  POST /api/workflows/:id/runtime/escalate
  POST /api/workflows/:id/runtime/terminate

executor 原生派发
  POST /api/executor/jobs
```

这个定义足以支持本 spec 里“关联接口路径”这一设计任务收口，因为它已经具体到：

- 路径；
- 输入输出；
- 字段来源；
- 高层与底层责任边界；
- 当前已存在接口与后续可拆接口面的区别。

## Mission Runtime 事件字段缺口清单

本节用于收口“评估现有 Mission Runtime 事件流中需要新增或补齐的编排字段”。这里不要求当前代码已经补完这些字段，而是要形成一份可执行的差异清单，明确：

- 现有字段来自哪里；
- 哪些字段已经足够用于当前 `autopilotSummary + orchestration`；
- 哪些字段仍然缺失；
- 缺失字段应该落在 `MissionRecord`、`MissionEvent`、`operator action`、`decision payload/history` 还是服务端 projection；
- 补齐优先级与推荐落点是什么。

### 1. 当前已稳定可用的编排字段

基于当前主仓实现，Mission Runtime 事件流已经能稳定提供或派生出以下字段族：

| 字段族 | 当前来源 | 已支撑的编排语义 | 当前落点 |
| --- | --- | --- | --- |
| 生命周期状态 | `MissionRecord.status / currentStageKey / stages / progress` | `driveState`、`route.currentStage*`、`execution.currentStep*`、`orchestration.status` | `autopilotSummary`、`orchestration` |
| 等待与阻塞 | `waitingFor / blocker / operatorState / decision / timeoutAt` | `takeover`、`wait`、`recovery`、`riskPoints` | `autopilotSummary`、`orchestration.wait` |
| 控制动作 | `operatorActions[] / attempt` | `controlActions`、`replan.required`、`recovery.attemptedActions` | `orchestration.controlActions`、`route.replan` |
| 执行引用 | `projection.workflowId / instanceId / replayId / sessionId`、`executor.jobId` | `bindings`、`evidence.correlation`、session/replay link | `autopilotSummary.bindings`、`orchestration.bindings` |
| 事件与时间线 | `events[] / decisionHistory[] / operatorActions[]` | `evidence.timeline`、`runtimeEventIds`、`decisionIds`、`operatorActionIds` | `autopilotSummary.evidence` |

当前这些字段已经足够支撑：

- queued / waiting / retry-replan 三类核心任务投影；
- task detail 的 `autopilotSummary` 消费；
- replay/session 的最小 link 锚点；
- takeover / recovery / evidence correlation 的第一轮解释。

### 2. 缺口类型总表

仍需要补齐的不是“更多概念”，而是更细的编排字段分层。建议把缺口分成四类：

| 缺口类型 | 主要问题 | 推荐落点 | 优先级 |
| --- | --- | --- | --- |
| 接口关联缺口 | approval / executor / workflow control 仍缺任务级回指字段 | projection + binding objects | P0 |
| 事件语义缺口 | Mission Runtime 事件本身没有显式 `orchestrationAction / route mutation / takeover lifecycle` | `MissionEvent` 扩展或等效事件镜像 | P0 |
| 路线与恢复缺口 | retry / replan / resume 结果缺少“影响了哪条 route / step”的结构化字段 | `MissionEvent` + `operatorActions` + projection | P1 |
| 治理证据缺口 | approval / permission / risk acceptance / executor side effect 缺编排级证据引用 | `decision payload/history` + projection correlation | P1 |

### 3. 字段缺口清单

#### 3.1 接口关联缺口

这些字段的目标是把“任务级编排接口”与“底层 runtime / approval / executor”串起来：

| 缺口字段 | 当前是否存在 | 推荐来源 | 推荐落点 | 用途 |
| --- | --- | --- | --- | --- |
| `workflowRuntimeControlRef` | 否 | workflow runtime 控制提交结果 | `orchestration.controlActions[*]` 或 `OrchestrationEvent` | 让任务侧知道这次 `resume / retry / escalate / terminate` 具体落到了哪个 workflow runtime control action |
| `approvalRef` | 否 | decision payload / approval node metadata | `TakeoverRuntimeBinding` + `evidence.correlation` | 区分普通 decision 与真正审批语义 |
| `executorRef` | 部分存在，仅 `executorJobId` | Mission executor context / executor callback | `bindings` 扩展 + `FleetRuntimeBinding.executorRefs` | 将 executor 从单一 jobId 提升为可解释执行绑定 |
| `workflowDefinitionId` | 部分存在 | workflow record | `RouteRuntimeBinding` | 区分 route 绑定的是 definition 还是 instance |

建议：

- P0.1 先补 `approvalRef`
- P0.2 再补 `workflowRuntimeControlRef`
- P0.3 最后把 `executorRef` 从单 `jobId` 扩成结构化绑定

#### 3.2 事件语义缺口

当前 `MissionEvent` 足以表达“发生过什么”，但还不够表达“在编排层意味着什么”：

| 缺口字段 | 当前是否存在 | 推荐来源 | 推荐落点 | 用途 |
| --- | --- | --- | --- | --- |
| `orchestrationAction` | 否 | Mission Runtime / operator action mirror | `MissionEvent` 或等效 `OrchestrationEvent` | 明确这是 `wait / resume / retry / escalate / terminate / replan` 中哪一种 |
| `routeId` | 否 | route binding / decision payload | `MissionEvent` / `OrchestrationEvent` | 明确该事件作用于哪条 route |
| `routeStepId` | 否 | workflow node -> route step mapping | `MissionEvent` / projection | 支撑 route step 级 replay 与定位 |
| `takeoverPointId` | 部分存在，仅 `decisionId` 可侧推 | decision / waiting state | `MissionEvent` / `TakeoverRuntimeBinding` | 明确接管生命周期 |
| `stateBefore / stateAfter` | 否 | runtime transition result | `OrchestrationEvent` | 支撑 replay 与审计解释 |

建议：

- P0 先补 `orchestrationAction + stateBefore/stateAfter`
- P1 再补 `routeId + routeStepId + takeoverPointId`

#### 3.3 路线与恢复缺口

当前 `route.replan` 可以表达“路线在变”，但还不够表达“为什么变、变了什么、恢复到哪里”：

| 缺口字段 | 当前是否存在 | 推荐来源 | 推荐落点 | 用途 |
| --- | --- | --- | --- | --- |
| `replanSource` | 部分存在，仅 `triggerAction/changedBy` | operator action / runtime result | `route.replan` | 区分 planner / runtime / user / operator |
| `resumeTarget` | 否 | resume payload + workflow state | `orchestration.wait` / `execution` | 说明恢复后回到哪一个 step / node / route |
| `retryScope` | 部分存在，文档模型有，事实层未落地 | operator action reason/detail | `controlState` + projection | 区分 node / step / route 重试 |
| `routeMutationType` | 否 | route selection / replan result | `OrchestrationEvent` | 区分 recommendation、user switch、runtime replan |
| `routeChangeImpact` | 否 | route diff builder | `route.replan` / replay projection | 说明 preserved / invalidated / newly-added steps |

建议：

- P1 先补 `resumeTarget + retryScope`
- P1.5 再补 `routeMutationType + routeChangeImpact`

#### 3.4 治理与证据缺口

当前 evidence correlation 已有 `decisionIds / operatorActionIds / auditEventIds / lineageIds`，但编排治理侧仍然偏弱：

| 缺口字段 | 当前是否存在 | 推荐来源 | 推荐落点 | 用途 |
| --- | --- | --- | --- | --- |
| `approvalDecisionType` | 否 | decision payload / approval node metadata | `takeover` + `decisionHistory` | 区分 budget / permission / risk / delivery approval |
| `governancePolicyRef` | 否 | runtime governance rules | `recovery / takeover / evidence.correlation` | 让 replay/audit 能回到治理规则来源 |
| `executorArtifactRefs` | 否 | executor callback / artifact sink | `evidence.correlation` | 关联 executor 副作用与产物 |
| `escalationTicketRef` | 部分存在，散落在 reason/detail | operator action metadata | `recovery` + `OrchestrationEvent` | 标记人工升级的外部工单或值班记录 |

建议：

- P1 先补 `approvalDecisionType + escalationTicketRef`
- P2 再补 `governancePolicyRef + executorArtifactRefs`

### 4. 推荐补齐落点

为了避免把所有字段都塞进同一个对象，建议按责任边界分层：

| 落点层 | 应承担的字段 | 不应承担的字段 |
| --- | --- | --- |
| `MissionRecord` 主事实层 | 稳定生命周期字段、decision/operator action 引用、executor 基础引用 | 纯展示型 explanation 文案 |
| `MissionEvent` / `OrchestrationEvent` | 状态切换、route mutation、takeover lifecycle、resume/retry/escalate 控制事实 | 任务详情视图拼接文案 |
| `decision payload/history` | approval 语义、governance refs、route choice context | drive state 计算结果 |
| 服务端 `projection` | bindings、correlation、route/recovery/takeover 聚合切片 | workflow runtime 原生内部细节 |
| 前端 view model | 展示顺序、alias/fallback、轻量 UI 衍生字段 | 新的事实字段定义 |

### 5. 增量补齐优先级

建议把字段补齐拆成三个优先级批次：

1. `P0：先把任务级控制面补成可解释接口`
   - `approvalRef`
   - `workflowRuntimeControlRef`
   - `orchestrationAction`
   - `stateBefore / stateAfter`

2. `P1：补 route / recovery / takeover 的结构化差异`
   - `resumeTarget`
   - `retryScope`
   - `routeId / routeStepId / takeoverPointId`
   - `approvalDecisionType`
   - `escalationTicketRef`

3. `P2：补治理与 executor 深层证据`
   - `executorRef` 结构化扩展
   - `executorArtifactRefs`
   - `governancePolicyRef`
   - `routeChangeImpact`

### 6. 收口结论

基于本节，可以把“Mission Runtime 事件流字段评估”这项设计任务视为已完成，原因不是代码已经补齐，而是：

- 已形成结构化字段缺口清单；
- 每项都明确了当前是否存在；
- 明确了推荐来源、推荐落点、用途；
- 明确了增量补齐优先级；
- 明确了哪些字段应该留在事实层，哪些只适合留在 projection 层。

## 核心映射设计

### 1. `Destination -> Mission Runtime`

`Destination` 的职责是告诉系统“要去哪”，Mission Runtime 的职责是把这趟任务真正纳入生命周期推进。两者的关系不是替换，而是承载与投影。

建议映射如下：

| 自动驾驶对象 | 运行时承载对象 | 说明 |
| --- | --- | --- |
| `destination.goal` | mission title / summary / objective | 任务目标摘要 |
| `destination.constraints` | mission metadata / plan context | 时间、预算、权限、风格、范围约束 |
| `destination.successCriteria` | finalize / review / verify checks | 最终结果达标依据 |
| `destination.missingInfo` | clarification takeover / waiting | 缺失信息必须显式进入澄清链路 |
| `destination.deliverables` | artifacts contract / delivery summary | 预期交付物与最终产物对齐 |

阶段映射原则：

- `receive`：接收请求，建立 Mission 事实对象。
- `understand`：构建 `DestinationRuntimeBinding`，补齐目标与上下文。
- `plan`：在 `Destination` 已清晰的前提下生成并选择 `Route`。

关键原则：

- 不要求 `Mission` 被重命名为 `Destination`。
- `Destination` 是用户可理解的目标层对象，Mission 是执行主干承载对象。
- `Destination` 的变化必须影响运行时，而不是只改前端文案。

缺失信息与变更处理规则：

- `destination.missingInfo` 一旦命中阻塞字段，编排层优先生成 `clarification` 类 `Takeover`，并把 Mission 推入真实 waiting / decision 链路，而不是仅在界面提示。
- 用户补齐信息后，优先走 `resume()` 恢复原路径；若补齐内容改变了目标、约束或成功标准，则改为触发重绑定与 `replan`。
- 若用户修改后的 `Destination` 只影响交付物或验收标准，可重新进入 `plan` 或 `finalize` 链路，而不必强制整趟任务重建。
- `destination.successCriteria` 与 `destination.deliverables` 必须在 `finalize` 阶段继续生效，用于决定 review / verify / delivery acceptance 的实际收口。

### 2. `Route -> workflow runtime`

`Route` 的职责是说明“准备怎么走”，workflow runtime 的职责是“具体怎么执行”。编排层的关键工作，就是把前者稳定映射到后者。

建议映射如下：

| 自动驾驶对象 | 运行时承载对象 | 说明 |
| --- | --- | --- |
| `Route` | workflow definition / workflow instance | 当前选中的执行路径 |
| `Route Stage` | workflow phase / mission stage hint | 用户可读阶段与底层阶段的桥 |
| `Route Step` | workflow node / node group / adapter action | 产品层步骤到执行单元的映射 |
| `Route Risk` | governance rule / runtime policy | 风险影响执行与接管策略 |
| `Route TakeoverPoint` | decision point / waiting input / approval | 接管点进入现有人工链路 |

设计原则：

- 一个 `Route Step` 可以映射到多个底层节点。
- 多个 `Route Step` 也可以共同落在同一 workflow phase。
- `Route` 是计划对象，workflow 是执行图对象。
- `Route` 的变更必须进入 `replanHistory`，而不是静默覆盖旧值。

建议为主路线、候选路线与切换记录保留最小结构：

```ts
type RouteSelectionRuntimeBinding = {
  selectedRouteId?: string;
  candidateRouteIds: string[];
  selectionReason?: string;
  changedAt?: string;
  changedBy?: "planner" | "user" | "runtime" | "operator";
};
```

路线状态更新规则：

- `pause / wait`：当前 `Route` 不变，但当前活动 stage / step 进入阻塞态。
- `resume`：恢复当前 `Route` 的当前 stage / step，除非接管结果明确要求切换路线。
- `failed`：先记录在当前 `Route` 的执行历史中；只有当失败说明当前路线前提失效时，才升级为 `replan`。
- `replan`：写入 `replanHistory`，切换 `selectedRouteId`，并允许重新生成 `Fleet` 绑定。

### 3. `Fleet -> agent / skill / node / executor`

`Fleet` 的职责是解释“由谁来走”，底层 runtime 负责真实执行。编排层必须把用户可理解的角色，与底层执行资源稳定连接。

建议映射如下：

| Fleet 角色 | 运行时承载对象 | 说明 |
| --- | --- | --- |
| Planner | manager / planning agents / planning nodes | 负责规划与组织 |
| Clarifier | input collection / user-input / decision nodes | 负责澄清与参数补齐 |
| Researcher | search / retrieval / knowledge nodes | 负责检索与研究 |
| Generator | generation / transform / writing nodes | 负责内容或结果生成 |
| Reviewer | review / verify / judge nodes | 负责复核与校验 |
| Auditor | audit / lineage / governance units | 负责治理与审计 |
| Executor | browser / sandbox / native / external executor | 负责真实执行与副作用 |

设计原则：

- `Fleet` 对外展示角色，对内保留到底层执行资源。
- 一个角色可以绑定多个 node / agent / executor。
- 角色绑定可以随 `Route` 或 `Replan` 动态变化。
- `Fleet` 必须与 Mission 的 `provision` 和 `execute` 阶段直接相关，而不是单纯视图包装。

车队更新与健康反馈规则：

- 在 `provision` 阶段，优先完成角色绑定、资源准备、权限校验与执行器可用性检查。
- 当 `Route` 切换、`Replan` 生效或关键依赖失效时，允许 `Fleet` 发生换绑、扩编或缩编，但必须保留旧绑定到新绑定的可追踪关系。
- `Fleet` 的阻塞、失败、空闲与运行中状态，应反馈到高层 `Drive State`、当前阻塞原因与执行摘要，而不是仅保留在底层 executor / node 日志中。
- 角色健康变化若影响当前路线推进，应优先触发 `retry`、`escalate` 或 `replan` 决策，而不是静默吞掉资源异常。

### 4. `Takeover -> wait-resume / decision / approval / escalate`

`Takeover` 的职责是说明“什么时候该把方向盘交还给人”，而现有 runtime 已经具备等待、决策、审批、恢复与升级能力。编排层的职责是统一这些入口。

建议映射如下：

| Takeover 类型 | 运行时落点 | 说明 |
| --- | --- | --- |
| `clarification` | `markWaiting()` / `WAITING_INPUT` / `resume(payload)` | 缺失信息补齐 |
| `route_confirmation` | decision 提交后选择 route / trigger replan | 路线确认或切换 |
| `budget_confirmation` | approval / governance / resume | 预算确认 |
| `permission_confirmation` | capability approval / grant / deny | 权限确认 |
| `risk_acceptance` | decision + audit evidence | 风险接受 |
| `delivery_acceptance` | finalize waiting / revise / done | 交付验收 |
| `exception_takeover` | `retry / escalate / terminate / replan` | 异常接管 |

关键原则：

- 阻塞型 `Takeover` 必须驱动真实 waiting 状态。
- 非阻塞建议接管可以以队列方式展示，但仍需可审计。
- 用户提交后，不是简单关闭弹窗，而是驱动真实 `resume`、`replan`、`retry` 或 `escalate` 动作。
- 高风险接管必须同时留下 `decision / approval / audit` 引用，确保预算、权限、风险接受与交付验收可回溯。

## 与 Mission 六阶段的关系

runtime 编排层建议直接挂接 Mission 六阶段主线：

| Mission 阶段 | 编排层职责 | 自动驾驶对象主角 |
| --- | --- | --- |
| `receive` | 接收目标、建立 Mission、初始化编排记录 | `Destination` |
| `understand` | 理解目标、整理上下文、识别缺口 | `Destination`、`Takeover` |
| `plan` | 生成路线、选择路线、建立 runtime 映射 | `Route` |
| `provision` | 组建车队、准备资源、校验能力与权限 | `Fleet` |
| `execute` | 沿路线执行、等待、恢复、重试、升级 | `Route`、`Fleet`、`Takeover` |
| `finalize` | 复核、验收、交付、收口证据 | `Takeover`、`Destination` |

这使得 Mission Runtime 继续承担生命周期主干，而编排层承担高层语义解释与控制组织。

## 控制动作设计

编排层必须以有限控制动作来统一现有 runtime 主线。

### `run`

语义：

- 沿当前 `Route` 继续执行。

典型场景：

- 路线已选定；
- 车队已完成绑定；
- 当前没有阻塞型接管；
- 当前不需要重规划。

### `wait`

语义：

- 进入等待用户或外部决策的阻塞态。

典型场景：

- 缺失信息；
- 预算、权限、风险或路线确认；
- 结果待验收。

运行时映射：

- Mission waiting；
- runtime `WAITING_INPUT`；
- decision / approval pending。

### `resume`

语义：

- 接收用户输入后恢复当前执行。

典型场景：

- 澄清已回答；
- 预算已批准；
- 权限已授予；
- 交付已验收或要求修正。

运行时映射：

- `resolveWaiting()`；
- `resume(payload)`；
- orchestrator decision submit。

### `retry`

语义：

- 在当前 Route 与当前高层策略不变的前提下，对局部执行单元重试。

典型场景：

- 幂等工具失败；
- 短暂依赖不可用；
- 节点超时但仍可恢复。

关键限制：

- `retry` 不改变当前 `Route`。
- `retry` 不应吞掉需要显式解释的重规划。

### `escalate`

语义：

- 升级到人工或更高权限处理。

典型场景：

- 重试预算耗尽；
- 权限、预算、风险超过自动处理边界；
- 结果偏航且需要人工兜底。

运行时映射：

- `escalate()`；
- exception takeover；
- operator / approval / manual intervention。

### `terminate`

语义：

- 主动终止当前 Mission 或当前执行路径。

典型场景：

- 用户拒绝继续；
- 风险不可接受；
- 关键依赖永久不可用。

### `replan`

语义：

- 改写当前路线，而不是在原路径上继续硬撑。

典型场景：

- 用户修改目标或约束；
- 当前路线连续失败；
- review 发现质量不达标；
- 风险、成本、时延超阈值；
- 用户在接管中选择切换路线。

关键限制：

- `replan` 必须保留旧路线与差异记录。
- `replan` 可以触发新的 `Fleet` 绑定。

### 控制动作作用范围

建议的最小作用范围如下：

| 控制动作 | 默认作用范围 | 说明 |
| --- | --- | --- |
| `run` | `step / route` | 沿当前路线继续推进当前步骤，必要时拉起后续阶段 |
| `wait` | `step / mission` | 当前步骤或整趟任务进入等待输入 / 决策 / 审批 |
| `resume` | `step / route / mission` | 依据接管结果恢复原路径、切换路线或恢复整趟任务 |
| `retry` | `node / step / route` | 从局部执行单元向外扩展，但不直接改变高层路线承诺 |
| `escalate` | `mission` | 将控制权升级到人工或更高权限链路 |
| `terminate` | `route / mission` | 终止当前路线或整趟任务 |
| `replan` | `route / mission` | 改写当前路线，并允许重绑 `Fleet` 与后续执行主线 |

## `wait-resume`、`retry-escalate` 与 `replan` 的边界

这是 runtime 编排层最关键的边界定义。

### 适合 `wait-resume` 的场景

- 需要补充缺失信息；
- 需要用户确认路线；
- 需要预算、权限、风险接受或结果验收；
- 任务本身并未换路，只是等待外部输入。

### 适合 `retry` 的场景

- 当前步骤仍然合理；
- 当前路线仍然成立；
- 失败原因是局部且可恢复的；
- 重试不会显著改变任务策略与成本结构。

### 适合 `escalate` 的场景

- 高风险动作需要人工兜底；
- 重试预算耗尽；
- 系统无法安全决定下一步；
- 需要更高权限、人工审批或人工接管。

### 适合 `replan` 的场景

- 当前路线前提已失效；
- 用户目标、约束、优先级发生变化；
- 结果质量与成功标准明显不匹配；
- 局部重试已经不能解决结构性问题。

建议决策矩阵：

| 触发情况 | 编排决策 | 运行时动作 |
| --- | --- | --- |
| 缺失成功标准 | 等待接管 | `wait -> resume` |
| 权限未授权 | 等待或升级 | `wait` 或 `escalate` |
| 单节点网络抖动 | 局部恢复 | `retry` |
| 工具连续失败且替代方案存在 | 改路 | `replan` |
| 风险超阈值且无法自动降级 | 人工兜底 | `escalate` |
| 用户切换快速路线到深度路线 | 改路并重编队 | `replan` |

### Mission 六阶段允许动作矩阵

| Mission 阶段 | 允许的主要动作 | 说明 |
| --- | --- | --- |
| `receive` | `run`、`wait`、`terminate` | 接收请求、校验入口、必要时直接等待补充输入 |
| `understand` | `run`、`wait`、`resume`、`terminate` | 目标理解与澄清阶段，优先进入 clarification takeover |
| `plan` | `run`、`wait`、`resume`、`replan`、`terminate` | 允许路线确认、路线切换与计划阶段重规划 |
| `provision` | `run`、`wait`、`resume`、`retry`、`escalate`、`terminate` | 资源准备、权限检查、能力校验可局部恢复或升级 |
| `execute` | `run`、`wait`、`resume`、`retry`、`escalate`、`replan`、`terminate` | 主执行阶段是控制动作最完整的阶段 |
| `finalize` | `run`、`wait`、`resume`、`retry`、`escalate`、`replan`、`terminate` | 复核、验收、修正与交付收口阶段允许再次等待、升级或改路 |

## 高层状态投影

编排层应负责把 Mission、workflow、fleet、takeover 的信号统一解释为高层 `Drive State`。

建议投影方式：

| 编排层信号 | Drive State |
| --- | --- |
| Destination 仍在归一化 | `understanding` |
| 存在缺失信息且等待补充 | `clarifying` |
| 正在生成或切换路线 | `planning` |
| 正在绑定角色、资源、执行器 | `fleet-forming` |
| workflow 正在推进主执行链路 | `executing` |
| review / audit / verify 激活 | `reviewing` |
| runtime 无法前进 | `blocked` |
| 存在阻塞型 takeover | `takeover-required` |
| 当前 Route 已切换或重写 | `replanning` |
| 结果完成并可交付 | `delivered` |

关键原则：

- 高层状态不直接替代底层 runtime state。
- 状态切换必须能被 replay / audit 重建。
- `takeover-required`、`blocked`、`replanning` 必须在语义上彼此区分。

## 事件与证据设计

编排层应输出一组可重建、可追踪的编排事件，而不是只在前端临时拼装状态。

建议事件至少包含：

```ts
type OrchestrationEvent = {
  id: string;
  missionId: string;
  routeId?: string;
  routeStepId?: string;
  fleetRoleId?: string;
  takeoverPointId?: string;
  action:
    | "destination_bound"
    | "route_selected"
    | "fleet_bound"
    | "takeover_requested"
    | "takeover_resolved"
    | "retry_requested"
    | "escalated"
    | "replanned"
    | "delivered";
  reason?: string;
  relatedRuntimeEventId?: string;
  relatedDecisionId?: string;
  createdAt: string;
};
```

这些事件的用途：

- cockpit 展示当前主线；
- replay 重建任务行驶时间线；
- audit 解释关键人工与自动决策；
- telemetry 统计等待、重试、升级与重规划分布。

replay / audit 重建规则：

- replay 应优先按 `OrchestrationEvent` 的顺序重建“绑定 -> 选路 -> 编队 -> 接管 / 重试 / 升级 / 重规划 -> 交付”的主线，而不是只展示孤立 runtime 日志。
- `takeover_requested / takeover_resolved / retry_requested / escalated / replanned` 必须能回连 `relatedRuntimeEventId` 或 `relatedDecisionId`，否则只能作为弱解释证据。
- audit 侧至少应能记录预算确认、权限确认、风险接受、交付验收四类高风险治理动作，并与对应的 `TakeoverRuntimeBinding` 或 `OrchestrationEvent` 关联。
- 若 replay 能看到路线切换或接管，但 audit / decision 没有对应治理引用，则该段应被标记为“解释不完整”，而不是冒充完整闭环。

## 与现有系统的兼容策略

### 策略 1：投影优先，不立即改名

短期内不要求：

- 把 `Mission` 改名为 `Destination`；
- 把 `Workflow` 改名为 `Route`；
- 把 runtime state 改名为 `Drive State`；
- 把 decision / approval 全部改名为 takeover。

短期应优先：

- 新增 binding；
- 新增 projection；
- 新增 orchestration event；
- 新增前端 view model 消费层。

### 策略 2：Mission Runtime 继续做事实主干

Mission Runtime 继续负责：

- 生命周期；
- 六阶段推进；
- waiting / done / failed 事实状态；
- 工件、事件、实例信息聚合。

编排层只负责解释、连接与控制组织。

### 策略 3：workflow runtime 继续做执行事实层

workflow runtime 继续负责：

- 节点推进；
- 分支与并行；
- `WAITING_INPUT`；
- `resume()`；
- `retry / escalate / terminate`。

编排层负责把这些信号组织成 Route、Fleet、Takeover 语义。

### 策略 4：Web-AIGC 节点继续保留为内部执行单元

不要求把 50+ 节点直接暴露给用户作为主产品语言。短期仍采用：

- 内部继续节点编排；
- 外部通过 Route Step、Fleet Role、Takeover Point 来解释。

## 2026-04-24 审计说明

基于当前主仓实现与直接测试，Runtime Orchestration 已经稳定落地并被验证的能力，集中在服务端 `projection` 的最小编排视图，而不是完整的编排控制语义。

当前已直接落地并有测试支撑的字段范围包括：

- `MissionProjectionOrchestrationView` 的最小结构：`status`、`currentStageKey`、`currentStageLabel`、`blockingReason`、`updatedAt`
- `bindings` 关联键：`missionId`、`workflowId`、`instanceId`、`decisionId`、`executorJobId`
- `controlActions` 的当前可用 operator actions、最近操作记录与最后操作记录
- `wait` 的 `active / reason / decisionId / timeoutAt`
- `replan` 的 `required / active / attempt / reason / triggerAction / updatedAt`

当前直接测试覆盖了三类代表性场景：

- queued mission 的基础 orchestration projection
- waiting mission 的 decision / wait 投影
- retry 驱动的 replan-aware orchestration 投影

这些测试能够证明：当前编排层已经把 Mission、workflow、decision、executor 的部分事实，稳定映射到 `/api/tasks/:id/projection` 的 `orchestration` 字段中。

补查当前 shared/server/client 消费链后，还可以进一步确认：

- `client/src/lib/tasks-store.ts` 当前已经把服务端投影、共享 summary 与 fallback summary 统一归一到 `detail.autopilotSummary`，并由 `client/src/lib/tasks-store.autopilot.test.ts` 覆盖 summary/detail/fallback 三条链路
- `client/src/components/tasks/TaskDetailView.tsx` 通过 `TaskAutopilotPanel.tsx` 消费 `detail.autopilotSummary`，`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已验证 task detail 级驾驶舱切片与 evidence correlation 计数展示
- `server/tests/mission-routes.test.ts` 当前不仅覆盖 `/api/tasks/:id/projection` 的 `autopilotSummary` / `orchestration` 投影，也覆盖 `/api/tasks/:id/session` 与 projection links 的对齐，因此 replay / session 消费侧至少有稳定的 link 锚点
- 因此“评估 cockpit、task detail、replay、audit 对编排层投影的消费方式”这一项，可以保守视为已完成评估：当前真实消费链成立的是 `autopilotSummary -> detail/task detail panel` 与 `projection/session links -> replay/session consumer`，而不是 UI 已直接消费 `projection.orchestration`
- `shared/workflow-domain.ts` 与 `shared/__tests__/workflow-domain.test.ts` 已把 `WAITING_INPUT`、`FORCE_TERMINATED` 等 runtime 状态映射收敛到共享域模型；`server/routes/workflows.ts` 明确暴露 `resume`、`terminate`、`retry`、`escalate` 的 runtime 控制入口；`server/tests/workflow-runtime-engine.test.ts` 与 `server/tests/workflows-routes.test.ts` 则直接覆盖了 `WAITING_INPUT -> resume()`、显式 `terminate()`、手动 `retry()`、显式 `escalate()` 的引擎与路由接入点。因此“评估现有 workflow runtime 中 WAITING_INPUT、resume()、retry / escalate / terminate 的接入点”这一项，本轮可以保守视为已完成评估，但边界仍是 workflow runtime 自身的控制入口与状态映射已被审计，不代表 autopilot orchestration UI 已直接消费这些 runtime API。

但基于当前文档收口与仓库已有 runtime/orchestration 能力，本轮可以保守视为“设计闭环”的内容包括：

- `Destination / Route / Fleet / Takeover` 四类对象进入 runtime 的最小编排字段集合
- `Destination -> Mission`、`Route -> workflow runtime`、`Fleet -> runtime resources`、`Takeover -> wait-resume / decision / escalate` 的最小映射口径
- `run / wait / resume / retry / escalate / terminate / replan` 七类动作的统一语义
- 控制动作的默认作用范围，以及 Mission 六阶段允许动作矩阵
- `wait-resume`、`retry-escalate`、`replan` 的边界与决策矩阵
- `OrchestrationEvent` 事件结构、replay 重建规则与 audit 治理证据要求

结合上文新增的“编排层关联接口路径”与“Mission Runtime 事件字段缺口清单”两节，本轮可以继续收口以下两项设计任务：

- `定义编排层与 Mission Runtime`、`workflow runtime`、`decision / approval`、`executor` 的关联接口路径`
  - 已在“编排层关联接口路径”中按任务级聚合读取、任务级控制写入、`workflow runtime` 原生控制、`approval / takeover` 桥接、`executor` 派发五个接口面完成定义，并补充了输入输出、字段来源、责任边界与首轮统一接口结构。
- `评估现有 Mission Runtime 事件流中需要新增或补齐的编排字段`
  - 已在“Mission Runtime 事件字段缺口清单”中形成当前字段族、缺口分类、字段级补齐建议、推荐落点与 `P0 / P1 / P2` 优先级，可作为后续实现与测试补齐的设计基线。

本轮审计结论：

- 从代码直证角度，`approval` 独立接口与 `executor` 完整 control surface 仍未落地。
- 从本 spec 设计收口角度，上述两项已经具备直接设计覆盖，可以在 `tasks.md` 勾选。
- 这些勾选仍代表设计闭环，不代表 shared / server / client 已经形成完整编排实现。

补充边界说明：

- 本轮新增勾选的“消费方式评估”只表示当前 consumer map 已经被代码与测试明确审计
- 本轮新增勾选的“workflow runtime 接入点评估”只表示 `WAITING_INPUT / resume / retry / escalate / terminate` 已有共享状态映射、服务路由入口与测试覆盖，不表示 runtime orchestration 已形成统一的 approval / executor 契约面
- 它不表示 cockpit / task detail 已开始直接读取 `projection.orchestration`
- 它也不表示 replay / audit 已经具备完整的独立运行时界面，只表示 replay/session/audit 相关 link 与 evidence 索引的最小消费锚点已经可验证

## 2026-04-25 审计补记（lane 3）

围绕本轮指定的 orchestration bindings / control actions / Mission Runtime / workflow runtime / decision / executor 相关实现，再做一次保守核对后，可以把当前已落地证据进一步收紧为下面几层：

- shared 契约层：
  `shared/mission/api.ts` 已把任务侧最小编排视图固定为 `MissionProjectionOrchestrationView`，明确了 `bindings`、`controlActions`、`wait`、`replan` 的外部契约；`MISSION_API_ROUTES` 也只直接暴露了任务侧 `projection / session / operator-actions / decision` 路径，并没有单独的 orchestration approval/executor 契约面。
- shared 自动驾驶摘要层：
  `shared/mission/autopilot.ts` 已稳定定义 `MissionAutopilotControlActionType`、`MissionAutopilotBindingsSummary`、`MissionAutopilotEvidenceCorrelationIndex`、`MissionAutopilotRouteReplanSummary`、`MissionAutopilotTakeoverSummary` 等结构，并由 `buildMissionAutopilotSummary()` 从 Mission/workflow 事实派生 route、takeover、execution、recovery、evidence、bindings。
- 服务端 projection 层：
  `server/tasks/mission-projection.ts` 当前明确只做两类投影：一类是 `buildMissionAutopilotSummary()` 生成的 `autopilotSummary`，另一类是 `buildOrchestrationView()` 生成的最小 `orchestration`。其中 `orchestration` 只稳定覆盖 `status / currentStage / blockingReason / bindings / controlActions / wait / replan`，并通过 link alignment 把 workflow/session/replay 锚点回填到 projection。
- workflow runtime 接入层：
  `server/routes/workflows.ts` 已明确提供 `/runtime/resume`、`/runtime/terminate`、`/runtime/retry`、`/runtime/escalate` 四个入口；`shared/workflow-domain.ts` 则把 `WAITING_INPUT`、`FORCE_TERMINATED` 等状态收敛为共享模型。`server/tests/workflows-routes.test.ts` 与 `server/tests/workflow-runtime-engine.test.ts` 直接证明这些 runtime control 入口与 `WAITING_INPUT -> resume()`、`retry()`、`terminate()`、`escalate()` 语义是可执行且已被测试的。
- 前端消费层：
  `client/src/lib/tasks-store.ts` 会优先读取 `mission.autopilotSummary`、`mission.autopilotProjection`、`mission.autopilot.summary`、`mission.projection.autopilotSummary` 等候选来源，并统一归一到 `detail.autopilotSummary`；`client/src/lib/tasks-store.autopilot.test.ts` 直接覆盖了这些 alias 与 fallback 补齐链路。
  `client/src/components/tasks/TaskAutopilotPanel.tsx` 当前只消费 `detail.autopilotSummary`，并把 route / driveState / fleet / recovery / evidence / explanation / takeover 渲染成 task detail 面板；`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接验证 evidence correlation identifiers 与 indexed counts 的展示。

因此，本轮可以继续保守确认的事实是：

- 代码与测试已经直接支撑“workflow runtime 接入点评估已完成”。
- 代码与测试已经直接支撑“task detail / replay-session 锚点等消费方式已完成评估”。
- 代码与测试已经直接支撑“服务端优先聚合、前端消费 `autopilotSummary` 并做 fallback normalization”的首轮实现路径。

但本轮需要区分“代码已完全落地”和“设计任务已收口”：

- 从实现现状看，`approval` 仍主要通过 `decision + resume` 桥接，`executor` 仍以 `executorJobId` 级绑定为主，尚未形成独立 orchestration control surface。
- 从设计文档看，上述缺口已经在“编排层关联接口路径”与“Mission Runtime 事件字段缺口清单”中被明确记录为桥接方式、字段缺口、补齐建议与优先级，因此这两项设计任务可视为完成。

## 2026-04-25 复核补记（runtime orchestration lane）

本轮仅以 `shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`shared/mission/api.ts`、`shared/mission/index.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts` 为直接证据重新收口。

- 这些证据已经足够证明当前落地形态是“服务端构建 `autopilotSummary + orchestration`，前端优先消费 `autopilotSummary` 并做 alias/fallback 归一”，而不是前端直接消费一套独立的 orchestration runtime API。
- 这些证据也足够证明当前任务侧已稳定暴露 `bindings / controlActions / wait / replan / evidence correlation / takeover / recovery` 等投影字段，并且已有任务级测试覆盖 queued / waiting / retry-replan 等代表场景。
- 设计文档现已进一步把 `Mission Runtime`、`workflow runtime`、`approval / takeover`、`executor` 的接口桥接路径整理成显式矩阵，可作为后续实现对账基线。
- 设计文档现已进一步给出 Mission Runtime 事件字段缺口、推荐落点与补齐优先级，可作为后续事件层与 projection 层增量补齐清单。

## 落地建议

建议按以下顺序落地：

1. 建立编排层对象与字段契约。
2. 建立 `Destination / Route / Fleet / Takeover` 四类 binding。
3. 建立 Mission Runtime 与 workflow runtime 到编排层的投影。
4. 建立 `wait-resume`、`retry-escalate`、`replan` 的决策规则。
5. 让 cockpit、task detail、replay、audit 统一消费编排层。

## 风险与边界

### 风险 1：只有文档概念，没有真实绑定

如果只写了自动驾驶对象，却没有 `mission / workflow / runtime / decision` 绑定，就会让编排层变成纯叙事层，无法真正解释运行时。

### 风险 2：把重规划写成重试

如果无法区分 `retry` 与 `replan`，前端和审计都会误判系统只是“又试了一次”，而看不到路线真的变化了。

### 风险 3：把接管做成孤立弹窗系统

如果 `Takeover` 不复用现有 `wait-resume / decision / approval / escalate`，就会产生两套人工介入体系，最终状态会失真。

### 风险 4：试图一次性重构底层命名

如果一开始就试图把底层 `Mission / Workflow / Runtime` 全部替换为新词，会带来高噪音改动和大范围回归风险，不符合当前仓库的演进路径。

## 设计结论

本 spec 的最终设计结论如下：

1. Runtime 编排层是自动驾驶对象与现有执行主线之间的兼容层与组织层。
2. `Destination` 映射到 Mission Runtime 的任务理解与生命周期主线。
3. `Route` 映射到 workflow runtime 的阶段、步骤、节点与控制路径。
4. `Fleet` 映射到 agent / skill / node / executor / adapter 的动态编组。
5. `Takeover` 映射到 `wait-resume / decision / approval / escalate`。
6. `retry`、`escalate`、`replan` 必须在编排层被清晰区分。
7. 首轮落地应优先做 binding、projection 与事件，而不是立刻重写底层 runtime。
