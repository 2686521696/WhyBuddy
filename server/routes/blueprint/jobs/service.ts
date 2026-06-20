import type {
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
  BlueprintGenerationRequest,
  BlueprintGenerationStage,
  BlueprintGenerationStatus,
} from "../../../../shared/blueprint/index.js";
import type {
  BlueprintJobRuntimeAction,
  BlueprintJobRuntimeResult,
  BlueprintJobRuntimeSnapshot,
} from "../../../../shared/blueprint/jobs/types.js";

import type { BlueprintServiceContext } from "../context.js";

export interface BlueprintJobRuntimeStartInput {
  id: string;
  request?: Partial<BlueprintGenerationRequest>;
  stage?: BlueprintGenerationStage;
  projectId?: string;
  sourceId?: string;
  version?: string;
  createdAt?: string;
  now?: string;
}

export interface JobService {
  listJobs(): BlueprintGenerationJob[];
  getJob(jobId: string): BlueprintGenerationJob | null;
  getLatestJob(options?: { projectId?: string }): BlueprintGenerationJob | null;
  emitJobEvent(event: BlueprintGenerationEvent): void;
  startJob(input: BlueprintJobRuntimeStartInput): Promise<BlueprintJobRuntimeResult>;
  getJobStatus(jobId: string): Promise<BlueprintJobRuntimeResult>;
  cancelJob(
    jobId: string,
    options?: { reason?: string; now?: string },
  ): Promise<BlueprintJobRuntimeResult>;
  readJob(jobId: string): Promise<BlueprintJobRuntimeResult>;
}

const CONTRACT_VERSION = "blueprint.job-runtime.proxy.v1";
const PYTHON_PROXY_ENABLED = "BLUEPRINT_JOB_RUNTIME_PYTHON_PROXY";
const PYTHON_PROXY_BASE_URL = "PYTHON_SLIDE_RULE_BASE_URL";
const PYTHON_PROXY_INTERNAL_KEY = "PYTHON_SLIDE_RULE_INTERNAL_KEY";
const VALID_RUNTIME_ACTIONS = new Set<BlueprintJobRuntimeAction>([
  "start",
  "status",
  "cancel",
  "read",
]);
const VALID_RUNTIME_STATUSES = new Set([
  "pending",
  "running",
  "waiting",
  "reviewing",
  "completed",
  "failed",
  "cancelled",
]);

function isPythonJobRuntimeProxyEnabled(): boolean {
  return process.env[PYTHON_PROXY_ENABLED] === "true";
}

function resolvePythonJobRuntimeBaseUrl(): string {
  return (process.env[PYTHON_PROXY_BASE_URL] || "http://localhost:9700").replace(/\/+$/, "");
}

function resolvePythonJobRuntimeInternalKey(): string {
  return process.env[PYTHON_PROXY_INTERNAL_KEY] || "dev-slide-rule-internal";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeSnapshot(value: unknown): value is BlueprintJobRuntimeSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    VALID_RUNTIME_STATUSES.has(value.status) &&
    typeof value.stage === "string" &&
    typeof value.version === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.artifacts) &&
    value.artifacts.length === 0 &&
    Array.isArray(value.events) &&
    value.events.length === 0
  );
}

function isBlueprintJobRuntimeResult(value: unknown): value is BlueprintJobRuntimeResult {
  if (!isRecord(value)) return false;
  if (value.contractVersion !== CONTRACT_VERSION) return false;
  if (typeof value.action !== "string") return false;
  if (!VALID_RUNTIME_ACTIONS.has(value.action as BlueprintJobRuntimeAction)) {
    return false;
  }
  if (value.ok === true) {
    return (
      isRecord(value.runtime) &&
      value.runtime.persistenceOwner === "node" &&
      isRuntimeSnapshot(value.job)
    );
  }
  return (
    value.ok === false &&
    (value.error === "not_found" ||
      value.error === "runtime_error" ||
      value.error === "timeout") &&
    typeof value.message === "string"
  );
}

