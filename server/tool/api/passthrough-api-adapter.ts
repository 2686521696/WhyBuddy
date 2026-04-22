import type { Action, ResourceType } from "../../../shared/permission/contracts.js";
import type { AuditLogger as PermissionAuditLogger } from "../../permission/check-engine.js";
import { maskSensitiveData } from "../../replay/sensitive-data.js";

export interface PassthroughApiExecutionRequest {
  targetId: string;
  input: string;
  context: string[];
  workflowId?: string;
  stage?: string;
  metadata?: Record<string, unknown>;
}

export interface PassthroughApiExecutionResult {
  output: string;
  targetLabel: string;
  operation: string;
  response: unknown;
  responseStatus: number;
}

export interface PassthroughApiExecutorLike {
  execute(
    request: PassthroughApiExecutionRequest,
  ): Promise<PassthroughApiExecutionResult>;
}

export interface PassthroughApiExecutorDependencies {
  fetchImpl?: typeof fetch;
  auditLogger?: PermissionAuditLogger;
}

type ResponseMode = "auto" | "json" | "text";

interface NormalizedPassthroughRequest {
  targetId: string;
  workflowId?: string;
  stage?: string;
  agentId: string;
  targetLabel: string;
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  timeoutMs: number;
  whitelist: string[];
  responseMode: ResponseMode;
  inputPreview: string;
}

const PASSTHROUGH_API_RESOURCE_TYPE: ResourceType = "api";
const PASSTHROUGH_API_ACTION: Action = "call";
const DEFAULT_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function readNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function readStringArray(
  value: Record<string, unknown> | undefined,
  key: string,
): string[] {
  if (!value || !Array.isArray(value[key])) {
    return [];
  }

  return value[key]
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim())
    .filter(Boolean);
}

function readRecord(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!value || !isRecord(value[key])) {
    return undefined;
  }

  return value[key] as Record<string, unknown>;
}

function ensureText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required field: ${field}`);
  }

  return value.trim();
}

function normalizeMethod(value: string | undefined, hasBody: boolean): string {
  const normalized = (value || (hasBody ? "POST" : "GET")).trim().toUpperCase();
  if (
    normalized !== "GET" &&
    normalized !== "POST" &&
    normalized !== "PUT" &&
    normalized !== "PATCH" &&
    normalized !== "DELETE" &&
    normalized !== "HEAD"
  ) {
    throw new Error(`Unsupported passthrough_api method: ${normalized}`);
  }

  return normalized;
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.max(1, Math.min(120_000, Math.floor(value)));
}

function summarizeInput(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  return normalized.length > 160
    ? `${normalized.slice(0, 160).trimEnd()}...`
    : normalized;
}

function normalizeHeaders(
  value: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean",
      )
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function applyQuery(
  url: URL,
  query: Record<string, unknown> | undefined,
): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

function normalizeUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid passthrough_api url: ${value}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported passthrough_api protocol: ${parsed.protocol}`);
  }

  return parsed;
}

function matchesWhitelist(url: URL, rule: string): boolean {
  const normalizedRule = rule.trim();
  if (!normalizedRule) {
    return false;
  }

  if (normalizedRule.endsWith("*")) {
    return url.href.startsWith(normalizedRule.slice(0, -1));
  }

  if (
    normalizedRule.startsWith("http://") ||
    normalizedRule.startsWith("https://")
  ) {
    return url.href === normalizedRule || url.href.startsWith(`${normalizedRule}/`);
  }

  return url.origin === normalizedRule || url.hostname === normalizedRule;
}

function isWhitelisted(url: URL, whitelist: string[]): boolean {
  return whitelist.some(rule => matchesWhitelist(url, rule));
}

function normalizeResponseMode(value: string | undefined): ResponseMode {
  if (value === "json" || value === "text") {
    return value;
  }

  return "auto";
}

function normalizeBody(
  request: PassthroughApiExecutionRequest,
  metadata: Record<string, unknown> | undefined,
  headers: Record<string, string>,
): BodyInit | undefined {
  const body = metadata?.body;
  if (body === undefined) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  return JSON.stringify(body);
}

function maskSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") {
    return maskSensitiveData(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => maskSensitiveValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key/i.test(key)) {
          return [key, "***"];
        }
        return [key, maskSensitiveValue(item)];
      }),
    );
  }

  return value;
}

async function parseResponseBody(
  response: Response,
  responseMode: ResponseMode,
): Promise<unknown> {
  if (responseMode === "json") {
    return response.json();
  }

  if (responseMode === "text") {
    return response.text();
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return response.text();
    }
  }

  return response.text();
}

function serializeMaskedResponse(payload: unknown): string {
  if (typeof payload === "string") {
    return maskSensitiveData(payload);
  }

  try {
    return JSON.stringify(maskSensitiveValue(payload), null, 2);
  } catch {
    return String(maskSensitiveValue(payload));
  }
}

function buildAuditResource(targetId: string): string {
  return `passthrough_api:${targetId}`;
}

function buildResponsePayload(
  response: Response,
  body: unknown,
): Record<string, unknown> {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: Object.fromEntries(response.headers.entries()),
    data: body,
  };
}

