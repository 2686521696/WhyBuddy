import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { tasksState, workflowState } = vi.hoisted(() => {
  const now = Date.now();
  const missionSummary = {
    id: "mission-1",
    title: "Review launch-free task workbench",
    kind: "general",
    sourceText: "The tasks page should inspect existing work only.",
    status: "running",
    operatorState: "idle",
    workflowStatus: "running",
    progress: 48,
    currentStageKey: "execution",
    currentStageLabel: "Execution",
    summary: "Task workbench tabs stay focused on follow-up.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    departmentLabels: ["Engineering"],
    taskCount: 4,
    completedTaskCount: 2,
    messageCount: 3,
    activeAgentCount: 1,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
  };
  const missionDetail = {
    ...missionSummary,
    workflow: null,
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
      socket: { status: "idle", label: "Socket", detail: "Idle" },
      callback: { status: "idle", label: "Callback", detail: "Idle" },
    },
    decisionHistory: [],
    operatorActions: [],
  };
  const tasksState = {
    ensureReady: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    selectTask: vi.fn(),
    submitOperatorAction: vi.fn(async () => null),
    setDecisionNote: vi.fn(),
    launchDecision: vi.fn(async () => null),
    tasks: [missionSummary],
    detailsById: { "mission-1": missionDetail },
    selectedTaskId: "mission-1" as string | null,
    loading: false,
    ready: true,
    error: null as string | null,
    decisionNotes: {},
    operatorActionLoadingByMissionId: {},
  };
  const workflowState = {
    workflows: [
      {
        id: "workflow-1",
        missionId: "mission-1",
        directive: "Review launch-free task workbench",
        status: "running",
        current_stage: "execution",
        departments_involved: ["Engineering"],
        started_at: null,
        completed_at: null,
        results: {},
        created_at: new Date(now).toISOString(),
      },
    ],
    agents: [{ id: "agent-1", name: "Coordinator" }],
    currentWorkflow: null,
    currentWorkflowId: null,
    fetchAgents: vi.fn(async () => {}),
    fetchStages: vi.fn(async () => {}),
    fetchWorkflows: vi.fn(async () => {}),
    setCurrentWorkflow: vi.fn(),
  };

  return { tasksState, workflowState };
});

import TasksPage from "./TasksPage";

vi.mock("@/hooks/useViewportTier", () => ({
  useViewportTier: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    tier: "desktop",
  }),
  useViewportWidth: () => 1440,
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    copy: {
      tasks: {
        listPage: {
          actionSuccess: (label: string) => `Action succeeded: ${label}`,
          actionError: "Action failed",
        },
        statuses: {
          action: {
            approve: "Approve",
            reject: "Reject",
            "request-changes": "Request changes",
            markBlocked: "Mark blocked",
            delegate: "Delegate",
          },
        },
      },
    },
  }),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value?: string;
  }) => (
    <div data-testid="tasks-workbench-tabs" data-value={value}>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="tasks-workbench-tab-list">{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
    disabled,
  }: {
    children?: React.ReactNode;
    value: string;
    disabled?: boolean;
  }) => (
    <button
      data-testid={`tasks-workbench-tab-${value}`}
      data-value={value}
      disabled={disabled}
    >
      {children}
    </button>
  ),
  TabsContent: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value: string;
  }) => <div data-testid={`tasks-workbench-panel-${value}`}>{children}</div>,
}));

vi.mock("@/components/tasks/TasksCockpitDetail", () => ({
  TasksCockpitDetail: () => (
    <section data-testid="tasks-cockpit-detail">Task detail tab</section>
  ),
}));

vi.mock("@/components/tasks/TasksQueueRail", () => ({
  TasksQueueRail: () => (
    <aside data-testid="tasks-queue-rail">Task queue rail</aside>
  ),
}));

vi.mock("@/components/office/OfficeAgentInspectorPanel", () => ({
  OfficeAgentInspectorPanel: () => (
    <section data-testid="office-agent-inspector-panel">Agent panel</section>
  ),
}));

vi.mock("@/components/office/OfficeWorkflowContextPanels", () => ({
  OfficeWorkflowFlowPanel: () => (
    <section data-testid="office-workflow-flow-panel">Flow panel</section>
  ),
  OfficeMemoryReportsPanel: () => (
    <section data-testid="office-memory-reports-panel">Memory panel</section>
  ),
  OfficeWorkflowHistoryPanel: () => (
    <section data-testid="office-workflow-history-panel">History panel</section>
  ),
}));

vi.mock("@/lib/tasks-store", () => ({
  useTasksStore: (selector: (state: typeof tasksState) => unknown) =>
    selector(tasksState),
}));

vi.mock("@/lib/workflow-store", () => ({
  useWorkflowStore: (selector: (state: typeof workflowState) => unknown) =>
    selector(workflowState),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("TasksPage workbench tabs", () => {
  beforeEach(() => {
    tasksState.selectedTaskId = "mission-1";
    tasksState.selectTask.mockClear();
    workflowState.fetchAgents.mockClear();
    workflowState.fetchStages.mockClear();
    workflowState.fetchWorkflows.mockClear();
    workflowState.setCurrentWorkflow.mockClear();
  });

  it("renders the dedicated task workbench tabs without a launch tab", () => {
    const markup = renderToStaticMarkup(<TasksPage />);

    expect(markup).toContain('data-testid="tasks-queue-rail"');
    expect(markup).toContain('data-testid="tasks-page-dashboard"');
    expect(markup).toContain('data-testid="tasks-page-focus-card"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-task"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-flow"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-agent"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-memory"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-history"');
    expect(markup).toContain(">Agent</button>");
    expect(markup).not.toContain('data-testid="tasks-workbench-tab-launch"');
    expect(markup).not.toContain('data-value="launch"');
    expect(markup).toContain('data-testid="tasks-cockpit-detail"');
  });
});
