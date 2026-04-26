# 设计文档：接管面板与决策点

## 设计目标

接管面板与决策点用于把任务自动驾驶从“全自动黑盒”变成“可看见、可解释、可接管”的协作系统。

设计目标：

- 统一澄清、路线确认、预算、权限、风险接受、交付验收、异常接管等用户介入场景。
- 复用现有 HITL / decision / approval / wait-resume 链路。
- 为 Route、Drive State、Mission Runtime 和审计系统提供一致的接管语义。
- 降低打断感，让接管像导航中的关键路口提示，而不是反复弹窗。

## 总体架构

```text
Route / Drive State / Runtime Event / Governance Signal
  -> Takeover Point Generator
  -> Takeover Queue
  -> Takeover Panel
  -> User Decision
  -> MissionDecision / Approval / Resume / Escalate
  -> Runtime Continue / Retry / Replan / Terminate
  -> Replay / Audit / Evidence
```

## 当前实现边界（2026-04-25）

当前主仓并未落地独立 `TakeoverQueue + TakeoverPanel` 单体架构，而是以“分布式 surface 复用”的方式提供最小接管能力：

```text
MissionDecision / waiting mission
  -> DecisionPanel（当前接管输入）
  -> submitMissionDecision()
  -> resolveWaiting / resume / decisionHistory

MissionAutopilotSummary
  -> TaskAutopilotPanel（takeover / route / recovery / evidence 摘要）
  -> TaskDetailView / cockpit workspace

DecisionHistoryEntry / evidence.timeline / audit slice / replay query
  -> DecisionHistory / TaskAutopilotPanel / replay routes
```

这意味着本 spec 当前只把以下事实视为已收口：

- 有一个稳定的 takeover 读模型；
- 有一个稳定的 decision 输入 surface；
- 有一个稳定的 summary / evidence 展示 surface；
- 有一个稳定的 decision history / audit / replay 最小切片。

其中需要特别区分两层“闭环”：

- 当前已经稳定成立的是 `decision submit -> decision history -> shared summary / projection` 闭环；
- 当前尚未稳定成立的是 `decision submit -> planner/runtime 内部真实 mutation / replan action` 闭环。

以下仍视为后续增强，而不是当前实现：

- 独立 `TakeoverQueue`；
- 统一 takeover panel 单组件；
- 推荐默认动作区；
- timeout policy 与默认动作自动执行；
- permission / risk / delivery / exception 的专门面板体验；
- 路线选择提交后的真实 route mutation / replan action。

## 模型设计

### TakeoverPoint

```ts
type TakeoverPoint = {
  id: string;
  type: TakeoverType;
  status: TakeoverStatus;
  required: boolean;
  title: string;
  description: string;
  reason: string;
  severity: "info" | "warn" | "danger" | "critical";
  routeId?: string;
  routeStepId?: string;
  missionId?: string;
  workflowId?: string;
  runtimeNodeId?: string;
  trigger: TakeoverTrigger;
  options: TakeoverOption[];
  defaultOptionId?: string;
  timeoutPolicy?: TakeoverTimeoutPolicy;
  evidenceRefs: string[];
  createdAt: string;
  resolvedAt?: string;
};
```

### 当前主仓最小 TakeoverPoint 读模型

当前代码真正稳定存在的是 `MissionAutopilotSummary.takeover` 这一最小读模型，而不是上面这份完整未来态实体。可保守视为当前 `TakeoverPoint` 最小实现切片的字段包括：

```ts
type CurrentTakeoverPointReadModel = {
  status: "pending" | "required" | "advisory" | null;
  required: boolean;
  blocking: boolean;
  type: "clarification" | "approval" | "budget" | "route-selection" | "exception" | "operator" | null;
  reason: string | null;
  prompt: string | null;
  decisionId: string | null;
  options: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  urgency: "low" | "medium" | "high";
};
```

配套锚点：

- `route.takeoverPointIds` 负责 Route 侧锚定；
- `DecisionHistoryEntry.prompt / options / resolved` 负责历史回看；
- `evidence.timeline(kind=takeover)` 与 `evidence.correlation.decisionIds` 负责 replay / projection 侧锚定。

### TakeoverType

```ts
type TakeoverType =
  | "clarification"
  | "route_confirmation"
  | "budget_confirmation"
  | "permission_confirmation"
  | "risk_acceptance"
  | "delivery_acceptance"
  | "exception_takeover";
```

### TakeoverStatus

```ts
type TakeoverStatus =
  | "pending"
  | "active"
  | "resolved"
  | "skipped"
  | "expired"
  | "escalated"
  | "cancelled";
```

### TakeoverOption

```ts
type TakeoverOption = {
  id: string;
  label: string;
  description: string;
  action: TakeoverAction;
  severity?: "info" | "warn" | "danger";
  requiresComment?: boolean;
  payload?: Record<string, unknown>;
};
```

### TakeoverAction

```ts
type TakeoverAction =
  | "answer"
  | "approve"
  | "reject"
  | "select_route"
  | "adjust_budget"
  | "grant_permission"
  | "accept_risk"
  | "request_revision"
  | "retry"
  | "replan"
  | "escalate"
  | "terminate"
  | "resume";
```

设计约束：

- `TakeoverAction` 是接管点动作语义的统一枚举，不要求与当前所有代码分支一一同名，但要求能稳定映射到 `MissionDecision`、runtime control 或治理写回结果。
- `answer / approve / reject / select_route / adjust_budget / grant_permission / accept_risk / request_revision` 用于表达用户显式决策语义。
- `retry / replan / escalate / terminate / resume` 用于表达接管后的运行时控制语义。
- 同一 `TakeoverOption` 只能绑定一个主动作；若需要同时写回治理数据与触发运行时动作，应通过 `payload` 明确附带补充上下文，而不是隐式多跳。

### TakeoverTimeoutPolicy

```ts
type TakeoverTimeoutPolicy = {
  mode:
    | "wait_forever"
    | "remind_then_wait"
    | "auto_apply_default"
    | "escalate"
    | "terminate";
  timeoutMs?: number;
  reminderIntervalsMs?: number[];
  defaultOptionId?: string;
  auditReason: string;
};
```

策略约束：

- `wait_forever` 用于高风险、外部副作用或必须由用户承担责任的接管点。
- `remind_then_wait` 用于允许催办但不允许系统代替决定的场景。
- `auto_apply_default` 只能用于低风险、非阻塞、已有 `defaultOptionId` 且已声明后果的场景。
- `escalate` 用于长时间无响应但不能静默继续的权限、预算或异常场景。
- `terminate` 仅用于用户或治理预先授权的硬失败策略，不能作为默认低风险兜底。

## 接管队列

接管面板不应只处理单个弹窗，而应维护一个 Takeover Queue。

```ts
type TakeoverQueue = {
  missionId: string;
  activeTakeoverId?: string;
  pendingIds: string[];
  resolvedIds: string[];
  blockedRuntime: boolean;
};
```

队列规则：

- 必须接管优先级高于建议接管。
- `critical` 高于 `danger`，高于 `warn`，高于 `info`。
- 同一 Route Step 下的低风险确认可以合并展示。
- 运行时阻塞类接管会将 `blockedRuntime` 设为 `true`。
- 非阻塞建议接管可以在右侧面板提示，不中断中间执行视图。

