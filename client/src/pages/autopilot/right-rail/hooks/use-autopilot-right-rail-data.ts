/**
 * Autopilot 驾驶舱右栏数据层 Hook — Canonical implementation
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-data-hook/`
 * - Requirement 1（Hook API 形状与契约）
 * - Requirement 2（fetch 合并与错误隔离）
 * - Requirement 4（Cache 与 jobId / stage 变化的 refetch 策略）
 * - Requirement 8（错误处理、重试与 stale 保护）
 * - Requirement 9.3（barrel re-export）
 * - Requirement 12.7（文件位置与范围约束）
 *
 * Spec 4 Task 1 — 类型定义 + barrel。
 * Spec 4 Task 2 — Wave 1 fetch（`job + routeSet + selection + specTree`）+ reducer +
 *                 per-jobId cache + AbortController + Ignore_Stale_Policy 基础设施。
 * Spec 4 Task 3 — Wave 2 fetch（`agentCrew + capabilities + capabilityInvocations +
 *                 capabilityEvidence`）+ 懒加载 gate + registry-first 合并 + W2 cache seed。
 * Spec 4 Task 4 — Wave 3 fetch（`effectPreviews + promptPackages + landingPlans +
 *                 engineeringRuns`）+ 按子阶段 / job.stage 懒加载阈值 + W3 cache seed。
 * Spec 4 Task 5 — Wave 4 fetch（`artifactEntries + artifactReplays`）+ `artifactFeedback`
 *                 派生（来自 W1 job.artifacts 中 `type === "feedback"` 的 payload，不新增
 *                 后端调用）+ 按 `currentSubStage === "artifact_memory"` 或
 *                 `job.stage === "engineering_landing"` 懒加载阈值 + W4 cache seed。
 *
 * 本文件目前包含的硬边界：
 * - Wave 1：`fetchLatestBlueprintGenerationJob()`；当 `initialData.job.id === jobId` 时跳过
 *   首次 fetch（Requirement 6.1）；`routeSet / selection / specTree` 从 Wave 1 快照派生。
 * - Wave 2：通过 `shouldLoadField` 懒加载 gate 触发 `Promise.allSettled` 合并 4 个 fetch（registry
 *   + job capabilities + invocations + evidence）。`agentCrew` 从 job snapshot / initialData
 *   派生，不进入 FETCH_STARTED 流程（Task 3 口径：gate 未打开时暴露 `initialData.agentCrew ?? null`）。
 * - Wave 3：通过 `shouldLoadField` 按 `currentSubStage` / `job.stage` 双维度判定 4 个字段的懒加载
 *   阈值，`Promise.allSettled` 并发拉取 `fetchBlueprintEffectPreviews / PromptPackages /
 *   EngineeringLanding / EngineeringRuns`；单字段失败不阻塞其余字段，并按字段写入 W3 cache。
 * - Wave 4：通过 `shouldLoadField` 按 `currentSubStage === "artifact_memory"` 或
 *   `job.stage === "engineering_landing"` 判定 3 个字段的懒加载阈值，`Promise.allSettled` 并发
 *   拉取 `fetchBlueprintArtifactLedger / fetchBlueprintArtifactReplays`；`artifactFeedback`
 *   作为派生字段不发起独立 fetch，其值来自 `state.job.data?.artifacts` 中 `type === "feedback"`
 *   的 payload（与服务器 `extractArtifactFeedback` 一致，Requirement 12.5）。
 * - SSE / polling / 指数退避由 Task 6 实现；当前版本不启动任何 `EventSource` 或 `setTimeout`。
 * - `retry` 当前覆盖 W1-W4 全部 15 个字段：W1 4 个字段共享 `retryWave1`（含 `agentCrew` 派生
 *   与 `artifactFeedback` 派生）；W2 除 `agentCrew` 外 3 个字段共享 `retryWave2`；W3 4 个字段
 *   共享 `retryWave3`；W4 `artifactEntries / artifactReplays` 共享 `retryWave4`，
 *   `artifactFeedback` 由于是 W1 派生，`retry` 复用 `retryWave1`。Per-field retry 的
 *   in-flight guard 由 Task 7 接入。
 *
 * 硬性约束（贯穿本 spec 全部任务）：
 * - 不订阅 `useAppStore` / `useProjectStore`；不写入全局 store。
 * - 不读写 `localStorage` / `sessionStorage`。
 * - 不抛异常到 React render path；所有 async 异常转为 `ApiRequestError` 存入 field status。
 * - 不新增后端契约。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { ApiRequestError } from "@/lib/api-client";
import {
  fetchBlueprintArtifactLedger,
  fetchBlueprintArtifactReplays,
  fetchBlueprintCapabilities,
  fetchBlueprintCapabilityEvidence,
  fetchBlueprintCapabilityInvocations,
  fetchBlueprintEffectPreviews,
  fetchBlueprintEngineeringLanding,
  fetchBlueprintEngineeringRuns,
  fetchBlueprintJobCapabilities,
  fetchBlueprintJobEventStreamUrl,
  fetchBlueprintPromptPackages,
  fetchLatestBlueprintGenerationJob,
  normalizeBlueprintAgentCrew,
  type BlueprintAgentCrewSnapshot,
  type BlueprintArtifactFeedback,
  type BlueprintArtifactLedgerEntry,
  type BlueprintArtifactReplay,
  type BlueprintEffectPreviewSnapshot,
  type BlueprintEngineeringLandingPlan,
  type BlueprintEngineeringRun,
  type BlueprintLatestGenerationJobSnapshot,
  type BlueprintPromptPackage,
} from "@/lib/blueprint-api";
import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintGenerationArtifactType,
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
  BlueprintSpecDocument,
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
 * - `retry`: 稳定引用的函数；仅在 `jobId` 变化时重建。受懒加载规则约束（Task 7 实现）。
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
 * Wave 1 中 `routeSet / selection / specTree` 从 Wave 1 `job` 响应的 snapshot 派生，不发起独立
 * fetch。同一个 W1 `fetchLatestBlueprintGenerationJob()` 响应会同时 seed 这 4 个字段。
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
   * 注：当 `initialData.job.id === jobId` 时，Task 2 的 W1 `fetchLatestBlueprintGenerationJob`
   * 会跳过首次拉取（Requirement 6.1，avoid N+1 fetch when parent already owns job state）。
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
// Internal types (reducer state + actions + per-jobId cache)
// ---------------------------------------------------------------------------

/**
 * 15 个数据字段的名称联合体（`RightRailDataView` 的 `keyof`）。
 */
type RightRailFieldName = keyof RightRailDataView;

/**
 * reducer 内部的单字段状态：比公开 `RightRailDataFieldStatus<T>` 多一个
 * `pendingRequestId` 字段用于 Ignore_Stale_Policy（`FETCH_FULFILLED` / `FETCH_REJECTED`
 * 时若 request id 不匹配则早退）。
 */
interface InternalFieldState<T> {
  data: T | null;
  loading: boolean;
  error: ApiRequestError | null;
  pendingRequestId: number | null;
}

/**
 * reducer 状态：per-field internal state + 当前 jobId。
 *
 * 注：`currentJobId` 是 reducer 的一部分而非 ref，以便 action 可以比较 `action.jobId` 与
 * `state.currentJobId` 并忽略 stale（`jobId` 变化后仍 resolve 的老请求）。
 */
interface ReducerState {
  currentJobId: string;
  // Wave 1
  job: InternalFieldState<BlueprintGenerationJob>;
  routeSet: InternalFieldState<BlueprintRouteSet>;
  selection: InternalFieldState<BlueprintRouteSelection>;
  specTree: InternalFieldState<BlueprintSpecTree>;
  // Wave 2
  agentCrew: InternalFieldState<BlueprintAgentCrewSnapshot>;
  capabilities: InternalFieldState<BlueprintRuntimeCapability[]>;
  capabilityInvocations: InternalFieldState<BlueprintCapabilityInvocation[]>;
  capabilityEvidence: InternalFieldState<BlueprintCapabilityEvidence[]>;
  // Wave 3
  effectPreviews: InternalFieldState<BlueprintEffectPreviewSnapshot[]>;
  promptPackages: InternalFieldState<BlueprintPromptPackage[]>;
  landingPlans: InternalFieldState<BlueprintEngineeringLandingPlan[]>;
  engineeringRuns: InternalFieldState<BlueprintEngineeringRun[]>;
  // Wave 4
  artifactEntries: InternalFieldState<BlueprintArtifactLedgerEntry[]>;
  artifactReplays: InternalFieldState<BlueprintArtifactReplay[]>;
  artifactFeedback: InternalFieldState<BlueprintArtifactFeedback[]>;
}

/**
 * reducer action 联合体。Task 2 仅实现 `JOB_CHANGED` / `FETCH_STARTED` / `FETCH_FULFILLED` /
 * `FETCH_REJECTED` 四个核心 action。Task 3-7 会扩展更多 action（如 `JOB_STAGE_SSE` 等）。
 */
type ReducerAction =
  | {
      type: "JOB_CHANGED";
      jobId: string;
      initialData: UseAutopilotRightRailDataOptions["initialData"];
      cachedFields: PartialCacheEntry | null;
    }
  | {
      type: "FETCH_STARTED";
      jobId: string;
      fields: readonly RightRailFieldName[];
      requestId: number;
    }
  | {
      type: "FETCH_FULFILLED";
      jobId: string;
      requestId: number;
      fieldUpdates: PartialFieldDataMap;
    }
  | {
      type: "FETCH_REJECTED";
      jobId: string;
      requestId: number;
      fields: readonly RightRailFieldName[];
      error: ApiRequestError;
    };

/**
 * 部分字段 → data 的 map，用于 `FETCH_FULFILLED` 批量应用多个字段（W1 一次 fetch 会填充 4 个字段）。
 * 使用 `any` 是因为各字段的 payload 类型不同；reducer 在应用时会按 key 逐一写入，运行期安全。
 */
type PartialFieldDataMap = Partial<
  Record<RightRailFieldName, unknown>
>;

/**
 * per-jobId cache 条目（存放在 `useRef<Map>` 中，跨 `JOB_CHANGED` 切换复用）。
 * 只记录每个字段的最后一次成功 `data`，不记录 error / loading。
 */
type PartialCacheEntry = Partial<Record<RightRailFieldName, unknown>>;

// ---------------------------------------------------------------------------
// Reducer + helpers
// ---------------------------------------------------------------------------

const ALL_FIELD_NAMES: readonly RightRailFieldName[] = [
  "job",
  "routeSet",
  "selection",
  "specTree",
  "agentCrew",
  "capabilities",
  "capabilityInvocations",
  "capabilityEvidence",
  "effectPreviews",
  "promptPackages",
  "landingPlans",
  "engineeringRuns",
  "artifactEntries",
  "artifactReplays",
  "artifactFeedback",
] as const;

function makeIdleField<T>(data: T | null): InternalFieldState<T> {
  return { data, loading: false, error: null, pendingRequestId: null };
}

/**
 * 从 `initialData` + optional `cachedFields` 构造 reducer 初始状态。
 * `cachedFields` 优先级高于 `initialData`（切回历史 `jobId` 时按 Requirement 4.3 复用 cache）。
 */
