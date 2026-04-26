# 设计文档：任务自动驾驶证据回放与信任链

## 设计概述

本设计将“任务自动驾驶”的任务历史统一解释为一条可回放、可审计、可追溯的证据主链：

`Destination -> Route -> Drive Timeline -> Evidence Items -> Result Evidence -> Trust Chain`

在这条主链中：

- `Drive Timeline` 负责回答“任务是怎样一步步开到这里的”。
- `Evidence Items` 负责回答“哪些事实支撑了这个过程和结果”。
- `Replay` 负责回答“当时按什么顺序发生了什么”。
- `Audit` 负责回答“谁做了什么决定、批准了什么、承担了什么风险”。
- `Lineage` 负责回答“数据与中间结果从哪里来、流向哪里去”。
- `Trust Chain` 负责回答“为什么这些证据和最终结果值得信任”。

本设计不是要把 audit、lineage、replay 三套能力合并成一个大而全的新系统，而是为它们增加一条共享的任务自动驾驶主脊柱，让它们围绕同一批证据对象协同消费。

## 设计目标

- 建立面向任务自动驾驶的统一证据解释层。
- 让驾驶时间线成为 replay、audit、lineage 的共享主脊柱。
- 让关键决策、路线变化、接管事件、工具调用和结果证据有统一的数据口径。
- 让结果可信状态可被结构化表达，而不是只能靠人工拼接日志。
- 保持与现有 `Route / Drive State / Takeover / Mission Runtime / workflow runtime` 兼容。

## 分层设计

### 第一层：底层事实层

底层事实层继续保留当前已有来源：

- Mission 与 workflow 生命周期事件；
- Route 规划、路线切换与重规划记录；
- Drive State 高层状态变化；
- `waiting / decision / approval / resume / escalate` 等接管链路；
- 工具调用、资源访问、执行器输出；
- review / audit / verify / revise；
- replay、audit、lineage 自己已有的事件与索引。

这一层适合真实执行，但不适合直接作为统一产品叙事。

### 第二层：证据投影层

证据投影层负责把多来源底层事实归并为任务自动驾驶统一证据对象：

- 驾驶时间线事件；
- 关键决策证据；
- 路线变化证据；
- 接管证据；
- 工具调用证据；
- 结果证据；
- 信任标记与串联引用。

这一层是本 spec 的核心。

### 第三层：消费层

消费层包括：

- 自动驾驶驾驶舱；
- 任务详情；
- replay 页面；
- audit 面；
- lineage 面；
- 导出报告或后续治理接口。

这些消费层应优先读取统一证据对象，而不是继续各自拼接底层状态。

## 总体架构

```text
Mission / Route / Runtime / HITL / Tool / Review / Audit / Lineage Facts
  -> Evidence Projector
      -> Drive Timeline
      -> Decision Evidence
      -> Route Change Evidence
      -> Takeover Evidence
      -> Tool Call Evidence
      -> Result Evidence
      -> Trust Marks
  -> Shared Correlation Index
      -> Replay Consumption
      -> Audit Consumption
      -> Lineage Consumption
      -> Cockpit Consumption
```

设计原则：

- 先做投影与串联，不先做底层整体改名。
- 驾驶时间线是主脊柱，其他证据挂载到时间线位置。
- 同一事实尽量维护单一证据主记录，再向 replay / audit / lineage 投影。
- 允许分阶段接线，暂时缺失的投影必须显式标记。

## 核心对象

### 1. Autopilot Evidence Chain

一次任务自动驾驶实例对应一条总证据链。

```ts
type AutopilotEvidenceChain = {
  chainId: string;
  missionId: string;
  destinationId?: string;
  routeSetId?: string;
  activeRouteId?: string;
  timelineId: string;
  resultEvidenceId?: string;
  trustProfile: TrustProfile;
  evidenceIds: string[];
  correlation: EvidenceCorrelationIndex;
};
```

设计说明：

- `chainId` 是任务证据主链标识。
- `timelineId` 指向该任务的驾驶时间线。
- `resultEvidenceId` 指向当前主交付结果。
- `correlation` 负责把 replay、audit、lineage 关联键统一收拢。

### 2. Base Evidence Item

所有证据对象共享统一基类。

```ts
type EvidenceType =
  | "drive_state_change"
  | "decision"
  | "route_change"
  | "takeover"
  | "tool_call"
  | "result"
  | "trust_update";

type EvidenceActorKind = "system" | "user" | "agent" | "tool" | "runtime" | "governance";

type EvidenceItem = {
  id: string;
  chainId: string;
  type: EvidenceType;
  occurredAt: string;
  recordedAt: string;
  summary: string;
  actor: {
    kind: EvidenceActorKind;
    id?: string;
    label?: string;
  };
  missionId: string;
  workflowId?: string;
  routeId?: string;
  routeStepId?: string;
  driveState?: string;
  runtimeEventId?: string;
  upstreamEvidenceIds: string[];
  auditRefs: string[];
  lineageRefs: string[];
  replayRefs: string[];
  trustMarks: TrustMark[];
  redaction?: EvidenceRedaction;
};
```

设计原则：

- 任意关键事实都必须可落到统一 `EvidenceItem` 口径。
- `upstreamEvidenceIds` 用于表达支撑关系，而不是只做平铺日志。
- `auditRefs / lineageRefs / replayRefs` 是共享串联点。
- 脱敏是证据层能力，而不是单独交给前端临时处理。

### 3. Drive Timeline

Drive Timeline 是证据链主脊柱，用于表达任务推进过程。

```ts
type DriveTimeline = {
  id: string;
  missionId: string;
  startAt: string;
  endAt?: string;
  currentDriveState: string;
  eventIds: string[];
};
```

```ts
type DriveTimelineEvent = {
  id: string;
  timelineId: string;
  occurredAt: string;
  previousDriveState?: string;
  nextDriveState: string;
  stageLabel?: string;
  routeId?: string;
  routeStepId?: string;
  triggerType:
    | "mission_created"
    | "state_transition"
    | "decision_made"
    | "route_switched"
    | "takeover_triggered"
    | "tool_finished"
    | "result_submitted"
    | "result_delivered";
  triggerReason: string;
  nextActionHint?: string;
  evidenceIds: string[];
};
```

设计说明：

- Timeline Event 不等于底层 runtime event，而是面向用户解释的高层事件。
- 每个 Timeline Event 可以挂载多个证据项。
- 任何关键状态跳转都应尽量能回到时间线定位点。

### 3A. Drive State Change Evidence

`drive_state_change` 是六类核心证据对象中的第一类，用于把高层驾驶状态的进入、退出、阻塞和恢复显式投影成证据项，而不是只保留在 view model 摘要里。

