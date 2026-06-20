/**
 * executor-event-mapper.ts — Pure mapping from ExecutorEvent types to Mission state actions.
 *
 * Extracted from the `/api/executor/events` route handler to enable property-based testing.
 * The mapping is mode-agnostic: mock and real events follow the same rules.
 */

import type { ExecutorEventType } from "../../shared/executor/contracts.js";

// ─── Result Types ───────────────────────────────────────────────────────────

export type EventMappingResult =
  | { action: "running"; progress: number }
  | { action: "done"; summary: string }
  | { action: "failed"; error: string }
  | { action: "cancelled"; reason: string }
  | { action: "progress"; progress: number }
  | { action: "log"; message: string }
  | { action: "log_stream" }
  | { action: "screenshot" }
  | { action: "waiting" }
  | { action: "duplicate"; reason: "duplicate" | "out_of_order" }
  | { action: "unknown" };

// ─── Input ──────────────────────────────────────────────────────────────────

export interface ExecutorCallbackDelivery {
  sequence?: number;
  attempt?: number;
  duplicate?: boolean;
  outOfOrder?: boolean;
}

export interface EventMappingInput {
  type: ExecutorEventType | string;
  status?: string;
  progress?: number;
  summary?: string;
  message?: string;
  detail?: string;
  errorCode?: string;
  log?: { level: string; message: string };
  delivery?: ExecutorCallbackDelivery;
  callbackSource?: "node" | "python";
}

export interface NormalizedPythonExecutorCallbackEvent extends EventMappingInput {
  version: string;
  eventId: string;
  missionId: string;
  jobId: string;
  executor: string;
  type: ExecutorEventType | string;
  status: string;
  occurredAt: string;
  message: string;
  progress?: number;
}

function stringField(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Python executor callback event must include ${fieldName}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeCallbackDelivery(value: unknown): ExecutorCallbackDelivery | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    sequence: optionalNumber(record.sequence),
    attempt: optionalNumber(record.attempt),
    duplicate: record.duplicate === true,
    outOfOrder: record.outOfOrder === true,
  };
}

export function normalizePythonExecutorCallbackEvent(
  value: Record<string, unknown>,
): NormalizedPythonExecutorCallbackEvent {
  return {
    version: stringField(value.version, "version"),
    eventId: stringField(value.eventId, "eventId"),
    missionId: stringField(value.missionId, "missionId"),
    jobId: stringField(value.jobId, "jobId"),
    executor: stringField(value.executor, "executor"),
    type: stringField(value.type, "type"),
    status: stringField(value.status, "status"),
    occurredAt: stringField(value.occurredAt, "occurredAt"),
    message: typeof value.message === "string" ? value.message : "",
    progress: optionalNumber(value.progress),
    summary: optionalString(value.summary),
    detail: optionalString(value.detail),
    errorCode: optionalString(value.errorCode),
    log:
      value.log && typeof value.log === "object"
        ? {
            level: optionalString((value.log as Record<string, unknown>).level) || "info",
            message: optionalString((value.log as Record<string, unknown>).message) || "",
          }
        : undefined,
    delivery: normalizeCallbackDelivery(value.delivery),
    callbackSource: "python",
  };
}

// ─── Pure Mapping Function ──────────────────────────────────────────────────

/**
 * Maps an executor event to the corresponding Mission state action.
 *
 * Rules (from Requirements 4.1–4.6, 7.4):
 * - job.started  → action "running"
 * - job.progress → action "progress" with clamped progress (0–100)
 * - job.completed → action "done"
 * - job.failed → action "failed"
 * - job.cancelled → action "cancelled"
 * - job.log → action "log"
 * - job.log_stream → action "log_stream"
 * - job.screenshot → action "screenshot"
 * - job.waiting → action "waiting"
 * - anything else → action "unknown"
 *
 * Progress clamping: if event.progress is a number, clamp to [0, 100].
 * If not a number, default to 0.
 */
export function mapExecutorEventToAction(
  input: EventMappingInput,
): EventMappingResult {
  if (input.delivery?.duplicate === true) {
    return { action: "duplicate", reason: "duplicate" };
  }
  if (input.delivery?.outOfOrder === true) {
    return { action: "duplicate", reason: "out_of_order" };
  }

  const clampedProgress =
    typeof input.progress === "number"
      ? Math.max(0, Math.min(100, input.progress))
      : 0;

  const summaryText =
    input.summary?.trim() || input.detail?.trim() || input.message?.trim() || "";

  switch (input.type) {
    case "job.started":
      return { action: "running", progress: clampedProgress };

    case "job.progress":
      return { action: "progress", progress: clampedProgress };

    case "job.completed":
      return { action: "done", summary: summaryText };

    case "job.failed":
      return { action: "failed", error: summaryText || input.errorCode || "unknown error" };

    case "job.cancelled":
      return { action: "cancelled", reason: summaryText || input.errorCode || "cancelled" };

    case "job.log":
      return { action: "log", message: input.log?.message?.trim() || summaryText };

    case "job.log_stream":
      return { action: "log_stream" };

    case "job.screenshot":
      return { action: "screenshot" };

    case "job.waiting":
      return { action: "waiting" };

    default:
      // Also handle status-based fallback (job.accepted, job.heartbeat, etc.)
      if (input.status === "completed") {
        return { action: "done", summary: summaryText };
      }
      if (input.status === "failed") {
        return { action: "failed", error: summaryText || "unknown error" };
      }
      if (input.status === "cancelled") {
        return { action: "cancelled", reason: summaryText || "cancelled" };
      }
      if (input.status === "waiting") {
        return { action: "waiting" };
      }
      return { action: "unknown" };
  }
}
