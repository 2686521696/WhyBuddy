import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { useNLCommandStoreMock } = vi.hoisted(() => {
  const state = {
    commands: [] as any[],
    currentDialog: null as any,
    currentCommand: null as any,
    currentAnalysis: null as any,
    currentPlan: null as any,
    draftText: "",
    lastSubmission: null as any,
    loading: false,
    error: null as string | null,
    setDraftText: (value: string) => {
      state.draftText = value;
    },
    clearError: () => {
      state.error = null;
    },
  };

  const hook = ((selector: (value: typeof state) => unknown) =>
    selector(state)) as any;
  hook.setState = (partial: Partial<typeof state>) => {
    Object.assign(state, partial);
  };
  hook.getState = () => state;

  return {
    useNLCommandStoreMock: hook,
  };
});

import { OfficeTaskCockpit } from "./OfficeTaskCockpit";
import { useAppStore } from "@/lib/store";
import { useNLCommandStore } from "@/lib/nl-command-store";
import { useTasksStore } from "@/lib/tasks-store";
import { useTelemetryStore } from "@/lib/telemetry-store";
import { useWorkflowStore } from "@/lib/workflow-store";

vi.mock("@/lib/nl-command-store", () => ({
  selectTaskHubLaunchSession: (state: unknown) => state,
  useNLCommandStore: useNLCommandStoreMock,
}));

vi.mock("@/components/launch/UnifiedLaunchComposer", () => ({
  UnifiedLaunchComposer: ({
    bare,
    hideHeader,
    hideClarificationPanel,
    hideOperatorActions,
  }: {
    bare?: boolean;
    hideHeader?: boolean;
    hideClarificationPanel?: boolean;
    hideOperatorActions?: boolean;
  }) => (
    <div
      data-testid="unified-launch-composer"
      data-bare={bare ? "true" : "false"}
      data-hide-header={hideHeader ? "true" : "false"}
      data-hide-clarification={hideClarificationPanel ? "true" : "false"}
      data-hide-operator-actions={hideOperatorActions ? "true" : "false"}
    >
      mocked composer
    </div>
  ),
}));

vi.mock("@/components/launch/LaunchDestinationPreviewCard", () => ({
  LaunchDestinationPreviewCard: () => (
    <div data-testid="autopilot-destination-preview-card">
      mocked destination preview
    </div>
  ),
}));

vi.mock("@/components/launch/RoutePlanningOverlay", () => ({
  RoutePlanningOverlay: () => (
    <div data-testid="route-planning-overlay">mocked route plan</div>
  ),
}));

vi.mock("@/components/nl-command/ClarificationPanel", () => ({
  ClarificationPanel: () => (
    <div data-testid="office-clarification-panel">mocked clarification</div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value: string;
  }) => <button data-value={value}>{children}</button>,
  TabsContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    modal = true,
  }: {
    children?: React.ReactNode;
    modal?: boolean;
  }) => (
    <div data-testid="dropdown-menu" data-modal={String(modal)}>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="dropdown-menu-trigger">{children}</div>
  ),
  DropdownMenuContent: ({
    children,
    align,
    side,
    sideOffset,
    className,
  }: {
    children?: React.ReactNode;
    align?: string;
    side?: string;
    sideOffset?: number;
    className?: string;
  }) => (
    <div
      className={className}
      data-testid="dropdown-menu-content"
      data-align={align}
      data-side={side}
      data-side-offset={String(sideOffset ?? "")}
    >
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="dropdown-menu-item">{children}</div>
  ),
  DropdownMenuRadioGroup: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value?: string;
  }) => (
    <div data-testid="dropdown-menu-radio-group" data-value={value}>
      {children}
    </div>
  ),
  DropdownMenuRadioItem: ({
    children,
    value,
    disabled,
  }: {
    children?: React.ReactNode;
    value?: string;
    disabled?: boolean;
  }) => (
    <div
      data-testid="dropdown-menu-radio-item"
      data-disabled={disabled ? "true" : "false"}
      data-value={value}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/components/ExecutorStatusPanel", () => ({
  ExecutorStatusPanel: () => null,
}));

vi.mock("@/components/ExecutorTerminalPanel", () => ({
  ExecutorTerminalPanel: () => null,
}));

vi.mock("@/components/tasks/ArtifactListBlock", () => ({
  ArtifactListBlock: () => null,
}));

vi.mock("@/components/tasks/ArtifactPreviewDialog", () => ({
  ArtifactPreviewDialog: () => null,
}));