```ts
type DriveStateChangeEvidence = EvidenceItem & {
  type: "drive_state_change";
  previousDriveState?: string;
  nextDriveState: string;
  stageLabel?: string;
  missionStatus?: string;
  workflowStatus?: string;
  triggerType:
    | "mission_created"
    | "state_transition"
    | "decision_waiting"
    | "decision_resolved"
    | "route_replanned"
    | "operator_action"
    | "result_progress";
  triggerReason: string;
  blocking: boolean;
  recoveryHint?: string;
  correlationTimelineId: string;
};
```

设计原则：

- 它表达的是“高层驾驶状态为什么发生变化”，而不是底层所有 runtime 原子事件。
- 它必须能与 `DriveTimelineEvent` 一一或一对多关联，成为 replay、audit、驾驶舱共同可消费的状态变化证据。
- 它可以引用 waiting / operator action / route replan / result progress，但不能替代 `decision`、`route_change`、`result` 这些专门证据对象。

### 4. Decision Evidence

关键决策证据用于解释“为什么选这条路、这个动作或这个结果”。

```ts
type DecisionEvidence = EvidenceItem & {
  type: "decision";
  subject: string;
  decisionMode: "automatic" | "human" | "hybrid";
  inputsSummary: string[];
  options: {
    id: string;
    label: string;
    pros?: string[];
    cons?: string[];
  }[];
  selectedOptionId: string;
  rationale: string;
  confidence?: number;
  relatedRiskIds?: string[];
};
```

设计原则：

- 记录关键输入与候选方案，而不只记录最终选项。
- 决策必须能关联路线、接管或结果。
- 若决策被后续推翻，也应保留原决策证据。

### 5. Route Change Evidence

路线变化证据用于解释偏航、重规划和路线切换。

```ts
type RouteChangeEvidence = EvidenceItem & {
  type: "route_change";
  previousRouteId?: string;
  nextRouteId: string;
  reasonType:
    | "replanning"
    | "human_override"
    | "risk_exceeded"
    | "quality_gap"
    | "dependency_unavailable"
    | "constraint_changed";
  reasonSummary: string;
  preservedStepIds: string[];
  invalidatedStepIds: string[];
  addedStepIds: string[];
};
```

设计原则：

- 路线变化必须保留前后关系和影响范围。
- 普通 `retry` 不应伪装成路线变化。
- 路线变化应能连接到 `Drive State = replanning` 的时间线位置。

### 6. Takeover Evidence

接管证据用于解释系统为什么交还方向盘，以及用户如何处理。

```ts
type TakeoverEvidence = EvidenceItem & {
  type: "takeover";
  takeoverType:
    | "clarification"
    | "route_selection"
    | "permission_confirm"
    | "budget_confirm"
    | "risk_acceptance"
    | "result_acceptance"
    | "manual_override"
    | "exception_recovery";
  required: boolean;
  reason: string;
  prompt: string;
  options: {
    id: string;
    label: string;
  }[];
  selectedOptionId?: string;
  submittedBy?: string;
  submittedAt?: string;
  timeoutOutcome?: "default_action" | "escalated" | "waiting";
  resumeTargetState?: string;
};
```

设计原则：

- 接管证据必须同时服务用户解释、审计追责和回放重现。
- 展示内容与用户选择都要保留。
- 接管完成后的恢复路径必须显式记录。

### 7. Tool Call Evidence

工具调用证据用于解释系统如何借助工具、执行器和资源推进任务。

```ts
type ToolCallEvidence = EvidenceItem & {
  type: "tool_call";
  toolId: string;
  toolKind: "file" | "browser" | "api" | "database" | "sandbox" | "mcp" | "other";
  purpose: string;
  inputDigest?: string;
  outputDigest?: string;
  startedAt: string;
  finishedAt?: string;
  status: "success" | "failure" | "timeout" | "cancelled";
  permissionDecision?: "granted" | "denied" | "not_required";
  estimatedCost?: number;
  actualCost?: number;
  sideEffectScope?: string;
  errorSummary?: string;
};
```

设计原则：

- 记录摘要和校验信息，不要求总是存全部原始载荷。
- 高风险或高成本调用必须可被审计定位。
- 调用失败也应是证据，而不是被过滤掉。

### 8. Result Evidence

结果证据用于把最终交付与其支撑链打通。

```ts
type ResultEvidence = EvidenceItem & {
  type: "result";
  resultVersion: number;
  status: "draft" | "reviewing" | "accepted" | "rejected" | "superseded";
  artifactRefs: {
    kind: "file" | "message" | "report" | "summary" | "external_link";
    ref: string;
  }[];
  qualitySignals: {
    review?: string;
    audit?: string;
    verify?: string;
    acceptance?: string;
  };
  supportingEvidenceIds: string[];
};
```

设计原则：

- 最终结果必须能向上游证据追溯。
- 支持多版本结果，而不是只保留最后一次交付。
- 结果状态必须能表达草稿、复核中、已验收、被替换等阶段。

### 9. Trust Profile

Trust Profile 用于统一表达可信状态。

```ts
type TrustStatus = "verified" | "partial" | "unverified" | "redacted";

type TrustDimension =
  | "origin"
  | "integrity"
  | "lineage"
  | "audit"
  | "replayability"
  | "result_readiness";

type TrustMark = {
  dimension: TrustDimension;
  status: TrustStatus;
  reason: string;
  sourceRef?: string;
};

type TrustProfile = {
  overallStatus: TrustStatus;
  marks: TrustMark[];
  gaps: string[];
};
```

设计原则：

- 信任不是单一分数，而是一组维度化判断。
- 脱敏、断链、未复核等情况必须显式体现在 `gaps` 中。
- `overallStatus` 是聚合结论，不替代维度细节。

### 10. Evidence Redaction / Gap / Broken Chain

证据链设计不能只定义“理想字段”，还必须定义不可见、缺失、断链和降级状态的正式对象口径。

```ts
type EvidenceRedaction = {
  mode: "field_masked" | "summary_only" | "reference_only" | "withheld";
  reason:
    | "permission_restricted"
    | "privacy_restricted"
    | "security_restricted"
    | "budget_restricted"
    | "policy_restricted";
  redactedFields: string[];
  fallbackSummary?: string;
};

type EvidenceGapMarker = {
  gapType:
    | "missing_source"
    | "missing_payload"
    | "missing_review"
    | "missing_audit"
    | "missing_lineage"
    | "missing_replay";
  severity: "info" | "warn" | "blocking";
  summary: string;
  relatedEvidenceId?: string;
};

type BrokenChainMarker = {
  breakType:
    | "missing_upstream"
    | "missing_downstream"
    | "missing_locator"
    | "orphan_result"
    | "orphan_tool_output";
  summary: string;
  relatedEvidenceId: string;
  affectedTrustDimensions: TrustDimension[];
};
```

设计原则：

