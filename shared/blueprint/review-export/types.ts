export type BlueprintReviewExportRuntimeStatus =
  | "exported"
  | "failed"
  | "denied"
  | "degraded";

export interface BlueprintReviewExportTrace {
  traceId?: string;
  spanId?: string;
  [key: string]: unknown;
}

export interface BlueprintReviewExportWarning {
  code: string;
  message: string;
  artifactId?: string;
  [key: string]: unknown;
}

export interface BlueprintReviewExportError {
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface BlueprintReviewExportSummary {
  jobId: string;
  totalArtifacts: number;
  reviewedItems: number;
  accepted: number;
  rejected: number;
  needsChanges: number;
  warnings: BlueprintReviewExportWarning[];
}

export interface BlueprintReviewExportManifestDocument {
  artifactId: string;
  documentId: string;
  nodeId: string;
  type: string;
  title: string;
  status: string;
}

export interface BlueprintReviewExportManifest {
  jobId: string;
  exportedAt: string;
  granularity: string;
  artifactCount: number;
  documents: BlueprintReviewExportManifestDocument[];
}

export type BlueprintReviewExportRuntimeEnvelope =
  | {
      status: "exported";
      degraded: false;
      trace: BlueprintReviewExportTrace;
      summary: BlueprintReviewExportSummary;
      manifest: BlueprintReviewExportManifest;
      warnings: BlueprintReviewExportWarning[];
      error?: never;
    }
  | {
      status: "degraded";
      degraded: true;
      trace: BlueprintReviewExportTrace;
      summary: BlueprintReviewExportSummary;
      manifest: BlueprintReviewExportManifest;
      warnings: BlueprintReviewExportWarning[];
      error?: BlueprintReviewExportError;
    }
  | {
      status: "failed" | "denied";
      degraded: false;
      trace: BlueprintReviewExportTrace;
      error: BlueprintReviewExportError;
      summary?: never;
      manifest?: never;
      warnings?: BlueprintReviewExportWarning[];
    };

export type BlueprintReviewExportBridgeResult =
  | {
      ok: true;
      status: "exported";
      httpStatus: 200;
      exported: true;
      degraded: false;
      trace: BlueprintReviewExportTrace;
      summary: BlueprintReviewExportSummary;
      manifest: BlueprintReviewExportManifest;
      warnings: BlueprintReviewExportWarning[];
    }
  | {
      ok: false;
      status: "failed" | "denied" | "degraded";
      httpStatus: 403 | 502;
      exported: false;
      degraded: boolean;
      trace: BlueprintReviewExportTrace;
      error?: BlueprintReviewExportError;
      warnings?: BlueprintReviewExportWarning[];
    };
