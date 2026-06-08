/**
 * Blueprint 运行时事件名与家族的单一真相源。
 *
 * 关键约束：
 * - 所有蓝图栈 emit 的事件名 SHALL 来自 {@link BlueprintEventName}。
 * - 所有蓝图栈事件 SHALL 归属到 {@link BlueprintGenerationEventFamily} 中的某个家族。
 * - 新增事件只允许通过本文件扩展，不允许在其它位置散落裸字符串。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split` 需求 5.1 / 5.2 / 6.3。
 */

import type {
  CritiqueSeverity,
  RebuttalStance,
} from "./brainstorm-contracts";

/**
 * 事件家族（13 个）。
 *
 * 顺序遵循 design.md §4「事件家族架构」：
 * - `job`：作业级生命周期（created / stage / completed / failed）。
 * - `clarification`：澄清会话阶段与答案。
 * - `route`：RouteSet 生成、选择与重置。
 * - `spec`：SPEC Tree 与 SPEC Document 的更新、版本、评审。
 * - `preview`：效果预演生成与刷新。
 * - `prompt`：实现提示词打包。
 * - `mission`：mission handoff 等交接动作。
 * - `evidence`：Artifact Replay 下的证据记录与关联。
 * - `role`：Agent Crew 内角色生命周期。
 * - `capability`：Runtime Capability 调用生命周期。
 * - `crew`：Agent Crew 跨角色上下文更新。
 * - `sandbox`：沙箱推导作业生命周期。
 * - `brainstorm`：多智能体协作决策会话生命周期（`autopilot-multi-agent-brainstorm` spec）。
 */
export type BlueprintGenerationEventFamily =
  | "job"
  | "clarification"
  | "route"
  | "spec"
  | "preview"
  | "prompt"
  | "mission"
  | "evidence"
  | "role"
  | "capability"
  | "crew"
  | "sandbox"
  | "brainstorm"
  | "checks";

/**
 * 所有 blueprint 运行时事件名的联合类型。
 *
 * 新增事件时必须：
 * 1. 在此 union 中追加对应字符串字面量；
 * 2. 在 {@link BlueprintEventName} 中追加常量键；
 * 3. 如引入新的家族，同步扩展 {@link BlueprintGenerationEventFamily}。
 */
