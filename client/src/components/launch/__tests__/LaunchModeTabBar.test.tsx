import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const { appState } = vi.hoisted(() => ({
  appState: {
    locale: "en-US",
    runtimeMode: "frontend",
    setRuntimeMode: async () => {},
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) =>
    selector(appState),
}));

import { LaunchModeTabBar, LAUNCH_MODES } from "../LaunchModeTabBar";

describe("LaunchModeTabBar", () => {
  it("renders all five mode tabs", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchModeTabBar, {
        mode: "quick",
        onModeChange: () => {},
      })
    );

    expect(markup).toContain('data-testid="launch-mode-tab-quick"');
    expect(markup).toContain('data-testid="launch-mode-tab-standard"');
    expect(markup).toContain('data-testid="launch-mode-tab-deep"');
    expect(markup).toContain('data-testid="launch-mode-tab-research"');
    expect(markup).toContain('data-testid="launch-mode-tab-custom"');
  });

  it("marks the selected tab with aria-selected=true", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchModeTabBar, {
        mode: "quick",
        onModeChange: () => {},
      })
    );

    // Quick tab should be selected
    expect(markup).toContain('aria-selected="true"');
    // Count: only one should be true
    const trueCount = (markup.match(/aria-selected="true"/g) || []).length;
    expect(trueCount).toBe(1);
  });

  it("marks non-selected tabs with aria-selected=false", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchModeTabBar, {
        mode: "standard",
        onModeChange: () => {},
      })
    );

    const trueCount = (markup.match(/aria-selected="true"/g) || []).length;
    const falseCount = (markup.match(/aria-selected="false"/g) || []).length;
    expect(trueCount).toBe(1);
    expect(falseCount).toBe(4);
  });

  it("renders with role=tablist", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchModeTabBar, {
        mode: "quick",
        onModeChange: () => {},
      })
    );

    expect(markup).toContain('role="tablist"');
  });

  it("renders each tab with role=tab", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchModeTabBar, {
        mode: "quick",
        onModeChange: () => {},
      })
    );

    const tabCount = (markup.match(/role="tab"/g) || []).length;
    expect(tabCount).toBe(5);
  });

  it("renders English labels when locale is en-US", () => {
    appState.locale = "en-US";
    const markup = renderToStaticMarkup(
      createElement(LaunchModeTabBar, {
        mode: "quick",
        onModeChange: () => {},
      })
    );

    expect(markup).toContain("Quick");
    expect(markup).toContain("Standard");
    expect(markup).toContain("Deep");
    expect(markup).toContain("Research");
    expect(markup).toContain("Custom");
  });

  it("renders Chinese labels when locale is zh-CN", () => {
    appState.locale = "zh-CN";
    const markup = renderToStaticMarkup(
      createElement(LaunchModeTabBar, {
        mode: "quick",
        onModeChange: () => {},
      })
    );

    expect(markup).toContain("快速模式");
    expect(markup).toContain("标准模式");
    expect(markup).toContain("深度模式");
    expect(markup).toContain("研究模式");
    expect(markup).toContain("自定义模式");
    appState.locale = "en-US";
  });

  it("has correct LAUNCH_MODES configuration", () => {
    expect(LAUNCH_MODES).toHaveLength(5);
    expect(LAUNCH_MODES.map(m => m.id)).toEqual([
      "quick",
      "standard",
      "deep",
      "research",
      "custom",
    ]);
    // Quick mode should not show advanced sections
    expect(LAUNCH_MODES.find(m => m.id === "quick")?.showAdvancedSections).toBe(false);
    // All other modes should show advanced sections
    expect(LAUNCH_MODES.filter(m => m.id !== "quick").every(m => m.showAdvancedSections)).toBe(true);
  });

  it("maps modes to LaunchRouteCandidateId correctly", () => {
    expect(LAUNCH_MODES.find(m => m.id === "quick")?.routeMapping).toBe("fast-route");
    expect(LAUNCH_MODES.find(m => m.id === "standard")?.routeMapping).toBe("standard-route");
    expect(LAUNCH_MODES.find(m => m.id === "deep")?.routeMapping).toBe("deep-route");
    expect(LAUNCH_MODES.find(m => m.id === "custom")?.routeMapping).toBeNull();
  });
});
