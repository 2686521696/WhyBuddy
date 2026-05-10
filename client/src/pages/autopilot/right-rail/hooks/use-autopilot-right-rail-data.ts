/**
 * Autopilot 驾驶舱右栏数据层 Hook — Canonical implementation
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-data-hook/`
 * - Requirement 1（Hook API 形状与契约）
 * - Requirement 9.3（barrel re-export）
 * - Requirement 12.7（文件位置与范围约束）
 *
 * Spec 4 Task 1 — 骨架 + 类型定义 + 占位实现。
 *
 * 本 Task 的硬边界：
 * - 只定义类型与 `useAutopilotRightRailData` 签名（与 `design.md` 一字不差）。
 * - 占位实现：从 `options.initialData` 直接派生只读 view；所有字段 `loading=false`、
 *   `error=null`、`retry` 为稳定 no-op。不发起任何 fetch、不订阅 SSE、不启动 polling。
 * - Wave 1-4 的真实 fetch 编排、reducer、AbortController、SSE、polling、cache 复用策略
 *   等由后续 Task 2-7 逐步落地；Task 1 不提供。
 *
 * 硬性约束（贯穿本 spec 全部任务）：
 * - 不订阅 `useAppStore` / `useProjectStore`；不写入全局 store。
 * - 不读写 `localStorage` / `sessionStorage`。
 * - 不抛异常到 React render path；所有 async 异常转为 `ApiRequestError` 存入 field status。
 * - 不新增后端契约。
 */

import { useCallback, useMemo } from "react";

import type { ApiRequestError } from "@/lib/api-client";
import type {
  BlueprintAgentCrewSnapshot,
  BlueprintArtifactFeedback,
  BlueprintArtifactLedgerEntry,
  BlueprintArtifactReplay,
  BlueprintEffectPreviewSnapshot,
  BlueprintEngineeringLandingPlan,
  BlueprintEngineeringRun,
  BlueprintPromptPackage,
} from "@/lib/blueprint-api";
import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import type { AutopilotRailSubStage } from "../types";

// ---------------------------------------------------------------------------
// Public types（与 design.md「完整 TypeScript 类型定义」一字不差）
// ---------------------------------------------------------------------------

/**
 * 单字段状态。
 *
 * 所有 15 个数据字段都通过同一套 `RightRailDataFieldStatus<T>` 形状暴露，便于消费者统一消费：
 * - `data`: 最近一次成功拉取或 `initialData` 提供的值；fetch 失败时保留上一次成功值。
 * - `loading`: 当前是否正在拉取（refetch 期间 `data` 不清空）。
 * - `error`: 最近一次 fetch 失败的 `ApiRequestError`；成功后清零。
 * - `retry`: 稳定引用的 no-op safe 函数；受懒加载规则约束（Task 7 实现）。
 */
export interface RightRailDataFieldStatus<T> {
  data: T | null;
  loading: boolean;
  error: ApiRequestError | null;
  retry: () => void;
}

/**
 * Hook 返回值。
 *
 * 15 个字段按 4 个 Wave 组织（详见 `design.md` 懒加载规则表）：
 * - Wave 1（顶层，始终加载）: `job / routeSet / selection / specTree`
 * - Wave 2（fabric 基础）: `agentCrew / capabilities / capabilityInvocations / capabilityEvidence`
 * - Wave 3（fabric 中层）: `effectPreviews / promptPackages / landingPlans / engineeringRuns`
 * - Wave 4（artifact）: `artifactEntries / artifactReplays / artifactFeedback`
 *
 * Wave 1 中 `routeSet / selection / specTree` 从 Wave 1 `job` 响应派生，不发起独立 fetch；
 * Wave 2 `agentCrew` 同样从 `job.agentCrew` 派生。详见 Task 2 实现。
 */
export interface RightRailDataView {
  // Wave 1：顶层（始终加载）
  job: RightRailDataFieldStatus<BlueprintGenerationJob>;
  routeSet: RightRailDataFieldStatus<BlueprintRouteSet>;
  selection: RightRailDataFieldStatus<BlueprintRouteSelection>;
  specTree: RightRailDataFieldStatus<BlueprintSpecTree>;

  // Wave 2：fabric 基础
  agentCrew: RightRailDataFieldStatus<BlueprintAgentCrewSnapshot>;
  capabilities: RightRailDataFieldStatus<BlueprintRuntimeCapability[]>;
  capabilityInvocations: RightRailDataFieldStatus<BlueprintCapabilityInvocation[]>;
  capabilityEvidence: RightRailDataFieldStatus<BlueprintCapabilityEvidence[]>;