function toRuntimeSnapshot(
  job: BlueprintGenerationJob,
  statusOverride?: BlueprintJobRuntimeSnapshot["status"],
): BlueprintJobRuntimeSnapshot {
  return {
    id: job.id,
    request: job.request,
    status: statusOverride ?? job.status,
    stage: job.stage,
    projectId: job.projectId,
    sourceId: job.sourceId,
    version: job.version,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    artifacts: [],
    events: [],
    error: job.error,
  };
}

function localRuntimeSuccess(
  action: BlueprintJobRuntimeAction,
  job: BlueprintGenerationJob,
  statusOverride?: BlueprintJobRuntimeSnapshot["status"],
  cancelRequested?: boolean,
): BlueprintJobRuntimeResult {
  return {
    ok: true,
    action,
    contractVersion: CONTRACT_VERSION,
    runtime: {
      owner: "node",
      persistenceOwner: "node",
      mode: "local",
    },
    job: toRuntimeSnapshot(job, statusOverride),
    ...(cancelRequested !== undefined ? { cancelRequested } : {}),
  };
}

function notFoundResult(
  action: BlueprintJobRuntimeAction,
  jobId: string,
): BlueprintJobRuntimeResult {
  return {
    ok: false,
    action,
    contractVersion: CONTRACT_VERSION,
    error: "not_found",
    message: `Blueprint job ${jobId} was not found in the Node job store.`,
    jobId,
  };
}

function runtimeErrorResult(
  action: BlueprintJobRuntimeAction,
  jobId: string | undefined,
  message: string,
): BlueprintJobRuntimeResult {
  const error = /abort|timeout/i.test(message) ? "timeout" : "runtime_error";
  return {
    ok: false,
    action,
    contractVersion: CONTRACT_VERSION,
    error,
    message,
    ...(jobId ? { jobId } : {}),
    retryable: true,
  };
}

function makeStartJob(
  ctx: BlueprintServiceContext,
  input: BlueprintJobRuntimeStartInput,
): BlueprintGenerationJob {
  const now = input.now ?? ctx.now().toISOString();
  return {
    id: input.id,
    request: input.request ?? {},
    status: "pending",
    stage: input.stage ?? "input",
    projectId: input.projectId ?? input.request?.projectId,
    sourceId: input.sourceId ?? input.request?.sourceId,
    version: input.version ?? "v1",
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    artifacts: [],
    events: [],
  };
}

function mapRuntimeStatusForNode(
  status: BlueprintJobRuntimeSnapshot["status"],
): BlueprintGenerationStatus {
  return status === "cancelled" ? "failed" : status;
}

function applyRuntimeSnapshotToNodeStore(
  ctx: BlueprintServiceContext,
  snapshot: BlueprintJobRuntimeSnapshot,
): BlueprintGenerationJob {
  const existing = ctx.jobStore.get(snapshot.id);
  const next: BlueprintGenerationJob = {
    id: snapshot.id,
    request: existing?.request ?? snapshot.request ?? {},
    status: mapRuntimeStatusForNode(snapshot.status),
    stage: snapshot.stage,
    projectId: snapshot.projectId ?? existing?.projectId,
    sourceId: snapshot.sourceId ?? existing?.sourceId,
    version: snapshot.version,
    createdAt: existing?.createdAt ?? snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    completedAt: snapshot.completedAt ?? existing?.completedAt,
    artifacts: existing?.artifacts ?? [],
    events: existing?.events ?? [],
    error:
      snapshot.status === "cancelled"
        ? snapshot.error ?? {
            code: "cancelled",
            message: "Blueprint job cancelled.",
            stage: snapshot.stage,
          }
        : snapshot.error ?? existing?.error,
  };
  ctx.jobStore.save(next);
  return next;
}

function applyRuntimeResultToNodeStore(
  ctx: BlueprintServiceContext,
  action: BlueprintJobRuntimeAction,
  result: BlueprintJobRuntimeResult,
): void {
  if (!result.ok || !result.job) return;
  if (action === "read") return;
  applyRuntimeSnapshotToNodeStore(ctx, result.job);
}

function runtimePayload(
  ctx: BlueprintServiceContext,
  action: BlueprintJobRuntimeAction,
  jobId: string,
  job: BlueprintGenerationJob | null,
  extra: Record<string, unknown> = {},
) {
  return {
    action,
    jobId,
    job,
    now: ctx.now().toISOString(),
    nodeControl: {
      persistenceOwner: "node",
      artifactStoreOwner: "node",
      eventBusOwner: "node",
      permissionOwner: "node",
      auditOwner: "node",
      cancellationOwner: "node",
    },
    ...extra,
  };
}

