/** 支持的外部框架类型 */
export type A2AFrameworkType = "crewai" | "langgraph" | "claude" | "custom";

/** 支持的 A2A 方法 */
export type A2AMethod = "a2a.invoke" | "a2a.stream" | "a2a.cancel";

/** A2A 协议信封（基于 JSON-RPC 2.0） */
export interface A2AEnvelope {
  jsonrpc: "2.0";
  method: A2AMethod;
  id: string;
  params: A2AInvokeParams;
  auth?: string;
}

/** 调用参数 */
export interface A2AInvokeParams {
  targetAgent: string;
  task: string;
  context: string; // 最大 2000 字符
  capabilities: string[];
  streamMode: boolean;
}

/** 调用响应 */
export interface A2AResponse {
  jsonrpc: "2.0";
  id: string;
  result?: A2AResult;
  error?: A2AError;
}

/** 成功结果 */
export interface A2AResult {
  output: string;
  artifacts: A2AArtifact[];
  metadata: Record<string, string>;
}

/** 产物 */
export interface A2AArtifact {
  name: string;
  type: string; // MIME type
  content: string; // base64 或文本
}

/** 错误信息 */
export interface A2AError {
  code: number;
  message: string;
  data?: unknown;
}

/** 流式响应块 */
export interface A2AStreamChunk {
  jsonrpc: "2.0";
  id: string;
  chunk: string;
  done: boolean;
}

/** A2A 会话状态 */
export type A2ASessionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** A2A 会话 */
export interface A2ASession {
  sessionId: string;
  requestEnvelope: A2AEnvelope;
  status: A2ASessionStatus;
  frameworkType: A2AFrameworkType;
  startedAt: number;
  completedAt?: number;
  response?: A2AResponse;
  streamChunks: A2AStreamChunk[];
}

/** 外部 Agent 注册信息 */
export interface ExternalAgentRegistration {
  id: string;
  name: string;
  frameworkType: A2AFrameworkType;
  endpoint: string;
  auth?: string;
  capabilities: string[];
  description: string;
}

/** A2A 标准错误码 */
export const A2A_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AUTH_FAILED: -32001,
  AGENT_NOT_FOUND: -32002,
  RATE_LIMITED: -32003,
  TIMEOUT: -32004,
  CANCELLED: -32005,
  FRAMEWORK_ERROR: -32006,
} as const;

// ─── Utility Functions ───────────────────────────────────────────────

/** 序列化 A2AEnvelope 为 JSON */
export function serializeEnvelope(envelope: A2AEnvelope): string {
  return JSON.stringify(envelope);
}

/** 从 JSON 反序列化 A2AEnvelope */
export function deserializeEnvelope(json: string): A2AEnvelope {
  return JSON.parse(json) as A2AEnvelope;
}

/** 序列化 A2ASession 为 JSON */
export function serializeSession(session: A2ASession): string {
  return JSON.stringify(session);
}

/** 从 JSON 反序列化 A2ASession */
export function deserializeSession(json: string): A2ASession {
  return JSON.parse(json) as A2ASession;
}

/** 验证 context 长度不超过 2000 字符 */
export function validateContext(context: string): boolean {
  return context.length <= 2000;
}

/** 构建 A2AEnvelope 的工厂函数 */
export function createEnvelope(
  method: A2AMethod,
  params: A2AInvokeParams,
  auth?: string,
): A2AEnvelope {
  return {
    jsonrpc: "2.0",
    method,
    id: crypto.randomUUID(),
    params,
    ...(auth !== undefined && { auth }),
  };
}

// ---------------------------------------------------------------------------
// Python Contract Slice: A2A Runtime
// ---------------------------------------------------------------------------

export const A2A_PYTHON_RUNTIME_CONTRACT_VERSION = "a2a.runtime.v1" as const;

export type A2APythonRuntimeOperation =
  | "invoke"
  | "stream_chunk"
  | "cancel"
  | "list_agents";

export type A2APythonRuntimeStatus =
  | "completed"
  | "streaming"
  | "failed"
  | "cancelled";

interface A2APythonRuntimeBaseResult {
  contractVersion: typeof A2A_PYTHON_RUNTIME_CONTRACT_VERSION;
  runtime: "python-contract";
  operation: A2APythonRuntimeOperation;
  ok: boolean;
  status: A2APythonRuntimeStatus;
}

