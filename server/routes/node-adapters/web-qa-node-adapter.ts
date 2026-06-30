import {
  executeChatNode,
  type ChatNodeAdapterDeps,
} from "./chat-node-adapter.js";
import {
  executeOpenPageNode,
  type OpenPageNodeAdapterDeps,
} from "./open-page-node-adapter.js";
import type {
  Entity,
  Relation,
  UnifiedQueryOptions,
  UnifiedKnowledgeResult,
} from "../../../shared/knowledge/types.js";
import type {
  WebAigcDocumentSearchResponse,
  WebAigcSearchRequest,
} from "../../../shared/rag/web-aigc-search.js";
import type {
  WebQaAnswerStrategy,
  WebQaEvidenceItem,
  WebQaInlinePageInput,
  WebQaLinkTargetKind,
  WebQaNodeExecutionRequest,
  WebQaNodeExecutionResult,
  WebQaNodeInput,
  WebQaOpenMode,
  WebQaSearchInput,
  WebQaSourceLink,
  WebQaSourcePointer,
  WebQaNodeType,
} from "../../../shared/web-qa/contracts.js";

type WebQaSearchExecutor = (
  request: WebAigcSearchRequest,
) => Promise<WebAigcDocumentSearchResponse>;

export interface WebQaNodeAdapterDeps
  extends Pick<ChatNodeAdapterDeps, "executeLLM" | "getConfig" | "now">,
    Pick<OpenPageNodeAdapterDeps, "permissionEngine"> {
  documentSearch?: WebQaSearchExecutor;
  knowledgeService?: {
    query(
      question: string,
      projectId: string,
      options?: Partial<UnifiedQueryOptions>,
    ): Promise<UnifiedKnowledgeResult>;
  };
  // 105 longtail cutover: python web-qa facade; Node is thin proxy when this present
  executePythonRuntime?: (input: WebQaNodeInput) => Promise<any>;
}

interface PreparedPageContext {
  sourceLink: WebQaSourceLink;
  evidence: WebQaEvidenceItem;
  citation: string;
  contextLine: string;
}

interface PreparedSearchContext {
  searchQuery: string;
  projectId: string;
  citations: string[];
  sourceLinks: WebQaSourceLink[];
  evidenceList: WebQaEvidenceItem[];
  contextBlock: string;
  resultCount: number;
}

const DOWNSTREAM_CONSUMERS = ["end", "file_generation"] as const;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeQuestion(input: WebQaNodeInput): string {
  const question = normalizeString(input.question);
  if (!question) {
    throw new Error("Web QA node input requires question.");
  }

  return question;
}

function normalizePages(value: unknown): WebQaInlinePageInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is WebQaInlinePageInput =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function normalizeObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function normalizeSearchInput(value: unknown): WebQaSearchInput | undefined {
  const candidate = normalizeObject(value);
  if (!candidate) {
    return undefined;
  }

  return candidate as unknown as WebQaSearchInput;
}

function buildOpenPageInput(pointer: WebQaSourcePointer) {
  return {
    ...(normalizeString(pointer.pageId) ? { pageId: normalizeString(pointer.pageId) } : {}),
    ...(normalizeString(pointer.route) ? { route: normalizeString(pointer.route) } : {}),
    ...(normalizeString(pointer.href) ? { href: normalizeString(pointer.href) } : {}),
    ...(normalizeString(pointer.title) ? { title: normalizeString(pointer.title) } : {}),
    ...(pointer.targetKind ? { targetKind: pointer.targetKind } : {}),
    ...(pointer.openMode ? { openMode: pointer.openMode } : {}),
    ...(pointer.params && typeof pointer.params === "object" ? { params: pointer.params } : {}),
    ...(pointer.query && typeof pointer.query === "object" ? { query: pointer.query } : {}),
  };
}

async function resolveSourceLink(
  pointer: WebQaSourcePointer,
  deps: WebQaNodeAdapterDeps,
  source: WebQaSourceLink["source"],
  fallbackLabel: string,
): Promise<WebQaSourceLink> {
  const input = buildOpenPageInput(pointer);
  if (!input.pageId && !input.route && !input.href) {
    return {
      source,
      label: fallbackLabel,
    };
  }

  const result = await executeOpenPageNode(
    {
      nodeType: "open_page",
      input,
    },
    {
      permissionEngine: deps.permissionEngine,
    },
  );

  return {
    source,
    label:
      result.output.title ||
      normalizeString(pointer.title) ||
      result.output.pageId ||
      fallbackLabel,
    href: result.output.target.href,
    pageId: result.output.target.pageId,
    route: result.output.target.route,
    targetKind: result.output.target.kind as WebQaLinkTargetKind,
    openMode: result.output.target.openMode as WebQaOpenMode,
    ...(result.output.target.external ? { external: true } : {}),
  };
}

