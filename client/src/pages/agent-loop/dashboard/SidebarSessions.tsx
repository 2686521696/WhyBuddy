/**
 * SidebarSessions — 侧栏会话区。
 *
 * ⚠ 2026-08-19：先铺过今天/昨天整表，侧栏被撑出屏幕；又收成「最近 6 条」
 *   把筛选一起撤了。用户要留着筛选，列表改成「最近 4 + 近七天 6」，
 *   超高就在列表里滚，再多走「更多」去应用中心。
 *   行样式仍是小方图 + 标题，封面 cover 占满。
 *
 * 数据：GET /api/sliderule/sessions（python 会话库）。切换/新建只做两件事：
 * 写 localStorage 的 active-session-id + 广播 window 事件——SlideRule 会话壳
 * 监听事件后以 key=sessionId 整树重挂完成水合。列表拉取失败如实显示。
 */

import React from "react";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { listApps, type AppStoreSummary } from "./app-store-client";
import {
  SESSION_THUMB_APP_LIMIT,
  SessionThumb,
  indexAppsBySession,
  sessionRowTitle,
} from "./session-thumb";

export const ACTIVE_SESSION_KEY = "sliderule:active-session-id";
export const SESSION_CHANGED_EVENT = "sliderule:active-session-changed";
/** 会话库内容有更新（话题落盘/推演完成）——侧栏收到后重拉列表，
 *  标题从"新会话"实时变成话题文案。 */
export const SESSIONS_UPDATED_EVENT = "sliderule:sessions-updated";

export function notifySessionsUpdated(): void {
  window.dispatchEvent(new CustomEvent(SESSIONS_UPDATED_EVENT));
}

export interface SessionMeta {
  sessionId: string;
  goal: string;
  createdAt?: string | null;
  lastActive?: string | null;
  artifactCount?: number;
  phase?: string;
}

/**
 * 新会话 id：**向服务端要**，不在本地生成（2026-08-06）。
 *
 * ## 为什么挪到后端
 *
 * 原来是 `sr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`
 * —— 5 位 base36 ≈ **25 位熵**，而且 Math.random() 不是加密安全的。服务端那份
 * 是 50 位 Crockford Base32 + 存在性检查（slide_rule_session._new_session_id）。
 *
 * 更要紧的是**权威归属**：id 由谁生成，就决定了"这条会话是谁的"这件事由谁说了算。
 * 客户端生成时服务端只能被动接受，实测出过一个劫持漏洞——攻击者拿着别人的
 * sessionId 发一次 POST 就能把整条会话连内容带归属一起夺走（已在服务端补了查重，
 * 见 routes/sliderule_full.create_sess）。id 从服务端出，这类问题从根上少一类。
 *
 * ## 代价：会话变成「点了就建」
 *
 * 之前是懒创建——本地先有个 id，用户真发第一条消息才落库，所以点开不发消息
 * 不会留下痕迹。现在点一次就在库里建一条。空会话会累积，这是有意接受的取舍：
 * 换来的是"客户端说的 id 服务端不必相信"。
 *
 * 侧栏那个「新建会话」按钮本来就只在用户主动点击时触发，不是页面加载就调，
 * 所以不会因为有人打开一次首页就凭空多一条。
 *
 * ## 失败怎么办
 *
 * 抛出去，由调用方决定怎么提示。**不回落到本地生成** —— 那等于把刚拆掉的
 * 弱路径又留了个后门，而且失败的真实原因通常是"没登录"（建会话已要求登录），
 * 悄悄给一个本地 id 只会让用户在下一步撞得更莫名其妙。
 */
export async function createSessionId(): Promise<string> {
  const res = await fetch("/api/sliderule/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: { text: "" } }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "请先登录后再新建会话" : `新建会话失败（HTTP ${res.status}）`
    );
  }
  const body = (await res.json()) as { sessionId?: string };
  const sid = String(body?.sessionId || "").trim();
  if (!sid) throw new Error("服务端没有返回 sessionId");
  return sid;
}

export type SessionSort = "active" | "created";
export type SessionPhaseFilter = "all" | "running" | "done" | "failed";

/** 排序键。active = lastActive 优先；created = createdAt 优先。都缺沉底。 */
export function sessionSortTime(s: SessionMeta, order: SessionSort): string {
  return order === "created"
    ? String(s.createdAt ?? s.lastActive ?? "")
    : String(s.lastActive ?? s.createdAt ?? "");
}

export function sortSessions(
  sessions: SessionMeta[],
  order: SessionSort = "active",
): SessionMeta[] {
  return [...sessions].sort((a, b) =>
    sessionSortTime(b, order).localeCompare(sessionSortTime(a, order)),
  );
}

