# 设计文档：任务自动驾驶恢复机制与人工接管治理

## 设计概述

本设计旨在把任务自动驾驶中的“偏航、失败、恢复、接手、升级”统一收敛为一条可解释的治理链路：

```text
Runtime / Review / Governance / Human Feedback Signal
  -> Deviation Detector
  -> Recovery Classifier
  -> Recovery Strategy Planner
  -> Auto Recovery / Degraded Execution / Human Takeover / Escalation
  -> Resume / Replan / Review / Terminate
  -> Replay / Audit / Evidence
```

设计目标：

- 把运行时失败与质量治理失败统一纳入恢复框架
- 在自动恢复和人工接手之间建立清晰边界
- 让降级执行成为显式、可治理、可审计的正式能力
- 让人工接手之后能回到自动链路继续推进
- 与现有 `Drive State`、`Takeover Point`、`MissionDecision`、`retry / resume / escalate / replan` 兼容

## 设计原则

- 不新增一套孤立 runtime，而是在现有 Mission Runtime 与 HITL 之上做投影和编排增强
- 优先最小恢复，避免直接放大为人工接手
- 高风险动作必须显式治理，不允许静默恢复
- 所有恢复动作都必须留下证据链
- 恢复不只面向报错，也面向偏航、质量失败和治理命中

## 总体架构

```text
Runtime Event / Review Result / Governance Signal / Human Feedback
  -> Deviation Detector
  -> Recovery Coordinator
     -> Recovery Attempt Ledger
     -> Governance Boundary Checker
     -> Takeover Bridge
     -> Escalation Bridge
  -> Runtime Action
     -> retry
     -> resume
     -> replan
     -> revise
     -> degrade
     -> terminate
  -> Projection Layer
     -> Drive State
     -> Takeover Queue
     -> Replay Timeline
     -> Audit Chain
```

建议新增的高层模块：

- `DeviationDetector`
  负责聚合运行时、质量、治理和人工反馈信号，输出结构化偏航或失败事件。
- `RecoveryCoordinator`
  负责选择恢复策略、控制恢复顺序、判断是否进入人工接手或升级。
- `RecoveryAttemptLedger`
  负责记录恢复尝试、次数、预算消耗和结果。
- `GovernanceBoundaryChecker`
  负责在恢复动作执行前校验预算、权限、风险和外部副作用边界。
- `TakeoverBridge`
  负责把需要人工的恢复策略映射为 `Takeover Point` 与 `MissionDecision`。
- `EscalationBridge`
  负责把无法在当前自动或普通人工层级解决的问题升级到更高权限流程。

## 模型设计

### 1. DeviationEvent

```ts
type DeviationEvent = {
  id: string;
  missionId: string;
  routeId?: string;
  routeStepId?: string;
  workflowId?: string;
  runtimeNodeId?: string;
  category: DeviationCategory;
  severity: "info" | "warn" | "danger" | "critical";
  triggerKind: "runtime" | "review" | "verify" | "audit" | "governance" | "human-feedback" | "external-change";
  summary: string;
  reason: string;
  evidenceRefs: string[];
  detectedAt: string;
  detectedInDriveState: DriveState;
  recoverable: boolean;
};
```

### 2. DeviationCategory

```ts
type DeviationCategory =
  | "goal_deviation"
  | "route_deviation"
  | "quality_deviation"
  | "governance_deviation"
  | "dependency_failure"
  | "state_block"
  | "recovery_exhausted";
```

说明：

- `goal_deviation`：结果方向与目标不一致
- `route_deviation`：执行路径明显脱离当前路线
- `quality_deviation`：review / verify 不达标
- `governance_deviation`：预算、权限、风险或策略命中边界
- `dependency_failure`：依赖不可用
- `state_block`：自动链路无法继续
- `recovery_exhausted`：已尝试恢复但仍未恢复

### 3. RecoveryStrategy

```ts
type RecoveryStrategy = {
  id: string;
  type: RecoveryStrategyType;
  scope: "node" | "step" | "stage" | "route" | "mission";
  automatic: boolean;
  requiresHumanApproval: boolean;
  requiresComment: boolean;
  governanceChecks: GovernanceCheckKind[];
  expectedImpact: RecoveryImpact;
  fallbackStrategyIds?: string[];
};
```

### 4. RecoveryStrategyType

```ts
type RecoveryStrategyType =
  | "retry"
  | "substitute_executor"
  | "restore_snapshot"
  | "skip_non_critical"
  | "rollback_to_checkpoint"
  | "degrade_execution"
  | "revise_then_review"
  | "replan_stage"
  | "human_confirm_continue"
  | "human_takeover"
  | "escalate_exception"
  | "terminate";
```

### 5. RecoveryImpact

```ts
type RecoveryImpact = {
  costImpact: "lower" | "same" | "higher" | "unknown";
  qualityImpact: "lower" | "same" | "higher" | "unknown";
  riskImpact: "lower" | "same" | "higher" | "unknown";
  permissionImpact: "lower" | "same" | "higher" | "unknown";
  automationImpact: "more_manual" | "same" | "more_auto";
};
```

### 6. RecoveryAttempt

```ts
type RecoveryAttempt = {
  id: string;
  missionId: string;
  deviationEventId: string;
  strategyType: RecoveryStrategyType;
  status: "planned" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";
  reason: string;
  governanceDecision?: "allowed" | "denied" | "needs_takeover" | "needs_escalation";
  startedAt: string;
  finishedAt?: string;
  comment?: string;
  triggeredBy: "system" | "user" | "operator" | "policy";
};
```

### 7. RecoveryDecisionPoint

`RecoveryDecisionPoint` 是恢复场景下的人工接手桥接对象，可映射到现有 `Takeover Point`。

```ts
type RecoveryDecisionPoint = {
  id: string;
  missionId: string;
  deviationEventId: string;
  kind: "recovery" | "degrade" | "resume" | "escalation";
  required: boolean;
  title: string;
  description: string;
  recommendedStrategyType?: RecoveryStrategyType;
  options: RecoveryDecisionOption[];
  requiresExplicitAcceptance: boolean;
  evidenceRefs: string[];
};
```

### 8. 恢复契约与 `Drive State` / `Takeover Point` 的映射字段

为了让契约层不只停留在类型定义，而是能够稳定投影到当前主线，还需要补一层显式的恢复映射字段：

```ts
type RecoveryProjectionMapping = {
  deviationEventId: string;
  recoveryAttemptId?: string;
  recoveryDecisionPointId?: string;
  projectedDriveState: DriveState;
  projectedTakeoverType?: RecoveryTakeoverMapping["takeoverType"];
  projectedMissionDecisionType?: RecoveryTakeoverMapping["missionDecisionType"];
  takeoverPointId?: string;
  decisionId?: string;
  waitState?: "waiting" | "WAITING_INPUT";
  consequenceSummary?: string;
  correlationRefs: string[];
};
```

映射原则：

- `DeviationEvent.category`
  - `route_deviation`、需要正式改线的 `goal_deviation` 默认投影到 `replanning`
  - `quality_deviation` 默认投影到 `reviewing`，若需要人工裁决则升级为 `takeover-required`
  - `governance_deviation` 默认投影到 `takeover-required` 或 `blocked`
  - `dependency_failure`、`state_block` 默认投影到 `blocked`
  - `recovery_exhausted` 默认投影到 `takeover-required`，必要时转 `blocked` 或升级
- `RecoveryAttempt`
  - 负责把 `strategyType / status / governanceDecision / reason` 投影到 `attemptedActions`、`suggestedActions`、`recovery.state`
  - 若动作导致后续必须等待人工或正式改线，必须同步产出 `projectedDriveState`
- `RecoveryDecisionPoint`
  - 负责把人工恢复决策映射到 `Takeover Point` 的 `type / title / prompt / urgency / options`
  - 若人工动作会进入通用 HITL 决策链路，必须同时给出 `projectedMissionDecisionType`
- `RecoveryProjectionMapping`
  - 必须保留 `takeoverPointId / decisionId / correlationRefs`
  - 用于把恢复语义稳定透传到 `mission projection`、任务详情、replay 与 audit 的只读结果面

这一定义支持 `1.6` 的设计收口，但边界仍需保持保守：

- 当前成立的是“恢复契约如何投影到现有 `Drive State` / `Takeover Point` 已被写清”，不是独立 recovery projection service 已经存在。
- 映射字段是统一语义合同，不等于当前所有 runtime / HITL / projection 写路径都已完整改造为使用这一合同。

## 偏航检测设计

### 信号来源

偏航检测由以下信号共同驱动：

- runtime 信号
  - 节点报错
  - 超时
  - 重试预算耗尽
  - 执行器不可用
- quality 信号
  - review 失败
  - verify 失败
  - revise 后仍不达标
- governance 信号
  - 成本超预算
  - 权限越界
  - 风险超阈值
  - 外部副作用策略阻断
- route 信号
  - 当前步骤输出与路线约束不一致
  - 关键里程碑未满足
- human 信号
  - 用户指出方向错了
  - 用户要求改线
  - 用户拒绝风险或预算

### 触发强度

建议将信号分为两类：

- 强触发
  - runtime 明确失败
  - governance 明确阻断
  - verify 明确失败
  - 用户明确要求改线或终止
- 弱触发
  - confidence 下降
  - review 给出较弱警告
  - 中间产物与预期存在可修复偏差

处理原则：

- 任一强触发可直接生成 `DeviationEvent`
- 多个弱触发叠加可升级为 `DeviationEvent`
- 弱触发优先尝试局部恢复或 revise，不立即进入重接管

### 信号来源与现有实现锚点

在当前主仓的最小闭环里，信号来源优先按“已有运行时事实 -> 共享 recovery summary -> mission projection -> 任务详情展示”的链路理解，而不是新造一套独立检测面。

- runtime 信号
  - 对应现有 `workflow runtime` 的节点失败、`WAITING_INPUT`、retry exhausted、`instance.escalated`、`instance.terminated`
  - 在现有仓库里可由 `server/core/workflow-runtime-engine.ts`、`server/core/web-aigc-runtime-observability.ts` 及其测试锚定
- quality 信号
  - 对应 `review / verify / revise` 结果造成的质量偏航、复核失败或需要回退到 revise 的场景
  - 在当前设计层先作为恢复入口语义，与 `shared/mission/autopilot.ts` 中的 `quality-deviation`、`reviewing` 投影保持兼容
- governance 信号
  - 对应预算、权限、风险、外部副作用、审批结果等命中
  - 在现有仓库里可由 `mission decision`、runtime governance blocked、auto-escalate 与 projection 的最小结果面锚定
- human 信号
  - 对应 route selection、request-info、人工改线、风险接受或拒绝继续
  - 在现有仓库里可由 `server/tasks/mission-decision.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts` 锚定

这一节的边界必须保持保守：

- 当前成立的是“恢复治理可复用现有 runtime / review / governance / human 决策事实链”，不是说 `DeviationDetector` 已经作为独立服务落地
- 当前更接近 signal projection 与 signal interpretation，而不是统一检测引擎、统一订阅总线或统一优先级调度器已经实现

### `DeviationDetector` 的最小闭环输入、输出与事件投影

在当前主线里，`DeviationDetector` 更适合被理解为一层“可重建的检测语义”，而不是一个必须先独立落地的新服务。它的最小闭环可以按下面的结构设计：

| 层级 | 最小输入 | 最小输出 | 当前主线对应落点 |
| ---- | ---- | ---- | ---- |
| runtime 事实 | 节点失败、`WAITING_INPUT`、retry budget exhausted、`instance.escalated`、`instance.terminated` | `state-block`、`dependency-failure`、`recovery-exhausted` 候选信号 | `workflow runtime` 事件、runtime observability 镜像 |
| mission / operator 事实 | `mission.status`、`operatorState`、`blocker`、`waitingFor`、`attempt`、`operatorActions` | `takeover-required / blocked / replanning` 方向判断 | `shared/mission/autopilot.ts` 中的 `inferDeviationCategory()`、`buildRecoverySummary()` |
| human / decision 事实 | `MissionDecision`、route selection、budget approval、request-info、comment / metadata | `needs_takeover`、route/goal 偏航、阻塞原因 | `server/tasks/mission-decision.ts`、`server/tests/hitl-decision.test.ts` |
| projection / consequence 事实 | `route.replan`、`missingInfoDetails`、`impact`、`blockingReason` | 面向任务详情与驾驶舱的检测结果投影 | `server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts` |

为了兼容当前主仓，这一层的最小输出不必先收敛成独立 `DeviationEvent` 表，而是至少要稳定投影出四类读模型结果：

- 偏航分类
  - 由 `MissionAutopilotDeviationCategory` 承载最小分类面
- 恢复状态
  - 由 `MissionAutopilotRecoverySummary` 承载 `state / attemptedActions / suggestedActions / needsHuman / canAutoRecover`
- 阻塞后果
  - 由 `destination.missingInfoDetails`、`destination.impact`、`destination.blockingReason` 承载“如果当前不处理会发生什么”
- 事件索引
  - 由 `evidence.timeline` 与 `evidence.correlation` 承载最小 replay / audit 重建线索

当前主线的最小事件投影链可以保守收敛为：

```text
runtime / decision / blocker / operator action
  -> inferDeviationCategory() + buildRecoverySummary()
  -> autopilotSummary.recovery / takeover / destination.missingInfoDetails / route.replan
  -> mission projection / orchestration.wait / orchestration.replan
  -> tasks-store normalized read model
  -> TaskAutopilotPanel / TaskDetailView
```

这一定义支持 `3.1` 的设计收口，但边界必须保持严格：

- 当前成立的是“输入、输出与投影链已经可被 shared/server/client 事实重建”，不是说独立 `DeviationDetector` 服务、统一事件总线或统一优先级调度器已经落地。
- 当前最稳固的直接锚点集中在 `route-deviation`、`governance-deviation`、`state-block` 与 waiting / replan / blocked consequences；`goal-deviation`、`quality-deviation`、`dependency-failure`、`recovery-exhausted` 仍不应因为有实现分支就外推为等价完成。

### `goal_deviation`、`route_deviation`、`quality_deviation` 的识别规则

这三个分类都属于“任务仍可推进，但当前理解、路线或质量已经不足以安全继续”的偏航面。设计上必须先判断“目标是否变了、路线是否偏了、还是产出质量没过关”，而不是把所有非 runtime 错误都混成同一类。

| 分类 | 必须同时满足 | 强触发 | 辅助证据 | 排除条件 | 默认投影 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `goal_deviation` | 当前产出方向、成功标准或关键约束与最新 `Destination` 不一致，且不能仅靠沿用当前路线局部修补解决 | 用户明确指出“方向错了”、用户更新目标或成功标准、当前结果与 destination summary 明显冲突 | `destination.summary`、`destination.successSignal`、人工 comment、change reason、目标澄清缺口 | 目标本身没变，只是执行路径需要改；或只是质量不达标但目标和路线都正确 | `takeover-required` 或 `replanning` |
| `route_deviation` | 目标保持稳定，但当前 `selectedRouteId / route stage / execution plan` 已不再适合继续，需要正式改线或重规划 | route selection 改选、`route.replan` 已形成、阶段阻塞已明确要求改线 | route diff、`selectedRouteId` 变更、`selectionStatus`、`changeReason`、路线阶段证据 | 目标/成功标准已变更，应归 `goal_deviation`；若只是等待输入尚未形成新路线，应先归 `state_block` | `replanning` |
| `quality_deviation` | 目标与路线都仍成立，但中间或最终产出无法满足 `review / verify` 标准 | review failed、verify failed、revise 后仍未过关 | reviewer comments、verify findings、低置信度信号、质量风险摘要 | 根因是预算/权限/风险阻断，应归 `governance_deviation`；根因是依赖不可用，应归 `dependency_failure` | `reviewing`，必要时升级为 `takeover-required` |

进一步的识别规则如下：

