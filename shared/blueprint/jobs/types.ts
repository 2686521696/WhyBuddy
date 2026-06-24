/**
 * Subdomain 3: Job Lifecycle & Events type exports.
 *
 * This file intentionally stays as a re-export view for Blueprint job route
 * consumers. It also gives the task-executor proxy gate a clean shared type
 * surface to scan without changing job runtime behavior.
 */

export type {
  // Job lifecycle objects
  BlueprintGenerationJob,
  BlueprintGenerationMode,
  BlueprintGenerationRequest,
  BlueprintGenerationStage,
  BlueprintGenerationStagePayloadKind,
  BlueprintGenerationStageState,
  BlueprintGenerationStatus,
  // Job artifacts and next actions
  BlueprintGenerationArtifact,
  BlueprintGenerationArtifactLink,
  BlueprintGenerationArtifactType,
  BlueprintGenerationNextAction,
  BlueprintGenerationNextActionId,
  BlueprintGenerationNextActionOption,
  BlueprintGenerationNextActionType,
  BlueprintHandoffState,
  BlueprintReviewHandoffState,
  BlueprintReviewingHandoff,
  // Events
  BlueprintGenerationEvent,
  BlueprintGenerationEventFamily,
  BlueprintGenerationEventFilters,
  BlueprintGenerationEventType,
  BlueprintStaleReason,
  BlueprintStaleSource,
  BlueprintStaleEditResultSummary,
  // Responses
  BlueprintCreateGenerationJobResponse,
  BlueprintFamilyResponse,
  BlueprintGenerationEventsResponse,
  BlueprintIntakePatchRequest,
  BlueprintLatestGenerationJobResponse,
} from "../contracts.js";

import type {
  BlueprintGenerationRequest,
  BlueprintGenerationStage,
  BlueprintGenerationStatus,
} from "../contracts.js";

export type BlueprintJobRuntimeAction =
  | "start"
  | "status"
  | "complete"
  | "fail"
  | "cancel"
  | "read";

export type BlueprintJobRuntimeStatus =
  | BlueprintGenerationStatus
  | "cancelled";

export interface BlueprintJobRuntimeSnapshot {
  id: string;
  request?: Partial<BlueprintGenerationRequest>;
  status: BlueprintJobRuntimeStatus;
  stage: BlueprintGenerationStage;
  projectId?: string;
  sourceId?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  artifacts: [];
  events: [];
  error?: {
    code: string;
    message: string;
    stage: BlueprintGenerationStage;
  };
}

export interface BlueprintJobRuntimeMeta {
  owner: "python" | "node";
  persistenceOwner: "node";
  mode: "proxy_contract" | "local";
}

export type BlueprintJobRuntimeError =
  | "not_found"
  | "runtime_error"
  | "timeout";

export type BlueprintJobRuntimeResult =
  | {
      ok: true;
      action: BlueprintJobRuntimeAction;
      contractVersion: "blueprint.job-runtime.proxy.v1";
      runtime: BlueprintJobRuntimeMeta;
      job: BlueprintJobRuntimeSnapshot;
      cancelRequested?: boolean;
    }
  | {
      ok: false;
      action: BlueprintJobRuntimeAction;
      contractVersion: "blueprint.job-runtime.proxy.v1";
      error: BlueprintJobRuntimeError;
      message: string;
      jobId?: string;
      retryable?: boolean;
    };

/**
 * 103: Job store scope decision types (consumed by python bridge + migration accounting).
 * These classify areas for denominator; do not imply migration of real stores.
 */
export type BlueprintJobStoreScopeArea =
  | "jobStore"
  | "eventBus"
  | "ledger"
  | "replan"
  | "promptPackage"
  | "previewState"
  | "jobStateSlice"
  | "all";

export type BlueprintJobStoreScopeOwnership =
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope";

export interface BlueprintJobStoreScopeDecision {
  area: BlueprintJobStoreScopeArea | string;
  ownership: BlueprintJobStoreScopeOwnership | Record<string, BlueprintJobStoreScopeOwnership>;
  productionTakeover: boolean;
  migrationDenominator: {
    total: number;
    pythonOwned: number;
    nodeRetained: number;
    externalOwned?: number;
    outOfScope?: number;
  };
  reason: string;
  evidence: Record<string, unknown>;
  contractVersion: "blueprint.job-store-scope-decision.v1";
  provenance: string;
  ok: boolean;
  areas?: Record<string, BlueprintJobStoreScopeOwnership>;
}

/**
 * 104: Blueprint job store runtime takeover decision types.
 * Surface classification for runtime read/write slice vs retained durable store.
 * Mirrors scope but focuses on runtime behavior envelope + fallback.
 * Does not imply durable store migration.
 */
export type BlueprintJobStoreRuntimeTakeoverSurface =
  | "jobStore"
  | "eventBus"
  | "ledger"
  | "replan"
  | "promptPackage"
  | "previewState"
  | "jobStateRuntimeSlice"
  | "all";

export type BlueprintJobStoreRuntimeTakeoverOwnership =
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope";

export interface BlueprintJobStoreRuntimeTakeover {
  surface: BlueprintJobStoreRuntimeTakeoverSurface | string;
  ownership: BlueprintJobStoreRuntimeTakeoverOwnership | Record<string, BlueprintJobStoreRuntimeTakeoverOwnership>;
  productionTakeover: boolean;
  migrationDenominator: {
    total: number;
    pythonOwned: number;
    nodeRetained: number;
    externalOwned?: number;
    outOfScope?: number;
  };
  evidence: Record<string, unknown>;
  fallback: string;
  reason?: string;
  contractVersion: "blueprint.job-store-runtime-takeover.v1";
  provenance: string;
  ok: boolean;
  surfaces?: Record<string, BlueprintJobStoreRuntimeTakeoverOwnership>;
}
