import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionRecord } from "../../shared/mission/contracts.js";
import type { GraphInstanceSnapshot } from "../../shared/workflow-graph.js";
import type {
  WebAigcGraphDefinition,
  WebAigcGraphInstance,
} from "../../shared/workflow-domain.js";
import type {
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
} from "../../shared/workflow-runtime.js";

const {
  state,
  getWorkflow,
  updateWorkflow,
  getWorkflows,
  getTasksByWorkflow,
  getMessagesByWorkflow,
  resolveWorkflowMission,
  getMissionTask,
  buildWorkflowGraphInstanceSnapshot,
  buildWorkflowGraphDefinition,
  buildWorkflowGraphInstance,
  getRuntimeState,
  runToCheckpoint,
  resumeRuntime,
  terminateRuntime,
  retryRuntime,
  escalateRuntime,
} = vi.hoisted(() => {
  const state: {
    workflow?: WorkflowRecord;
    tasks: TaskRecord[];
    messages: MessageRecord[];
    missionId?: string;
    mission?: MissionRecord;
    instance?: GraphInstanceSnapshot;
    definition?: WebAigcGraphDefinition;
    runtimeInstance?: WebAigcGraphInstance;
    runtimeState?: {
      domainModelVersion: 1;
      definition: WebAigcGraphDefinition;
      instance: WebAigcGraphInstance;
      updatedAt?: string;
    };
  } = {
    workflow: undefined,
    tasks: [],
    messages: [],
    missionId: undefined,
    mission: undefined,
    instance: undefined,
    definition: undefined,
    runtimeInstance: undefined,
    runtimeState: undefined,
  };

  return {
    state,
    getWorkflow: vi.fn((id: string) =>
      state.workflow?.id === id ? state.workflow : undefined
    ),
    updateWorkflow: vi.fn((id: string, patch: Partial<WorkflowRecord>) => {
      if (state.workflow?.id === id) {
        state.workflow = {
          ...state.workflow,
          ...patch,
          results: {
            ...(state.workflow.results || {}),
            ...((patch.results as Record<string, unknown> | undefined) || {}),
          },
        } as WorkflowRecord;
      }
    }),
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
    buildWorkflowGraphDefinition: vi.fn(() => {
      if (!state.definition) {
        throw new Error("runtime definition not seeded for test");
      }
      return state.definition;
    }),
    buildWorkflowGraphInstance: vi.fn(() => {
      if (!state.runtimeInstance) {
        throw new Error("runtime instance not seeded for test");
      }
      return state.runtimeInstance;
    }),
    getRuntimeState: vi.fn(() => state.runtimeState),
    runToCheckpoint: vi.fn(async () => {
      if (!state.runtimeState) {
        throw new Error("runtime state not seeded for test");
      }
      return state.runtimeState;
    }),
    resumeRuntime: vi.fn(async () => {
      if (!state.runtimeState) {
        throw new Error("runtime state not seeded for test");
      }
      return state.runtimeState;
    }),
    terminateRuntime: vi.fn(() => {
      if (!state.runtimeState) {
        throw new Error("runtime state not seeded for test");
      }
      return state.runtimeState;
    }),
    retryRuntime: vi.fn(async () => {
      if (!state.runtimeState) {
        throw new Error("runtime state not seeded for test");
      }
      return state.runtimeState;
    }),
    escalateRuntime: vi.fn(() => {
      if (!state.runtimeState) {
        throw new Error("runtime state not seeded for test");
      }
      return state.runtimeState;
    }),
  };
});

vi.mock("../db/index.js", () => ({
  default: {
    getWorkflow,
    updateWorkflow,
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
    startWorkflow: vi.fn(async () => "wf-created"),
  },
}));

vi.mock("../core/workflow-graph-projection.js", () => ({
  buildWorkflowGraphInstanceSnapshot,
}));