- `goal_deviation`
  - 至少需要一条“目标解释已变化或已被否定”的强信号，不能仅凭结果不完美就判为目标偏航。
  - 如果当前争议集中在“做什么”或“交付什么才算成功”，优先归为 `goal_deviation`，哪怕后续处理动作仍可能是 `replan_stage`。
  - 如果用户只是接受同一目标下的另一条路线，不应上提为 `goal_deviation`。
- `route_deviation`
  - 前提是 `Destination` 仍被接受，问题出在“怎么走”而不是“去哪里”。
  - 只有当系统已经形成“原路线不能继续、需要换线或重规划”的判断时，才升级为 `route_deviation`。
  - 单纯的 route-selection waiting、参数待补、人工待确认，在尚未形成 authoritative route 之前，应保守归入 `state_block`，而不是提前判成 `route_deviation`。
- `quality_deviation`
  - 前提是目标没错、路线没错，只是结果质量不够好、没过 review / verify、或需要 revise 后再复核。
  - 如果 review 失败的真正原因是路线错了或目标理解错了，应把 `quality_deviation` 作为次级证据，而不是主分类。
  - `quality_deviation` 默认先走 `revise_then_review` 或回到 `reviewing`，而不是直接改写高层目标。

### `governance_deviation`、`dependency_failure`、`state_block` 的识别规则

这三个分类都与“当前任务不能按原方式继续推进”有关，但根因不同：一个是治理边界命中，一个是依赖本身失效，一个是链路在等待或阻塞中无法前进。

| 分类 | 必须同时满足 | 强触发 | 辅助证据 | 排除条件 | 默认投影 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `governance_deviation` | 继续执行或恢复动作已明确命中预算、权限、风险、外部副作用或自动化等级边界 | governance denied、needs takeover、needs escalation、预算审批待定、权限拒绝、风险阻断 | governance metadata、approval status、cost/risk blocker、operator action 原因 | 若只是普通 runtime 失败且尚未命中治理边界，不应归此类 | `takeover-required` 或 `blocked` |
| `dependency_failure` | 根因是模型、工具、执行器、外部服务、数据源等依赖不可用或不健康 | executor unavailable、tool/service timeout、连接失败、替代依赖不可用 | runtime error code、provider/service name、fallback unavailability、依赖健康度 | 若主要问题是等待人工补充信息或审批，不应归此类；若治理边界阻止 fallback，应把治理结果记为次级证据 | `blocked` |
| `state_block` | 当前任务尚未完成，但没有安全的自动前进路径，且阻塞原因不是显式治理命中或依赖故障 | `WAITING_INPUT`、未解决的 route selection、缺失必要上下文、人工决策待处理、mission blocker 持续存在 | `waitingFor`、`blockingReason`、missing info consequences、takeover queue、operator state | 若已知根因是依赖故障，应优先归 `dependency_failure`；若已知根因是治理拒绝，应优先归 `governance_deviation` | `blocked` 或 `takeover-required` |

进一步的识别规则如下：

- `governance_deviation`
  - 只要治理边界本身已经足以阻止继续，即使同时存在质量或路线问题，主分类也应优先落在 `governance_deviation`。
  - 这类分类的核心不是“任务做错了”，而是“当前角色/预算/风险许可下不能这么做”。
- `dependency_failure`
  - 必须能够指出具体失效依赖或依赖族，不能把所有 runtime 错误都偷懒归成依赖失败。
  - 如果依赖短暂失败但替代执行器或重试路径仍然可用，可先保持 `dependency_failure`，恢复层再决定是否自动重试或替代执行。
- `state_block`
  - 它是“当前链路被卡住”的保守默认类，用于承接 waiting / missing-info / unresolved decision 一类需要等待外部输入的场景。
  - 一旦根因被进一步识别为治理命中或依赖失效，应优先升级到对应更具体的分类，而不是长期停留在 `state_block`。

### `recovery_exhausted` 的判定条件与升级规则

`recovery_exhausted` 不是第一因分类，而是“已有恢复路径已经试过，仍未把任务带回可推进状态”的上层结果类。它应覆盖在先前的 `goal_deviation / route_deviation / quality_deviation / governance_deviation / dependency_failure / state_block` 之上，而不是替代最初根因。

判定为 `recovery_exhausted` 时，至少应同时满足以下条件：

1. 已存在明确的前序偏航或阻塞事实。
2. 已尝试过至少一种正式恢复动作，并在 `attemptedActions`、operator actions、timeline 或等价字段中留下证据。
3. 满足以下任一耗尽条件：
   - 同层 `retry`、替代执行器或局部恢复预算已耗尽；
   - 可用 fallback strategy 已全部尝试或被治理拒绝；
   - 相同 blocker 在连续恢复后仍未解除；
   - 继续重复同一恢复动作已不再产生新信息。
4. 任务仍未回到 `executing`、`reviewing` 或 `delivered` 可继续面。

`recovery_exhausted` 的升级规则应固定为：

- 第一步：停止继续静默自动恢复。
  - 把 `canAutoRecover` 置为否，并把默认高层去向提升到 `takeover-required`。
- 第二步：如果当前恢复需要更高权限、更多预算、显式风险接受或跨角色批准，升级为 `needs_escalation` 或 `blocked`。
- 第三步：如果不存在安全的人类接手路径，或继续尝试只会扩大外部副作用，允许进入 `terminate`。

在设计合同里，`recovery_exhausted` 还必须保留以下解释面：

- 原始根因仍需保留在 evidence 与 correlation 中，避免把“为什么耗尽”丢成黑盒。
- `attemptedActions / suggestedActions / blockingReason / governanceDecision` 必须能够解释“已经试过什么、为什么不能再试、接下来该谁接手”。
- `recovery_exhausted` 进入 `takeover-required / blocked / escalate_exception / terminate` 的判断顺序必须稳定，不能因 UI 文案或单个模块自定义而漂移。

### 分类优先级与冲突消解

当多个分类同时命中时，设计层按以下顺序选主分类，其他分类作为次级证据保留：

1. `governance_deviation`
   - 治理边界一旦独立成立，优先级最高，因为它直接决定“当前是否允许继续”。
2. `dependency_failure`
   - 若根因是依赖失效，优先于 `state_block`。
3. `recovery_exhausted`
   - 仅在已有恢复尝试耗尽时覆盖为当前恢复主分类，同时保留原始根因。
4. `goal_deviation`
   - 当问题已经上升到“去哪里”或“什么算成功”时，优先于 `route_deviation` 与 `quality_deviation`。
5. `route_deviation`
   - 目标稳定但执行路径失效时，优先于 `quality_deviation`。
6. `quality_deviation`
   - 只有在目标和路线都仍成立时，才作为主分类。
7. `state_block`
   - 作为保守默认类，承接等待输入、等待决策、等待解除 blocker 的场景。

这一组规则用于支撑 `3.2 / 3.3 / 3.4` 的设计收口。边界同样需要保持保守：

- 当前成立的是“识别规则、冲突优先级与升级条件已经被写成显式设计合同”，不是说 shared / server / client 已经对每个分类都补齐了同等级直测闭环。
- 后续若代码与测试补齐，应优先验证这些规则，而不是再从实现分支反推新的分类口径。

## 恢复策略规划

### 恢复层级

恢复动作按从轻到重的顺序规划：

1. 节点级重试
2. 节点级替代执行
3. 恢复到最近稳定检查点
4. 跳过非关键步骤
5. 降级执行
6. revise 后重进 review / verify
7. 阶段级 replan
8. 人工确认继续
9. 人工接手
10. 异常升级
11. 终止任务

选择原则：

- 优先局部，后全局
- 优先自动，后人工
- 优先低风险，后高风险
- 优先保留原路线，必要时再改线

### 策略矩阵

| 异常类型 | 首选策略 | 次选策略 | 必须人工条件 |
| ---- | ---- | ---- | ---- |
| `dependency_failure` | `retry` / `substitute_executor` | `degrade_execution` / `replan_stage` | 需要更高权限或更高成本时 |
| `quality_deviation` | `revise_then_review` | `replan_stage` / `human_confirm_continue` | 主观质量判断或业务风险高时 |
| `governance_deviation` | `human_confirm_continue` | `degrade_execution` / `escalate_exception` | 命中高风险或高权限边界时 |
| `route_deviation` | `rollback_to_checkpoint` | `replan_stage` / `human_takeover` | 路线变更影响交付承诺时 |
| `goal_deviation` | `human_confirm_continue` | `replan_stage` / `human_takeover` | 目标解释需要责任确认时 |
| `state_block` | `restore_snapshot` / `retry` | `human_takeover` / `escalate_exception` | 自动恢复预算耗尽时 |
| `recovery_exhausted` | `human_takeover` | `escalate_exception` / `terminate` | 默认进入人工或升级 |

### 普通控制动作与正式恢复动作的边界

`retry`、`revise`、`replan` 在当前仓库里本身已经是可独立出现的控制动作，但在 recovery governance 语义下，只有满足“由偏航、阻塞、治理命中或人工接手需求触发，并带恢复理由与后续去向”时，才应视为正式恢复动作。

- 普通 `retry`
  - 仍停留在节点或局部执行层的常规重试
  - 可以只由 runtime 自身预算与重试策略触发
  - 不必天然提升为人工接手或 recovery ledger 语义
- 恢复语义下的 `retry`
  - 必须能够说明当前为何需要重试、是否已命中治理边界、失败后进入哪一层恢复
  - 在现有实现中通常表现为 recovery summary 里的 `attemptedActions`、blocked reason、retry exhausted 后的 escalate
- 普通 `revise`
  - 是质量修正或内容改写动作
  - 不天然意味着任务已经进入恢复治理
- 恢复语义下的 `revise_then_review`
  - 是质量偏航后的正式补救路径
  - 必须和 `reviewing` / `verify` 复核链路连起来，不能仅把 revise 当作一次普通内容编辑
- 普通 `replan`
  - 是路线重算或计划重写
  - 在没有偏航、阻塞、治理命中时，可以只是常规路线优化
- 恢复语义下的 `replan_stage`
  - 代表原路线已不足以安全继续，需要把任务显式送入 `replanning`
  - 在现有实现里应与 route diff、selected route、changed reason、replan projection 一起理解

因此，设计层应把“普通控制动作”和“正式恢复动作”的分界放在三件事上：

- 是否由 `DeviationEvent` 或等价恢复信号触发
- 是否需要治理重检、人工确认或下一层恢复去向
- 是否会改变高层 `Drive State`、接管状态或恢复摘要

### `RecoveryCoordinator` 的最小编排流

在当前主仓中，`RecoveryCoordinator` 也更适合被理解为一条跨 shared / runtime / HITL / projection 的“协调主线”，而不是一个已经独立存在的类。设计上可把它的总体流程写成下面七步：

1. 读取等价偏航事实
   - 从 runtime 失败、mission blocker、waiting decision、operator action、review / audit / governance 命中里收集候选信号。
2. 归一为恢复摘要
   - 先在 shared 层归一为 `deviationCategory`、`recovery.state`、`attemptedActions`、`suggestedActions`、`needsHuman`。
3. 执行治理边界检查
   - 进入 `allowed / denied / needs_takeover / needs_escalation` 四类结果分派。
4. 选择最低代价的下一步
   - 优先局部 `retry / revise / resume`，再进入 `replan`、人工接手、升级或终止。
5. 复用现有执行控制面
   - 自动链路优先复用 `retry`、`resume()`、`replan`、`escalate()`、`terminate()`，不新造平行执行协议。
6. 复用现有人工桥接
   - 需要人工时进入 `waiting / WAITING_INPUT`、`Takeover Point`、`MissionDecision`，并复用 `submitMissionDecision()` 的历史归档与幂等语义。
7. 投影结果面
   - 把协调结果投影到 `autopilotSummary`、`orchestration.wait / replan`、timeline / correlation 与任务详情只读展示面。

用当前主线能力表达，上述协调流可以保守写成：

```text
detected deviation
  -> buildRecoverySummary()
  -> governance result
  -> choose retry / resume / replan / wait / escalate / terminate
  -> mission decision / workflow runtime / operator action
  -> mission projection + evidence mirroring
```

与现有实现的最小对齐如下：

- `workflow runtime`
  - 已提供 automatic retry、retry exhausted、`resume()`、`escalate()`、`terminate()` 的结果面
- `mission runtime / mission orchestrator`
  - 已提供 waiting、`resolveWaiting()`、decision accepted 后 resumed 或继续等待的主线
- `mission decision`
  - 已提供 `requiresComment`、`alreadyResolved`、history append 与 route-selection / request-info 等通用桥接
- `mission projection`
  - 已提供 `autopilotSummary`、`orchestration.wait`、`orchestration.replan`、correlation 和 consequences 投影
- `runtime observability`
  - 已提供 retry / escalate / terminate 进入 replay / audit 的最小镜像

这一节支持 `4.1` 的设计收口，但仍应明确边界：

- 当前成立的是“RecoveryCoordinator 总体流程已经能被现有模块组合重建”，不是统一 `RecoveryCoordinator` 类、统一策略注册中心或统一恢复账本已经完成。
- `degrade_execution`、`restore_snapshot`、`skip_non_critical` 等动作目前仍主要停留在设计意图或局部语义，不应因为总体流程写清楚就外推为编排已完整落地。

### 恢复动作的退出条件、放弃条件与升级条件

每次恢复动作都不应只有“尝试执行”这一种结果，而应明确三类判定：

- 退出条件
  - 当前动作已把任务带回可继续推进的稳定状态
  - 当前动作虽然未直接完成任务，但已成功把任务交给下一条明确主线，例如 `reviewing`、`replanning`
- 放弃条件
  - 继续重复相同动作不再带来新信息
  - 当前动作的前置条件已不成立，例如没有可恢复快照、替代执行器不再可用
  - 当前动作会突破治理边界或最低交付标准
- 升级条件
  - 动作预算耗尽
  - 动作被治理明确阻断
  - 动作执行后仍需要更高权限责任确认
  - 风险、副作用或不确定性已超出当前层级可接受范围

建议按策略族定义最小判断表：

| 策略族 | 退出条件 | 放弃条件 | 升级条件 |
| ---- | ---- | ---- | ---- |
| `retry` / `substitute_executor` | 节点或步骤重新产出稳定结果，blocker 清除 | 同根因重复失败、预算耗尽、替代执行器不再等价 | 命中 `needs_escalation`、失败继续扩散到阶段级 |
| `restore_snapshot` / `rollback_to_checkpoint` | 回到最近稳定检查点，路线与治理边界仍有效 | 快照缺失、检查点已过时、回退后仍与当前 `Destination` 冲突 | 恢复后仍需高权限确认或引发更大范围改线 |
| `skip_non_critical` / `degrade_execution` | 最低交付标准仍成立，影响已向用户与审计表达 | 跳过后将破坏最低质量、合规要求或外部副作用边界 | 降级超出可自动接受范围，需人工责任确认 |
| `revise_then_review` / `replan_stage` | 结果已进入 `reviewing` 或已生成新的可执行路线 | revise 无法收敛、路线不存在可行替代 | 需要人工决定是否继续原目标或改写承诺 |
| `human_confirm_continue` / `human_takeover` | 人工决策已提交并进入 `resume()`、`replan` 或新的等待点 | 长时间无人处理、评论/责任确认缺失 | 问题超出当前人工层级，需正式升级 |
| `escalate_exception` / `terminate` | 升级已成功进入更高控制面，或终止已完成 | 无法保留最小证据、升级目标不可达 | 升级继续失败时收敛到更强阻断或终止 |

统一规则：

- 每次恢复尝试结束时都必须收敛为 `succeeded / failed / blocked / cancelled` 之一。
- 若动作命中退出条件，必须进一步映射到 `executing / reviewing / replanning / takeover-required / delivered` 中的下一状态。
- 若动作命中放弃条件但未达到升级条件，应进入下一层恢复，而不是无限重复同策略。
- 若动作命中升级条件，不得再把同类动作继续伪装成普通重试。

这一节支持 `4.5` 的设计收口；但它描述的是统一判断规则，不等于当前主仓已经存在统一的 recovery state machine executor。

## 自动恢复设计

### 自动恢复动作族

