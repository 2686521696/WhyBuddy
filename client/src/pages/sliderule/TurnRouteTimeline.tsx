import React, { useCallback, useState } from "react";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { ActionTrace, LiveAction } from "@shared/blueprint/capability-process-labels";
import {
  buildRouteSummary,
  deriveTurnRoute,
  type RouteStation,
  type RouteStationKind,
  type RouteStationTone,
  type SelectedCapabilityPick,
  type TurnRouteFacts,
} from "@shared/blueprint/sliderule-turn-route";
import { autopilotTheme } from "./autopilot-theme";
import { RoleProgressLog, TurnFleetProgressLog } from "./role-progress-log";
import type { TurnStep } from "./types";
import { executionTurnSteps } from "./turn-route-steps";

/**
 * V5.1 IM surface tiers:
 * - minimal: 无路径时间线（默认产品页）
 * - product: 薄节拍（收到/裁决/等待）
 * - engineering: dev 驾驶舱完整路径
 */
export type TurnRouteSurfaceMode = "minimal" | "product" | "engineering";

/** V5.1 产品 IM：只标架构图节点（INTAKE / ORCH / C_EVID …），不含 GCOV 结论写入。 */
const PRODUCT_STATION_KINDS = new Set<RouteStationKind>([
  "intake",
  "stale_cascade",
  "reentry",
  "budget_pass",
  "plan",
  "budget_block",
  "capability",
  "interactive_gate",
  "trust_gate",
]);

function filterStationsForSurface(
  stations: RouteStation[],
  mode: TurnRouteSurfaceMode
): RouteStation[] {
  if (mode === "engineering" || mode === "minimal") return stations;
  return stations.filter((s) => PRODUCT_STATION_KINDS.has(s.kind));
}

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

function StationDot({
  tone,
  style,
}: {
  tone: RouteStationTone;
  style?: React.CSSProperties;
}) {
  const hollow = tone === "pending";
  return (
    <span
      className={`absolute top-[3px] size-3 rounded-full ${TONE_DOT[tone]} ${
        hollow ? "box-border" : ""
      }`}
      style={style}
    />
  );
}

function treeConnector(station: RouteStation): string {
  if (station.linkKind === "reentry") {
    const target = station.reentryTargetV51 ?? "";
    return target ? `↩ ${target}` : "↩";
  }
  if (station.linkKind === "parallel") {
    return station.isLastSibling ? "└─" : "├─";
  }
  if ((station.depth ?? 0) > 0 && (station.lane ?? 0) === 0) return "│";
  return "";
}

function treeIndentPx(station: RouteStation): number {
  if (station.linkKind === "reentry") {
    return 4;
  }
  if (station.linkKind === "parallel") {
    return 12 + (station.lane ?? 1) * 14;
  }
  return Math.max(0, (station.depth ?? 0) * 12);
}

function stepsForLoop(steps: TurnStep[], loopTurnId?: string): TurnStep[] {
  if (!loopTurnId) return steps;
  const prefix = `${loopTurnId}-`;
  return steps.filter((s) => s.id.startsWith(prefix));
}

function actionsForLoop(actions: ActionTrace[], loopTurnId?: string): ActionTrace[] {
  if (!loopTurnId) return actions;
  return actions.filter((a) => a.turnId === loopTurnId);
}

function picksForPlanStation(
  station: RouteStation,
  facts: TurnRouteFacts
): SelectedCapabilityPick[] {
  const roundMatch = station.id.match(/-r(\d+)-plan/);
  if (roundMatch && facts.rounds?.length) {
    const round = facts.rounds.find((r) => r.roundIndex === Number(roundMatch[1]));
    return round?.selectedCapabilities ?? [];
  }
  return facts.selectedCapabilities ?? [];
}

function stationCollapsedSummary(
  station: RouteStation,
  facts: TurnRouteFacts
): string | null {
  if (station.kind === "trust_gate" && (facts.trustTotalCount ?? 0) > 0) {
    return `${facts.trustPassedCount ?? 0}/${facts.trustTotalCount} 通过提交闸`;
  }
  if (station.kind === "plan" && (facts.planSelectedCount ?? 0) > 0) {
    return `DLEDGER 选定 ${facts.planSelectedCount} 个池节点`;
  }
  if (station.kind === "capability") {
    const pick = capabilityPickForStation(station, facts);
    if (pick) return `${pick.roleId} · ${pick.capabilityId}`;
  }
  if (station.detail) return station.detail.slice(0, 96);
  return station.summaryToken ?? null;
}