export type BlueprintGenerationEventType =
  // Job lifecycle
  | "job.created"
  | "job.stage"
  | "job.completed"
  | "job.failed"
  | "replan.triggered"
  // Clarification
  | "clarification.ready"
  | "clarification.answered"
  | "clarification.dismissed"
  // RouteSet
  | "route.generated"
  | "route.selected"
  | "route.reset"
  // SPEC Tree / Documents
  | "spec.tree.updated"
  | "spec.tree.versioned"
  | "spec.document.versioned"
  | "spec.document.reviewed"
  // autopilot-mirofish-stream（2026-05-17）：
  // 节点级 SPEC 文档完成事件，归入 `spec` 家族。当
  // spec-docs-llm-generation 完成单个节点的 requirements/design/tasks
  // 三份文档时发出,前端 MiroFishCardStream 据此派生 node_completed 卡片。
  | "spec.node_completed"
  // Effect preview
  | "preview.generated"
  | "preview.refreshed"
  | "preview.batch.completed"
  // EP_VIS_AUDIT 出图审计回炉（`blueprint-v4-full-alignment` Module E / R14.1）：
  // 出图审计发现假图时发出，请求对失败图片回炉重生。使用点号命名
  // `preview.audit.regenerate_requested`，`resolveBlueprintEventFamily` 按首段
  // `.` 截取会自动归入既有 `preview` 家族，不扩展家族目录。
  | "preview.audit.regenerate_requested"
  // Prompt package
  | "prompt.packaged"
  // Mission handoff
  | "mission.handoff"
  // Evidence / Artifact Replay
  | "evidence.recorded"
  | "evidence.linked"
  // autopilot-mirofish-stream（2026-05-17）：
  // job.artifacts 写入时发出的产物落库事件，归入 `evidence` 家族。
  // 前端 MiroFishCardStream 据此派生 artifact_created 卡片。
  | "evidence.artifact_created"
  // Agent Crew roles
  | "role.activated"
  | "role.watching"
  | "role.capability_invoked"
  | "role.review_started"
  | "role.review_completed"
  | "role.sleeping"
  | "role.completed"
  // Role container loader（`autopilot-role-container-loader` spec Task 1）：
  // 角色容器 loader 的 4 条生命周期事件。仍归入 `role` 家族，不扩展 12 家族目录。
  | "role.container.provisioning"
  | "role.container.ready"
  | "role.container.teardown"
  | "role.container.failed"
  // Agent reasoning stream（`autopilot-agent-reasoning-stream` spec Task 2）：
  // Agent ReAct 循环对外暴露的 7 条事件。仍归入 `role` 家族，不扩展 12 家族目录；
  // `resolveBlueprintEventFamily` 按首段 `.` 截取，会自动把 `role.agent.thinking`
  // 这种带两个 `.` 的事件归入 `"role"`。
  | "role.agent.iteration_started"
  | "role.agent.thinking"
  | "role.agent.acting"
  | "role.agent.observing"
  | "role.agent.iteration_completed"
  | "role.agent.error"
  | "role.agent.completed"
  // Runtime capability
  | "capability.invoked"
  | "capability.completed"
  | "capability.failed"
  // Crew 跨角色上下文
  | "crew.context.updated"
  // Sandbox 推导作业
  | "sandbox.job.started"
  | "sandbox.job.completed"
  | "sandbox.job.failed"
  // Brainstorm session lifecycle（`autopilot-multi-agent-brainstorm` spec）
  | "brainstorm.session.started"
  | "brainstorm.session.completed"
  | "brainstorm.session.failed"
  | "brainstorm.mode.selected"
  // Brainstorm node lifecycle
  | "brainstorm.node.created"
  | "brainstorm.node.updated"
  // Brainstorm tool events
  | "brainstorm.tool.completed"
  | "brainstorm.tool.failed"
  // Brainstorm degradation
  | "brainstorm.degraded"
  // Blueprint v4 full-loop deliberation events
  | "brainstorm.round.completed"
  | "brainstorm.challenge.issued"
  | "brainstorm.vote.completed"
  // Autopilot brainstorm real collaboration（`autopilot-brainstorm-real-collaboration` spec Task 1.2）：
  // 结构化反驳事件。仍归入 `brainstorm` 家族，不扩展家族目录（R12.2）；
  // `resolveBlueprintEventFamily` 按首段 `.` 截取会自动归入 `"brainstorm"`。
  | "brainstorm.rebuttal.issued"
  // Blueprint v4 companion challenge/response events
  | "companion.challenge.started"
  | "companion.challenge.resolved"
  // Checks Ledger（`blueprint-checks-ledger` spec）
  | "checks.entry.recorded"
  | "checks.gate.passed"
  | "checks.gate.failed";

/**
 * `BlueprintEventName` 事件常量命名空间。
 *
 * 使用方式：`ctx.eventBus.emit({ type: BlueprintEventName.RouteSelected, ... })`。
 *
 * 每个键值严格等于其对应的字符串字面量，TypeScript 会把它们收窄成
 * {@link BlueprintGenerationEventType} 的一员，便于 event bus 做类型校验。
 */
