/**
 * SessionSwitcher — Claude 式会话管理（顶栏「会话」按钮 + 下拉面板）。
 *
 * 面板打开时实拉 python 会话库（GET /api/sliderule/sessions）：
 * 最近话题列表（goal + 阶段徽章 + 最近活跃）+ 新建会话。
 * 切换/新建由上层以 key=sessionId 整树重挂完成水合——本组件只负责
 * 选择，不碰会话状态。列表拉取失败如实显示，不摆假列表。
 */

import React from "react";
import { History, Plus } from "lucide-react";

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

const PHASE_BADGE: Record<string, { label: string; cls: string }> = {
  done: { label: "已闭环", cls: "bg-emerald-50 text-emerald-700" },
  awaiting: { label: "待介入", cls: "bg-amber-50 text-amber-700" },
  running: { label: "推演中", cls: "bg-amber-50 text-amber-700" },
  idle: { label: "就绪", cls: "bg-[#F0EDE5] text-stone-500" },
};

export function SessionSwitcher({
  activeSessionId,
  onSwitch,
  onNew,
}: {
  activeSessionId: string;
  onSwitch: (sessionId: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [sessions, setSessions] = React.useState<SessionMeta[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    fetch("/api/sliderule/sessions")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { sessions?: SessionMeta[] };
        if (!cancelled) setSessions(sortSessionsByRecency(body.sessions ?? []));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== activeSessionId) onSwitch(id);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="sliderule-session-switcher"
        className="flex h-9 items-center gap-1.5 rounded-full border border-[#E7E2D9] bg-white px-4 text-[13px] font-medium text-stone-700 shadow-[0_1px_6px_rgb(68_60_44/0.06)] transition hover:border-[#D8D1C4] hover:bg-[#F5F1EA]"
        title="历史会话与新建"
      >
        <History className="h-4 w-4" />
        会话
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-11 z-50 w-[360px] overflow-hidden rounded-2xl border border-[#E7E2D9] bg-white shadow-[0_18px_50px_rgb(68_60_44/0.22)]"
            data-testid="sliderule-session-list"
          >
            <button
              type="button"
              data-testid="sliderule-session-new"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className="flex w-full items-center gap-2 border-b border-[#F0EDE5] px-4 py-3 text-left text-[13px] font-semibold text-[#B0552F] transition hover:bg-[#FAF6F0]"
            >
              <Plus className="h-4 w-4" />
              新建会话
            </button>
            <div className="max-h-[380px] overflow-y-auto py-1">
              {sessions === null && !error && (
                <div className="px-4 py-3 text-[12px] text-stone-400">加载中…</div>
              )}
              {error && (
                <div className="px-4 py-3 text-[12px] text-red-500">
                  会话列表不可用：{error}
                </div>
              )}
              {sessions?.length === 0 && (
                <div className="px-4 py-3 text-[12px] text-stone-300">暂无历史会话</div>
              )}
              {sessions?.map((s) => {
                const active = s.sessionId === activeSessionId;
                const badge = PHASE_BADGE[s.phase ?? ""] ?? null;
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    data-testid={`sliderule-session-item-${s.sessionId}`}
                    onClick={() => pick(s.sessionId)}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left transition ${
                      active ? "bg-[#F8E8E0]/70" : "hover:bg-[#FAF8F3]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-stone-700">
                        {s.goal || s.sessionId}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-stone-300">
                        {s.lastActive ? String(s.lastActive).slice(0, 19).replace("T", " ") : s.sessionId}
                      </span>
                    </span>
                    {badge && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                    {active && (
                      <span className="shrink-0 rounded-full bg-[#D97757] px-2 py-0.5 text-[10px] font-semibold text-white">
                        当前
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
