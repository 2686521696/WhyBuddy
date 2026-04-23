import db from "../../db/index.js";
import { sessionStore as runtimeSessionStore } from "../../memory/session-store.js";
import type {
  ChatNodeMessageStore,
  ChatNodeSessionStore,
  ChatNodeToolCall,
} from "./chat-node-adapter.js";

export type RobotReplyNodeType = "robot_reply";

export interface RobotReplyMessage {
  role: "assistant";
  content: string;
  citations?: string[];
  toolSummaries?: string[];
}

export interface RobotReplyNodeInput {
  content?: string;
  prompt?: string;
  reply?: {
    role?: "assistant";
    content?: string;
  };
  citations?: string[];
  toolCalls?: Array<{
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
  }>;
  workflowId?: string;
  sessionId?: string;
  missionId?: string;
  agentId?: string;
  stage?: string;
  upstream?: unknown;
}

export interface RobotReplyNodeExecutionRequest {
  nodeType: RobotReplyNodeType;
  input?: RobotReplyNodeInput;
}

export interface RobotReplyNodeExecutionResult {
  ok: true;
  nodeType: RobotReplyNodeType;
  output: {
    content: string;
    reply: RobotReplyMessage;
    citations?: string[];
    toolCalls?: ChatNodeToolCall[];
    toolSummaries?: string[];
    observability: {
      workflowId?: string;
      sessionId?: string;
      missionId?: string;
      agentId?: string;
      stage?: string;
      persistedToWorkflow: boolean;
      persistedToSession: boolean;
      citations?: string[];
      toolCalls?: ChatNodeToolCall[];
      upstreamNodeType?: string;
    };
  };
}

export interface RobotReplyNodeAdapterDeps {
  messageStore?: ChatNodeMessageStore | null;
  sessionStore?: ChatNodeSessionStore | null;
}

type RobotReplyUpstreamEnvelope = {
  nodeType?: string;
  content?: string;
  replyContent?: string;
  workflowId?: string;
  sessionId?: string;
  missionId?: string;
  agentId?: string;
  stage?: string;
  citations?: string[];
  toolCalls?: ChatNodeToolCall[];
  prompt?: string;
};

const defaultMessageStore: ChatNodeMessageStore | undefined =
  typeof (db as Partial<ChatNodeMessageStore>).createMessage === "function"
    ? (db as unknown as ChatNodeMessageStore)
    : undefined;

const defaultSessionStore: ChatNodeSessionStore | undefined =
  typeof (runtimeSessionStore as Partial<ChatNodeSessionStore>).appendLLMExchange === "function"
    ? runtimeSessionStore
    : undefined;

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
      const result = normalizeString(entry.result);
      return {
        name,
        arguments: argumentsText,
        ...(result ? { result } : {}),
      };
    });

  return normalized.length > 0 ? normalized : undefined;
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

function normalizeMessages(
  value: unknown,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (
        entry,
      ): entry is {
        role: "system" | "user" | "assistant";
        content: string;
      } =>
        typeof entry === "object" &&
        entry !== null &&
        ((entry as { role?: unknown }).role === "system" ||
          (entry as { role?: unknown }).role === "user" ||
          (entry as { role?: unknown }).role === "assistant") &&
        typeof (entry as { content?: unknown }).content === "string",
    )
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
}

function getLatestUserContent(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      const normalized = message.content.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function normalizeUpstream(value: unknown): RobotReplyUpstreamEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const outer = value as Record<string, unknown>;
  const candidate =
    outer.output && typeof outer.output === "object" && !Array.isArray(outer.output)
      ? (outer.output as Record<string, unknown>)
      : outer;

  const observability =
    candidate.observability &&
    typeof candidate.observability === "object" &&
    !Array.isArray(candidate.observability)
      ? (candidate.observability as Record<string, unknown>)
      : undefined;

  const messages = normalizeMessages(candidate.messages);

  return {
    nodeType: normalizeString(outer.nodeType) ?? normalizeString(candidate.nodeType),
    content: normalizeString(candidate.content),
    replyContent:
      candidate.reply && typeof candidate.reply === "object"
        ? normalizeString((candidate.reply as { content?: unknown }).content)
        : undefined,
    workflowId:
      normalizeString(candidate.workflowId) ?? normalizeString(observability?.workflowId),
    sessionId:
      normalizeString(candidate.sessionId) ?? normalizeString(observability?.sessionId),
    missionId:
      normalizeString(candidate.missionId) ?? normalizeString(observability?.missionId),
    agentId:
      normalizeString(candidate.agentId) ?? normalizeString(observability?.agentId),
    stage: normalizeString(candidate.stage) ?? normalizeString(observability?.stage),
    citations: mergeStringArrays(
      normalizeStringArray(candidate.citations),
      normalizeStringArray(observability?.citations),
    ),
    toolCalls:
      normalizeToolCalls(candidate.toolCalls) ?? normalizeToolCalls(observability?.toolCalls),
    prompt: getLatestUserContent(messages),
  };
}

