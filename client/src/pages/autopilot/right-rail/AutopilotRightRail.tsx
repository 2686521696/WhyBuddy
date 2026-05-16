/**
 * Autopilot 驾驶舱右栏 — 流式时间线版本
 *
 * 重构自 Wave 2 / Spec 4 的 MiroFish 卡片版,改为纵向时间线布局:
 * - 已完成子阶段:折叠为一行摘要 + 3 指标
 * - 当前活跃子阶段:展示进度信息
 * - 未来子阶段:灰色标题占位
 *
 * 数据层不变:仍消费 `AutopilotRightRailProps`,仍用 `resolveRailSubStage` 判定活跃子阶段。
 */

import { useEffect, useRef, type FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { SPECS_PATH } from "@/components/navigation-config";
import type { BlueprintSpecTree } from "@shared/blueprint/contracts";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";

import { AgentReasoningSubTimeline } from "./AgentReasoningSubTimeline";
import { CapabilityRail } from "./CapabilityRail";
import { FleetActivationLog } from "./FleetActivationLog";
import { resolveRailSubStage } from "./resolve-rail-sub-stage";
import { RoleStatusStrip } from "./RoleStatusStrip";
import { deriveSubStageSummary } from "./sub-stage-summary";
import { TimelineNode, type TimelineNodeStatus } from "./timeline";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
  type AutopilotTimelineStage,
} from "./types";

const TIMELINE_STAGE_ORDER: readonly AutopilotTimelineStage[] = [
  "input",
  "clarification",
  "routeset",
  "selection",
  "fabric",
] as const;

function resolveAriaLabel(locale: AppLocale): string {
  return locale === "zh-CN"
    ? "Autopilot 右栏时间线"
    : "Autopilot right rail timeline";
}

/**
 * 活跃节点的默认内容:显示 API path + 摘要文案。
 * 如果是 spec_tree 阶段且数据就绪,额外显示树节点列表 + "确认并继续"按钮。
 */
function ActiveNodeContent({
  summary,
  locale,
  subStage,
  dataReady,
  onConfirmAdvance,
  advancing,
  specTree,
}: {
  summary: { apiPath: string; summary: string; dataReady: boolean };
  locale: AppLocale;
  subStage: string;
  dataReady: boolean;
  onConfirmAdvance?: () => void;
  advancing?: boolean;
  specTree?: BlueprintSpecTree | null;
}) {
  const isZh = locale === "zh-CN";
  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] text-slate-400">
        {summary.apiPath}
      </div>
      <div className="text-xs leading-5 text-slate-600">
        {summary.summary}
      </div>

      {/* spec_tree 阶段:展示树节点列表 */}
      {subStage === "spec_tree" && specTree && specTree.nodes.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            {specTree.nodes.length} {isZh ? "个节点" : "nodes"} · v{specTree.version}
          </div>
          <div className="max-h-[240px] space-y-1 overflow-y-auto">
            {specTree.nodes.slice(0, 15).map((node, i) => (
              <div
                key={node.id}
                className="flex items-center gap-2 rounded px-2 py-1 text-xs"
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white text-[9px] font-bold text-slate-500 shadow-sm">
                  {i + 1}
                </span>
                <span className="min-w-0 truncate font-medium text-slate-700">
                  {node.title}
                </span>
                <span className="ml-auto shrink-0 text-[9px] text-slate-400">
                  {node.type.replace(/_/g, " ")}
                </span>
              </div>
            ))}
            {specTree.nodes.length > 15 && (
              <div className="px-2 text-[10px] text-slate-400">
                +{specTree.nodes.length - 15} {isZh ? "更多" : "more"}...
              </div>
            )}
          </div>
        </div>
      )}

      {!summary.dataReady && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          <div className="size-3 animate-pulse rounded-full bg-blue-300" />
          {isZh ? "等待上游数据..." : "Awaiting upstream data..."}
        </div>
      )}

      {/* autopilot-agent-reasoning-stream：Agent 推理子时间线（在 active 节点内部展开） */}
      <AgentReasoningSubTimeline locale={locale} />

      {/* 数据就绪时显示"确认并继续"按钮 */}
      {dataReady && onConfirmAdvance && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log("[timeline] confirm advance clicked", { subStage, advancing });
            onConfirmAdvance();
          }}
          disabled={advancing}
          style={{ position: "relative", zIndex: 10 }}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-700 disabled:bg-slate-400 cursor-pointer"
          data-testid="timeline-confirm-advance"
        >
          {advancing
            ? (isZh ? "推进中..." : "Advancing...")
            : subStage === "spec_tree"
              ? (isZh ? "确认 SPEC 树并生成规格文档" : "Confirm and generate documents")
              : (isZh ? "继续下一步" : "Continue")}
        </button>
      )}
    </div>
  );
}

