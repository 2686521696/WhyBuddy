import { create } from "zustand";

import {
  MISSION_CORE_STAGE_BLUEPRINT,
  type DecisionHistoryEntry,
  type MissionArtifact,
  type MissionBlocker,
  type MissionDecision,
  type MissionEvent,
  type MissionExecutorContext,
  type MissionInstanceContext,
  type MissionOperatorActionRecord,
  type MissionOperatorActionType,
  type MissionOperatorState,
  type MissionPlanetInteriorData,
  type MissionPlanetOverviewItem,
  type MissionRecord,
  type MissionStage,
} from "@shared/mission/contracts";
import {
  MISSION_SOCKET_EVENT,
  MISSION_SOCKET_TYPES,
  type MissionSocketPayload,
} from "@shared/mission/socket";
import { io, type Socket } from "socket.io-client";
import type { ExecutorEvent } from "@shared/executor/contracts";
import type { ExecutorPreviewSession } from "@shared/executor/contracts";
import {
  buildMissionAutopilotSummary as buildSharedMissionAutopilotSummary,
  type MissionAutopilotConfidenceLevel,
  type MissionAutopilotDriveState,
  type MissionAutopilotFleetRole,
  type MissionAutopilotFleetRoleStatus,
  type MissionAutopilotFleetRoleType,
  type MissionAutopilotRiskLevel,
  type MissionAutopilotRouteStage,
  type MissionAutopilotSummary,
  type MissionAutopilotTakeoverStatus,
  type MissionAutopilotTakeoverType,
} from "@shared/mission/autopilot";

import {
  cancelMission as cancelMissionRequest,
  createMission as createMissionRequest,
  getMission,
  getPlanet,
  getPlanetInterior,
  listMissionEvents,
  listMissions,
  listPlanets,
  submitMissionOperatorAction as submitMissionOperatorActionRequest,
  submitMissionDecision as submitMissionDecisionRequest,
} from "./mission-client";
import { IS_GITHUB_PAGES } from "./deploy-target";
import {
  GITHUB_PAGES_DEMO_MISSION_IDS,
  GITHUB_PAGES_DEMO_PROJECT_IDS,
} from "./github-pages-demo-data";
import { useSandboxStore } from "./sandbox-store";
import { useAppStore } from "./store";

/** Locally-defined status union derived from MissionTaskStatus. */
type SyntheticWfStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

/** Locally-defined shape for the synthetic workflow object built from MissionRecord. */
interface SyntheticWfSnapshot {
  id: string;
  directive: string;
  status: SyntheticWfStatus;
  current_stage: string | null;
  departments_involved: string[];
  started_at: string | null;
  completed_at: string | null;
  results: unknown;
  created_at: string;
}

export type MissionTaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export type TimelineLevel = "info" | "success" | "warn" | "error";
export type InteriorStageStatus = "pending" | "running" | "done" | "failed";
export type InteriorAgentStatus =
  | "idle"
  | "working"
  | "thinking"
  | "done"
  | "error";

export type TaskAutopilotDriveState = MissionAutopilotDriveState;
export type TaskAutopilotRiskLevel = MissionAutopilotRiskLevel;
export type TaskAutopilotConfidenceLevel = MissionAutopilotConfidenceLevel;
export type TaskAutopilotTakeoverStatus = MissionAutopilotTakeoverStatus;
export type TaskAutopilotTakeoverType = MissionAutopilotTakeoverType;
export type TaskAutopilotFleetRoleType = MissionAutopilotFleetRoleType;
export type TaskAutopilotFleetRoleStatus = MissionAutopilotFleetRoleStatus;
export type TaskAutopilotDestinationTaskType =
  MissionAutopilotSummary["destination"]["taskType"];
export type TaskAutopilotRouteStage = MissionAutopilotRouteStage;
export type TaskAutopilotFleetRole = MissionAutopilotFleetRole;
export type TaskAutopilotRouteMode = MissionAutopilotSummary["route"]["mode"];
export type TaskAutopilotCandidateRoute =
  MissionAutopilotSummary["route"]["candidateRoutes"][number];
export type TaskAutopilotControlAction =
  MissionAutopilotSummary["execution"]["availableActions"][number];
export type TaskAutopilotExecutionView = MissionAutopilotSummary["execution"];
export type TaskAutopilotRecoverySummary = MissionAutopilotSummary["recovery"];
export type TaskAutopilotEvidenceTimelineItem =
  MissionAutopilotSummary["evidence"]["timeline"][number];
export type TaskAutopilotExplanationSummary =
  MissionAutopilotSummary["explanation"];
export type TaskAutopilotRouteSelectionStatus = NonNullable<
  MissionAutopilotSummary["route"]["selectionStatus"]
>;
type TaskAutopilotExplanationCurrentState = NonNullable<
  TaskAutopilotExplanationSummary["currentState"]
>;
type TaskAutopilotRecommendationDetail = NonNullable<
  TaskAutopilotExplanationSummary["recommendationDetails"]
>[number];
type TaskAutopilotRemainingSteps = NonNullable<
  TaskAutopilotExplanationSummary["remainingSteps"]
>;
type TaskAutopilotDestinationSubGoal = NonNullable<
  MissionAutopilotSummary["destination"]["subGoals"]
>[number];
type TaskAutopilotDestinationLockState =
  | "unconfirmed"
  | "locked"
  | "modified"
  | "needs-reconfirm";

export interface TaskAutopilotSummary
  extends Omit<MissionAutopilotSummary, "version" | "source"> {
  version: string;
  source: string;
  destination: Omit<MissionAutopilotSummary["destination"], "subGoals"> & {
    subGoals?: TaskAutopilotDestinationSubGoal[];
    lockState?: TaskAutopilotDestinationLockState | null;
    confirmedAt?: string | null;
    modifiedAt?: string | null;
    impact?: string | null;
    blockingReason?: string | null;
  };
}

function readStringArrayOfRecords(
  value: unknown,
  extractor: (item: Record<string, unknown>) => string | null,
  fallback: string[]
): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map(item => (isRecord(item) ? extractor(item) : null))
    .filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );

  return normalized;
}

export interface MissionTaskSummary {
  id: string;
  title: string;
  kind: string;
  sourceText: string;
  status: MissionTaskStatus;
  operatorState: MissionOperatorState;
  workflowStatus: SyntheticWfStatus;
  progress: number;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  summary: string;
  waitingFor: string | null;
  blocker: MissionBlocker | null;
  attempt: number;
  latestOperatorAction: MissionOperatorActionRecord | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  departmentLabels: string[];
  taskCount: number;
  completedTaskCount: number;
  messageCount: number;
  activeAgentCount: number;
  attachmentCount: number;
  issueCount: number;
  hasWarnings: boolean;
  lastSignal: string | null;
  autopilotSummary?: TaskAutopilotSummary;
}

export interface TaskTimelineEvent {
  id: string;
  type: string;
  time: number;
  level: TimelineLevel;
  title: string;
  description: string;
  actor?: string;
}

export interface TaskStageRing {
  key: string;
  label: string;
  status: InteriorStageStatus;
  progress: number;
  detail?: string;
  arcStart: number;
  arcEnd: number;
  midAngle: number;
}

export interface TaskInteriorAgent {
  id: string;
  name: string;
  role: string;
  department: string;
  title: string;
  status: InteriorAgentStatus;
  stageKey: string;
  stageLabel: string;
  progress: number | null;
  currentAction?: string;
  angle: number;
}

export interface TaskArtifact {
  id: string;
  title: string;
  description: string;
  kind: "report" | "department_report" | "attachment" | "file" | "url" | "log";
  managerId?: string;
  format?: string;
  filename?: string;
  workflowId?: string;
  downloadKind?:
    | "workflow"
    | "department"
    | "attachment"
    | "external"
    | "server";
  href?: string;
  content?: string;
  mimeType?: string;
  previewType?: "text" | "json" | "html" | "pdf" | "image" | "log";
  size?: number;
  downloadUrl?: string;
  previewUrl?: string;
}

export interface TaskDecisionPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  tone: "primary" | "secondary" | "warning";
  action: "workflow" | "mission";
  optionId?: string;
}

/** Work-package item shape consumed by TaskDetailView work-packages panel. */
export interface WorkPackageDisplayItem {
  id: number;
  status: string;
  department: string;
  description: string;
  version: number;
  deliverable: string | null;
  deliverable_v2: string | null;
  deliverable_v3: string | null;
  total_score: number | null;
  manager_feedback: string | null;
  meta_audit_feedback: string | null;
}

export interface MissionTaskDetail extends MissionTaskSummary {
  workflow: SyntheticWfSnapshot;
  tasks: WorkPackageDisplayItem[];
  messages: unknown[];
  report: unknown | null;
  organization: unknown | null;
  stages: TaskStageRing[];
  agents: TaskInteriorAgent[];
  timeline: TaskTimelineEvent[];
  artifacts: TaskArtifact[];
  failureReasons: string[];
  decisionPresets: TaskDecisionPreset[];
  decisionPrompt: string | null;
  decisionPlaceholder: string | null;
  decisionAllowsFreeText: boolean;
  decision: MissionDecision | null;
  instanceInfo: Array<{ label: string; value: string }>;
  logSummary: Array<{ label: string; value: string }>;
  runtimeChannels: {
    socket: {
      status: "connected" | "disconnected";
      label: string;
      detail: string;
    };
    callback: {
      status: "active" | "idle" | "waiting" | "error";
      label: string;
      detail: string;
      eventType?: string;
      eventSummary?: string;
    };
  };
  decisionHistory: DecisionHistoryEntry[];
  operatorActions: MissionOperatorActionRecord[];
  securitySummary?: {
    level: string;
    user: string;
    networkMode: string;
    readonlyRootfs: boolean;
    memoryLimit: string;
    cpuLimit: string;
    pidsLimit: number;
  };
  executor?: MissionExecutorContext;
  instance?: MissionInstanceContext;
  previewSession?: ExecutorPreviewSession;
  missionArtifacts?: MissionArtifact[];
}

export type MissionOperatorActionLoadingMap = Partial<
  Record<MissionOperatorActionType, boolean>
>;

interface TasksStoreState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  missionSocketConnected: boolean;
  selectedTaskId: string | null;
  tasks: MissionTaskSummary[];
  detailsById: Record<string, MissionTaskDetail>;
  decisionNotes: Record<string, string>;
  cancellingMissionIds: Record<string, boolean>;
  operatorActionLoadingByMissionId: Record<
    string,
    MissionOperatorActionLoadingMap
  >;
  lastDecisionLaunch: {
    sourceTaskId: string;
    sourceTaskTitle: string;
    spawnedWorkflowId: string | null;
    at: number;
  } | null;
  ensureReady: () => Promise<void>;
  refresh: (options?: { preferredTaskId?: string | null }) => Promise<void>;
  selectTask: (taskId: string | null) => void;
  createMission: (input: {
    title?: string;
    sourceText?: string;
    kind?: string;
    topicId?: string;
    autoDispatch?: boolean;
    projectId?: string | null;
  }) => Promise<string | null>;
  cancelMission: (
    taskId: string,
    payload: {
      reason?: string;
      requestedBy?: string;
      source?: "user" | "brain" | "feishu" | "mission-core" | "executor";
    }
  ) => Promise<string | null>;
  submitOperatorAction: (
    taskId: string,
    payload: {
      action: MissionOperatorActionType;
      reason?: string;
      requestedBy?: string;
    }
  ) => Promise<string | null>;
  setDecisionNote: (taskId: string, note: string) => void;
  launchDecision: (taskId: string, presetId: string) => Promise<string | null>;
  clearDecisionLaunch: () => void;
}

function trimText(value: string | null | undefined, maxLength = 160): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function pickFallbackTaskId(tasks: MissionTaskSummary[]): string | null {
  return (
    tasks.find(task => task.status === "running")?.id ||
    tasks.find(task => task.status === "waiting")?.id ||
    tasks[0]?.id ||
    null
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatShortDate(value: number | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDurationMs(value: number | null): string {
  if (value === null || value < 0) return "n/a";
  const totalMinutes = Math.max(1, Math.round(value / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

const TASKS_SELECTED_TASK_STORAGE_KEY = "cube-office:selected-task-id";

function readPersistedSelectedTaskId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.sessionStorage?.getItem(TASKS_SELECTED_TASK_STORAGE_KEY) || null
    );
  } catch {
    return null;
  }
}

function persistSelectedTaskId(taskId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const storage = window.sessionStorage;
    if (!storage) return;
    if (taskId) {
      storage.setItem(TASKS_SELECTED_TASK_STORAGE_KEY, taskId);
      return;
    }
    storage.removeItem(TASKS_SELECTED_TASK_STORAGE_KEY);
  } catch {
    // Ignore sessionStorage failures and keep the in-memory focus intact.
  }
}

function buildSocketRuntimeChannel(missionSocketConnected: boolean) {
  return missionSocketConnected
    ? {
        status: "connected" as const,
        label: "Socket connected",
        detail:
          "Mission socket is connected and can receive live runtime updates.",
      }
    : {
        status: "disconnected" as const,
        label: "Socket disconnected",
        detail:
          "Mission socket is offline, so runtime updates may be delayed until refresh.",
      };
}

function formatExecutorEventLabel(
  eventType: string | null | undefined
): string {
  if (!eventType) {
    return "Callback idle";
  }

  switch (eventType) {
    case "job.accepted":
      return "Relay accepted";
    case "job.started":
      return "Relay started";
    case "job.progress":
      return "Relay progress update";
    case "job.waiting":
      return "Callback waiting";
    case "job.completed":
      return "Callback completed";
    case "job.failed":
      return "Callback failed";
    case "job.cancelled":
      return "Callback cancelled";
    case "job.log":
      return "Relay log update";
    case "job.heartbeat":
      return "Relay heartbeat";
    case "job.log_stream":
      return "Relay log stream";
    case "job.screenshot":
      return "Relay screenshot update";
    default:
      return `${eventType.startsWith("job.") ? "Relay" : "Callback"} ${eventType}`;
  }
}

function buildExecutorEventDetail(
  eventType: string | null | undefined,
  occurredAt: string,
  jobId?: string,
  requestId?: string,
  summary?: string | null
): string {
  const parts = [
    `${formatExecutorEventLabel(eventType)} recorded at ${occurredAt}.`,
  ];

  if (jobId) {
    parts.push(`Job ${jobId}.`);
  }

  if (requestId) {
    parts.push(`Request ${requestId}.`);
  }

  if (summary) {
    parts.push(summary);
  }

  return parts.join(" ");
}

function resolveCallbackStatus(
  eventType: string | null | undefined,
  jobStatus: string | null | undefined,
  missionStatus?: MissionTaskStatus
): MissionTaskDetail["runtimeChannels"]["callback"]["status"] {
  if (
    eventType === "job.failed" ||
    eventType === "job.cancelled" ||
    jobStatus === "failed" ||
    jobStatus === "cancelled" ||
    missionStatus === "failed" ||
    missionStatus === "cancelled"
  ) {
    return "error";
  }

  if (
    eventType === "job.waiting" ||
    jobStatus === "waiting" ||
    missionStatus === "waiting"
  ) {
    return "waiting";
  }

  if (
    eventType === "job.completed" ||
    eventType === "job.started" ||
    eventType === "job.progress" ||
    eventType === "job.accepted" ||
    eventType === "job.log" ||
    eventType === "job.log_stream" ||
    eventType === "job.heartbeat" ||
    eventType === "job.screenshot" ||
    jobStatus === "running" ||
    jobStatus === "completed"
  ) {
    return "active";
  }

  return "idle";
}

function buildCallbackRuntimeChannel(
  mission: Pick<MissionRecord, "status" | "executor" | "events">
): MissionTaskDetail["runtimeChannels"]["callback"] {
  const lastExecutorEventType = mission.executor?.lastEventType || null;
  const lastExecutorEventMessage =
    trimText(
      [...mission.events]
        .reverse()
        .find(event => event.type === "log" || event.source === "executor")
        ?.message,
      140
    ) || null;

  if (mission.executor?.lastEventAt) {
    return {
      status: resolveCallbackStatus(
        lastExecutorEventType,
        mission.executor?.status,
        mission.status
      ),
      label: formatExecutorEventLabel(lastExecutorEventType),
      detail: buildExecutorEventDetail(
        lastExecutorEventType,
        formatShortDate(mission.executor.lastEventAt),
        mission.executor?.jobId,
        mission.executor?.requestId,
        lastExecutorEventMessage
      ),
      eventType: lastExecutorEventType || undefined,
      eventSummary: lastExecutorEventMessage || undefined,
    };
  }

  if (mission.executor?.jobId) {
    return {
      status: "waiting",
      label: "Callback pending",
      detail: buildExecutorEventDetail(
        "job.waiting",
        "dispatch",
        mission.executor.jobId,
        mission.executor.requestId,
        "Waiting for the first executor callback after dispatch."
      ),
      eventType: lastExecutorEventType || undefined,
      eventSummary: lastExecutorEventMessage || undefined,
    };
  }

  return {
    status: "idle",
    label: "Callback idle",
    detail: "No executor callback has been recorded for this mission yet.",
    eventType: lastExecutorEventType || undefined,
    eventSummary: lastExecutorEventMessage || undefined,
  };
}

function applySocketConnectionToRuntimeChannels(
  runtimeChannels: MissionTaskDetail["runtimeChannels"],
  missionSocketConnected: boolean
): MissionTaskDetail["runtimeChannels"] {
  return {
    ...runtimeChannels,
    socket: buildSocketRuntimeChannel(missionSocketConnected),
  };
}

function buildRuntimeChannels(
  mission: MissionRecord,
  missionSocketConnected: boolean
): MissionTaskDetail["runtimeChannels"] {
  return {
    socket: buildSocketRuntimeChannel(missionSocketConnected),
    callback: buildCallbackRuntimeChannel(mission),
  };
}

function applyExecutorEventToRuntimeChannels(
  runtimeChannels: MissionTaskDetail["runtimeChannels"],
  event: ExecutorEvent
): MissionTaskDetail["runtimeChannels"] {
  const occurredAt = formatShortDate(Date.parse(event.occurredAt));
  const eventSummary = trimText(
    event.detail || event.summary || event.message || event.waitingFor,
    140
  );

  return {
    ...runtimeChannels,
    callback: {
      status: resolveCallbackStatus(event.type, event.status),
      label: formatExecutorEventLabel(event.type),
      detail: buildExecutorEventDetail(
        event.type,
        occurredAt,
        event.jobId,
        undefined,
        eventSummary
      ),
      eventType: event.type,
      eventSummary: eventSummary || undefined,
    },
  };
}

function applyMissionSocketState(
  runtimeChannels: MissionTaskDetail["runtimeChannels"],
  missionSocketConnected: boolean
): MissionTaskDetail["runtimeChannels"] {
  return {
    ...runtimeChannels,
    socket: buildSocketRuntimeChannel(missionSocketConnected),
  };
}

function updateDetailsSocketConnection(
  detailsById: Record<string, MissionTaskDetail>,
  missionSocketConnected: boolean
): Record<string, MissionTaskDetail> {
  return Object.fromEntries(
    Object.entries(detailsById).map(([taskId, detail]) => [
      taskId,
      {
        ...detail,
        runtimeChannels: applyMissionSocketState(
          detail.runtimeChannels,
          missionSocketConnected
        ),
      },
    ])
  ) as Record<string, MissionTaskDetail>;
}

function clampPercentage(
  value: number | null | undefined,
  fallback = 0
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

let taskStoreWatchersStarted = false;
let scheduledRefreshTimer: number | null = null;
let queuedRefreshOptions: { preferredTaskId?: string | null } | null = null;
let inFlightRefresh: Promise<void> | null = null;
let missionSocket: Socket | null = null;

function workflowStatusFromMission(
  status: MissionTaskStatus
): SyntheticWfStatus {
  if (status === "queued") return "pending";
  if (status === "done") return "completed";
  if (status === "cancelled") return "completed_with_errors";
  if (status === "failed") return "failed";
  return "running";
}

function stageKeyFromMission(mission: MissionRecord): string | null {
  return (
    mission.currentStageKey ||
    mission.stages.find(stage => stage.status === "running")?.key ||
    mission.stages.find(stage => stage.status === "failed")?.key ||
    mission.stages.find(stage => stage.status === "done")?.key ||
    MISSION_CORE_STAGE_BLUEPRINT[0]?.key ||
    null
  );
}

function stageLabelFromMission(
  mission: MissionRecord,
  stageKey?: string | null
): string | null {
  if (!stageKey) return null;
  return (
    mission.stages.find(stage => stage.key === stageKey)?.label ||
    MISSION_CORE_STAGE_BLUEPRINT.find(stage => stage.key === stageKey)?.label ||
    stageKey
  );
}

function missionStartedAt(mission: MissionRecord): number | null {
  const stageStartedAt = mission.stages
    .flatMap(stage => [stage.startedAt, stage.completedAt])
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right)[0];

  if (typeof stageStartedAt === "number") {
    return stageStartedAt;
  }

  return mission.status === "queued" ? null : mission.createdAt;
}

function syntheticWorkflowFromMission(
  mission: MissionRecord
): SyntheticWfSnapshot {
  return {
    id: mission.id,
    directive: mission.sourceText || mission.title,
    status: workflowStatusFromMission(mission.status),
    current_stage: stageKeyFromMission(mission),
    departments_involved: mission.kind ? [mission.kind] : [],
    started_at: missionStartedAt(mission)
      ? new Date(missionStartedAt(mission) || mission.createdAt).toISOString()
      : null,
    completed_at: mission.completedAt
      ? new Date(mission.completedAt).toISOString()
      : null,
    results: {
      missionId: mission.id,
      summary: mission.summary,
      waitingFor: mission.waitingFor,
      executor: mission.executor,
      instance: mission.instance,
      artifacts: mission.artifacts,
    },
    created_at: new Date(mission.createdAt).toISOString(),
  };
}

function missionOperatorStateFromMission(
  mission: MissionRecord
): MissionOperatorState {
  return mission.operatorState ?? "active";
}

function missionLatestOperatorAction(
  mission: MissionRecord
): MissionOperatorActionRecord | null {
  return mission.operatorActions?.at(-1) ?? null;
}

function missionFailureReasons(
  mission: MissionRecord,
  events: MissionEvent[]
): string[] {
  if (mission.status === "cancelled") {
    return [];
  }

  const reasons = new Set<string>();

  if (mission.status === "failed" && mission.summary) {
    reasons.add(mission.summary);
  }

  for (const stage of mission.stages) {
    if (stage.status === "failed" && stage.detail) {
      reasons.add(stage.detail);
    }
  }

  for (const event of events) {
    if (event.level === "error" || event.type === "failed") {
      reasons.add(event.message);
    }
  }

  return Array.from(reasons).filter(Boolean);
}

function missionSummaryText(
  mission: MissionRecord,
  events: MissionEvent[],
  waitingFor: string | null
): string {
  const operatorState = missionOperatorStateFromMission(mission);
  const latestOperatorAction = missionLatestOperatorAction(mission);

  if (operatorState === "blocked" && mission.blocker?.reason) {
    return `Blocked: ${trimText(mission.blocker.reason, 160)}`;
  }

  if (operatorState === "paused") {
    return (
      trimText(latestOperatorAction?.reason, 180) ||
      trimText(latestOperatorAction?.detail, 180) ||
      "Mission paused by operator."
    );
  }

  if (operatorState === "terminating") {
    return (
      trimText(latestOperatorAction?.reason, 180) ||
      "Mission termination requested."
    );
  }

  if (trimText(mission.summary, 180)) {
    return trimText(mission.summary, 180);
  }

  const latestEventMessage = trimText(events[events.length - 1]?.message, 180);
  if (latestEventMessage) {
    return latestEventMessage;
  }

  if (waitingFor) {
    return waitingFor;
  }

  if (mission.status === "queued") {
    return "Mission created and waiting for execution signals.";
  }

  if (mission.status === "done") {
    return "Mission completed and is ready for review.";
  }

  if (mission.status === "failed") {
    return "Mission stopped before the execution chain could complete.";
  }

  if (mission.status === "cancelled") {
    return (
      trimText(mission.cancelReason, 180) ||
      "Mission was cancelled before the execution chain completed."
    );
  }

  return "Mission is progressing through the execution pipeline.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullableText(
  value: unknown,
  fallback: string | null
): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const normalized = value
      .map(item => (typeof item === "string" ? trimText(item, 180) : ""))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }

  if (typeof value === "string" && value.trim()) {
    return [trimText(value, 180)];
  }

  return fallback;
}

