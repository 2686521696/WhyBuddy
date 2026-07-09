/**
 * `useViewportTier` —— Autopilot 右栏响应式三档断点 hook
 *
 * 对应 spec：`.kiro/specs/autopilot-step-driven-rail-navigation/`
 * - Requirement 5.1-5.7：Viewport_Tier 三档响应式边界
 *
 * 三档定义：
 * - `"drawer"`：`window.innerWidth < 768`（`<md`）
 * - `"side-collapsible"`：`768 <= width < 1280`（`md-xl`）
 * - `"side-fixed"`：`width >= 1280`（`≥xl`）
 *
 * 边界值选取对齐 Tailwind 默认 `md = 768px` / `xl = 1280px`。
 *
 * 硬性约束：
 * - `resolveViewportTier(width)` 是纯函数（不依赖 `window`），供 unit 测试在 node 环境直接覆盖。
 * - `useViewportTier()` 负责 React 生命周期 + `matchMedia` 监听；SSR / 无 `matchMedia` 环境下
 *   fallback 为 `"side-fixed"`（Spec 3 现状，不降级用户体验）。
 * - 不订阅任何 store；不持有任何组件内 state 之外的依赖。
 */

import { useEffect, useState } from "react";

/**
 * 三档响应式断点枚举。
 */
export type ViewportTier = "drawer" | "side-collapsible" | "side-fixed";

/**
 * 断点阈值常量（与 Tailwind 默认 `md` / `xl` 对齐）。
 */
export const VIEWPORT_TIER_BREAKPOINT_MD = 768;
export const VIEWPORT_TIER_BREAKPOINT_XL = 1280;

/**
 * 把 viewport 宽度映射为三档 tier。纯函数，供 unit 测试直接覆盖。
 *
 * - `width < 768` → `"drawer"`
 * - `768 <= width < 1280` → `"side-collapsible"`
 * - `width >= 1280` → `"side-fixed"`
 *
 * `width` 为 `NaN` / 非有限数字 / 负数时返回 `"side-fixed"`（保守 fallback，避免把桌面
 * 用户意外降级为 drawer 模式）。
 */
export function resolveViewportTier(width: number): ViewportTier {
  if (!Number.isFinite(width) || width < 0) {
    return "side-fixed";
  }
  if (width < VIEWPORT_TIER_BREAKPOINT_MD) {
    return "drawer";
  }
  if (width < VIEWPORT_TIER_BREAKPOINT_XL) {
    return "side-collapsible";
  }
  return "side-fixed";
}

/**
 * 返回当前 viewport 对应的 tier；在 resize / matchMedia 触发时重新计算。
 *
 * 在 SSR / 无 `window` 环境下返回 `"side-fixed"`（Spec 3 现状）。
 * 在无 `matchMedia` 的环境下仍可计算首次 tier，但不会响应后续 resize。
 */
export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() => {
    if (typeof window === "undefined") {
      return "side-fixed";
    }
    return resolveViewportTier(window.innerWidth);
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mdQuery = window.matchMedia(`(min-width: ${VIEWPORT_TIER_BREAKPOINT_MD}px)`);
    const xlQuery = window.matchMedia(`(min-width: ${VIEWPORT_TIER_BREAKPOINT_XL}px)`);
    const recompute = () => {
      setTier(resolveViewportTier(window.innerWidth));
    };
    // 初次同步（避免 useState lazy init 与后续 listener 之间的 race）。
    recompute();
    // 优先使用现代 `addEventListener("change")`；若不可用则回退到旧版 `addListener`。
    const supportsModern =
      typeof mdQuery.addEventListener === "function" &&
      typeof xlQuery.addEventListener === "function";
    if (supportsModern) {
      mdQuery.addEventListener("change", recompute);
      xlQuery.addEventListener("change", recompute);
      return () => {
        mdQuery.removeEventListener("change", recompute);
        xlQuery.removeEventListener("change", recompute);
      };
    }
    type LegacyMediaQueryList = MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    };
    const md = mdQuery as LegacyMediaQueryList;
    const xl = xlQuery as LegacyMediaQueryList;
    md.addListener?.(recompute);
    xl.addListener?.(recompute);
    return () => {
      md.removeListener?.(recompute);
      xl.removeListener?.(recompute);
    };
  }, []);

  return tier;
}

/**
 * 测试专用导出：`resolveViewportTier` 已经是 named export；本对象保留为未来扩展占位，
 * 当前只 re-export pure helper 以便与 `use-right-rail-sub-stage-state.ts` 的 `__testing__`
 * 模式保持一致。
 */
export const __testing__ = {
  resolveViewportTier,
  VIEWPORT_TIER_BREAKPOINT_MD,
  VIEWPORT_TIER_BREAKPOINT_XL,
};
