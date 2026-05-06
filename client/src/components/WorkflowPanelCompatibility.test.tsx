import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const workflowStoreState = {
  isWorkflowPanelOpen: true,
  toggleWorkflowPanel: vi.fn(),
  activeView: "history",
  setActiveView: vi.fn(),
  currentWorkflowId: "wf-graph",
  workflows: [
    {
      id: "wf-graph",
      missionId: "mission-graph",
      directive: "Advance the growth experiment",
      status: "running",
      current_stage: "execution",
      departments_involved: ["Marketing"],
      started_at: "2026-04-15T00:00:01.000Z",
      completed_at: null,
      results: {},
      created_at: "2026-04-15T00:00:00.000Z",
    },
    {
      id: "wf-review",
      missionId: "mission-review",
      directive: "Review the quarterly planning pack",
      status: "completed",
      current_stage: "summary",
      departments_involved: ["Operations"],
      started_at: "2026-04-14T00:00:01.000Z",
      completed_at: "2026-04-14T00:30:00.000Z",
      results: {},
      created_at: "2026-04-14T00:00:00.000Z",
    },
  ],
  workflowsError: null,
  currentWorkflow: {
    id: "wf-graph",
    missionId: "mission-graph",
    directive: "Advance the growth experiment",
    status: "running",
    current_stage: "execution",
    departments_involved: ["Marketing"],
    started_at: "2026-04-15T00:00:01.000Z",
    completed_at: null,
    results: {
      organization: {
        departments: ["Marketing"],
        taskProfile: "growth",
        nodes: [
          {
            id: "node-marketing",
            agentId: "agent-manager",
            departmentLabel: "Marketing",
            name: "Growth Manager",
            title: "Growth Lead",
            responsibility: "Drive the experiment decomposition",
          },
        ],
        reasoning: "Organization prepared",
      },
    },
    created_at: "2026-04-15T00:00:00.000Z",
  },
  agents: [],
  setCurrentWorkflow: vi.fn(),
  currentWorkflowGraphInstance: {
    kind: "graph_instance_snapshot",
    version: 1,
    instanceId: "graph-wf-graph",
    workflowId: "wf-graph",
    missionId: "mission-graph",
    sessionId: "session-graph",
    directive: "Advance the growth experiment",
    status: "EXECUTING",
    workflowStatus: "running",
    missionStatus: "running",
    currentStage: "execution",
    createdAt: "2026-04-15T00:00:00.000Z",
    startedAt: "2026-04-15T00:00:01.000Z",
    completedAt: null,
    links: {
      workflowId: "wf-graph",
      missionId: "mission-graph",
      sessionId: "session-graph",
    },
    nodeRuns: [
      {
        nodeId: "node-ceo",
        title: "CEO sync",
        departmentLabel: "Command",
        role: "ceo",
        stageKey: "direction",
        status: "EXECUTED",
        outputPreview: "Direction aligned",
      },
      {
        nodeId: "node-marketing",
        title: "Marketing analysis",
        departmentLabel: "Marketing",
        role: "manager",
        stageKey: "execution",
        status: "EXECUTING",
        outputPreview: "Preparing competitor sample set",
      },
    ],
    edgeTransitions: [
      {
        edgeId: "node-ceo->node-marketing",
        fromNodeId: "node-ceo",
        toNodeId: "node-marketing",
        kind: "parent_child",
        status: "executed",
      },
    ],
    telemetry: {
      messageCount: 6,
      taskCount: 2,
      errorCount: 0,
      waitingFor: "Waiting for budget approval",
    },
  },
  currentWorkflowMonitoringInstance: {
    id: 101,
    instanceUuid: "wf-graph",
    orchestrationCode: "growth-agent-pipeline",
    orchestrationName: "Growth Agent Pipeline",
    orchestrationVersion: 3,
    category: "growth",
    sourceApp: "web-aigc",
    status: "EXECUTING",
    executor: "office-runtime",
    startTime: "2026-04-15T00:00:01.000Z",
    endTime: null,
    lastUpdateTime: "2026-04-15T00:03:00.000Z",
    inputVariables: {},
    outputVariables: {},
    nodes: [
      {
        id: 1,
        nodeId: "node-marketing",
        nodeLabel: "Marketing planner",
        nodeType: "planner",
        status: "EXECUTING",
        startTime: "2026-04-15T00:00:01.000Z",
        endTime: null,
        inputData: null,
        outputData: null,
        errorMessage: null,
        position: { x: 0, y: 0 },
      },
      {
        id: 2,
        nodeId: "node-review",
        nodeLabel: "Human checkpoint",
        nodeType: "review",
        status: "EXCEPTION",
        startTime: "2026-04-15T00:02:00.000Z",
        endTime: null,
        inputData: null,
        outputData: null,
        errorMessage: "Budget approval is still pending",
        position: { x: 120, y: 80 },
      },
    ],
    edges: [],
  },
  currentWorkflowMonitoringSession: {
    sessionId: "session-graph",
    user: "operator",
    startTime: "2026-04-15T00:00:01.000Z",
    sourceApp: "web-aigc",
    messages: [
      {
        id: "msg-1",
        role: "assistant",
        content: "Growth graph execution is in progress.",
        timestamp: "2026-04-15T00:02:00.000Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "Waiting for budget approval before the next node runs.",
        timestamp: "2026-04-15T00:03:00.000Z",
      },
    ],
  },
  fetchWorkflows: vi.fn(async () => {}),
  fetchWorkflowGraphInstance: vi.fn(async () => {}),
  fetchWorkflowMonitoringInstance: vi.fn(async () => {}),
  fetchWorkflowMonitoringSession: vi.fn(async () => {}),
  terminateWorkflowMonitoringInstance: vi.fn(async () => null),
};

