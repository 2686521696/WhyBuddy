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
 * writes, instance normalization and Socket.IO emits. Python owns
 * the action decision (which runtime transition + fallback texts). On any
 * infra failure or invalid projection envelope this seam reports
 * "not handled" and the caller falls back to the existing inline mapper, so
 * behavior stays byte-identical with the flag off or Python down.
 *
 * Slice 2 additions:
 *
 * - Dedup landing (EXECUTOR_EVENTS_DEDUP_ENFORCED, default OFF, explicit
 *   "true" only): when Python returns a duplicate/out-of-order verdict for a
 *   state-changing delivery, Node skips applying the action (and logs the
 *   skip) instead of replaying it into the mission runtime. This is a
 *   deliberate behavior change vs today's inline route (which never consults
 *   event.delivery — a documented gap), hence its own opt-in flag. It only
 *   takes effect when the Python projection actually handled the event.
 * - Artifacts normalization: the Python projection response may carry an
 *   `artifacts` array (index.ts normalizeExecutorArtifacts port hardened
 *   with the artifact-utils.ts traversal guard). When present and valid it
 *   is consumed instead of the Node-side normalization; otherwise the caller
 *   keeps its own normalization (same fallback discipline as the action).
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

/**
 * Dedup landing flag (slice 2). Default OFF everywhere — skipping duplicate /
 * out-of-order state-changing deliveries is a behavior change vs the historic
 * inline route (which never checked delivery.duplicate), so it must be
 * explicitly opted into with "true". Flipping the default is a later decision.
 */
export const EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG =
  "EXECUTOR_EVENTS_DEDUP_ENFORCED";