export type A2APythonRuntimeInvokeResult =
  | (A2APythonRuntimeBaseResult & {
      operation: "invoke";
      ok: true;
      status: "completed";
      envelope: A2AEnvelope;
      response: A2AResponse & { result: A2AResult };
      session: A2ASession & { status: "completed"; response: A2AResponse };
    })
  | (A2APythonRuntimeBaseResult & {
      operation: "invoke";
      ok: false;
      status: "failed";
      envelope?: A2AEnvelope;
      error: A2AError;
      response?: A2AResponse & { error: A2AError };
      session?: A2ASession & { status: "failed" };
    });

export type A2APythonRuntimeStreamChunkResult =
  | (A2APythonRuntimeBaseResult & {
      operation: "stream_chunk";
      ok: true;
      status: "streaming" | "completed";
      envelope: A2AEnvelope;
      streamChunk: A2AStreamChunk;
      session: A2ASession & { status: "running" | "completed" };
    })
  | (A2APythonRuntimeBaseResult & {
      operation: "stream_chunk";
      ok: false;
      status: "failed";
      envelope?: A2AEnvelope;
      error: A2AError;
      response?: A2AResponse & { error: A2AError };
      session?: A2ASession & { status: "failed" };
    });

export type A2APythonRuntimeCancelResult = A2APythonRuntimeBaseResult & {
  operation: "cancel";
  ok: false;
  status: "cancelled";
  envelope: A2AEnvelope;
  error: A2AError;
  response: A2AResponse & { error: A2AError };
  session: A2ASession & { status: "cancelled"; response: A2AResponse };
};

export type A2APythonRuntimeListAgentsResult = A2APythonRuntimeBaseResult & {
  operation: "list_agents";
  ok: true;
  status: "completed";
  agents: ExposedA2APythonRuntimeAgent[];
};

export interface ExposedA2APythonRuntimeAgent {
  id: string;
  name: string;
  capabilities: string[];
  description: string;
}

export type A2APythonRuntimeResult =
  | A2APythonRuntimeInvokeResult
  | A2APythonRuntimeStreamChunkResult
  | A2APythonRuntimeCancelResult
  | A2APythonRuntimeListAgentsResult;

const A2A_PYTHON_RUNTIME_OPERATIONS: readonly A2APythonRuntimeOperation[] = [
  "invoke",
  "stream_chunk",
  "cancel",
  "list_agents",
];

const A2A_PYTHON_RUNTIME_FRAMEWORKS: readonly A2AFrameworkType[] = [
  "crewai",
  "langgraph",
  "claude",
  "custom",
];

const A2A_PYTHON_RUNTIME_SESSION_STATUSES: readonly A2ASessionStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];

export function isA2APythonRuntimeResult(
  value: unknown,
): value is A2APythonRuntimeResult {
  const record = a2aRuntimeAsRecord(value);
  if (!record) return false;
  if (record.contractVersion !== A2A_PYTHON_RUNTIME_CONTRACT_VERSION) {
    return false;
  }
  if (record.runtime !== "python-contract") return false;
  if (!a2aRuntimeOneOf(record.operation, A2A_PYTHON_RUNTIME_OPERATIONS)) {
    return false;
  }

  if (record.operation === "list_agents") {
    return (
      record.ok === true &&
      record.status === "completed" &&
      Array.isArray(record.agents) &&
      record.agents.every(isA2APythonRuntimeAgent)
    );
  }

  if (record.operation === "cancel") {
    if (record.ok !== false || record.status !== "cancelled") return false;
    const envelope = a2aRuntimeAsRecord(record.envelope);
    if (!isA2ARuntimeEnvelope(envelope, "a2a.cancel")) return false;
    const error = a2aRuntimeAsRecord(record.error);
    if (!isA2ARuntimeError(error)) return false;
    if (error.code !== A2A_ERROR_CODES.CANCELLED) return false;
    const response = a2aRuntimeAsRecord(record.response);
    if (!isA2ARuntimeResponse(response, envelope.id, "error")) return false;
    if (!a2aRuntimeErrorsMatch(response.error, error)) return false;
    return isA2ARuntimeSession(record.session, envelope, "cancelled", response);
  }

  if (record.ok === false || record.status === "failed") {
    return isA2APythonRuntimeFailure(record);
  }

  if (record.operation === "invoke") {
    if (record.ok !== true || record.status !== "completed") return false;
    if (record.error !== undefined) return false;
    const envelope = a2aRuntimeAsRecord(record.envelope);
    if (!isA2ARuntimeEnvelope(envelope, "a2a.invoke")) return false;
    const response = a2aRuntimeAsRecord(record.response);
    if (!isA2ARuntimeResponse(response, envelope.id, "result")) return false;
    return isA2ARuntimeSession(record.session, envelope, "completed", response);
  }

  if (record.ok !== true) return false;
  if (record.status !== "streaming" && record.status !== "completed") return false;
  const envelope = a2aRuntimeAsRecord(record.envelope);
  if (!isA2ARuntimeEnvelope(envelope, "a2a.stream")) return false;
  const chunk = a2aRuntimeAsRecord(record.streamChunk);
  if (!isA2ARuntimeStreamChunk(chunk, envelope.id)) return false;
  const expectedStatus = chunk.done ? "completed" : "streaming";
  const expectedSessionStatus = chunk.done ? "completed" : "running";
  if (record.status !== expectedStatus) return false;
  return isA2ARuntimeSession(
    record.session,
    envelope,
    expectedSessionStatus,
    undefined,
    chunk,
  );
}

