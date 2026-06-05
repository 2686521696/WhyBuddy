/**
 * `blueprint-content-quality-check` spec Task 4.1–4.5：服务层实现。
 */

import type { BlueprintServiceContext } from "../context.js";
import type {
  ContentQualityService,
  ContentQualityCheckInput,
  ContentQualityBatchInput,
  ContentQualityCheckResult,
  ContentQualityBatchResult,
  ContentQualityOverallStatus,
} from "./types.js";
import { checkDocumentSubstance, checkEarsCompliance } from "./validator.js";

const ENV_KEY = "BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED";

export function createContentQualityService(
  ctx: BlueprintServiceContext,
): ContentQualityService {
  const enabled = process.env[ENV_KEY] === "true";

  return {
    validateDocument(input: ContentQualityCheckInput): ContentQualityCheckResult {
      const { jobId, document } = input;
      const documentType = (document as any).type ?? "unknown";
      const documentId = (document as any).id ?? "unknown";
      const content = (document as any).body ?? (document as any).content ?? "";

      if (!enabled) {
        return {
          documentId,
          documentType,
          substanceStatus: "skip",
          substanceOutput: "content quality check disabled",
        };
      }

      let substanceResult;
      try {
        substanceResult = checkDocumentSubstance(content, documentType);
      } catch (err) {
        substanceResult = {
          status: "warn" as const,
          output: `substance check error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // Record substance check to ledger
      ctx.checksLedger?.recordCheck({
        jobId,
        stage: "spec_docs",
        checkType: "content_quality",
        checkName: `Content Quality: ${documentType}`,
        status: substanceResult.status,
        validator: "content-quality/validator.ts",
        output: substanceResult.output,
      });

      // EARS check only for requirements
      let earsResult;
      if (documentType === "requirements") {
        try {
          earsResult = checkEarsCompliance(content);
        } catch (err) {
          earsResult = {
            status: "warn" as const,
            output: `EARS check error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        ctx.checksLedger?.recordCheck({
          jobId,
          stage: "spec_docs",
          checkType: "content_quality",
          checkName: `EARS Pattern: ${documentType}`,
          status: earsResult.status,
          validator: "content-quality/validator.ts",
          output: earsResult.output,
        });
      }

      return {
        documentId,
        documentType,
        substanceStatus: substanceResult.status,
        substanceOutput: substanceResult.output,
        earsStatus: earsResult?.status,
        earsOutput: earsResult?.output,
      };
    },

    validateDocuments(input: ContentQualityBatchInput): ContentQualityBatchResult {
      if (!enabled) {
        return {
          overallStatus: "skip",
          results: input.documents.map((doc) => ({
            documentId: (doc as any).id ?? "unknown",
            documentType: (doc as any).type ?? "unknown",
            substanceStatus: "skip" as const,
            substanceOutput: "content quality check disabled",
          })),
        };
      }

      const results: ContentQualityCheckResult[] = [];

      for (const document of input.documents) {
        try {
          const result = this.validateDocument({ jobId: input.jobId, document });
          results.push(result);
        } catch (err) {
          // Non-blocking: record error and continue
          const documentType = (document as any).type ?? "unknown";
          ctx.checksLedger?.recordCheck({
            jobId: input.jobId,
            stage: "spec_docs",
            checkType: "content_quality",
            checkName: `Content Quality: ${documentType}`,
            status: "warn",
            validator: "content-quality/validator.ts",
            output: `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
          });
          results.push({
            documentId: (document as any).id ?? "unknown",
            documentType,
            substanceStatus: "warn",
            substanceOutput: `error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // Compute overall status
      const overallStatus = computeOverallStatus(results);

      return { overallStatus, results };
    },
  };
}

function computeOverallStatus(results: ContentQualityCheckResult[]): ContentQualityOverallStatus {
  let hasFail = false;
  let hasWarn = false;

  for (const r of results) {
    if (r.substanceStatus === "fail" || r.earsStatus === "fail") hasFail = true;
    if (r.substanceStatus === "warn" || r.earsStatus === "warn") hasWarn = true;
  }

  if (hasFail) return "fail";
  if (hasWarn) return "warn";
  return "pass";
}