function capabilityPickForStation(
  station: RouteStation,
  facts: TurnRouteFacts
): SelectedCapabilityPick | undefined {
  const capMatch = station.id.match(/-cap-(\d+)$/);
  if (!capMatch) return undefined;
  const capIndex = Number(capMatch[1]);
  const roundMatch = station.id.match(/-r(\d+)-cap-/);
  if (roundMatch && facts.rounds?.length) {
    const round = facts.rounds.find((r) => r.roundIndex === Number(roundMatch[1]));
    return round?.selectedCapabilities?.[capIndex];
  }
  return facts.selectedCapabilities?.[capIndex];
}

function failStepForStation(
  steps: TurnStep[],
  station: RouteStation,
  facts: TurnRouteFacts
): Extract<TurnStep, { kind: "capability_fail" }> | undefined {
  const pick = capabilityPickForStation(station, facts);
  const loopTurnId = loopTurnIdForStation(station, facts);
  if (!pick || !loopTurnId) return undefined;
  return steps.find(
    (s): s is Extract<TurnStep, { kind: "capability_fail" }> =>
      s.kind === "capability_fail" &&
      s.loopTurnId === loopTurnId &&
      s.capabilityId === pick.capabilityId
  );
}

function loopTurnIdForStation(
  station: RouteStation,
  facts: TurnRouteFacts
): string | undefined {
  if (station.loopTurnId) return station.loopTurnId;
  const multi = station.id.match(/-r(\d+)-cap-/);
  if (multi && facts.rounds?.length) {
    const round = facts.rounds.find((r) => r.roundIndex === Number(multi[1]));
    return round?.loopTurnId;
  }
  if (station.kind === "capability" && station.id.startsWith(`${facts.turnId}-cap-`)) {
    return facts.turnId;
  }
  return undefined;
}

function ExecutionSubsteps({
  steps,
  actions,
  sessionId,
  activeStepId,
  streaming,
  loopTurnId,
}: {
  steps: TurnStep[];
  actions: ActionTrace[];
  sessionId: string;
  activeStepId?: string | null;
  streaming: boolean;
  loopTurnId?: string;
}) {
  const execSteps = executionTurnSteps(stepsForLoop(steps, loopTurnId)).filter(
    (s) => s.kind !== "narration"
  );
  const roundActions = actionsForLoop(actions, loopTurnId);
  if (execSteps.length === 0 && roundActions.length === 0) return null;

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
        if (step.kind !== "step_narration") return null;
        const active = streaming && step.id === activeStepId;
        return (
          <p
            key={step.id}
            className={`m-0 text-xs leading-relaxed ${
              step.realLlm ? "text-violet-600" : "text-slate-500"
            }`}
          >
            {active ? step.text.slice(0, Math.min(step.text.length, 40)) : step.text}
            {active && step.text.length > 40 ? "…" : ""}
          </p>
        );
      })}
      {roundActions.map((trace, i) => (
        <a
          key={`${trace.label}-${i}`}
          href={`/sliderule/dev?session=${encodeURIComponent(sessionId)}`}
          className={autopilotTheme.actionTrace}
        >
          ⚡ {trace.label}
        </a>
      ))}
    </div>
  );
}

type StationPhase = "completed" | "active" | "future";