- `redacted` 必须作为证据层能力进入统一对象，而不是前端临时把某些字段删掉。
- `gaps` 与 `broken chain` 必须可被 replay / audit / lineage / cockpit 共同消费。
- 降级规则必须和 `TrustProfile` 联动，而不是只在 UI 上显示一条弱提示。

## 六类核心证据对象语义边界

| 对象 | 主要回答的问题 | 核心主字段 | 不应混入的语义 |
| --- | --- | --- | --- |
| `drive_state_change` | 当前驾驶状态为什么改变 | `previousDriveState`、`nextDriveState`、`triggerType`、`triggerReason`、`blocking` | 不能替代具体决策、路线切换或最终结果 |
| `decision` | 为什么选这条路线/这个动作/这个验收结论 | `options`、`selectedOptionId`、`rationale`、`decisionMode` | 不能把工具执行细节和结果工件塞进决策对象 |
| `route_change` | 为什么换路、影响了哪些步骤 | `previousRouteId`、`nextRouteId`、`reasonType`、`preservedStepIds`、`invalidatedStepIds`、`addedStepIds` | 不能把普通 `retry` 伪装为换路 |
| `takeover` | 为什么要求人工接手、人工如何处理 | `takeoverType`、`required`、`prompt`、`options`、`selectedOptionId`、`resumeTargetState` | 不能替代 route summary，也不能吞掉恢复结果 |
| `tool_call` | 系统调用了什么资源、代价与副作用是什么 | `toolKind`、`purpose`、`inputDigest`、`outputDigest`、`status`、`permissionDecision` | 不能直接替代结果证据；失败调用也要保留 |
| `result` | 最终交付是什么、由哪些证据支撑 | `artifactRefs`、`status`、`qualitySignals`、`supportingEvidenceIds` | 不能只剩附件列表而缺少 review / audit / verify / acceptance 语义 |

补充说明：

- 六类对象共享同一套 `EvidenceItem` 基类、共享 `TrustMark` / `EvidenceRedaction` / `EvidenceCorrelationIndex`。
- `DriveTimelineEvent` 是高层叙事事件；六类核心证据对象是挂载在时间线节点上的结构化事实。
- 一个时间线事件可以挂多个证据对象，但每个关键证据对象都必须有明确的时间线归属。

## 串联关系设计

### 1. 驾驶时间线作为主脊柱

所有关键证据项都应挂载到某个时间线位置或时间线片段上。

主链路示意：

```text
Mission Created
  -> understanding
  -> planning
  -> fleet-forming
  -> executing
  -> reviewing
  -> delivered
```

非理想链路示意：

```text
executing
  -> takeover-required
  -> replanning
  -> executing
  -> reviewing
  -> takeover-required
  -> delivered
```

时间线作用：

- 给 replay 提供可播放顺序。
- 给 audit 提供上下文定位。
- 给 lineage 提供时间和阶段语义。
- 给驾驶舱提供“现在开到哪了”的主叙事。

### 2. 关键决策挂载到时间线事件

关键决策一般挂载在以下时间点：

- 路线生成后；
- 重规划时；
- 高风险工具调用前；
- review / audit 结果回流时；
- 交付验收前。

设计要求：

- 决策不能只存在于单独决策表中。
- 必须能从时间线进入决策详情。
- 决策结果若影响后续路线或结果，应建立下游引用。

### 3. 路线变化连接前后两段时间线

路线变化证据的本质不是一条普通事件，而是两段驾驶历史之间的桥。

它至少应连接：

- 原路线；
- 触发原因；
- 新路线；
- 受影响步骤；
- 进入 `replanning` 的时间线事件；
- 恢复执行的时间线事件。

这样 replay 才能解释“为什么突然换路”，audit 才能解释“谁批准了换路”，lineage 才能解释“哪些中间结果被复用或废弃”。

### 4. 接管事件连接系统与人工链路

接管证据必须把两部分连接起来：

- 系统视角：为什么需要接管、若不处理会怎样；
- 人工视角：用户看到了什么、做了什么选择、系统如何恢复。

串联要求：

- 接管前关联当前 `Drive State`、风险、当前路线与上下文摘要；
- 接管中保留展示内容与决策选项；
- 接管后记录进入何种恢复路径，如 `clarifying / planning / executing / replanning / terminate`。

### 5. 工具调用连接执行事实与结果支撑

工具调用证据连接两类对象：

- 上游决策和路线步骤；
- 下游中间结果和最终结果。

设计要求：

- 若工具调用生成了文件、摘要、报告、搜索结果或结构化数据，应尽量生成输出摘要或哈希。
- 若工具调用失败，应保留失败原因和对应恢复动作。
- 若工具调用受权限或预算约束，应连接审计与接管证据。

### 6. 结果证据作为任务信任汇总点

结果证据是任务交付阶段的汇总对象：

- 汇总最终工件；
- 汇总 review / audit / verify / 验收 信号；
- 汇总关键支撑证据；
- 给 trust chain 提供最终聚合结论。

结果证据不是简单的“附件列表”，而是一次交付的可信摘要。

## audit / lineage / replay 串联设计

### Replay 消费

Replay 优先消费：

- `DriveTimelineEvent`
- `EvidenceItem.summary`
- 关键决策、路线变化、接管、工具调用、结果证据

Replay 需要回答：

- 任务如何推进；
- 在哪里偏航；
- 在哪里请求用户；
- 为什么最终结果变成现在这样。

Replay 的最小消费单元应定义为“一个 `DriveTimelineEvent` + 其挂载的 evidence cluster”，而不是继续直接消费底层 runtime 原子事件流。

Replay 必须稳定展示的字段包括：

- `timelineId / eventId / occurredAt / triggerType / triggerReason`
- `previousDriveState / nextDriveState / stageLabel`
- `routeId / routeStepId / decisionId / runtimeEventId`
- 当前 event 挂载的 `decision / route_change / takeover / tool_call / result` 摘要
- `TimelineLocator.resolution`、`TrustMark.replayability` 与对应 gaps / broken chain

Replay 展示规则：

- **关键时间点**：`mission_created`、关键 `state_transition`、`route_switched`、`takeover_triggered`、`result_submitted`、`result_delivered` 必须作为可定位节点展示。
- **偏航展示**：当存在 `RouteChangeEvidence` 时，必须同屏展示 `previousRouteId -> nextRouteId`、`reasonType / reasonSummary`、`preservedStepIds / invalidatedStepIds / addedStepIds`，不能只显示“已重规划”一句文案。
- **接管展示**：当存在 `TakeoverEvidence` 时，必须展示 `prompt / options / selectedOptionId / submittedBy / submittedAt / resumeTargetState`，使 replay 能完整还原“为什么停下来、用户如何接手、系统如何恢复”。
- **结果切换展示**：当 `ResultEvidence` 发生版本替换、拒收或 superseded 时，Replay 必须把 `resultVersion / status / qualitySignals / supportingEvidenceIds` 作为切换节点展示，而不是只保留最后一个结果快照。
- **降级展示**：若 `TimelineLocator.resolution = approximate / unresolved`，或 evidence 被 redacted / broken chain，则 Replay 必须显式展示降级原因，不能伪装成完整可回放。

