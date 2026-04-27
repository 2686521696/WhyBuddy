import type {
  MissionDecisionOption,
  MissionEvent,
  MissionOperatorActionRecord,
  MissionOperatorState,
  MissionRecord,
  MissionStage,
  MissionStatus,
} from "./contracts.js";

export const MISSION_AUTOPILOT_DRIVE_STATES = [
  "understanding",
  "clarifying",
  "planning",
  "fleet-forming",
  "executing",
  "reviewing",
  "blocked",
  "takeover-required",
  "replanning",
  "delivered",
] as const;

export type MissionAutopilotDriveState =
  (typeof MISSION_AUTOPILOT_DRIVE_STATES)[number];

export const MISSION_AUTOPILOT_TAKEOVER_TYPES = [
  "clarification",
  "approval",
  "permission",
  "budget",
  "risk-acceptance",
  "route-selection",
  "delivery-review",
  "exception",
  "operator",
] as const;

export type MissionAutopilotTakeoverType =
  (typeof MISSION_AUTOPILOT_TAKEOVER_TYPES)[number];

export const MISSION_AUTOPILOT_TAKEOVER_URGENCIES = [
  "low",
  "medium",
  "high",
] as const;

export type MissionAutopilotTakeoverUrgency =
  (typeof MISSION_AUTOPILOT_TAKEOVER_URGENCIES)[number];

export const MISSION_AUTOPILOT_TAKEOVER_STATUSES = [
  "pending",
  "required",
  "resolved",
  "advisory",
] as const;

export type MissionAutopilotTakeoverStatus =
  (typeof MISSION_AUTOPILOT_TAKEOVER_STATUSES)[number];

export const MISSION_AUTOPILOT_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "unknown",
] as const;

export type MissionAutopilotRiskLevel =
  (typeof MISSION_AUTOPILOT_RISK_LEVELS)[number];

export const MISSION_AUTOPILOT_CONFIDENCE_LEVELS = [
  "low",
  "medium",
  "high",
  "unknown",
] as const;

export type MissionAutopilotConfidenceLevel =
  (typeof MISSION_AUTOPILOT_CONFIDENCE_LEVELS)[number];

export const MISSION_AUTOPILOT_DESTINATION_TASK_TYPES = [
  "analysis",
  "research",
  "generation",
  "transformation",
  "implementation",
  "coordination",
  "mixed",
  "unknown",
] as const;

export type MissionAutopilotDestinationTaskType =
  (typeof MISSION_AUTOPILOT_DESTINATION_TASK_TYPES)[number];

export const MISSION_AUTOPILOT_FLEET_ROLE_TYPES = [
  "planner",
  "clarifier",
  "researcher",
  "generator",
  "reviewer",
  "auditor",
  "operator",
  "executor",
  "custom",
] as const;

export type MissionAutopilotFleetRoleType =
  (typeof MISSION_AUTOPILOT_FLEET_ROLE_TYPES)[number];

export const MISSION_AUTOPILOT_FLEET_ROLE_STATUSES = [
  "idle",
  "running",
  "waiting",
  "blocked",
  "failed",
  "done",
] as const;

export type MissionAutopilotFleetRoleStatus =
  (typeof MISSION_AUTOPILOT_FLEET_ROLE_STATUSES)[number];

export const MISSION_AUTOPILOT_ROUTE_MODES = [
  "fast",
  "standard",
  "deep",
  "custom",
] as const;

export type MissionAutopilotRouteMode =
  (typeof MISSION_AUTOPILOT_ROUTE_MODES)[number];

export const MISSION_AUTOPILOT_ROUTE_STATUSES = [
  "pending",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
] as const;

export type MissionAutopilotRouteStatus =
  (typeof MISSION_AUTOPILOT_ROUTE_STATUSES)[number];

export const MISSION_AUTOPILOT_ROUTE_SELECTION_STATUSES = [
  "recommended",
  "alternatives-available",
  "user-selected",
  "locked",
  "replanned",
] as const;

export type MissionAutopilotRouteSelectionStatus =
  (typeof MISSION_AUTOPILOT_ROUTE_SELECTION_STATUSES)[number];

export const MISSION_AUTOPILOT_ROUTE_SELECTION_MODES = [
  "planner_default",
  "user_selected",
  "runtime_replanned",
  "system_downgraded",
] as const;

export type MissionAutopilotRouteSelectionMode =
  (typeof MISSION_AUTOPILOT_ROUTE_SELECTION_MODES)[number];

export const MISSION_AUTOPILOT_ROUTE_CHANGE_ACTORS = [
  "planner",
  "user",
  "runtime",
  "operator",
] as const;

export type MissionAutopilotRouteChangeActor =
  (typeof MISSION_AUTOPILOT_ROUTE_CHANGE_ACTORS)[number];

export const MISSION_AUTOPILOT_ROUTE_EVIDENCE_EVENT_TYPES = [
  "route.recommended",
  "route.selected",
  "route.locked",
  "route.replanned",
] as const;

export type MissionAutopilotRouteEvidenceEventType =
  (typeof MISSION_AUTOPILOT_ROUTE_EVIDENCE_EVENT_TYPES)[number];

export const MISSION_AUTOPILOT_CONTROL_ACTION_TYPES = [
  "run",
  "wait",
  "resume",
  "retry",
  "escalate",
  "terminate",
  "replan",
] as const;

export type MissionAutopilotControlActionType =
  (typeof MISSION_AUTOPILOT_CONTROL_ACTION_TYPES)[number];

export const MISSION_AUTOPILOT_CONTROL_SCOPES = [
  "step",
  "stage",
  "route",
  "mission",
] as const;

export type MissionAutopilotControlScope =
  (typeof MISSION_AUTOPILOT_CONTROL_SCOPES)[number];

export const MISSION_AUTOPILOT_EXECUTION_STATUSES = [
  "pending",
  "running",
  "waiting",
  "blocked",
  "done",
  "failed",
] as const;

export type MissionAutopilotExecutionStatus =
  (typeof MISSION_AUTOPILOT_EXECUTION_STATUSES)[number];

export const MISSION_AUTOPILOT_RECOVERY_STATES = [
  "healthy",
  "watching",
  "recovering",
  "takeover-required",
  "escalated",
] as const;

export type MissionAutopilotRecoveryState =
  (typeof MISSION_AUTOPILOT_RECOVERY_STATES)[number];

export const MISSION_AUTOPILOT_DEVIATION_CATEGORIES = [
  "none",
  "goal-deviation",
  "route-deviation",
  "quality-deviation",
  "governance-deviation",
  "dependency-failure",
  "state-block",
  "recovery-exhausted",
] as const;

export type MissionAutopilotDeviationCategory =
  (typeof MISSION_AUTOPILOT_DEVIATION_CATEGORIES)[number];

export const MISSION_AUTOPILOT_EVIDENCE_TRUST_LEVELS = [
  "verified",
  "partial",
  "unverified",
  "redacted",
] as const;

export type MissionAutopilotEvidenceTrustLevel =
  (typeof MISSION_AUTOPILOT_EVIDENCE_TRUST_LEVELS)[number];

export const MISSION_AUTOPILOT_TIMELINE_EVENT_TYPES = [
  "drive_state_change",
  "decision",
  "route_change",
  "takeover",
  "tool_call",
  "result",
  "operator_action",
  "system",
] as const;

export type MissionAutopilotTimelineEventType =
  (typeof MISSION_AUTOPILOT_TIMELINE_EVENT_TYPES)[number];

export const MISSION_AUTOPILOT_TIMELINE_EVENT_STATUSES = [
  "info",
  "running",
  "waiting",
  "blocked",
  "done",
  "failed",
] as const;

export type MissionAutopilotTimelineEventStatus =
  (typeof MISSION_AUTOPILOT_TIMELINE_EVENT_STATUSES)[number];

export const MISSION_AUTOPILOT_EXPLANATION_SOURCES = [
  "mission-runtime",
  "workflow-runtime",
  "route-planner",
  "recovery-engine",
  "takeover-state",
  "combined-inference",
] as const;

export type MissionAutopilotExplanationSource =
  (typeof MISSION_AUTOPILOT_EXPLANATION_SOURCES)[number];

export const MISSION_AUTOPILOT_RECOMMENDATION_KINDS = [
  "route",
  "action",
  "takeover",
  "replan",
] as const;

export type MissionAutopilotRecommendationKind =
  (typeof MISSION_AUTOPILOT_RECOMMENDATION_KINDS)[number];

export interface MissionAutopilotRouteStage {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail: string | null;
  isCurrent: boolean;
}

export interface MissionAutopilotFleetRole {
  id: string;
  roleType: MissionAutopilotFleetRoleType;
  title: string;
  status: MissionAutopilotFleetRoleStatus;
  responsibility: string;
  boundAgents: string[];
  boundExecutors: string[];
  currentFocus: string | null;
}

export interface MissionAutopilotTakeoverOption {
  id: string;
  label: string;
  description?: string;
}

export interface MissionAutopilotCandidateRoute {
  id: string;
  label: string;
  mode: MissionAutopilotRouteMode;
  status: MissionAutopilotRouteStatus;
  title: string;
  name: string;
  summary: string;
  recommended: boolean;
  selected: boolean;
  locked: boolean;
  reason: string | null;
  description: string | null;
  estimatedCost: string | null;
  estimatedDuration: string | null;
  takeoverLoad: MissionAutopilotTakeoverUrgency;
  riskLevel: MissionAutopilotRiskLevel;
  stageKeys: string[];
}

export interface MissionAutopilotRouteEvidenceEvent {
  eventType: MissionAutopilotRouteEvidenceEventType;
  at: string;
  actor: MissionAutopilotRouteChangeActor;
  reason: string | null;
  fromRouteId?: string | undefined;
  toRouteId?: string | undefined;
}

export interface MissionAutopilotRouteEvidenceSummary {
  lastEventType: MissionAutopilotRouteEvidenceEventType | null;
  lastEventAt: string | null;
  events: MissionAutopilotRouteEvidenceEvent[];
}

export interface MissionAutopilotRouteReplanSummary {
  active: boolean;
  reason: string | null;
  fromRouteId: string | null;
  toRouteId: string | null;
  triggeredBy: MissionAutopilotRouteChangeActor | null;
}

export interface MissionAutopilotRouteSelectionSummary {
  status: MissionAutopilotRouteSelectionStatus;
  mode: MissionAutopilotRouteSelectionMode;
  locked: boolean;
  canSwitch: boolean;
  switchRequiresConfirmation: boolean;
  changedAt: string | null;
  changedBy: MissionAutopilotRouteChangeActor | null;
  changedReason: string | null;
}

export interface MissionAutopilotControlAction {
  id: string;
  type: MissionAutopilotControlActionType;
  label: string;
  scope: MissionAutopilotControlScope;
  enabled: boolean;
  reason: string | null;
}

export interface MissionAutopilotExecutionView {
  currentStepKey: string | null;
  currentStepLabel: string | null;
  currentStepStatus: MissionAutopilotExecutionStatus;
  parallelBranchCount: number;
  blockedReasons: string[];
  intermediateDeliverables: string[];
  availableActions: MissionAutopilotControlAction[];
}

export interface MissionAutopilotRecoverySummary {
  state: MissionAutopilotRecoveryState;
  deviationCategory: MissionAutopilotDeviationCategory;
  reason: string | null;
  attemptedActions: string[];
  suggestedActions: MissionAutopilotControlActionType[];
  needsHuman: boolean;
  canAutoRecover: boolean;
}

export interface MissionAutopilotEvidenceTimelineItem {
  id: string;
  type: MissionAutopilotTimelineEventType;
  label: string;
  detail: string | null;
  status: MissionAutopilotTimelineEventStatus;
  source: string | null;
  time: string;
}

export interface MissionAutopilotEvidenceCorrelationIndex {
  missionId: string;
  workflowId: string | null;
  replayId: string | null;
  sessionId: string | null;
  timelineId: string;
  routeIds: string[];
  recommendedRouteId?: string | null;
  selectedRouteId?: string | null;
  routeStageKeys: string[];
  currentStepKey?: string | null;
  runtimeEventIds: string[];
  decisionIds: string[];
  operatorActionIds: string[];
  auditEventIds: string[];
  lineageIds: string[];
}

export interface MissionAutopilotCurrentStateExplanation {
  summary: string;
  driveState: MissionAutopilotDriveState;
  missionStatus: MissionStatus;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  workflowStatus: string | null;
  workflowStage: string | null;
  routeSelectionStatus?: MissionAutopilotRouteSelectionStatus | null;
  selectedRouteId?: string | null;
  correlationTimelineId?: string | null;
  sources: MissionAutopilotExplanationSource[];
  updatedAt: string;
}

export interface MissionAutopilotRecommendationReason {
  kind: MissionAutopilotRecommendationKind;
  summary: string;
  source: MissionAutopilotExplanationSource;
  routeId: string | null;
  actionType: MissionAutopilotControlActionType | null;
  takeoverType: MissionAutopilotTakeoverType | null;
  decisionId: string | null;
  routeSelectionStatus?: MissionAutopilotRouteSelectionStatus | null;
  correlationTimelineId?: string | null;
  updatedAt: string;
}

export interface MissionAutopilotRemainingStepItem {
  key: string;
  label: string;
  status: MissionStage["status"];
  isCurrent: boolean;
}

export interface MissionAutopilotRemainingStepsExplanation {
  currentStepKey: string | null;
  currentStepLabel: string | null;
  mainlineSteps: MissionAutopilotRemainingStepItem[];
  pendingSteps: MissionAutopilotRemainingStepItem[];
  parallelBranchCount: number;
  replanChangeSummary: string | null;
  selectedRouteId?: string | null;
  routeSelectionStatus?: MissionAutopilotRouteSelectionStatus | null;
}

export interface MissionAutopilotExplanationSummary {
  current: string;
  nextSteps: string[];
  recommendationReasons: string[];
  currentState?: MissionAutopilotCurrentStateExplanation;
  recommendationDetails?: MissionAutopilotRecommendationReason[];
  remainingSteps?: MissionAutopilotRemainingStepsExplanation;
  riskSummary: string[];
  evidenceHints: string[];
  telemetrySignals: string[];
}

export interface MissionAutopilotRouteSummary {
  id: string;
  label: string;
  mode: MissionAutopilotRouteMode;
  status: MissionAutopilotRouteStatus;
  progress: number;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  stages: MissionAutopilotRouteStage[];
  riskPoints: string[];
  takeoverPointIds: string[];
  recommendedRouteId: string | null;
  selectedRouteId: string | null;
  locked: boolean;
  changeReason: string | null;
  candidateRoutes: MissionAutopilotCandidateRoute[];
  selectionStatus: MissionAutopilotRouteSelectionStatus;
  selectionLocked: boolean;
  selected: MissionAutopilotCandidateRoute | null;
  selectedRoute: MissionAutopilotCandidateRoute | null;
  selection: MissionAutopilotRouteSelectionSummary;
  evidence: MissionAutopilotRouteEvidenceSummary;
  replan: MissionAutopilotRouteReplanSummary;
}