## 接管面板信息架构

接管面板建议放在任务自动驾驶三栏驾驶舱右侧，同时可在任务详情页复用。

面板区域：

- 当前接管：展示最需要处理的接管点。
- 决策上下文：展示为什么需要接管、关联路线步骤、影响范围。
- 可选动作：展示按钮、输入框、路线卡片、预算输入或权限范围。
- 推荐默认：展示系统推荐动作和理由。
- 风险与证据：展示风险说明、证据引用、审计提示。
- 历史接管：展示已处理的接管时间线。

### 当前主仓的最小复合式信息架构

当前已经稳定落地的信息架构，不是一个单独的 takeover panel，而是下面这组组合：

- `DecisionPanel`
  - 当前接管区域
  - 决策上下文区域
  - 可选动作区域
- `TaskAutopilotPanel`
  - takeover 摘要
  - route diff / recovery / explanation / evidence 摘要
- `DecisionHistory`
  - 通用 decision history slice

因此本轮只把“当前接管区域 / 决策上下文区域 / 可选动作区域”视为 `DecisionPanel` 已落地的信息架构分区；而“风险与证据区域”“历史接管时间线区域”仍归于组合式详情视图，不等于统一 takeover panel 已完成。

### 推荐默认动作区域合同

推荐默认动作区域用于表达“如果用户不接管，系统最安全的继续方式是什么”，字段至少包括：

- `recommendedOptionId`：系统建议采用的 `TakeoverOption`。
- `recommendationLabel`：对外展示的推荐动作名称。
- `recommendationReason`：为什么建议这样做，必须是人类可读说明，而不是只有分值。
- `consequenceIfIgnored`：用户不接管时系统将如何处理。
- `timeoutPolicyRef`：若存在超时策略，必须展示对应策略摘要。
- `safetyGuardrails`：推荐动作依赖的风险边界、预算边界或权限边界。

该区域属于统一 takeover panel 的目标信息架构；当前主仓尚未形成稳定 recommendation block，但 spec 侧已明确其字段合同。

### 历史接管时间线区域合同

历史接管时间线不是简单复用通用 decision history，而是面向 takeover 语义的聚合视图，最少应展示：

- `occurredAt`：接管创建或展示时间。
- `takeoverType`：澄清、路线、预算、权限、风险、交付或异常。
- `promptSnapshot`：用户当时看到的核心提示文案。
- `optionsSnapshot`：当时可选动作集合。
- `resolvedSnapshot`：用户选择、补充说明与最终状态。
- `anchors`：`decisionId / routeId / stageKey / nodeId / replayId` 等跳转锚点。
- `followUpAction`：接管后触发的 `resume / retry / replan / escalate / terminate`。

当前主仓只有 `DecisionHistory + evidence timeline` 的最小切片；但 spec 已把 takeover 专用时间线区域的目标合同定义清楚。

## 各类型设计

### 澄清

触发来源：

- Destination 缺少成功标准。
- 用户目标存在歧义。
- Route Planner 无法选择可靠路线。
- Runtime 需要额外输入才能继续。

UI 表达：

- 问题说明。
- 系统推断的默认答案。
- 单选、多选、自由文本或上下文选择。
- “使用默认并继续”动作。

Runtime 映射：

- `waiting`
- `WAITING_INPUT`
- `resume(payload)`
- `request-info` 类型 decision

交互与治理契约：

- 单选澄清用于“系统已给出候选答案，需要用户在候选中确认”的场景；提交结果至少保留 `optionId / optionLabel / reason`。
- 多选澄清用于“可并行补充多个约束或素材”的场景；设计上允许单个 takeover 返回数组型 `selectedOptionIds`，并在 history 中保留选项快照。
- 自由文本澄清用于“候选项不足以表达补充信息”的场景；空文本、全空白文本或未授权自由文本的提交必须被拒绝。
- 文件/上下文引用补充至少要支持 `attachmentRefs / contextRefs / metadata` 三类输入。
- “使用默认并继续”只适用于已经给出显式默认答案、且默认继续不会产生高风险外部副作用的澄清点。

### 路线确认

触发来源：

- 存在多条候选路线。
- 路线差异会显著影响成本、质量、风险或时长。
- 用户偏好未知。

UI 表达：

- 快速 / 标准 / 深度路线对比。
- 每条路线展示时间、成本、风险、接管次数、预期质量。
- 推荐路线高亮。

Runtime 映射：

- route selection decision。
- 当前阶段会在 `submitMissionDecision()` / `decisionHistory` 中写入：
  - `selectedRouteOptionId`
  - `selectedRouteLabel`
  - `selectedRouteId`
  - `changedReason`
- shared / projection 会把这些事实提升成：
  - `selectedRouteId`
  - `selection.status = user-selected`
  - `route.evidence[eventType = route.selected]`
- 上述提升表示 authoritative route summary / projection 已被更新，可稳定供 `tasks-store`、`TaskAutopilotPanel` 与 `/projection` 消费。
- 真正的 route mutation 与自动 replan action 仍未形成稳定闭环；当前没有直接代码 + 直接测试证明同一条 takeover decision 提交已经改写 planner 内部 Route 状态或触发 runtime replan mutation。

### 预算确认

触发来源：

- 预计成本超出默认阈值。
- 需要长时间执行。
- 需要高成本模型、浏览器、外部工具或多轮生成。

UI 表达：

- 预计成本。
- 成本来源。
- 最大预算输入。
- 低成本路线选项。

Runtime 映射：

- cost governance。
- runtime governance budget。
- approval decision。

交互与治理契约：

- 预计成本至少拆分为 `model / browser / tool / executor / retryAllowance` 五类来源；缺少精确数值时，也必须给出区间或等级。
- 成本来源必须同时说明 `sourceType / estimateBasis / confidence`，避免只有总成本没有来源语义。
- 最大预算输入至少支持 `hardCap / softCap / currentTaskCap` 三种模式，其作用域默认限制在当前 mission。
- 低成本路线必须是一等动作，不是说明文案；用户选择后需要保留 `lowCostPreference` 或等价 route preference。
- budget 提交的治理写回合同至少包含 `approvedCap / approvedScope / selectedAction / decisionId`。
- budget 审计快照至少包含 `estimatedRange / costSources / approvedCap / selectedAction / submittedBy / submittedAt`。
- 当前主仓尚未完成上述治理写回与审计 UI，但 spec 侧已经把目标合同定义清楚。

### 权限确认

触发来源：

- 文件访问。
- 网络访问。
- 外部 API。
- 沙箱执行。
- 浏览器控制。
- 高权限工具。

UI 表达：

- 权限名称。
- 使用目的。
- 权限范围。
- 有效期。
- 风险说明。

Runtime 映射：

- permission / capability check。
- approval decision。
- grant / deny payload。

交互与治理契约：

