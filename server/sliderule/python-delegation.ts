/**
 * Thin delegation helper for calling the Python SlideRule V5 backend
 * (slide-rule-python).
 *
 * Runtime boundary:
 * - PYTHON_SLIDE_RULE_BASE_URL controls the target service, default localhost:9700.
 * - PYTHON_SLIDE_RULE_INTERNAL_KEY is sent only on internal POST delegation calls.
 * - PYTHON_SLIDE_RULE_TIMEOUT_MS bounds Node -> Python calls.
 * - Proxy behavior is left to Node fetch env support (HTTP_PROXY/HTTPS_PROXY,
 *   NODE_USE_ENV_PROXY, NO_PROXY); this helper does not install a dispatcher.
 *
 * Used by server/routes/sliderule.ts for V5 capabilities when
 * SLIDERULE_V5_BACKEND=python (default).
 */

export interface PythonSlideRuleRuntimeConfig {
  baseUrl: string;
  internalKey: string;
  timeoutMs: number;
  healthPath: string;
  proxyMode: "node-fetch-env";
}

export interface PythonSlideRuleHealthResult {
  ok: boolean;
  url: string;
  status?: number;
  backend?: string;
  error?: string;
}

export interface PythonSlideRuleCallOptions {
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://localhost:9700";
const DEFAULT_INTERNAL_KEY = "dev-slide-rule-internal";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_HEALTH_PATH = "/health";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /abort/i.test(error.message))
  );
}

export function resolvePythonSlideRuleRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): PythonSlideRuleRuntimeConfig {
  const rawBaseUrl = (env.PYTHON_SLIDE_RULE_BASE_URL || DEFAULT_BASE_URL).trim();
  return {
    baseUrl: trimTrailingSlashes(rawBaseUrl || DEFAULT_BASE_URL),
    internalKey: env.PYTHON_SLIDE_RULE_INTERNAL_KEY || DEFAULT_INTERNAL_KEY,
    timeoutMs: parsePositiveInt(env.PYTHON_SLIDE_RULE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    healthPath: DEFAULT_HEALTH_PATH,
    proxyMode: "node-fetch-env",
  };
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  errorPrefix: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${errorPrefix} failed: http ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`${errorPrefix} invalid json: ${errorMessage(error)}`);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${errorPrefix} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callPythonSlideRule(
  pythonBase: string,
  endpoint: string,
  payload: any,
  internalKey: string,
  options: PythonSlideRuleCallOptions = {},
) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const timeoutMs = options.timeoutMs ?? resolvePythonSlideRuleRuntimeConfig().timeoutMs;
  return await fetchJsonWithTimeout(
    `${trimTrailingSlashes(pythonBase)}${normalizedEndpoint}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": internalKey,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
    `python ${normalizedEndpoint}`,
  );
}

/**
 * Thin delegation for any HTTP method to Python backend (for Node route retirement to thin proxy).
 * Used for GET /sessions, GET /sessions/:id, PUT /sessions/:id, DELETE to prove no Node business ownership.
 */
export async function delegateToPythonSlideRule(
  pythonBase: string,
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  payload: any,
  internalKey: string,
  options: PythonSlideRuleCallOptions = {},
) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const timeoutMs = options.timeoutMs ?? resolvePythonSlideRuleRuntimeConfig().timeoutMs;
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": internalKey,
    },
  };
  if (method !== "GET" && method !== "DELETE") {
    init.body = JSON.stringify(payload ?? {});
  }
  return await fetchJsonWithTimeout(
    `${trimTrailingSlashes(pythonBase)}${normalizedEndpoint}`,
    init,
    timeoutMs,
    `python ${method} ${normalizedEndpoint}`,
  );
}

export async function callPythonSlideRuleGet(
  pythonBase: string,
  endpoint: string,
  internalKey: string,
  options: PythonSlideRuleCallOptions = {},
) {
  return delegateToPythonSlideRule(pythonBase, endpoint, "GET", null, internalKey, options);
}

export async function checkPythonSlideRuleHealth(
  config: PythonSlideRuleRuntimeConfig = resolvePythonSlideRuleRuntimeConfig(),
): Promise<PythonSlideRuleHealthResult> {
  const url = `${config.baseUrl}${config.healthPath}`;
  try {
    const payload = await fetchJsonWithTimeout(
      url,
      { method: "GET" },
      config.timeoutMs,
      "python health",
    );
    const body = payload as Record<string, unknown>;
    return {
      ok: body?.status === "ok",
      url,
      status: body?.status === "ok" ? 200 : undefined,
      backend: typeof body?.backend === "string" ? body.backend : undefined,
      error: body?.status === "ok" ? undefined : "python health returned non-ok status",
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: errorMessage(error),
    };
  }
}
