export const WEB_AIGC_IMAGE_SEARCH_API = {
  EXECUTE: "POST /api/image-search/nodes/execute",
} as const;

export const WEB_AIGC_IMAGE_SEARCH_NODE_TYPES = [
  "image_search",
] as const;

export type ImageSearchNodeType =
  (typeof WEB_AIGC_IMAGE_SEARCH_NODE_TYPES)[number];

export const WEB_AIGC_IMAGE_SEARCH_MODES = [
  "mock",
  "hybrid",
] as const;

export type WebAigcImageSearchMode =
  (typeof WEB_AIGC_IMAGE_SEARCH_MODES)[number];

export const WEB_AIGC_IMAGE_AVAILABILITY = [
  "available",
  "preview_only",
  "unavailable",
] as const;

export type WebAigcImageAvailability =
  (typeof WEB_AIGC_IMAGE_AVAILABILITY)[number];

export interface WebAigcReferenceImageInput {
  description?: string;
  tags?: string[];
  previewUrl?: string;
  sourceHint?: string;
}

export interface WebAigcImageSearchOptions {
  topK?: number;
  minScore?: number;
  mode?: WebAigcImageSearchMode;
}

export interface ImageSearchNodeInput {
  query?: string;
  tags?: string[];
  referenceImage?: WebAigcReferenceImageInput;
  options?: WebAigcImageSearchOptions;
  context?: Record<string, unknown>;
}

export interface ImageSearchNodeExecutionRequest {
  nodeType: ImageSearchNodeType;
  input?: ImageSearchNodeInput;
}

export interface WebAigcImageSearchRequest {
  query?: string;
  tags?: string[];
  referenceImage?: WebAigcReferenceImageInput;
  options?: WebAigcImageSearchOptions;
}

export interface WebAigcImageSearchResultItem {
  imageId: string;
  title: string;
  summary: string;
  previewUrl: string;
  sourceUrl: string;
  source: string;
  tags: string[];
  availability: WebAigcImageAvailability;
  score: number;
  matchedBy: Array<"query" | "tags" | "reference">;
}

export interface WebAigcImageSearchResponse {
  query: string;
  normalized: {
    textQuery?: string;
    tags: string[];
    referenceDescription?: string;
    referenceTags: string[];
  };
  results: WebAigcImageSearchResultItem[];
  totalCandidates: number;
  degraded: boolean;
  fallbackReason?: string;
  warnings: string[];
  mode: WebAigcImageSearchMode;
}

export interface ImageSearchNodeExecutionResult {
  ok: true;
  nodeType: ImageSearchNodeType;
  output: WebAigcImageSearchResponse & {
    status: "completed" | "degraded";
    result: WebAigcImageSearchResponse;
    previews: string[];
    sourceDomains: string[];
    availabilitySummary: {
      available: number;
      previewOnly: number;
      unavailable: number;
    };
    context: Record<string, unknown>;
  };
}