/** 最近活跃倒序（无时间戳的沉底，稳定排序）。 */
export function sortSessionsByRecency(sessions: SessionMeta[]): SessionMeta[] {
  return sortSessions(sessions, "active");
}

export const SIDEBAR_RECENT_LIMIT = 4;
export const SIDEBAR_WEEK_LIMIT = 6;

export function isWithinLast7Days(
  iso: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const g = sessionAgeGroup(iso, now);
  return g === "today" || g === "yesterday" || g === "week";
}

/**
 * 已经排好序的名单：头 4 条进「最近」，其后 7 天内再取 6 条进「近七天」，
 * 剩下的 hiddenCount 走「更多」。不在这里再排一次——排序由调用方的筛选项定。
 */
export function splitSidebarSessions(
  sessions: SessionMeta[],
  now: number = Date.now(),
  order: SessionSort = "active",
): { recent: SessionMeta[]; week: SessionMeta[]; hiddenCount: number } {
  const recent = sessions.slice(0, SIDEBAR_RECENT_LIMIT);
  const rest = sessions.slice(SIDEBAR_RECENT_LIMIT);
  const week = rest
    .filter(s => isWithinLast7Days(sessionSortTime(s, order) || null, now))
    .slice(0, SIDEBAR_WEEK_LIMIT);
  const shown = new Set([...recent, ...week].map(s => s.sessionId));
  return {
    recent,
    week,
    hiddenCount: sessions.filter(s => !shown.has(s.sessionId)).length,
  };
}

export function takeRecentSessions(
  sessions: SessionMeta[],
  limit: number = SIDEBAR_RECENT_LIMIT,
): { shown: SessionMeta[]; hiddenCount: number } {
  const sorted = sortSessionsByRecency(sessions);
  const n = Math.max(0, limit);
  return {
    shown: sorted.slice(0, n),
    hiddenCount: Math.max(0, sorted.length - n),
  };
}

/** 副行日期。今天 / 昨天 / M月D日，对得上 Stitch 那行日历，不引 AppsWorkbench。 */
export function sessionWhen(
  iso?: string | null,
  now: number = Date.now(),
): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  const today0 = startOfLocalDay(now);
  if (t >= today0) return "今天";
  if (t >= today0 - DAY_MS) return "昨天";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 列表 ``phase`` 就是 runtimePhase。机器：
 * idle → orchestrating → awaiting | done | failed（偶发 concluded）。
 * 不是 done/failed 的（含缺字段）算推演中——老会话经常没写 phase，
 * 漏掉它们「推演中」会空。
 */
export function sessionPhaseBucket(phase: string | null | undefined): Exclude<SessionPhaseFilter, "all"> {
  const p = String(phase ?? "").trim().toLowerCase();
  if (p === "failed") return "failed";
  if (p === "done" || p === "concluded") return "done";
  return "running";
}

export function filterSessionsByPhase(
  sessions: SessionMeta[],
  phase: SessionPhaseFilter,
): SessionMeta[] {
  if (phase === "all") return sessions;
  return sessions.filter(s => sessionPhaseBucket(s.phase) === phase);
}

export type SessionAgeGroup = "today" | "yesterday" | "week" | "month" | "older";

export const SESSION_AGE_LABELS: Record<SessionAgeGroup, string> = {
  today: "今天",
  yesterday: "昨天",
  week: "近 7 天",
  month: "近 30 天",
  older: "更早",
};

const AGE_ORDER: SessionAgeGroup[] = ["today", "yesterday", "week", "month", "older"];
const DAY_MS = 86_400_000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 按本地日历分桶。now 可注入，避免测试撞 CI 时区的「现在」。 */
export function sessionAgeGroup(
  iso: string | null | undefined,
  now: number = Date.now(),
): SessionAgeGroup {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "older";
  const today0 = startOfLocalDay(now);
  if (t >= today0) return "today";
  if (t >= today0 - DAY_MS) return "yesterday";
  if (t >= today0 - 7 * DAY_MS) return "week";
  if (t >= today0 - 30 * DAY_MS) return "month";
  return "older";
}

export function groupSessionsByAge(
  sessions: SessionMeta[],
  now: number = Date.now(),
  order: SessionSort = "active",
): { id: SessionAgeGroup; label: string; sessions: SessionMeta[] }[] {
  const buckets: Record<SessionAgeGroup, SessionMeta[]> = {
    today: [],
    yesterday: [],
    week: [],
    month: [],
    older: [],
  };
  for (const s of sessions) {
    buckets[sessionAgeGroup(sessionSortTime(s, order) || null, now)].push(s);
  }
  return AGE_ORDER.filter(id => buckets[id].length > 0).map(id => ({
    id,
    label: SESSION_AGE_LABELS[id],
    sessions: buckets[id],
  }));
}