function isA2APythonRuntimeFailure(
  record: Record<string, unknown>,
): boolean {
  if (record.operation !== "invoke" && record.operation !== "stream_chunk") {
    return false;
  }
  if (record.ok !== false || record.status !== "failed") return false;
  const error = a2aRuntimeAsRecord(record.error);
  if (!isA2ARuntimeError(error)) return false;
  if (record.response !== undefined) {
    const response = a2aRuntimeAsRecord(record.response);
    if (!response || response.result !== undefined || !isA2ARuntimeError(response.error)) {
      return false;
    }
    if (!a2aRuntimeErrorsMatch(response.error, error)) return false;
  }
  if (record.envelope !== undefined) {
    const expectedMethod = record.operation === "invoke" ? "a2a.invoke" : "a2a.stream";
    const envelope = a2aRuntimeAsRecord(record.envelope);
    if (!isA2ARuntimeEnvelope(envelope, expectedMethod)) return false;
    if (record.response !== undefined) {
      const response = a2aRuntimeAsRecord(record.response);
      if (!isA2ARuntimeResponse(response, envelope.id, "error")) return false;
      if (!a2aRuntimeErrorsMatch(response.error, error)) return false;
    }
    if (record.session !== undefined) {
      const response = record.response !== undefined
        ? a2aRuntimeAsRecord(record.response) ?? undefined
        : undefined;
      if (!isA2ARuntimeSession(record.session, envelope, "failed", response)) {
        return false;
      }
    }
  }
  return true;
}

function isA2ARuntimeEnvelope(
  value: Record<string, unknown> | null,
  expectedMethod?: A2AMethod,
): value is Record<string, unknown> & A2AEnvelope {
  if (!value) return false;
  if (value.jsonrpc !== "2.0") return false;
  if (!a2aRuntimeOneOf(value.method, ["a2a.invoke", "a2a.stream", "a2a.cancel"] as const)) {
    return false;
  }
  if (expectedMethod && value.method !== expectedMethod) return false;
  if (!a2aRuntimeNonEmptyString(value.id)) return false;
  if (!isA2ARuntimeInvokeParams(value.params)) return false;
  if (value.auth !== undefined && !a2aRuntimeNonEmptyString(value.auth)) {
    return false;
  }
  return true;
}

function isA2ARuntimeInvokeParams(value: unknown): value is A2AInvokeParams {
  const params = a2aRuntimeAsRecord(value);
  if (!params) return false;
  if (!a2aRuntimeNonEmptyString(params.targetAgent)) return false;
  if (!a2aRuntimeNonEmptyString(params.task)) return false;
  if (typeof params.context !== "string") return false;
  if (!Array.isArray(params.capabilities)) return false;
  if (!params.capabilities.every((capability) => typeof capability === "string")) {
    return false;
  }
  return typeof params.streamMode === "boolean";
}

function isA2ARuntimeResponse(
  value: Record<string, unknown> | null,
  expectedId: string,
  kind: "result" | "error",
): value is Record<string, unknown> & A2AResponse {
  if (!value) return false;
  if (value.jsonrpc !== "2.0") return false;
  if (value.id !== expectedId) return false;
  if (kind === "result") {
    return isA2ARuntimeResult(value.result) && value.error === undefined;
  }
  return isA2ARuntimeError(value.error) && value.result === undefined;
}

