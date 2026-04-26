# 设计文档：路线规划器与路线模型

## 设计目标

Route Planner 负责把 Destination 转换为可执行、可解释、可接管、可审计的 Route 计划对象，并让这套计划对象同时服务于三类消费者：

- 产品层：驾驶舱、任务详情、路线比较、偏航说明、接管面板；
- 编排层：Mission Runtime、workflow runtime、HITL、recovery、governance；
- 观测层：evidence、telemetry、replay、audit、lineage。

本设计不要求立即重构现有 `mission / workflow / task` 底层命名，而是在产品层补齐 Route 抽象，并明确 Route 目标模型与当前主线最小 projection contract 的边界。

## 1. 设计原则

### 1.1 Route 不是 workflow 图的别名

- Route 是面向用户和规划层的任务路线；
- workflow / runtime 是底层执行图与控制面；
- 一个 RouteStep 可以映射到多个 workflow node；
- 多个 RouteStep 也可以聚合映射到同一个 workflow phase。

### 1.2 设计闭环与代码闭环分开记账

- 本 spec 中被勾选的任务，如果属于“定义 / 设计 / 建立映射 / 补测试计划”，默认表示文档设计已收口；
- 只有明确写到 shared / server / client / tests 已有锚点的部分，才表示当前仓库存在直接消费事实；
- 独立 Route 存储、结构化风险/接管/重规划记录、RouteStep 拓扑执行与 replay snapshot 持久化仍属于后续实现目标。

### 1.3 当前主线必须兼容最小 Route contract

当前稳定 contract 以 `MissionAutopilotSummary.route` 为核心，相关字段已通过：

- `shared/mission/autopilot.ts`
- `server/tasks/mission-projection.ts`
- `client/src/lib/tasks-store.ts`
- `client/src/components/tasks/TaskAutopilotPanel.tsx`
- `shared/__tests__/mission-autopilot.test.ts`
- `server/tests/mission-routes.test.ts`
- `client/src/lib/tasks-store.autopilot.test.ts`
- `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`

形成最小 shared / server / client 闭环。

## 2. 当前最小 Contract 与目标模型

### 2.1 对齐总览

| 设计关注点 | 目标模型 | 当前主线最小 contract | 当前状态 |
| --- | --- | --- | --- |
| 路线集合 | `RouteSet` | `route.candidateRoutes + recommendedRouteId + selectedRouteId + selection.*` | 已有最小投影，未独立持久化 |
| 路线本体 | `Route` | `route.id / label / mode / status / progress / stages` | 已有最小投影，未独立领域化 |
| 路线步骤 | `RouteStep[]` | `execution.currentStep* + explanation.remainingSteps` | 仅有摘要，未结构化 |
| 并行图 | `RouteParallelGroup[]` | `execution.parallelBranchCount` | 仅有并行度摘要 |
| 风险 | `RouteRisk[]` | `route.riskPoints: string[]` | 仅有字符串摘要 |
| 接管 | `RouteTakeoverPoint[]` | `route.takeoverPointIds + takeover.*` | 仅有 summary contract |
| 运行时映射 | `RouteRuntimeMapping` | `route.stages + bindings.* + execution.availableActions + recovery.suggestedActions` | 已有部分投影 |
| 重规划 | `RouteReplanRecord[]` | `selectionStatus = replanned + route.replan + route.evidence.events + remainingSteps.replanChangeSummary` | 已有最小摘要 |
| 审计回放 | `RoutePlannerInputSnapshot / RouteExecutionSnapshot / RouteReplaySnapshot` | `evidence.correlation + route.evidence + explanation.*` | 已有索引级关联，未独立快照化 |

### 2.2 当前最小 Route contract

当前主线中可以被直接消费的 Route 事实字段如下：

