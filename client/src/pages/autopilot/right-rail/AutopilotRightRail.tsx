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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { toast as showToast } from "sonner";

import type { AppLocale } from "@/lib/locale";
import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintSpecDocument,
  BlueprintSpecDocumentsResponse,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import {
  generateBlueprintEffectPreview,
  generateBlueprintSpecDocuments,
} from "@/lib/blueprint-api";
import { postBlueprintReplan } from "@/lib/blueprint-api/replan";
import { FRONTEND_TIMEOUT_MARKER } from "@/lib/blueprint-realtime-store";
import type { ApiRequestError } from "@/lib/api-client";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import {
  getAutopilotPageForStage,
  useStageTransitionAnimator,
} from "@/lib/autopilot-coordination";

import { AgentReasoningSubTimeline } from "./AgentReasoningSubTimeline";
import { CapabilityRail } from "./CapabilityRail";
import { FleetActivationLog } from "./FleetActivationLog";
import { TrustSection } from "./TrustSection";
import type { CompanionFindingsSource } from "./trust/companion";
import { deriveNodeStatusById } from "./spec-docs-progress/derive-node-status-by-id";
import { stepSubStage } from "./hooks/use-right-rail-sub-stage-state";
import { resolveRailSubStage } from "./resolve-rail-sub-stage";
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
  REPLAN_STAGE_ORDER,
  deriveDownstreamImpact as deriveReplanDownstreamImpact,
  getReplanArtifactStage,
  ReplanButton,
  ReplanConfirmationModal,
  useReplanFlow,
  type ReplanMode,
  type ReplanPostResult,
  type ReplanStage,
  type ReplanStatus,
} from "./replan";
import {
  RightRailStaleIndicator,
  type AutopilotLocalStage,
  type RightRailStaleArtifact,
} from "../stage-edit";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
  type AutopilotTimelineStage,
} from "./types";
import {
  AgentCrewFabricPanel,
  ArtifactMemoryPanel,
  EffectPreviewPanel,
  EngineeringHandoffPanel,
  PromptPackagePanel,
  RuntimeCapabilityPanel,
} from "./panels";

const TIMELINE_STAGE_ORDER: readonly AutopilotTimelineStage[] = [
  "input",
  "clarification",
  "routeset",
  "selection",
  "fabric",
] as const;

type ReplannableGenerationStage = Extract<
  BlueprintGenerationStage,
  ReplanStage
>;

const EMPTY_FABRIC_SPEC_TREE = {
  id: "empty-fabric-spec-tree",
  rootNodeId: "empty-root",
  version: 1,
  nodes: [],
  documents: [],
} as unknown as BlueprintSpecTree;

// spec-generation-perceived-performance Task 6.2（R4.5 / R5.5）：In_Flight
// 乐观标记的权威超时阈值。子组件 SpecTreeWorkbench 内的 deriveGenerationState
// 也有一份 60s 乐观超时用于派生，但父级这份才是真正释放 In_Flight_Lock
// （specDocsGenerating）并通过 toast 通道浮现超时原因的权威计时。
const SPEC_DOCS_GENERATION_TIMEOUT_MS = 60000;

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

export type ManualAdvanceAction =
  | { type: "none" }
  | { type: "stage" }
  | { type: "sub-stage"; nextSubStage: AutopilotRailSubStage }
  | {
      type: "workbench-stage";
      nextStage: WorkbenchStage;
      nextSubStage?: AutopilotRailSubStage;
    };

export type ManualPreviousAction =
  | { type: "none" }
  | { type: "sub-stage"; previousSubStage: AutopilotRailSubStage }
  | { type: "workflow-stage"; previousStage: AutopilotTimelineStage }
  | {
      type: "workbench-stage";
      previousStage: WorkbenchStage;
      previousSubStage?: AutopilotRailSubStage;
    };

/**
 * Resolve what the bottom "continue" button should do.
 *
 * The visual workbench only has 6 stages, while the fabric rail has 7
 * sub-stages. Several late sub-stages all render inside STEP 06, so using only
 * `activeStageIndex + 1` makes the button a no-op there.
 */
export function resolveManualAdvanceAction(input: {
  activeSubStage: AutopilotRailSubStage | undefined;
  activeStageIndex: number;
  isViewingCompletedStage: boolean;
}): ManualAdvanceAction {
  if (input.isViewingCompletedStage || input.activeSubStage === undefined) {
    return { type: "none" };
  }

  if (input.activeSubStage === "spec_tree") {
    // SPEC tree and SPEC documents now share the same stage-2 workspace.
    return { type: "none" };
  }

  const nextSubStage = stepSubStage(input.activeSubStage, "next");
  if (nextSubStage === undefined) {
    return { type: "none" };
  }

  switch (input.activeSubStage) {
    case "agent_crew_fabric":
    case "prompt_package":
    case "runtime_capability":
    case "engineering_handoff":
      return { type: "sub-stage", nextSubStage };
    case "effect_preview":
      return { type: "stage" };
    case "artifact_memory":
      return { type: "none" };
    default:
      return input.activeSubStage satisfies never;
  }
}

function isFoldedEffectPreviewSubStage(
  subStage: AutopilotRailSubStage
): boolean {
  switch (subStage) {
    case "effect_preview":
    case "prompt_package":
    case "runtime_capability":
    case "engineering_handoff":
    case "artifact_memory":
      return true;
    case "agent_crew_fabric":
    case "spec_tree":
      return false;
    default:
      return subStage satisfies never;
  }
}

/**
 * Resolve the header "previous" button by the visible workbench step first.
 *
 * `spec_documents` is a visual stage, not a rail sub-stage. If we only step
 * through `RAIL_SUB_STAGE_ORDER`, the button jumps from SPEC documents back to
 * `agent_crew_fabric`, or appears to do nothing when the rail sub-stage is
 * already `spec_tree`. This resolver keeps visual-stage backtracking separate
 * from rail-sub-stage backtracking.
 */
