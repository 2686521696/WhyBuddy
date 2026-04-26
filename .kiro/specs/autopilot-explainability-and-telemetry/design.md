# 设计文档：任务自动驾驶可解释性与遥测层

## 设计概述

任务自动驾驶的可解释性与遥测层，是建立在现有 Mission Runtime、workflow runtime、runtime events、replay、audit、monitoring 与 evidence 能力之上的高层投影。

它的目标是把底层事实翻译为用户能够理解和信任的解释：

- 当前状态解释；
- 推荐原因；
- 剩余步骤；
- 风险提示；
- 置信度；
- 证据提示；
- 实时状态信号。

本设计不把可解释性写成一个新的独立平台，而是把它定义为自动驾驶产品对象与现有工程对象之间的解释层。

## 设计原则

1. 解释层是投影层，不是事实源替代层。
2. runtime events、replay、audit 仍然是关键事实与治理承接面。
3. 解释必须能追溯到真实信号，不能只生成漂亮文案。
4. 高风险解释必须保留证据、接管或审计入口。
5. 允许早期由前端 view model 推导，但必须保留服务端 projection 演进路径。
6. 不把“可关联 lineage”误写成“所有事件已全量沉淀 lineage”。

## 总体分层

### 第一层：事实信号层

事实信号层来自当前系统中已经存在或可稳定推导的执行事实：

- Mission 状态；
- Workflow instance 状态；
- Node run 状态；
- Runtime event；
- Route Planner 输出；
- Drive State 投影；
- Takeover Point / decision / approval；
- review / audit / verify / revise；
- replay timeline；
- artifacts / logs / evidence；
- monitoring projection；
- lineage relation index。

这一层回答“发生了什么”。

### 第二层：遥测归一层

遥测归一层把多个事实来源归并成任务自动驾驶需要消费的实时状态信号。

它不要求当前建立新的统一 telemetry backend，而是允许以下来源并存：

- 直接来自现有 runtime event；
- 来自 runtime event bridge；
- 来自 mission / workflow projection；
- 来自 replay / audit 查询；
- 来自前端 view model 的阶段性组合推导。

这一层回答“哪些信号对自动驾驶解释有意义”。

### 第三层：解释对象层

解释对象层把遥测信号转换为结构化解释对象。

典型解释对象包括：

- `CurrentStateExplanation`
- `RecommendationReason`
- `RemainingStepsExplanation`
- `RiskExplanation`
- `ConfidenceExplanation`
- `EvidenceHint`
- `RuntimeSignalSummary`

这一层回答“如何向用户解释”。

### 第四层：消费层

消费层包括：

- 自动驾驶驾驶舱；
- 任务详情页；
- 接管面板；
- 路线推荐与选择界面；
- replay 时间线；
- audit 查询；
- runtime / evidence dock。

这一层回答“在哪里展示和复原解释”。

## 核心对象设计

### 1. AutopilotExplanation

`AutopilotExplanation` 是所有解释对象的基础结构。

```ts
type ConfidenceSummary = {
  level: "low" | "medium" | "high" | "unknown";
  reason?: string;
};

type RiskSummary = {
  level: "low" | "medium" | "high" | "critical" | "unknown";
  label?: string;
};

type SuggestedAction = {
  actionType:
    | "continue"
    | "wait"
    | "clarify"
    | "takeover"
    | "replan"
    | "retry"
    | "escalate"
    | "degrade";
  label: string;
  requiresConfirmation: boolean;
  relatedRouteId?: string;
  relatedDecisionId?: string;
};

type AutopilotExplanation = {
  explanationId: string;
  type:
    | "current_state"
    | "recommendation_reason"
    | "remaining_steps"
    | "risk"
    | "confidence"
    | "evidence_hint"
    | "runtime_signal";
  title: string;
  summary: string;
  reason?: string;
  source: ExplanationSource;
  relatedRefs: ExplanationRelatedRefs;
  confidence?: ConfidenceSummary;
  risk?: RiskSummary;
  evidenceRefs: EvidenceRef[];
  suggestedActions: SuggestedAction[];
  status: "active" | "superseded" | "resolved" | "expired";
  createdAt: string;
  updatedAt: string;
};
```

设计要点：

- `type` 用于区分解释类型；
- `source` 用于说明解释来自 runtime、projection、audit、replay 或推断；
- `relatedRefs` 用于关联 mission、workflow、route、step、runtime event；
- `status` 用于支持重规划、状态变化后的解释失效。
- 第一阶段兼容策略是不替换现有 `MissionAutopilotExplanationSummary`，而是把 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals` 视为这个基础对象的最小投影切片；
- 第二阶段开始，新的结构化解释对象应作为 `autopilotSummary.explanation` 的可选扩展字段并行增加，而不是推翻现有 task detail 已稳定消费的摘要字段。

### 2. ExplanationSource

```ts
type ExplanationSource = {
  sourceType:
    | "runtime_event"
    | "mission_projection"
    | "workflow_projection"
    | "route_planner"
    | "drive_state_projection"
    | "audit_entry"
    | "replay_snapshot"
    | "frontend_view_model"
    | "combined_inference";
  sourceId?: string;
  generatedBy: "system" | "model" | "rule" | "human" | "projection";
  inferenceNote?: string;
  currentContractValue?:
    | "mission-runtime"
    | "workflow-runtime"
    | "route-planner"
    | "recovery-engine"
    | "takeover-state"
    | "combined-inference";
};
```

设计要点：

- `frontend_view_model` 是阶段性允许的来源，但不应长期成为关键解释的唯一来源；
- `combined_inference` 必须说明推断依据；
- 高风险解释优先使用 `runtime_event`、`audit_entry` 或服务端 projection。

与当前主仓兼容的来源映射：

| 目标 `sourceType` | 当前主仓稳定口径 | 当前直接锚点 |
| ---- | ---- | ---- |
| `mission_projection` | `mission-runtime` | `explanation.currentState.sources[]` |
| `workflow_projection` | `workflow-runtime` | `explanation.currentState.sources[]` |
| `route_planner` | `route-planner` | `recommendationDetails[].source` |
| `drive_state_projection` | `mission-runtime` 或 `workflow-runtime` | `currentState.driveState / workflowStatus / workflowStage` |
| `combined_inference` | `combined-inference` | `currentState.sources[]` |
| `audit_entry` | 第二/三阶段扩展 | 当前 design 目标，不宣称已落地 |
| `replay_snapshot` | 第二/三阶段扩展 | 当前 design 目标，不宣称已落地 |
| `frontend_view_model` | 第一阶段允许的 UI 层推导来源 | 仅作为设计边界保留，不宣称当前 shared 合同已输出 |

收口原则：

- 第二阶段服务端 projection 应优先把当前窄枚举映射到 `sourceType + currentContractValue` 双字段，而不是直接废弃现有 shared `MissionAutopilotExplanationSource`；
- `audit_entry / replay_snapshot / frontend_view_model` 只有在对应 consumer 真正落地时，才应进入代码合同；本轮只是设计定义，不把它们误写成当前主仓已实现。

### 3. ExplanationRelatedRefs

```ts
type ExplanationRelatedRefs = {
  missionId?: string;
  workflowId?: string;
  workflowInstanceId?: string;
  replayId?: string;
  sessionId?: string;
  timelineId?: string;
  routeId?: string;
  recommendedRouteId?: string;
  selectedRouteId?: string;
  routeVersion?: string;
  driveState?: string;
  stepId?: string;
  currentStepKey?: string;
  routeStageKeys?: string[];
  nodeId?: string;
  runtimeEventIds?: string[];
  decisionId?: string;
  decisionIds?: string[];
  operatorActionIds?: string[];
  auditEntryId?: string;
  auditEventIds?: string[];
  replaySnapshotId?: string;
  artifactIds?: string[];
  lineageId?: string;
  lineageIds?: string[];
};
```

设计要点：

- 关联字段保持宽松，便于分阶段接入；
- `lineageId` 是关联线索，不代表所有解释都已完整写入 lineage store；
- `runtimeEventIds` 支持解释与多个底层事件建立关系。

与当前主仓兼容的最小收口：

- 当前 shared/server 已稳定存在的引用骨架是 `evidence.correlation`，其中已直接覆盖 `missionId / workflowId / replayId / sessionId / timelineId / routeIds / recommendedRouteId / selectedRouteId / routeStageKeys / currentStepKey / runtimeEventIds / decisionIds / operatorActionIds / auditEventIds / lineageIds`；
- 第二阶段服务端 projection 应优先把 `evidence.correlation + resolved links + route selection/current step` 汇总为 `ExplanationRelatedRefs`，而不是再发明一套与 `correlation` 平行的引用命名；
- `workflowInstanceId / stepId / nodeId / artifactIds` 是本 spec 需要补齐的目标维度，但当前代码链路尚未统一输出，故只在设计中定义，不宣称当前已全部存在。

### 4. CurrentStateExplanation

`CurrentStateExplanation` 用于解释系统当前正在做什么。

```ts
type CurrentStateExplanation = AutopilotExplanation & {
  type: "current_state";
  currentDriveState:
    | "understanding"
    | "clarifying"
    | "planning"
    | "fleet-forming"
    | "executing"
    | "reviewing"
    | "blocked"
    | "takeover-required"
    | "replanning"
    | "delivered";
  currentStageTitle: string;
  currentActionText: string;
  whyNow: string;
  nextExpectedAction?: string;
};
```

示例解释口径：

- “正在执行第 3 阶段：生成候选方案，因为路线已确认且研究角色已完成资料收集。”
- “当前需要接管，因为预算确认缺失，继续执行会触发高成本外部工具。”

### 5. RecommendationReason

`RecommendationReason` 用于解释系统为什么推荐某条路线、动作或接管默认选项。

```ts
type RecommendationReason = AutopilotExplanation & {
  type: "recommendation_reason";
  targetKind: "route" | "action" | "takeover_option" | "replan_strategy";
  recommendedTargetId: string;
  comparedTargetIds: string[];
  tradeoffs: {
    time?: string;
    cost?: string;
    quality?: string;
    risk?: string;
    autonomy?: string;
  };
  autopilotLevelImpact?: string;
};
```

设计要点：

- 推荐原因必须能解释“为什么是它”；
- 路线推荐应关联 Route Planner 输出；
- 接管默认动作应关联 Takeover Point 与 risk/confidence。

### 6. RemainingStepsExplanation

`RemainingStepsExplanation` 用于解释还剩哪些主要步骤。

```ts
type RemainingStepsExplanation = AutopilotExplanation & {
  type: "remaining_steps";
  currentStepId?: string;
  completedStepIds: string[];
  activeStepIds: string[];
  remainingSteps: RemainingStepSummary[];
  changedByReplan?: boolean;
  replanReason?: string;
};

