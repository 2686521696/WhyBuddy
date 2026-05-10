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
 *
 * 本文件目前包含的硬边界：
 * - 只发起 Wave 1 `fetchLatestBlueprintGenerationJob()`；当 `initialData.job.id === jobId` 时
 *   跳过首次 fetch（避免在父组件已持有 job 状态时发起 N+1 请求，Requirement 6.1）。
 * - `routeSet / selection / specTree` 从 Wave 1 快照派生（不发起独立 fetch）。
 * - Wave 2-4 的字段仍为占位 `loading=false`；Task 3-5 会逐步接入真实 fetch。
 * - SSE / polling / 指数退避由 Task 6 实现；当前版本不启动任何 `EventSource` 或 `setTimeout`。
 * - `retry` 当前只覆盖 W1 字段（job + 3 个派生字段共享同一次 refetch）；W2-W4 的 retry 由
 *   Task 3-5 分别接入。
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
  fetchLatestBlueprintGenerationJob,
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
  // Task 2 下 W2-W4 还没有真实 fetch 结果写入，因此这里先建好骨架；Task 3-5 会写入。
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

  // Wave 2-4 retry 占位（Task 3-7 会替换为真实实现）。
  // 绑定到 jobId 确保「仅在 jobId 变化时重建」的稳定引用契约。
  const noopRetry = useCallback(() => {
    /* Task 3-7 会接入 W2-W4 retry */
  }, [trimmedJobId]);

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
    return {
      // Wave 1 共享 retryWave1
      job: toPublic(state.job, retryWave1),
      routeSet: toPublic(state.routeSet, retryWave1),
      selection: toPublic(state.selection, retryWave1),
      specTree: toPublic(state.specTree, retryWave1),
      // Wave 2 占位
      agentCrew: toPublic(state.agentCrew, noopRetry),
      capabilities: toPublic(state.capabilities, noopRetry),
      capabilityInvocations: toPublic(state.capabilityInvocations, noopRetry),
      capabilityEvidence: toPublic(state.capabilityEvidence, noopRetry),
      // Wave 3 占位
      effectPreviews: toPublic(state.effectPreviews, noopRetry),
      promptPackages: toPublic(state.promptPackages, noopRetry),
      landingPlans: toPublic(state.landingPlans, noopRetry),
      engineeringRuns: toPublic(state.engineeringRuns, noopRetry),
      // Wave 4 占位
      artifactEntries: toPublic(state.artifactEntries, noopRetry),
      artifactReplays: toPublic(state.artifactReplays, noopRetry),
      artifactFeedback: toPublic(state.artifactFeedback, noopRetry),
    };
  }, [state, retryWave1, noopRetry]);
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
  ALL_FIELD_NAMES,
};
