import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionRecord } from "../../shared/mission/contracts.js";
import type { GraphInstanceSnapshot } from "../../shared/workflow-graph.js";
import type {
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
} from "../../shared/workflow-runtime.js";

const {
  state,
  getWorkflow,
  getWorkflows,
  getTasksByWorkflow,
  getMessagesByWorkflow,
  resolveWorkflowMission,
  getMissionTask,
  buildWorkflowGraphInstanceSnapshot,
} = vi.hoisted(() => {
  const state: {
    workflow?: WorkflowRecord;
    tasks: TaskRecord[];
    messages: MessageRecord[];
    missionId?: string;
    mission?: MissionRecord;
    instance?: GraphInstanceSnapshot;
  } = {
    workflow: undefined,
    tasks: [],
    messages: [],
    missionId: undefined,
    mission: undefined,
    instance: undefined,
  };

  return {
    state,
    getWorkflow: vi.fn((id: string) =>
      state.workflow?.id === id ? state.workflow : undefined
    ),
    getWorkflows: vi.fn(() => (state.workflow ? [state.workflow] : [])),
    getTasksByWorkflow: vi.fn((workflowId: string) =>
      state.tasks.filter(task => task.workflow_id === workflowId)
    ),
    getMessagesByWorkflow: vi.fn((workflowId: string) =>
      state.messages.filter(message => message.workflow_id === workflowId)
    ),
    resolveWorkflowMission: vi.fn((workflowId: string) =>
      state.workflow?.id === workflowId ? state.missionId : undefined
    ),
    getMissionTask: vi.fn((missionId: string) =>
      state.mission?.id === missionId ? state.mission : undefined
    ),
    buildWorkflowGraphInstanceSnapshot: vi.fn(() => {
      if (!state.instance) {
        throw new Error("graph instance not seeded for test");
      }
      return state.instance;
    }),
  };
});

vi.mock("../db/index.js", () => ({
  default: {
    getWorkflow,
    getWorkflows,
    getTasksByWorkflow,
    getMessagesByWorkflow,
  },
}));

vi.mock("../core/ai-config.js", () => ({
  getAIConfig: () => ({ model: "gpt-5.4" }),
}));

vi.mock("../core/dynamic-organization.js", () => ({
  generateWorkflowOrganization: vi.fn(),
}));

vi.mock("../core/workflow-engine.js", () => ({
  workflowEngine: {
    startWorkflow: vi.fn(),
  },
}));

vi.mock("../core/workflow-graph-projection.js", () => ({
  buildWorkflowGraphInstanceSnapshot,
}));

vi.mock("../memory/report-store.js", () => ({
  reportStore: {
    readFinalWorkflowReport: vi.fn(),
    getFinalWorkflowReportFilePath: vi.fn(),
    getDepartmentReportFilePath: vi.fn(),
  },
}));

vi.mock("../runtime/server-runtime.js", () => ({
  serverRuntime: {
    llmProvider: {},
  },
}));

vi.mock("../tasks/mission-runtime.js", () => ({
  missionRuntime: {
    getTask: getMissionTask,
  },
}));

vi.mock("../core/mission-enrichment-bridge.js", () => ({
  linkWorkflowToMission: vi.fn(),
  resolveWorkflowMission,
}));

vi.mock("../../shared/workflow-input.js", () => ({
  buildWorkflowDirectiveContext: vi.fn((directive: string) => directive),
  buildWorkflowInputSignature: vi.fn(() => "test-signature"),
  normalizeWorkflowAttachments: vi.fn((attachments: unknown) =>
    Array.isArray(attachments) ? attachments : []
  ),
}));

function makeWorkflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "wf-graph-route",
    directive: "Build workflow graph projection",
    status: "running",
    current_stage: "execution",
    departments_involved: ["ai"],
    started_at: "2026-04-22T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-04-22T00:00:00.000Z",
    results: {},
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 1,
    workflow_id: "wf-graph-route",
    worker_id: "agent-worker",
    manager_id: "agent-manager",
    department: "AI",
    description: "Answer the user question",
    deliverable: "Draft answer",
    deliverable_v2: null,
    deliverable_v3: null,
    score_accuracy: null,
    score_completeness: null,
    score_actionability: null,
    score_format: null,
    total_score: null,
    manager_feedback: null,
    meta_audit_feedback: null,
    verify_result: null,
    version: 1,
    status: "running",
    created_at: "2026-04-22T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: 1,
    workflow_id: "wf-graph-route",
    from_agent: "agent-worker",
    to_agent: "agent-manager",
    stage: "execution",
    content: "Draft answer ready",
    metadata: {},
    created_at: "2026-04-22T00:00:01.000Z",
    ...overrides,
  };
}

