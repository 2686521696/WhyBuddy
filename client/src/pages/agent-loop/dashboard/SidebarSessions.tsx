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
  // 两步删除确认：第一次点垃圾桶进入待确认（变红），再点才真删；点别处/超时复位
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

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
        {/* E30：空会话（无话题）不进列表——它们只是还没说话的壳，显示成
            一排「新会话」是纯噪音（冒烟遗留的空会话同样隐藏） */}
        {sessions?.filter((s) => (s.goal || "").trim()).map((s) => {
          const active = s.sessionId === activeId;
          const confirming = confirmDeleteId === s.sessionId;
          return (
            <div
              key={s.sessionId}
              className={`native-agent-session-row${active ? " native-agent-session-row-active" : ""}`}
            >
              <button
                type="button"
                title={s.goal || s.sessionId}
                data-testid={`sidebar-session-item-${s.sessionId}`}
                className="native-agent-session-item"
                onClick={() => pick(s.sessionId)}
              >
                {s.goal || "新会话"}
              </button>
              <button
                type="button"
                title={confirming ? "再点一次确认删除" : "删除会话"}
                aria-label={confirming ? "确认删除" : "删除会话"}
                data-testid={`sidebar-session-delete-${s.sessionId}`}
                className={`native-agent-session-delete${confirming ? " native-agent-session-delete-confirm" : ""}`}
                onClick={(ev) => {
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
        })}
      </div>
    </div>
  );
}