/** 搜标题。空串原样返回——清空搜索必须回到全表，不能搜出空。 */
export function filterSessionsByQuery(sessions: SessionMeta[], query: string): SessionMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(s => (s.goal || "").toLowerCase().includes(q));
}

/** 切换当前会话：落存储 + 广播（SlideRule 壳监听后整树重挂）。 */
export function activateSession(sessionId: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  } catch {
    /* 隐私模式降级：事件仍然广播，本次内存态生效 */
  }
  window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT, { detail: { sessionId } }));
}

function readActiveSessionId(): string {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY) || "sliderule-v51-product";
  } catch {
    return "sliderule-v51-product";
  }
}

export function SidebarSessions({
  onOpenSliderule,
  onOpenWorkbench,
}: {
  onOpenSliderule?: () => void;
  onOpenWorkbench?: () => void;
}) {
  const [sessions, setSessions] = React.useState<SessionMeta[] | null>(null);
  const [apps, setApps] = React.useState<AppStoreSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [sortOrder, setSortOrder] = React.useState<SessionSort>("active");
  const [phaseFilter, setPhaseFilter] = React.useState<SessionPhaseFilter>("all");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = React.useState<string>(() => readActiveSessionId());
  // 两步删除确认：第一次点垃圾桶进入待确认（变红），再点才真删；点别处/超时复位
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    fetch("/api/sliderule/sessions")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { sessions?: SessionMeta[] };
        setSessions(body.sessions ?? []);
        setError(null);
      })
      .catch((e) => setError(String(e)));
    if (IS_GITHUB_PAGES) return;
    listApps({ limit: SESSION_THUMB_APP_LIMIT, offset: 0 })
      .then(rows => setApps(rows))
      .catch(() => setApps([]));
  }, []);

  React.useEffect(() => {
    refresh();
    const onChanged = () => {
      setActiveId(readActiveSessionId());
      refresh();
    };
    window.addEventListener(SESSION_CHANGED_EVENT, onChanged);
    // 话题落盘/推演完成后重拉：当前会话标题从"新会话"实时变成话题
    window.addEventListener(SESSIONS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, onChanged);
      window.removeEventListener(SESSIONS_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  React.useEffect(() => {
    if (!confirmDeleteId) return;
    const t = window.setTimeout(() => setConfirmDeleteId(null), 3500);
    return () => window.clearTimeout(t);
  }, [confirmDeleteId]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (ev: MouseEvent) => {
      if (!menuRef.current?.contains(ev.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const pick = (id: string) => {
    if (id !== activeId) activateSession(id);
    setActiveId(id);
    onOpenSliderule?.();
  };

  const remove = async (id: string) => {
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(String(e));
      return;
    }
    const remaining = (sessions ?? []).filter((s) => s.sessionId !== id);
    setSessions(remaining);
    // 删的是当前会话：切到最近的剩余会话；一个不剩才向服务端要一个新的
    if (id === activeId) {
      let next = remaining[0]?.sessionId;
      if (!next) {
        try {
          next = await createSessionId();
        } catch (e) {
          setError(String(e instanceof Error ? e.message : e));
          return;
        }
      }
      activateSession(next);
      setActiveId(next);
    }
  };

  const named = (sessions ?? []).filter(s => (s.goal || "").trim());
  const listed = sortSessions(
    filterSessionsByPhase(filterSessionsByQuery(named, query), phaseFilter),
    sortOrder,
  );
  const { recent, week, hiddenCount } = splitSidebarSessions(
    listed,
    Date.now(),
    sortOrder,
  );
  const appsBySession = React.useMemo(() => indexAppsBySession(apps), [apps]);
  const filterDirty = sortOrder !== "active" || phaseFilter !== "all";

  const openWorkbench = (ev: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenWorkbench) return;
    ev.preventDefault();
    onOpenWorkbench();
  };

  const renderRow = (s: SessionMeta) => {
    const active = s.sessionId === activeId;
    const confirming = confirmDeleteId === s.sessionId;
    const when = sessionWhen(s.lastActive || s.createdAt);
    const app = appsBySession.get(s.sessionId);
    const title = sessionRowTitle(s.goal, app);
    return (
      <div
        key={s.sessionId}
        className={`native-agent-session-row${active ? " native-agent-session-row-active" : ""}`}
      >
        <button
          type="button"
          title={title}
          data-testid={`sidebar-session-item-${s.sessionId}`}
          className="native-agent-session-item"
          onClick={() => pick(s.sessionId)}
        >
          <SessionThumb sessionId={s.sessionId} title={title} app={app} />
          <span className="native-agent-session-copy">
            <span className="native-agent-session-title">{title}</span>
            {when && (
              <span className="native-agent-session-meta">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="4" y="5" width="16" height="16" rx="2" />
                  <path d="M4 10h16M8 3v4M16 3v4" />
                </svg>
                {when}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          title={confirming ? "再点一次确认删除" : "删除会话"}
          aria-label={confirming ? "确认删除" : "删除会话"}
          data-testid={`sidebar-session-delete-${s.sessionId}`}
          className={`native-agent-session-delete${confirming ? " native-agent-session-delete-confirm" : ""}`}
          onClick={ev => {
            ev.stopPropagation();
            if (confirming) void remove(s.sessionId);
            else setConfirmDeleteId(s.sessionId);
          }}
        >
          {confirming ? "确认" : (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="native-agent-sessions" data-testid="sidebar-sessions">
      <button
        type="button"
        className="native-agent-session-new"
        data-testid="sidebar-session-new"
        onClick={() => {
          // E28 防双开：已经站在空会话上（不在列表=刚建未落盘，或在列表但
          // 无话题）→ 复用当前；列表里已有空的「新会话」→ 复用它；
          // 都没有才真正要一个新 id。用户实测连点会叠出多个空会话。
          //
          // 这条复用逻辑在"id 改由服务端生成"（2026-08-06）之后更重要了：
          // 铸新 id 现在等于**真的在库里建一条**，不再是懒创建。有它挡着，
          // 连点不会在库里堆出一串空会话。
          const list = sessions ?? [];
          const activeMeta = list.find((s) => s.sessionId === activeId);
          const activeIsBlank = activeMeta ? !activeMeta.goal : true;
          if (activeIsBlank) {
            pick(activeId);
            return;
          }
          const blank = list.find((s) => !s.goal);
          if (blank) {
            pick(blank.sessionId);
            return;
          }
          void (async () => {
            try {
              pick(await createSessionId());
            } catch (e) {
              setError(String(e instanceof Error ? e.message : e));
            }
          })();
        }}
      >
        <svg className="native-agent-session-new-plus" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建会话
      </button>

      <div className="native-agent-session-tools" ref={menuRef}>
        <label className="native-agent-session-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20 16.5 16.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="搜索会话"
            aria-label="搜索会话"
            data-testid="sidebar-session-search"
          />
        </label>
        <button
          type="button"
          className={`native-agent-session-filter${filterDirty ? " native-agent-session-filter-on" : ""}`}
          data-testid="sidebar-session-filter"
          aria-label="排序与筛选"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 7h16M7 12h10M10 17h4" />
          </svg>
        </button>
        <div
          className="native-agent-session-menu"
          data-testid="sidebar-session-menu"
          hidden={!menuOpen}
        >
          <div className="native-agent-session-menu-cap">排序</div>
          <button type="button" data-active={sortOrder === "active"} onClick={() => setSortOrder("active")}>
            最近活跃
          </button>
          <button type="button" data-active={sortOrder === "created"} onClick={() => setSortOrder("created")}>
            创建时间
          </button>
          <div className="native-agent-session-menu-cap">阶段</div>
          <button type="button" data-active={phaseFilter === "all"} onClick={() => setPhaseFilter("all")}>
            全部
          </button>
          <button type="button" data-active={phaseFilter === "running"} onClick={() => setPhaseFilter("running")}>
            推演中
          </button>
          <button type="button" data-active={phaseFilter === "done"} onClick={() => setPhaseFilter("done")}>
            已完成
          </button>
          <button type="button" data-active={phaseFilter === "failed"} onClick={() => setPhaseFilter("failed")}>
            失败
          </button>
        </div>
      </div>

      <div className="native-agent-sessions-list" data-testid="sidebar-session-list">
        {sessions === null && !error && (
          <div className="native-agent-sessions-hint">加载中…</div>
        )}
        {error && <div className="native-agent-sessions-hint">会话列表不可用</div>}
        {sessions?.length === 0 && <div className="native-agent-sessions-hint">暂无历史会话</div>}
        {/* E30：空会话（无话题）不进列表——它们只是还没说话的壳，显示成
            一排「新会话」是纯噪音（冒烟遗留的空会话同样隐藏） */}
        {sessions && recent.length > 0 && (
          <div className="native-agent-session-group">
            <div className="native-agent-sessions-label">最近</div>
            {recent.map(renderRow)}
          </div>
        )}
        {sessions && week.length > 0 && (
          <div className="native-agent-session-group">
            <div className="native-agent-sessions-label">近七天</div>
            {week.map(renderRow)}
          </div>
        )}
        {sessions !== null && !error && listed.length === 0 && named.length > 0 && (
          <div className="native-agent-sessions-hint">没有匹配的会话</div>
        )}
      </div>
      {hiddenCount > 0 && (
        <a
          href="/agent-loop/workbench"
          className="native-agent-session-more"
          data-testid="sidebar-session-more"
          onClick={openWorkbench}
        >
          更多
        </a>
      )}
    </div>
  );
}