export interface MissionAutopilotDriveStateSummary {
  state: MissionAutopilotDriveState;
  label: string;
  detail: string;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  blocked: boolean;
  waitingForUser: boolean;
  riskLevel: MissionAutopilotRiskLevel;
  confidence: MissionAutopilotConfidenceLevel;
}

export interface MissionAutopilotFleetSummary {
  roles: MissionAutopilotFleetRole[];
  activeRoleCount: number;
  blockedRoleCount: number;
}

export interface MissionAutopilotTakeoverSummary {
  status: MissionAutopilotTakeoverStatus | null;
  required: boolean;
  blocking: boolean;
  type: MissionAutopilotTakeoverType | null;
  reason: string | null;
  prompt: string | null;
  decisionId: string | null;
  options: MissionAutopilotTakeoverOption[];
  urgency: MissionAutopilotTakeoverUrgency;
}

export interface MissionAutopilotEvidenceSummary {
  eventCount: number;
  artifactCount: number;
  lastSignal: string | null;
  latestEventType: string | null;
  updatedAt: string;
  trustLevel: MissionAutopilotEvidenceTrustLevel;
  gaps: string[];
  timeline: MissionAutopilotEvidenceTimelineItem[];
  correlation: MissionAutopilotEvidenceCorrelationIndex;
}

export interface MissionAutopilotBindingsSummary {
  missionId: string;
  workflowId: string | null;
  executorJobId: string | null;
  instanceId: string | null;
}

export interface MissionAutopilotDestinationConfidenceSummary {
  level: MissionAutopilotConfidenceLevel;
  reason: string | null;
  signals: string[];
}

export interface MissionAutopilotDestinationSubGoal {
  id: string;
  title: string;
  source: "mission-text" | "work-package" | "mission-stage";
  status: MissionStage["status"] | null;
}

export interface MissionAutopilotMissingInfoDetail {
  item: string;
  impact: string;
  blocking: boolean;
  clarification?: string | null;
}

export interface MissionAutopilotDestinationSummary {
  id: string;
  goal: string;
  request: string;
  taskType: MissionAutopilotDestinationTaskType;
  auxiliaryTaskTypes: MissionAutopilotDestinationTaskType[];
  subGoals?: MissionAutopilotDestinationSubGoal[];
  constraints: string[];
  successCriteria: string[];
  deliverables: string[];
  missingInfo: string[];
  confidence?: MissionAutopilotDestinationConfidenceSummary;
  missingInfoDetails?: MissionAutopilotMissingInfoDetail[];
  suggestedClarifications?: string[];
}

export type MissionAutopilotDestinationInputSource =
  | "chat"
  | "mission_form"
  | "workflow_launch"
  | "api";

export type MissionAutopilotDestinationFieldSource =
  | "explicit"
  | "inferred"
  | "default";

export type MissionAutopilotDestinationFieldStatus =
  | "confirmed"
  | "inferred"
  | "defaulted"
  | "missing";

export type MissionAutopilotDestinationConstraintDimension =
  | "time"
  | "budget"
  | "permission"
  | "format"
  | "style"
  | "data-scope"
  | "tool"
  | "governance"
  | "taboo-boundary";

export interface MissionAutopilotDestinationSourceInput {
  text: string;
  attachments: Array<{
    name: string;
    kind: string;
    path?: string;
    url?: string;
    description?: string;
  }>;
  source: MissionAutopilotDestinationInputSource;
  submittedAt: string;
  missionId: string;
}

export interface MissionAutopilotDestinationGoalSummary {
  title: string;
  summary: string;
  expectedDeliverables: string[];
  businessIntent: string | null;
  goalType: MissionAutopilotDestinationTaskType;
  sourceRefs: string[];
  confidence: MissionAutopilotConfidenceLevel;
}

export interface MissionAutopilotParsedDestinationSubGoal
  extends MissionAutopilotDestinationSubGoal {
  description: string | null;
  priority: number;
  dependsOn: string[];
  deliverables: string[];
  confidence: MissionAutopilotConfidenceLevel;
  blockingQuestions: string[];
}

export interface MissionAutopilotDestinationConstraint {
  id: string;
  dimension: MissionAutopilotDestinationConstraintDimension;
  value: string;
  required: boolean;
  source: MissionAutopilotDestinationFieldSource;
  status: MissionAutopilotDestinationFieldStatus;
  confidence: MissionAutopilotConfidenceLevel;
  appliesTo: string;
  evidenceRefs: string[];
}

export interface MissionAutopilotDestinationSuccessCriterion {
  id: string;
  description: string;
  metricType: "deliverable" | "quality" | "state" | "review" | "unknown";
  required: boolean;
  source: MissionAutopilotDestinationFieldSource;
  status: MissionAutopilotDestinationFieldStatus;
  confidence: MissionAutopilotConfidenceLevel;
  appliesTo: string;
  evidenceRefs: string[];
  verificationHint: string;
}

export interface MissionAutopilotDestinationMissingInformationItem {
  id: string;
  item: string;
  impact: string;
  blocking: boolean;
  source: "runtime" | "explicit" | "inferred";
  status: "missing";
  confidence: MissionAutopilotConfidenceLevel;
  appliesTo: string;
  suggestedClarification: string;
}

export interface MissionAutopilotDestinationClarificationPrompt {
  id: string;
  question: string;
  source: "runtime" | "parser";
  required: boolean;
  missingInformationId: string;
}

export interface MissionAutopilotDestinationEvidence {
  id: string;
  kind:
    | "source-input"
    | "mission-summary"
    | "decision-prompt"
    | "runtime-state"
    | "work-package";
  text: string;
  confidence: MissionAutopilotConfidenceLevel;
}

export interface MissionAutopilotDestinationAssumption {
  id: string;
  description: string;
  confidence: MissionAutopilotConfidenceLevel;
}

export interface MissionAutopilotParsedDestination {
  id: string;
  sourceInput: MissionAutopilotDestinationSourceInput;
  normalizedGoal: MissionAutopilotDestinationGoalSummary;
  subGoals: MissionAutopilotParsedDestinationSubGoal[];
  constraints: MissionAutopilotDestinationConstraint[];
  successCriteria: MissionAutopilotDestinationSuccessCriterion[];
  missingInformation: MissionAutopilotDestinationMissingInformationItem[];
  taskType: MissionAutopilotDestinationTaskType;
  auxiliaryTaskTypes: MissionAutopilotDestinationTaskType[];
  confidence: MissionAutopilotDestinationConfidenceSummary;
  assumptions: MissionAutopilotDestinationAssumption[];
  suggestedClarifications: MissionAutopilotDestinationClarificationPrompt[];
  evidence: MissionAutopilotDestinationEvidence[];
  mappedMissionContext: {
    title: string;
    summary: string;
    metadata: {
      taskType: MissionAutopilotDestinationTaskType;
      auxiliaryTaskTypes: MissionAutopilotDestinationTaskType[];
      constraintCount: number;
      successCriterionCount: number;
      missingInformationCount: number;
    };
    reviewInput: {
      constraints: string[];
      successCriteria: string[];
      missingInformation: string[];
    };
  };
  mappedWorkflowInput: {
    goal: string;
    plannerInput: {
      subGoals: string[];
      constraints: string[];
      successCriteria: string[];
    };
    runtimeGovernance: {
      permissions: string[];
      budgets: string[];
      toolLimits: string[];
    };
    clarifyInput: {
      questions: string[];
      blockingQuestions: string[];
    };
  };
  version: number;
  updatedAt: string;
}

export interface MissionAutopilotSummary {
  version: string;
  source: string;
  destination: MissionAutopilotDestinationSummary;
  route: MissionAutopilotRouteSummary;
  driveState: MissionAutopilotDriveStateSummary;
  fleet: MissionAutopilotFleetSummary;
  takeover: MissionAutopilotTakeoverSummary;
  execution: MissionAutopilotExecutionView;
  recovery: MissionAutopilotRecoverySummary;
  evidence: MissionAutopilotEvidenceSummary;
  explanation: MissionAutopilotExplanationSummary;
  bindings: MissionAutopilotBindingsSummary;
}

interface BuildMissionAutopilotSummaryInput {
  mission: MissionRecord;
  workflowId?: string | null;
  source?: string;
  version?: string;
  workflowRuntime?: {
    status: string | null;
    currentStage: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    directive?: string | null;
  };
}

export interface ParseMissionDestinationInput {
  source?: string;
  version?: string;
}

function uniqueNonEmpty(values: Array<string | null | undefined>, limit = 5): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = trimText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }

  return result;
}

function trimText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

const DESTINATION_SUCCESS_CRITERIA_LABELS = [
  "success criteria",
  "acceptance criteria",
  "definition of done",
  "done when",
  "done criteria",
  "completion criteria",
  "\u6210\u529f\u6761\u4ef6",
  "\u9a8c\u6536\u6761\u4ef6",
  "成功标准",
  "验收标准",
  "完成标准",
] as const;

const DESTINATION_DELIVERABLE_LABELS = [
  "deliverables",
  "expected deliverables",
  "expected outputs",
  "outputs",
  "artifacts",
  "delivery package",
  "\u4ea4\u4ed8\u7269",
  "\u9884\u671f\u4ea4\u4ed8\u7269",
  "\u4ea7\u51fa",
  "\u8f93\u51fa",
] as const;

const DESTINATION_CONSTRAINT_LABELS = [
  "constraints",
  "guardrails",
  "requirements",
  "time",
  "deadline",
  "budget",
  "permission",
  "permissions",
  "output format",
  "format",
  "style",
  "data scope",
  "scope",
  "tools",
  "tooling",
  "\u65f6\u95f4",
  "\u622a\u6b62\u65f6\u95f4",
  "\u622a\u6b62\u65e5\u671f",
  "\u9884\u7b97",
  "\u6743\u9650",
  "\u8f93\u51fa\u683c\u5f0f",
  "\u683c\u5f0f",
  "\u98ce\u683c",
  "\u6570\u636e\u8303\u56f4",
  "\u8303\u56f4",
  "\u5de5\u5177",
  "限制",
  "约束",
  "要求",
] as const;

const DESTINATION_SUB_GOAL_LABELS = [
  "sub-goals",
  "subgoals",
  "sub goals",
  "steps",
  "milestones",
  "tasks",
  "plan",
  "\u5b50\u76ee\u6807",
  "\u6b65\u9aa4",
  "\u91cc\u7a0b\u7891",
  "\u4efb\u52a1",
  "\u8ba1\u5212",
] as const;

const DESTINATION_MISSING_INFO_LABELS = [
  "missing info",
  "missing information",
  "open questions",
  "clarifications",
  "clarification needed",
  "needs clarification",
  "need to know",
  "\u7f3a\u5931\u4fe1\u606f",
  "\u5f85\u6f84\u6e05",
  "\u9700\u8981\u6f84\u6e05",
  "\u5f00\u653e\u95ee\u9898",
] as const;

const DESTINATION_SECTION_LABELS = [
  ...DESTINATION_DELIVERABLE_LABELS,
  ...DESTINATION_SUCCESS_CRITERIA_LABELS,
  ...DESTINATION_CONSTRAINT_LABELS,
  ...DESTINATION_SUB_GOAL_LABELS,
  ...DESTINATION_MISSING_INFO_LABELS,
] as const;

const DESTINATION_STRUCTURED_VALUE_KEYS = {
  deliverables: [
    "deliverable",
    "deliverables",
    "expectedDeliverables",
    "expected_deliverables",
    "expectedOutputs",
    "expected_outputs",
    "output",
    "outputs",
    "artifact",
    "artifacts",
    "name",
    "fileName",
    "filename",
    "title",
    "value",
    "description",
  ],
  successCriteria: [
    "successCriteria",
    "success_criteria",
    "acceptanceCriteria",
    "acceptance_criteria",
    "definitionOfDone",
    "definition_of_done",
    "doneCriteria",
    "done_criteria",
    "criterion",
    "criteria",
    "description",
    "value",
    "text",
    "summary",
    "label",
    "title",
  ],
  constraints: [
    "constraints",
    "constraint",
    "requirements",
    "requirement",
    "guardrails",
    "guardrail",
    "deadline",
    "dueDate",
    "due_date",
    "time",
    "budget",
    "budgets",
    "permission",
    "permissions",
    "format",
    "outputFormat",
    "output_format",
    "style",
    "scope",
    "dataScope",
    "data_scope",
    "tools",
    "tooling",
    "toolLimits",
    "tool_limits",
    "tool",
    "governance",
    "value",
    "description",
    "text",
    "summary",
    "label",
  ],
} as const;

const DESTINATION_STRUCTURED_PATHS = {
  deliverables: [
    ["destination", "deliverables"],
    ["destination", "expectedDeliverables"],
    ["destination", "expectedOutputs"],
    ["destination", "outputs"],
    ["destination", "artifacts"],
    ["autopilotDestination", "deliverables"],
    ["autopilotDestination", "expectedDeliverables"],
    ["missionDestination", "deliverables"],
    ["missionDestination", "expectedDeliverables"],
    ["normalizedGoal", "expectedDeliverables"],
    ["goal", "expectedDeliverables"],
    ["mappedMissionContext", "reviewInput", "deliverables"],
    ["mappedWorkflowInput", "plannerInput", "deliverables"],
    ["reviewInput", "deliverables"],
    ["plannerInput", "deliverables"],
    ["deliverables"],
    ["expectedDeliverables"],
    ["expectedOutputs"],
    ["outputs"],
  ],
  successCriteria: [
    ["destination", "successCriteria"],
    ["destination", "acceptanceCriteria"],
    ["destination", "definitionOfDone"],
    ["autopilotDestination", "successCriteria"],
    ["autopilotDestination", "acceptanceCriteria"],
    ["missionDestination", "successCriteria"],
    ["missionDestination", "acceptanceCriteria"],
    ["mappedMissionContext", "reviewInput", "successCriteria"],
    ["mappedWorkflowInput", "plannerInput", "successCriteria"],
    ["reviewInput", "successCriteria"],
    ["plannerInput", "successCriteria"],
    ["successCriteria"],
    ["acceptanceCriteria"],
    ["definitionOfDone"],
  ],
  constraints: [
    ["destination", "constraints"],
    ["destination", "requirements"],
    ["destination", "guardrails"],
    ["autopilotDestination", "constraints"],
    ["autopilotDestination", "requirements"],
    ["missionDestination", "constraints"],
    ["missionDestination", "requirements"],
    ["mappedMissionContext", "reviewInput", "constraints"],
    ["mappedWorkflowInput", "plannerInput", "constraints"],
    ["mappedWorkflowInput", "runtimeGovernance"],
    ["reviewInput", "constraints"],
    ["plannerInput", "constraints"],
    ["runtimeGovernance"],
    ["constraints"],
    ["requirements"],
    ["guardrails"],
  ],
} as const;