```ts
type CurrentRouteProjection = {
  id: string;
  label: string;
  mode: "fast" | "standard" | "deep" | "custom";
  status: "pending" | "running" | "completed" | "completed_with_errors" | "failed";
  progress: number;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  stages: MissionAutopilotRouteStage[];
  riskPoints: string[];
  takeoverPointIds: string[];
  recommendedRouteId: string | null;
  selectedRouteId: string | null;
  candidateRoutes: MissionAutopilotCandidateRoute[];
  selectionStatus:
    | "recommended"
    | "alternatives-available"
    | "user-selected"
    | "locked"
    | "replanned";
  selectionLocked: boolean;
  selection: MissionAutopilotRouteSelectionSummary;
  evidence: MissionAutopilotRouteEvidenceSummary;
  replan: MissionAutopilotRouteReplanSummary;
  changeReason: string | null;
};
```

这套 contract 负责当前主线的最小产品展示与跨层透传，不应被误写成已经等价于完整 `RouteSet / Route / RouteStep / RouteRisk / RouteTakeoverPoint / RouteReplanRecord`。

## 3. 目标 Route 模型

### 3.1 RouteSet

```ts
type RouteSet = {
  id: string;
  destinationId: string;
  missionId?: string;
  workflowId?: string;
  recommendedRouteId: string;
  selectedRouteId?: string;
  routes: Route[];
  generatedAt: string;
  plannerVersion: string;
  planningContextSummary: string;
  generationReasonSummary: string[];
};
```

字段说明：

- `recommendedRouteId` 指向推荐路线；
- `selectedRouteId` 指向当前实际采用路线，允许与推荐路线不同；
- `planningContextSummary` 面向用户和审计；
- `plannerVersion` 允许回放时还原规划器语义。

### 3.2 Route

```ts
type Route = {
  id: string;
  destinationId: string;
  missionId?: string;
  workflowId?: string;
  name: string;
  title: string;
  mode: RouteMode;
  status: RouteStatus;
  summary: string;
  recommendationReason: string;
  comparisonSummary: RouteComparisonSummary;
  stages: RouteStage[];
  steps: RouteStep[];
  parallelGroups: RouteParallelGroup[];
  risks: RouteRisk[];
  takeoverPoints: RouteTakeoverPoint[];
  estimates: RouteEstimates;
  runtimeMapping: RouteRuntimeMapping;
  governance: RouteGovernanceProfile;
};
```

### 3.3 RouteMode / RouteStatus

```ts
type RouteMode = "fast" | "standard" | "deep" | "custom";

type RouteStatus =
  | "planned"
  | "selected"
  | "executing"
  | "paused"
  | "takeover_required"
  | "replanning"
  | "delivered"
  | "failed"
  | "cancelled";
```

### 3.4 RouteStage

```ts
type RouteStage = {
  id: string;
  key: string;
  name: string;
  description: string;
  order: number;
  status: "pending" | "running" | "done" | "failed";
  stepIds: string[];
  workflowPhaseHint?: string;
};
```

建议高层阶段：

- understand
- clarify
- plan
- fleet
- execute
- review
- deliver

### 3.5 RouteStep

```ts
type RouteStep = {
  id: string;
  stageId: string;
  key: string;
  title: string;
  description: string;
  type: RouteStepType;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  dependencies: string[];
  expectedOutputs: string[];
  ownerRole?: string;
  optional?: boolean;
  runtimeRef?: RouteRuntimeRef;
  riskIds: string[];
  takeoverPointIds: string[];
};

type RouteStepType =
  | "understand"
  | "clarify"
  | "plan"
  | "research"
  | "generate"
  | "execute"
  | "review"
  | "audit"
  | "revise"
  | "deliver"
  | "human_decision";
```

### 3.6 RouteParallelGroup

```ts
type RouteParallelGroup = {
  id: string;
  title: string;
  stepIds: string[];
  joinStepId: string;
  maxConcurrency?: number;
  fallbackMode: "serial" | "skip_optional" | "takeover";
  fallbackReason?: string;
};
```

### 3.7 RouteRisk

```ts
type RouteRisk = {
  id: string;
  routeId: string;
  stepId?: string;
  type: RouteRiskType;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  triggerCondition: string;
  mitigation: string;
  impactScope: "step" | "stage" | "route" | "mission";
  requiresTakeover: boolean;
};

type RouteRiskType =
  | "missing_context"
  | "permission_required"
  | "budget_overrun"
  | "quality_uncertain"
  | "tool_failure"
  | "data_trust"
  | "long_running"
  | "policy_sensitive";
```