export const AutopilotRightRail: FC<AutopilotRightRailProps> = (props) => {
  const {
    currentStage,
    currentSubStage: currentSubStageFromProps,
    job,
    selection,
    specTree,
    agentCrew,
    locale,
  } = props;

  const computedSubStage = resolveRailSubStage({
    currentStage,
    job,
    selection,
    specTree,
    agentCrew,
  });
  const activeSubStage: AutopilotRailSubStage | undefined =
    currentSubStageFromProps ??
    computedSubStage ??
    (currentStage === "fabric" ? RAIL_SUB_STAGE_ORDER[0] : undefined);

  const activeIndex =
    activeSubStage !== undefined
      ? RAIL_SUB_STAGE_ORDER.indexOf(activeSubStage)
      : -1;

  // 自动滚动到活跃节点
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSubStage]);

  // 非 fabric 阶段不渲染时间线
  if (currentStage !== "fabric") {
    return (
      <aside
        role="complementary"
        aria-label={resolveAriaLabel(locale)}
        data-testid="autopilot-right-rail"
        data-autopilot-stage={currentStage}
        data-autopilot-sub-stage=""
      >
        {TIMELINE_STAGE_ORDER.map((stage) => (
          <div
            key={stage}
            data-stage-placeholder={stage}
            data-active={stage === currentStage ? "true" : "false"}
          />
        ))}
      </aside>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label={resolveAriaLabel(locale)}
      data-testid="autopilot-right-rail"
      data-autopilot-stage={currentStage}
      data-autopilot-sub-stage={activeSubStage ?? ""}
      className="px-4 py-5"
    >
      {/* fabric 阶段的 placeholder 保留(供测试断言) */}
      <div data-stage-placeholder="fabric" data-active="true" className="hidden" />

      {/* autopilot-streaming-experience integration-gap-2026-05-16 UI 消费面 Step 1：角色态条带 */}
      <RoleStatusStrip />

      {/* 流式时间线 */}
      <div className="space-y-0">
        {RAIL_SUB_STAGE_ORDER.map((sub, index) => {
          const summary = deriveSubStageSummary(sub, props, locale);
          let status: TimelineNodeStatus;
          if (index < activeIndex) {
            status = "completed";
          } else if (index === activeIndex) {
            status = "active";
          } else {
            status = "future";
          }

          return (
            <div
              key={sub}
              ref={status === "active" ? activeRef : undefined}
              data-sub-stage-placeholder={status === "active" ? sub : undefined}
              aria-current={status === "active" ? "step" : undefined}
            >
              <TimelineNode
                index={index}
                status={status}
                summary={summary}
                ready={status === "active" && summary.dataReady}
                onViewDetail={
                  status === "completed"
                    ? () => { window.location.href = SPECS_PATH; }
                    : undefined
                }
              >
                {status === "active" && (
                  <ActiveNodeContent
                    summary={summary}
                    locale={locale}
                    subStage={sub}
                    dataReady={summary.dataReady}
                    onConfirmAdvance={props.onStageAdvanced}
                    advancing={false}
                    specTree={props.specTree}
                  />
                )}
              </TimelineNode>
            </div>
          );
        })}
      </div>

      {/* autopilot-streaming-experience integration-gap-2026-05-16 UI 消费面 Step 2：能力调用条 */}
      <CapabilityRail />

      {/* autopilot-streaming-experience integration-gap-2026-05-16 UI 消费面 Step 3：激活日志 */}
      <FleetActivationLog />
    </aside>
  );
};

/**
 * autopilot-agent-reasoning-stream：Agent 推理子时间线挂载点。
 *
 * 组件实现已抽出到 `./AgentReasoningSubTimeline.tsx`，由 right-rail 与
 * `StoreObservabilityHud`（跨阶段 HUD overlay）共同复用，避免子时间线
 * 仅在 fabric 阶段可见、澄清/路线阶段就看不到流式条目的问题。
 */

export default AutopilotRightRail;
