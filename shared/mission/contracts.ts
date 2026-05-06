import type { ExecutorPreviewSession } from "../executor/contracts.js";

export const MISSION_CONTRACT_VERSION = "2026-03-28" as const;
export const MISSION_TOPIC_STRATEGY = "strict-by-thread" as const;

export const MISSION_STAGE_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
] as const;

export type MissionStageStatus = (typeof MISSION_STAGE_STATUSES)[number];

export const MISSION_STATUSES = [
  "queued",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MISSION_OPERATOR_STATES = [
  "active",
  "paused",
  "blocked",
  "terminating",
] as const;

export type MissionOperatorState =
  (typeof MISSION_OPERATOR_STATES)[number];

export const MISSION_OPERATOR_ACTION_TYPES = [
  "pause",
  "resume",
  "retry",
  "escalate",
  "mark-blocked",
  "terminate",
] as const;

export type MissionOperatorActionType =
  (typeof MISSION_OPERATOR_ACTION_TYPES)[number];

export const MISSION_OPERATOR_ACTION_RESULTS = [
  "accepted",
  "completed",
  "rejected",
] as const;

export type MissionOperatorActionResult =
  (typeof MISSION_OPERATOR_ACTION_RESULTS)[number];

export const MISSION_EVENT_TYPES = [
  "created",
  "progress",
  "log",
  "waiting",
  "done",
  "failed",
  "cancelled",
  "role_switch",
  "collaboration_result",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

export const MISSION_EVENT_LEVELS = ["info", "warn", "error"] as const;
export type MissionEventLevel = (typeof MISSION_EVENT_LEVELS)[number];

/* ─── Decision Type System ─── */

export const DECISION_TYPES = [
  'approve',
  'reject',
  'request-info',
  'escalate',
  'custom-action',
  'multi-choice',
] as const;

export type DecisionType = (typeof DECISION_TYPES)[number];

export const WEB_AIGC_HITL_NODE_TYPES = [
  "user_input",
  "selection",
  "param_collection",
  "confirm_judge",
  "intent_recognition",
  "command_list",
  "recommended_commands",
] as const;

export type WebAigcHitlNodeType =
  (typeof WEB_AIGC_HITL_NODE_TYPES)[number];

export const WEB_AIGC_HITL_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "boolean",
  "selection",
  "attachment",
] as const;

export type WebAigcHitlFieldType =
  (typeof WEB_AIGC_HITL_FIELD_TYPES)[number];

export interface WebAigcHitlFieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface WebAigcHitlAttachmentValue {
  kind: "attachment";
  ref?: string;
  name?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  source?: "upload" | "artifact" | "url" | "manual";
}

export type WebAigcHitlFieldValue =
  | string
  | number
  | boolean
  | null
  | WebAigcHitlAttachmentValue;

export type WebAigcHitlFormData = Record<string, WebAigcHitlFieldValue>;

export interface WebAigcHitlFieldDefinition {
  key: string;
  label: string;
  type?: WebAigcHitlFieldType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: WebAigcHitlFieldValue;
  options?: WebAigcHitlFieldOption[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeFieldOption(
  value: unknown,
): WebAigcHitlFieldOption | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const optionValue = normalizeOptionalText(value.value);
  const label = normalizeOptionalText(value.label);
  if (!optionValue || !label) {
    return undefined;
  }

  return {
    value: optionValue,
    label,
    description: normalizeOptionalText(value.description),
  };
}

function normalizeAttachmentSource(
  value: unknown,
): WebAigcHitlAttachmentValue["source"] | undefined {
  return value === "upload" ||
    value === "artifact" ||
    value === "url" ||
    value === "manual"
    ? value
    : undefined;
}

function normalizeAttachmentSize(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeAttachmentValue(
  value: unknown,
): WebAigcHitlAttachmentValue | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    return {
      kind: "attachment",
      ref: normalized,
    };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const ref =
    normalizeOptionalText(value.ref) ||
    normalizeOptionalText(value.attachmentId) ||
    normalizeOptionalText(value.artifactId) ||
    normalizeOptionalText(value.id);
  const name =
    normalizeOptionalText(value.name) ||
    normalizeOptionalText(value.fileName) ||
    normalizeOptionalText(value.filename);
  const url = normalizeOptionalText(value.url);
  const mimeType =
    normalizeOptionalText(value.mimeType) ||
    normalizeOptionalText(value.contentType) ||
    normalizeOptionalText(value.type);
  const size = normalizeAttachmentSize(value.size);
  const source = normalizeAttachmentSource(value.source);

  if (!ref && !name && !url) {
    return undefined;
  }

  return {
    kind: "attachment",
    ...(ref ? { ref } : {}),
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(source ? { source } : {}),
  };
}

function normalizeFieldDefaultValue(
  value: unknown,
  fieldType?: WebAigcHitlFieldType,
): WebAigcHitlFieldValue | undefined {
  if (fieldType === "attachment") {
    return normalizeAttachmentValue(value);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return undefined;
}

function normalizeFieldDefinition(
  value: unknown,
): WebAigcHitlFieldDefinition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const key = normalizeOptionalText(value.key);
  const label = normalizeOptionalText(value.label);
  if (!key || !label) {
    return undefined;
  }

  const type = WEB_AIGC_HITL_FIELD_TYPES.includes(
    value.type as WebAigcHitlFieldType,
  )
    ? (value.type as WebAigcHitlFieldType)
    : undefined;

  return {
    key,
    label,
    type,
    required: value.required === true,
    placeholder: normalizeOptionalText(value.placeholder),
    defaultValue: normalizeFieldDefaultValue(value.defaultValue, type),
    options: Array.isArray(value.options)
      ? value.options
          .map(option => normalizeFieldOption(option))
          .filter((option): option is WebAigcHitlFieldOption => Boolean(option))
      : undefined,
  };
}

export function readWebAigcHitlFieldDefinitions(
  payload: unknown,
): WebAigcHitlFieldDefinition[] {
  if (!isRecord(payload)) {
    return [];
  }

  const rawFieldDefinitions = payload.fieldDefinitions;
  const rawFields =
    Array.isArray(payload.fields)
      ? payload.fields
      : Array.isArray(rawFieldDefinitions)
        ? rawFieldDefinitions
        : [];

  return rawFields
    .map(field => normalizeFieldDefinition(field))
    .filter(
      (field): field is WebAigcHitlFieldDefinition => Boolean(field),
    );
}

function coerceBooleanFieldValue(
  value: unknown,
): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function normalizeSingleFieldValue(
  field: WebAigcHitlFieldDefinition,
  value: unknown,
): { value?: WebAigcHitlFieldValue; error?: string; empty: boolean } {
  const fieldType = field.type || "text";
  const rawValue =
    value === undefined ? field.defaultValue : value;

  if (rawValue === undefined || rawValue === null) {
    return { value: rawValue === null ? null : undefined, empty: true };
  }

  if (typeof rawValue === "string" && rawValue.trim() === "") {
    if (
      fieldType === "text" ||
      fieldType === "textarea" ||
      fieldType === "selection" ||
      fieldType === "attachment"
    ) {
      return { value: undefined, empty: true };
    }
  }

  if (fieldType === "attachment") {
    let attachmentValue: WebAigcHitlAttachmentValue | undefined;

    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        return { value: undefined, empty: true };
      }

      if (trimmed.startsWith("{")) {
        try {
          attachmentValue = normalizeAttachmentValue(JSON.parse(trimmed));
        } catch {
          return {
            error: `字段“${field.label}”需要附件描述对象或引用`,
            empty: false,
          };
        }
      } else {
        attachmentValue = normalizeAttachmentValue(trimmed);
      }
    } else {
      attachmentValue = normalizeAttachmentValue(rawValue);
    }

    if (!attachmentValue) {
      return {
        error: `字段“${field.label}”需要附件描述对象或引用`,
        empty: false,
      };
    }

    return {
      value: attachmentValue,
      empty: false,
    };
  }

  if (fieldType === "number") {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return { value: rawValue, empty: false };
    }
    if (typeof rawValue === "string" && rawValue.trim() !== "") {
      const parsed = Number(rawValue.trim());
      if (Number.isFinite(parsed)) {
        return { value: parsed, empty: false };
      }
    }
    return {
      error: `字段“${field.label}”需要数字值`,
      empty: false,
    };
  }

  if (fieldType === "boolean") {
    const parsed = coerceBooleanFieldValue(rawValue);
    if (parsed !== undefined) {
      return { value: parsed, empty: false };
    }
    return {
      error: `字段“${field.label}”需要布尔值`,
      empty: false,
    };
  }

  const textValue =
    typeof rawValue === "string"
      ? rawValue.trim()
      : String(rawValue);

  if (!textValue) {
    return { value: undefined, empty: true };
  }

  if (fieldType === "selection" && Array.isArray(field.options) && field.options.length > 0) {
    const allowedValues = new Set(field.options.map(option => option.value));
    if (!allowedValues.has(textValue)) {
      return {
        error: `字段“${field.label}”的选项不合法`,
        empty: false,
      };
    }
  }

  return { value: textValue, empty: false };
}