- 权限确认最少展示 `capabilityKey / purpose / requestedScope / effectiveDuration / riskSummary`。
- 权限范围至少区分 `一次性授权`、`当前任务授权` 与 `拒绝并升级人工` 三类结果。
- 高风险权限不得绑定 `auto_apply_default`；默认策略只能是 `wait_forever` 或 `escalate`。
- permission 提交必须映射到现有 `permission / capability / approval` 链路，而不是创建平行审批体系。
- permission 审计快照至少包含 `capabilityKey / purpose / scope / selectedAction / submittedBy / submittedAt / escalationRef?`。

当前主仓只在 runtime / approval 侧有局部事实链；上面这些定义用于收口 spec 设计合同，不代表任务详情闭环已经落地。

### 风险接受

触发来源：

- 数据可信度不足。
- 质量不确定。
- 策略敏感。
- 结果可能影响真实业务。
- 工具失败概率高。

UI 表达：

- 风险类型。
- 严重程度。
- 缓解方案。
- 接受风险的确认输入。

Runtime 映射：

- audit evidence。
- risk governance。
- decision history。

交互与治理契约：

- 风险接受卡片至少展示 `riskType / severity / triggerCondition / mitigationPlan / supportingEvidenceRefs`。
- 用户动作至少包括 `accept_risk / lower_risk_route / request_more_evidence / terminate`。
- `severity = danger | critical` 时必须要求 `requiresComment = true` 或等价确认文本。
- 若用户选择“降低风险路线”，需保留新的 route preference 或 fallback policy。
- risk 审计快照至少包含 `riskType / severity / mitigationPlan / selectedAction / comment / evidenceRefs`。

当前主仓尚未形成专门 risk takeover 面板；但 spec 已定义其信息结构、动作集合与审计合同。

### 交付验收

触发来源：

- Route 到达交付阶段。
- Review / Verify 完成。
- 系统建议结束任务。

UI 表达：

- 结果摘要。
- 成功标准覆盖情况。
- 未解决问题。
- 接受交付 / 继续修正 / 深度复核。

Runtime 映射：

- mission completion。
- revise / retry / replan。
- result acceptance decision。

交互与治理契约：

- 交付验收至少展示 `resultSummary / successCriteriaCoverage / unresolvedIssues / recommendedNextStep`。
- 用户动作至少包括 `accept_delivery / request_revision / request_deeper_review / save_draft / terminate`。
- 若用户要求继续修正，需保留 `revisionReason / revisedScope / preferredRouteDepth`。
- 验收写回合同至少包含 `acceptanceStatus / nextStep / decisionId / submittedBy / submittedAt`。
- 交付验收的 mission 状态映射应至少区分 `accepted / revision_requested / draft / terminated`。

当前主仓尚未形成专门 delivery takeover surface；但 spec 已收口其卡片内容、动作集合与状态写回合同。

### 异常接管

触发来源：

- 工具失败。
- runtime retry budget 耗尽。
- 质量检查失败。
- 任务偏航。
- 治理策略阻断。
- 人工升级。

UI 表达：

- 出错位置。
- 已尝试恢复动作。
- 推荐恢复策略。
- 重试、换路线、跳过、升级、终止。

Runtime 映射：

- `retry()`
- `escalate()`
- `terminate()`
- `resume()`
- replan record

交互与治理契约：

- 异常接管至少展示 `failureLocation / failureReason / attemptedActions / impactScope / recommendedRecoveries`。
- `impactScope` 至少覆盖 `当前节点 / 当前阶段 / 当前路线 / 整个 mission` 四个粒度。
- 恢复动作至少包括 `retry / switch_route / downgrade_execution / skip_non_critical / escalate / terminate`。
- 若用户选择换路线，应保留 `fallbackRouteId` 或等价路由偏好，而不是只写自然语言说明。
- 若用户选择跳过非关键步骤，应显式列出被跳过步骤和预期副作用。

当前主仓已具备 recovery summary 与 runtime control 最小链路，但尚未形成稳定的 `takeover.type = exception` 主链合同；上面内容是异常接管的设计收口，而不是实现完成声明。

## 与现有 HITL / decision 的兼容

TakeoverPoint 应映射到现有 `MissionDecision` 或兼容扩展。

```ts
type TakeoverDecisionMapping = {
  takeoverPointId: string;
  missionDecisionId?: string;
  decisionType: string;
  submitEndpoint?: string;
  resumePayload?: Record<string, unknown>;
  approvalRef?: string;
};
```

兼容原则：

- 不绕开 `submitMissionDecision()` 的幂等提交语义。
- 不绕开现有 `MissionStore.markWaiting()` / `resolveWaiting()`。
- 对 workflow runtime 的 `WAITING_INPUT` 使用 `resume(payload)`。
- 对需要人工升级的场景使用 `escalate()`。
- 对失败恢复使用现有 `retry / terminate` 控制面。

## 状态流转

```text
pending
  -> active
  -> resolved

pending
  -> active
  -> escalated

pending
  -> active
  -> expired

pending
  -> skipped

active
  -> cancelled
```

状态说明：

- `pending`：已生成，等待展示或排队。
- `active`：当前正在要求用户处理。
- `resolved`：用户已提交有效决策。
- `skipped`：建议接管被系统默认动作跳过。
- `expired`：超时后按策略处理。
- `escalated`：升级到人工或更高权限。
- `cancelled`：Route 或 Mission 变化导致接管点失效。

## 审计与回放

每个接管点应记录：

- 生成原因；
- 展示给用户的内容；
- 用户看到的选项；
- 用户选择；
- 用户补充说明；
- 触发的 runtime action；
- 关联证据；
- Route / Mission / Workflow / Runtime Event 关联键。

### 接管生成原因合同

```ts
type TakeoverGenerationReason = {
  source:
    | "route_gap"
    | "budget_threshold"
    | "permission_check"
    | "risk_policy"
    | "delivery_gate"
    | "runtime_exception"
    | "operator_request";
  triggerKey: string;
  summary: string;
  blocking: boolean;
  relatedIds?: {
    routeId?: string;
    stageKey?: string;
    nodeId?: string;
    policyId?: string;
  };
};
```

该合同用于回答“为什么在这里把方向盘交还给用户”，与 `prompt` 不同，它记录的是生成因果，而不是展示文案。

### 专门治理快照合同

为了支持预算、权限和风险接受的专门审计展示，统一定义以下快照切片：

```ts
type TakeoverGovernanceSnapshot = {
  kind: "budget" | "permission" | "risk";
  headline: string;
  details: Record<string, unknown>;
  selectedAction: string;
  comment?: string;
  evidenceRefs?: string[];
};
```

按类型最少保留：

- budget：`estimatedRange / costSources / approvedCap / selectedRoutePreference`
- permission：`capabilityKey / requestedScope / purpose / approvalScope`
- risk：`riskType / severity / mitigationPlan / evidenceRefs`

### 当前主仓已稳定存在的最小记录切片

当前实际稳定的记录合同收口到以下字段：

- `DecisionHistoryEntry.prompt`
- `DecisionHistoryEntry.options`
- `DecisionHistoryEntry.resolved.optionId / optionLabel / freeText`
- `DecisionHistoryEntry.submittedBy / submittedAt / reason`
- `DecisionHistoryEntry.nodeId / nodeType / sessionId / interactionId / branchKey`
- `MissionAutopilotSummary.evidence.timeline`
- `MissionAutopilotSummary.evidence.correlation`
- `human.decision_submitted / human.param_collection_submitted`
- runtime control events mirrored into replay / audit