const DESTINATION_STRUCTURED_SKIP_KEYS = new Set([
  "id",
  "key",
  "kind",
  "type",
  "source",
  "status",
  "required",
  "blocking",
  "confidence",
  "metricType",
  "dimension",
  "appliesTo",
  "evidenceRefs",
  "metadata",
  "version",
  "createdAt",
  "updatedAt",
]);

type DestinationStructuredField = keyof typeof DESTINATION_STRUCTURED_VALUE_KEYS;

function buildDestinationEvidenceTexts(mission: MissionRecord): string[] {
  return uniqueNonEmpty(
    [
      mission.title,
      mission.sourceText,
      mission.summary,
      mission.waitingFor,
      mission.decision?.prompt,
      ...(mission.decision?.options ?? []).flatMap(option => [
        option.label,
        option.description,
      ]),
    ],
    16
  );
}

function truncateTaggedSection(
  value: string,
  labels: readonly string[]
): string {
  const lower = value.toLowerCase();
  let boundary = value.length;

  for (const label of labels) {
    const labelLower = label.toLowerCase();
    for (const marker of [
      ` ${labelLower}:`,
      ` ${labelLower}：`,
      ` ${labelLower}-`,
      `\n${labelLower}:`,
      `\n${labelLower}：`,
      `\n${labelLower}-`,
    ]) {
      const index = lower.indexOf(marker);
      if (index >= 0 && index < boundary) {
        boundary = index;
      }
    }
  }

  return value.slice(0, boundary);
}

function splitTaggedDestinationItems(value: string): string[] {
  const normalized = trimText(value);
  if (!normalized) return [];

  return uniqueNonEmpty(
    normalized
      .split(/\s*(?:[;,\uff0c\uff1b\u3001\u2022|]|\r?\n)\s*/g)
      .map(item =>
        item
          .replace(/^[\-\u2022*\s]+/, "")
          .replace(/^\d+[.)]\s+/, "")
      )
      .map(item => item.replace(/\s+/g, " ").trim())
      .map(trimText)
      .filter((item): item is string => Boolean(item)),
    6
  );
}

function extractTaggedDestinationItems(
  texts: string[],
  labels: readonly string[],
  limit = 5
): string[] {
  const items: string[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = trimText(rawLine);
      if (!line) continue;

      for (const label of labels) {
        const labelIndex = line.toLowerCase().indexOf(label.toLowerCase());
        if (labelIndex < 0) continue;

        const suffix = line.slice(labelIndex + label.length);
        const match = suffix.match(/^\s*[:：-]\s*(.+)$/);
        if (!match?.[1]) continue;

        const section = truncateTaggedSection(
          match[1],
          DESTINATION_SECTION_LABELS
        );
        for (const item of splitTaggedDestinationItems(section)) {
          if (seen.has(item)) continue;
          seen.add(item);
          items.push(item);
          if (items.length >= limit) {
            return items;
          }
        }
      }
    }
  }

  return items;
}

function addUniqueDestinationItem(
  items: string[],
  seen: Set<string>,
  value: string | null | undefined,
  limit: number
): boolean {
  const normalized = trimText(value);
  if (!normalized || seen.has(normalized)) {
    return items.length >= limit;
  }

  seen.add(normalized);
  items.push(normalized);
  return items.length >= limit;
}

function collectDestinationStructuredValues(
  value: unknown,
  field: DestinationStructuredField
): string[] {
  if (typeof value === "string") {
    return splitTaggedDestinationItems(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectDestinationStructuredValues(item, field));
  }

  if (!isRecord(value)) {
    return [];
  }

  const keys = DESTINATION_STRUCTURED_VALUE_KEYS[field];
  const values: string[] = [];

  for (const key of keys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    values.push(...collectDestinationStructuredValues(candidate, field));
  }

  if (values.length > 0) {
    return values;
  }

  for (const [key, candidate] of Object.entries(value)) {
    if (DESTINATION_STRUCTURED_SKIP_KEYS.has(key)) continue;
    values.push(...collectDestinationStructuredValues(candidate, field));
  }

  return values;
}

function collectDestinationStructuredRoots(mission: MissionRecord): unknown[] {
  return [
    mission,
    mission.projection,
    mission.decision?.payload,
    ...(mission.decisionHistory || []).map(entry => entry.payload),
  ].filter((value): value is unknown => value !== undefined && value !== null);
}

function extractStructuredDestinationItems(
  mission: MissionRecord,
  field: DestinationStructuredField,
  limit = 5
): string[] {
  const items: string[] = [];
  const seen = new Set<string>();

  for (const root of collectDestinationStructuredRoots(mission)) {
    for (const path of DESTINATION_STRUCTURED_PATHS[field]) {
      const value = readNestedValue(root, path);
      if (value === undefined) continue;

      for (const item of collectDestinationStructuredValues(value, field)) {
        if (addUniqueDestinationItem(items, seen, item, limit)) {
          return items;
        }
      }
    }
  }

  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNestedValue(
  value: unknown,
  path: readonly string[]
): unknown {
  let current: unknown = value;

  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = trimText(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectStringValues(item));
  }

  return [];
}

const MISSION_AUTOPILOT_AUDIT_CORRELATION_PATHS = [
  ["auditEventIds"],
  ["auditEntryIds"],
  ["auditEntryId"],
  ["auditId"],
  ["links", "auditId"],
  ["metadata", "auditId"],
  ["metadata", "links", "auditId"],
  ["context", "auditId"],
  ["context", "links", "auditId"],
  ["context", "inheritedContext", "auditId"],
  ["runtime", "auditId"],
  ["runtime", "links", "auditId"],
  ["observability", "auditId"],
  ["observability", "links", "auditId"],
  ["approval", "auditId"],
  ["audit", "auditId"],
] as const;

const MISSION_AUTOPILOT_LINEAGE_CORRELATION_PATHS = [
  ["lineageIds"],
  ["lineageId"],
  ["links", "lineageId"],
  ["metadata", "lineageId"],
  ["metadata", "links", "lineageId"],
  ["context", "lineageId"],
  ["context", "links", "lineageId"],
  ["context", "inheritedContext", "lineageId"],
  ["runtime", "lineageId"],
  ["runtime", "links", "lineageId"],
  ["observability", "lineageId"],
  ["observability", "links", "lineageId"],
  ["approval", "lineageId"],
  ["audit", "lineageId"],
] as const;

function collectCorrelationIdsFromPayloads(
  payloads: Array<Record<string, unknown> | undefined>,
  paths: readonly (readonly string[])[]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const payload of payloads) {
    if (!payload) continue;

    for (const path of paths) {
      for (const candidate of collectStringValues(readNestedValue(payload, path))) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        result.push(candidate);
      }
    }
  }

  return result;
}

function toSyntheticWorkflowStatus(
  status: MissionStatus
): MissionAutopilotSummary["route"]["status"] {
  if (status === "queued") return "pending";
  if (status === "done") return "completed";
  if (status === "failed" || status === "cancelled") {
    return "completed_with_errors";
  }
  if (status === "waiting") return "running";
  return "running";
}

function inferRouteLabel(
  mission: MissionRecord,
  workflowId: string | null,
  currentStageLabel: string | null
): string {
  if (currentStageLabel && workflowId) {
    return `${currentStageLabel} route`;
  }
  if (workflowId) {
    return "Workflow-backed route";
  }
  return currentStageLabel ? `${currentStageLabel} route` : "Mission route";
}

function inferRouteMode(
  mission: MissionRecord,
  takeoverType: MissionAutopilotTakeoverType | null,
  riskLevel: MissionAutopilotRiskLevel
): MissionAutopilotRouteMode {
  if (mission.kind === "analysis" || mission.kind === "research") {
    return riskLevel === "high" ? "deep" : "standard";
  }
  if (
    takeoverType === "budget" ||
    takeoverType === "risk-acceptance" ||
    riskLevel === "high"
  ) {
    return "deep";
  }
  if (mission.kind === "chat" || mission.kind === "nl-command") {
    return "fast";
  }
  return "standard";
}

function inferRouteChangeActor(
  mission: MissionRecord,
  operatorState: MissionOperatorState
): MissionAutopilotRouteChangeActor {
  if (mission.status === "waiting") return "user";
  if ((mission.attempt ?? 1) > 1) return "runtime";
  if (operatorState === "blocked" || operatorState === "paused") return "operator";
  return "planner";
}

type MissionResolvedRouteSelection = {
  decisionId: string;
  optionId: string | null;
  optionLabel: string | null;
  selectedRouteId: string | null;
  selectedRouteLabel: string | null;
  changedReason: string | null;
  recommendedRouteId: string | null;
  replanRequested: boolean;
  submittedAt: string;
};

function resolveSelectedRouteFromDecisionPayload(
  payload: Record<string, unknown> | undefined,
  optionId: string | null,
  optionLabel: string | null
): { routeId: string | null; routeLabel: string | null } {
  if (!payload || (!optionId && !optionLabel)) {
    return {
      routeId: null,
      routeLabel: null,
    };
  }

  if (optionId) {
    const routeMap = isRecord(payload.routeMap) ? payload.routeMap : undefined;
    const mappedRouteId = trimText(
      routeMap && typeof routeMap[optionId] === "string"
        ? (routeMap[optionId] as string)
        : null
    );
    if (mappedRouteId) {
      return {
        routeId: mappedRouteId,
        routeLabel: optionLabel,
      };
    }
  }

  const candidateRoutes = Array.isArray(payload.candidateRoutes)
    ? payload.candidateRoutes
    : [];
  for (const candidate of candidateRoutes) {
    if (!isRecord(candidate)) continue;

    const candidateOptionId = trimText(
      typeof candidate.optionId === "string"
        ? candidate.optionId
        : typeof candidate.optionValue === "string"
          ? candidate.optionValue
          : null
    );
    const candidateLabel = trimText(
      typeof candidate.optionLabel === "string"
        ? candidate.optionLabel
        : typeof candidate.label === "string"
          ? candidate.label
          : typeof candidate.title === "string"
            ? candidate.title
            : typeof candidate.name === "string"
              ? candidate.name
              : null
    );
    const candidateRouteId = trimText(
      typeof candidate.routeId === "string"
        ? candidate.routeId
        : typeof candidate.id === "string"
          ? candidate.id
          : typeof candidate.value === "string"
            ? candidate.value
            : null
    );

    if (!candidateRouteId) continue;
    if (optionId && candidateOptionId && candidateOptionId === optionId) {
      return {
        routeId: candidateRouteId,
        routeLabel: candidateLabel || optionLabel,
      };
    }
    if (optionLabel && candidateLabel && candidateLabel === optionLabel) {
      return {
        routeId: candidateRouteId,
        routeLabel: candidateLabel,
      };
    }
  }

  return {
    routeId: null,
    routeLabel: null,
  };
}

function readResolvedRouteSelection(
  mission: MissionRecord
): MissionResolvedRouteSelection | null {
  const history = mission.decisionHistory || [];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.type !== "multi-choice") continue;

    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    const resolved = entry.resolved;
    const formData = isRecord(resolved?.metadata?.formData)
      ? resolved.metadata.formData
      : undefined;
    const selectedRouteOptionId = trimText(
      typeof formData?.selectedRouteOptionId === "string"
        ? formData.selectedRouteOptionId
        : resolved?.optionId
    );
    const routeSelectionFromPayload = resolveSelectedRouteFromDecisionPayload(
      payload,
      selectedRouteOptionId,
      trimText(resolved?.optionLabel)
    );

    const selectedRouteId = trimText(
      typeof formData?.selectedRouteId === "string"
        ? formData.selectedRouteId
        : typeof payload?.selectedRouteId === "string"
          ? payload.selectedRouteId
          : routeSelectionFromPayload.routeId
            ? routeSelectionFromPayload.routeId
          : null
    );
    const selectedRouteLabel = trimText(
      typeof formData?.selectedRouteLabel === "string"
        ? formData.selectedRouteLabel
        : routeSelectionFromPayload.routeLabel
          ? routeSelectionFromPayload.routeLabel
        : resolved?.optionLabel
    );
    const recommendedRouteId = trimText(
      typeof formData?.recommendedRouteId === "string"
        ? formData.recommendedRouteId
        : typeof payload?.recommendedRouteId === "string"
          ? payload.recommendedRouteId
          : null
    );
    const replanRequested =
      formData?.replanRequested === true ||
      formData?.replanRequested === "true";

    if (!selectedRouteId && !selectedRouteOptionId && !selectedRouteLabel) {
      continue;
    }

    return {
      decisionId: entry.decisionId,
      optionId: selectedRouteOptionId,
      optionLabel: trimText(resolved?.optionLabel),
      selectedRouteId,
      selectedRouteLabel,
      changedReason:
        trimText(
          typeof formData?.changedReason === "string"
            ? formData.changedReason
            : resolved?.freeText
        ) || trimText(entry.reason),
      recommendedRouteId,
      replanRequested,
      submittedAt: new Date(entry.submittedAt).toISOString(),
    };
  }

  return null;
}

function hasExplicitUserRouteReplan(
  mission: MissionRecord,
  selectedRoute: MissionAutopilotCandidateRoute | null
): boolean {
  const resolvedRouteSelection = readResolvedRouteSelection(mission);
  if (!resolvedRouteSelection?.replanRequested) {
    return false;
  }

  if (
    !resolvedRouteSelection.selectedRouteId ||
    !resolvedRouteSelection.recommendedRouteId ||
    resolvedRouteSelection.selectedRouteId === resolvedRouteSelection.recommendedRouteId
  ) {
    return false;
  }

  return (
    !selectedRoute || selectedRoute.id === resolvedRouteSelection.selectedRouteId
  );
}

function routeMatchesResolvedSelection(
  route: MissionAutopilotCandidateRoute,
  selection: MissionResolvedRouteSelection
): boolean {
  if (selection.selectedRouteId && route.id === selection.selectedRouteId) {
    return true;
  }

  if (selection.optionId) {
    const routeOptionId = trimText(route.id.split(":").at(-1));
    if (routeOptionId && routeOptionId === selection.optionId) {
      return true;
    }
  }

  if (selection.selectedRouteLabel) {
    const target = selection.selectedRouteLabel.toLowerCase();
    return (
      route.label.toLowerCase() === target ||
      route.title.toLowerCase() === target ||
      route.name.toLowerCase() === target
    );
  }

  return false;
}

function inferRouteModeFromSelection(
  selection: MissionResolvedRouteSelection
): MissionAutopilotRouteMode {
  const hints = uniqueNonEmpty([
    selection.selectedRouteId,
    selection.selectedRouteLabel,
    selection.optionId,
    selection.optionLabel,
  ])
    .join(" ")
    .toLowerCase();

  if (hints.includes("fast")) return "fast";
  if (hints.includes("deep")) return "deep";
  if (
    hints.includes("standard") ||
    hints.includes("safe") ||
    hints.includes("balanced")
  ) {
    return "standard";
  }

  return "custom";
}

