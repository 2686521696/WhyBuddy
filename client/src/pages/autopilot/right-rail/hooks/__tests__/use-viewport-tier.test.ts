/**
 * Unit 测试 —— Task 5：`resolveViewportTier` pure helper
 *
 * 对应 spec：`.kiro/specs/autopilot-step-driven-rail-navigation/`
 * - Requirement 5.1-5.4（三档断点边界）
 * - Requirement 10.4（unit 覆盖 Viewport_Tier 运行时切换等 edge case；hook 层本身的
 *   `matchMedia` 订阅需要 DOM runtime，将在 Task 10 可选 integration test 里补）
 *
 * 本文件只覆盖 pure helper `resolveViewportTier(width)`；`useViewportTier()` hook
 * 的 React render 层不在 node 环境直接测试，以避免引入 `@testing-library/react`。
 */

import { describe, expect, it } from "vitest";

import {
  __testing__,
  VIEWPORT_TIER_BREAKPOINT_MD,
  VIEWPORT_TIER_BREAKPOINT_XL,
  resolveViewportTier,
  type ViewportTier,
} from "../use-viewport-tier";

describe("use-viewport-tier / Task 5 — resolveViewportTier", () => {
  it("returns 'drawer' when width is strictly below 768", () => {
    const samples = [0, 320, 414, 640, 767];
    for (const w of samples) {
      expect(resolveViewportTier(w)).toBe<ViewportTier>("drawer");
    }
  });

  it("returns 'side-collapsible' when width is in [768, 1280)", () => {
    const samples = [768, 800, 1024, 1200, 1279];
    for (const w of samples) {
      expect(resolveViewportTier(w)).toBe<ViewportTier>("side-collapsible");
    }
  });

  it("returns 'side-fixed' when width is >= 1280", () => {
    const samples = [1280, 1440, 1728, 1920, 2560];
    for (const w of samples) {
      expect(resolveViewportTier(w)).toBe<ViewportTier>("side-fixed");
    }
  });

  it("uses exact boundary: 768 → side-collapsible, 1280 → side-fixed", () => {
    expect(resolveViewportTier(VIEWPORT_TIER_BREAKPOINT_MD)).toBe("side-collapsible");
    expect(resolveViewportTier(VIEWPORT_TIER_BREAKPOINT_XL)).toBe("side-fixed");
    expect(resolveViewportTier(VIEWPORT_TIER_BREAKPOINT_MD - 1)).toBe("drawer");
    expect(resolveViewportTier(VIEWPORT_TIER_BREAKPOINT_XL - 1)).toBe("side-collapsible");
  });

  it("returns 'side-fixed' for non-finite / negative widths (conservative fallback)", () => {
    expect(resolveViewportTier(Number.NaN)).toBe("side-fixed");
    expect(resolveViewportTier(Number.POSITIVE_INFINITY)).toBe("side-fixed");
    expect(resolveViewportTier(-1)).toBe("side-fixed");
    expect(resolveViewportTier(-1000)).toBe("side-fixed");
  });

  it("is accessible via __testing__ re-export with matching breakpoints", () => {
    expect(__testing__.VIEWPORT_TIER_BREAKPOINT_MD).toBe(768);
    expect(__testing__.VIEWPORT_TIER_BREAKPOINT_XL).toBe(1280);
    expect(__testing__.resolveViewportTier(1000)).toBe("side-collapsible");
  });
});