自动恢复优先承载低风险、低副作用、局部可回退的补救动作，建议至少包含以下五类：

- `retry`
  - 节点级重试或短链路重试
- `substitute_executor`
  - 切换到等价工具、模型或执行器
- `restore_snapshot`
  - 回到快照、缓存或最近稳定检查点
- `skip_non_critical`
  - 跳过非关键增强步骤继续执行
- `rollback_to_checkpoint`
  - 回退到上一个稳定阶段后重新执行

### 节点级重试与替代执行器切换的触发与上限

`retry` 与 `substitute_executor` 必须满足以下准入条件：

- 当前失败是局部的、可重入的、不会造成不可逆外部副作用
- 重试不会突破 `retry_budget`、任务级成本边界或权限边界
- 替代执行器在能力、权限、数据范围上与原执行器等价或更保守
- 替代执行器带来的质量下降、时间上升或成本变化能够被明确表达

上限规则：

- 节点级上限
  - 同一节点只能在本地预算内重复同类自动恢复动作
- 阶段级上限
  - 同一阶段内不允许多个节点无限串联自动恢复，避免“隐形卡死”
- 任务级上限
  - 任何自动恢复都必须受 mission / workflow 总预算约束

超过上限后：

- 优先切换到下一层恢复动作
- 若已命中治理边界，则直接进入 `needs_takeover` 或 `needs_escalation`

### 从快照或稳定检查点恢复的最小能力

`restore_snapshot` / `rollback_to_checkpoint` 至少应具备以下恢复对象：

- 最近稳定输入
  - 能重建当前步骤或阶段重新执行所需输入
- 稳定输出锚点
  - 能识别恢复后是否回到了先前已通过的安全状态
- 路线与阶段索引
  - 至少保留 `routeId / routeStageKey / stepId` 或等价索引
- 治理与决策上下文
  - 保留相关 `decisionId`、审批结论、必要评论或 route selection 结果
- 证据与关联索引
  - 保留 `timelineId / runtimeEventIds / correlationRefs`

禁止伪恢复：

- 若没有可验证的稳定检查点，不得把“重新跑一次”伪装成快照恢复
- 若检查点与当前目标、路线或治理边界冲突，不得直接恢复

### 跳过非关键步骤继续执行的准入条件

`skip_non_critical` 只能用于满足以下条件的步骤：

- 步骤被定义为增强项、可选项或不会破坏最低交付标准
- 跳过后不会破坏必需 review / verify / audit 证据
- 跳过不会新增外部副作用，也不会掩盖安全或合规风险
- 跳过后的后果已经被投影成 `consequenceSummary`、`destination.impact` 或等价解释字段

以下场景禁止自动跳过：

- 安全、权限、审批、交付验收相关步骤
- 会改变业务结论正确性的关键步骤
- 会让后续用户看到“看似完成、实际失真”的步骤

### 局部自动恢复失败后的层级推进

局部自动恢复失败后，必须按“同层替代 -> 更高层恢复 -> 人工接手 / 升级”的顺序推进：

1. 同层替代
   - 例如 `retry -> substitute_executor`
2. 更高层恢复
   - 例如 `restore_snapshot`、`rollback_to_checkpoint`、`replan_stage`
3. 人工或升级
   - 例如 `human_confirm_continue`、`human_takeover`、`escalate_exception`

禁止以下行为：

- 在相同失败根因下无限重复同一自动恢复动作
- 在治理已明确阻断后继续自动尝试
- 在没有后果表达的情况下静默跳过步骤或静默降级

### 自动恢复记录如何进入 replay / audit / evidence

每次自动恢复尝试至少应向三类结果面写入最小记录：

- recovery 读模型
  - `attemptedActions`
  - `suggestedActions`
  - `recovery.state`
  - `reason / consequenceSummary`
- replay / evidence
  - `timelineId`
  - `runtimeEventIds`
  - `decisionIds`
  - `operatorActionIds`
  - `beforeState / afterState`
- audit / observability
  - `strategyType`
  - `governanceDecision`
  - `triggeredBy`
  - `startedAt / finishedAt`
  - 是否自动执行、是否被阻断、是否转人工或升级

与当前主仓的最小对齐方式是：

- shared 层继续承载 `recovery.attemptedActions / suggestedActions / reason`
- mission projection 继续承载 `takeover / replan / consequence / correlation`
- runtime observability 继续镜像 retry / escalate / terminate 一类控制事件

这一节支持 `5.1 / 5.2 / 5.3 / 5.5` 的设计收口；当前仍不外推为独立 recovery ledger、恢复查询接口或完整自动恢复编排引擎已经实现。

## 降级执行设计

### 降级维度

`degrade_execution` 不是单一动作，而是一个受治理约束的策略包，至少支持以下维度：

- 模型降级
  - 从高成本模型切换到低成本模型
  - 从深度推理切换到标准推理
- 路线降级
  - 从深度路线切换到标准路线
  - 从全自动闭环切换到半自动路线
- 权限降级
  - 从可写切换到只读
  - 从执行外部动作切换到给出建议
- 范围降级
  - 缩小处理数据范围
  - 跳过非关键增强步骤

### 降级准入

降级执行必须先通过 `GovernanceBoundaryChecker`：

- 是否仍满足最低交付标准
- 是否违反用户明确要求
- 是否降低到不可接受质量
- 是否绕过高风险审批
- 是否引入新的外部副作用

若任一项不满足：

- 不允许自动降级
- 转为 `human_confirm_continue` 或 `human_takeover`

### 降级影响表达

降级执行必须以统一影响表达对外说明，而不是只留下“已降级”这一句抽象结论。建议沿用 `RecoveryImpact` 的五维结构，并增加面向任务详情与审计的说明字段：

| 影响维度 | 结构化字段 | 对外表达重点 |
| ---- | ---- | ---- |
| 时间 | `timeImpact` 或等价 ETA 变化 | 是否变慢、剩余步骤是否增加、是否推迟交付 |
| 成本 | `costImpact` | 是否降本、是否需要额外预算、是否切换到低成本模式 |
| 质量 | `qualityImpact` | 哪些能力、深度、覆盖面被下调 |
| 风险 | `riskImpact` | 风险是否下降、是否转为只读、是否仍需人工确认 |
| 自动化 | `automationImpact` | 是否从自动闭环改为半自动协同 |

最小表达规则：

- 降级原因必须单独可见
- 降级内容必须能被列成差异项，例如“关闭外部写入”“改为建议模式”“缩小范围”
- 降级影响必须能进入任务详情 explanation、destination impact 或等价 consequence 字段

### 禁止静默降级的高风险场景

以下场景不得静默执行 `degrade_execution`：

- 涉及不可逆外部写入、支付、通知、审批提交等真实副作用
- 需要新增权限、扩大数据范围或改变合规边界
- 会跌破用户已确认的最低质量、时效或交付承诺
- 降级后结果可能被误读为“已完成”，但其实只完成了部分能力
- 降级本身会改变责任边界，例如从系统自动执行改成人工承担风险

这些场景下必须至少进入：

- `human_confirm_continue`
- 或 `human_takeover`
- 或 `escalate_exception`

### 降级执行与现有治理的对接方式

`degrade_execution` 必须同时对接三类既有治理面：

- cost governance
  - 说明是否通过降级实现降本，或是否为了稳定性接受更高成本
- permission governance
  - 说明是否把可写改为只读、把执行改为建议，禁止以降级名义扩权
- runtime governance
  - 说明是否命中 `needs_takeover / needs_escalation / denied`

与当前主仓对齐时，最小落点应是：

- 在 recovery summary 中可解释“为什么要降级”
- 在 mission projection / task detail 中可解释“降级后差异与影响”
- 在 replay / audit 中可关联“降级前原因 -> 降级动作 -> 降级后状态”

这一节支持 `6.1 / 6.2 / 6.3 / 6.4 / 6.5` 的设计收口；但当前依然不能外推出 `degrade_execution` 的专门执行器、差异 UI 或持久化审计模型已经落地。

## 人工接手设计

### 人工确认后继续 vs 人工直接接手

两者必须区分：

- `human_confirm_continue`
  - 系统仍是执行主体
  - 人类只负责选择恢复策略、确认边界或补充上下文
  - 适合预算、权限、风险接受、低幅度改线
- `human_takeover`
  - 人类成为当前阶段主导者
  - 系统等待人类决策、修正、选择路线或直接操作
  - 适合恢复耗尽、目标偏航、复杂质量争议、高风险异常

### 接手范围

人工接手范围建议支持：

- `step`
  - 只接手当前步骤恢复
- `stage`
  - 接手当前阶段策略与结果
- `route`
  - 接手路线改写与后续策略
- `mission`
  - 接手整任务后续走向

### 恢复场景下的接手选项合同

恢复场景下的人工接手不应只有“批准 / 拒绝”两态，而应至少固定为以下五类显式选项：

| 接手选项 | 对应恢复语义 | 典型适用场景 | 默认是否要求评论 |
| ---- | ---- | ---- | ---- |
| `continue` | `human_confirm_continue` | 系统方案可继续，只差预算、权限、风险接受或人工背书 | 视风险而定 |
| `degrade` | `degrade_execution` | 为了降低成本、权限、外部副作用或稳定性风险，改走保守能力包 | 是 |
| `reroute` | `replan_stage` / `human_takeover` | 原路线已不合适，需要在候选路线间切换或改写阶段安排 | 是 |
| `escalate` | `escalate_exception` | 当前执行人或当前审批层不足以安全决策 | 是 |
| `terminate` | `terminate` | 风险、合规、证据缺口或升级失败使任务不应继续 | 是 |

约束如下：

- `continue`
  - 不改变当前主路线，只确认继续条件已经被人类接管或接受
  - 可伴随风险接受、预算接受、权限接受等责任确认
- `degrade`
  - 必须明确“降了什么、保留了什么、影响是什么”
  - 不得只给出抽象的“继续但更保守”
- `reroute`
  - 必须指向一条明确候选路线，或至少明确由谁接手改写路线
  - 若改变交付承诺，必须带 `changedReason`
- `escalate`
  - 必须带当前层级为何不能继续决策的理由
  - 目标是更高权限审批、值守队列或治理复核，不是普通重试
- `terminate`
  - 必须明确终止原因、终止范围以及是否需要后续人工善后
  - 终止不是“升级失败后的静默超时”，而是显式收敛动作

展示规则：

- 推荐动作必须从这五类中选一类作为主推荐，而不是只显示自由文本建议
- 已尝试动作必须能与这五类语义对齐，例如 `retry -> escalate`、`retry -> reroute`
- 若当前只允许其中一部分动作，未开放动作也要能说明原因，例如“高风险场景禁止 continue”

### 与 Takeover Point 的兼容映射

```ts
type RecoveryTakeoverMapping = {
  recoveryDecisionPointId: string;
  takeoverType: "exception_takeover" | "risk_acceptance" | "route_confirmation" | "delivery_acceptance";
  missionDecisionType: "approve" | "request-info" | "multi-choice" | "escalate" | "custom-action";
  actionMapping: Record<string, RecoveryStrategyType>;
};
```

映射原则：

- 需要人工处理时进入现有 `Takeover Queue`
- 需要等待人工时进入 `waiting` 或 `WAITING_INPUT`
- 人工提交后复用 `submitMissionDecision()`
- 决策通过后调用 `resume()`、`replan` 或 orchestrator 继续

### 恢复选项到 `MissionDecision` 的映射合同

恢复接手选项不新增独立提交协议，而是映射到现有 `MissionDecision.type`、prompt payload 与 resolved metadata/formData。最小合同如下：

| 恢复选项 | `MissionDecision.type` | prompt payload 最小字段 | resolved metadata/formData 最小字段 | 对接去向 |
| ---- | ---- | ---- | ---- | ---- |
| `continue` | `approve` | `recoveryAction = "continue"`、`approvalScope`、`consequences`、`safetyChecks` | `recoveryAction`、`acceptanceReason?`、`approvalScope?` | `resume()` / orchestrator continue |
| `degrade` | `approve` 或 `multi-choice` | `recoveryAction = "degrade_execution"`、`candidateProfiles?`、`impactSummary`、`requiresComment` | `recoveryAction`、`selectedProfileId?`、`changedReason` | `resume()` 后按降级配置继续 |
| `reroute` | `multi-choice` | `recoveryAction = "reroute"`、`candidateRoutes`、`routeMap`、`recommendedRouteId` | `selectedRouteOptionId`、`selectedRouteLabel`、`selectedRouteId`、`changedReason` | `replan` / route switch |
| `escalate` | `escalate` | `recoveryAction = "escalate_exception"`、`escalationTarget?`、`evidenceChecklist` | `recoveryAction`、`escalationReason`、`handoffTarget?` | `escalate()` / higher review |
| `terminate` | `custom-action` | `recoveryAction = "terminate"`、`actionId = "terminate"`、`consequences`、`requiresComment = true` | `recoveryAction`、`terminationReason`、`confirmed = true` | `terminate()` |

补充规则：

- `request-info`
  - 不是五类主恢复动作之一，但可作为辅助决策类型
  - 用于在 `continue / degrade / reroute / escalate / terminate` 之前补充缺失理由、参数或责任说明
- `reroute`
  - 直接复用现有 route-selection 语义
  - 当前 `server/tasks/mission-decision.ts` 已证明 `selectedRouteOptionId / selectedRouteLabel / selectedRouteId / changedReason` 可通过 `metadata.formData` 保留
- `degrade`
  - 当只有一个推荐降级方案时，可用 `approve`
  - 当存在多个可选降级档位时，应改用 `multi-choice`
- `terminate`
  - 当前没有独立 `MissionDecision.type = "terminate"`，因此必须通过 `custom-action` 承载
  - 这条合同只说明如何复用现有 carrier，不代表 terminate prompt 已在所有前端入口统一生成

这一定义支持 `8.2` 的设计收口；边界仍需保持保守：

- 当前成立的是“恢复选项如何复用现有 `MissionDecision` carrier 已写清”，不是 recovery-specific payload builder 或提交服务已经统一实现。
- 其中 `reroute` 的 resolved `formData` 与 route-selection 元数据保留已有直接代码与测试锚点；其余选项当前主要停留在设计合同层。

### requiresComment 与责任确认边界

恢复场景并不是所有人工动作都必须留言，但以下几类动作应默认进入 `requiresComment` 或等价责任确认语义：

- 接受治理越界边缘的继续执行
  - 例如预算接近上限、需要额外权限、存在外部副作用风险
- 接受显著降级后的继续执行
  - 例如质量、范围、自动化等级被主动下调
- 主动改线并改变原交付承诺
  - 例如切换路线、放弃原阶段、改写任务边界
- 触发升级或终止
  - 需要说明为什么当前层级无法继续，或为什么必须停止
- 人工明确覆盖系统推荐动作
  - 例如系统建议 replan，但人工要求继续原路线

以下场景可以不强制评论，但仍应保留最小决策痕迹：

- 明确的 route selection 多选提交
- 对缺失信息的直接补充
- 在既有治理允许范围内批准低风险继续

与当前主仓的兼容边界如下：

- 当前可以复用现有 `MissionDecision.requiresComment`、comment、metadata 与 `alreadyResolved` 幂等链路
- 当前还不能外推出 recovery-specific option payload 已经成型，因此这里只定义“何时应要求评论”的治理原则，不定义新的提交协议

## 恢复后继续设计

### Resume 路径

恢复成功后，任务可回到以下高层状态：

- `executing`
  - 自动恢复成功，继续原执行链
- `reviewing`
  - revise 或恢复后需要重新复核
- `replanning`
  - 路线已变更，需要重新生成执行计划
- `takeover-required`
  - 仍有未解决治理或人工问题
- `delivered`
  - 恢复后完成交付且通过校验

### 继续前校验

任何恢复后的继续动作都必须重新执行以下检查：

- 当前治理边界是否仍允许继续
- 当前路线是否仍有效
- 当前人工批准是否覆盖后续动作
- 当前 review / verify 是否要求再次执行

### 恢复返回条件 Contract