function ensureResolvedRouteSelectionCandidate(
  routes: MissionAutopilotCandidateRoute[],
  selection: MissionResolvedRouteSelection | null,
  mission: MissionRecord,
  riskLevel: MissionAutopilotRiskLevel,
  stageKeys: string[]
): MissionAutopilotCandidateRoute[] {
  if (!selection?.selectedRouteId) {
    return routes;
  }

  const hasMatchedRoute = routes.some(route =>
    routeMatchesResolvedSelection(route, selection)
  );
  if (hasMatchedRoute) {
    return routes;
  }

  const title =
    selection.selectedRouteLabel ||
    selection.optionLabel ||
    selection.selectedRouteId;

  return [
    ...routes,
    {
      id: selection.selectedRouteId,
      label: title,
      mode: inferRouteModeFromSelection(selection),
      status: toSyntheticWorkflowStatus(mission.status),
      title,
      name: title,
      summary:
        selection.changedReason ||
        `User selected ${title} for the next mission segment.`,
      recommended: false,
      selected: true,
      locked:
        mission.status !== "queued" &&
        mission.status !== "running" &&
        mission.status !== "waiting",
      reason: selection.changedReason,
      description: selection.changedReason,
      estimatedCost: null,
      estimatedDuration: null,
      takeoverLoad: "medium",
      riskLevel: riskLevel === "unknown" ? "medium" : riskLevel,
      stageKeys,
    },
  ];
}

function applyResolvedRouteSelection(
  routes: MissionAutopilotCandidateRoute[],
  selection: MissionResolvedRouteSelection | null
): MissionAutopilotCandidateRoute[] {
  if (!selection) {
    return routes;
  }

  let matched = false;
  const updated = routes.map(route => {
    const isSelected = routeMatchesResolvedSelection(route, selection);
    if (isSelected) {
      matched = true;
    }

    return {
      ...route,
      selected: isSelected,
      reason: isSelected ? selection.changedReason || route.reason : route.reason,
    };
  });

  return matched ? updated : routes;
}

function currentStageKeyFromMission(mission: MissionRecord): string | null {
  return (
    mission.currentStageKey ||
    mission.stages.find(stage => stage.status === "running")?.key ||
    mission.stages.find(stage => stage.status === "failed")?.key ||
    mission.stages.find(stage => stage.status === "done")?.key ||
    null
  );
}

function currentStageLabelFromMission(
  mission: MissionRecord,
  currentStageKey: string | null
): string | null {
  if (!currentStageKey) return null;
  return (
    mission.stages.find(stage => stage.key === currentStageKey)?.label ||
    currentStageKey
  );
}

function defaultStageDetail(stage: MissionStage): string | null {
  if (trimText(stage.detail)) return trimText(stage.detail);
  if (stage.status === "done") return "Stage completed";
  if (stage.status === "running") return "Stage in progress";
  if (stage.status === "failed") return "Stage blocked";
  return null;
}

function inferTakeoverType(mission: MissionRecord): MissionAutopilotTakeoverType | null {
  const prompt = trimText(mission.decision?.prompt)?.toLowerCase() || "";
  const waitingFor = trimText(mission.waitingFor)?.toLowerCase() || "";
  const combined = `${prompt} ${waitingFor}`.trim();

  if (!combined) {
    return mission.status === "waiting" ? "operator" : null;
  }

  if (combined.includes("clarif") || combined.includes("more info") || combined.includes("澄清")) {
    return "clarification";
  }
  if (combined.includes("budget") || combined.includes("预算")) {
    return "budget";
  }
  if (combined.includes("permission") || combined.includes("授权") || combined.includes("权限")) {
    return "permission";
  }
  if (combined.includes("route") || combined.includes("路径") || combined.includes("路线")) {
    return "route-selection";
  }
  if (combined.includes("review") || combined.includes("验收") || combined.includes("交付")) {
    return "delivery-review";
  }
  if (combined.includes("risk") || combined.includes("风险")) {
    return "risk-acceptance";
  }
  if (combined.includes("approve") || combined.includes("确认") || combined.includes("审批")) {
    return "approval";
  }
  return "operator";
}

function inferTakeoverUrgency(mission: MissionRecord): MissionAutopilotTakeoverUrgency {
  if (mission.operatorState === "blocked" || mission.blocker) return "high";
  if (mission.status === "waiting") return "medium";
  return "low";
}

function inferTakeoverStatus(
  mission: MissionRecord,
  operatorState: MissionOperatorState
): MissionAutopilotTakeoverStatus | null {
  if (operatorState === "blocked" || mission.blocker) {
    return "required";
  }
  if (mission.status === "waiting" || mission.decision) {
    return "pending";
  }
  if (trimText(mission.waitingFor)) {
    return "advisory";
  }
  return null;
}

function inferRiskLevel(mission: MissionRecord): MissionAutopilotRiskLevel {
  if (mission.status === "failed" || mission.operatorState === "blocked" || mission.blocker) {
    return "high";
  }
  if (mission.status === "waiting") return "medium";
  if (mission.progress >= 80 && mission.status === "running") return "low";
  if (mission.status === "queued") return "unknown";
  return "medium";
}

function inferConfidenceLevel(mission: MissionRecord): MissionAutopilotConfidenceLevel {
  if (mission.status === "done") return "high";
  if (mission.status === "failed" || mission.operatorState === "blocked") return "low";
  if (mission.status === "waiting") return "medium";
  if (mission.progress >= 60) return "medium";
  if (mission.status === "queued") return "unknown";
  return "medium";
}

function inferFleetRoleStatus(
  mission: MissionRecord,
  operatorState: MissionOperatorState
): MissionAutopilotFleetRoleStatus {
  if (mission.status === "failed" || operatorState === "blocked") return "blocked";
  if (mission.status === "done") return "done";
  if (mission.status === "waiting") return "waiting";
  if (mission.status === "queued") return "idle";
  return "running";
}

function isFleetRoleActive(role: MissionAutopilotFleetRole): boolean {
  return role.status === "running" || role.status === "waiting";
}

function resolveAgentCrewLabel(
  mission: MissionRecord,
  input: { workerId?: string; assignee?: string }
): string | null {
  const workerId = trimText(input.workerId);
  const assignee = trimText(input.assignee);
  const crew = mission.agentCrew || [];

  if (workerId) {
    const byId = crew.find(member => trimText(member.id) === workerId);
    if (byId) {
      return trimText(byId.name) || trimText(byId.id);
    }
  }

  if (assignee) {
    const byName = crew.find(member => trimText(member.name) === assignee);
    if (byName) {
      return trimText(byName.name) || trimText(byName.id);
    }
  }

  return assignee || workerId;
}

function buildExecutorBoundAgents(mission: MissionRecord): string[] {
  const fromWorkPackages = uniqueNonEmpty(
    (mission.workPackages || []).map(pkg =>
      resolveAgentCrewLabel(mission, {
        workerId: pkg.workerId,
        assignee: pkg.assignee,
      })
    )
  );

  if (fromWorkPackages.length > 0) {
    return fromWorkPackages;
  }

  return uniqueNonEmpty(
    (mission.agentCrew || [])
      .filter(member => member.role === "worker")
      .map(member => trimText(member.name) || trimText(member.id))
  );
}

function buildExecutorCurrentFocus(
  mission: MissionRecord,
  currentStageLabel: string | null,
  events: MissionEvent[]
): string | null {
  const packages = mission.workPackages || [];
  const prioritizedPackage =
    packages.find(pkg => pkg.status === "running") ||
    packages.find(pkg => pkg.status === "pending") ||
    packages.find(pkg => pkg.status === "failed") ||
    null;

  return (
    trimText(prioritizedPackage?.title) ||
    trimText(prioritizedPackage?.deliverable) ||
    trimText(prioritizedPackage?.description) ||
    trimText(latestSignal(events)) ||
    currentStageLabel
  );
}

function summarizeDecisionOptions(
  options: MissionDecisionOption[] | undefined
): MissionAutopilotTakeoverOption[] {
  return (options || []).map(option => ({
    id: option.id,
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
  }));
}

function buildRiskPoints(mission: MissionRecord): string[] {
  const points = new Set<string>();
  if (mission.blocker?.reason) {
    points.add(mission.blocker.reason);
  }
  if (mission.waitingFor) {
    points.add(`Awaiting ${mission.waitingFor}`);
  }
  if (mission.status === "failed") {
    points.add("Mission failed and needs recovery");
  }
  if (mission.operatorState === "blocked") {
    points.add("Operator intervention is blocking progress");
  }
  return Array.from(points);
}

function buildDeliverables(mission: MissionRecord): string[] {
  const deliverables = new Set<string>();

  for (const artifact of mission.artifacts || []) {
    const name = trimText(artifact.name);
    if (name) deliverables.add(name);
  }

  for (const pkg of mission.workPackages || []) {
    const deliverable = trimText(pkg.deliverable);
    if (deliverable) deliverables.add(deliverable);
  }

  for (const item of extractTaggedDestinationItems(
    buildDestinationEvidenceTexts(mission),
    DESTINATION_DELIVERABLE_LABELS,
    6
  )) {
    deliverables.add(item);
  }

  for (const item of extractStructuredDestinationItems(
    mission,
    "deliverables",
    6
  )) {
    deliverables.add(item);
  }

  if (deliverables.size > 0) {
    return Array.from(deliverables).slice(0, 6);
  }

  return ["Mission result package"];
}

function normalizeSubGoalStatus(
  status: string | null | undefined
): MissionStage["status"] | null {
  if (status === "pending" || status === "running" || status === "failed") {
    return status;
  }
  if (status === "done" || status === "passed" || status === "verified") {
    return "done";
  }
  return null;
}

function buildSubGoals(mission: MissionRecord): MissionAutopilotDestinationSubGoal[] {
  const subGoals: MissionAutopilotDestinationSubGoal[] = [];
  const seen = new Set<string>();

  const addSubGoal = (
    title: string | null | undefined,
    source: MissionAutopilotDestinationSubGoal["source"],
    status: MissionStage["status"] | null
  ) => {
    const normalized = trimText(title);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    subGoals.push({
      id: `${mission.id}:sub-goal:${subGoals.length + 1}`,
      title: normalized,
      source,
      status,
    });
  };

  for (const item of extractTaggedDestinationItems(
    buildDestinationEvidenceTexts(mission),
    DESTINATION_SUB_GOAL_LABELS,
    5
  )) {
    addSubGoal(item, "mission-text", null);
  }

  for (const workPackage of mission.workPackages || []) {
    addSubGoal(
      workPackage.title,
      "work-package",
      normalizeSubGoalStatus(workPackage.status)
    );
  }

  if (subGoals.length === 0) {
    for (const stage of mission.stages) {
      if (stage.key === "receive" || stage.key === "finalize") continue;
      addSubGoal(stage.label, "mission-stage", stage.status);
      if (subGoals.length >= 3) break;
    }
  }

  return subGoals.slice(0, 5);
}

function buildTaskTypeDefaultSuccessCriteria(
  taskType: MissionAutopilotDestinationTaskType
): string[] {
  switch (taskType) {
    case "analysis":
      return ["Findings and recommendation are clear enough to review."];
    case "research":
      return ["Research findings cite the available mission evidence."];
    case "generation":
      return ["Requested output is drafted and ready for review."];
    case "transformation":
      return ["Converted output preserves the requested source intent."];
    case "implementation":
      return ["Implementation result is produced with validation evidence."];
    case "coordination":
      return ["Required human or workflow decision is captured."];
    case "mixed":
      return ["Each identified work stream has a reviewable outcome."];
    case "unknown":
      return [];
  }
}

function buildSuccessCriteria(mission: MissionRecord): string[] {
  const criteria = new Set<string>();
  const derivedCriteria = extractTaggedDestinationItems(
    buildDestinationEvidenceTexts(mission),
    DESTINATION_SUCCESS_CRITERIA_LABELS
  );
  const structuredCriteria = extractStructuredDestinationItems(
    mission,
    "successCriteria"
  );
  const destinationTaskTypes = buildDestinationTaskTypes(mission);
  if (mission.summary) {
    criteria.add("Mission summary is available");
  }
  if ((mission.artifacts || []).length > 0) {
    criteria.add("Artifacts are produced");
  }
  if (mission.status === "done") {
    criteria.add("Mission reaches delivered state");
  }
  for (const criterion of derivedCriteria) {
    criteria.add(criterion);
  }
  for (const criterion of structuredCriteria) {
    criteria.add(criterion);
  }
  if (derivedCriteria.length > 0 || structuredCriteria.length > 0) {
    for (const criterion of buildTaskTypeDefaultSuccessCriteria(
      destinationTaskTypes.taskType
    )) {
      criteria.add(criterion);
    }
  }
  if (criteria.size === 0) {
    criteria.add("Mission completes its current route");
  }
  return Array.from(criteria);
}

function buildConstraints(mission: MissionRecord): string[] {
  const constraints = new Set<string>();
  const derivedConstraints = extractTaggedDestinationItems(
    buildDestinationEvidenceTexts(mission),
    DESTINATION_CONSTRAINT_LABELS,
    12
  );
  const structuredConstraints = extractStructuredDestinationItems(
    mission,
    "constraints",
    12
  );
  if (mission.kind) {
    constraints.add(`Mission kind: ${mission.kind}`);
  }
  if (mission.projection?.sourceApp) {
    constraints.add(`Source app: ${mission.projection.sourceApp}`);
  }
  if (mission.securitySummary?.level) {
    constraints.add(`Security level: ${mission.securitySummary.level}`);
  }
  if (mission.securitySummary?.networkMode) {
    constraints.add(`Network mode: ${mission.securitySummary.networkMode}`);
  }
  if (mission.securitySummary?.readonlyRootfs !== undefined) {
    constraints.add(
      `Filesystem mode: ${
        mission.securitySummary.readonlyRootfs ? "readonly" : "writable"
      }`
    );
  }
  if (mission.securitySummary?.memoryLimit) {
    constraints.add(`Memory limit: ${mission.securitySummary.memoryLimit}`);
  }
  if (mission.securitySummary?.cpuLimit) {
    constraints.add(`CPU limit: ${mission.securitySummary.cpuLimit}`);
  }
  for (const constraint of derivedConstraints) {
    constraints.add(constraint);
  }
  for (const constraint of structuredConstraints) {
    constraints.add(constraint);
  }
  return Array.from(constraints);
}

function addDestinationTaskTypeScore(
  scores: Map<MissionAutopilotDestinationTaskType, number>,
  taskType: Exclude<MissionAutopilotDestinationTaskType, "mixed" | "unknown">,
  score: number
): void {
  if (score <= 0) return;
  scores.set(taskType, (scores.get(taskType) ?? 0) + score);
}

