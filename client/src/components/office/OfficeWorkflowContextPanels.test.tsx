import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowInfo } from "@/lib/workflow-store";

const workflowStoreState = {
  stages: [
    { id: "direction", order: 1, label: "Direction" },
    { id: "planning", order: 2, label: "Planning" },
    { id: "execution", order: 3, label: "Execution" },
    { id: "review", order: 4, label: "Review" },
  ],
  tasks: [
    {
      id: 1,
      workflow_id: "wf-graph",
      worker_id: "agent-worker",
      manager_id: "agent-manager",
      department: "Marketing",
      description: "Prepare launch plan",
      deliverable: null,
      deliverable_v2: null,
      deliverable_v3: null,
      score_accuracy: null,
      score_completeness: null,
      score_actionability: null,
      score_format: null,
      total_score: null,
      manager_feedback: null,
      meta_audit_feedback: null,
      version: 1,
      status: "running",
    },
  ],
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
  ],
  workflowsError: null,
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
      {
        nodeId: "node-review",
        title: "Human review",
        departmentLabel: "Operations",
        role: "worker",
        stageKey: "review",
        status: "WAITING_INPUT",
        error: "Waiting for budget confirmation",
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
      errorCount: 1,
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
    links: {
      workflowId: "wf-graph",
      missionId: "mission-graph",
      sessionId: "session-monitor-links",
      replayId: "replay-monitor-graph",
      auditId: "audit-monitor-graph",
    },
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
  monitoringInstances: [
    {
      id: 101,
      instanceUuid: "wf-graph",
      orchestrationCode: "growth-agent-pipeline",
      orchestrationName: "Growth Agent Pipeline",
      orchestrationVersion: 3,
      category: "growth",
      sourceApp: "web-aigc",
      status: "EXECUTING",
      executor: "office-runtime",
      lastExecutionTime: "2026-04-15T00:03:00.000Z",
      startTime: "2026-04-15T00:00:01.000Z",
      endTime: null,
    },
  ],
  fetchWorkflows: vi.fn(async () => {}),
  fetchWorkflowGraphInstance: vi.fn(async () => {}),
  fetchWorkflowMonitoringInstance: vi.fn(async () => {}),
  fetchWorkflowMonitoringSession: vi.fn(async () => {}),
  terminateWorkflowMonitoringInstance: vi.fn(async () => null),
  downloadWorkflowReport: vi.fn(async () => {}),
  downloadDepartmentReport: vi.fn(async () => {}),
};

const activeWorkflow: WorkflowInfo = {
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
};

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "en-US",
    copy: {
      common: {
        unavailable: "Unavailable",
      },
    },
    setLocale: () => {},
    toggleLocale: () => {},
  }),
}));

vi.mock("@/lib/store", () => ({
  useAppStore: () => null,
}));

vi.mock("@/lib/project-store", () => ({
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

import {
  OfficeWorkflowFlowPanel,
  OfficeWorkflowHistoryPanel,
} from "./OfficeWorkflowContextPanels";

beforeEach(() => {
  workflowStoreState.fetchWorkflows.mockClear();
  workflowStoreState.fetchWorkflowGraphInstance.mockClear();
  workflowStoreState.fetchWorkflowMonitoringInstance.mockClear();
  workflowStoreState.fetchWorkflowMonitoringSession.mockClear();
  workflowStoreState.terminateWorkflowMonitoringInstance.mockClear();
  workflowStoreState.downloadWorkflowReport.mockClear();
  workflowStoreState.downloadDepartmentReport.mockClear();
});

describe("OfficeWorkflowFlowPanel", () => {
  it("renders graph instance runtime summary and node runs", () => {
    const markup = renderToStaticMarkup(
      <OfficeWorkflowFlowPanel
        workflow={{
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
        }}
        missionDetail={
          {
            id: "mission-graph",
            title: "Advance the growth experiment",
            taskCount: 2,
          } as any
        }
        onOpenTask={() => {}}
      />
    );

    expect(markup).toContain("Graph instance runtime");
    expect(markup).toContain("Total nodes");
    expect(markup).toContain("Waiting for budget approval");
    expect(markup).toContain("Marketing analysis");
    expect(markup).toContain("Waiting input");
    expect(markup).toContain("Human review");
    expect(markup).toContain("Waiting for budget confirmation");
  });
});

describe("OfficeWorkflowHistoryPanel", () => {
  it("renders web-aigc compatibility monitoring content", () => {
    const markup = renderToStaticMarkup(
      <OfficeWorkflowHistoryPanel
        workflow={activeWorkflow}
        activeWorkflowId="wf-graph"
        onSelectWorkflow={() => {}}
      />
    );

    expect(markup).toContain("History and compatibility");
    expect(markup).toContain("Graph runtime compatibility");
    expect(markup).toContain("Runtime status");
    expect(markup).toMatch(/Runtime status[\s\S]*?(EXECUTING|Executing)/);
    expect(markup).toMatch(/Total nodes[\s\S]*?>3</);
    expect(markup).toMatch(/Edge transitions[\s\S]*?>1</);
    expect(markup).toContain("Waiting for budget approval");
    expect(markup).toContain("CEO sync");
    expect(markup).toContain("Marketing analysis");
    expect(markup).toContain("web-aigc compatibility monitor");
    expect(markup).toContain("growth-agent-pipeline");
    expect(markup).toContain("office-runtime");
    expect(markup).toContain("Projection links");
    expect(markup).toContain("replay-monitor-graph");
    expect(markup).toContain("audit-monitor-graph");
    expect(markup).toContain("session-monitor-links");
    expect(markup).toContain("Node execution snapshot");
    expect(markup).toContain("Marketing planner");
    expect(markup).toContain("Budget approval is still pending");
    expect(markup).toContain("Recent session messages");
    expect(markup).toContain("Waiting for budget approval before the next node runs.");
    expect(markup).toContain("Recent workflows");
    expect(markup).toContain("Advance the growth experiment");
  });
});