### Audit 消费

Audit 优先消费：

- 决策证据；
- 接管证据；
- 工具调用中的权限、风险、成本信号；
- 结果证据中的复核和验收结论；
- `TrustMark.integrity / audit / result_readiness`

Audit 需要回答：

- 谁批准了什么；
- 谁接受了什么风险；
- 为什么允许这次调用或换路；
- 结果是否经过必要治理。

Audit 的最小消费单元应定义为“一个治理关注点 + 相关 evidence bundle”，至少覆盖一个核心 `DecisionEvidence`，并按需附带 `TakeoverEvidence`、`ToolCallEvidence`、`ResultEvidence` 与 `TrustMark`。

Audit 必须稳定消费的字段包括：

- `DecisionEvidence.subject / decisionMode / selectedOptionId / rationale / relatedRiskIds`
- `TakeoverEvidence.takeoverType / required / prompt / selectedOptionId / submittedBy / submittedAt`
- `ToolCallEvidence.permissionDecision / estimatedCost / actualCost / sideEffectScope / errorSummary`
- `ResultEvidence.status / qualitySignals.review / qualitySignals.audit / qualitySignals.verify / qualitySignals.acceptance`
- `TrustMark.audit / TrustMark.integrity / TrustMark.result_readiness`
- 关联的 `actor / occurredAt / auditRefs / TimelineLocator`

Audit 展示规则：

- **关键决策**：必须能看到候选方案、最终选项、决策理由与风险归属，不能只剩一句“已批准”。
- **接管与授权**：涉及 `permission_confirm / budget_confirm / risk_acceptance / result_acceptance` 的 takeover，必须与决策和最终恢复路径一起展示，明确“谁在什么时间接受了什么责任”。
- **权限与预算**：高风险、高成本工具调用必须在 Audit 中展示权限判定、成本区间和副作用摘要，并能回指触发它的决策或路线步骤。
- **验收与复核**：结果验收必须展示 `qualitySignals` 与 `ResultEvidence.status` 的对应关系；若缺 review / audit / verify / acceptance，必须直接显示 gap，而不是默认视为通过。
- **可信降级**：当 evidence 被 redacted、缺 locator 或存在 broken chain 时，Audit 必须保留这些治理缺口，使审计结论天然带降级语义。

### Lineage 消费

Lineage 优先消费：

- 工具调用输出摘要；
- 数据或中间结果节点；
- 决策输入来源；
- 结果证据的支撑引用。

Lineage 需要回答：

- 结果依赖了哪些输入；
- 输入在何处被变换；
- 某次路线变化是否复用了旧结果；
- 某个异常结果受哪些上游证据影响。

Lineage 的最小消费单元应定义为“一个工件或中间结果节点 + 它的上游/下游 evidence edges”，而不是只显示孤立的 `lineageId` 或 artifact 引用。

Lineage 必须稳定消费的字段包括：

- `ToolCallEvidence.toolKind / purpose / inputDigest / outputDigest / status`
- `ResultEvidence.artifactRefs / supportingEvidenceIds / resultVersion / status`
- `DecisionEvidence.inputsSummary` 与关键上游 `upstreamEvidenceIds`
- `RouteChangeEvidence.previousRouteId / nextRouteId / preservedStepIds / invalidatedStepIds / addedStepIds`
- `TimelineLocator.routeId / routeStepId / occurredAt / resolution`
- `EvidenceGapMarker / BrokenChainMarker` 对 lineage 完整性的影响

Lineage 展示规则：

- **输入到结果的支撑路径**：必须能从最终 `ResultEvidence` 沿 `supportingEvidenceIds` 回看工具输出、决策输入与中间结果，而不是只展示最终工件列表。
- **路线切换复用**：当发生 `route_change` 时，Lineage 必须明确标出哪些工件/中间结果被 `preserved` 复用、哪些被 `invalidated` 废弃、哪些是新路线新增产物。
- **工具输出归属**：文件、浏览器、API、数据库、沙箱、MCP 的输出摘要必须作为 lineage 节点或边的一部分被消费，便于解释结果来自哪里、经过了什么转换。
- **异常溯源**：若结果异常、工具失败或支撑链断裂，Lineage 必须沿 `upstreamEvidenceIds` 与 `BrokenChainMarker` 给出异常上游，而不是停留在“节点缺失”的静态提示。
- **定位透明**：若只能近似定位到某个 timeline 节点，Lineage 必须暴露 `resolution = approximate`；若无法定位，则显示 `unresolved` 并同步触发 trust 降级。

### Shared Correlation Index

为了让三者不再割裂，需要定义统一关联键：

```ts
type EvidenceCorrelationIndex = {
  missionId: string;
  workflowId?: string;
  timelineId: string;
  routeIds: string[];
  routeStepIds: string[];
  runtimeEventIds: string[];
  decisionIds: string[];
  auditEventIds: string[];
  lineageIds: string[];
  replayEventIds: string[];
};
```

设计原则：

- 关联键是串联层，不要求底层所有对象改名。
- 允许某些字段暂时为空，但必须显式存在。
- 串联失败要可观察，不能静默吞掉。

## 驾驶时间线映射规则

`DriveTimelineEvent` 与现有 `Drive State`、Mission Runtime、workflow runtime 的关系应采用“高层事件归一化 + 底层事实挂载”的映射策略，而不是直接把所有 runtime 事件原样暴露给消费层。

| 底层事实来源 | 进入的高层事件 | 推荐 `triggerType` | 主要挂载的证据对象 | 必须保留的关联键 |
| --- | --- | --- | --- | --- |
| mission 创建 / workflow 启动 | timeline 起点 | `mission_created` | `drive_state_change` | `missionId`、`workflowId`、`timelineId` |
| `Drive State` 从 understanding/planning/executing/reviewing 等切换 | 状态跃迁 | `state_transition` | `drive_state_change` | `previousDriveState`、`nextDriveState`、`routeId?` |
| waiting decision / approval_required / human input | 接管等待 | `decision_waiting` / `takeover_triggered` | `takeover`、`decision`、`drive_state_change` | `decisionId`、`sessionId`、`timelineId` |
| decision submit / approval resolve / operator continue | 人工处理完成 | `decision_made` / `decision_resolved` | `decision`、`takeover` | `decisionId`、`submittedBy`、`selectedOptionId` |
| route 选择切换 / runtime replanned | 路线变化 | `route_switched` | `route_change`、`decision?`、`drive_state_change` | `previousRouteId`、`nextRouteId`、`routeIds` |
| tool finished / executor callback | 工具执行完成 | `tool_finished` | `tool_call` | `toolId`、`runtimeEventId`、`artifactId?` |
| review / audit / verify / acceptance / delivery | 结果推进 | `result_submitted` / `result_delivered` | `result`、`decision?` | `artifactRefs`、`qualitySignals`、`supportingEvidenceIds` |