### 3.8 RouteTakeoverPoint

```ts
type RouteTakeoverPoint = {
  id: string;
  routeId: string;
  stepId?: string;
  type: RouteTakeoverType;
  required: boolean;
  blocking: boolean;
  reason: string;
  triggerCondition: string;
  prompt: string;
  options: RouteTakeoverOption[];
  defaultOptionId?: string;
  timeoutPolicy?: RouteTakeoverTimeoutPolicy;
  runtimeDecisionRef?: string;
};

type RouteTakeoverType =
  | "clarification"
  | "route_selection"
  | "permission_confirm"
  | "budget_confirm"
  | "risk_acceptance"
  | "result_acceptance"
  | "manual_override";
```

### 3.9 RouteEstimates / Governance / RuntimeMapping

```ts
type RouteEstimates = {
  estimatedDuration: string | null;
  estimatedCost: string | null;
  estimatedTakeovers: number | null;
  automationLevelHint: "manual" | "assisted" | "semi-auto" | "high-auto";
};

type RouteGovernanceProfile = {
  reviewDepth: "light" | "standard" | "deep";
  auditRequired: boolean;
  externalSideEffectsAllowed: boolean;
  maxBudgetBand: "low" | "medium" | "high" | "custom";
  policySensitivity: "low" | "medium" | "high";
};

type RouteRuntimeMapping = {
  missionId?: string;
  workflowId?: string;
  workflowDefinitionId?: string;
  stageMappings: RouteStageRuntimeMapping[];
  stepMappings: RouteStepRuntimeMapping[];
  eventCorrelationKey: string;
};

type RouteStageRuntimeMapping = {
  routeStageId: string;
  missionStageKey?: string;
  workflowPhase?: string;
};

type RouteStepRuntimeMapping = {
  routeStepId: string;
  workflowPhase?: string;
  workflowNodeId?: string;
  adapterName?: string;
  agentRole?: string;
  decisionPointId?: string;
  runtimeControl?: "run" | "wait" | "resume" | "retry" | "replan" | "escalate" | "terminate";
};
```

### 3.10 RouteReplanRecord

```ts
type RouteReplanRecord = {
  id: string;
  previousRouteId: string;
  nextRouteId: string;
  reason: string;
  triggerType: "user" | "runtime" | "governance" | "system";
  changedStepIds: string[];
  preservedStepIds: string[];
  inputSnapshotId?: string;
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
  createdAt: string;
};
```

## 4. 路线模式设计

### 4.1 统一语义矩阵

| 模式 | 产品语义 | 默认策略 | 接管密度 | 治理强度 |
| --- | --- | --- | --- | --- |
| `fast` | 快速出结果 | 少步骤、少等待、少复核 | 低 | 轻量 |
| `standard` | 平衡质量与效率 | 保留关键澄清与单轮 review | 中 | 标准 |
| `deep` | 深度交付与高可信 | 增加研究、复核、证据与审计 | 高 | 强 |
| `custom` | 模板或策略定制 | 由用户/策略定义 | 可变 | 可变 |

### 4.2 当前可直接锚定的模式字段

当前主线已稳定输出：

- `route.mode`
- `candidateRoutes[*].mode`
- `candidateRoutes[*].riskLevel`
- `candidateRoutes[*].takeoverLoad`
- `candidateRoutes[*].estimatedDuration`
- `candidateRoutes[*].estimatedCost`

这些字段已足够支撑最小路线比较与路线推荐展示，但仍未形成统一 planner scoring 系统。

## 5. Route Planner 规划流程

### 5.1 总体流程

```text
Destination
  -> Destination Analyzer
  -> Route Candidate Builder
  -> Risk Evaluator
  -> Takeover Point Generator
  -> Runtime Mapping Builder
  -> Recommendation Selector
  -> RouteSet
  -> Route projection / Mission Runtime / UI / Replay / Audit
```

### 5.2 组件定义