export function isExecutorEventsDedupEnforcementEnabled(): boolean {
  return process.env[EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG] === "true";
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
  /** Raw ExecutionPlanArtifact[] from the callback (normalized by Python). */
  artifacts?: unknown;
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

/** Dedup verdict surfaced by the Python projection envelope. */
export interface PythonExecutorDedupVerdict {
  duplicate: boolean;
  reason?: string;
}

/** MissionArtifact-shaped record normalized by the Python projection. */
export interface PythonNormalizedExecutorArtifact {
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

export interface ExecutorEventProjectionDelegated {
  delegated: true;
  apply: PythonExecutorApplyPlan;
  /** Pure mapper action / routing verdict from Python (provenance only). */
  action?: unknown;
  routing?: unknown;
  /** Dedup verdict (consumed only when EXECUTOR_EVENTS_DEDUP_ENFORCED). */
  dedup: PythonExecutorDedupVerdict;
  /**
   * True when Python claimed the artifacts decision (the delivery carried an
   * artifacts array and every returned entry validated). False keeps the
   * Node-side normalization (fallback discipline).
   */
  artifactsProvided: boolean;
  /**
   * Normalized artifacts (present only when artifactsProvided). An empty
   * Python list collapses to undefined, mirroring Node's
   * `normalized.length > 0 ? normalized : undefined`.
   */
  artifacts?: PythonNormalizedExecutorArtifact[];
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

const ARTIFACT_KINDS = new Set(["file", "report", "url", "log"]);
const ARTIFACT_PREVIEW_TYPES = new Set([
  "text",
  "json",
  "html",
  "pdf",
  "image",
  "log",
]);

function parseOptionalArtifactString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseNormalizedArtifact(
  value: unknown,
): PythonNormalizedExecutorArtifact | null {
  if (!isPlainRecord(value)) return null;
  const kind = value.kind;
  if (typeof kind !== "string" || !ARTIFACT_KINDS.has(kind)) return null;
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return null;
  }
  const path = parseOptionalArtifactString(value.path);
  // Defense in depth: re-check the traversal guard Node applies when serving
  // artifact content (artifact-utils.ts validateArtifactPath).
  if (path !== undefined && path.includes("..")) return null;
  const previewType =
    typeof value.previewType === "string" &&
    ARTIFACT_PREVIEW_TYPES.has(value.previewType)
      ? (value.previewType as PythonNormalizedExecutorArtifact["previewType"])
      : undefined;
  const size =
    typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
      ? value.size
      : undefined;
  return {
    kind: kind as PythonNormalizedExecutorArtifact["kind"],
    id: parseOptionalArtifactString(value.id),
    name: value.name,
    path,
    url: parseOptionalArtifactString(value.url),
    mimeType: parseOptionalArtifactString(value.mimeType),
    previewType,
    size,
    description: parseOptionalArtifactString(value.description),
  };
}

/**
 * Parses the optional `artifacts` field of the projection envelope. Any
 * invalid entry rejects the whole decision (the caller keeps its own
 * normalization), never a partial list — same fail-closed posture as the
 * apply plan.
 */
function parseNormalizedArtifacts(value: unknown): {
  provided: boolean;
  artifacts?: PythonNormalizedExecutorArtifact[];
} {
  if (value === undefined || value === null) return { provided: false };
  if (!Array.isArray(value)) return { provided: false };
  const parsed: PythonNormalizedExecutorArtifact[] = [];
  for (const entry of value) {
    const artifact = parseNormalizedArtifact(entry);
    if (!artifact) return { provided: false };
    parsed.push(artifact);
  }
  // Node collapses an empty normalized list to undefined before patching.
  return { provided: true, artifacts: parsed.length > 0 ? parsed : undefined };
}

function parseDedupVerdict(body: Record<string, unknown>): PythonExecutorDedupVerdict {
  const dedup = body.dedup;
  if (isPlainRecord(dedup) && typeof dedup.duplicate === "boolean") {
    return {
      duplicate: dedup.duplicate,
      reason: typeof dedup.reason === "string" ? dedup.reason : undefined,
    };
  }
  // Older Python envelopes: fall back to the pure mapper verdict.
  const action = body.action;
  if (isPlainRecord(action) && action.action === "duplicate") {
    return {
      duplicate: true,
      reason: typeof action.reason === "string" ? action.reason : undefined,
    };
  }
  return { duplicate: false };
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
  const { provided: artifactsProvided, artifacts } = parseNormalizedArtifacts(
    body.artifacts,
  );
  return {
    delegated: true,
    apply,
    action: body.action,
    routing: body.routing,
    dedup: parseDedupVerdict(body),
    artifactsProvided,
    artifacts,
  };
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
 * Flag check + state-changing predicate + Python projection in one step.
 * Returns the delegated projection, or null when the caller must stay on the
 * Node inline path (flag off, streaming/non-state-changing event, or Python
 * infra failure / invalid envelope).
 */
export async function maybeProjectExecutorEventViaPython(input: {
  event: ExecutorProjectionEventInput;
  mission: ExecutorProjectionMissionContext;
  fetchImpl?: typeof fetch;
  target?: PythonThinProxyTarget;
}): Promise<ExecutorEventProjectionDelegated | null> {
  if (!isExecutorEventsPythonProjectionEnabled()) return null;
  if (!isStateChangingExecutorCallbackEvent(input.event.type, input.event.status)) {
    return null;
  }
  const projection = await projectExecutorEventViaPython(input);
  return projection.delegated ? projection : null;
}

/**
 * Applies a delegated projection, honoring the opt-in dedup enforcement:
 * with EXECUTOR_EVENTS_DEDUP_ENFORCED=true a duplicate / out-of-order verdict
 * skips the runtime apply entirely (logged), blocking replayed terminal
 * events from re-landing. With the flag off (default), the apply proceeds
 * exactly as before — byte-identical to today's behavior.
 */
export function applyOrSkipProjectedExecutorAction(
  projection: ExecutorEventProjectionDelegated,
  ctx: ExecutorProjectionApplyContext,
  deps: ExecutorProjectionApplyDeps,
): "applied" | "skipped-duplicate" {
  if (isExecutorEventsDedupEnforcementEnabled() && projection.dedup.duplicate) {
    console.warn(
      `[executor-events] ${EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG}: skipping ${
        projection.dedup.reason ?? "duplicate"
      } delivery for mission ${ctx.missionId} (python dedup verdict; action not applied)`,
    );
    return "skipped-duplicate";
  }
  applyPythonProjectedExecutorAction(projection.apply, ctx, deps);
  return "applied";
}

/**
 * Full delegation attempt for one callback event: flag check, state-changing
 * predicate, Python projection, validation and runtime apply (or dedup skip).
 *
 * Returns true when the event was fully handled through the Python decision
 * (applied, or skipped by dedup enforcement); false means the caller must run
 * the existing inline mapper path (flag off, streaming/non-state-changing
 * event, or Python infra failure).
 */
export async function runExecutorEventPythonProjection(input: {
  event: ExecutorProjectionEventInput;
  mission: ExecutorProjectionMissionContext;
  ctx: ExecutorProjectionApplyContext;
  deps: ExecutorProjectionApplyDeps;
  fetchImpl?: typeof fetch;
  target?: PythonThinProxyTarget;
}): Promise<boolean> {
  const projection = await maybeProjectExecutorEventViaPython({
    event: input.event,
    mission: input.mission,
    fetchImpl: input.fetchImpl,
    target: input.target,
  });
  if (!projection) return false;
  applyOrSkipProjectedExecutorAction(projection, input.ctx, input.deps);
  return true;
}