映射原则：

- Mission Runtime / workflow runtime 的原始状态变化先映射成 `DriveTimelineEvent`，再把底层 `runtimeEventId / replayId / routeId / decisionId` 挂到证据对象或 correlation 上。
- `Drive State` 是高层叙事主状态；Mission Runtime / workflow runtime 是底层事实来源。二者不能混用为同一字段。
- 一次路线重规划至少应形成两类挂载：`drive_state_change(replanning)` 与 `route_change(previous -> next)`。
- 一次等待人工输入至少应形成 `takeover` 证据，并在需要时补一条 `decision` 证据表达“用户或系统为何选择某方案”。

## 关键证据关联规则

### 1. 决策证据关联规则

- `DecisionEvidence` 必须至少关联一个时间线事件、一个 `selectedOptionId` 和一个下游对象：
  - 路线选择类：关联 `RouteChangeEvidence` 或 route selection summary；
  - 风险接受类：关联 `TakeoverEvidence` 与对应 `TrustMark.audit`；
  - 结果验收类：关联 `ResultEvidence.status` 与 `qualitySignals.acceptance`；
  - 人工决策类：关联 `submittedBy / submittedAt / decisionId`。
- Route 选择、风险判断、结果验收和人工决策不是四套互不相干的对象，而是 `decision` 证据的不同 subject / mode / downstream relation。
- 决策被后续推翻时，旧的 `DecisionEvidence` 不能删，只能通过新的 evidence item 标记 superseded 或 overridden。

### 2. 路线变化证据关联规则

- `RouteChangeEvidence` 的最小关联集是：
  - `previousRouteId`
  - `nextRouteId`
  - `reasonType / reasonSummary`
  - `preservedStepIds / invalidatedStepIds / addedStepIds`
  - 进入 `replanning` 的 timeline event
  - 退出 `replanning` 或恢复 `executing` 的 timeline event
- 候选路线切换和 runtime replanned 都属于 `route_change`，但 `reasonType` 不同：
  - 用户改线：`human_override`
  - 运行时自动改线：`replanning`
  - 风险/质量触发：`risk_exceeded` / `quality_gap`
- 如果没有步骤差异，只允许保留空数组，不允许省略三个差异字段；这是为了让 replay / lineage / cockpit 能稳定消费路线影响范围。

### 3. 工具调用与结果证据关联规则

- `ToolCallEvidence` 必须可向上游回指触发它的 route step / decision / takeover，也必须可向下游挂接：
  - 工具输出工件
  - review / verify / audit 结果
  - 最终 `ResultEvidence`
- `ResultEvidence.supportingEvidenceIds` 不是附加说明，而是最终交付可信链的正式支撑关系。
- 对于文件、浏览器、API、数据库、沙箱、MCP 六类资源，统一摘要字段保持一致，但每类至少补一个专有扩展：
  - file：`artifactRef / pathDigest`
  - browser：`urlDigest / pageTitle`
  - api：`endpointDigest / method`
  - database：`queryDigest / datasetRef`
  - sandbox：`jobRef / commandDigest`
  - mcp：`serverName / capability`

## audit / lineage 回指时间线定位规则

从 audit 记录和 lineage 节点回到驾驶时间线，不能只靠“看起来像”的字符串匹配，必须有稳定定位规则。

```ts
type TimelineLocator = {
  timelineId: string;
  eventId?: string;
  resolution: "exact" | "approximate" | "unresolved";
  routeId?: string;
  routeStepId?: string;
  decisionId?: string;
  runtimeEventId?: string;
  occurredAt?: string;
  reason?: string;
};
```

定位优先级：

1. **精确命中**：若 audit / lineage 对象直接携带 `timelineId + eventId`，则使用 `resolution = exact`。
2. **决策 / 运行时命中**：若只携带 `decisionId`、`runtimeEventId`、`operatorActionId`，则在 `DriveTimelineEvent.evidenceIds` 与 `EvidenceCorrelationIndex` 中反查，命中时仍记为 `exact`。
3. **路线 / 步骤命中**：若只携带 `routeId / routeStepId + occurredAt`，则按同路线、同步骤、时间最近原则定位，记为 `approximate`。
4. **状态兜底命中**：若只能命中 `driveState + occurredAt`，则允许定位到最近的状态变化事件，但必须暴露 `resolution = approximate` 和 `reason`。
5. **无法定位**：若上述规则都无法命中，则返回 `resolution = unresolved`，并追加 `BrokenChainMarker(missing_locator)`，同步触发 `replayability` / `lineage` / `audit` 至少一个维度降级。

设计原则：

- audit / lineage 回指 timeline 的规则必须独立于具体页面存在，这样 replay、audit、lineage 三个消费面才能共享同一套定位逻辑。
- “近似定位”与“无法定位”都必须显式暴露，不能在 UI 中伪装成精确命中。

## 证据脱敏、缺口、断链与可信降级规则

### 1. 脱敏规则

- 若证据包含敏感输入、受限输出、预算/权限受限片段，则原证据对象保留，但以 `EvidenceRedaction` 标注：
  - `field_masked`：字段仍存在但内容被遮罩；
  - `summary_only`：仅保留摘要；
  - `reference_only`：仅保留引用键；
  - `withheld`：对象可见但主体内容完全不可见。
- 发生脱敏后，`TrustProfile.overallStatus` 最高只能到 `partial`，除非存在独立 audit / verify 证据明确背书该脱敏对象。

### 2. 缺口规则

- 以下情形必须生成 `EvidenceGapMarker` 并写入 `TrustProfile.gaps`：
  - result 已交付但缺 review / verify / acceptance 记录；
  - route_change 存在但缺 `reasonSummary` 或步骤差异；
  - tool_call 存在但缺 outputDigest / artifactRef；
  - replay 可查但没有 timeline locator；
  - lineage 引用存在但没有可用节点对象。

### 3. 断链规则

- 当 evidence item 缺失 upstream/downstream/locator 时，必须生成 `BrokenChainMarker`：
  - `missing_upstream`：结果无法回指到支撑证据；
  - `missing_downstream`：工具输出存在但未进入结果或 lineage；
  - `missing_locator`：audit / lineage 无法回到 timeline；
  - `orphan_result`：结果对象没有任何支撑证据；
  - `orphan_tool_output`：工具输出没有后续消费节点。

### 4. 可信降级规则

