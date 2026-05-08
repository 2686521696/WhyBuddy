/**
 * 子域 2：Clarification 的类型出口。
 *
 * 当前采用 re-export 视图（方案 B）。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1（子域 2 路由：`/intake/:id/clarifications`、`/clarifications/:sessionId`、`/clarifications/:sessionId/answers`）
 * - 需求 2.4、6.3
 */

export type {
  BlueprintClarificationAnswer,
  BlueprintClarificationAnswerProvenance,
  BlueprintClarificationAnswerSource,
  BlueprintClarificationGenerationSource,
  BlueprintClarificationQuestion,
  BlueprintClarificationQuestionKind,
  BlueprintClarificationReadiness,
  BlueprintClarificationReadinessSignalId,
  BlueprintClarificationReadinessStatus,
  BlueprintClarificationRouteDimension,
  BlueprintClarificationSession,
  BlueprintClarificationStrategyId,
} from "../contracts.js";