function buildDestinationTaskTypes(
  mission: MissionRecord
): {
  taskType: MissionAutopilotDestinationTaskType;
  auxiliaryTaskTypes: MissionAutopilotDestinationTaskType[];
} {
  const scores = new Map<MissionAutopilotDestinationTaskType, number>();
  const kind = trimText(mission.kind)?.toLowerCase() ?? "";
  const corpus = uniqueNonEmpty(
    [
      mission.title,
      mission.sourceText,
      mission.summary,
      mission.waitingFor,
      mission.decision?.prompt,
    ],
    12
  )
    .join(" ")
    .toLowerCase();

  const signalTable: Array<{
    taskType: Exclude<MissionAutopilotDestinationTaskType, "mixed" | "unknown">;
    score: number;
    needles: string[];
  }> = [
    {
      taskType: "analysis",
      score: 3,
      needles: [
        "analy",
        "review",
        "audit",
        "assess",
        "evaluate",
        "diagnos",
        "分析",
        "评审",
        "审查",
        "审计",
        "评估",
        "诊断",
        "复核",
      ],
    },
    {
      taskType: "research",
      score: 3,
      needles: [
        "research",
        "investigat",
        "study",
        "survey",
        "explore",
        "调研",
        "研究",
        "检索",
        "梳理",
      ],
    },
    {
      taskType: "generation",
      score: 2,
      needles: [
        "write",
        "draft",
        "generate",
        "compose",
        "prepare",
        "summar",
        "整理",
        "生成",
        "撰写",
        "起草",
        "输出",
        "总结",
        "brief",
        "方案",
      ],
    },
    {
      taskType: "transformation",
      score: 3,
      needles: [
        "transform",
        "convert",
        "migrat",
        "rewrite",
        "refactor",
        "adapt",
        "改造",
        "转换",
        "迁移",
        "重构",
        "改写",
        "优化",
      ],
    },
    {
      taskType: "implementation",
      score: 3,
      needles: [
        "implement",
        "build",
        "develop",
        "ship",
        "fix",
        "execute",
        "code",
        "实现",
        "开发",
        "构建",
        "修复",
        "落地",
        "执行",
      ],
    },
    {
      taskType: "coordination",
      score: 3,
      needles: [
        "approve",
        "approval",
        "coordinate",
        "handoff",
        "confirm",
        "clarif",
        "permission",
        "budget",
        "route selection",
        "发布",
        "审批",
        "协调",
        "确认",
        "澄清",
        "交接",
      ],
    },
  ];

  if (kind.includes("review") || kind.includes("analysis")) {
    addDestinationTaskTypeScore(scores, "analysis", 4);
  }
  if (kind.includes("research")) {
    addDestinationTaskTypeScore(scores, "research", 4);
  }
  if (kind.includes("workflow_organization") || kind.includes("approval")) {
    addDestinationTaskTypeScore(scores, "coordination", 4);
  }
  if (kind.includes("code") || kind.includes("implement")) {
    addDestinationTaskTypeScore(scores, "implementation", 4);
  }
  if (kind.includes("transform") || kind.includes("migration")) {
    addDestinationTaskTypeScore(scores, "transformation", 4);
  }
  if (kind.includes("nl-command")) {
    addDestinationTaskTypeScore(scores, "coordination", 2);
  }

  for (const signal of signalTable) {
    for (const needle of signal.needles) {
      if (corpus.includes(needle)) {
        addDestinationTaskTypeScore(scores, signal.taskType, signal.score);
      }
    }
  }

  const ranked = Array.from(scores.entries())
    .filter(
      (
        entry
      ): entry is [
        Exclude<MissionAutopilotDestinationTaskType, "mixed" | "unknown">,
        number,
      ] => entry[1] > 0
    )
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    });

  if (ranked.length === 0) {
    return {
      taskType: "unknown",
      auxiliaryTaskTypes: [],
    };
  }

  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return {
      taskType: "mixed",
      auxiliaryTaskTypes: ranked.map(([taskType]) => taskType),
    };
  }

  return {
    taskType: ranked[0][0],
    auxiliaryTaskTypes: ranked
      .slice(1)
      .map(([taskType]) => taskType)
      .slice(0, 3),
  };
}

function buildMissingInfo(mission: MissionRecord): string[] {
  const missing = new Set<string>();
  if (mission.status === "waiting" && mission.waitingFor) {
    missing.add(mission.waitingFor);
  }
  if (mission.operatorState === "blocked" && mission.blocker?.reason) {
    missing.add(mission.blocker.reason);
  }
  for (const item of extractTaggedDestinationItems(
    buildDestinationEvidenceTexts(mission),
    DESTINATION_MISSING_INFO_LABELS,
    5
  )) {
    missing.add(item);
  }
  return Array.from(missing);
}

function buildDestinationConfidence(
  mission: MissionRecord
): MissionAutopilotDestinationConfidenceSummary {
  const signals = uniqueNonEmpty([
    mission.summary ? "mission-summary" : null,
    (mission.artifacts || []).length > 0 ? "artifacts-present" : null,
    (mission.events || []).length > 0 ? "runtime-events-present" : null,
    mission.waitingFor ? "waiting-for-input" : null,
    mission.blocker?.reason ? "blocked-by-runtime" : null,
    mission.decision?.prompt ? "decision-prompt-present" : null,
    mission.sourceText ? "source-text-present" : null,
  ]);

  const level = inferConfidenceLevel(mission);
  const reason =
    mission.blocker?.reason
      ? trimText(mission.blocker.reason)
      : mission.waitingFor
        ? `Pending clarification: ${trimText(mission.waitingFor) ?? mission.waitingFor}`
        : mission.summary
          ? "Mission summary and runtime state provide destination context."
          : mission.sourceText
            ? "Source text provides the current destination intent."
            : "Destination intent is inferred from the live mission record.";

  return {
    level,
    reason: reason || null,
    signals,
  };
}

function buildMissingInfoDetails(
  mission: MissionRecord
): MissionAutopilotMissingInfoDetail[] {
  const details: MissionAutopilotMissingInfoDetail[] = [];
  const clarificationPrompt = trimText(mission.decision?.prompt);

  if (mission.status === "waiting" && trimText(mission.waitingFor)) {
    details.push({
      item: trimText(mission.waitingFor) ?? mission.waitingFor!,
      impact:
        mission.decision?.type === "multi-choice"
          ? "Route selection cannot continue until this input is resolved."
          : mission.decision?.type === "request-info"
            ? "Goal understanding remains incomplete until this input is resolved."
            : "Mission progress remains paused until this input is resolved.",
      blocking: true,
      clarification: clarificationPrompt,
    });
  }

  if (mission.operatorState === "blocked" && trimText(mission.blocker?.reason)) {
    details.push({
      item: trimText(mission.blocker?.reason) ?? mission.blocker!.reason,
      impact: "Runtime recovery and execution handoff remain blocked.",
      blocking: true,
      clarification: clarificationPrompt,
    });
  }

  const existingItems = new Set(details.map(detail => detail.item));
  for (const item of extractTaggedDestinationItems(
    buildDestinationEvidenceTexts(mission),
    DESTINATION_MISSING_INFO_LABELS,
    5
  )) {
    if (existingItems.has(item)) continue;
    existingItems.add(item);
    details.push({
      item,
      impact: "Mission can continue, but this clarification would improve delivery quality.",
      blocking: false,
      clarification: `Please clarify: ${item}`,
    });
  }

  return details;
}

function buildSuggestedClarifications(
  details: MissionAutopilotMissingInfoDetail[]
): string[] {
  return uniqueNonEmpty(details.map(detail => detail.clarification), 3);
}

function inferDestinationConstraintDimension(
  value: string
): MissionAutopilotDestinationConstraintDimension {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("permission") ||
    normalized.includes("approval") ||
    normalized.includes("approve") ||
    normalized.includes("redact") ||
    normalized.includes("security") ||
    normalized.includes("\u6743\u9650") ||
    normalized.includes("\u5ba1\u6279") ||
    normalized.includes("\u6279\u51c6")
  ) {
    return "permission";
  }
  if (
    normalized.includes("deadline") ||
    normalized.includes("before ") ||
    normalized.includes("time") ||
    normalized.includes("date") ||
    normalized.includes("\u5c0f\u65f6") ||
    normalized.includes("\u65f6\u95f4") ||
    normalized.includes("\u622a\u6b62") ||
    normalized.includes("\u5b8c\u6210")
  ) {
    return "time";
  }
  if (
    normalized.includes("budget") ||
    normalized.includes("paid") ||
    normalized.includes("cost") ||
    normalized.includes("spend") ||
    normalized.includes("\u9884\u7b97") ||
    normalized.includes("\u82b1\u8d39") ||
    normalized.includes("\u652f\u51fa")
  ) {
    return "budget";
  }
  if (
    normalized.includes("format") ||
    normalized.includes("markdown") ||
    normalized.includes("deck") ||
    normalized.includes("outline") ||
    normalized.includes("\u683c\u5f0f")
  ) {
    return "format";
  }
  if (
    normalized.includes("style") ||
    normalized.includes("tone") ||
    normalized.includes("concise") ||
    normalized.includes("bilingual") ||
    normalized.includes("\u98ce\u683c")
  ) {
    return "style";
  }
  if (
    normalized.includes("scope") ||
    normalized.includes("train") ||
    normalized.includes("internal evidence") ||
    normalized.includes("telemetry") ||
    normalized.includes("offline evidence") ||
    normalized.includes("raw logs") ||
    normalized.includes("source links") ||
    normalized.includes("\u8303\u56f4")
  ) {
    return "data-scope";
  }
  if (
    normalized.includes("tool") ||
    normalized.includes("repository") ||
    normalized.includes("artifact")
  ) {
    return "tool";
  }
  if (
    normalized.includes("source app") ||
    normalized.includes("mission kind") ||
    normalized.includes("network") ||
    normalized.includes("filesystem") ||
    normalized.includes("memory") ||
    normalized.includes("cpu")
  ) {
    return "governance";
  }
  return "taboo-boundary";
}

function inferDestinationSuccessMetricType(
  value: string
): MissionAutopilotDestinationSuccessCriterion["metricType"] {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("artifact") ||
    normalized.includes("deliver") ||
    normalized.includes("output")
  ) {
    return "deliverable";
  }
  if (
    normalized.includes("review") ||
    normalized.includes("committee") ||
    normalized.includes("follow-up")
  ) {
    return "review";
  }
  if (normalized.includes("deck")) {
    return "deliverable";
  }
  if (
    normalized.includes("clear") ||
    normalized.includes("quality") ||
    normalized.includes("ready")
  ) {
    return "quality";
  }
  if (
    normalized.includes("done") ||
    normalized.includes("complete") ||
    normalized.includes("state")
  ) {
    return "state";
  }
  return "unknown";
}

function inferDestinationFieldSource(
  value: string
): MissionAutopilotDestinationFieldSource {
  const normalized = value.toLowerCase();
  if (
    normalized.startsWith("mission kind:") ||
    normalized.startsWith("security level:") ||
    normalized.startsWith("source app:") ||
    normalized.startsWith("network mode:") ||
    normalized.startsWith("filesystem mode:") ||
    normalized.startsWith("memory limit:") ||
    normalized.startsWith("cpu limit:")
  ) {
    return "inferred";
  }
  if (
    value === "Mission summary is available" ||
    value === "Artifacts are produced" ||
    value === "Mission reaches delivered state" ||
    value === "Mission completes its current route"
  ) {
    return "default";
  }
  return "explicit";
}

function buildDestinationEvidence(
  mission: MissionRecord
): MissionAutopilotDestinationEvidence[] {
  const evidence: MissionAutopilotDestinationEvidence[] = [];
  const addEvidence = (
    kind: MissionAutopilotDestinationEvidence["kind"],
    text: string | null | undefined,
    confidence: MissionAutopilotConfidenceLevel
  ) => {
    const normalized = trimText(text);
    if (!normalized) return;
    evidence.push({
      id: `${mission.id}:destination-evidence:${evidence.length + 1}`,
      kind,
      text: normalized,
      confidence,
    });
  };

  addEvidence("source-input", mission.sourceText, "high");
  addEvidence("mission-summary", mission.summary, "medium");
  addEvidence("decision-prompt", mission.decision?.prompt, "medium");
  addEvidence("runtime-state", mission.waitingFor, "medium");
  for (const workPackage of mission.workPackages || []) {
    addEvidence("work-package", workPackage.title, "medium");
  }

  return evidence.slice(0, 8);
}

function buildDestinationAssumptions(
  mission: MissionRecord,
  summary: MissionAutopilotSummary
): MissionAutopilotDestinationAssumption[] {
  const assumptions: MissionAutopilotDestinationAssumption[] = [];
  const addAssumption = (
    description: string | null | undefined,
    confidence: MissionAutopilotConfidenceLevel
  ) => {
    const normalized = trimText(description);
    if (!normalized) return;
    assumptions.push({
      id: `${mission.id}:destination-assumption:${assumptions.length + 1}`,
      description: normalized,
      confidence,
    });
  };

  if (!mission.sourceText) {
    addAssumption(
      "Original source text is unavailable, so the parser falls back to mission title and summary.",
      "low"
    );
  }
  if (summary.destination.subGoals?.length === 0 || !summary.destination.subGoals) {
    addAssumption(
      "No explicit sub-goals were detected; route stages remain the fallback execution structure.",
      "medium"
    );
  }
  if (summary.destination.missingInfo.length === 0) {
    addAssumption(
      "No blocking clarification is required for the current mission state.",
      "medium"
    );
  }

  return assumptions;
}

function buildParsedDestinationSubGoals(
  mission: MissionRecord,
  summary: MissionAutopilotSummary
): MissionAutopilotParsedDestinationSubGoal[] {
  return (summary.destination.subGoals || []).map((subGoal, index) => {
    const matchingPackage = (mission.workPackages || []).find(
      item => trimText(item.title) === subGoal.title
    );
    const matchingMissing = (summary.destination.missingInfoDetails || []).filter(
      detail =>
        detail.item.toLowerCase().includes(subGoal.title.toLowerCase()) ||
        subGoal.title.toLowerCase().includes(detail.item.toLowerCase())
    );
    return {
      ...subGoal,
      description: trimText(matchingPackage?.description) || null,
      priority: index + 1,
      dependsOn: index > 0 ? [summary.destination.subGoals![index - 1]!.id] : [],
      deliverables: uniqueNonEmpty(
        [matchingPackage?.deliverable, summary.destination.deliverables[index]],
        3
      ),
      confidence: subGoal.source === "mission-text" ? "high" : "medium",
      blockingQuestions: matchingMissing.map(detail => detail.item),
    };
  });
}