export const BlueprintEventName = {
  // Job lifecycle
  JobCreated: "job.created",
  JobStage: "job.stage",
  JobCompleted: "job.completed",
  JobFailed: "job.failed",
  ReplanTriggered: "replan.triggered",
  // Clarification
  ClarificationReady: "clarification.ready",
  ClarificationAnswered: "clarification.answered",
  ClarificationDismissed: "clarification.dismissed",
  // RouteSet
  RouteGenerated: "route.generated",
  RouteSelected: "route.selected",
  RouteReset: "route.reset",
  // SPEC Tree / Documents
  SpecTreeUpdated: "spec.tree.updated",
  SpecTreeVersioned: "spec.tree.versioned",
  SpecDocumentVersioned: "spec.document.versioned",
  SpecDocumentReviewed: "spec.document.reviewed",
  // autopilot-mirofish-stream（2026-05-17）
  SpecNodeCompleted: "spec.node_completed",
  // Effect preview
  PreviewGenerated: "preview.generated",
  PreviewRefreshed: "preview.refreshed",
  PreviewBatchCompleted: "preview.batch.completed",
  // EP_VIS_AUDIT 出图审计回炉（`blueprint-v4-full-alignment` Module E / R14.1）
  PreviewAuditRegenerateRequested: "preview.audit.regenerate_requested",
  // Prompt package
  PromptPackaged: "prompt.packaged",
  // Mission handoff
  MissionHandoff: "mission.handoff",
  // Evidence / Artifact Replay
  EvidenceRecorded: "evidence.recorded",
  EvidenceLinked: "evidence.linked",
  // autopilot-mirofish-stream（2026-05-17）
  EvidenceArtifactCreated: "evidence.artifact_created",
  // Agent Crew roles
  RoleActivated: "role.activated",
  RoleWatching: "role.watching",
  RoleCapabilityInvoked: "role.capability_invoked",
  RoleReviewStarted: "role.review_started",
  RoleReviewCompleted: "role.review_completed",
  RoleSleeping: "role.sleeping",
  RoleCompleted: "role.completed",
  // Role container loader（`autopilot-role-container-loader` spec Task 1）
  RoleContainerProvisioning: "role.container.provisioning",
  RoleContainerReady: "role.container.ready",
  RoleContainerTeardown: "role.container.teardown",
  RoleContainerFailed: "role.container.failed",
  // Agent reasoning stream（`autopilot-agent-reasoning-stream` spec Task 2）
  RoleAgentIterationStarted: "role.agent.iteration_started",
  RoleAgentThinking: "role.agent.thinking",
  RoleAgentActing: "role.agent.acting",
  RoleAgentObserving: "role.agent.observing",
  RoleAgentIterationCompleted: "role.agent.iteration_completed",
  RoleAgentError: "role.agent.error",
  RoleAgentCompleted: "role.agent.completed",
  // Runtime capability
  CapabilityInvoked: "capability.invoked",
  CapabilityCompleted: "capability.completed",
  CapabilityFailed: "capability.failed",
  // Crew 跨角色上下文
  CrewContextUpdated: "crew.context.updated",
  // Sandbox 推导作业
  SandboxJobStarted: "sandbox.job.started",
  SandboxJobCompleted: "sandbox.job.completed",
  SandboxJobFailed: "sandbox.job.failed",
  // Brainstorm session lifecycle（`autopilot-multi-agent-brainstorm` spec）
  BrainstormSessionStarted: "brainstorm.session.started",
  BrainstormSessionCompleted: "brainstorm.session.completed",
  BrainstormSessionFailed: "brainstorm.session.failed",
  BrainstormModeSelected: "brainstorm.mode.selected",
  // Brainstorm node lifecycle
  BrainstormNodeCreated: "brainstorm.node.created",
  BrainstormNodeUpdated: "brainstorm.node.updated",
  // Brainstorm tool events
  BrainstormToolCompleted: "brainstorm.tool.completed",
  BrainstormToolFailed: "brainstorm.tool.failed",
  // Brainstorm degradation
  BrainstormDegraded: "brainstorm.degraded",
  // Blueprint v4 full-loop deliberation events
  BrainstormRoundCompleted: "brainstorm.round.completed",
  BrainstormChallengeIssued: "brainstorm.challenge.issued",
  BrainstormVoteCompleted: "brainstorm.vote.completed",
  // Autopilot brainstorm real collaboration（`autopilot-brainstorm-real-collaboration` spec Task 1.2）
  BrainstormRebuttalIssued: "brainstorm.rebuttal.issued",
  // Blueprint v4 companion challenge/response events
  CompanionChallengeStarted: "companion.challenge.started",
  CompanionChallengeResolved: "companion.challenge.resolved",
  // Checks Ledger（`blueprint-checks-ledger` spec）
  ChecksEntryRecorded: "checks.entry.recorded",
  ChecksGatePassed: "checks.gate.passed",
  ChecksGateFailed: "checks.gate.failed",
} as const satisfies Record<string, BlueprintGenerationEventType>;

