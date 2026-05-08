/**
 * 子域 8：Artifact Memory / Replay 的类型出口。
 *
 * 当前采用 re-export 视图（方案 B）。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1（子域 8 路由：`/jobs/:id/artifact-ledger`、`/artifact-replay`、`/artifact-replays`、`/artifact-diff`、`/artifact-feedback`）
 * - 需求 2.4、3.2、3.6、5.3、6.3
 */

export type {
  // Ledger
  BlueprintArtifactLedgerResponse,
  BlueprintArtifactMemoryEntry,
  BlueprintArtifactMemoryType,
  BlueprintArtifactPayloadSummary,
  BlueprintArtifactSourceIds,
  // Lineage / timeline
  BlueprintArtifactLineageEdge,
  BlueprintArtifactReplayTimelineEntry,
  // Replay & decision preservation
  BlueprintArtifactDecisionReplay,
  BlueprintArtifactEvolutionEffectPreview,
  BlueprintArtifactEvolutionPromptPackage,
  BlueprintArtifactEvolutionReplay,
  BlueprintArtifactEvolutionRouteSet,
  BlueprintArtifactEvolutionSpecDocument,
  BlueprintArtifactEvolutionSpecTree,
  BlueprintArtifactReplayConfirmationDecision,
  BlueprintArtifactReplayHandoffDecision,
  BlueprintArtifactReplayResponse,
  BlueprintArtifactReplaySnapshot,
  BlueprintArtifactReplaysResponse,
  BlueprintCreateArtifactReplayRequest,
  // Diff & feedback
  BlueprintArtifactDiff,
  BlueprintArtifactDiffRequest,
  BlueprintArtifactDiffResponse,
  BlueprintArtifactFeedback,
  BlueprintArtifactFeedbackKind,
  BlueprintArtifactFeedbackRequest,
  BlueprintArtifactFeedbackResponse,
} from "../contracts.js";
