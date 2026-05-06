import {
  EXECUTOR_API_ROUTES,
  EXECUTOR_CALLBACK_HEADERS,
  type CreateExecutorJobResponse,
  type ExecutorCapabilitiesResponse,
} from "../../shared/executor/api.js";
import {
  EXECUTOR_CONTRACT_VERSION,
  EXECUTOR_CAPABILITY_SET,
  type ExecutionPlan,
  type ExecutorCapabilities,
  type ExecutorCapability,
  type ExecutorJobRequest,
} from "../../shared/executor/contracts.js";

export interface ExecutorClientErrorDetails {
  code?: string;
  unsupportedCapabilities?: string[];
  unknownCapabilities?: string[];
  supportedCapabilities?: string[];
  hint?: string;
}

export class ExecutorClientError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "protocol" | "rejected",
    readonly statusCode?: number,
    options?: {
      cause?: unknown;
      details?: ExecutorClientErrorDetails;
    },
  ) {
    super(message, options);
    this.name = "ExecutorClientError";
    this.details = options?.details;
  }

  readonly details?: ExecutorClientErrorDetails;
}

export interface ExecutorClientOptions {
  baseUrl: string;
  callbackUrl: string;
  callbackTimeoutMs?: number;
  healthPath?: string;
  timeoutMs?: number;
  executorName?: ExecutorJobRequest["executor"];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
}

export interface DispatchExecutionPlanOptions {
  requestId?: string;
  jobId?: string;
  traceId?: string;
  idempotencyKey?: string;
}

export interface DispatchExecutionPlanResult {
  request: ExecutorJobRequest;
  response: CreateExecutorJobResponse;
}

function joinUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function createOpaqueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function parseExecutorErrorDetails(value: unknown): ExecutorClientErrorDetails | undefined {
  if (!value || typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const details: ExecutorClientErrorDetails = {
    code: typeof record.code === "string" ? record.code : undefined,
    unsupportedCapabilities: stringArray(record.unsupportedCapabilities),
    supportedCapabilities: stringArray(record.supportedCapabilities),
    hint: typeof record.hint === "string" ? record.hint : undefined,
  };

  return Object.values(details).some(value => value !== undefined) ? details : undefined;
}

function formatExecutorErrorDetails(details: ExecutorClientErrorDetails | undefined): string {
  if (!details) return "";

  const parts: string[] = [];
  if (details.code) {
    parts.push(`code=${details.code}`);
  }
  if (details.unsupportedCapabilities?.length) {
    parts.push(`unsupported=${details.unsupportedCapabilities.join(", ")}`);
  }
  if (details.unknownCapabilities?.length) {
    parts.push(`unknown=${details.unknownCapabilities.join(", ")}`);
  }
  if (details.hint) {
    parts.push(`hint=${details.hint}`);
  }

  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}

export function getExecutorCapabilityMismatchReason(error: unknown): string | undefined {
  if (!(error instanceof ExecutorClientError)) return undefined;

  const code = error.details?.code;
  if (
    code !== "EXECUTOR_CAPABILITY_UNKNOWN" &&
    code !== "EXECUTOR_CAPABILITY_UNSUPPORTED"
  ) {
    return undefined;
  }

  const missing =
    error.details?.unsupportedCapabilities?.length
      ? error.details.unsupportedCapabilities
      : error.details?.unknownCapabilities;
  const capabilityText = missing?.length
    ? missing.join(", ")
    : "required executor capability";
  const hint = error.details?.hint ? ` Hint: ${error.details.hint}` : "";

  return `Executor capability mismatch (${code}): ${capabilityText}.${hint}`;
}

function collectPlanRequiredCapabilities(plan: ExecutionPlan): string[] {
  const required = new Set<string>();

  for (const job of plan.jobs) {
    const raw = job.payload?.requiredCapabilities;
    if (!Array.isArray(raw)) continue;

    for (const value of raw) {
      if (typeof value !== "string") {
        required.add("<non-string-capability>");
        continue;
      }

      const normalized = value.trim();
      if (normalized) {
        required.add(normalized);
      }
    }
  }

  return [...required];
}

export class ExecutorClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly callbackTimeoutMs: number;
  private readonly healthPath: string;
  private readonly executorName: ExecutorJobRequest["executor"];
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly options: ExecutorClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = Math.max(1_000, options.timeoutMs || 10_000);
    this.callbackTimeoutMs = Math.max(1_000, options.callbackTimeoutMs || 10_000);
    this.healthPath = options.healthPath || "/health";
    this.executorName = options.executorName || "lobster";
    this.now = options.now || (() => new Date());
    this.createId = options.createId || createOpaqueId;
  }

  buildJobRequest(
    plan: ExecutionPlan,
    dispatch: DispatchExecutionPlanOptions = {},
  ): ExecutorJobRequest {
    return {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: dispatch.requestId || this.createId(),
      missionId: plan.missionId,
      jobId: dispatch.jobId || this.createId(),
      executor: this.executorName,
      createdAt: this.now().toISOString(),
      traceId: dispatch.traceId,
      idempotencyKey: dispatch.idempotencyKey,
      plan,
      callback: {
        eventsUrl: this.options.callbackUrl,
        timeoutMs: this.callbackTimeoutMs,
        auth: {
          scheme: "hmac-sha256",
          executorHeader: EXECUTOR_CALLBACK_HEADERS.executorId,
          timestampHeader: EXECUTOR_CALLBACK_HEADERS.timestamp,
          signatureHeader: EXECUTOR_CALLBACK_HEADERS.signature,
          signedPayload: "timestamp.rawBody",
        },
      },
    };
  }

  async assertReachable(): Promise<void> {
    const url = joinUrl(this.options.baseUrl, this.healthPath);

    let response: Response;
    try {
      response = await this.request(url, { method: "GET" });
    } catch (error) {
      throw new ExecutorClientError(
        `Executor is unreachable at ${url}. Brain dispatch is failing fast instead of queueing blindly.`,
        "unavailable",
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ExecutorClientError(
        `Executor health check failed with HTTP ${response.status} at ${url}. Brain dispatch is failing fast.`,
        "unavailable",
        response.status,
      );
    }
  }

  async getCapabilities(): Promise<ExecutorCapabilities> {
    const url = joinUrl(this.options.baseUrl, EXECUTOR_API_ROUTES.capabilities);

    let response: Response;
    try {
      response = await this.request(url, { method: "GET" });
    } catch (error) {
      throw new ExecutorClientError(
        `Executor capabilities request failed for ${url}.`,
        "unavailable",
        undefined,
        { cause: error },
      );
    }

    const rawBody = await response.text();
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ExecutorClientError(
        `Executor returned a non-JSON response while reading capabilities at ${url}.`,
        "protocol",
        response.status,
      );
    }

    if (!response.ok) {
      const errorMessage =
        typeof parsedBody === "object" &&
        parsedBody !== null &&
        "error" in parsedBody &&
        typeof parsedBody.error === "string"
          ? parsedBody.error
          : `HTTP ${response.status}`;
      const details = parseExecutorErrorDetails(parsedBody);

      throw new ExecutorClientError(
        `Executor capabilities request was rejected: ${errorMessage}${formatExecutorErrorDetails(details)}`,
        "rejected",
        response.status,
        { details },
      );
    }

    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      !("ok" in parsedBody) ||
      !("capabilities" in parsedBody) ||
      typeof (parsedBody as { capabilities?: unknown }).capabilities !== "object"
    ) {
      throw new ExecutorClientError(
        "Executor capabilities response is missing required fields.",
        "protocol",
        response.status,
      );
    }

    return (parsedBody as ExecutorCapabilitiesResponse).capabilities;
  }

  async validatePlanCapabilities(
    plan: ExecutionPlan,
    capabilities?: ExecutorCapabilities,
  ): Promise<ExecutorCapabilities> {
    const resolvedCapabilities = capabilities ?? await this.getCapabilities();
    const requiredCapabilities = collectPlanRequiredCapabilities(plan);
    if (requiredCapabilities.length === 0) {
      return resolvedCapabilities;
    }

    const unknownCapabilities = requiredCapabilities.filter(
      capability => !EXECUTOR_CAPABILITY_SET.has(capability),
    );
    if (unknownCapabilities.length > 0) {
      const details: ExecutorClientErrorDetails = {
        code: "EXECUTOR_CAPABILITY_UNKNOWN",
        unknownCapabilities,
        supportedCapabilities: resolvedCapabilities.capabilities,
        hint: "Use one of the shared executor capability names before dispatching this plan.",
      };
      throw new ExecutorClientError(
        `ExecutionPlan requires unknown executor capabilities: ${unknownCapabilities.join(", ")}${formatExecutorErrorDetails(details)}`,
        "rejected",
        undefined,
        { details },
      );
    }

    const supported = new Set<string>(resolvedCapabilities.capabilities);
    const unsupportedCapabilities = requiredCapabilities.filter(
      capability => !supported.has(capability as ExecutorCapability),
    );
    if (unsupportedCapabilities.length > 0) {
      const details: ExecutorClientErrorDetails = {
        code: "EXECUTOR_CAPABILITY_UNSUPPORTED",
        unsupportedCapabilities,
        supportedCapabilities: resolvedCapabilities.capabilities,
        hint: "Switch executor mode/image or remove unsupported requiredCapabilities before dispatch.",
      };
      throw new ExecutorClientError(
        `ExecutionPlan requires unsupported executor capabilities: ${unsupportedCapabilities.join(", ")}${formatExecutorErrorDetails(details)}`,
        "rejected",
        undefined,
        { details },
      );
    }

    return resolvedCapabilities;
  }

  async dispatchPlan(
    plan: ExecutionPlan,
    dispatch: DispatchExecutionPlanOptions = {},
  ): Promise<DispatchExecutionPlanResult> {
    await this.assertReachable();

    const request = this.buildJobRequest(plan, dispatch);
    const url = joinUrl(this.options.baseUrl, EXECUTOR_API_ROUTES.createJob);

    let response: Response;
    try {
      response = await this.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new ExecutorClientError(
        `Executor create-job request failed for ${url}. Brain dispatch is failing fast.`,
        "unavailable",
        undefined,
        { cause: error },
      );
    }

    const rawBody = await response.text();
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ExecutorClientError(
        `Executor returned a non-JSON response while creating a job at ${url}.`,
        "protocol",
        response.status,
      );
    }

    if (!response.ok) {
      const errorMessage =
        typeof parsedBody === "object" &&
        parsedBody !== null &&
        "error" in parsedBody &&
        typeof parsedBody.error === "string"
          ? parsedBody.error
          : `HTTP ${response.status}`;
      const details = parseExecutorErrorDetails(parsedBody);

      throw new ExecutorClientError(
        `Executor rejected the job request: ${errorMessage}${formatExecutorErrorDetails(details)}`,
        "rejected",
        response.status,
        { details },
      );
    }

    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      !("ok" in parsedBody) ||
      !("accepted" in parsedBody) ||
      !("jobId" in parsedBody) ||
      typeof parsedBody.jobId !== "string"
    ) {
      throw new ExecutorClientError(
        `Executor create-job response is missing required fields.`,
        "protocol",
        response.status,
      );
    }

    return {
      request,
      response: parsedBody as CreateExecutorJobResponse,
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ExecutorClientError(
          `Executor request to ${url} timed out after ${this.timeoutMs}ms.`,
          "unavailable",
          undefined,
          { cause: error },
        );
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
