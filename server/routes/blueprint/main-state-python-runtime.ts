import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintGenerationStatus,
} from "../../../shared/blueprint/index.js";
import {
  BLUEPRINT_MAIN_STATE_PYTHON_CONTRACT_VERSION,
  type BlueprintMainStatePythonArtifact,
  type BlueprintMainStatePythonError,
  type BlueprintMainStatePythonProjection,
  isBlueprintMainStatePythonProjection,
} from "../../../shared/blueprint/blueprint-main-state-contract.js";

export const BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION =
  "blueprint.main-state.runtime.v1" as const;

export type BlueprintMainStateRuntimeOperation = "read" | "project" | "update";

export interface BlueprintMainStateRuntimeBoundary {
  owner: "python" | "node";
  mode: "runtime_bridge" | "local_fallback";
  stateAuthority: "node";
  stateMutation: "none";
  jobStoreOwner: "node";
  eventBusOwner: "node";
  ledgerOwner: "node";
  previewOwner: "node";
  promptPackageOwner: "node";
}

export interface BlueprintMainStateRuntimeReadEnvelope {
  source: "node-job-snapshot";
  projectedAt: string;
}

export interface BlueprintMainStateRuntimeUpdateEnvelope {
  accepted: false;
  reason: "node_state_owner";
  message: string;
  requestedPatch?: Record<string, unknown>;
}

export interface BlueprintMainStateRuntimeSuccess {
  ok: true;
  operation: BlueprintMainStateRuntimeOperation;
  contractVersion: typeof BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION;
  runtime: BlueprintMainStateRuntimeBoundary;
  jobId: string;
  projection: BlueprintMainStatePythonProjection;
  read: BlueprintMainStateRuntimeReadEnvelope;
  update: BlueprintMainStateRuntimeUpdateEnvelope;
  provenance: "python-blueprint-state-runtime" | "node-blueprint-state-python-runtime";
}

export interface BlueprintMainStateRuntimeError {
  ok: false;
  operation: BlueprintMainStateRuntimeOperation | "unknown";
  contractVersion: typeof BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION;
  error:
    | "invalid_operation"
    | "validation_error"
    | "not_found"
    | "projection_error"
    | "boundary_violation"
    | "runtime_unavailable"
    | "invalid_runtime_response";
  reason: string;
  message: string;
  statusCode: number;
  jobId?: string;
  retryable?: boolean;
  provenance: "python-blueprint-state-runtime" | "node-blueprint-state-python-runtime";
}

export type BlueprintMainStateRuntimeResult =
  | BlueprintMainStateRuntimeSuccess
  | BlueprintMainStateRuntimeError;

export interface BlueprintMainStateRuntimeOptions {
  now?: () => string;
}

const PYTHON_RUNTIME_ENABLED = "BLUEPRINT_MAIN_STATE_PYTHON_RUNTIME";
const PYTHON_RUNTIME_BASE_URL = "PYTHON_SLIDE_RULE_BASE_URL";
const PYTHON_RUNTIME_INTERNAL_KEY = "PYTHON_SLIDE_RULE_INTERNAL_KEY";
const UPDATE_NODE_OWNER_MESSAGE =
  "Blueprint main state updates are audited by Python but applied by Node.";
const VALID_NODE_STATUSES = new Set<BlueprintGenerationStatus>([
  "pending",
  "running",
  "waiting",
  "reviewing",
  "completed",
  "failed",
]);
const NODE_CONTROL = {
  jobStoreOwner: "node",
  eventBusOwner: "node",
  ledgerOwner: "node",
  previewOwner: "node",
  promptPackageOwner: "node",
} as const;

export async function readBlueprintMainStateWithPythonRuntime(
  job: BlueprintGenerationJob | null,
  options: BlueprintMainStateRuntimeOptions = {},
): Promise<BlueprintMainStateRuntimeResult> {
  return executeBlueprintMainStateRuntime("read", job, undefined, options);
}

export async function projectBlueprintMainStateWithPythonRuntime(
  job: BlueprintGenerationJob | null,
  options: BlueprintMainStateRuntimeOptions = {},
): Promise<BlueprintMainStateRuntimeResult> {
  return executeBlueprintMainStateRuntime("project", job, undefined, options);
}

export async function updateBlueprintMainStateWithPythonRuntime(
  job: BlueprintGenerationJob | null,
  patch: Record<string, unknown>,
  options: BlueprintMainStateRuntimeOptions = {},
): Promise<BlueprintMainStateRuntimeResult> {
  return executeBlueprintMainStateRuntime("update", job, patch, options);
}

