/**
 * Autopilot 右栏子阶段 state hook —— Task 2 完成态
 *
 * 对应 spec：`.kiro/specs/autopilot-step-driven-rail-navigation/`
 * - Requirement 1.1-1.7：URL `?sub=xxx` 同步（读 / 写 / 非法值降级）
 * - Requirement 2.6：Pinned_Sub_Stage 仅 session scope（URL 层），不写 localStorage / sessionStorage
 * - Requirement 6.1：hook 在 `AutopilotRoutePage` fabric 分支调用，而非 `<AutopilotRightRail>` 内部
 * - Requirement 6.5：hook 不订阅 `useAppStore` / `useProjectStore`；不写 `localStorage` / `sessionStorage`
 * - Requirement 6.6：`setPinnedSubStage` 通过 `useCallback` 稳定引用；同时更新内部 state 与写 URL
 * - Requirement 6.7：`resetPin()` 等价于 `setPinnedSubStage(null)`；清除 URL `?sub` 参数
 *
 * Task 2 范围：真实 URL 读写、lazy state 初始化、非法 URL 清理、setPinned/reset/toggle 三 setter。
 * Task 3+ 会在 `<AutopilotRightRail>` 内部新增 scroll container、键盘快捷键、Viewport_Tier 分支等。
 *
 * 硬性约束：
 * - 使用 `window.history.replaceState` 而非 `pushState`（Requirement 1.6）
 * - URL 写入通过手动构造 `URLSearchParams`，不依赖 `wouter` 的 navigate（Requirement 1.7）
 * - 不订阅 store；不调用 `resolveRailSubStage()`（由 consumer 在 `AutopilotRoutePage` 计算后作为
 *   `resolvedSubStage` 输入）
 * - URL 解析 / 应用拆成 pure layer（`parseSubFromSearch` / `applySubToSearch`），仅通过字符串交互，
 *   以便测试在 node 环境下直接覆盖，不依赖 jsdom
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import { RAIL_SUB_STAGE_ORDER, type AutopilotRailSubStage } from "../types";

/**
 * Sub_Stage_State_Hook 的返回值（同时是 Context 的载荷）。
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
 */
export interface UseRightRailSubStageStateInput {
  jobStage: BlueprintGenerationJob["stage"] | null;
  resolvedSubStage: AutopilotRailSubStage | undefined;
}

/**
 * Context 缺失时的降级对象。所有 setter 为 no-op；`isPinned` 恒为 `false`。
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
 */
export const RightRailSubStageContext =
  createContext<RightRailSubStageContextValue | null>(null);

/**
 * 读取 Context；Provider 外返回 `NULL_CONTEXT_FALLBACK`。
 */
export function useRightRailSubStageContext(): RightRailSubStageContextValue {
  const value = useContext(RightRailSubStageContext);
  return value ?? NULL_CONTEXT_FALLBACK;
}

// =============================================================================
// Pure helpers (不依赖 window，供 unit 测试在 node 环境直接调用)
// =============================================================================

/**
 * 判断字符串是否为合法的 `AutopilotRailSubStage`。
 *
 * 严格大小写匹配 `RAIL_SUB_STAGE_ORDER`；空字符串、`null` / `undefined`、
 * 未知字符串、大小写不匹配全部视为非法（Requirement 1.3）。
 */
function isValidSubStage(
  value: string | null | undefined,
): value is AutopilotRailSubStage {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  return (RAIL_SUB_STAGE_ORDER as readonly string[]).includes(value);
}

/**
 * 从查询字符串（可含或不含开头 `?`）中解析并校验 `sub` 参数。
 *
 * 本函数不依赖 `window`，可在 node 环境下被 unit 测试直接覆盖。
 */