function readStringArrayAllowEmpty(
  value: unknown,
  fallback: string[]
): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === "string" ? trimText(item, 180) : ""))
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [trimText(value, 180)];
  }

  return fallback;
}

function readNullableTextFromCandidates(
  values: unknown[],
  fallback: string | null
): string | null {
  for (const value of values) {
    const normalized = readNullableText(value, null);
    if (normalized !== null) {
      return normalized;
    }
  }

  return fallback;
}

function readStringArrayFromCandidates(
  values: unknown[],
  fallback: string[]
): string[] {
  const normalized: string[] = [];

  for (const value of values) {
    for (const item of readStringArrayAllowEmpty(value, [])) {
      if (!normalized.includes(item)) {
        normalized.push(item);
      }
    }
  }

  return normalized.length > 0 ? normalized : fallback;
}

function readRecordValue(
  value: Record<string, unknown>,
  aliases: string[]
): unknown {
  for (const alias of aliases) {
    if (alias in value) {
      return value[alias];
    }
  }

  return undefined;
}

function readValuesFromRecordAliases(
  value: Record<string, unknown>,
  aliases: string[]
): unknown[] {
  return aliases.filter(alias => alias in value).map(alias => value[alias]);
}

function readStringArrayFromRecordAliases(
  value: Record<string, unknown>,
  aliases: string[],
  fallback: string[]
): string[] {
  return readStringArrayFromCandidates(
    readValuesFromRecordAliases(value, aliases),
    fallback
  );
}

function normalizeAutopilotDestinationSubGoals(
  value: unknown,
  fallback: TaskAutopilotDestinationSubGoal[]
): TaskAutopilotDestinationSubGoal[] {
  const normalizeSubGoal = (
    item: unknown,
    index: number
  ): TaskAutopilotDestinationSubGoal | null => {
    if (typeof item === "string") {
      const title = trimText(item, 180);
      return title
        ? {
            id: `destination-sub-goal:${index + 1}`,
            title,
            source: "mission-text",
            status: null,
          }
        : null;
    }

    if (!isRecord(item)) return null;

    const fallbackItem = fallback[index];
    const title = readText(
      readRecordValue(item, ["title", "label", "goal", "objective"]),
      fallbackItem?.title ?? ""
    );
    if (!title) return null;

    const source =
      item.source === "work-package" || item.source === "mission-stage"
        ? item.source
        : (fallbackItem?.source ?? "mission-text");
    const status =
      item.status === "pending" ||
      item.status === "running" ||
      item.status === "done" ||
      item.status === "failed"
        ? item.status
        : (fallbackItem?.status ?? null);

    return {
      id: readText(
        item.id,
        fallbackItem?.id ?? `destination-sub-goal:${index + 1}`
      ),
      title,
      source,
      status,
    };
  };

  const normalized = Array.isArray(value)
    ? value
        .map(normalizeSubGoal)
        .filter(
          (item): item is TaskAutopilotDestinationSubGoal => item !== null
        )
    : typeof value === "string" && value.trim()
      ? [normalizeSubGoal(value, 0)].filter(
          (item): item is TaskAutopilotDestinationSubGoal => item !== null
        )
      : [];

  return normalized.length > 0 ? normalized : fallback;
}

function readAutopilotSummaryCandidate(value: unknown): unknown {
  if (!isRecord(value)) return undefined;

  if ("autopilotSummary" in value) {
    return value.autopilotSummary;
  }

  if ("autopilotProjection" in value) {
    return value.autopilotProjection;
  }

  const autopilot = value.autopilot;
  if (isRecord(autopilot)) {
    return autopilot.summary ?? autopilot;
  }

  const projection = value.projection;
  if (isRecord(projection)) {
    if ("autopilotSummary" in projection) {
      return projection.autopilotSummary;
    }

    const projectionAutopilot = projection.autopilot;
    if (isRecord(projectionAutopilot)) {
      return projectionAutopilot.summary ?? projectionAutopilot;
    }
  }

  return undefined;
}

function isAutopilotDriveState(
  value: unknown
): value is TaskAutopilotDriveState {
  return (
    value === "understanding" ||
    value === "clarifying" ||
    value === "planning" ||
    value === "fleet-forming" ||
    value === "executing" ||
    value === "reviewing" ||
    value === "blocked" ||
    value === "takeover-required" ||
    value === "replanning" ||
    value === "delivered"
  );
}

function readAutopilotDriveState(
  value: unknown,
  fallback: TaskAutopilotDriveState
): TaskAutopilotDriveState {
  return isAutopilotDriveState(value) ? value : fallback;
}

function readAutopilotRiskLevel(
  value: unknown,
  fallback: TaskAutopilotRiskLevel
): TaskAutopilotRiskLevel {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "unknown"
    ? value
    : fallback;
}

function readAutopilotConfidenceLevel(
  value: unknown,
  fallback: TaskAutopilotConfidenceLevel
): TaskAutopilotConfidenceLevel {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "unknown"
    ? value
    : fallback;
}

function readAutopilotDestinationTaskType(
  value: unknown,
  fallback: TaskAutopilotDestinationTaskType
): TaskAutopilotDestinationTaskType {
  return value === "analysis" ||
    value === "research" ||
    value === "generation" ||
    value === "transformation" ||
    value === "implementation" ||
    value === "coordination" ||
    value === "mixed" ||
    value === "unknown"
    ? value
    : fallback;
}

function readAutopilotDestinationLockState(
  value: unknown,
  fallback: TaskAutopilotDestinationLockState | null
): TaskAutopilotDestinationLockState | null {
  const normalized =
    typeof value === "string"
      ? value
          .toLowerCase()
          .replace(/[\s_]+/g, "-")
          .trim()
      : "";

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

  return fallback;
}

function readSyntheticWorkflowStatus(
  value: unknown,
  fallback: SyntheticWfStatus
): SyntheticWfStatus {
  return value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "completed_with_errors" ||
    value === "failed"
    ? value
    : fallback;
}

function readAutopilotTakeoverType(
  value: unknown,
  fallback: TaskAutopilotTakeoverType | null
): TaskAutopilotTakeoverType | null {
  return value === "clarification" ||
    value === "approval" ||
    value === "permission" ||
    value === "budget" ||
    value === "risk-acceptance" ||
    value === "route-selection" ||
    value === "delivery-review" ||
    value === "exception" ||
    value === "operator"
    ? value
    : fallback;
}

function readAutopilotTakeoverStatus(
  value: unknown,
  fallback: TaskAutopilotTakeoverStatus | null
): TaskAutopilotTakeoverStatus | null {
  return value === "pending" ||
    value === "required" ||
    value === "resolved" ||
    value === "advisory"
    ? value
    : fallback;
}

function readAutopilotFleetRoleType(
  value: unknown,
  fallback: TaskAutopilotFleetRoleType
): TaskAutopilotFleetRoleType {
  return value === "planner" ||
    value === "clarifier" ||
    value === "researcher" ||
    value === "generator" ||
    value === "reviewer" ||
    value === "auditor" ||
    value === "operator" ||
    value === "executor" ||
    value === "custom"
    ? value
    : fallback;
}

function readAutopilotFleetRoleStatus(
  value: unknown,
  fallback: TaskAutopilotFleetRoleStatus
): TaskAutopilotFleetRoleStatus {
  return value === "idle" ||
    value === "running" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "failed" ||
    value === "done"
    ? value
    : fallback;
}

function readInteriorStageStatus(
  value: unknown,
  fallback: InteriorStageStatus
): InteriorStageStatus {
  return value === "pending" ||
    value === "running" ||
    value === "done" ||
    value === "failed"
    ? value
    : fallback;
}

function readAutopilotUrgency(
  value: unknown,
  fallback: "low" | "medium" | "high"
): "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : fallback;
}

function readAutopilotRouteMode(
  value: unknown,
  fallback: TaskAutopilotRouteMode
): TaskAutopilotRouteMode {
  return value === "fast" ||
    value === "standard" ||
    value === "deep" ||
    value === "custom"
    ? value
    : fallback;
}

function readAutopilotRouteSelectionStatus(
  value: unknown,
  fallback: TaskAutopilotRouteSelectionStatus
): TaskAutopilotRouteSelectionStatus {
  return value === "recommended" ||
    value === "alternatives-available" ||
    value === "user-selected" ||
    value === "locked" ||
    value === "replanned"
    ? value
    : fallback;
}

function readNullableAutopilotRouteSelectionStatus(
  value: unknown,
  fallback: TaskAutopilotRecommendationDetail["routeSelectionStatus"]
): TaskAutopilotRecommendationDetail["routeSelectionStatus"] {
  if (value === null) return null;
  if (typeof value === "undefined") return fallback;
  return readAutopilotRouteSelectionStatus(value, fallback ?? "recommended");
}

function readAutopilotRouteSelectionMode(
  value: unknown,
  fallback: TaskAutopilotSummary["route"]["selection"]["mode"]
): TaskAutopilotSummary["route"]["selection"]["mode"] {
  return value === "planner_default" ||
    value === "user_selected" ||
    value === "runtime_replanned" ||
    value === "system_downgraded"
    ? value
    : fallback;
}

function readAutopilotRouteChangeActor(
  value: unknown,
  fallback: TaskAutopilotSummary["route"]["selection"]["changedBy"]
): TaskAutopilotSummary["route"]["selection"]["changedBy"] {
  return value === "planner" ||
    value === "user" ||
    value === "runtime" ||
    value === "operator"
    ? value
    : fallback;
}

function readAutopilotRouteEvidenceEventType(
  value: unknown,
  fallback: TaskAutopilotSummary["route"]["evidence"]["lastEventType"]
): TaskAutopilotSummary["route"]["evidence"]["lastEventType"] {
  return value === "route.recommended" ||
    value === "route.selected" ||
    value === "route.locked" ||
    value === "route.replanned"
    ? value
    : fallback;
}

function readAutopilotControlActionType(
  value: unknown,
  fallback: TaskAutopilotControlAction["type"]
): TaskAutopilotControlAction["type"] {
  return value === "run" ||
    value === "wait" ||
    value === "resume" ||
    value === "retry" ||
    value === "escalate" ||
    value === "terminate" ||
    value === "replan"
    ? value
    : fallback;
}

function readNullableAutopilotControlActionType(
  value: unknown,
  fallback: NonNullable<
    TaskAutopilotExplanationSummary["recommendationDetails"]
  >[number]["actionType"]
): NonNullable<
  TaskAutopilotExplanationSummary["recommendationDetails"]
>[number]["actionType"] {
  if (value === null) return null;
  return readAutopilotControlActionType(value, fallback ?? "wait");
}

function readAutopilotControlScope(
  value: unknown,
  fallback: TaskAutopilotControlAction["scope"]
): TaskAutopilotControlAction["scope"] {
  return value === "step" ||
    value === "stage" ||
    value === "route" ||
    value === "mission"
    ? value
    : fallback;
}

function readAutopilotExecutionStatus(
  value: unknown,
  fallback: TaskAutopilotExecutionView["currentStepStatus"]
): TaskAutopilotExecutionView["currentStepStatus"] {
  return value === "pending" ||
    value === "running" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "done" ||
    value === "failed"
    ? value
    : fallback;
}

function readAutopilotRecoveryState(
  value: unknown,
  fallback: TaskAutopilotRecoverySummary["state"]
): TaskAutopilotRecoverySummary["state"] {
  return value === "healthy" ||
    value === "watching" ||
    value === "recovering" ||
    value === "takeover-required" ||
    value === "escalated"
    ? value
    : fallback;
}

function readAutopilotDeviationCategory(
  value: unknown,
  fallback: TaskAutopilotRecoverySummary["deviationCategory"]
): TaskAutopilotRecoverySummary["deviationCategory"] {
  return value === "none" ||
    value === "goal-deviation" ||
    value === "route-deviation" ||
    value === "quality-deviation" ||
    value === "governance-deviation" ||
    value === "dependency-failure" ||
    value === "state-block" ||
    value === "recovery-exhausted"
    ? value
    : fallback;
}

function readAutopilotEvidenceTrustLevel(
  value: unknown,
  fallback: TaskAutopilotSummary["evidence"]["trustLevel"]
): TaskAutopilotSummary["evidence"]["trustLevel"] {
  return value === "verified" ||
    value === "partial" ||
    value === "unverified" ||
    value === "redacted"
    ? value
    : fallback;
}

function readAutopilotTimelineEventType(
  value: unknown,
  fallback: TaskAutopilotEvidenceTimelineItem["type"]
): TaskAutopilotEvidenceTimelineItem["type"] {
  return value === "drive_state_change" ||
    value === "decision" ||
    value === "route_change" ||
    value === "takeover" ||
    value === "tool_call" ||
    value === "result" ||
    value === "operator_action" ||
    value === "system"
    ? value
    : fallback;
}

function readAutopilotTimelineEventStatus(
  value: unknown,
  fallback: TaskAutopilotEvidenceTimelineItem["status"]
): TaskAutopilotEvidenceTimelineItem["status"] {
  return value === "info" ||
    value === "running" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "done" ||
    value === "failed"
    ? value
    : fallback;
}

function readMissionTaskStatus(
  value: unknown,
  fallback: TaskAutopilotExplanationSummary["currentState"] extends infer T
    ? T extends { missionStatus: infer U }
      ? U
      : MissionTaskStatus
    : MissionTaskStatus
): MissionTaskStatus {
  return value === "queued" ||
    value === "running" ||
    value === "waiting" ||
    value === "done" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : fallback;
}

function readAutopilotExplanationSource(
  value: unknown,
  fallback: TaskAutopilotExplanationCurrentState["sources"][number]
): TaskAutopilotExplanationCurrentState["sources"][number] {
  return value === "mission-runtime" ||
    value === "workflow-runtime" ||
    value === "route-planner" ||
    value === "recovery-engine" ||
    value === "takeover-state" ||
    value === "combined-inference"
    ? value
    : fallback;
}

function readAutopilotRecommendationKind(
  value: unknown,
  fallback: TaskAutopilotRecommendationDetail["kind"]
): TaskAutopilotRecommendationDetail["kind"] {
  return value === "route" ||
    value === "action" ||
    value === "takeover" ||
    value === "replan"
    ? value
    : fallback;
}

function normalizeAutopilotExplanationSources(
  value: unknown,
  fallback: TaskAutopilotExplanationCurrentState["sources"]
): TaskAutopilotExplanationCurrentState["sources"] {
  if (!Array.isArray(value)) return fallback;

  const sources = value
    .map(item =>
      readAutopilotExplanationSource(item, fallback[0] ?? "combined-inference")
    )
    .filter(Boolean);

  return sources.length > 0 ? Array.from(new Set(sources)) : fallback;
}

function normalizeAutopilotRecommendationDetails(
  value: unknown,
  fallback: TaskAutopilotRecommendationDetail[]
): TaskAutopilotRecommendationDetail[] {
  if (!Array.isArray(value)) return fallback;

  const details: TaskAutopilotRecommendationDetail[] = [];

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) continue;

    const routeId = readNullableText(item.routeId, null);
    const fallbackItem =
      fallback.find(candidate => {
        const fallbackRouteId =
          typeof candidate.routeId === "string" ? candidate.routeId : null;
        return (
          candidate.kind ===
            readAutopilotRecommendationKind(
              item.kind,
              fallback[index]?.kind ?? fallback[0]?.kind ?? "action"
            ) &&
          (routeId === null || fallbackRouteId === routeId)
        );
      }) ??
      fallback[index] ??
      fallback[0];
    const summary = readText(item.summary, fallbackItem?.summary ?? "");

    if (!summary) continue;

    details.push({
      kind: readAutopilotRecommendationKind(
        item.kind,
        fallbackItem?.kind ?? "action"
      ),
      summary,
      source: readAutopilotExplanationSource(
        item.source,
        fallbackItem?.source ?? "combined-inference"
      ),
      routeId: readNullableText(item.routeId, fallbackItem?.routeId ?? null),
      actionType: readNullableAutopilotControlActionType(
        item.actionType,
        fallbackItem?.actionType ?? null
      ),
      takeoverType: readAutopilotTakeoverType(
        item.takeoverType,
        fallbackItem?.takeoverType ?? null
      ),
      decisionId: readNullableText(
        item.decisionId,
        fallbackItem?.decisionId ?? null
      ),
      routeSelectionStatus: readNullableAutopilotRouteSelectionStatus(
        item.routeSelectionStatus,
        fallbackItem?.routeSelectionStatus
      ),
      correlationTimelineId: readNullableText(
        item.correlationTimelineId,
        fallbackItem?.correlationTimelineId ?? null
      ),
      updatedAt: readText(
        item.updatedAt,
        fallbackItem?.updatedAt ??
          fallback[0]?.updatedAt ??
          new Date(0).toISOString()
      ),
    });
  }

  if (details.length === 0) {
    return fallback;
  }

  const merged: TaskAutopilotRecommendationDetail[] = [...details];
  const seen = new Set(
    details.map(item =>
      [
        item.kind,
        item.source,
        item.routeId ?? "",
        item.actionType ?? "",
        item.takeoverType ?? "",
        item.decisionId ?? "",
        item.summary,
      ].join("|")
    )
  );

  for (const fallbackItem of fallback) {
    const signature = [
      fallbackItem.kind,
      fallbackItem.source,
      fallbackItem.routeId ?? "",
      fallbackItem.actionType ?? "",
      fallbackItem.takeoverType ?? "",
      fallbackItem.decisionId ?? "",
      fallbackItem.summary,
    ].join("|");
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    merged.push(fallbackItem);
  }

  return merged;
}

function normalizeAutopilotRemainingStepsItems(
  value: unknown,
  fallback: NonNullable<
    TaskAutopilotExplanationSummary["remainingSteps"]
  >["pendingSteps"]
): NonNullable<
  TaskAutopilotExplanationSummary["remainingSteps"]
>["pendingSteps"] {
  if (!Array.isArray(value)) return fallback;

  const items = value
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const rawKey =
        typeof item.key === "string" && item.key.trim() ? item.key.trim() : "";
      const fallbackItem =
        (rawKey
          ? fallback.find(candidate => candidate.key === rawKey)
          : undefined) ??
        fallback[index] ??
        fallback[0];
      const key = readText(item.key, fallbackItem?.key ?? "");
      const label = readText(item.label, fallbackItem?.label ?? key);
      if (!key || !label) return null;

      return {
        key,
        label,
        status: readInteriorStageStatus(
          item.status,
          fallbackItem?.status ?? "pending"
        ),
        isCurrent: readBoolean(
          item.isCurrent,
          fallbackItem?.isCurrent ?? false
        ),
      };
    })
    .filter(
      (
        item
      ): item is NonNullable<
        TaskAutopilotExplanationSummary["remainingSteps"]
      >["pendingSteps"][number] => item !== null
    );

  return items.length > 0 ? items : fallback;
}

function deriveAutopilotPendingSteps(
  mainlineSteps: NonNullable<
    TaskAutopilotExplanationSummary["remainingSteps"]
  >["mainlineSteps"]
): NonNullable<
  TaskAutopilotExplanationSummary["remainingSteps"]
>["pendingSteps"] {
  return mainlineSteps.filter(
    step => step.status === "pending" || step.status === "running"
  );
}