| 组件 | 输入 | 输出 | 责任 | 当前最小锚点 |
| --- | --- | --- | --- | --- |
| Destination Analyzer | `Destination`、现有 mission 上下文、缺失信息、success criteria | `DestinationAnalysis` | 提取任务类型、复杂度、上下文完整度、交付物类型、治理敏感度 | `destination.*` |
| Route Candidate Builder | `DestinationAnalysis`、route modes、policy hints | `Route[]` | 生成 `fast / standard / deep / custom` 候选路线 | `buildCandidateRoutes()` 对应 `candidateRoutes` |
| Risk Evaluator | `DestinationAnalysis`、候选路线、runtime/gov hints | `RouteRisk[]` | 生成结构化风险并影响推荐与接管 | 当前仅 `route.riskPoints` |
| Takeover Point Generator | 风险、缺失信息、预算/权限/结果要求 | `RouteTakeoverPoint[]` | 生成阻塞型或建议型接管点 | 当前仅 `takeover.* + takeoverPointIds` |
| Runtime Mapping Builder | RouteStage、RouteStep、现有 workflow/runtime 能力 | `RouteRuntimeMapping` | 把 Route 映射到底层控制面与执行对象 | 当前仅 `route.stages + execution.availableActions + bindings.*` |
| Recommendation Selector | 候选路线、风险、预算、治理策略、用户偏好 | `recommendedRouteId`、理由、对比摘要 | 选择推荐路线并输出可解释理由 | 当前已投影到 `recommendedRouteId`、`selection.*`、`candidateRoutes[*].reason` |

### 5.3 规划流程输出原则

- Route Planner 输出目标是 `RouteSet`；
- 当前主线透传目标是 `MissionAutopilotSummary.route`；
- 因此 Route Planner 落地时必须至少提供一层 projection，把目标模型映射成当前最小 contract。

## 6. 并行 / 串行表达设计

### 6.1 设计语义

- `dependencies` 表示先后依赖；
- `parallelGroups` 表示一组可并发执行的步骤；
- `joinStepId` 表示并发结果汇总点；
- `fallbackMode` 表示 runtime 不支持并行时的降级策略；
- `fallbackReason` 用于审计和回放。

### 6.2 当前最小锚点

当前仓库仅有：

- `execution.parallelBranchCount`
- `explanation.remainingSteps.parallelBranchCount`

这说明当前只具备“并行度摘要”，不具备结构化 `RouteStep.dependencies / RouteParallelGroup / fallbackReason` 执行模型。

### 6.3 落地波次

- P0：保留 `parallelBranchCount` 作为驾驶舱摘要；
- P1：引入 `RouteStep.dependencies` 与 `RouteParallelGroup`；
- P2：引入 runtime 并行降级记录和 replay / audit 可见的 `fallbackReason`。

## 7. 风险模型与风险生成规则

### 7.1 风险生成矩阵

| 风险类型 | 典型信号 | 对路线的影响 | 当前最小锚点 |
| --- | --- | --- | --- |
| `missing_context` | `missingInfo`、waiting 澄清 | 增加澄清步骤或阻塞接管 | `destination.missingInfo`、`route.riskPoints` |
| `permission_required` | 权限不足、审批前置 | 增加权限确认接管点 | takeover type 推断，未结构化 |
| `budget_overrun` | 成本超带宽 | 推荐深度或等待预算确认 | budget takeover / reason |
| `quality_uncertain` | 结果可信度不足 | 增加 review / verify | `route.riskPoints`、`recovery` |
| `tool_failure` | executor / tool 失败 | 触发 retry / escalate / replan | `recovery`、`route.replan` |
| `data_trust` | 证据不完整、来源不可信 | 提升审计深度 | `evidence.gaps`、`evidenceHints` |
| `long_running` | 长耗时、多阶段 | 增加候选路线比较或降级 | ETA 摘要、并行度摘要 |
| `policy_sensitive` | 高风险副作用、策略敏感 | 强制接管、审计加严 | takeover / recovery / evidence |

### 7.2 目标模型

所有风险必须能够：

- 绑定 route 或 step；
- 提供 triggerCondition、severity、mitigation；
- 影响推荐路线、接管点和治理策略；
- 进入 replay / audit 元数据。

### 7.3 当前边界