vi.mock("../core/workflow-runtime-engine.js", () => ({
  buildWorkflowGraphDefinition,
  buildWorkflowGraphInstance,
  webAigcRuntimeEngine: {
    getState: getRuntimeState,
    runToCheckpoint,
    resume: resumeRuntime,
    terminate: terminateRuntime,
    retry: retryRuntime,
    escalate: escalateRuntime,
  },
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
    createChatTask: vi.fn(() => makeMission({ id: "mission-created" })),
    markMissionRunning: vi.fn(),
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
  normalizeWorkflowInputProjection: vi.fn((projection: unknown) =>
    projection && typeof projection === "object" ? projection : undefined
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

function makeRuntimeDefinition(
  overrides: Partial<WebAigcGraphDefinition> = {}
): WebAigcGraphDefinition {
  return {
    kind: "graph_definition",
    version: 1,
    definitionId: "wf-graph-route",
    code: "wf-graph-route",
    name: "Build workflow graph projection",
    source: "task_projection",
    entryNodeId: "task-1",
    graphVersion: {
      kind: "graph_version",
      version: 1,
      definitionId: "wf-graph-route",
      graphVersion: "v1",
      createdAt: "2026-04-22T00:00:00.000Z",
    },
    links: {
      workflowId: "wf-graph-route",
      missionId: "mission-route",
      sessionId: "session-route",
      replayId: "wf-graph-route",
    },
    nodeSchemas: [
      {
        id: "task-1",
        type: "agent_task",
        title: "Answer the user question",
        inputs: [],
        outputs: [],
        config: [],
      },
    ],
    edgeSchemas: [],
    ...overrides,
  };
}

function makeRuntimeInstance(
  overrides: Partial<WebAigcGraphInstance> = {}
): WebAigcGraphInstance {
  return {
    kind: "graph_instance",
    version: 1,
    instanceId: "wf-graph-route",
    definitionId: "wf-graph-route",
    status: "WAITING_INPUT",
    currentNodeId: "task-1",
    createdAt: "2026-04-22T00:00:00.000Z",
    startedAt: "2026-04-22T00:00:00.000Z",
    completedAt: null,
    links: {
      workflowId: "wf-graph-route",
      missionId: "mission-route",
      sessionId: "session-route",
      replayId: "wf-graph-route",
    },
    variables: {},
    nodeRuns: [
      {
        nodeId: "task-1",
        status: "WAITING_INPUT",
        attempts: 1,
        startedAt: "2026-04-22T00:00:00.000Z",
        completedAt: null,
        waitingFor: "approval token",
      },
    ],
    edgeTransitions: [],
    checkpoint: {
      nodeId: "task-1",
      waitingFor: "approval token",
      createdAt: "2026-04-22T00:00:01.000Z",
      resumeCount: 0,
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
    state.definition = undefined;
    state.runtimeInstance = undefined;
    state.runtimeState = undefined;

    getWorkflow.mockClear();
    updateWorkflow.mockClear();
    getWorkflows.mockClear();
    getTasksByWorkflow.mockClear();
    getMessagesByWorkflow.mockClear();
    resolveWorkflowMission.mockClear();
    getMissionTask.mockClear();
    buildWorkflowGraphInstanceSnapshot.mockClear();
    buildWorkflowGraphDefinition.mockClear();
    buildWorkflowGraphInstance.mockClear();
    getRuntimeState.mockClear();
    runToCheckpoint.mockClear();
    resumeRuntime.mockClear();
    terminateRuntime.mockClear();
    retryRuntime.mockClear();
    escalateRuntime.mockClear();
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

  it("returns a projected runtime definition", async () => {
    state.workflow = makeWorkflow();
    state.tasks = [makeTask()];
    state.missionId = "mission-route";
    state.mission = makeMission();
    state.definition = makeRuntimeDefinition();

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/runtime-definition`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ definition: state.definition });
      expect(buildWorkflowGraphDefinition).toHaveBeenCalledWith({
        workflow: state.workflow,
        tasks: state.tasks,
        mission: state.mission,
      });
    });
  });

  it("returns persisted runtime state when available", async () => {
    state.workflow = makeWorkflow();
    state.runtimeState = {
      domainModelVersion: 1,
      definition: makeRuntimeDefinition(),
      instance: makeRuntimeInstance(),
      updatedAt: "2026-04-22T00:00:02.000Z",
    };

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/runtime-state`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ state: state.runtimeState });
      expect(getRuntimeState).toHaveBeenCalledWith("wf-graph-route", undefined);
      expect(buildWorkflowGraphDefinition).not.toHaveBeenCalled();
    });
  });

  it("runs the lightweight runtime until checkpoint", async () => {
    state.workflow = makeWorkflow();
    state.tasks = [makeTask()];
    state.missionId = "mission-route";
    state.mission = makeMission();
    state.definition = makeRuntimeDefinition();
    state.runtimeState = {
      domainModelVersion: 1,
      definition: state.definition,
      instance: makeRuntimeInstance(),
      updatedAt: "2026-04-22T00:00:02.000Z",
    };

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/runtime/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            variables: { seed: "value" },
            maxSteps: 3,
          }),
        }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ state: state.runtimeState });
      expect(runToCheckpoint).toHaveBeenCalledWith({
        workflowId: "wf-graph-route",
        definition: state.definition,
        variables: { seed: "value" },
        maxSteps: 3,
      });
    });
  });

  it("resumes a waiting lightweight runtime", async () => {
    state.workflow = makeWorkflow();
    state.runtimeState = {
      domainModelVersion: 1,
      definition: makeRuntimeDefinition(),
      instance: makeRuntimeInstance({
        status: "EXECUTED",
        checkpoint: undefined,
        output: {
          acceptedToken: "approved",
        },
      }),
      updatedAt: "2026-04-22T00:00:03.000Z",
    };

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/runtime/resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            payload: {
              token: "approved",
            },
          }),
        }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ state: state.runtimeState });
      expect(resumeRuntime).toHaveBeenCalledWith("wf-graph-route", {
        token: "approved",
      });
    });
  });

  it("terminates a runtime instance through explicit runtime control", async () => {
    state.workflow = makeWorkflow();
    state.runtimeState = {
      domainModelVersion: 1,
      definition: makeRuntimeDefinition(),
      instance: makeRuntimeInstance({
        status: "FORCE_TERMINATED",
        completedAt: "2026-04-22T00:00:04.000Z",
        checkpoint: undefined,
      }),
      updatedAt: "2026-04-22T00:00:04.000Z",
    };

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/runtime/terminate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestedBy: "operator-1",
            reason: "Stop the broken run",
          }),
        }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ state: state.runtimeState });
      expect(terminateRuntime).toHaveBeenCalledWith("wf-graph-route", {
        requestedBy: "operator-1",
        reason: "Stop the broken run",
      });
    });
  });

  it("retries a failed runtime instance through explicit runtime control", async () => {
    state.workflow = makeWorkflow();
    state.runtimeState = {
      domainModelVersion: 1,
      definition: makeRuntimeDefinition(),
      instance: makeRuntimeInstance({
        status: "EXECUTED",
        checkpoint: undefined,
        output: {
          retried: true,
        },
      }),
      updatedAt: "2026-04-22T00:00:05.000Z",
    };

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/runtime/retry`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestedBy: "operator-2",
            reason: "Retry after transient provider failure",
            maxSteps: 4,
          }),
        }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ state: state.runtimeState });
      expect(retryRuntime).toHaveBeenCalledWith("wf-graph-route", {
        requestedBy: "operator-2",
        reason: "Retry after transient provider failure",
        maxSteps: 4,
      });
    });
  });

  it("escalates a runtime instance into waiting human review", async () => {
    state.workflow = makeWorkflow();
    state.runtimeState = {
      domainModelVersion: 1,
      definition: makeRuntimeDefinition(),
      instance: makeRuntimeInstance({
        status: "WAITING_INPUT",
        checkpoint: {
          nodeId: "task-1",
          waitingFor: "human escalation review",
          createdAt: "2026-04-22T00:00:06.000Z",
          resumeCount: 0,
        },
      }),
      updatedAt: "2026-04-22T00:00:06.000Z",
    };

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/workflows/${state.workflow?.id}/runtime/escalate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestedBy: "operator-3",
            reason: "Need manual review before proceeding",
          }),
        }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ state: state.runtimeState });
      expect(escalateRuntime).toHaveBeenCalledWith("wf-graph-route", {
        requestedBy: "operator-3",
        reason: "Need manual review before proceeding",
      });
    });
  });

  it("stores workflow projection input and creates mission with projection links", async () => {
    state.workflow = makeWorkflow({
      id: "wf-created",
      status: "done",
      created_at: "2026-04-01T00:00:00.000Z",
      results: {},
    });
    const { workflowEngine } = await import("../core/workflow-engine.js");
    const { missionRuntime } = await import("../tasks/mission-runtime.js");
    const { linkWorkflowToMission } = await import("../core/mission-enrichment-bridge.js");

    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/workflows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          directive: "Build a projected workflow",
          sessionId: "session-created",
          sourceApp: "web-aigc",
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        workflowId: "wf-created",
        missionId: "mission-created",
        status: "running",
        deduped: false,
      });
      expect(workflowEngine.startWorkflow).toHaveBeenCalled();
      expect(updateWorkflow).toHaveBeenCalledWith(
        "wf-created",
        expect.objectContaining({
          results: expect.objectContaining({
            input: expect.objectContaining({
              sessionId: "session-created",
              sourceApp: "web-aigc",
              projection: {
                sessionId: "session-created",
                sourceApp: "web-aigc",
              },
            }),
          }),
        }),
      );
      expect(missionRuntime.createChatTask).toHaveBeenCalledWith(
        "Build a projected workflow",
        "Build a projected workflow",
        "session-created",
        {
          workflowId: "wf-created",
          instanceId: "wf-created",
          replayId: "wf-created",
          sessionId: "session-created",
          sourceApp: "web-aigc",
        },
      );
      expect(linkWorkflowToMission).toHaveBeenCalledWith("wf-created", "mission-created");
    });
  });
});
