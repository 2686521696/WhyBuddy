export const WEB_AIGC_LONG_TEXT_EXTRACTION_API = {
  EXECUTE: "POST /api/long-text-extraction/nodes/execute",
} as const;

export const WEB_AIGC_LONG_TEXT_EXTRACTION_NODE_TYPES = [
  "long_text_extraction",
] as const;

export type LongTextExtractionNodeType =
  (typeof WEB_AIGC_LONG_TEXT_EXTRACTION_NODE_TYPES)[number];

export const WEB_AIGC_LONG_TEXT_EXTRACTION_MODES = [
  "balanced",
  "summary_first",
  "fragments_first",
] as const;

export type LongTextExtractionMode =
  (typeof WEB_AIGC_LONG_TEXT_EXTRACTION_MODES)[number];

export interface LongTextExtractionNodeInput {
  text?: string;
  title?: string;
  mode?: LongTextExtractionMode;
  maxInputChars?: number;
  maxSummaryChars?: number;
  maxKeywords?: number;
  maxFragments?: number;
  fragmentCharLimit?: number;
  context?: Record<string, unknown>;
}

export interface LongTextExtractionNodeExecutionRequest {
  nodeType: LongTextExtractionNodeType;
  input?: LongTextExtractionNodeInput;
}

export interface LongTextExtractionFragment {
  fragmentId: string;
  chunkIndex: number;
  title: string;
  excerpt: string;
  score: number;
  startOffset: number;
  endOffset: number;
}

export interface LongTextExtractionKeyword {
  keyword: string;
  count: number;
  score: number;
}

export interface LongTextExtractionChunkInfo {
  chunkIndex: number;
  charCount: number;
  tokenEstimate: number;
  truncated: boolean;
}

export interface LongTextExtractionNodeExecutionResult {
  ok: true;
  nodeType: LongTextExtractionNodeType;
  output: {
    status: "completed";
    title?: string;
    mode: LongTextExtractionMode;
    source: {
      originalCharCount: number;
      processedCharCount: number;
      chunkCount: number;
      truncated: boolean;
    };
    summary: {
      short: string;
      paragraph: string;
    };
    keywords: LongTextExtractionKeyword[];
    fragments: LongTextExtractionFragment[];
    chunks: LongTextExtractionChunkInfo[];
    structured: {
      title?: string;
      summary: string;
      keywords: string[];
      fragments: Array<{
        title: string;
        excerpt: string;
        score: number;
      }>;
      notes: string[];
    };
    warnings: string[];
    context: Record<string, unknown>;
  };
}
