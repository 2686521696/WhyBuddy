/**
 * Shared thin-proxy delegation helper for Node routes that forward
 * endpoint-for-endpoint to the Python FastAPI backend (slide-rule-python, :9700).
 *
 * Follows the repo's established delegate-first pattern
 * (server/routes/rag.ts, server/routes/sliderule.ts,
 * server/sliderule/python-delegation.ts, blueprint review/export proxy):
 *
 * - Runtime target comes from PYTHON_SLIDE_RULE_BASE_URL (default
 *   http://localhost:9700) + PYTHON_SLIDE_RULE_INTERNAL_KEY (default
 *   dev-slide-rule-internal), sent as X-Internal-Key.
 * - Infrastructure failures (connect failure / timeout / 5xx / internal-key
 *   rejection / non-JSON body) resolve to `{ delegated: false }` so callers
 *   gracefully fall back to the existing Node implementation.
 * - Business responses (2xx and business 4xx) resolve to
 *   `{ delegated: true, status, body }` and are passed through verbatim.
 *
 * Flag semantics (isPythonThinProxyEnabled):
 * - explicit "true"  -> on (also under vitest, so proxy tests can opt in)
 * - explicit "false" -> off
 * - unset            -> `defaultEnabled`, except default-on flags stay off in
 *                       the vitest environment so unit suites keep the Node
 *                       path (same guard as server/routes/blueprint.ts).
 *
 * Used by: server/routes/tasks.ts (TASKS_PYTHON_PROXY, default ON),
 * server/routes/auth.ts (AUTH_PYTHON_PROXY, default OFF),
 * server/routes/permissions.ts (PERMISSIONS_PYTHON_PROXY, default OFF),
 * server/routes/audit.ts (AUDIT_PYTHON_PROXY, default OFF).
 */

export interface PythonThinProxyDelegated {
  delegated: true;
  /** HTTP status returned by Python (2xx or business 4xx). */
  status: number;
  /** Parsed JSON body from Python (null when the response body was empty). */
  body: unknown;
}

export interface PythonThinProxyUnavailable {
  delegated: false;
  /** Human-readable infra-failure reason (connect error, 5xx, bad key, ...). */
  reason: string;
}

export type PythonThinProxyResult =
  | PythonThinProxyDelegated
  | PythonThinProxyUnavailable;

export interface PythonThinProxyTarget {
  baseUrl: string;
  internalKey: string;
  timeoutMs: number;
}

export interface PythonThinProxyRequest {
  /** Full Python path, e.g. "/api/tasks/abc/cancel". */
  endpoint: string;
  method?: "GET" | "POST";
  /** JSON payload for POST requests (defaults to {}). */
  payload?: unknown;
  /** Optional query string parameters (undefined values are dropped). */
  query?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  target?: PythonThinProxyTarget;
}

const DEFAULT_BASE_URL = "http://localhost:9700";
const DEFAULT_INTERNAL_KEY = "dev-slide-rule-internal";
const DEFAULT_TIMEOUT_MS = 15_000;

export function isVitestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.VITEST_POOL_ID !== undefined
  );
}

export function isPythonThinProxyEnabled(
  flagName: string,
  options: { defaultEnabled: boolean },
): boolean {
  const value = process.env[flagName];
  if (value === "true") return true;
  if (value === "false") return false;
  if (!options.defaultEnabled) return false;
  // Default-on flags stay off under vitest so unit suites keep the Node path
  // by default (blueprint.ts isVitestEnvironment guard pattern).
  return !isVitestEnvironment();
}

export function resolvePythonThinProxyTarget(
  env: NodeJS.ProcessEnv = process.env,
): PythonThinProxyTarget {
  const rawBaseUrl = (env.PYTHON_SLIDE_RULE_BASE_URL || DEFAULT_BASE_URL).trim();
  const rawTimeout = Number.parseInt(env.PYTHON_SLIDE_RULE_TIMEOUT_MS || "", 10);
  return {
    baseUrl: (rawBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    internalKey: env.PYTHON_SLIDE_RULE_INTERNAL_KEY || DEFAULT_INTERNAL_KEY,
    timeoutMs:
      Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function delegateToPythonThinProxy(
  input: PythonThinProxyRequest,
): Promise<PythonThinProxyResult> {
  const target = input.target ?? resolvePythonThinProxyTarget();
  const method = input.method ?? "POST";
  const fetchImpl = input.fetchImpl ?? fetch;
  const normalizedEndpoint = input.endpoint.startsWith("/")
    ? input.endpoint
    : `/${input.endpoint}`;

  const url = new URL(`${target.baseUrl}${normalizedEndpoint}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method,
      headers: {
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        "X-Internal-Key": target.internalKey,
      },
      ...(method === "POST" ? { body: JSON.stringify(input.payload ?? {}) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    return { delegated: false, reason: errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }

  // Infra failure: Python 5xx never wins over the Node fallback implementation.
  if (response.status >= 500) {
    return { delegated: false, reason: `python http ${response.status}` };
  }

  const text = await response.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return { delegated: false, reason: "python returned a non-JSON body" };
    }
  }

  // FastAPI internal-key rejection ({"detail": "Invalid key"}) is a
  // configuration/infra failure, not a business 4xx: fall back to Node.
  if (
    response.status === 403 &&
    isPlainRecord(body) &&
    typeof body.detail === "string"
  ) {
    return { delegated: false, reason: `python rejected internal key: ${body.detail}` };
  }

  return { delegated: true, status: response.status, body };
}