当前主线只有 `route.riskPoints: string[]` 与关联 explanation / recovery 摘要，不能误写成结构化 `RouteRisk[]` 已实现。

## 8. 接管模型与接管生成规则

### 8.1 接管类型矩阵

| 接管类型 | 典型触发 | 默认强度 | 运行时桥接 | 当前最小锚点 |
| --- | --- | --- | --- | --- |
| `clarification` | 缺失信息、目标歧义 | required | `WAITING_INPUT -> resume()` | `takeover.type`、`missingInfo` |
| `route_selection` | 候选路线切换 | required | `decision / multi-choice` | `selection.*`、`takeover.options` |
| `permission_confirm` | 权限升级 | required | approval / decision | 枚举存在，未全链路落地 |
| `budget_confirm` | 成本带宽超限 | required | budget decision | 已有最小 summary 锚点 |
| `risk_acceptance` | 高风险动作放行 | required | human approval | 枚举存在，未结构化落地 |
| `result_acceptance` | 交付确认 | advisory 或 required | delivery review | 枚举存在，未结构化落地 |
| `manual_override` | 系统恢复失败或人工接管 | required | `escalate()` / operator | 枚举存在，未结构化落地 |

### 8.2 阻塞型与建议型

接管点需要显式区分：

- `required = true, blocking = true`：必须停下来等人确认；
- `required = false, blocking = false`：建议型提示，不阻塞主线。

当前主线已经有：

- `takeover.required`
- `takeover.blocking`
- `takeover.status`

但还没有独立 `RouteTakeoverPoint[]` 记录每个接管点的完整触发条件、默认动作和超时策略。

### 8.3 当前最小锚点

当前接管相关字段主要来自：

- `takeover.required / blocking / type / reason / prompt / options / urgency`
- `route.takeoverPointIds`
- `selection.canSwitch / switchRequiresConfirmation`
- `execution.availableActions`
- `recovery.suggestedActions`

## 9. Route 到现有 runtime 的映射

### 9.1 RouteStage 到 mission / workflow 的映射

| RouteStage | mission / workflow 参考阶段 | 当前状态 |
| --- | --- | --- |
| understand | receive / understand / assemble | 已有 stage summary 投影 |
| clarify | CEO split / waiting | 已有 waiting + takeover 摘要 |
| plan | manager planning / plan | 已有 current stage 摘要 |
| fleet | provision / resource bind | 已有 fleet + bindings 摘要 |
| execute | execute | 已有 execution 摘要 |
| review | review / audit / revise / verify | 已有 explanation / recovery / route diff 摘要 |
| deliver | summary / evolve / finalize | 已有 delivered 状态摘要 |

### 9.2 RouteStep 到底层执行对象的目标映射

目标设计要求 `RouteStepRuntimeMapping` 支持映射到：

- workflow phase；
- workflow node；
- runtime adapter；
- agent role；
- decision point；
- control surface。

### 9.3 当前最小映射锚点

当前主线已经能提供：

- `route.stages`
- `bindings.missionId / workflowId / instanceId`
- `execution.currentStepKey / currentStepLabel / availableActions`
- `recovery.suggestedActions`
- `evidence.correlation.workflowId / routeStageKeys / currentStepKey / runtimeEventIds`

这足以形成“stage summary + control summary + evidence correlation”的最小映射闭环，但不等于 `RouteStep -> workflow node / adapter / agent action` 已完整实现。

## 10. 重规划机制设计

### 10.1 触发条件

Route 重规划至少应覆盖以下触发来源：

| 触发来源 | 示例 | 当前最小锚点 |
| --- | --- | --- |
| runtime retry | 重试后重新选路 | `selectionStatus = replanned` |
| blocker / failure | 阻塞或失败要求改线 | `route.replan.reason` |
| user route switch | 用户显式改线 | `selectedRouteId / changedReason` |
| governance decision | 成本/权限/风险要求改线 | 当前为目标设计 |
| context change | 输入、约束、成功标准变化 | 当前为目标设计 |

### 10.2 重规划结果类型

重规划的结果应允许：

- 继续当前路线；
- 切换到已有候选路线；
- 生成新路线；
- 请求用户接管并暂停推进。

