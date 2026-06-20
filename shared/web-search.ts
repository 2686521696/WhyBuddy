export const WEB_SEARCH_API = {
  EXECUTE: "POST /api/web-search/nodes/execute",
} as const;

export type WebSearchMode = "mock" | "hybrid";
export type WebSearchStatus = "completed" | "empty" | "error" | "permission_denied";

export interface WebSearchProvenance {
  provider: "fake" | string;
  source: string;
  query: string;
  auditId?: string;
  permission?: Record<string, unknown>;
}

export interface WebSearchError {
  code: string;
  message: string;
}

export interface WebSearchRequestOptions {
  topK?: number;
  mode?: WebSearchMode;
  /** Per-request fetch timeout (ms). HTML scrape uses a shorter first pass by default. */
  timeoutMs?: number;
  /** Skip in-memory result cache (tests / forced refresh). */
  skipCache?: boolean;
}

export interface WebSearchRequest {
  query: string;
  options?: WebSearchRequestOptions;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
  provenance?: WebSearchProvenance;
}

export interface WebSearchResponse {
  ok?: boolean;
  query: string;
  results: WebSearchResultItem[];
  totalCandidates: number;
  latencyMs: number;
  mode: WebSearchMode;
  error?: WebSearchError;
  provenance?: WebSearchProvenance;
}