| 触发情况 | 最低降级维度 | 最低可信状态 |
| --- | --- | --- |
| 有脱敏但无独立审计背书 | `origin` / `result_readiness` | `partial` |
| 缺 review / audit / verify / acceptance | `audit` / `result_readiness` | `partial` 或 `unverified` |
| 缺 timeline locator | `replayability` | `partial` |
| 缺 lineage 回指 | `lineage` | `partial` |
| 缺关键上游或下游支撑 | `integrity` | `unverified` |
| 仅剩前端临时文案无服务端投影 | `origin` / `integrity` | `unverified` |

Replay、Audit、Lineage 的消费方式都必须承认这张降级表，而不是各自重新发明一套“可信/不可信”定义。

## 信任链计算原则

### 1. 来源可信

如果证据来自受控的 runtime、明确的用户操作或已登记工具调用，则 `origin` 可标记为较高可信。

### 2. 链路完整

如果证据存在明确上游和下游引用，且能回到时间线定位点，则 `integrity` 和 `lineage` 可提升。

### 3. 可回放

如果证据能被 replay 直接消费或能定位到时间线事件，则 `replayability` 可标记为 `verified` 或 `partial`。

### 4. 已复核

如果存在 review / audit / verify / 验收结论，则 `audit` 和 `result_readiness` 可提升。

### 5. 缺口显式暴露

出现以下情况时，可信状态不得显示为完整可信：

- 证据缺失；
- 只剩前端临时文案，没有服务端投影；
- 工具输出被截断或无法定位来源；
- 结果未经过复核；
- 关键接管或批准记录缺失；
- 关键路线变化没有原因。

## 兼容与落地策略

### 1. 与 Drive State 兼容

本设计直接复用现有高层十态 `Drive State` 作为时间线状态语义来源，不重新定义第二套状态机。

### 2. 与 Route / Replan 兼容

路线变化证据应直接复用 Route、候选路线、Replan 记录与 Route Runtime Mapping 作为事实输入。

### 3. 与 Takeover 兼容

接管证据应复用现有 `MissionDecision`、`waiting`、`resume()`、`escalate()`、approval 链路。

### 4. 与 replay / audit / lineage 兼容

优先做共享证据对象与关联键，再逐步让 replay、audit、lineage 改为消费统一投影。

### 5. 分阶段落地

建议分四段推进：

- A 段：术语、对象模型和文档统一。
- B 段：前端或 view model 层先消费统一时间线和关键证据。
- C 段：服务端落地证据投影与关联索引。
- D 段：补齐 trust marks、审计锚点、lineage 接线与 replay 深度消费。

### 6. 首版验证方案

首版验证方案不要求一次性把所有页面做完，但必须覆盖“对象模型、映射规则、消费方式、可信降级”四个层面的最小场景。

建议验证矩阵如下：

| 场景 | 期望验证点 |
| --- | --- |
| 标准成功链路 | `DriveTimelineEvent` 能串起 mission created -> planning -> executing -> reviewing -> delivered，且 `ResultEvidence` 能回指支撑证据 |
| waiting / route-selection | 产生 `TakeoverEvidence` + `DecisionEvidence`，并能把 route selection comment 作为 change reason 收口 |
| runtime replanned | 产生 `RouteChangeEvidence`，且带 `preservedStepIds / invalidatedStepIds / addedStepIds` |
| 高风险工具调用 | 产生 `ToolCallEvidence`，并保留 permission / cost / sideEffectScope 摘要 |
| result accepted / rejected | `ResultEvidence.status` 与 `qualitySignals.acceptance` 一致，且 trust profile 同步更新 |
| audit / lineage 回指 timeline | `TimelineLocator` 能返回 `exact / approximate / unresolved` 之一，且 unresolved 会触发降级 |
| redacted / missing / broken chain | `EvidenceRedaction`、`EvidenceGapMarker`、`BrokenChainMarker` 都会进入 trust profile 与消费层 |

验证层次：

- shared：对象模型、字段归一化、trust downgrade 计算。
- server：evidence projector、replay/audit/shared links、timeline locator、route change diff。
- client：驾驶舱/任务详情/replay/audit/lineage 消费同一套证据摘要与降级标记。

### 7. 统一实现基线

后续统一实现应明确分层边界，避免再次回到“每个消费面自己拼装 evidence”的旧模式。

#### Shared 基线

- 共享契约层至少统一导出：
  - `AutopilotEvidenceChain`
  - `EvidenceItem` 与六类核心对象
  - `DriveTimeline / DriveTimelineEvent`
  - `EvidenceCorrelationIndex / TimelineLocator`
  - `EvidenceRedaction / EvidenceGapMarker / BrokenChainMarker`
  - `TrustProfile / TrustMark`

#### Server 基线

- `buildMissionAutopilotSummary()` 继续承担最小 view-model 证据投影。
- evidence projector 负责把 mission/runtime/replay/audit/lineage 事实重建为共享 evidence object graph。
- replay / audit / lineage 路由不再各自发明一套关联逻辑，而是复用 `EvidenceCorrelationIndex + TimelineLocator`。

#### Client 基线

- 驾驶舱、任务详情、回放页、审计页、血缘页优先消费统一 evidence summary，而不是直接拼 MissionRecord 零散字段。
- UI 层允许做裁剪与摘要，但不得改变对象语义、不得私自吞掉 gaps / broken chain / redacted。

#### 基线约束

- 设计闭环与实现闭环分开统计：本 spec 可以先把设计模型定义完整，但实现推进时必须对照上述 shared/server/client 基线逐段落地。
- 若某一层尚未实现，必须保留显式 fallback 与 trust downgrade，而不是回退到隐式字符串摘要。

## 审计备注（2026-04-25，按 design 闭环口径收口）

- 本轮 design 收口口径以“设计文档是否已经把对象模型、映射规则、消费契约、可信降级和验证基线定义完整”为准，而不是以当前 shared / server / client 是否全部实现完成为准。
- 因此，本文档里已经明确闭环的 `AutopilotEvidenceChain / EvidenceItem / DriveTimelineEvent`、六类核心证据对象、Replay/Audit/Lineage 消费方式、TimelineLocator、可信降级规则、首版验证方案与统一实现基线，都应按 design 完成看待。
- 前述多轮“限定代码证据”“扩围至 replay / observability / client consumer”“shared correlation 增强”审计备注继续保留，作用是说明**实现现状仍分阶段落地**，不影响本 spec 在设计层面的收口判断。

## 风险与边界

### 风险 1：把证据链做成新的平行日志系统

如果证据链与现有 replay、audit、lineage 各做一套记录，会导致事实冲突和维护成本激增。

应对原则：

- 优先投影共享对象。
- 避免每个消费面维护一套独立事实。

### 风险 2：只做前端拼接，不做可重建投影

如果证据链只能在前端临时算出，就无法支撑真实回放和审计。

应对原则：