function normalizeRequest(
  request: PassthroughApiExecutionRequest,
): NormalizedPassthroughRequest {
  const metadata = isRecord(request.metadata) ? request.metadata : undefined;
  const url = normalizeUrl(ensureText(metadata?.url, "metadata.url"));
  const headers = normalizeHeaders(readRecord(metadata, "headers"));
  applyQuery(url, readRecord(metadata, "query"));
  const body = normalizeBody(request, metadata, headers);
  const method = normalizeMethod(readString(metadata, "method"), body !== undefined);

  return {
    targetId: ensureText(request.targetId, "targetId"),
    workflowId: request.workflowId?.trim() || undefined,
    stage: request.stage?.trim() || undefined,
    agentId:
      readString(metadata, "agentId") ||
      readString(metadata, "requestedBy") ||
      "passthrough_api_executor",
    targetLabel: readString(metadata, "targetLabel") || ensureText(request.targetId, "targetId"),
    url,
    method,
    headers,
    body:
      method === "GET" || method === "HEAD"
        ? undefined
        : body,
    timeoutMs: normalizeTimeoutMs(readNumber(metadata, "timeoutMs")),
    whitelist: readStringArray(metadata, "whitelist"),
    responseMode: normalizeResponseMode(readString(metadata, "responseMode")),
    inputPreview: summarizeInput(request.input),
  };
}

export class PassthroughApiExecutor implements PassthroughApiExecutorLike {
  private readonly fetchImpl: typeof fetch;
  private readonly auditLogger?: PermissionAuditLogger;

  constructor(deps: PassthroughApiExecutorDependencies = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.auditLogger = deps.auditLogger;
  }

  async execute(
    request: PassthroughApiExecutionRequest,
  ): Promise<PassthroughApiExecutionResult> {
    let normalized: NormalizedPassthroughRequest | undefined;
    let auditLogged = false;

    try {
      normalized = normalizeRequest(request);
      if (normalized.whitelist.length === 0) {
        throw new Error("Missing required field: metadata.whitelist");
      }
      if (!isWhitelisted(normalized.url, normalized.whitelist)) {
        this.auditExecution(request, normalized, "denied", {
          reason: `Passthrough API whitelist blocked URL: ${normalized.url.toString()}`,
        });
        auditLogged = true;
        throw new Error(
          `Passthrough API whitelist blocked URL: ${normalized.url.toString()}`,
        );
      }

      const response = await this.fetchWithTimeout(normalized);
      const body = await parseResponseBody(response, normalized.responseMode);
      const payload = buildResponsePayload(response, body);
      const output = serializeMaskedResponse(payload);

      if (!response.ok) {
        const reason =
          response.status === 429
            ? `Passthrough API rate limited with HTTP 429 for ${normalized.method} ${normalized.url.toString()}`
            : `Passthrough API request failed with HTTP ${response.status} for ${normalized.method} ${normalized.url.toString()}`;
        this.auditExecution(request, normalized, "error", {
          reason,
          statusCode: response.status,
          responsePreview: output.slice(0, 400),
        });
        auditLogged = true;
        throw new Error(reason);
      }

      const result: PassthroughApiExecutionResult = {
        output,
        targetLabel: normalized.targetLabel,
        operation: normalized.targetId,
        response: payload,
        responseStatus: response.status,
      };
      this.auditExecution(request, normalized, "allowed", {
        statusCode: response.status,
        responsePreview: output.slice(0, 400),
      });
      auditLogged = true;
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (
        normalized &&
        !auditLogged
      ) {
        this.auditExecution(request, normalized, "error", {
          reason,
        });
      }
      throw error;
    }
  }

  private async fetchWithTimeout(
    request: NormalizedPassthroughRequest,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      return await this.fetchImpl(request.url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        throw new Error(
          `Passthrough API request timed out after ${request.timeoutMs}ms for ${request.method} ${request.url.toString()}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private auditExecution(
    originalRequest: PassthroughApiExecutionRequest,
    normalized: NormalizedPassthroughRequest,
    result: "allowed" | "denied" | "error",
    extras: {
      reason?: string;
      statusCode?: number;
      responsePreview?: string;
    } = {},
  ): void {
    if (!this.auditLogger) {
      return;
    }

    this.auditLogger.log({
      agentId: normalized.agentId,
      operation: "passthrough_api",
      resourceType: PASSTHROUGH_API_RESOURCE_TYPE,
      action: PASSTHROUGH_API_ACTION,
      resource: buildAuditResource(normalized.targetId),
      result,
      reason: extras.reason,
      metadata: {
        targetId: normalized.targetId,
        targetLabel: normalized.targetLabel,
        workflowId: normalized.workflowId,
        stage: normalized.stage,
        requestUrl: normalized.url.toString(),
        method: normalized.method,
        timeoutMs: normalized.timeoutMs,
        whitelist: normalized.whitelist,
        inputPreview: normalized.inputPreview,
        contextCount: Array.isArray(originalRequest.context)
          ? originalRequest.context.length
          : 0,
        statusCode: extras.statusCode,
        responsePreview: extras.responsePreview,
      },
    });
  }
}
