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
    draftText: "",
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
      reasons: [],
      requiresAdvancedRuntime: false,
      needsClarification: false,
      canOverride: true,
    },
    recommendedRouteId: "fast-route",
    candidates: [],
  }),
}));

vi.mock("@/lib/workflow-attachments", () => ({
  prepareWorkflowAttachments: async () => [],
}));

vi.mock("@/lib/unified-launch-coordinator", () => ({
  submitUnifiedLaunch: async () => ({
    route: "mission",
    decision: { kind: "mission", reasons: [], requiresAdvancedRuntime: false, needsClarification: false, canOverride: true },
    missionId: "test-mission-1",
    commandId: "test-cmd-1",
    status: "created",
  }),
}));

// Mock framer-motion to render static markup
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

describe("LaunchPanelShell", () => {
  it("renders panel and backdrop when open=true", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain('data-testid="launch-panel-backdrop"');
    expect(markup).toContain('data-testid="launch-panel-shell"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="launch-panel-title"');
  });

  it("does not render panel content when open=false", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: false,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).not.toContain('data-testid="launch-panel-shell"');
    expect(markup).not.toContain('role="dialog"');
  });

  it("renders the panel title", () => {
    appState.locale = "en-US";
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain("Task Autopilot Control");
    expect(markup).toContain('id="launch-panel-title"');
  });

  it("renders close button", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain('data-testid="launch-panel-close"');
  });

  it("renders mode tab bar, goal input, and action bar", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain('data-testid="launch-mode-tabbar"');
    expect(markup).toContain('data-testid="launch-goal-input"');
    expect(markup).toContain('data-testid="launch-panel-action-bar"');
  });

  it("does not render advanced sections in quick mode by default", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).not.toContain('data-testid="launch-route-planning-flow"');
    expect(markup).not.toContain('data-testid="launch-cockpit-grid"');
    expect(markup).not.toContain('data-testid="launch-output-chips"');
  });

  it("renders the submit button as disabled when input is empty", () => {
    nlCommandState.draftText = "";
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain('data-testid="launch-action-submit"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Launch Task");
  });

  it("renders the submit button when input has text", () => {
    nlCommandState.draftText = "Build a dashboard";
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain('data-testid="launch-action-submit"');
    expect(markup).toContain("Launch Task");
    nlCommandState.draftText = "";
  });

  it("renders Chinese labels when locale is zh-CN", () => {
    appState.locale = "zh-CN";
    const markup = renderToStaticMarkup(
      createElement(LaunchPanelShell, {
        open: true,
        onClose: () => {},
        createMission: async () => null,
      })
    );

    expect(markup).toContain("任务自动驾驶");
    expect(markup).toContain("启动任务");
    appState.locale = "en-US";
  });
});
