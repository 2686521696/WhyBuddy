import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveStatusBarFacts } from "./derive-status-bar";
import type { WhyBuddyExecutorMode } from "./types";

export function WhyBuddyStatusBar({
  state,
  turnCount,
  isRunning,
  driveLoopCount,
  closureReason,
  executorMode,
}: {
  state: V5SessionState;
  turnCount: number;
  isRunning: boolean;
  driveLoopCount?: number;
  closureReason?: string | null;
  executorMode?: WhyBuddyExecutorMode;
}) {
  const facts = deriveStatusBarFacts(state, {
    turnCount,
    isRunning,
    driveLoopCount,
    closureReason,
    executorMode,
  });

  return (
    <div
      className="border-b border-slate-200/80 bg-slate-50/90 px-4 py-1.5"
      data-testid="whybuddy-status-bar"
      aria-label="推演状态"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          STATUS
        </span>
        <span
          data-testid="whybuddy-conclusion-badge"
          className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${facts.conclusionClassName}`}
        >
          {facts.conclusionLabel}
        </span>
        <span
          data-testid="whybuddy-grounding-badge"
          title={facts.groundingHint || facts.groundingLabel}
          className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${facts.groundingClassName}`}
        >
          {facts.groundingLabel}
        </span>
        <span
          data-testid="whybuddy-executor-mode"
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${facts.executorModeClassName}`}
        >
          {facts.executorModeLabel}
        </span>
        <span>
          <span className="text-slate-400">轮次 </span>
          <span className="font-mono font-semibold text-slate-700">{facts.turnCount}</span>
        </span>
        <span>
          <span className="text-slate-400">阶段 </span>
          <span className="font-mono text-slate-700">{facts.phaseLabel}</span>
        </span>
        {facts.groundingHint && (
          <span className="text-amber-700" data-testid="whybuddy-grounding-hint">
            {facts.groundingHint}
          </span>
        )}
        {facts.parkHint && (
          <span className="text-slate-500" title={facts.goalSnippet}>
            {facts.parkHint}
          </span>
        )}
        {facts.dataReady && (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            dataReady
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-[10px]">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-slate-800">
            {facts.trustedArtifactCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-slate-400">可信产物</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-slate-800">
            {facts.openGapCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-slate-400">缺口</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-slate-800">
            {facts.driveLoopCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-slate-400">调度环</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-slate-800">
            {facts.capabilityRunCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-slate-400">能力调用</span>
        </div>
      </div>
    </div>
  );
}