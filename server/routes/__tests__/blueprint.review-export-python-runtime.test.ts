import { describe, expect, it } from "vitest";

import { mapBlueprintReviewExportPythonRuntime } from "../blueprint/review-export-python-runtime.js";
import type { BlueprintReviewExportRuntimeEnvelope } from "../../../shared/blueprint/review-export/types.js";

const trace = { traceId: "trace-1", spanId: "span-1" };

function exportedEnvelope(): BlueprintReviewExportRuntimeEnvelope {
  return {
    status: "exported",
    degraded: false,
    trace,
    summary: {
      jobId: "job-1",
      totalArtifacts: 1,
      reviewedItems: 1,
      accepted: 1,
      rejected: 0,
      needsChanges: 0,
      warnings: [],
    },
    manifest: {
      jobId: "job-1",
      exportedAt: "2026-06-20T00:00:00.000Z",
      granularity: "single",
      artifactCount: 1,
      documents: [
        {
          artifactId: "artifact-doc-1",
          documentId: "doc-1",
          nodeId: "node-1",
          type: "requirements",
          title: "Requirements Authentication Module",
          status: "draft",
        },
      ],
    },
    warnings: [],
  };
}

describe("Blueprint review/export Python runtime bridge", () => {
  it("maps exported runtime envelopes without dropping trace or manifest", () => {
    const result = mapBlueprintReviewExportPythonRuntime(exportedEnvelope());

    expect(result).toEqual({
      ok: true,
      status: "exported",
      httpStatus: 200,
      exported: true,
      degraded: false,
      trace,
      summary: exportedEnvelope().summary,
      manifest: exportedEnvelope().manifest,
      warnings: [],
    });
  });

  it("keeps degraded envelopes observable instead of marking them exported", () => {
    const envelope = {
      ...exportedEnvelope(),
      status: "degraded",
      degraded: true,
      warnings: [
        {
          code: "review_item_artifact_missing",
          message: "Review item review-1 references missing artifact missing-artifact.",
          artifactId: "missing-artifact",
        },
      ],
    } satisfies BlueprintReviewExportRuntimeEnvelope;

    const result = mapBlueprintReviewExportPythonRuntime(envelope);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.httpStatus).toBe(502);
    expect(result.exported).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.trace).toEqual(trace);
    expect(result.warnings).toEqual(envelope.warnings);
    expect("manifest" in result).toBe(false);
  });

  it("preserves denied permission envelopes and maps them to 403", () => {
    const result = mapBlueprintReviewExportPythonRuntime({
      status: "denied",
      degraded: false,
      trace,
      error: {
        code: "permission_denied",
        message: "Blueprint review/export requires blueprint.export permission.",
      },
    });

    expect(result).toEqual({
      ok: false,
      status: "denied",
      httpStatus: 403,
      exported: false,
      degraded: false,
      trace,
      error: {
        code: "permission_denied",
        message: "Blueprint review/export requires blueprint.export permission.",
      },
    });
  });

  it("preserves failed runtime errors and maps them to 502", () => {
    const result = mapBlueprintReviewExportPythonRuntime({
      status: "failed",
      degraded: false,
      trace,
      error: {
        code: "invalid_artifacts",
        message: "artifacts must be a list",
      },
    });

    expect(result).toEqual({
      ok: false,
      status: "failed",
      httpStatus: 502,
      exported: false,
      degraded: false,
      trace,
      error: {
        code: "invalid_artifacts",
        message: "artifacts must be a list",
      },
    });
  });
});