恢复成功后并不是一律回到 `executing`，而应按返回条件进入不同高层状态：

- 返回 `executing`
  - 当前 blocker 已清除
  - 当前路线仍有效，且不需要正式改线
  - 治理边界允许继续
  - 不存在未完成的 `Takeover Point` / `MissionDecision`
- 返回 `reviewing`
  - 恢复动作产出了需要重新 review / verify 的结果
  - 进行了 `revise_then_review`
  - 或降级 / 替代执行导致必须重新确认质量
- 返回 `delivered`
  - 交付物已完成
  - 所有强制 review / verify / audit gate 已通过
  - 没有未关闭的 takeover、升级或 blocker

以下情况不得直接宣称恢复完成：

- 仍存在待处理人工决策
- 已经进入正式改线但新路线未确认
- 风险接受、预算接受、权限接受仍未完成责任确认
- 虽然局部节点恢复成功，但任务级 blocker 仍在

若不满足上述返回条件，应继续停留或转入以下状态：

- `takeover-required`
  - 仍需人工处理或责任确认
- `replanning`
  - 原路线不再有效或恢复动作显式改变路线
- `blocked`
  - 技术恢复未完成，且当前无法安全推进

这一节支持 `12.3` 的设计收口；当前不外推为统一 recovery return-condition evaluator 已在代码中实现。

## 与 Drive State 的映射

| 恢复阶段 | 对应 Drive State | 说明 |
| ---- | ---- | ---- |
| 偏航检测中 | `executing` / `reviewing` | 在原状态内发现异常 |
| 自动恢复中 | `blocked` 或 `executing` | 取决于是否阻塞主链 |
| 等待人工恢复决策 | `takeover-required` | 进入人工链路 |
| 改线恢复中 | `replanning` | 重新规划路线 |
| 恢复后重新复核 | `reviewing` | 防止带病继续 |
| 恢复成功继续 | `executing` | 回到主链 |

说明：

- `blocked` 不是终态，而是“当前无法自动推进且恢复尚未完成”
- `replanning` 与 `retry` 不同，它代表正式改写路线
- `reviewing` 也可以成为恢复入口，而不是只在结果末尾出现

### 与现有 `Drive State` spec 的术语与迁移条件对齐

为了避免 recovery spec 再发明一套高层状态名，当前文档与 `.kiro/specs/drive-state-and-replan-state-machine/` 保持以下术语对齐：

| recovery 语义 | 本 spec 使用方式 | 既有 `Drive State` spec 对齐口径 | 迁移条件 |
| ---- | ---- | ---- | ---- |
| `goal_deviation` | 偏航分类，不是 Drive State | 需要人工裁决时转 `takeover-required`，需要正式改线时转 `replanning` | 不新增 `goal-deviation` 作为高层状态名 |
| `route_deviation` | 偏航分类，不是 Drive State | 对齐为 `replanning` | 继续保留 route selection / replan 事实字段 |
| `quality_deviation` | 偏航分类，不是 Drive State | 对齐为 `reviewing`，必要时升级为 `takeover-required` | 不把 review 失败直接改名成新状态 |
| `dependency_failure` | 偏航分类，不是 Drive State | 对齐为 `blocked` | 继续保留 runtime failure / blocker 事实 |
| `state_block` | 偏航分类，不是 Drive State | 对齐为 `blocked` | 继续保留 `mission.blocker`、`operatorState = blocked` |
| `recovery_exhausted` | 偏航分类，不是 Drive State | 对齐为 `takeover-required` 或 `blocked`，随后可能升级 | 不新增 `recovery-exhausted` Drive State |
| `escalated` | recovery state，不是 Drive State | 对齐到 `takeover-required` 或 `blocked` 的高层结果面 | 继续保留 `instance.escalated`、human escalation review 事实 |
| `human_confirm_continue` | 恢复动作，不是 Drive State | 处理窗口仍属于 `takeover-required` | 由决策结果驱动后续 `resume()` |
| `degrade_execution` | 恢复动作，不是 Drive State | 影响的是 `executing / reviewing` 的能力包，而不是单独新状态 | 继续通过 impact / diff 表达，不新增 Drive State |

统一约束：

- recovery spec 不引入新的高层 Drive State 枚举，继续复用既有十态口径：
  - `understanding / clarifying / planning / fleet-forming / executing / reviewing / blocked / takeover-required / replanning / delivered`
- recovery spec 中的 `deviationCategory`、`recovery.state`、`takeover.status`、`route.selectionStatus`
  - 都是与 `driveState` 并行存在的解释字段，不替代 `driveState`
- 若未来要做字段迁移，必须满足两个条件：
  - 现有 shared `inferMissionAutopilotDriveState()` 仍能只依赖 mission facts、decision facts、route/replan facts 推导结果
  - 不要求批量重命名 `MissionStatus`、workflow/runtime status、execution step status 或 recovery state

这一节支持 `12.5` 的设计收口；当前不外推为旧字段依赖已经被全面盘点或批量迁移计划已经落地。

## 与 review / audit / revise / verify 的兼容

### review

- 发现结果偏弱但可修补时，优先进入 `revise_then_review`
- 发现方向错误时，升级为 `goal_deviation` 或 `route_deviation`

### verify

- 明确不通过时，生成强触发 `DeviationEvent`
- 若可通过补证据解决，可进入人工确认或 revise

### revise

- `revise` 不是独立终态，而是恢复策略中的一种
- revise 成功后应返回 `reviewing` 或 `executing`

### audit

- audit 命中治理问题时，默认视为 `governance_deviation`
- 可能导致 `human_confirm_continue`、`human_takeover` 或 `escalate_exception`

### 这一闭环与现有实现的最小对齐

当前主仓已经具备一条保守可读的闭环，但仍停留在“恢复语义可被重建”的层面：

- `review`
  - 可作为发现结果偏弱、方向错误或需要回退 revise 的入口
- `verify`
  - 可作为强触发来源，把任务推进到更明确的 recovery / takeover 判断
- `revise`
  - 可作为恢复策略的一部分，并把任务送回 `reviewing`
- `audit`
  - 可作为治理命中来源，把任务送入 `human_confirm_continue`、`human_takeover` 或 `escalate_exception`

这一节当前支持勾选的边界是“设计兼容关系已写清”，不是说 `review / verify / revise / audit` 到 recovery 的统一写路径、统一事件模型和统一测试矩阵都已完整落地。

## 与 runtime governance 的兼容

`GovernanceBoundaryChecker` 在每个恢复策略执行前都要运行。

建议治理检查维度：

- `retry_budget`
- `cost_budget`
- `permission_scope`
- `risk_level`
- `external_side_effect`
- `automation_level`

治理结果分类：

- `allowed`
  - 允许自动执行恢复
- `needs_takeover`
  - 可以做，但必须人工确认
- `needs_escalation`
  - 普通人工确认不够，需要更高层级审批或升级
- `denied`
  - 不允许执行该恢复动作

### 治理命中后的默认控制面

设计上应把治理结果继续分派到默认控制面，而不是只停留在抽象结果值：

| 治理结果 | 默认控制面 | 说明 |
| ---- | ---- | ---- |
| `allowed` | 继续自动恢复或进入下一步恢复 | 保留治理结果与恢复动作痕迹，但不强制人工接手 |
| `needs_takeover` | 进入人工确认或人工接手 | 默认进入 `takeover-required`，等待 `MissionDecision` / `Takeover Point` 处理 |
| `needs_escalation` | 进入升级链路 | 不再停留在普通人工确认层，直接映射到更高权限审批、值守或升级 |
| `denied` | 阻断当前恢复动作 | 当前动作不得执行，可改为建议其他低风险动作、等待接手或终止 |

为了与当前主仓兼容，这里的默认控制面先按已有主线落点表达：

- `allowed`
  - 对应继续 `retry / resume / revise / replan`
- `needs_takeover`
  - 对应 `waiting` / `WAITING_INPUT` / `takeover-required`
- `needs_escalation`
  - 对应 `escalate()`、human escalation review、blocked human follow-up
- `denied`
  - 对应 blocked reason、禁止继续当前动作、转入其他恢复层或等待人工

这一节成立的是“设计上已给出治理命中后的默认分派原则”，不是统一治理控制面代码已经完成。

### 恢复动作对自动驾驶等级的影响

恢复动作不只改变当前执行路径，也应显式改变当前任务的自动化等级预期。建议按下表表达：

| 恢复动作 | 自动化等级影响 | 说明 |
| ---- | ---- | ---- |
| `retry` / `restore_snapshot` | 保持原等级或轻微降级 | 仍由系统主导，且动作局部可回退 |
| `substitute_executor` | 视替代范围轻微降级 | 需要说明能力是否收窄、质量是否下降 |
| `skip_non_critical` / `degrade_execution` | 明确降级 | 自动化仍可继续，但必须降低对结果完整性的预期 |
| `human_confirm_continue` | 从纯自动转为有人类责任确认 | 系统继续执行，但自动化等级下降一级 |
| `human_takeover` | 明确降到半自动或人工主导 | 当前阶段不再属于纯自动驾驶 |
| `escalate_exception` | 进入受控人工值守或更高治理层 | 当前自动驾驶主线暂停 |
| `terminate` | 自动化链路结束 | 不再继续推进 |

最小表达规则：

- 任何会引入人工责任确认的动作，都不得继续标记为原自动化等级
- 任何 `degrade_execution` 都必须同步更新 automation impact，并在任务详情或 explanation 中可见
- 若恢复动作会把系统从“自动闭环”降到“半自动协同”，必须同步进入审计与回放

## 异常升级设计

### 触发条件

以下场景建议进入 `escalate_exception`：

- 自动恢复预算已耗尽
- 人工接手仍无法决策
- 需要超出当前权限边界的操作
- 风险等级达到 `critical`
- 任务可能造成真实外部副作用
- 审计或合规要求更高等级审批

### 升级前证据保留清单

进入 `escalate_exception` 之前，至少应冻结并保留以下证据组：

- 上下文组
  - 当前 `Destination`、当前 `Route`、当前 `Drive State`
  - 当前 blocker、takeover reason、recovery reason
- 动作组
  - `attemptedActions`
  - `suggestedActions`
  - 当前准备执行但被阻断的恢复动作
- 治理组
  - `governanceDecision`
  - 命中的预算、权限、风险、副作用边界
  - 已有审批、责任确认与缺失确认项
- 人工组
  - comment
  - decisionId
  - operatorActionIds
  - 谁请求升级、谁拒绝继续、谁要求额外审查
- 证据组
  - `timelineId`
  - `runtimeEventIds`
  - `correlationRefs`
  - 可用的 `auditEventIds`

保留原则：

- 没有最小证据组，不得把升级写成“已完成”
- 升级不是只保留最终 reason，而是要保留“为什么之前的恢复动作不再可行”
- 若证据缺口本身就是升级原因，也必须被记录成显式缺口，而不是静默丢失

### 升级后动作

升级后任务可进入三种处理结果：

- `takeover-required`
  - 等待更高权限人工处理
- `blocked`
  - 冻结任务，保留证据，等待治理响应
- `terminate`
  - 强制停止任务并记录终止原因

### 升级失败或无人接手时的兜底策略

升级并不保证一定有人及时处理，因此必须预先定义兜底收敛路径：

- 有更高权限队列但暂时无人处理
  - 保持 `blocked` 或 `takeover-required`
  - 继续保留任务证据与 consequences，不得伪装为已恢复
- 升级请求被明确拒绝
  - 当前恢复动作转为 `denied`
  - 任务必须在 `replan`、更保守降级或 `terminate` 中收敛
- 没有合法升级目标
  - 直接转 `terminate` 或更强阻断
  - 审计中必须解释为什么“无人可安全接手”
- 升级超时
  - 不能无限停留在模糊状态
  - 必须进入显式等待、重新提醒、重新分派或终止策略中的一种

兜底规则：

- 高风险、高副作用场景优先保守阻断或终止
- 低风险但需要责任确认的场景可继续停留在等待状态
- 任何兜底收敛都必须保留升级前证据与升级未完成原因

### 与现有人工值守、治理审批和终止控制面的关系

`escalate_exception` 不应被理解为一条全新的平行链路，而应优先复用现有三类控制面：

- 与人工值守的关系
  - 当普通执行人或当前任务拥有者无法安全决策时，升级进入更高权限人工 review / follow-up
  - 在现有仓库里，这通常表现为 `WAITING_INPUT` 下的 human escalation review，或 blocked human follow-up
- 与治理审批的关系
  - 当问题本质是预算、权限、风险、外部副作用、责任接受边界不足时，升级应理解为进入更高等级审批，而不是继续尝试局部恢复
  - 普通 `human_confirm_continue` 不足以覆盖的情况，应直接转入 `needs_escalation`
- 与终止控制面的关系
  - 当升级本身也无法获得批准、无人接手或风险已不允许继续保留任务时，必须允许升级链路收敛到 `terminate`
  - 终止不是升级失败后的异常状态，而是升级链路中的合法终点之一

因此，异常升级的兼容路径可以保守写成：

```text
recovery blocked
  -> human_confirm_continue 不足
  -> escalate_exception
  -> higher approval / higher-privilege takeover / terminate
```

在当前主仓语义里，这一节应与以下既有能力对齐理解：

- `mission decision` 可承载 comment、approval、request-info、escalate
- `workflow runtime` 可承载 `escalate()`、`terminate()` 与 `WAITING_INPUT`
- `mission projection` / `autopilot summary` 可把升级结果面投影为 `takeover-required`、`blocked`、`recovery.attemptedActions`
- `runtime observability` / `audit` 可镜像 `instance.escalated`、`instance.terminated`

## 审计与回放

### Recovery Attempt Ledger

每次恢复尝试至少记录：

- 偏航事件 ID
- 恢复策略类型
- 触发来源
- 治理判断
- 是否自动执行
- 是否需要人工评论
- 开始与结束时间
- 成功或失败原因

### `RecoveryAttemptLedger` 最小字段与保留策略

为了让恢复记录后续可进入 replay / audit / projection，而不是只停留在临时内存态，建议把 `RecoveryAttemptLedger` 的最小字段拆成五组：

- 标识与范围
  - `attemptId`
  - `missionId`
  - `deviationEventId`
  - `routeId / stageKey / stepId`
- 触发与策略
  - `triggerKind`
  - `strategyType`
  - `triggeredBy`
  - `automatic`
- 治理与责任
  - `governanceDecision`
  - `requiresComment`
  - `decisionId`
  - `approver / operator`
- 状态变化
  - `beforeDriveState`
  - `afterDriveState`
  - `status`
  - `reason`
  - `consequenceSummary`
- 证据与关联
  - `runtimeEventIds`
  - `timelineId`
  - `correlationRefs`
  - `operatorActionIds`
  - `auditEventIds`

保留策略：

- 运行中任务
  - 至少要能在 projection / task detail 中重建当前一次恢复尝试及其后果
- 已完成或已终止任务
  - 至少要能在 replay / audit 中重建主要恢复轨迹与责任归因
- 当前主仓未落地独立 ledger 持久化时
  - 也必须保证 shared summary、mission projection、runtime observability 三层中存在稳定可重建的最小字段

这一节支持 `13.1` 的设计收口，但不意味着恢复账本的存储层、查询接口或 recovery-specific audit record model 已经实现。

### replay 表达

在回放时间线上至少展示：

- 何时检测到偏航或失败
- 当时处于什么 Drive State
- 系统先尝试了哪些恢复动作
- 哪一步进入人工接手
- 人工最终选择了什么
- 恢复后回到了执行、重规划、复核还是终止

### 质量失败与运行失败的时间线表达

为了避免时间线只会显示“失败”而没有语义，replay 中应把质量失败与运行失败分开表达：

- 运行失败
  - 来源于 runtime error、timeout、retry exhausted、dependency unavailable
  - 时间线重点展示：失败节点、恢复动作、blocked reason、是否进入升级
- 质量失败
  - 来源于 `review / verify / revise` 闭环
  - 时间线重点展示：失败结论、是否进入 `revise_then_review`、是否需要人工裁决、是否回到 `reviewing`