export function normalizeWebAigcHitlFormData(
  fields: WebAigcHitlFieldDefinition[],
  value: unknown,
): {
  value: WebAigcHitlFormData;
  errors: string[];
  fieldErrors: Record<string, string>;
} {
  const raw = isRecord(value) ? value : {};
  const normalized: WebAigcHitlFormData = {};
  const errors: string[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const field of fields) {
    const result = normalizeSingleFieldValue(field, raw[field.key]);
    if (result.error) {
      errors.push(result.error);
      fieldErrors[field.key] = result.error;
      continue;
    }
    if (result.empty) {
      if (field.required) {
        const message = `字段“${field.label}”为必填项`;
        errors.push(message);
        fieldErrors[field.key] = message;
      }
      continue;
    }
    if (result.value !== undefined) {
      normalized[field.key] = result.value;
    }
  }

  return {
    value: normalized,
    errors,
    fieldErrors,
  };
}

export interface WebAigcHitlSubmissionMetadata {
  nodeType?: WebAigcHitlNodeType;
  sessionId?: string;
  nodeId?: string;
  interactionId?: string;
  branchKey?: string;
  formData?: WebAigcHitlFormData;
}

export interface MissionStage {
  key: string;
  label: string;
  status: MissionStageStatus;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface MissionEvent {
  type: MissionEventType;
  message: string;
  progress?: number;
  stageKey?: string;
  level?: MissionEventLevel;
  time: number;
  source?: "mission-core" | "executor" | "feishu" | "brain" | "user";
}

export interface MissionDecisionOption {
  id: string;
  label: string;
  description?: string;
  action?: DecisionType;
  severity?: 'info' | 'warn' | 'danger';
  requiresComment?: boolean;
}

export interface MissionDecision {
  prompt: string;
  options: MissionDecisionOption[];
  allowFreeText?: boolean;
  placeholder?: string;
  type?: DecisionType;
  templateId?: string;
  payload?: Record<string, unknown>;
  decisionId?: string;
  timeoutMs?: number;
  timeoutAt?: number;
}

export interface MissionDecisionSubmission {
  optionId?: string;
  freeText?: string;
  detail?: string;
  progress?: number;
  submittedBy?: string;
  metadata?: WebAigcHitlSubmissionMetadata;
}

export interface MissionDecisionResolved {
  optionId?: string;
  optionLabel?: string;
  freeText?: string;
  metadata?: WebAigcHitlSubmissionMetadata;
}

/* ─── Decision History ─── */

export interface DecisionHistoryEntry {
  decisionId: string;
  type: DecisionType;
  prompt: string;
  options: MissionDecisionOption[];
  templateId?: string;
  payload?: Record<string, unknown>;
  resolved: MissionDecisionResolved;
  submittedBy?: string;
  submittedAt: number;
  reason?: string;
  stageKey?: string;
  nodeId?: string;
  sessionId?: string;
  nodeType?: WebAigcHitlNodeType;
  interactionId?: string;
  branchKey?: string;
}

export const MISSION_CORE_STAGE_BLUEPRINT = [
  { key: "receive", label: "Receive task" },
  { key: "understand", label: "Understand request" },
  { key: "plan", label: "Build execution plan" },
  { key: "provision", label: "Provision execution runtime" },
  { key: "execute", label: "Run execution" },
  { key: "finalize", label: "Finalize mission" },
] as const;

export interface MissionArtifact {
  kind: "file" | "report" | "url" | "log";
  id?: string;
  name: string;
  path?: string;
  url?: string;
  mimeType?: string;
  previewType?: "text" | "json" | "html" | "pdf" | "image" | "log";
  size?: number;
  description?: string;
}

export interface MissionBlocker {
  reason: string;
  createdAt: number;
  createdBy?: string;
}

export interface MissionOperatorActionRecord {
  id: string;
  action: MissionOperatorActionType;
  requestedBy?: string;
  reason?: string;
  createdAt: number;
  result: MissionOperatorActionResult;
  detail?: string;
}

export interface ArtifactListItem extends MissionArtifact {
  index: number;
  downloadUrl: string;
}

export interface ArtifactListResponse {
  ok: true;
  missionId: string;
  artifacts: ArtifactListItem[];
}

export interface MissionOrganizationSnapshot {
  departments: Array<{
    key: string;
    label: string;
    managerName?: string;
  }>;
  agentCount: number;
}

export interface MissionWorkPackage {
  id: string;
  workerId?: string;
  title?: string;
  assignee?: string;
  description?: string;
  stageKey?: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'verified';
  score?: number;
  deliverable?: string;
  feedback?: string;
}

export interface MissionMessageLogEntry {
  sender: string;
  content: string;
  time: number;
  stageKey?: string;
}

export interface MissionAgentCrewMember {
  id: string;
  name: string;
  role: "ceo" | "manager" | "worker";
  department?: string;
  status: "idle" | "working" | "thinking" | "done" | "error";
}

export interface MissionExecutorContext {
  name: string;
  requestId?: string;
  jobId?: string;
  status?: string;
  baseUrl?: string;
  lastEventType?: string;
  lastEventAt?: number;
}

export interface MissionInstanceContext {
  id?: string;
  image?: string;
  command?: string[];
  workspaceRoot?: string;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  host?: string;
}

export type MissionProjectionLinks =
  import("./projection.js").MissionProjectionLinks;

export interface MissionRecord {
  id: string;
  kind: string;
  title: string;
  sourceText?: string;
  topicId?: string;
  projection?: MissionProjectionLinks;
  status: MissionStatus;
  progress: number;
  currentStageKey?: string;
  stages: MissionStage[];
  summary?: string;
  executor?: MissionExecutorContext;
  instance?: MissionInstanceContext;
  artifacts?: MissionArtifact[];
  organization?: MissionOrganizationSnapshot;
  workPackages?: MissionWorkPackage[];
  messageLog?: MissionMessageLogEntry[];
  agentCrew?: MissionAgentCrewMember[];
  /** Autonomy data: assessments, competitions, and taskforces */
  autonomy?: import("../autonomy-types.js").AutonomyData;
  waitingFor?: string;
  decision?: MissionDecision;
  waitingTimedOutAt?: number;
  decisionHistory?: DecisionHistoryEntry[];
  operatorState?: MissionOperatorState;
  operatorActions?: MissionOperatorActionRecord[];
  blocker?: MissionBlocker;
  attempt?: number;
  /** Security sandbox summary attached from executor job.started event */
  securitySummary?: {
    level: string;
    user: string;
    networkMode: string;
    readonlyRootfs: boolean;
    memoryLimit: string;
    cpuLimit: string;
    pidsLimit: number;
  };
  previewSession?: ExecutorPreviewSession;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;
  events: MissionEvent[];
}

export interface MissionPosition {
  x: number;
  y: number;
}

export type MissionPlanetStatus = MissionStatus | "archived";

export interface MissionPlanetOverviewItem {
  id: string;
  title: string;
  sourceText?: string;
  summary?: string;
  kind: string;
  status: MissionPlanetStatus;
  progress: number;
  complexity: number;
  radius: number;
  position: MissionPosition;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  currentStageKey?: string;
  currentStageLabel?: string;
  waitingFor?: string;
  taskUrl: string;
  tags: string[];
}

export const MISSION_PLANET_EDGE_TYPES = [
  "depends-on",
  "related-to",
  "supersedes",
] as const;

export type MissionPlanetEdgeType =
  (typeof MISSION_PLANET_EDGE_TYPES)[number];

export interface MissionPlanetEdge {
  fromPlanetId: string;
  toPlanetId: string;
  type: MissionPlanetEdgeType;
  confidence: number;
  source: "auto" | "manual";
  reason?: string;
}

export interface MissionPlanetInteriorStage {
  key: string;
  label: string;
  status: MissionStageStatus;
  progress: number;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
  arcStart: number;
  arcEnd: number;
  midAngle: number;
}

export type MissionAgentStatus =
  | "idle"
  | "working"
  | "thinking"
  | "done"
  | "error";

export interface MissionPlanetInteriorAgent {
  id: string;
  name: string;
  role: string;
  sprite: string;
  status: MissionAgentStatus;
  stageKey: string;
  stageLabel: string;
  progress?: number;
  currentAction?: string;
  angle: number;
}

export interface MissionPlanetInteriorData {
  stages: MissionPlanetInteriorStage[];
  agents: MissionPlanetInteriorAgent[];
  events: MissionEvent[];
  summary?: string;
  waitingFor?: string;
}

/* ─── Snapshot Persistence Types ─── */

export const SNAPSHOT_VERSION = 1 as const;

/**
 * 快照中保存的运行时模式。
 * 与 client/src/lib/store.ts 中的 RuntimeMode 保持一致。
 */
export type SnapshotRuntimeMode = "frontend" | "advanced";

/**
 * 快照中保存的 AI 配置（精简版）。
 * 与 client/src/lib/ai-config.ts 中的 AIConfig 保持一致。
 */
export interface SnapshotAIConfig {
  mode: "server_proxy" | "browser_direct";
  source: "server_env" | "browser_local";
  apiKey: string;
  baseUrl: string;
  model: string;
  modelReasoningEffort: string;
  maxContext: number;
  providerName: string;
  wireApi: "responses" | "chat_completions";
  timeoutMs: number;
  stream: boolean;
  chatThinkingType?: string;
  proxyUrl: string;
}

/**
 * 快照中保存的聊天消息。
 * 与 client/src/lib/store.ts 中的 ChatMessage 保持一致。
 */
export interface SnapshotChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  petName?: string;
  timestamp: number;
}