function findAutopilotStepLabel(
  steps: NonNullable<
    TaskAutopilotExplanationSummary["remainingSteps"]
  >["mainlineSteps"],
  stepKey: string | null
): string | null {
  if (!stepKey) return null;
  return steps.find(step => step.key === stepKey)?.label ?? null;
}

function normalizeAutopilotExplanationCurrentState(
  value: unknown,
  fallback: TaskAutopilotExplanationSummary["currentState"]
): TaskAutopilotExplanationSummary["currentState"] {
  if (!isRecord(value)) return fallback;

  return {
    summary: readText(value.summary, fallback?.summary ?? ""),
    driveState: readAutopilotDriveState(
      value.driveState,
      fallback?.driveState ?? "understanding"
    ),
    missionStatus: readMissionTaskStatus(
      value.missionStatus,
      fallback?.missionStatus ?? "queued"
    ),
    currentStageKey: readNullableText(
      value.currentStageKey,
      fallback?.currentStageKey ?? null
    ),
    currentStageLabel: readNullableText(
      value.currentStageLabel,
      fallback?.currentStageLabel ?? null
    ),
    workflowStatus: readNullableText(
      value.workflowStatus,
      fallback?.workflowStatus ?? null
    ),
    workflowStage: readNullableText(
      value.workflowStage,
      fallback?.workflowStage ?? null
    ),
    routeSelectionStatus:
      readNullableAutopilotRouteSelectionStatus(
        value.routeSelectionStatus,
        fallback?.routeSelectionStatus ?? "recommended"
      ) ?? null,
    selectedRouteId: readNullableText(
      value.selectedRouteId,
      fallback?.selectedRouteId ?? null
    ),
    correlationTimelineId: readNullableText(
      value.correlationTimelineId,
      fallback?.correlationTimelineId ?? null
    ),
    sources: normalizeAutopilotExplanationSources(
      value.sources,
      fallback?.sources ?? ["combined-inference"]
    ),
    updatedAt: readText(
      value.updatedAt,
      fallback?.updatedAt ?? new Date(0).toISOString()
    ),
  };
}

function normalizeAutopilotExplanationRemainingSteps(
  value: unknown,
  fallback: TaskAutopilotExplanationSummary["remainingSteps"]
): TaskAutopilotExplanationSummary["remainingSteps"] {
  if (!isRecord(value)) return fallback;

  return {
    currentStepKey: readNullableText(
      value.currentStepKey,
      fallback?.currentStepKey ?? null
    ),
    currentStepLabel: readNullableText(
      value.currentStepLabel,
      fallback?.currentStepLabel ?? null
    ),
    mainlineSteps: normalizeAutopilotRemainingStepsItems(
      value.mainlineSteps,
      fallback?.mainlineSteps ??
        ([] as TaskAutopilotRemainingSteps["mainlineSteps"])
    ),
    pendingSteps: normalizeAutopilotRemainingStepsItems(
      value.pendingSteps,
      fallback?.pendingSteps ??
        ([] as TaskAutopilotRemainingSteps["pendingSteps"])
    ),
    parallelBranchCount: Number.isFinite(value.parallelBranchCount)
      ? Number(value.parallelBranchCount)
      : (fallback?.parallelBranchCount ?? 0),
    replanChangeSummary: readNullableText(
      value.replanChangeSummary,
      fallback?.replanChangeSummary ?? null
    ),
    selectedRouteId: readNullableText(
      value.selectedRouteId,
      fallback?.selectedRouteId ?? null
    ),
    routeSelectionStatus:
      readNullableAutopilotRouteSelectionStatus(
        value.routeSelectionStatus,
        fallback?.routeSelectionStatus ?? "recommended"
      ) ?? null,
  };
}

function normalizeAutopilotRouteStages(
  value: unknown,
  fallback: TaskAutopilotRouteStage[]
): TaskAutopilotRouteStage[] {
  if (!Array.isArray(value)) return fallback;

  const stages = value
    .map((item): TaskAutopilotRouteStage | null => {
      if (!isRecord(item)) return null;
      const key = readText(item.key, "");
      const label = readText(item.label, key);
      if (!key || !label) return null;
      return {
        key,
        label,
        status: readInteriorStageStatus(item.status, "pending"),
        detail: readNullableText(item.detail, null),
        isCurrent: readBoolean(item.isCurrent, false),
      };
    })
    .filter((item): item is TaskAutopilotRouteStage => item !== null);

  return stages.length > 0 ? stages : fallback;
}

function normalizeAutopilotFleetRoles(
  value: unknown,
  fallback: TaskAutopilotFleetRole[]
): TaskAutopilotFleetRole[] {
  if (!Array.isArray(value)) return fallback;

  const roles = value
    .map((item): TaskAutopilotFleetRole | null => {
      if (!isRecord(item)) return null;
      const id = readText(item.id ?? item.roleId, "");
      const title = readText(item.title, id);
      if (!id || !title) return null;

      return {
        id,
        roleType: readAutopilotFleetRoleType(item.roleType, "custom"),
        title,
        status: readAutopilotFleetRoleStatus(item.status, "idle"),
        responsibility: readText(item.responsibility, title),
        boundAgents: readStringArray(item.boundAgents, []),
        boundExecutors: readStringArray(item.boundExecutors, []),
        currentFocus: readNullableText(item.currentFocus, null),
      };
    })
    .filter((item): item is TaskAutopilotFleetRole => item !== null);

  return roles.length > 0 ? roles : fallback;
}

function normalizeAutopilotTakeoverOptions(
  value: unknown,
  fallback: TaskAutopilotSummary["takeover"]["options"]
): TaskAutopilotSummary["takeover"]["options"] {
  if (!Array.isArray(value)) return fallback;

  const options = value
    .map(item => {
      if (!isRecord(item)) return null;
      const id = readText(item.id, "");
      const label = readText(item.label, id);
      if (!id || !label) return null;

      return {
        id,
        label,
        ...(typeof item.description === "string" && item.description.trim()
          ? { description: item.description.trim() }
          : {}),
      };
    })
    .filter(
      (item): item is TaskAutopilotSummary["takeover"]["options"][number] =>
        item !== null
    );

  return options.length > 0 ? options : fallback;
}

function normalizeAutopilotCandidateRoutes(
  value: unknown,
  fallback: TaskAutopilotSummary["route"]["candidateRoutes"]
): TaskAutopilotSummary["route"]["candidateRoutes"] {
  if (!Array.isArray(value)) return fallback;

  const routes = value
    .map(item => {
      if (!isRecord(item)) return null;
      const id = readText(item.id, "");
      const label = readText(item.label, id);
      if (!id || !label) return null;

      return {
        id,
        label,
        mode: readAutopilotRouteMode(item.mode, "standard"),
        status: readSyntheticWorkflowStatus(
          item.status,
          fallback.find(route => route.id === id)?.status ?? "running"
        ),
        title: readText(
          item.title,
          fallback.find(route => route.id === id)?.title ?? label
        ),
        name: readText(
          item.name,
          fallback.find(route => route.id === id)?.name ??
            readText(item.title, label)
        ),
        summary: readText(item.summary, label),
        recommended: readBoolean(item.recommended, false),
        selected: readBoolean(item.selected, false),
        locked: readBoolean(item.locked, false),
        reason: readNullableText(item.reason, null),
        description: readNullableText(
          item.description,
          fallback.find(route => route.id === id)?.description ?? null
        ),
        estimatedCost: readNullableText(item.estimatedCost, null),
        estimatedDuration: readNullableText(item.estimatedDuration, null),
        takeoverLoad: readAutopilotUrgency(item.takeoverLoad, "medium"),
        riskLevel: readAutopilotRiskLevel(item.riskLevel, "unknown"),
        stageKeys: readStringArray(item.stageKeys, []),
      };
    })
    .filter(
      (
        item
      ): item is TaskAutopilotSummary["route"]["candidateRoutes"][number] =>
        item !== null
    );

  return routes.length > 0 ? routes : fallback;
}

function normalizeAutopilotCandidateRoute(
  value: unknown,
  fallback:
    | TaskAutopilotSummary["route"]["selected"]
    | TaskAutopilotSummary["route"]["selectedRoute"]
): TaskAutopilotSummary["route"]["selected"] {
  if (!isRecord(value)) return fallback;

  const id = readText(value.id, fallback?.id ?? "");
  const label = readText(
    value.label ?? value.title ?? value.name,
    fallback?.label ?? fallback?.title ?? fallback?.name ?? id
  );
  if (!id || !label) return fallback;

  const title = readText(value.title, fallback?.title ?? label);

  return {
    id,
    label,
    mode: readAutopilotRouteMode(value.mode, fallback?.mode ?? "standard"),
    status: readSyntheticWorkflowStatus(
      value.status,
      fallback?.status ?? "running"
    ),
    title,
    name: readText(value.name, fallback?.name ?? title),
    summary: readText(value.summary, fallback?.summary ?? title),
    recommended: readBoolean(value.recommended, fallback?.recommended ?? false),
    selected: readBoolean(value.selected, fallback?.selected ?? true),
    locked: readBoolean(value.locked, fallback?.locked ?? false),
    reason: readNullableText(value.reason, fallback?.reason ?? null),
    description: readNullableText(
      value.description,
      fallback?.description ?? null
    ),
    estimatedCost: readNullableText(
      value.estimatedCost,
      fallback?.estimatedCost ?? null
    ),
    estimatedDuration: readNullableText(
      value.estimatedDuration,
      fallback?.estimatedDuration ?? null
    ),
    takeoverLoad: readAutopilotUrgency(
      value.takeoverLoad,
      fallback?.takeoverLoad ?? "medium"
    ),
    riskLevel: readAutopilotRiskLevel(
      value.riskLevel,
      fallback?.riskLevel ?? "unknown"
    ),
    stageKeys: readStringArray(value.stageKeys, fallback?.stageKeys ?? []),
  };
}

function normalizeAutopilotControlActions(
  value: unknown,
  fallback: TaskAutopilotControlAction[]
): TaskAutopilotControlAction[] {
  if (!Array.isArray(value)) return fallback;

  const actions = value
    .map(item => {
      if (!isRecord(item)) return null;
      const id = readText(item.id, "");
      const label = readText(item.label, id);
      if (!id || !label) return null;

      return {
        id,
        type: readAutopilotControlActionType(item.type, "run"),
        label,
        scope: readAutopilotControlScope(item.scope, "mission"),
        enabled: readBoolean(item.enabled, true),
        reason: readNullableText(item.reason, null),
      };
    })
    .filter((item): item is TaskAutopilotControlAction => item !== null);

  return actions.length > 0 ? actions : fallback;
}

function normalizeAutopilotEvidenceTimeline(
  value: unknown,
  fallback: TaskAutopilotEvidenceTimelineItem[]
): TaskAutopilotEvidenceTimelineItem[] {
  if (!Array.isArray(value)) return fallback;

  const items = value
    .map(item => {
      if (!isRecord(item)) return null;
      const id = readText(item.id, "");
      const label = readText(item.label, id);
      if (!id || !label) return null;

      return {
        id,
        type: readAutopilotTimelineEventType(item.type, "system"),
        label,
        detail: readNullableText(item.detail, null),
        status: readAutopilotTimelineEventStatus(item.status, "info"),
        source: readNullableText(item.source, null),
        time: readText(item.time, new Date(0).toISOString()),
      };
    })
    .filter((item): item is TaskAutopilotEvidenceTimelineItem => item !== null);

  return items.length > 0 ? items : fallback;
}

function normalizeAutopilotEvidenceCorrelation(
  value: unknown,
  fallback: TaskAutopilotSummary["evidence"]["correlation"]
): TaskAutopilotSummary["evidence"]["correlation"] {
  if (!isRecord(value)) return fallback;
  const links = isRecord(value.links) ? value.links : {};

  return {
    missionId: readText(value.missionId, fallback.missionId),
    workflowId: readNullableText(value.workflowId, fallback.workflowId),
    replayId: readNullableText(value.replayId, fallback.replayId),
    sessionId: readNullableText(value.sessionId, fallback.sessionId),
    timelineId: readText(value.timelineId, fallback.timelineId),
    routeIds: readStringArray(value.routeIds, fallback.routeIds),
    recommendedRouteId: readNullableText(
      value.recommendedRouteId,
      fallback.recommendedRouteId ?? null
    ),
    selectedRouteId: readNullableText(
      value.selectedRouteId,
      fallback.selectedRouteId ?? null
    ),
    routeStageKeys: readStringArray(
      value.routeStageKeys,
      fallback.routeStageKeys
    ),
    currentStepKey: readNullableText(
      value.currentStepKey,
      fallback.currentStepKey ?? null
    ),
    runtimeEventIds: readStringArray(
      value.runtimeEventIds,
      fallback.runtimeEventIds
    ),
    decisionIds: readStringArray(value.decisionIds, fallback.decisionIds),
    operatorActionIds: readStringArray(
      value.operatorActionIds,
      fallback.operatorActionIds
    ),
    auditEventIds: readStringArrayFromCandidates(
      [
        value.auditEventIds,
        value.auditEventId,
        value.auditId,
        links.auditEventIds,
        links.auditEventId,
        links.auditId,
      ],
      fallback.auditEventIds
    ),
    lineageIds: readStringArrayFromCandidates(
      [value.lineageIds, value.lineageId, links.lineageIds, links.lineageId],
      fallback.lineageIds
    ),
  };
}

function normalizeAutopilotRouteEvidenceEvents(
  value: unknown,
  fallback: TaskAutopilotSummary["route"]["evidence"]["events"]
): TaskAutopilotSummary["route"]["evidence"]["events"] {
  if (!Array.isArray(value)) return fallback;

  const events: TaskAutopilotSummary["route"]["evidence"]["events"] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const at = readText(item.at, "");
    if (!at) continue;
    const eventType =
      readAutopilotRouteEvidenceEventType(item.eventType, null) ??
      "route.selected";
    const actor = readAutopilotRouteChangeActor(item.actor, null) ?? "planner";

    events.push({
      eventType,
      at,
      actor,
      reason: readNullableText(item.reason, null),
      fromRouteId: readNullableText(item.fromRouteId, null) || undefined,
      toRouteId: readNullableText(item.toRouteId, null) || undefined,
    });
  }

  return events.length > 0 ? events : fallback;
}

function inferRouteSelectionMode(
  routeSelectionMode: unknown,
  normalizedSelectionStatus: TaskAutopilotRouteSelectionStatus,
  routeReplanActive: boolean,
  routeReplanTriggeredBy: TaskAutopilotSummary["route"]["replan"]["triggeredBy"],
  selectedRouteId: string | null,
  recommendedRouteId: string | null
): TaskAutopilotSummary["route"]["selection"]["mode"] {
  if (
    routeSelectionMode === "planner_default" ||
    routeSelectionMode === "user_selected" ||
    routeSelectionMode === "runtime_replanned" ||
    routeSelectionMode === "system_downgraded"
  ) {
    return routeSelectionMode;
  }

  if (normalizedSelectionStatus === "replanned" || routeReplanActive) {
    return routeReplanTriggeredBy === "user"
      ? "user_selected"
      : "runtime_replanned";
  }

  if (
    selectedRouteId &&
    recommendedRouteId &&
    selectedRouteId !== recommendedRouteId
  ) {
    return "user_selected";
  }

  return "planner_default";
}

