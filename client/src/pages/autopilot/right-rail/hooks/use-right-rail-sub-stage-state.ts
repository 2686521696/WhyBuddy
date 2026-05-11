/**
 * Autopilot 右栏子阶段 state hook —— Task 1 骨架
 *
 * 对应 spec：`.kiro/specs/autopilot-step-driven-rail-navigation/`
 * - Requirement 6.1：hook 在 `AutopilotRoutePage` fabric 分支调用，而非 `<AutopilotRightRail>` 内部
 * - Requirement 6.5：hook 不订阅 `useAppStore` / `useProjectStore`；不写 `localStorage` / `sessionStorage`
 * - Requirement 6.6：`setPinnedSubStage` 通过 `useCallback` 稳定引用；同时更新内部 state 与写 URL（Task 2 实现）
 * - Requirement 12.9：文件改动范围限定在 `client/src/pages/autopilot/right-rail/hooks/` 下
 *
 * Task 1 范围：仅建立 hook 契约、Context 结构、fallback 降级对象；
 * URL 读写、sticky pin 真实实现、键盘快捷键均留待 Task 2 及之后的任务。
 *
 * 硬性约束：
 * - 不读 `window.location` / `window.history`（Task 2 落地）
 * - 不订阅 store；不调用 `resolveRailSubStage()`（由 consumer 在 `AutopilotRoutePage` 计算后作为
 *   `resolvedSubStage` 输入）
 * - `setPinnedSubStage / resetPin / togglePin` 在 Task 1 全部为 no-op，确保类型与消费面先对齐
 */

import { createContext, useContext, useMemo } from "react";

import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import type { AutopilotRailSubStage } from "../types";

/**
 * Sub_Stage_State_Hook 的返回值（同时是 Context 的载荷）。
 *
 * 字段语义：
 * - `effectiveSubStage`：权威的当前子阶段；`pinnedSubStage ?? resolvedSubStage`。
 * - `pinnedSubStage`：用户手动固定的子阶段；`null` 表示跟随派生。
 * - `isPinned`：`pinnedSubStage !== null` 的派生布尔值。
 * - `setPinnedSubStage(next)`：设置固定子阶段；`null` 表示恢复跟随。Task 2 中会同时写 URL。
 * - `resetPin()`：等价于 `setPinnedSubStage(null)`。
 * - `togglePin()`：根据当前 pin 状态在「固定到 resolvedSubStage」与「恢复跟随」间切换。
 */
export interface RightRailSubStageContextValue {
  effectiveSubStage: AutopilotRailSubStage | undefined;
  pinnedSubStage: AutopilotRailSubStage | null;
  isPinned: boolean;
  setPinnedSubStage: (next: AutopilotRailSubStage | null) => void;
  resetPin: () => void;
  togglePin: () => void;
}

/**
 * Hook 输入参数。
 *
 * - `jobStage`：来自 `latestJob?.stage ?? null`；用于未来判定非 fabric 阶段下的 URL 写入时机
 *   （Requirement 1.5）。Task 1 暂未消费。
 * - `resolvedSubStage`：由 consumer 在 `AutopilotRoutePage` 通过 Spec 1 `resolveRailSubStage()`
 *   计算后传入；hook 内部不重复调用 resolver。
 */
export interface UseRightRailSubStageStateInput {
  jobStage: BlueprintGenerationJob["stage"] | null;
  resolvedSubStage: AutopilotRailSubStage | undefined;
}

/**
 * Context 缺失时（例如 `/specs` 页面或测试未包裹 Provider）的降级对象。
 *
 * 所有 setter 为 no-op，`isPinned` 恒为 `false`，`pinnedSubStage` 恒为 `null`。
 * `effectiveSubStage` 设为 `undefined`，因为 Context 缺失时没有可靠的权威源。
 *
 * 导出为常量以便测试断言引用相等性。
 */
export const NULL_CONTEXT_FALLBACK: RightRailSubStageContextValue = {
  effectiveSubStage: undefined,
  pinnedSubStage: null,
  isPinned: false,
  setPinnedSubStage: () => {
    /* no-op */
  },
  resetPin: () => {
    /* no-op */
  },
  togglePin: () => {
    /* no-op */
  },
};

/**
 * Right rail sub-stage Context。
 *
 * Provider 由 `AutopilotRoutePage` 在 fabric 分支包裹 `<AutopilotRightRail>`（Task 7）；
 * `<AutopilotRightRail>` 内部通过 `useRightRailSubStageContext()` 读 `togglePin / isPinned`，
 * 避免扩展 Spec 1 冻结的 `AutopilotRightRailProps` 9 字段契约。
 */
export const RightRailSubStageContext =
  createContext<RightRailSubStageContextValue | null>(null);

/**
 * 读取 Right rail sub-stage Context 的 helper。
 *
 * 在 Provider 外使用时返回 `NULL_CONTEXT_FALLBACK` 降级对象（不抛错），
 * 以便 `<AutopilotRightRail>` 在 `/specs` 等无 Provider 场景下继续渲染；
 * 此时键盘快捷键、sticky toggle 等交互均为 no-op（Requirement 9）。
 */
export function useRightRailSubStageContext(): RightRailSubStageContextValue {
  const value = useContext(RightRailSubStageContext);
  return value ?? NULL_CONTEXT_FALLBACK;
}

/**
 * `useRightRailSubStageState` —— Task 1 骨架实现。
 *
 * 当前行为：
 * - `effectiveSubStage` 直接返回输入的 `resolvedSubStage`（pin 能力留给 Task 2）
 * - `pinnedSubStage` 恒为 `null`
 * - `isPinned` 恒为 `false`
 * - 所有 setter 为 no-op
 *
 * 返回值通过 `useMemo` 包裹以保持引用稳定，避免 `<AutopilotRightRail>` 因 Context value
 * 身份变化而触发不必要的 re-render。
 *
 * Task 2 会在此基础上补：
 * - 读写 `window.history.replaceState` 与 URL `?sub` 参数
 * - 真实的 pinnedSubStage state + setter
 * - 首次挂载时非法 URL 清理
 */
export function useRightRailSubStageState(
  _input: UseRightRailSubStageStateInput,
): RightRailSubStageContextValue {
  const { resolvedSubStage } = _input;

  return useMemo<RightRailSubStageContextValue>(
    () => ({
      effectiveSubStage: resolvedSubStage,
      pinnedSubStage: null,
      isPinned: false,
      setPinnedSubStage: () => {
        /* no-op — Task 2 实现 */
      },
      resetPin: () => {
        /* no-op — Task 2 实现 */
      },
      togglePin: () => {
        /* no-op — Task 2 实现 */
      },
    }),
    [resolvedSubStage],
  );
}
