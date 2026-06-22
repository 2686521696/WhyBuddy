import type {
  BlueprintReviewExportBridgeResult,
  BlueprintReviewExportRuntimeEnvelope,
} from "../../../shared/blueprint/review-export/types.js";

const RUNTIME_DEGRADED_ERROR = {
  code: "runtime_degraded",
  message: "Blueprint review/export runtime returned a degraded envelope.",
};

export function mapBlueprintReviewExportPythonRuntime(
  envelope: BlueprintReviewExportRuntimeEnvelope,
): BlueprintReviewExportBridgeResult {
  if (envelope.status === "exported") {
    return {
      ok: true,
      status: "exported",
      httpStatus: 200,
      exported: true,
      degraded: false,
      trace: envelope.trace,
      summary: envelope.summary,
      manifest: envelope.manifest,
      warnings: envelope.warnings,
    };
  }

  if (envelope.status === "denied") {
    return {
      ok: false,
      status: "denied",
      httpStatus: 403,
      exported: false,
      degraded: false,
      trace: envelope.trace,
      error: envelope.error,
    };
  }

  if (envelope.status === "degraded") {
    return {
      ok: false,
      status: "degraded",
      httpStatus: 502,
      exported: false,
      degraded: true,
      trace: envelope.trace,
      error: envelope.error ?? RUNTIME_DEGRADED_ERROR,
      warnings: envelope.warnings,
    };
  }

  return {
    ok: false,
    status: "failed",
    httpStatus: 502,
    exported: false,
    degraded: false,
    trace: envelope.trace,
    error: envelope.error,
  };
}