function normalizeAutopilotSummary(
  value: unknown,
  fallback: TaskAutopilotSummary
): TaskAutopilotSummary {
  if (!isRecord(value)) return fallback;

  const destination = isRecord(value.destination) ? value.destination : {};
  const route = isRecord(value.route) ? value.route : {};
  const driveState = isRecord(value.driveState) ? value.driveState : {};
  const fleet = isRecord(value.fleet) ? value.fleet : {};
  const takeover = isRecord(value.takeover) ? value.takeover : {};
  const execution = isRecord(value.execution) ? value.execution : {};
  const recovery = isRecord(value.recovery) ? value.recovery : {};
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const explanation = isRecord(value.explanation) ? value.explanation : {};
  const bindings = isRecord(value.bindings) ? value.bindings : {};
  const normalizedRoles = normalizeAutopilotFleetRoles(
    fleet.roles,
    fallback.fleet.roles
  );
  const normalizedCandidateRoutes = normalizeAutopilotCandidateRoutes(
    route.candidateRoutes,
    fallback.route.candidateRoutes
  );
  const explicitRecommendedRouteId = readNullableText(
    route.recommendedRouteId,
    null
  );
  const explicitSelectedRouteId = readNullableTextFromCandidates(
    [
      route.selectedRouteId,
      isRecord(route.selected) ? route.selected.id : null,
      isRecord(route.selectedRoute) ? route.selectedRoute.id : null,
    ],
    null
  );
  const routeSelection = isRecord(route.selection) ? route.selection : {};
  const routeEvidence = isRecord(route.evidence) ? route.evidence : {};
  const routeReplan = isRecord(route.replan) ? route.replan : {};
  const explanationCurrentState = isRecord(explanation.currentState)
    ? explanation.currentState
    : null;
  const explanationRemainingSteps = isRecord(explanation.remainingSteps)
    ? explanation.remainingSteps
    : null;
  const evidenceCorrelation = isRecord(evidence.correlation)
    ? evidence.correlation
    : null;
  const projectedRecommendedRouteId = readNullableText(
    evidenceCorrelation?.recommendedRouteId,
    null
  );
  const projectedSelectedRouteId = readNullableTextFromCandidates(
    [
      evidenceCorrelation?.selectedRouteId,
      explanationCurrentState?.selectedRouteId,
      explanationRemainingSteps?.selectedRouteId,
    ],
    null
  );
  const normalizedSelectionStatus = readAutopilotRouteSelectionStatus(
    route.selectionStatus ??
      routeSelection.status ??
      explanationCurrentState?.routeSelectionStatus ??
      explanationRemainingSteps?.routeSelectionStatus,
    fallback.route.selectionStatus
  );
  const routeReplanActive = readBoolean(
    normalizedSelectionStatus === "replanned" ? true : routeReplan.active,
    fallback.route.replan.active
  );
  const fallbackRouteChangeReason = readNullableTextFromCandidates(
    [
      fallback.route.changeReason,
      fallback.route.selection.changedReason,
      normalizedSelectionStatus === "replanned" || routeReplanActive
        ? fallback.route.replan.reason
        : null,
    ],
    null
  );
  const normalizedRouteChangeReason = readNullableTextFromCandidates(
    [
      route.changeReason,
      routeSelection.changedReason,
      normalizedSelectionStatus === "replanned" || routeReplanActive
        ? routeReplan.reason
        : null,
      explanationRemainingSteps?.replanChangeSummary,
    ],
    fallbackRouteChangeReason
  );
  const normalizedRouteReplanTriggeredBy = readAutopilotRouteChangeActor(
    routeReplan.triggeredBy,
    normalizedSelectionStatus === "replanned" || routeReplanActive
      ? readAutopilotRouteChangeActor(
          routeSelection.changedBy,
          fallback.route.replan.triggeredBy
        )
      : fallback.route.replan.triggeredBy
  );
  const selectionLocked = readBoolean(
    route.selectionLocked,
    readBoolean(routeSelection.locked, fallback.route.selectionLocked)
  );
  const recommendedRouteId =
    readNullableTextFromCandidates(
      [
        explicitRecommendedRouteId,
        normalizedCandidateRoutes.find(candidate => candidate.recommended)?.id,
        projectedRecommendedRouteId,
        explicitSelectedRouteId,
        projectedSelectedRouteId,
      ],
      fallback.route.recommendedRouteId
    ) ?? null;
  const selectedRouteId =
    readNullableTextFromCandidates(
      [
        explicitSelectedRouteId,
        projectedSelectedRouteId,
        normalizedCandidateRoutes.find(candidate => candidate.selected)?.id,
      ],
      fallback.route.selectedRouteId
    ) ?? null;
  const selectedRouteFallback =
    normalizedCandidateRoutes.find(
      candidate => candidate.id === selectedRouteId
    ) ??
    normalizedCandidateRoutes.find(candidate => candidate.selected) ??
    fallback.route.selectedRoute ??
    fallback.route.selected;
  const selectedFromProjection = normalizeAutopilotCandidateRoute(
    route.selectedRoute,
    selectedRouteFallback
  );
  const normalizedSelectedRoute = normalizeAutopilotCandidateRoute(
    route.selected,
    selectedFromProjection
  );

  const normalizedRoute = {
    id: readText(route.id, fallback.route.id),
    label: readText(route.label, fallback.route.label),
    mode: readAutopilotRouteMode(route.mode, fallback.route.mode),
    status: readSyntheticWorkflowStatus(route.status, fallback.route.status),
    progress: clampPercentage(
      typeof route.progress === "number" ? route.progress : undefined,
      fallback.route.progress
    ),
    currentStageKey: readNullableText(
      route.currentStageKey,
      fallback.route.currentStageKey
    ),
    currentStageLabel: readNullableText(
      route.currentStageLabel,
      fallback.route.currentStageLabel
    ),
    stages: normalizeAutopilotRouteStages(route.stages, fallback.route.stages),
    riskPoints: readStringArray(route.riskPoints, fallback.route.riskPoints),
    takeoverPointIds: readStringArray(
      route.takeoverPointIds,
      fallback.route.takeoverPointIds
    ),
    recommendedRouteId,
    selectedRouteId,
    locked: readBoolean(route.locked, fallback.route.locked),
    changeReason: normalizedRouteChangeReason,
    candidateRoutes: normalizedCandidateRoutes,
    selectionStatus: normalizedSelectionStatus,
    selectionLocked,
    selected: normalizedSelectedRoute,
    selectedRoute: normalizedSelectedRoute,
    selection: {
      status: readAutopilotRouteSelectionStatus(
        routeSelection.status,
        normalizedSelectionStatus
      ),
      mode: inferRouteSelectionMode(
        routeSelection.mode,
        normalizedSelectionStatus,
        routeReplanActive,
        normalizedRouteReplanTriggeredBy,
        selectedRouteId,
        recommendedRouteId
      ),
      locked: readBoolean(routeSelection.locked, selectionLocked),
      canSwitch: readBoolean(
        routeSelection.canSwitch,
        fallback.route.selection.canSwitch
      ),
      switchRequiresConfirmation: readBoolean(
        routeSelection.switchRequiresConfirmation,
        fallback.route.selection.switchRequiresConfirmation
      ),
      changedAt: readNullableText(
        routeSelection.changedAt,
        fallback.route.selection.changedAt
      ),
      changedBy: readAutopilotRouteChangeActor(
        routeSelection.changedBy,
        normalizedSelectionStatus === "replanned" || routeReplanActive
          ? normalizedRouteReplanTriggeredBy
          : fallback.route.selection.changedBy
      ),
      changedReason: readNullableTextFromCandidates(
        [
          routeSelection.changedReason,
          route.changeReason,
          normalizedSelectionStatus === "replanned" || routeReplanActive
            ? routeReplan.reason
            : null,
          explanationRemainingSteps?.replanChangeSummary,
        ],
        normalizedRouteChangeReason
      ),
    },
    evidence: {
      lastEventType: readAutopilotRouteEvidenceEventType(
        routeEvidence.lastEventType,
        fallback.route.evidence.lastEventType
      ),
      lastEventAt: readNullableText(
        routeEvidence.lastEventAt,
        fallback.route.evidence.lastEventAt
      ),
      events: normalizeAutopilotRouteEvidenceEvents(
        routeEvidence.events,
        fallback.route.evidence.events
      ),
    },
    replan: {
      active: routeReplanActive,
      reason: readNullableText(
        routeReplan.reason,
        normalizedSelectionStatus === "replanned" || routeReplanActive
          ? normalizedRouteChangeReason
          : fallback.route.replan.reason
      ),
      fromRouteId: readNullableText(
        routeReplan.fromRouteId,
        normalizedSelectionStatus === "replanned" &&
          recommendedRouteId &&
          selectedRouteId &&
          recommendedRouteId !== selectedRouteId
          ? recommendedRouteId
          : fallback.route.replan.fromRouteId
      ),
      toRouteId: readNullableText(
        routeReplan.toRouteId,
        normalizedSelectionStatus === "replanned"
          ? selectedRouteId
          : fallback.route.replan.toRouteId
      ),
      triggeredBy: normalizedRouteReplanTriggeredBy,
    },
  } satisfies TaskAutopilotSummary["route"];

  const normalizedDriveState = {
    state: readAutopilotDriveState(
      driveState.state ?? value.driveState,
      fallback.driveState.state
    ),
    label: readText(driveState.label, fallback.driveState.label),
    detail: readText(driveState.detail, fallback.driveState.detail),
    currentStageKey: readNullableText(
      driveState.currentStageKey,
      fallback.driveState.currentStageKey
    ),
    currentStageLabel: readNullableText(
      driveState.currentStageLabel,
      fallback.driveState.currentStageLabel
    ),
    blocked: readBoolean(driveState.blocked, fallback.driveState.blocked),
    waitingForUser: readBoolean(
      driveState.waitingForUser,
      fallback.driveState.waitingForUser
    ),
    riskLevel: readAutopilotRiskLevel(
      driveState.riskLevel,
      fallback.driveState.riskLevel
    ),
    confidence: readAutopilotConfidenceLevel(
      driveState.confidence,
      fallback.driveState.confidence
    ),
  } satisfies TaskAutopilotSummary["driveState"];

  const normalizedExecution = {
    currentStepKey: readNullableText(
      execution.currentStepKey,
      fallback.execution.currentStepKey
    ),
    currentStepLabel: readNullableText(
      execution.currentStepLabel,
      fallback.execution.currentStepLabel
    ),
    currentStepStatus: readAutopilotExecutionStatus(
      execution.currentStepStatus,
      fallback.execution.currentStepStatus
    ),
    parallelBranchCount: Number.isFinite(execution.parallelBranchCount)
      ? Number(execution.parallelBranchCount)
      : fallback.execution.parallelBranchCount,
    blockedReasons: readStringArray(
      execution.blockedReasons,
      fallback.execution.blockedReasons
    ),
    intermediateDeliverables: readStringArray(
      execution.intermediateDeliverables,
      fallback.execution.intermediateDeliverables
    ),
    availableActions: normalizeAutopilotControlActions(
      execution.availableActions,
      fallback.execution.availableActions
    ),
  } satisfies TaskAutopilotSummary["execution"];
  const normalizedCorrelationTimelineId =
    readNullableTextFromCandidates(
      [
        evidenceCorrelation?.timelineId,
        explanationCurrentState?.correlationTimelineId,
        explanationRemainingSteps?.correlationTimelineId,
      ],
      fallback.evidence.correlation.timelineId
    ) ?? fallback.evidence.correlation.timelineId;
  const normalizedEvidenceCorrelationBase =
    normalizeAutopilotEvidenceCorrelation(
      evidenceCorrelation,
      fallback.evidence.correlation
    );
  const normalizedEvidenceCorrelation = {
    ...normalizedEvidenceCorrelationBase,
    timelineId: normalizedCorrelationTimelineId,
    recommendedRouteId: readNullableTextFromCandidates(
      [
        evidenceCorrelation?.recommendedRouteId,
        normalizedRoute.recommendedRouteId,
      ],
      normalizedEvidenceCorrelationBase.recommendedRouteId ?? null
    ),
    selectedRouteId: readNullableTextFromCandidates(
      [
        evidenceCorrelation?.selectedRouteId,
        normalizedRoute.selectedRouteId,
        explanationCurrentState?.selectedRouteId,
        explanationRemainingSteps?.selectedRouteId,
      ],
      normalizedEvidenceCorrelationBase.selectedRouteId ?? null
    ),
    currentStepKey: readNullableTextFromCandidates(
      [
        evidenceCorrelation?.currentStepKey,
        normalizedExecution.currentStepKey,
        normalizedRoute.currentStageKey,
      ],
      normalizedEvidenceCorrelationBase.currentStepKey ?? null
    ),
  } satisfies TaskAutopilotSummary["evidence"]["correlation"];

  const normalizedExplanationCurrentStateBase =
    normalizeAutopilotExplanationCurrentState(
      explanation.currentState,
      fallback.explanation.currentState
    );
  const normalizedRemainingStepsBase =
    normalizeAutopilotExplanationRemainingSteps(
      explanation.remainingSteps,
      fallback.explanation.remainingSteps
    );
  const normalizedMainlineSteps = Array.isArray(
    explanationRemainingSteps?.mainlineSteps
  )
    ? normalizeAutopilotRemainingStepsItems(
        explanationRemainingSteps.mainlineSteps,
        fallback.explanation.remainingSteps?.mainlineSteps ?? []
      )
    : (normalizedRemainingStepsBase?.mainlineSteps ?? []);
  const normalizedPendingSteps = Array.isArray(
    explanationRemainingSteps?.pendingSteps
  )
    ? normalizeAutopilotRemainingStepsItems(
        explanationRemainingSteps.pendingSteps,
        fallback.explanation.remainingSteps?.pendingSteps ?? []
      )
    : deriveAutopilotPendingSteps(normalizedMainlineSteps).length > 0
      ? deriveAutopilotPendingSteps(normalizedMainlineSteps)
      : (normalizedRemainingStepsBase?.pendingSteps ?? []);
  const normalizedCurrentStepKey =
    readNullableText(
      explanationRemainingSteps?.currentStepKey,
      normalizedRemainingStepsBase?.currentStepKey ?? null
    ) ??
    normalizedExecution.currentStepKey ??
    normalizedRoute.currentStageKey;
  const normalizedCurrentStepLabel =
    readNullableText(
      explanationRemainingSteps?.currentStepLabel,
      normalizedRemainingStepsBase?.currentStepLabel ?? null
    ) ??
    findAutopilotStepLabel(normalizedMainlineSteps, normalizedCurrentStepKey) ??
    findAutopilotStepLabel(normalizedPendingSteps, normalizedCurrentStepKey) ??
    normalizedExecution.currentStepLabel ??
    normalizedRoute.currentStageLabel;
  const normalizedExplanationCurrentStateBaseSafe =
    normalizedExplanationCurrentStateBase ?? {
      summary: fallback.explanation.current,
      driveState: normalizedDriveState.state,
      missionStatus: "queued" as MissionTaskStatus,
      currentStageKey: normalizedCurrentStepKey,
      currentStageLabel: normalizedCurrentStepLabel,
      workflowStatus: normalizedRoute.status,
      workflowStage: normalizedRoute.currentStageKey,
      routeSelectionStatus: normalizedRoute.selectionStatus,
      selectedRouteId: normalizedRoute.selectedRouteId,
      correlationTimelineId: normalizedCorrelationTimelineId,
      sources: ["combined-inference"] as NonNullable<
        TaskAutopilotExplanationSummary["currentState"]
      >["sources"],
      updatedAt: fallback.evidence.updatedAt,
    };
  const normalizedExplanationCurrentState: NonNullable<
    TaskAutopilotExplanationSummary["currentState"]
  > = {
    summary: readText(
      explanationCurrentState?.summary,
      normalizedExplanationCurrentStateBaseSafe.summary ??
        fallback.explanation.current ??
        normalizedDriveState.detail
    ),
    driveState: readAutopilotDriveState(
      explanationCurrentState?.driveState,
      normalizedDriveState.state
    ),
    currentStageKey:
      readNullableText(
        explanationCurrentState?.currentStageKey,
        normalizedExplanationCurrentStateBaseSafe.currentStageKey
      ) ?? normalizedCurrentStepKey,
    currentStageLabel:
      readNullableText(
        explanationCurrentState?.currentStageLabel,
        normalizedExplanationCurrentStateBaseSafe.currentStageLabel
      ) ?? normalizedCurrentStepLabel,
    workflowStatus:
      readNullableText(
        explanationCurrentState?.workflowStatus,
        normalizedExplanationCurrentStateBaseSafe.workflowStatus
      ) ?? normalizedRoute.status,
    workflowStage:
      readNullableText(
        explanationCurrentState?.workflowStage,
        normalizedExplanationCurrentStateBaseSafe.workflowStage
      ) ?? normalizedRoute.currentStageKey,
    missionStatus: readMissionTaskStatus(
      explanationCurrentState?.missionStatus,
      normalizedExplanationCurrentStateBaseSafe.missionStatus
    ),
    routeSelectionStatus:
      explanationCurrentState?.routeSelectionStatus === null
        ? null
        : readAutopilotRouteSelectionStatus(
            explanationCurrentState?.routeSelectionStatus,
            normalizedExplanationCurrentStateBaseSafe.routeSelectionStatus ??
              normalizedRoute.selectionStatus
          ),
    selectedRouteId: readNullableText(
      explanationCurrentState?.selectedRouteId,
      normalizedExplanationCurrentStateBaseSafe.selectedRouteId ??
        normalizedRoute.selectedRouteId
    ),
    correlationTimelineId: readNullableText(
      explanationCurrentState?.correlationTimelineId,
      normalizedExplanationCurrentStateBaseSafe.correlationTimelineId ??
        normalizedCorrelationTimelineId
    ),
    sources: normalizeAutopilotExplanationSources(
      explanationCurrentState?.sources,
      normalizedExplanationCurrentStateBaseSafe.sources
    ),
    updatedAt: readText(
      explanationCurrentState?.updatedAt,
      normalizedExplanationCurrentStateBaseSafe.updatedAt ??
        fallback.evidence.updatedAt
    ),
  };
  const normalizedExplanationRemainingSteps: NonNullable<
    TaskAutopilotExplanationSummary["remainingSteps"]
  > = {
    ...normalizedRemainingStepsBase,
    currentStepKey: normalizedCurrentStepKey,
    currentStepLabel: normalizedCurrentStepLabel,
    mainlineSteps: normalizedMainlineSteps,
    pendingSteps: normalizedPendingSteps,
    parallelBranchCount: Number.isFinite(
      explanationRemainingSteps?.parallelBranchCount
    )
      ? Number(explanationRemainingSteps?.parallelBranchCount)
      : (normalizedRemainingStepsBase?.parallelBranchCount ??
        normalizedExecution.parallelBranchCount),
    replanChangeSummary: readNullableText(
      explanationRemainingSteps?.replanChangeSummary,
      normalizedRemainingStepsBase?.replanChangeSummary ??
        normalizedRoute.replan.reason
    ),
    selectedRouteId: readNullableText(
      explanationRemainingSteps?.selectedRouteId,
      normalizedRemainingStepsBase?.selectedRouteId ??
        normalizedRoute.selectedRouteId
    ),
    routeSelectionStatus:
      explanationRemainingSteps?.routeSelectionStatus === null
        ? null
        : readAutopilotRouteSelectionStatus(
            explanationRemainingSteps?.routeSelectionStatus,
            normalizedRemainingStepsBase?.routeSelectionStatus ??
              normalizedRoute.selectionStatus
          ),
  };

  const destinationMissingInfoDetailsValue = readRecordValue(destination, [
    "missingInfoDetails",
    "missing_info_details",
    "missingDetails",
    "clarificationDetails",
    "clarification_details",
  ]);
  const destinationMissingInfoValues = readValuesFromRecordAliases(
    destination,
    [
      "missingInfo",
      "missing_info",
      "missingInformation",
      "missing_information",
      "openQuestions",
      "open_questions",
      "questions",
    ]
  );
  const destinationSuggestedClarificationValues = readValuesFromRecordAliases(
    destination,
    [
      "suggestedClarifications",
      "suggested_clarifications",
      "clarificationQuestions",
      "clarification_questions",
      "clarifications",
      "questions",
    ]
  );
  const normalizedDestinationImpact = readNullableText(
    isRecord(destinationMissingInfoDetailsValue)
      ? null
      : readRecordValue(destination, [
          "impact",
          "impactSummary",
          "impact_summary",
        ]),
    readStringArrayOfRecords(
      destinationMissingInfoDetailsValue,
      item =>
        readNullableTextFromCandidates(
          [item.impact, item.impactSummary, item.impact_summary],
          null
        ),
      []
    )[0] ??
      fallback.destination.impact ??
      null
  );
  const normalizedDestinationBlockingReason = readNullableText(
    isRecord(destinationMissingInfoDetailsValue)
      ? null
      : readRecordValue(destination, [
          "blockingReason",
          "blocking_reason",
          "blocker",
          "blockedReason",
          "blocked_reason",
        ]),
    readStringArrayOfRecords(
      destinationMissingInfoDetailsValue,
      item =>
        readBoolean(item.blocking, false)
          ? readNullableTextFromCandidates(
              [
                item.blockingReason,
                item.blocking_reason,
                item.impact,
                item.impactSummary,
                item.impact_summary,
              ],
              null
            )
          : null,
      []
    )[0] ??
      fallback.destination.blockingReason ??
      null
  );

  const normalizedMissingInfoDetails:
    | TaskAutopilotSummary["destination"]["missingInfoDetails"]
    | undefined = Array.isArray(destinationMissingInfoDetailsValue)
    ? destinationMissingInfoDetailsValue
        .map(
          (
            item,
            index
          ):
            | NonNullable<
                TaskAutopilotSummary["destination"]["missingInfoDetails"]
              >[number]
            | null => {
            if (!isRecord(item)) return null;
            const fallbackItem =
              fallback.destination.missingInfoDetails?.[index];
            const itemLabel = readText(
              readRecordValue(item, [
                "item",
                "label",
                "question",
                "prompt",
                "missingInfo",
                "missing_info",
              ]),
              fallbackItem?.item ??
                readStringArrayFromCandidates(destinationMissingInfoValues, [])[
                  index
                ] ??
                fallback.destination.missingInfo[index] ??
                ""
            );
            const impact = readText(
              readRecordValue(item, [
                "impact",
                "impactSummary",
                "impact_summary",
              ]),
              fallbackItem?.impact ?? normalizedDestinationImpact ?? ""
            );
            if (!itemLabel || !impact) return null;
            const clarification = readNullableTextFromCandidates(
              [
                item.clarification,
                item.suggestedClarification,
                item.suggested_clarification,
                item.question,
                item.prompt,
              ],
              fallbackItem?.clarification ?? null
            );
            return {
              item: itemLabel,
              impact,
              blocking: readBoolean(
                item.blocking,
                fallbackItem?.blocking ??
                  impact === normalizedDestinationBlockingReason
              ),
              ...(clarification ? { clarification } : {}),
            };
          }
        )
        .filter(
          (
            item
          ): item is NonNullable<
            TaskAutopilotSummary["destination"]["missingInfoDetails"]
          >[number] => item !== null
        )
    : fallback.destination.missingInfoDetails;

  const normalizedMissingInfo = Array.from(
    new Set([
      ...readStringArrayFromCandidates(
        destinationMissingInfoValues,
        fallback.destination.missingInfo
      ),
      ...(normalizedMissingInfoDetails ?? [])
        .map(item => readNullableText(item.item, null))
        .filter((item): item is string => item !== null),
    ])
  );
  const destinationLock = isRecord(destination.lock) ? destination.lock : {};
  const normalizedDestinationConfirmedAt = readNullableTextFromCandidates(
    [
      destination.confirmedAt,
      destination.confirmed_at,
      destination.lockedAt,
      destination.locked_at,
      destinationLock.confirmedAt,
      destinationLock.confirmed_at,
      destinationLock.lockedAt,
      destinationLock.locked_at,
    ],
    fallback.destination.confirmedAt ?? null
  );
  const normalizedDestinationModifiedAt = readNullableTextFromCandidates(
    [
      destination.modifiedAt,
      destination.modified_at,
      destination.updatedAt,
      destination.updated_at,
      destination.changedAt,
      destination.changed_at,
      destinationLock.modifiedAt,
      destinationLock.modified_at,
      destinationLock.updatedAt,
      destinationLock.updated_at,
    ],
    fallback.destination.modifiedAt ?? null
  );
  const normalizedDestinationLockState =
    readAutopilotDestinationLockState(
      readNullableTextFromCandidates(
        [
          destination.lockState,
          destination.lock_state,
          destination.goalLockState,
          destination.goal_lock_state,
          destination.status,
          destinationLock.state,
          destinationLock.lockState,
          destinationLock.lock_state,
        ],
        null
      ),
      fallback.destination.lockState ?? null
    ) ??
    (normalizedMissingInfo.length > 0
      ? "needs-reconfirm"
      : normalizedDestinationModifiedAt
        ? "modified"
        : normalizedDestinationConfirmedAt
          ? "locked"
          : null);

  return {
    version: readText(value.version, fallback.version),
    source: readText(value.source, fallback.source),
    destination: {
      id: readText(destination.id, fallback.destination.id),
      goal: readText(destination.goal, fallback.destination.goal),
      request: readText(destination.request, fallback.destination.request),
      taskType: readAutopilotDestinationTaskType(
        destination.taskType,
        fallback.destination.taskType
      ),
      auxiliaryTaskTypes: readStringArrayFromCandidates(
        readValuesFromRecordAliases(destination, [
          "auxiliaryTaskTypes",
          "auxiliary_task_types",
          "secondaryTaskTypes",
          "secondary_task_types",
        ]),
        fallback.destination.auxiliaryTaskTypes ?? []
      ).map(taskType => readAutopilotDestinationTaskType(taskType, "unknown")),
      confidence:
        destination.confidence === null
          ? undefined
          : {
              level: readAutopilotConfidenceLevel(
                isRecord(destination.confidence)
                  ? destination.confidence.level
                  : destination.confidence,
                fallback.destination.confidence?.level ??
                  fallback.driveState.confidence
              ),
              reason: readNullableTextFromCandidates(
                [
                  isRecord(destination.confidence)
                    ? destination.confidence.reason
                    : null,
                ],
                fallback.destination.confidence?.reason ?? null
              ),
              signals: readStringArrayFromCandidates(
                [
                  isRecord(destination.confidence)
                    ? destination.confidence.signals
                    : undefined,
                ],
                fallback.destination.confidence?.signals ?? []
              ),
            },
      constraints: readStringArrayAllowEmpty(
        readRecordValue(destination, [
          "constraints",
          "constraintList",
          "constraint_list",
          "requirements",
          "guardrails",
        ]),
        fallback.destination.constraints
      ),
      successCriteria: readStringArrayAllowEmpty(
        readRecordValue(destination, [
          "successCriteria",
          "success_criteria",
          "acceptanceCriteria",
          "acceptance_criteria",
          "doneCriteria",
          "done_criteria",
        ]),
        fallback.destination.successCriteria
      ),
      subGoals: normalizeAutopilotDestinationSubGoals(
        readRecordValue(destination, [
          "subGoals",
          "sub_goals",
          "subgoals",
          "goals",
          "objectives",
        ]),
        fallback.destination.subGoals ?? []
      ),
      deliverables: readStringArrayAllowEmpty(
        destination.deliverables,
        fallback.destination.deliverables
      ),
      missingInfo: normalizedMissingInfo,
      missingInfoDetails: normalizedMissingInfoDetails,
      suggestedClarifications: readStringArrayFromCandidates(
        [
          ...destinationSuggestedClarificationValues,
          Array.isArray(destinationMissingInfoDetailsValue)
            ? destinationMissingInfoDetailsValue
                .map(item =>
                  isRecord(item)
                    ? readNullableTextFromCandidates(
                        [
                          item.clarification,
                          item.suggestedClarification,
                          item.suggested_clarification,
                          item.question,
                          item.prompt,
                        ],
                        null
                      )
                    : null
                )
                .filter((item): item is string => item !== null)
            : undefined,
        ],
        fallback.destination.suggestedClarifications ?? []
      ),
      lockState: normalizedDestinationLockState,
      confirmedAt: normalizedDestinationConfirmedAt,
      modifiedAt: normalizedDestinationModifiedAt,
      impact: normalizedDestinationImpact,
      blockingReason: normalizedDestinationBlockingReason,
    },
    route: normalizedRoute,
    driveState: normalizedDriveState,
    fleet: {
      roles: normalizedRoles,
      activeRoleCount: Number.isFinite(fleet.activeRoleCount)
        ? Number(fleet.activeRoleCount)
        : normalizedRoles.filter(
            role => role.status === "running" || role.status === "waiting"
          ).length,
      blockedRoleCount: Number.isFinite(fleet.blockedRoleCount)
        ? Number(fleet.blockedRoleCount)
        : normalizedRoles.filter(
            role => role.status === "blocked" || role.status === "failed"
          ).length,
    },
    takeover: {
      status: readAutopilotTakeoverStatus(
        takeover.status,
        fallback.takeover.status
      ),
      required: readBoolean(takeover.required, fallback.takeover.required),
      blocking: readBoolean(takeover.blocking, fallback.takeover.blocking),
      type: readAutopilotTakeoverType(takeover.type, fallback.takeover.type),
      reason: readNullableText(takeover.reason, fallback.takeover.reason),
      prompt: readNullableText(takeover.prompt, fallback.takeover.prompt),
      decisionId: readNullableText(
        takeover.decisionId,
        fallback.takeover.decisionId
      ),
      options: normalizeAutopilotTakeoverOptions(
        takeover.options,
        fallback.takeover.options
      ),
      urgency: readAutopilotUrgency(
        takeover.urgency,
        fallback.takeover.urgency
      ),
    },
    execution: normalizedExecution,
    recovery: {
      state: readAutopilotRecoveryState(
        recovery.state,
        fallback.recovery.state
      ),
      deviationCategory: readAutopilotDeviationCategory(
        recovery.deviationCategory,
        fallback.recovery.deviationCategory
      ),
      reason: readNullableText(recovery.reason, fallback.recovery.reason),
      attemptedActions: readStringArray(
        recovery.attemptedActions,
        fallback.recovery.attemptedActions
      ),
      suggestedActions: readStringArray(
        recovery.suggestedActions,
        fallback.recovery.suggestedActions
      ) as TaskAutopilotRecoverySummary["suggestedActions"],
      needsHuman: readBoolean(
        recovery.needsHuman,
        fallback.recovery.needsHuman
      ),
      canAutoRecover: readBoolean(
        recovery.canAutoRecover,
        fallback.recovery.canAutoRecover
      ),
    },
    evidence: {
      eventCount: Number.isFinite(evidence.eventCount)
        ? Number(evidence.eventCount)
        : fallback.evidence.eventCount,
      artifactCount: Number.isFinite(evidence.artifactCount)
        ? Number(evidence.artifactCount)
        : fallback.evidence.artifactCount,
      lastSignal: readNullableText(
        evidence.lastSignal,
        fallback.evidence.lastSignal
      ),
      latestEventType: readNullableText(
        evidence.latestEventType,
        fallback.evidence.latestEventType
      ),
      updatedAt: readText(evidence.updatedAt, fallback.evidence.updatedAt),
      trustLevel: readAutopilotEvidenceTrustLevel(
        evidence.trustLevel,
        fallback.evidence.trustLevel
      ),
      gaps: readStringArray(evidence.gaps, fallback.evidence.gaps),
      timeline: normalizeAutopilotEvidenceTimeline(
        evidence.timeline,
        fallback.evidence.timeline
      ),
      correlation: normalizedEvidenceCorrelation,
    },
    explanation: {
      current: readText(explanation.current, fallback.explanation.current),
      nextSteps: readStringArray(
        explanation.nextSteps,
        fallback.explanation.nextSteps
      ),
      recommendationReasons: readStringArray(
        explanation.recommendationReasons,
        fallback.explanation.recommendationReasons
      ),
      currentState: normalizedExplanationCurrentState,
      recommendationDetails: normalizeAutopilotRecommendationDetails(
        explanation.recommendationDetails,
        fallback.explanation.recommendationDetails ?? []
      ).map(detail => ({
        ...detail,
        routeSelectionStatus:
          detail.routeSelectionStatus ?? normalizedRoute.selectionStatus,
        correlationTimelineId:
          detail.correlationTimelineId ?? normalizedCorrelationTimelineId,
      })),
      remainingSteps: normalizedExplanationRemainingSteps,
      riskSummary: readStringArray(
        explanation.riskSummary,
        fallback.explanation.riskSummary
      ),
      evidenceHints: readStringArray(
        explanation.evidenceHints,
        fallback.explanation.evidenceHints
      ),
      telemetrySignals: readStringArray(
        explanation.telemetrySignals,
        fallback.explanation.telemetrySignals
      ),
    },
    bindings: {
      missionId: readText(bindings.missionId, fallback.bindings.missionId),
      workflowId: readNullableText(
        bindings.workflowId,
        fallback.bindings.workflowId
      ),
      executorJobId: readNullableText(
        bindings.executorJobId,
        fallback.bindings.executorJobId
      ),
      instanceId: readNullableText(
        bindings.instanceId,
        fallback.bindings.instanceId
      ),
    },
  };
}