export function projectBlueprintMainStateLocally(
  job: BlueprintGenerationJob,
): BlueprintMainStatePythonProjection {
  const staleArtifactIds = collectStaleArtifactIds(job);
  const stale = staleArtifactIds.length > 0;
  const errors = projectErrors(job);
  const projection: BlueprintMainStatePythonProjection = {
    contractVersion: BLUEPRINT_MAIN_STATE_PYTHON_CONTRACT_VERSION,
    kind: "blueprint.main.state_projection",
    stateAuthority: "node",
    stateMutation: "none",
    jobId: job.id,
    projectId: cleanOptionalString(job.projectId),
    sourceId: cleanOptionalString(job.sourceId),
    version: cleanOptionalString(job.version),
    stage: job.stage,
    status: projectStatus(job.status, stale),
    nodeStatus: job.status,
    createdAt: cleanOptionalString(job.createdAt),
    updatedAt: job.updatedAt,
    completedAt: cleanOptionalString(job.completedAt),
    artifacts: job.artifacts.map((artifact) => projectArtifact(artifact, staleArtifactIds)),
    stale,
    staleArtifactIds,
    ...(errors[0] ? { error: errors[0], errors } : {}),
  };

  if (!isBlueprintMainStatePythonProjection(projection)) {
    throw new Error("local Blueprint main-state projection failed contract validation");
  }
  return projection;
}