这些字段当前分别落在三类 surface / 通道中：

- `DecisionHistoryEntry.*` 进入 `DecisionHistory`，提供通用 decision history slice；
- `evidence.timeline / evidence.correlation` 进入 `TaskAutopilotPanel` 与 `/projection`，提供最小 replay / correlation slice；
- `human.decision_submitted` 与 runtime control event 进入 audit / observability collector，提供最小审计事实。

当前仍未形成统一历史合同的内容包括：

- 推荐默认动作；
- takeover 生成因果模型；
- 专门的 takeover risk/evidence 文案快照；
- 预算 / 权限 / 风险接受的专门 audit UI。

replay 表达：

- 当前阶段只要求在 evidence timeline / replay query 中标记“系统请求接管”。
- 当前阶段可以展示用户选择后的 authoritative route summary 如何继续，而不是承诺真实 Route 图已经同步变更。
- 当前阶段可以展示异常接管是否导致 `retry / replan / escalate / terminate` 等 runtime control 事件进入回放。

audit 表达：

- 当前阶段只要求 decision submit 与 runtime control event 拥有最小 audit slice。
- 预算、权限、风险接受的专门 takeover audit 展示仍是目标合同，不外推为当前主仓已有专门 UI。
- 高风险动作必须保留 reason/comment；默认动作若将来落地，也必须记录为什么允许默认继续。

## 降低打断策略

接管面板应遵循以下策略：

- 低风险建议接管不阻塞 runtime。
- 多个同类低风险确认合并展示。
- 系统可推断的问题提供默认答案。
- 关键路线选择、预算、权限、风险接受必须显式确认。
- 超时策略只能用于低风险或已有默认授权的场景。

规则收口：

- 建议接管不阻塞：只有 `required = false` 且 `blocking = false` 的接管点可以沉入摘要区，不中断主执行视图。
- 低风险合并：仅当多个接管点同属一个 route step、同一接管类型且风险等级不高于 `warn` 时，才允许合并展示。
- 默认动作可用条件：必须同时满足 `defaultOptionId` 已声明、`TakeoverTimeoutPolicy.mode = auto_apply_default`、无高风险外部副作用、且能生成审计理由。
- 高风险显式确认：预算超限、权限放行、风险接受、交付验收和异常终止默认都需要用户显式点击确认。
- 超时策略适用范围：`auto_apply_default` 仅用于低风险澄清与非阻塞建议；`escalate` 用于长期无响应但不能静默继续的场景。

## 测试计划

本 spec 的测试计划按“合同层 -> 投影层 -> 界面层 -> 审计/回放层”组织，避免只测展示不测治理写回。

### 类型覆盖矩阵

- 澄清：覆盖单选、多选、自由文本、附件/上下文引用、默认继续与 `WAITING_INPUT -> resume`。
- 路线确认：覆盖 candidate routes、route diff、selected route authoritative projection，以及 mutation/replan 缺口的回归守卫。
- 预算确认：覆盖预计成本、成本来源、最大预算输入、低成本路线切换、governance snapshot 与 audit snapshot。
- 权限确认：覆盖 capability 展示、一次性授权、任务级授权、拒绝、人工升级，以及 permission / approval 映射。
- 风险接受：覆盖风险类型、严重程度、更多证据请求、降低风险路线、高风险 comment 要求。
- 交付验收：覆盖结果摘要、成功标准覆盖、未解决问题、接受/修正/深度复核/草稿/终止。
- 异常接管：覆盖失败原因、影响范围、切换路线、跳过非关键步骤、retry/escalate/terminate/resume。

### 分层断言要求

- shared / contract：覆盖 `TakeoverPoint / TakeoverAction / TakeoverTimeoutPolicy / TakeoverGenerationReason` 等类型合同与 projection builder。
- server / workflow：覆盖 `submitMissionDecision()`、governance writeback、approval / resume / retry / terminate 链路。
- client / surface：覆盖 `DecisionPanel / TaskAutopilotPanel / DecisionHistory` 的区域渲染、动作提交和时间线可见性。
- audit / replay：覆盖 takeover 事件、governance snapshot、runtime control event 与 replay 查询锚点。

## 非目标

- 不在本 spec 中实现多人投票审批。
- 不在本 spec 中替代完整 BPMN 审批流。
- 不在本 spec 中接入第三方审批系统。
- 不在本 spec 中重构所有 MissionDecision 底层存储。
- 不在本 spec 中承诺开放域 L5 全自动无需接管。

## 实现审计（2026-04-24）

基于当前主仓代码、面板展示与测试覆盖，本 spec 可保守确认以下最小闭环已经存在：

- takeover 最小契约已经稳定存在于 `MissionAutopilotSummary.takeover`：
  - `status`
  - `required`
  - `blocking`
  - `type`
  - `reason`
  - `prompt`
  - `decisionId`
  - `options`
  - `urgency`
- waiting decision 已形成最小交互闭环，但现阶段仍是分布式 surface：
  - `TaskDetailView.tsx` 在 waiting mission 下挂载 `DecisionPanel`
  - `DecisionPanel.tsx` 支持 `multi-choice`、`request-info`、`escalate`、`allowFreeText`、`requiresComment`
  - 其中 `multi-choice` 当前实现为 `radiogroup` 单选卡片，不应外推成真正的“多选澄清”
  - `request-info` 下的 `param_collection` 已支持结构化字段、附件引用、附件 metadata 的最小输入 surface
  - `client/src/components/tasks/__tests__/DecisionPanel.param-collection.test.ts` 已覆盖 `param_collection` 附件引用归一化、单选 `selection` 字段归一化与字段级错误
  - `server/tests/workflow-runtime-engine.test.ts` 已覆盖带必填 `selection` 字段的 `param_collection` 在 `WAITING_INPUT -> resume(formData)` 后继续执行
  - `server/tests/hitl-decision.test.ts` 已覆盖 `submitMissionDecision()` 的多选提交、freeText、requiresComment 校验，以及 `param_collection` 附件 payload 进入 resolved metadata 与 decision history
  - 因此当前可以确认“单选式澄清 / 结构化参数补充 / 决策点提交 / 决策历史写入”的最小事实链，但不能把它等同为完整统一 takeover panel
- 预算确认类接管也已经形成最小只读闭环：
  - `shared/__tests__/mission-autopilot.test.ts` 的 waiting mission 场景直接断言了 `takeover.type = budget`
  - 同时断言了 `prompt / decisionId / options / route.takeoverPointIds`
  - 还断言了 budget waiting 下的 `execution.availableActions = wait / resume / replan`
  - 这说明 budget approval 已经具备最小字段与动作建议投影，但不代表预算输入、预算治理回写和审计记录已经完成
- 路线确认类接管的最小展示闭环已经存在：
  - shared `candidateRoutes`
  - client store 归一化 `selectionStatus / selection / evidence / replan`
  - `TaskAutopilotPanel` 展示 `fast / standard / deep`
  - `TaskAutopilotPanel` 展示 `Route Diff`