- 至少核心证据要能由服务端或事件层重建。

### 风险 3：把信任链误做成“永远可信”的装饰标签

如果缺口、脱敏和断链不被暴露，信任链会失去意义。

应对原则：

- 信任链必须能表达 `partial / unverified / redacted`。
- 缺口必须被显示，而不是隐藏。

### 风险 4：把重试误当成换路

如果 `retry` 与 `route_change` 混淆，用户和审计都无法理解系统是否真正重新规划。

应对原则：

- 明确区分普通重试、步骤返工和路线切换。

## 设计结论

本 spec 的最终结论是：

1. 任务自动驾驶需要一条统一的证据主链，而不是 replay、audit、lineage 三个并列孤岛。
2. 驾驶时间线是证据主链的脊柱，关键决策、路线变化、接管事件、工具调用和结果证据挂载其上。
3. 结果可信状态来自结构化信任链，而不是人工阅读日志后的主观判断。
4. 该设计优先做投影层和串联层，不要求立刻重构底层执行引擎。
5. 后续驾驶舱、回放、审计、血缘和导出面，应优先复用本 spec 中定义的证据对象和关联口径。

## 审计备注（2026-04-25，限定证据范围复核）

- 本轮 design 复核只允许依赖以下文件：`shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/mission/index.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`。
- 站在这组限定证据上，当前真正落地的是“最小任务投影视图层 evidence 合同”，而不是完整的 replay / audit / lineage 统一证据链。

### 当前可坐实的最小实现

- `shared/mission/autopilot.ts` 已提供单任务 `autopilotSummary` 级别的 evidence projection：
  - `evidence.trustLevel / gaps / timeline / correlation`
  - `route.evidence.events`
  - `takeover` 摘要
  - `explanation.currentState / recommendationDetails / remainingSteps`
- `shared/__tests__/mission-autopilot.test.ts` 直接验证：
  - `verified / partial / unverified` 的 trust 推导
  - waiting / blocked / retry 等场景下的 `takeover`、`route.evidence.events`、`evidence.timeline`
  - `recommendedRouteId / selectedRouteId / currentStepKey / decisionIds / operatorActionIds`
  - barrel/API 对 evidence、timeline、route、takeover、recovery 的类型导出
