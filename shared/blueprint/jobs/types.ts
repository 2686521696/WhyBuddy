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