  // Wave 3：fabric 中层
  effectPreviews: RightRailDataFieldStatus<BlueprintEffectPreviewSnapshot[]>;
  promptPackages: RightRailDataFieldStatus<BlueprintPromptPackage[]>;
  landingPlans: RightRailDataFieldStatus<BlueprintEngineeringLandingPlan[]>;
  engineeringRuns: RightRailDataFieldStatus<BlueprintEngineeringRun[]>;

  // Wave 4：artifact
  artifactEntries: RightRailDataFieldStatus<BlueprintArtifactLedgerEntry[]>;
  artifactReplays: RightRailDataFieldStatus<BlueprintArtifactReplay[]>;
  artifactFeedback: RightRailDataFieldStatus<BlueprintArtifactFeedback[]>;
}

/**
 * Hook options。
 *
 * 所有字段均为可选；见 `design.md` 的逐项语义说明。
 */
export interface UseAutopilotRightRailDataOptions {
  /**
   * 初始 / 回退数据。来源：
   * - `AutopilotRoutePage`：现有 `useState<BlueprintGenerationJob>` 等 state。
   * - `BlueprintProgressPanel`：旧 `initial*` props 的映射。
   *
   * 注：当 `initialData.job` 已提供时，Task 2 的 W1 `fetchLatestBlueprintGenerationJob` 会跳过
   * 首次拉取，直接 seed cache（avoid N+1 fetch when parent already owns job state）。
   */
  initialData?: Partial<{
    job: BlueprintGenerationJob | null;
    routeSet: BlueprintRouteSet | null;
    selection: BlueprintRouteSelection | null;
    specTree: BlueprintSpecTree | null;
    agentCrew: BlueprintAgentCrewSnapshot | null;
    capabilities: BlueprintRuntimeCapability[];
    capabilityInvocations: BlueprintCapabilityInvocation[];
    capabilityEvidence: BlueprintCapabilityEvidence[];
    effectPreviews: BlueprintEffectPreviewSnapshot[];
    promptPackages: BlueprintPromptPackage[];
    landingPlans: BlueprintEngineeringLandingPlan[];
    engineeringRuns: BlueprintEngineeringRun[];
    artifactEntries: BlueprintArtifactLedgerEntry[];
    artifactReplays: BlueprintArtifactReplay[];
    artifactFeedback: BlueprintArtifactFeedback[];
  }>;

  /**
   * 当前 fabric 子阶段；驱动 Wave 2-4 懒加载 gate。
   * 若未提供，hook 内部用 `resolveRailSubStage()` 兜底（Task 3-5 实现）。
   */
  currentSubStage?: AutopilotRailSubStage;

  /**
   * true 时跳过懒加载门限，Wave 1-4 全量发起。
   * 供 `/specs` 路径的 `BlueprintProgressPanel.autoLoad === true` 兼容场景使用。
   */
  skipLazyLoad?: boolean;

  /**
   * SSE 不可用或显式禁用时的 polling 间隔。
   * - `undefined`: 默认 15000ms；
   * - `0` 或负数：禁用 SSE + polling（测试或手动触发场景）。
   */
  pollingIntervalMs?: number;

  /**
   * 由 SSE 或 polling 检测到 `job.stage` 变化时的回调。
   */
  onJobStageChange?: (
    next: BlueprintGenerationJob["stage"],
    prev: BlueprintGenerationJob["stage"] | null
  ) => void;

  /**
   * 任一字段 fetch 失败时的统一回调。
   * 消费者可据此打点、上报或显示全局错误条。
   */
  onFieldError?: (
    field: keyof RightRailDataView,
    error: ApiRequestError
  ) => void;

