import type { UnifiedQueryOptions } from "../knowledge/types.js";
import type {
  WebAigcSearchOptions,
  WebAigcSearchScope,
} from "../rag/web-aigc-search.js";

export const WEB_QA_API = {
  EXECUTE_NODE: "POST /api/web-qa/nodes/execute",
} as const;

export type WebQaNodeType = "web_qa";
export type WebQaExecutionStatus = "completed" | "fallback" | "failed";
export type WebQaAnswerStrategy =
  | "inline_pages"
  | "document_search"
  | "knowledge_fallback";
export type WebQaLinkTargetKind =
  | "internal_route"
  | "external_url"
  | "task_detail";
export type WebQaOpenMode = "push" | "replace" | "new_tab";

export interface WebQaSourcePointer {
  pageId?: string;
  title?: string;
  href?: string;
  route?: string;
  targetKind?: WebQaLinkTargetKind;
  openMode?: WebQaOpenMode;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export interface WebQaInlinePageInput extends WebQaSourcePointer {
  content?: string;
  summary?: string;
  snippet?: string;
}

export interface WebQaSearchInput {
  query?: string;
  scope?: WebAigcSearchScope;
  options?: WebAigcSearchOptions;
  linkMap?: Record<string, WebQaSourcePointer>;
}

export interface WebQaKnowledgeFallbackInput {
  enabled?: boolean;
  projectId?: string;
  options?: Partial<UnifiedQueryOptions>;
}

export interface WebQaNodeInput {
  question?: string;
  pages?: WebQaInlinePageInput[];
  search?: WebQaSearchInput;
  knowledgeFallback?: WebQaKnowledgeFallbackInput;
  systemPrompt?: string;
  answerStyle?: string;
  workflowId?: string;
  sessionId?: string;
  missionId?: string;
  agentId?: string;
  stage?: string;
  context?: Record<string, unknown>;
}

export interface WebQaSourceLink {
  source: "page" | "search" | "knowledge_fallback";
  label: string;
  href?: string;
  pageId?: string;
  route?: string;
  targetKind?: WebQaLinkTargetKind;
  openMode?: WebQaOpenMode;
  external?: boolean;
}

export interface WebQaEvidenceItem {
  source: "page" | "search" | "knowledge_fallback";
  title: string;
  detail: string;
  snippet?: string;
  href?: string;
  documentId?: string;
  score?: number;
}

export interface WebQaNodeExecutionRequest {
  nodeType: WebQaNodeType;
  input?: WebQaNodeInput;
}

export interface WebQaNodeExecutionResult {
  ok: boolean;
  nodeType: WebQaNodeType;
  output: {
    status: WebQaExecutionStatus;
    strategy: WebQaAnswerStrategy;
    answer: string;
    reply: {
      role: "assistant";
      content: string;
    };
    citations: string[];
    sourceLinks: WebQaSourceLink[];
    evidenceList: WebQaEvidenceItem[];
    fallbackUsed: boolean;
    fallbackReason?: string;
    error?: string;
    metadata: {
      projectId?: string;
      question: string;
      pageCount: number;
      sourceCount: number;
      searchQuery?: string;
      searchResultCount?: number;
      providerClosure?: Record<string, unknown>;
      downstreamConsumers: Array<"end" | "file_generation">;
    };
    observability?: Record<string, unknown>;
  };
}