async function callPythonJobRuntimeProxy(
  action: BlueprintJobRuntimeAction,
  payload: Record<string, unknown>,
): Promise<BlueprintJobRuntimeResult> {
  const response = await fetch(
    `${resolvePythonJobRuntimeBaseUrl()}/api/blueprint/jobs/runtime/${action}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": resolvePythonJobRuntimeInternalKey(),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`python job-runtime proxy failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  const result = await response.json();
  if (!isBlueprintJobRuntimeResult(result)) {
    throw new Error("python job-runtime proxy returned invalid shape");
  }
  return result;
}

async function withPythonJobRuntimeProxy(
  ctx: BlueprintServiceContext,
  action: BlueprintJobRuntimeAction,
  jobId: string,
  job: BlueprintGenerationJob | null,
  fallback: () => BlueprintJobRuntimeResult,
  extra: Record<string, unknown> = {},
): Promise<BlueprintJobRuntimeResult> {
  if (!isPythonJobRuntimeProxyEnabled()) {
    return fallback();
  }
  try {
    const result = await callPythonJobRuntimeProxy(
      action,
      runtimePayload(ctx, action, jobId, job, extra),
    );
    applyRuntimeResultToNodeStore(ctx, action, result);
    return result;
  } catch (error) {
    const message = errorMessage(error);
    ctx.logger.warn("job-runtime python proxy failed", {
      action,
      jobId,
      error: message,
    });
    return runtimeErrorResult(action, jobId, message);
  }
}

export function createJobService(ctx: BlueprintServiceContext): JobService {
  return {
    listJobs() {
      return ctx.jobStore.list();
    },
    getJob(jobId) {
      return ctx.jobStore.get(jobId);
    },
    getLatestJob(options) {
      return ctx.jobStore.latest(options);
    },
    emitJobEvent(event) {
      ctx.eventBus.emit(event);
    },
    async startJob(input) {
      const existing = ctx.jobStore.get(input.id);
      const job = existing ?? makeStartJob(ctx, input);
      if (!existing) {
        ctx.jobStore.save(job);
      }
      return withPythonJobRuntimeProxy(
        ctx,
        "start",
        job.id,
        job,
        () => {
          const next: BlueprintGenerationJob = {
            ...job,
            status: "running",
            updatedAt: input.now ?? ctx.now().toISOString(),
          };
          ctx.jobStore.save(next);
          return localRuntimeSuccess("start", next);
        },
        { request: input.request ?? job.request, now: input.now },
      );
    },
    async getJobStatus(jobId) {
      const job = ctx.jobStore.get(jobId);
      return withPythonJobRuntimeProxy(
        ctx,
        "status",
        jobId,
        job,
        () => (job ? localRuntimeSuccess("status", job) : notFoundResult("status", jobId)),
      );
    },
    async cancelJob(jobId, options = {}) {
      const job = ctx.jobStore.get(jobId);
      return withPythonJobRuntimeProxy(
        ctx,
        "cancel",
        jobId,
        job,
        () => {
          if (!job) return notFoundResult("cancel", jobId);
          const now = options.now ?? ctx.now().toISOString();
          const cancelled: BlueprintGenerationJob = {
            ...job,
            status: "failed",
            updatedAt: now,
            completedAt: job.completedAt ?? now,
            error: {
              code: "cancelled",
              message: options.reason ?? "Blueprint job cancelled.",
              stage: job.stage,
            },
          };
          ctx.jobStore.save(cancelled);
          return localRuntimeSuccess("cancel", cancelled, "cancelled", true);
        },
        { reason: options.reason, now: options.now },
      );
    },
    async readJob(jobId) {
      const job = ctx.jobStore.get(jobId);
      return withPythonJobRuntimeProxy(
        ctx,
        "read",
        jobId,
        job,
        () => (job ? localRuntimeSuccess("read", job) : notFoundResult("read", jobId)),
      );
    },
  };
}
