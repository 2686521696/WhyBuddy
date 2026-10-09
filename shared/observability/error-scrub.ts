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

/**
 * Sentry 拒收的事件大小上限是 1 MB（outcome = invalid / too_large:event）。这里留一半余量。
 *
 * ⚠ 2026-10-09 审 Sentry：问题列表一天多没有新错误，统计里却有 6 条错误被以 too_large:event 拒收、8 条发送失败
 *   ——线上真出了错，只是没进来。同一天 Python / Node 的 ERROR 日志（Sentry Logs）一条都没有，所以是浏览器那份：
 *   SDK 默认把每次 console.log 的**原始参数对象**存进面包屑（data.arguments），出错时最近 100 条跟着事件走，
 *   工作台往控制台打过大对象就超限。被拒收的原件看不到，所以两头都做：面包屑不留原始参数（slimBreadcrumb），
 *   发送前再按大小兜底（fitEventSize），保证错误本身一定送得到——上报是增强，但「错误进不来」等于没装。
 */
export const MAX_EVENT_BYTES = 512 * 1024;
const MAX_CRUMB_MESSAGE = 1000;

/** beforeBreadcrumb：先脱敏，再去掉控制台面包屑的原始参数对象、截短正文。 */
export function slimBreadcrumb<T>(crumb: T): T | null {
  const out = scrubEvent(crumb) as unknown as { message?: unknown; data?: Record<string, unknown> } | null;
  if (!out || typeof out !== "object") return out as T | null;
  if (out.data && typeof out.data === "object" && "arguments" in out.data) {
    const { arguments: _dropped, ...rest } = out.data;
    out.data = rest;
  }
  if (typeof out.message === "string" && out.message.length > MAX_CRUMB_MESSAGE) {
    out.message = out.message.slice(0, MAX_CRUMB_MESSAGE) + "…";
  }
  return out as unknown as T;
}

function byteSize(value: unknown): number {
  const text = JSON.stringify(value) ?? "";
  return typeof TextEncoder === "function" ? new TextEncoder().encode(text).length : text.length * 3;
}

/**
 * beforeSend 的最后一步：超过上限就依次丢面包屑、extra、各帧的局部变量、只留每个异常最后 50 帧，
 * 直到放得下；丢了什么记在 tag `trimmed` 上。量不出大小（循环引用等）就原样交回，让 SDK 自己处理。
 */
export function fitEventSize<T>(event: T, limit = MAX_EVENT_BYTES): T {
  try {
    if (!event || typeof event !== "object" || byteSize(event) <= limit) return event;
    const raw = event as unknown as {
      breadcrumbs?: unknown; extra?: unknown; tags?: Record<string, unknown>;
      exception?: { values?: Array<{ value?: string; stacktrace?: { frames?: Array<Record<string, unknown>> } }> };
    };
    const trimmed: string[] = [];
    const steps: Array<[string, () => void]> = [
      ["breadcrumbs", () => { delete raw.breadcrumbs; }],
      ["extra", () => { delete raw.extra; }],
      ["frame_vars", () => {
        for (const value of raw.exception?.values ?? []) for (const frame of value.stacktrace?.frames ?? []) delete frame.vars;
      }],
      ["frames", () => {
        for (const value of raw.exception?.values ?? []) {
          if (value.stacktrace?.frames && value.stacktrace.frames.length > 50) value.stacktrace.frames = value.stacktrace.frames.slice(-50);
          if (typeof value.value === "string" && value.value.length > 4000) value.value = value.value.slice(0, 4000) + "…";
        }
      }],
    ];
    for (const [name, step] of steps) {
      step();
      trimmed.push(name);
      if (byteSize(raw) <= limit) break;
    }
    raw.tags = { ...(raw.tags || {}), trimmed: trimmed.join(",") };
    return raw as unknown as T;
  } catch {
    return event;
  }
}

/** environment：显式 SENTRY_ENVIRONMENT 优先；否则 production / development。跟 Python 那份同一个规则。 */
export function reportingEnvironment(explicit: string | undefined, mode: string | undefined): string {
  const set = (explicit || "").trim();
  if (set) return set;
  const m = (mode || "").trim().toLowerCase();
  return m === "production" || m === "prod" ? "production" : "development";
}