function autopilotDriveStateLabel(state: TaskAutopilotDriveState): string {
  switch (state) {
    case "understanding":
      return "Understanding destination";
    case "clarifying":
      return "Clarifying destination";
    case "planning":
      return "Planning route";
    case "fleet-forming":
      return "Forming fleet";
    case "executing":
      return "Executing route";
    case "reviewing":
      return "Reviewing result";
    case "blocked":
      return "Blocked";
    case "takeover-required":
      return "Takeover required";
    case "replanning":
      return "Replanning route";
    case "delivered":
      return "Delivered";
  }
}

function inferAutopilotDriveState(
  mission: MissionRecord,
  currentStageKey: string | null,
  operatorState: MissionOperatorState,
  waitingFor: string | null
): TaskAutopilotDriveState {
  if (mission.status === "done") return "delivered";
  if (operatorState === "blocked") return "blocked";
  if (mission.status === "waiting" || waitingFor || mission.decision) {
    return "takeover-required";
  }
  if (mission.status === "failed" || mission.status === "cancelled") {
    return "blocked";
  }
  if (operatorState === "paused" || operatorState === "terminating") {
    return "blocked";
  }

  switch (currentStageKey) {
    case "receive":
    case "understand":
      return "understanding";
    case "plan":
      return "planning";
    case "provision":
      return "fleet-forming";
    case "finalize":
      return "reviewing";
    case "execute":
      return "executing";
    default:
      return mission.status === "queued" ? "understanding" : "executing";
  }
}

function inferAutopilotRiskLevel(
  mission: MissionRecord,
  failureReasons: string[],
  operatorState: MissionOperatorState
): TaskAutopilotRiskLevel {
  if (mission.status === "failed" || operatorState === "blocked") return "high";
  if (
    failureReasons.length > 0 ||
    mission.status === "cancelled" ||
    mission.events.some(event => event.level === "error")
  ) {
    return "high";
  }
  if (
    mission.status === "waiting" ||
    mission.decision ||
    mission.blocker ||
    mission.events.some(event => event.level === "warn")
  ) {
    return "medium";
  }
  return "low";
}

function inferAutopilotConfidenceLevel(
  mission: MissionRecord,
  riskLevel: TaskAutopilotRiskLevel,
  waitingFor: string | null
): TaskAutopilotConfidenceLevel {
  if (mission.status === "failed" || riskLevel === "high") return "low";
  if (waitingFor || mission.decision || riskLevel === "medium") return "medium";
  if (mission.status === "queued") return "unknown";
  return "high";
}

function inferAutopilotTakeoverType(
  mission: MissionRecord,
  operatorState: MissionOperatorState
): TaskAutopilotTakeoverType | null {
  if (mission.decision?.type === "multi-choice") return "route-selection";
  if (mission.decision?.type === "approve") return "approval";
  if (mission.decision?.type === "request-info") return "clarification";
  if (mission.decision?.type === "escalate") return "exception";
  if (mission.decision?.type) return "approval";
  if (operatorState === "blocked") return "operator";
  if (mission.status === "waiting") return "clarification";
  return null;
}

function inferAutopilotTakeoverStatus(
  mission: MissionRecord,
  operatorState: MissionOperatorState,
  takeoverRequired: boolean
): TaskAutopilotTakeoverStatus | null {
  if (operatorState === "blocked" || mission.blocker) {
    return "required";
  }
  if (takeoverRequired || mission.decision) {
    return "pending";
  }
  if (mission.waitingFor) {
    return "advisory";
  }
  return null;
}

