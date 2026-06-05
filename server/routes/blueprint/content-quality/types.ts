/**
 * `blueprint-content-quality-check` spec Task 1.1：类型定义。
 */

import type { BlueprintCheckStatus } from "../../../../shared/blueprint/checks-ledger/types.js";
import type { BlueprintSpecDocument } from "../../../../shared/blueprint/contracts.js";

export type ContentQualityOverallStatus = "pass" | "fail" | "warn" | "skip";

export interface ContentQualityCheckInput {
  jobId: string;
  document: BlueprintSpecDocument;
}

export interface ContentQualityBatchInput {
  jobId: string;
  documents: BlueprintSpecDocument[];
}

export interface ContentQualityCheckResult {
  documentId: string;
  documentType: string;
  substanceStatus: BlueprintCheckStatus;
  substanceOutput: string;
  earsStatus?: BlueprintCheckStatus;
  earsOutput?: string;
}

export interface ContentQualityBatchResult {
  overallStatus: ContentQualityOverallStatus;
  results: ContentQualityCheckResult[];
}

export interface ContentQualityService {
  validateDocument(input: ContentQualityCheckInput): ContentQualityCheckResult;
  validateDocuments(input: ContentQualityBatchInput): ContentQualityBatchResult;
}
