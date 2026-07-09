/**
 * Autopilot 进度节奏可视化 — 进度计算 hook 与纯函数实现
 *
 * 本文件是 `.kiro/specs/autopilot-stage-progress-indicator/` 任务 1.1 的落地点：
 * - 消费 `useBlueprintRealtimeStore.agentReasoning.entries`，按 `entry.stageId`
 *   归并到 6 个 `WorkbenchStage` 中。
 * - 根据 entries 在阶段间的分布，派生 `completedStages` / `activeStage` /
 *   `stageProgress` / `isIndeterminate` 四个字段，构成 `StageProgressState`。
 * - `computeStageProgress` 作为纯函数独立导出，方便 SSR 渲染与 PBT 直接验证
 *   「确定态范围约束」与「不确定态对数增长单调递增」两条性质。
 *
 * 硬性约束（与 design.md / requirements.md 对齐）：
 * - 纯函数 `computeStageProgress` 不读 store、不依赖 `Date.now()` / `Math.random()`、
 *   不修改入参，对相同入参返回值全等。
 * - 配置 `STAGE_ESTIMATED_ENTRIES` 中 `null` 表示 entries 总数无法预估，需要走对数
 *   增长曲线（不确定态）；其余阶段使用 `entriesInStage / estimatedTotal × 100`
 *   的确定态计算。
 * - hook 自身只读 store，不写 store；不发起任何 API；不维护副作用。
 */

import { useMemo } from "react";

import {
  useBlueprintRealtimeStore,
  type AgentReasoningEntry,
} from "@/lib/blueprint-realtime-store";

import type { WorkbenchStage } from "../stage-viewport/stage-config";
import { STAGE_ORDER } from "../stage-viewport/stage-config";

// ─── 配置常量 ────────────────────────────────────────────────────────────────

/**
 * 每个阶段的 entry 预估总数。
 *
 * - `null` 表示该阶段 entries 总量无法预估（如澄清依赖用户回合数、文档生成依赖
 *   节点数），此时 `computeStageProgress` 走对数增长曲线，避免长时间停留在低
 *   百分比。
 * - 数值表示该阶段相对稳定的 entry 总数估计；`computeStageProgress` 走线性
 *   `entriesInStage / estimatedTotal × 100` 计算。
 *
 * 取值参考 `requirements.md` 需求 4.2 / 4.3 与 `design.md`「进度计算逻辑」段。
 */
export const STAGE_ESTIMATED_ENTRIES: Record<WorkbenchStage, number | null> = {
  input: 1,
  clarification: null,
  route: 8,
  spec_tree: 12,
  spec_documents: null,
  effect_preview: 5,
};

/**
 * 后端 `entry.stageId` 字面量到本 spec 6 阶段 `WorkbenchStage` 的归并映射。
 *
 * 后端目前会出现的 stage 字面量包括：`input` / `clarification` /
 * `route_generation` / `route_selection` / `spec_tree` / `spec_docs` /
 * `preview` / `effect_preview`。其它阶段（`agent_crew_fabric` / `prompt_packaging`
 * 等）当前不参与本 spec 的 6 阶段步骤指示器，统一返回 `null` 由调用方丢弃。
 */
function mapStageIdToWorkbenchStage(
  stageId: string | undefined
): WorkbenchStage | null {
  if (!stageId) return null;
  switch (stageId) {
    case "input":
      return "input";
    case "clarification":
      return "clarification";
    case "route_generation":
    case "route_selection":
      return "route";
    case "spec_tree":
      return "spec_tree";
    case "spec_docs":
    case "spec_documents":
      return "spec_documents";
    case "preview":
    case "effect_preview":
      return "effect_preview";
    default:
      return null;
  }
}

// ─── 类型契约 ────────────────────────────────────────────────────────────────

/**
 * `useStageProgress` 派生出的进度状态。
 *
 * - `completedStages`：所有「已收到 entry 且 index 严格小于 activeStage」的阶段。
 * - `activeStage`：当前正在执行的阶段，取自 6 阶段中收到过 entry 的最大 index。
 *   尚未收到任何 entry 时回退到 `STAGE_ORDER[0]`（即 `input`）。
 * - `stageProgress`：`activeStage` 内部的完成百分比，范围始终在 `[0, 100]`。
 * - `isIndeterminate`：当 `activeStage` 的预估总数为 `null` 时为 `true`，
 *   UI 应改为不确定态动画展示。
 */
export interface StageProgressState {
  completedStages: Set<WorkbenchStage>;
  activeStage: WorkbenchStage;
  stageProgress: number;
  isIndeterminate: boolean;
}

/**
 * `computeStageProgress` 的纯函数返回值。
 *
 * 单独抽出便于在 hook 之外（SSR / PBT / 单测）直接验证 progress 范围与
 * 不确定态语义。
 */
export interface ComputeStageProgressResult {
  progress: number;
  isIndeterminate: boolean;
}

// ─── 纯函数实现 ──────────────────────────────────────────────────────────────