function parseSubFromSearch(search: string | null | undefined): AutopilotRailSubStage | null {
  if (!search) {
    return null;
  }
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const raw = params.get("sub");
    return isValidSubStage(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 把 `next` 应用到 `search`，返回新查询字符串（不含开头 `?`）。
 *
 * - `next === null` → 删除 `sub` 参数
 * - `next !== null` → 写入 / 覆盖 `sub` 参数
 * - 保留 `search` 中除 `sub` 之外的所有参数
 *
 * 本函数不依赖 `window`，可在 node 环境下被 unit 测试直接覆盖。
 */
function applySubToSearch(
  search: string | null | undefined,
  next: AutopilotRailSubStage | null,
): string {
  const params = new URLSearchParams(
    search ? (search.startsWith("?") ? search.slice(1) : search) : "",
  );
  if (next === null) {
    params.delete("sub");
  } else {
    params.set("sub", next);
  }
  return params.toString();
}

// =============================================================================
// Scroll behavior helpers (不依赖 window，供组件与 unit 测试共享)
// =============================================================================

/**
 * 根据首次挂载 / 用户动效偏好决策 `scrollIntoView` 的 behavior。
 *
 * - 首次挂载（`isFirstMount === true`）：返回 `"auto"`，避免 URL 恢复或派生初始位置时
 *   出现视觉跳变（Requirement 3.4）。
 * - `prefers-reduced-motion: reduce` 命中时：返回 `"auto"`（Requirement 3.2）。
 * - 其他情况：返回 `"smooth"`。
 *
 * 本函数为纯函数，不依赖 `window` / DOM，可以在 node 环境下被测试直接调用。
 */
function resolveScrollBehavior(opts: {
  isFirstMount: boolean;
  prefersReducedMotion: boolean;
}): ScrollBehavior {
  if (opts.isFirstMount) {
    return "auto";
  }
  if (opts.prefersReducedMotion) {
    return "auto";
  }
  return "smooth";
}

/**
 * 在指定 scroll container 内查找 anchor 并调用 `scrollIntoView`。
 *
 * - `container == null` → 返回 `false`
 * - anchor 未找到 → 返回 `false`（Requirement 3.3）
 * - anchor 找到但缺少 `scrollIntoView`（如测试 stub 元素）→ 返回 `false`
 * - 成功调用 → 返回 `true`
 *
 * 不抛错；纯逐步 early-return，便于测试覆盖所有分支。
 */
function scrollAnchorIntoView(params: {
  container: Element | null;
  anchorAttr: string;
  anchorValue: string;
  behavior: ScrollBehavior;
  block?: ScrollLogicalPosition;
}): boolean {
  if (!params.container) {
    return false;
  }
  const selector = `[${params.anchorAttr}="${params.anchorValue}"]`;
  let anchor: Element | null;
  try {
    anchor = params.container.querySelector(selector);
  } catch {
    return false;
  }
  if (!anchor) {
    return false;
  }
  const el = anchor as HTMLElement;
  if (typeof el.scrollIntoView !== "function") {
    return false;
  }
  try {
    el.scrollIntoView({ behavior: params.behavior, block: params.block ?? "start" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 通过 `window.matchMedia("(prefers-reduced-motion: reduce)").matches` 读取当前偏好。
 *
 * `window` 不可用或 `matchMedia` 不可用时返回 `false`（假设允许动效）。
 */
function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/**
 * 对外命名导出（供 `<AutopilotRightRail>` 直接使用）。
 * 保持为 named exports 而不是挂在 `__testing__` 下：运行时路径与测试路径都会消费它们。
 */
export { resolveScrollBehavior, scrollAnchorIntoView, readPrefersReducedMotion };

// =============================================================================
// Keyboard helpers (Task 4) —— 不依赖 window，供组件与 unit 测试共享
// =============================================================================

/**
 * 键盘快捷键决策结果。
 *
 * `"step-prev"` / `"step-next"`：`[` / `]` 触发的前后切换；必须与 `stepSubStage(..., direction)` 连用
 *   计算真实目标 sub-stage。
 * `"toggle-pin"`：`Shift + P` 触发的 sticky toggle。
 * `"close-drawer"`：drawer 模式下 `Escape` 触发关闭；`<AutopilotRightRail>` 当前不持有 drawer state，
 *   由 Task 5 / Task 8 在 `AutopilotRoutePage` 层承接。
 * `"ignore"`：early-return；本次 keydown 不应触发任何 rail 交互。
 */
export type RailKeyboardIntent =
  | "step-prev"
  | "step-next"
  | "toggle-pin"
  | "close-drawer"
  | "ignore";

/**
 * 判断目标元素是否在输入类控件或其子孙中（Key_Input_Focus_Guard）。
 *
 * - `<input>` / `<textarea>` / `<select>`：直接命中
 * - `contenteditable="true"`：命中
 * - 其他：不命中
 *
 * 向上逐层检查 `parentElement`，以处理 wrapper span 包裹的 input 情况。
 * 纯函数；不依赖 `window`，在 node 环境下可测试。
 */
function isInputFocused(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") {
    return false;
  }
  let cursor: Element | null = target as Element;
  let depth = 0;
  while (cursor && depth < 10) {
    const tag = cursor.tagName?.toUpperCase?.();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return true;
    }
    if (typeof (cursor as HTMLElement).getAttribute === "function") {
      const editable = (cursor as HTMLElement).getAttribute("contenteditable");
      if (editable === "" || editable === "true") {
        return true;
      }
    }
    cursor = cursor.parentElement;
    depth += 1;
  }
  return false;
}

/**
 * 根据 keydown 事件的各维度（按键、modifier、target、currentStage、drawerOpen）
 * 计算应该触发哪种 rail 交互。
 *
 * 决策优先级（硬性顺序）：
 * 1. 目标元素在输入控件内 → `"ignore"`（Requirement 4.5）
 * 2. 任一 `metaKey / ctrlKey / altKey` 按下 → `"ignore"`（Requirement 4.8；`Shift` 不算 modifier）
 * 3. `currentStage !== "fabric"`：
 *    - `"Escape"` 且 `drawerOpen === true` → `"close-drawer"`
 *    - 其他 → `"ignore"`（Requirement 4.7）
 * 4. `currentStage === "fabric"`：
 *    - `"["` → `"step-prev"`
 *    - `"]"` → `"step-next"`
 *    - `"P"` 且 `shiftKey` → `"toggle-pin"`
 *    - `"Escape"` 且 `drawerOpen === true` → `"close-drawer"`
 *    - 其他 → `"ignore"`
 *
 * 纯函数。`event` 用最小接口以便 node 环境可直接构造测试用例。
 */
function resolveKeyboardIntent(input: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
  currentStage: string | undefined;
  drawerOpen: boolean;
}): RailKeyboardIntent {
  if (isInputFocused(input.target)) {
    return "ignore";
  }
  if (input.metaKey || input.ctrlKey || input.altKey) {
    return "ignore";
  }
  const isFabric = input.currentStage === "fabric";

  if (!isFabric) {
    if (input.key === "Escape" && input.drawerOpen) {
      return "close-drawer";
    }
    return "ignore";
  }

  if (input.key === "[") {
    return "step-prev";
  }
  if (input.key === "]") {
    return "step-next";
  }
  if (input.key === "P" && input.shiftKey) {
    return "toggle-pin";
  }
  if (input.key === "Escape" && input.drawerOpen) {
    return "close-drawer";
  }
  return "ignore";
}

/**
 * 计算 `[` / `]` 后的目标 sub-stage（纯函数）。
 *
 * - `current` 为 `undefined`：direction=`"prev"` 返回 `undefined`（无切换目标）；
 *   direction=`"next"` 返回 `RAIL_SUB_STAGE_ORDER[0]`（从头开始）。
 * - `current` 在 `RAIL_SUB_STAGE_ORDER` 中：
 *   - `"prev"` 且已在首位 → `undefined`（边界 no-op，不循环）
 *   - `"next"` 且已在末位 → `undefined`（边界 no-op，不循环）
 *   - 否则返回 index ± 1
 * - `current` 不在 `RAIL_SUB_STAGE_ORDER` 中（防御性）：回退到 `undefined`。
 *
 * 调用方应在 `undefined` 时跳过 `setPinnedSubStage` 以避免无意义的 URL 写入。
 */
function stepSubStage(
  current: AutopilotRailSubStage | undefined,
  direction: "prev" | "next",
): AutopilotRailSubStage | undefined {
  if (current === undefined) {
    return direction === "next" ? RAIL_SUB_STAGE_ORDER[0] : undefined;
  }
  const idx = RAIL_SUB_STAGE_ORDER.indexOf(current);
  if (idx < 0) {
    return undefined;
  }
  const nextIdx = direction === "prev" ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= RAIL_SUB_STAGE_ORDER.length) {
    return undefined;
  }
  return RAIL_SUB_STAGE_ORDER[nextIdx];
}

export { isInputFocused, resolveKeyboardIntent, stepSubStage };

// =============================================================================
// Impure wrappers (依赖 window；生产环境与 jsdom 集成测试使用)
// =============================================================================

/**
 * 从 `window.location.search` 读取并校验初始 `?sub` 参数值。
 *
 * - `typeof window === "undefined"`（SSR / node 环境）→ `null`
 * - 其他情况委托给 `parseSubFromSearch`
 */
function readInitialSubStageFromUrl(): AutopilotRailSubStage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return parseSubFromSearch(window.location.search);
  } catch {
    return null;
  }
}

