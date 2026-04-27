import type {
  LaunchRouteCandidate,
  LaunchRouteCandidateId,
  LaunchRoutePlan,
} from "@/lib/launch-router";
import { cn } from "@/lib/utils";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function getRouteCandidateTitle(
  locale: string,
  candidate: Pick<LaunchRouteCandidate, "id">
): string {
  switch (candidate.id) {
    case "clarify-first":
      return t(locale, "先补路标", "Clarify waypoints");
    case "fast-route":
      return t(locale, "最快路线", "Fastest route");
    case "standard-route":
      return t(locale, "标准路线", "Standard route");
    case "deep-route":
      return t(locale, "深度路线", "Deep route");
    case "upgrade-runtime":
      return t(locale, "切换高级执行", "Switch runtime");
  }
}

export function getRouteCandidateDetail(
  locale: string,
  candidate: Pick<LaunchRouteCandidate, "id">
): string {
  switch (candidate.id) {
    case "clarify-first":
      return t(
        locale,
        "目的地不够清晰时，先问关键问题，再规划路线。",
        "When the destination is unclear, ask key questions before planning."
      );
    case "fast-route":
      return t(
        locale,
        "直接创建 mission，优先快速产出和短反馈环。",
        "Create a mission directly for fast output and a short feedback loop."
      );
    case "standard-route":
      return t(
        locale,
        "先解析目的地，再规划路线、编队执行、审阅证据。",
        "Parse destination, plan route, form fleet, execute, and review evidence."
      );
    case "deep-route":
      return t(
        locale,
        "进入高级编排，适合附件、团队分工和多阶段交付。",
        "Use advanced orchestration for attachments, team split, and multi-stage delivery."
      );
    case "upgrade-runtime":
      return t(
        locale,
        "当前目的地需要浏览器、命令、沙盒或容器能力。",
        "This destination needs browser, command, sandbox, or container capabilities."
      );
  }
}

export function getRouteCandidateStageLabel(
  locale: string,
  stage: LaunchRouteCandidate["stages"][number]
): string {
  const zh: Record<LaunchRouteCandidate["stages"][number], string> = {
    destination: "目的地",
    clarification: "澄清",
    route: "路线",
    fleet: "编队",
    execution: "执行",
    review: "审阅",
    evidence: "证据",
  };
  const en: Record<LaunchRouteCandidate["stages"][number], string> = {
    destination: "Destination",
    clarification: "Clarify",
    route: "Route",
    fleet: "Fleet",
    execution: "Execute",
    review: "Review",
    evidence: "Evidence",
  };

  return locale === "zh-CN" ? zh[stage] : en[stage];
}

export function getRouteCandidateDisabledReason(
  locale: string,
  disabledReason: LaunchRouteCandidate["disabledReason"]
): string | null {
  switch (disabledReason) {
    case "needs_destination_detail":
      return t(locale, "需先补全目的地", "Needs destination details");
    case "requires_runtime_upgrade":
      return t(locale, "需先切高级执行", "Needs advanced runtime");
    case "not_needed":
      return t(locale, "当前不推荐", "Not recommended now");
    default:
      return null;
  }
}

export function getRouteCandidateTakeoverLabel(
  locale: string,
  candidate: Pick<LaunchRouteCandidate, "takeoverPoints">
): string {
  return t(
    locale,
    `接管点 ${candidate.takeoverPoints.length}`,
    `${candidate.takeoverPoints.length} takeover point(s)`
  );
}

export type RouteComparisonMetricKey =
  | "speed"
  | "stability"
  | "depth"
  | "risk"
  | "cost"
  | "takeover";

export interface RouteCandidateComparison {
  speed: string;
  stability: string;
  depth: string;
  risk: string;
  cost: string;
  takeover: string;
}

export function getRouteComparisonMetricLabel(
  locale: string,
  metric: RouteComparisonMetricKey
): string {
  const zh: Record<RouteComparisonMetricKey, string> = {
    speed: "速度",
    stability: "稳定性",
    depth: "深度",
    risk: "风险",
    cost: "成本",
    takeover: "接管点",
  };
  const en: Record<RouteComparisonMetricKey, string> = {
    speed: "Speed",
    stability: "Stability",
    depth: "Depth",
    risk: "Risk",
    cost: "Cost",
    takeover: "Takeover",
  };

  return locale === "zh-CN" ? zh[metric] : en[metric];
}

