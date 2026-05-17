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

import { useCallback, useEffect, useRef, useState, type FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { SPECS_PATH } from "@/components/navigation-config";
import type {
  BlueprintGenerationJob,
  BlueprintSpecDocumentsResponse,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import {
  generateBlueprintSpecDocuments,
  type ApiRequestError,
} from "@/lib/blueprint-api";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";

import { AgentReasoningSubTimeline } from "./AgentReasoningSubTimeline";
import { CapabilityRail } from "./CapabilityRail";
import { FleetActivationLog } from "./FleetActivationLog";
import { resolveRailSubStage } from "./resolve-rail-sub-stage";
import { RoleStatusStrip } from "./RoleStatusStrip";
import { SpecTreeWorkbench } from "./spec-tree-workbench/SpecTreeWorkbench";
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
 *
 * autopilot-spec-tree-workbench（2026-05-17）：spec_tree 阶段不再渲染裸的
 * "树节点 + N/3 chip" 列表，改为挂载 <SpecTreeWorkbench>，由它承载顶部
 * 双 CTA、节点行展开预览、ephemeral observing 桥接。底部"确认并继续"按钮
 * 在 spec_tree 阶段被隐藏（CTA 由 Workbench 自己提供）。
 */
function ActiveNodeContent({
  summary,
  locale,
  subStage,
  dataReady,
  onConfirmAdvance,
  advancing,
  specTree,
  job,
  jobId,
  generating,
  onGenerateAll,
  onGenerateNode,
}: {
  summary: { apiPath: string; summary: string; dataReady: boolean };
  locale: AppLocale;
  subStage: string;
  dataReady: boolean;
  onConfirmAdvance?: () => void;
  advancing?: boolean;
  specTree?: BlueprintSpecTree | null;
  job?: BlueprintGenerationJob | null;
  jobId: string;
  generating: "all" | "single" | null;
  onGenerateAll: () => void;
  onGenerateNode: (nodeId: string) => void;
}) {
  const isZh = locale === "zh-CN";
  const isSpecTreeStage = subStage === "spec_tree";

  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] text-slate-400">
        {summary.apiPath}
      </div>
      <div className="text-xs leading-5 text-slate-600">
        {summary.summary}
      </div>

      {/* spec_tree 阶段:挂载 SpecTreeWorkbench(顶部双 CTA + 节点行展开式预览) */}
      {isSpecTreeStage && (
        <SpecTreeWorkbench
          jobId={jobId}
          job={job ?? null}
          specTree={specTree ?? null}
          locale={locale}
          generating={generating}
          onGenerateAll={onGenerateAll}
          onGenerateNode={onGenerateNode}
        />
      )}

      {!summary.dataReady && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          <div className="size-3 animate-pulse rounded-full bg-blue-300" />
          {isZh ? "等待上游数据..." : "Awaiting upstream data..."}
        </div>
      )}

      {/* autopilot-agent-reasoning-stream：Agent 推理子时间线（在 active 节点内部展开） */}
      <AgentReasoningSubTimeline locale={locale} />

      {/*
        数据就绪时显示"确认并继续"按钮。
        spec_tree 阶段下隐藏：CTA 由 SpecTreeWorkbench 顶部双按钮承担，
        当用户点击"生成整棵树文档"完成后由父组件 onSpecDocumentsGenerated
        回调推动后端 stage 前进，再由 useAutoAdvance 推到 effect_preview。
      */}
      {dataReady && onConfirmAdvance && !isSpecTreeStage && (
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

  // autopilot-spec-tree-workbench（2026-05-17）：spec_tree 子阶段的双 CTA
  // (生成整棵树 / 生成当前节点) 由 SpecTreeWorkbench 渲染，但 in-flight 锁
  // 与 API 调用由这里集中托管：组件内部不写 store、不发 socket，调用
  // generateBlueprintSpecDocuments 后把响应通过 onSpecDocumentsGenerated
  // 上抛给父组件 (AutopilotRoutePage) 让它 setLatestJob 等。
  const [specDocsGenerating, setSpecDocsGenerating] = useState<
    "all" | "single" | null
  >(null);
  const [specDocsError, setSpecDocsError] = useState<ApiRequestError | null>(
    null
  );

  const triggerSpecDocsGeneration = useCallback(
    async (scope: "all" | "single", nodeId?: string) => {
      if (!props.jobId || specDocsGenerating !== null) return;
      setSpecDocsGenerating(scope);
      setSpecDocsError(null);
      const result = await generateBlueprintSpecDocuments(
        props.jobId,
        scope === "single" && nodeId !== undefined ? { nodeId } : {}
      );
      setSpecDocsGenerating(null);
      if (result.ok) {
        props.onSpecDocumentsGenerated?.(result.data);
      } else {
        setSpecDocsError(result.error);
      }
    },
    [props.jobId, specDocsGenerating, props.onSpecDocumentsGenerated]
  );

  const handleGenerateAllSpecDocs = useCallback(() => {
    void triggerSpecDocsGeneration("all");
  }, [triggerSpecDocsGeneration]);

  const handleGenerateNodeSpecDocs = useCallback(
    (nodeId: string) => {
      void triggerSpecDocsGeneration("single", nodeId);
    },
    [triggerSpecDocsGeneration]
  );

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
                    job={props.job}
                    jobId={props.jobId}
                    generating={specDocsGenerating}
                    onGenerateAll={handleGenerateAllSpecDocs}
                    onGenerateNode={handleGenerateNodeSpecDocs}
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
