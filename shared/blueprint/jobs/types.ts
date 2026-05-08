/**
 * 子域 3：Job Lifecycle & Events 的类型出口。
 *
 * 当前采用 re-export 视图（方案 B）。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1（子域 3 路由：`/jobs`、`/generations`、`/jobs/:id`、`/jobs/:id/events`、`/jobs/:id/events/stream`）
 * - 需求 2.4、5.1、6.3
 */

export type {
  // 作业生命周期主对象
  BlueprintGenerationJob,
  BlueprintGenerationMode,
  BlueprintGenerationRequest,
  BlueprintGenerationStage,
  BlueprintGenerationStagePayloadKind,
  BlueprintGenerationStageState,
  BlueprintGenerationStatus,
  // 作业 artifact 与下一步动作
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
  // 事件
  BlueprintGenerationEvent,
  BlueprintGenerationEventFamily,
  BlueprintGenerationEventFilters,
  BlueprintGenerationEventType,
  // 响应
  BlueprintCreateGenerationJobResponse,
  BlueprintGenerationEventsResponse,
  BlueprintLatestGenerationJobResponse,
} from "../contracts.js";