export function getRouteCandidateComparison(
  locale: string,
  candidate: LaunchRouteCandidate
): RouteCandidateComparison {
  const takeover = t(
    locale,
    `${candidate.takeoverPoints.length} 个`,
    `${candidate.takeoverPoints.length}`
  );

  switch (candidate.id) {
    case "clarify-first":
      return {
        speed: t(locale, "先暂停", "Paused"),
        stability: t(locale, "高", "High"),
        depth: t(locale, "补问", "Clarify"),
        risk: t(locale, "低", "Low"),
        cost: t(locale, "低", "Low"),
        takeover,
      };
    case "fast-route":
      return {
        speed: t(locale, "最快", "Fastest"),
        stability: t(locale, "中", "Medium"),
        depth: t(locale, "轻量", "Light"),
        risk: t(locale, "中", "Medium"),
        cost: t(locale, "低", "Low"),
        takeover,
      };
    case "standard-route":
      return {
        speed: t(locale, "均衡", "Balanced"),
        stability: t(locale, "高", "High"),
        depth: t(locale, "标准", "Standard"),
        risk: t(locale, "低", "Low"),
        cost: t(locale, "中", "Medium"),
        takeover,
      };
    case "deep-route":
      return {
        speed: t(locale, "较慢", "Slower"),
        stability: t(locale, "最高", "Highest"),
        depth: t(locale, "深入", "Deep"),
        risk: t(locale, "可治理", "Managed"),
        cost: t(locale, "高", "High"),
        takeover,
      };
    case "upgrade-runtime":
      return {
        speed: t(locale, "需升级", "Upgrade"),
        stability: t(locale, "运行时门控", "Runtime gated"),
        depth: t(locale, "真实执行", "Execution"),
        risk: t(locale, "高", "High"),
        cost: t(locale, "升级", "Upgrade"),
        takeover,
      };
  }
}

export function getRouteCandidateSummary(
  locale: string,
  candidate: LaunchRouteCandidate
) {
  return {
    title: getRouteCandidateTitle(locale, candidate),
    detail: getRouteCandidateDetail(locale, candidate),
    comparison: getRouteCandidateComparison(locale, candidate),
    stages: candidate.stages.map(stage =>
      getRouteCandidateStageLabel(locale, stage)
    ),
    disabledReason: getRouteCandidateDisabledReason(
      locale,
      candidate.disabledReason
    ),
    takeoverLabel: getRouteCandidateTakeoverLabel(locale, candidate),
  };
}

function findCandidate(
  routePlan: LaunchRoutePlan,
  candidateId: LaunchRouteCandidateId | null | undefined
): LaunchRouteCandidate | null {
  if (!candidateId) return null;
  return routePlan.candidates.find(candidate => candidate.id === candidateId) ?? null;
}

function RouteCandidateCard({
  candidate,
  locale,
  selected,
  onSelect,
  compact = false,
  revealIndex,
}: {
  candidate: LaunchRouteCandidate;
  locale: string;
  selected: boolean;
  onSelect: (candidate: LaunchRouteCandidate) => void;
  compact?: boolean;
  revealIndex: number;
}) {
  const summary = getRouteCandidateSummary(locale, candidate);
  const statusText = candidate.recommended
    ? t(locale, "推荐", "Best")
    : summary.disabledReason || summary.takeoverLabel;

  return (
    <button
      type="button"
      disabled={!candidate.available}
      aria-pressed={selected}
      aria-label={summary.title}
      data-motion="route-candidate-stagger-reveal"
      data-reveal-index={revealIndex}
      data-reduced-motion="route-candidate-static"
      onClick={() => {
        if (candidate.available) {
          onSelect(candidate);
        }
      }}
      className={cn(
        "min-w-0 rounded-[14px] border px-2 py-2 text-left transition-all motion-safe:duration-300 motion-safe:ease-out motion-reduce:transform-none motion-reduce:transition-none",
        compact && "w-[min(78vw,260px)] shrink-0 snap-start",
        selected
          ? "border-[#d07a4f] bg-[#fff7ed] shadow-[0_12px_28px_rgba(184,111,69,0.14)]"
          : "border-[#ead8c3]/80 bg-white/78 hover:border-[#d9a47c] hover:bg-[#fffaf4]",
        !candidate.available && "cursor-not-allowed opacity-55"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-bold text-stone-800">
            {summary.title}
          </div>
          <div className="mt-0.5 text-[9px] leading-3 text-stone-500">
            {summary.detail}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold",
            candidate.recommended
              ? "bg-[#d07a4f] text-white"
              : "bg-stone-100 text-stone-500"
          )}
        >
          {statusText}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {summary.stages.slice(0, 5).map(stage => (
          <span
            key={stage}
            className="rounded-full border border-[#ead8c3]/70 bg-white/72 px-1.5 py-0.5 text-[8px] font-semibold text-[#9a5d32]"
          >
            {stage}
          </span>
        ))}
      </div>

      <div className="mt-1.5 text-[8px] font-semibold text-stone-500">
        {summary.disabledReason || summary.takeoverLabel}
      </div>
    </button>
  );
}

