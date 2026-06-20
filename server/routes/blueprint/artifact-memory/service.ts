import type {
  BlueprintArtifactFeedback,
  BlueprintArtifactFeedbackRequest,
  BlueprintArtifactMemoryEntry,
  BlueprintArtifactReplaySnapshot,
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
} from "../../../../shared/blueprint/index.js";

import type { BlueprintServiceContext } from "../context.js";

type MaybePromise<T> = T | Promise<T>;
type ArtifactMemoryResource = "all" | "ledger" | "events" | "replays" | "feedback";

export interface ArtifactMemoryWriteResult {
  jobId: string;
  action: "write";
  resource: "feedback";
  source: "node-artifact-store";
  persistenceOwner: "node";
  request: BlueprintArtifactFeedbackRequest;
  writeAccepted: boolean;
  ledger: BlueprintArtifactMemoryEntry[];
  events: BlueprintGenerationEvent[];
  replays: BlueprintArtifactReplaySnapshot[];
  feedback: BlueprintArtifactFeedback[];
  counts: {
    ledger: number;
    events: number;
    replays: number;
    feedback: number;
  };
}

export interface ArtifactMemoryService {
  listLedger(jobId: string): MaybePromise<BlueprintArtifactMemoryEntry[]>;
  listReplays(jobId: string): MaybePromise<BlueprintArtifactReplaySnapshot[]>;
  listFeedback(jobId: string): MaybePromise<BlueprintArtifactFeedback[]>;
  listEvents(jobId: string): MaybePromise<BlueprintGenerationEvent[]>;
  writeFeedback(
    jobId: string,
    request: BlueprintArtifactFeedbackRequest,
  ): MaybePromise<ArtifactMemoryWriteResult>;
}

interface ArtifactMemoryProxyResponse {
  jobId: string;
  action: "list" | "read" | "write";
  resource: ArtifactMemoryResource;
  source: "node-artifact-store";
  persistenceOwner?: "node";
  ledger: BlueprintArtifactMemoryEntry[];
  events: BlueprintGenerationEvent[];
  replays: BlueprintArtifactReplaySnapshot[];
  feedback: BlueprintArtifactFeedback[];
  counts?: {
    ledger: number;
    events: number;
    replays: number;
    feedback: number;
  };
  request?: BlueprintArtifactFeedbackRequest;
  writeAccepted?: boolean;
}

const PYTHON_PROXY_ENABLED = "BLUEPRINT_ARTIFACT_MEMORY_PYTHON_PROXY";
const PYTHON_PROXY_BASE_URL = "PYTHON_SLIDE_RULE_BASE_URL";
const PYTHON_PROXY_INTERNAL_KEY = "PYTHON_SLIDE_RULE_INTERNAL_KEY";

function readArtifactPayloads<T>(
  job: BlueprintGenerationJob | null,
  type: string,
): T[] {
  if (!job) return [];
  return job.artifacts
    .filter(artifact => artifact.type === type)
    .map(artifact => artifact.payload as T)
    .filter((payload): payload is T => payload !== undefined && payload !== null);
}

function readLocalSnapshot(ctx: BlueprintServiceContext, jobId: string) {
  const job = ctx.jobStore.get(jobId);
  return {
    ledger: readArtifactPayloads<BlueprintArtifactMemoryEntry>(job, "replay"),
    replays: readArtifactPayloads<BlueprintArtifactReplaySnapshot>(job, "replay"),
    feedback: readArtifactPayloads<BlueprintArtifactFeedback>(job, "feedback"),
    events: ctx.replayStore.listEvents(jobId),
  };
}

function makeCounts(snapshot: ReturnType<typeof readLocalSnapshot>) {
  return {
    ledger: snapshot.ledger.length,
    events: snapshot.events.length,
    replays: snapshot.replays.length,
    feedback: snapshot.feedback.length,
  };
}

function createLocalWriteResult(
  ctx: BlueprintServiceContext,
  jobId: string,
  request: BlueprintArtifactFeedbackRequest,
): ArtifactMemoryWriteResult {
  const snapshot = readLocalSnapshot(ctx, jobId);
  return {
    jobId,
    action: "write",
    resource: "feedback",
    source: "node-artifact-store",
    persistenceOwner: "node",
    request,
    writeAccepted: false,
    ...snapshot,
    counts: makeCounts(snapshot),
  };
}

