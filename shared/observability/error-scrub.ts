/**
 * 错误上报出这台机器之前脱敏（Node 服务和浏览器共用）。
 *
 * ⚠ 跟 Python 那份（slide-rule-python/services/error_reporting.py 的 scrub_event）是成对的东西（CLAUDE.md §四）：
 *   同一份样本 shared/observability/scrub-samples.json，两侧测试都读，secret 一个都不许留下、keep 一个都不许误伤。
 *   只改一侧不会报错，只会有一半的报错带着密钥出去。
 *
 * 宁可多剥：上报的东西出了这台机器就收不回来。脱敏自己出错就**不发**（返回 null）。
 */

export const FILTERED = "[Filtered]";

/** 头、cookie、字段名里出现这些就整值剥掉（小写比较）。不放 "session"：session_id 是按会话搜报错的标签。 */
const SENSITIVE_KEYS = [
  "authorization", "cookie", "x-internal-key", "internal-key", "api-key", "apikey", "x-api-key",
  "token", "secret", "password", "passwd", "dsn", "credential", "private",
];

const SECRET_PATTERNS: RegExp[] = [
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|pk|rk|xai|gsk|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(password|passwd|secret|api[_-]?key|token)\s*[=:]\s*[^\s,;&'"]+/gi,
];

const MAX_DEPTH = 12;

export function scrubText(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, FILTERED);
  return out;
}

function sensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SENSITIVE_KEYS.some(word => lowered.includes(word));
}

function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0)
    || (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(item => scrubValue(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sensitiveKey(key) && !isEmpty(inner) ? FILTERED : scrubValue(inner, depth + 1);
    }
    return out;
  }
  return value;
}

/** Sentry beforeSend / beforeSendTransaction / beforeBreadcrumb 共用。 */
export function scrubEvent<T>(event: T): T | null {
  try {
    const raw = event as unknown as { request?: Record<string, unknown> };
    if (raw && raw.request && typeof raw.request === "object") {
      const request = { ...raw.request };
      delete request.cookies;
      delete request.data;                // 请求体：用户原话、上传内容，不出这台机器
      (raw as { request?: unknown }).request = request;
    }
    return scrubValue(raw) as T;
  } catch {
    return null;
  }
}

/** environment：显式 SENTRY_ENVIRONMENT 优先；否则 production / development。跟 Python 那份同一个规则。 */
export function reportingEnvironment(explicit: string | undefined, mode: string | undefined): string {
  const set = (explicit || "").trim();
  if (set) return set;
  const m = (mode || "").trim().toLowerCase();
  return m === "production" || m === "prod" ? "production" : "development";
}