vi.mock("@/components/tasks/CreateMissionDialog", () => ({
  CreateMissionDialog: () => null,
}));

vi.mock("@/components/tasks/TasksCockpitDetail", () => ({
  TasksCockpitDetail: () => (
    <div data-testid="right-task-detail">mocked task detail</div>
  ),
}));

vi.mock("@/components/tasks/TasksQueueRail", () => ({
  TasksQueueRail: () => (
    <div data-testid="tasks-queue-rail">mocked task queue</div>
  ),
}));

vi.mock("@/components/tasks/TaskDetailCardsView", () => ({
  TaskDetailCardsView: () => (
    <div data-testid="task-detail-cards-view">mocked task cards</div>
  ),
}));

vi.mock("@/components/launch/LaunchPanelShell", () => ({
  LaunchPanelShell: () => null,
}));

const noopAsync = async () => {};
const noopAsyncNullable = async () => null;
const noopToggle = () => {};

const missionDetail = {
  id: "mission-1",
  title: "Ship office cockpit",
  kind: "general",
  sourceText: "Keep the scene visible",
  status: "running",
  operatorState: "idle",
  workflowStatus: "running",
  progress: 42,
  currentStageKey: "execution",
  currentStageLabel: "Execution",
  summary: "Selected task should stay lightweight on home.",
  waitingFor: null,
  blocker: null,
  attempt: 1,
  latestOperatorAction: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  startedAt: Date.now(),
  completedAt: null,
  departmentLabels: ["Engineering"],
  taskCount: 3,
  completedTaskCount: 1,
  messageCount: 2,
  activeAgentCount: 2,
  attachmentCount: 0,
  issueCount: 0,
  hasWarnings: false,
  lastSignal: null,
  workflow: {
    id: "wf-1",
    status: "running",
    currentStage: "execution",
    stages: [],
    results: {},
  },
  tasks: [],
  messages: [],
  report: null,
  organization: null,
  stages: [],
  agents: [],
  timeline: [],
  artifacts: [],
  failureReasons: [],
  decisionPresets: [],
  decisionPrompt: null,
  decisionAllowsFreeText: false,
  decision: null,
  instanceInfo: [],
  logSummary: [],
  runtimeChannels: {
    socket: { status: "connected", label: "Socket", detail: "OK" },
    callback: { status: "idle", label: "Callback", detail: "Idle" },
  },
  decisionHistory: [],
  operatorActions: [],
} as any;

const missionSummary = {
  id: "mission-1",
  title: "Ship office cockpit",
  kind: "general",
  sourceText: "Keep the scene visible",
  status: "running",
  operatorState: "idle",
  workflowStatus: "running",
  progress: 42,
  currentStageKey: "execution",
  currentStageLabel: "Execution",
  summary: "Selected task should stay lightweight on home.",
  waitingFor: null,
  blocker: null,
  attempt: 1,
  latestOperatorAction: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  startedAt: Date.now(),
  completedAt: null,
  departmentLabels: ["Engineering"],
  taskCount: 3,
  completedTaskCount: 1,
  messageCount: 2,
  activeAgentCount: 2,
  attachmentCount: 0,
  issueCount: 0,
  hasWarnings: false,
  lastSignal: null,
} as any;

beforeEach(() => {
  useAppStore.setState({
    locale: "zh-CN",
    runtimeMode: "frontend",
    selectedPet: null,
    toggleConfig: noopToggle,
    setRuntimeMode: async () => {},
  });

  useTelemetryStore.setState({
    dashboardOpen: false,
    toggleDashboard: noopToggle,
  });

  useNLCommandStore.setState({
    currentDialog: null,
    currentCommand: null,
    draftText: "",
  });

  useWorkflowStore.setState({
    workflows: [],
    agents: [],
    currentWorkflow: null,
    currentWorkflowId: null,
    fetchWorkflowDetail: noopAsync,
    fetchWorkflows: noopAsync,
    setCurrentWorkflow: () => {},
  });

  useTasksStore.setState({
    tasks: [],
    detailsById: {},
    selectedTaskId: null,
    loading: false,
    ready: true,
    error: null,
    decisionNotes: {},
    operatorActionLoadingByMissionId: {},
    refresh: noopAsync,
    selectTask: () => {},
    createMission: async () => null,
    submitOperatorAction: noopAsyncNullable,
    setDecisionNote: () => {},
    launchDecision: noopAsyncNullable,
  });
});