const taskStoreState = {
  tasks: [
    {
      id: "mission-graph",
      title: "Advance the growth experiment",
      status: "running",
    },
    {
      id: "mission-review",
      title: "Review the quarterly planning pack",
      status: "done",
    },
  ],
  detailsById: {
    "mission-graph": {
      id: "mission-graph",
      title: "Advance the growth experiment",
      currentStageLabel: "Execution",
      summary: "Prepare the next launch decision.",
      sourceText: "Advance the growth experiment",
    },
  },
  selectedTaskId: "mission-graph",
};

vi.mock("wouter", () => ({
  useLocation: () => ["/workflow", vi.fn()],
}));

vi.mock("@/hooks/useViewportTier", () => ({
  useViewportTier: () => ({
    isMobile: false,
    isTablet: false,
  }),
}));

vi.mock("@/components/SessionHistoryTab", () => ({
  SessionHistoryTab: () => <div>session-history-tab</div>,
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    copy: {
      common: {
        close: "Close",
        unavailable: "Unavailable",
      },
      workflow: {
        title: "Workflow",
        tabs: {
          directive: "Directive",
          org: "Org",
          workflow: "Workflow",
          review: "Review",
          memory: "Memory",
          reports: "Reports",
          history: "History",
          sessions: "Sessions",
        },
      },
    },
  }),
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: any) => unknown) =>
    selector({
      locale: "en-US",
      runtimeMode: "advanced",
      selectedPet: null,
      setSelectedPet: vi.fn(),
    }),
}));

vi.mock("@/lib/tasks-store", () => ({
  useTasksStore: (selector: (state: typeof taskStoreState) => unknown) =>
    selector(taskStoreState),
}));

vi.mock("@/lib/project-store", () => ({
  selectCurrentProject: () => null,
  useProjectStore: (
    selector: (state: { missions: []; projects: [] }) => unknown
  ) =>
    selector({
      missions: [],
      projects: [],
    }),
}));

vi.mock("@/lib/workflow-store", () => ({
  useWorkflowStore: (selector: (state: typeof workflowStoreState) => unknown) =>
    selector(workflowStoreState),
}));

vi.mock("@/lib/workflow-selectors", () => ({
  selectWorkflowLegacyDestination: () => ({
    kind: "legacy",
    href: null,
    agentId: null,
  }),
  selectWorkflowMissionDetail: (workflow: any, detailsById: any) =>
    workflow?.missionId ? detailsById[workflow.missionId] : null,
  selectWorkflowOrganization: (workflow: any) =>
    workflow?.results?.organization ?? null,
}));

import { WorkflowPanelCompatibility } from "./WorkflowPanelCompatibility";

describe("WorkflowPanelCompatibility", () => {
  it("renders web-aigc monitoring summary inside the history compatibility view", () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanelCompatibility embedded />
    );

    expect(markup).toContain("web-aigc compatibility monitor");
    expect(markup).toContain("Graph runtime compatibility");
    expect(markup).toContain("Marketing analysis");
    expect(markup).toContain("Waiting for budget approval");
    expect(markup).toContain("Recent workflows");
    expect(markup).toContain("growth-agent-pipeline");
    expect(markup).toContain("office-runtime");
    expect(markup).toContain("Node execution preview");
    expect(markup).toContain("Marketing planner");
    expect(markup).toContain("Budget approval is still pending");
    expect(markup).toContain("Recent session summary");
    expect(markup).toContain("Waiting for budget approval before the next node runs.");
    expect(markup).toContain("Review the quarterly planning pack");
  });
});