function buildParsedDestinationConstraints(
  mission: MissionRecord,
  summary: MissionAutopilotSummary
): MissionAutopilotDestinationConstraint[] {
  return summary.destination.constraints.map((constraint, index) => {
    const source = inferDestinationFieldSource(constraint);
    return {
      id: `${mission.id}:destination-constraint:${index + 1}`,
      dimension: inferDestinationConstraintDimension(constraint),
      value: constraint,
      required: true,
      source,
      status:
        source === "default"
          ? "defaulted"
          : source === "inferred"
            ? "inferred"
            : "confirmed",
      confidence: source === "explicit" ? "high" : "medium",
      appliesTo: summary.destination.id,
      evidenceRefs: [summary.destination.id],
    };
  });
}

function buildParsedDestinationSuccessCriteria(
  mission: MissionRecord,
  summary: MissionAutopilotSummary
): MissionAutopilotDestinationSuccessCriterion[] {
  return summary.destination.successCriteria.map((criterion, index) => {
    const source = inferDestinationFieldSource(criterion);
    return {
      id: `${mission.id}:destination-success:${index + 1}`,
      description: criterion,
      metricType: inferDestinationSuccessMetricType(criterion),
      required: true,
      source,
      status:
        source === "default"
          ? "defaulted"
          : source === "inferred"
            ? "inferred"
            : "confirmed",
      confidence: source === "explicit" ? "high" : "medium",
      appliesTo: summary.destination.id,
      evidenceRefs: [summary.destination.id],
      verificationHint: `Verify that "${criterion}" is satisfied before delivery.`,
    };
  });
}

function buildParsedDestinationMissingInformation(
  mission: MissionRecord,
  summary: MissionAutopilotSummary
): MissionAutopilotDestinationMissingInformationItem[] {
  return (summary.destination.missingInfoDetails || []).map((detail, index) => ({
    id: `${mission.id}:destination-missing:${index + 1}`,
    item: detail.item,
    impact: detail.impact,
    blocking: detail.blocking,
    source: detail.blocking ? "runtime" : "explicit",
    status: "missing",
    confidence: detail.blocking ? "high" : "medium",
    appliesTo: summary.destination.id,
    suggestedClarification:
      trimText(detail.clarification) || `Please clarify: ${detail.item}`,
  }));
}

function buildParsedDestinationClarifications(
  mission: MissionRecord,
  missingInformation: MissionAutopilotDestinationMissingInformationItem[]
): MissionAutopilotDestinationClarificationPrompt[] {
  return missingInformation.map((item, index) => ({
    id: `${mission.id}:destination-clarification:${index + 1}`,
    question: item.suggestedClarification,
    source: item.blocking ? "runtime" : "parser",
    required: item.blocking,
    missingInformationId: item.id,
  }));
}

function latestEventType(events: MissionEvent[]): string | null {
  return events.length > 0 ? events[events.length - 1]?.type || null : null;
}

function latestSignal(events: MissionEvent[]): string | null {
  return trimText(events[events.length - 1]?.message);
}

function latestOperatorActionOfType(
  mission: MissionRecord,
  actionType: MissionOperatorActionRecord["action"]
): MissionOperatorActionRecord | null {
  const actions = mission.operatorActions || [];
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action?.action === actionType) {
      return action;
    }
  }
  return null;
}

function inferRouteChangeReason(mission: MissionRecord): string | null {
  const resolvedRouteSelection = readResolvedRouteSelection(mission);
  if (resolvedRouteSelection?.changedReason) {
    return resolvedRouteSelection.changedReason;
  }

  const blockerReason = trimText(mission.blocker?.reason);
  const waitingReason = trimText(mission.waitingFor);
  const latestRetry = latestOperatorActionOfType(mission, "retry");
  const attempt = mission.attempt ?? 1;
  const retryReason =
    trimText(latestRetry?.reason) || trimText(latestRetry?.detail);

  if (attempt > 1) {
    return (
      blockerReason ||
      retryReason ||
      waitingReason ||
      `Mission has retried ${attempt - 1} time(s).`
    );
  }

  return waitingReason || blockerReason;
}

function availableControlActionTypes(
  mission: MissionRecord,
  operatorState: MissionOperatorState
): MissionAutopilotControlActionType[] {
  if (mission.status === "failed" || mission.status === "cancelled") {
    return mission.status === "failed" ? ["retry", "escalate", "terminate"] : ["retry"];
  }
  if (operatorState === "paused") {
    return ["resume", "terminate"];
  }
  if (operatorState === "blocked") {
    return ["resume", "retry", "escalate", "terminate"];
  }
  if (mission.status === "waiting") {
    return ["wait", "resume", "replan", "terminate"];
  }
  if (mission.attempt && mission.attempt > 1) {
    return ["run", "retry", "replan", "terminate"];
  }
  return ["run", "wait", "replan", "terminate"];
}

function buildControlActionReason(
  mission: MissionRecord,
  operatorState: MissionOperatorState,
  type: MissionAutopilotControlActionType,
  currentStageLabel: string | null
): string | null {
  const waitingReason = trimText(mission.waitingFor);
  const blockerReason = trimText(mission.blocker?.reason);

  switch (type) {
    case "run":
      return currentStageLabel
        ? `Continue executing ${currentStageLabel}.`
        : "Continue the current mission stage.";
    case "wait":
      return waitingReason
        ? `Hold the current stage until ${waitingReason} is resolved.`
        : "Pause route progression until runtime or human signals unblock execution.";
    case "resume":
      if (mission.status === "waiting") {
        return waitingReason
          ? `Resume once ${waitingReason} is resolved.`
          : "Resume after the pending takeover is resolved.";
      }
      if (operatorState === "blocked" || blockerReason) {
        return blockerReason
          ? `Resume after clearing blocker: ${blockerReason}`
          : "Resume after the blocker is cleared.";
      }
      return "Resume the mission from the latest safe checkpoint.";
    case "retry":
      return blockerReason
        ? `Retry after addressing blocker: ${blockerReason}`
        : "Retry the mission from the latest safe checkpoint.";
    case "escalate":
      return blockerReason
        ? `Escalate for human review because ${blockerReason}`
        : "Escalate for human review or operator intervention.";
    case "terminate":
      return "Terminate the mission and stop further execution.";
    case "replan":
      if (waitingReason) {
        return `Replan the active route around ${waitingReason}.`;
      }
      if (blockerReason) {
        return `Replan the route to avoid blocker: ${blockerReason}`;
      }
      if ((mission.attempt ?? 1) > 1) {
        return "Replan the route before retrying execution.";
      }
      return "Adapt the active route before more work is dispatched.";
    default:
      return null;
  }
}

function buildControlActions(
  mission: MissionRecord,
  operatorState: MissionOperatorState,
  currentStageLabel: string | null
): MissionAutopilotControlAction[] {
  return availableControlActionTypes(mission, operatorState).map(type => ({
    id: `${mission.id}:${type}`,
    type,
    label: type.replace(/-/g, " "),
    scope:
      type === "replan"
        ? "route"
        : type === "wait" || type === "run"
          ? "stage"
          : "mission",
    enabled: true,
    reason: buildControlActionReason(mission, operatorState, type, currentStageLabel),
  }));
}

function buildCandidateRoutes(
  mission: MissionRecord,
  workflowId: string,
  currentStageKey: string | null,
  currentStageLabel: string | null,
  riskLevel: MissionAutopilotRiskLevel,
  takeoverType: MissionAutopilotTakeoverType | null
): MissionAutopilotCandidateRoute[] {
  const stageKeys = mission.stages.map(stage => stage.key);
  const baseReason =
    trimText(mission.summary) ||
    trimText(mission.waitingFor) ||
    "Derived from mission intent, current risk, and runtime readiness.";
  const selectedMode = inferRouteMode(mission, takeoverType, riskLevel);
  const resolvedRouteSelection = readResolvedRouteSelection(mission);

  const candidates: MissionAutopilotCandidateRoute[] = [
    {
      id: `${workflowId}:fast`,
      label: "Fast route",
      mode: "fast",
      status: toSyntheticWorkflowStatus(mission.status),
      title: "Fast route",
      name: "Fast route",
      summary: "Favor shorter execution chains and minimal confirmations.",
      recommended: selectedMode === "fast",
      selected: selectedMode === "fast",
      locked: mission.status !== "queued" && mission.status !== "running",
      reason: baseReason,
      description: currentStageLabel
        ? `Optimized for speed through ${currentStageLabel}.`
        : "Optimized for speed and shorter execution depth.",
      estimatedCost: "low",
      estimatedDuration: "short",
      takeoverLoad: "medium",
      riskLevel: riskLevel === "high" ? "medium" : "low",
      stageKeys,
    },
    {
      id: `${workflowId}:standard`,
      label: "Standard route",
      mode: "standard",
      status: toSyntheticWorkflowStatus(mission.status),
      title: "Standard route",
      name: "Standard route",
      summary: "Balance execution depth, governance, and delivery confidence.",
      recommended: selectedMode === "standard",
      selected: selectedMode === "standard",
      locked: mission.status !== "queued" && mission.status !== "running",
      reason: baseReason,
      description: currentStageLabel
        ? `Balanced route aligned to ${currentStageLabel}.`
        : "Balanced route for standard mission delivery.",
      estimatedCost: "medium",
      estimatedDuration: "medium",
      takeoverLoad: "medium",
      riskLevel,
      stageKeys,
    },
    {
      id: `${workflowId}:deep`,
      label: "Deep route",
      mode: "deep",
      status: toSyntheticWorkflowStatus(mission.status),
      title: "Deep route",
      name: "Deep route",
      summary: "Favor verification, recovery headroom, and auditability.",
      recommended: selectedMode === "deep",
      selected: selectedMode === "deep",
      locked: mission.status !== "queued" && mission.status !== "running",
      reason:
        riskLevel === "high" || mission.status === "waiting"
          ? "High-risk or human-gated missions benefit from deeper governance."
          : baseReason,
      description: currentStageLabel
        ? `Adds more governance and verification around ${currentStageLabel}.`
        : "Adds more governance, verification, and recovery headroom.",
      estimatedCost: "high",
      estimatedDuration: "long",
      takeoverLoad: "high",
      riskLevel: riskLevel === "unknown" ? "medium" : riskLevel,
      stageKeys,
    },
  ];

  const routeCandidatesBase =
    currentStageKey === "finalize"
      ? candidates.map(candidate => ({
          ...candidate,
          locked: true,
        }))
      : candidates;

  const resolvedCandidates = applyResolvedRouteSelection(
    ensureResolvedRouteSelectionCandidate(
      routeCandidatesBase,
      resolvedRouteSelection,
      mission,
      riskLevel,
      stageKeys
    ),
    resolvedRouteSelection
  );

  if (currentStageKey === "finalize") {
    return resolvedCandidates.map(candidate => ({
      ...candidate,
      locked: true,
    }));
  }

  return resolvedCandidates;
}

function inferRouteSelectionStatus(
  mission: MissionRecord,
  selectedRoute: MissionAutopilotCandidateRoute | null
): MissionAutopilotRouteSelectionStatus {
  if (hasExplicitUserRouteReplan(mission, selectedRoute)) return "replanned";
  if ((mission.attempt ?? 1) > 1) return "replanned";
  if (mission.status === "waiting" && mission.decision?.type === "multi-choice") {
    return "alternatives-available";
  }
  if (
    mission.status === "done" ||
    mission.status === "failed" ||
    mission.status === "cancelled"
  ) {
    return "locked";
  }
  if (readResolvedRouteSelection(mission)) return "user-selected";
  if (selectedRoute && !selectedRoute.recommended) return "user-selected";
  if (mission.decision) return "alternatives-available";
  return "recommended";
}

function inferRouteSelectionMode(
  mission: MissionRecord,
  selectedRoute: MissionAutopilotCandidateRoute | null
): MissionAutopilotRouteSelectionMode {
  if (hasExplicitUserRouteReplan(mission, selectedRoute)) return "user_selected";
  if ((mission.attempt ?? 1) > 1) return "runtime_replanned";
  if (mission.status === "waiting" && mission.decision?.type === "multi-choice") {
    return "planner_default";
  }
  if (readResolvedRouteSelection(mission)) return "user_selected";
  if (selectedRoute && !selectedRoute.recommended) return "user_selected";
  return "planner_default";
}

function buildRouteEvidence(
  mission: MissionRecord,
  recommendedRouteId: string | null,
  selectedRouteId: string | null,
  changeReason: string | null,
  locked: boolean,
  actor: MissionAutopilotRouteChangeActor
): MissionAutopilotRouteEvidenceSummary {
  const createdAt = new Date(mission.createdAt).toISOString();
  const resolvedRouteSelection = readResolvedRouteSelection(mission);
  const explicitUserReplan =
    resolvedRouteSelection?.replanRequested === true &&
    !!resolvedRouteSelection.selectedRouteId &&
    !!resolvedRouteSelection.recommendedRouteId &&
    resolvedRouteSelection.selectedRouteId !== resolvedRouteSelection.recommendedRouteId;
  const updatedAt =
    resolvedRouteSelection?.submittedAt || new Date(mission.updatedAt).toISOString();
  const events: MissionAutopilotRouteEvidenceEvent[] = [];

  if (recommendedRouteId) {
    events.push({
      eventType: "route.recommended",
      at: createdAt,
      actor: "planner",
      reason: "Planner generated the default recommendation set.",
      toRouteId: recommendedRouteId,
    });
  }

  if (selectedRouteId) {
    events.push({
      eventType:
        (mission.attempt ?? 1) > 1 || explicitUserReplan
          ? "route.replanned"
          : "route.selected",
      at: updatedAt,
      actor: resolvedRouteSelection ? "user" : actor,
      reason: changeReason,
      ...(recommendedRouteId && recommendedRouteId !== selectedRouteId
        ? { fromRouteId: recommendedRouteId }
        : {}),
      toRouteId: selectedRouteId,
    });
  }

  if (locked && selectedRouteId) {
    events.push({
      eventType: "route.locked",
      at: updatedAt,
      actor: resolvedRouteSelection || mission.status === "waiting" ? "user" : actor,
      reason:
        changeReason ||
        (mission.status === "waiting"
          ? "Route selection is waiting for explicit confirmation."
          : "Route is locked by runtime mission state."),
      toRouteId: selectedRouteId,
    });
  }

  const lastEvent = events[events.length - 1] || null;

  return {
    lastEventType: lastEvent?.eventType || null,
    lastEventAt: lastEvent?.at || null,
    events,
  };
}

function inferExecutionStatus(
  mission: MissionRecord,
  operatorState: MissionOperatorState
): MissionAutopilotExecutionStatus {
  if (mission.status === "failed") return "failed";
  if (mission.status === "done") return "done";
  if (mission.status === "waiting") return "waiting";
  if (operatorState === "blocked" || mission.blocker) return "blocked";
  if (mission.status === "queued") return "pending";
  return "running";
}