describe("OfficeTaskCockpit", () => {
  it("renders a single center-bottom composer and keeps guidance collapsed by default", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).toContain('data-testid="unified-launch-composer"');
    expect(markup.match(/data-testid="unified-launch-composer"/g)?.length).toBe(
      1
    );
    expect(markup).toContain('data-bare="true"');
    expect(markup).toContain('data-hide-header="true"');
    expect(markup).toContain('data-hide-clarification="true"');
    expect(markup).toContain('data-center-controls-state="collapsed"');
    expect(markup).not.toContain('data-testid="office-launch-guidance"');
    expect(markup).not.toContain('data-testid="office-clarification-panel"');
    expect(markup).not.toContain("office-cockpit-right-drawer");
  });

  it("renders clarification as a separate panel above the launcher", () => {
    useNLCommandStore.setState({
      currentDialog: {
        dialogId: "dialog-1",
        commandId: "cmd-1",
        questions: [
          {
            questionId: "outcome:1",
            text: "Clarify goal",
            type: "free_text",
          },
        ],
        answers: [],
        clarificationRounds: 1,
        status: "active",
      },
      currentCommand: {
        commandId: "cmd-1",
        commandText: "Need more delivery detail",
        userId: "user-1",
        timestamp: Date.now(),
        status: "clarifying",
        parsedIntent: "Need more delivery detail",
        constraints: [],
        objectives: [],
        priority: "medium",
      },
    });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).toContain('data-testid="office-clarification-panel"');
    expect(markup).toContain('data-testid="office-clarification-stage"');
    expect(markup).toContain(
      'data-clarification-placement="viewport-safe-top"'
    );
    expect(markup).toContain('data-testid="office-launch-stage"');
    expect(markup).toContain(
      "fixed left-1/2 top-[calc(env(safe-area-inset-top)+92px)]"
    );
    expect(markup).toContain("max-h-[min(42vh,420px)]");
    expect(markup).toContain(
      'data-center-controls-state="clarification-hidden"'
    );
    expect(markup).not.toContain('data-testid="office-center-workbench-shell"');
    expect(markup).toContain('data-testid="office-center-composer-shell"');
    expect(markup).toContain('data-testid="unified-launch-composer"');
    expect(
      markup.indexOf('data-testid="office-clarification-stage"')
    ).toBeLessThan(markup.indexOf('data-testid="office-launch-stage"'));
    expect(markup).toContain(
      'data-center-controls-state="clarification-hidden"'
    );
    expect(markup).toContain('data-testid="office-clarification-panel"');
  });
});

