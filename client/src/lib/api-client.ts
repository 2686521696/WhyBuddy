import { useAppStore } from "./store";

export type ApiErrorKind = "demo" | "offline" | "error" | "degraded";
export type ApiErrorSource =
  | "network"
  | "http"
  | "html-fallback"
  | "non-json"
  | "parse"
  | "storage"
  | "python"
  | "timeout"
  | "legacy-fallback";

export interface ApiRequestError {
  kind: ApiErrorKind;
  source: ApiErrorSource;
  endpoint: string;
  message: string;
  detail: string;
  retryable: boolean;
  status?: number;
}

export type FetchJsonSafeResult<T> =
  | { ok: true; data: T; response: Response }
  | { ok: false; error: ApiRequestError; response?: Response };

function getEndpoint(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getFallbackKind(): ApiErrorKind {
  return useAppStore.getState().runtimeMode === "frontend" ? "demo" : "offline";
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<body")
  );
}

function extractErrorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.error,
    record.message,
    record.detail,
    typeof record.result === "object" && record.result
      ? (record.result as Record<string, unknown>).message
      : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function isPythonDegradedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p: any = payload;
  return (
    p.degraded === true ||
    p.degraded === "true" ||
    p.status === "degraded" ||
    (p.error &&
      (typeof p.error === "object"
        ? p.error.code === "planner_timeout"
        : String(p.error).includes("timeout"))) ||
    (typeof p.reason === "string" && /timeout|degraded|python/i.test(p.reason))
  );
}

function extractPythonEnvelope(
  payload: unknown
): { message: string; detail?: string; retryable?: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const p: any = payload;
  // Only trigger for explicit Python degraded/timeout markers or 5xx python context (do not swallow generic {error:..} server responses)
  const hasPythonMarker =
    isPythonDegradedPayload(p) ||
    (p.error &&
      (typeof p.error === "string"
        ? /python|timeout|degraded|planner/i.test(p.error)
        : /python|timeout|degraded|planner/i.test(JSON.stringify(p.error)))) ||
    (typeof p.reason === "string" &&
      /python|timeout|degraded|planner/i.test(p.reason)) ||
    p.degraded === true ||
    p.status === "degraded";
  if (!hasPythonMarker) return null;
  const msg =
    p.message ||
    (typeof p.error === "string"
      ? p.error
      : p.error?.message || p.error?.code) ||
    p.reason ||
    extractErrorDetail(payload) ||
    "Python backend error/timeout/degraded";
  const detailParts: string[] = [];
  if (p.reason) detailParts.push(`reason=${p.reason}`);
  if (p.error)
    detailParts.push(`error=${JSON.stringify(p.error).slice(0, 120)}`);
  if (p.degraded) detailParts.push("degraded=true");
  return {
    message: String(msg).slice(0, 200),
    detail: detailParts.length
      ? detailParts.join("; ")
      : "Python envelope normalized",
    retryable: true,
  };
}

function createApiError(
  endpoint: string,
  config: Omit<ApiRequestError, "endpoint">
): ApiRequestError {
  return {
    endpoint,
    ...config,
  };
}

export function isDemoModeFallback(
  error: ApiRequestError | null | undefined
): boolean {
  return error?.kind === "demo";
}

export function isOfflineApiError(
  error: ApiRequestError | null | undefined
): boolean {
  return error?.kind === "offline";
}

export function isDegradedApiError(
  error: ApiRequestError | null | undefined
): boolean {
  return error?.kind === "degraded";
}

export function isPythonBackendFailure(
  error: ApiRequestError | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.kind === "degraded" ||
    error.source === "python" ||
    error.source === "timeout" ||
    (error.status != null && (error.status === 502 || error.status === 504)) ||
    /python|timeout|degraded/i.test(error.message || "") ||
    /python|timeout|degraded/i.test(error.detail || "")
  );
}

export function getLegacyFallbackReason(
  error: ApiRequestError | null | undefined
): string | null {
  if (!error) return null;
  if (error.source === "html-fallback" || error.source === "legacy-fallback") {
    return "legacy Node fallback active";
  }
  if (error.kind === "degraded") return "Python degraded, legacy may apply";
  return null;
}

