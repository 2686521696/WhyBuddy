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
 * - Wave 4 的字段仍为占位 `loading=false`；Task 5 会接入真实 fetch。
 * - SSE / polling / 指数退避由 Task 6 实现；当前版本不启动任何 `EventSource` 或 `setTimeout`。
 * - `retry` 当前只覆盖 W1 字段（job + 3 个派生字段共享同一次 refetch）；W2 的 `agentCrew.retry`
 *   与 `job.retry` 行为一致（共享 Wave 1 refetch）；W2 其余 3 个字段共享 `retryWave2`；W3 的
 *   4 个字段共享 `retryWave3`（共享一次 Wave 3 fetch 重跑）；W4 字段与 per-field retry 的
 *   in-flight guard 由 Task 5/7 接入。
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
  fetchBlueprintCapabilities,
  fetchBlueprintCapabilityEvidence,
  fetchBlueprintCapabilityInvocations,
  fetchBlueprintEffectPreviews,
  fetchBlueprintEngineeringLanding,
  fetchBlueprintEngineeringRuns,
  fetchBlueprintJobCapabilities,
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
  return {
    job: snapshot.job ?? null,
    routeSet: snapshot.routeSet ?? null,
    selection: snapshot.selection ?? null,
    specTree: snapshot.specTree ?? null,
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
 * Task 3-4 实现范围：Wave 2 与 Wave 3 的 case 均返回真实规则，Wave 4 的 case 仍为 `false`
 * 占位；Task 5 会把 Wave 4 的规则接入。
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
      // Wave 4：Task 5 会扩展真实规则。
      return false;
    default:
      return false;
  }
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
  // 注：`refetchTrigger` 是 W1 retry 时递增的本地计数器，用于强制 effect 重新执行。
  const refetchTriggerRef = useRef(0);
  const [, forceRefetchBump] = useReducer((x: number) => x + 1, 0);

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
  }, [trimmedJobId, hasJob]);

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

  // Wave 4 retry 占位（Task 5/7 会替换为真实实现）。
  // 绑定到 jobId 确保「仅在 jobId 变化时重建」的稳定引用契约。
  const noopRetry = useCallback(() => {
    /* Task 5/7 会接入 W4 retry */
  }, [trimmedJobId]);

  // 预先计算 Wave 2 字段的 gate 状态，view 映射中直接复用。
  const wave2GateOpen = useMemo(() => {
    return shouldLoadField("agentCrew", {
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
            retry: retryWave1,
          }
        : {
            data: derivedAgentCrew,
            loading: false,
            error: null,
            retry: retryWave1,
          };

    return {
      // Wave 1 共享 retryWave1
      job: toPublic(state.job, retryWave1),
      routeSet: toPublic(state.routeSet, retryWave1),
      selection: toPublic(state.selection, retryWave1),
      specTree: toPublic(state.specTree, retryWave1),
      // Wave 2：agentCrew 派生 + 其余 3 个字段共享 retryWave2
      agentCrew: agentCrewView,
      capabilities: toPublic(state.capabilities, retryWave2),
      capabilityInvocations: toPublic(state.capabilityInvocations, retryWave2),
      capabilityEvidence: toPublic(state.capabilityEvidence, retryWave2),
      // Wave 3：4 个字段共享 retryWave3
      effectPreviews: toPublic(state.effectPreviews, retryWave3),
      promptPackages: toPublic(state.promptPackages, retryWave3),
      landingPlans: toPublic(state.landingPlans, retryWave3),
      engineeringRuns: toPublic(state.engineeringRuns, retryWave3),
      // Wave 4 占位
      artifactEntries: toPublic(state.artifactEntries, noopRetry),
      artifactReplays: toPublic(state.artifactReplays, noopRetry),
      artifactFeedback: toPublic(state.artifactFeedback, noopRetry),
    };
  }, [
    state,
    wave2GateOpen,
    derivedAgentCrew,
    retryWave1,
    retryWave2,
    retryWave3,
    noopRetry,
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
  ALL_FIELD_NAMES,
  // Task 3：Wave 2 helpers
  shouldLoadField,
  deriveAgentCrewFromJob,
  mergeCapabilities,
  coerceApiRequestError,
};
