import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { BrainstormGraphTelemetry } from "@shared/blueprint/brainstorm-reasoning-graph";
import { deriveStatusBarFacts } from "./derive-status-bar";
import { autopilotTheme } from "./autopilot-theme";
import type { SlideRuleExecutorMode } from "./types";
import type { ProjectionDensity } from "./sliderule-projection-constants";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { Layers, Settings2 } from "lucide-react";
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
  projectionDensity,
  onProjectionDensityChange,
  viewMode,
  onViewModeChange,
  surfaceMode = "reasoning",
  onSurfaceModeChange,
  onResetSession,
  onOpenSettings,
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
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
  viewMode?: "overview" | "collaboration" | "reasoning";
  onViewModeChange?: (mode: "overview" | "collaboration" | "reasoning") => void;
  surfaceMode?: "chat" | "reasoning";
  onSurfaceModeChange?: (mode: "chat" | "reasoning") => void;
  onResetSession?: () => void;
  onOpenSettings?: () => void;
  onOpenDeliverables?: () => void;
  embedded?: boolean;
}) {
  const effectiveSurfaceMode = surfaceMode || "reasoning";
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
      <div className="flex w-full items-start justify-between gap-4">
        <div className={`${autopilotTheme.overlayBar} min-w-0 flex-1 pr-4`}>
          {embedded ? null : (
            <img
              src="/assets/sliderule_logo_wordmark_transparent.png"
              alt="SlideRule"
              className="mr-3 h-[42px] w-auto max-w-[156px] shrink-0 object-contain opacity-95 sm:h-[46px]"
              title="SlideRule"
            />
          )}
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            STATUS
          </span>
          <span
            data-testid="sliderule-conclusion-badge"
            className="text-[10px] text-slate-500"
          >
            {facts.conclusionLabel}
          </span>
          <span className="font-mono text-[10px] text-slate-400">话题</span>
          <span
            className={`min-w-0 max-w-[min(34vw,300px)] truncate font-medium text-slate-800 sm:max-w-[min(38vw,420px)] ${
              !goal ? "text-slate-400" : ""
            }`}
            data-testid="sliderule-goal-display"
            title={goal}
          >
            {goal || "尚未稳定话题"}
          </span>
          <span className="hidden h-3 w-px bg-slate-300 md:inline-block" aria-hidden />
          <span className="hidden text-slate-400 sm:inline">
            阶段{" "}
            <span className="font-mono font-semibold text-slate-700">
              {facts.phaseLabel || "就绪"}
            </span>
          </span>

          {turnCount > 0 && onViewModeChange && (
            <div
              className="flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 ring-1 ring-slate-200/80"
              data-testid="sliderule-viewmode-toggle"
            >
              {(["overview", "collaboration", "reasoning"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onViewModeChange(mode)}
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${
                    viewMode === mode
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                  title={mode === "overview" ? "概览" : mode === "collaboration" ? "协作" : "思考链"}
                >
                  {mode === "overview" ? "概览" : mode === "collaboration" ? "协作" : "链路"}
                </button>
              ))}
            </div>
          )}

          {onSurfaceModeChange && (
            <div
              className="ml-2 flex items-center gap-0.5 rounded-full bg-indigo-100 p-0.5 ring-1 ring-indigo-200/80"
              data-testid="sliderule-surfacemode-toggle"
              title="界面模式"
            >
              {(["chat", "reasoning"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onSurfaceModeChange(mode)}
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${
                    effectiveSurfaceMode === mode
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-indigo-500 hover:text-indigo-700"
                  }`}
                >
                  {mode === "chat" ? "聊天" : "推演"}
                </button>
              ))}
            </div>
          )}
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
              className={`${autopilotTheme.auditBtn} flex items-center gap-1`}
              title="交付物"
            >
              <Layers className="h-3.5 w-3.5" />
              交付物
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              data-testid="sliderule-settings-open"
              className={`${autopilotTheme.auditBtn} flex items-center justify-center`}
              title="设置"
              aria-label="设置"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              disabled={isRunning}
              data-testid="sliderule-reset-session"
              className={autopilotTheme.auditBtn}
              title={isRunning ? "推演进行中，稍后再重置" : "清空本轮对话与持久化状态，重新开始"}
            >
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
    <span className="tabular-nums text-slate-600">
      <span className="text-slate-400">{label} </span>
      <span className="font-mono font-semibold text-slate-800">{value}</span>
    </span>
  );
}