export function resolveManualPreviousAction(input: {
  activeSubStage: AutopilotRailSubStage | undefined;
  activeStageKey: WorkbenchStage;
  isViewingCompletedStage: boolean;
  isManualWorkbenchStageOverride?: boolean;
}): ManualPreviousAction {
  if (input.isViewingCompletedStage || input.activeSubStage === undefined) {
    return { type: "none" };
  }

  if (
    input.activeSubStage === "spec_tree" &&
    (input.activeStageKey === "spec_tree" ||
      input.activeStageKey === "spec_documents")
  ) {
    return {
      type: "workflow-stage",
      previousStage: "input",
    };
  }

  if (
    input.activeStageKey === "effect_preview" &&
    isFoldedEffectPreviewSubStage(input.activeSubStage)
  ) {
    return {
      type: "workbench-stage",
      previousStage: "spec_documents",
      previousSubStage: "spec_tree",
    };
  }

  const previousSubStage = stepSubStage(input.activeSubStage, "prev");
  if (previousSubStage === undefined) {
    return { type: "none" };
  }
  return { type: "sub-stage", previousSubStage };
}

export function isManualWorkbenchStageOverrideValid(
  override: WorkbenchStage | null,
  input: {
    activeSubStage: AutopilotRailSubStage | undefined;
    jobStage: string | undefined;
  }
): override is WorkbenchStage {
  if (override === null) {
    return false;
  }

  if (override === "spec_tree") {
    return input.activeSubStage === "spec_tree";
  }

  if (override === "spec_documents") {
    if (input.activeSubStage === "spec_tree") {
      return isAtOrBeyondSpecDocuments(input.jobStage);
    }

    return (
      input.activeSubStage !== undefined &&
      isFoldedEffectPreviewSubStage(input.activeSubStage)
    );
  }

  return false;
}

export function resolveReplanCompletedViewFlag(input: {
  isViewingCompletedStage: boolean;
  isCurrentJobCompleted?: boolean;
  manualStageOverride: WorkbenchStage | null;
  coercedStaleRoutePin: boolean;
  isViewingEarlierGenerationStage?: boolean;
}): boolean {
  return (
    input.isViewingCompletedStage ||
    input.isCurrentJobCompleted === true ||
    input.manualStageOverride !== null ||
    input.coercedStaleRoutePin ||
    input.isViewingEarlierGenerationStage === true
  );
}

export function resolveHistoryEntryFamilyCount(input: {
  familyJobCount: number | null | undefined;
  hasParentJob: boolean;
}): number {
  if (input.familyJobCount && input.familyJobCount > 0) {
    return input.familyJobCount;
  }
  return 1;
}

function isViewingEarlierGenerationStage(input: {
  currentGenerationStage: ReplanStage;
  jobStage: string | undefined;
}): boolean {
  const currentIndex = REPLAN_STAGE_ORDER.indexOf(input.currentGenerationStage);
  const jobIndex = REPLAN_STAGE_ORDER.indexOf(input.jobStage as ReplanStage);

  return currentIndex >= 0 && jobIndex >= 0 && currentIndex < jobIndex;
}

function isAtOrBeyondSpecDocuments(jobStage: string | undefined): boolean {
  switch (jobStage) {
    case "spec_docs":
    case "preview":
    case "effect_preview":
    case "prompt_packaging":
    case "runtime_capability":
    case "engineering_handoff":
    case "engineering_landing":
      return true;
    default:
      return false;
  }
}

function mapWorkbenchStageToGenerationStage(
  stage: WorkbenchStage,
): ReplannableGenerationStage {
  switch (stage) {
    case "input":
      return "input";
    case "clarification":
      return "clarification";
    case "route":
      return "route_generation";
    case "spec_tree":
      return "spec_tree";
    case "spec_documents":
      return "spec_docs";
    case "effect_preview":
      return "effect_preview";
    default:
      return stage satisfies never;
  }
}

function mapGenerationStageToLocalStage(
  stage: BlueprintGenerationStage | ReplanStage,
): AutopilotLocalStage {
  switch (stage) {
    case "spec_docs":
      return "spec_documents";
    case "agent_crew_fabric":
      return "agent_crew";
    default:
      return stage;
  }
}

function mapReplanStageToBlueprintStage(
  stage: ReplanStage,
): BlueprintGenerationStage {
  switch (stage) {
    case "agent_crew_fabric":
      return "route_generation";
    case "artifact_memory":
      return "engineering_landing";
    default:
      return stage;
  }
}

function normalizeReplanStatus(status: string | undefined): ReplanStatus {
  switch (status) {
    case "pending":
    case "running":
    case "waiting":
    case "reviewing":
    case "completed":
    case "failed":
      return status;
    default:
      return "completed";
  }
}

function findStaleArtifactForStage(
  job: BlueprintGenerationJob | null,
  currentStage: AutopilotLocalStage,
): RightRailStaleArtifact | null {
  if (!job?.artifacts) return null;

  for (const artifact of job.artifacts) {
    if (!artifact.staleSince) continue;
    const artifactStage = getReplanArtifactStage({
      id: artifact.id,
      type: artifact.type,
    });
    if (!artifactStage) continue;

    const localStage = mapGenerationStageToLocalStage(artifactStage);
    if (localStage !== currentStage) continue;

    return {
      id: artifact.id,
      stage: localStage,
      staleSince: artifact.staleSince,
      invalidatedBy: artifact.invalidatedBy,
    };
  }

  return null;
}