  /**
   * Per-field 写回回调。
   * Phase A 中 `BlueprintProgressPanel` 通过这些回调把 hook 最新值桥接回旧 `on*Change` props。
   */
  onJobChange?: (next: BlueprintGenerationJob | null) => void;
  onRouteSetChange?: (next: BlueprintRouteSet | null) => void;
  onSelectionChange?: (next: BlueprintRouteSelection | null) => void;
  onSpecTreeChange?: (next: BlueprintSpecTree | null) => void;
  onAgentCrewChange?: (next: BlueprintAgentCrewSnapshot | null) => void;
  onCapabilitiesChange?: (next: BlueprintRuntimeCapability[]) => void;
  onCapabilityInvocationsChange?: (next: BlueprintCapabilityInvocation[]) => void;
  onCapabilityEvidenceChange?: (next: BlueprintCapabilityEvidence[]) => void;
  onEffectPreviewsChange?: (next: BlueprintEffectPreviewSnapshot[]) => void;
  onPromptPackagesChange?: (next: BlueprintPromptPackage[]) => void;
  onLandingPlansChange?: (next: BlueprintEngineeringLandingPlan[]) => void;
  onEngineeringRunsChange?: (next: BlueprintEngineeringRun[]) => void;
  onArtifactEntriesChange?: (next: BlueprintArtifactLedgerEntry[]) => void;
  onArtifactReplaysChange?: (next: BlueprintArtifactReplay[]) => void;
  onArtifactFeedbackChange?: (next: BlueprintArtifactFeedback[]) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * 构造空字段 status：用于 Task 1 占位实现（Task 2-7 真实实现时逐步替换）。
 */
function buildIdleStatus<T>(
  initialData: T | null | undefined,
  retry: () => void
): RightRailDataFieldStatus<T> {
  return {
    data: initialData ?? null,
    loading: false,
    error: null,
    retry,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Autopilot 右栏数据层 hook。
 *
 * Task 1 占位实现：返回由 `options.initialData` 派生的只读 view。后续 Task 2-7 会把这里
 * 替换为带 reducer、Wave 分层 fetch、AbortController、SSE、polling 的完整实现。
 *
 * 外部契约（spec Requirement 1）：
 * - 签名固定：`(jobId: string, options?: UseAutopilotRightRailDataOptions) => RightRailDataView`。
 * - `jobId` 为空字符串或空白时，不发起任何 fetch（Task 1 本就不发 fetch，Task 2+ 维持此不变式）。
 * - `retry` 是稳定引用（仅在 `jobId` 变化时重建）。
 * - 不抛异常到 render path。
 * - 不订阅 `useAppStore` / `useProjectStore`。
 */
export function useAutopilotRightRailData(
  jobId: string,
  options?: UseAutopilotRightRailDataOptions
): RightRailDataView {
  const initialData = options?.initialData;

  // Task 1 占位：retry 是 no-op。Task 7 会接入真实 retry 逻辑并保持 jobId 级稳定引用。
  // 此处使用 `jobId` 作为依赖保证未来 Task 7 的契约兼容：`retry` 仅在 `jobId` 变化时重建。
  const noopRetry = useCallback(() => {
    /* Task 7 会替换为 targeted refetch */
  }, [jobId]);

  return useMemo<RightRailDataView>(
    () => ({
      job: buildIdleStatus(initialData?.job ?? null, noopRetry),
      routeSet: buildIdleStatus(initialData?.routeSet ?? null, noopRetry),
      selection: buildIdleStatus(initialData?.selection ?? null, noopRetry),
      specTree: buildIdleStatus(initialData?.specTree ?? null, noopRetry),
      agentCrew: buildIdleStatus(initialData?.agentCrew ?? null, noopRetry),
      capabilities: buildIdleStatus(
        initialData?.capabilities ?? null,
        noopRetry
      ),
      capabilityInvocations: buildIdleStatus(
        initialData?.capabilityInvocations ?? null,
        noopRetry
      ),
      capabilityEvidence: buildIdleStatus(
        initialData?.capabilityEvidence ?? null,
        noopRetry
      ),
      effectPreviews: buildIdleStatus(
        initialData?.effectPreviews ?? null,
        noopRetry
      ),
      promptPackages: buildIdleStatus(
        initialData?.promptPackages ?? null,
        noopRetry
      ),
      landingPlans: buildIdleStatus(
        initialData?.landingPlans ?? null,
        noopRetry
      ),
      engineeringRuns: buildIdleStatus(
        initialData?.engineeringRuns ?? null,
        noopRetry
      ),
      artifactEntries: buildIdleStatus(
        initialData?.artifactEntries ?? null,
        noopRetry
      ),
      artifactReplays: buildIdleStatus(
        initialData?.artifactReplays ?? null,
        noopRetry
      ),
      artifactFeedback: buildIdleStatus(
        initialData?.artifactFeedback ?? null,
        noopRetry
      ),
    }),
    [initialData, noopRetry]
  );
}