function isA2ARuntimeResult(value: unknown): value is A2AResult {
  const result = a2aRuntimeAsRecord(value);
  if (!result) return false;
  if (typeof result.output !== "string") return false;
  if (!Array.isArray(result.artifacts) || !result.artifacts.every(isA2ARuntimeArtifact)) {
    return false;
  }
  const metadata = a2aRuntimeAsRecord(result.metadata);
  if (!metadata) return false;
  return Object.values(metadata).every((item) => typeof item === "string");
}

function isA2ARuntimeArtifact(value: unknown): value is A2AArtifact {
  const artifact = a2aRuntimeAsRecord(value);
  if (!artifact) return false;
  if (!a2aRuntimeNonEmptyString(artifact.name)) return false;
  if (!a2aRuntimeNonEmptyString(artifact.type)) return false;
  return typeof artifact.content === "string";
}

function isA2ARuntimeError(value: unknown): value is A2AError {
  const error = a2aRuntimeAsRecord(value);
  if (!error) return false;
  if (typeof error.code !== "number" || !Number.isFinite(error.code)) return false;
  return a2aRuntimeNonEmptyString(error.message);
}

function isA2ARuntimeStreamChunk(
  value: Record<string, unknown> | null,
  expectedId: string,
): value is Record<string, unknown> & A2AStreamChunk {
  if (!value) return false;
  if (value.jsonrpc !== "2.0") return false;
  if (value.id !== expectedId) return false;
  if (typeof value.chunk !== "string") return false;
  return typeof value.done === "boolean";
}

function isA2ARuntimeSession(
  value: unknown,
  envelope: A2AEnvelope,
  expectedStatus: A2ASessionStatus,
  expectedResponse?: Record<string, unknown>,
  expectedChunk?: Record<string, unknown>,
): value is A2ASession {
  const session = a2aRuntimeAsRecord(value);
  if (!session) return false;
  if (session.sessionId !== envelope.id) return false;
  if (!isA2ARuntimeEnvelope(a2aRuntimeAsRecord(session.requestEnvelope), envelope.method)) {
    return false;
  }
  const sessionEnvelope = session.requestEnvelope as A2AEnvelope;
  if (sessionEnvelope.id !== envelope.id) return false;
  if (session.status !== expectedStatus) return false;
  if (!a2aRuntimeOneOf(session.frameworkType, A2A_PYTHON_RUNTIME_FRAMEWORKS)) {
    return false;
  }
  if (typeof session.startedAt !== "number" || !Number.isFinite(session.startedAt)) {
    return false;
  }
  if (
    session.completedAt !== undefined &&
    (typeof session.completedAt !== "number" || !Number.isFinite(session.completedAt))
  ) {
    return false;
  }
  if (!Array.isArray(session.streamChunks)) return false;
  if (!session.streamChunks.every((chunk) => isA2ARuntimeStreamChunk(a2aRuntimeAsRecord(chunk), envelope.id))) {
    return false;
  }
  if (expectedResponse) {
    if (!a2aRuntimeDeepEqual(session.response, expectedResponse)) return false;
  }
  if (expectedChunk) {
    const lastChunk = session.streamChunks[session.streamChunks.length - 1];
    if (!lastChunk || !a2aRuntimeDeepEqual(lastChunk, expectedChunk)) return false;
  }
  return a2aRuntimeOneOf(session.status, A2A_PYTHON_RUNTIME_SESSION_STATUSES);
}

function isA2APythonRuntimeAgent(
  value: unknown,
): value is ExposedA2APythonRuntimeAgent {
  const agent = a2aRuntimeAsRecord(value);
  if (!agent) return false;
  if (!a2aRuntimeNonEmptyString(agent.id)) return false;
  if (!a2aRuntimeNonEmptyString(agent.name)) return false;
  if (!Array.isArray(agent.capabilities)) return false;
  if (!agent.capabilities.every((capability) => typeof capability === "string")) {
    return false;
  }
  return a2aRuntimeNonEmptyString(agent.description);
}

function a2aRuntimeErrorsMatch(left: unknown, right: unknown): boolean {
  const leftError = a2aRuntimeAsRecord(left);
  const rightError = a2aRuntimeAsRecord(right);
  if (!isA2ARuntimeError(leftError) || !isA2ARuntimeError(rightError)) return false;
  return (
    leftError.code === rightError.code &&
    leftError.message === rightError.message &&
    a2aRuntimeDeepEqual(leftError.data, rightError.data)
  );
}

function a2aRuntimeAsRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function a2aRuntimeNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function a2aRuntimeOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function a2aRuntimeDeepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