function normalizeActiveSubStageForJobProgress(input: {
  requestedSubStage: AutopilotRailSubStage | undefined;
  explicitSubStage: AutopilotRailSubStage | undefined;
  jobStage: string | undefined;
}): {
  activeSubStage: AutopilotRailSubStage | undefined;
  coercedStaleRoutePin: boolean;
} {
  return {
    activeSubStage: input.requestedSubStage,
    coercedStaleRoutePin: false,
  };
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

type BlueprintSpecTreeWithDocuments = BlueprintSpecTree & {
  documents?: BlueprintSpecDocument[];
};

function extractSpecTreeDocuments(
  specTree: BlueprintSpecTree | null | undefined
): BlueprintSpecDocument[] | undefined {
  const documents = (specTree as BlueprintSpecTreeWithDocuments | null | undefined)
    ?.documents;
  return Array.isArray(documents) && documents.length > 0
    ? documents
    : undefined;
}

function resolvePersistedSpecDocuments(input: {
  job: BlueprintGenerationJob | null | undefined;
  specTree: BlueprintSpecTree | null | undefined;
}): BlueprintSpecDocument[] | undefined {
  const docs =
    extractSpecDocuments(input.job) ?? extractSpecTreeDocuments(input.specTree);
  if (!docs || docs.length === 0) return docs;

  // Cross-job/cross-project bleed guard: only surface documents whose `nodeId`
  // belongs to the CURRENT spec tree. Without this, a stale job snapshot (e.g.
  // the previous project's `latestJob`) can carry 63 documents whose nodeIds
  // belong to a different tree, producing the "63/72 generated but every node
  // 未生成" inconsistency the user reported (docs from another project bleeding
  // into a freshly-created job that hasn't generated anything yet).
  const nodeIds = input.specTree?.nodes;
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    // No tree to validate against — keep docs as-is (no mismatch to guard).
    return docs;
  }
  const treeNodeIdSet = new Set(nodeIds.map(node => node.id));
  const scoped = docs.filter(
    doc => typeof doc.nodeId === "string" && treeNodeIdSet.has(doc.nodeId)
  );
  return scoped.length > 0 ? scoped : undefined;
}

