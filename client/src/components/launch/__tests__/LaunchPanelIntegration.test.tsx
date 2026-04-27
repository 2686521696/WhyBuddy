import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const { appState, nlCommandState, workflowState } = vi.hoisted(() => ({
  appState: {
    locale: "en-US",
    runtimeMode: "frontend" as "frontend" | "advanced",
    setRuntimeMode: async () => {},
  },
  nlCommandState: {
    commands: [] as Array<{ commandText: string }>,
    draftText: "Build a dashboard for metrics",
    currentCommand: null,
    currentAnalysis: null,
    currentDialog: null,
    currentPlan: null,
    lastSubmission: null,
    loading: false,
    error: null,
    setDraftText: (value: string) => {
      nlCommandState.draftText = value;
    },
    clearError: () => {
      nlCommandState.error = null;
    },
  },
  workflowState: {
    isSubmitting: false,
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) =>
    selector(appState),
}));

vi.mock("@/lib/nl-command-store", () => ({
  selectTaskHubLaunchSession: (state: typeof nlCommandState) => state,
  useNLCommandStore: (selector: (state: typeof nlCommandState) => unknown) =>
    selector(nlCommandState),
}));

vi.mock("@/lib/workflow-store", () => ({
  useWorkflowStore: (selector: (state: typeof workflowState) => unknown) =>
    selector(workflowState),
}));

vi.mock("@/lib/launch-router", () => ({
  buildLaunchRoutePlan: () => ({
    decision: {
      kind: "mission",
      reasons: ["complete_task_brief"],
      requiresAdvancedRuntime: false,
      needsClarification: false,
      canOverride: true,
    },
    recommendedRouteId: "fast-route",
    candidates: [
      {
        id: "fast-route",
        mode: "fast",
        launchKind: "mission",
        recommended: true,
        available: true,
        disabledReason: null,
        reasons: [],
        stages: ["destination", "route", "execution"],
        takeoverPoints: [],
      },
    ],
  }),
}));

vi.mock("@/lib/workflow-attachments", () => ({
  prepareWorkflowAttachments: async () => [],
}));

vi.mock("@/lib/unified-launch-coordinator", () => ({
  submitUnifiedLaunch: async () => ({
    route: "mission",
    decision: {
      kind: "mission",
      reasons: [],
      requiresAdvancedRuntime: false,
      needsClarification: false,
      canOverride: true,
    },
    missionId: "test-mission-1",
    commandId: "test-cmd-1",
    status: "created",
  }),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({
      children,
      className,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) =>
      createElement("div", { className, ...rest }, children),
  },
}));

// No need to mock createPortal - component falls back to inline rendering in SSR

import { LaunchPanelShell } from "../LaunchPanelShell";

describe("LaunchPanel Integration", () => {
  it("renders a complete panel with all sections when open", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    // Panel structure
    expect(markup).toContain('data-testid="launch-panel-backdrop"');
    expect(markup).toContain('data-testid="launch-panel-shell"');
    expect(markup).toContain('role="dialog"');

    // Header
    expect(markup).toContain("Task Autopilot Control");

    // Tab bar
    expect(markup).toContain('data-testid="launch-mode-tabbar"');
    expect(markup).toContain('role="tablist"');

    // Goal input
    expect(markup).toContain('data-testid="launch-goal-input"');
    expect(markup).toContain('data-testid="launch-goal-textarea"');

    // Action bar
    expect(markup).toContain('data-testid="launch-panel-action-bar"');
    expect(markup).toContain('data-testid="launch-action-submit"');
  });

  it("shows draft text in the textarea and character count", () => {
    nlCommandState.draftText = "Build a dashboard for metrics";
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain("Build a dashboard for metrics");
    expect(markup).toContain("29 / 2000");
  });

  it("does not render advanced sections in quick mode", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    // Quick mode is default - no advanced sections
    expect(markup).not.toContain('data-testid="launch-route-planning-flow"');
    expect(markup).not.toContain('data-testid="launch-cockpit-grid"');
    expect(markup).not.toContain('data-testid="launch-output-chips"');
  });

  it("renders nothing when open=false", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: false,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toBe("");
  });

  it("has submit button enabled when draft text exists", () => {
    nlCommandState.draftText = "Build a dashboard";
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    // The submit button should exist and not be disabled
    expect(markup).toContain('data-testid="launch-action-submit"');
    expect(markup).toContain("Launch Task");
  });

  it("has submit button disabled when draft text is empty", () => {
    nlCommandState.draftText = "";
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain("disabled");
    nlCommandState.draftText = "Build a dashboard for metrics";
  });

  it("renders all five mode tabs with correct aria attributes", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    const tabCount = (markup.match(/role="tab"/g) || []).length;
    expect(tabCount).toBe(5);

    // Exactly one tab should be selected (quick by default)
    const selectedCount = (markup.match(/aria-selected="true"/g) || []).length;
    expect(selectedCount).toBe(1);
  });
});