/**
 * 根据当前阶段已收到的 entries 数量与预估总数，计算阶段内进度百分比。
 *
 * - 确定态（`estimatedTotal` 为正整数）：
 *   `progress = min(100, entriesInStage / estimatedTotal × 100)`
 *   并强制下限为 `0`，保证 `entriesInStage < 0` 等异常输入也能返回合法值。
 * - 不确定态（`estimatedTotal === null`）：使用对数增长曲线模拟进度，
 *   `progress = 60 × (1 - 1 / (1 + ln(1 + entries)))`，并取 `min(95, ...)`
 *   作为上限，避免在等待终态前误显示 100%。
 *
 * 返回的 `progress` 始终落在 `[0, 100]` 闭区间内（见 design.md Property 1）。
 */
export function computeStageProgress(
  entriesInStage: number,
  estimatedTotal: number | null
): ComputeStageProgressResult {
  const safeEntries =
    Number.isFinite(entriesInStage) && entriesInStage > 0 ? entriesInStage : 0;

  if (estimatedTotal === null) {
    // 对数增长曲线：快速到 60%，然后逐渐放缓；上限 95，留出"完成态" headroom。
    const raw = 60 * (1 - 1 / (1 + Math.log(1 + safeEntries)));
    const progress = Math.max(0, Math.min(95, raw));
    return { progress, isIndeterminate: true };
  }

  if (estimatedTotal <= 0) {
    return { progress: 0, isIndeterminate: false };
  }

  const raw = (safeEntries / estimatedTotal) * 100;
  const progress = Math.max(0, Math.min(100, raw));
  return { progress, isIndeterminate: false };
}

// ─── 内部派生工具 ────────────────────────────────────────────────────────────

/**
 * 把 `agentReasoning.entries` 按 `WorkbenchStage` 聚合成「阶段 → entry 数量」的
 * Record；不属于 6 阶段的 entry 直接丢弃。
 */
function countEntriesByStage(
  entries: readonly AgentReasoningEntry[]
): Record<WorkbenchStage, number> {
  const counts: Record<WorkbenchStage, number> = {
    input: 0,
    clarification: 0,
    route: 0,
    spec_tree: 0,
    spec_documents: 0,
    effect_preview: 0,
  };

  for (const entry of entries) {
    const stage = mapStageIdToWorkbenchStage(entry.stageId);
    if (stage !== null) {
      counts[stage] += 1;
    }
  }

  return counts;
}

/**
 * 根据「阶段 → entry 数量」的统计，按 `STAGE_ORDER` 找到「收到过 entry 的最大
 * index 阶段」作为 `activeStage`；尚未收到任何 entry 时回退到第一个阶段。
 */
function deriveActiveStage(
  counts: Record<WorkbenchStage, number>
): { activeStage: WorkbenchStage; activeIndex: number } {
  let activeIndex = 0;
  for (let index = STAGE_ORDER.length - 1; index >= 0; index -= 1) {
    if (counts[STAGE_ORDER[index]] > 0) {
      activeIndex = index;
      break;
    }
  }
  return { activeStage: STAGE_ORDER[activeIndex], activeIndex };
}

/**
 * 根据 `activeIndex` 把所有严格更早的阶段标记为已完成，组装成 `Set`。
 */
function deriveCompletedStages(activeIndex: number): Set<WorkbenchStage> {
  const completed = new Set<WorkbenchStage>();
  for (let index = 0; index < activeIndex; index += 1) {
    completed.add(STAGE_ORDER[index]);
  }
  return completed;
}

// ─── React hook ──────────────────────────────────────────────────────────────

/**
 * 消费实时 store 中的 `agentReasoning.entries`，派生进度节奏可视化所需的
 * 4 字段状态：`completedStages` / `activeStage` / `stageProgress` /
 * `isIndeterminate`。
 *
 * - 仅订阅 `agentReasoning.entries` 这一引用，避免无关字段更新触发重渲染。
 * - 通过 `useMemo` 在 entries 引用未变时复用上一次结果，让上层 React.memo
 *   组件的 props 引用保持稳定。
 * - `Set<WorkbenchStage>` 在每次重新派生时都是新对象引用；上层若关心引用
 *   稳定性，可基于 `activeStage + stageProgress` 做二级 memo。
 */
export function useStageProgress(): StageProgressState {
  const entries = useBlueprintRealtimeStore(
    (state) => state.agentReasoning.entries
  );

  return useMemo<StageProgressState>(() => {
    const counts = countEntriesByStage(entries);
    const { activeStage, activeIndex } = deriveActiveStage(counts);
    const completedStages = deriveCompletedStages(activeIndex);
    const { progress, isIndeterminate } = computeStageProgress(
      counts[activeStage],
      STAGE_ESTIMATED_ENTRIES[activeStage]
    );

    return {
      completedStages,
      activeStage,
      stageProgress: progress,
      isIndeterminate,
    };
  }, [entries]);
}