/**
 * {@link BlueprintEventName} 的键名类型，便于需要"事件名常量键"的场景使用。
 */
export type BlueprintEventNameKey = keyof typeof BlueprintEventName;

/**
 * 把事件名字符串映射到它所属的家族。
 *
 * 实现方式：截取首个 `.` 之前的段。`sandbox.job.started` 会返回 `sandbox`，
 * `spec.tree.updated` 会返回 `spec`，与现有 `mapGenerationEventFamily` 的行为一致。
 *
 * @param eventType 事件名
 * @returns 家族名
 */
export function resolveBlueprintEventFamily(
  eventType: BlueprintGenerationEventType
): BlueprintGenerationEventFamily {
  if (eventType === BlueprintEventName.ReplanTriggered) {
    return "job";
  }
  const [family] = eventType.split(".", 1);
  if (family === "companion") {
    return "checks";
  }
  return family as BlueprintGenerationEventFamily;
}

/**
 * Optional payload shape carried by `BlueprintEventName.PreviewGenerated`
 * events (and, by extension, the `BlueprintEventName.JobCompleted` emit
 * that also aggregates per-preview provenance).
 *
 * Added by the `autopilot-effect-preview-llm` spec (design §4.8 / §D7,
 * requirement 6.1 / 6.2 / 6.5). All three fields are optional so event
 * consumers that pre-date this spec remain source-compatible:
 *
 *  - `previewGenerationSources` — per-preview `{ nodeId, generationSource }`
 *    summary covering the entire effect preview batch. Always filled when
 *    at least one preview was produced.
 *  - `promptId` — set when any preview in the batch attempted the LLM
 *    path (i.e. `generationSource` was `"llm"` or `"llm_fallback"`).
 *    Currently pinned to `"blueprint.effect-preview.v1"`.
 *  - `model` — LLM model identifier read from `ctx.llm.getConfig().model`
 *    at invocation time, filled under the same condition as `promptId`.
 *
 * The type is intentionally additive on top of the generic
 * `BlueprintGenerationEvent.payload?: unknown` shape — events still
 * validate via the existing event bus guard and this interface acts as
 * a documented overlay for consumers that want structured access.
 */
export interface BlueprintPreviewGeneratedEventPayload {
  previewGenerationSources?: Array<{
    nodeId: string;
    generationSource: "llm" | "llm_fallback" | "template";
  }>;
  promptId?: string;
  model?: string;
}


// ---------------------------------------------------------------------------
// Brainstorm event payload interfaces（`autopilot-multi-agent-brainstorm` spec）
// ---------------------------------------------------------------------------

/**
 * Brainstorm 角色 ID。
 *
 * 在 `shared/blueprint/brainstorm-contracts.ts` 落地后，此处类型应与其保持一致。
 * 独立声明以避免循环依赖并支持 task 1.1 / 1.2 并行开发。
 */
export type BrainstormEventRoleId =
  | "decider"
  | "planner"
  | "architect"
  | "executor"
  | "auditor"
  | "ui_previewer";

/**
 * Branch 节点类型。
 */
export type BrainstormEventNodeType =
  | "decision"
  | "thinking"
  | "action"
  | "observation"
  | "synthesis"
  | "error";

/**
 * Branch 节点状态。
 */
export type BrainstormEventNodeStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed";

/**
 * Payload for `brainstorm.node.created` events.
 *
 * Emitted when a new branch node is created during collaboration.
 * Validates: Requirements 5.3.
 */
export interface BrainstormNodeCreatedPayload {
  sessionId: string;
  nodeId: string;
  parentNodeId: string | null;
  roleId: BrainstormEventRoleId;
  nodeType: BrainstormEventNodeType;
  status: BrainstormEventNodeStatus;
  title: string;
  sequenceNumber: number;
}

/**
 * Payload for `brainstorm.node.updated` events.
 *
 * Emitted when a branch node's status or content changes.
 * Validates: Requirements 5.4.
 */
export interface BrainstormNodeUpdatedPayload {
  sessionId: string;
  nodeId: string;
  status: BrainstormEventNodeStatus;
  content?: string;
  confidence?: number;
  tokenUsage?: number;
}

