/**
 * Node -> Python delegation seam for the POST /api/executor/events
 * event->action projection (slide-rule-python routes/executor_events.py,
 * services/executor_event_projection.py).
 *
 * Flag: EXECUTOR_EVENTS_PYTHON_PROJECTION (default ON via the
 * isVitestEnvironment guard pattern from server/routes/blueprint.ts /
 * python-thin-proxy.ts: explicit "false" opts out, unset stays off under
 * vitest so unit suites keep the Node path).
 *
 * Scope: STATE-CHANGING callback events only (job.started / job.progress /
 * job.waiting / job.completed / job.failed / job.cancelled, plus the
 * status-based fallbacks for job.accepted / job.heartbeat / unknown types).
 * High-frequency streaming events (job.log, job.log_stream, job.screenshot)
 * are NEVER delegated — the Socket.IO passthrough must not gain an HTTP hop.
 *
 * Node keeps: HMAC verification, heartbeatMonitor reset, missionRuntime
 * writes, artifact/instance normalization and Socket.IO emits. Python owns
 * the action decision (which runtime transition + fallback texts). On any
 * infra failure or invalid projection envelope this seam reports
 * "not handled" and the caller falls back to the existing inline mapper, so
 * behavior stays byte-identical with the flag off or Python down.
 */

import {
  delegateToPythonThinProxy,
  isPythonThinProxyEnabled,
  type PythonThinProxyTarget,
} from "./python-thin-proxy.js";

export const EXECUTOR_EVENTS_PYTHON_PROJECTION_FLAG =
  "EXECUTOR_EVENTS_PYTHON_PROJECTION";

export const EXECUTOR_EVENTS_PROJECT_ENDPOINT = "/api/executor/events/project";

export function isExecutorEventsPythonProjectionEnabled(): boolean {
  return isPythonThinProxyEnabled(EXECUTOR_EVENTS_PYTHON_PROJECTION_FLAG, {
    defaultEnabled: true,
  });
}

const STATE_CHANGING_EVENT_TYPES = new Set([
  "job.started",
  "job.progress",
  "job.waiting",
  "job.completed",
  "job.failed",
  "job.cancelled",
]);

const STREAMING_EVENT_TYPES = new Set([
  "job.log",
  "job.log_stream",
  "job.screenshot",
]);

