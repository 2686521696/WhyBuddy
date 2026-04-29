import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/* ─── hoisted mocks ─── */

const { useNLCommandStoreMock } = vi.hoisted(() => {
  const state = {
    currentDialog: null as any,
    currentCommand: null as any,
  };
  const hook = ((selector: (value: typeof state) => unknown) =>
    selector(state)) as any;
  hook.setState = (partial: Partial<typeof state>) => {
    Object.assign(state, partial);
  };
  hook.getState = () => state;
  return { useNLCommandStoreMock: hook };
});

/* ─── capture what TaskDetailCardsView receives ─── */

const { capturedProps, TaskDetailCardsViewMock } = vi.hoisted(() => {
  const capturedProps: Array<{ taskId: string; autopilotSummary: unknown }> = [];
  const TaskDetailCardsViewMock = (props: {
    taskId: string;
    autopilotSummary: unknown;
    [key: string]: unknown;
  }) => {
    capturedProps.push({
      taskId: props.taskId,
      autopilotSummary: props.autopilotSummary,
    });
    return (
      <div
        data-testid="task-detail-cards-view"
        data-task-id={props.taskId}
        data-has-autopilot={props.autopilotSummary != null ? "true" : "false"}
      >
        mocked cards view
      </div>
    );
  };
  return { capturedProps, TaskDetailCardsViewMock };
});

import { OfficeTaskCockpit } from "../OfficeTaskCockpit";
import { useAppStore } from "@/lib/store";
import { useNLCommandStore } from "@/lib/nl-command-store";
import { useTasksStore } from "@/lib/tasks-store";
import type { MissionTaskDetail } from "@/lib/tasks-store";
import { useTelemetryStore } from "@/lib/telemetry-store";
import { useWorkflowStore } from "@/lib/workflow-store";

/* ─── module mocks ─── */

vi.mock("antd", () => {
  function Panel({ children }: { children?: React.ReactNode }) {
    return <div data-testid="splitter-panel">{children}</div>;
  }
  function Splitter({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) {
    return <div className={className}>{children}</div>;
  }
  Splitter.Panel = Panel;
  return { Splitter };
});

vi.mock("@/lib/nl-command-store", () => ({
  useNLCommandStore: useNLCommandStoreMock,
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ locale: "en-US" }),
}));

vi.mock("@/components/launch/UnifiedLaunchComposer", () => ({
  UnifiedLaunchComposer: () => (
    <div data-testid="unified-launch-composer">mocked composer</div>
  ),
}));

vi.mock("@/components/nl-command/ClarificationPanel", () => ({
  ClarificationPanel: () => null,
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
  TasksQueueRail: () => <div>mocked task queue</div>,
}));

vi.mock("@/components/tasks/TaskDetailCardsView", () => ({
  TaskDetailCardsView: TaskDetailCardsViewMock,
}));

vi.mock("./OfficeAgentInspectorPanel", () => ({
  OfficeAgentInspectorPanel: () => null,
}));

vi.mock("./OfficeWorkflowContextPanels", () => ({
  OfficeMemoryReportsPanel: () => null,
  OfficeWorkflowFlowPanel: () => null,
  OfficeWorkflowHistoryPanel: () => null,
}));

vi.mock("@/components/launch/LaunchPanelShell", () => ({
  LaunchPanelShell: () => null,
}));

/* ─── helpers ─── */

const noopAsync = async () => {};
const noopAsyncNullable = async () => null;
const noopToggle = () => {};

function makeMockDetail(
  id: string,
  overrides?: Partial<MissionTaskDetail>,
): MissionTaskDetail {
  return {
    id,
    title: `Task ${id}`,
    kind: "general",
    sourceText: "test source",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 50,
    currentStageKey: "execution",
    currentStageLabel: "Execution",
    summary: "Test summary",
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
    messageCount: 5,
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
    } as any,
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
    decisionPlaceholder: null,
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
    ...overrides,
  } as MissionTaskDetail;
}

function makeMockTaskSummary(id: string) {
  return {
    id,
    title: `Task ${id}`,
    kind: "general",
    sourceText: "",
    status: "running" as const,
    operatorState: "active" as const,
    workflowStatus: "running" as const,
    progress: 50,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    departmentLabels: [],
    taskCount: 0,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 0,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
  };
}

/* ─── setup ─── */

beforeEach(() => {
  capturedProps.length = 0;

  useAppStore.setState({
    locale: "en-US",
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

/* ─── tests ─── */

describe("OfficeTaskCockpit home center hierarchy", () => {
  it("keeps duplicate scene HUD and detail cards out of the empty home center", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="office-scene-hud"');
    expect(markup).not.toContain('data-testid="task-detail-cards-view"');
    expect(capturedProps).toHaveLength(0);
  });

  it("keeps selected task detail out of the merged home center stack", () => {
    const detail = makeMockDetail("mission-1");
    useTasksStore.setState({
      tasks: [makeMockTaskSummary("mission-1")],
      detailsById: { "mission-1": detail },
      selectedTaskId: "mission-1",
    });

    // Verify store state is correctly set
    const state = useTasksStore.getState();
    expect(state.selectedTaskId).toBe("mission-1");
    expect(state.detailsById["mission-1"]).toBeDefined();
    expect(state.tasks).toHaveLength(1);

    // The activeTaskId computation:
    // (selectedTaskId && detailsById[selectedTaskId] ? selectedTaskId : null) || filteredTasks[0]?.id || null
    const activeTaskId =
      (state.selectedTaskId && state.detailsById[state.selectedTaskId]
        ? state.selectedTaskId
        : null) ||
      state.tasks[0]?.id ||
      null;
    expect(activeTaskId).toBe("mission-1");

    const selectedDetail = activeTaskId
      ? state.detailsById[activeTaskId] || null
      : null;
    expect(selectedDetail).not.toBeNull();
    expect(selectedDetail?.id).toBe("mission-1");

    // Verify the autopilotSummary access pattern
    expect(selectedDetail?.autopilotSummary ?? null).toBeNull();

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="office-scene-hud"');
    expect(markup).not.toContain('data-testid="right-task-detail"');
    expect(markup).not.toContain('data-testid="task-detail-cards-view"');
    expect(capturedProps).toHaveLength(0);
  });

  it("does not pass autopilotSummary into central detail cards on the home surface", () => {
    const detail = makeMockDetail("mission-2");

    useTasksStore.setState({
      tasks: [makeMockTaskSummary("mission-2")],
      detailsById: { "mission-2": detail },
      selectedTaskId: "mission-2",
    });

    renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(capturedProps).toHaveLength(0);
  });

  it("still avoids central detail cards when selectedTaskId has no matching detail", () => {
    useTasksStore.setState({
      tasks: [makeMockTaskSummary("mission-3")],
      detailsById: {},
      selectedTaskId: "mission-3",
    });

    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).not.toContain('data-testid="office-scene-hud"');
    expect(markup).not.toContain('data-testid="task-detail-cards-view"');
  });
});
