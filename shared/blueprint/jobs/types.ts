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

export type BlueprintJobRuntimeAction = "start" | "status" | "cancel" | "read";

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