async function executeBlueprintMainStateRuntime(
  operation: BlueprintMainStateRuntimeOperation,
  job: BlueprintGenerationJob | null,
  patch: Record<string, unknown> | undefined,
  options: BlueprintMainStateRuntimeOptions,
): Promise<BlueprintMainStateRuntimeResult> {
  const now = options.now?.() ?? new Date().toISOString();

  if (!isPythonRuntimeEnabled()) {
    return localRuntimeResult(operation, job, patch, now);
  }

  try {
    const response = await fetch(
      `${resolvePythonRuntimeBaseUrl()}/api/blueprint/main-state/runtime/${operation}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": resolvePythonRuntimeInternalKey(),
        },
        body: JSON.stringify({
          operation,
          jobId: job?.id,
          job: job ? snapshotForPython(job) : null,
          patch,
          now,
          nodeControl: NODE_CONTROL,
        }),
      },
    );
    const payload = await response.json().catch(async () => {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        operation,
        contractVersion: BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION,
        error: "invalid_runtime_response",
        reason: "non_json_python_response",
        message: text.slice(0, 200) || "Python Blueprint state runtime returned non-JSON response.",
        statusCode: response.status || 502,
        jobId: job?.id,
        provenance: "node-blueprint-state-python-runtime",
      };
    });

    if (isBlueprintMainStateRuntimeResult(payload)) {
      return payload;
    }

    return runtimeUnavailableResult(
      operation,
      job?.id,
      "Python Blueprint state runtime returned invalid shape.",
      "invalid_runtime_response",
      "invalid_python_runtime_shape",
    );
  } catch (error) {
    return runtimeUnavailableResult(
      operation,
      job?.id,
      errorMessage(error),
      "runtime_unavailable",
      "python_runtime_failed",
    );
  }
}

function localRuntimeResult(
  operation: BlueprintMainStateRuntimeOperation,
  job: BlueprintGenerationJob | null,
  patch: Record<string, unknown> | undefined,
  now: string,
): BlueprintMainStateRuntimeResult {
  if (!job) {
    return {
      ok: false,
      operation,
      contractVersion: BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION,
      error: "not_found",
      reason: "missing_node_job_snapshot",
      message: "Blueprint main state runtime requires a Node job snapshot.",
      statusCode: 404,
      provenance: "node-blueprint-state-python-runtime",
    };
  }

  return {
    ok: true,
    operation,
    contractVersion: BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION,
    runtime: {
      owner: "node",
      mode: "local_fallback",
      stateAuthority: "node",
      stateMutation: "none",
      ...NODE_CONTROL,
    },
    jobId: job.id,
    projection: projectBlueprintMainStateLocally(job),
    read: {
      source: "node-job-snapshot",
      projectedAt: now,
    },
    update: {
      accepted: false,
      reason: "node_state_owner",
      message: UPDATE_NODE_OWNER_MESSAGE,
      ...(patch ? { requestedPatch: patch } : {}),
    },
    provenance: "node-blueprint-state-python-runtime",
  };
}

function snapshotForPython(job: BlueprintGenerationJob) {
  return {
    id: job.id,
    projectId: job.projectId,
    sourceId: job.sourceId,
    status: job.status,
    stage: job.stage,
    version: job.version,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    artifacts: job.artifacts,
    staleArtifactIds: job.staleArtifactIds,
    error: job.error,
  };
}

function projectStatus(
  nodeStatus: BlueprintGenerationStatus,
  stale: boolean,
): BlueprintMainStatePythonProjection["status"] {
  if (nodeStatus === "failed") return "failed";
  if (nodeStatus === "pending") return "pending";
  if (nodeStatus === "completed") return stale ? "stale" : "done";
  return stale ? "stale" : "running";
}

function projectArtifact(
  artifact: BlueprintGenerationArtifact,
  staleArtifactIds: readonly string[],
): BlueprintMainStatePythonArtifact {
  const stale = staleArtifactIds.includes(artifact.id);
  return {
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
    payload: artifact.payload,
    stale,
    staleSince: artifact.staleSince,
    invalidatedBy: artifact.invalidatedBy,
  };
}

function collectStaleArtifactIds(job: BlueprintGenerationJob): string[] {
  const staleIds = new Set<string>();
  for (const artifactId of job.staleArtifactIds ?? []) {
    if (isNonEmptyString(artifactId)) staleIds.add(artifactId);
  }
  for (const artifact of job.artifacts) {
    if (artifact.staleSince) staleIds.add(artifact.id);
  }
  const artifactIds = new Set(job.artifacts.map((artifact) => artifact.id));
  return [...staleIds].filter((artifactId) => artifactIds.has(artifactId)).sort();
}

function projectErrors(job: BlueprintGenerationJob): BlueprintMainStatePythonError[] {
  if (job.error) {
    return [
      {
        code: job.error.code,
        message: job.error.message,
        stage: job.error.stage,
      },
    ];
  }
  if (job.status === "failed") {
    return [
      {
        code: "blueprint_job_failed",
        message: "Blueprint job failed without error details.",
        stage: job.stage,
      },
    ];
  }
  return [];
}

function isPythonRuntimeEnabled(): boolean {
  return process.env[PYTHON_RUNTIME_ENABLED] === "true";
}

function resolvePythonRuntimeBaseUrl(): string {
  return (process.env[PYTHON_RUNTIME_BASE_URL] || "http://localhost:9700").replace(/\/+$/, "");
}

function resolvePythonRuntimeInternalKey(): string {
  return process.env[PYTHON_RUNTIME_INTERNAL_KEY] || "dev-slide-rule-internal";
}

function isBlueprintMainStateRuntimeResult(value: unknown): value is BlueprintMainStateRuntimeResult {
  const record = asRecord(value);
  if (!record) return false;
  if (record.contractVersion !== BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION) return false;
  if (!isRuntimeOperation(record.operation) && record.operation !== "unknown") return false;

  if (record.ok === true) {
    return (
      isRuntimeOperation(record.operation) &&
      isRuntimeBoundary(record.runtime) &&
      isNonEmptyString(record.jobId) &&
      isBlueprintMainStatePythonProjection(record.projection) &&
      isReadEnvelope(record.read) &&
      isUpdateEnvelope(record.update) &&
      (record.provenance === "python-blueprint-state-runtime" ||
        record.provenance === "node-blueprint-state-python-runtime")
    );
  }

  return (
    record.ok === false &&
    isRuntimeErrorCode(record.error) &&
    isNonEmptyString(record.reason) &&
    isNonEmptyString(record.message) &&
    typeof record.statusCode === "number" &&
    (record.jobId === undefined || isNonEmptyString(record.jobId)) &&
    (record.retryable === undefined || typeof record.retryable === "boolean") &&
    (record.provenance === "python-blueprint-state-runtime" ||
      record.provenance === "node-blueprint-state-python-runtime")
  );
}

function isRuntimeBoundary(value: unknown): value is BlueprintMainStateRuntimeBoundary {
  const record = asRecord(value);
  return Boolean(
    record &&
      (record.owner === "python" || record.owner === "node") &&
      (record.mode === "runtime_bridge" || record.mode === "local_fallback") &&
      record.stateAuthority === "node" &&
      record.stateMutation === "none" &&
      record.jobStoreOwner === "node" &&
      record.eventBusOwner === "node" &&
      record.ledgerOwner === "node" &&
      record.previewOwner === "node" &&
      record.promptPackageOwner === "node",
  );
}

function isReadEnvelope(value: unknown): value is BlueprintMainStateRuntimeReadEnvelope {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.source === "node-job-snapshot" &&
      isNonEmptyString(record.projectedAt),
  );
}

function isUpdateEnvelope(value: unknown): value is BlueprintMainStateRuntimeUpdateEnvelope {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.accepted === false &&
      record.reason === "node_state_owner" &&
      isNonEmptyString(record.message) &&
      (record.requestedPatch === undefined || asRecord(record.requestedPatch)),
  );
}

function runtimeUnavailableResult(
  operation: BlueprintMainStateRuntimeOperation,
  jobId: string | undefined,
  message: string,
  error: BlueprintMainStateRuntimeError["error"],
  reason: string,
): BlueprintMainStateRuntimeError {
  return {
    ok: false,
    operation,
    contractVersion: BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION,
    error,
    reason,
    message,
    statusCode: error === "runtime_unavailable" ? 503 : 502,
    ...(jobId ? { jobId } : {}),
    retryable: true,
    provenance: "node-blueprint-state-python-runtime",
  };
}

function isRuntimeOperation(value: unknown): value is BlueprintMainStateRuntimeOperation {
  return value === "read" || value === "project" || value === "update";
}

function isRuntimeErrorCode(value: unknown): value is BlueprintMainStateRuntimeError["error"] {
  return (
    value === "invalid_operation" ||
    value === "validation_error" ||
    value === "not_found" ||
    value === "projection_error" ||
    value === "boundary_violation" ||
    value === "runtime_unavailable" ||
    value === "invalid_runtime_response"
  );
}

function cleanOptionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