type RemainingStepSummary = {
  stepId: string;
  title: string;
  status: "pending" | "running" | "waiting" | "blocked" | "skipped" | "done";
  expectedOutput?: string;
  riskLevel?: "low" | "medium" | "high" | "unknown";
  mayRequireTakeover?: boolean;
};
```

设计要点：

- 剩余步骤来自 Route、workflow projection 或 runtime projection；
- 发生 Replan 时必须能说明剩余步骤变化；
- 并行支路应保留主线与分支关系。

### 7. RiskExplanation

`RiskExplanation` 用于说明当前风险。

```ts
type RiskExplanation = AutopilotExplanation & {
  type: "risk";
  riskId: string;
  scope: "destination" | "route" | "execution" | "takeover" | "delivery";
  riskType:
    | "goal_ambiguity"
    | "missing_data"
    | "cost_overrun"
    | "permission"
    | "security"
    | "compliance"
    | "tool_failure"
    | "runtime_instability"
    | "quality_gap"
    | "audit_gap"
    | "unknown";
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  trigger: string;
  impact: string;
  mitigation?: string;
  relatedRouteId?: string;
  relatedDecisionId?: string;
  mayTriggerTakeover: boolean;
  mayTriggerReplan: boolean;
};
```

设计要点：

- 风险必须能关联阶段、路线、runtime event 或 audit entry；
- 高风险必须提供建议动作；
- 风险变化应进入可回放时间线。

与当前主仓兼容的最小映射：

- 第一阶段最小输入来自 `route.riskPoints`、`explanation.riskSummary`、`driveState.riskLevel`、`recovery.state / deviationCategory / reason` 与 `takeover.reason`；
- 第二阶段 projection 可以先把这些摘要上卷成 `RiskExplanation[]`，同时继续保留 `riskSummary: string[]` 供现有 task detail consumer 兼容读取；
- `riskType / severity / trigger / impact / mitigation / mayTriggerTakeover / mayTriggerReplan` 一律要求能回指到 `route / recovery / takeover / evidence.correlation`，避免风险解释变成纯 UI 文案。

### 8. ConfidenceExplanation

`ConfidenceExplanation` 用于表达系统把握程度。

```ts
type ConfidenceExplanation = AutopilotExplanation & {
  type: "confidence";
  confidenceId: string;
  overall: ConfidenceLevel;
  dimensions: {
    goalUnderstanding?: ConfidenceLevel;
    routeFeasibility?: ConfidenceLevel;
    executionCompletion?: ConfidenceLevel;
    resultQuality?: ConfidenceLevel;
    evidenceSufficiency?: ConfidenceLevel;
  };
  changedReason?: string;
  thresholdAction?: "continue" | "clarify" | "takeover" | "degrade" | "replan";
  relatedRouteId?: string;
};

type ConfidenceLevel = {
  level: "low" | "medium" | "high" | "unknown";
  explanation: string;
};
```

设计要点：

- 避免伪精确，不强制使用百分比；
- 置信度变化必须能说明原因；
- 低置信度应与澄清、接管或重规划策略连接。

与当前主仓兼容的最小映射：

- 当前直接可复用的置信信号主要来自 `destination.confidence.level / reason / signals` 与 `driveState.confidence`；
- 第二阶段 projection 建议把它们汇总为 `overall + dimensions` 的结构化对象，同时继续保留当前 UI 已消费的 `destination.confidence` 与 `driveState.confidence`；
- `thresholdAction` 不应凭空生成，应由 `confidence 变化 + takeover/replan/clarify` 规则明确推导。

### 9. EvidenceHint

`EvidenceHint` 用于把当前解释关联到相关证据。

```ts
type EvidenceHint = AutopilotExplanation & {
  type: "evidence_hint";
  hintId: string;
  evidenceType:
    | "runtime_event"
    | "replay_timeline"
    | "audit_entry"
    | "artifact"
    | "log_summary"
    | "decision_record"
    | "review_result"
    | "lineage_ref";
  evidenceTitle: string;
  evidenceSummary: string;
  evidenceRef: EvidenceRef;
  freshness: "live" | "recent" | "snapshot" | "stale" | "unknown";
  availability: "verified" | "partial" | "unverified" | "unknown";
};