function buildInitialReducerState(
  jobId: string,
  initialData: UseAutopilotRightRailDataOptions["initialData"],
  cachedFields: PartialCacheEntry | null
): ReducerState {
  const init = <K extends RightRailFieldName, T>(
    field: K,
    initialValue: T | null | undefined
  ): InternalFieldState<T> => {
    if (cachedFields && field in cachedFields) {
      return makeIdleField<T>((cachedFields[field] as T | null) ?? null);
    }
    return makeIdleField<T>(initialValue ?? null);
  };

  return {
    currentJobId: jobId,
    job: init("job", initialData?.job),
    routeSet: init("routeSet", initialData?.routeSet),
    selection: init("selection", initialData?.selection),
    specTree: init("specTree", initialData?.specTree),
    agentCrew: init("agentCrew", initialData?.agentCrew),
    capabilities: init("capabilities", initialData?.capabilities),
    capabilityInvocations: init(
      "capabilityInvocations",
      initialData?.capabilityInvocations
    ),
    capabilityEvidence: init(
      "capabilityEvidence",
      initialData?.capabilityEvidence
    ),
    effectPreviews: init("effectPreviews", initialData?.effectPreviews),
    promptPackages: init("promptPackages", initialData?.promptPackages),
    landingPlans: init("landingPlans", initialData?.landingPlans),
    engineeringRuns: init("engineeringRuns", initialData?.engineeringRuns),
    artifactEntries: init("artifactEntries", initialData?.artifactEntries),
    artifactReplays: init("artifactReplays", initialData?.artifactReplays),
    artifactFeedback: init("artifactFeedback", initialData?.artifactFeedback),
  };
}

/**
 * Pure reducer。所有状态转换规则集中在这里；便于单元测试。
 *
 * Ignore_Stale_Policy 的两道护栏：
 *   1. `action.jobId !== state.currentJobId` → 立即 early return（跨 `jobId` 的 stale 响应）。
 *   2. 字段的 `pendingRequestId !== action.requestId` → 忽略该字段的 update（同 `jobId` 下更早
 *      一次 in-flight 请求的 late resolve）。
 */
export function rightRailDataReducer(
  state: ReducerState,
  action: ReducerAction
): ReducerState {
  switch (action.type) {
    case "JOB_CHANGED": {
      return buildInitialReducerState(
        action.jobId,
        action.initialData,
        action.cachedFields
      );
    }
    case "FETCH_STARTED": {
      if (action.jobId !== state.currentJobId) return state;
      const next = { ...state } as ReducerState;
      for (const field of action.fields) {
        const prev = state[field] as InternalFieldState<unknown>;
        (next[field] as InternalFieldState<unknown>) = {
          ...prev,
          loading: true,
          pendingRequestId: action.requestId,
        };
      }
      return next;
    }
    case "FETCH_FULFILLED": {
      if (action.jobId !== state.currentJobId) return state;
      const next = { ...state } as ReducerState;
      let changed = false;
      for (const key of Object.keys(action.fieldUpdates) as RightRailFieldName[]) {
        const prev = state[key] as InternalFieldState<unknown>;
        if (prev.pendingRequestId !== action.requestId) continue; // ignore stale
        (next[key] as InternalFieldState<unknown>) = {
          data: action.fieldUpdates[key] as unknown ?? null,
          loading: false,
          error: null,
          pendingRequestId: null,
        };
        changed = true;
      }
      return changed ? next : state;
    }
    case "FETCH_REJECTED": {
      if (action.jobId !== state.currentJobId) return state;
      const next = { ...state } as ReducerState;
      let changed = false;
      for (const field of action.fields) {
        const prev = state[field] as InternalFieldState<unknown>;
        if (prev.pendingRequestId !== action.requestId) continue; // ignore stale
        (next[field] as InternalFieldState<unknown>) = {
          data: prev.data, // 保留 previousCache
          loading: false,
          error: action.error,
          pendingRequestId: null,
        };
        changed = true;
      }
      return changed ? next : state;
    }
    default:
      return state;
  }
}

/**
 * 从 `BlueprintLatestGenerationJobSnapshot` 响应派生 W1 4 个字段的 data map。
 * `routeSet / selection / specTree` 不是独立 fetch 结果，而是与 `job` 同一次响应的 sibling 字段。
 */
function deriveWave1FieldUpdates(
  snapshot: BlueprintLatestGenerationJobSnapshot
): PartialFieldDataMap {
  const specTree =
    snapshot.specTree && Array.isArray(snapshot.specDocuments)
      ? ({
          ...snapshot.specTree,
          documents: snapshot.specDocuments as BlueprintSpecDocument[],
        } as BlueprintSpecTree)
      : (snapshot.specTree ?? null);

  return {
    job: snapshot.job ?? null,
    routeSet: snapshot.routeSet ?? null,
    selection: snapshot.selection ?? null,
    specTree,
  };
}

const WAVE_1_FIELDS: readonly RightRailFieldName[] = [
  "job",
  "routeSet",
  "selection",
  "specTree",
] as const;

const WAVE_2_FETCH_FIELDS: readonly RightRailFieldName[] = [
  "capabilities",
  "capabilityInvocations",
  "capabilityEvidence",
] as const;

/**
 * Wave 3 fetch 字段集合（顺序固定，便于 PBT 与测试断言）。
 *
 * 4 个字段各自通过独立 REST 入口拉取，无跨字段合并：
 * - `effectPreviews`       → `fetchBlueprintEffectPreviews(jobId)`
 * - `promptPackages`       → `fetchBlueprintPromptPackages(jobId)`
 * - `landingPlans`         → `fetchBlueprintEngineeringLanding(jobId)`
 * - `engineeringRuns`      → `fetchBlueprintEngineeringRuns(jobId)`
 *
 * 懒加载阈值见 `shouldLoadField`；每个字段独立判定。
 */
const WAVE_3_FETCH_FIELDS: readonly RightRailFieldName[] = [
  "effectPreviews",
  "promptPackages",
  "landingPlans",
  "engineeringRuns",
] as const;

/**
 * Wave 4 fetch 字段集合（顺序固定，便于测试断言）。
 *
 * 本常量只包含真正发起独立 HTTP 请求的字段：
 * - `artifactEntries`  → `fetchBlueprintArtifactLedger(jobId)`
 * - `artifactReplays`  → `fetchBlueprintArtifactReplays(jobId)`
 *
 * 注意：`artifactFeedback` 是派生字段（值来自 `state.job.data?.artifacts` 中 `type === "feedback"`
 * 的 payload，与服务器 `extractArtifactFeedback` 语义一致），**不**发起独立 fetch，因此不进入
 * 本常量。懒加载 gate 打开 `artifactEntries / artifactReplays` 时，`artifactFeedback` 的可见性
 * 也会随之就绪（通过 view 映射时从 job snapshot 派生）。Requirement 12.5：不新增后端调用。
 */
const WAVE_4_FETCH_FIELDS: readonly RightRailFieldName[] = [
  "artifactEntries",
  "artifactReplays",
] as const;

// ---------------------------------------------------------------------------
// Wave 3 lazy-loading stage sets
//
// Wave 3 的懒加载阈值同时以 `currentSubStage`（fabric 子阶段）与 `job.stage`（顶层生成阶段）
// 两个维度判定，只要任一维度进入字段对应的门限集合，就触发该字段的 fetch。set 的取值参考
// `design.md` 的「懒加载规则实现」并与 `BlueprintGenerationStage` 联合体一一对应（非法字面量
// 在 TS 编译期即会报错，不会出现 cast）。
// ---------------------------------------------------------------------------

/**
 * `job.stage` 打开 `effectPreviews` 阈值的集合：`preview` 或更深阶段。
 */
const STAGES_ALLOWING_EFFECT_PREVIEWS: ReadonlySet<
  BlueprintGenerationJob["stage"]
> = new Set<BlueprintGenerationJob["stage"]>([
  "preview",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
]);

/**
 * `job.stage` 打开 `promptPackages` 阈值的集合：`prompt_packaging` 或更深阶段。
 */
const STAGES_ALLOWING_PROMPT_PACKAGES: ReadonlySet<
  BlueprintGenerationJob["stage"]
> = new Set<BlueprintGenerationJob["stage"]>([
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
]);

/**
 * `job.stage` 打开 `landingPlans` 与 `engineeringRuns` 阈值的集合：`engineering_handoff`
 * 或 `engineering_landing`。
 */
const STAGES_ALLOWING_ENGINEERING: ReadonlySet<
  BlueprintGenerationJob["stage"]
> = new Set<BlueprintGenerationJob["stage"]>([
  "engineering_handoff",
  "engineering_landing",
]);

// ---------------------------------------------------------------------------
// Wave 2 helpers: agentCrew derivation + capabilities registry-first merge +
// shouldLoadField 懒加载 gate。
//
// 这些 helper 的语义与 `AutopilotRoutePage.tsx` / `BlueprintProgressPanel.tsx` /
// `RuntimeCapabilityPanel.tsx` 现有规则保持一致（复用 `normalizeBlueprintAgentCrew`，
// 合并规则沿用 panel 的「job 列表非空时优先，否则回退 registry」）。任何 DOM parity 回归
// 都应先检查这组 helper 与现有代码的语义对齐。
// ---------------------------------------------------------------------------

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readJobArtifactPayloads(
  job: BlueprintGenerationJob | null,
  type: BlueprintGenerationArtifactType
): unknown[] {
  if (!job) return [];
  return job.artifacts
    .filter(artifact => artifact.type === type)
    .map(artifact => artifact.payload);
}

/**
 * 从 job artifacts 派生 `BlueprintAgentCrewSnapshot`。
 * 规则与 `AutopilotRoutePage.readAutopilotAgentCrew` 一致：
 *   1. 先取最新 `agent_crew` payload；
 *   2. 若有最新 `role_timeline` payload，合并其 `timelines` 到 `roleTimelines` / `presence` 上；
 *   3. 统一走 `normalizeBlueprintAgentCrew` 完成字段标准化。
 */
export function deriveAgentCrewFromJob(
  job: BlueprintGenerationJob | null
): BlueprintAgentCrewSnapshot | null {
  if (!job) return null;
  const crewPayloads = readJobArtifactPayloads(job, "agent_crew");
  const crewPayload = crewPayloads.at(-1);
  if (crewPayload === undefined) return null;

  const crewRecord = asObjectRecord(crewPayload);
  if (!crewRecord) return normalizeBlueprintAgentCrew(crewPayload);

  const timelinePayloads = readJobArtifactPayloads(job, "role_timeline");
  const timelinePayload = timelinePayloads.at(-1);
  const timelineRecord = asObjectRecord(timelinePayload);
  const timelines = Array.isArray(timelineRecord?.timelines)
    ? timelineRecord.timelines
    : undefined;

  return normalizeBlueprintAgentCrew(
    timelines
      ? {
          ...crewRecord,
          roleTimelines: timelines,
          presence: timelines,
        }
      : crewRecord
  );
}

/**
 * 从 job artifacts 派生 `BlueprintArtifactFeedback[]`。
 *
 * 规则与服务端 `extractArtifactFeedback`（`server/routes/blueprint.ts`）一致：
 *   1. 取 `job.artifacts` 中 `type === "feedback"` 的 payload；
 *   2. 按 `createdAt` 升序排序（若 payload 缺失 createdAt 则保持 artifact 出现顺序，与服务端
 *      的稳定排序语义对齐）；
 *   3. 结果里每个 payload 本身就是 `BlueprintArtifactFeedback`（后端已在写入 artifact 时完成
 *      规范化，前端仅做最基本的形状断言过滤）。
 *
 * 该 helper 让 Wave 4 的 `artifactFeedback` 字段可以完全从 W1 `state.job.data` 派生出来，
 * 不再需要单独 fetch（Requirement 12.5：不新增后端调用）。任何 job 级状态变化（W1 job refetch
 * 成功 / SSE stage 推进）都会自动带来 artifactFeedback 的刷新。
 */