async function prepareInlinePages(
  pages: WebQaInlinePageInput[],
  deps: WebQaNodeAdapterDeps,
): Promise<PreparedPageContext[]> {
  const prepared: PreparedPageContext[] = [];

  for (const [index, page] of pages.entries()) {
    const summary =
      normalizeString(page.summary) ||
      normalizeString(page.snippet) ||
      normalizeString(page.content);
    if (!summary) {
      continue;
    }

    const label =
      normalizeString(page.title) ||
      normalizeString(page.pageId) ||
      normalizeString(page.route) ||
      normalizeString(page.href) ||
      `网页 ${index + 1}`;
    const sourceLink = await resolveSourceLink(page, deps, "page", label);

    prepared.push({
      sourceLink,
      citation: `${label}: ${summary}`,
      evidence: {
        source: "page",
        title: label,
        detail: summary,
        ...(normalizeString(page.snippet) ? { snippet: normalizeString(page.snippet) } : {}),
        ...(sourceLink.href ? { href: sourceLink.href } : {}),
      },
      contextLine: `${label}\n摘要：${summary}${
        normalizeString(page.content) ? `\n正文：${normalizeString(page.content)}` : ""
      }`,
    });
  }

  return prepared;
}

function normalizeKnowledgeOptions(
  value: unknown,
): Partial<UnifiedQueryOptions> | undefined {
  const candidate = normalizeObject(value);
  if (!candidate) {
    return undefined;
  }

  if (
    candidate.mode === "preferStructured" ||
    candidate.mode === "preferSemantic" ||
    candidate.mode === "balanced"
  ) {
    return {
      mode: candidate.mode,
    };
  }

  return undefined;
}