### 10.3 当前最小重规划 contract

当前主线已被代码与测试稳定锚定的字段包括：

- `route.selectionStatus = replanned`
- `route.selection.mode = runtime_replanned`
- `route.replan.active / reason / fromRouteId / toRouteId / triggeredBy`
- `route.evidence.events[eventType = route.replanned]`
- `explanation.recommendationDetails[kind = replan]`
- `explanation.remainingSteps.replanChangeSummary`

### 10.4 目标记录模型

`RouteReplanRecord` 必须补齐：

- 触发来源；
- 变更步骤集合；
- 保留步骤集合；
- 前后快照引用；
- planner 输入快照引用；
- replay / audit 可见的 before / after diff。

### 10.5 已完成步骤证据保留

目标设计要求：

- 每次重规划都必须给出 `preservedStepIds`；
- 已完成步骤的 evidence / artifacts / runtimeEventIds 不应丢失；
- 前端展示“已完成步骤沿用，未完成步骤改线”。

当前主线尚未把 completed-step evidence 单独结构化输出，因此这里只能视为设计要求。

## 11. 审计、回放与证据链设计

### 11.1 目标快照模型

```ts
type RoutePlannerInputSnapshot = {
  id: string;
  destinationId: string;
  request: string;
  constraints: string[];
  successCriteria: string[];
  deliverables: string[];
  missingInfo: string[];
  plannerVersion: string;
  createdAt: string;
};

type RouteExecutionSnapshot = {
  id: string;
  routeId: string;
  selectedRouteId: string;
  currentStageKey: string | null;
  currentStepKey: string | null;
  riskIds: string[];
  takeoverPointIds: string[];
  runtimeEventIds: string[];
  createdAt: string;
};

type RouteReplaySnapshot = {
  id: string;
  routeSetId: string;
  plannerInputSnapshotId: string;
  executionSnapshotIds: string[];
  replanRecordIds: string[];
  correlation: {
    missionId: string;
    workflowId?: string;
    replayId?: string;
    routeIds: string[];
  };
};
```

### 11.2 当前最小证据链

当前主线已经有如下最小锚点：

- `route.evidence.lastEventType / lastEventAt / events[]`
- `evidence.correlation.missionId / workflowId / replayId / routeIds / routeStageKeys / runtimeEventIds / decisionIds / operatorActionIds / auditEventIds / lineageIds`
- `selection.changedBy / changedReason / changedAt`
- `route.replan.*`
- `explanation.recommendationDetails`
- `explanation.evidenceHints`

### 11.3 当前边界

当前主线能够支撑：

- route recommendation / selection / lock / replan 事件；
- 与 Mission Runtime 事件流的关联索引；
- route diff、route events 与 route evidence 的 UI 呈现。

当前主线不能外推为：

- 独立 Route replay snapshot 持久化；
- 独立 Route audit entry 存储；
- 可回放的 planner input snapshot 已完整实现。

## 12. 驾驶舱摘要设计

### 12.1 Route 摘要字段

面向前端驾驶舱和任务详情的 Route 摘要应至少提供：

- 当前主路线摘要；
- 推荐路线与已选路线；
- 候选路线比较；
- 当前阶段 / 当前步骤；
- 风险点数量 / 接管点数量；
- 剩余步骤、并行分支、ETA、成本摘要；
- 选择状态、锁定状态、改线原因；
- Route Diff；
- Route Evidence / Route Events。

### 12.2 当前主线锚点

当前这些字段已经通过：

- `route.selected / route.selectedRoute / route.candidateRoutes`
- `route.selection.*`
- `route.replan.*`
- `route.evidence.*`
- `explanation.remainingSteps`
- `execution.parallelBranchCount`

在 `TaskAutopilotPanel` 形成最小 route block 聚合展示闭环。

## 13. 测试计划

### 13.1 设计覆盖矩阵

