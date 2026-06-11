import React from "react";
import type { ActionTrace, LiveAction } from "@shared/blueprint/capability-process-labels";
import {
  buildRouteSummary,
  deriveTurnRoute,
  type RouteStation,
  type RouteStationTone,
  type TurnRouteFacts,
} from "@shared/blueprint/whybuddy-turn-route";
import { autopilotTheme } from "./autopilot-theme";
import type { TurnStep } from "./types";
import { executionTurnSteps } from "./turn-route-steps";

const TONE_DOT: Record<RouteStationTone, string> = {
  process: "bg-[#888780]",
  reconverge: "bg-[#EF9F27]",
  pass: "bg-[#1D9E75]",
  partial: "bg-[#EF9F27]",
  fail: "bg-rose-500",
  pending: "border-2 border-slate-300 bg-white",
  active: "bg-[#888780] animate-pulse",
};

function formatStationTime(timestamp?: string): string | null {
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}

function StationDot({ tone }: { tone: RouteStationTone }) {
  const hollow = tone === "pending";
  return (
    <span
      className={`absolute -left-6 top-[3px] size-3 rounded-full ${TONE_DOT[tone]} ${
        hollow ? "box-border" : ""
      }`}
    />
  );
}

function ExecutionSubsteps({
  steps,
  actions,
  sessionId,
  activeStepId,
  streaming,
}: {
  steps: TurnStep[];
  actions: ActionTrace[];
  sessionId: string;
  activeStepId?: string | null;
  streaming: boolean;
}) {
  const execSteps = executionTurnSteps(steps).filter((s) => s.kind !== "narration");
  if (execSteps.length === 0 && actions.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-slate-200 pl-2.5">
      {execSteps.map((step) => {
        if (step.kind === "chip") {
          return (
            <span
              key={step.id}
              className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                step.realLlm
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : "bg-slate-50 text-slate-600 ring-slate-200"
              }`}
            >
              {step.label}
            </span>
          );
        }
        const active = streaming && step.id === activeStepId;
        return (
          <p
            key={step.id}
            className={`m-0 text-xs leading-relaxed ${
              step.kind === "step_narration" && step.realLlm
                ? "text-violet-600"
                : "text-slate-500"
            }`}
          >
            {active ? step.text.slice(0, Math.min(step.text.length, 40)) : step.text}
            {active && step.text.length > 40 ? "…" : ""}
          </p>
        );
      })}
      {actions.map((trace, i) => (
        <a
          key={`${trace.label}-${i}`}
          href={`/whybuddy/dev?session=${encodeURIComponent(sessionId)}`}
          className={autopilotTheme.actionTrace}
        >
          ⚡ {trace.label}
        </a>
      ))}
    </div>
  );
}

function StationRow({
  station,
  steps,
  actions,
  sessionId,
  active,
  liveAction,
  activeStepId,
  streaming,
}: {
  station: RouteStation;
  steps: TurnStep[];
  actions: ActionTrace[];
  sessionId: string;
  active: boolean;
  liveAction: LiveAction | null;
  activeStepId?: string | null;
  streaming: boolean;
}) {
  const time = formatStationTime(station.timestamp);
  const tone: RouteStationTone = active ? "active" : station.tone;
  const title =
    station.kind === "await" ? "等待你的下一步" : station.title;
  const detail =
    active && liveAction
      ? liveAction.label
      : station.detail;

  const planHref =
    station.kind === "plan" && station.dledgerDecisionId
      ? `/whybuddy/dev?session=${encodeURIComponent(sessionId)}&decision=${encodeURIComponent(station.dledgerDecisionId)}`
      : null;

  return (
    <div className="relative mb-3.5 last:mb-0">
      <StationDot tone={tone} />
      <p className="m-0 text-[13px]">
        {planHref ? (
          <a href={planHref} className="font-medium text-slate-800 hover:underline">
            {title}
          </a>
        ) : (
          <span className={`font-medium ${station.kind === "await" ? "text-slate-500" : "text-slate-800"}`}>
            {title}
          </span>
        )}
        {time && station.kind === "intake" && (
          <span className="ml-1.5 text-[11px] text-slate-400">{time}</span>
        )}
      </p>
      {detail && (
        <p className="m-0 mt-0.5 text-xs text-slate-500">
          {station.kind === "verdict" && station.tone === "pass" && detail.includes("→") ? (
            <>
              {detail.split("→")[0]}→{" "}
              <span className="font-medium text-[#0F6E56]">
                {detail.split("→")[1]}
              </span>
            </>
          ) : (
            detail
          )}
        </p>
      )}
      {station.kind === "execution" && (
        <ExecutionSubsteps
          steps={steps}
          actions={actions}
          sessionId={sessionId}
          activeStepId={activeStepId}
          streaming={streaming}
        />
      )}
    </div>
  );
}

export function TurnRouteTimeline({
  facts,
  steps,
  actions,
  sessionId,
  expanded,
  onToggle,
  litCount,
  streaming,
  liveAction,
  activeStepId,
}: {
  facts: TurnRouteFacts;
  steps: TurnStep[];
  actions: ActionTrace[];
  sessionId: string;
  expanded: boolean;
  onToggle: () => void;
  litCount: number;
  streaming: boolean;
  liveAction: LiveAction | null;
  activeStepId?: string | null;
}) {
  const allStations = deriveTurnRoute(facts);
  const visibleStations = streaming
    ? allStations.slice(0, Math.max(1, litCount))
    : allStations;
  const summary = buildRouteSummary(allStations);

  if (!streaming && !expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 w-full rounded-md border border-transparent py-1 text-left text-xs text-slate-500 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
      >
        {summary}
      </button>
    );
  }

  const activeIndex =
    streaming && litCount > 0 ? Math.min(litCount - 1, visibleStations.length - 1) : -1;

  return (
    <div className="mb-3">
      {!streaming && (
        <button
          type="button"
          onClick={onToggle}
          className="mb-2 text-xs text-slate-400 hover:text-slate-600"
        >
          {summary.replace(" ▸", " ▾")}
        </button>
      )}
      <div className="relative pl-6">
        <div className="absolute bottom-1.5 left-[7px] top-1.5 w-0.5 bg-slate-200" />
        {visibleStations.map((station, idx) => (
          <StationRow
            key={station.id}
            station={station}
            steps={steps}
            actions={actions}
            sessionId={sessionId}
            active={streaming && idx === activeIndex}
            liveAction={liveAction}
            activeStepId={activeStepId}
            streaming={streaming}
          />
        ))}
      </div>
    </div>
  );
}