- 治理失败
  - 来源于 audit / governance / approval gate
  - 时间线重点展示：命中的边界、责任确认、是否阻断、是否升级

统一表达规则：

- 时间线事件标题必须包含失败类别，而不是只写 generic failed
- 若同一任务同时出现运行失败与质量失败，应保留因果顺序，而不是只展示最终失败
- 任务详情、replay 与 audit 的失败类别命名应与 `DeviationCategory` 保持一致或可映射

### audit 表达

在审计链中至少记录：

- 高风险降级执行
- 人工批准继续或风险接受
- 权限、预算、外部副作用相关恢复
- 异常升级与终止
- 默认自动恢复为何被允许

### 默认自动恢复为何被允许的证据表达

“允许自动恢复”不能只停留在系统内部判断，至少应在 evidence / audit 中保留以下理由字段：

- `allowReason`
  - 为什么当前动作被判断为低风险、低副作用或局部可回退
- `governanceDecision`
  - 当前动作是 `allowed` 还是因何被转人工 / 升级
- `safetyChecks`
  - 校验了哪些边界，例如预算、权限、外部副作用、最低交付标准
- `fallbackPlan`
  - 如果自动恢复失败，下一步会进入哪一层恢复
- `approvalScope`
  - 当前是否已经被既有审批、route selection、risk acceptance 所覆盖

最小审计口径：

- 默认自动恢复必须可回答“为什么这次不是直接接管”
- 若动作后来失败并升级，仍要能回溯当时允许自动恢复的理由
- 若理由只存在于瞬时 runtime 日志而不会进入 projection / replay / audit，则不算满足证据表达要求

## 与现有基础设施的兼容方案

### 兼容现有 MissionDecision

恢复场景下不新增独立提交协议，优先使用现有决策体系承载：

- `approve`
  - 批准继续、批准降级、批准恢复
- `request-info`
  - 要求补充上下文或人工填写理由
- `multi-choice`
  - 在多种恢复策略之间选择
- `escalate`
  - 升级到更高权限人工处理
- `custom-action`
  - 特殊恢复动作

### 兼容现有 runtime 控制面

- 节点重试映射到 `retry`
- 人工处理后继续映射到 `resume`
- 改线恢复映射到 `replan`
- 质量修正映射到 `revise`
- 升级映射到 `escalate`
- 不可恢复时映射到 `terminate`

### 兼容现有接管面板

恢复决策点进入现有接管队列，但增加以下信息：

- 当前恢复层级
- 已尝试恢复动作
- 推荐恢复策略
- 降级影响说明
- 继续后需要重新 review / verify 的提示

## 服务端投影与任务详情接入

### 服务端投影职责

当前主线的恢复治理更适合先通过 projection 收口，而不是先引入独立 recovery API。服务端最小职责如下：

- shared summary 归一
  - 以 `buildMissionAutopilotSummary()` 作为 recovery / takeover / route replan / consequence 的统一读模型入口
- mission projection 对齐
  - 由 `server/tasks/mission-projection.ts` 把 workflow / replay / session links、`autopilotSummary` 与 `orchestration.wait / replan` 对齐到同一任务视图
- 证据与关联索引补齐
  - 继续透出 `evidence.timeline`、`evidence.correlation`、`route.takeoverPointIds`、`decisionId`、`operatorActionIds`
- 只读结果面优先
  - 当前优先保证任务详情、cockpit 变体、replay / audit 能重建语义，而不是新增 recovery-specific 写接口

### 任务详情与驾驶舱最小接入

客户端当前最稳妥的接入方式是“只读 recovery surface + 复用通用 decision 写路径”：

- `tasks-store`
  - 负责把 `destination.impact / blockingReason`、`recovery`、`takeover`、`route.replan`、`evidence.correlation` 归一成稳定前端读模型
- `TaskDetailView`
  - 负责把 `DecisionPanel` 与 `TaskAutopilotPanel` 组合到 default / cockpit 两种详情视图
- `TaskAutopilotPanel`
  - 负责展示 recovery 摘要、takeover 摘要、timeline / correlation、route diff、consequences 与 recommendation reasons

这一层当前支持保守声称的范围是：

- 任务详情和 cockpit 详情变体已经能读到 recovery / takeover / replan / consequence 的最小闭环
- 当前仍是只读展示面，不是完整 recovery cockpit、接手控制台或 recovery-specific write-path

### 驾驶舱全局状态提示

驾驶舱级提示不应只复述任务详情里的字段，而应把 recovery/takeover 状态压缩成一组全局可扫读提示。最小合同如下：

| 驾驶舱状态提示 | 触发条件 | 必带信息 | 默认语气 |
| ---- | ---- | ---- | ---- |
| `偏航已检测` | `deviationCategory != none` 且尚未进入人工链路 | 偏航类别、当前阶段、是否仍可自动恢复 | 警示 |
| `恢复执行中` | `recovery.state = recovering` 或存在自动恢复动作进行中 | 已尝试动作、下一步 fallback、是否会回到 review/replan | 处理中 |
| `等待接手` | `driveState = takeover-required` 或 `wait.active = true` | 接手原因、推荐动作、不处理后果、decisionId | 阻塞 |
| `升级处理中` | `recovery.state = escalated`、`instance.escalated` 或 higher review | 升级目标、冻结范围、证据是否已保留 | 高风险 |

展示规则：

- 状态提示优先消费：
  - `driveState`
  - `recovery.state`
  - `recovery.deviationCategory`
  - `takeover.reason / prompt / decisionId`
  - `destination.impact / blockingReason`
  - `route.replan.reason`
- 同一时刻只允许一个主提示占位，但可以附带一个次提示：
  - 例如主提示为“等待接手”，次提示为“运行时已重规划”
- 文案必须回答两个问题：
  - 现在为什么停在这里
  - 下一步最安全的动作是什么
- 若存在 `WAITING_INPUT` 或 `decisionId`
  - 提示中必须显式带出“正在等待人工输入”而不是只写 blocked

这一节支持 `14.2` 的设计收口；当前不外推为独立驾驶舱组件或全局提示总线已经实现。

### 降级执行差异与风险提示

`degrade_execution` 不能被普通 route diff 取代，必须有单独的 before/after 差异合同。最小展示结构如下：

| 字段组 | before | after | 说明 |
| ---- | ---- | ---- | ---- |
| 能力范围 | 原模型 / 原工具 / 原权限 / 原自动化级别 | 降级后的模型 / 工具 / 权限 / 自动化级别 | 说明降了什么 |
| 交付预期 | 原质量、原范围、原验证深度 | 降级后的质量、范围、验证深度 | 说明交付损失 |
| 治理影响 | 原预算 / 副作用 / 风险假设 | 降级后的预算 / 副作用 / 风险假设 | 说明为什么降级更安全或更保守 |
| 责任确认 | 原本不需确认或已确认 | 当前是否要求 comment / approval / escalation | 说明谁要为降级背书 |

最小提示规则：

- `degrade_execution` 必须同时展示：
  - `为什么降级`
  - `降了什么`
  - `风险是否真的下降`
  - `自动化等级是否下降`
  - `是否需要人工评论或批准`
- 当 route 也发生变化时：
  - route diff 与 degrade diff 应拆开显示
  - 不允许只用“切到 safer route”掩盖降级带来的质量/权限变化
- 如果降级被治理拒绝：
  - 必须展示拒绝原因与下一步动作，例如 escalate 或 terminate

与当前主仓的最小对齐方式：

- `TaskAutopilotPanel` 现有 route selection/replan/evidence/recovery 展示
  - 可作为 degrade diff 的承载面
- 但 route diff 只说明“路线变了”，不等于“能力包降级差异”本身

这一节支持 `14.4` 的设计收口；当前不外推为降级差异 UI、专用投影字段或审计卡片已经实现。

### 恢复记录进入 Mission 快照或等价持久化层

在不新增独立 recovery 存储服务的前提下，恢复事件与恢复尝试至少应能进入 Mission 快照或等价持久化层的下列字段组：

- 当前恢复快照
  - `currentDeviationCategory`
  - `currentRecoveryState`
  - `currentRecoveryReason`
  - `currentDecisionId`
  - `currentTakeoverPointId`
- 最近一次恢复尝试
  - `lastRecoveryAttemptId`
  - `lastRecoveryStrategyType`
  - `lastRecoveryStatus`
  - `lastRecoveryUpdatedAt`
- 恢复索引
  - `operatorActionIds`
  - `decisionIds`
  - `runtimeEventIds`
  - `auditEventIds`
  - `lineageIds`

如果当前阶段仍不引入独立 ledger 表，最低要求是这些信息可以通过以下现有事实组合被重建：

- `mission.blocker / waitingFor / operatorState / attempt`
- `decision / decisionHistory`
- `operatorActions`
- `projection.workflowId / replayId / sessionId`
- `autopilotSummary.recovery / takeover / route.replan / evidence.correlation`

这一节支持 `15.1` 的设计收口；当前不外推为独立数据库表或 recovery snapshot writer 已经落地。

### 服务重启后的恢复上下文 re-attach

服务重启后，恢复中的任务应按“先重建语义，再恢复 attach”的顺序处理：

1. 读取 Mission 主记录与 projection links
2. 用 `buildMissionAutopilotSummary()` 重建 `recovery / takeover / route.replan / evidence.correlation`
3. 若存在 `workflowId / instanceId`
   - 尝试重新附着当前 runtime instance 或 checkpoint
4. 若附着失败
   - 至少保留 `blocked / takeover-required / replanning` 的只读结果面
   - 不得回退成看似健康的 `executing`

最小 re-attach 依据：

- `mission.status = waiting`
  - 优先恢复为 `takeover-required` 或 `clarifying`
- `operatorState = blocked` 或存在 `blocker`
  - 优先恢复为 `blocked`
- 存在 `route.selection.status = replanned`、`route.replan`
  - 优先恢复为 `replanning`
- 存在未完成 `decisionId`
  - 必须把接手上下文一并恢复出来

这一节支持 `15.2` 的设计收口；当前不外推为 restart attach harness 或统一重建服务已经实现。

### 恢复记录与 `decisionHistory` / 任务历史 / audit 的关联合同

恢复记录需要与三条既有历史链路显式对齐：

- `decisionHistory`
  - 关联键：`decisionId`、`nodeId`、`sessionId`、`interactionId`、`branchKey`
  - 用于回答“哪次人工决策改变了恢复去向”
- 任务历史 / operator actions
  - 关联键：`operatorActionIds`、`stageKey`、`createdAt`
  - 用于回答“已经尝试过哪些恢复动作”
- audit / replay / lineage
  - 关联键：`auditEventIds`、`runtimeEventIds`、`timelineId`、`lineageIds`
  - 用于回答“治理和证据如何回放到这次恢复”

最小关联原则：

- `reroute`
  - 必须能关联到 `decisionHistory.resolved.metadata.formData.selectedRouteId / changedReason`
- `escalate`
  - 必须能关联到 `instance.escalated` 或等价 audit/replay 事件
- `terminate`
  - 必须能关联到 `instance.terminated` 或等价任务终止记录
- 若 `auditEventIds` 暂时缺失
  - 也必须显式记录为证据缺口，而不是把关联合同省略掉

这一节支持 `15.3` 的设计收口；当前不外推为所有任务都已稳定写出非空 `auditEventIds`。

### 重连、刷新、重启后的最小继续保证

恢复中的任务在连续性层至少保证以下四件事不会丢：

- 当前高层状态
  - `driveState`
  - `recovery.state`
  - `takeover.status`
- 当前阻塞语义
  - `takeover.reason / prompt / decisionId`
  - `destination.impact / blockingReason`
- 当前路线语义
  - `selectedRouteId`
  - `recommendedRouteId`
  - `route.selection.status`
  - `route.replan`
- 当前证据索引
  - `timelineId`
  - `decisionIds`
  - `operatorActionIds`
  - `runtimeEventIds`

连续性约束：

- 浏览器刷新或 socket 重连后
  - 必须能从 projection 直接读回这组最小字段
- 服务重启后
  - 若无法立刻恢复写路径，也必须先恢复只读 recovery surface
- 不允许出现以下倒退：
  - 明明还在等待接手，却显示为 healthy / executing
  - 明明已重规划，却丢失 `selectedRouteId / changedReason`
  - 明明已升级，却丢失 `decisionId / operatorActionIds / runtimeEventIds`

这一节支持 `15.4` 的设计收口；当前不外推为跨刷新、跨重启 continuity test harness 已全量实现。

### 历史恢复记录的查询/投影接口

当前阶段不强制新增独立 recovery API，但至少要明确历史恢复记录可从哪些只读接口或投影视图取回：

- 任务详情投影
  - `GET /api/tasks/:id/projection`
  - 读取 `autopilotSummary.recovery / takeover / route.replan / evidence`
- 任务列表或详情缓存
  - 读取 `tasks-store` 归一后的 `autopilotSummary`
- replay / audit 视图
  - 按 `missionId / workflowId / replayId / timelineId / decisionId` 回放

建议的最小查询维度：

- `missionId`
- `workflowId`
- `timelineId`
- `decisionId`
- `routeId`
- `stageKey`
- `recoveryState`
- `deviationCategory`

最小结果面：

- 当前恢复摘要
- 最近一次恢复动作
- 最近一次接手/升级/终止动作
- 关联的 route change summary
- 证据与关联索引

这一节支持 `15.5` 的设计收口；当前不外推为独立恢复历史查询接口已经存在，只定义“现有 projection / replay / audit 应承载什么查询语义”。

## 测试与验证策略

### 单元测试设计

恢复治理的单元测试优先覆盖“等价检测语义 + 恢复选择结果 + 治理判定结果”，而不是先等待完整 recovery engine 落地：

- shared 读模型单测
  - 锁定 `inferDeviationCategory()`、`buildRecoverySummary()`、`buildMissingInfoDetails()`、`evidence.correlation`
- decision 兼容单测
  - 锁定 `requiresComment`、`alreadyResolved`、route-selection / request-info 元数据保留
- runtime 治理单测
  - 锁定 retry exhausted、`allowed / denied / needs_escalation` 的最小结果面

当前单元测试设计应遵守两个边界：

- 优先覆盖当前已有直接代码与直接测试锚点的 `route-deviation / governance-deviation / state-block / waiting / replan / escalate`
- 不把尚未形成直测闭环的 `goal-deviation / quality-deviation / dependency-failure / recovery-exhausted` 外推为同等级已验证

### 集成与投影验证

集成层应优先覆盖 recovery 语义如何穿过 mission / workflow / projection / observability：

- waiting route-selection、budget approval、blocked retry、retry-replan 的 projection 闭环
- `resume()`、`escalate()`、`terminate()` 与 auto-escalate 的 runtime 结果面
- replay / audit 对 retry / escalate / terminate 的镜像
- 任务详情对 recovery / takeover / consequence / correlation 的只读消费

建议把集成验证矩阵至少收敛为以下场景：

| 场景 | 触发来源 | 预期结果面 |
| ---- | ---- | ---- |
| 局部 retry 成功 | runtime retryable failure | 回到 `executing`，保留 attempted action |
| retry exhausted -> escalation | runtime budget exhausted | 进入 `takeover-required` 或 `WAITING_INPUT`，保留 escalate 轨迹 |
| waiting route-selection -> decision -> resume/replan | human / route selection | projection 同步更新 `takeover`、`route.replan`、decision history |
| governance blocked -> needs_takeover | governance / audit | 进入 `blocked` 或 `takeover-required`，保留 blocked reason |
| revise_then_review | review / verify | 回到 `reviewing` 并带恢复原因 |
| 降级执行获批或被拒绝 | governance + human | 产生差异说明、责任确认或升级结果 |

### 回归验证边界

`review / audit / revise / verify` 进入 recovery 闭环的回归测试当前应分两层推进：

- 已有最小锚点
  - `audit` / governance blocked、waiting review checkpoint、revise 后回到 `reviewing` 的语义兼容