function buildToolSummaries(toolCalls: ChatNodeToolCall[] | undefined): string[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((toolCall, index) => {
    const summary = normalizeString(toolCall.result);
    return summary
      ? `${index + 1}. ${toolCall.name}: ${summary}`
      : `${index + 1}. ${toolCall.name}`;
  });
}

function buildRobotReplyMetadata(input: {
  sessionId?: string;
  missionId?: string;
  agentId?: string;
  stage?: string;
  citations?: string[];
  toolCalls?: ChatNodeToolCall[];
  upstreamNodeType?: string;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    nodeType: "robot_reply",
  };

  if (input.sessionId) {
    metadata.sessionId = input.sessionId;
  }
  if (input.missionId) {
    metadata.missionId = input.missionId;
  }
  if (input.agentId) {
    metadata.agentId = input.agentId;
  }
  if (input.stage) {
    metadata.stage = input.stage;
  }
  if (input.citations) {
    metadata.citations = input.citations;
  }
  if (input.toolCalls) {
    metadata.toolCalls = input.toolCalls;
  }
  if (input.upstreamNodeType) {
    metadata.upstreamNodeType = input.upstreamNodeType;
  }

  return metadata;
}

export function isRobotReplyNodeType(value: unknown): value is RobotReplyNodeType {
  return value === "robot_reply";
}

export async function executeRobotReplyNode(
  request: RobotReplyNodeExecutionRequest,
  deps: RobotReplyNodeAdapterDeps = {},
): Promise<RobotReplyNodeExecutionResult> {
  if (!isRobotReplyNodeType(request.nodeType)) {
    throw new Error("Unsupported robot reply node type.");
  }

  const input = request.input ?? {};
  const upstream = normalizeUpstream(input.upstream);
  const content =
    normalizeString(input.content) ||
    normalizeString(input.reply?.content) ||
    upstream.replyContent ||
    upstream.content;

  if (!content) {
    throw new Error(
      "Robot reply node input requires content, reply.content, or upstream output content.",
    );
  }

  const workflowId = normalizeString(input.workflowId) ?? upstream.workflowId;
  const sessionId = normalizeString(input.sessionId) ?? upstream.sessionId;
  const missionId = normalizeString(input.missionId) ?? upstream.missionId;
  const agentId = normalizeString(input.agentId) ?? upstream.agentId;
  const stage = normalizeString(input.stage) ?? upstream.stage ?? "robot_reply";
  const citations = mergeStringArrays(
    normalizeStringArray(input.citations),
    upstream.citations,
  );
  const toolCalls = normalizeToolCalls(input.toolCalls) ?? upstream.toolCalls;
  const toolSummaries = buildToolSummaries(toolCalls);
  const upstreamNodeType = upstream.nodeType;
  const prompt =
    normalizeString(input.prompt) ||
    upstream.prompt ||
    upstream.content ||
    content;

  const metadata = buildRobotReplyMetadata({
    sessionId,
    missionId,
    agentId,
    stage,
    citations,
    toolCalls,
    upstreamNodeType,
  });

  const messageStore =
    deps.messageStore === undefined ? defaultMessageStore : deps.messageStore ?? undefined;
  const sessionStore =
    deps.sessionStore === undefined ? defaultSessionStore : deps.sessionStore ?? undefined;
  const reply: RobotReplyMessage = {
    role: "assistant",
    content,
    ...(citations ? { citations } : {}),
    ...(toolSummaries ? { toolSummaries } : {}),
  };

  let persistedToWorkflow = false;
  let persistedToSession = false;

  if (workflowId && messageStore) {
    messageStore.createMessage({
      workflow_id: workflowId,
      from_agent: agentId ?? "robot-reply-agent",
      to_agent: "workflow-user",
      stage,
      content,
      metadata,
    });
    persistedToWorkflow = true;
  }

  if (agentId && sessionStore) {
    sessionStore.appendLLMExchange(agentId, {
      workflowId,
      stage,
      prompt,
      response: content,
      metadata,
    });
    persistedToSession = true;
  }

  return {
    ok: true,
    nodeType: "robot_reply",
    output: {
      content,
      reply,
      ...(citations ? { citations } : {}),
      ...(toolCalls ? { toolCalls } : {}),
      ...(toolSummaries ? { toolSummaries } : {}),
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
        ...(upstreamNodeType ? { upstreamNodeType } : {}),
      },
    },
  };
}