export function deriveArtifactFeedbackFromJob(
  job: BlueprintGenerationJob | null
): BlueprintArtifactFeedback[] {
  if (!job) return [];
  const feedbackArtifacts = job.artifacts.filter(
    artifact => artifact.type === "feedback"
  );
  if (feedbackArtifacts.length === 0) return [];
  const payloads = feedbackArtifacts
    .filter(artifact => isArtifactFeedbackPayload(artifact.payload))
    .map(artifact => artifact.payload as BlueprintArtifactFeedback);
  // 按 createdAt 升序排序；无 createdAt 的项保持相对顺序。
  return [...payloads].sort((left, right) => {
    const leftCreatedAt = left.createdAt ?? "";
    const rightCreatedAt = right.createdAt ?? "";
    if (!leftCreatedAt && !rightCreatedAt) return 0;
    if (!leftCreatedAt) return 1;
    if (!rightCreatedAt) return -1;
    return leftCreatedAt.localeCompare(rightCreatedAt);
  });
}

/**
 * 防御性形状检查：artifact.payload 是否真的是 `BlueprintArtifactFeedback`。
 * 与 `server/routes/blueprint.ts` 中 `isArtifactFeedbackPayload` 对齐（只断言必要字段）。
 */
function isArtifactFeedbackPayload(
  value: unknown
): value is BlueprintArtifactFeedback {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.jobId === "string" &&
    typeof record.entryId === "string"
  );
}

/**
 * registry + job 两路 capabilities 的合并规则：
 * - 与 `RuntimeCapabilityPanel` 当前 UI 逻辑（`jobCapabilities.length ? job : registry`）等价：
 *   只要 job 返回了非空列表，就以 job 列表为准；否则回退到 registry 列表。
 * - 任一侧为 `null`（fetch 失败） → 退化为另一侧；两侧都是 `null` → 返回 `null`
 *   （调用方据此决定 dispatch FULFILLED 还是 REJECTED）。
 *
 * 该 helper 暴露为 named export 以便在 reducer 外复用 / 单元测试。
 */
export function mergeCapabilities(
  registry: BlueprintRuntimeCapability[] | null,
  jobList: BlueprintRuntimeCapability[] | null
): BlueprintRuntimeCapability[] | null {
  if (jobList && jobList.length > 0) return jobList;
  if (registry) return registry;
  if (jobList) return jobList; // 空数组但非 null，仍优先于 null
  return null;
}

/**
 * 判断 `field` 是否应当在当前 `(jobStage, currentSubStage, skipLazyLoad)` 快照下发起 fetch。
 *
 * Task 3-5 实现范围：Wave 2、Wave 3 与 Wave 4 的 case 均返回真实规则。
 *
 * 注：`job / routeSet / selection / specTree` 四个 W1 字段不走本 gate —— 它们始终加载（由 W1
 * effect 直接驱动），因此不作为本函数的合法输入；若误传入，函数也会在 default 分支返回 `false`。
 */
export function shouldLoadField(
  field: Exclude<
    RightRailFieldName,
    "job" | "routeSet" | "selection" | "specTree"
  >,
  params: {
    currentSubStage: AutopilotRailSubStage | undefined;
    jobStage: BlueprintGenerationJob["stage"] | null;
    skipLazyLoad: boolean;
  }
): boolean {
  if (params.skipLazyLoad) return true;
  const { currentSubStage, jobStage } = params;
  switch (field) {
    case "agentCrew":
    case "capabilities":
    case "capabilityInvocations":
    case "capabilityEvidence":
      // Wave 2：`currentSubStage` 存在（即 fabric 阶段）即触发。
      return Boolean(currentSubStage);
    case "effectPreviews":
      // Wave 3：effectPreviews
      //  - currentSubStage ∈ { effect_preview, prompt_package, runtime_capability,
      //    engineering_handoff, artifact_memory } → 触发；
      //  - job.stage ∈ STAGES_ALLOWING_EFFECT_PREVIEWS → 触发（无 currentSubStage 兜底，
      //    例如 `/specs` 页面尚未进入 fabric 子阶段但 job 已推进到 preview）。
      return (
        currentSubStage === "effect_preview" ||
        currentSubStage === "prompt_package" ||
        currentSubStage === "runtime_capability" ||
        currentSubStage === "engineering_handoff" ||
        currentSubStage === "artifact_memory" ||
        (jobStage !== null && STAGES_ALLOWING_EFFECT_PREVIEWS.has(jobStage))
      );
    case "promptPackages":
      // Wave 3：promptPackages
      //  - currentSubStage ∈ { prompt_package, runtime_capability,
      //    engineering_handoff, artifact_memory } → 触发；
      //  - job.stage ∈ STAGES_ALLOWING_PROMPT_PACKAGES → 触发。
      return (
        currentSubStage === "prompt_package" ||
        currentSubStage === "runtime_capability" ||
        currentSubStage === "engineering_handoff" ||
        currentSubStage === "artifact_memory" ||
        (jobStage !== null && STAGES_ALLOWING_PROMPT_PACKAGES.has(jobStage))
      );
    case "landingPlans":
    case "engineeringRuns":
      // Wave 3：engineering 家族共享同一懒加载阈值
      //  - currentSubStage ∈ { engineering_handoff, artifact_memory } → 触发；
      //  - job.stage ∈ STAGES_ALLOWING_ENGINEERING → 触发。
      return (
        currentSubStage === "engineering_handoff" ||
        currentSubStage === "artifact_memory" ||
        (jobStage !== null && STAGES_ALLOWING_ENGINEERING.has(jobStage))
      );
    case "artifactEntries":
    case "artifactReplays":
    case "artifactFeedback":
      // Wave 4：共享懒加载阈值
      //  - currentSubStage === "artifact_memory" → 触发；
      //  - job.stage === "engineering_landing" → 触发（即便 currentSubStage 尚未进入
      //    fabric 子阶段，例如 `/specs` autoLoad 路径需要 bootstrap artifact memory）。
      //
      // 说明：`artifactFeedback` 本身不发起独立 HTTP 请求（Requirement 12.5），但 view 层
      // 依然需要用同一 gate 判定它的可见性；这样切回 artifact_memory 子阶段后 feedback 能
      // 与 entries / replays 同步出现。
      return (
        currentSubStage === "artifact_memory" ||
        jobStage === "engineering_landing"
      );
    default:
      return false;
  }
}

/**
 * Task 6：判断 SSE + polling 自动刷新是否启用。
 *
 * 规则（与 `design.md`「SSE / polling 实现」章节一致，Requirement 5.5）：
 * - `undefined` / 正整数 → 启用（undefined 使用默认间隔 15000ms）。
 * - `0` / 负数 / `NaN` → 禁用（测试或手动触发场景）。
 */
export function isJobAutoRefreshEnabled(
  pollingIntervalMs: number | undefined
): boolean {
  if (pollingIntervalMs === undefined) return true;
  if (!Number.isFinite(pollingIntervalMs)) return false;
  return pollingIntervalMs > 0;
}

/**
 * Task 6：根据连续失败次数计算下一次 polling 的间隔（毫秒）。
 *
 * 语义（Requirement 5.4）：
 * - `attempt < 3`：使用 base interval，不退避；
 * - `attempt >= 3`：使用 `base * 2^(attempt - 2)`，上限 120000ms。
 *
 * 以 attempt=3 为例（`base = 15000`）：15s * 2^1 = 30s；
 * attempt=4 → 60s；attempt=5 → 120s（被上限截断）。
 */
export function computePollingBackoff(
  baseIntervalMs: number,
  attempt: number,
  maxIntervalMs = 120000
): number {
  if (!Number.isFinite(baseIntervalMs) || baseIntervalMs <= 0) {
    return 0;
  }
  const safeAttempt = Math.max(0, Math.floor(attempt));
  if (safeAttempt < 3) {
    return Math.min(baseIntervalMs, maxIntervalMs);
  }
  const exponent = safeAttempt - 2;
  const nextInterval = baseIntervalMs * Math.pow(2, exponent);
  return Math.min(nextInterval, maxIntervalMs);
}

/**
 * Task 7：判断单字段 `retry()` 是否应当真正触发一次 fetch。
 *
 * 组合规则（Requirement 7.2、7.3、8.2、8.3）：
 *   1. `hasJob === false` → 永远 `false`（`jobId` 为空时 retry 为 no-op）。
 *   2. W1 字段 / W1 派生字段（`job / routeSet / selection / specTree / agentCrew /
 *      artifactFeedback`） → 只要 `pendingRequestId === null` 即可触发；W1 字段不走懒加载 gate。
 *   3. W2-W4 fetch 字段 → 需同时满足 `shouldLoadField` 懒加载 gate 与 in-flight guard
 *      （`pendingRequestId === null`）。
 *
 * 该 helper 纯函数实现，可直接单测，不依赖 React / hook 内部 state；retry 的 Ignore_Stale_Policy
 * 由 reducer 层（`pendingRequestId` 比较）承担，本 helper 仅负责「要不要发起」这一决策点。
 */
export function shouldTriggerPerFieldRetry(
  field: RightRailFieldName,
  params: {
    hasJob: boolean;
    currentSubStage: AutopilotRailSubStage | undefined;
    jobStage: BlueprintGenerationJob["stage"] | null;
    skipLazyLoad: boolean;
    pendingRequestId: number | null;
  }
): boolean {
  if (!params.hasJob) return false;
  if (
    field === "job" ||
    field === "routeSet" ||
    field === "selection" ||
    field === "specTree" ||
    field === "agentCrew" ||
    field === "artifactFeedback"
  ) {
    // W1 / 派生字段：仅由 in-flight guard 限制；懒加载 gate 对 W1 不适用。
    return params.pendingRequestId === null;
  }
  // W2-W4 fetch 字段：先懒加载 gate，再 in-flight guard。
  const gateOpen = shouldLoadField(
    field as Exclude<
      RightRailFieldName,
      "job" | "routeSet" | "selection" | "specTree"
    >,
    {
      currentSubStage: params.currentSubStage,
      jobStage: params.jobStage,
      skipLazyLoad: params.skipLazyLoad,
    }
  );
  if (!gateOpen) return false;
  if (params.pendingRequestId !== null) return false;
  return true;
}

/**
 * Task 6：从 SSE `message` 事件 payload 中提取 `job.stage`。
 *
 * 服务端 `/api/blueprint/jobs/:id/events/stream` 的 payload 形状可能是：
 *   1. `{ stage: "spec_tree", ... }`
 *   2. `{ job: { stage: "spec_tree", ... }, ... }`
 * 其它 payload 一律忽略。
 *
 * 返回值：
 * - 合法字符串 → 原样返回（未对 stage 联合体做 narrow；由调用方决定是否 narrow）；
 * - 其它 → `null`。
 */