- `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 直接验证：
  - `/api/tasks/:id/projection` 会透传 `autopilotSummary`
  - evidence correlation 中的 `workflowId / replayId / sessionId / timelineId`
  - waiting decision 会投影为 `takeover`、`evidence.timeline`、`orchestration.bindings.decisionId`
  - decision submit 之后 mission 能恢复执行
- `client/src/lib/tasks-store.ts` 已把上述 projection 做了 normalize：
  - 保留 `evidence.timeline`
  - 保留 `evidence.correlation`
  - 保留 `route.evidence.events`
  - 保留 `trustLevel / gaps / evidenceHints`

### 因限定范围而必须收紧的边界

- 当前不能再把这份 spec 表述成“replay 已消费统一时间线”：
  - 在本轮允许范围内，只能看到 `replayId` 被当作 projection/correlation 字段透传；
  - 看不到 replay route 本身如何消费 `evidence.timeline`、如何表达偏航、如何切换结果。
- 当前也不能再把这份 spec 表述成“replay -> audit / lineage 上下文透传已完成”：
  - 在允许范围内，`auditEventIds`、`lineageIds` 只是 correlation 里的预留数组；
  - `buildEvidenceCorrelationIndex()` 当前仍把它们构造成空数组；
  - 没有 direct test 证明 replay 事件与 audit / lineage 对象之间存在正式 links 合同。
- 当前 `TrustProfile` 仍只能按“最小口径”理解：
  - 枚举里已有 `redacted`；
  - client normalize 也允许消费 `redacted`；
  - 但限定范围内没有 direct code + direct test 证明实际会产出 `redacted`，也没有脱敏/断链导致 trust 降级的闭环。

### 仍未落地的关键设计缺口

- 没有统一 `AutopilotEvidenceChain / EvidenceItem / DriveTimelineEvent` 对象体系，现状仍是 view-model 预览切片。
- 没有 `RouteChangeEvidence` 的影响范围合同，缺少 `preservedStepIds / invalidatedStepIds / addedStepIds`。
- 没有工具调用证据统一摘要模型；限定文件里看不到 file / browser / api / database / sandbox / mcp 的 shared evidence contract。
- 没有 `ResultEvidence` 或 result trace；现有测试没有把结果状态、工件、review/audit/verify/acceptance 串成统一闭环。
- 没有 `audit / lineage -> timeline` 正式回溯定位规则；当前只具备相关键位预留，不具备规则合同。

### 本轮设计收口

- 如果只按本轮允许的证据范围做设计审计，当前最准确的结论应是：
  - 仓内已经落地“最小 evidence projection + 最小 takeover projection + 最小 correlation projection + 最小 client normalize”；
  - 这些实现足以支撑任务详情/任务投影层的 evidence 预览；
  - 但还不足以支撑统一 evidence chain、formal replay consumption、formal audit-lineage backtrace 或 result trust chain。
- 因此，本 spec 的设计文档应继续把 `AutopilotEvidenceChain / EvidenceItem / DriveTimelineEvent / ResultEvidence / replay-audit-lineage` 视为目标设计，而不是已由当前限定代码范围完成的事实。

## 审计备注（2026-04-25，扩围至 replay / observability / client consumer 后复核）

- 本轮 design 复核在上一轮“最小任务投影视图层 evidence 合同”结论之上，额外纳入：`server/routes/replay.ts`、`server/tests/replay-routes.test.ts`、`server/core/web-aigc-runtime-observability.ts`、`server/tests/web-aigc-runtime-observability.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`。

### 本轮新增坐实的一条设计事实

- 当前仓内已经可以保守认定“replay 事件可携带跳转到 audit / lineage 的共享上下文键”这一层设计事实：
  - `server/core/web-aigc-runtime-observability.ts` 会从 runtime event 中抽取并统一沉淀 `workflowId / missionId / instanceId / sessionId / replayId / traceId / requestId / lineageId / artifactId / nodeId / edgeId / decisionId`；
  - 这些 links 会同时进入 replay sink 的 `eventData.metadata.links` 与 audit sink 的 `metadata.links`；
  - `server/tests/web-aigc-runtime-observability.test.ts` 直接验证 replay / audit 两端的 links 一致，且覆盖 `lineageId / decisionId / replayId`；
  - `server/routes/replay.ts` 与 `server/tests/replay-routes.test.ts` 又证明 replay API 已能基于这些上下文键暴露 `relationIndex`，并支持 `decisionId / nodeId / stage / eventKey` 级过滤。
- 因此，design 上可以把“replay -> audit / lineage 的上下文透传规则”从目标设计提升为已落地的最小实现：它不是完整消费闭环，但已经是稳定的 shared navigation keys 合同。

### 新增证据同时说明了哪些消费面已经具备

- `client/src/lib/tasks-store.ts` 与 `client/src/lib/tasks-store.autopilot.test.ts` 证明 client normalize 已能保留并透传：
  - `evidence.timeline`
  - `evidence.correlation.replayId / timelineId / routeIds / decisionIds / operatorActionIds / auditEventIds / lineageIds`
  - `explanation.currentState.correlationTimelineId`
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 证明任务详情页已经会把上述 correlation / timeline 信息展示为：
  - replay / workflow / session 引用
  - route / decision / operator / audit / lineage 计数
  - timeline preview 与 explanation 中的 timeline reference
- 这些证据说明“统一 evidence correlation 被任务详情消费”这件事已具备稳定 UI 闭环，但这仍属于 projection consumer 层，不等于 replay / audit / lineage 三个正式页面都已切换到统一证据主链。

### 仍需保持收紧的边界

- 仍不能把本 spec 表述成“replay 已消费统一自动驾驶时间线”：
  - `server/routes/replay.ts` 当前消费的是 replay store 的 execution timeline 与 relation index；
  - 不是 `autopilotSummary.evidence.timeline + route.evidence + takeover/recovery/result` 这一套统一自动驾驶证据对象；
  - 现有 direct tests 也没有覆盖“偏航、接管、结果切换如何在 replay 中展示”。
- 仍不能把本 spec 表述成“audit / lineage 已能回溯定位到驾驶时间线”：
  - 现在已成立的是共享 links 存在且 replay 可按这些键查询；
  - 还没有 direct code + direct test 证明 audit page 或 lineage consumer 能把某个 audit entry / lineage node 映射回统一 `timelineId + timeline item`。
- 仍不能把 `TrustProfile.redacted` 视为已落地：
  - shared type、client normalize、TaskAutopilotPanel 都接受 `redacted`；
  - 但没有 direct code + direct test 证明真实 redaction 事件产生，并导致 trust 降级与 UI 消费。
- 仍不能把 `auditEventIds / lineageIds` 视为稳定服务端产物：
  - client normalize 与 UI 测试会消费它们；
  - 但 mission autopilot builder 当前仍缺少正式填充逻辑与对应 server-side direct test。

### 本轮设计收口更新

- 扩围复核后，最准确的设计结论应更新为：
  - 仓内已落地“最小 evidence projection + 最小 correlation projection + replay/audit shared links + client evidence consumer”；
  - 其中 replay -> audit / lineage 的上下文透传键已具备直接代码和直接测试，可视为最小已实现能力；
  - 但 formal replay consumption、formal audit-lineage backtrace、tool/result evidence、redaction trust downgrade 仍属于目标设计，尚未由当前代码和测试坐实。

## 审计备注（2026-04-25，shared correlation 增强后复核）

- 本轮 design 复核新增纳入两份直接证据：`shared/mission/autopilot.ts` 与 `shared/__tests__/mission-autopilot.test.ts`。复核时同时参照现有 `server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`，但不额外扩大到其他未指定模块。

### 本轮新增坐实的最小设计事实

- `EvidenceCorrelationIndex` 这一层的 shared builder 现在已经具备“从现有 mission 决策事实中抽取 audit / lineage 相关键”的保守实现：
  - `shared/mission/autopilot.ts` 的 `buildEvidenceCorrelationIndex()` 会从 `mission.decision.payload` 与 `mission.decisionHistory[].payload` 中收集：
    - `auditEventIds / auditEntryIds / auditEntryId / auditId`
    - `lineageIds / lineageId`
    - 以及 `links / metadata / context / runtime / observability / approval / audit` 这些壳层里的同名键。
  - 该实现只读取 mission record 上已经存在的通用 payload facts，不扩展 `MissionProjectionLinks` 协议，也不假设不存在的数据源。
  - `shared/__tests__/mission-autopilot.test.ts` 直接证明上述 payload facts 会被去重后沉淀到 `evidence.correlation.auditEventIds / lineageIds`。
- 这说明当前设计里的 `EvidenceCorrelationIndex` 不再只是“预留 audit/lineage 槽位”，而是已经能在 shared builder 层承接一部分现成的 mission correlation facts。

### 为什么这仍不足以新增完成更多设计项

- 这次增强本质上仍然属于“相关键收集规则”强化，而不是新的证据对象模型落地：
  - 它没有引入统一 `AutopilotEvidenceChain / EvidenceItem / DriveTimelineEvent`；
  - 也没有把 `route.evidence`、`evidence.timeline`、`takeover`、`result` 统一折叠成一个共享 evidence object graph。
- 这次增强也不能外推为“audit / lineage 回溯规则已成立”：
  - 新代码只负责把可见的 `auditEventIds / lineageIds` 收集进 `correlation`；
  - 没有 direct code + direct test 证明 audit consumer 或 lineage consumer 能把某个 audit entry / lineage node 反查回统一 `timelineId + timeline item`；
  - 因此 “从 audit 记录和 lineage 节点回溯到驾驶时间线位置的定位规则” 仍然是目标设计。
- 这次增强同样不能外推为“replay 正式消费统一证据时间线已成立”：
  - `server/tasks/mission-projection.ts` 现阶段只是透传增强后的 `summary.evidence.correlation`；
  - `client/src/lib/tasks-store.ts` 与 `TaskAutopilotPanel.tsx` 及其测试只证明任务详情消费者能 normalize 并展示这些关联键；
  - 还没有 direct code + direct test 证明 replay 页面或 replay route 改为消费 `autopilotSummary.evidence.timeline + correlation` 这套统一自动驾驶证据时间线。
- 这次增强也不能单独证明“服务端 evidence trust chain 已完整闭环”：
  - 新 shared 测试覆盖的是 mission builder 从 decision payload/history payload 提取相关键；
  - 但没有直接覆盖真实 runtime observability / replay / audit 产物如何先进入 `MissionRecord`，再经 mission projection 稳定进入服务端接口响应；
  - 因而设计上仍应把这部分视为“可承接既有 mission facts 的增强型 correlation builder”，而不是完整 trust chain 的最终态。

### 本轮设计收口更新

- 经过这轮 shared correlation 增强复核，最准确的设计结论应进一步收紧为：
  - 当前已落地的是“最小 evidence projection + 增强型 `EvidenceCorrelationIndex` + replay/audit shared links + client evidence consumer”；
  - 其中增强型 correlation builder 已能从现有 decision payload/history payload 里承接 audit / lineage 关联键；
  - 但 formal replay consumption、formal audit-lineage backtrace、tool/result evidence、redaction trust downgrade 以及统一 `EvidenceChain / DriveTimelineEvent` 模型，仍然属于目标设计，而不是本轮代码已经完成的事实。