export async function fetchJsonSafe<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchJsonSafeResult<T>> {
  const endpoint = getEndpoint(input);

  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    const fallbackKind = getFallbackKind();
    return {
      ok: false,
      error: createApiError(endpoint, {
        kind: fallbackKind,
        source: "network",
        message:
          fallbackKind === "demo"
            ? "The app is using local demo data because the API is unavailable."
            : "The API is currently unreachable.",
        detail:
          fallbackKind === "demo"
            ? "Switch to advanced mode after the server is ready, or keep browsing with local preview data."
            : "Check whether the backend service is running, then retry this request.",
        retryable: true,
      }),
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const rawText = await response.text();

  if (looksLikeHtml(rawText) || contentType.includes("text/html")) {
    const fallbackKind = getFallbackKind();
    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: fallbackKind,
        source: "html-fallback",
        status: response.status,
        message:
          fallbackKind === "demo"
            ? "The browser preview is active because the API returned an HTML fallback page."
            : "The API returned an HTML fallback page instead of JSON.",
        detail:
          fallbackKind === "demo"
            ? "This usually means the frontend is running without the backend service."
            : "Start the backend service or restore the API proxy, then retry.",
        retryable: true,
      }),
    };
  }

  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: "error",
        source: "non-json",
        status: response.status,
        message: "The API did not return JSON data.",
        detail:
          "The response format was not recognized, so the UI kept the raw parser error hidden.",
        retryable: response.status >= 500 || response.status === 0,
      }),
    };
  }

  let payload: T;
  try {
    payload = rawText ? (JSON.parse(rawText) as T) : (null as T);
  } catch {
    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: "error",
        source: "parse",
        status: response.status,
        message: "The API response could not be parsed.",
        detail:
          "The UI suppressed the raw JSON parse error and treated this as a structured request failure.",
        retryable: response.status >= 500 || response.status === 0,
      }),
    };
  }

  // Normalize Python error/timeout/degraded envelopes (and legacy) in frontend API helpers (105 req 1)
  // Even 200 responses from Python may carry degraded=true / planner_timeout for visibility + recoverability.
  // 502/timeout/legacy fallbacks must not be hidden as silent Node success.
  const pyEnv = extractPythonEnvelope(payload);
  if (pyEnv) {
    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: "degraded",
        source:
          response.status >= 500 || response.status === 504
            ? "timeout"
            : "python",
        status: response.status,
        message: pyEnv.message,
        detail: pyEnv.detail || "",
        retryable: pyEnv.retryable !== false,
      }),
    };
  }

  if (!response.ok) {
    const isPython5xx =
      (response.status === 502 ||
        response.status === 503 ||
        response.status === 504) &&
      (String(extractErrorDetail(payload) || "")
        .toLowerCase()
        .includes("python") ||
        String(rawText || "")
          .toLowerCase()
          .includes("python"));
    const fallbackKind =
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
        ? getFallbackKind()
        : "error";

    const src: ApiErrorSource = isPython5xx
      ? "python"
      : response.status >= 500
        ? "timeout"
        : "http";
    const kind =
      response.status === 502 || isPython5xx || isPythonDegradedPayload(payload)
        ? "degraded"
        : fallbackKind;

    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind,
        source: src,
        status: response.status,
        message:
          extractErrorDetail(payload) ??
          (kind === "degraded"
            ? "Python backend failure (timeout/degraded/502)."
            : fallbackKind === "error"
              ? `Request failed with status ${response.status}.`
              : "The backend service is not ready yet."),
        detail:
          kind === "degraded"
            ? "Python error/timeout/degraded envelope; retry or legacy fallback visible to user."
            : fallbackKind === "error"
              ? "The request completed, but the server reported an application error."
              : "Retry after the backend becomes available, or switch back to local preview mode.",
        retryable: response.status >= 500 || response.status === 429,
      }),
    };
  }

  return { ok: true, data: payload, response };
}