export interface AgentMemorySummary {
  agentId: string;
  soulMdHash: string;
  recentExchanges: unknown[];
}

export interface SceneLayoutState {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  selectedPet: string | null;
}

export interface MissionDecisionEntry {
  stageKey: string;
  decision: MissionDecision;
  resolved?: MissionDecisionResolved;
  timestamp: number;
  nodeId?: string;
  nodeType?: WebAigcHitlNodeType;
  sessionId?: string;
  interactionId?: string;
  branchKey?: string;
}

export interface AttachmentIndexEntry {
  name: string;
  kind: MissionArtifact["kind"];
  path?: string;
  url?: string;
  size?: number;
}

export interface ZustandRecoverySlice {
  runtimeMode: SnapshotRuntimeMode;
  aiConfig: SnapshotAIConfig;
  chatMessages: SnapshotChatMessage[];
}

export interface SnapshotPayload {
  mission: MissionRecord;
  agentMemories: AgentMemorySummary[];
  sceneLayout: SceneLayoutState;
  decisionHistory: MissionDecisionEntry[];
  attachmentIndex: AttachmentIndexEntry[];
  zustandSlice: ZustandRecoverySlice;
}

export interface SnapshotRecord {
  id: string;
  missionId: string;
  version: number;
  checksum: string;
  createdAt: number;
  missionTitle: string;
  missionProgress: number;
  missionStatus: MissionStatus;
  payload: SnapshotPayload;
}
