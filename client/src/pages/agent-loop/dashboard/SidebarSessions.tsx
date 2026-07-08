/**
 * SidebarSessions — Claude Code 式侧栏会话区：「新建会话」+ 最近会话列表。
 *
 * 数据：GET /api/sliderule/sessions（python 会话库）。切换/新建只做两件事：
 * 写 localStorage 的 active-session-id + 广播 window 事件——SlideRule 会话壳
 * 监听事件后以 key=sessionId 整树重挂完成水合。列表拉取失败如实显示。
 */

import React from "react";

export const ACTIVE_SESSION_KEY = "sliderule:active-session-id";
export const SESSION_CHANGED_EVENT = "sliderule:active-session-changed";

export interface SessionMeta {
  sessionId: string;
  goal: string;
  createdAt?: string | null;
  lastActive?: string | null;
  artifactCount?: number;
  phase?: string;
}

/** 新会话 id：sr- 前缀 + 时间戳 + 随机尾，可读且不撞。 */
export function newSessionId(): string {
  return `sr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 最近活跃倒序（无时间戳的沉底，稳定排序）。 */
export function sortSessionsByRecency(sessions: SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((a, b) =>
    String(b.lastActive ?? b.createdAt ?? "").localeCompare(String(a.lastActive ?? a.createdAt ?? ""))
  );
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

export function SidebarSessions({ onOpenSliderule }: { onOpenSliderule?: () => void }) {
  const [sessions, setSessions] = React.useState<SessionMeta[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string>(() => readActiveSessionId());

  const refresh = React.useCallback(() => {
    fetch("/api/sliderule/sessions")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { sessions?: SessionMeta[] };
        setSessions(sortSessionsByRecency(body.sessions ?? []));
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  React.useEffect(() => {
    refresh();
    const onChanged = () => {
      setActiveId(readActiveSessionId());
      refresh();
    };
    window.addEventListener(SESSION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const pick = (id: string) => {
    if (id !== activeId) activateSession(id);
    setActiveId(id);
    onOpenSliderule?.();
  };

  return (
    <div className="native-agent-sessions" data-testid="sidebar-sessions">
      <button
        type="button"
        className="native-agent-session-new"
        data-testid="sidebar-session-new"
        onClick={() => pick(newSessionId())}
      >
        <span className="native-agent-session-new-plus">+</span>
        新建会话
      </button>

      <div className="native-agent-sessions-label">最近</div>
      <div className="native-agent-sessions-list" data-testid="sidebar-session-list">
        {sessions === null && !error && (
          <div className="native-agent-sessions-hint">加载中…</div>
        )}
        {error && <div className="native-agent-sessions-hint">会话列表不可用</div>}
        {sessions?.length === 0 && <div className="native-agent-sessions-hint">暂无历史会话</div>}
        {sessions?.map((s) => {
          const active = s.sessionId === activeId;
          return (
            <button
              key={s.sessionId}
              type="button"
              title={s.goal || s.sessionId}
              data-testid={`sidebar-session-item-${s.sessionId}`}
              className={`native-agent-session-item${active ? " native-agent-session-item-active" : ""}`}
              onClick={() => pick(s.sessionId)}
            >
              {s.goal || "新会话"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