/**
 * 把 `next` 写入或从 URL 中清除 `?sub` 参数。
 *
 * - `typeof window === "undefined"` → no-op
 * - 使用 `applySubToSearch` 计算新 search，保留 pathname、hash、其他 query
 * - 使用 `history.replaceState`，不使用 `pushState`（Requirement 1.6）
 * - 幂等：若新 search 与当前完全一致，跳过 `replaceState` 调用
 */
function writeUrlSubParam(next: AutopilotRailSubStage | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const currentSearch = window.location.search;
    const nextSearch = applySubToSearch(currentSearch, next);
    const nextSearchPrefixed = nextSearch ? `?${nextSearch}` : "";
    if (nextSearchPrefixed === currentSearch) {
      return;
    }
    const nextRelative = `${window.location.pathname}${nextSearchPrefixed}${window.location.hash}`;
    window.history.replaceState(null, "", nextRelative);
  } catch {
    /* swallow — Requirement 1.3 非法 URL 不抛错 */
  }
}

// =============================================================================
// The hook
// =============================================================================

/**
 * `useRightRailSubStageState` —— Task 2 完成态。
 *
 * 行为：
 * - `pinnedSubStage` 通过 `useState` 保存；初始值由 `readInitialSubStageFromUrl()` 懒加载。
 * - 首次挂载后若 URL 中存在非法 `?sub` 值，同步调用 `writeUrlSubParam(null)` 清理。
 * - `setPinnedSubStage(next)`：更新内部 state + 写 URL（幂等由 `writeUrlSubParam` 保护）。
 * - `resetPin()`：等价于 `setPinnedSubStage(null)`。
 * - `togglePin()`：通过 ref 读最新 `pinnedSubStage / resolvedSubStage`，
 *   `pinnedSubStage === null` 时固定到 `resolvedSubStage`（缺失则回退到 `RAIL_SUB_STAGE_ORDER[0]`），
 *   否则清除 pin。
 *
 * 返回对象通过 `useMemo` 包裹以保持引用稳定。
 */
