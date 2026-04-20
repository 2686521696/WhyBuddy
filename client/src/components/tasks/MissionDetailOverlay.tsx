import { useCallback, useEffect, useRef } from "react";

import { useI18n } from "@/i18n";
import type { MissionTaskDetail } from "@/lib/tasks-store";

import { CompactPlanetInterior } from "./CompactPlanetInterior";
import {
  agentStatusLabel,
  agentStatusTone,
  compactText,
  formatTaskRelative,
  missionStatusLabel,
  missionStatusTone,
} from "./task-helpers";

export interface MissionDetailOverlayProps {
  detail: MissionTaskDetail | null;
  onClose: () => void;
  onNavigateToDetail: (taskId: string) => void;
}

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function MissionDetailOverlay({
  detail,
  onClose,
  onNavigateToDetail,
}: MissionDetailOverlayProps) {
  const { locale } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  if (!detail) return null;

  const totalWorkPackages = Math.max(detail.taskCount, detail.tasks.length);
  const completedWorkPackages = Math.min(
    detail.completedTaskCount,
    totalWorkPackages
  );
  const summaryText =
    compactText(detail.summary || detail.sourceText, 220) ||
    t(
      locale,
      "当前任务还没有补充摘要，打开完整详情后可继续查看工作包。首页运行证据统一留在共享运行证据容器。",
      "This mission does not have a summary yet. Open the full detail view to inspect work packages. Runtime evidence on Office home stays in the shared runtime evidence container."
    );
  const workPackageSummary =
    totalWorkPackages > 0
      ? t(
          locale,
          `${completedWorkPackages}/${totalWorkPackages} 已完成`,
          `${completedWorkPackages}/${totalWorkPackages} completed`
        )
      : t(locale, "尚未生成工作包", "No work packages yet");
  const coordinationTitle =
    detail.status === "waiting"
      ? t(locale, "等待继续推进", "Waiting to continue")
      : detail.operatorState === "blocked"
        ? t(locale, "阻塞待处理", "Blocker pending")
        : detail.operatorState === "paused"
          ? t(locale, "暂停中", "Paused")
          : t(locale, "协作状态", "Coordination");
  const coordinationDetail =
    compactText(
      detail.waitingFor ||
        detail.decisionPrompt ||
        detail.blocker?.reason ||
        detail.currentStageLabel ||
        detail.summary,
      180
    ) ||
    t(
      locale,
      "当前没有额外的协作说明。首页的日志、产物和运行证据统一保留在共享运行证据容器。",
      "There is no extra coordination note right now. Logs, artifacts, and runtime evidence on Office home stay in the shared runtime evidence container."
    );
  const stageLabel =
    detail.currentStageLabel || t(locale, "等待聚焦阶段", "Awaiting stage focus");
  const activeAgents = detail.activeAgentCount || detail.agents.length;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(247,239,226,0.16),rgba(59,39,20,0.08)_40%,rgba(25,16,8,0.22)_100%)] px-4 py-6 backdrop-blur-[6px]"
      onClick={handleBackdropClick}
      data-testid="mission-detail-backdrop"
    >
      <div
        ref={panelRef}
        className="animate-in fade-in zoom-in-95 relative flex max-h-[min(82vh,760px)] w-full max-w-[720px] flex-col gap-4 overflow-y-auto rounded-[28px] border border-[rgba(169,136,102,0.26)] bg-[linear-gradient(180deg,rgba(255,252,247,0.98),rgba(244,235,223,0.95))] p-6 shadow-[0_24px_80px_rgba(86,60,33,0.24)] duration-200"
        data-testid="mission-detail-panel"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
              {t(locale, "当前任务", "Current mission")}
            </p>
            <h2 className="mt-1 text-xl font-bold text-stone-900">
              {detail.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                {detail.departmentLabels.length > 0
                  ? detail.departmentLabels.join(" / ")
                  : t(locale, "未分配部门", "Unassigned")}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${missionStatusTone(detail.status)}`}
              >
                {missionStatusLabel(detail.status, locale)}
              </span>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                {stageLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/72 px-3 py-2 text-xs font-semibold text-stone-600 transition-colors hover:bg-white hover:text-stone-900"
            data-testid="mission-detail-close"
          >
            {t(locale, "关闭", "Close")}
          </button>
        </div>

        <CompactPlanetInterior detail={detail} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="rounded-2xl bg-white/58 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
            <h3 className="text-xs font-semibold text-stone-700">
              {t(locale, "任务概览", "Task overview")}
            </h3>
            <p
              className="mt-2 rounded-xl bg-white/70 px-3 py-3 text-[12px] leading-6 text-stone-700"
              data-testid="mission-detail-summary"
            >
              {summaryText}
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-white/60 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  {t(locale, "工作包", "Work packages")}
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-800">
                  {workPackageSummary}
                </div>
              </div>
              <div className="rounded-xl bg-white/60 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  {t(locale, "最近更新", "Last update")}
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-800">
                  {formatTaskRelative(detail.updatedAt, locale)}
                </div>
              </div>
              <div className="rounded-xl bg-white/60 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  {t(locale, "活跃成员", "Active crew")}
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-800">
                  {t(locale, `${activeAgents} 名`, `${activeAgents}`)}
                </div>
              </div>
              <div className="rounded-xl bg-white/60 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  {t(locale, "执行轮次", "Attempt")}
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-800">
                  #{detail.attempt}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl bg-sky-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                {coordinationTitle}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-stone-700">
                {coordinationDetail}
              </div>
              <div className="mt-2 text-[10px] leading-5 text-stone-500">
                {t(
                  locale,
                  "日志、产物和运行证据在首页上统一归口到共享运行证据容器。",
                  "On Office home, logs, artifacts, and runtime evidence stay in the shared runtime evidence container."
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white/52 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]">
            <h3 className="mb-2 text-xs font-semibold text-stone-700">
              {t(locale, "执行成员", "Agent crew")}
            </h3>
            {detail.agents.length === 0 ? (
              <p className="text-xs text-stone-400">
                {t(locale, "暂无执行成员", "No agents yet")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1" data-testid="mission-detail-agents">
                {detail.agents.map(agent => (
                  <li
                    key={agent.id}
                    className="flex items-center gap-2 rounded-lg bg-white/60 px-2.5 py-1.5"
                  >
                    <span className="text-sm">{agent.name || agent.id}</span>
                    <span className="text-[10px] text-stone-500">
                      {agent.role}
                    </span>
                    <span
                      className={`workspace-status ml-auto px-1.5 py-0.5 text-[10px] font-medium leading-tight ${agentStatusTone(agent.status)}`}
                    >
                      {agentStatusLabel(agent.status, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onNavigateToDetail(detail.id)}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100"
            data-testid="mission-detail-navigate"
          >
            {t(locale, "查看完整详情", "Open full detail")}
          </button>
        </div>
      </div>
    </div>
  );
}
