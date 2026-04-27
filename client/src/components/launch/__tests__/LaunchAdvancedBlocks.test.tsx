import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const { appState } = vi.hoisted(() => ({
  appState: {
    locale: "en-US",
    runtimeMode: "frontend" as "frontend" | "advanced",
    setRuntimeMode: async () => {},
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) =>
    selector(appState),
}));

import { LaunchRoutePlanningFlow } from "../LaunchRoutePlanningFlow";
import { LaunchCockpitGrid, COCKPIT_TOOLS } from "../LaunchCockpitGrid";
import { LaunchOutputChips, OUTPUT_TYPES } from "../LaunchOutputChips";

const mockRoutePlan = {
  decision: {
    kind: "mission" as const,
    reasons: [] as string[],
    requiresAdvancedRuntime: false,
    needsClarification: false,
    canOverride: true,
  },
  recommendedRouteId: "fast-route" as const,
  candidates: [],
};

describe("LaunchRoutePlanningFlow", () => {
  it("renders four route planning steps", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchRoutePlanningFlow, {
        hasDraftDestination: false,
        routePlan: mockRoutePlan,
      })
    );

    expect(markup).toContain('data-testid="route-step-destination"');
    expect(markup).toContain('data-testid="route-step-planning"');
    expect(markup).toContain('data-testid="route-step-execution"');
    expect(markup).toContain('data-testid="route-step-validation"');
  });

  it("marks destination as completed when draft has text", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchRoutePlanningFlow, {
        hasDraftDestination: true,
        routePlan: mockRoutePlan,
      })
    );

    expect(markup).toContain('data-status="completed"');
  });

  it("marks all steps as pending when no draft", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchRoutePlanningFlow, {
        hasDraftDestination: false,
        routePlan: mockRoutePlan,
      })
    );

    const pendingCount = (markup.match(/data-status="pending"/g) || []).length;
    expect(pendingCount).toBeGreaterThanOrEqual(3);
  });

  it("renders the section title", () => {
    appState.locale = "en-US";
    const markup = renderToStaticMarkup(
      createElement(LaunchRoutePlanningFlow, {
        hasDraftDestination: false,
        routePlan: mockRoutePlan,
      })
    );

    expect(markup).toContain("Autonomous Route Planning");
  });
});

describe("LaunchCockpitGrid", () => {
  it("renders all six tool cards", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchCockpitGrid, {
        runtimeMode: "advanced",
      })
    );

    expect(markup).toContain('data-testid="cockpit-tool-browser"');
    expect(markup).toContain('data-testid="cockpit-tool-executor"');
    expect(markup).toContain('data-testid="cockpit-tool-filesystem"');
    expect(markup).toContain('data-testid="cockpit-tool-knowledge"');
    expect(markup).toContain('data-testid="cockpit-tool-web"');
    expect(markup).toContain('data-testid="cockpit-tool-vision"');
  });

  it("disables advanced-runtime tools when runtimeMode is frontend", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchCockpitGrid, {
        runtimeMode: "frontend",
      })
    );

    // Browser, executor, filesystem require advanced runtime
    const browserMatch = markup.match(
      /data-testid="cockpit-tool-browser"[^>]*data-disabled="([^"]*)"/
    );
    expect(browserMatch?.[1]).toBe("true");

    const executorMatch = markup.match(
      /data-testid="cockpit-tool-executor"[^>]*data-disabled="([^"]*)"/
    );
    expect(executorMatch?.[1]).toBe("true");

    // Knowledge, web, vision should not be disabled
    const knowledgeMatch = markup.match(
      /data-testid="cockpit-tool-knowledge"[^>]*data-disabled="([^"]*)"/
    );
    expect(knowledgeMatch?.[1]).toBe("false");
  });

  it("enables all tools when runtimeMode is advanced", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchCockpitGrid, {
        runtimeMode: "advanced",
      })
    );

    const disabledTrueCount = (markup.match(/data-disabled="true"/g) || []).length;
    expect(disabledTrueCount).toBe(0);
  });

  it("has correct COCKPIT_TOOLS configuration", () => {
    expect(COCKPIT_TOOLS).toHaveLength(6);
    const advancedTools = COCKPIT_TOOLS.filter(t => t.requiresAdvancedRuntime);
    expect(advancedTools).toHaveLength(3);
    expect(advancedTools.map(t => t.id)).toEqual(["browser", "executor", "filesystem"]);
  });

  it("renders the section title", () => {
    appState.locale = "en-US";
    const markup = renderToStaticMarkup(
      createElement(LaunchCockpitGrid, {
        runtimeMode: "frontend",
      })
    );

    expect(markup).toContain("Capability Cockpit");
  });
});

describe("LaunchOutputChips", () => {
  it("renders all five output type chips", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchOutputChips, {
        selectedTypes: new Set(["summary", "files"]),
        onToggle: () => {},
      })
    );

    expect(markup).toContain('data-testid="output-chip-summary"');
    expect(markup).toContain('data-testid="output-chip-files"');
    expect(markup).toContain('data-testid="output-chip-logs"');
    expect(markup).toContain('data-testid="output-chip-screenshots"');
    expect(markup).toContain('data-testid="output-chip-records"');
  });

  it("marks selected chips with data-selected=true", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchOutputChips, {
        selectedTypes: new Set(["summary", "files"]),
        onToggle: () => {},
      })
    );

    const summaryMatch = markup.match(
      /data-testid="output-chip-summary"[^>]*data-selected="([^"]*)"/
    );
    expect(summaryMatch?.[1]).toBe("true");

    const logsMatch = markup.match(
      /data-testid="output-chip-logs"[^>]*data-selected="([^"]*)"/
    );
    expect(logsMatch?.[1]).toBe("false");
  });

  it("has correct OUTPUT_TYPES configuration", () => {
    expect(OUTPUT_TYPES).toHaveLength(5);
    expect(OUTPUT_TYPES.map(t => t.id)).toEqual([
      "summary",
      "files",
      "logs",
      "screenshots",
      "records",
    ]);
    // Summary and files are default selected
    expect(OUTPUT_TYPES.filter(t => t.defaultSelected).map(t => t.id)).toEqual([
      "summary",
      "files",
    ]);
  });

  it("renders the section title", () => {
    appState.locale = "en-US";
    const markup = renderToStaticMarkup(
      createElement(LaunchOutputChips, {
        selectedTypes: new Set(),
        onToggle: () => {},
      })
    );

    expect(markup).toContain("Output &amp; Delivery");
  });
});