- 与现有 HITL / decision 的兼容层已经有直接代码承接：
  - `submitMissionDecision()` 幂等提交
  - `MissionStore.markWaiting()` / `resolveWaiting()`
  - `MissionOrchestrator.submitDecision()`
  - `POST /api/tasks/:id/decision`
  - Web-AIGC runtime 的 `WAITING_INPUT -> resume()`
  - Web-AIGC runtime 的 `escalate()`
- TakeoverPoint 到 MissionDecision 的最小映射测试也已经存在：
  - `shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 已断言 `takeover.decisionId` 与 `route.takeoverPointIds`
  - `server/tests/mission-routes.test.ts` 已覆盖 waiting decision summary 投影与 `POST /api/tasks/:id/decision` 提交后恢复任务
  - `server/tests/hitl-decision.test.ts` 已覆盖 decision history 记录与多步 decision chain
  - 当前这条映射更接近“`MissionDecision -> takeover summary / route takeover ids` 的最小投影链”，而非独立 `TakeoverPoint` 实体存储
- 接管记录的最小历史 / 回放闭环已经存在，但仍停留在 projection 与 decision history 级别：
  - `server/tasks/mission-decision.ts` 会把 `resolved.optionId / optionLabel / freeText / nodeId / nodeType / sessionId / interactionId / branchKey` 写入 `DecisionHistoryEntry`
  - 同一条 `DecisionHistoryEntry` 还会保留 `options: prompt?.options ?? []`，因此用户当时可选的最小动作集合不会在 mission 恢复后完全丢失
  - 同一条 `DecisionHistoryEntry` 还会保留 `prompt`，因此用户当时看到的核心决策文案不会在 mission 恢复后完全丢失
  - `DecisionHistory.tsx` 会按时间顺序展示 `prompt / selected option / reason`，其中补充说明优先取 `entry.resolved.freeText || entry.reason`
  - `server/routes/tasks.ts` 的 `GET /api/tasks/:id/decisions` 会直接返回这些 history entries，因此 options/prompt 至少能经由 API history slice 被查询和回放
  - `server/tests/mission-routes.test.ts` 已断言 waiting decision 会进入 `/projection` 的 `autopilotSummary.evidence.timeline`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 evidence timeline 在 `TaskAutopilotPanel` 中的最小显示
  - `server/tests/hitl-decision.test.ts` 已断言 comment-required 提交时 `decision.freeText` 被保留；`server/tests/hitl-decision.property.test.ts` 也覆盖了 `resolved.freeText` 的序列化保真
  - `server/tests/hitl-decision.test.ts` 与 `server/tests/mission-routes.test.ts` 还分别覆盖了 waiting decision prompt 与 `autopilotSummary.takeover.prompt`，这意味着“展示给用户的核心 prompt 文案”已经能在 history / projection 两条线上保留下来
  - 因此当前可以确认“接管事件可被投影进 evidence timeline、用户看到的 prompt 文案、当时 options 集合、用户选择与补充说明可进入 decision history”的最小 replay/history slice，但不能把它等同为完整 audit / replay 体系
- 接管记录的最小 audit / observability 链也已经存在：
  - `server/tests/hitl-decision.test.ts` 已覆盖 `human.decision_submitted` 与 `human.param_collection_submitted` audit entry，其中 metadata 包含 `decisionId / nodeId / nodeType / submittedBy / optionId / optionLabel / freeText / interactionId / branchKey`
  - `server/tests/web-aigc-runtime-observability.test.ts` 已覆盖 `instance.retry_requested / instance.escalated / instance.terminated` 同时进入 replay collector 与 audit collector
  - `server/tests/replay-routes.test.ts` 已覆盖 replay 路由按 `decisionId / traceId / nodeId / eventKey` 查询 `human.decision_submitted` 等接管相关事件
  - 因此当前可以确认“decision submit 的用户选择、补充说明，以及 runtime control action 会被记录进 audit/replay”的最小事实链，但还不能把它等同为完整 takeover audit UI
- 关联键的最小 correlation slice 也已经存在：
  - `shared/mission/autopilot.ts` 与 `shared/__tests__/mission-autopilot.test.ts` 已构建并断言 `evidence.correlation.missionId / workflowId / replayId / sessionId / routeIds / routeStageKeys / runtimeEventIds / decisionIds / operatorActionIds`
  - `server/tests/mission-routes.test.ts` 已断言这些 correlation 字段会经 `/projection` 返回
  - 这说明 Route / Mission / Workflow / Runtime Event 已能通过 autopilot projection 的 correlation index 被最小关联，但 `auditEventIds / lineageIds` 仍主要停留为空数组或保留位
- 异常接管的最小只读闭环也已经存在：
  - `MissionAutopilotSummary.recovery.reason` 可直接投影失败原因
  - `MissionAutopilotSummary.recovery.attemptedActions` / `suggestedActions` 可直接投影已尝试恢复动作与建议动作
  - `TaskAutopilotPanel` 测试已覆盖 recovery block 的失败原因、已尝试动作、建议动作展示
  - `OperatorActionBar.tsx` 与 `OperatorActionBar.test.tsx` 已覆盖 blocked / paused / failed 状态下的 `resume / retry / escalate / terminate / mark-blocked`
  - `server/tests/workflows-routes.test.ts` 与 `server/tests/workflow-runtime-engine.test.ts` 已覆盖 `retry()`、`escalate()`、`terminate()`、`resume()` 这组异常恢复相关 runtime action 的最小控制事实链

当前还需要明确区分的一点是：

- 现有实现已经有 `TaskAutopilotPanel` takeover block、`DecisionPanel`、`DecisionHistory`、`OperatorActionBar` 四类 surface
- 但它们还没有收敛为单一“Takeover Panel”组件，也没有形成 `TakeoverQueue`、推荐默认动作区域、风险与证据区域、历史接管时间线的统一信息架构
- 因此本轮只把“字段投影 + decision 提交 + recovery 动作”这类最小闭环认定为 done，不把更高层面板架构或 replay / audit 闭环外推为已完成
- 同时还需要额外注意：
  - 当前“澄清类接管”里最稳妥已落地的是单选式 decision 选择与 `param_collection`/附件补充，不是完整澄清类型全集
  - `RequestInfoLayout` 虽然存在 free-text input surface，`DecisionPanel.tsx` 也确实会通过 `handleSubmitFreeText -> submitMissionDecision({ freeText })` 走 free-text-only 提交分支，服务端 `submitMissionDecision()` 亦会在 `allowFreeText !== true` 时阻止这一路径；但当前测试仍主要覆盖 `requiresComment + freeText`、序列化保真与通用 `allowFreeText` 校验，没有把它收敛成“clarification 型 request-info 已经端到端验证”的定向事实链，因此仍不将“自由文本澄清”判定为 done
  - `DecisionHistory` 是通用决策历史，而不是 takeover 专用时间线；`TaskAutopilotPanel` 的 timeline 也是 evidence projection，而不是专门的 takeover replay 视图
  - 现有 audit / replay 事实主要停留在 collector、route query、projection correlation 与任务详情最小展示层，还没有汇聚成 takeover 专用的审计面板或统一回放视图
  - 本轮仅将“用户补充说明被写入 history + audit metadata”认定为最小接管记录能力，不外推为“展示给用户的内容”“可选动作全集”或统一回放面板已完成
  - 本轮虽然补勾了“记录展示给用户的内容”和“记录用户可选动作”，但范围仍严格限定在 `DecisionHistoryEntry.prompt` 与 `DecisionHistoryEntry.options` 这类核心 decision slice；推荐默认动作、风险/证据说明、推荐路线卡片与更完整的 panel 内容仍未形成统一历史记录
  - workflow runtime、transaction flow、MCP/permission 治理侧虽然已经有 `approval_required -> node.waiting_input -> human.approved` 的最小等待/恢复语义与审计测试，但这些事实还没有稳定投影回任务详情页上的 `MissionAutopilotSummary.takeover / DecisionPanel / DecisionHistory / TaskAutopilotPanel` 闭环，因此本轮仍不把它们外推成“权限确认类接管体验”已完成

本轮仍未把以下内容认定为已完成实现：

- 路线选择后真正提交更新 Route
- 路线选择后触发真实 replan mutation
- 接管记录进入 replay / audit 的统一时间线展示
- 权限、风险、交付验收、异常接管的专门面板体验
- 异常接管里的直接动作提交按钮与完整影响范围面板

因此本 spec 的勾选仍维持“展示与兼容层已闭环、动作闭环仍未完成”的保守口径。

### 实现续审（2026-04-25）

本轮继续围绕 `DecisionPanel`、`TaskAutopilotPanel`、`DecisionHistory`、`OperatorActionBar`、`mission-routes`、`hitl-decision`、`replay-routes` 与 workflow runtime approval 相关测试做保守复核，结论是不新增 checkbox，原因如下：

- `approval_required / human.approved / permission governance` 的 runtime 事实链仍主要停留在 `workflow-runtime-engine.test.ts`、transaction/vector adapters 与 governance 输出层；它们还没有稳定收敛到任务详情页可消费的 `MissionAutopilotSummary.takeover + DecisionPanel + DecisionHistory + TaskAutopilotPanel` 合同，因此不能把“权限确认类接管体验”或对应测试计划写成已完成。
- route/takeover 当前已能稳定表达 `candidateRoutes / selectedRouteId / selectionStatus / switchRequiresConfirmation / route.replan / Route Diff`，但现有代码与测试仍更偏只读 projection 和 UI 消费，没有直接锚定“用户在 takeover decision 中做出路线选择后，Route 状态被真实更新”或“同一交互会触发真实 replan mutation”的闭环。
- 接管记录当前已能保留核心 decision slice：`prompt`、`options`、`resolved.optionId / optionLabel / freeText`、以及 replay/projection 中的 takeover timeline item；但“接管点生成原因”的统一生成模型、推荐默认动作、风险说明和完整 takeover panel 内容还没有形成稳定历史记录合同。
- `TaskAutopilotPanel` 的 approval fixture、`shared/mission/autopilot.ts` 的 `approval / permission / risk-acceptance / delivery-review` 类型枚举，以及若干 runtime approval 测试只能证明这些语义在局部存在；它们还不足以证明专门的 approval/permission/risk/delivery takeover 面板体验已经落地。

因此本 spec 仍保持当前保守边界：

- 已完成的是最小字段投影、decision/HITL 兼容、decision history 留痕、replay/audit 最小切片、以及异常恢复动作控制面。
- 未完成的仍是统一 takeover panel 信息架构、approval/permission/risk/delivery 专门体验、路线选择后的真实 mutation 闭环、以及面向 takeover 语义的完整 audit/replay 展示面。

### lane 1 续审（2026-04-25）

本轮按 lane 1 约束重新串查 `DecisionPanel.tsx`、`TaskAutopilotPanel.tsx`、`TaskDetailView.tsx`、`DecisionPanel.param-collection.test.ts`、`TaskAutopilotPanel.test.tsx`、`tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts` 与 `server/tests/workflow-runtime-engine.test.ts` 后，结论仍是“不新增 checkbox，只补中文审计边界说明”，核心原因如下：

- 预算确认目前仍只达到“takeover summary + execution suggestion + 面板只读消费”的最小层级：
  - `shared/__tests__/mission-autopilot.test.ts` 已直接断言 waiting mission 的 `takeover.type = budget`、`prompt`、`decisionId`、`options`、`route.takeoverPointIds`、`execution.availableActions(wait / resume / replan)`。
  - 这些事实足以证明预算确认信号已经进入 shared/client/server 的 summary 投影，但还不足以证明 spec 里“预计成本”“成本来源”“最大预算输入”“预算确认审计落库”这组预算体验字段已经实现。
  - 因此 lane 1 本轮继续把预算条目视为“最小只读闭环存在，但交互与审计闭环仍未完成”。

- 权限确认目前仍只在 runtime 层有局部审批事实，没有稳定进入任务详情 takeover 闭环：
  - `server/tests/workflow-runtime-engine.test.ts` 中 `approval_required -> WAITING_INPUT -> human.approved`、transaction approval、MCP approval 与 permission engine 相关用例，能证明 runtime 侧确有等待审批与恢复语义。
  - 但这些事实仍未稳定落到 `MissionAutopilotSummary.takeover`、`DecisionPanel`、`DecisionHistory`、`TaskAutopilotPanel` 这一条用户可见链路上。
  - 所以本轮继续只把它们记录为“runtime 治理能力已存在”，不外推成“权限确认类接管体验”已经落地。

- 路线确认仍停留在“候选路线投影 + diff/replan 解释 + 只读展示”阶段：
  - `tasks-store.autopilot.test.ts`、`server/tests/mission-routes.test.ts` 与 `TaskAutopilotPanel.test.tsx` 已稳定覆盖 `candidateRoutes / selectedRouteId / selectionStatus / route.replan / Route Diff / selection reason`。
  - 但现有证据仍没有直接证明：用户在 takeover decision 中提交路线选择后，会通过同一条交互真正更新 Route 状态，或触发真实 route mutation / replan mutation。
  - 因此 spec 中“支持路线选择后更新 Route”“支持路线选择后触发重规划”继续保持未完成。

- 异常接管仍更接近 recovery/operator-action/runtime-control 的组合，而不是稳定的 `takeover.type = exception` 合同：
  - `TaskAutopilotPanel.test.tsx` 已覆盖 recovery block 的失败原因、已尝试动作、建议动作与 `route.replanned` 证据展示。
  - `server/tests/workflow-runtime-engine.test.ts` 已覆盖 `retry()`、`escalate()`、`terminate()`、`resume()` 与 retry budget/exhaustion 场景。
  - 但 shared/server 直连测试仍未形成稳定可消费的 `takeover.type = exception` summary 合同，因此 lane 1 本轮仍不把“定义异常接管类接管”或专门异常 takeover 面板写成 done。

- 澄清类接管的最小端到端事实链已保持成立，但 lane 1 本轮没有新证据足以继续扩勾：
  - `DecisionPanel.tsx` + `DecisionPanel.param-collection.test.ts` + `server/tests/hitl-decision.test.ts` + `server/tests/workflow-runtime-engine.test.ts` 已持续支撑“单选澄清 / 自由文本澄清 / param_collection / selection / attachment 引用补充 / wait-resume”这条最小链路。
  - 但这组证据仍不支持“多选澄清”“默认继续”“统一 takeover queue/panel”之类更完整体验，因此 lane 1 本轮不新增澄清类 checkbox。

综上，lane 1 本轮对 spec 的保守结论没有变化：

- 可以确认的仍是 summary 投影、waiting decision 提交、decision history 留痕、audit/replay 最小切片、以及 recovery/runtime control 最小闭环。
- 仍不能外推的则是权限/风险/交付/异常专门 takeover 面板、预算输入与预算审计、以及路线选择后的真实 mutation/replan 提交闭环。

### lane 3 续审（2026-04-25）

本轮按 lane 3 约束重新核对 `DecisionPanel.tsx`、`TaskAutopilotPanel.tsx`、`TaskDetailView.tsx`、`DecisionPanel.param-collection.test.ts`、`TaskAutopilotPanel.test.tsx`、`tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts` 与 `server/tests/workflow-runtime-engine.test.ts` 后，结论仍是不新增 checkbox，只补保守中文审计边界，原因如下：

- `TaskDetailView.tsx` 明确在 waiting 详情页挂载 `DecisionPanel`，而 `DecisionPanel.tsx` 与 `DecisionPanel.param-collection.test.ts` 已直接覆盖 `request-info` 的 free-text、`param_collection`、`selection` 字段与 keyed remount 稳态；这足以继续证明“最小澄清闭环”成立，但仍不足以把 spec 中的统一 takeover panel 信息架构、多选澄清或“默认继续”外推成已完成。

- `TaskAutopilotPanel.tsx` 与 `TaskAutopilotPanel.test.tsx` 已直接消费并展示：
  - `takeover.status / type / prompt / options`
  - `candidateRoutes / selectedRouteId / recommendedRouteId`
  - `Route Diff`
  - `时长汇总 / 成本汇总`
  - `recovery.reason / attemptedActions / suggestedActions`
  这些证据说明 route/takeover/recovery 摘要展示面是稳定的，但仍属于“只读 summary panel”层，不足以把预算确认里的“成本来源 / 最大预算输入 / 审计写回”或路线确认里的“提交后真实 mutation”写成已完成。

- `tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts` 与 `server/tasks/mission-projection.ts` 已共同形成稳定的 autopilot/takeover 投影合同：`status(required/pending/advisory)`、`required`、`blocking`、`type`、`reason`、`prompt`、`decisionId`、`options`、`takeoverPointIds`、`selectionStatus`、`replan`、`recovery`、`evidence.timeline` 都有实现落点与测试命中；但这仍是 summary/projection 层证据，不等于已经落地 `TakeoverQueue`、推荐默认动作区、风险与证据区、或 takeover 专用历史时间线。

- `server/tests/mission-routes.test.ts` 与 `tasks-store.autopilot.test.ts` 已直接断言 `canSwitch / switchRequiresConfirmation / route.replan / selectedRouteId / recommendedRouteId`，这足以支撑“路线确认信号与 route diff/replan 解释已投影并可展示”；但没有直接代码+测试证明用户通过同一条 takeover decision 交互提交路线选择后，会真实更新 Route 或触发 route mutation/replan mutation，因此相关交互闭环继续保持未完成。

- `server/tests/workflow-runtime-engine.test.ts` 中 transaction/MCP 的 `approval_required -> WAITING_INPUT -> human.approved` 仍然只证明 runtime 审批与 permission 语义存在；当前缺少把这些审批事实稳定投影进 `MissionAutopilotSummary.takeover`、`DecisionPanel`、`DecisionHistory`、`TaskAutopilotPanel` 这一条任务详情闭环的直接证据，因此 lane 3 本轮继续不把权限确认 takeover 体验或对应测试计划写成 done。

- `shared/mission/autopilot.ts`、`tasks-store.ts` 与 `TaskAutopilotPanel.tsx` 虽然都包含 `approval / permission / budget / exception` 类型枚举或本地化分支，`TaskAutopilotPanel.test.tsx` 也能消费手工构造的 approval fixture；但本轮直接命中的 shared/server 直连事实链仍主要集中在 `route-selection`、`budget`、clarification/request-info 与 recovery/operator-action 切片，尚不足以把 permission/exception 专门 takeover 面板写成落地。

因此 lane 3 本轮继续维持与 lane 1 一致的保守口径：

- 已完成的是 waiting decision 的最小提交闭环、takeover/recovery/evidence 的 summary 投影与最小显示、以及 HITL/runtime control 的兼容与留痕。
- 仍未完成的是统一 takeover panel 信息架构、permission/risk/delivery/exception 专门体验、budget 输入与审计、以及路线选择后的真实 mutation/replan 提交闭环。

### lane takeover 续审（2026-04-25）

本轮按 `DecisionPanel.tsx`、`TaskDetailView.tsx`、`DecisionPanel.param-collection.test.ts`、`tasks-store.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`shared/mission/api.ts`、`shared/mission/index.ts` 与 `server/tasks/mission-projection.ts` 重新复核后，确认当前可以保守承认一层更窄的“最小接管面板信息架构”已经存在，但范围严格限定如下：

