import { getAIConfig } from "../../core/ai-config.js";
import { callLLM } from "../../core/llm-client.js";
import db from "../../db/index.js";
import { sessionStore as runtimeSessionStore } from "../../memory/session-store.js";
import type {
  WebAigcDocumentSearchResponse,
  WebAigcSearchRequest,
} from "../../../shared/rag/web-aigc-search.js";

export type ChatNodeType = "llm" | "dialogue";

export interface ChatNodeMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatNodeToolCall {
  name: string;
  arguments: string;
  result?: string;
}

export interface ChatNodeDocumentSearchInput
  extends Omit<WebAigcSearchRequest, "query"> {
  query?: string;
}

export type ChatNodeDocumentSearchResult = WebAigcDocumentSearchResponse;

export type ChatNodeDocumentSearchExecutor = (
  request: WebAigcSearchRequest,
) => Promise<ChatNodeDocumentSearchResult>;

export interface ChatNodeInput {
  messages?: ChatNodeMessage[];
  prompt?: string;
  systemPrompt?: string;
  context?: unknown;
  variables?: Record<string, unknown>;
  workflowId?: string;
  sessionId?: string;
  missionId?: string;
  agentId?: string;
  stage?: string;
  citations?: string[];
  toolCalls?: Array<{
    name?: string;
    arguments?: unknown;
    result?: unknown;
  }>;
  thinking?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  documentSearch?: ChatNodeDocumentSearchInput;
}

export interface ChatNodeExecutionRequest {
  nodeType: ChatNodeType;
  input?: ChatNodeInput;
}

export interface ChatNodeExecutionResult {
  ok: true;
  nodeType: ChatNodeType;
  output: {
    content: string;
    model: string;
    latencyMs: number;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    messages: ChatNodeMessage[];
    reply: {
      role: "assistant";
      content: string;
    };
    observability?: {
      workflowId?: string;
      sessionId?: string;
      missionId?: string;
      agentId?: string;
      stage?: string;
      persistedToWorkflow: boolean;
      persistedToSession: boolean;
      citations?: string[];
      toolCalls?: ChatNodeToolCall[];
      thinking?: string;
    };
  };
}

export interface ChatNodeMessageStore {
  createMessage(message: {
    workflow_id: string;
    from_agent: string;
    to_agent: string;
    stage: string;
    content: string;
    metadata: Record<string, unknown> | null;
  }): unknown;
}

export interface ChatNodeSessionStore {
  appendLLMExchange(
    agentId: string,
    options: {
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: Record<string, unknown> | null;
    },
  ): void;
}

export interface ChatNodeAdapterDeps {
  executeLLM?: typeof callLLM;
  getConfig?: typeof getAIConfig;
  now?: () => number;
  messageStore?: ChatNodeMessageStore;
  sessionStore?: ChatNodeSessionStore;
  documentSearch?: ChatNodeDocumentSearchExecutor;
}

const defaultMessageStore: ChatNodeMessageStore | undefined =
  typeof (db as Partial<ChatNodeMessageStore>).createMessage === "function"
    ? (db as unknown as ChatNodeMessageStore)
    : undefined;

const defaultSessionStore: ChatNodeSessionStore | undefined =
  typeof (runtimeSessionStore as Partial<ChatNodeSessionStore>).appendLLMExchange === "function"
    ? runtimeSessionStore
    : undefined;

let defaultDocumentSearchPromise:
  | Promise<ChatNodeDocumentSearchExecutor | undefined>
  | undefined;

function isChatNodeMessage(value: unknown): value is ChatNodeMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.role === "system" ||
      candidate.role === "user" ||
      candidate.role === "assistant") &&
    typeof candidate.content === "string"
  );
}

function normalizeMessages(messages: unknown): ChatNodeMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter(isChatNodeMessage);
}