- 后续补线重点
  - recovery-specific `review / verify / revise` 写路径
  - 质量失败与运行失败在同一时间线中的统一回归矩阵
  - 降级执行、升级前证据保留、恢复返回条件的专门回归用例

建议回归矩阵至少覆盖以下组合：

- `review -> revise_then_review -> reviewing`
- `verify -> blocked / takeover-required`
- `audit -> governance_deviation -> needs_takeover / needs_escalation`
- `route selection -> changed route -> replanning`
- `blocked retry -> escalate -> waiting human review`

因此，这一节当前更适合支撑：

- `16.1`：偏航检测、恢复层级选择与治理判定的单元测试设计已经可以按现有 shared / decision / runtime 锚点收口
- `16.2`：自动恢复、降级执行、人工接手、异常升级的集成测试目标已经可以按场景矩阵收口
- `16.3`：`review / audit / revise / verify` 进入 recovery 的回归测试目标已经可以按回归矩阵收口

但仍不应外推为：

- `16.5`：跨重启、重连、刷新后的恢复继续验证已经完善

### 连续性验证

跨重启、刷新和重连的恢复继续验证，当前更适合作为测试计划显式定义，而不是误读为已实现能力。最小验证面应包括：

- 服务重启
  - 任务重新通过 mission projection、shared summary、decision history 与 correlation index 重建 recovery 读模型
- 页面刷新
  - 任务详情重新获取后，仍能看到 recovery / takeover / consequence / timeline preview
- socket 重连
  - 增量事件恢复后，不应把任务误判为“已恢复完成”或丢失等待中的人工决策

这一节支持 `16.5` 的测试计划收口，但当前仍不外推为跨重启 attach、恢复持久化与统一 continuity harness 已经落地。

## 灰度与回滚策略

### 灰度策略

恢复治理应优先按“只读投影 -> 通用决策复用 -> 有边界的自动恢复”逐层放量，而不是一次性切到完整自动恢复：

1. 观察态灰度
   - 只打开 `autopilotSummary`、`mission projection`、任务详情 consequences / recovery 展示
   - 不新增 recovery-specific 写路径
2. 人工桥接灰度
   - 只复用已有 `MissionDecision`、`waiting`、`resume()`、`escalate()`
   - route selection、budget approval、request-info 这类已有语义先行
3. 自动恢复灰度
   - 仅放开已被 runtime governance 和直接测试锚定的低风险动作，例如 local retry、retry exhausted -> auto-escalate
   - `degrade_execution`、高风险外部副作用、额外权限扩张场景继续保守关闭

### 阈值原则

即使当前没有独立阈值配置中心，设计上仍应先统一三类阈值口径：

- 自动恢复阈值
  - 仅允许低风险、低副作用、局部可回退动作自动进入下一步
- 接手阈值
  - 评论必填、风险接受、路线改写、预算边界、权限边界优先进入 `needs_takeover`
- 升级阈值
  - retry exhausted、权限越界、`critical` 风险、真实外部副作用、无人可安全决策时进入 `needs_escalation`

### 阈值灰度分层

阈值不应一次性全开，建议按三层灰度推进：

1. 观察阈值
   - 只记录 recovery candidate，不真正执行自动恢复
   - 用于校准强触发 / 弱触发与 consequences copy
2. 保守执行阈值
   - 只允许 `retry`、低风险 `resume()`、已有直测锚点的 waiting / escalate 主线
   - `degrade_execution`、`skip_non_critical`、替代执行器切换默认关闭
3. 扩展执行阈值
   - 仅在已验证质量下限、治理边界与审计表达后，逐步放开更多自动恢复动作

灰度阈值至少要围绕以下维度配置：

- 风险等级
- 外部副作用
- 预算余量
- 权限边界
- 自动化等级
- 是否已有人工责任确认

### 回滚原则

回滚策略必须保证 recovery governance 关闭后，现有主线仍然可继续：

- 读面回滚
  - 允许关闭新的 recovery summary / consequence 展示增强，但不破坏原任务详情与通用 decision 面板
- 写面回滚
  - 继续保留既有 `MissionDecision`、`waiting`、`resume()`、`escalate()`、`terminate()` 主线，不要求 recovery-specific payload 才能工作
- 投影回滚
  - `mission projection` 即使去掉 recovery 增强字段，也必须保留基础任务、workflow、session links 与 orchestration 结果面

### 回滚触发条件

以下信号应触发 recovery governance 的分级回滚：

- `blocked / takeover-required` 异常突增，且无对应业务原因
- 路线频繁重规划，明显偏离预期稳定性
- audit / replay 中出现无法解释的恢复动作或责任缺口
- 任务详情 consequences / recovery summary 与 runtime 实际状态持续不一致
- 灰度阶段中高风险场景被错误自动恢复

回滚顺序：

1. 先关闭高风险自动恢复
   - 包括 `degrade_execution`、高副作用动作、需要额外权限的替代执行
2. 再关闭自动恢复写面
   - 保留通用 `MissionDecision` / `waiting` / `resume()` / `escalate()` 主线
3. 最后回退为只读 recovery surface
   - 保留 projection / explanation / evidence，不破坏基础任务详情与通用 decision 面板

这一节当前是落地计划设计，不应外推为：

- 已有独立阈值配置中心、灰度开关、动态策略下发或一键回滚工具
- `17.4 / 17.5` 的代码级灰度平台、动态阈值中心或统一回滚开关已经实现

## 分阶段落地建议

### 第一阶段：语义与事件层

- 定义 `DeviationEvent`、`RecoveryStrategy`、`RecoveryAttempt`
- 梳理 runtime / review / governance 信号映射
- 建立最小恢复事件投影

### 第二阶段：恢复控制与接管桥接

- 建立 `RecoveryCoordinator`
- 将恢复决策映射到 `Takeover Point` 和 `MissionDecision`
- 接入 `retry / resume / replan / escalate / terminate`

### 第三阶段：可视化与治理集成

- 在驾驶舱和任务详情中展示恢复状态
- 在 replay / audit 中展示恢复时间线
- 将治理命中与恢复动作打通

### 第四阶段：策略优化

- 灰度调整自动恢复阈值
- 优化降级策略矩阵
- 补充更细粒度异常升级流程

## 审计补注（2026-04-24）

基于当前主仓代码与直接测试，恢复机制与人工接管治理已经有一条最小、可验证的事实闭环，但仍然主要停留在 recovery summary、等待恢复、异常升级和 replay / audit 镜像层，而不是完整的治理契约层。

### 已有直接代码与测试支撑的部分

`shared/mission/autopilot.ts` 已落地以下恢复相关读模型：

- `MissionAutopilotDeviationCategory`，覆盖 `goal-deviation / route-deviation / quality-deviation / governance-deviation / dependency-failure / state-block / recovery-exhausted`
- `MissionAutopilotRecoverySummary`，覆盖 `state / deviationCategory / reason / attemptedActions / suggestedActions / needsHuman / canAutoRecover`
- `inferMissionAutopilotDriveState()`，把 waiting、failed、blocked、plan+retry、finalize 等状态映射到 `takeover-required / blocked / replanning / reviewing`
- `buildRecoverySummary()`，把 `mission.status`、`operatorState`、`blocker`、`decision`、`operatorActions` 聚合为恢复摘要

`shared/__tests__/mission-autopilot.test.ts` 已直接验证：

- waiting budget approval 场景映射到 `takeover-required` 与 `governance-deviation`
- blocked retry 场景映射到 `blocked` 与 `state-block`
- blocked/retry/replan 场景下 recovery summary、remaining steps 与 evidence timeline 的最小闭环

`server/tests/mission-routes.test.ts` 已直接验证：

- waiting mission 的 `autopilotSummary.recovery`、`takeover`、`orchestration.wait`
- retry-driven mission 的 `autopilotSummary.recovery`、`route.replan`、`orchestration.replan`
- 服务端 projection 可以把恢复态与重规划态透出到 `/api/tasks/:id/projection`

`server/tests/mission-operator-actions.test.ts` 已直接验证：

- blocked mission 可通过 `resume` 清空 blocker 并回到 active operator state
- failed mission 可通过 `escalate` 进入 blocked human follow-up
- failed / cancelled mission 可通过 `retry` 返回 queued 并重建下一次尝试

`server/tests/workflow-runtime-engine.test.ts` 已直接验证：

- `WAITING_INPUT -> resume()` 的继续链路
- runtime `escalate()` 会把异常实例送入 human review checkpoint
- automatic/manual retry budget exhaustion 会生成 blocked reason，并在策略允许时触发 auto-escalate

`server/tests/web-aigc-runtime-observability.test.ts` 已直接验证：

- `node.waiting_input`、`node.failed`、`instance.retry_requested`、`instance.escalated`、`instance.terminated` 会被镜像到 replay / audit
- governance 相关 metadata 会在 retry / escalate 镜像时一并保留

### 因此本轮可保守确认的设计结论

- `blocked / takeover-required / replanning` 已有直接代码与测试支撑的边界
- 人工处理后回到自动链路继续，当前至少已有 `submitMissionDecision() -> resume`、workflow `resume()`、blocked mission `resume` 三条真实通路
- 恢复状态已经可以通过 shared autopilot summary 与 server mission projection 重建
- 异常升级已经可以映射到现有 `escalate()` 与 human review checkpoint 主线

### 本轮仍保留为后续工作的部分

以下能力目前还只有设计意图，没有足够的统一代码与测试闭环，因此仍不能写成已完成：

- `DeviationEvent / RecoveryStrategy / RecoveryAttempt / RecoveryDecisionPoint` 契约层
- 普通 `retry`、`revise`、`replan`、`degrade_execution` 的统一恢复层级矩阵
- 降级执行与 cost / permission / runtime governance 的统一表达
- 恢复记录持久化、查询接口与服务重启后的完整 attach 语义
- 驾驶舱、接管面板、replay、audit 中对恢复历史的统一展示模型
- “质量失败”和“运行失败”在单一治理时间线中的统一前端表达

### 本轮新增审计结论（2026-04-24）

在不外推未实现恢复契约的前提下，当前主仓还可以再保守确认一条事实：

- “恢复后继续如何映射到 `resume()`、orchestrator 继续或 `replan`” 已经有最小实现闭环。

直接依据如下：

- `server/tasks/mission-runtime.ts`
  - `waitOnMission()` 把恢复/接管语境落到 mission waiting 状态；
  - `resumeMissionFromDecision()` 通过 `resolveWaiting()` 把等待态恢复回 running 主链。
- `server/core/mission-orchestrator.ts`
  - `submitDecision()` 在决策被接受后，会根据 hook 结果进入三种真实分支：
    - 继续等待下一决策；
    - `resumed = true` 时回到 running；
    - 未完成 executor resume 接线时保留等待后续继续。
- `server/tests/workflow-runtime-engine.test.ts`
  - 已直接验证 workflow runtime 的 `WAITING_INPUT -> resume()`。
- `server/tests/mission-routes.test.ts`
  - 已直接验证 retry-driven projection 中 `orchestration.replan` 与 `route.replan` 的联动透出。

这条结论的边界也需要写清楚：

- 当前能确认的是“现有继续控制面已可被 recovery/takeover 主线复用”，不是完整的 `RecoveryDecisionPoint -> MissionDecision payload -> resume/replan` 统一桥接协议已经定型。
- `submitMissionDecision()` 虽已有幂等接口与 `alreadyResolved` 语义，但当前缺少专门针对 recovery 场景的端到端幂等测试，因此本轮仍不保守勾选 `8.3`。
- `Takeover Point` 类型与 `MissionDecision` payload 的恢复专用映射仍主要停留在设计层与现有 waiting/route-selection/budget 等事实的复用层，尚不足以保守勾选 `8.1 / 8.2`。

在相同的保守口径下，本轮还可以再确认两条设计闭环，但仍然只应表述为“已有最小实现与审计表达”，不能外推成完整 recovery ledger 或治理契约：

- “治理判断与恢复动作如何进入审计链”已经有最小事实闭环。
- “replay 时间线中偏航、恢复、接手、升级事件的展示语义”已经有最小事实闭环。

直接依据如下：

- `server/tests/web-aigc-runtime-observability.test.ts`
  - 已验证 `node.waiting_input`、`node.failed`、`instance.retry_requested`、`instance.escalated`、`instance.terminated` 会被镜像到 replay / audit；
  - 已验证 retry / escalate 控制事件会携带 governance metadata 进入 replay / audit；
  - 因而“治理判断与恢复动作进入审计链”这一层的最小表达已经成立。
- `shared/__tests__/mission-autopilot.test.ts`
  - 已验证 recovery summary 会输出 attempted actions、takeover state 与 evidence timeline；
  - 已验证 blocked / retry / escalate 语境下 evidence timeline 至少能表达恢复动作与人工处理痕迹。
- `server/tests/mission-routes.test.ts`
  - 已验证 waiting projection 会同时透出 `autopilotSummary.recovery`、`takeover`、`orchestration.wait`；
  - 已验证 retry-driven projection 会同时透出 `autopilotSummary.recovery`、`route.replan`、`orchestration.replan`；
  - 这意味着服务端投影层已经能把 replay 所需的“等待接手 / 改线恢复”语义重建到任务视图。

这些新增结论的边界同样需要写清：

- 当前 replay / audit 侧成立的是“现有 runtime 与 projection 事件已经足够表达最小恢复时间线”，还不是统一的 `RecoveryAttemptLedger` 字段设计、保留策略和查询接口已经实现，因此本轮仍不勾 `13.1`。
- observability 已经保留 retry budget 与 blocked reason 一类 governance metadata，但并没有形成覆盖 cost / permission / external side effect / auto-allowed rationale 的统一证据协议，因此本轮仍不勾 `10.1 / 10.2 / 10.3 / 13.3 / 13.5`。

在继续复核 mission operator actions、workflow runtime engine、mission routes、runtime observability 与 HITL decision 后，本轮还可以再保守确认两条：

- “升级后任务是冻结、等待更高权限接手还是终止”已经有最小结果闭环。
- “replay / audit 能重建恢复时间线”的验证用例已经存在最小闭环。

直接依据如下：

- `server/tests/mission-operator-actions.test.ts`
  - 已验证 failed mission 可以通过 `escalate` 进入 blocked human follow-up；
  - 已验证 blocked mission 可以通过 `resume` 清空 blocker 并回到 active operator state；
  - 这说明 mission 控制面至少已经覆盖“升级后冻结等待人工处理”的结果分支。
- `server/tests/workflow-runtime-engine.test.ts`
  - 已验证 runtime `escalate()` 后实例进入 `WAITING_INPUT`，并带 `human escalation review` checkpoint；
  - 已验证 `terminate()` 后实例进入 `FORCE_TERMINATED`，并写出 `instance.terminated` 事件；
  - 已验证 retry governance exhausted 时会 auto-escalate 进入等待人工 review；
  - 这三类结果合起来，已经覆盖“等待更高权限接手 / 冻结 / 终止”的最小状态面。
- `shared/__tests__/mission-autopilot.test.ts`
  - 已验证 evidence timeline、correlation、decisionIds、runtimeEventIds 与 telemetry signals 的最小重建；
  - 已验证 waiting / blocked / retry / escalate 语境下恢复线索会进入 shared autopilot summary。
- `server/tests/mission-routes.test.ts`
  - 已验证 projection 会把 `autopilotSummary.recovery`、`takeover`、`route.replan`、`orchestration.wait / replan` 与 evidence correlation 一并透出；
  - 这说明任务投影视图已经能重建 recovery timeline 所需的最小上下文。
- `server/tests/web-aigc-runtime-observability.test.ts`
  - 已验证 `node.waiting_input`、`node.failed`、`instance.retry_requested`、`instance.escalated`、`instance.terminated` 会镜像进入 replay / audit；
  - 已验证 retry / escalate 的 governance metadata 会被保留；
  - 因而“replay / audit 能重建恢复时间线”的验证并非只有单点断言，而是跨 shared summary、projection 与 runtime observability 的最小组合。

这些新增结论的边界仍需保持保守：

