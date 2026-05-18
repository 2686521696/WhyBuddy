/**
 * Autopilot 驾驶舱右栏 — 阶段独占视口版本
 *
 * 重构自平铺 timeline 版本，改为"当前阶段独占视口 + 切场动画"的节奏模式：
 * - 使用 StageViewport 容器实现三段式布局（header + content + cta）
 * - 使用 StageTransitionWrapper 实现 framer-motion 方向性滑动过渡
 * - 使用 resolveRailSubStage 计算 activeStageIndex
 * - 一次只渲染当前活跃阶段的内容
 *
 * 数据层不变：仍消费 `AutopilotRightRailProps`，仍用 `resolveRailSubStage` 判定活跃子阶段。
 *
 * 对应 spec：`.kiro/specs/autopilot-workbench-stage-rhythm/`
 * - 需求 1.1：当前阶段独占视口
 * - 需求 5.1：维持固定的 6 阶段顺序
 *
 * autopilot-streaming-doc-renderer 任务 6.1（2026-05-18）：
 * - 当 `activeStageKey === "spec_documents"` 时，StageContent 改为渲染
 *   `<StreamingDocRenderer>`，由它消费 `useBlueprintRealtimeStore` 的
 *   `agentReasoning.entries`（stage_id = `spec_documents`）形成主区域流式
 *   Markdown 渲染，替代既有 `ActiveNodeContent` 内的 SpecTreeWorkbench
 *   accordion 折叠面板。
 * - StageCTA 在 `spec_documents` 阶段已通过 `STAGE_CONFIG.spec_documents
 *   .autoAdvance = true` 进入只读提示分支（"自动生成中..."），无需在此处
 *   做 CTA 适配；只读提示文案对应需求 1.1 / 2.1 中"StageCTA 在此阶段为只读"。
 */

