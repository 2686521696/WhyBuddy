import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { BrainstormGraphTelemetry } from "@shared/blueprint/brainstorm-reasoning-graph";
import { deriveStatusBarFacts } from "./derive-status-bar";
import { autopilotTheme } from "./autopilot-theme";
import type { WhyBuddyExecutorMode } from "./types";

export function WhyBuddyTopHud({
  state,
  goal,
  turnCount,
  isRunning,
  driveLoopCount,
  telemetry,
  executorMode,
  onResetSession,
}: {
  state: V5SessionState;
  goal: string;
  turnCount: number;
  isRunning: boolean;
  driveLoopCount?: number;
  telemetry?: BrainstormGraphTelemetry | null;
  executorMode?: WhyBuddyExecutorMode;
  onResetSession?: () => void;
}) {
  const facts = deriveStatusBarFacts(state, {
    turnCount,
    isRunning,
    driveLoopCount,
    immersion: true,
    executorMode,
  });

  return (
    <header
      className={autopilotTheme.immersionOverlayHeader}
      data-testid="whybuddy-status-bar"
    >
      <div
        className={`${autopilotTheme.overlayTransparent} flex w-full items-center gap-3 border-b border-slate-900/[0.06] pb-1.5`}
      >
        <div
          className={`${autopilotTheme.overlayBar} min-w-0 flex-1 border-b-0 pb-0`}
        >
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            STATUS
          </span>
          <span
            data-testid="whybuddy-conclusion-badge"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${facts.conclusionClassName}`}
          >
            {facts.conclusionLabel}
          </span>
          <span
            data-testid="whybuddy-grounding-badge"
            title={facts.groundingHint || facts.groundingLabel}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${facts.groundingClassName}`}
          >
            {facts.groundingLabel}
          </span>
          <span
            data-testid="whybuddy-executor-mode"
            className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-medium ring-1 ring-inset ${facts.executorModeClassName}`}
          >
            {facts.executorModeLabel}
          </span>
          {facts.groundingHint && (
            <span
              className="hidden text-[10px] text-amber-700 lg:inline"
              data-testid="whybuddy-grounding-hint"
            >
              {facts.groundingHint}
            </span>
          )}
          <span className="hidden h-3 w-px bg-slate-300 sm:inline-block" aria-hidden />
          <span className="font-mono text-[10px] text-slate-400">话题</span>
          <span
            className={`min-w-0 max-w-[min(36vw,280px)] truncate font-medium text-slate-800 sm:max-w-[min(42vw,360px)] ${
              !goal ? "text-slate-400" : ""
            }`}
            data-testid="whybuddy-goal-display"
            title={goal}
          >
            {goal || "输入想法，架构图从 INTAKE 展开…"}
          </span>
          <span className="hidden h-3 w-px bg-slate-300 md:inline-block" aria-hidden />
          <InlineMetric label="可信" value={facts.trustedArtifactCount} />
          <InlineMetric label="缺口" value={facts.openGapCount} />
          <InlineMetric label="环" value={facts.driveLoopCount} />
          <InlineMetric label="调用" value={facts.capabilityRunCount} />
          {telemetry?.sourceCount != null && (
            <InlineMetric label="来源" value={telemetry.sourceCount} />
          )}
          {telemetry?.activeRoleCount != null && (
            <InlineMetric label="角色" value={telemetry.activeRoleCount} />
          )}
          <span className="text-slate-400">
            阶段{" "}
            <span className="font-mono font-semibold text-slate-700">{facts.phaseLabel}</span>
          </span>
          {facts.dataReady && (
            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              dataReady
            </span>
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          data-testid="whybuddy-header-actions"
        >
          {onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              disabled={isRunning}
              data-testid="whybuddy-reset-session"
              className={autopilotTheme.auditBtn}
              title={isRunning ? "推演进行中，请稍后再重置" : "清空本轮对话与持久化状态，重新开始"}
            >
              重置会话
            </button>
          )}
          <a href="/whybuddy/dev" className={autopilotTheme.devLink}>
            Dev
          </a>
        </div>
      </div>
    </header>
  );
}

function InlineMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="tabular-nums text-slate-600">
      <span className="text-slate-400">{label} </span>
      <span className="font-mono font-semibold text-slate-800">{value}</span>
    </span>
  );
}