| 测试主题 | 设计目标 | 当前最小锚点 |
| --- | --- | --- |
| 快速路线生成 | `fast` 路线模式与候选路线差异 | `candidateRoutes[*].mode = fast` |
| 标准路线生成 | `standard` 默认推荐语义 | `recommendedRouteId / candidateRoutes` |
| 深度路线生成 | 高风险 / 高治理路线 | `deep` 路由与理由摘要 |
| 主路线推荐 | 推荐理由与比较元数据 | `candidateRoutes[*].reason / summary` |
| 候选路线保留 | 未选路线可比较可审计 | `candidateRoutes[]` |
| 并行降级 | `parallelGroups -> serial` 的目标规则 | 当前仅设计，未来实现 |
| 风险生成 | `RouteRiskType` 全覆盖 | 当前仅 `route.riskPoints` 摘要 |
| 接管生成 | `RouteTakeoverType` 全覆盖 | 当前仅 takeover summary |
| runtime 映射 | RouteStage/Step 到 runtime | 当前已有 stage/control/evidence 摘要 |
| 重规划记录 | `RouteReplanRecord` 与 before/after snapshot | 当前仅 replan summary |

### 13.2 当前直接证据文件

当前可直接锚定的测试文件包括：

- `shared/__tests__/mission-autopilot.test.ts`
- `server/tests/mission-routes.test.ts`
- `client/src/lib/tasks-store.autopilot.test.ts`
- `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`

这些测试当前主要证明“最小 route projection contract”稳定，而不是证明目标 Route 领域模型已经被 runtime 直接消费。

## 14. 分阶段落地建议

### Phase 1：继续沿最小 projection contract 扩展

- 维持 `MissionAutopilotSummary.route` 为主出口；
- 新增字段优先映射到现有 summary contract；
- 避免平行发明第二套路线 view model。

### Phase 2：补齐结构化 Route 目标模型

- 引入 `RouteSet / Route / RouteStage / RouteStep / RouteRisk / RouteTakeoverPoint / RouteReplanRecord`；
- 通过 server projection 做目标模型到 UI contract 的映射；
- 补结构化 replay / audit snapshot。

### Phase 3：把 RouteStep 拓扑接入 runtime

- 引入 `RouteStepRuntimeMapping`；
- 支持 `dependencies / parallelGroups / fallbackReason`；
- 把 step 级路线真正映射到 workflow node / adapter / decision point。

### Phase 4：形成 planner / audit / replay 独立子系统

- planner 输入快照持久化；
- replay snapshot 持久化；
- audit / lineage / correlation 深度闭环；
- 重规划前后快照比对可视化。

## 审计补注（2026-04-25）

- 本轮新增的设计内容，重点是把 Route 目标模型、规划流程、并行表达、风险模型、接管模型、runtime 映射、重规划记录与审计快照全部结构化定义出来，并明确它们与当前 `MissionAutopilotSummary.route` 最小 contract 的映射关系。
- 因此，本轮可以把多项“定义 / 设计 / 建立映射 / 补测试计划”类任务视为文档已收口，但这些勾选不代表主仓已经拥有独立 `RouteSet / RouteRisk / RouteTakeoverPoint / RouteReplanRecord / RouteReplaySnapshot` 代码实现。
- 当前仓库真正已被直接代码与直接测试锚定的，仍然主要是：
  - `candidateRoutes + recommendedRouteId + selectedRouteId + selection.*`
  - `route.stages + currentStageKey/currentStageLabel`
  - `route.riskPoints + takeoverPointIds + takeover.*`
  - `route.evidence.* + route.replan.*`
  - `execution.parallelBranchCount`
  - `evidence.correlation.*`
  - `explanation.remainingSteps / recommendationDetails`
- 其中：
  - `shared/mission/autopilot.ts` 仍是当前最核心的 route builder / projection anchor；
  - `server/tasks/mission-projection.ts` 负责把 shared summary 与 projection links、workflow/runtime 绑定对齐；
  - `client/src/lib/tasks-store.ts` 负责 route summary 的 normalize 与 fallback；
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 负责 route block、route diff、route evidence 的最小驾驶舱展示。
- 因而本 spec 当前最准确的落地口径是：
  - 设计层：Route Planner 与 Route 模型已完成结构化定义；
  - 代码层：最小 route projection contract 已稳定；
  - 后续实现层：仍需把目标模型逐步接入 persistence、runtime、replay 与 audit。
