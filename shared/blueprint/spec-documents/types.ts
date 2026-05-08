/**
 * 子域 6：SPEC Documents 的类型出口。
 *
 * 当前采用 re-export 视图（方案 B）。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1（子域 6 路由：`/jobs/:id/spec-documents` 及其版本 / review 子路径）
 * - 需求 2.4、4.1、4.4、6.3
 */

export type {
  BlueprintGenerateSpecDocumentsRequest,
  BlueprintReviewSpecDocumentRequest,
  BlueprintReviewSpecDocumentResponse,
  BlueprintSaveSpecDocumentVersionResponse,
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
  BlueprintSpecDocumentVersionSnapshot,
  BlueprintSpecDocumentsResponse,
} from "../contracts.js";