function stringifyContext(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyContext(entry))
      .filter(Boolean)
      .join("\n");
  }

  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function stringifyJson(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || "{}";
  }

  if (value === undefined) {
    return "{}";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringifyToolCallResult(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function mergeStringArrays(...collections: Array<string[] | undefined>): string[] | undefined {
  const merged = collections
    .flatMap((collection) => collection ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (merged.length === 0) {
    return undefined;
  }

  return Array.from(new Set(merged));
}

function normalizeToolCalls(value: unknown): ChatNodeToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter(
      (
        entry,
      ): entry is {
        name?: unknown;
        arguments?: unknown;
        result?: unknown;
      } => typeof entry === "object" && entry !== null,
    )
    .map((entry) => {
      const name = normalizeString(entry.name) ?? "tool";
      const argumentsText = stringifyJson(entry.arguments);
      const result = stringifyToolCallResult(entry.result);
      return {
        name,
        arguments: argumentsText,
        ...(result !== undefined ? { result } : {}),
      };
    });

  return normalized.length > 0 ? normalized : undefined;
}

function clampTemperature(value: unknown): number {
  return Math.max(0, Math.min(2, Number(value) || 0.7));
}

function clampMaxTokens(value: unknown): number {
  return Math.max(64, Math.min(4000, Number(value) || 400));
}

function normalizeDocumentSearchMode(
  value: unknown,
): "semantic" | "keyword" | "hybrid" | undefined {
  if (value !== "semantic" && value !== "keyword" && value !== "hybrid") {
    return undefined;
  }

  return value;
}

function normalizeDocumentSearchInput(
  value: unknown,
): ChatNodeDocumentSearchInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const scopeValue = candidate.scope;
  if (!scopeValue || typeof scopeValue !== "object" || Array.isArray(scopeValue)) {
    throw new Error("documentSearch.scope.projectId is required.");
  }

  const scopeCandidate = scopeValue as Record<string, unknown>;
  const projectId = normalizeString(scopeCandidate.projectId);
  if (!projectId) {
    throw new Error("documentSearch.scope.projectId is required.");
  }

  const optionsValue =
    candidate.options && typeof candidate.options === "object" && !Array.isArray(candidate.options)
      ? (candidate.options as Record<string, unknown>)
      : undefined;
  const topK = normalizeNumber(optionsValue?.topK);
  const minScore = normalizeNumber(optionsValue?.minScore);
  const mode = normalizeDocumentSearchMode(optionsValue?.mode);
  const expandContext = normalizeBoolean(optionsValue?.expandContext);
  const contextWindowChunks = normalizeNumber(optionsValue?.contextWindowChunks);

  return {
    ...(normalizeString(candidate.query) ? { query: normalizeString(candidate.query) } : {}),
    scope: {
      projectId,
      ...(normalizeStringArray(scopeCandidate.sourceTypes)
        ? {
            sourceTypes: normalizeStringArray(scopeCandidate.sourceTypes) as NonNullable<
              ChatNodeDocumentSearchInput["scope"]["sourceTypes"]
            >,
          }
        : {}),
      ...(normalizeStringArray(scopeCandidate.documentIds)
        ? {
            documentIds: normalizeStringArray(scopeCandidate.documentIds),
          }
        : {}),
      ...(normalizeString(scopeCandidate.agentId)
        ? { agentId: normalizeString(scopeCandidate.agentId) }
        : {}),
      ...(normalizeString(scopeCandidate.codeLanguage)
        ? { codeLanguage: normalizeString(scopeCandidate.codeLanguage) }
        : {}),
    },
    ...(optionsValue
      ? {
          options: {
            ...(typeof topK === "number" ? { topK } : {}),
            ...(typeof minScore === "number" ? { minScore } : {}),
            ...(mode ? { mode } : {}),
            ...(typeof expandContext === "boolean" ? { expandContext } : {}),
            ...(typeof contextWindowChunks === "number"
              ? { contextWindowChunks }
              : {}),
          },
        }
      : {}),
  };
}

function mergeContext(base: unknown, addition: unknown): unknown {
  if (addition === undefined || addition === null) {
    return base;
  }

  if (base === undefined || base === null || base === "") {
    return addition;
  }

  if (Array.isArray(base)) {
    return [...base, addition];
  }

  return [base, addition];
}

function buildDocumentSearchCitations(
  response: ChatNodeDocumentSearchResult,
): string[] | undefined {
  const citations = response.results
    .map((result) => {
      const highlights = result.highlights.filter(Boolean).slice(0, 2).join(" | ");
      return highlights
        ? `${result.documentId}: ${result.summary} [${highlights}]`
        : `${result.documentId}: ${result.summary}`;
    })
    .filter(Boolean);

  return citations.length > 0 ? citations : undefined;
}

function buildDocumentSearchToolResult(
  response: ChatNodeDocumentSearchResult,
): string {
  const preview = response.results
    .slice(0, 3)
    .map((result) => `${result.documentId}(${result.score.toFixed(2)})`)
    .join(", ");

  return [
    `Matched ${response.results.length} documents in ${response.latencyMs}ms.`,
    `Mode: ${response.mode}.`,
    preview ? `Top hits: ${preview}.` : "Top hits: none.",
  ].join(" ");
}

function buildDocumentSearchContext(
  response: ChatNodeDocumentSearchResult,
): Record<string, unknown> {
  return {
    documentSearch: {
      query: response.query,
      mode: response.mode,
      latencyMs: response.latencyMs,
      totalCandidates: response.totalCandidates,
      documents: response.results.map((result) => ({
        documentId: result.documentId,
        sourceType: result.sourceType,
        score: result.score,
        summary: result.summary,
        highlights: result.highlights,
      })),
    },
  };
}

async function getDefaultDocumentSearchExecutor(): Promise<
  ChatNodeDocumentSearchExecutor | undefined
> {
  if (!defaultDocumentSearchPromise) {
    defaultDocumentSearchPromise = (async () => {
      try {
        const { getRAGConfig } = await import("../../rag/config.js");
        if (!getRAGConfig().enabled) {
          return undefined;
        }

        const { initRAG } = await import("../../rag/index.js");
        const {
          normalizeWebAigcSearchRequest,
          projectDocumentSearchResponse,
        } = await import("../../rag/web-aigc-search-adapter.js");
        const ragDeps = initRAG();

        return async (
          request: WebAigcSearchRequest,
        ): Promise<ChatNodeDocumentSearchResult> => {
          const options = normalizeWebAigcSearchRequest(request);
          const startedAt = Date.now();
          const results = await ragDeps.retriever.search(request.query, options);
          const latencyMs = Math.max(0, Date.now() - startedAt);

          return projectDocumentSearchResponse({
            query: request.query,
            results,
            documentIds: request.scope.documentIds,
            latencyMs,
            mode: request.options?.mode ?? "hybrid",
          });
        };
      } catch {
        return undefined;
      }
    })();
  }

  return defaultDocumentSearchPromise;
}

async function applyDialogueDocumentSearch(
  input: ChatNodeInput,
  deps: ChatNodeAdapterDeps,
): Promise<ChatNodeInput> {
  const documentSearch = normalizeDocumentSearchInput(input.documentSearch);
  if (!documentSearch) {
    return input;
  }

  const baseMessages = normalizeMessages(input.messages);
  const query =
    normalizeString(documentSearch.query) ||
    normalizeString(input.prompt) ||
    getLatestUserContent(baseMessages);

  if (!query) {
    throw new Error(
      "Dialogue documentSearch requires query, prompt, or user message.",
    );
  }

  const executor =
    deps.documentSearch || (await getDefaultDocumentSearchExecutor());
  if (!executor) {
    throw new Error(
      "Dialogue documentSearch is configured but no search executor is available.",
    );
  }

  const response = await executor({
    query,
    scope: documentSearch.scope,
    ...(documentSearch.options ? { options: documentSearch.options } : {}),
  });

  const citations = mergeStringArrays(
    normalizeStringArray(input.citations),
    buildDocumentSearchCitations(response),
  );
  const toolCalls = [
    ...(Array.isArray(input.toolCalls) ? input.toolCalls : []),
    {
      name: "document_search",
      arguments: {
        query,
        scope: documentSearch.scope,
        ...(documentSearch.options ? { options: documentSearch.options } : {}),
      },
      result: buildDocumentSearchToolResult(response),
    },
  ];

  return {
    ...input,
    context: mergeContext(input.context, buildDocumentSearchContext(response)),
    ...(citations ? { citations } : {}),
    toolCalls,
    documentSearch: {
      ...documentSearch,
      query,
    },
  };
}

function buildMessages(input?: ChatNodeInput): ChatNodeMessage[] {
  const normalizedInput = input ?? {};
  const baseMessages = normalizeMessages(normalizedInput.messages);
  const prompt =
    typeof normalizedInput.prompt === "string" ? normalizedInput.prompt.trim() : "";
  const systemPrompt =
    typeof normalizedInput.systemPrompt === "string"
      ? normalizedInput.systemPrompt.trim()
      : "";
  const contextText = stringifyContext(normalizedInput.context);
  const variablesText =
    normalizedInput.variables &&
    typeof normalizedInput.variables === "object" &&
    Object.keys(normalizedInput.variables).length > 0
      ? JSON.stringify(normalizedInput.variables, null, 2)
      : "";
  const citationsText = normalizeStringArray(normalizedInput.citations)
    ?.map((citation, index) => `${index + 1}. ${citation}`)
    .join("\n");
  const toolCallsText = normalizeToolCalls(normalizedInput.toolCalls)
    ?.map((toolCall, index) =>
      [
        `${index + 1}. ${toolCall.name}`,
        `arguments: ${toolCall.arguments}`,
        toolCall.result ? `result: ${toolCall.result}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const systemSegments = [systemPrompt];
  if (contextText) {
    systemSegments.push(`Upstream context:\n${contextText}`);
  }
  if (variablesText) {
    systemSegments.push(`Variables:\n${variablesText}`);
  }
  if (citationsText) {
    systemSegments.push(`Retrieved citations:\n${citationsText}`);
  }
  if (toolCallsText) {
    systemSegments.push(`Tool results:\n${toolCallsText}`);
  }

  const messages: ChatNodeMessage[] = [];
  const normalizedSystem = systemSegments.filter(Boolean).join("\n\n").trim();
  if (normalizedSystem) {
    messages.push({ role: "system", content: normalizedSystem });
  }

  messages.push(...baseMessages);

  if (prompt) {
    messages.push({ role: "user", content: prompt });
  }

  const hasPromptLikeMessage = messages.some((message) => message.role !== "system");
  if (!hasPromptLikeMessage) {
    throw new Error("Chat node input requires prompt or messages.");
  }

  return messages;
}

function getLatestUserContent(messages: ChatNodeMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      const normalized = message.content.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function serializePromptTranscript(messages: ChatNodeMessage[]): string {
  return messages
    .map((message) => `[${message.role}] ${message.content}`)
    .join("\n\n")
    .trim();
}

function buildDialogueMetadata(input: ChatNodeInput, extras: {
  model: string;
  latencyMs: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    nodeType: "dialogue",
    model: extras.model,
    latencyMs: extras.latencyMs,
  };

  const workflowId = normalizeString(input.workflowId);
  const sessionId = normalizeString(input.sessionId);
  const missionId = normalizeString(input.missionId);
  const agentId = normalizeString(input.agentId);
  const stage = normalizeString(input.stage);
  const citations = normalizeStringArray(input.citations);
  const toolCalls = normalizeToolCalls(input.toolCalls);
  const thinking = normalizeString(input.thinking);

  if (workflowId) {
    metadata.workflowId = workflowId;
  }
  if (sessionId) {
    metadata.sessionId = sessionId;
  }
  if (missionId) {
    metadata.missionId = missionId;
  }
  if (agentId) {
    metadata.agentId = agentId;
  }
  if (stage) {
    metadata.stage = stage;
  }
  if (citations) {
    metadata.citations = citations;
  }
  if (toolCalls) {
    metadata.toolCalls = toolCalls;
  }
  if (thinking) {
    metadata.thinking = thinking;
  }
  if (extras.usage) {
    metadata.usage = extras.usage;
  }

  return metadata;
}

export function isChatNodeType(value: unknown): value is ChatNodeType {
  return value === "llm" || value === "dialogue";
}

export async function executeChatNode(
  request: ChatNodeExecutionRequest,
  deps: ChatNodeAdapterDeps = {},
): Promise<ChatNodeExecutionResult> {
  if (!isChatNodeType(request.nodeType)) {
    throw new Error("Unsupported chat node type.");
  }

  const rawInput = request.input ?? {};
  const input =
    request.nodeType === "dialogue"
      ? await applyDialogueDocumentSearch(rawInput, deps)
      : rawInput;
  const messages = buildMessages(input);
  const getConfigValue = deps.getConfig ?? getAIConfig;
  const executeLLM = deps.executeLLM ?? callLLM;
  const now = deps.now ?? Date.now;
  const messageStore = deps.messageStore ?? defaultMessageStore;
  const sessionStore = deps.sessionStore ?? defaultSessionStore;
  const config = getConfigValue();
  const model =
    typeof input.model === "string" && input.model.trim()
      ? input.model.trim()
      : config.model;

  const startedAt = now();
  const response = await executeLLM(messages, {
    model,
    temperature: clampTemperature(input.temperature),
    maxTokens: clampMaxTokens(input.maxTokens),
  });
  const finishedAt = now();
  const latencyMs = Math.max(0, finishedAt - startedAt);
  const workflowId = normalizeString(input.workflowId);
  const sessionId = normalizeString(input.sessionId);
  const missionId = normalizeString(input.missionId);
  const agentId = normalizeString(input.agentId);
  const stage = normalizeString(input.stage) ?? "dialogue";
  const citations = normalizeStringArray(input.citations);
  const toolCalls = normalizeToolCalls(input.toolCalls);
  const thinking = normalizeString(input.thinking);
  const promptContent = getLatestUserContent(messages) ?? serializePromptTranscript(messages);
  const exchangeMetadata =
    request.nodeType === "dialogue"
      ? buildDialogueMetadata(input, {
          model,
          latencyMs,
          usage: response.usage,
        })
      : undefined;

  let persistedToWorkflow = false;
  let persistedToSession = false;

  if (request.nodeType === "dialogue" && workflowId && messageStore) {
    const assistantAgentId = agentId ?? "dialogue-agent";
    const userMetadata: Record<string, unknown> = {
      nodeType: "dialogue",
      role: "user",
      ...(workflowId ? { workflowId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(missionId ? { missionId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(stage ? { stage } : {}),
    };

    if (getLatestUserContent(messages)) {
      messageStore.createMessage({
        workflow_id: workflowId,
        from_agent: "workflow-user",
        to_agent: assistantAgentId,
        stage,
        content: getLatestUserContent(messages) as string,
        metadata: userMetadata,
      });
    }

    messageStore.createMessage({
      workflow_id: workflowId,
      from_agent: assistantAgentId,
      to_agent: "workflow-user",
      stage,
      content: response.content,
      metadata: exchangeMetadata ?? null,
    });
    persistedToWorkflow = true;
  }

  if (request.nodeType === "dialogue" && agentId && sessionStore) {
    sessionStore.appendLLMExchange(agentId, {
      workflowId,
      stage,
      prompt: promptContent,
      response: response.content,
      metadata: exchangeMetadata ?? null,
    });
    persistedToSession = true;
  }

  return {
    ok: true,
    nodeType: request.nodeType,
    output: {
      content: response.content,
      model,
      latencyMs,
      usage: response.usage,
      messages,
      reply: {
        role: "assistant",
        content: response.content,
      },
      ...(request.nodeType === "dialogue"
        ? {
            observability: {
              ...(workflowId ? { workflowId } : {}),
              ...(sessionId ? { sessionId } : {}),
              ...(missionId ? { missionId } : {}),
              ...(agentId ? { agentId } : {}),
              ...(stage ? { stage } : {}),
              persistedToWorkflow,
              persistedToSession,
              ...(citations ? { citations } : {}),
              ...(toolCalls ? { toolCalls } : {}),
              ...(thinking ? { thinking } : {}),
            },
          }
        : {}),
    },
  };
}