describe("OfficeTaskCockpit home hierarchy", () => {
  it("does not render the task queue rail on the home cockpit", () => {
    useTasksStore.setState({
      tasks: [missionSummary],
      detailsById: { "mission-1": missionDetail },
      selectedTaskId: "mission-1",
    });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="tasks-queue-rail"');
  });

  it("keeps runtime evidence tabs out of the default collapsed center console", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    for (const tab of ["support", "logs", "artifacts", "runtime"]) {
      expect(markup).not.toContain(`data-value="${tab}"`);
    }
    expect(markup).not.toContain('data-value="launch"');
    expect(markup).not.toContain('data-value="task"');
  });

  it("places the collapse control outside the composer input", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).toContain('data-testid="office-center-control-stack"');
    expect(markup).toContain(
      'data-collapse-control-placement="outside-composer"'
    );
    expect(markup).toContain('data-center-controls-state="collapsed"');
    expect(markup).not.toContain('data-testid="office-center-control-panel"');
    expect(markup).toContain('data-testid="office-center-collapse-toggle"');
    expect(markup).toContain('data-testid="office-center-composer-panel"');

    expect(
      markup.indexOf('data-testid="office-center-collapse-toggle"')
    ).toBeLessThan(markup.indexOf('data-testid="unified-launch-composer"'));

    const toggleIndex = markup.indexOf(
      'data-testid="office-center-collapse-toggle"'
    );
    const toggleStart = markup.lastIndexOf("<button", toggleIndex);
    const toggleEnd = markup.indexOf("</button>", toggleIndex);
    const toggleMarkup = markup.slice(toggleStart, toggleEnd);
    expect(toggleMarkup).toContain("pointer-events-auto");
  });

  it("keeps the support workbench collapsed by default to preserve the scene", () => {
    useNLCommandStore.setState({
      draftText:
        "Ship office cockpit by Friday with rollback tests and acceptance criteria.",
    });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).toContain('data-testid="office-center-control-stack"');
    expect(markup).toContain('data-center-controls-state="collapsed"');
    expect(markup).not.toContain('data-testid="office-center-workbench-shell"');
    expect(markup).not.toContain('data-testid="office-center-context-dock"');
    expect(markup).toContain("max-w-[1320px]");
    expect(markup).not.toContain("h-[86vh]");
    expect(markup).not.toContain("max-h-[calc(100vh-420px)]");
    expect(markup).not.toContain("h-[72vh]");
    expect(markup).not.toContain("h-[min(33vh,420px)]");
    expect(markup).not.toContain("h-[min(50vh,640px)]");
    expect(markup).not.toContain("max-h-[min(58vh,620px)]");
    expect(markup).not.toContain(
      'class="pointer-events-auto mx-auto w-full max-w-[700px] overflow-hidden rounded-[16px]'
    );
  });

  it("keeps the lower composer centered at the marked narrow width", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).toContain('data-testid="office-center-control-stack"');
    expect(markup).toContain(
      'class="pointer-events-none mx-auto w-full max-w-[1320px] overflow-visible"'
    );
    expect(markup).toContain('data-testid="office-center-composer-shell"');
    expect(markup).toContain(
      'class="pointer-events-auto mx-auto w-full max-w-[980px] overflow-visible"'
    );
    expect(
      markup.indexOf('data-testid="office-center-control-stack"')
    ).toBeLessThan(
      markup.indexOf('data-testid="office-center-composer-shell"')
    );
  });

  it("moves launch destination preview and route plan into the support tab", () => {
    useNLCommandStore.setState({
      draftText:
        "Ship office cockpit by Friday with rollback tests and acceptance criteria.",
    });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="office-launch-support-preview"');
    expect(markup).not.toContain(
      'data-testid="autopilot-destination-preview-card"'
    );
    expect(markup).not.toContain('data-testid="route-planning-overlay"');
    expect(markup).toContain('data-testid="unified-launch-composer"');
  });

  it("prioritizes launch planning over task support cards while drafting a destination", () => {
    useTasksStore.setState({
      tasks: [missionSummary],
      detailsById: {
        "mission-1": {
          ...missionDetail,
          status: "blocked",
          waitingFor: "Review the failure reason before retrying.",
          blocker: "HTTP code 404 no such container",
          currentStageLabel: "Finalize mission",
        },
      },
      selectedTaskId: "mission-1",
    });
    useNLCommandStore.setState({
      draftText:
        "Ship office cockpit by Friday with rollback tests and acceptance criteria.",
    });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="office-launch-support-preview"');
    expect(markup).not.toContain(
      'data-launch-planning-priority="destination-draft"'
    );
    expect(markup).not.toContain('data-testid="office-support-waiting-card"');
    expect(markup).not.toContain('data-testid="office-support-blocker-card"');
    expect(markup).not.toContain('data-testid="office-support-next-step-card"');
    expect(markup).not.toContain('data-testid="office-support-owner-card"');
    expect(markup).toContain('data-hide-operator-actions="true"');
  });

  it("does not render the duplicate scene HUD overlay on the home cockpit", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="office-scene-hud"');
    expect(markup).toContain('data-testid="office-launch-stage"');
  });

  it("keeps launch guidance dropdowns out of the default collapsed cockpit", () => {
    useAppStore.setState({ locale: "en-US" });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup.match(/data-testid="dropdown-menu"/g)?.length ?? 0).toBe(0);
    expect(markup.match(/data-modal="false"/g)?.length ?? 0).toBe(0);
    expect(markup.match(/data-side="top"/g)?.length ?? 0).toBe(0);
    expect(markup.match(/z-\[120\]/g)?.length ?? 0).toBe(0);
    expect(markup).not.toContain('data-testid="office-launch-guidance"');
    expect(markup).toContain('data-testid="unified-launch-composer"');
  });

  it("centers the launch composer on the viewport centerline", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).toContain("fixed bottom-[24px] left-1/2");
    expect(markup).toContain("w-[min(1320px,calc(100vw-96px))]");
    expect(markup).toContain("-translate-x-1/2");
    expect(markup).not.toContain("right:360px");
    expect(markup).not.toContain("office-cockpit-right-drawer");
  });

  it("keeps selected task detail out of the home center stage", () => {
    useTasksStore.setState({
      tasks: [missionSummary],
      detailsById: { "mission-1": missionDetail },
      selectedTaskId: "mission-1",
    });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="office-scene-hud"');
    expect(markup).not.toContain('data-testid="right-task-detail"');
    expect(markup).not.toContain('data-testid="task-detail-cards-view"');
  });
});
