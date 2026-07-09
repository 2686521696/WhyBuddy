import type {
  FrontendAutopilotLayer,
  FrontendAutopilotViewModelInput,
} from "./autopilot-frontend-model";
import { normalizeFrontendAutopilotViewModel } from "./autopilot-frontend-model";

type UnknownRecord = Record<string, unknown>;

export interface FrontendAutopilotCockpitModelInput {
  frontendState?: FrontendAutopilotViewModelInput | null;
  autopilotSummary?: unknown;
  projection?: unknown;
  launchRoute?: {
    selectedRouteId?: string | null;
    recommendedRouteId?: string | null;
  } | null;
}

export interface FrontendAutopilotCockpitDestinationModel {
  goal: string;
  request: string | null;
  lockState: string | null;
  confirmedAt: string | null;
  modifiedAt: string | null;
  subGoals: string[];
  constraints: string[];
  successCriteria: string[];
  deliverables: string[];
  confidenceLevel: string | null;
  missingInfo: string[];
  suggestedClarifications: string[];
}

export interface FrontendAutopilotCockpitRouteModel {
  selectedRouteId: string | null;
  recommendedRouteId: string | null;
  routeSelectionStatus: string | null;
  locked: boolean;
  candidateCount: number;
}

export interface FrontendAutopilotCockpitProjectionModel {
  taskId: string | null;
  status: string;
  progressPercent: number;
  sourceLayer: FrontendAutopilotLayer;
}

export interface FrontendAutopilotCockpitModel {
  destination: FrontendAutopilotCockpitDestinationModel;
  route: FrontendAutopilotCockpitRouteModel;
  projection: FrontendAutopilotCockpitProjectionModel;
  warnings: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPath(source: unknown, path: string): unknown {
  if (!isRecord(source)) return undefined;
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTextFromValue(value: unknown): string | null {
  const direct = readText(value);
  if (direct || !isRecord(value)) return direct;

  return pickText(value, [
    "value",
    "description",
    "title",
    "item",
    "name",
    "question",
    "text",
    "label",
    "summary",
    "clarification",
    "suggestedClarification",
    "suggested_clarification",
  ]);
}

function pickText(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const text = readText(readPath(source, path));
    if (text) return text;
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map(readTextFromValue)
          .filter((item): item is string => item !== null)
      )
    );
  }
  const single = readTextFromValue(value);
  return single ? [single] : [];
}

function collectTexts(source: unknown, paths: string[]): string[] {
  return Array.from(
    new Set(paths.flatMap(path => readStringArray(readPath(source, path))))
  );
}

const DESTINATION_GOAL_PATHS = [
  "destination.goal",
  "destination.destinationGoal",
  "destination.destination_goal",
  "destination.objective",
  "destination.objectiveText",
  "destination.objective_text",
  "destination.summary",
  "destination.title",
  "normalizedGoal.title",
  "normalizedGoal.goal",
  "mappedWorkflowInput.goal",
  "mappedMissionContext.title",
  "destinationSummary",
  "destinationText",
  "draft.destinationText",
];

const DESTINATION_REQUEST_PATHS = [
  "destination.request",
  "destination.userRequest",
  "destination.user_request",
  "destination.originalRequest",
  "destination.original_request",
  "destination.prompt",
  "destination.input",
  "destination.context",
  "destination.description",
  "destination.sourceInput.text",
  "sourceInput.text",
  "normalizedGoal.summary",
  "mappedMissionContext.summary",
  "request",
  "destinationText",
  "draft.destinationText",
];

const DESTINATION_CONFIDENCE_PATHS = [
  "destination.confidence.level",
  "destination.goalConfidence",
  "destination.goal_confidence",
  "destination.readiness",
  "confidence.level",
  "normalizedGoal.confidence",
];

const DESTINATION_MISSING_INFO_PATHS = [
  "destination.missingInfo",
  "destination.missingInformation",
  "destination.missing_info",
  "destination.missingFields",
  "destination.missing_fields",
  "destination.requiredInfo",
  "destination.required_info",
  "destination.gaps",
  "destination.parser.missingInfo",
  "destination.parser.missingInformation",
  "missingInfo",
  "missingInformation",
  "missing_info",
  "mappedMissionContext.reviewInput.missingInformation",
];

const DESTINATION_CLARIFICATION_PATHS = [
  "destination.suggestedClarifications",
  "destination.suggested_clarifications",
  "destination.clarifications",
  "destination.clarificationQuestions",
  "destination.clarification_questions",
  "destination.missingInfoClarifications",
  "destination.missing_info_clarifications",
  "destination.missingInfoQuestions",
  "destination.missing_info_questions",
  "destination.parser.suggestedClarifications",
  "destination.parser.suggested_clarifications",
  "suggestedClarifications",
  "suggested_clarifications",
  "clarificationQuestions",
  "clarification_questions",
  "mappedWorkflowInput.clarifyInput.questions",
  "mappedWorkflowInput.clarifyInput.blockingQuestions",
];