- `11.3` 当前成立的是“升级后结果面”的最小闭环，不是完整的 escalation policy、审批层级和无人接手兜底流程都已定型，因此仍不勾 `11.1 / 11.2 / 11.4 / 11.5`。
- `16.4` 当前成立的是“已有 recovery timeline reconstruction 的验证用例”，不是统一的 recovery ledger 回放测试框架，也不代表服务重启、重连、跨端历史查询等验证已经补齐，因此仍不勾 `16.2 / 16.5`。
- `8.3` 虽然 `submitMissionDecision()` 已有 `idempotentIfNotWaiting` 与 `alreadyResolved` 语义，但 recovery 场景仍缺专门端到端幂等验证，因此本轮继续不勾。
- `15.3` 虽然 decision history、projection correlation 与 audit/replay metadata 已经存在，但尚未形成统一的“恢复记录与 decisionHistory / task history / audit 的正式关联模型”，因此本轮继续不勾。

在进一步复核 workflow runtime governance、mission waiting/takeover 投影与 approval gate 后，本轮还可以再保守确认一条：

- “`allowed / denied / needs_takeover / needs_escalation` 的治理判定结果”已经有最小结果闭环。

直接依据如下：

- `server/tests/workflow-runtime-engine.test.ts`
  - 已验证权限允许或审批 `not_required` 的场景可以继续执行，形成 `allowed` 的最小事实锚点；
  - 已验证 manual retry governance exhausted 时，`instance.retry_requested` 会写出 `allowed: false` 与 `blockedReason`，形成 `denied` 的最小事实锚点；
  - 已验证 automatic retry governance exhausted 且允许 auto-escalate 时，会进入 `runtime.auto_escalate` 与 `instance.escalated`，形成 `needs_escalation` 的最小事实锚点。
- `shared/__tests__/mission-autopilot.test.ts`
  - 已验证 waiting budget approval 会被投影为 `takeover-required` 与 `governance-deviation`；
  - 这说明 shared recovery summary 已经能把“需要人工确认后才能继续”的治理结果表达出来。
- `server/tests/mission-routes.test.ts`
  - 已验证 waiting decision / route selection 场景会同时透出 `autopilotSummary.recovery`、`takeover` 与 `orchestration.wait`；
  - 这说明服务端 projection 已经把 `needs_takeover` 的最小结果面重建到任务视图。

这条新增结论也必须保持边界：

- 当前能保守确认的是“四类治理结果已经各自有最小结果锚点”，不是统一的 runtime governance contract、字段协议和控制面分派策略已经完全定型，因此本轮只勾 `10.2`，继续不勾 `10.3`。
- `needs_takeover` 目前主要通过 waiting / approval_required / takeover-required 的结果面表达出来，还不是统一的 `GovernanceBoundaryChecker` 返回结构已在所有恢复动作上落地。
- `denied` 与 `needs_escalation` 目前最强锚点集中在 retry governance 与 approval gate，尚未扩展到成本、权限范围、外部副作用等完整治理维度，因此 `10.1` 仍不能勾。

## 非目标

- 不在本 spec 中要求重写现有 workflow engine
- 不在本 spec 中实现外部值班系统或 Pager 集成
- 不在本 spec 中定义多人审批编排
- 不在本 spec 中承诺所有异常都能自动恢复

### 续审补注（2026-04-24，lane 1）

本轮围绕 recovery state、escalation、replay-audit reconstruction、operator actions、mission runtime、workflow runtime、observability 与 HITL decision 又做了一次保守复核，结论是当前主仓仍然主要停留在“最小恢复结果面 + 投影面 + 可观测面”闭环，而不是完整 recovery governance contract 闭环，因此不新增勾选。

这轮最接近但仍不能保守勾选的条目包括：

- `10.3`：已有治理结果类别，但还没有统一默认控制面策略去规定治理命中后何时阻断、何时建议接管、何时必须接管、何时升级。
- `11.2`：已有 `requestedBy / reason / governance / decisionId` 等零散保留字段，但没有统一约束“升级前必须保留哪些上下文、证据与人工评论”。
- `12.3`：已有 drive state 映射，但缺少把“恢复后返回 `executing / reviewing / delivered` 的条件”明文化并被测试锚定的 recovery 条件模型。
- `13.3`：已有 replay / audit 镜像 escalate、retry、terminate，但没有统一“高风险恢复 / 降级 / 人工批准 / 终止”的 audit 记录方式；`degrade` 仍是设计意图。
- `15.3`：已有 `decisionHistory`、timeline correlation、runtime/audit metadata，但尚未形成恢复记录与 `decisionHistory / task history / audit` 的正式关联契约，且 `auditEventIds` 仍为空数组。

因此，本 spec 当前可保守声称的是：恢复摘要、接管等待、升级结果、replay / audit 镜像与 mission projection 已经能重建最小恢复语义；仍不可声称的是：统一恢复账本、统一治理分派策略、统一升级前证据保留规则、统一恢复-审计关联模型已经实现。

### 再续审补注（2026-04-24，lane 1）

在本轮继续复核 shared autopilot correlation、mission projection 与对应测试后，可以再保守新增一条：

- `13.4`“恢复事件与 Route、Mission、Workflow、Runtime Event 的关联键”已经有最小实现闭环。

直接依据如下：

- `shared/mission/autopilot.ts`
  - 已定义 `MissionAutopilotEvidenceCorrelationIndex`，包含 `missionId / workflowId / replayId / sessionId / timelineId / routeIds / routeStageKeys / runtimeEventIds / decisionIds / operatorActionIds / auditEventIds / lineageIds`；
  - `buildEvidenceCorrelationIndex()` 已把这些索引键聚合进 shared autopilot summary。
- `shared/__tests__/mission-autopilot.test.ts`
  - 已直接断言 waiting / blocked / queued 等场景下 `evidence.correlation` 会输出 `missionId`、`workflowId`、`timelineId`、`routeIds`、`routeStageKeys`、`runtimeEventIds`、`decisionIds`、`operatorActionIds` 等关联键。
- `server/tests/mission-routes.test.ts`
  - 已直接断言 `/api/tasks/:id/projection` 会把上述 correlation key 透出到 mission projection，包括 waiting route-selection 与 retry-replan 两类恢复相关场景。

这条结论的边界同样需要保持保守：

- 当前成立的是“最小关联键索引已经存在并被 shared/server 测试锚定”，不是完整 recovery ledger、正式 audit 关联、查询接口或跨重启 attach 语义已经实现。
- `auditEventIds` 当前仍为空数组，因此 `13.3 / 15.3` 依然不能随之勾选。
- 这条新增更接近“投影/索引层闭环”，不能外推成恢复记录持久化与审计链路已经完整收口。

### 补位续审补注（2026-04-24，lane 1）

在继续复核 workflow runtime recovery/governance 测试后，本轮可以再保守确认一条最小设计闭环：

- `5.4`“局部自动恢复失败后进入下一层恢复的规则”已经有一条可被真实代码与测试直接锚定的窄实现路径。

直接依据如下：

- `server/tests/workflow-runtime-engine.test.ts`
  - `automatically retries a retryable node when retry budget is configured` 已证明节点级 automatic retry 是当前已落地的局部自动恢复动作；
  - `automatically escalates when retry budget is exhausted and escalation is enabled` 已证明当 local automatic retry budget exhausted 且策略允许 auto-escalate 时，runtime 会把实例从局部恢复切换到 `instance.escalated` + `WAITING_INPUT` 的 `human escalation review`。
- `shared/__tests__/mission-autopilot.test.ts`
  - 已验证 blocked retry 场景会在 recovery summary 中留下 `attemptedActions: ["retry", "escalate"]`、`takeover-required` 与 evidence timeline；
  - 这说明 shared recovery 投影已经能把“局部自动恢复失败后进入更高一层恢复/人工处理”的结果面表达出来。

这条闭环的边界同样需要写清：

- 当前能保守确认的，只是“节点级 automatic retry 耗尽后升级到人工评审/异常升级路径”这一条最小规则，而不是所有局部恢复动作都已经定义了统一的下一层恢复规则。
- 因此，这里不能外推成完整的 `RecoveryCoordinator`、恢复层级矩阵、`degrade_execution` 分派规则、恢复账本或恢复持久化已经实现。
- 也正因为边界仍然很窄，本轮只保守支撑 `5.4`，继续不勾 `4.2 / 4.3 / 5.1 / 5.2 / 5.3 / 5.5`。

### 续审补注（2026-04-25，lane 3）

基于当前主仓最新工作树，这轮再次围绕 recovery / human takeover governance 的直接实现与测试做了保守复核，结论是不新增勾选，当前 done/total 仍为 `15 / 103`。

本轮重点回看的真实代码与测试链路包括：

- `shared/mission/autopilot.ts` 与 `shared/__tests__/mission-autopilot.test.ts`
  - 继续确认了 `MissionAutopilotRecoverySummary`、`inferMissionAutopilotDriveState()`、`buildRecoverySummary()`、`MissionAutopilotEvidenceCorrelationIndex` 已把 recovery state、takeover-required / replanning 边界、attempted actions 与 correlation keys 投影到 shared autopilot 读模型；
  - 也继续确认了 `auditEventIds` 在现有 shared 测试中仍为空数组，说明 recovery-to-audit 的正式关联模型仍未收口。
- `server/tasks/mission-runtime.ts`、`server/core/mission-orchestrator.ts`、`server/tasks/mission-decision.ts`、`server/routes/tasks.ts` 与 `server/tests/hitl-decision.test.ts`
  - 继续确认了 waiting -> `submitMissionDecision()` -> `resolveWaiting()` -> resumed / alreadyResolved 的最小 wait-resume / idempotent submission 闭环；
  - 但这条链路依旧主要证明“现有 HITL 决策流程可被 recovery/takeover 复用”，还不足以推出一套 recovery-specific `MissionDecision` payload contract。
- `server/tests/mission-routes.test.ts`
  - 继续确认 waiting route selection、retry-replan、correlation projection 与 `takeover.decisionId / route.takeoverPointIds / evidence.timeline` 的最小闭环；
  - 但这些投影仍是 summary/projection 视角，而不是 recovery ledger、recovery return conditions 或 recovery history query 的正式模型。
- `server/tests/mission-operator-actions.test.ts`、`server/core/workflow-runtime-engine.ts`、`server/tests/workflow-runtime-engine.test.ts`
  - 继续确认 blocked mission `resume`、failed mission `escalate`、automatic/manual retry budget exhaustion、auto-escalate、`WAITING_INPUT` human escalation review、`terminate()` 等恢复结果面；
  - 但还没有统一的 escalation evidence preservation contract，也没有把恢复后回到 `executing / reviewing / delivered` 的条件做成单独合同。
- `server/core/web-aigc-runtime-observability.ts` 与 `server/tests/web-aigc-runtime-observability.test.ts`
  - 继续确认 `node.waiting_input`、`node.failed`、`instance.retry_requested`、`instance.escalated`、`instance.terminated` 会镜像进入 replay / audit；
  - 但 audit 侧仍然是 runtime event mirroring，不是完整的“高风险恢复 / 降级 / 人工批准 / 终止”统一记录方式。

因此，本轮最接近但仍不能保守新增勾选的缺口仍集中在以下几类：

- recovery option 兼容层还缺正式合同：
  - `8.2` 还不能勾，因为当前只是 waiting / route-selection / takeover summary 复用了既有 `MissionDecision` 与 `decisionId` 锚点，没有 recovery option -> `MissionDecision` payload 的统一字段约束与直接测试。
- governance 控制面仍未统一：
  - `10.3` 还不能勾，因为 `allowed / denied / needs_takeover / needs_escalation` 只有结果锚点，没有统一默认控制面策略去定义阻断、建议接管、必须接管与升级的分派规则。
- escalation 前证据保留规则仍未封口：
  - `11.2` 还不能勾，因为虽然 `requestedBy / reason / governance / decisionId` 在多个链路中可见，但没有统一 contract/test 约束升级前必须保留哪些上下文、证据与人工评论。
- recovery return-condition contract 仍缺：
  - `12.3` 还不能勾，因为 shared/server 当前证明的是结果态投影，不是“恢复完成后何时回到 `executing / reviewing / delivered`”的条件模型。
- replay / audit 仍停留在最小镜像层：
  - `13.3` 还不能勾，因为 audit 侧没有专门的高风险 recovery / degrade / manual approval record model；
  - `15.3` 还不能勾，因为 `decisionHistory`、projection correlation、runtime/audit metadata 虽可并存，但 `auditEventIds` 仍为空，恢复记录和 task history / audit 的正式关联模型未落地。
- recovery-specific 前端展示仍不能外推：
  - `14.1 - 14.5` 这组条目目前还缺 recovery-specific UI contract 与稳定测试闭环，不能仅凭零散 takeover / autopilot surface 就声明已完成恢复状态、恢复历史和接手治理展示。

这轮续审后，本 spec 仍然只适合保守声称：

- recovery summary、drive state、takeover-required / replanning 边界已经可投影；
- wait-resume / escalate / retry governance / replay-audit mirroring 已构成最小恢复治理事实链；
- replay / projection 已能重建最小 recovery timeline。

本 spec 仍不适合声称：

- 统一的恢复治理契约层已经建立；
- recovery option 与 `MissionDecision` payload 的兼容层已定型；
- 完整 recovery ledger / audit record model / recovery history query 已实现；
- recovery-specific cockpit / panel / history UI 已稳定落地。

### 续审补注（2026-04-25，lane 2）

本轮围绕任务详情侧的 recovery / takeover 展示继续做保守复核后，可以再补两条前端展示面的最小闭环结论：

- `14.1`“任务详情中恢复状态、恢复历史与当前接手点的展示区域”现在可以保守成立；
- `14.3`“恢复决策面板中的推荐动作、已尝试动作与影响说明”现在也可以保守成立。

直接依据如下：

- `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts`
  - 服务端 projection 已把 `autopilotSummary.recovery`、`takeover`、`route.replan`、`evidence.timeline`、`evidence.correlation` 与 explanation/recommendation 字段一起透出到任务详情视图；
  - waiting route selection 与 retry-replan 两类 recovery 场景都已有直接测试锚点，说明前端消费的不是临时 mock，而是服务端稳定投影。
- `client/src/components/tasks/TaskAutopilotPanel.tsx`
  - 已在 `TaskDetailView` 中稳定挂载 `task-autopilot-panel`；
  - `parseRecovery()` 已把 `recovery.state / deviationCategory / reason / attemptedActions / suggestedActions / needsHuman / canAutoRecover` 收敛为 recovery 摘要块；
  - `parseTakeover()` 已把 `takeover.type / status / reason / prompt / options / urgency` 收敛为当前接手点摘要块；
  - `parseEvidence()` 与 `enhanceEvidenceBlock()` 已把 timeline preview、correlation refs 与 indexed counts 收敛为“恢复历史/证据”最小展示面；
  - `parseRoute()`、`parseDestination()` 与 `parseExplanation()` 已补充路线差异、ETA / cost 汇总、risk points、remaining steps、missing-info impact 与 recommendation reasons，构成恢复决策说明所需的最小上下文。