function buildIntermediateDeliverables(mission: MissionRecord): string[] {
  const deliverables = new Set<string>();
  for (const artifact of mission.artifacts || []) {
    const name = trimText(artifact.name);
    if (name) deliverables.add(name);
  }
  for (const pkg of mission.workPackages || []) {
    const deliverable = trimText(pkg.deliverable);
    if (deliverable) deliverables.add(deliverable);
  }
  return Array.from(deliverables).slice(0, 5);
}

function buildExecutionView(
  mission: MissionRecord,
  operatorState: MissionOperatorState,
  currentStageKey: string | null,
  currentStageLabel: string | null
): MissionAutopilotExecutionView {
  const agentCount = mission.agentCrew?.length || 0;
  const workPackageCount = mission.workPackages?.length || 0;
  return {
    currentStepKey: currentStageKey,
    currentStepLabel: currentStageLabel,
    currentStepStatus: inferExecutionStatus(mission, operatorState),
    parallelBranchCount: Math.max(agentCount, workPackageCount, mission.executor ? 1 : 0),
    blockedReasons: buildRiskPoints(mission),
    intermediateDeliverables: buildIntermediateDeliverables(mission),
    availableActions: buildControlActions(mission, operatorState, currentStageLabel),
  };
}

function inferDeviationCategory(mission: MissionRecord): MissionAutopilotDeviationCategory {
  if (mission.operatorState === "blocked" && mission.blocker) {
    return "state-block";
  }
  if (mission.status === "failed") {
    return mission.attempt && mission.attempt > 1
      ? "recovery-exhausted"
      : "dependency-failure";
  }
  if (mission.waitingFor || mission.decision) {
    if (mission.decision?.type === "request-info") return "goal-deviation";
    if (mission.decision?.type === "multi-choice") return "route-deviation";
    return "governance-deviation";
  }
  if (mission.events.some(event => event.level === "warn")) {
    return "quality-deviation";
  }
  return "none";
}

function buildRecoverySummary(
  mission: MissionRecord,
  operatorState: MissionOperatorState
): MissionAutopilotRecoverySummary {
  const deviationCategory = inferDeviationCategory(mission);
  const attemptedActions = (mission.operatorActions || [])
    .map(action => action.action)
    .filter(Boolean);
  const needsHuman =
    mission.status === "waiting" ||
    operatorState === "blocked" ||
    deviationCategory === "recovery-exhausted";
  const canAutoRecover =
    mission.status !== "done" &&
    mission.status !== "cancelled" &&
    operatorState !== "blocked" &&
    deviationCategory !== "recovery-exhausted";

  return {
    state:
      deviationCategory === "none"
        ? "healthy"
        : needsHuman
          ? deviationCategory === "recovery-exhausted"
            ? "escalated"
            : "takeover-required"
          : mission.status === "failed"
            ? "recovering"
            : "watching",
    deviationCategory,
    reason: trimText(mission.blocker?.reason) || trimText(mission.waitingFor),
    attemptedActions,
    suggestedActions: canAutoRecover
      ? ["retry", "replan"]
      : needsHuman
        ? ["resume", "escalate", "terminate"]
        : ["run"],
    needsHuman,
    canAutoRecover,
  };
}

function inferEvidenceTrustLevel(
  mission: MissionRecord,
  events: MissionEvent[]
): MissionAutopilotEvidenceTrustLevel {
  if ((mission.artifacts || []).length > 0 && events.length > 0) return "verified";
  if (events.length > 0) return "partial";
  if (mission.status === "queued") return "unverified";
  return "partial";
}

function buildEvidenceGaps(mission: MissionRecord): string[] {
  const gaps = new Set<string>();
  if ((mission.artifacts || []).length === 0) {
    gaps.add("No artifacts captured yet");
  }
  if ((mission.events || []).length === 0) {
    gaps.add("No runtime events captured yet");
  }
  if (!mission.decisionHistory?.length && mission.status === "waiting") {
    gaps.add("Waiting mission has no resolved decision history yet");
  }
  return Array.from(gaps);
}

function buildEvidenceTimeline(
  mission: MissionRecord,
  events: MissionEvent[]
): MissionAutopilotEvidenceTimelineItem[] {
  const timeline: MissionAutopilotEvidenceTimelineItem[] = [];

  for (const event of events.slice(-6)) {
    timeline.push({
      id: `${mission.id}:event:${event.time}:${event.type}`,
      type:
        event.type === "waiting"
          ? "takeover"
          : event.type === "done"
            ? "result"
            : event.type === "progress"
              ? "drive_state_change"
              : "system",
      label: event.type,
      detail: trimText(event.message),
      status:
        event.level === "error"
          ? "failed"
          : event.type === "waiting"
            ? "waiting"
            : event.type === "done"
              ? "done"
              : "running",
      source: event.source || null,
      time: new Date(event.time).toISOString(),
    });
  }

  for (const action of (mission.operatorActions || []).slice(-3)) {
    timeline.push({
      id: action.id,
      type: "operator_action",
      label: action.action,
      detail: trimText(action.detail) || trimText(action.reason),
      status:
        action.result === "rejected"
          ? "failed"
          : action.result === "completed"
            ? "done"
            : "running",
      source: action.requestedBy || "operator",
      time: new Date(action.createdAt).toISOString(),
    });
  }

  for (const history of (mission.decisionHistory || []).slice(-3)) {
    timeline.push({
      id: history.decisionId,
      type: "decision",
      label: history.type,
      detail: trimText(history.prompt) || trimText(history.reason),
      status: "done",
      source: history.submittedBy || null,
      time: new Date(history.submittedAt).toISOString(),
    });
  }

  return timeline
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(-8);
}