const DESTINATION_CONFIRMED_AT_PATHS = [
  "destination.confirmedAt",
  "destination.confirmed_at",
  "destination.lockedAt",
  "destination.locked_at",
  "destination.lock.confirmedAt",
  "destination.lock.confirmed_at",
  "destination.lock.lockedAt",
  "destination.lock.locked_at",
  "confirmedAt",
  "confirmed_at",
  "lockedAt",
  "locked_at",
];

const DESTINATION_MODIFIED_AT_PATHS = [
  "destination.modifiedAt",
  "destination.modified_at",
  "destination.updatedAt",
  "destination.updated_at",
  "destination.changedAt",
  "destination.changed_at",
  "destination.lock.modifiedAt",
  "destination.lock.modified_at",
  "modifiedAt",
  "modified_at",
  "updatedAt",
  "updated_at",
];

const DESTINATION_LOCK_STATE_PATHS = [
  "destination.lockState",
  "destination.lock_state",
  "destination.goalLockState",
  "destination.goal_lock_state",
  "destination.lock.state",
  "destination.lock.status",
  "destination.status",
  "lockState",
  "lock_state",
];

const DESTINATION_LOCK_BOOLEAN_PATHS = [
  "destination.locked",
  "destination.isLocked",
  "destination.is_locked",
  "destination.confirmed",
  "destination.isConfirmed",
  "destination.is_confirmed",
  "destination.lock.locked",
  "destination.lock.confirmed",
];

const DESTINATION_SUB_GOAL_PATHS = [
  "destination.subGoals",
  "destination.subgoals",
  "destination.sub_goals",
  "destination.objectives",
  "destination.parser.subGoals",
  "destination.parser.sub_goals",
  "subGoals",
  "subgoals",
  "sub_goals",
  "mappedWorkflowInput.plannerInput.subGoals",
];

const DESTINATION_CONSTRAINT_PATHS = [
  "destination.constraints",
  "destination.constraint",
  "destination.limitations",
  "destination.limits",
  "destination.requirements.constraints",
  "destination.requirements.constraint",
  "destination.requirements.limitations",
  "destination.parser.constraints",
  "destination.parser.constraint",
  "destination.parser.limitations",
  "constraints",
  "constraint",
  "limitations",
  "mappedMissionContext.reviewInput.constraints",
  "mappedWorkflowInput.plannerInput.constraints",
];

const DESTINATION_SUCCESS_CRITERIA_PATHS = [
  "destination.successCriteria",
  "destination.success_criteria",
  "destination.acceptanceCriteria",
  "destination.acceptance_criteria",
  "destination.doneCriteria",
  "destination.done_criteria",
  "destination.definitionOfDone",
  "destination.definition_of_done",
  "destination.criteria",
  "destination.requirements.successCriteria",
  "destination.requirements.success_criteria",
  "destination.requirements.acceptanceCriteria",
  "destination.requirements.acceptance_criteria",
  "destination.parser.successCriteria",
  "destination.parser.success_criteria",
  "successCriteria",
  "success_criteria",
  "acceptanceCriteria",
  "acceptance_criteria",
  "doneCriteria",
  "done_criteria",
  "mappedMissionContext.reviewInput.successCriteria",
  "mappedWorkflowInput.plannerInput.successCriteria",
];

const DESTINATION_DELIVERABLE_PATHS = [
  "destination.deliverables",
  "destination.deliverable",
  "destination.deliverableText",
  "destination.deliverable_text",
  "destination.outputs",
  "destination.output",
  "destination.artifacts",
  "destination.artifact",
  "destination.expectedDeliverables",
  "destination.expected_deliverables",
  "destination.requirements.deliverables",
  "destination.parser.deliverables",
  "destination.parser.deliverable",
  "destination.parser.outputs",
  "normalizedGoal.expectedDeliverables",
  "normalizedGoal.expected_deliverables",
  "normalizedGoal.deliverables",
  "outputs.deliverables",
  "outputs.deliverable",
  "deliverables",
  "deliverable",
];

function normalizeDestinationLockState(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[\s_]+/g, "-");

  if (
    normalized === "locked" ||
    normalized === "confirmed" ||
    normalized === "goal-locked"
  ) {
    return "locked";
  }
  if (
    normalized === "modified" ||
    normalized === "changed" ||
    normalized === "updated" ||
    normalized === "edited"
  ) {
    return "modified";
  }
  if (
    normalized === "needs-reconfirm" ||
    normalized === "needs-reconfirmation" ||
    normalized === "requires-reconfirm" ||
    normalized === "requires-confirmation" ||
    normalized === "needs-clarification" ||
    normalized === "clarification-needed" ||
    normalized === "missing-info" ||
    normalized === "missing-information" ||
    normalized === "blocked"
  ) {
    return "needs-reconfirm";
  }
  if (
    normalized === "unconfirmed" ||
    normalized === "unlocked" ||
    normalized === "draft" ||
    normalized === "open" ||
    normalized === "pending"
  ) {
    return "unconfirmed";
  }
  return value;
}