- `DecisionPanel.tsx` 已提供稳定的当前接管卡片骨架：
  - `CardTitle` 固定表达 `Decision Required / 需要人工决策`
  - `CardDescription` 直接展示当前 `decision.prompt`
  - `ApproveRejectLayout / MultiChoiceLayout / RequestInfoLayout / EscalateLayout / CustomActionLayout` 五类布局负责承载可选动作区
- `client/src/components/tasks/__tests__/DecisionPanel.param-collection.test.ts` 已直接命中上述三层最小结构：
  - 断言标题 `Decision Required / 需要人工决策`
  - 断言上下文 prompt，如 `Choose how the mission should continue`、`Collect the missing launch parameters`
  - 断言动作区内容，如 `Retry current executor`、`Escalate to operator`、`Submit Selection / Submit Parameters`
- `TaskDetailView.tsx` 已在 waiting 任务详情与 cockpit decisions workspace 中挂载 `DecisionPanel`，因此这套最小结构确实进入任务详情页，而不是只停留在孤立组件层。

基于这组直接代码 + 直接测试证据，本轮仅把以下三个信息架构子项视为已完成：

- 当前接管区域
- 决策上下文区域
- 可选动作区域

但仍不能外推为完整 takeover panel 信息架构已经落地，关键缺口如下：