type EvidenceRef = {
  refType:
    | "runtime_event"
    | "replay"
    | "audit"
    | "artifact"
    | "log"
    | "decision"
    | "review"
    | "lineage";
  refId: string;
  relation?: "supports" | "explains" | "contradicts" | "supersedes" | "context";
};
```

设计要点：

- 证据提示只展示最相关证据，不替代完整证据库；
- 证据不足时应明确提示；
- 对外展示应避免把审计摘要伪装成完整事实。

与当前主仓兼容的最小映射：

- 第一阶段最小输入来自 `evidence.trustLevel / gaps / timeline / correlation` 与 `explanation.evidenceHints`；
- 第二阶段 projection 可以把 `trustLevel + gaps + timeline item + correlation refs` 汇总为 `EvidenceHint[]`，同时继续保留 `evidenceHints: string[]` 供现有任务详情页兼容展示；
- `EvidenceRef.refId` 优先复用现有 `runtimeEventIds / decisionIds / auditEventIds / lineageIds / timelineId`，避免引入无法跳转的新引用源。

### 10. RuntimeSignalSummary

`RuntimeSignalSummary` 用于归一化实时状态信号。

```ts
type RuntimeSignalSummary = {
  signalId: string;
  signalType:
    | "drive_state.changed"
    | "route.recommended"
    | "route.selected"
    | "route.replanned"
    | "step.progressed"
    | "risk.changed"
    | "confidence.changed"
    | "evidence.updated"
    | "takeover.requested"
    | "takeover.resolved"
    | "runtime.health_changed";
  relatedRefs: ExplanationRelatedRefs;
  payload: Record<string, unknown>;
  source: ExplanationSource;
  occurredAt: string;
};
```

设计要点：

- `signalType` 是任务自动驾驶解释层的高层信号；
- 它可以由现有 runtime event、projection 或组合推断得到；
- 不要求第一阶段全部变成底层原生事件。

### 11. 实时状态信号目录（与当前主仓兼容版）

| 高层信号 | 当前主仓最小事实来源 | 当前稳定承载字段 | 第二/三阶段增强方向 |
| ---- | ---- | ---- | ---- |
| `drive_state.changed` | mission status、stage、decision、operatorState | `explanation.currentState.driveState`、`telemetrySignals[]` | 服务端按状态 diff 生成结构化 signal record |
| `route.recommended` | Route Planner 输出、route evidence | `route.evidence.events[eventType=route.recommended]`、`recommendationDetails[kind=route]` | 保持沿用，不另造并行事件 |
| `route.selected` | route selection / decision / route evidence | `route.selection`、`route.evidence.events[eventType=route.selected]` | 为 replay / audit 增加统一 refs |
| `route.replanned` | route selection.status = replanned、route.replan、route evidence | `route.replan`、`route.evidence.events[eventType=route.replanned]`、`recommendationDetails[kind=replan]` | 增加 before/after route refs 与原因快照 |
| `step.progressed` | mission stages、route stages、edge transition | `remainingSteps`、`route.currentStage*`、`telemetrySignals[]` | 服务端输出结构化步骤推进信号 |
| `risk.changed` | risk points、recovery、takeover、operator escalation | `riskSummary[]`、`recovery`、`takeover.reason` | 结构化 `RiskExplanation[]` + signal diff |
| `confidence.changed` | destination confidence、drive state confidence | `destination.confidence`、`driveState.confidence` | 结构化 `ConfidenceExplanation` + thresholdAction |
| `evidence.updated` | evidence timeline、trustLevel、gaps、correlation | `evidence.timeline`、`evidence.trustLevel`、`evidence.gaps`、`evidenceHints[]` | 结构化 `EvidenceHint[]` + freshness/availability |
| `takeover.requested` | waiting mission、mission decision、takeover summary | `takeover`、`decisionId`、`currentState.driveState=takeover-required` | 为 replay / audit 增加 takeover refs 与原因快照 |
| `takeover.resolved` | human decision submit、waiting resolution、decision history | `decisionHistory`、`operatorActions`、resolved waiting state | 服务端生成 resolution signal 并关联 decisionId |
| `runtime.health_changed` | monitoring projection、runtime channel state、recovery state | `runtimeChannels`、`recovery.state`、`telemetrySignals[]` | 输出 bridge-derived health signal record |

收口原则：

- 第一阶段允许 `telemetrySignals: string[]` 与 `route.evidence.events` 并存；
- 第二/三阶段应把字符串摘要逐步提升为 `RuntimeSignalSummary[]`，但仍保留旧摘要字段兼容当前 task detail consumer；
- 除 `route.recommended / route.selected / route.replanned` 外，其余高层信号优先走 projection-diff 或 bridge-derived 路径，不要求直接改写底层 Web-AIGC event catalog。

## 遥测信号映射设计

### 与现有 runtime events 的关系

现有 Web-AIGC 可观测事件目录已经覆盖多个关键事件，例如：

- `node.started`
- `node.completed`
- `node.failed`
- `node.waiting_input`
- `edge.transitioned`
- `human.decision_submitted`
- `human.approved`
- `human.rejected`
- `instance.terminated`
- `instance.retry_requested`
- `instance.escalated`

自动驾驶遥测信号不应替代这些底层事件，而应在其上形成解释投影。

示意映射：

| 底层事件或事实 | 自动驾驶遥测信号 | 说明 |
| ---- | ---- | ---- |
| `node.started` / `node.completed` | `step.progressed` | 节点进展投影为步骤进展 |
| `node.waiting_input` | `takeover.requested` 或 `drive_state.changed` | 等待输入可能进入澄清或接管 |
| `node.failed` | `risk.changed` 或 `drive_state.changed` | 失败可能提升风险或进入阻塞 |
| `edge.transitioned` | `step.progressed` | 边跳转投影为路线推进 |
| `instance.retry_requested` | `risk.changed` | 重试可提升风险，但不等同 Replan |
| `instance.escalated` | `takeover.requested` | 升级投影为接管请求 |
| `human.decision_submitted` | `takeover.resolved` | 人工决策完成 |
| Route Planner 输出 | `route.recommended` | 路线推荐生成 |
| 用户路线确认 | `route.selected` | 当前路线锁定或切换 |
| Replan 触发 | `route.replanned` | 高层路线变化 |

### 与 replay 的关系

replay 负责复原时间线。

可解释性层需要 replay 支持：

- 展示 Drive State 变化；
- 展示路线推荐与选择；
- 展示风险与置信度变化；
- 展示接管请求与用户选择；
- 展示关键证据提示；
- 展示 Replan 前后的剩余步骤变化。

早期可以通过 runtime event 与 projection 重建解释；后续应逐步将关键解释对象写入可回放时间线。

### 与 audit 的关系

audit 负责治理与关键决策证据。

必须进入或关联 audit 的解释包括：

- 高风险推荐；
- 权限、预算、合规、外部副作用相关接管；
- 用户接受风险；
- 用户拒绝推荐路线；
- 系统自动降级或重规划；
- 结果质量不达标后的恢复策略。

普通低风险状态解释可以不全部写入 audit，但必须能关联 replay 或 runtime evidence。

### 高风险解释进入 audit 的规则矩阵

以下规则用于把“高风险解释必须进入 audit”进一步收口为可核对口径。这里的“进入 audit”允许两种方式：

- `direct_audit_record`：解释本身或其治理快照直接形成 audit 记录；
- `audit_link_required`：解释不单独落审计实体，但必须稳定关联到已有 audit entry，并能反查 explainability 来源与相关 refs。

| 高风险解释类型 | 典型触发器 | 最低 audit 落点 | 最小必备字段 | 备注 |
| ---- | ---- | ---- | ---- | ---- |
| 权限解释 | 文件/网络/API/浏览器/高权限工具放行；`approval_required -> human.approved`；权限拒绝或升级 | `direct_audit_record` | `explanationId`、`explanationType=permission`、`sourceType`、`missionId/workflowId`、`decisionId?`、`requestedScope`、`selectedAction`、`riskLevel`、`evidenceRefs`、`recordedAt` | 若解释只由 projection 拼装，仍必须绑定到已有 approval / permission audit entry |
| 预算解释 | 预算上调、超预算继续、切换高成本路线、批准外部高成本执行器 | `direct_audit_record` | `explanationId`、`explanationType=budget`、`recommendedRouteId?`、`selectedRouteId?`、`approvedCap`、`thresholdAction`、`decisionId?`、`evidenceRefs`、`triggerReason`、`recordedAt` | 至少保留阈值动作和与路线选择的关系 |
| 合规解释 | 合规规则命中、需要人工合规确认、合规失败后降级或终止 | `direct_audit_record` | `explanationId`、`explanationType=compliance`、`sourceType`、`mission/workflow refs`、`policyKey?`、`decisionId?`、`selectedAction`、`riskLevel`、`evidenceRefs`、`recordedAt` | 可由现有治理 audit 承接，但 explainability refs 不得丢失 |
| 外部副作用解释 | 会写外部系统、发送消息、修改外部数据、触发不可逆动作 | `direct_audit_record` | `explanationId`、`explanationType=side_effect`、`sourceType`、`mission/workflow refs`、`route refs?`、`decisionId?`、`sideEffectScope`、`selectedAction`、`evidenceRefs`、`recordedAt` | 重点记录影响范围与是否由用户确认 |
| 风险接受解释 | 用户接受高风险、继续执行高不确定方案、显式忽略证据缺口 | `direct_audit_record` | `explanationId`、`explanationType=risk_acceptance`、`riskType`、`riskLevel`、`decisionId`、`comment?`、`thresholdAction`、`evidenceRefs`、`recordedAt` | comment/reason 若存在必须进入 audit metadata |
| 路线切换解释 | 用户拒绝推荐路线、切到替代路线、路线锁定发生高风险变化 | `audit_link_required` | `explanationId`、`explanationType=route_selection`、`recommendedRouteId`、`selectedRouteId`、`decisionId`、`triggerReason`、`evidenceRefs`、`recordedAt` | 当前主仓更接近这一路径：通过 decision history + auditEventIds/correlation 关联，而不是直接 route audit 实体 |
| 重规划解释 | 系统自动重规划、人工触发重规划、重规划导致风险/治理策略变化 | `direct_audit_record` | `explanationId`、`explanationType=replan`、`sourceType`、`previousRouteId?`、`selectedRouteId?`、`decisionId?`、`triggerReason`、`thresholdAction`、`evidenceRefs`、`recordedAt` | 若当前阶段无独立 explainability audit，也至少要关联 runtime / route 相关 audit entry |

规则收口：

- 任何高风险解释进入 audit 时都必须至少能反查 `missionId / workflowId / replayId? / decisionId? / routeId?` 这一组最小 refs。
- `selectedAction / thresholdAction / triggerReason / evidenceRefs` 是治理可解释性的最小闭环字段，缺一不可。
- 若解释由 `combined_inference` 生成，audit 中必须同时保留 `sourceType` 与 `inferenceNote` 或等价来源说明，避免把推断解释包装成原生事实。
- 当前主仓已经存在的直接代码证据更偏向 `audit_link_required` 所需锚点：
  - `evidence.correlation.auditEventIds`
  - `human.decision_submitted` / runtime control event mirrored into audit
  - mission projection 继续透传这些 audit refs
- 因此本规则矩阵属于设计收口，不外推为每一类高风险解释都已在主仓形成独立审计记录 UI。

### 与 monitoring 的关系

monitoring 可以继续作为兼容读取与健康投影入口。

自动驾驶可解释性层可消费 monitoring projection 中的：

- mission 状态；
- workflow 状态；
- session 状态；
- runtime 健康摘要；
- 最近错误或等待信号。

但 monitoring 不应被描述为独立的自动驾驶事实源。

### 与 lineage 的关系

lineage 可用于增强证据提示与跨对象关联。

准确口径：

- 可以通过 `lineageId` 或 relation index 关联部分证据；
- 可以把 artifact、audit entry、runtime event 与解释对象建立线索；
- 不应声称所有 runtime event 已统一直写 lineage；
- 不应把 lineage 当成当前唯一或完整事实源。

## 解释生成流程

### 1. 收集事实

从以下来源读取事实：

- mission；
- workflow instance；
- node run；
- runtime event；
- route planner；
- drive state projection；
- takeover / decision；
- review / audit；
- replay / artifact / log。

### 2. 归一信号

将事实归一为高层遥测信号，例如：

- 当前 Drive State 是否变化；
- 当前步骤是否推进；
- 是否出现等待输入；
- 风险是否升高；
- 置信度是否下降；
- 是否出现新证据；
- 是否触发接管或重规划。

### 3. 生成解释对象

根据不同信号生成解释对象：

- 状态变化生成 `CurrentStateExplanation`；
- 路线推荐生成 `RecommendationReason`；
- 路线或步骤变化生成 `RemainingStepsExplanation`；
- 风险变化生成 `RiskExplanation`；
- 置信度变化生成 `ConfidenceExplanation`；
- 证据变化生成 `EvidenceHint`。

### 4. 分发消费

解释对象可被以下界面消费：

- 驾驶舱当前状态区；
- 路线推荐卡；
- 剩余步骤区域；
- 风险与置信度提示；
- 接管面板；
- replay 时间线；
- audit 查询结果；
- evidence dock。

### 5. 失效与更新

当发生以下情况时，旧解释必须被更新或标记为失效：

- Drive State 变化；
- Route 被重新选择；
- Replan 发生；
- 用户完成接管；
- 风险被缓解；
- 证据被补齐；
- 任务完成或终止。

## 与任务自动驾驶对象的映射

| 自动驾驶对象 | 可解释性对象 | 遥测信号 | 说明 |
| ---- | ---- | ---- | ---- |
| `Destination` | 目标理解置信度、目标歧义风险 | `confidence.changed` / `risk.changed` | 解释目标是否明确 |
| `Route` | 推荐原因、剩余步骤 | `route.recommended` / `route.selected` | 解释为什么这样走 |
| `Drive State` | 当前状态解释 | `drive_state.changed` | 解释现在在哪里 |
| `Fleet` | 当前执行角色解释 | `step.progressed` | 解释谁在做什么 |
| `Takeover Point` | 接管原因、风险提示、默认动作解释 | `takeover.requested` / `takeover.resolved` | 解释为什么交还方向盘 |
| `Replan` | 重规划原因、剩余步骤变化 | `route.replanned` | 解释为什么换路 |
| `Confidence` | 置信度解释 | `confidence.changed` | 解释把握程度 |
| `Risk` | 风险解释 | `risk.changed` | 解释风险与缓解动作 |
| Evidence | 证据提示 | `evidence.updated` | 解释依据在哪里 |

## 兼容策略

### 策略 1：优先投影，不重写事实源

首阶段应优先在 view model 或 projection 层构建解释，不要求改造所有 runtime event。

### 策略 2：关键解释逐步服务端化

会影响用户决策、风险接受、权限审批、预算确认、路线切换的解释，应优先沉淀到服务端 projection、replay 或 audit。

### 策略 3：低风险解释允许轻量推导

普通状态摘要、轻量剩余步骤说明，可以先由前端组合信号生成，但需要保留来源标记。

### 策略 4：事件命名保持兼容

新增高层信号不应和现有 runtime events 抢命名空间。
底层仍使用已有 Web-AIGC observability event catalog，高层使用自动驾驶解释信号进行投影。

### 策略 5：证据不足必须显式表达

如果某个解释没有足够证据，应显示“证据不足”或“基于当前信号推断”，而不是伪装为确定事实。

## 风险与边界

### 风险 1：解释层变成纯文案层

如果解释无法追溯到 runtime、route、audit 或 replay，用户看到的只是包装文案。
因此每个关键解释必须带 `source` 和 `evidenceRefs`。

### 风险 2：过早承诺统一 telemetry backend

当前主仓更准确的状态是最小 observability / replay / audit 闭环，而不是完整统一 telemetry 平台。
因此本 spec 只能定义高层信号语义和映射方式，不宣称底层总线已经完成。

### 风险 3：置信度伪精确

如果把置信度简单写成百分比，会造成虚假的确定性。
因此首阶段建议使用 `low / medium / high / unknown` 等级和解释文本。

### 风险 4：证据提示夸大 lineage 能力

当前 lineage 更适合作为关联线索和增强方向。
解释层可以使用 lineage 关联，但不能声称所有 runtime evidence 已全量进入 lineage。

### 风险 5：实时解释无法回放

如果解释只存在于前端内存，任务完成后无法复盘。
因此关键解释需要进入 replay 或 audit，至少要能由 runtime events 重建。

## 分阶段落地建议

### 第一阶段：文档与对象口径

- 固化解释对象类型；
- 固化高层遥测信号目录；
- 明确与 runtime events / replay / audit 的关系；
- 明确不替代现有观测系统。

### 第二阶段：前端 view model

- 在驾驶舱或任务详情页生成当前状态解释；
- 展示推荐原因、剩余步骤、风险、置信度和证据提示；
- 标注解释来源。

### 第三阶段：服务端 projection

- 服务端生成可复用解释对象；
- 将关键解释与 mission / workflow / runtime event 关联；
- 为 replay / audit 提供稳定查询入口。

第二阶段服务端 projection 接入方案（与当前 shared/server/client 链路兼容）：

1. 延续当前 `MissionAutopilotSummary.explanation` 作为唯一 explainability 入口，不新增平行顶层字段。
2. 继续保留当前已稳定消费的最小字段：
   - `current`
   - `nextSteps`
   - `recommendationReasons`
   - `currentState`
   - `recommendationDetails`
   - `remainingSteps`
   - `riskSummary`
   - `evidenceHints`
   - `telemetrySignals`
3. 在不破坏现有 task detail consumer 的前提下，追加结构化扩展槽位：

```ts
type MissionAutopilotExplanationSummaryV2 = {
  current: string;
  nextSteps: string[];
  recommendationReasons: string[];
  currentState?: MissionAutopilotCurrentStateExplanation;
  recommendationDetails?: MissionAutopilotRecommendationReason[];
  remainingSteps?: MissionAutopilotRemainingStepsExplanation;
  riskSummary: string[];
  evidenceHints: string[];
  telemetrySignals: string[];
  risks?: RiskExplanation[];
  confidence?: ConfidenceExplanation;
  evidenceDetails?: EvidenceHint[];
  relatedRefs?: ExplanationRelatedRefs;
  signals?: RuntimeSignalSummary[];
};
```

4. `server/tasks/mission-projection.ts` 的第二阶段职责：
   - 继续校准 `selectedRouteId / routeSelectionStatus / correlationTimelineId`
   - 把 `resolved links + evidence.correlation + route/recovery/takeover` 汇总为统一 `relatedRefs`
   - 为 `risks / confidence / evidenceDetails / signals` 提供可选字段，不强制现有 consumer 立即全量消费
5. consumer 复用顺序：
   - 任务详情页 `TaskAutopilotPanel`
   - 驾驶舱主视图
   - 接管 explainability surface
   - replay 解释时间线
   - audit explainability 查询
6. 边界控制：
   - 第二阶段仅要求“服务端统一生成与透传”，不要求每个 consumer 都在同一轮完成 UI；
   - 未接线的 consumer 必须允许继续读取旧摘要字段，不得因结构化扩展导致回归。

### 第四阶段：事件与证据增强

- 将高风险解释、接管解释、路线变化解释写入 replay / audit；
- 补充关键高层信号到 runtime event bridge 或 projection；
- 增强 evidence hint 与 artifact / audit / replay 的跳转关系。

第三阶段 runtime events 增强方案：

1. 保持底层 Web-AIGC observability event catalog 不改名、不抢命名空间。
2. 通过两条路径补齐 explainability 高层信号：
   - `projection-diff path`
     - 对 `driveState / route selection / replan / risk summary / confidence / evidence trust` 做服务端 diff
     - 产出 `RuntimeSignalSummary[]`
   - `bridge-derived path`
     - 复用已有 runtime observability bridge、route evidence、decision history、operator action、monitoring projection
     - 推导 `takeover.requested / takeover.resolved / runtime.health_changed`
3. 必须优先补齐的高层信号：
   - `drive_state.changed`
   - `step.progressed`
   - `risk.changed`
   - `confidence.changed`
   - `evidence.updated`
   - `takeover.requested`
   - `takeover.resolved`
4. 当前已稳定存在、应直接复用而非重造的信号证据：
   - `route.recommended`
   - `route.selected`
   - `route.replanned`
5. 事件记录要求：
   - 每条高层信号必须带 `relatedRefs`
   - 能关联 `timelineId / routeId / selectedRouteId / decisionId / runtimeEventIds`
   - 能标记 `sourceType` 与 `currentContractValue`

第四阶段 replay / audit 闭环方案：

1. replay 闭环目标
   - 能按时间顺序复原 `currentState -> recommendation -> remainingSteps -> risk/confidence -> takeover -> replan -> evidence update`
   - 能展示“当时依据是什么”和“后续为什么失效/被 superseded”
2. replay 最小落点
   - 复用现有 `evidence.timeline`
   - 对关键 explainability 追加 `explanationId / signalId / relatedRefs`
   - 对 `route.replanned / takeover.requested / takeover.resolved / risk.changed / confidence.changed / evidence.updated` 提供可回放切片
3. audit 闭环目标
   - 对高风险解释、接管解释、用户拒绝推荐路线、用户接受风险、系统自动降级/重规划保留治理证据
   - 查询时能从 audit entry 反查 explainability source 与 related refs
4. audit 最小落点
   - 预算、权限、合规、外部副作用、风险接受、重规划原因进入 audit
   - 记录 `recommendedRouteId / selectedRouteId / decisionId / riskType / thresholdAction / evidenceRef`
5. 失效规则
   - 当 route 变化、takeover resolved、risk 缓解、evidence 补齐时，旧 explainability 记录应标记 `superseded` 或 `resolved`
   - replay 必须能看到前后两个版本，而 audit 至少保留关键版本与触发原因

### replay 解释时间线复原矩阵

为避免“已有 timeline 片段”被误写成“解释时间线已经可完整复原”，replay 侧需要按下表定义最小复原槽位：

| 时间线槽位 | 复原内容 | 最小来源 | 最小字段 | 排序锚点 | 缺失回退 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `current_state` | 当时 Drive State、当前动作、whyNow、nextExpectedAction | `explanation.currentState` + runtime/projection | `explanationId?`、`driveState`、`currentStageTitle`、`currentActionText`、`updatedAt` | `updatedAt` 或对应 runtime event time | 若无结构化对象，允许用 `telemetrySignals + mission status/stage` 重建，并标注 `combined_inference` |
| `recommendation` | 当时推荐路线/动作及原因 | `recommendationDetails` + route evidence | `recommendedTargetId`、`targetKind`、`routeSelectionStatus?`、`summary`、`sourceType`、`correlationTimelineId?` | 推荐产生时间；若无则用 route evidence event time | 若无结构化 detail，允许回退到 `recommendationReasons[]` 摘要 |
| `remaining_steps` | 当时剩余步骤、当前步骤、并行支路、replan 变更说明 | `remainingSteps` + route/workflow projection | `selectedRouteId?`、`currentStepLabel`、`pendingSteps[]`、`parallelBranchCount?`、`replanChangeSummary?` | `updatedAt` 或 route/currentStep 变化时间 | 若无结构化对象，允许用 route stage/projection snapshot 重建 |
| `risk` | 当时风险提示、触发原因、建议动作 | `RiskExplanation[]` 或 `riskSummary[]` + recovery/takeover | `riskType?`、`severity?`、`summary`、`trigger?`、`thresholdAction?`、`evidenceRefs?` | 风险变化时间或 recovery/takeover 事件时间 | 当前阶段允许用 `riskSummary[] + recovery.state/deviationCategory + takeover.reason` 回退 |
| `confidence` | 当时置信度变化与原因 | `ConfidenceExplanation` 或 `destination.confidence / driveState.confidence` | `overall?`、`dimensions?`、`changedReason?`、`thresholdAction?`、`updatedAt` | 置信度更新时刻 | 当前阶段允许用 `destination.confidence / driveState.confidence` 摘要回退 |
| `takeover` | 当时接管提示、接管原因、用户选择、是否 resolved | `takeover` + `decisionHistory` + runtime/audit hooks | `decisionId`、`takeoverType`、`promptSnapshot`、`optionsSnapshot`、`resolvedSnapshot?`、`status` | waiting / decision submit 时间 | 若缺 explainability 对象，允许回退到 `DecisionHistory + evidence.timeline(type=takeover)` |
| `evidence_update` | 当时可见证据提示、trust/gaps、关键 evidence refs | `evidence.timeline / trustLevel / gaps / evidenceHints` | `timelineId`、`trustLevel`、`gaps[]`、`evidenceHints[]`、`auditEventIds?`、`runtimeEventIds?` | evidence timeline item time | 若无结构化 `EvidenceHint[]`，允许保留当前字符串提示与 correlation refs |
| `replan_change` | 当时为什么重规划、前后路线与步骤如何变化 | `route.replan` + `recommendationDetails[kind=replan]` + route evidence | `previousRouteId?`、`selectedRouteId?`、`replanReason`、`replanChangeSummary`、`sourceType` | `route.replanned` 事件时间 | 若无显式 replan detail，允许用 route evidence + remainingSteps diff 重建 |

时间线排序与版本规则：

1. 主排序键为原始事实时间：
   - 优先使用 runtime / replay / decision / operator action 的原始时间戳；
   - 其次使用 explanation 对象的 `updatedAt`；
   - 最后才允许使用 projection snapshot 时间。
2. 同一时刻多个槽位的展示顺序固定为：
   - `current_state`
   - `recommendation`
   - `remaining_steps`
   - `risk`
   - `confidence`
   - `takeover`
   - `evidence_update`
   - `replan_change`
3. 版本失效规则：
   - route 变化、takeover resolved、risk 缓解、evidence 补齐后，旧解释标记为 `superseded` 或 `resolved`；
   - replay 必须保留新旧两个版本，不能只显示最新快照覆盖历史。
4. 缺失处理规则：
   - 若缺少原生 explainability 事件，可使用 `projection snapshot + correlation refs + runtime timeline` 重建；
   - 但必须显式标记来源为 `mission_projection / workflow_projection / combined_inference`，不能伪装为原生 runtime 记录。
5. 对用户决策有影响的槽位至少必须保留一条可回放记录：
   - `recommendation`
   - `risk`
   - `confidence`
   - `takeover`
   - `replan_change`

与当前主仓的最小兼容边界：

- 已有直接代码/测试支撑的基础锚点包括：
  - `shared/mission/autopilot.ts` 的 `evidence.timeline`
  - `explanation.currentState / recommendationDetails / remainingSteps`
  - `evidence.correlation.timelineId / auditEventIds`
  - runtime observability bridge mirrored into replay / audit
- 当前主仓尚未形成独立的 explainability replay consumer，因此本矩阵是 replay 复原规则设计，而不是现状实现声明。

### 第五阶段：回放与审计闭环

- 在 replay 中复原解释时间线；
- 在 audit 中查询关键解释与人工决策；
- 支持对“为什么这么做”进行事后追踪。

## 测试计划

### 1. shared builder 层

- `AutopilotExplanation` 基础对象兼容性：
  - 结构化对象扩展不破坏现有 `MissionAutopilotExplanationSummary`
- `CurrentStateExplanation`：
  - planning / waiting / blocked / replanning / delivered 场景
- `RecommendationReason`：
  - route / action / takeover / replan 四类 recommendation
- `RemainingStepsExplanation`：
  - 主线、并行分支、replan change summary
- `RiskExplanation`：
  - route risk / recovery risk / takeover risk 的结构化上卷
- `ConfidenceExplanation`：
  - destination confidence + driveState confidence -> overall/dimensions
- `EvidenceHint`：
  - trustLevel / gaps / timeline / correlation -> evidence hint
- `RuntimeSignalSummary`：
  - projection-diff 与 bridge-derived 两条路径生成
- `ExplanationSource / ExplanationRelatedRefs`：
  - 现有窄枚举映射到目标 source/ref 合同不丢失关键信息

### 2. server projection 层

- `server/tasks/mission-projection.ts`
  - explainability 扩展字段透传
  - resolved links 与 `evidence.correlation` 汇总为 `relatedRefs`
  - route selection/current step/correlationTimelineId 对齐
- `mission-routes`
  - queued / waiting / replanning / resolved links / recovery-contract 场景

### 3. client normalize 层

- `tasks-store`
  - 结构化 `currentState / recommendationDetails / remainingSteps`
  - 可选结构化 `risks / confidence / evidenceDetails / signals / relatedRefs`
  - 老字段 fallback 与新字段并存

### 4. consumer 层

- `TaskAutopilotPanel`
  - explanation 结构化详情
  - risk/confidence/evidence/signal 最小展示
- cockpit consumer
  - 消费同一份 projection，不再复制推导逻辑
- takeover consumer
  - consume explanation source/risk/evidence refs，而不是只读 decision payload

### 5. replay / audit 层

- replay
  - explainability timeline reconstruct
  - superseded / resolved 状态切换
- audit
  - 高风险/重规划/接管 explainability 可查询
  - decision / route / evidence refs 可反查

## 设计结论

本 spec 的结论是：

1. 可解释性与遥测层是任务自动驾驶的信任投影层。
2. 它覆盖当前状态解释、推荐原因、剩余步骤、风险提示、置信度、证据提示与实时状态信号。
3. 它必须建立在现有 mission / workflow / runtime events / replay / audit / observability 之上。
4. 它不替代现有 runtime，也不新建独立 telemetry backend。
5. 它必须支持分阶段落地，先做稳定解释口径，再逐步服务端化和证据化。

## 审计补注（2026-04-24）

- 当前主仓已经存在可直接复用的 explainability 事实来源：mission record 与 stages、workflow runtime `status/current_stage`、mission `events` / `operatorActions` / `decisionHistory`、projection links、monitoring projection，以及 Web-AIGC runtime observability bridge 写入的 replay / audit 事实。
- `shared/mission/autopilot.ts` 已把其中一部分事实汇总为 `currentState`、`recommendationDetails`、`remainingSteps`、`riskSummary`、`evidenceHints`、`telemetrySignals`，`shared/__tests__/mission-autopilot.test.ts` 直接校验了这些结构在 queued / waiting / replanning / blocked-retry 场景下的 builder 输出；`server/tasks/mission-projection.ts` 再将 mission 与 workflow runtime 一并透传到 `autopilotSummary`。
- `server/tests/mission-routes.test.ts` 已验证 mission projection 对 queued / waiting / replanning 场景的 explainability 输出；`server/tests/aigc-monitoring-routes.test.ts` 已验证 monitoring 视图继续消费 workflow/mission/projection 事实；`server/tests/web-aigc-runtime-observability.test.ts` 已验证 runtime 事件会镜像到 replay / audit；`server/tests/workflow-runtime-engine.test.ts -t "human review checkpoint"` 已验证 review checkpoint 事实真实存在。
- `client/src/lib/tasks-store.ts` 当前对 explanation 的归一化仍主要保留 `current / nextSteps / recommendationReasons / riskSummary / evidenceHints / telemetrySignals` 这组扁平摘要字段，`client/src/lib/tasks-store.autopilot.test.ts` 也主要验证这些字段的 fallback / normalize；其中 `riskSummary / evidenceHints / telemetrySignals` 仍以字符串摘要形式向下流动，并未沉淀成结构化 `RiskExplanation`、`EvidenceHint` 或统一 telemetry signal view model。
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 虽已在 `client/src/components/tasks/TaskDetailView.tsx` 中落地消费 `detail.autopilotSummary`，并通过 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 验证 alias fields、nested shared fields、normalized autopilot summary fields 与任务详情页接入，但 explanation block 现阶段仍以这组扁平字段为主；`TaskDetailView` 只是接线该 panel，并没有第二个独立的结构化 explainability consumer，因此不能把现状描述成“structured explainability client consumption 已完成”。
- 同时，`TaskAutopilotPanel` 当前已经在任务详情页展示当前状态、route/live execution 剩余步骤线索、风险、置信度、证据提示与 explanation 摘要，`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 对这些展示以及 `TaskDetailView` 接线都有直接断言；因此“第一阶段前端接入方案”可以保守视为已在任务详情页形成最小闭环。
- 同时，`shared/mission/autopilot.ts` 已把 `MissionAutopilotExplanationSource`、`MissionAutopilotCurrentStateExplanation`、`MissionAutopilotRecommendationReason`、`MissionAutopilotRemainingStepsExplanation` 明确写成 shared 类型，`shared/mission/api.ts` 也继续向客户端暴露这些 explainability 类型；配合 `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts`，可以确认“结构化 explainability builder -> mission projection 契约”这条 shared/server 链路已经成立。
- 但这里仍需严格区分“projection 契约已存在”和“第二阶段服务端 projection 接入方案已完成”：
  - 当前稳定落地的是 mission projection 输出 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals`；
  - 尚未稳定落地的是这些关键解释对象被驾驶舱、接管面板、replay、audit 以统一结构复用的消费闭环；
  - `client/src/lib/tasks-store.ts` 虽直接复用 shared `MissionAutopilotSummary["explanation"]` 类型，但 normalize 与 UI 消费仍聚焦扁平摘要字段，没有把结构化 explanation 对象完整下推为前端 explainability view model。
- 因此，当前更准确的口径是：shared/server 已经形成结构化 explainability builder 与 mission projection 契约，client 已形成最小摘要消费与任务详情页接线；这足以支撑“分层评估”和“第一阶段前端接入方案”相关任务，但还不足以宣称 explainability 前端展示层已经完整消费了全部结构化对象，也不足以把“第二阶段服务端 projection 接入方案”整体视为完成。
- 基于以上代码与测试，当前可以保守认定“事实来源梳理”“当前状态解释对象”“推荐原因对象”“剩余步骤解释对象”“高层遥测信号映射表”“前端 view model 与服务端 projection 分层评估”“兼容边界”“第一阶段前端接入方案”八类文档任务已有足够依据；但结构化 `RiskExplanation`、`ConfidenceExplanation`、`EvidenceHint`、关键 explainability 对象的统一 projection 消费模型，以及 explainability 对 replay / audit 的直接复用契约仍需后续代码化，因此本轮不再新增其他勾选。

## 审计补注（2026-04-24，Lane 5 explainability 复核）

- 本轮复核补充确认：`client/src/lib/tasks-store.ts` 已不只是保留 explainability 的扁平别名字段，而是会稳定 normalize `currentState / recommendationDetails / remainingSteps`，并保留 `evidence.correlation` 这一组结构化字段；`client/src/lib/tasks-store.autopilot.test.ts` 已直接断言这些结构在 projection alias / fallback 场景下的输出。
- `TaskAutopilotPanel` 当前也不只是展示 `current / nextSteps / recommendationReasons` 这组旧摘要，而是会把 `currentState.summary / sources / updatedAt`、`recommendationDetails`、`remainingSteps.currentStepLabel / pendingSteps / parallelBranchCount / replanChangeSummary` 渲染成任务详情页里的 explainability 详情段；对应面板测试已经覆盖这一点。
- 本轮进一步补充确认：`recommendationDetails.routeSelectionStatus / correlationTimelineId` 也已经进入 client 最小消费闭环。
  - `client/src/lib/tasks-store.ts` 会保留这两个 recommendation 级结构字段；
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 会把它们作为 recommendation detail 的元信息展示；
  - 对应 store / panel 测试已直接断言这两个字段的 normalize 与渲染。
- 因此，explainability 的前端现状更准确地说是“结构化 explainability 摘要已经进入任务详情页消费”，而不是“client 仍完全停留在扁平字段阶段”。
- 但本 spec 需要的完成口径仍然更高：当前 client 侧还没有结构化 `RiskExplanation / ConfidenceExplanation / EvidenceHint`，也没有把 explainability 统一复用到驾驶舱、接管面板、replay 与 audit。也就是说，现状足以支撑 `8 / 23` 的保守结论，却仍不足以支撑继续新增勾选。

## 审计补注（2026-04-25，Lane 4 explainability 复核）

- 本轮只新增确认一条 explainability 最小闭环：证据不足时已经有统一的“未验证 / 缺口 / 提示”展示口径，不再把缺少事实支撑的解释包装成确定事实。
- 直接依据如下：
  - `shared/mission/autopilot.ts` 已把证据充分度编码为 `evidence.trustLevel`，把缺失事实编码为 `evidence.gaps`，并把同一组提示透出为 `explanation.evidenceHints`
  - `shared/__tests__/mission-autopilot.test.ts` 已覆盖 `partial / unverified` 场景下的 `trustLevel`、`gaps` 与 `evidenceHints`
  - `server/tests/mission-routes.test.ts` 已验证这些字段会经由 mission projection 暴露到 `autopilotSummary`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已验证任务详情页会显式显示 `Trust: Unverified` 和缺口文案
- 这里仍必须与完整 `EvidenceHint` 对象体系区分开：
  - 当前实现是“evidence trust / gaps / hint strings”的最小规则闭环；
  - 还不是结构化 `EvidenceHint` 引用模型；
  - 也还不是 replay / audit explainability 统一回放闭环。

## 审计补注（2026-04-25，Lane 5 explainability 复核补充）

- 本轮补充确认：设计文档中“解释对象与 `Destination`、`Route`、`Drive State`、`Fleet`、`Takeover Point`、`Replan`、`Confidence`、`Risk`、Evidence 的映射关系”已经不只停留在文档表格，而是有 shared builder、server projection、client normalize 与 task detail panel 测试的直接支撑。
- 代码锚点如下：
  - `shared/mission/autopilot.ts` 的 `MissionAutopilotSummary` 已把 `destination / route / driveState / fleet / takeover / evidence / explanation` 放进同一份 summary，对应映射不是分散文案，而是明确对象字段：
    - `destination.confidence / missingInfo / missingInfoDetails` 承接目标理解与缺口；
    - `route.selection / route.replan / route.evidence` 承接路线选择、重规划与路线证据；
    - `driveState.state/detail` 承接当前状态；
    - `fleet.roles` 承接执行角色与当前焦点；
    - `takeover.type / decisionId / reason` 承接接管点；
    - `explanation.currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints` 把上述对象翻译成 explainability 摘要；
    - `evidence.correlation` 把 route / decision / operator action / runtime event 等证据线索收口到统一关联索引。
  - `buildExplanationSummary()` 还把这些映射做成了显式字段绑定，而不是靠 UI 推测：`currentState.driveState/currentStage/workflowStatus`、`recommendationDetails.routeId/actionType/takeoverType/decisionId/routeSelectionStatus`、`remainingSteps.selectedRouteId/currentStep/pendingSteps/replanChangeSummary` 都来自已有 mission/runtime/projection 事实。
- 测试锚点如下：
  - `shared/__tests__/mission-autopilot.test.ts` 已覆盖 planning、waiting、blocked/recovery 等场景，直接断言 `destination.confidence`、`route.selection/replan/evidence`、`driveState`、`fleet.roles.currentFocus`、`takeover.decisionId`、`riskSummary`、`evidence.correlation` 与 explainability 字段之间的对应关系。
  - `server/tests/mission-routes.test.ts` 已验证 mission projection 不会打散这些映射，waiting / replanning / resolved links 场景下依然能把 `destination / route / driveState / takeover / evidence / explanation` 一起稳定透出。
  - `client/src/lib/tasks-store.autopilot.test.ts` 已验证 client normalize 后仍保留这组对象映射，而不是只剩扁平字符串。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已验证任务详情页能消费并展示 `destination confidence / missing-info`、`fleet`、`structured explanation details` 与 `evidence correlation`，说明这些映射已经进入现有 consumer。
- 但这里的完成口径仍需收紧：
  - 这只证明“映射关系”已在当前 `MissionAutopilotSummary -> mission projection -> tasks-store -> TaskAutopilotPanel` 链路里落地；
  - 还不能外推为结构化 `RiskExplanation / ConfidenceExplanation / EvidenceHint` 已全部成型；
  - 也不能外推为驾驶舱、接管面板、replay、audit 已共享同一套 explainability 对象复用入口。

## 审计补注（2026-04-25，Lane 5 explainability 二次复核）

- 本轮按 lane 5 指定范围重新核对 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 后，设计侧判断维持不变：结构化 explainability 已经覆盖 `currentState / recommendationDetails / remainingSteps`，但 `confidence / risk / evidence hints` 仍主要停留在摘要层，不足以支撑更多完成态勾选。
- `explanation / recommendation / remaining steps` 的设计口径已经有直接代码锚点，不再只是文档对象草图：
  - `shared/mission/autopilot.ts` 直接定义并生成 `MissionAutopilotCurrentStateExplanation`、`MissionAutopilotRecommendationReason`、`MissionAutopilotRemainingStepsExplanation`；
  - `shared/__tests__/mission-autopilot.test.ts` 直接覆盖 planning / waiting / blocked-retry / recovery-contract 场景；
  - `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 直接确认 mission projection 透传这些字段；
  - `client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 及其测试直接消费这些结构化字段。
- `confidence` 的当前落地更准确地应描述为“目标与当前状态的置信摘要”，而不是完整 `ConfidenceExplanation`：
  - 代码侧已经有 `destination.confidence.level / reason / signals` 与 `driveState.confidence`；
  - store 与 panel 测试也直接命中了 `Confidence: Medium/High` 等展示；
  - 但设计文档里定义的多维度 `ConfidenceExplanation.dimensions`、`changedReason`、`thresholdAction` 仍未在当前实现与测试链路中落地。
- `risk` 的当前落地更准确地应描述为“路线/恢复风险摘要”，而不是完整 `RiskExplanation`：
  - 代码侧已经有 `route.riskPoints`、`explanation.riskSummary`、`recovery.state / deviationCategory` 与 `takeover.reason`；
  - shared/server/client/panel 测试也已直接命中这些风险相关字段；
  - 但 `RiskExplanation` 设计里要求的 `riskType / severity / trigger / impact / mitigation / mayTriggerTakeover / mayTriggerReplan` 仍未形成结构化对象。
- `evidence hints` 的当前落地更准确地应描述为“提示字符串 + 证据关联索引”：
  - 代码侧已经有 `explanation.evidenceHints`、`evidence.trustLevel / gaps / timeline / correlation`；
  - panel 测试已直接验证 `Trust: Unverified`、缺口文案、时间线预览以及 `workflow / replay / session / route / runtime events / decisions / operator actions / audit / lineage` 计数展示；
  - 但这仍不是设计文档中定义的结构化 `EvidenceHint` 与 `EvidenceRef` 引用模型。
- `MissionAutopilotExplanationSource` 当前只是一个较窄的实现型来源枚举，直接代码与测试只支撑 `mission-runtime / workflow-runtime / route-planner / recovery-engine / takeover-state / combined-inference`；因此本设计文档中的 `ExplanationSource` 仍应保持“目标口径”，不能被误写成“主仓已完整落地”。
- 结论上，这一轮更适合把设计文档收紧为“当前主仓已实现哪些 explainability 摘要与最小消费闭环”，而不是继续放大为“完整 explainability 对象体系已完成”。因此，本轮只追加审计补注，不推进新的完成态结论。

## 审计补注（2026-04-25，指定文件范围 explainability 复核）

- 本轮按指定文件范围重新核对 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/mission/index.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskDetailView.tsx` 与 `client/src/components/tasks/DecisionPanel.tsx` 后，设计结论继续维持在“最小 explainability 摘要闭环已成立，但跨面 explainability 复用尚未成立”。
- 这组指定文件里，最强的直接代码 + 直接测试锚点仍集中在 `MissionAutopilotSummary -> mission projection` 这一段：
  - `shared/mission/autopilot.ts` 已定义并生成 `MissionAutopilotCurrentStateExplanation`、`MissionAutopilotRecommendationReason`、`MissionAutopilotRemainingStepsExplanation`；
  - `shared/mission/api.ts` 与 `shared/mission/index.ts` 已把这些 explainability 类型继续暴露到 API / barrel 契约层；
  - `shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 已直接命中 builder 输出与 projection 透传。
- `server/tasks/mission-projection.ts` 的当前完成口径应收敛为“mission projection 已承接 explainability summary，并对 `bindings`、`workflow runtime`、`evidence.correlation` 做服务端对齐”，而不是“解释对象已经被驾驶舱、接管面板、replay、audit 统一复用”。原因是指定范围内还没有任何 replay / audit consumer 或接管 explainability consumer 的直接代码 + 直接测试锚点。
- `client/src/lib/tasks-store.ts` 的当前完成口径也需要写窄：它已经把 `currentState / recommendationDetails / remainingSteps` 与 `evidence.correlation` 归一化进 client model，但 `riskSummary / evidenceHints / telemetrySignals` 仍是摘要字符串数组；因此这里更接近“结构化 explainability 摘要 + 扁平风险/证据/信号摘要并存”，而不是完整 `RiskExplanation / ConfidenceExplanation / EvidenceHint / RuntimeSignalSummary` 客户端对象体系。
- `client/src/components/tasks/TaskDetailView.tsx` 本身只证明 explainability 入口被接线到任务详情与 cockpit 布局中：它把 `TaskAutopilotPanel` 摆进 overview / cockpit 区域，也把 `DecisionPanel` 摆进 decisions 区域；但它自身不解释 `autopilotSummary`、不组织 explainability source/ref、也不承担 replay / audit / takeover 的二次消费逻辑。因此在设计口径上，`TaskDetailView` 只能算 explainability 容器，不应被抬升为独立 explainability consumer。
- `client/src/components/tasks/DecisionPanel.tsx` 的当前角色更清楚地应定义为“人工决策录入面板”，而不是“接管 explainability 面板”：
  - 它消费的是 `MissionDecision`、`decision.options`、`decision.payload` 与 `submitMissionDecision()`；
  - 它处理的是 approval / reject / request-info / escalate / param_collection 等提交动作；
  - 它并不直接消费 `autopilotSummary.explanation`、`riskSummary`、`evidenceHints`、`telemetrySignals` 或 `evidence.correlation`。
- 因此，本设计文档在指定文件范围下需要继续坚持以下边界：
  - `ExplanationSource` 仍只是目标设计口径，现有实现只落到较窄的 `mission-runtime / workflow-runtime / route-planner / recovery-engine / takeover-state / combined-inference`；
  - `RiskExplanation`、`ConfidenceExplanation`、`EvidenceHint` 与 `ExplanationRelatedRefs` 仍未形成主仓中的结构化对象闭环；
  - “第二阶段服务端 projection 接入方案”依旧只能描述为未来目标，不能因 `mission-projection.ts` 已输出 explainability summary 就提前写成已完成；
  - `DecisionPanel` 尚不能被记为本 spec 所需的接管 explainability 复用面；
  - replay / audit explainability 时间线复原仍没有在这组指定文件里拿到直接实现与直接测试。

## 审计补注（2026-04-25，指定文件范围 explainability 三次复核）

- 本轮继续围绕 `shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 与 `client/src/components/tasks/TaskDetailView.tsx` 做只读复核后，设计侧判断仍维持不变：当前主仓已经形成“builder -> projection -> store -> task detail panel”的最小 explainability 闭环，但还没有进入“完整 explainability 对象体系 + 跨面复用闭环”阶段。
- 这条最小闭环现在可以更准确地表述为：
  - `shared/mission/autopilot.ts` 已把 explainability 固化为 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals` 与 `evidence.correlation`；
  - `server/tasks/mission-projection.ts` 已把这些字段作为 `autopilotSummary` 的一部分稳定投影，并用 resolved links 对齐 `workflowId / replayId / sessionId / instanceId`；
  - `client/src/lib/tasks-store.ts` 已把结构化 `currentState / recommendationDetails / remainingSteps` 与 `evidence.correlation` 归一化进 client model，而不再只是扁平字符串兜底；
  - `TaskAutopilotPanel.tsx` 与对应测试已直接消费这些结构化字段，并把它们展示在任务详情页 explainability 区块中。
- 但 `实时状态信号目录` 仍只落到很窄的一层：当前代码里真正形成显式事件枚举并被测试命中的，主要还是路线证据事件 `route.recommended / route.selected / route.replanned`，以及 `telemetrySignals` 里的摘要字符串。它还不能等价为一份独立、完备、可复用的高层 signal catalog，因此不能把 spec 中列出的 `drive_state.changed / takeover.requested / takeover.resolved / risk.changed / confidence.changed / evidence.updated / runtime.health_changed` 全目录视为已完成。
- `ExplanationSource` 的设计口径也必须继续收紧：现有 `MissionAutopilotExplanationSource` 更像一份“当前实现中已落地的来源枚举”，而不是 spec 里那份“完整 explainability 来源体系”。它尚未覆盖 `audit_entry / replay_snapshot / frontend_view_model` 这些目标来源，因此这部分仍应保留为未来设计口径。
- `ExplanationRelatedRefs` 当前最接近的落地点仍是 `evidence.correlation`，而不是独立 explainability ref contract。它已经提供 `workflow / replay / session / route / runtime events / decision / operator action / audit / lineage` 这组关联索引，并被 panel 测试展示出来；但它还没有统一纳入 `workflow instance / step / node / artifact` 等维度，也没有以 explainability 对象引用模型的方式沉淀，因此不能把它写成 `ExplanationRelatedRefs` 已完成。
- `TaskDetailView.tsx` 这轮复核后更应被定义为“explainability 容器层”而不是“第二个 explainability consumer”：它负责把 `TaskAutopilotPanel` 安放到 overview / cockpit 布局中，但并不直接拼装 `autopilotSummary`、不处理 `source / refs`、也不承担 replay / audit / takeover 的二次 explainability 消费。因此，现状仍只够支撑“任务详情页接入”，不够支撑“驾驶舱、接管面板、replay、audit 统一复用”。
- 综上，这轮设计文档最应该继续坚持的边界是：当前主仓已经实现的是“结构化 explainability 摘要与任务详情页消费”，而尚未实现的是“结构化 `RiskExplanation / ConfidenceExplanation / EvidenceHint / ExplanationRelatedRefs` 对象体系”“完备高层 signal catalog”“以及 projection 到 takeover / replay / audit 的统一复用面”。因此，本轮不新增完成态，只补强设计边界说明。