const STATE_CHANGING_FALLBACK_STATUSES = new Set([
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * True when the inline route would take a mission state-changing branch for
 * this event. Streaming events are never state-changing here, regardless of
 * status, because the inline handler matches their type first.
 */
export function isStateChangingExecutorCallbackEvent(
  type: string | undefined,
  status?: string,
): boolean {
  const normalizedType = type?.trim() || "";
  if (STATE_CHANGING_EVENT_TYPES.has(normalizedType)) return true;
  if (STREAMING_EVENT_TYPES.has(normalizedType)) return false;
  return STATE_CHANGING_FALLBACK_STATUSES.has(status?.trim() || "");
}

// ── Wire types ───────────────────────────────────────────────────────────────

/** Minimal callback event fields forwarded to the Python projection. */
export interface ExecutorProjectionEventInput {
  version?: string;
  eventId?: string;
  missionId?: string;
  jobId?: string;
  executor?: string;
  type?: string;
  status?: string;
  occurredAt?: string;
  stageKey?: string;
  progress?: number;
  message?: string;
  detail?: string;
  summary?: string;
  errorCode?: string;
  waitingFor?: string;
  log?: { level?: "info" | "warn" | "error"; message?: string };
  delivery?: unknown;
}

export interface ExecutorProjectionMissionContext {
  currentProgress: number;
  stageLabel: string;
}

const APPLY_KINDS = [
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
] as const;

export type PythonExecutorApplyKind = (typeof APPLY_KINDS)[number];

export interface PythonExecutorApplyPlan {
  kind: PythonExecutorApplyKind;
  progress: number;
  detail: string;
  waitingFor?: string;
  message?: string;
  error?: string;
  reason?: string;
}

export interface ExecutorEventProjectionDelegated {
  delegated: true;
  apply: PythonExecutorApplyPlan;
  /** Pure mapper action / routing verdict from Python (provenance only). */
  action?: unknown;
  routing?: unknown;
}

export interface ExecutorEventProjectionUnavailable {
  delegated: false;
  reason: string;
}

export type ExecutorEventProjectionResult =
  | ExecutorEventProjectionDelegated
  | ExecutorEventProjectionUnavailable;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseApplyPlan(value: unknown): PythonExecutorApplyPlan | null {
  if (!isPlainRecord(value)) return null;
  const kind = value.kind;
  if (
    typeof kind !== "string" ||
    !(APPLY_KINDS as readonly string[]).includes(kind)
  ) {
    return null;
  }
  if (typeof value.progress !== "number" || !Number.isFinite(value.progress)) {
    return null;
  }
  if (typeof value.detail !== "string" || value.detail.length === 0) {
    return null;
  }
  const optionalString = (field: unknown): string | undefined =>
    typeof field === "string" && field.length > 0 ? field : undefined;
  return {
    kind: kind as PythonExecutorApplyKind,
    progress: value.progress,
    detail: value.detail,
    waitingFor: optionalString(value.waitingFor),
    message: optionalString(value.message),
    error: optionalString(value.error),
    reason: optionalString(value.reason),
  };
}

export async function projectExecutorEventViaPython(input: {
  event: ExecutorProjectionEventInput;
  mission: ExecutorProjectionMissionContext;
  fetchImpl?: typeof fetch;
  target?: PythonThinProxyTarget;
}): Promise<ExecutorEventProjectionResult> {
  const result = await delegateToPythonThinProxy({
    endpoint: EXECUTOR_EVENTS_PROJECT_ENDPOINT,
    method: "POST",
    payload: { event: input.event, mission: input.mission },
    fetchImpl: input.fetchImpl,
    target: input.target,
  });
  if (!result.delegated) {
    return { delegated: false, reason: result.reason };
  }
  if (result.status !== 200) {
    // Business 4xx from Python (fail-closed envelope) means the delivery was
    // rejected there; the Node inline mapper stays the source of behavior.
    return { delegated: false, reason: `python http ${result.status}` };
  }
  const body = result.body;
  if (!isPlainRecord(body) || body.ok !== true) {
    return { delegated: false, reason: "python projection envelope not ok" };
  }
  const apply = parseApplyPlan(body.apply);
  if (!apply) {
    return {
      delegated: false,
      reason: "python projection returned an invalid apply plan",
    };
  }
  return { delegated: true, apply, action: body.action, routing: body.routing };
}

// ── Apply (existing runtime calls, decision from Python) ────────────────────

export interface ExecutorProjectionApplyContext {
  missionId: string;
  stageKey: string;
  executorName: string;
  /** Node-normalized MissionDecision (normalizeExecutorDecision), opaque here. */
  decision?: unknown;
}

export interface ExecutorProjectionApplyDeps {
  markMissionRunning(
    missionId: string,
    stageKey: string,
    detail: string,
    progress: number,
    source: "executor",
  ): void;
  waitOnMission(
    missionId: string,
    waitingFor: string,
    detail: string,
    progress: number,
    decision: unknown,
    source: "executor",
  ): void;
  finishMission(missionId: string, summary: string, source: "executor"): void;
  failMission(missionId: string, error: string, source: "executor"): void;
  cancelMission(
    missionId: string,
    input: { reason: string; requestedBy: string; source: "executor" },
  ): void;
  clearHeartbeat(missionId: string): void;
}

/**
 * Applies a Python-projected action through the same runtime calls the inline
 * handler performs (markMissionRunning first on every branch; terminal kinds
 * clear the heartbeat).
 */
export function applyPythonProjectedExecutorAction(
  apply: PythonExecutorApplyPlan,
  ctx: ExecutorProjectionApplyContext,
  deps: ExecutorProjectionApplyDeps,
): void {
  deps.markMissionRunning(
    ctx.missionId,
    ctx.stageKey,
    apply.detail,
    apply.progress,
    "executor",
  );
  if (apply.kind === "waiting") {
    deps.waitOnMission(
      ctx.missionId,
      apply.waitingFor || apply.detail,
      apply.detail,
      apply.progress,
      ctx.decision,
      "executor",
    );
  } else if (apply.kind === "done") {
    deps.finishMission(ctx.missionId, apply.message || apply.detail, "executor");
  } else if (apply.kind === "failed") {
    deps.failMission(ctx.missionId, apply.error || apply.detail, "executor");
  } else if (apply.kind === "cancelled") {
    deps.cancelMission(ctx.missionId, {
      reason: apply.reason || apply.detail,
      requestedBy: ctx.executorName,
      source: "executor",
    });
  }
  if (
    apply.kind === "done" ||
    apply.kind === "failed" ||
    apply.kind === "cancelled"
  ) {
    deps.clearHeartbeat(ctx.missionId);
  }
}

/**
 * Full delegation attempt for one callback event: flag check, state-changing
 * predicate, Python projection, validation and runtime apply.
 *
 * Returns true when the event was fully handled through the Python decision;
 * false means the caller must run the existing inline mapper path (flag off,
 * streaming/non-state-changing event, or Python infra failure).
 */
export async function runExecutorEventPythonProjection(input: {
  event: ExecutorProjectionEventInput;
  mission: ExecutorProjectionMissionContext;
  ctx: ExecutorProjectionApplyContext;
  deps: ExecutorProjectionApplyDeps;
  fetchImpl?: typeof fetch;
  target?: PythonThinProxyTarget;
}): Promise<boolean> {
  if (!isExecutorEventsPythonProjectionEnabled()) return false;
  if (!isStateChangingExecutorCallbackEvent(input.event.type, input.event.status)) {
    return false;
  }
  const projection = await projectExecutorEventViaPython({
    event: input.event,
    mission: input.mission,
    fetchImpl: input.fetchImpl,
    target: input.target,
  });
  if (!projection.delegated) return false;
  applyPythonProjectedExecutorAction(projection.apply, input.ctx, input.deps);
  return true;
}
