/**
 * 当前会话 id 的单一兜底。
 *
 * ⚠ 2026-09-02 真机：新建会话后「社区图书馆」产物写进昨天的诊所会话。
 * 字面量散落 7 处，拿不到 id 的路径全掉进同一个桶。定义只许这一处。
 *
 * ⚠ 2026-09-15：主入口 `/agent-loop/sliderule` 只把 id 写在 localStorage，
 *   刷新 / 应用中心整页跳 / 复刻链接都指回光秃秃的路径——用户说「刷新丢会话」。
 *   地址栏才是可收藏的权威，localStorage 降成 fallback。查询键只许这一处。
 */
export const DEFAULT_SESSION_ID = "sliderule-v51-product";

/** 地址栏上的会话键。开发态 `/sliderule/dev?session=` 早就用这个字。 */
export const SESSION_QUERY_KEY = "session";

export class SessionIdMismatchError extends Error {
  constructor(
    readonly driveSessionId: string,
    readonly shellSessionId: string
  ) {
    super(
      `会话错位：推演 ${driveSessionId} ≠ 当前 ${shellSessionId}，拒绝点火`
    );
    this.name = "SessionIdMismatchError";
  }
}

/** 点火前：消息落库的会话必须等于本次推演的会话。不等就拒绝，不许静默择一。 */
export function assertDriveSessionMatchesShell(
  driveSessionId: string | null | undefined,
  shellSessionId: string | null | undefined
): string {
  const shell = String(shellSessionId || "").trim();
  if (!shell) {
    throw new SessionIdMismatchError("", "");
  }
  const drive = String(driveSessionId || "").trim();
  if (drive && drive !== shell) {
    throw new SessionIdMismatchError(drive, shell);
  }
  return shell;
}

export function sessionIdFromSearch(search: string): string | null {
  const raw = String(search || "").trim();
  if (!raw) return null;
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  try {
    const id = String(new URLSearchParams(query).get(SESSION_QUERY_KEY) || "").trim();
    return id || null;
  } catch {
    return null;
  }
}

/** SSR / 残缺 window 上 location.href 可能根本不在。 */
export function hrefFromWindow(win: { location?: { href?: string } } | undefined | null): string {
  const href = win?.location?.href;
  return typeof href === "string" ? href : "";
}

export function sessionIdFromHref(href: string): string | null {
  const raw = String(href || "").trim();
  if (!raw) return null;
  try {
    return sessionIdFromSearch(new URL(raw, "https://sliderule.local").search);
  } catch {
    return sessionIdFromSearch(raw);
  }
}

/**
 * 推演页才把 session 写进地址栏。工作台 / 设置带着别人的查询串，
 * 不许被切换会话顺手改掉。
 */
export function isSliderulePath(pathname: string): boolean {
  const path = String(pathname || "").split(/[?#]/, 1)[0];
  const trimmed = path.replace(/\/+$/, "") || "/";
  const n = trimmed.toLowerCase();
  return (
    n === "/agent-loop" ||
    n.endsWith("/agent-loop") ||
    n === "/agent-loop/sliderule" ||
    n.endsWith("/agent-loop/sliderule")
  );
}

export function hrefWithSession(href: string, sessionId: string): string {
  const id = String(sessionId || "").trim();
  const raw = String(href || "").trim();
  if (!id || !raw) return raw;
  try {
    const url = new URL(raw, "https://sliderule.local");
    url.searchParams.set(SESSION_QUERY_KEY, id);
    if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(raw)) return url.href;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw;
  }
}

export function slideruleSessionPath(sessionId: string): string {
  return hrefWithSession("/agent-loop/sliderule", sessionId);
}

/** URL 有就听 URL；没有再听存储；再没有才掉进历史兜底桶。 */
export function resolveActiveSessionId(input: {
  urlSession?: string | null;
  stored?: string | null;
  fallback?: string;
}): string {
  const url = String(input.urlSession || "").trim();
  if (url) return url;
  const stored = String(input.stored || "").trim();
  if (stored) return stored;
  return String(input.fallback || DEFAULT_SESSION_ID);
}

export function applySessionToHistory(
  history: {
    state: unknown;
    pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
    replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
  },
  href: string,
  sessionId: string,
  mode: "push" | "replace"
): string | null {
  let pathname = "";
  try {
    pathname = new URL(href, "https://sliderule.local").pathname;
  } catch {
    pathname = String(href || "").split(/[?#]/, 1)[0];
  }
  if (!isSliderulePath(pathname)) return null;
  const next = hrefWithSession(href, sessionId);
  if (!next || next === href) return null;
  const prior =
    history.state && typeof history.state === "object"
      ? (history.state as Record<string, unknown>)
      : {};
  if (mode === "replace") history.replaceState(prior, "", next);
  else history.pushState({ ...prior, sessionId }, "", next);
  return next;
}

/** 浏览器里记着的「当前会话」（侧栏点开 / 推演页打开时写入）。 */
export const ACTIVE_SESSION_KEY = "sliderule:active-session-id";
/** 记下「当前会话」时是哪个账号。 */
export const ACTIVE_SESSION_OWNER_KEY = "sliderule:active-session-owner";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 记着的「当前会话」不是这个账号的就丢掉，返回被丢掉的会话号；没丢返回 null。之后它归这个账号。
 *
 * ⚠ 2026-10-10 用户：同一个浏览器先用管理员账号推演，再注册新账号登录，页面自己打开了
 *   `?session=sr-20261010041133-…`（上一个账号的会话），新账号看到的是一张空白欢迎页；在这里发第一句话，
 *   话进的是别人的会话，服务端拒掉，黄条「推演中断：控制面未返回结果」。「当前会话」存在 localStorage 里、
 *   不分账号，退出登录也不清——换账号就串过去。
 *
 * 没记过归属的（这一版之前存下的）一律当作不是这个账号的：分不出来就不冒险，代价是老用户升级后
 * 回到空白页一次，会话都还在侧栏里。
 */
export function claimStoredSessionFor(
  userId: string | null | undefined,
  storage: KeyValueStorage | null = defaultStorage()
): string | null {
  const owner = String(userId || "").trim();
  if (!owner || !storage) return null;
  try {
    const stored = String(storage.getItem(ACTIVE_SESSION_KEY) || "").trim();
    const recorded = String(storage.getItem(ACTIVE_SESSION_OWNER_KEY) || "").trim();
    storage.setItem(ACTIVE_SESSION_OWNER_KEY, owner);
    if (stored && recorded !== owner) {
      storage.removeItem(ACTIVE_SESSION_KEY);
      return stored;
    }
  } catch {
    /* 隐私模式：没有存储就没有串号 */
  }
  return null;
}

/** 退出登录：「当前会话」和它的归属一起清掉。 */
export function forgetStoredSession(storage: KeyValueStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(ACTIVE_SESSION_KEY);
    storage.removeItem(ACTIVE_SESSION_OWNER_KEY);
  } catch {
    /* 隐私模式 */
  }
}