function StationExpandedBody({
  station,
  facts,
  steps,
  actions,
  sessionId,
  activeStepId,
  streaming,
  loopTurnId,
  surfaceMode,
}: {
  station: RouteStation;
  facts: TurnRouteFacts;
  steps: TurnStep[];
  actions: ActionTrace[];
  sessionId: string;
  activeStepId?: string | null;
  streaming: boolean;
  loopTurnId?: string;
  surfaceMode: TurnRouteSurfaceMode;
}) {
  if (station.kind === "capability") {
    const pick = capabilityPickForStation(station, facts);
    return (
      <>
        <RoleProgressLog
          steps={steps}
          actions={actions}
          loopTurnId={loopTurnId}
          capabilityId={pick?.capabilityId}
        />
        {surfaceMode === "engineering" && (
          <ExecutionSubsteps
            steps={steps}
            actions={actions}
            sessionId={sessionId}
            activeStepId={activeStepId}
            streaming={streaming}
            loopTurnId={loopTurnId}
          />
        )}
      </>
    );
  }

  if (station.kind === "plan") {
    const picks = picksForPlanStation(station, facts);
    return (
      <div className="mt-1.5 flex flex-col gap-1.5">
        {station.detail && (
          <p className="m-0 text-xs text-slate-500">{station.detail}</p>
        )}
        {picks.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {picks.map((p, i) => (
              <span
                key={`${p.capabilityId}-${i}`}
                className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600"
              >
                {p.roleId} · {p.capabilityId}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (station.kind === "trust_gate") {
    return (
      <p className="m-0 mt-1 text-xs text-slate-500">
        T_PROV · {facts.trustPassedCount ?? 0}/{facts.trustTotalCount ?? 0} 通过
        {(facts.trustGroundFailedCount ?? 0) > 0
          ? ` · ${facts.trustGroundFailedCount} 项接地未过`
          : ""}
      </p>
    );
  }

  if (station.kind === "reentry" && station.reentryTargetV51) {
    return (
      <p className="m-0 mt-1 text-xs text-amber-700">
        回边再入 {station.reentryTargetV51} · {station.detail || "GCOV 后预算放行续跑"}
      </p>
    );
  }

  if (station.detail) {
    return <p className="m-0 mt-1 text-xs text-slate-500">{station.detail}</p>;
  }

  return null;
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
  facts,
  surfaceMode,
  phase,
  expanded,
  onToggleExpand,
  onRetryCapability,
  retrying,
  immersionOverlay,
}: {
  station: RouteStation;
  steps: TurnStep[];
  actions: ActionTrace[];
  sessionId: string;
  active: boolean;
  liveAction: LiveAction | null;
  activeStepId?: string | null;
  streaming: boolean;
  facts: TurnRouteFacts;
  surfaceMode: TurnRouteSurfaceMode;
  phase: StationPhase;
  expanded: boolean;
  onToggleExpand?: () => void;
  onRetryCapability?: (params: {
    loopTurnId: string;
    capabilityId: V5CapabilityId;
    roleId: string;
    runIndex: number;
  }) => void;
  retrying?: boolean;
  immersionOverlay?: boolean;
}) {
  const loopTurnId = loopTurnIdForStation(station, facts);
  const time = formatStationTime(station.timestamp);
  const tone: RouteStationTone = active ? "active" : station.tone;
  const nodeLabel = station.title.includes("·")
    ? station.title.split("·").slice(1).join("·").trim()
    : station.title;
  const detail =
    active && liveAction
      ? liveAction.label
      : station.detail;

  const planHref =
    surfaceMode === "engineering" &&
    station.kind === "plan" &&
    station.dledgerDecisionId
      ? `/sliderule/dev?session=${encodeURIComponent(sessionId)}&decision=${encodeURIComponent(station.dledgerDecisionId)}`
      : null;

  const indent = treeIndentPx(station);
  const connector = treeConnector(station);
  const isReentry = station.linkKind === "reentry";
  const collapsed = phase === "completed" && !expanded && !immersionOverlay;
  const dimmed = phase === "future";
  const failStep =
    station.kind === "capability" ? failStepForStation(steps, station, facts) : undefined;
  const collapsedSummary =
    collapsed && phase === "completed"
      ? stationCollapsedSummary(station, facts)
      : null;

  return (
    <div
      className={`relative mb-3.5 last:mb-0 ${
        isReentry
          ? immersionOverlay
            ? "rounded-md bg-amber-500/[0.07] py-0.5 pr-1"
            : "rounded-md bg-amber-50/80 py-1 pr-1"
          : ""
      } ${dimmed ? "opacity-40" : ""}`}
      style={{ marginLeft: indent }}
      data-timeline-phase={phase}
    >
      <StationDot tone={tone} style={{ left: -22 }} />
      <p className="m-0 text-[13px]">
        {connector && (
          <span
            className={`mr-1 font-mono text-[11px] ${
              isReentry ? "font-semibold text-amber-700" : "text-slate-400"
            }`}
          >
            {connector}
          </span>
        )}
        {station.v51NodeId && (
          <span
            className={`mr-1.5 inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 ${
              immersionOverlay ? "bg-white/40 ring-1 ring-slate-900/5" : "bg-slate-100"
            }`}
          >
            {station.v51NodeId}
          </span>
        )}
        {planHref ? (
          <a href={planHref} className="font-medium text-slate-800 hover:underline">
            {nodeLabel}
          </a>
        ) : (
          <span
            className={`font-medium ${
              station.kind === "await" && station.v51NodeId === "AWAIT"
                ? "text-slate-500"
                : station.v51NodeId === "DONE"
                ? "text-[#0F6E56]"
                : "text-slate-800"
            }`}
          >
            {nodeLabel}
          </span>
        )}
        {time && station.kind === "intake" && (
          <span className="ml-1.5 text-[11px] text-slate-400">{time}</span>
        )}
        {phase === "completed" && (
          <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
            完成
          </span>
        )}
        {phase === "active" && streaming && (
          <span className="ml-1.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
            进行中
          </span>
        )}
      </p>
      {phase === "active" && detail && (
        <p className="m-0 mt-0.5 text-xs text-slate-500">{detail}</p>
      )}
      {collapsedSummary && (
        <p className="m-0 mt-0.5 text-xs text-slate-400">{collapsedSummary}</p>
      )}
      {!collapsed && (
        <StationExpandedBody
          station={station}
          facts={facts}
          steps={steps}
          actions={actions}
          sessionId={sessionId}
          activeStepId={activeStepId}
          streaming={streaming}
          loopTurnId={loopTurnId}
          surfaceMode={surfaceMode}
        />
      )}
      {phase === "completed" && collapsed && onToggleExpand && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="mt-1 text-[11px] font-medium text-blue-500 hover:text-blue-700 hover:underline"
        >
          查看详情
        </button>
      )}
      {phase === "completed" && expanded && onToggleExpand && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="mt-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 hover:underline"
        >
          收起
        </button>
      )}
      {phase === "active" &&
        streaming &&
        surfaceMode !== "minimal" &&
        station.kind !== "capability" &&
        station.kind !== "plan" && (
          <RoleProgressLog steps={steps} actions={actions} loopTurnId={loopTurnId} />
        )}
      {failStep && onRetryCapability && loopTurnId && (
        <button
          type="button"
          disabled={retrying}
          onClick={() =>
            onRetryCapability({
              loopTurnId,
              capabilityId: failStep.capabilityId,
              roleId: failStep.roleId,
              runIndex: failStep.runIndex,
            })
          }
          className="mt-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
        >
          {retrying ? "重试中…" : "重试"}
        </button>
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
  surfaceMode = "engineering",
  onRetryCapability,
  retrying,
  immersionOverlay,
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
  /** product: IM 操纵杆；engineering: dev 驾驶舱完整路径 */
  surfaceMode?: TurnRouteSurfaceMode;
  onRetryCapability?: (
    params: {
      loopTurnId: string;
      capabilityId: V5CapabilityId;
      roleId: string;
      runIndex: number;
    }
  ) => void;
  retrying?: boolean;
  /** 沉浸右上浮层：透明背景、始终展开完整架构树 */
  immersionOverlay?: boolean;
}) {
  const [expandedStationIds, setExpandedStationIds] = useState<Set<string>>(
    () => new Set()
  );

  const toggleStationExpand = useCallback((stationId: string) => {
    setExpandedStationIds((prev) => {
      const next = new Set(prev);
      if (next.has(stationId)) next.delete(stationId);
      else next.add(stationId);
      return next;
    });
  }, []);

  // ① 多轮折叠:静态(非 streaming)沉浸浮层下,历史轮默认折叠成一行,只展开最新轮,
  // 减少 BUDGET/GCOV/ORCH 每轮重复刷屏。纯渲染层,不动 deriveTurnRoute。
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(() => new Set());
  const toggleRound = useCallback((r: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }, []);

  if (surfaceMode === "minimal") return null;

  const allStations = deriveTurnRoute(facts);
  const filteredStations = filterStationsForSurface(allStations, surfaceMode);
  const visibleStations = streaming
    ? filteredStations.slice(0, Math.max(1, litCount))
    : filteredStations;
  const summary = buildRouteSummary(filteredStations);

  if (!streaming && !expanded && !immersionOverlay) {
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
  const highlightActive = streaming;

  return (
    <div className={immersionOverlay ? "mb-0" : "mb-3"}>
      {!streaming && !immersionOverlay && (
        <button
          type="button"
          onClick={onToggle}
          className="mb-2 text-xs text-slate-400 hover:text-slate-600"
        >
          {summary.replace(" ▸", " ▾")}
        </button>
      )}
      <div className="relative pl-8">
        {(() => {
          const roundOf = (id: string): number | null => {
            const m = /-r(\d+)-/.exec(id);
            return m ? Number(m[1]) : null;
          };
          const roundIdxs = visibleStations
            .map((s) => roundOf(s.id))
            .filter((r): r is number => r != null);
          const maxRound = roundIdxs.length ? Math.max(...roundIdxs) : null;
          // 仅静态、沉浸浮层、且 ≥2 轮时折叠(streaming 实时观看时全展开)。
          const foldRounds =
            !streaming && immersionOverlay && maxRound != null && new Set(roundIdxs).size >= 2;
          const emittedHeaders = new Set<number>();

          return visibleStations.map((station, idx) => {
            const phase: StationPhase = streaming
              ? idx < activeIndex
                ? "completed"
                : idx === activeIndex
                ? "active"
                : "future"
              : "completed";

            const r = roundOf(station.id);
            const isFoldableRound = foldRounds && r != null && r !== maxRound;
            if (isFoldableRound && !expandedRounds.has(r!)) {
              if (emittedHeaders.has(r!)) return null;
              emittedHeaders.add(r!);
              const stepsInRound = visibleStations.filter((s) => roundOf(s.id) === r).length;
              return (
                <button
                  key={`round-fold-${r}`}
                  type="button"
                  onClick={() => toggleRound(r!)}
                  className="mb-1 flex w-full items-center gap-1.5 rounded-md border border-transparent py-1 pl-1 text-left text-[11px] text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-600"
                  data-testid={`sliderule-timeline-round-fold-${r}`}
                >
                  <span className="font-mono">▸</span>
                  第 {r} 轮 · {stepsInRound} 步（已折叠 · 点击展开）
                </button>
              );
            }
          // 展开的历史轮:在该轮第一步前插一个「收起」入口(此前展开后无法再折叠)。
          let collapseHeader: React.ReactNode = null;
          if (isFoldableRound && expandedRounds.has(r!) && !emittedHeaders.has(r!)) {
            emittedHeaders.add(r!);
            collapseHeader = (
              <button
                type="button"
                onClick={() => toggleRound(r!)}
                className="mb-1 flex w-full items-center gap-1.5 rounded-md border border-transparent py-1 pl-1 text-left text-[11px] text-slate-500 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                data-testid={`sliderule-timeline-round-collapse-${r}`}
              >
                <span className="font-mono">▾</span>
                第 {r} 轮 · 点击收起
              </button>
            );
          }
          const stationRow = (
            <StationRow
              station={station}
              steps={steps}
              actions={actions}
              sessionId={sessionId}
              active={highlightActive && idx === activeIndex}
              liveAction={liveAction}
              activeStepId={activeStepId}
              streaming={streaming}
              facts={facts}
              surfaceMode={surfaceMode}
              phase={phase}
              expanded={expandedStationIds.has(station.id)}
              onToggleExpand={
                phase === "completed"
                  ? () => toggleStationExpand(station.id)
                  : undefined
              }
              onRetryCapability={onRetryCapability}
              retrying={retrying}
              immersionOverlay={immersionOverlay}
            />
          );
          return collapseHeader ? (
            <React.Fragment key={station.id}>
              {collapseHeader}
              {stationRow}
            </React.Fragment>
          ) : (
            <React.Fragment key={station.id}>{stationRow}</React.Fragment>
          );
          });
        })()}
      </div>
      {surfaceMode === "product" && !immersionOverlay && (
        <TurnFleetProgressLog steps={steps} actions={actions} />
      )}
    </div>
  );
}