function isPythonArtifactMemoryProxyEnabled(): boolean {
  return process.env[PYTHON_PROXY_ENABLED] === "true";
}

function resolvePythonArtifactMemoryBaseUrl(): string {
  return (process.env[PYTHON_PROXY_BASE_URL] || "http://localhost:9700").replace(/\/+$/, "");
}

function resolvePythonArtifactMemoryInternalKey(): string {
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

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isArtifactMemoryProxyResponse(value: unknown): value is ArtifactMemoryProxyResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.jobId === "string" &&
    (candidate.action === "list" ||
      candidate.action === "read" ||
      candidate.action === "write") &&
    (candidate.resource === "all" ||
      candidate.resource === "ledger" ||
      candidate.resource === "events" ||
      candidate.resource === "replays" ||
      candidate.resource === "feedback") &&
    candidate.source === "node-artifact-store" &&
    isArray(candidate.ledger) &&
    isArray(candidate.events) &&
    isArray(candidate.replays) &&
    isArray(candidate.feedback)
  );
}

async function callPythonArtifactMemoryProxy(
  ctx: BlueprintServiceContext,
  jobId: string,
  resource: ArtifactMemoryResource,
  action: "list" | "write",
  request?: BlueprintArtifactFeedbackRequest,
): Promise<ArtifactMemoryProxyResponse> {
  const snapshot = readLocalSnapshot(ctx, jobId);
  const response = await fetch(
    `${resolvePythonArtifactMemoryBaseUrl()}/api/blueprint/spec-documents/artifact-memory/contract`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": resolvePythonArtifactMemoryInternalKey(),
      },
      body: JSON.stringify({
        jobId,
        action,
        resource,
        request,
        ...snapshot,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`python artifact-memory proxy failed: ${response.status} ${detail.slice(0, 200)}`);
  }

  const payload = await response.json();
  if (!isArtifactMemoryProxyResponse(payload)) {
    throw new Error("python artifact-memory proxy returned invalid shape");
  }
  return payload;
}

function withPythonFallback<T>(
  ctx: BlueprintServiceContext,
  jobId: string,
  resource: ArtifactMemoryResource,
  action: "list" | "write",
  select: (payload: ArtifactMemoryProxyResponse) => T,
  fallback: () => T,
  request?: BlueprintArtifactFeedbackRequest,
): MaybePromise<T> {
  if (!isPythonArtifactMemoryProxyEnabled()) {
    return fallback();
  }

  return callPythonArtifactMemoryProxy(ctx, jobId, resource, action, request)
    .then(select)
    .catch(error => {
      ctx.logger.warn("artifact-memory python proxy failed, using node store", {
        jobId,
        resource,
        action,
        error: errorMessage(error),
      });
      return fallback();
    });
}

export function createArtifactMemoryService(
  ctx: BlueprintServiceContext,
): ArtifactMemoryService {
  return {
    listLedger(jobId) {
      return withPythonFallback(
        ctx,
        jobId,
        "ledger",
        "list",
        payload => payload.ledger,
        () => readLocalSnapshot(ctx, jobId).ledger,
      );
    },
    listReplays(jobId) {
      return withPythonFallback(
        ctx,
        jobId,
        "replays",
        "list",
        payload => payload.replays,
        () => readLocalSnapshot(ctx, jobId).replays,
      );
    },
    listFeedback(jobId) {
      return withPythonFallback(
        ctx,
        jobId,
        "feedback",
        "list",
        payload => payload.feedback,
        () => readLocalSnapshot(ctx, jobId).feedback,
      );
    },
    listEvents(jobId) {
      return readLocalSnapshot(ctx, jobId).events;
    },
    writeFeedback(jobId, request) {
      return withPythonFallback(
        ctx,
        jobId,
        "feedback",
        "write",
        payload => ({
          jobId: payload.jobId,
          action: "write",
          resource: "feedback",
          source: "node-artifact-store",
          persistenceOwner: "node",
          request: payload.request ?? request,
          writeAccepted: payload.writeAccepted === true,
          ledger: payload.ledger,
          events: payload.events,
          replays: payload.replays,
          feedback: payload.feedback,
          counts: payload.counts ?? {
            ledger: payload.ledger.length,
            events: payload.events.length,
            replays: payload.replays.length,
            feedback: payload.feedback.length,
          },
        }),
        () => createLocalWriteResult(ctx, jobId, request),
        request,
      );
    },
  };
}