import { useCallback, useEffect, useRef, useState, type FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { SPECS_PATH } from "@/components/navigation-config";
import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
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
import { StreamingDocRenderer } from "./streaming-doc/StreamingDocRenderer";
import { deriveSubStageSummary } from "./sub-stage-summary";
import StageViewport from "./stage-viewport/StageViewport";
import StageHeader from "./stage-viewport/StageHeader";
import StageCTA from "./stage-viewport/StageCTA";
import StageTransitionWrapper from "./stage-viewport/StageTransitionWrapper";
import { STAGE_CONFIG, STAGE_ORDER } from "./stage-viewport/stage-config";
import type { WorkbenchStage } from "./stage-viewport/stage-config";
import { useStageProgress } from "./stage-progress/useStageProgress";
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

/**
 * 将 RAIL_SUB_STAGE_ORDER 中的子阶段映射到 STAGE_ORDER 中的阶段索引。
 *
 * 映射规则（来自 design.md）：
 * - agent_crew_fabric → route (index 2)
 * - spec_tree → spec_tree (index 3)
 * - effect_preview → effect_preview (index 5)
 * - prompt_package / runtime_capability / engineering_handoff / artifact_memory → effect_preview (index 5)
 */
function mapSubStageToStageIndex(subStage: AutopilotRailSubStage): number {
  switch (subStage) {
    case "agent_crew_fabric":
      return STAGE_ORDER.indexOf("route");
    case "spec_tree":
      return STAGE_ORDER.indexOf("spec_tree");
    case "effect_preview":
    case "prompt_package":
    case "runtime_capability":
    case "engineering_handoff":
    case "artifact_memory":
      return STAGE_ORDER.indexOf("effect_preview");
    default:
      return 0;
  }
}

function resolveAriaLabel(locale: AppLocale): string {
  return locale === "zh-CN"
    ? "Autopilot 右栏时间线"
    : "Autopilot right rail timeline";
}

/**
 * autopilot-streaming-doc-renderer Task 6.1：
 * 从 `job.artifacts` 中以只读方式抽取 spec document artifact 的 payload，作为
 * StreamingDocRenderer 在流式生成结束后回填稳定文档列表的兜底来源。
 *
 * 服务端写入路径（参见 `server/routes/blueprint.ts` 中对
 * `artifact.type === "requirements" | "design" | "tasks"` 的判定）会把
 * `BlueprintSpecDocument` 对象作为 artifact payload 持久化，这里把这三类 type
 * 的 payload 还原成 `BlueprintSpecDocument[]`，避免 right rail 必须再去 specTree
 * 派生面取数。`payload` 类型契约为 `unknown`，仅在 `typeof payload === "object"`
 * 时透传，不做更深的字段断言（DocTabBar 内部按 `id` / `title` 软读取兼容）。
 */
function extractSpecDocuments(
  job: BlueprintGenerationJob | null | undefined
): BlueprintSpecDocument[] | undefined {
  if (!job?.artifacts) return undefined;
  const docs: BlueprintSpecDocument[] = [];
  for (const artifact of job.artifacts) {
    if (
      artifact.type === "requirements" ||
      artifact.type === "design" ||
      artifact.type === "tasks"
    ) {
      if (artifact.payload && typeof artifact.payload === "object") {
        docs.push(artifact.payload as BlueprintSpecDocument);
      }
    }
  }
  return docs.length > 0 ? docs : undefined;
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

      {/* autopilot-agent-reasoning-stream：Agent 推理子时间线（在 active 节点内部展开）
          autopilot-mirofish-stream（2026-05-17）：组件内部委托给 MiroFishCardStream，
          job prop 让流能合并 artifact / route / node_completed entry。 */}
      <AgentReasoningSubTimeline locale={locale} job={job} />

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

  // 计算 STAGE_ORDER 中的 activeStageIndex（用于 StageViewport）
  //
  // autopilot-streaming-doc-renderer 任务 6.1（2026-05-18）：
  // 当 `job.stage === "spec_docs"` 时，强制把 activeStageKey 锁定到
  // `"spec_documents"` 阶段，让 StageContent 走 StreamingDocRenderer 分支。
  // 否则 `resolveRailSubStage` 会把 `spec_docs` 折回 `spec_tree` 子阶段，
  // 进而 `mapSubStageToStageIndex` 把它再映射到 `STAGE_ORDER.indexOf("spec_tree") = 3`，
  // 让 spec_documents 主区域永远渲染不到——这与设计文档「集成到 spec_documents
  // 阶段的 StageContent」的口径直接冲突。
  //
  // 该 override 仅作用于 STAGE_ORDER 的展示层 stageKey / stageIndex；右栏内部
  // 的 `activeSubStage`（spec_tree / agent_crew_fabric / ...）以及 fabric 派发
  // 测试断言的 `data-autopilot-sub-stage` 仍然继续走 RAIL_SUB_STAGE_ORDER，
  // 保持 fabric-dispatch.property.test.tsx 等既有 PBT 不被破坏。
  const baseStageIndex = activeSubStage !== undefined
    ? mapSubStageToStageIndex(activeSubStage)
    : 0;
  const isSpecDocumentsStage = job?.stage === "spec_docs";
  const activeStageIndex = isSpecDocumentsStage
    ? STAGE_ORDER.indexOf("spec_documents")
    : baseStageIndex;
  const activeStageKey: WorkbenchStage = STAGE_ORDER[activeStageIndex];
  const currentStageConfig = STAGE_CONFIG[activeStageKey];

  // autopilot-stage-progress-indicator（任务 6.1）：
  // 把 useStageProgress() 在右栏顶层调用一次，将派生进度传给 StageHeader。
  // 这样 6 圆点 + 进度条会跟着 sticky header 固定在视口顶部，与 StageHeader
  // 的步骤标识 / 中文标题协调布局，并共享同一份实时 entries 派生结果。
  const stageProgress = useStageProgress();

  // autopilot-streaming-doc-renderer 任务 6.1：
  // 从 blueprint realtime store 直接读取 agentReasoning entries，让
  // `<StreamingDocRenderer>` 在 `spec_documents` 阶段消费同一份事件流。
  // 选择函数让 selector 命中 zustand 的浅比较，仅在 entries 引用变化时触发
  // 重新渲染；空态由 store INITIAL_AGENT_REASONING 自带的 `entries: []` 兜底，
  // 避免 SSR 路径下出现 undefined。
  const reasoningEntries = useBlueprintRealtimeStore(
    (state) => state.agentReasoning.entries
  );

  // 切场方向：基于上一次 stageIndex 判断 forward / backward
  const prevStageIndexRef = useRef(activeStageIndex);
  const transitionDirection: "forward" | "backward" =
    activeStageIndex >= prevStageIndexRef.current ? "forward" : "backward";
  useEffect(() => {
    prevStageIndexRef.current = activeStageIndex;
  }, [activeStageIndex]);

  /**
   * 已完成阶段数据快照缓存。
   *
   * 当子阶段从 active 推进到下一阶段时，将当前阶段的 `deriveSubStageSummary` 结果
   * 缓存到此 Map 中。用户通过进度指示器回看已完成阶段时，从缓存读取而非重新计算，
   * 避免因 props 数据已被后续阶段覆盖而导致回看内容不准确。
   *
   * 对应需求 1.4：保留已完成阶段的数据快照，允许用户通过进度指示器回看已完成阶段。
   */
  const completedStageSnapshotRef = useRef<
    Map<string, { summary: { apiPath: string; summary: string; dataReady: boolean } }>
  >(new Map());

  // 当 activeSubStage 推进时，将前一个子阶段的摘要快照缓存
  const prevActiveSubStageRef = useRef<AutopilotRailSubStage | undefined>(undefined);
  useEffect(() => {
    const prev = prevActiveSubStageRef.current;
    if (
      prev !== undefined &&
      prev !== activeSubStage &&
      activeSubStage !== undefined
    ) {
      // 前一个子阶段已完成，缓存其摘要
      const prevIndex = RAIL_SUB_STAGE_ORDER.indexOf(prev);
      const currentIndex = RAIL_SUB_STAGE_ORDER.indexOf(activeSubStage);
      if (currentIndex > prevIndex) {
        // 正向推进：缓存前一个阶段的摘要数据
        const snapshot = deriveSubStageSummary(prev, props, locale);
        completedStageSnapshotRef.current.set(prev, {
          summary: {
            apiPath: snapshot.apiPath,
            summary: snapshot.summary,
            dataReady: snapshot.dataReady,
          },
        });
      }
    }
    prevActiveSubStageRef.current = activeSubStage;
  }, [activeSubStage, props, locale]);

  /**
   * 回看已完成阶段的索引。
   *
   * 当用户通过进度指示器回看已完成阶段时，此值为回看目标的 stageIndex；
   * 为 null 时表示用户正在查看当前活跃阶段。
   *
   * 回看时 StageCTA 展示"返回当前阶段"按钮而非推进按钮，
   * 防止用户在回看状态下误触发阶段推进。
   *
   * 对应需求 5.3：回看时允许查看但不允许修改已完成阶段的输出。
   * TODO: 当 autopilot-stage-progress-indicator spec 实现后，
   * 由进度指示器的 onClick 设置此值。
   */
  const [viewingCompletedStageIndex, setViewingCompletedStageIndex] = useState<number | null>(null);

  /** 用户是否正在回看已完成阶段 */
  const isViewingCompletedStage = viewingCompletedStageIndex !== null;

  /**
   * 阶段推进处理函数 — 带顺序守卫。
   *
   * 确保阶段推进严格顺序执行（目标 index === 当前 index + 1），
   * 禁止跳过中间阶段，且回看已完成阶段时不允许触发推进。
   *
   * 对应需求 1.3：StageCTA onAction 触发 activeStageIndex + 1
   * 对应需求 5.2：不允许跳过中间阶段直接推进到后续阶段
   * 对应需求 5.3：回看时允许查看但不允许修改
   */
  const handleStageAdvance = useCallback(() => {
    // 回看已完成阶段时禁止推进
    if (isViewingCompletedStage) {
      return;
    }

    // 顺序守卫：目标阶段必须是当前阶段 + 1
    const targetIndex = activeStageIndex + 1;
    if (targetIndex >= STAGE_ORDER.length) {
      // 已是最后阶段，无法继续推进
      return;
    }

    // 验证目标阶段确实是下一个阶段（禁止跳跃）
    if (targetIndex !== activeStageIndex + 1) {
      return;
    }

    // 调用父组件的推进回调
    props.onStageAdvanced?.();
  }, [isViewingCompletedStage, activeStageIndex, props.onStageAdvanced]);

  /**
   * 从回看状态返回当前活跃阶段。
   *
   * 清除 viewingCompletedStageIndex，恢复到当前活跃阶段视图。
   */
  const handleReturnToActiveStage = useCallback(() => {
    setViewingCompletedStageIndex(null);
  }, []);

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

      {/* 阶段独占视口 — 使用 resolveRailSubStage 计算 activeStageIndex，
          将当前活跃阶段内容作为 StageViewport children 传入 */}
      <StageTransitionWrapper
        stageKey={activeStageKey}
        direction={transitionDirection}
      >
        <StageViewport
          stageIndex={activeStageIndex}
          stageKey={activeStageKey}
          header={
            <StageHeader
              stageIndex={activeStageIndex}
              englishLabel={currentStageConfig.englishLabel}
              chineseTitle={currentStageConfig.chineseTitle}
              isActive={true}
              completedStages={stageProgress.completedStages}
              activeStage={stageProgress.activeStage}
              stageProgress={stageProgress.stageProgress}
              isIndeterminate={stageProgress.isIndeterminate}
            />
          }
          cta={
            isViewingCompletedStage ? (
              <StageCTA
                label={locale === "zh-CN" ? "返回当前阶段" : "Return to current stage"}
                loading={false}
                disabled={false}
                onAction={handleReturnToActiveStage}
              />
            ) : currentStageConfig.autoAdvance ? (
              <StageCTA
                label={currentStageConfig.ctaLabel}
                loading={false}
                disabled={false}
                readOnly={true}
                readOnlyHint={locale === "zh-CN" ? "自动生成中..." : "Auto-generating..."}
                onAction={() => {}}
              />
            ) : (
              <StageCTA
                label={currentStageConfig.ctaLabel}
                loading={specDocsGenerating !== null}
                disabled={specDocsGenerating !== null}
                onAction={handleStageAdvance}
              />
            )
          }
        >
          {/* autopilot-streaming-doc-renderer 任务 6.1：
              当活跃阶段为 `spec_documents` 时，由 StreamingDocRenderer 占据
              StageContent 主区域，替代原 SpecTreeWorkbench accordion 折叠面板。
              StageCTA 已通过 STAGE_CONFIG.spec_documents.autoAdvance = true 走只读
              提示分支（"自动生成中..."），无需在此处做额外 CTA 适配。

              data-sub-stage-placeholder / data-timeline-status / aria-current 等
              既有断点保留，避免破坏 fabric-dispatch.property.test.tsx 等回归。 */}
          {activeStageKey === "spec_documents" ? (
            <div
              data-sub-stage-placeholder={activeSubStage ?? ""}
              data-timeline-status="active"
              aria-current="step"
              className="h-full min-h-0"
            >
              <StreamingDocRenderer
                entries={reasoningEntries}
                specDocuments={extractSpecDocuments(props.job)}
                locale={locale}
              />
            </div>
          ) : (
            /* 当前活跃阶段的内容 — 保留 data-sub-stage-placeholder 供测试断言 */
            activeSubStage !== undefined && (
              <div
                data-sub-stage-placeholder={activeSubStage}
                data-timeline-status="active"
                aria-current="step"
              >
                <ActiveNodeContent
                  summary={
                    completedStageSnapshotRef.current.has(activeSubStage)
                      ? completedStageSnapshotRef.current.get(activeSubStage)!.summary
                      : deriveSubStageSummary(activeSubStage, props, locale)
                  }
                  locale={locale}
                  subStage={activeSubStage}
                  dataReady={
                    completedStageSnapshotRef.current.has(activeSubStage)
                      ? completedStageSnapshotRef.current.get(activeSubStage)!.summary.dataReady
                      : deriveSubStageSummary(activeSubStage, props, locale).dataReady
                  }
                  onConfirmAdvance={isViewingCompletedStage ? undefined : handleStageAdvance}
                  advancing={false}
                  specTree={props.specTree}
                  job={props.job}
                  jobId={props.jobId}
                  generating={specDocsGenerating}
                  onGenerateAll={handleGenerateAllSpecDocs}
                  onGenerateNode={handleGenerateNodeSpecDocs}
                />
              </div>
            )
          )}
        </StageViewport>
      </StageTransitionWrapper>

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
