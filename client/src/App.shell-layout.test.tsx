import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { locationState, viewportState } = vi.hoisted(() => ({
  locationState: {
    current: "/tasks",
    setLocation: vi.fn(),
  },
  viewportState: {
    isMobile: false,
    isTablet: false,
  },
}));

import { AppShell } from "./App";

vi.mock("wouter", () => ({
  useLocation: () => [locationState.current, locationState.setLocation],
  Switch: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Route: ({
    children,
    component: Component,
    path,
  }: {
    children?:
      | React.ReactNode
      | ((params: Record<string, string>) => React.ReactNode);
    component?: React.ComponentType;
    path?: string;
  }) => {
    const current = locationState.current;
    const matches =
      path === current ||
      (path === "/tasks/:taskId" && current.startsWith("/tasks/")) ||
      (path === "/debug/:section" && current.startsWith("/debug/")) ||
      (!path && current === "/404");

    if (!matches) return null;
    if (Component) return <Component />;
    if (typeof children === "function") {
      return <>{children({ taskId: "task-1", section: "status" })}</>;
    }
    return <>{children}</>;
  },
}));

vi.mock("./hooks/useViewportTier", () => ({
  useViewportTier: () => ({
    isMobile: viewportState.isMobile,
    isTablet: viewportState.isTablet,
  }),
}));

vi.mock("./hooks/useRecoveryDetection", () => ({
  useRecoveryDetection: () => ({
    candidate: null,
    isRestoring: false,
    restoreProgress: 0,
    restorePhase: "",
    handleResume: vi.fn(),
    handleDiscard: vi.fn(),
  }),
}));

vi.mock("./components/AppSidebar", () => ({
  AppSidebar: ({
    collapsed,
    embedded,
  }: {
    collapsed: boolean;
    embedded?: boolean;
  }) => (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : "false"}
      data-testid="app-sidebar"
    />
  ),
}));

vi.mock("./components/ConfigPanel", () => ({
  ConfigPanel: () => <div data-testid="config-panel" />,
}));

vi.mock("./components/MobileTabBar", () => ({
  MobileTabBar: () => <nav data-testid="mobile-tab-bar" />,
}));

vi.mock("./components/RecoveryDialog", () => ({
  RecoveryDialog: () => <div data-testid="recovery-dialog" />,
}));

vi.mock("./components/replay/ReplayPage", () => ({
  ReplayPage: () => <div data-testid="replay-page" />,
}));

vi.mock("./pages/Home", () => ({
  default: () => <main data-testid="home-page" />,
}));

vi.mock("./pages/tasks", () => ({
  TasksPage: () => <main data-testid="tasks-page" />,
  TaskDetailPage: () => <main data-testid="task-detail-page" />,
}));

vi.mock("./pages/debug/DebugPage", () => ({
  default: () => <main data-testid="debug-page" />,
}));

vi.mock("./pages/nl-command/LegacyCommandCenterPage", () => ({
  default: () => <main data-testid="legacy-command-page" />,
}));

vi.mock("./pages/lineage/LineagePage", () => ({
  default: () => <main data-testid="lineage-page" />,
}));

vi.mock("./pages/NotFound", () => ({
  default: () => <main data-testid="not-found-page" />,
}));

describe("AppShell fixed sidebar layout", () => {
  it("offsets non-home desktop content by the fixed sidebar width", () => {
    locationState.current = "/tasks";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="tasks-page"');
    expect(shell).toContain("--sidebar-width:248px");
    expect(shell).toContain("padding-left:248px");
  });

  it("does not offset the home page because it uses embedded scene chrome", () => {
    locationState.current = "/";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="home-page"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
  });

  it("does not keep the task sidebar offset when the home URL has query or hash state", () => {
    locationState.current = "/?from=tasks#autopilot";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
    expect(shell).not.toContain("transition-[padding-left]");
  });
});