function makeMission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "mission-route",
    kind: "chat",
    title: "Workflow mission",
    sourceText: "Build workflow graph projection",
    topicId: "session-route",
    status: "running",
    progress: 48,
    currentStageKey: "execute",
    stages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    ...overrides,
  };
}

function makeInstance(
  overrides: Partial<GraphInstanceSnapshot> = {}
): GraphInstanceSnapshot {
  return {
    kind: "graph_instance_snapshot",
    version: 1,
    instanceId: "wf-graph-route",
    workflowId: "wf-graph-route",
    missionId: "mission-route",
    sessionId: "session-route",
    directive: "Build workflow graph projection",
    status: "EXECUTING",
    workflowStatus: "running",
    missionStatus: "running",
    currentStage: "execution",
    createdAt: "2026-04-22T00:00:00.000Z",
    startedAt: "2026-04-22T00:00:00.000Z",
    completedAt: null,
    links: {
      workflowId: "wf-graph-route",
      missionId: "mission-route",
      sessionId: "session-route",
      replayId: "wf-graph-route",
    },
    nodeRuns: [],
    edgeTransitions: [],
    telemetry: {
      messageCount: 1,
      taskCount: 1,
      errorCount: 0,
    },
    ...overrides,
  };
}

async function withServer(
  handler: (baseUrl: string) => Promise<void>
): Promise<void> {
  const { default: workflowRoutes } = await import("../routes/workflows.js");
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRoutes);

  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

describe("workflow graph-instance route", () => {
  beforeEach(() => {
    state.workflow = undefined;
    state.tasks = [];
    state.messages = [];
    state.missionId = undefined;
    state.mission = undefined;
    state.instance = undefined;

    getWorkflow.mockClear();
    getWorkflows.mockClear();
    getTasksByWorkflow.mockClear();
    getMessagesByWorkflow.mockClear();
    resolveWorkflowMission.mockClear();
    getMissionTask.mockClear();
    buildWorkflowGraphInstanceSnapshot.mockClear();
  });

  it("returns 404 when the workflow does not exist", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/wf-missing/graph-instance`
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Workflow not found" });
      expect(buildWorkflowGraphInstanceSnapshot).not.toHaveBeenCalled();
      expect(getMissionTask).not.toHaveBeenCalled();
    });
  });

  it("returns a projected graph instance for a linked mission", async () => {
    state.workflow = makeWorkflow();
    state.tasks = [makeTask()];
    state.messages = [makeMessage()];
    state.missionId = "mission-route";
    state.mission = makeMission();
    state.instance = makeInstance();

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/graph-instance`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ instance: state.instance });
      expect(resolveWorkflowMission).toHaveBeenCalledWith("wf-graph-route");
      expect(getMissionTask).toHaveBeenCalledWith("mission-route");
      expect(buildWorkflowGraphInstanceSnapshot).toHaveBeenCalledWith({
        workflow: state.workflow,
        tasks: state.tasks,
        messages: state.messages,
        mission: state.mission,
      });
    });
  });

  it("still projects a graph instance when no mission is linked", async () => {
    state.workflow = makeWorkflow({ id: "wf-without-mission" });
    state.tasks = [makeTask({ workflow_id: "wf-without-mission" })];
    state.messages = [makeMessage({ workflow_id: "wf-without-mission" })];
    state.instance = makeInstance({
      instanceId: "wf-without-mission",
      workflowId: "wf-without-mission",
      missionId: undefined,
      sessionId: undefined,
      links: {
        workflowId: "wf-without-mission",
        replayId: "wf-without-mission",
      },
    });

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/wf-without-mission/graph-instance`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ instance: state.instance });
      expect(resolveWorkflowMission).toHaveBeenCalledWith("wf-without-mission");
      expect(getMissionTask).not.toHaveBeenCalled();
      expect(buildWorkflowGraphInstanceSnapshot).toHaveBeenCalledWith({
        workflow: state.workflow,
        tasks: state.tasks,
        messages: state.messages,
        mission: undefined,
      });
    });
  });
});