async function prepareSearchContext(
  question: string,
  search: WebQaSearchInput | undefined,
  deps: WebQaNodeAdapterDeps,
): Promise<PreparedSearchContext | undefined> {
  if (!search) {
    return undefined;
  }

  const projectId = normalizeString(search.scope?.projectId);
  if (!projectId) {
    throw new Error("Web QA search scope.projectId is required.");
  }

  const executor = deps.documentSearch;
  if (!executor) {
    throw new Error("Web QA documentSearch executor is not available.");
  }

  const searchQuery = normalizeString(search.query) || question;
  const response = await executor({
    query: searchQuery,
    scope: {
      projectId,
      ...(Array.isArray(search.scope?.sourceTypes)
        ? { sourceTypes: search.scope?.sourceTypes }
        : {}),
      ...(Array.isArray(search.scope?.documentIds)
        ? { documentIds: search.scope?.documentIds }
        : {}),
      ...(normalizeString(search.scope?.agentId)
        ? { agentId: normalizeString(search.scope?.agentId) }
        : {}),
      ...(normalizeString(search.scope?.codeLanguage)
        ? { codeLanguage: normalizeString(search.scope?.codeLanguage) }
        : {}),
    },
    ...(search.options ? { options: search.options } : {}),
  });

  const citations: string[] = [];
  const sourceLinks: WebQaSourceLink[] = [];
  const evidenceList: WebQaEvidenceItem[] = [];
  const contextLines: string[] = [];
  const linkMap = search.linkMap ?? {};

  for (const hit of response.results) {
    const summary = normalizeString(hit.summary) || "未提供摘要";
    const highlights = hit.highlights.filter(Boolean);
    const label = hit.documentId;
    const pointer = normalizeObject(linkMap[hit.documentId]) as WebQaSourcePointer | undefined;
    const sourceLink = pointer
      ? await resolveSourceLink(pointer, deps, "search", label)
      : {
          source: "search" as const,
          label,
        };

    citations.push(
      `${hit.documentId}: ${summary}${
        highlights.length > 0 ? ` [${highlights.slice(0, 2).join(" | ")}]` : ""
      }`,
    );
    sourceLinks.push(sourceLink);
    evidenceList.push({
      source: "search",
      title: hit.documentId,
      detail: summary,
      ...(highlights[0] ? { snippet: highlights[0] } : {}),
      ...(sourceLink.href ? { href: sourceLink.href } : {}),
      documentId: hit.documentId,
      score: hit.score,
    });
    contextLines.push(
      [
        `文档：${hit.documentId}`,
        `摘要：${summary}`,
        highlights.length > 0 ? `高亮：${highlights.slice(0, 2).join(" | ")}` : "",
        `得分：${hit.score.toFixed(2)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return {
    searchQuery,
    projectId,
    citations,
    sourceLinks,
    evidenceList,
    contextBlock: contextLines.join("\n\n"),
    resultCount: response.results.length,
  };
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function dedupeSourceLinks(links: WebQaSourceLink[]): WebQaSourceLink[] {
  const seen = new Set<string>();
  const normalized: WebQaSourceLink[] = [];

  for (const link of links) {
    const key = [
      link.source,
      link.pageId ?? "",
      link.href ?? "",
      link.route ?? "",
      link.label,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(link);
  }

  return normalized;
}

function buildKnowledgeFallbackCitations(
  result: UnifiedKnowledgeResult,
): string[] {
  const entityCitations = result.structuredResults.entities.map(
    (entity) => `${entity.entityType}:${entity.name}`,
  );
  const relationCitations = result.structuredResults.relations.map(
    (relation) =>
      `${relation.relationType}:${relation.sourceEntityId}->${relation.targetEntityId}`,
  );
  const semanticCitations = result.semanticResults.map((hit, index) => {
    const candidate =
      typeof hit === "object" && hit !== null && "id" in hit
        ? (hit as { id?: unknown }).id
        : undefined;
    return `semantic:${typeof candidate === "string" ? candidate : index + 1}`;
  });

  return [...entityCitations, ...relationCitations, ...semanticCitations];
}

function buildEntityEvidence(entity: Entity): WebQaEvidenceItem {
  return {
    source: "knowledge_fallback",
    title: entity.name,
    detail: entity.description || entity.entityType,
  };
}

function buildRelationEvidence(relation: Relation): WebQaEvidenceItem {
  return {
    source: "knowledge_fallback",
    title: relation.relationType,
    detail:
      relation.evidence ||
      `${relation.sourceEntityId} -> ${relation.targetEntityId}`,
  };
}

function buildKnowledgeFallbackEvidence(
  result: UnifiedKnowledgeResult,
): WebQaEvidenceItem[] {
  const entityEvidence = result.structuredResults.entities.map(buildEntityEvidence);
  const relationEvidence = result.structuredResults.relations.map(
    buildRelationEvidence,
  );
  const semanticEvidence = result.semanticResults.map((hit, index) => {
    const candidate =
      typeof hit === "object" && hit !== null
        ? (hit as { content?: unknown; score?: unknown })
        : {};
    return {
      source: "knowledge_fallback" as const,
      title: `semantic-${index + 1}`,
      detail:
        typeof candidate.content === "string"
          ? candidate.content
          : typeof candidate.score === "number"
            ? `score=${candidate.score}`
            : "semantic hit",
    };
  });

  return [...entityEvidence, ...relationEvidence, ...semanticEvidence];
}

async function answerWithChat(input: {
  question: string;
  contextSections: string[];
  citations: string[];
  workflowId?: string;
  sessionId?: string;
  missionId?: string;
  agentId?: string;
  stage?: string;
  systemPrompt?: string;
  answerStyle?: string;
  deps: WebQaNodeAdapterDeps;
}): Promise<string> {
  const contextSections = input.contextSections.filter(Boolean);
  const answerStyle = normalizeString(input.answerStyle);
  const systemPrompt = normalizeString(input.systemPrompt);
  const composedSystemPrompt = [
    "你是网页问答节点，请严格基于提供的网页/检索上下文回答问题。",
    "回答应简洁、可执行，并优先引用证据。",
    answerStyle ? `回答风格：${answerStyle}` : "",
    systemPrompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await executeChatNode(
    {
      nodeType: "dialogue",
      input: {
        prompt: input.question,
        systemPrompt: composedSystemPrompt,
        context: {
          webQa: contextSections.join("\n\n"),
        },
        citations: input.citations,
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.missionId ? { missionId: input.missionId } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.stage ? { stage: input.stage } : {}),
      },
    },
    {
      ...(input.deps.executeLLM ? { executeLLM: input.deps.executeLLM } : {}),
      ...(input.deps.getConfig ? { getConfig: input.deps.getConfig } : {}),
      ...(input.deps.now ? { now: input.deps.now } : {}),
    },
  );

  return result.output.reply.content;
}

function isKnowledgeFallbackEnabled(input: WebQaNodeInput): boolean {
  if (input.knowledgeFallback?.enabled === false) {
    return false;
  }

  return Boolean(normalizeString(input.knowledgeFallback?.projectId));
}

export function isWebQaNodeType(value: unknown): value is WebQaNodeType {
  return value === "web_qa";
}

function buildCompletedResult(input: {
  strategy: WebQaAnswerStrategy;
  answer: string;
  citations: string[];
  sourceLinks: WebQaSourceLink[];
  evidenceList: WebQaEvidenceItem[];
  fallbackUsed: boolean;
  fallbackReason?: string;
  question: string;
  projectId?: string;
  searchQuery?: string;
  searchResultCount?: number;
  providerClosure?: Record<string, unknown>;
  observability?: Record<string, unknown>;
}): WebQaNodeExecutionResult {
  const status = input.fallbackUsed ? "fallback" : "completed";
  const pageCount = input.evidenceList.filter((item) => item.source === "page").length;
  const sourceCount = dedupeSourceLinks(input.sourceLinks).length;
  const observability = {
    eventKey: "external.web_qa" as const,
    nodeType: "web_qa" as const,
    strategy: input.strategy,
    question: input.question,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    pageCount,
    inlinePageCount: pageCount,
    sourceCount,
    searchUsed: typeof input.searchQuery === "string" && input.searchQuery.length > 0,
    ...(input.searchQuery ? { searchQuery: input.searchQuery } : {}),
    ...(typeof input.searchResultCount === "number"
      ? { searchResultCount: input.searchResultCount }
      : {}),
    fallbackUsed: input.fallbackUsed,
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.observability ?? {}),
  };

  return {
    ok: true,
    nodeType: "web_qa",
    output: {
      status,
      strategy: input.strategy,
      answer: input.answer,
      reply: {
        role: "assistant",
        content: input.answer,
      },
      citations: dedupeStrings(input.citations),
      sourceLinks: dedupeSourceLinks(input.sourceLinks),
      evidenceList: input.evidenceList,
      fallbackUsed: input.fallbackUsed,
      ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
      metadata: {
        ...(input.projectId ? { projectId: input.projectId } : {}),
        question: input.question,
        pageCount,
        sourceCount,
        ...(input.searchQuery ? { searchQuery: input.searchQuery } : {}),
        ...(typeof input.searchResultCount === "number"
          ? { searchResultCount: input.searchResultCount }
          : {}),
        ...(input.providerClosure ? { providerClosure: input.providerClosure } : {}),
        downstreamConsumers: [...DOWNSTREAM_CONSUMERS],
      },
      observability,
    },
  };
}

function buildFailedResult(
  question: string,
  error: string,
  projectId?: string,
  providerClosure?: Record<string, unknown>,
): WebQaNodeExecutionResult {
  return {
    ok: false,
    nodeType: "web_qa",
    output: {
      status: "failed",
      strategy: "knowledge_fallback",
      answer: "",
      reply: {
        role: "assistant",
        content: "",
      },
      citations: [],
      sourceLinks: [],
      evidenceList: [],
      fallbackUsed: false,
      error,
      metadata: {
        ...(projectId ? { projectId } : {}),
        question,
        pageCount: 0,
        sourceCount: 0,
        ...(providerClosure ? { providerClosure } : {}),
        downstreamConsumers: [...DOWNSTREAM_CONSUMERS],
      },
      observability: {
        eventKey: "external.web_qa",
        nodeType: "web_qa",
        status: "failed",
        ...(providerClosure ? { providerClosure } : {}),
      },
    },
  };
}

export async function executeWebQaNode(
  request: WebQaNodeExecutionRequest,
  deps: WebQaNodeAdapterDeps = {},
): Promise<WebQaNodeExecutionResult> {
  if (!isWebQaNodeType(request.nodeType)) {
    throw new Error("Unsupported web_qa node type.");
  }

  const input = request.input ?? {};
  // python thin proxy priority for web-qa longtail cutover 105
  if (deps.executePythonRuntime) {
    try {
      const py = await deps.executePythonRuntime(input);
      return {
        ok: py?.ok !== false,
        nodeType: "web_qa",
        output: {
          status: py?.status || "completed",
          strategy: py?.strategy || "document_search",
          answer: py?.answer || "python web qa proxy",
          citations: py?.citations || [],
          sourceLinks: py?.sourceLinks || [],
          evidenceList: py?.evidenceList || [],
          fallbackUsed: !!py?.fallbackUsed,
          fallbackReason: py?.fallbackReason,
          metadata: py?.metadata || { python: true },
          observability: { eventKey: "external.web_qa", nodeType: "web_qa", strategy: "python" },
        },
      } as any;
    } catch (error: any) {
      return {
        ok: true,
        nodeType: "web_qa",
        output: {
          status: "degraded",
          strategy: "fallback",
          answer: "",
          citations: [],
          sourceLinks: [],
          evidenceList: [],
          fallbackUsed: true,
          fallbackReason: `python web-qa failed visibly: ${error?.message || error}`,
          metadata: { providerClosure: { ownership: "python", status: "error" } },
          observability: {},
        },
      } as any;
    }
  }

  const inputContext = normalizeObject(input.context);
  // consume python provider closure summary for web-qa (explicit config_missing until full python cutover)
  const providerClosure = normalizeObject(inputContext?.providerClosure);
  const question = normalizeQuestion(input);
  const pages = normalizePages(input.pages);
  const pageContexts = await prepareInlinePages(pages, deps);
  const searchInput = normalizeSearchInput(input.search);

  let searchContext: PreparedSearchContext | undefined;
  let searchError: Error | undefined;
  if (searchInput) {
    try {
      searchContext = await prepareSearchContext(question, searchInput, deps);
    } catch (error) {
      searchError = error instanceof Error ? error : new Error("Web QA search failed.");
    }
  }

  const citations = dedupeStrings([
    ...pageContexts.map((page) => page.citation),
    ...(searchContext?.citations ?? []),
  ]);
  const sourceLinks = [
    ...pageContexts.map((page) => page.sourceLink),
    ...(searchContext?.sourceLinks ?? []),
  ];
  const evidenceList = [
    ...pageContexts.map((page) => page.evidence),
    ...(searchContext?.evidenceList ?? []),
  ];
  const contextSections = [
    pageContexts.length > 0
      ? `网页上下文：\n${pageContexts.map((page) => page.contextLine).join("\n\n")}`
      : "",
    searchContext?.contextBlock ? `检索上下文：\n${searchContext.contextBlock}` : "",
  ].filter(Boolean);

  if (contextSections.length > 0) {
    const answer = await answerWithChat({
      question,
      contextSections,
      citations,
      workflowId: normalizeString(input.workflowId),
      sessionId: normalizeString(input.sessionId),
      missionId: normalizeString(input.missionId),
      agentId: normalizeString(input.agentId),
      stage: normalizeString(input.stage) ?? "web_qa",
      systemPrompt: input.systemPrompt,
      answerStyle: input.answerStyle,
      deps,
    });

    return buildCompletedResult({
      strategy:
        searchContext && searchContext.resultCount > 0
          ? "document_search"
          : "inline_pages",
      answer,
      citations,
      sourceLinks,
      evidenceList,
      fallbackUsed: false,
      question,
      projectId: searchContext?.projectId,
      searchQuery: searchContext?.searchQuery,
      searchResultCount: searchContext?.resultCount,
      providerClosure,
      observability: {
        pageCount: pageContexts.length,
        searchUsed: Boolean(searchContext),
        searchError: searchError?.message,
        ...(providerClosure ? { providerClosure } : {}),
      },
    });
  }

  if (isKnowledgeFallbackEnabled(input)) {
    if (!deps.knowledgeService) {
      throw new Error("Web QA knowledge fallback requires knowledgeService.");
    }

    const projectId = normalizeString(input.knowledgeFallback?.projectId);
    if (!projectId) {
      throw new Error("Web QA knowledge fallback requires projectId.");
    }

    const fallbackResult = await deps.knowledgeService.query(
      question,
      projectId,
      normalizeKnowledgeOptions(input.knowledgeFallback?.options),
    );

    return buildCompletedResult({
      strategy: "knowledge_fallback",
      answer: fallbackResult.mergedSummary,
      citations: buildKnowledgeFallbackCitations(fallbackResult),
      sourceLinks: [],
      evidenceList: buildKnowledgeFallbackEvidence(fallbackResult),
      fallbackUsed: true,
      fallbackReason:
        searchError?.message ||
        "网页内容不可用，已回退到知识问答底座。",
      question,
      projectId,
      searchQuery: searchInput?.query,
      searchResultCount: searchContext?.resultCount ?? 0,
      providerClosure,
      observability: {
        pageCount: pageContexts.length,
        searchUsed: Boolean(searchInput),
        searchError: searchError?.message,
        ...(providerClosure ? { providerClosure } : {}),
      },
    });
  }

  return buildFailedResult(
    question,
    searchError?.message || "No page context or search results available for web_qa.",
    normalizeString(searchInput?.scope?.projectId),
    providerClosure,
  );
}