function buildAutopilotSummaryFallback(
  mission: MissionRecord,
  options?: {
    currentStageKey?: string | null;
    currentStageLabel?: string | null;
    waitingFor?: string | null;
    summaryText?: string;
    lastSignal?: string | null;
    failureReasons?: string[];
    departmentLabels?: string[];
  }
): TaskAutopilotSummary {
  const workflowId = mission.projection?.workflowId || mission.id;
  const fallback = buildSharedMissionAutopilotSummary({
    mission,
    workflowId,
    source: "client-mission-projection",
    version: "client-autopilot-projection/v1",
  });
  const currentStageKey =
    options?.currentStageKey ?? stageKeyFromMission(mission);
  const currentStageLabel =
    options?.currentStageLabel ??
    stageLabelFromMission(mission, currentStageKey);
  const operatorState = missionOperatorStateFromMission(mission);
  const waitingFor =
    options?.waitingFor ??
    mission.waitingFor ??
    (mission.status === "waiting"
      ? mission.decision?.prompt || "Awaiting decision"
      : null);
  const summaryText =
    options?.summaryText ??
    missionSummaryText(mission, mission.events, waitingFor);
  const failureReasons =
    options?.failureReasons ?? missionFailureReasons(mission, mission.events);
  const driveState = inferAutopilotDriveState(
    mission,
    currentStageKey,
    operatorState,
    waitingFor
  );
  const riskLevel = inferAutopilotRiskLevel(
    mission,
    failureReasons,
    operatorState
  );
  const confidence = inferAutopilotConfidenceLevel(
    mission,
    riskLevel,
    waitingFor
  );
  const takeoverRequired =
    driveState === "takeover-required" ||
    Boolean(waitingFor) ||
    Boolean(mission.decision) ||
    operatorState === "blocked";
  const lastSignal =
    options?.lastSignal ?? fallback.evidence.lastSignal ?? null;
  const routeMode: TaskAutopilotRouteMode =
    mission.kind === "chat" || mission.kind === "nl-command"
      ? "fast"
      : mission.status === "waiting" || operatorState === "blocked"
        ? "deep"
        : "standard";
  const routeStatus = workflowStatusFromMission(mission.status);
  const routeLocked =
    mission.status === "waiting" ||
    mission.status === "done" ||
    mission.status === "failed" ||
    mission.status === "cancelled";
  const routeChangeReason =
    (mission.attempt ?? 1) > 1
      ? `Mission has retried ${Math.max((mission.attempt ?? 1) - 1, 0)} time(s).`
      : waitingFor || mission.blocker?.reason || null;
  const routeChangeActor: TaskAutopilotSummary["route"]["selection"]["changedBy"] =
    mission.status === "waiting"
      ? "user"
      : (mission.attempt ?? 1) > 1
        ? "runtime"
        : operatorState === "blocked" || operatorState === "paused"
          ? "operator"
          : "planner";
  const candidateRoutes: TaskAutopilotSummary["route"]["candidateRoutes"] = [
    {
      id: `${workflowId}:fast`,
      label: "Fast route",
      mode: "fast",
      status: routeStatus,
      title: "Fast route",
      name: "Fast route",
      summary: "Favor shorter execution chains and minimal confirmations.",
      recommended: routeMode === "fast",
      selected: routeMode === "fast",
      locked: routeLocked,
      reason: summaryText,
      description: "Favor shorter execution chains and minimal confirmations.",
      estimatedCost: "low",
      estimatedDuration: "short",
      takeoverLoad: "medium",
      riskLevel: riskLevel === "high" ? "medium" : "low",
      stageKeys: mission.stages.map(stage => stage.key),
    },
    {
      id: `${workflowId}:standard`,
      label: "Standard route",
      mode: "standard",
      status: routeStatus,
      title: "Standard route",
      name: "Standard route",
      summary: "Balance execution depth, governance, and delivery confidence.",
      recommended: routeMode === "standard",
      selected: routeMode === "standard",
      locked: routeLocked,
      reason: summaryText,
      description:
        "Balance execution depth, governance, and delivery confidence.",
      estimatedCost: "medium",
      estimatedDuration: "medium",
      takeoverLoad: "medium",
      riskLevel,
      stageKeys: mission.stages.map(stage => stage.key),
    },
    {
      id: `${workflowId}:deep`,
      label: "Deep route",
      mode: "deep",
      status: routeStatus,
      title: "Deep route",
      name: "Deep route",
      summary: "Favor verification, recovery headroom, and auditability.",
      recommended: routeMode === "deep",
      selected: routeMode === "deep",
      locked: routeLocked,
      reason: waitingFor || mission.blocker?.reason || summaryText,
      description: "Favor verification, recovery headroom, and auditability.",
      estimatedCost: "high",
      estimatedDuration: "long",
      takeoverLoad: "high",
      riskLevel: riskLevel === "unknown" ? "medium" : riskLevel,
      stageKeys: mission.stages.map(stage => stage.key),
    },
  ];
  const selectedRoute =
    candidateRoutes.find(route => route.selected) ?? candidateRoutes[0] ?? null;
  const recommendedRouteId =
    candidateRoutes.find(route => route.recommended)?.id || null;
  const selectedRouteId = selectedRoute?.id || null;
  const waitingForRouteSelection = mission.decision?.type === "multi-choice";
  const selectionStatus: TaskAutopilotSummary["route"]["selectionStatus"] =
    (mission.attempt ?? 1) > 1
      ? "replanned"
      : waitingForRouteSelection
        ? "alternatives-available"
        : routeLocked
          ? "locked"
          : "recommended";
  const selectionMode: TaskAutopilotSummary["route"]["selection"]["mode"] =
    (mission.attempt ?? 1) > 1 ? "runtime_replanned" : "planner_default";
  const routeEvidenceEvents: TaskAutopilotSummary["route"]["evidence"]["events"] =
    [
      {
        eventType: "route.recommended",
        at: new Date(mission.updatedAt).toISOString(),
        actor: "planner",
        reason: summaryText,
        toRouteId: recommendedRouteId || undefined,
      },
      {
        eventType:
          (mission.attempt ?? 1) > 1 ? "route.replanned" : "route.selected",
        at: new Date(mission.updatedAt).toISOString(),
        actor: routeChangeActor,
        reason: routeChangeReason,
        fromRouteId:
          (mission.attempt ?? 1) > 1 &&
          recommendedRouteId &&
          recommendedRouteId !== selectedRouteId
            ? recommendedRouteId
            : undefined,
        toRouteId: selectedRouteId || undefined,
      },
      ...(routeLocked
        ? [
            {
              eventType: "route.locked" as const,
              at: new Date(mission.updatedAt).toISOString(),
              actor: routeChangeActor,
              reason: routeChangeReason,
              toRouteId: selectedRouteId || undefined,
            },
          ]
        : []),
    ];
  const routeRiskPoints = Array.from(
    new Set([
      ...failureReasons,
      ...(waitingFor ? [`Awaiting ${waitingFor}`] : []),
      ...(mission.blocker?.reason ? [mission.blocker.reason] : []),
      ...(mission.status === "failed"
        ? ["Mission failed and needs recovery"]
        : []),
      ...(operatorState === "blocked"
        ? ["Operator intervention is blocking progress"]
        : []),
    ])
  ).filter(Boolean);
  const explanationUpdatedAt = new Date(mission.updatedAt).toISOString();
  const evidenceTimelineId = `${mission.id}:timeline`;
  const recommendationDetails: NonNullable<
    TaskAutopilotExplanationSummary["recommendationDetails"]
  > = [];

  if (selectedRoute) {
    recommendationDetails.push({
      kind: "route",
      summary: selectedRoute.reason || selectedRoute.summary,
      source: "route-planner",
      routeId: selectedRoute.id,
      actionType: null,
      takeoverType: null,
      decisionId: null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: evidenceTimelineId,
      updatedAt: explanationUpdatedAt,
    });
  }

  if (mission.status === "waiting") {
    recommendationDetails.push({
      kind: "takeover",
      summary:
        mission.decision?.prompt ||
        waitingFor ||
        "Explicit operator confirmation is required before execution resumes.",
      source: "takeover-state",
      routeId: selectedRoute?.id || null,
      actionType: "wait",
      takeoverType: inferAutopilotTakeoverType(mission, operatorState),
      decisionId: mission.decision?.decisionId || null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: evidenceTimelineId,
      updatedAt: explanationUpdatedAt,
    });
  }

  if (selectionStatus === "replanned") {
    recommendationDetails.push({
      kind: "replan",
      summary:
        routeChangeReason ||
        "Runtime signals changed enough that the route was replanned.",
      source:
        routeChangeActor === "runtime" ? "recovery-engine" : "mission-runtime",
      routeId: selectedRoute?.id || null,
      actionType: "replan",
      takeoverType: null,
      decisionId: null,
      routeSelectionStatus: selectionStatus,
      correlationTimelineId: evidenceTimelineId,
      updatedAt: explanationUpdatedAt,
    });
  }

  const explanationMainlineSteps = mission.stages.map(stage => ({
    key: stage.key,
    label: stage.label,
    status: stage.status,
    isCurrent: stage.key === currentStageKey,
  }));
  const explanationPendingSteps = explanationMainlineSteps.filter(
    stage => stage.status === "pending" || stage.status === "running"
  );
  const explanationSources: NonNullable<
    TaskAutopilotExplanationSummary["currentState"]
  >["sources"] = Array.from(
    new Set([
      "mission-runtime",
      ...(mission.projection?.workflowId
        ? (["workflow-runtime"] as const)
        : []),
      ...(selectedRoute ? (["route-planner"] as const) : []),
      ...(takeoverRequired ? (["takeover-state"] as const) : []),
      ...(selectionStatus === "replanned" || routeChangeActor === "runtime"
        ? (["recovery-engine"] as const)
        : []),
    ])
  );

  return {
    ...fallback,
    destination: {
      ...fallback.destination,
      missingInfo: waitingFor
        ? Array.from(new Set([waitingFor, ...fallback.destination.missingInfo]))
        : fallback.destination.missingInfo,
      confidence: {
        level: confidence,
        reason: waitingFor
          ? `Pending clarification: ${waitingFor}`
          : mission.summary
            ? "Mission summary and runtime state provide destination context."
            : mission.sourceText
              ? "Source text provides the current destination intent."
              : "Destination intent is inferred from the live mission record.",
        signals: Array.from(
          new Set([
            ...(mission.summary ? ["mission-summary"] : []),
            ...((mission.artifacts?.length ?? 0) > 0
              ? ["artifacts-present"]
              : []),
            ...(mission.events.length > 0 ? ["runtime-events-present"] : []),
            ...(waitingFor ? ["waiting-for-input"] : []),
            ...(mission.blocker?.reason ? ["blocked-by-runtime"] : []),
            ...(mission.decision?.prompt ? ["decision-prompt-present"] : []),
            ...(mission.sourceText ? ["source-text-present"] : []),
          ])
        ),
      },
      suggestedClarifications:
        waitingFor && mission.decision?.prompt
          ? [mission.decision.prompt]
          : fallback.destination.suggestedClarifications,
      missingInfoDetails: waitingFor
        ? [
            {
              item: waitingFor,
              impact:
                mission.decision?.type === "multi-choice"
                  ? "Route selection cannot continue until this input is resolved."
                  : mission.decision?.type === "request-info"
                    ? "Goal understanding remains incomplete until this input is resolved."
                    : "Mission progress remains paused until this input is resolved.",
              blocking: true,
            },
          ]
        : mission.operatorState === "blocked" && mission.blocker?.reason
          ? [
              {
                item: mission.blocker.reason,
                impact:
                  "Runtime recovery and execution handoff remain blocked.",
                blocking: true,
              },
            ]
          : fallback.destination.missingInfoDetails,
    },
    route: {
      ...fallback.route,
      mode: routeMode,
      status: workflowStatusFromMission(mission.status),
      currentStageKey: currentStageKey ?? fallback.route.currentStageKey,
      currentStageLabel: currentStageLabel ?? fallback.route.currentStageLabel,
      riskPoints: routeRiskPoints,
      takeoverPointIds: mission.decision?.decisionId
        ? [mission.decision.decisionId]
        : takeoverRequired
          ? [`${mission.id}:takeover`]
          : fallback.route.takeoverPointIds,
      recommendedRouteId,
      selectedRouteId,
      locked: routeLocked,
      changeReason: routeChangeReason,
      candidateRoutes,
      selectionStatus,
      selectionLocked: routeLocked,
      selected: selectedRoute,
      selectedRoute,
      selection: {
        status: selectionStatus,
        mode: selectionMode,
        locked: routeLocked,
        canSwitch: waitingForRouteSelection ? true : !routeLocked,
        switchRequiresConfirmation: takeoverRequired,
        changedAt: new Date(mission.updatedAt).toISOString(),
        changedBy: routeChangeActor,
        changedReason: routeChangeReason,
      },
      evidence: {
        lastEventType: routeEvidenceEvents.at(-1)?.eventType || null,
        lastEventAt: routeEvidenceEvents.at(-1)?.at || null,
        events: routeEvidenceEvents,
      },
      replan: {
        active: selectionStatus === "replanned",
        reason: selectionStatus === "replanned" ? routeChangeReason : null,
        fromRouteId:
          selectionStatus === "replanned" &&
          recommendedRouteId &&
          recommendedRouteId !== selectedRouteId
            ? recommendedRouteId
            : null,
        toRouteId: selectionStatus === "replanned" ? selectedRouteId : null,
        triggeredBy: selectionStatus === "replanned" ? routeChangeActor : null,
      },
    },
    driveState: {
      state: driveState,
      label: autopilotDriveStateLabel(driveState),
      detail: summaryText || fallback.driveState.detail,
      currentStageKey: currentStageKey ?? fallback.driveState.currentStageKey,
      currentStageLabel:
        currentStageLabel ?? fallback.driveState.currentStageLabel,
      blocked: driveState === "blocked" || operatorState === "blocked",
      waitingForUser: takeoverRequired,
      riskLevel,
      confidence,
    },
    takeover: {
      status: inferAutopilotTakeoverStatus(
        mission,
        operatorState,
        takeoverRequired
      ),
      required: takeoverRequired,
      blocking:
        driveState === "takeover-required" || operatorState === "blocked",
      type: inferAutopilotTakeoverType(mission, operatorState),
      reason: waitingFor ?? fallback.takeover.reason,
      prompt:
        mission.decision?.prompt || waitingFor || fallback.takeover.prompt,
      decisionId: mission.decision?.decisionId || fallback.takeover.decisionId,
      options: (mission.decision?.options ?? []).map(option => ({
        id: option.id,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
      urgency:
        riskLevel === "high"
          ? "high"
          : takeoverRequired || riskLevel === "medium"
            ? "medium"
            : "low",
    },
    execution: {
      currentStepKey: currentStageKey,
      currentStepLabel: currentStageLabel,
      currentStepStatus:
        mission.status === "done"
          ? "done"
          : mission.status === "failed"
            ? "failed"
            : operatorState === "blocked" || mission.blocker
              ? "blocked"
              : mission.status === "waiting"
                ? "waiting"
                : mission.status === "queued"
                  ? "pending"
                  : "running",
      parallelBranchCount: Math.max(
        mission.agentCrew?.length ?? 0,
        mission.workPackages?.length ?? 0,
        mission.executor ? 1 : 0
      ),
      blockedReasons: Array.from(
        new Set([
          ...(waitingFor ? [waitingFor] : []),
          ...(mission.blocker?.reason ? [mission.blocker.reason] : []),
          ...failureReasons,
        ])
      ),
      intermediateDeliverables: Array.from(
        new Set([
          ...(mission.artifacts?.map(artifact => artifact.name) ?? []),
          ...(mission.workPackages
            ?.map(pkg => pkg.deliverable)
            .filter((item): item is string => Boolean(item)) ?? []),
        ])
      ).slice(0, 5),
      availableActions: [
        {
          id: `${mission.id}:run`,
          type: "run",
          label: "run",
          scope: "stage",
          enabled: mission.status === "running" || mission.status === "queued",
          reason: null,
        },
        {
          id: `${mission.id}:wait`,
          type: "wait",
          label: "wait",
          scope: "stage",
          enabled: mission.status === "waiting",
          reason: waitingFor ? "Mission is waiting on human input." : null,
        },
        {
          id: `${mission.id}:resume`,
          type: "resume",
          label: "resume",
          scope: "mission",
          enabled: mission.status === "waiting" || operatorState === "blocked",
          reason:
            mission.status === "waiting" || operatorState === "blocked"
              ? null
              : "Resume is only available for waiting or blocked missions.",
        },
        {
          id: `${mission.id}:replan`,
          type: "replan",
          label: "replan",
          scope: "route",
          enabled: mission.status !== "done" && mission.status !== "cancelled",
          reason: null,
        },
      ],
    },
    recovery: {
      state:
        operatorState === "blocked"
          ? "takeover-required"
          : mission.status === "failed"
            ? (mission.attempt ?? 1) > 1
              ? "escalated"
              : "recovering"
            : waitingFor
              ? "watching"
              : "healthy",
      deviationCategory:
        operatorState === "blocked"
          ? "state-block"
          : mission.status === "failed"
            ? (mission.attempt ?? 1) > 1
              ? "recovery-exhausted"
              : "dependency-failure"
            : mission.decision?.type === "multi-choice"
              ? "route-deviation"
              : mission.decision?.type === "request-info"
                ? "goal-deviation"
                : waitingFor
                  ? "governance-deviation"
                  : failureReasons.length > 0
                    ? "quality-deviation"
                    : "none",
      reason: mission.blocker?.reason || waitingFor || null,
      attemptedActions: (mission.operatorActions ?? []).map(
        action => action.action
      ),
      suggestedActions:
        operatorState === "blocked"
          ? ["resume", "retry", "escalate"]
          : waitingFor
            ? ["resume", "replan"]
            : mission.status === "failed"
              ? ["retry", "escalate"]
              : ["run"],
      needsHuman:
        operatorState === "blocked" ||
        mission.status === "waiting" ||
        ((mission.attempt ?? 1) > 1 && mission.status === "failed"),
      canAutoRecover:
        mission.status !== "done" &&
        mission.status !== "cancelled" &&
        operatorState !== "blocked" &&
        ((mission.attempt ?? 1) <= 2 || mission.status !== "failed"),
    },
    evidence: {
      ...fallback.evidence,
      lastSignal,
      updatedAt: new Date(mission.updatedAt).toISOString(),
      trustLevel:
        (mission.artifacts?.length ?? 0) > 0 && mission.events.length > 0
          ? "verified"
          : mission.events.length > 0
            ? "partial"
            : "unverified",
      gaps: Array.from(
        new Set([
          ...(mission.artifacts?.length ? [] : ["No artifacts captured yet"]),
          ...(mission.events.length > 0
            ? []
            : ["No runtime events captured yet"]),
          ...(mission.status === "waiting" &&
          (mission.decisionHistory?.length ?? 0) === 0
            ? ["Waiting mission has no resolved decision history yet"]
            : []),
        ])
      ),
      timeline: [
        ...mission.events.slice(-6).map(
          event =>
            ({
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
              detail: event.message || null,
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
            }) satisfies TaskAutopilotEvidenceTimelineItem
        ),
        ...(mission.operatorActions ?? []).slice(-3).map(
          action =>
            ({
              id: action.id,
              type: "operator_action" as const,
              label: action.action,
              detail: action.detail || action.reason || null,
              status:
                action.result === "rejected"
                  ? "failed"
                  : action.result === "completed"
                    ? "done"
                    : "running",
              source: action.requestedBy || "operator",
              time: new Date(action.createdAt).toISOString(),
            }) satisfies TaskAutopilotEvidenceTimelineItem
        ),
      ].slice(-8),
      correlation: {
        ...fallback.evidence.correlation,
        missionId: mission.id,
        workflowId,
        timelineId: evidenceTimelineId,
        routeIds: candidateRoutes.map(route => route.id),
        recommendedRouteId,
        selectedRouteId,
        routeStageKeys: mission.stages.map(stage => stage.key),
        currentStepKey: currentStageKey,
        runtimeEventIds: mission.events.map(
          event => `${mission.id}:event:${event.time}:${event.type}`
        ),
        decisionIds: Array.from(
          new Set(
            [
              mission.decision?.decisionId,
              ...(mission.decisionHistory ?? []).map(entry => entry.decisionId),
            ].filter((value): value is string => Boolean(value))
          )
        ),
        operatorActionIds: (mission.operatorActions ?? []).map(
          action => action.id
        ),
        auditEventIds: fallback.evidence.correlation.auditEventIds,
        lineageIds: fallback.evidence.correlation.lineageIds,
      },
    },
    explanation: {
      current: summaryText,
      currentState: {
        summary: summaryText,
        driveState,
        missionStatus: mission.status,
        currentStageKey,
        currentStageLabel,
        workflowStatus: routeStatus,
        workflowStage: currentStageKey,
        routeSelectionStatus: selectionStatus,
        selectedRouteId,
        correlationTimelineId: evidenceTimelineId,
        sources: explanationSources,
        updatedAt: explanationUpdatedAt,
      },
      nextSteps: explanationPendingSteps.map(stage => stage.label).slice(0, 3),
      recommendationReasons:
        recommendationDetails.length > 0
          ? recommendationDetails.map(item => item.summary)
          : [
              waitingFor
                ? "Current route keeps human review in the loop before continuing."
                : "Current route is inferred from mission kind, risk, and runtime readiness.",
            ],
      recommendationDetails:
        recommendationDetails.length > 0 ? recommendationDetails : undefined,
      remainingSteps: {
        currentStepKey: currentStageKey,
        currentStepLabel: currentStageLabel,
        mainlineSteps: explanationMainlineSteps,
        pendingSteps: explanationPendingSteps,
        parallelBranchCount: Math.max(
          mission.agentCrew?.length ?? 0,
          mission.workPackages?.length ?? 0,
          mission.executor ? 1 : 0
        ),
        replanChangeSummary:
          selectionStatus === "replanned" ? routeChangeReason : null,
      },
      riskSummary: Array.from(
        new Set([
          ...failureReasons,
          ...(waitingFor ? [waitingFor] : []),
          ...(mission.blocker?.reason ? [mission.blocker.reason] : []),
        ])
      ),
      evidenceHints: Array.from(
        new Set([
          ...(mission.artifacts?.length
            ? ["Artifacts are available for review."]
            : []),
          ...(mission.events.length > 0
            ? ["Runtime events are available."]
            : []),
          ...((mission.decisionHistory?.length ?? 0) > 0
            ? ["Decision history is available."]
            : []),
        ])
      ),
      telemetrySignals: [
        `mission.status:${mission.status}`,
        `drive.state:${driveState}`,
        `risk.level:${riskLevel}`,
      ],
    },
    bindings: {
      ...fallback.bindings,
      workflowId,
      instanceId:
        mission.projection?.instanceId ||
        mission.instance?.id ||
        fallback.bindings.instanceId,
    },
  };
}

function buildAutopilotSummary(
  mission: MissionRecord,
  options?: Parameters<typeof buildAutopilotSummaryFallback>[1]
): TaskAutopilotSummary {
  const fallback = buildAutopilotSummaryFallback(mission, options);
  return normalizeAutopilotSummary(
    readAutopilotSummaryCandidate(mission),
    fallback
  );
}

function buildPlanetAutopilotSummaryFallback(
  planet: MissionPlanetOverviewItem,
  options: {
    summaryText: string;
    currentStageKey: string | null;
    currentStageLabel: string | null;
    waitingFor: string | null;
    lastSignal: string | null;
  }
): TaskAutopilotSummary {
  const syntheticMission: MissionRecord = {
    id: planet.id,
    kind: planet.kind || "general",
    title: trimText(planet.title, 140) || "Untitled mission",
    sourceText: planet.sourceText || planet.title,
    status: planet.status === "archived" ? "done" : planet.status,
    progress: clampPercentage(planet.progress),
    currentStageKey: options.currentStageKey ?? undefined,
    projection: {
      workflowId: planet.id,
    },
    stages: options.currentStageKey
      ? [
          {
            key: options.currentStageKey,
            label: options.currentStageLabel || options.currentStageKey,
            status:
              planet.status === "archived"
                ? "done"
                : planet.status === "failed"
                  ? "failed"
                  : "running",
            detail: options.summaryText,
          },
        ]
      : [],
    summary: options.summaryText,
    waitingFor: options.waitingFor || undefined,
    operatorState: "active",
    operatorActions: [],
    attempt: 1,
    createdAt: planet.createdAt,
    updatedAt: planet.updatedAt,
    completedAt: planet.completedAt,
    events: [],
  };

  const summary = buildAutopilotSummaryFallback(syntheticMission, {
    currentStageKey: options.currentStageKey,
    currentStageLabel: options.currentStageLabel,
    waitingFor: options.waitingFor,
    summaryText: options.summaryText,
    lastSignal: options.lastSignal,
  });

  return {
    ...summary,
    source: "client-planet-projection",
    bindings: {
      ...summary.bindings,
      workflowId: planet.id,
    },
  };
}

function timelineLevelForMissionEvent(event: MissionEvent): TimelineLevel {
  if (event.type === "done") return "success";
  if (event.type === "failed" || event.level === "error") return "error";
  if (event.type === "cancelled") return "warn";
  if (event.type === "waiting" || event.level === "warn") return "warn";
  return "info";
}

function titleForMissionEvent(
  mission: MissionRecord,
  event: MissionEvent
): string {
  const stageLabel = stageLabelFromMission(mission, event.stageKey);

  switch (event.type) {
    case "created":
      return "Mission created";
    case "progress":
      return stageLabel ? `Stage active: ${stageLabel}` : "Mission progressed";
    case "waiting":
      return stageLabel ? `Waiting in ${stageLabel}` : "Awaiting decision";
    case "done":
      return "Mission completed";
    case "failed":
      return "Mission failed";
    case "cancelled":
      return "Mission cancelled";
    case "log":
    default:
      return stageLabel ? `${stageLabel} signal` : "Mission log";
  }
}

function buildMissionTimeline(
  mission: MissionRecord,
  events: MissionEvent[]
): TaskTimelineEvent[] {
  const items: TaskTimelineEvent[] = events.map((event, index) => ({
    id: `${mission.id}:${event.time}:${event.type}:${index}`,
    type: event.type,
    time: event.time,
    level: timelineLevelForMissionEvent(event),
    title: titleForMissionEvent(mission, event),
    description: event.message,
    actor: event.source
      ? capitalize(event.source.replace(/-/g, " "))
      : undefined,
  }));

  if (!items.some(item => item.type === "created")) {
    items.unshift({
      id: `${mission.id}:created`,
      type: "created",
      time: mission.createdAt,
      level: "info",
      title: "Mission created",
      description:
        trimText(mission.sourceText || mission.title, 180) ||
        "Mission created.",
    });
  }

  return items.sort((left, right) => left.time - right.time).slice(-40);
}

function buildMissionInteriorStages(mission: MissionRecord): TaskStageRing[] {
  const orderedStages: MissionStage[] =
    mission.stages.length > 0
      ? mission.stages
      : MISSION_CORE_STAGE_BLUEPRINT.map(stage => ({
          key: stage.key,
          label: stage.label,
          status:
            mission.currentStageKey === stage.key && mission.status !== "queued"
              ? ("running" as const)
              : ("pending" as const),
          detail: undefined,
        }));

  return orderedStages.map((stage, index) => {
    const arcStart = (index / orderedStages.length) * 360;
    const arcEnd = ((index + 1) / orderedStages.length) * 360;
    const midAngle = (arcStart + arcEnd) / 2;
    const segmentStart = (index / orderedStages.length) * 100;
    const segmentEnd = ((index + 1) / orderedStages.length) * 100;
    const segmentProgress =
      segmentEnd <= segmentStart
        ? 0
        : ((clampPercentage(mission.progress) - segmentStart) /
            (segmentEnd - segmentStart)) *
          100;

    let progress = 0;
    if (stage.status === "done") {
      progress = 100;
    } else if (stage.status === "running") {
      progress = Math.max(18, Math.min(96, Math.round(segmentProgress)));
    } else if (stage.status === "failed") {
      progress = Math.max(24, Math.min(92, Math.round(segmentProgress || 42)));
    }

    return {
      key: stage.key,
      label: stage.label,
      status: stage.status,
      progress,
      detail:
        stage.detail ||
        (stage.status === "done"
          ? "Completed"
          : stage.status === "running"
            ? "Live stage"
            : stage.status === "failed"
              ? "Blocked"
              : "Queued"),
      arcStart,
      arcEnd,
      midAngle,
    };
  });
}

function inferMissionCoreAgentStatus(
  status: MissionTaskStatus,
  operatorState: MissionOperatorState = "active"
): InteriorAgentStatus {
  if (operatorState === "paused" || operatorState === "blocked") return "idle";
  if (status === "running") return "working";
  if (status === "waiting") return "thinking";
  if (status === "done") return "done";
  if (status === "failed") return "error";
  if (status === "cancelled") return "idle";
  return "idle";
}

function withAgentAngles(
  agents: Omit<TaskInteriorAgent, "angle">[]
): TaskInteriorAgent[] {
  return agents.map((agent, index) => ({
    ...agent,
    angle: agents.length <= 1 ? 0 : Math.round((360 / agents.length) * index),
  }));
}

function extensionFromValue(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.split(/[?#]/)[0];
  const index = normalized.lastIndexOf(".");
  if (index === -1 || index === normalized.length - 1) {
    return null;
  }
  return normalized.slice(index + 1).toLowerCase();
}

export function buildMissionArtifacts(mission: MissionRecord): TaskArtifact[] {
  return (mission.artifacts || []).map((artifact: MissionArtifact, index) => {
    const downloadUrl = `/api/tasks/${mission.id}/artifacts/${index}/download`;
    const previewUrl = `/api/tasks/${mission.id}/artifacts/${index}/preview`;
    const format =
      extensionFromValue(artifact.name) ||
      extensionFromValue(artifact.path) ||
      extensionFromValue(artifact.url) ||
      undefined;

    const isExternal = artifact.kind === "url";
    const downloadKind: TaskArtifact["downloadKind"] = isExternal
      ? "external"
      : artifact.path
        ? "server"
        : undefined;
    const href = isExternal
      ? artifact.url
      : artifact.path
        ? downloadUrl
        : undefined;

    return {
      id: artifact.id || `${mission.id}:mission-artifact:${index}`,
      title: artifact.name,
      description:
        artifact.description ||
        artifact.path ||
        artifact.url ||
        `${capitalize(artifact.kind)} artifact`,
      kind: artifact.kind,
      format,
      filename: artifact.name,
      downloadKind,
      href,
      mimeType: artifact.mimeType,
      previewType: artifact.previewType,
      size: artifact.size,
      downloadUrl,
      previewUrl,
    };
  });
}

function dedupeArtifacts(artifacts: TaskArtifact[]): TaskArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter(artifact => {
    const key = [
      artifact.kind,
      artifact.title,
      artifact.format || "",
      artifact.href || "",
      artifact.filename || "",
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildMissionDecisionPresets(
  decision: MissionDecision | undefined
): TaskDecisionPreset[] {
  if (!decision) {
    return [];
  }

  const options = Array.isArray(decision.options) ? decision.options : [];
  if (options.length === 0 && decision.allowFreeText) {
    return [
      {
        id: "mission-free-text",
        label: "Submit note",
        description: "Resume the mission with a decision note.",
        prompt: decision.prompt,
        tone: "primary",
        action: "mission",
      },
    ];
  }

  return options.map((option, index) => ({
    id: `mission:${option.id}`,
    label: option.label,
    description:
      option.description ||
      (decision.allowFreeText
        ? "Submit this option with an optional note."
        : "Submit this option and resume the mission."),
    prompt: decision.prompt,
    tone:
      index === 0
        ? "primary"
        : /abort|stop|reject|fail|report/i.test(option.label)
          ? "warning"
          : "secondary",
    action: "mission",
    optionId: option.id,
  }));
}

function buildMissionInstanceInfo(
  summary: MissionTaskSummary,
  mission: MissionRecord
): Array<{ label: string; value: string }> {
  return [
    { label: "Mission ID", value: mission.id },
    { label: "Runtime", value: "Advanced server runtime" },
    {
      label: "Current stage",
      value: summary.currentStageLabel || "Not started",
    },
    { label: "Executor", value: mission.executor?.name || "n/a" },
    { label: "Executor job", value: mission.executor?.jobId || "n/a" },
    { label: "Executor request", value: mission.executor?.requestId || "n/a" },
    { label: "Attempt", value: String(summary.attempt) },
    { label: "Instance", value: mission.instance?.id || "n/a" },
    { label: "Workspace", value: mission.instance?.workspaceRoot || "n/a" },
    { label: "Created", value: formatShortDate(summary.createdAt) },
    { label: "Completed", value: formatShortDate(summary.completedAt) },
  ];
}

function buildMissionLogSummary(
  mission: MissionRecord,
  events: MissionEvent[]
): Array<{ label: string; value: string }> {
  const lastEvent = events[events.length - 1];

  return [
    { label: "Event entries", value: formatCount(events.length) },
    {
      label: "Progress signals",
      value: formatCount(
        events.filter(event => event.type === "progress").length
      ),
    },
    {
      label: "Waiting signals",
      value: formatCount(
        events.filter(event => event.type === "waiting").length
      ),
    },
    {
      label: "Log entries",
      value: formatCount(events.filter(event => event.type === "log").length),
    },
    {
      label: "Executor status",
      value: mission.executor?.status || "n/a",
    },
    {
      label: "Last signal",
      value: lastEvent
        ? `${lastEvent.type} @ ${formatShortDate(lastEvent.time)}`
        : "No live mission event yet",
    },
  ];
}

/**
 * Planet-native summary 构建：从 MissionPlanetOverviewItem 派生。
 * 可选传入 MissionRecord 以获取 workPackages/messageLog 等丰富化字段。
 */
export function buildPlanetSummaryRecord(
  planet: MissionPlanetOverviewItem,
  mission?: MissionRecord
): MissionTaskSummary {
  const workPackages = mission?.workPackages ?? [];
  const messageLog = mission?.messageLog ?? [];
  const events = mission?.events ?? [];
  const artifacts = mission?.artifacts ?? [];

  const taskCount = workPackages.length;
  const completedTaskCount = workPackages.filter(
    wp => wp.status === "passed" || wp.status === "verified"
  ).length;
  const messageCount = messageLog.length;
  const activeAgentCount = mission?.agentCrew
    ? mission.agentCrew.filter(
        a => a.status === "working" || a.status === "thinking"
      ).length
    : 0;

  const failureReasons: string[] = [];
  if (mission) {
    failureReasons.push(...missionFailureReasons(mission, events));
  }

  const waitingFor = planet.waitingFor ?? null;
  const currentStageKey = planet.currentStageKey ?? null;
  const currentStageLabel = planet.currentStageLabel ?? null;

  const summaryText = mission
    ? missionSummaryText(mission, events, waitingFor)
    : trimText(planet.summary, 180) ||
      "Mission is progressing through the execution pipeline.";

  const startedAt = mission ? missionStartedAt(mission) : null;

  const lastEvent = events[events.length - 1];
  const lastMessage = messageLog[messageLog.length - 1];
  const lastSignal =
    trimText(lastEvent?.message, 96) ||
    trimText(lastMessage?.content, 96) ||
    currentStageLabel ||
    null;
  const autopilotSummary = mission
    ? buildAutopilotSummary(mission, {
        currentStageKey,
        currentStageLabel,
        waitingFor,
        summaryText,
        lastSignal,
        failureReasons,
      })
    : buildPlanetAutopilotSummaryFallback(planet, {
        summaryText,
        currentStageKey,
        currentStageLabel,
        waitingFor,
        lastSignal,
      });

  return {
    id: planet.id,
    title: trimText(planet.title, 76) || "Untitled mission",
    kind: planet.kind || "general",
    sourceText: planet.sourceText || planet.title,
    status: planet.status === "archived" ? "done" : planet.status,
    operatorState: mission
      ? missionOperatorStateFromMission(mission)
      : "active",
    workflowStatus: workflowStatusFromMission(
      planet.status === "archived" ? "done" : planet.status
    ),
    progress: clampPercentage(planet.progress),
    currentStageKey,
    currentStageLabel,
    summary: summaryText,
    waitingFor,
    blocker: mission?.blocker ?? null,
    attempt: Math.max(1, mission?.attempt ?? 1),
    latestOperatorAction: mission ? missionLatestOperatorAction(mission) : null,
    createdAt: planet.createdAt,
    updatedAt: planet.updatedAt,
    startedAt,
    completedAt: planet.completedAt ?? null,
    departmentLabels:
      planet.tags.length > 0
        ? planet.tags
        : planet.kind
          ? [capitalize(planet.kind.replace(/[_-]/g, " "))]
          : [],
    taskCount,
    completedTaskCount,
    messageCount,
    activeAgentCount,
    attachmentCount: artifacts.length,
    issueCount: failureReasons.length,
    hasWarnings:
      failureReasons.length > 0 ||
      events.some((event: MissionEvent) => event.level === "warn"),
    lastSignal,
    autopilotSummary,
  };
}

/**
 * summary 构建：完全从 MissionRecord 派生。
 */
function buildSummaryRecord(mission: MissionRecord): MissionTaskSummary {
  const currentStageKey = stageKeyFromMission(mission);
  const currentStageLabel = stageLabelFromMission(mission, currentStageKey);
  const operatorState = missionOperatorStateFromMission(mission);
  const latestOperatorAction = missionLatestOperatorAction(mission);
  const waitingFor =
    mission.waitingFor ||
    (mission.status === "waiting"
      ? mission.decision?.prompt || "Awaiting decision"
      : null);
  const failureReasons = missionFailureReasons(mission, mission.events);
  const lastEvent = mission.events[mission.events.length - 1];
  const summaryText = missionSummaryText(mission, mission.events, waitingFor);
  const lastSignal =
    trimText(latestOperatorAction?.detail, 96) ||
    trimText(latestOperatorAction?.reason, 96) ||
    trimText(lastEvent?.message, 96) ||
    trimText(
      mission.messageLog?.[mission.messageLog.length - 1]?.content,
      96
    ) ||
    currentStageLabel ||
    null;

  return {
    id: mission.id,
    title: trimText(mission.title, 76) || "Untitled mission",
    kind: mission.kind || "general",
    sourceText: mission.sourceText || mission.title,
    status: mission.status,
    operatorState,
    workflowStatus: workflowStatusFromMission(mission.status),
    progress: clampPercentage(mission.progress),
    currentStageKey,
    currentStageLabel,
    summary: summaryText,
    waitingFor,
    blocker: mission.blocker ?? null,
    attempt: Math.max(1, mission.attempt ?? 1),
    latestOperatorAction,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    startedAt: missionStartedAt(mission),
    completedAt: mission.completedAt || null,
    departmentLabels: mission.organization?.departments.map(d => d.label) ?? [],
    taskCount: mission.workPackages?.length ?? 0,
    completedTaskCount:
      mission.workPackages?.filter(
        wp => wp.status === "passed" || wp.status === "verified"
      ).length ?? 0,
    messageCount: mission.messageLog?.length ?? 0,
    activeAgentCount:
      mission.agentCrew?.filter(
        a => a.status === "working" || a.status === "thinking"
      ).length ?? 0,
    attachmentCount: mission.artifacts?.length ?? 0,
    issueCount: failureReasons.length,
    hasWarnings:
      failureReasons.length > 0 ||
      operatorState === "blocked" ||
      mission.events.some(e => e.level === "warn"),
    lastSignal,
    autopilotSummary: buildAutopilotSummary(mission, {
      currentStageKey,
      currentStageLabel,
      waitingFor,
      summaryText,
      lastSignal,
      failureReasons,
    }),
  };
}

/**
 * 原生 agent 构建：从 MissionRecord.agentCrew 派生（mission-native 数据源）。
 * 始终包含 mission-core agent。
 */
function buildNativeInteriorAgents(
  mission: MissionRecord
): TaskInteriorAgent[] {
  const currentStageKey = stageKeyFromMission(mission) || "receive";
  const currentStageLabel =
    stageLabelFromMission(mission, currentStageKey) || currentStageKey;

  const agents: Array<Omit<TaskInteriorAgent, "angle">> = [];

  if (mission.agentCrew) {
    for (const member of mission.agentCrew) {
      agents.push({
        id: member.id,
        name: member.name,
        role: member.role,
        department: member.department ?? "",
        title: member.role,
        status: member.status,
        stageKey: currentStageKey,
        stageLabel: currentStageLabel,
        progress: null,
        currentAction: undefined,
      });
    }
  }

  // 始终包含 mission-core agent
  agents.push({
    id: "mission-core",
    name: "Mission Core",
    role: "orchestrator",
    department: "Mission",
    title: "Mission controller",
    status: inferMissionCoreAgentStatus(
      mission.status,
      missionOperatorStateFromMission(mission)
    ),
    stageKey: currentStageKey,
    stageLabel: currentStageLabel,
    progress: clampPercentage(mission.progress),
    currentAction: undefined,
  });

  return withAgentAngles(agents);
}

/**
 * 原生 log summary 构建：从 MissionRecord.messageLog 最近 10 条派生。
 */
function buildNativeLogSummary(
  mission: MissionRecord
): Array<{ label: string; value: string }> {
  if (!mission.messageLog?.length) {
    return [{ label: "Messages", value: "No messages yet" }];
  }

  const recent = mission.messageLog.slice(-10);
  return recent.map(entry => ({
    label: entry.sender,
    value: entry.content,
  }));
}

/**
 * detail 构建：完全从 MissionRecord 派生。
 */
function buildDetailRecord(
  mission: MissionRecord,
  missionSocketConnected = false
): MissionTaskDetail {
  const summary = buildSummaryRecord(mission);
  const failureReasons = missionFailureReasons(mission, mission.events);

  return {
    ...summary,
    workflow: syntheticWorkflowFromMission(mission),
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: buildMissionInteriorStages(mission),
    agents: buildNativeInteriorAgents(mission),
    timeline: buildMissionTimeline(mission, mission.events),
    artifacts: dedupeArtifacts(buildMissionArtifacts(mission)),
    failureReasons,
    decisionPresets: buildMissionDecisionPresets(mission.decision),
    decisionPrompt: mission.decision?.prompt || null,
    decisionPlaceholder: mission.decision?.placeholder || null,
    decisionAllowsFreeText: mission.decision?.allowFreeText === true,
    decision: mission.decision ?? null,
    instanceInfo: buildMissionInstanceInfo(summary, mission),
    logSummary: buildMissionLogSummary(mission, mission.events),
    runtimeChannels: buildRuntimeChannels(mission, missionSocketConnected),
    decisionHistory: mission.decisionHistory ?? [],
    operatorActions: mission.operatorActions ?? [],
    securitySummary: mission.securitySummary,
    executor: mission.executor,
    instance: mission.instance,
    previewSession: mission.previewSession,
    missionArtifacts: mission.artifacts,
  };
}

function buildDemoMissionStages(
  activeStageKey: string,
  statuses?: Partial<
    Record<
      (typeof MISSION_CORE_STAGE_BLUEPRINT)[number]["key"],
      InteriorStageStatus
    >
  >
): MissionStage[] {
  return MISSION_CORE_STAGE_BLUEPRINT.map(stage => {
    const status =
      statuses?.[stage.key] ??
      (stage.key === activeStageKey
        ? "running"
        : MISSION_CORE_STAGE_BLUEPRINT.findIndex(
              item => item.key === stage.key
            ) <
            MISSION_CORE_STAGE_BLUEPRINT.findIndex(
              item => item.key === activeStageKey
            )
          ? "done"
          : "pending");

    return {
      key: stage.key,
      label: stage.label,
      status,
      detail:
        status === "done"
          ? "Demo stage completed."
          : status === "running"
            ? "Demo stage is currently active."
            : "Queued for the demo route.",
    };
  });
}

function createGitHubPagesDemoMissions(): MissionRecord[] {
  const base = Date.parse("2026-05-04T01:00:00.000Z");

  return [
    {
      id: GITHUB_PAGES_DEMO_MISSION_IDS.aigcClarify,
      kind: "project-autopilot",
      title: "澄清 AI漫剧生成平台目标与交付物",
      sourceText:
        "围绕 AI 漫剧生成平台，确认目标用户、输入输出、MVP 范围、可接管节点和首版交付物。",
      topicId: GITHUB_PAGES_DEMO_PROJECT_IDS.aigcComic,
      projection: {
        projectId: GITHUB_PAGES_DEMO_PROJECT_IDS.aigcComic,
        workflowId: "demo-workflow-aigc-clarify",
        instanceId: "demo-instance-aigc-clarify",
        sourceApp: "github-pages-demo",
      },
      status: "running",
      progress: 62,
      currentStageKey: "plan",
      stages: buildDemoMissionStages("plan"),
      summary:
        "AI 已理解项目空间、自动驾驶页和任务中心需要围绕同一个项目工作，正在整理 Spec 和演示执行路线。",
      artifacts: [
        {
          kind: "report",
          name: "aigc-comic-demo-scope.md",
          path: "docs/demo/aigc-comic-demo-scope.md",
          description: "演示范围、关键页面和首版交付物清单。",
        },
      ],
      organization: {
        departments: [
          { key: "planning", label: "Planning", managerName: "Spec Agent" },
          { key: "runtime", label: "Runtime", managerName: "Mission Core" },
          { key: "archive", label: "Archive", managerName: "Evidence Agent" },
        ],
        agentCount: 5,
      },
      workPackages: [
        {
          id: "demo-wp-aigc-1",
          title: "整理项目目标",
          description: "把用户目标转成项目上下文和 Spec 草案。",
          stageKey: "understand",
          status: "verified",
          score: 92,
          deliverable: "项目目标摘要",
        },
        {
          id: "demo-wp-aigc-2",
          title: "规划演示路径",
          description: "确认自动驾驶页、任务中心和产物归档的演示顺序。",
          stageKey: "plan",
          status: "running",
          deliverable: "演示路线",
        },
      ],
      messageLog: [
        {
          sender: "User",
          content: "需要展示用的默认数据，GitHub Pages 不要登录。",
          time: base + 12 * 60_000,
          stageKey: "receive",
        },
        {
          sender: "Mission Core",
          content: "已切换为 Pages 展示模式，准备注入项目和任务演示数据。",
          time: base + 24 * 60_000,
          stageKey: "understand",
        },
      ],
      agentCrew: [
        {
          id: "demo-agent-planner",
          name: "Planner",
          role: "manager",
          department: "Planning",
          status: "thinking",
        },
        {
          id: "demo-agent-runtime",
          name: "Runtime Scout",
          role: "worker",
          department: "Runtime",
          status: "working",
        },
      ],
      executor: {
        name: "GitHub Pages Demo",
        status: "running",
        jobId: "demo-job-aigc-clarify",
        lastEventType: "job.progress",
        lastEventAt: base + 86 * 60_000,
      },
      instance: {
        id: "demo-instance-aigc-clarify",
        workspaceRoot: "/demo/github-pages/aigc-comic",
        startedAt: base + 30 * 60_000,
      },
      operatorState: "active",
      operatorActions: [],
      attempt: 1,
      createdAt: base + 30 * 60_000,
      updatedAt: base + 150 * 60_000,
      events: [
        {
          type: "created",
          message: "Demo mission created for AI comic platform.",
          level: "info",
          time: base + 30 * 60_000,
          stageKey: "receive",
          source: "mission-core",
        },
        {
          type: "progress",
          message: "Spec skeleton and route outline are ready for review.",
          progress: 62,
          level: "info",
          time: base + 148 * 60_000,
          stageKey: "plan",
          source: "brain",
        },
      ],
    },
    {
      id: GITHUB_PAGES_DEMO_MISSION_IDS.aigcRender,
      kind: "project-autopilot",
      title: "规划首版漫剧生成链路",
      sourceText:
        "规划从脚本输入到分镜、角色设定、素材生成和审核归档的演示执行链路。",
      topicId: GITHUB_PAGES_DEMO_PROJECT_IDS.aigcComic,
      projection: {
        projectId: GITHUB_PAGES_DEMO_PROJECT_IDS.aigcComic,
        workflowId: "demo-workflow-aigc-render",
        instanceId: "demo-instance-aigc-render",
        sourceApp: "github-pages-demo",
      },
      status: "waiting",
      progress: 38,
      currentStageKey: "understand",
      stages: buildDemoMissionStages("understand"),
      summary: "正在等待用户确认首版更偏可演示原型，还是接入真实生成链路。",
      waitingFor: "确认首版交付物定位",
      decision: {
        decisionId: "demo-decision-aigc-output",
        type: "multi-choice",
        prompt: "首版交付物更偏向可演示原型，还是端到端真实生成链路？",
        options: [
          {
            id: "prototype",
            label: "可演示原型",
            description: "优先保证 GitHub Pages 上看得懂、点得通。",
          },
          {
            id: "real-pipeline",
            label: "真实生成链路",
            description: "优先接入真实模型和素材生成服务。",
          },
          {
            id: "hybrid",
            label: "两者都要",
            description: "演示原型先跑通，同时保留真实服务接入点。",
          },
        ],
      },
      artifacts: [
        {
          kind: "file",
          name: "storyboard-flow.json",
          path: "docs/demo/storyboard-flow.json",
          description: "脚本到分镜的演示流程结构。",
        },
      ],
      organization: {
        departments: [
          { key: "story", label: "Story", managerName: "Story Agent" },
          { key: "visual", label: "Visual", managerName: "Visual Agent" },
        ],
        agentCount: 4,
      },
      workPackages: [
        {
          id: "demo-wp-render-1",
          title: "梳理生成链路",
          stageKey: "understand",
          status: "running",
          deliverable: "生成链路草图",
        },
      ],
      messageLog: [
        {
          sender: "Mission Core",
          content: "等待用户确认交付物定位后继续拆分生成任务。",
          time: base + 142 * 60_000,
          stageKey: "understand",
        },
      ],
      agentCrew: [
        {
          id: "demo-agent-story",
          name: "Story Agent",
          role: "manager",
          department: "Story",
          status: "thinking",
        },
      ],
      executor: {
        name: "GitHub Pages Demo",
        status: "waiting",
        jobId: "demo-job-aigc-render",
        lastEventType: "job.waiting",
        lastEventAt: base + 144 * 60_000,
      },
      operatorState: "active",
      operatorActions: [],
      attempt: 1,
      createdAt: base + 60 * 60_000,
      updatedAt: base + 140 * 60_000,
      events: [
        {
          type: "waiting",
          message: "Waiting for output positioning decision.",
          level: "warn",
          time: base + 140 * 60_000,
          stageKey: "understand",
          source: "mission-core",
        },
      ],
    },
    {
      id: GITHUB_PAGES_DEMO_MISSION_IDS.authSpec,
      kind: "project-autopilot",
      title: "补齐权限管理系统认证合同",
      sourceText:
        "确认邮箱验证码登录、共享认证合同、RBAC、项目数据隔离和审计日志的实现边界。",
      topicId: GITHUB_PAGES_DEMO_PROJECT_IDS.authAdmin,
      projection: {
        projectId: GITHUB_PAGES_DEMO_PROJECT_IDS.authAdmin,
        workflowId: "demo-workflow-auth-spec",
        sourceApp: "github-pages-demo",
      },
      status: "waiting",
      progress: 45,
      currentStageKey: "plan",
      stages: buildDemoMissionStages("plan"),
      summary:
        "邮箱登录和验证码方向已明确，仍需确认权限模型是否支持部门继承与跨项目授权。",
      waitingFor: "确认权限模型范围",
      decision: {
        decisionId: "demo-decision-auth-scope",
        type: "multi-choice",
        prompt: "权限模型是否需要支持部门继承和跨项目授权？",
        options: [
          { id: "simple-rbac", label: "仅简单 RBAC" },
          { id: "department", label: "支持部门继承" },
          { id: "cross-project", label: "支持跨项目授权" },
        ],
      },
      artifacts: [
        {
          kind: "report",
          name: "auth-contract-notes.md",
          path: "docs/demo/auth-contract-notes.md",
          description: "共享认证合同和验证码登录边界。",
        },
      ],
      organization: {
        departments: [
          { key: "auth", label: "Auth", managerName: "Auth Agent" },
          { key: "security", label: "Security", managerName: "Policy Agent" },
        ],
        agentCount: 3,
      },
      workPackages: [
        {
          id: "demo-wp-auth-1",
          title: "整理认证合同",
          stageKey: "plan",
          status: "running",
          deliverable: "认证合同说明",
        },
      ],
      messageLog: [
        {
          sender: "Auth Agent",
          content: "验证码登录、会话恢复和项目 owner 绑定需要统一契约。",
          time: base + 120 * 60_000,
          stageKey: "plan",
        },
      ],
      agentCrew: [
        {
          id: "demo-agent-auth",
          name: "Auth Agent",
          role: "manager",
          department: "Auth",
          status: "thinking",
        },
      ],
      executor: {
        name: "GitHub Pages Demo",
        status: "waiting",
        jobId: "demo-job-auth-spec",
        lastEventType: "job.waiting",
        lastEventAt: base + 122 * 60_000,
      },
      operatorState: "active",
      operatorActions: [],
      attempt: 1,
      createdAt: base + 78 * 60_000,
      updatedAt: base + 122 * 60_000,
      events: [
        {
          type: "waiting",
          message: "Waiting for permission model scope.",
          level: "warn",
          time: base + 122 * 60_000,
          stageKey: "plan",
          source: "mission-core",
        },
      ],
    },
    {
      id: GITHUB_PAGES_DEMO_MISSION_IDS.dataDashboard,
      kind: "project-autopilot",
      title: "完成数据运营驾驶舱演示闭环",
      sourceText:
        "整理增长、留存、成本和异常告警指标，形成可展示的运营驾驶舱原型。",
      topicId: GITHUB_PAGES_DEMO_PROJECT_IDS.dataOps,
      projection: {
        projectId: GITHUB_PAGES_DEMO_PROJECT_IDS.dataOps,
        workflowId: "demo-workflow-data-dashboard",
        sourceApp: "github-pages-demo",
      },
      status: "done",
      progress: 100,
      currentStageKey: "finalize",
      stages: buildDemoMissionStages("finalize", {
        receive: "done",
        understand: "done",
        plan: "done",
        provision: "done",
        execute: "done",
        finalize: "done",
      }),
      summary: "运营驾驶舱演示原型已经完成，可查看指标分组、筛选和导出入口。",
      completedAt: base + 125 * 60_000,
      artifacts: [
        {
          kind: "url",
          name: "数据运营驾驶舱原型",
          url: "https://example.com/demo/data-ops-dashboard",
          description: "GitHub Pages 展示用的看板原型入口。",
        },
      ],
      organization: {
        departments: [
          { key: "analytics", label: "Analytics", managerName: "Data Agent" },
        ],
        agentCount: 2,
      },
      workPackages: [
        {
          id: "demo-wp-data-1",
          title: "完成指标看板",
          stageKey: "execute",
          status: "verified",
          score: 96,
          deliverable: "运营看板原型",
        },
      ],
      messageLog: [
        {
          sender: "Data Agent",
          content: "指标分组、筛选视图和导出入口已经形成闭环。",
          time: base + 123 * 60_000,
          stageKey: "finalize",
        },
      ],
      agentCrew: [
        {
          id: "demo-agent-data",
          name: "Data Agent",
          role: "manager",
          department: "Analytics",
          status: "done",
        },
      ],
      executor: {
        name: "GitHub Pages Demo",
        status: "completed",
        jobId: "demo-job-data-dashboard",
        lastEventType: "job.completed",
        lastEventAt: base + 125 * 60_000,
      },
      operatorState: "active",
      operatorActions: [],
      attempt: 1,
      createdAt: base + 82 * 60_000,
      updatedAt: base + 125 * 60_000,
      events: [
        {
          type: "done",
          message: "Data operations dashboard demo has been delivered.",
          progress: 100,
          level: "info",
          time: base + 125 * 60_000,
          stageKey: "finalize",
          source: "mission-core",
        },
      ],
    },
  ];
}

function hydrateGitHubPagesDemoTaskData(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState,
  options?: { preferredTaskId?: string | null }
) {
  const missions = createGitHubPagesDemoMissions().sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
  const summaries = missions.map(mission => buildSummaryRecord(mission));
  const selectedTaskId = resolveSelectedTaskId(
    summaries,
    get().selectedTaskId,
    options?.preferredTaskId
  );
  persistSelectedTaskId(selectedTaskId);

  const detailsById = Object.fromEntries(
    missions.map(mission => [
      mission.id,
      buildDetailRecord(mission, get().missionSocketConnected),
    ])
  ) as Record<string, MissionTaskDetail>;

  set({
    ready: true,
    loading: false,
    error: null,
    tasks: summaries,
    detailsById,
    selectedTaskId,
  });
}

/**
 * Build a MissionTaskDetail from the /api/planets/:id/interior response.
 * This is the planet-native counterpart of buildMissionDetailRecord —
 * it derives every field from MissionPlanetInteriorData + MissionRecord,
 * without touching WorkflowRecord at all.
 */
export function buildPlanetDetailRecord(
  planet: MissionPlanetOverviewItem,
  interior: MissionPlanetInteriorData,
  mission: MissionRecord,
  missionSocketConnected = false,
  summaryOverride?: MissionTaskSummary
): MissionTaskDetail {
  const summary = summaryOverride ?? buildPlanetSummaryRecord(planet, mission);
  const events = interior.events ?? [];

  // ── stages: MissionPlanetInteriorStage[] → TaskStageRing[] ──
  const stages: TaskStageRing[] = interior.stages.map(s => ({
    key: s.key,
    label: s.label,
    status: s.status,
    progress: s.progress,
    detail:
      s.detail ||
      (s.status === "done"
        ? "Completed"
        : s.status === "running"
          ? "Live stage"
          : s.status === "failed"
            ? "Blocked"
            : "Queued"),
    arcStart: s.arcStart,
    arcEnd: s.arcEnd,
    midAngle: s.midAngle,
  }));

  // ── agents: MissionPlanetInteriorAgent[] → TaskInteriorAgent[] ──
  const agents: TaskInteriorAgent[] = interior.agents.map(a => ({
    id: a.id,
    name: a.name,
    role: a.role,
    department:
      a.role === "orchestrator"
        ? "Mission"
        : capitalize(a.stageLabel || a.stageKey),
    title: a.currentAction || a.role,
    status: a.status as InteriorAgentStatus,
    stageKey: a.stageKey,
    stageLabel: a.stageLabel,
    progress: a.progress ?? null,
    currentAction: a.currentAction,
    angle: a.angle,
  }));

  // ── timeline from interior events ──
  const timeline = buildMissionTimeline(mission, events);

  // ── artifacts from mission ──
  const artifacts = dedupeArtifacts(buildMissionArtifacts(mission));

  // ── failure reasons ──
  const failureReasons = Array.from(
    new Set(missionFailureReasons(mission, events))
  );

  return {
    ...summary,
    workflow: syntheticWorkflowFromMission(mission),
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages,
    agents,
    timeline,
    artifacts,
    failureReasons,
    decisionPresets: buildMissionDecisionPresets(mission.decision),
    decisionPrompt: mission.decision?.prompt || null,
    decisionPlaceholder: mission.decision?.placeholder || null,
    decisionAllowsFreeText: mission.decision?.allowFreeText === true,
    decision: mission.decision ?? null,
    instanceInfo: buildMissionInstanceInfo(summary, mission),
    logSummary: buildMissionLogSummary(mission, events),
    runtimeChannels: buildRuntimeChannels(mission, missionSocketConnected),
    decisionHistory: mission.decisionHistory ?? [],
    operatorActions: mission.operatorActions ?? [],
    securitySummary: mission.securitySummary,
    executor: mission.executor,
    instance: mission.instance,
    previewSession: mission.previewSession,
    missionArtifacts: mission.artifacts,
  };
}

/* buildMissionDetailRecord — kept for backward compat, delegates to buildDetailRecord */
function buildMissionDetailRecord(
  mission: MissionRecord,
  missionSocketConnected = false,
  summaryOverride?: MissionTaskSummary
): MissionTaskDetail {
  const summary = summaryOverride ?? buildSummaryRecord(mission);
  const failureReasons = missionFailureReasons(mission, mission.events);

  return {
    ...summary,
    workflow: syntheticWorkflowFromMission(mission),
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: buildMissionInteriorStages(mission),
    agents: buildNativeInteriorAgents(mission),
    timeline: buildMissionTimeline(mission, mission.events),
    artifacts: dedupeArtifacts(buildMissionArtifacts(mission)),
    failureReasons,
    decisionPresets: buildMissionDecisionPresets(mission.decision),
    decisionPrompt: mission.decision?.prompt || null,
    decisionPlaceholder: mission.decision?.placeholder || null,
    decisionAllowsFreeText: mission.decision?.allowFreeText === true,
    decision: mission.decision ?? null,
    instanceInfo: buildMissionInstanceInfo(summary, mission),
    logSummary: buildNativeLogSummary(mission),
    runtimeChannels: buildRuntimeChannels(mission, missionSocketConnected),
    decisionHistory: mission.decisionHistory ?? [],
    operatorActions: mission.operatorActions ?? [],
    securitySummary: mission.securitySummary,
    executor: mission.executor,
    instance: mission.instance,
    previewSession: mission.previewSession,
    missionArtifacts: mission.artifacts,
  };
}

function queueTasksRefresh(options?: { preferredTaskId?: string | null }) {
  queuedRefreshOptions = {
    preferredTaskId:
      options?.preferredTaskId ?? queuedRefreshOptions?.preferredTaskId ?? null,
  };
  if (typeof window === "undefined") return;
  if (scheduledRefreshTimer !== null) {
    window.clearTimeout(scheduledRefreshTimer);
  }
  scheduledRefreshTimer = window.setTimeout(() => {
    scheduledRefreshTimer = null;
    const nextOptions = queuedRefreshOptions;
    queuedRefreshOptions = null;
    void useTasksStore.getState().refresh(nextOptions || undefined);
  }, 140);
}

function stopMissionSocket() {
  if (!missionSocket) return;
  missionSocket.off(MISSION_SOCKET_EVENT);
  missionSocket.disconnect();
  missionSocket = null;
}

function resolveSelectedTaskId(
  summaries: MissionTaskSummary[],
  currentSelectedTaskId: string | null,
  preferredTaskId?: string | null
): string | null {
  const candidateTaskIds = [
    preferredTaskId,
    currentSelectedTaskId,
    readPersistedSelectedTaskId(),
  ].filter(
    (taskId, index, allTaskIds): taskId is string =>
      Boolean(taskId) && allTaskIds.indexOf(taskId) === index
  );

  for (const taskId of candidateTaskIds) {
    if (summaries.some(summary => summary.id === taskId)) {
      return taskId;
    }
  }

  return pickFallbackTaskId(summaries);
}

export async function patchMissionRecordInStore(
  missionId: string,
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState
): Promise<void> {
  if (useAppStore.getState().runtimeMode !== "advanced") {
    return;
  }

  const missionResponse = await getMission(missionId);
  const summary = buildSummaryRecord(missionResponse.task);
  const detail = buildDetailRecord(
    missionResponse.task,
    get().missionSocketConnected
  );

  set(state => {
    const nextTasks = [
      ...state.tasks.filter(task => task.id !== missionId),
      summary,
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    const nextSelectedTaskId = resolveSelectedTaskId(
      nextTasks,
      state.selectedTaskId,
      state.selectedTaskId === missionId ? missionId : undefined
    );
    persistSelectedTaskId(nextSelectedTaskId);

    return {
      ready: true,
      loading: false,
      error: null,
      tasks: nextTasks,
      detailsById: {
        ...state.detailsById,
        [missionId]: detail,
      },
      selectedTaskId: nextSelectedTaskId,
    };
  });
}

function ensureMissionSocket(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState
) {
  if (typeof window === "undefined") {
    return;
  }

  if (useAppStore.getState().runtimeMode !== "advanced") {
    stopMissionSocket();
    return;
  }

  if (missionSocket) {
    return;
  }

  missionSocket = io(window.location.origin, {
    transports: ["websocket", "polling"],
  });

  // Initialize sandbox store for live log/screenshot streaming
  useSandboxStore.getState().initSocket(missionSocket);

  missionSocket.on("connect", () => {
    set(state => ({
      missionSocketConnected: true,
      detailsById: updateDetailsSocketConnection(state.detailsById, true),
    }));
    queueTasksRefresh({
      preferredTaskId: get().selectedTaskId,
    });
  });

  missionSocket.on(MISSION_SOCKET_EVENT, (payload: MissionSocketPayload) => {
    if (!payload || typeof payload !== "object" || !("type" in payload)) {
      return;
    }

    if (payload.type === "mission.snapshot") {
      queueTasksRefresh({
        preferredTaskId: get().selectedTaskId,
      });
      return;
    }

    if (!("missionId" in payload) || !payload.missionId) {
      return;
    }

    // Handle decision submitted: immediately update decisionHistory from the payload
    if (
      payload.type === MISSION_SOCKET_TYPES.decisionSubmitted &&
      "task" in payload &&
      payload.task
    ) {
      const mission = payload.task;
      const summary = buildSummaryRecord(mission);
      const detail = buildDetailRecord(mission, get().missionSocketConnected);

      set(state => {
        const nextTasks = [
          ...state.tasks.filter(t => t.id !== mission.id),
          summary,
        ].sort((a, b) => b.updatedAt - a.updatedAt);

        return {
          tasks: nextTasks,
          detailsById: {
            ...state.detailsById,
            [mission.id]: detail,
          },
        };
      });
      return;
    }

    if (payload.type === MISSION_SOCKET_TYPES.executorEvent) {
      const executorEvent = payload.event;
      set(state => {
        const detail = state.detailsById[payload.missionId];
        if (!detail) {
          return {};
        }

        return {
          detailsById: {
            ...state.detailsById,
            [payload.missionId]: {
              ...detail,
              lastSignal:
                trimText(
                  executorEvent.summary ||
                    executorEvent.detail ||
                    executorEvent.message,
                  180
                ) || detail.lastSignal,
              waitingFor: executorEvent.waitingFor || detail.waitingFor,
              runtimeChannels: applyExecutorEventToRuntimeChannels(
                detail.runtimeChannels,
                executorEvent
              ),
            },
          },
        };
      });
    }

    void patchMissionRecordInStore(payload.missionId, set, get).catch(error => {
      console.warn(
        `[Tasks] Failed to patch mission ${payload.missionId} from socket event:`,
        error
      );
      queueTasksRefresh({
        preferredTaskId: payload.missionId,
      });
    });
  });

  missionSocket.on("disconnect", () => {
    set(state => ({
      missionSocketConnected: false,
      detailsById: updateDetailsSocketConnection(state.detailsById, false),
    }));
    if (useAppStore.getState().runtimeMode !== "advanced") {
      stopMissionSocket();
    }
  });
}

function startTaskStoreWatchers() {
  if (taskStoreWatchersStarted) return;
  taskStoreWatchersStarted = true;

  useAppStore.subscribe((state, previousState) => {
    if (state.runtimeMode !== previousState.runtimeMode) {
      if (state.runtimeMode !== "advanced") {
        stopMissionSocket();
      }
      queueTasksRefresh();
    }
  });
}

/**
 * 任务数据加载入口。
 * Advanced Mode: 优先走 planet-native，失败时降级到 mission-native。
 * Frontend Mode: 走 mission-native。
 */
async function hydrateTaskData(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState,
  options?: { preferredTaskId?: string | null }
): Promise<void> {
  startTaskStoreWatchers();

  if (IS_GITHUB_PAGES) {
    hydrateGitHubPagesDemoTaskData(set, get, options);
    return;
  }

  if (useAppStore.getState().runtimeMode === "advanced") {
    try {
      await hydratePlanetTaskData(set, get, options);
      return;
    } catch (error) {
      console.warn(
        "[Tasks] Planet hydration failed, falling back to mission hydration:",
        error
      );
    }
  }

  // mission-native fallback  ensureMissionSocket(set, get);

  const missionsResponse = await listMissions(200);
  const missions = [...missionsResponse.tasks].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );

  // 加载每个 mission 的事件，用于 timeline 和 failure reasons
  const eventsEntries = await Promise.all(
    missions.map(async mission => {
      try {
        const response = await listMissionEvents(mission.id, 60);
        return [mission.id, response.events] as const;
      } catch (error) {
        console.warn(
          `[Tasks] Failed to load mission events for ${mission.id}:`,
          error
        );
        return [mission.id, mission.events || []] as const;
      }
    })
  );
  const missionEvents = Object.fromEntries(eventsEntries) as Record<
    string,
    MissionEvent[]
  >;

  // 将事件注入 mission record 以便 buildSummaryRecord/buildDetailRecord 使用
  const enrichedMissions = missions.map(mission => ({
    ...mission,
    events: missionEvents[mission.id] || mission.events || [],
  }));

  const summaries = enrichedMissions
    .map(mission => buildSummaryRecord(mission))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const selectedTaskId = resolveSelectedTaskId(
    summaries,
    get().selectedTaskId,
    options?.preferredTaskId
  );
  persistSelectedTaskId(selectedTaskId);

  const detailsById = Object.fromEntries(
    enrichedMissions.map(mission => [
      mission.id,
      buildDetailRecord(mission, get().missionSocketConnected),
    ])
  ) as Record<string, MissionTaskDetail>;

  set({
    ready: true,
    loading: false,
    error: null,
    tasks: summaries,
    detailsById,
    selectedTaskId,
  });
}

/**
 * Planet-native hydration: uses /api/planets endpoints.
 */
async function hydratePlanetTaskData(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState,
  options?: { preferredTaskId?: string | null }
): Promise<void> {
  ensureMissionSocket(set, get);

  const [planetsResponse, missionsResponse] = await Promise.all([
    listPlanets(200),
    listMissions(200),
  ]);

  const planets = planetsResponse.planets;
  const missionById = new Map<string, MissionRecord>(
    missionsResponse.tasks.map((m: MissionRecord) => [m.id, m])
  );

  const summaries = planets
    .map((planet: MissionPlanetOverviewItem) =>
      buildPlanetSummaryRecord(planet, missionById.get(planet.id))
    )
    .sort(
      (left: MissionTaskSummary, right: MissionTaskSummary) =>
        right.updatedAt - left.updatedAt
    );

  const selectedTaskId = resolveSelectedTaskId(
    summaries,
    get().selectedTaskId,
    options?.preferredTaskId
  );
  persistSelectedTaskId(selectedTaskId);

  const summaryById = new Map<string, MissionTaskSummary>(
    summaries.map(summary => [summary.id, summary])
  );
  const detailsById: Record<string, MissionTaskDetail> = {};
  for (const planet of planets) {
    const mission = missionById.get(planet.id);
    if (!mission) continue;
    const summary = summaryById.get(planet.id);

    if (planet.id === selectedTaskId) {
      try {
        const interiorResponse = await getPlanetInterior(planet.id);
        detailsById[planet.id] = buildPlanetDetailRecord(
          planet,
          interiorResponse.interior,
          mission,
          get().missionSocketConnected,
          summary
        );
      } catch {
        detailsById[planet.id] = buildMissionDetailRecord(
          mission,
          get().missionSocketConnected,
          summary
        );
      }
    } else {
      detailsById[planet.id] = buildMissionDetailRecord(
        mission,
        get().missionSocketConnected,
        summary
      );
    }
  }

  set({
    ready: true,
    loading: false,
    error: null,
    tasks: summaries,
    detailsById,
    selectedTaskId,
  });
}

export const useTasksStore = create<TasksStoreState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,
  missionSocketConnected: false,
  selectedTaskId: null,
  tasks: [],
  detailsById: {},
  decisionNotes: {},
  cancellingMissionIds: {},
  operatorActionLoadingByMissionId: {},
  lastDecisionLaunch: null,

  ensureReady: async () => {
    if (get().ready || inFlightRefresh) {
      if (inFlightRefresh) {
        await inFlightRefresh;
      }
      return;
    }

    set({ loading: true, error: null });
    inFlightRefresh = hydrateTaskData(set, get);
    try {
      await inFlightRefresh;
    } catch (error) {
      console.error("[Tasks] Failed to initialize tasks store:", error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load tasks.",
      });
    } finally {
      inFlightRefresh = null;
      if (queuedRefreshOptions) {
        const nextOptions = queuedRefreshOptions;
        queuedRefreshOptions = null;
        void get().refresh(nextOptions);
      }
    }
  },

  refresh: async options => {
    if (inFlightRefresh) {
      queuedRefreshOptions = {
        preferredTaskId:
          options?.preferredTaskId ??
          queuedRefreshOptions?.preferredTaskId ??
          null,
      };
      await inFlightRefresh;
      return;
    }

    set(state => ({
      loading: !state.ready && state.tasks.length === 0,
      error: null,
    }));

    inFlightRefresh = hydrateTaskData(set, get, options);
    try {
      await inFlightRefresh;
    } catch (error) {
      console.error("[Tasks] Failed to refresh tasks store:", error);
      set({
        loading: false,
        error:
          error instanceof Error ? error.message : "Failed to refresh tasks.",
      });
    } finally {
      inFlightRefresh = null;
      if (queuedRefreshOptions) {
        const nextOptions = queuedRefreshOptions;
        queuedRefreshOptions = null;
        void get().refresh(nextOptions);
      }
    }
  },

  selectTask: taskId => {
    persistSelectedTaskId(taskId);
    set({ selectedTaskId: taskId });
  },

  createMission: async input => {
    if (useAppStore.getState().runtimeMode !== "advanced") {
      set({
        error: "Mission creation is only available in advanced runtime mode.",
      });
      return null;
    }

    const response = await createMissionRequest({
      ...input,
      projectId: input.projectId ?? undefined,
    });
    await get().refresh({
      preferredTaskId: response.task.id,
    });
    return response.task.id;
  },

  cancelMission: async (taskId, payload) => {
    await get().ensureReady();

    set(state => ({
      error: null,
      cancellingMissionIds: {
        ...state.cancellingMissionIds,
        [taskId]: true,
      },
    }));

    try {
      const response = await cancelMissionRequest(taskId, {
        reason: payload.reason?.trim() || undefined,
        requestedBy: payload.requestedBy?.trim() || undefined,
        source: payload.source ?? "user",
      });

      const summary = buildSummaryRecord(response.task);
      const detail = buildDetailRecord(
        response.task,
        get().missionSocketConnected
      );

      set(state => {
        const nextTasks = [
          ...state.tasks.filter(task => task.id !== taskId),
          summary,
        ].sort((left, right) => right.updatedAt - left.updatedAt);
        const nextSelectedTaskId = resolveSelectedTaskId(
          nextTasks,
          state.selectedTaskId,
          taskId
        );
        persistSelectedTaskId(nextSelectedTaskId);

        return {
          tasks: nextTasks,
          detailsById: {
            ...state.detailsById,
            [taskId]: detail,
          },
          selectedTaskId: nextSelectedTaskId,
        };
      });

      return response.task.id;
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to cancel mission.",
      });
      throw error;
    } finally {
      set(state => ({
        cancellingMissionIds: {
          ...state.cancellingMissionIds,
          [taskId]: false,
        },
      }));
    }
  },

  submitOperatorAction: async (taskId, payload) => {
    await get().ensureReady();

    set(state => ({
      error: null,
      operatorActionLoadingByMissionId: {
        ...state.operatorActionLoadingByMissionId,
        [taskId]: {
          ...(state.operatorActionLoadingByMissionId[taskId] ?? {}),
          [payload.action]: true,
        },
      },
    }));

    try {
      const response = await submitMissionOperatorActionRequest(taskId, {
        action: payload.action,
        reason: payload.reason?.trim() || undefined,
        requestedBy: payload.requestedBy?.trim() || undefined,
      });

      const summary = buildSummaryRecord(response.task);
      const detail = buildDetailRecord(
        response.task,
        get().missionSocketConnected
      );

      set(state => {
        const nextTasks = [
          ...state.tasks.filter(task => task.id !== taskId),
          summary,
        ].sort((left, right) => right.updatedAt - left.updatedAt);
        const nextSelectedTaskId = resolveSelectedTaskId(
          nextTasks,
          state.selectedTaskId,
          taskId
        );
        persistSelectedTaskId(nextSelectedTaskId);

        return {
          tasks: nextTasks,
          detailsById: {
            ...state.detailsById,
            [taskId]: detail,
          },
          selectedTaskId: nextSelectedTaskId,
        };
      });

      return response.task.id;
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to submit mission operator action.",
      });
      throw error;
    } finally {
      set(state => ({
        operatorActionLoadingByMissionId: {
          ...state.operatorActionLoadingByMissionId,
          [taskId]: {
            ...(state.operatorActionLoadingByMissionId[taskId] ?? {}),
            [payload.action]: false,
          },
        },
      }));
    }
  },

  setDecisionNote: (taskId, note) => {
    set(state => ({
      decisionNotes: {
        ...state.decisionNotes,
        [taskId]: note,
      },
    }));
  },

  launchDecision: async (taskId, presetId) => {
    await get().ensureReady();
    const detail = get().detailsById[taskId];
    const preset = detail?.decisionPresets.find(item => item.id === presetId);
    if (!detail || !preset) return null;

    const note = get().decisionNotes[taskId]?.trim();

    if (!preset.optionId && detail.decisionAllowsFreeText !== true) {
      set({
        error: "This mission decision requires a configured option.",
      });
      return null;
    }

    if (!preset.optionId && detail.decisionAllowsFreeText && !note) {
      set({
        error: "Add a note before submitting this mission decision.",
      });
      return null;
    }

    const response = await submitMissionDecisionRequest(taskId, {
      optionId: preset.optionId,
      freeText: detail.decisionAllowsFreeText ? note || undefined : undefined,
      detail: detail.decisionAllowsFreeText !== true && note ? note : undefined,
    });

    set(state => ({
      error: null,
      decisionNotes: {
        ...state.decisionNotes,
        [taskId]: "",
      },
      lastDecisionLaunch: {
        sourceTaskId: taskId,
        sourceTaskTitle: detail.title,
        spawnedWorkflowId: null,
        at: Date.now(),
      },
    }));

    try {
      await patchMissionRecordInStore(taskId, set, get);
    } catch (error) {
      console.warn(
        `[Tasks] Failed to patch mission ${taskId} after decision submit:`,
        error
      );
      await get().refresh({
        preferredTaskId: response.task.id || taskId,
      });
    }

    return response.task.id;
  },

  clearDecisionLaunch: () => {
    set({ lastDecisionLaunch: null });
  },
}));