function pickDestinationLockState(source: unknown): string | null {
  for (const path of DESTINATION_LOCK_STATE_PATHS) {
    const lockState = normalizeDestinationLockState(
      readText(readPath(source, path))
    );
    if (lockState) return lockState;
  }
  if (
    DESTINATION_LOCK_BOOLEAN_PATHS.some(path =>
      readBoolean(readPath(source, path))
    )
  ) {
    return "locked";
  }
  return null;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function readPercent(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function routeCandidateCount(source: unknown): number {
  const candidates =
    readPath(source, "route.candidateRoutes") ??
    readPath(source, "route.routes") ??
    readPath(source, "candidateRoutes");
  return Array.isArray(candidates) ? candidates.length : 0;
}

export function buildAutopilotCockpitModel(
  input: FrontendAutopilotCockpitModelInput
): FrontendAutopilotCockpitModel {
  const frontendState = normalizeFrontendAutopilotViewModel(
    input.frontendState ?? {}
  );
  const source =
    input.autopilotSummary ?? input.projection ?? input.frontendState ?? {};
  const warnings: string[] = [];
  const selectedRouteId =
    pickText(source, [
      "route.selectedRouteId",
      "route.selection.selectedRouteId",
      "selectedRouteId",
      "evidence.correlation.selectedRouteId",
      "explanation.currentState.selectedRouteId",
      "explanation.remainingSteps.selectedRouteId",
    ]) ??
    input.launchRoute?.selectedRouteId ??
    frontendState.selectedRouteId;
  const recommendedRouteId =
    pickText(source, [
      "route.recommendedRouteId",
      "route.recommended.id",
      "recommendedRouteId",
    ]) ?? input.launchRoute?.recommendedRouteId ?? null;
  const routeSelectionStatus = pickText(source, [
    "route.selection.status",
    "route.selectionStatus",
    "routeSelectionStatus",
    "explanation.currentState.routeSelectionStatus",
    "explanation.remainingSteps.routeSelectionStatus",
  ]);
  const confidenceLevel = pickText(source, DESTINATION_CONFIDENCE_PATHS);
  const destinationGoal =
    pickText(source, DESTINATION_GOAL_PATHS) ||
    frontendState.draft.destinationText ||
    "Untitled destination";
  const missingInfo = collectTexts(source, DESTINATION_MISSING_INFO_PATHS);
  const suggestedClarifications = collectTexts(
    source,
    DESTINATION_CLARIFICATION_PATHS
  );
  const confirmedAt = pickText(source, DESTINATION_CONFIRMED_AT_PATHS);
  const modifiedAt = pickText(source, DESTINATION_MODIFIED_AT_PATHS);
  const explicitLockState = pickDestinationLockState(source);
  const lockState =
    explicitLockState ??
    (missingInfo.length > 0
      ? "needs-reconfirm"
      : modifiedAt
        ? "modified"
        : confirmedAt
          ? "locked"
          : null);

  if (!selectedRouteId && recommendedRouteId) {
    warnings.push("Route selection is missing; falling back to recommendation only.");
  }
  if (missingInfo.length > 0 && suggestedClarifications.length === 0) {
    warnings.push("Missing info exists without clarification aliases.");
  }

  return {
    destination: {
      goal: destinationGoal,
      request: pickText(source, DESTINATION_REQUEST_PATHS),
      lockState,
      confirmedAt,
      modifiedAt,
      subGoals: collectTexts(source, DESTINATION_SUB_GOAL_PATHS),
      constraints: collectTexts(source, DESTINATION_CONSTRAINT_PATHS),
      successCriteria: collectTexts(
        source,
        DESTINATION_SUCCESS_CRITERIA_PATHS
      ),
      deliverables: collectTexts(source, DESTINATION_DELIVERABLE_PATHS),
      confidenceLevel,
      missingInfo,
      suggestedClarifications,
    },
    route: {
      selectedRouteId,
      recommendedRouteId,
      routeSelectionStatus,
      locked: readBoolean(readPath(source, "route.selection.locked")) ||
        readBoolean(readPath(source, "route.selectionLocked")),
      candidateCount: routeCandidateCount(source),
    },
    projection: {
      taskId:
        pickText(source, ["taskId", "missionId", "id"]) ??
        frontendState.projection.taskId,
      status:
        pickText(source, [
          "execution.status",
          "driveState.state",
          "status",
        ]) ?? frontendState.projection.status,
      progressPercent: readPercent(
        readPath(source, "execution.progressPercent") ??
          readPath(source, "progressPercent") ??
          readPath(source, "progress")
      ) || frontendState.projection.progressPercent,
      sourceLayer: frontendState.sourceLayer,
    },
    warnings,
  };
}

export function useAutopilotCockpitModel(
  input: FrontendAutopilotCockpitModelInput
): FrontendAutopilotCockpitModel {
  return buildAutopilotCockpitModel(input);
}