function RouteComparisonView({
  routePlan,
  locale,
  selectedRouteId,
}: {
  routePlan: LaunchRoutePlan;
  locale: string;
  selectedRouteId: LaunchRouteCandidateId | null | undefined;
}) {
  const metrics: RouteComparisonMetricKey[] = [
    "speed",
    "stability",
    "depth",
    "risk",
    "cost",
    "takeover",
  ];

  return (
    <div className="mt-2 overflow-hidden rounded-[14px] border border-white/80 bg-white/62">
      <div className="grid grid-cols-[92px_repeat(5,minmax(92px,1fr))] overflow-x-auto text-[8px] sm:text-[9px]">
        <div className="sticky left-0 z-10 border-b border-r border-[#ead8c3]/70 bg-[#fff7ed] px-2 py-1.5 font-bold uppercase tracking-[0.12em] text-[#9a5d32]">
          {t(locale, "横向比较", "Compare")}
        </div>
        {routePlan.candidates.map(candidate => (
          <div
            key={candidate.id}
            className={cn(
              "border-b border-r border-[#ead8c3]/70 px-2 py-1.5 font-bold text-stone-700",
              candidate.id === selectedRouteId && "bg-[#fff7ed] text-[#9a5d32]"
            )}
          >
            {getRouteCandidateTitle(locale, candidate)}
          </div>
        ))}

        {metrics.map(metric => [
          <div
            key={`${metric}:label`}
            className="sticky left-0 z-10 border-b border-r border-[#ead8c3]/70 bg-white/90 px-2 py-1 font-semibold text-stone-500"
          >
            {getRouteComparisonMetricLabel(locale, metric)}
          </div>,
          ...routePlan.candidates.map(candidate => {
            const comparison = getRouteCandidateComparison(locale, candidate);
            return (
              <div
                key={`${candidate.id}:${metric}`}
                className={cn(
                  "border-b border-r border-[#ead8c3]/70 px-2 py-1 text-stone-600",
                  candidate.id === selectedRouteId && "bg-[#fffaf4]",
                  !candidate.available && "text-stone-400"
                )}
              >
                {comparison[metric]}
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

export interface RoutePlanningOverlayProps {
  routePlan: LaunchRoutePlan;
  selectedRouteId: LaunchRouteCandidateId | null;
  locale: string;
  onSelect: (candidate: LaunchRouteCandidate) => void;
  onConfirmRoute?: (candidate: LaunchRouteCandidate) => void;
  confirming?: boolean;
  confirmDisabled?: boolean;
  presentation?: "panel" | "bottom-sheet";
}

export function RoutePlanningOverlay({
  routePlan,
  selectedRouteId,
  locale,
  onSelect,
  onConfirmRoute,
  confirming = false,
  confirmDisabled = false,
  presentation = "panel",
}: RoutePlanningOverlayProps) {
  const recommendedCandidate = findCandidate(
    routePlan,
    routePlan.recommendedRouteId
  );
  const selectedCandidate =
    findCandidate(routePlan, selectedRouteId) ?? recommendedCandidate;
  const canRestoreRecommended =
    Boolean(recommendedCandidate?.available) &&
    selectedCandidate?.id !== recommendedCandidate?.id;
  const canConfirm =
    Boolean(onConfirmRoute) &&
    Boolean(selectedCandidate?.available) &&
    !confirming &&
    !confirmDisabled;
  const isBottomSheet = presentation === "bottom-sheet";

  return (
    <div
      className={cn(
        "mt-2 rounded-[18px] border border-[#ead8c3]/80 bg-[linear-gradient(135deg,rgba(255,248,239,0.96),rgba(250,238,224,0.78))] p-2 shadow-[0_14px_34px_rgba(128,82,45,0.08)]",
        !isBottomSheet &&
          "max-h-[min(42vh,360px)] overflow-y-auto overscroll-contain",
        isBottomSheet &&
          "route-planning-bottom-sheet max-h-[min(calc(100svh-var(--autopilot-bottom-dock-clearance,180px)-env(safe-area-inset-top)-env(safe-area-inset-bottom)),720px)] overflow-y-auto overscroll-contain rounded-b-none pb-[calc(0.75rem+env(safe-area-inset-bottom))] data-[presentation=bottom-sheet]:border-b-0"
      )}
      data-bottom-dock-safe="true"
      data-bottom-dock-clearance={
        isBottomSheet ? "var(--autopilot-bottom-dock-clearance,180px)" : "panel-contained"
      }
      data-motion="route-plan-stagger-reveal"
      data-reduced-motion="route-plan-static"
      data-presentation={presentation}
      data-testid="route-planning-overlay"
    >
      {isBottomSheet ? (
        <div
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-[#d9a47c]/55"
          data-testid="route-planning-bottom-sheet-handle"
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a5d32]">
            {t(locale, "自动驾驶路线规划", "Autopilot route plan")}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-stone-600">
            {t(
              locale,
              "输入目的地后先弹出候选路线，确认路线再启动执行。",
              "After a destination is entered, route candidates appear before execution starts."
            )}
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-[#e6c5a7] bg-white/80 px-2 py-1 text-[9px] font-semibold text-[#9a5d32]">
          {t(locale, "推荐：", "Best: ")}
          {recommendedCandidate
            ? getRouteCandidateTitle(locale, recommendedCandidate)
            : "-"}
        </div>
      </div>

      <div
        className={cn(
          "mt-2 gap-1.5",
          isBottomSheet
            ? "flex snap-x overflow-x-auto pb-1 [scrollbar-width:none]"
            : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5"
        )}
        data-testid="route-planning-candidate-list"
        data-motion="route-candidate-list-stagger"
        data-reduced-motion="route-candidate-list-static"
      >
        {routePlan.candidates.map((candidate, index) => (
          <RouteCandidateCard
            key={candidate.id}
            candidate={candidate}
            locale={locale}
            selected={candidate.id === selectedCandidate?.id}
            onSelect={onSelect}
            compact={isBottomSheet}
            revealIndex={index}
          />
        ))}
      </div>

      <RouteComparisonView
        routePlan={routePlan}
        locale={locale}
        selectedRouteId={selectedCandidate?.id}
      />

      {selectedCandidate ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-white/80 bg-white/60 px-2 py-1.5 text-[9px] text-stone-600">
          <span className="font-semibold text-stone-700">
            {t(locale, "当前路线：", "Selected route: ")}
            {getRouteCandidateTitle(locale, selectedCandidate)}
          </span>
          <span>
            {t(locale, "接管点 ", "Takeover points ")}
            {selectedCandidate.takeoverPoints.length}
            {" / "}
            {t(locale, "阶段 ", "Stages ")}
            {selectedCandidate.stages.length}
          </span>
        </div>
      ) : null}

      {selectedCandidate ? (
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center justify-end gap-1.5 rounded-[14px] border border-white/80 bg-white/60 px-2 py-1.5 text-[9px] text-stone-600",
            isBottomSheet &&
              "sticky bottom-0 z-20 -mx-2 mb-[-0.5rem] rounded-b-none border-x-0 border-b-0 bg-white/92 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-12px_28px_rgba(128,82,45,0.12)] backdrop-blur"
          )}
          data-bottom-sheet-actions={isBottomSheet ? "sticky" : undefined}
          data-testid="route-planning-actions"
        >
          <button
            type="button"
            disabled={!canRestoreRecommended}
            onClick={() => {
              if (recommendedCandidate?.available) {
                onSelect(recommendedCandidate);
              }
            }}
            className={cn(
              "rounded-full border px-2 py-1 text-[9px] font-bold transition",
              canRestoreRecommended
                ? "border-[#e6c5a7] bg-white text-[#9a5d32] hover:border-[#d07a4f]"
                : "cursor-not-allowed border-stone-200 bg-stone-50 text-stone-400"
            )}
          >
            {t(locale, "恢复系统推荐路线", "Restore recommended route")}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (canConfirm && selectedCandidate) {
                onConfirmRoute?.(selectedCandidate);
              }
            }}
            className={cn(
              "rounded-full px-2.5 py-1 text-[9px] font-bold shadow-[0_10px_22px_rgba(184,111,69,0.16)] transition",
              canConfirm
                ? "bg-[#d07a4f] text-white hover:bg-[#b8653f]"
                : "cursor-not-allowed bg-stone-200 text-stone-500 shadow-none"
            )}
          >
            {confirming
              ? t(locale, "正在确认路线...", "Confirming route...")
              : t(locale, "确认路线并执行", "Confirm route and execute")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