function buildEvidenceCorrelationIndex(
  mission: MissionRecord,
  workflowId: string,
  routeIds: string[],
  routeStageKeys: string[],
  events: MissionEvent[],
  recommendedRouteId: string | null,
  selectedRouteId: string | null,
  currentStepKey: string | null
): MissionAutopilotEvidenceCorrelationIndex {
  // Decision payloads already preserve workflow/runtime link facts when upstream
  // approvals or route selections carry them through MissionRecord.
  const decisionPayloads = [
    mission.decision?.payload,
    ...(mission.decisionHistory || []).map(history => history.payload),
  ];

  return {
    missionId: mission.id,
    workflowId: workflowId || null,
    replayId: mission.projection?.replayId || null,
    sessionId: mission.projection?.sessionId || null,
    timelineId: `${mission.id}:timeline`,
    routeIds,
    recommendedRouteId,
    selectedRouteId,
    routeStageKeys,
    currentStepKey,
    runtimeEventIds: events.map(
      event => `${mission.id}:event:${event.time}:${event.type}`
    ),
    decisionIds: Array.from(
      new Set([
        mission.decision?.decisionId,
        ...(mission.decisionHistory || []).map(history => history.decisionId),
      ].filter((value): value is string => typeof value === "string" && value.length > 0))
    ),
    operatorActionIds: (mission.operatorActions || [])
      .map(action => action.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
    auditEventIds: collectCorrelationIdsFromPayloads(
      decisionPayloads,
      MISSION_AUTOPILOT_AUDIT_CORRELATION_PATHS
    ),
    lineageIds: collectCorrelationIdsFromPayloads(
      decisionPayloads,
      MISSION_AUTOPILOT_LINEAGE_CORRELATION_PATHS
    ),
  };
}

function buildExplanationSummary(
  mission: MissionRecord,
  workflowRuntime: BuildMissionAutopilotSummaryInput["workflowRuntime"],
  driveState: MissionAutopilotDriveState,
  driveStateDetail: string,
  currentStageKey: string | null,
  currentStageLabel: string | null,
  riskPoints: string[],
  selectedRoute: MissionAutopilotCandidateRoute | null,
  selectionStatus: MissionAutopilotRouteSelectionStatus,
  routeChangeReason: string | null,
  routeChangeActor: MissionAutopilotRouteChangeActor,
  takeoverType: MissionAutopilotTakeoverType | null,
  execution: MissionAutopilotExecutionView,
  recovery: MissionAutopilotRecoverySummary,
  evidenceGaps: string[],
  correlation: MissionAutopilotEvidenceCorrelationIndex
): MissionAutopilotExplanationSummary {
  const updatedAt = new Date(mission.updatedAt).toISOString();
  const sources = new Set<MissionAutopilotExplanationSource>(["mission-runtime"]);
  if (workflowRuntime?.status || workflowRuntime?.currentStage) {
    sources.add("workflow-runtime");
  }
  if (mission.status === "waiting" || mission.decision) {
    sources.add("takeover-state");
  }
  if (
    selectionStatus === "replanned" ||
    recovery.state === "recovering" ||
    recovery.state === "escalated" ||
    recovery.deviationCategory === "state-block" ||
    recovery.deviationCategory === "recovery-exhausted"
  ) {
    sources.add("recovery-engine");
  }
  if (!trimText(mission.summary) && !trimText(mission.events.at(-1)?.message)) {
    sources.add("combined-inference");
  }

  const recommendationDetails: MissionAutopilotRecommendationReason[] = [];
  if (selectedRoute) {
    recommendationDetails.push({
      kind: "route",
      summary: selectedRoute.reason || selectedRoute.summary,
      source: "route-planner",
      routeId: selectedRoute.id,
      actionType: null,
      takeoverType: null,
      decisionId: mission.decision?.decisionId || null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: correlation.timelineId,
      updatedAt,
    });
  }

  if (mission.status === "waiting") {
    recommendationDetails.push({
      kind: "action",
      summary:
        trimText(mission.waitingFor)
          ? `Pause route progression until ${trimText(mission.waitingFor)} is resolved.`
          : "Pause route progression until explicit operator input is resolved.",
      source: "recovery-engine",
      routeId: selectedRoute?.id || null,
      actionType: "wait",
      takeoverType,
      decisionId: mission.decision?.decisionId || null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: correlation.timelineId,
      updatedAt,
    });
    recommendationDetails.push({
      kind: "takeover",
      summary:
        trimText(mission.decision?.prompt) ||
        trimText(mission.waitingFor) ||
        "Explicit confirmation is required before the mission can continue.",
      source: "takeover-state",
      routeId: selectedRoute?.id || null,
      actionType: "wait",
      takeoverType,
      decisionId: mission.decision?.decisionId || null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: correlation.timelineId,
      updatedAt,
    });
  } else if (selectionStatus === "replanned") {
    const hasEnabledReplanAction = execution.availableActions.some(
      action => action.type === "replan" && action.enabled
    );
    recommendationDetails.push({
      kind: "action",
      summary: hasEnabledReplanAction
        ? "Replan remains enabled so the route can be adapted before execution resumes."
        : "Retry and escalation remain available while the route is being stabilized.",
      source: "recovery-engine",
      routeId: selectedRoute?.id || null,
      actionType: hasEnabledReplanAction ? "replan" : "retry",
      takeoverType: null,
      decisionId: null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: correlation.timelineId,
      updatedAt,
    });
  }

  if (selectionStatus === "replanned") {
    recommendationDetails.push({
      kind: "replan",
      summary:
        routeChangeReason ||
        "Runtime signals changed enough that the planner selected a fresh route.",
      source:
        routeChangeActor === "runtime" ? "recovery-engine" : "mission-runtime",
      routeId: selectedRoute?.id || null,
      actionType: "replan",
      takeoverType: null,
      decisionId: null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: correlation.timelineId,
      updatedAt,
    });
  }

  const mainlineSteps = mission.stages.map(stage => ({
    key: stage.key,
    label: stage.label,
    status: stage.status,
    isCurrent: stage.key === currentStageKey,
  }));
  const pendingSteps = mainlineSteps.filter(
    stage => stage.status === "pending" || stage.status === "running"
  );

  return {
    current: driveStateDetail,
    currentState: {
      summary: driveStateDetail,
      driveState,
      missionStatus: mission.status,
      currentStageKey,
      currentStageLabel,
      workflowStatus: workflowRuntime?.status || null,
      workflowStage: workflowRuntime?.currentStage || null,
      routeSelectionStatus: selectionStatus,
      selectedRouteId: selectedRoute?.id || null,
      correlationTimelineId: correlation.timelineId,
      sources: Array.from(sources),
      updatedAt,
    },
    nextSteps:
      mission.stages
        .filter(stage => stage.status === "pending" || stage.status === "running")
        .map(stage => stage.label)
        .slice(0, 3),
    recommendationReasons:
      recommendationDetails.length > 0
        ? recommendationDetails.map(reason => reason.summary)
        : ["Use the current route until runtime signals require a change."],
    recommendationDetails:
      recommendationDetails.length > 0 ? recommendationDetails : undefined,
    remainingSteps: {
      currentStepKey: currentStageKey,
      currentStepLabel: currentStageLabel,
      mainlineSteps,
      pendingSteps,
      parallelBranchCount: execution.parallelBranchCount,
      replanChangeSummary:
        selectionStatus === "replanned"
          ? routeChangeReason ||
            "Runtime signals changed enough that the active route was replanned."
          : null,
      selectedRouteId: selectedRoute?.id || null,
      routeSelectionStatus: selectionStatus,
    },
    riskSummary: riskPoints,
    evidenceHints: evidenceGaps.length > 0 ? evidenceGaps : ["Artifacts and runtime logs are available."],
    telemetrySignals: [
      `mission.status:${mission.status}`,
      `drive.state:${inferMissionAutopilotDriveState(mission)}`,
      `recovery.state:${recovery.state}`,
    ],
  };
}

export function inferMissionAutopilotDriveState(
  mission: MissionRecord
): MissionAutopilotDriveState {
  const currentStageKey = currentStageKeyFromMission(mission);

  if (mission.status === "done") return "delivered";
  if (mission.status === "failed" || mission.operatorState === "blocked" || mission.blocker) {
    return "blocked";
  }
  if (mission.status === "waiting") {
    return mission.decision ? "takeover-required" : "clarifying";
  }
  if (currentStageKey === "receive" || currentStageKey === "understand") {
    return "understanding";
  }
  if (currentStageKey === "plan") {
    return mission.attempt && mission.attempt > 1 ? "replanning" : "planning";
  }
  if (currentStageKey === "provision") return "fleet-forming";
  if (currentStageKey === "execute") return "executing";
  if (currentStageKey === "finalize") return "reviewing";
  return mission.status === "queued" ? "understanding" : "executing";
}

export function parseMissionDestination(
  mission: MissionRecord,
  input: ParseMissionDestinationInput = {}
): MissionAutopilotParsedDestination {
  const summary = buildMissionAutopilotSummary({
    mission,
    source: input.source,
    version: input.version,
  });
  const destination = summary.destination;
  const submittedAt = new Date(mission.createdAt || mission.updatedAt).toISOString();
  const parsedSubGoals = buildParsedDestinationSubGoals(mission, summary);
  const parsedConstraints = buildParsedDestinationConstraints(mission, summary);
  const parsedSuccessCriteria = buildParsedDestinationSuccessCriteria(
    mission,
    summary
  );
  const missingInformation = buildParsedDestinationMissingInformation(
    mission,
    summary
  );
  const suggestedClarifications = buildParsedDestinationClarifications(
    mission,
    missingInformation
  );
  const confidence = destination.confidence ?? buildDestinationConfidence(mission);
  const permissions = parsedConstraints
    .filter(item => item.dimension === "permission" || item.dimension === "governance")
    .map(item => item.value);
  const budgets = parsedConstraints
    .filter(item => item.dimension === "budget")
    .map(item => item.value);
  const toolLimits = parsedConstraints
    .filter(item => item.dimension === "tool")
    .map(item => item.value);

  return {
    id: `${mission.id}:destination:v1`,
    sourceInput: {
      text: destination.request,
      attachments: (mission.artifacts || []).map(artifact => ({
        name: artifact.name,
        kind: artifact.kind,
        ...(artifact.path ? { path: artifact.path } : {}),
        ...(artifact.url ? { url: artifact.url } : {}),
        ...(artifact.description ? { description: artifact.description } : {}),
      })),
      source:
        mission.projection?.sourceApp === "workflow"
          ? "workflow_launch"
          : input.source === "api"
            ? "api"
            : mission.sourceText
              ? "chat"
              : "mission_form",
      submittedAt,
      missionId: mission.id,
    },
    normalizedGoal: {
      title: destination.goal,
      summary: trimText(mission.summary) || destination.request,
      expectedDeliverables: destination.deliverables,
      businessIntent: trimText(mission.summary),
      goalType: destination.taskType,
      sourceRefs: uniqueNonEmpty(
        [
          mission.sourceText ? `${mission.id}:sourceText` : null,
          mission.summary ? `${mission.id}:summary` : null,
          mission.decision?.prompt ? `${mission.id}:decision` : null,
        ],
        4
      ),
      confidence: confidence.level,
    },
    subGoals: parsedSubGoals,
    constraints: parsedConstraints,
    successCriteria: parsedSuccessCriteria,
    missingInformation,
    taskType: destination.taskType,
    auxiliaryTaskTypes: destination.auxiliaryTaskTypes,
    confidence,
    assumptions: buildDestinationAssumptions(mission, summary),
    suggestedClarifications,
    evidence: buildDestinationEvidence(mission),
    mappedMissionContext: {
      title: destination.goal,
      summary: trimText(mission.summary) || destination.request,
      metadata: {
        taskType: destination.taskType,
        auxiliaryTaskTypes: destination.auxiliaryTaskTypes,
        constraintCount: parsedConstraints.length,
        successCriterionCount: parsedSuccessCriteria.length,
        missingInformationCount: missingInformation.length,
      },
      reviewInput: {
        constraints: parsedConstraints.map(item => item.value),
        successCriteria: parsedSuccessCriteria.map(item => item.description),
        missingInformation: missingInformation.map(item => item.item),
      },
    },
    mappedWorkflowInput: {
      goal: destination.goal,
      plannerInput: {
        subGoals: parsedSubGoals.map(item => item.title),
        constraints: parsedConstraints.map(item => item.value),
        successCriteria: parsedSuccessCriteria.map(item => item.description),
      },
      runtimeGovernance: {
        permissions,
        budgets,
        toolLimits,
      },
      clarifyInput: {
        questions: suggestedClarifications.map(item => item.question),
        blockingQuestions: suggestedClarifications
          .filter(item => item.required)
          .map(item => item.question),
      },
    },
    version: 1,
    updatedAt: new Date(mission.updatedAt).toISOString(),
  };
}

export function buildMissionAutopilotSummary(
  input: BuildMissionAutopilotSummaryInput
): MissionAutopilotSummary {
  const { mission, workflowRuntime } = input;
  const events = mission.events || [];
  const currentStageKey = currentStageKeyFromMission(mission);
  const currentStageLabel = currentStageLabelFromMission(mission, currentStageKey);
  const driveState = inferMissionAutopilotDriveState(mission);
  const takeoverType = inferTakeoverType(mission);
  const workflowId = input.workflowId || mission.projection?.workflowId || mission.id;
  const operatorState = mission.operatorState ?? "active";
  const riskLevel = inferRiskLevel(mission);
  const routeMode = inferRouteMode(mission, takeoverType, riskLevel);
  const resolvedRouteSelection = readResolvedRouteSelection(mission);
  const routeStages = mission.stages.map(stage => ({
    key: stage.key,
    label: stage.label,
    status: stage.status,
    detail: defaultStageDetail(stage),
    isCurrent: stage.key === currentStageKey,
  }));
  const plannerRoleStatus = inferFleetRoleStatus(mission, operatorState);
  const roles: MissionAutopilotFleetRole[] = [
    {
      id: `${mission.id}:planner`,
      roleType: "planner",
      title: "Planner",
      status: mission.status === "queued" ? "running" : plannerRoleStatus,
      responsibility: "Translate mission intent into an executable route",
      boundAgents: [],
      boundExecutors: [],
      currentFocus: currentStageLabel,
    },
    {
      id: `${mission.id}:operator`,
      roleType: mission.status === "waiting" ? "clarifier" : "operator",
      title: mission.status === "waiting" ? "Clarifier" : "Operator",
      status:
        mission.status === "waiting"
          ? "waiting"
          : operatorState === "blocked"
            ? "blocked"
            : mission.status === "done"
              ? "done"
              : "idle",
      responsibility:
        mission.status === "waiting"
          ? "Collect confirmation and unblock route progression"
          : "Supervise takeovers and operational recovery",
      boundAgents: [],
      boundExecutors: [],
      currentFocus: trimText(mission.waitingFor) || trimText(mission.decision?.prompt),
    },
  ];

  if (mission.executor?.jobId || mission.executor?.name) {
    roles.push({
      id: `${mission.id}:executor`,
      roleType: "executor",
      title: mission.executor?.name || "Executor",
      status:
        mission.status === "done"
          ? "done"
          : mission.status === "failed"
            ? "failed"
            : mission.status === "waiting"
              ? "waiting"
              : mission.status === "running"
                ? "running"
                : "idle",
      responsibility: "Run the active mission execution workload",
      boundAgents: buildExecutorBoundAgents(mission),
      boundExecutors: mission.executor?.jobId ? [mission.executor.jobId] : [],
      currentFocus: buildExecutorCurrentFocus(mission, currentStageLabel, events),
    });
  }

  const driveStateLabelMap: Record<MissionAutopilotDriveState, string> = {
    "understanding": "Understanding destination",
    "clarifying": "Clarifying goal",
    "planning": "Planning route",
    "fleet-forming": "Forming fleet",
    "executing": "Executing route",
    "reviewing": "Reviewing delivery",
    "blocked": "Blocked",
    "takeover-required": "Takeover required",
    "replanning": "Replanning route",
    "delivered": "Delivered",
  };

  const driveStateDetail =
    trimText(mission.summary) ||
    trimText(mission.waitingFor) ||
    trimText(mission.blocker?.reason) ||
    trimText(events[events.length - 1]?.message) ||
    "Mission is progressing through the current route.";
  const candidateRoutes = buildCandidateRoutes(
    mission,
    workflowId,
    currentStageKey,
    currentStageLabel,
    riskLevel,
    takeoverType
  );
  const selectedRoute =
    candidateRoutes.find(candidate => candidate.selected) || candidateRoutes[0] || null;
  const routeIds = Array.from(
    new Set(
      candidateRoutes
        .map(candidate => candidate.id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const routeStageKeys = routeStages.map(stage => stage.key);
  const recommendedRouteId =
    resolvedRouteSelection?.recommendedRouteId ||
    candidateRoutes.find(candidate => candidate.recommended)?.id ||
    null;
  const selectedRouteId = selectedRoute?.id || null;
  const routeLocked =
    mission.status === "waiting" ||
    mission.status === "done" ||
    mission.status === "failed" ||
    mission.status === "cancelled";
  const routeChangeReason = inferRouteChangeReason(mission);
  const routeChangeActor = inferRouteChangeActor(mission, operatorState);
  const selectionStatus = inferRouteSelectionStatus(mission, selectedRoute);
  const selectionMode = inferRouteSelectionMode(mission, selectedRoute);
  const explicitUserReplan = hasExplicitUserRouteReplan(mission, selectedRoute);
  const routeEvidence = buildRouteEvidence(
    mission,
    recommendedRouteId,
    selectedRouteId,
    routeChangeReason,
    routeLocked,
    routeChangeActor
  );
  const execution = buildExecutionView(
    mission,
    operatorState,
    currentStageKey,
    currentStageLabel
  );
  const recovery = buildRecoverySummary(mission, operatorState);
  const evidenceGaps = buildEvidenceGaps(mission);
  const evidenceTimeline = buildEvidenceTimeline(mission, events);
  const evidenceCorrelation = buildEvidenceCorrelationIndex(
    mission,
    workflowId,
    routeIds,
    routeStageKeys,
    events,
    recommendedRouteId,
    selectedRouteId,
    currentStageKey
  );
  const takeoverStatus = inferTakeoverStatus(mission, operatorState);
  const takeoverRequired =
    mission.status === "waiting" || takeoverStatus === "required";
  const takeoverBlocking =
    takeoverRequired || operatorState === "blocked" || Boolean(mission.blocker);
  const takeoverReason =
    trimText(mission.waitingFor) ||
    trimText(mission.blocker?.reason) ||
    trimText(mission.decision?.prompt);
  const destinationMissingInfoDetails = buildMissingInfoDetails(mission);
  const destinationSuggestedClarifications = buildSuggestedClarifications(
    destinationMissingInfoDetails
  );
  const destinationTaskTypes = buildDestinationTaskTypes(mission);
  const destinationSubGoals = buildSubGoals(mission);

  return {
    version: input.version || "client-autopilot-projection/v1",
    source: input.source || "client-mission-projection",
    destination: {
      id: mission.id,
      goal: trimText(mission.title) || "Untitled mission",
      request:
        trimText(mission.sourceText) ||
        trimText(mission.summary) ||
        trimText(mission.title) ||
        "No request captured yet",
      taskType: destinationTaskTypes.taskType,
      auxiliaryTaskTypes: destinationTaskTypes.auxiliaryTaskTypes,
      subGoals: destinationSubGoals.length > 0 ? destinationSubGoals : undefined,
      constraints: buildConstraints(mission),
      successCriteria: buildSuccessCriteria(mission),
      deliverables: buildDeliverables(mission),
      missingInfo: buildMissingInfo(mission),
      confidence: buildDestinationConfidence(mission),
      missingInfoDetails: destinationMissingInfoDetails,
      suggestedClarifications:
        destinationSuggestedClarifications.length > 0
          ? destinationSuggestedClarifications
          : undefined,
    },
    route: {
      id: workflowId,
      label: inferRouteLabel(mission, workflowId, currentStageLabel),
      mode: routeMode,
      status: toSyntheticWorkflowStatus(mission.status),
      progress: Math.max(0, Math.min(100, Math.round(mission.progress || 0))),
      currentStageKey,
      currentStageLabel,
      stages: routeStages,
      riskPoints: buildRiskPoints(mission),
      takeoverPointIds: mission.decision?.decisionId
        ? [mission.decision.decisionId]
        : mission.decision
          ? [mission.id]
          : mission.status === "waiting"
            ? [`${mission.id}:takeover`]
            : [],
      recommendedRouteId,
      selectedRouteId,
      locked: routeLocked,
      changeReason: routeChangeReason,
      candidateRoutes,
      selectionStatus,
      selectionLocked: routeLocked,
      selected: selectedRoute,
      selectedRoute: selectedRoute
        ? {
            ...selectedRoute,
          }
        : null,
      selection: {
        status: selectionStatus,
        mode: selectionMode,
        locked: routeLocked,
        canSwitch:
          mission.status === "waiting" && mission.decision?.type === "multi-choice"
            ? true
            : !routeLocked,
        switchRequiresConfirmation: mission.status === "waiting" || Boolean(mission.decision),
        changedAt: resolvedRouteSelection?.submittedAt || routeEvidence.lastEventAt,
        changedBy: resolvedRouteSelection ? "user" : routeChangeActor,
        changedReason: routeChangeReason,
      },
      evidence: routeEvidence,
      replan: {
        active: selectionStatus === "replanned",
        reason: selectionStatus === "replanned" ? routeChangeReason : null,
        fromRouteId:
          selectionStatus === "replanned" && recommendedRouteId !== selectedRouteId
            ? recommendedRouteId
            : null,
        toRouteId: selectionStatus === "replanned" ? selectedRouteId : null,
        triggeredBy:
          selectionStatus === "replanned"
            ? explicitUserReplan
              ? "user"
              : routeChangeActor
            : null,
      },
    },
    driveState: {
      state: driveState,
      label: driveStateLabelMap[driveState],
      detail: driveStateDetail,
      currentStageKey,
      currentStageLabel,
      blocked:
        mission.status === "failed" ||
        operatorState === "blocked" ||
        Boolean(mission.blocker),
      waitingForUser: mission.status === "waiting",
      riskLevel,
      confidence: inferConfidenceLevel(mission),
    },
    fleet: {
      roles,
      activeRoleCount: roles.filter(role => isFleetRoleActive(role)).length,
      blockedRoleCount: roles.filter(
        role => role.status === "blocked" || role.status === "failed"
      ).length,
    },
    takeover: {
      status: takeoverStatus,
      required: takeoverRequired,
      blocking: takeoverBlocking,
      type: takeoverType,
      reason: takeoverReason,
      prompt: trimText(mission.decision?.prompt),
      decisionId: mission.decision?.decisionId || (mission.decision ? mission.id : null),
      options: summarizeDecisionOptions(mission.decision?.options),
      urgency: inferTakeoverUrgency(mission),
    },
    execution,
    recovery,
    evidence: {
      eventCount: events.length,
      artifactCount: (mission.artifacts || []).length,
      lastSignal: latestSignal(events),
      latestEventType: latestEventType(events),
      updatedAt: new Date(mission.updatedAt).toISOString(),
      trustLevel: inferEvidenceTrustLevel(mission, events),
      gaps: evidenceGaps,
      timeline: evidenceTimeline,
      correlation: evidenceCorrelation,
    },
    explanation: buildExplanationSummary(
      mission,
      workflowRuntime,
      driveState,
      driveStateDetail,
      currentStageKey,
      currentStageLabel,
      buildRiskPoints(mission),
      selectedRoute,
      selectionStatus,
      routeChangeReason,
      routeChangeActor,
      takeoverType,
      execution,
      recovery,
      evidenceGaps,
      evidenceCorrelation
    ),
    bindings: {
      missionId: mission.id,
      workflowId,
      executorJobId: mission.executor?.jobId || null,
      instanceId: mission.projection?.instanceId || workflowId || null,
    },
  };
}