export function extractStageFromSSEPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.stage === "string") return record.stage;
  const job = record.job;
  if (job && typeof job === "object") {
    const jobStage = (job as Record<string, unknown>).stage;
    if (typeof jobStage === "string") return jobStage;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Autopilot 右栏数据层 hook。
 *
 * Task 2 现状：
 * - W1 `fetchLatestBlueprintGenerationJob()` 在 `jobId` 变化且 `initialData.job.id !== jobId`
 *   时触发；成功后填充 `job / routeSet / selection / specTree`。
 * - W2-W4 字段仍为占位（data 来自 `initialData`，`loading=false`，`retry` 为 no-op）；
 *   Task 3-5 会接入真实 fetch。
 *
 * 外部契约（spec Requirement 1）：
 * - 签名固定：`(jobId: string, options?: UseAutopilotRightRailDataOptions) => RightRailDataView`。
 * - `jobId` 为空字符串或仅空白时，不发起任何 fetch（Requirement 1.5）。
 * - `retry` 是稳定引用（仅在 `jobId` 变化时重建）。
 * - 不抛异常到 render path。
 * - 不订阅 `useAppStore` / `useProjectStore`。
 */
export function useAutopilotRightRailData(
  jobId: string,
  options?: UseAutopilotRightRailDataOptions
): RightRailDataView {
  const initialData = options?.initialData;
  const trimmedJobId = jobId.trim();
  const hasJob = trimmedJobId.length > 0;

  // per-jobId 历史 cache：用于切回历史 jobId 时复用 W2-W4（Requirement 4.3 策略）。
  // Task 2 在 W1 成功后会写入 `job/routeSet/selection/specTree` 到 cache；Task 3 在 W2 成功
  // 后会写入 `capabilities/capabilityInvocations/capabilityEvidence`（`agentCrew` 由于是派生
  // 字段不进入 cache，其值在切回时会由同一 W1 job 快照重新派生出来）。
  const cacheRef = useRef<Map<string, PartialCacheEntry>>(new Map());

  const [state, dispatch] = useReducer(
    rightRailDataReducer,
    undefined,
    () =>
      buildInitialReducerState(
        trimmedJobId,
        initialData,
        cacheRef.current.get(trimmedJobId) ?? null
      )
  );

  // `jobId` 变化：重置 reducer 到新 jobId，从 cacheRef 读取可能的历史 cache seed。
  // 注：reducer init 已经处理了首次挂载；本 effect 处理后续 jobId 变化。
  useEffect(() => {
    if (state.currentJobId === trimmedJobId) return;
    dispatch({
      type: "JOB_CHANGED",
      jobId: trimmedJobId,
      initialData,
      cachedFields: cacheRef.current.get(trimmedJobId) ?? null,
    });
    // 仅依赖 trimmedJobId：initialData 的身份变化不应触发整体 reset（避免父组件每 render
    // 都重建 initialData object 时频繁 reset）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedJobId]);

  // W1 fetch orchestration：
  //   1. jobId 非空且 initialData.job 不对应当前 jobId → 发起 fetchLatestBlueprintGenerationJob。
  //   2. jobId 为空 → 不发 fetch（Requirement 1.5）。
  //   3. jobId 非空且 initialData.job.id === jobId → 跳过首次 fetch，仅建立 cache 指针
  //      （Requirement 6.1，当父组件已经持有 job state 时避免 N+1）。
  // 注：`refetchTrigger` 是 W1 retry 时递增的 useReducer counter，用于强制 effect 重新执行。
  //     之前版本把 state 丢弃（`const [, forceRefetchBump] = useReducer(...)`）导致 effect
  //     依赖数组无法订阅到 counter 变化，`retryWave1()` 只是一个假 retry — 会 bump ref 但
  //     不会重跑 effect。本版把 state 保留并加进 effect 依赖，让 W1 retry 真正生效
  //     （例如 `handleSelectRoute` 成功后调用 `rightRailView.job.retry()` 主动刷新 W1 snapshot）。
  const refetchTriggerRef = useRef(0);
  const [refetchTrigger, forceRefetchBump] = useReducer(
    (x: number) => x + 1,
    0
  );

  useEffect(() => {
    if (!hasJob) return;

    // 若 initialData.job 对应当前 jobId 且当前 state.job 已从 initialData seed（即未被
    // 后续 fetch 覆盖），跳过首次 fetch。这与 Requirement 6.1 的 AutopilotRoutePage 场景一致：
    // 父组件已经通过 createBlueprintGenerationJob 等写请求持有 latestJob state，hook 不应再
    // 发 GET /jobs/latest 复制一次。
    const seededFromInitial =
      initialData?.job?.id === trimmedJobId &&
      state.job.data?.id === trimmedJobId &&
      refetchTriggerRef.current === 0;
    if (seededFromInitial) return;

    const controller = new AbortController();
    const requestId = nextRequestId();

    dispatch({
      type: "FETCH_STARTED",
      jobId: trimmedJobId,
      fields: WAVE_1_FIELDS,
      requestId,
    });

    void (async () => {
      try {
        const result = await fetchLatestBlueprintGenerationJob();
        if (controller.signal.aborted) return;
        if (!result.ok) {
          dispatch({
            type: "FETCH_REJECTED",
            jobId: trimmedJobId,
            requestId,
            fields: WAVE_1_FIELDS,
            error: result.error,
          });
          options?.onFieldError?.("job", result.error);
          return;
        }
        // 仅当返回 job 与当前 trimmedJobId 匹配时应用；否则忽略（可能后端返回了另一个 job）。
        const receivedJobId = result.data.job?.id;
        if (!receivedJobId || receivedJobId !== trimmedJobId) {
          // 安全降级：把 job 应用为 null 以表明当前 jobId 对应的 job 不存在。
          dispatch({
            type: "FETCH_FULFILLED",
            jobId: trimmedJobId,
            requestId,
            fieldUpdates: {
              job: null,
              routeSet: null,
              selection: null,
              specTree: null,
            },
          });
          return;
        }
        dispatch({
          type: "FETCH_FULFILLED",
          jobId: trimmedJobId,
          requestId,
          fieldUpdates: deriveWave1FieldUpdates(result.data),
        });

        // W1 on*Change 回调：把最新 job 快照 sibling 字段同步给 consumer（Phase A 桥接
        // `BlueprintProgressPanel` 的 `initial*` / `on*Change` props，以及让 Office 任务面板
        // 等统一驾驶舱消费方感知 W1 数据）。
        options?.onJobChange?.(result.data.job ?? null);
        options?.onRouteSetChange?.(result.data.routeSet ?? null);
        options?.onSelectionChange?.(result.data.selection ?? null);
        options?.onSpecTreeChange?.(result.data.specTree ?? null);

        // 写入 cache（用于 Requirement 4.3 切回复用）。
        const entry: PartialCacheEntry = cacheRef.current.get(trimmedJobId) ?? {};
        entry.job = result.data.job ?? null;
        entry.routeSet = result.data.routeSet ?? null;
        entry.selection = result.data.selection ?? null;
        entry.specTree = result.data.specTree ?? null;
        cacheRef.current.set(trimmedJobId, entry);
      } catch (rawError) {
        if (controller.signal.aborted) return;
        // 不抛到 render path；转为 ApiRequestError。
        const error: ApiRequestError = {
          kind: "error",
          source: "network",
          endpoint: "/api/blueprint/jobs/latest",
          message:
            rawError instanceof Error ? rawError.message : "unexpected error",
          detail:
            rawError instanceof Error && rawError.stack
              ? rawError.stack
              : "useAutopilotRightRailData: W1 fetch threw synchronously",
          retryable: true,
        };
        dispatch({
          type: "FETCH_REJECTED",
          jobId: trimmedJobId,
          requestId,
          fields: WAVE_1_FIELDS,
          error,
        });
        options?.onFieldError?.("job", error);
      }
    })();

    return () => {
      controller.abort();
    };
    // refetchTrigger 依赖用于 W1 retry 强制重入；initialData 故意排除在依赖外。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedJobId, hasJob, refetchTrigger]);

  // W1 共享 retry：触发 W1 fetch 重跑（bump refetch trigger + 重新 mount effect）。
  // W1 4 个字段共用此 retry：因为它们从同一次 snapshot 派生。
  const retryWave1 = useCallback(() => {
    if (!hasJob) return;
    refetchTriggerRef.current += 1;
    forceRefetchBump();
  }, [hasJob]);

  // -------------------------------------------------------------------------
  // Wave 2 fetch orchestration
  //
  // 触发条件：W1 已经有 `job.data`（或 initialData 提供了 job）+ `shouldLoadField` 判定
  // 对应字段应当加载。本 effect 只在上述条件变化时重跑（`jobId`、`job.stage`、
  // `currentSubStage`、`skipLazyLoad` 四元组），且通过 `abortController` 取消在飞请求。
  //
  // 为避免与 W1 effect 形成双写冲突：W1 负责 `job / routeSet / selection / specTree` 的
  // loading / data / error；W2 负责 `capabilities / capabilityInvocations / capabilityEvidence`。
  // `agentCrew` 是派生字段，不进入 FETCH_STARTED 流程，而是在 view 映射时按 gate 从
  // `state.job.data` 派生（见 `useMemo` 末尾）。
  //
  // 合并规则：registry + job 两路 capabilities 使用 `mergeCapabilities`（registry-first
  // 回退：job 列表非空时优先，否则取 registry；任一 ok → 视为该字段成功）。
  // -------------------------------------------------------------------------
  const [w2RetryTrigger, bumpW2Retry] = useReducer((x: number) => x + 1, 0);
  const currentSubStage = options?.currentSubStage;
  const skipLazyLoad = options?.skipLazyLoad === true;
  const jobStage = state.job.data?.stage ?? null;

  useEffect(() => {
    if (!hasJob) return;
    // 仅当 W1 已经具备 job 数据时才推进 W2（否则 gate 无法判定 fabric 阶段语义）。
    // 注：`initialData.job.id === jobId` 时 state.job.data 已从 init seed 提供，满足此门限。
    if (!state.job.data || state.job.data.id !== trimmedJobId) return;

    const fields = WAVE_2_FETCH_FIELDS.filter(field =>
      shouldLoadField(
        field as Exclude<
          RightRailFieldName,
          "job" | "routeSet" | "selection" | "specTree"
        >,
        { currentSubStage, jobStage, skipLazyLoad }
      )
    );
    if (fields.length === 0) return;

    const controller = new AbortController();
    const requestId = nextRequestId();

    dispatch({
      type: "FETCH_STARTED",
      jobId: trimmedJobId,
      fields,
      requestId,
    });

    void (async () => {
      // 使用 Promise.allSettled：单字段失败不阻塞其余字段；registry + job 两路合并仍按
      // `mergeCapabilities` 处理。所有 fetchBlueprint* 函数均返回 `{ ok, ... }`（内部已
      // 捕获网络异常），因此这里把它们当作不会 throw 的 async 函数；但仍通过
      // `Promise.allSettled` 兜底，防止底层行为变更后穿透异常。
      const wantCapabilities = fields.includes("capabilities");
      const wantInvocations = fields.includes("capabilityInvocations");
      const wantEvidence = fields.includes("capabilityEvidence");

      const registryPromise = wantCapabilities
        ? fetchBlueprintCapabilities()
        : null;
      const jobCapabilitiesPromise = wantCapabilities
        ? fetchBlueprintJobCapabilities(trimmedJobId)
        : null;
      const invocationsPromise = wantInvocations
        ? fetchBlueprintCapabilityInvocations(trimmedJobId)
        : null;
      const evidencePromise = wantEvidence
        ? fetchBlueprintCapabilityEvidence(trimmedJobId)
        : null;
      const settled = await Promise.allSettled([
        registryPromise,
        jobCapabilitiesPromise,
        invocationsPromise,
        evidencePromise,
      ]);
      if (controller.signal.aborted) return;

      const [
        registrySettled,
        jobCapabilitiesSettled,
        invocationsSettled,
        evidenceSettled,
      ] = settled;

      const fieldUpdates: PartialFieldDataMap = {};
      const rejectedFields: RightRailFieldName[] = [];
      let primaryError: ApiRequestError | null = null;

      const extractResult = <T,>(
        entry: (typeof settled)[number],
        endpoint: string
      ):
        | { ok: true; data: T }
        | { ok: false; error: ApiRequestError }
        | null => {
        if (entry.status === "fulfilled") {
          if (entry.value === null || entry.value === undefined) return null;
          return entry.value as
            | { ok: true; data: T }
            | { ok: false; error: ApiRequestError };
        }
        return { ok: false, error: coerceApiRequestError(entry.reason, endpoint) };
      };

      if (wantCapabilities) {
        const registryResult = extractResult<
          { capabilities: BlueprintRuntimeCapability[] }
        >(registrySettled, "/api/blueprint/capabilities");
        const jobResult = extractResult<
          { capabilities: BlueprintRuntimeCapability[] }
        >(
          jobCapabilitiesSettled,
          `/api/blueprint/jobs/${trimmedJobId}/capabilities`
        );
        const registryList =
          registryResult && registryResult.ok
            ? registryResult.data.capabilities
            : null;
        const jobList =
          jobResult && jobResult.ok ? jobResult.data.capabilities : null;
        const merged = mergeCapabilities(registryList, jobList);
        if (merged !== null) {
          fieldUpdates.capabilities = merged;
          options?.onCapabilitiesChange?.(merged);
        } else {
          rejectedFields.push("capabilities");
          // 至少一个失败；按 registry 失败优先展示错误（否则用 job 的错误）。
          if (registryResult && !registryResult.ok) {
            primaryError ??= registryResult.error;
          } else if (jobResult && !jobResult.ok) {
            primaryError ??= jobResult.error;
          }
          options?.onCapabilitiesChange?.([]);
        }
      }

      if (wantInvocations) {
        const invocationsResult = extractResult<{
          invocations: BlueprintCapabilityInvocation[];
        }>(
          invocationsSettled,
          `/api/blueprint/jobs/${trimmedJobId}/capability-invocations`
        );
        if (invocationsResult && invocationsResult.ok) {
          fieldUpdates.capabilityInvocations =
            invocationsResult.data.invocations;
          options?.onCapabilityInvocationsChange?.(
            invocationsResult.data.invocations
          );
        } else if (invocationsResult && !invocationsResult.ok) {
          rejectedFields.push("capabilityInvocations");
          primaryError ??= invocationsResult.error;
        }
      }

      if (wantEvidence) {
        const evidenceResult = extractResult<{
          evidence: BlueprintCapabilityEvidence[];
        }>(
          evidenceSettled,
          `/api/blueprint/jobs/${trimmedJobId}/capability-evidence`
        );
        if (evidenceResult && evidenceResult.ok) {
          fieldUpdates.capabilityEvidence = evidenceResult.data.evidence;
          options?.onCapabilityEvidenceChange?.(evidenceResult.data.evidence);
        } else if (evidenceResult && !evidenceResult.ok) {
          rejectedFields.push("capabilityEvidence");
          primaryError ??= evidenceResult.error;
        }
      }

      // 分两步 dispatch：先写入成功字段（批量 FULFILLED），再把失败字段单独 REJECTED。
      // 注意：reducer 在字段级别比较 pendingRequestId，因此同一个 requestId 同时覆盖成功
      // 与失败字段不会互相污染。
      if (Object.keys(fieldUpdates).length > 0) {
        dispatch({
          type: "FETCH_FULFILLED",
          jobId: trimmedJobId,
          requestId,
          fieldUpdates,
        });

        // 写入 W2 cache 条目，供历史 jobId 切回复用。
        const entry: PartialCacheEntry = cacheRef.current.get(trimmedJobId) ?? {};
        if ("capabilities" in fieldUpdates) {
          entry.capabilities = fieldUpdates.capabilities;
        }
        if ("capabilityInvocations" in fieldUpdates) {
          entry.capabilityInvocations = fieldUpdates.capabilityInvocations;
        }
        if ("capabilityEvidence" in fieldUpdates) {
          entry.capabilityEvidence = fieldUpdates.capabilityEvidence;
        }
        cacheRef.current.set(trimmedJobId, entry);
      }
      if (rejectedFields.length > 0 && primaryError) {
        dispatch({
          type: "FETCH_REJECTED",
          jobId: trimmedJobId,
          requestId,
          fields: rejectedFields,
          error: primaryError,
        });
        for (const field of rejectedFields) {
          options?.onFieldError?.(field, primaryError);
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // 注：`state.job.data` 作为 gating 先决条件进入依赖（W1 完成后即可 kick off W2）。
    // `options.on*Change` 故意排除，避免消费者每次 render 重建 callback 造成 W2 重发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trimmedJobId,
    hasJob,
    state.job.data,
    jobStage,
    currentSubStage,
    skipLazyLoad,
    w2RetryTrigger,
  ]);

  // Wave 2 共享 retry：触发 W2 effect 重跑。
  // Task 3 实现范围：`capabilities / capabilityInvocations / capabilityEvidence` 共享此 retry；
  // Task 7 会把 per-field retry 替换为仅重拉单字段的版本。
  const retryWave2 = useCallback(() => {
    if (!hasJob) return;
    bumpW2Retry();
  }, [hasJob]);

  // -------------------------------------------------------------------------
  // Wave 3 fetch orchestration
  //
  // 触发条件：W1 已经有 `job.data` + 字段级 `shouldLoadField` 判定通过。本 effect 按
  // `(jobId, job.stage, currentSubStage, skipLazyLoad, w3RetryTrigger)` 五元组重跑，
  // 通过 `AbortController` 取消在飞请求。
  //
  // 为避免与 W1 / W2 effect 的双写冲突：本 effect 只负责
  // `effectPreviews / promptPackages / landingPlans / engineeringRuns` 4 个字段；与
  // Wave 2 字段的 `FETCH_STARTED` 不会在 reducer 中发生交叠（字段集合互斥）。
  //
  // 单字段失败不阻塞其余字段：每个结果独立判定 ok；成功字段走一次批量 FETCH_FULFILLED，
  // 失败字段走一次 FETCH_REJECTED 并附带该次 fetch 的 primaryError（记录在 field error）。
  //
  // 子阶段从浅切深（例如 `effect_preview → prompt_package`）时，新解锁的字段以 loading=true
  // 进入 fetch；已经在 W3 cache 中的字段不会触发独立 fetch（通过 seed 覆盖而非重拉）。
  // -------------------------------------------------------------------------
  const [w3RetryTrigger, bumpW3Retry] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!hasJob) return;
    // 与 W2 effect 一致，要求 W1 job 数据已就绪并且指向当前 jobId，避免 gate 判定悬空。
    if (!state.job.data || state.job.data.id !== trimmedJobId) return;

    const fields = WAVE_3_FETCH_FIELDS.filter(field =>
      shouldLoadField(
        field as Exclude<
          RightRailFieldName,
          "job" | "routeSet" | "selection" | "specTree"
        >,
        { currentSubStage, jobStage, skipLazyLoad }
      )
    );
    if (fields.length === 0) return;

    const controller = new AbortController();
    const requestId = nextRequestId();

    dispatch({
      type: "FETCH_STARTED",
      jobId: trimmedJobId,
      fields,
      requestId,
    });

    void (async () => {
      const wantEffectPreviews = fields.includes("effectPreviews");
      const wantPromptPackages = fields.includes("promptPackages");
      const wantLandingPlans = fields.includes("landingPlans");
      const wantEngineeringRuns = fields.includes("engineeringRuns");

      const effectPreviewsPromise = wantEffectPreviews
        ? fetchBlueprintEffectPreviews(trimmedJobId)
        : null;
      const promptPackagesPromise = wantPromptPackages
        ? fetchBlueprintPromptPackages(trimmedJobId)
        : null;
      const landingPlansPromise = wantLandingPlans
        ? fetchBlueprintEngineeringLanding(trimmedJobId)
        : null;
      const engineeringRunsPromise = wantEngineeringRuns
        ? fetchBlueprintEngineeringRuns(trimmedJobId)
        : null;

      const settled = await Promise.allSettled([
        effectPreviewsPromise,
        promptPackagesPromise,
        landingPlansPromise,
        engineeringRunsPromise,
      ]);
      if (controller.signal.aborted) return;

      const [
        effectPreviewsSettled,
        promptPackagesSettled,
        landingPlansSettled,
        engineeringRunsSettled,
      ] = settled;

      const fieldUpdates: PartialFieldDataMap = {};
      const rejectedFields: RightRailFieldName[] = [];
      let primaryError: ApiRequestError | null = null;

      const extractResult = <T,>(
        entry: (typeof settled)[number],
        endpoint: string
      ):
        | { ok: true; data: T }
        | { ok: false; error: ApiRequestError }
        | null => {
        if (entry.status === "fulfilled") {
          if (entry.value === null || entry.value === undefined) return null;
          return entry.value as
            | { ok: true; data: T }
            | { ok: false; error: ApiRequestError };
        }
        return { ok: false, error: coerceApiRequestError(entry.reason, endpoint) };
      };

      if (wantEffectPreviews) {
        const result = extractResult<{
          effectPreviews: BlueprintEffectPreviewSnapshot[];
        }>(
          effectPreviewsSettled,
          `/api/blueprint/jobs/${trimmedJobId}/effect-previews`
        );
        if (result && result.ok) {
          fieldUpdates.effectPreviews = result.data.effectPreviews;
          options?.onEffectPreviewsChange?.(result.data.effectPreviews);
        } else if (result && !result.ok) {
          rejectedFields.push("effectPreviews");
          primaryError ??= result.error;
        }
      }

      if (wantPromptPackages) {
        const result = extractResult<{
          promptPackages: BlueprintPromptPackage[];
        }>(
          promptPackagesSettled,
          `/api/blueprint/jobs/${trimmedJobId}/prompt-packages`
        );
        if (result && result.ok) {
          fieldUpdates.promptPackages = result.data.promptPackages;
          options?.onPromptPackagesChange?.(result.data.promptPackages);
        } else if (result && !result.ok) {
          rejectedFields.push("promptPackages");
          primaryError ??= result.error;
        }
      }

      if (wantLandingPlans) {
        const result = extractResult<{
          landingPlans: BlueprintEngineeringLandingPlan[];
        }>(
          landingPlansSettled,
          `/api/blueprint/jobs/${trimmedJobId}/engineering-landing`
        );
        if (result && result.ok) {
          fieldUpdates.landingPlans = result.data.landingPlans;
          options?.onLandingPlansChange?.(result.data.landingPlans);
        } else if (result && !result.ok) {
          rejectedFields.push("landingPlans");
          primaryError ??= result.error;
        }
      }

      if (wantEngineeringRuns) {
        const result = extractResult<{
          engineeringRuns: BlueprintEngineeringRun[];
        }>(
          engineeringRunsSettled,
          `/api/blueprint/jobs/${trimmedJobId}/engineering-runs`
        );
        if (result && result.ok) {
          fieldUpdates.engineeringRuns = result.data.engineeringRuns;
          options?.onEngineeringRunsChange?.(result.data.engineeringRuns);
        } else if (result && !result.ok) {
          rejectedFields.push("engineeringRuns");
          primaryError ??= result.error;
        }
      }

      if (Object.keys(fieldUpdates).length > 0) {
        dispatch({
          type: "FETCH_FULFILLED",
          jobId: trimmedJobId,
          requestId,
          fieldUpdates,
        });

        // 写入 W3 cache 条目，供历史 jobId 切回复用。
        const entry: PartialCacheEntry = cacheRef.current.get(trimmedJobId) ?? {};
        if ("effectPreviews" in fieldUpdates) {
          entry.effectPreviews = fieldUpdates.effectPreviews;
        }
        if ("promptPackages" in fieldUpdates) {
          entry.promptPackages = fieldUpdates.promptPackages;
        }
        if ("landingPlans" in fieldUpdates) {
          entry.landingPlans = fieldUpdates.landingPlans;
        }
        if ("engineeringRuns" in fieldUpdates) {
          entry.engineeringRuns = fieldUpdates.engineeringRuns;
        }
        cacheRef.current.set(trimmedJobId, entry);
      }
      if (rejectedFields.length > 0 && primaryError) {
        dispatch({
          type: "FETCH_REJECTED",
          jobId: trimmedJobId,
          requestId,
          fields: rejectedFields,
          error: primaryError,
        });
        for (const field of rejectedFields) {
          options?.onFieldError?.(field, primaryError);
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // 注：`options.on*Change` 故意排除依赖以避免消费者每 render 重建 callback 触发 W3 重发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trimmedJobId,
    hasJob,
    state.job.data,
    jobStage,
    currentSubStage,
    skipLazyLoad,
    w3RetryTrigger,
  ]);

  // Wave 3 共享 retry：触发 W3 effect 重跑。
  // Task 4 实现范围：`effectPreviews / promptPackages / landingPlans / engineeringRuns` 共享此 retry；
  // Task 7 会把 per-field retry 替换为仅重拉单字段的版本。
  const retryWave3 = useCallback(() => {
    if (!hasJob) return;
    bumpW3Retry();
  }, [hasJob]);

  // -------------------------------------------------------------------------
  // Wave 4 fetch orchestration
  //
  // 触发条件：W1 已经有 `job.data` + `shouldLoadField` 对 `artifactEntries / artifactReplays`
  // 返回 true。本 effect 按 `(jobId, job.stage, currentSubStage, skipLazyLoad, w4RetryTrigger)`
  // 五元组重跑；通过 `AbortController` 取消在飞请求。
  //
  // 字段覆盖范围：
  //   - `artifactEntries`  → `fetchBlueprintArtifactLedger(jobId)`（独立 HTTP 请求）
  //   - `artifactReplays`  → `fetchBlueprintArtifactReplays(jobId)`（独立 HTTP 请求）
  //   - `artifactFeedback` → **不**发起独立 fetch；值来自 `state.job.data?.artifacts` 中
  //     `type === "feedback"` 的 payload（Requirement 12.5），在 view 映射时通过
  //     `deriveArtifactFeedbackFromJob(state.job.data)` 派生。
  //
  // 为避免与 W1/W2/W3 effect 的双写冲突：本 effect 只负责 `artifactEntries / artifactReplays`
  // 两个字段；与 Wave 1/2/3 字段的 `FETCH_STARTED` 不会在 reducer 中发生交叠（字段集合互斥）。
  //
  // 单字段失败不阻塞其余字段：每个结果独立判定 ok；成功字段走一次批量 FETCH_FULFILLED，
  // 失败字段走一次 FETCH_REJECTED 并附带该次 fetch 的 primaryError（记录在 field error）。
  // -------------------------------------------------------------------------
  const [w4RetryTrigger, bumpW4Retry] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!hasJob) return;
    // 与 W2/W3 effect 一致，要求 W1 job 数据已就绪并且指向当前 jobId，避免 gate 判定悬空。
    if (!state.job.data || state.job.data.id !== trimmedJobId) return;

    const fields = WAVE_4_FETCH_FIELDS.filter(field =>
      shouldLoadField(
        field as Exclude<
          RightRailFieldName,
          "job" | "routeSet" | "selection" | "specTree"
        >,
        { currentSubStage, jobStage, skipLazyLoad }
      )
    );
    if (fields.length === 0) return;

    const controller = new AbortController();
    const requestId = nextRequestId();

    dispatch({
      type: "FETCH_STARTED",
      jobId: trimmedJobId,
      fields,
      requestId,
    });

    void (async () => {
      const wantArtifactEntries = fields.includes("artifactEntries");
      const wantArtifactReplays = fields.includes("artifactReplays");

      const entriesPromise = wantArtifactEntries
        ? fetchBlueprintArtifactLedger(trimmedJobId)
        : null;
      const replaysPromise = wantArtifactReplays
        ? fetchBlueprintArtifactReplays(trimmedJobId)
        : null;

      const settled = await Promise.allSettled([
        entriesPromise,
        replaysPromise,
      ]);
      if (controller.signal.aborted) return;

      const [entriesSettled, replaysSettled] = settled;

      const fieldUpdates: PartialFieldDataMap = {};
      const rejectedFields: RightRailFieldName[] = [];
      let primaryError: ApiRequestError | null = null;

      const extractResult = <T,>(
        entry: (typeof settled)[number],
        endpoint: string
      ):
        | { ok: true; data: T }
        | { ok: false; error: ApiRequestError }
        | null => {
        if (entry.status === "fulfilled") {
          if (entry.value === null || entry.value === undefined) return null;
          return entry.value as
            | { ok: true; data: T }
            | { ok: false; error: ApiRequestError };
        }
        return { ok: false, error: coerceApiRequestError(entry.reason, endpoint) };
      };

      if (wantArtifactEntries) {
        const result = extractResult<{
          entries: BlueprintArtifactLedgerEntry[];
        }>(
          entriesSettled,
          `/api/blueprint/jobs/${trimmedJobId}/artifact-ledger`
        );
        if (result && result.ok) {
          fieldUpdates.artifactEntries = result.data.entries;
          options?.onArtifactEntriesChange?.(result.data.entries);
        } else if (result && !result.ok) {
          rejectedFields.push("artifactEntries");
          primaryError ??= result.error;
        }
      }

      if (wantArtifactReplays) {
        const result = extractResult<{
          replays: BlueprintArtifactReplay[];
        }>(
          replaysSettled,
          `/api/blueprint/jobs/${trimmedJobId}/artifact-replays`
        );
        if (result && result.ok) {
          fieldUpdates.artifactReplays = result.data.replays;
          options?.onArtifactReplaysChange?.(result.data.replays);
        } else if (result && !result.ok) {
          rejectedFields.push("artifactReplays");
          primaryError ??= result.error;
        }
      }

      if (Object.keys(fieldUpdates).length > 0) {
        dispatch({
          type: "FETCH_FULFILLED",
          jobId: trimmedJobId,
          requestId,
          fieldUpdates,
        });

        // 写入 W4 cache 条目，供历史 jobId 切回复用。
        // `artifactFeedback` 为派生字段，不进入独立 cache（切回时会随 W1 job snapshot 一同
        // 从历史 cache 恢复 `state.job.data` 后由 view 映射派生）。
        const entry: PartialCacheEntry =
          cacheRef.current.get(trimmedJobId) ?? {};
        if ("artifactEntries" in fieldUpdates) {
          entry.artifactEntries = fieldUpdates.artifactEntries;
        }
        if ("artifactReplays" in fieldUpdates) {
          entry.artifactReplays = fieldUpdates.artifactReplays;
        }
        cacheRef.current.set(trimmedJobId, entry);
      }
      if (rejectedFields.length > 0 && primaryError) {
        dispatch({
          type: "FETCH_REJECTED",
          jobId: trimmedJobId,
          requestId,
          fields: rejectedFields,
          error: primaryError,
        });
        for (const field of rejectedFields) {
          options?.onFieldError?.(field, primaryError);
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // 注：`options.on*Change` 故意排除依赖以避免消费者每 render 重建 callback 触发 W4 重发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trimmedJobId,
    hasJob,
    state.job.data,
    jobStage,
    currentSubStage,
    skipLazyLoad,
    w4RetryTrigger,
  ]);

  // Wave 4 共享 retry：触发 W4 effect 重跑。
  // Task 5 实现范围：`artifactEntries / artifactReplays` 共享此 retry；
  // `artifactFeedback` 由于是 W1 派生，retry 复用 `retryWave1`(在 view 映射中绑定)。
  const retryWave4 = useCallback(() => {
    if (!hasJob) return;
    bumpW4Retry();
  }, [hasJob]);

  // -------------------------------------------------------------------------
  // Task 6：SSE + polling 生命周期管理
  //
  // 职责（Requirement 5）：
  //   1. 当 `jobId` 非空且自动刷新启用（`isJobAutoRefreshEnabled(pollingIntervalMs)`）时,
  //      通过 `fetchBlueprintJobEventStreamUrl(jobId)` 建立 `EventSource` 订阅。
  //   2. 每次收到 `message` 事件,解析 `job.stage`,若与上一次 stage 不同则:
  //        - 调用 `options.onJobStageChange?.(next, prev)`;
  //        - 触发 targeted W1 refetch(复用 reducer 的 `FETCH_STARTED / FULFILLED /
  //          REJECTED` 路径,独立 requestId);下游 W2/W3/W4 effect 依赖 `state.job.data`
  //          / `jobStage`,W1 成功后会自动级联重跑。
  //   3. SSE 不可用(浏览器不支持 / 构造抛错) 或 `error` 事件且 `readyState === CLOSED`
  //      时降级为 polling:`setTimeout` 周期性调用 `fetchLatestBlueprintGenerationJob()`。
  //   4. Polling 失败退避(Requirement 5.4):
  //        - `attempt < 3` 使用 `baseInterval`;
  //        - `attempt >= 3` 使用 `min(base * 2^(attempt - 2), 120000)`。
  //   5. `pollingIntervalMs === 0` 或负数 / `NaN` → 完全禁用 SSE + polling
  //      (Requirement 5.5,测试或手动触发场景)。
  //   6. 组件 unmount 时:`source.close()` + `clearTimeout(pollingTimer)` + `closed = true`
  //      让 in-flight polling callback 自动短路。
  //
  // 设计决策:
  //   - 依赖数组只放 `[trimmedJobId, hasJob, autoRefreshEnabled, baseIntervalMs]`。
  //     `options.onJobStageChange / onFieldError` 的身份变化通过 ref 透传,避免订阅重建。
  //   - `state.job.data?.stage` 不进依赖:订阅建立后 stage 变化完全由 SSE `message` 事件
  //     驱动,若把 stage 放入依赖会在每次 stage 变化时关闭并重开 SSE 造成断流。
  //   - Targeted refetch 不走 `retryWave1()`(它只 bump counter 不改 W1 effect 依赖),而是
  //     直接 dispatch 独立 requestId 的 W1 fetch:与 W1 effect 共享 reducer 路径,
  //     Ignore_Stale_Policy 保证 stale 响应被正确丢弃。
  //   - 跨 `jobId` 的 in-flight SSE refetch 也会被 reducer 层拦截(`action.jobId !==
  //     state.currentJobId`)。
  // -------------------------------------------------------------------------
  const pollingIntervalMs = options?.pollingIntervalMs;
  const autoRefreshEnabled = isJobAutoRefreshEnabled(pollingIntervalMs);
  const baseIntervalMs = pollingIntervalMs ?? 15000;
  // 保留最新 onJobStageChange 引用（不进 effect 依赖），避免订阅重建。
  const onJobStageChangeRef =
    useRef<UseAutopilotRightRailDataOptions["onJobStageChange"]>(undefined);
  onJobStageChangeRef.current = options?.onJobStageChange;
  const onFieldErrorRef =
    useRef<UseAutopilotRightRailDataOptions["onFieldError"]>(undefined);
  onFieldErrorRef.current = options?.onFieldError;
  // W1 on*Change 回调的最新引用（SSE / polling 路径通过 ref 透传，不触发订阅重建）。
  const onJobChangeRef =
    useRef<UseAutopilotRightRailDataOptions["onJobChange"]>(undefined);
  onJobChangeRef.current = options?.onJobChange;
  const onRouteSetChangeRef =
    useRef<UseAutopilotRightRailDataOptions["onRouteSetChange"]>(undefined);
  onRouteSetChangeRef.current = options?.onRouteSetChange;
  const onSelectionChangeRef =
    useRef<UseAutopilotRightRailDataOptions["onSelectionChange"]>(undefined);
  onSelectionChangeRef.current = options?.onSelectionChange;
  const onSpecTreeChangeRef =
    useRef<UseAutopilotRightRailDataOptions["onSpecTreeChange"]>(undefined);
  onSpecTreeChangeRef.current = options?.onSpecTreeChange;

  useEffect(() => {
    if (!hasJob) return;
    if (!autoRefreshEnabled) return;

    let closed = false;
    let source: EventSource | null = null;
    let pollingTimer: ReturnType<typeof setTimeout> | null = null;
    let pollingAttempt = 0;
    // 闭包捕获的 prev stage：effect 初建时取 cache 中已知 job.stage（若 reducer 状态已经
    // seed），之后完全由 SSE / polling 解析结果更新；refetch 触发后 W1 的 FETCH_FULFILLED
    // 会异步更新 reducer 的 `state.job.data?.stage`，但 `prevStage` 只反映订阅层感知到的
    // stage 序列，避免外部 render 影响。
    const cachedJob = cacheRef.current.get(trimmedJobId)?.job as
      | BlueprintGenerationJob
      | null
      | undefined;
    let prevStage: string | null =
      cachedJob && typeof cachedJob.stage === "string" ? cachedJob.stage : null;

    const triggerTargetedRefetch = () => {
      if (closed) return;
      // 独立 requestId 的 W1 fetch；reducer 的 Ignore_Stale_Policy 会确保同字段 in-flight
      // 请求不会被老响应覆盖。
      const requestId = nextRequestId();
      dispatch({
        type: "FETCH_STARTED",
        jobId: trimmedJobId,
        fields: WAVE_1_FIELDS,
        requestId,
      });
      void (async () => {
        try {
          const result = await fetchLatestBlueprintGenerationJob();
          if (closed) return;
          if (!result.ok) {
            dispatch({
              type: "FETCH_REJECTED",
              jobId: trimmedJobId,
              requestId,
              fields: WAVE_1_FIELDS,
              error: result.error,
            });
            onFieldErrorRef.current?.("job", result.error);
            return;
          }
          const receivedJobId = result.data.job?.id;
          if (!receivedJobId || receivedJobId !== trimmedJobId) {
            dispatch({
              type: "FETCH_FULFILLED",
              jobId: trimmedJobId,
              requestId,
              fieldUpdates: {
                job: null,
                routeSet: null,
                selection: null,
                specTree: null,
              },
            });
            return;
          }
          dispatch({
            type: "FETCH_FULFILLED",
            jobId: trimmedJobId,
            requestId,
            fieldUpdates: deriveWave1FieldUpdates(result.data),
          });
          // W1 on*Change 回调：SSE / polling 路径通过 ref 透传最新 callback。
          onJobChangeRef.current?.(result.data.job ?? null);
          onRouteSetChangeRef.current?.(result.data.routeSet ?? null);
          onSelectionChangeRef.current?.(result.data.selection ?? null);
          onSpecTreeChangeRef.current?.(result.data.specTree ?? null);
          const entry: PartialCacheEntry =
            cacheRef.current.get(trimmedJobId) ?? {};
          entry.job = result.data.job ?? null;
          entry.routeSet = result.data.routeSet ?? null;
          entry.selection = result.data.selection ?? null;
          entry.specTree = result.data.specTree ?? null;
          cacheRef.current.set(trimmedJobId, entry);
        } catch (rawError) {
          if (closed) return;
          const error = coerceApiRequestError(
            rawError,
            "/api/blueprint/jobs/latest"
          );
          dispatch({
            type: "FETCH_REJECTED",
            jobId: trimmedJobId,
            requestId,
            fields: WAVE_1_FIELDS,
            error,
          });
          onFieldErrorRef.current?.("job", error);
        }
      })();
    };

    const handleStageFromPayload = (rawStage: unknown): void => {
      if (typeof rawStage !== "string") return;
      if (rawStage === prevStage) return;
      const previous = prevStage as BlueprintGenerationJob["stage"] | null;
      prevStage = rawStage;
      // stage 变化 → 通知 consumer + targeted refetch。stage 的联合体 narrow 交给
      // onJobStageChange 的调用方；reducer 应用 FETCH_FULFILLED 时会以后端权威值为准。
      onJobStageChangeRef.current?.(
        rawStage as BlueprintGenerationJob["stage"],
        previous
      );
      triggerTargetedRefetch();
    };

    const scheduleNextPoll = () => {
      if (closed) return;
      const interval = computePollingBackoff(baseIntervalMs, pollingAttempt);
      pollingTimer = setTimeout(() => {
        if (closed) return;
        void (async () => {
          try {
            const result = await fetchLatestBlueprintGenerationJob();
            if (closed) return;
            if (!result.ok) {
              pollingAttempt += 1;
              scheduleNextPoll();
              return;
            }
            const receivedStage = result.data.job?.stage;
            const receivedJobId = result.data.job?.id;
            if (receivedJobId === trimmedJobId && receivedStage) {
              handleStageFromPayload(receivedStage);
            }
            pollingAttempt = 0;
            scheduleNextPoll();
          } catch {
            if (closed) return;
            pollingAttempt += 1;
            scheduleNextPoll();
          }
        })();
      }, interval);
    };

    const startPolling = () => {
      if (closed) return;
      if (pollingTimer !== null) return;
      scheduleNextPoll();
    };

    const startSSE = () => {
      if (closed) return;
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      try {
        const url = fetchBlueprintJobEventStreamUrl(trimmedJobId);
        source = new EventSource(url);
      } catch {
        source = null;
        startPolling();
        return;
      }

      source.addEventListener("message", (event: MessageEvent) => {
        if (closed) return;
        try {
          const payload = JSON.parse(event.data);
          const nextStage = extractStageFromSSEPayload(payload);
          handleStageFromPayload(nextStage);
        } catch {
          // 忽略畸形 payload（非 JSON 或解析异常）。
        }
      });

      source.addEventListener("error", () => {
        if (closed) return;
        // 仅在 EventSource 定型为 CLOSED 时降级为 polling；short-lived 网络抖动让浏览器
        // 自行重连。
        if (source && source.readyState === EventSource.CLOSED) {
          source.close();
          source = null;
          startPolling();
        }
      });
    };

    startSSE();

    return () => {
      closed = true;
      if (source) {
        source.close();
        source = null;
      }
      if (pollingTimer !== null) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
      }
    };
    // 依赖只放 trimmedJobId / hasJob / autoRefreshEnabled / baseIntervalMs；`options.onJobStageChange`
    // 和 `options.onFieldError` 的身份变化通过 ref 透传，不触发订阅重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedJobId, hasJob, autoRefreshEnabled, baseIntervalMs]);

  // 预先计算 Wave 2 字段的 gate 状态,view 映射中直接复用。
  const wave2GateOpen = useMemo(() => {
    return shouldLoadField("agentCrew", {
      currentSubStage,
      jobStage,
      skipLazyLoad,
    });
  }, [currentSubStage, jobStage, skipLazyLoad]);

  // 预先计算 Wave 4 字段（`artifactFeedback` 派生部分）的 gate 状态。
  // `artifactEntries / artifactReplays` 的 gate 由 W4 effect 直接判定；这里的 gate 专用于
  // view 映射层决定 `artifactFeedback` 的可见性与 loading/error 绑定。
  const wave4GateOpen = useMemo(() => {
    return shouldLoadField("artifactFeedback", {
      currentSubStage,
      jobStage,
      skipLazyLoad,
    });
  }, [currentSubStage, jobStage, skipLazyLoad]);

  // `agentCrew` 是派生字段：
  //  - gate 打开（fabric 阶段 / skipLazyLoad）→ 从当前 `state.job.data` 派生；若 initialData
  //    提供了 agentCrew 作为首屏回退，则在派生结果为 null 时退回到它（常见于 /specs autoLoad
  //    路径，job 尚未加载但父组件已把 agentCrew 单独缓存）。
  //  - gate 关闭（非 fabric 阶段且未强制 skipLazyLoad）→ 暴露 `initialData.agentCrew ?? null`，
  //    `loading=false`、`error=null`。
  const initialAgentCrewFallback = initialData?.agentCrew ?? null;
  const derivedAgentCrew = useMemo<
    BlueprintAgentCrewSnapshot | null
  >(() => {
    if (!wave2GateOpen) {
      return initialAgentCrewFallback;
    }
    const fromJob = deriveAgentCrewFromJob(state.job.data);
    return fromJob ?? initialAgentCrewFallback;
  }, [wave2GateOpen, state.job.data, initialAgentCrewFallback]);

  // `artifactFeedback` 是派生字段（Requirement 12.5）：
  //  - gate 打开（artifact_memory / engineering_landing 或 skipLazyLoad）→ 从当前
  //    `state.job.data` 的 `artifacts` 中 `type === "feedback"` payload 派生；若派生结果
  //    为空且 initialData 提供了 artifactFeedback，则退回到 initialData。
  //  - gate 关闭（尚未进入 artifact 阶段且未 skipLazyLoad）→ 暴露
  //    `initialData.artifactFeedback ?? []`（保持数组形状，供 panel 组件直接消费）。
  //
  // 该字段不发起独立 HTTP 请求，loading/error 直接复用 `state.job` 的生命周期（W1 job
  // refetch 成功 / 失败即为 artifactFeedback 的刷新 / 错误）。
  const initialArtifactFeedbackFallback = initialData?.artifactFeedback ?? [];
  const derivedArtifactFeedback = useMemo<BlueprintArtifactFeedback[]>(() => {
    if (!wave4GateOpen) {
      return initialArtifactFeedbackFallback;
    }
    const fromJob = deriveArtifactFeedbackFromJob(state.job.data);
    return fromJob.length > 0 ? fromJob : initialArtifactFeedbackFallback;
  }, [wave4GateOpen, state.job.data, initialArtifactFeedbackFallback]);

  // -------------------------------------------------------------------------
  // Task 7：派生字段 `on*Change` 回调（`agentCrew` / `artifactFeedback`）。
  //
  // 这两个字段不通过独立 fetch 产出（`agentCrew` 由 job artifacts 派生；`artifactFeedback`
  // 由 job.artifacts 中 `type === "feedback"` 的 payload 派生），因此无法在 `FETCH_FULFILLED`
  // 路径里直接触发回调。改用 useEffect 观察派生值变化：当 `derivedAgentCrew` /
  // `derivedArtifactFeedback` 身份变化时调用 consumer 回调；首次挂载不触发（避免 initial
  // seed 造成冗余写回循环，行为与 W1-W4 fetch 路径的「仅在实际获取成功后通知」保持一致）。
  // -------------------------------------------------------------------------
  const onAgentCrewChangeRef =
    useRef<UseAutopilotRightRailDataOptions["onAgentCrewChange"]>(undefined);
  onAgentCrewChangeRef.current = options?.onAgentCrewChange;
  const onArtifactFeedbackChangeRef =
    useRef<
      UseAutopilotRightRailDataOptions["onArtifactFeedbackChange"]
    >(undefined);
  onArtifactFeedbackChangeRef.current = options?.onArtifactFeedbackChange;

  const lastNotifiedAgentCrewRef = useRef<BlueprintAgentCrewSnapshot | null>(
    derivedAgentCrew
  );
  useEffect(() => {
    if (lastNotifiedAgentCrewRef.current === derivedAgentCrew) return;
    lastNotifiedAgentCrewRef.current = derivedAgentCrew;
    onAgentCrewChangeRef.current?.(derivedAgentCrew);
  }, [derivedAgentCrew]);

  const lastNotifiedArtifactFeedbackRef = useRef<BlueprintArtifactFeedback[]>(
    derivedArtifactFeedback
  );
  useEffect(() => {
    if (lastNotifiedArtifactFeedbackRef.current === derivedArtifactFeedback)
      return;
    lastNotifiedArtifactFeedbackRef.current = derivedArtifactFeedback;
    onArtifactFeedbackChangeRef.current?.(derivedArtifactFeedback);
  }, [derivedArtifactFeedback]);

  // -------------------------------------------------------------------------
  // Task 7：Per-field `retry()`。
  //
  // 策略（design.md「推荐实现」简化方案）：
  //   - 每个字段暴露独立 `retry()` 闭包，但内部仍调用对应 Wave 的共享 `retryWaveN()`
  //     触发 effect 重跑（不做真正的 per-field 粒度刷新；这与现有 effect 架构兼容）。
  //   - Retry 受懒加载 gate 约束：非 W1 字段在 `shouldLoadField` 判定关闭时为 no-op，
  //     保持 `error` 不变。
  //   - In-flight guard：同字段 `pendingRequestId !== null` 时 retry 为 no-op，等价于
  //     「500ms 内去重」的更精确版本（整个 in-flight 窗口内都不重发）。
  //   - W1 字段 / 派生字段（`agentCrew`、`artifactFeedback`）均绑定 `retryWave1`。
  //
  // 稳定引用（Requirement 1.8）：retry 通过 `useRef<Map>` 保存最新 gate / state，通过
  // `useCallback` 构造 `retryField`（依赖仅 wave retry 与 `hasJob`）；`perFieldRetries`
  // 为 15 条 retry 的稳定 Map，只在底层 retry 重建时重建。父组件多次 render 时，
  // `view.xxx.retry` 的引用保持不变。
  // -------------------------------------------------------------------------

  const stateRef = useRef(state);
  stateRef.current = state;

  const gateParamsRef = useRef({
    currentSubStage,
    jobStage,
    skipLazyLoad,
    hasJob,
  });
  gateParamsRef.current = {
    currentSubStage,
    jobStage,
    skipLazyLoad,
    hasJob,
  };

  const retryField = useCallback(
    (field: RightRailFieldName) => {
      const gate = gateParamsRef.current;
      if (!gate.hasJob) return;
      const internal = stateRef.current[field] as InternalFieldState<unknown>;
      const allow = shouldTriggerPerFieldRetry(field, {
        hasJob: gate.hasJob,
        currentSubStage: gate.currentSubStage,
        jobStage: gate.jobStage,
        skipLazyLoad: gate.skipLazyLoad,
        pendingRequestId: internal.pendingRequestId,
      });
      if (!allow) return;
      // W1 字段 / 派生字段 → retryWave1
      if (
        field === "job" ||
        field === "routeSet" ||
        field === "selection" ||
        field === "specTree" ||
        field === "agentCrew" ||
        field === "artifactFeedback"
      ) {
        retryWave1();
        return;
      }
      if ((WAVE_2_FETCH_FIELDS as readonly string[]).includes(field)) {
        retryWave2();
        return;
      }
      if ((WAVE_3_FETCH_FIELDS as readonly string[]).includes(field)) {
        retryWave3();
        return;
      }
      if ((WAVE_4_FETCH_FIELDS as readonly string[]).includes(field)) {
        retryWave4();
        return;
      }
    },
    [retryWave1, retryWave2, retryWave3, retryWave4]
  );

  // 15 条稳定 per-field retry 闭包；依赖 `retryField`，后者仅在 wave retry 身份变化时重建。
  const perFieldRetries = useMemo(() => {
    const map = {} as Record<RightRailFieldName, () => void>;
    for (const field of ALL_FIELD_NAMES) {
      map[field] = () => retryField(field);
    }
    return map;
  }, [retryField]);

  // 把 reducer state 映射为 public `RightRailDataView`：剥离 `pendingRequestId`，挂接 retry。
  return useMemo<RightRailDataView>(() => {
    const toPublic = <T,>(
      internal: InternalFieldState<T>,
      retry: () => void
    ): RightRailDataFieldStatus<T> => ({
      data: internal.data,
      loading: internal.loading,
      error: internal.error,
      retry,
    });

    // agentCrew view：gate 打开时与 `view.job` 共享 loading/error 生命周期，data 使用派生值；
    // gate 关闭时退回 `initialData.agentCrew ?? null`，loading/error 清零。
    const agentCrewView: RightRailDataFieldStatus<BlueprintAgentCrewSnapshot> =
      wave2GateOpen
        ? {
            data: derivedAgentCrew,
            loading: state.job.loading,
            error: state.job.error,
            retry: perFieldRetries.agentCrew,
          }
        : {
            data: derivedAgentCrew,
            loading: false,
            error: null,
            retry: perFieldRetries.agentCrew,
          };

    // artifactFeedback view：派生字段，与 `view.job` 共享 loading/error 生命周期。
    // - gate 打开 → data 使用 `deriveArtifactFeedbackFromJob` 派生值，loading/error 沿 state.job；
    // - gate 关闭 → data 退回 `initialData.artifactFeedback ?? []`，loading/error 清零；
    // - retry 通过 per-field retry 绑定到 `retryWave1`（刷新 W1 job 会自动带出最新 feedback）。
    const artifactFeedbackView: RightRailDataFieldStatus<
      BlueprintArtifactFeedback[]
    > = wave4GateOpen
      ? {
          data: derivedArtifactFeedback,
          loading: state.job.loading,
          error: state.job.error,
          retry: perFieldRetries.artifactFeedback,
        }
      : {
          data: derivedArtifactFeedback,
          loading: false,
          error: null,
          retry: perFieldRetries.artifactFeedback,
        };

    return {
      // Wave 1 per-field retries 均路由到 retryWave1（从同一次 W1 snapshot 派生）。
      job: toPublic(state.job, perFieldRetries.job),
      routeSet: toPublic(state.routeSet, perFieldRetries.routeSet),
      selection: toPublic(state.selection, perFieldRetries.selection),
      specTree: toPublic(state.specTree, perFieldRetries.specTree),
      // Wave 2：agentCrew 派生 + 其余 3 个字段各自通过 per-field retry 路由到 retryWave2。
      agentCrew: agentCrewView,
      capabilities: toPublic(state.capabilities, perFieldRetries.capabilities),
      capabilityInvocations: toPublic(
        state.capabilityInvocations,
        perFieldRetries.capabilityInvocations
      ),
      capabilityEvidence: toPublic(
        state.capabilityEvidence,
        perFieldRetries.capabilityEvidence
      ),
      // Wave 3：4 个字段各自通过 per-field retry 路由到 retryWave3。
      effectPreviews: toPublic(
        state.effectPreviews,
        perFieldRetries.effectPreviews
      ),
      promptPackages: toPublic(
        state.promptPackages,
        perFieldRetries.promptPackages
      ),
      landingPlans: toPublic(state.landingPlans, perFieldRetries.landingPlans),
      engineeringRuns: toPublic(
        state.engineeringRuns,
        perFieldRetries.engineeringRuns
      ),
      // Wave 4：`artifactEntries / artifactReplays` 通过 per-field retry 路由到 retryWave4；
      // `artifactFeedback` 为派生字段，retry 走 retryWave1（见上方 view 构造）。
      artifactEntries: toPublic(
        state.artifactEntries,
        perFieldRetries.artifactEntries
      ),
      artifactReplays: toPublic(
        state.artifactReplays,
        perFieldRetries.artifactReplays
      ),
      artifactFeedback: artifactFeedbackView,
    };
  }, [
    state,
    wave2GateOpen,
    wave4GateOpen,
    derivedAgentCrew,
    derivedArtifactFeedback,
    perFieldRetries,
  ]);
}

// ---------------------------------------------------------------------------
// Internal request id counter
// ---------------------------------------------------------------------------

/**
 * 单调递增的 request id 计数器（模块级）。用于 Ignore_Stale_Policy：reducer 比较
 * `action.requestId` 与 `state.field.pendingRequestId`，不匹配则忽略。
 *
 * 模块级而非 `useRef<number>`：request id 必须在 hook 的多个 render 之间单调递增，模块级
 * 计数器保证了这一点；即使多个 consumer 同时挂载，每次 fetch 仍能拿到唯一 id。
 */
let REQUEST_ID_COUNTER = 0;

function nextRequestId(): number {
  REQUEST_ID_COUNTER += 1;
  return REQUEST_ID_COUNTER;
}

/**
 * 将意外的 `throw`（例如同步抛错或网络层未封装为 `FetchJsonSafeResult` 的异常）转换为统一
 * `ApiRequestError`。hook 规约：async 异常不得穿透到 React render path，全部转为 field
 * status 中的 `error`。
 */
function coerceApiRequestError(raw: unknown, endpoint: string): ApiRequestError {
  if (
    raw &&
    typeof raw === "object" &&
    "kind" in raw &&
    "source" in raw &&
    "endpoint" in raw
  ) {
    // 已经是 ApiRequestError 形状（来自 `{ ok: false, error }` 的解构）
    return raw as ApiRequestError;
  }
  return {
    kind: "error",
    source: "network",
    endpoint,
    message: raw instanceof Error ? raw.message : "unexpected error",
    detail:
      raw instanceof Error && raw.stack
        ? raw.stack
        : "useAutopilotRightRailData: fetch threw synchronously",
    retryable: true,
  };
}

// ---------------------------------------------------------------------------
// Testing-only exports
// ---------------------------------------------------------------------------

/**
 * 测试专用：导出 reducer 与构造 helper 供单元测试直接断言 pure 转换规则。
 * 外部消费者不应依赖这些 symbol；命名加下划线前缀作为提示。
 */
export const __testing__ = {
  rightRailDataReducer,
  buildInitialReducerState,
  deriveWave1FieldUpdates,
  WAVE_1_FIELDS,
  WAVE_2_FETCH_FIELDS,
  WAVE_3_FETCH_FIELDS,
  WAVE_4_FETCH_FIELDS,
  ALL_FIELD_NAMES,
  // Task 3：Wave 2 helpers
  shouldLoadField,
  deriveAgentCrewFromJob,
  mergeCapabilities,
  coerceApiRequestError,
  // Task 5：Wave 4 helpers
  deriveArtifactFeedbackFromJob,
  // Task 6：SSE + polling helpers
  isJobAutoRefreshEnabled,
  computePollingBackoff,
  extractStageFromSSEPayload,
  // Task 7：per-field retry helper
  shouldTriggerPerFieldRetry,
};