/**
 * Payload for `brainstorm.session.completed` events.
 *
 * Emitted when a brainstorm session reaches the synthesis phase and completes.
 * Validates: Requirements 5.5.
 */
export interface BrainstormSessionCompletedPayload {
  sessionId: string;
  synthesisDecision: string;
  synthesisConfidence: number;
  totalTokenUsage: number;
  totalDurationMs: number;
  crewMemberCount: number;
  nodeCount: number;
}

/**
 * Payload for `brainstorm.degraded` events.
 *
 * Emitted whenever a fallback path is taken during brainstorm orchestration.
 * Validates: Requirements 10.4.
 */
export interface BrainstormDegradedPayload {
  sessionId: string;
  reason: string;
  affectedComponent: string;
  fallbackAction: string;
}

// ---------------------------------------------------------------------------
// Blueprint v4 full-loop event payload interfaces
// ---------------------------------------------------------------------------

/**
 * Payload for `brainstorm.round.completed` events.
 *
 * 升级（`autopilot-brainstorm-real-collaboration` spec Task 1.2，R6.3）：
 * 补 `consensusReached` / `unresolvedCritiqueCount`，反映 Adjudicator 真实裁决结果。
 * 既有字段保持不变，向后兼容。
 */
export interface BrainstormRoundCompletedPayload {
  sessionId: string;
  roundNumber: number;
  participatingRoleIds: BrainstormEventRoleId[];
  convergenceScore: number;
  challengesThisRound: number;
  /** Adjudicator 是否判定本轮达成共识（R6.3）。 */
  consensusReached: boolean;
  /** 本轮结束时仍未解决的 Critique 数量（R6.3）。 */
  unresolvedCritiqueCount: number;
}

/**
 * Payload for `brainstorm.challenge.issued` events.
 *
 * 升级（`autopilot-brainstorm-real-collaboration` spec Task 1.2，R6.1）：
 * 补 `targetClaim` / `severity`，反映结构化 Critique 引用的具体主张与严重度。
 * 既有字段保持不变，向后兼容。
 */
export interface BrainstormChallengeIssuedPayload {
  sessionId: string;
  challengerRoleId: BrainstormEventRoleId;
  targetRoleId: BrainstormEventRoleId;
  challengeSummary: string;
  roundNumber: number;
  /** challenger 所质疑的 target 本轮产出的具体主张文本（R6.1）。 */
  targetClaim: string;
  /** 结构化 Critique 的严重度（R6.1）。 */
  severity: CritiqueSeverity;
}

/**
 * Payload for `brainstorm.rebuttal.issued` events.
 *
 * 新增（`autopilot-brainstorm-real-collaboration` spec Task 1.2，R6.2）：
 * 被批评方对某条 Critique 的结构化反驳。归入 `brainstorm` 家族。
 */
export interface BrainstormRebuttalIssuedPayload {
  sessionId: string;
  responderRoleId: BrainstormEventRoleId;
  /** === 所回应 Critique.id（R6.2）。 */
  challengeId: string;
  rebuttalSummary: string;
  stance: RebuttalStance;
  roundNumber: number;
}

/**
 * Payload for `brainstorm.vote.completed` events.
 */
export interface BrainstormVoteCompletedPayload {
  sessionId: string;
  voteTally: Record<string, number>;
  winningOption: string;
  margin: number;
  isNarrow: boolean;
}

/**
 * Payload for `companion.challenge.started` events.
 */
export interface CompanionChallengeStartedPayload {
  jobId: string;
  findingId: string;
  targetArtifactId: string;
  challengeSummary: string;
}

/**
 * Payload for `companion.challenge.resolved` events.
 */
export interface CompanionChallengeResolvedPayload {
  jobId: string;
  findingId: string;
  outcome: "accepted" | "partially_resolved" | "escalated";
  responseSummary: string;
  durationMs: number;
}

/**
 * Payload for `preview.batch.completed` events.
 */
export interface PreviewBatchCompletedPayload {
  jobId: string;
  totalAttempted: number;
  succeeded: number;
  failed: number;
  retried: number;
}