- 推荐默认动作区域仍不存在稳定合同：
  - 当前没有独立 recommendation block、推荐 option 标记、推荐理由字段，也没有测试直接命中“系统推荐默认动作”。
- 风险与证据区域仍不存在当前 lane 可消费闭环：
  - 风险说明、evidence timeline、correlation 仍主要停留在 `TaskAutopilotPanel` 与 projection summary，不在 `DecisionPanel` 内形成单独区域。
- 历史接管时间线区域仍不足以勾选：
  - `TaskDetailView.tsx` 虽会渲染 `DecisionHistory`，但它是通用 decision history，不是 takeover 专用 timeline；现有测试也未把它作为“接管时间线区域”进行直接锚定。
- 路线选择后的 mutation / replan 提交仍未打通：
  - `server/tests/mission-routes.test.ts` 与 `tasks-store.ts` 只稳定证明 `candidateRoutes / selectedRouteId / selectionStatus / route.replan / Route Diff` 被投影和展示；
  - 仍没有直接代码 + 直接测试证明用户通过当前 takeover 决策提交路线选择后，Route 状态会真实更新，或触发真实 route mutation / replan mutation。
- 权限、风险、交付、异常四类专门接管面板仍未形成同一条任务详情闭环：
  - runtime approval / permission 事实还主要停留在 `workflow-runtime-engine.test.ts` 一侧；
  - recovery/operator actions 虽然存在，但仍更接近恢复控制面，而不是稳定的 `takeover.type = exception` 面板合同。