export function useRightRailSubStageState(
  input: UseRightRailSubStageStateInput,
): RightRailSubStageContextValue {
  const { resolvedSubStage } = input;

  const [pinnedSubStage, setPinnedSubStageState] = useState<AutopilotRailSubStage | null>(
    () => readInitialSubStageFromUrl(),
  );

  const pinnedRef = useRef<AutopilotRailSubStage | null>(pinnedSubStage);
  const resolvedRef = useRef<AutopilotRailSubStage | undefined>(resolvedSubStage);
  useEffect(() => {
    pinnedRef.current = pinnedSubStage;
  }, [pinnedSubStage]);
  useEffect(() => {
    resolvedRef.current = resolvedSubStage;
  }, [resolvedSubStage]);

  // 首次挂载：非法 URL 清理（Requirement 1.3）。lazy init 已把非法值 state 设为 null；
  // 此 effect 只负责把非法 URL 参数也从地址栏清除。
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("sub");
      if (raw !== null && !isValidSubStage(raw)) {
        writeUrlSubParam(null);
      }
    } catch {
      /* swallow */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPinnedSubStage = useCallback((next: AutopilotRailSubStage | null) => {
    setPinnedSubStageState(next);
    writeUrlSubParam(next);
  }, []);

  const resetPin = useCallback(() => {
    setPinnedSubStage(null);
  }, [setPinnedSubStage]);

  const togglePin = useCallback(() => {
    if (pinnedRef.current !== null) {
      setPinnedSubStage(null);
      return;
    }
    const seed = resolvedRef.current ?? RAIL_SUB_STAGE_ORDER[0];
    setPinnedSubStage(seed);
  }, [setPinnedSubStage]);

  const effectiveSubStage = useMemo<AutopilotRailSubStage | undefined>(
    () => pinnedSubStage ?? resolvedSubStage,
    [pinnedSubStage, resolvedSubStage],
  );

  return useMemo<RightRailSubStageContextValue>(
    () => ({
      effectiveSubStage,
      pinnedSubStage,
      isPinned: pinnedSubStage !== null,
      setPinnedSubStage,
      resetPin,
      togglePin,
    }),
    [effectiveSubStage, pinnedSubStage, setPinnedSubStage, resetPin, togglePin],
  );
}

// =============================================================================
// Testing exports
// =============================================================================

/**
 * 测试专用命名导出。仅供 `__tests__/` 下的 unit 与 PBT 测试直接调用。
 *
 * Pure layer（`parseSubFromSearch` / `applySubToSearch` / `isValidSubStage`）在 node 环境可用；
 * Impure layer（`readInitialSubStageFromUrl` / `writeUrlSubParam`）需要 jsdom 环境。
 */
export const __testing__ = {
  isValidSubStage,
  parseSubFromSearch,
  applySubToSearch,
  readInitialSubStageFromUrl,
  writeUrlSubParam,
  resolveScrollBehavior,
  scrollAnchorIntoView,
  readPrefersReducedMotion,
  isInputFocused,
  resolveKeyboardIntent,
  stepSubStage,
};