function renderFabricSubStageContent(
  activeSubStage: AutopilotRailSubStage,
  props: AutopilotRightRailProps,
): ReactNode {
  const specTree = props.specTree ?? EMPTY_FABRIC_SPEC_TREE;
  const persistedSpecDocuments = resolvePersistedSpecDocuments({
    job: props.job,
    specTree: props.specTree,
  });

  switch (activeSubStage) {
    case "agent_crew_fabric":
      return (
        <AgentCrewFabricPanel
          jobId={props.jobId}
          job={props.job}
          agentCrew={props.agentCrew}
          capabilities={props.capabilities}
          capabilityInvocations={props.capabilityInvocations}
          capabilityEvidence={props.capabilityEvidence}
          locale={props.locale}
        />
      );
    case "spec_tree":
      return null;
    case "effect_preview":
      return (
        <EffectPreviewPanel
          jobId={props.jobId}
          job={props.job}
          specTree={specTree}
          effectPreviews={props.effectPreviews}
          initialPreviews={props.effectPreviews}
          documents={persistedSpecDocuments}
          agentCrew={props.agentCrew}
          capabilityEvidence={props.capabilityEvidence}
          locale={props.locale}
        />
      );
    case "prompt_package":
      return (
        <PromptPackagePanel
          jobId={props.jobId}
          specTree={specTree}
          effectPreviews={props.effectPreviews}
          locale={props.locale}
        />
      );
    case "runtime_capability":
      return (
        <RuntimeCapabilityPanel
          jobId={props.jobId}
          specTree={specTree}
          capabilities={props.capabilities}
          capabilityInvocations={props.capabilityInvocations}
          capabilityEvidence={props.capabilityEvidence}
          agentCrew={props.agentCrew}
          locale={props.locale}
        />
      );
    case "engineering_handoff":
      return <EngineeringHandoffPanel jobId={props.jobId} locale={props.locale} />;
    case "artifact_memory":
      return <ArtifactMemoryPanel jobId={props.jobId} locale={props.locale} />;
    default:
      return activeSubStage satisfies never;
  }
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
  specTree,
  job,
  jobId,
  generating,
  onGenerateAll,
  onGenerateNode,
  generationError,
  onRetry,
}: {
  summary: { apiPath: string; summary: string; dataReady: boolean };
  locale: AppLocale;
  subStage: string;
  specTree?: BlueprintSpecTree | null;
  job?: BlueprintGenerationJob | null;
  jobId: string;
  generating: "all" | "single" | null;
  onGenerateAll: () => void;
  onGenerateNode: (nodeId: string) => void;
  // spec-generation-perceived-performance Task 6.1：父级失败态与重试入口透传。
  generationError?: { message?: string; detail?: string } | null;
  onRetry?: (scope: "all" | "single", nodeId?: string) => void;
}) {
  const isZh = locale === "zh-CN";
  const isSpecTreeStage = subStage === "spec_tree";
  const anyGenerating = generating !== null;
  const generatingAll = generating === "all";

  return (
    <div className="px-2 py-1.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] text-slate-400 truncate">
          {summary.apiPath}
        </div>
        {/* 一键生成全部规格文档按钮 — 放在 API path 右侧，醒目位置 */}
        {isSpecTreeStage && (
          <button
            type="button"
            data-testid="spec-tree-generate-all-header"
            disabled={anyGenerating}
            onClick={onGenerateAll}
            className="flex-shrink-0 rounded-md bg-slate-900 px-3 py-1 text-[11px] font-bold text-white transition hover:bg-slate-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {generatingAll
              ? (isZh ? "生成中..." : "Generating...")
              : (isZh ? "生成全部" : "Generate All")}
          </button>
        )}
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
          generationError={generationError}
          onRetry={onRetry}
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
  const requestedSubStage: AutopilotRailSubStage | undefined =
    currentSubStageFromProps ??
    computedSubStage ??
    (currentStage === "fabric" ? RAIL_SUB_STAGE_ORDER[0] : undefined);
  const { activeSubStage, coercedStaleRoutePin } =
    normalizeActiveSubStageForJobProgress({
      requestedSubStage,
      explicitSubStage: currentSubStageFromProps,
      jobStage: job?.stage,
    });

  const activeIndex =
    activeSubStage !== undefined
      ? RAIL_SUB_STAGE_ORDER.indexOf(activeSubStage)
      : -1;
  const [manualWorkbenchStageOverride, setManualWorkbenchStageOverride] =
    useState<WorkbenchStage | null>(null);

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
  const manualStageOverride = isManualWorkbenchStageOverrideValid(
    manualWorkbenchStageOverride,
    { activeSubStage, jobStage: job?.stage }
  )
    ? manualWorkbenchStageOverride
    : null;
  const activeStageIndex = manualStageOverride
    ? STAGE_ORDER.indexOf(manualStageOverride)
    : baseStageIndex;
  const activeStageKey: WorkbenchStage = STAGE_ORDER[activeStageIndex];
  const currentStageConfig = STAGE_CONFIG[activeStageKey];
  const canEnterEffectPreviewFromCurrentStage =
    activeStageKey === "spec_documents";
  const showFabricObservability =
    activeStageKey !== "spec_tree" &&
    activeStageKey !== "spec_documents";
  const showTrustSection = activeStageKey !== "spec_tree";
  const currentGenerationStage =
    mapWorkbenchStageToGenerationStage(activeStageKey);
  const {
    state: stageAnimatorState,
    transition: triggerStageAnimatorTransition,
  } = useStageTransitionAnimator();
  const currentLocalStage =
    mapGenerationStageToLocalStage(currentGenerationStage);
  const replanImpact = deriveReplanDownstreamImpact({
    fromStage: currentGenerationStage,
    artifacts: props.job?.artifacts ?? [],
  });
  const staleArtifact = findStaleArtifactForStage(
    props.job,
    currentLocalStage,
  );
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanMode, setReplanMode] = useState<ReplanMode>("in_place");
  const [replanReason, setReplanReason] = useState("");
  const [replanLoading, setReplanLoading] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const replanFlow = useReplanFlow({
    postReplan: async (request, options) => {
      const result = await postBlueprintReplan(
        request.jobId,
        {
          fromStage: mapReplanStageToBlueprintStage(request.fromStage),
          mode: request.mode,
          reason: request.reason.trim() || undefined,
        },
        { signal: options?.signal },
      );
      if (!result.ok) {
        throw result.error;
      }
      const replanResult: ReplanPostResult = {
        ...result.data,
        mode: result.data.mode,
        job: result.data.job,
      };
      return replanResult;
    },
    applyNavigation: {
      applyInPlace: (result) => {
        props.onJobUpdated?.(result.job as BlueprintGenerationJob);
        props.onStageAdvanced?.();
      },
      activeJob: (_jobId, result) => {
        const nextJob = result.job as BlueprintGenerationJob;
        if (props.onBranchJobActivated) {
          props.onBranchJobActivated(nextJob);
        } else {
          props.onJobUpdated?.(nextJob);
        }
        props.onStageAdvanced?.();
      },
    },
    coordinator: props.coordinator,
    getCoordinationTransitions: (input, result) => {
      const fromStage = mapReplanStageToBlueprintStage(input.fromStage);
      const toStage = result.job.stage ?? fromStage;
      const fromPage = getAutopilotPageForStage(fromStage);
      const toPage = getAutopilotPageForStage(toStage);

      return {
        stageTransition: {
          fromStage,
          toStage,
        },
        ...(fromPage !== null && toPage !== null
          ? {
              pageTransition: {
                fromPage,
                toPage,
              },
            }
          : {}),
      };
    },
    toastQueue: {
      push: (notification) => {
        if (notification.tone === "success") {
          showToast.success(notification.title, {
            description: notification.message,
          });
          return;
        }
        if (notification.tone === "error") {
          showToast.error(notification.title, {
            description: notification.message,
          });
          return;
        }
        showToast(notification.title, {
          description: notification.message,
        });
      },
    },
  });

  useEffect(() => {
    if (manualWorkbenchStageOverride !== null && manualStageOverride === null) {
      setManualWorkbenchStageOverride(null);
    }
  }, [manualWorkbenchStageOverride, manualStageOverride]);

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

  // sliderule-spec-tree-progress-merge-2026-05-29 §6：把 specDocsProgress.nodes
  // 派生成 plain record（nodeId → { status, wasRetried, errorSummary }）透传给
  // 下游 SPEC 树，替代原 SpecDocsProgressPanel 浮层。selector 直接返回 store
  // 的 nodes record，useMemo 把它映射成轻量快照只在 nodes 引用变化时重算。
  //
  // 双源合并（refresh 持久化修复）：specDocsProgress 是浏览器内存里的活跃态浮层，
  // 刷新页面后会回到 idle / 空 nodes，导致历史已生成节点被错判为 pending。把
  // job.artifacts 中已落盘的 spec documents 也作为 status 来源——任何节点存在
  // 至少一份持久化文档，基线就是 completed；live progress 再覆盖（in-flight
  // 重试时显示 processing 而不是 completed），保证刷新后 ✓ 不丢、live retry 优先。
  const specDocsNodes = useBlueprintRealtimeStore(
    (state) => state.specDocsProgress.nodes
  );
  const specDocsBatchStatus = useBlueprintRealtimeStore(
    (state) => state.specDocsProgress.batchStatus
  );
  const persistedSpecDocuments = useMemo(
    () =>
      resolvePersistedSpecDocuments({
        job: props.job,
        specTree: props.specTree,
      }),
    [props.job, props.specTree]
  );
  const nodeStatusById = useMemo(
    () =>
      deriveNodeStatusById({
        persistedSpecDocuments,
        liveProgressNodes: specDocsNodes,
        liveBatchStatus: specDocsBatchStatus,
      }),
    [persistedSpecDocuments, specDocsNodes, specDocsBatchStatus]
  );

  // 切场方向：基于上一次 stageIndex 判断 forward / backward
  const prevStageIndexRef = useRef(activeStageIndex);
  const transitionDirection: "forward" | "backward" =
    activeStageIndex >= prevStageIndexRef.current ? "forward" : "backward";
  const previousGenerationStageRef = useRef(currentGenerationStage);
  useEffect(() => {
    prevStageIndexRef.current = activeStageIndex;
  }, [activeStageIndex]);
  useEffect(() => {
    const previousStage = previousGenerationStageRef.current;
    if (previousStage !== currentGenerationStage) {
      triggerStageAnimatorTransition(previousStage, currentGenerationStage);
      previousGenerationStageRef.current = currentGenerationStage;
    }
  }, [currentGenerationStage, triggerStageAnimatorTransition]);
  const stageAnimatorDirection: "forward" | "backward" | null =
    stageAnimatorState.direction === "advance"
      ? "forward"
      : stageAnimatorState.direction === "retreat"
        ? "backward"
        : null;

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
  const isReplanCompletedView = resolveReplanCompletedViewFlag({
    isViewingCompletedStage,
    isCurrentJobCompleted: normalizeReplanStatus(props.job?.status) === "completed",
    manualStageOverride,
    coercedStaleRoutePin,
    isViewingEarlierGenerationStage: isViewingEarlierGenerationStage({
      currentGenerationStage,
      jobStage: props.job?.stage,
    }),
  });

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
  const manualAdvanceAction = resolveManualAdvanceAction({
    activeSubStage,
    activeStageIndex,
    isViewingCompletedStage,
  });
  const handleStageAdvance = useCallback(() => {
    const action = resolveManualAdvanceAction({
      activeSubStage,
      activeStageIndex,
      isViewingCompletedStage,
    });

    if (action.type === "none") {
      return;
    }

    if (action.type === "sub-stage") {
      props.onSubStageChange(action.nextSubStage);
      return;
    }

    if (action.type === "workbench-stage") {
      setManualWorkbenchStageOverride(action.nextStage);
      if (action.nextSubStage !== undefined) {
        props.onSubStageChange(action.nextSubStage);
      }
      return;
    }

    props.onStageAdvanced?.();
  }, [
    activeSubStage,
    activeStageIndex,
    isViewingCompletedStage,
    props.onSubStageChange,
    props.onStageAdvanced,
  ]);

  /**
   * 从回看状态返回当前活跃阶段。
   *
   * 清除 viewingCompletedStageIndex，恢复到当前活跃阶段视图。
   */
  const handleReturnToActiveStage = useCallback(() => {
    setViewingCompletedStageIndex(null);
  }, []);

  const previousNavigationAction = resolveManualPreviousAction({
    activeSubStage,
    activeStageKey,
    isViewingCompletedStage,
    isManualWorkbenchStageOverride:
      manualStageOverride !== null || coercedStaleRoutePin,
  });
  const previousSubStage =
    previousNavigationAction.type === "sub-stage"
      ? previousNavigationAction.previousSubStage
      : previousNavigationAction.type === "workbench-stage"
        ? previousNavigationAction.previousSubStage
        : undefined;
  const previousWorkbenchStage =
    previousNavigationAction.type === "workbench-stage"
      ? previousNavigationAction.previousStage
      : undefined;
  const previousWorkflowStage =
    previousNavigationAction.type === "workflow-stage"
      ? previousNavigationAction.previousStage
      : undefined;
  const previousTargetKind =
    previousNavigationAction.type === "none"
      ? undefined
      : previousNavigationAction.type;
  const previousStageLabel =
    locale === "zh-CN" ? "返回上一步" : "Back to previous step";
  const handleNavigatePreviousStage = useCallback(() => {
    if (previousNavigationAction.type === "none") {
      return;
    }
    setViewingCompletedStageIndex(null);

    if (previousNavigationAction.type === "workbench-stage") {
      setManualWorkbenchStageOverride(previousNavigationAction.previousStage);
      if (previousNavigationAction.previousSubStage !== undefined) {
        props.onSubStageChange(previousNavigationAction.previousSubStage);
      }
      return;
    }

    if (previousNavigationAction.type === "workflow-stage") {
      setManualWorkbenchStageOverride(null);
      props.onNavigateWorkflowStage?.(previousNavigationAction.previousStage);
      return;
    }

    setManualWorkbenchStageOverride(null);
    props.onSubStageChange(previousNavigationAction.previousSubStage);
  }, [
    previousNavigationAction,
    props.onNavigateWorkflowStage,
    props.onSubStageChange,
  ]);

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
  // spec-generation-perceived-performance Task 6.2：避免在异步生成 race 决出
  // 胜负后、组件已卸载的情况下 setState（React 泄漏告警 / 状态写孤儿）。
  const specDocsMountedRef = useRef(true);
  useEffect(() => {
    specDocsMountedRef.current = true;
    return () => {
      specDocsMountedRef.current = false;
    };
  }, []);
  const generateSpecDocuments =
    props.generateSpecDocuments ?? generateBlueprintSpecDocuments;

  // sliderule-stage3-unblock-2026-05-29：进入效果预演（stage 3）的 in-flight
  // 状态与 onClick 处理。背景：服务端 POST /jobs/:id/effect-previews 在
  // specTree 存在时即可成功（probe 已验证返回 201 + 13 份预演 + job.stage
  // 翻到 effect_preview）。useAutoAdvance 只在 stage === "spec_docs" &&
  // status === "completed" 时才推进，但服务端 spec_docs 默认停在
  // status:"reviewing" 等用户接受文档，导致自动推进永远沉默。这里给用户一个
  // 显式按钮，点击后把响应抬到上层 onSpecDocumentsGenerated 让 latestJob
  // 推进，使右栏 dispatcher 切换到 effect_preview 子阶段。
  const [effectPreviewState, setEffectPreviewState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const handleEnterEffectPreview = useCallback(async () => {
    if (!props.jobId) return;
    if (effectPreviewState === "loading") return;
    setEffectPreviewState("loading");
    try {
      const result = await generateBlueprintEffectPreview(props.jobId, {
        includeDrafts: true,
      });
      if (result.ok) {
        // Re-use the existing onSpecDocumentsGenerated bridge so the parent
        // page rolls latestJob / specTree forward; the response contract from
        // /effect-previews is a superset (carries job + effectPreviews) and
        // the parent's setLatestJob accepts the same shape.
        const job = (result.data as unknown as { job?: BlueprintGenerationJob })
          .job;
        if (job && props.onSpecDocumentsGenerated) {
          props.onSpecDocumentsGenerated({
            job,
            specTree: props.specTree as BlueprintSpecTree,
            documents: persistedSpecDocuments,
          } as unknown as Parameters<
            NonNullable<typeof props.onSpecDocumentsGenerated>
          >[0]);
        }
        setEffectPreviewState("success");
      } else {
        setEffectPreviewState("error");
      }
    } catch {
      setEffectPreviewState("error");
    }
  }, [
    props.jobId,
    props.onSpecDocumentsGenerated,
    props.specTree,
    persistedSpecDocuments,
    effectPreviewState,
  ]);
  // Reset the success/error state when the job advances out of the spec
  // documents view (e.g. once the server's stage flips to effect_preview, we
  // want a fresh button if the user comes back).
  useEffect(() => {
    if (props.job?.stage !== "spec_docs" && effectPreviewState !== "idle") {
      setEffectPreviewState("idle");
    }
  }, [props.job?.stage, effectPreviewState]);

  const triggerSpecDocsGeneration = useCallback(
    async (scope: "all" | "single", nodeId?: string) => {
      // In_Flight_Lock 并发幂等（R1.5 / R1.6 / R3.5）：当锁已被任意范围标记
      // 进行中（specDocsGenerating !== null）时，后续对相同或不同范围的触发
      // 一律 early return —— 不改变当前锁、不发起新的生成 API 调用，直至当前
      // 请求结束。这里是唯一的 In_Flight_Lock + API + 回写锚点。
      if (!props.jobId || specDocsGenerating !== null) return;
      setSpecDocsGenerating(scope);
      setSpecDocsError(null);
      const startTime = Date.now();

      // R4.5 / R5.5：60s 超时守卫。把真实生成 promise 与一个超时哨兵竞速，
      // 任一先到即决出胜负；超时分支结束乐观/in-flight、派生 failure、CTA
      // 恢复 enabled（specDocsGenerating 归 null）、toast 超时原因，且绝不
      // 向真相源（onSpecDocumentsGenerated → latestJob）写入部分结果。
      const TIMEOUT = Symbol("spec-docs-generation-timeout");
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
        timeoutHandle = setTimeout(
          () => resolve(TIMEOUT),
          SPEC_DOCS_GENERATION_TIMEOUT_MS
        );
      });

      let raceResult:
        | Awaited<ReturnType<typeof generateSpecDocuments>>
        | typeof TIMEOUT;
      try {
        raceResult = await Promise.race([
          generateSpecDocuments(
            props.jobId,
            scope === "single" && nodeId !== undefined
              ? { nodeId, locale }
              : { locale }
          ),
          timeoutPromise,
        ]);
      } finally {
        // 已决出胜负：清理计时器（resolved/rejected 路径都清），避免泄漏。
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }

      // 组件已卸载：不再 setState，避免 React 泄漏告警与孤儿写入。
      if (!specDocsMountedRef.current) return;

      // —— 超时分支（R4.5 / R5.5）——
      if (raceResult === TIMEOUT) {
        setSpecDocsGenerating(null);
        const timeoutError: ApiRequestError = {
          kind: "error",
          source: "network",
          endpoint: `/api/blueprint/jobs/${props.jobId}/spec-documents`,
          message:
            locale === "zh-CN"
              ? "生成规格文档请求超时（后台可能仍在生成）"
              : "Spec document generation request timed out (backend may still be running)",
          detail:
            locale === "zh-CN"
              ? "前端 60 秒保护已触发，后端默认超时 ~5 分钟。请稍后刷新查看进度，或重试单节点生成。"
              : "Frontend 60s guard fired; backend default LLM timeout is ~5min. Refresh later to see progress, or retry single-node.",
          retryable: true,
        };
        setSpecDocsError(timeoutError);
        showToast.error(
          locale === "zh-CN"
            ? "生成规格文档请求超时（后台可能仍在生成）"
            : "Spec document generation request timed out (backend may still be running)",
          { description: timeoutError.detail }
        );

        // 关键收敛：timeout 时把 live progress 标记为 finished + failed 节点，
        // 让 deriveNodeStatusById 的 !isBatchActive 守门生效，停止 spinner。
        // 使用语言无关的 machine marker，这样 isFrontendTimeoutFailed 能可靠识别，
        // 并且后端真实 "agent timeout" 等不会被误判为前端保护失败。
        useBlueprintRealtimeStore.getState().failSpecDocsProgress(FRONTEND_TIMEOUT_MARKER);

        // 不向真相源写入部分结果：不调用 onSpecDocumentsGenerated。
        return;
      }

      const result = raceResult;
      setSpecDocsGenerating(null);
      if (result.ok) {
        // Fallback: ensure the progress panel reaches "finished" state even
        // if Socket.IO dropped/coalesced batch_finished or per-node events.
        // Idempotent — no-op when batch already finished or panel idle.
        if (scope === "all") {
          useBlueprintRealtimeStore
            .getState()
            .completeSpecDocsProgress(Date.now() - startTime);
        }
        // R5.6：回写失败映射。onSpecDocumentsGenerated 把结果回写真相源
        // （setLatestJob 等）若抛错，视为生成失败：派生 failure + toast，
        // 且不在真相源留下部分写入（异常即终止，不做二次回写）。
        try {
          props.onSpecDocumentsGenerated?.(result.data);
        } catch (writebackError) {
          const detail =
            writebackError instanceof Error
              ? writebackError.message
              : String(writebackError);
          const mappedError: ApiRequestError = {
            kind: "error",
            source: "parse",
            endpoint: `/api/blueprint/jobs/${props.jobId}/spec-documents`,
            message:
              locale === "zh-CN"
                ? "生成规格文档回写失败"
                : "Failed to apply generated spec documents",
            detail:
              detail ||
              (locale === "zh-CN"
                ? "结果回写失败，请重试。"
                : "Writing back the generated result failed. Please retry."),
            retryable: true,
          };
          setSpecDocsError(mappedError);
          showToast.error(
            locale === "zh-CN"
              ? "生成规格文档回写失败"
              : "Failed to apply generated spec documents",
            { description: mappedError.detail }
          );
        }
      } else {
        setSpecDocsError(result.error);
        // autopilot-v4 fix：生成失败必须给用户即时反馈，否则按钮从"生成中…"
        // 翻回"生成"后页面看起来毫无反应（specDocsError 此前只入 state、从不渲染）。
        // 复用 rail 既有的 sonner toast 通道，与 replan 失败提示一致。
        showToast.error(
          locale === "zh-CN" ? "生成规格文档失败" : "Spec document generation failed",
          {
            description:
              result.error.detail ||
              result.error.message ||
              (locale === "zh-CN"
                ? "请检查 LLM 服务配置（LLM_BASE_URL / LLM_MODEL / LLM_API_KEY）后重试。"
                : "Check the LLM service config (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY) and retry."),
          }
        );
      }
    },
    [
      generateSpecDocuments,
      props.jobId,
      specDocsGenerating,
      props.onSpecDocumentsGenerated,
      locale,
    ]
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

  // spec-generation-perceived-performance Task 6.1：失败 → 重试入口。
  // 复用唯一的 triggerSpecDocsGeneration（同时承载 In_Flight_Lock /
  // specDocsGenerating、API 调用与 onSpecDocumentsGenerated 回写锚点）。
  // triggerSpecDocsGeneration 内部已 setSpecDocsError(null)，此处再清一次让
  // failure → pending 的交接显式且即时（同一渲染帧不残留旧 error）。
  const handleRetrySpecDocs = useCallback(
    (scope: "all" | "single", nodeId?: string) => {
      setSpecDocsError(null);
      void triggerSpecDocsGeneration(scope, nodeId);
    },
    [triggerSpecDocsGeneration]
  );

  // 非 fabric 阶段不渲染时间线
  const handleConfirmReplan = useCallback(async () => {
    if (!props.jobId || replanLoading) return;

    setReplanLoading(true);
    setReplanError(null);
    try {
      await replanFlow.confirmReplan({
        jobId: props.jobId,
        fromStage: currentGenerationStage,
        mode: replanMode,
        reason: replanReason.trim(),
        impact: replanImpact,
      });
      setReplanOpen(false);
    } catch (error) {
      setReplanError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplanLoading(false);
    }
  }, [
    currentGenerationStage,
    replanFlow,
    replanImpact,
    props.jobId,
    replanLoading,
    replanMode,
    replanReason,
  ]);

  const handleRegenerateStaleStage = useCallback(
    (stage: AutopilotLocalStage) => {
      if (stage === "spec_documents" || stage === "spec_tree") {
        handleGenerateAllSpecDocs();
        return;
      }
      props.onStageAdvanced?.();
    },
    [handleGenerateAllSpecDocs, props.onStageAdvanced],
  );

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
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        // 硬约束 aside 宽度。父级是 grid track minmax(0, 2fr)，正常情况下
        // 应该自然限制宽度，但右栏内部多层 flex / motion.div / overflow 嵌套
        // 容易把 min-content 推到内容总宽。inline width: 100% + maxWidth: 100%
        // 直接锁定 aside 不超过 grid track。
        // 注意：这里只锁宽度方向；垂直方向由外层 AutopilotWorkflowRail aside
        // 的 xl:overflow-y-auto 承担，本元素不能写 overflow: hidden（inline
        // overflow 会覆盖 class，导致超出视口的内容无法被外层 scroll 到）。
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      {/* fabric 阶段的 placeholder 保留(供测试断言) */}
      <div data-stage-placeholder="fabric" data-active="true" className="hidden" />

      <div
        className="mb-2 flex flex-shrink-0 flex-wrap items-center gap-2 px-1"
        data-testid="autopilot-right-rail-action-strip"
      >
        <ReplanButton
          viewingStage={currentGenerationStage}
          stageStatus={normalizeReplanStatus(props.job?.status)}
          jobStatus={normalizeReplanStatus(props.job?.status)}
          impact={replanImpact}
          isViewingCompletedStage={isReplanCompletedView}
          staticPreview={IS_GITHUB_PAGES}
          label={locale === "zh-CN" ? "从这里重新规划" : "Replan from here"}
          onOpen={() => setReplanOpen(true)}
        />
      </div>

      {replanError ? (
        <div
          className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800"
          data-testid="autopilot-replan-error"
          role="alert"
        >
          {replanError}
        </div>
      ) : null}

      <ReplanConfirmationModal
        open={replanOpen}
        mode={replanMode}
        reason={replanReason}
        loading={replanLoading}
        impact={replanImpact}
        onModeChange={setReplanMode}
        onReasonChange={setReplanReason}
        onConfirm={handleConfirmReplan}
        onCancel={() => setReplanOpen(false)}
      />

      <RightRailStaleIndicator
        artifact={staleArtifact}
        currentStage={currentLocalStage}
        locale={locale}
        status={{
          isRegenerating: specDocsGenerating !== null,
          isUpstreamRunning: props.job?.status === "running",
          runningStage: props.job?.stage,
        }}
        onRegenerate={handleRegenerateStaleStage}
      />

      {/* sliderule-3d-real-role-driven-scene-2026-05-29: the role status strip
          was removed from the right rail. Role identity / phase status is now
          carried by the real 3D agents (pet body + nameplate + bob animation),
          so a duplicate role chip strip here was redundant. */}

      {/* sliderule-spec-tree-progress-merge-2026-05-29：原 <SpecDocsProgressPanel/>
          浮层已删除，其每节点进度状态合并进 WorkbenchSpecTree 节点行
          （nodeStatusById 透传链），全局进度仍由 WorkbenchStatusBar 统计三联承载。
          store 的 specDocsProgress slice 与 dismiss/complete action 保留不变。 */}

      {/* 阶段独占视口 — 包一层 flex-1 min-h-0 让它占满 aside 剩余高度，
          避免大屏下 StageViewport 内容只占 content-height、底部出现白色空白带。 */}
      <div className="flex-1 min-h-0" style={{ minHeight: 0 }}>
        <StageTransitionWrapper
          stageKey={activeStageKey}
          direction={stageAnimatorDirection ?? transitionDirection}
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
              locale={locale}
              completedStages={stageProgress.completedStages}
              activeStage={stageProgress.activeStage}
              stageProgress={stageProgress.stageProgress}
              isIndeterminate={stageProgress.isIndeterminate}
              onNavigatePreviousStage={
                previousNavigationAction.type !== "none"
                  ? handleNavigatePreviousStage
                  : undefined
              }
              previousStageLabel={previousStageLabel}
              previousSubStage={previousSubStage}
              previousWorkbenchStage={previousWorkbenchStage}
              previousWorkflowStage={previousWorkflowStage}
              previousTargetKind={previousTargetKind}
              onNavigateNextStage={
                manualAdvanceAction.type !== "none"
                  ? handleStageAdvance
                  : undefined
              }
              nextStageLabel={
                locale === "zh-CN" ? "继续下一步" : "Continue to next step"
              }
              nextSubStage={
                manualAdvanceAction.type === "sub-stage"
                  ? manualAdvanceAction.nextSubStage
                  : manualAdvanceAction.type === "workbench-stage"
                    ? manualAdvanceAction.nextSubStage
                    : undefined
              }
              nextWorkbenchStage={
                manualAdvanceAction.type === "workbench-stage"
                  ? manualAdvanceAction.nextStage
                  : undefined
              }
              nextTargetKind={
                manualAdvanceAction.type === "none"
                  ? undefined
                  : manualAdvanceAction.type
              }
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
            ) : (
              // 2026-05-19：所有非回看分支不再渲染底部 StageCTA。
              // - autoAdvance 阶段（spec_documents）：流式状态由 StreamingDocRenderer
              //   头部"生成中"指示器承载，底部白色提示条挤压主区高度。
              // - spec_tree 等其它阶段：CTA 已经由 SpecTreeWorkbench 顶部双 CTA
              //   （"生成整棵树文档" / "生成当前节点文档"）承担，底部再放
              //   "生成文档"按钮属于功能重复且分割视觉。
              manualAdvanceAction.type !== "none" ? (
                <StageCTA
                  label={
                    manualAdvanceAction.type === "sub-stage"
                      ? locale === "zh-CN"
                        ? "继续下一步"
                        : "Continue"
                      : currentStageConfig.ctaLabel
                  }
                  loading={false}
                  disabled={false}
                  onAction={handleStageAdvance}
                  testId="autopilot-stage-continue-button"
                />
              ) : null
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
          {/* spec_tree 与 spec_documents 合并为同一界面：
              左侧节点导航 + 右侧文档渲染，由 StreamingDocRenderer 统一承载。 */}
          {activeStageKey === "spec_tree" ||
          activeStageKey === "spec_documents" ? (
            <div
              data-sub-stage-placeholder={activeSubStage ?? ""}
              data-timeline-status="active"
              aria-current="step"
              className="h-full min-h-0"
            >
              <StreamingDocRenderer
                entries={reasoningEntries}
                specDocuments={persistedSpecDocuments}
                specTree={props.specTree}
                nodeStatusById={nodeStatusById}
                locale={locale}
                onGenerateAll={handleGenerateAllSpecDocs}
                onGenerateNode={handleGenerateNodeSpecDocs}
                generating={specDocsGenerating}
                jobId={props.jobId}
                job={props.job}
                onEnterEffectPreview={
                  canEnterEffectPreviewFromCurrentStage &&
                  (persistedSpecDocuments?.length ?? 0) > 0
                    ? handleEnterEffectPreview
                    : undefined
                }
                effectPreviewState={effectPreviewState}
                effectPreviewDisabled={
                  !canEnterEffectPreviewFromCurrentStage ||
                  !props.jobId ||
                  (persistedSpecDocuments?.length ?? 0) === 0
                }
              />
            </div>
          ) : currentStage === "fabric" && activeSubStage !== undefined ? (
            <div
              data-sub-stage-placeholder={activeSubStage}
              data-timeline-status="active"
              aria-current="step"
            >
              {renderFabricSubStageContent(activeSubStage, props)}
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
                  specTree={props.specTree}
                  job={props.job}
                  jobId={props.jobId}
                  generating={specDocsGenerating}
                  onGenerateAll={handleGenerateAllSpecDocs}
                  onGenerateNode={handleGenerateNodeSpecDocs}
                  generationError={specDocsError}
                  onRetry={handleRetrySpecDocs}
                />
              </div>
            )
          )}
        </StageViewport>
      </StageTransitionWrapper>
      </div>

      {showFabricObservability ? (
        <>
          {/* autopilot-streaming-experience integration-gap-2026-05-16 UI 消费面 Step 2：能力调用条 */}
          <CapabilityRail />

          {/* autopilot-streaming-experience integration-gap-2026-05-16 UI 消费面 Step 3：激活日志 */}
          <FleetActivationLog />
        </>
      ) : null}

      {/* autopilot-v4-frontend-alignment 任务 53：跨阶段「信任层」section
          （校验台账 / 可追溯矩阵 / 伴随发现）。非线性 sub-stage，不改
          resolve-rail-sub-stage 契约；可用性 gating + CardErrorBoundary 由
          TrustSection 内部承载（design.md §9）。 */}
      {props.jobId && showTrustSection ? (
        <TrustSection
          jobId={props.jobId}
          job={props.job as unknown as CompanionFindingsSource | null}
          locale={locale}
          hasSpecTree={
            ((props.specTree?.nodes?.length ?? 0) > 0) ||
            isAtOrBeyondSpecDocuments(props.job?.stage) ||
            props.job?.stage === "spec_tree"
          }
          hasSpecDocs={
            isAtOrBeyondSpecDocuments(props.job?.stage) ||
            (persistedSpecDocuments?.length ?? 0) > 0
          }
        />
      ) : null}

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