- `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
  - 已直接断言 `task-autopilot-recovery`、`task-autopilot-evidence`、`task-autopilot-explanation`、`task-autopilot-takeover` 与 `task-autopilot-panel` 会出现在任务详情中；
  - 已直接断言 recovery 区块会显示 `Attempted: Retry`、`Suggested: Replan; Escalate`、`Human handoff required`、`Auto recovery unavailable`；
  - 已直接断言 takeover 区块会显示 `Approve external write?` 与 `Options: Approve: Continue the route.; Reject: Stop the route.`；
  - 已直接断言 evidence / explanation 区块会显示 timeline、remaining steps、recommendation reasons、route diff、ETA / cost / risk 汇总与 correlation 标识。

这两条结论的边界必须继续保持保守：

- 当前能成立的是“任务详情页已有 recovery/takeover 的只读展示区块，并且有稳定测试”，不是独立 recovery cockpit、takeover queue、交互式恢复控制面或完整历史页已经落地。
- 当前 `14.3` 能成立的是“推荐动作、已尝试动作与影响说明的摘要表达已经落地”，不是前端已经具备 recovery option 的统一提交模型、影响评估写回或动作执行编排。

因此，本轮仍不能把其余前端项外推为已完成：

- `14.2` 仍不能勾：证据只覆盖任务详情面板，没有独立驾驶舱的全局状态提示体系。
- `14.4` 仍不能勾：route diff 不是 `degrade_execution` 的专门差异模型，降级能力边界与风险提示仍停留在设计意图。
- `14.5` 仍不能勾：destination impact / blocking 文案虽能提示“会继续阻塞”，但还没有 takeover-specific 的“如果不接手会发生什么”统一契约与直测锚点。

### 续审补注（2026-04-25，lane 6）

本轮继续围绕 recovery governance / retry / takeover-required / recommended actions / attempted actions 的现有实现与测试做保守复核后，可以再补一条前端展示面的最小闭环结论：

- `14.5`“不接手会发生什么”的提示表达，现在可以保守成立。

直接依据如下：

- `shared/mission/autopilot.ts`
  - `buildMissingInfoDetails()` 已在 waiting / blocked 两类恢复相关场景下直接生成 consequences 文案：
    - `Route selection cannot continue until this input is resolved.`
    - `Goal understanding remains incomplete until this input is resolved.`
    - `Mission progress remains paused until this input is resolved.`
    - `Runtime recovery and execution handoff remain blocked.`
  - 这说明 shared autopilot 读模型已经把“当前不处理会继续造成什么阻塞”收敛成稳定字段，而不是仅靠零散前端拼文案。
- `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts`
  - 服务端 projection 已透出 `destination.missingInfoDetails`；
  - waiting route-selection 场景已有直接测试断言：
    - `item = 'route selection'`
    - `impact = 'Route selection cannot continue until this input is resolved.'`
    - `blocking = true`
  - 这说明任务详情消费到的 consequences 提示不是本地 mock，而是服务端 recovery/takeover 投影的一部分。
- `client/src/lib/tasks-store.ts` 与 `client/src/lib/tasks-store.autopilot.test.ts`
  - store 归一化逻辑已把 `destination.missingInfoDetails[*].impact` 提升为 `destination.impact / destination.blockingReason`；
  - 现有测试已直接断言结构化 missing-info 细节会保留并提升为：
    - `impact = "Execution remains blocked until the workspace is confirmed."`
    - `blockingReason = "Execution remains blocked until the workspace is confirmed."`
  - 这说明 client 侧已经把 consequences 文案稳定收口为任务详情可消费的统一字段。
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
  - `parseDestination()` 已优先展示 `destination.blockingReason / destination.impact / destination.missingInfoDetails[*].impact`；
  - 现有测试已直接断言 destination 区块会显示：
    - `Route selection will stay blocked until the release owner confirms the handoff.`
    - `Execution remains blocked until the workspace is confirmed.`
  - 因而“如果当前不接手 / 不补输入，会继续发生什么”的提示已经在任务详情面板中稳定可见，并有直接直测锚点。

这条结论的边界同样必须保持保守：

- 当前成立的是“任务详情页已经存在 consequences / blocking impact 提示表达的最小闭环”，不是独立 takeover-specific 字段协议、驾驶舱级全局提示体系、交互式后果模拟或统一 recovery write-path 已经落地。
- 因此，本轮只保守支撑 `14.5`；`14.2 / 14.4` 仍不能勾，`7.3 / 8.2` 也不能因为已有 suggested actions、decision options 或 consequences copy 就被外推出已完成。

### 指定证据集续审补注（2026-04-25）

本轮按更严格边界，仅复核以下指定证据：

- `client/src/components/tasks/DecisionPanel.tsx`
- `client/src/components/tasks/TaskDetailView.tsx`
- `client/src/lib/tasks-store.ts`
- `server/tests/hitl-decision.test.ts`
- `server/tests/mission-routes.test.ts`
- `server/tasks/mission-projection.ts`
- `shared/mission/api.ts`
- `shared/mission/index.ts`
- `shared/mission/autopilot.ts`
- `shared/__tests__/mission-autopilot.test.ts`

基于这组证据，当前更适合把 recovery / takeover governance 的已落地范围收口为以下三层，而不再继续外推：

- 通用决策提交层已稳定，但仍是通用 HITL，不是 recovery 专用合同：
  - `DecisionPanel.tsx` 已覆盖 `approve / reject / multi-choice / request-info / escalate / custom-action` 六类通用决策布局，以及 `requiresComment` 校验、`param_collection` metadata 组装与提交。
  - `server/tests/hitl-decision.test.ts` 已直接锁定 `requiresComment` 校验、`request-info` comment option、`param_collection` metadata 持久化、重复提交 `alreadyResolved`、以及普通 `human.decision_submitted` / `human.param_collection_submitted` 审计记录。
  - 这说明现有 `MissionDecision` 写路径足以承载 recovery/takeover 的最小提交复用，但仍不能推出 recovery option 已拥有独立 payload contract。

- recovery / takeover 读模型与投影层已稳定，但仍是 summary/projection，不是 recovery ledger：
  - `shared/mission/autopilot.ts` 已把 `takeover`、`recovery`、`missingInfoDetails`、`attemptedActions`、`suggestedActions`、`evidence.timeline`、`evidence.correlation`、`takeoverPointIds` 固化为 autopilot summary。
  - `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 已锁定 waiting route-selection、retry-replan、impact consequences、decisionId、timeline、correlation 的投影面。
  - `client/src/lib/tasks-store.ts` 已把这些字段归一化为前端稳定读模型，包括 `destination.impact / blockingReason`、`takeover.options`、`recovery.suggestedActions` 与 correlation refs。
  - 这说明恢复相关状态已能被服务端和客户端稳定重建，但仍不等于 `RecoveryAttemptLedger`、恢复持久化、恢复查询接口或恢复与 audit 的正式关联模型已经完成。

- 任务详情展示已稳定，但仍是只读 recovery surface，不是完整 recovery cockpit：
  - `TaskDetailView.tsx` 已稳定挂载 `DecisionPanel` 与 `TaskAutopilotPanel`。
  - 结合既有任务详情测试闭环，可以保守认为 recovery state、takeover summary、impact consequences 与 timeline preview 已形成只读展示面。
  - 但这仍不足以推出 recovery-specific cockpit、接手控制面、降级执行差异面板或统一 recovery write-path 已经落地。

基于上述更严格边界，本 spec 当前仍不能继续外推完成的条目如下：

- `7.3` 仍不能勾：
  - 通用 decision options 已存在，但没有 recovery 语义下“继续 / 降级 / 改线 / 升级 / 终止”的专门选项合同与直接测试。
- `8.2` 仍不能勾：
  - 现有类型与测试证明的是通用 `MissionDecision` payload / metadata 机制，不是 recovery option -> `MissionDecision` payload 的专门映射协议。
- `10.3` 仍不能勾：
  - 当前只有结果态与投影，没有统一治理控制面把 `allowed / denied / needs_takeover / needs_escalation` 继续分派成“阻断 / 建议接管 / 必须接管 / 升级”。
- `11.2` 仍不能勾：
  - 现有审计测试是普通人类决策提交审计，不是 recovery / escalation 专用“升级前证据保留”合同。
- `12.3` 仍不能勾：
  - 现有代码能表达 `resume / retry / replan / escalate` 的建议，但没有 recovery return-condition contract 去约束何时恢复到 `executing / reviewing / delivered`。
- `13.3` 仍不能勾：
  - 现有审计记录以普通决策提交和 runtime/control timeline 镜像为主，没有高风险 recovery / degrade / manual approval / terminate 的统一记录格式。
- `15.3` 仍不能勾：
  - `decisionHistory`、timeline correlation 与空的 `auditEventIds` 同时存在，反而说明恢复记录与任务历史 / audit 的正式关联合同尚未成型。

因此，这次指定证据集复核后的保守结论是：

- recovery/takeover 的“读模型 + 通用决策复用 + 任务详情只读展示”已经具备最小闭环；
- recovery-specific option payload、escalation evidence preservation、return-condition contract、recovery audit record model 仍然是后续补线重点；
- 在这些专门合同落地前，不应再继续新增 recovery lane 的勾选项。

### 补充续审（2026-04-25，runtime / observability 证据复核）

本轮在既有指定证据集的基础上，又补充复核了两类更靠近 runtime / audit 的直接测试：

- `server/tests/workflow-runtime-engine.test.ts`
- `server/tests/web-aigc-runtime-observability.test.ts`

并继续与以下实现或投影面交叉核对：

- `shared/mission/autopilot.ts`
- `shared/__tests__/mission-autopilot.test.ts`
- `server/tasks/mission-projection.ts`
- `server/tests/mission-routes.test.ts`
- `server/tests/hitl-decision.test.ts`
- `client/src/components/tasks/DecisionPanel.tsx`
- `client/src/components/tasks/TaskAutopilotPanel.tsx`
- `client/src/lib/tasks-store.ts`

基于这组补充证据，当前可以再收紧为以下判断：

- runtime control 结果面已更清晰，但仍是结果面，不是统一 recovery governance contract：
  - `workflow-runtime-engine` 已直接覆盖 `WAITING_INPUT -> resume()`、显式 `escalate()`、显式 `terminate()`、以及 retry exhausted -> auto-escalate 的运行时分支；
  - escalation / terminate metadata 中会保留 `requestedBy / reason`，部分人工审批类 resume 还会保留 `comment / ticketId / governance.approval`；
  - 但这些字段目前仍分散在不同 node/runtime 场景里，尚未被收敛成“升级前必须保留哪些上下文、证据与人工评论”的统一 recovery contract，因此不能外推勾选 `11.2`。

- replay / audit mirroring 已更完整，但仍是镜像，不是 recovery-specific audit model：
  - `web-aigc-runtime-observability` 已直接验证 `instance.retry_requested / instance.escalated / instance.terminated` 会进入 replay / audit；
  - retry / escalate 镜像中也会带出 governance metadata；
  - 但 audit 侧仍主要是 runtime control event mirroring，尚未形成“高风险恢复 / 降级 / 人工批准 / 终止”的统一记录格式，因此不能外推勾选 `13.3`。

- 任务详情展示已稳定消费这些字段，但仍是只读 summary surface：
  - `TaskAutopilotPanel` 与 `tasks-store` 已稳定消费 `recovery.attemptedActions / suggestedActions`、`destination.impact / blockingReason`、`evidence.correlation`；
  - `DecisionPanel` 仍只证明通用 `MissionDecision` 写路径可复用，而不是 recovery 专用选项模型；
  - 因此当前成立的是“任务详情已能读到恢复建议、后果提示与关联索引”，不是“recovery-specific option payload / takeover action contract / recovery audit link model 已落地”。

这轮补充复核后，以下未勾项的边界反而更清楚了：

- `7.3` 仍不能勾：
  - 现有 UI 展示的是通用 decision option 体系，不是 recovery 语义下“继续 / 降级 / 改线 / 升级 / 终止”的专门接手选项合同。
- `8.2` 仍不能勾：
  - 现有闭环证明的是通用 `MissionDecision` payload / metadata 提交、幂等与历史留痕，不是 recovery option -> `MissionDecision` payload 的专用映射协议。
- `10.3` 仍不能勾：
  - 现有代码与测试能证明局部 governance result 已存在，但没有统一控制面去正式分派“阻断 / 建议接管 / 必须接管 / 升级”。
- `11.2` 仍不能勾：
  - escalation / terminate / approval resume 虽已零散保留上下文与评论字段，但没有 recovery / escalation 专用字段清单与统一测试约束。
- `12.3` 仍不能勾：
  - `resume()` 与部分 waiting/approval 场景的恢复结果已经存在，但没有单独 contract 去统一 recovery 完成后何时回到 `executing / reviewing / delivered`。
- `13.3` 仍不能勾：
  - replay / audit 现阶段是镜像层，不是 recovery-specific 审计模型层。
- `15.3` 仍不能勾：
  - `decisionHistory`、timeline correlation 与 replay / audit metadata 已共存，但 `auditEventIds` 仍为空，恢复记录与 `decisionHistory / 任务历史 / audit` 的正式关联模型尚未落地。

因此，这轮新增 runtime / observability 证据后的保守结论依旧不变：

- 当前主仓已经具备 recovery/takeover 的最小读模型、等待/接手/升级结果面、任务详情只读展示面，以及 replay / audit 的基础镜像面；
- 但 recovery-specific option payload、escalation evidence preservation、return-condition contract、recovery audit association model 仍未成型；
- 在这些专门合同落地前，不应继续新增这条 lane 的勾选项。

### 总收口补注（2026-04-25，lane 6）

本轮的目标不是继续外推代码完成度，而是把这份 spec 里已经直接写成型的设计项，与现有 tasks 勾选状态做一次保守对齐收口。

基于当前正文，以下条目已经具备直接设计覆盖，可以按“设计已收口”处理：

- `4.2`：`恢复层级` 小节已经明确从节点级重试、替代执行、检查点恢复、跳过非关键步骤、降级执行，到人工确认、人工接手、异常升级、终止任务的层级顺序。
- `4.3`：`策略矩阵` 已经把 `dependency_failure / quality_deviation / governance_deviation / route_deviation / goal_deviation / state_block / recovery_exhausted` 的首选、次选与必须人工条件写成表格。
- `7.1`：`人工确认后继续 vs 人工直接接手` 小节已经明确区分 `human_confirm_continue` 与 `human_takeover` 的职责边界。
- `7.2`：`接手范围` 小节已经给出 `step / stage / route / mission` 四级接手范围模型。
- `10.1`：`建议治理检查维度` 已经列出 `retry_budget / cost_budget / permission_scope / risk_level / external_side_effect / automation_level`。
- `11.1`：`异常升级设计` 下的 `触发条件` 已经列出自动恢复耗尽、权限越界、风险达到 `critical`、真实外部副作用、审计/合规要求升级等触发条件。
- `12.1`：`恢复后继续设计` 与 `与 Drive State 的映射` 两节已经共同给出偏航检测、自动恢复、等待人工、改线恢复、恢复后复核、恢复成功继续的高层状态流。
- `17.1 / 17.2 / 17.3`：`分阶段落地建议` 已经分别定义第一阶段语义与事件层、第二阶段恢复控制与接管桥接、第三阶段可视化与治理集成的落地范围。

这里的“已收口”只代表设计文档已经把语义、边界和阶段范围写清楚，不代表代码、持久化、接口、前端交互和治理合同都已经完整实现。

同时需要显式澄清一条阅读规则：本文件前面的历史续审补注中，若仍保留了诸如 `8.1 / 8.3 / 10.2 / 14.1 / 14.3 / 14.5` 曾经“不能勾”的旧表述，应以后续补注与当前 tasks 勾选状态为准，不再把这些旧结论当作最新判断。

在本轮收口后，以下条目仍然不适合保守勾选：

- `3.2 / 3.3 / 3.4`：实现分支已存在，但 `goal_deviation / quality_deviation / dependency_failure / recovery_exhausted` 仍缺同等级直测闭环。
- `7.3 / 8.2`：仍缺 recovery 语义下的专门接手选项合同，以及 recovery option 到 `MissionDecision` payload 的专门映射合同。
- `10.3`：仍缺统一治理控制面，把 `allowed / denied / needs_takeover / needs_escalation` 正式分派成“阻断 / 建议接管 / 必须接管 / 升级”。
- `11.2`：仍缺升级前必须保留哪些上下文、证据与人工评论的统一合同。
- `12.3`：仍缺恢复完成后何时回到 `executing / reviewing / delivered` 的独立 return-condition contract。
- `13.3`：仍缺 recovery-specific 的统一 audit record model。
- `14.2 / 14.4`：仍缺独立驾驶舱全局状态提示，以及 `degrade_execution` 的专门差异展示合同。
- `15.3`：`auditEventIds` 仍为空，恢复记录与 `decisionHistory / 任务历史 / audit` 的正式关联合同尚未成型。