### lane takeover 聚焦续审（二）（2026-04-25）

本轮按 `DecisionPanel.tsx`、`TaskDetailView.tsx`、`TaskAutopilotPanel.tsx`、`DecisionPanel.param-collection.test.ts`、`TaskAutopilotPanel.test.tsx`、`tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`server/tests/workflow-runtime-engine.test.ts` 重新聚焦复核后，结论仍是“不新增 checkbox，只补保守审计边界”。这一轮的重点不是再扩大已完成面，而是进一步确认当前接管 UI 与 projection contract 的真实边界。

本轮新增确认但不外推勾选的事实如下：

- `TaskDetailView.tsx` 现在已经把三类接管相关 surface 放进同一任务详情语境：
  - waiting 任务详情与 cockpit decisions workspace 会挂载 `DecisionPanel`
  - decisions workspace 会挂载 `DecisionHistory`
  - cockpit 与 overview 侧栏会挂载 `TaskAutopilotPanel`
  这说明当前产品面确实已经存在“决策输入 + 决策历史 + autopilot 摘要”的并列组合；但它仍是多个 surface 的拼接复用，不等于 spec 中“统一 takeover panel 信息架构”已经完整落地。

- `DecisionPanel.tsx` 负责最小决策输入面，`TaskAutopilotPanel.tsx` 负责 route/takeover/recovery/evidence 摘要展示，两者职责边界目前很清楚：
  - `DecisionPanel.tsx` 的直接测试仍只稳定命中标题、prompt、选项/输入框与提交按钮
  - `TaskAutopilotPanel.test.tsx` 的直接测试则命中 `takeover.status / type / prompt / options`、`Route Diff`、`riskSummary`、`evidenceHints`、`evidence timeline` 与 recovery block
  因此“风险与证据区域”当前更接近 `TaskAutopilotPanel` 中的 autopilot summary block，而不是 `DecisionPanel` 内已定义完成的接管面板分区。

- route confirmation 相关代码与测试继续只证明“可展示、可解释”，还不能证明“已提交并改变真实路线状态”：
  - `tasks-store.ts`、`shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts` 与配套测试，已经稳定透传 `candidateRoutes / selectedRouteId / recommendedRouteId / selectionStatus / route.replan / takeoverPointIds`
  - `TaskAutopilotPanel.test.tsx` 也直接断言了 `Route Diff`、候选路线、replan 原因与 route selection summary
  - 但现有证据仍没有直接命中“用户通过当前 takeover decision 提交路线选择后，Route 状态真实更新”或“同一交互触发真实 route mutation / replan mutation”
  所以这轮继续不把“支持路线选择后更新 Route”“支持路线选择后触发重规划”写成 done。

- permission / approval 语义目前仍主要停留在 runtime 治理层，而不是任务详情 takeover 闭环：
  - `workflow-runtime-engine.test.ts`、transaction approval、MCP approval 相关测试已能证明 `approval_required -> WAITING_INPUT -> human.approved` 这条等待/审批/恢复事实链存在
  - 但这些事实还没有稳定投影成 `MissionAutopilotSummary.takeover` 中专门的 permission/approval takeover summary，并贯穿 `DecisionPanel`、`DecisionHistory`、`TaskAutopilotPanel`
  - `TaskAutopilotPanel` 虽能消费手工构造的 approval fixture，但这不等于 shared/server 已形成可复用的专门 approval takeover 合同
  因此权限确认类接管体验与对应测试计划仍只记审计说明，不新增勾选。

- `DecisionHistory` 仍然只能保守视为“通用 decision history”，不能外推成“历史接管时间线区域”：
  - 当前直接代码+测试已证明其可保留 `prompt / options / resolved option / freeText`
  - `mission-routes.test.ts` 与 `TaskAutopilotPanel.test.tsx` 也已证明 takeover 事件能进入 evidence timeline
  - 但这两者目前分别属于“通用 history card”和“autopilot evidence timeline”，还没有一个专门面向 takeover 的统一时间线组件或对应集成测试
  - 同样地，`takeover.reason / prompt / options` 目前只是 decision slice 与 summary slice，不是“接管点生成原因”这一独立因果记录模型

因此本轮续审后的保守结论是：

- 已经稳定成立的是：`DecisionPanel` 最小输入区、`DecisionHistory` 最小留痕区、`TaskAutopilotPanel` 的 route/takeover/recovery/evidence 摘要区，以及它们在任务详情页内的组合复用。
- 仍未稳定成立的是：统一 takeover panel、`DecisionPanel` 内专门的风险/证据区、takeover 专用历史时间线、permission/approval 专门接管体验、以及路线选择提交后的真实 mutation/replan 闭环。

### 2026-04-25 主仓收口补充

本轮补充把 design 口径进一步压实到当前主仓已经稳定存在的两条事实：

- `TakeoverPoint` 当前应理解为“`MissionAutopilotSummary.takeover + route.takeoverPointIds + DecisionHistoryEntry` 共同组成的最小读模型/锚点集合”，而不是已经独立持久化的实体。
- “路线选择后更新 Route”当前应理解为“决策历史中的 route-selection 语义被 shared / projection 提升为 authoritative `selectedRouteId / selection.status / route.evidence`”，而不是已经触发真实 route mutation 或重规划执行。

### 2026-04-26 route-selection 兼容边界补充

- 本轮若将 `支持路线选择后更新 Route` 视为完成，其含义继续严格限制在 authoritative summary / projection 层：
  - `server/tasks/mission-decision.ts` 持久化 `selectedRouteOptionId / selectedRouteLabel / selectedRouteId / changedReason`；
  - `shared/mission/autopilot.ts` 从 decision payload/history 解析 authoritative route selection；
  - `server/tasks/mission-projection.ts`、client store 与 `TaskAutopilotPanel` 继续消费同一份 authoritative `selectedRouteId / selection.status / route.evidence`。
- 上述闭环解决的是“路线选择结果被任务详情摘要、projection 与 replay/evidence 最小切片稳定看见”，不是“planner 内部 Route 图已被改写”：
  - 当前仍没有直接代码 + 直接测试证明同一条 takeover route-selection 提交会触发真实 route mutation；
  - 当前也仍没有直接代码 + 直接测试证明同一条交互会触发真实 runtime replan action。
- 因此设计口径保持为：
  - `支持路线选择后更新 Route` 可以按 summary/projection authoritative update 理解；
  - `支持路线选择后触发重规划` 继续属于后续真实 runtime/planner 闭环，不纳入当前完成面。
