import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { BrainstormGraphTelemetry } from "@shared/blueprint/brainstorm-reasoning-graph";
import { deriveStatusBarFacts } from "./derive-status-bar";
import { autopilotTheme } from "./autopilot-theme";
import type { SlideRuleExecutorMode } from "./types";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { Layers, RotateCw } from "lucide-react";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";

export function SlideRuleTopHud({
  state,
  goal,
  turnCount,
  isRunning,
  driveLoopCount,
  telemetry,
  executorMode,
  publishClosure,
  onResetSession,
  onOpenDeliverables,
  embedded = false,
}: {
  state: V5SessionState;
  goal: string;
  turnCount: number;
  isRunning: boolean;
  driveLoopCount?: number;
  telemetry?: BrainstormGraphTelemetry | null;
  executorMode?: SlideRuleExecutorMode;
  publishClosure?: PublishClosureSummary | null;
  onResetSession?: () => void;
  onOpenDeliverables?: () => void;
  embedded?: boolean;
}) {
  const facts = deriveStatusBarFacts(state, {
    turnCount,
    isRunning,
    driveLoopCount,
    immersion: true,
    executorMode,
    publishClosure,
  });

  return (
    <header
      className={autopilotTheme.immersionOverlayHeader}
      data-testid="sliderule-status-bar"
    >
      <div className="flex w-full items-center justify-between gap-4">
        {/* STATUS 组：装进描边圆角盒（样式版），信息项不变 */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {embedded ? null : (
            <img
              src="/assets/sliderule_logo_wordmark_transparent.png"
              alt="SlideRule"
              className="h-[42px] w-auto max-w-[156px] shrink-0 object-contain opacity-95 sm:h-[46px]"
              title="SlideRule"
            />
          )}
          <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-[#E7E2D9] bg-white/80 px-3.5 py-2 text-xs shadow-[0_1px_6px_rgb(68_60_44/0.05)]">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              STATUS
            </span>
            <span
              data-testid="sliderule-conclusion-badge"
              className="text-[10px] text-stone-500"
            >
              {facts.conclusionLabel}
            </span>
            <span className="font-mono text-[10px] text-stone-400">话题</span>
            <span
              className={`min-w-0 max-w-[min(30vw,280px)] truncate font-medium text-stone-800 sm:max-w-[min(34vw,380px)] ${
                !goal ? "text-stone-400" : ""
              }`}
              data-testid="sliderule-goal-display"
              title={goal}
            >
              {goal || "尚未稳定话题"}
            </span>
            <span className="hidden h-3 w-px bg-[#E7E2D9] md:inline-block" aria-hidden />
            <span className="hidden text-stone-400 sm:inline">
              阶段{" "}
              <span className="font-mono font-semibold text-stone-700">
                {facts.phaseLabel || "就绪"}
              </span>
            </span>
          </div>
        </div>

        <div
          className="flex shrink-0 items-center justify-end gap-2 py-1"
          data-testid="sliderule-header-actions"
        >
          {onOpenDeliverables && (
            <button
              type="button"
              onClick={onOpenDeliverables}
              data-testid="sliderule-deliverables-open"
              className="flex h-9 items-center gap-1.5 rounded-full border border-[#E7E2D9] bg-white px-4 text-[13px] font-medium text-stone-700 shadow-[0_1px_6px_rgb(68_60_44/0.06)] transition hover:border-[#D8D1C4] hover:bg-[#F5F1EA]"
              title="交付物"
            >
              <Layers className="h-4 w-4" />
              交付物
            </button>
          )}
          {/* 设置入口收敛到侧栏「设置」整页（用户反馈：与侧栏重复） */}
          {onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              disabled={isRunning}
              data-testid="sliderule-reset-session"
              className="flex h-9 items-center gap-1.5 rounded-full border border-[#E7E2D9] bg-white px-4 text-[13px] font-medium text-stone-700 shadow-[0_1px_6px_rgb(68_60_44/0.06)] transition hover:border-[#D8D1C4] hover:bg-[#F5F1EA] disabled:opacity-45"
              title={isRunning ? "推演进行中，稍后再重置" : "清空本轮对话与持久化状态，重新开始"}
            >
              <RotateCw className="h-4 w-4" />
              重置会话
            </button>
          )}
          {!IS_GITHUB_PAGES && (
            <a href="/sliderule/dev" className={autopilotTheme.devLink}>
              Dev
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

export function InlineMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="tabular-nums text-stone-600">
      <span className="text-stone-400">{label} </span>
      <span className="font-mono font-semibold text-stone-800">{value}</span>
    </span>
  );
}
