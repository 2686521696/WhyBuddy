import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveStatusBarFacts } from "./derive-status-bar";
import type { SlideRuleExecutorMode } from "./types";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";

export function SlideRuleStatusBar({
  state,
  turnCount,
  isRunning,
  driveLoopCount,
  closureReason,
  executorMode,
  publishClosure,
}: {
  state: V5SessionState;
  turnCount: number;
  isRunning: boolean;
  driveLoopCount?: number;
  closureReason?: string | null;
  executorMode?: SlideRuleExecutorMode;
  publishClosure?: PublishClosureSummary | null;
}) {
  const facts = deriveStatusBarFacts(state, {
    turnCount,
    isRunning,
    driveLoopCount,
    closureReason,
    executorMode,
    publishClosure,
  });

  return (
    <div
      className="border-b border-[#E7E2D9]/80 bg-[#F5F1EA]/90 px-4 py-1.5"
      data-testid="sliderule-status-bar"
      aria-label="推演状态"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-600">
        <img
          src="/assets/sliderule_icon_flat_transparent.png"
          alt="SlideRule"
          className="mr-1 inline-block h-3.5 w-3.5 opacity-60 align-middle"
          title="SlideRule"
        />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          STATUS
        </span>
        <span
          data-testid="sliderule-conclusion-badge"
          className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${facts.conclusionClassName}`}
        >
          {facts.conclusionLabel}
        </span>
        <span
          data-testid="sliderule-grounding-badge"
          title={facts.groundingHint || facts.groundingLabel}
          className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${facts.groundingClassName}`}
        >
          {facts.groundingLabel}
        </span>
        <span
          data-testid="sliderule-executor-mode"
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${facts.executorModeClassName}`}
        >
          {facts.executorModeLabel}
        </span>
        {facts.publishClosureLabel && (
          <span
            data-testid="sliderule-publish-closure-badge"
            data-fail-closed={facts.publishClosureFailClosed ? "true" : "false"}
            title={facts.publishClosureHint}
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${facts.publishClosureClassName}`}
          >
            {facts.publishClosureLabel}
          </span>
        )}
        <span>
          <span className="text-stone-400">轮次 </span>
          <span className="font-mono font-semibold text-stone-700">{facts.turnCount}</span>
        </span>
        <span>
          <span className="text-stone-400">阶段 </span>
          <span className="font-mono text-stone-700">{facts.phaseLabel}</span>
        </span>
        {facts.groundingHint && (
          <span className="text-amber-700" data-testid="sliderule-grounding-hint">
            {facts.groundingHint}
          </span>
        )}
        {facts.parkHint && (
          <span className="text-stone-500" title={facts.goalSnippet}>
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
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.trustedArtifactCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">可信产物</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.openGapCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">缺口</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.driveLoopCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">调度环</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.capabilityRunCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">能力调用</span>
        </div>
      </div>
    </div>
  );
}
