import { describe, expect, it } from "vitest";

import type { WorkflowRuntime } from "../../shared/workflow-runtime.js";
import type { WorkflowNodeAdapter } from "../../shared/workflow-runtime-engine.js";
import { WorkflowRuntimeEngine } from "../core/workflow-runtime-engine.js";
import type {
  AgentRecord,
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
} from "../../shared/workflow-runtime.js";

function makeWorkflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "wf-runtime-engine",
    directive: "Run a thin web-aigc runtime slice",
    status: "pending",
    current_stage: null,
    departments_involved: [],
    started_at: null,
    completed_at: null,
    results: {},
    created_at: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

function createRuntime(
  workflow: WorkflowRecord,
): WorkflowRuntime & {
  __test: {
    emittedEvents: Array<Record<string, unknown>>;
    finalReports: Array<Record<string, unknown>>;
  };
} {
  const workflows = new Map<string, WorkflowRecord>([[workflow.id, workflow]]);
  const tasksByWorkflow = new Map<string, TaskRecord[]>();
  const messagesByWorkflow = new Map<string, MessageRecord[]>();
  const agents: AgentRecord[] = [];
  const emittedEvents: Array<Record<string, unknown>> = [];
  const finalReports: Array<Record<string, unknown>> = [];

  return {
    workflowRepo: {
      createWorkflow(id, directive, departments) {
        const created = makeWorkflow({
          id,
          directive,
          departments_involved: departments,
        });
        workflows.set(id, created);
        return created;
      },
      getWorkflow(id) {
        return workflows.get(id);
      },
      getWorkflows() {
        return Array.from(workflows.values());
      },
      findWorkflowByDirective() {
        return undefined;
      },
      updateWorkflow(id, updates) {
        const current = workflows.get(id);
        if (!current) return;
        workflows.set(id, { ...current, ...updates });
      },
      getAgents() {
        return agents;
      },
      getAgent(id) {
        return agents.find(agent => agent.id === id);
      },
      getAgentsByRole(role) {
        return agents.filter(agent => agent.role === role);
      },
      getAgentsByDepartment(dept) {
        return agents.filter(agent => agent.department === dept);
      },
      getTasksByWorkflow(workflowId) {
        return tasksByWorkflow.get(workflowId) || [];
      },
      createTask(task) {
        const created: TaskRecord = {
          id: 1,
          created_at: "2026-04-22T00:00:00.000Z",
          updated_at: "2026-04-22T00:00:00.000Z",
          ...task,
        };
        tasksByWorkflow.set(task.workflow_id, [
          ...(tasksByWorkflow.get(task.workflow_id) || []),
          created,
        ]);
        return created;
      },
      updateTask(id, updates) {
        for (const [workflowId, tasks] of tasksByWorkflow.entries()) {
          tasksByWorkflow.set(
            workflowId,
            tasks.map(task => (task.id === id ? { ...task, ...updates } : task)),
          );
        }
      },
      getMessagesByWorkflow(workflowId) {
        return messagesByWorkflow.get(workflowId) || [];
      },
      createEvolutionLog() {
        return {};
      },
      getScoresForWorkflow() {
        return [];
      },
    },
    memoryRepo: {
      buildPromptContext() {
        return [];
      },
      appendLLMExchange() {},
      appendMessageLog() {},
      materializeWorkflowMemories() {},
      getSoulText() {
        return "";
      },
      appendLearnedBehaviors() {
        return "";
      },
    },
    reportRepo: {
      buildDepartmentReport() {
        return {
          stats: {
            averageScore: null,
          },
        };
      },
      saveDepartmentReport(report) {
        return { jsonPath: "department.json", markdownPath: "department.md" };
      },
      saveFinalWorkflowReport(report) {
        finalReports.push(report as Record<string, unknown>);
        return { jsonPath: "workflow.json", markdownPath: "workflow.md" };
      },
    },
    eventEmitter: {
      emit(event) {
        emittedEvents.push(event as Record<string, unknown>);
      },
    },
    llmProvider: {
      async call() {
        return { content: "" };
      },
      async callJson() {
        return {};
      },
    },
    agentDirectory: {
      get() {
        return undefined;
      },
      getCEO() {
        return undefined;
      },
      getManagerByDepartment() {
        return undefined;
      },
      getWorkersByManager() {
        return [];
      },
      refresh() {},
    },
    messageBus: {
      async send() {
        throw new Error("not needed");
      },
      async sendA2A() {
        throw new Error("not needed");
      },
      async getInbox() {
        return [];
      },
    },
    evolutionService: {
      evolveWorkflow() {
        return {};
      },
    },
    __test: {
      emittedEvents,
      finalReports,
    },
  };
}

describe("WorkflowRuntimeEngine", () => {
  it("runs a minimal graph to completion through adapters", async () => {
    const workflow = makeWorkflow();
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const rootAdapter: WorkflowNodeAdapter = {
      type: "root",
      async execute() {
        return {
          kind: "advance",
          output: {
            directive: "hello",
          },
        };
      },
    };
    const echoAdapter: WorkflowNodeAdapter = {
      type: "echo",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            finalText: String(context.variables.directive || ""),
          },
        };
      },
    };

    engine.registerAdapter(rootAdapter);
    engine.registerAdapter(echoAdapter);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "thin-slice",
        source: "inline",
        entryNodeId: "start",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "start",
            type: "root",
            title: "Start",
            inputs: [],
            outputs: [],
            config: [],
          },
          {
            id: "echo",
            type: "echo",
            title: "Echo",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "start->echo",
            fromNodeId: "start",
            toNodeId: "echo",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.output).toMatchObject({
      finalText: "hello",
    });
    expect(state.instance.nodeRuns.map(node => node.status)).toEqual([
      "EXECUTED",
      "EXECUTED",
    ]);
  });

  it("stores a checkpoint and resumes waiting nodes", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-wait" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const waitAdapter: WorkflowNodeAdapter = {
      type: "waiter",
      async execute() {
        return {
          kind: "wait",
          waitingFor: "approval token",
          inputSchema: [
            {
              key: "token",
              label: "Approval token",
              valueType: "string",
              required: true,
            },
          ],
        };
      },
      async resume(context) {
        return {
          kind: "complete",
          output: {
            acceptedToken: context.resumePayload?.token,
          },
        };
      },
    };

    engine.registerAdapter(waitAdapter);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "wait-slice",
        source: "inline",
        entryNodeId: "wait-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "wait-node",
            type: "waiter",
            title: "Wait Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [],
      },
    });

    const waitingState = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(waitingState.instance.status).toBe("WAITING_INPUT");
    expect(waitingState.instance.checkpoint?.waitingFor).toBe("approval token");

    const resumedState = await engine.resume(workflow.id, { token: "approved" });
    expect(resumedState.instance.status).toBe("EXECUTED");
    expect(resumedState.instance.output).toMatchObject({
      acceptedToken: "approved",
    });
    expect(resumedState.instance.checkpoint).toBeUndefined();
  });

  it("routes selection nodes to different branches after resume", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-selection" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const approvedAdapter: WorkflowNodeAdapter = {
      type: "approved-node",
      async execute() {
        return {
          kind: "complete",
          output: {
            outcome: "approved",
          },
        };
      },
    };
    const rejectedAdapter: WorkflowNodeAdapter = {
      type: "rejected-node",
      async execute() {
        return {
          kind: "complete",
          output: {
            outcome: "rejected",
          },
        };
      },
    };

    engine.registerAdapter(approvedAdapter);
    engine.registerAdapter(rejectedAdapter);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "selection-slice",
        source: "inline",
        entryNodeId: "selection-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "selection-node",
            type: "selection",
            title: "Select Branch",
            description: "Choose the next branch",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "prompt",
                label: "Prompt",
                valueType: "string",
                defaultValue: "Choose the next branch",
              },
              {
                key: "options",
                label: "Options",
                valueType: "array",
                defaultValue: [
                  { id: "approved", label: "Approved" },
                  { id: "rejected", label: "Rejected" },
                ],
              },
            ],
          },
          {
            id: "approved-node",
            type: "approved-node",
            title: "Approved Path",
            inputs: [],
            outputs: [],
            config: [],
          },
          {
            id: "rejected-node",
            type: "rejected-node",
            title: "Rejected Path",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "selection->approved",
            fromNodeId: "selection-node",
            toNodeId: "approved-node",
            kind: "conditional",
            label: "approved",
          },
          {
            id: "selection->rejected",
            fromNodeId: "selection-node",
            toNodeId: "rejected-node",
            kind: "conditional",
            label: "rejected",
          },
        ],
      },
    });

    const waitingState = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(waitingState.instance.status).toBe("WAITING_INPUT");
    expect(waitingState.instance.checkpoint?.waitingFor).toBe("Choose the next branch");

    const approvedState = await engine.resume(workflow.id, { optionId: "approved" });
    expect(approvedState.instance.status).toBe("EXECUTED");
    expect(approvedState.instance.output).toMatchObject({
      outcome: "approved",
    });
    expect(approvedState.instance.variables).toMatchObject({
      selectedOptionId: "approved",
      branchKey: "approved",
    });
    expect(approvedState.instance.currentNodeId).toBe("approved-node");
    expect(
      approvedState.instance.edgeTransitions.find(edge => edge.edgeId === "selection->approved")?.status,
    ).toBe("executed");
  });

  it("routes confirm_judge nodes by branchKey after resume", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-confirm" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const yesAdapter: WorkflowNodeAdapter = {
      type: "yes-node",
      async execute() {
        return {
          kind: "complete",
          output: {
            confirmation: "approved",
          },
        };
      },
    };
    const noAdapter: WorkflowNodeAdapter = {
      type: "no-node",
      async execute() {
        return {
          kind: "complete",
          output: {
            confirmation: "rejected",
          },
        };
      },
    };

    engine.registerAdapter(yesAdapter);
    engine.registerAdapter(noAdapter);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "confirm-slice",
        source: "inline",
        entryNodeId: "confirm-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "confirm-node",
            type: "confirm_judge",
            title: "Confirm Choice",
            description: "Approve or reject",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "prompt",
                label: "Prompt",
                valueType: "string",
                defaultValue: "Approve this action?",
              },
              {
                key: "options",
                label: "Options",
                valueType: "array",
                defaultValue: [
                  { id: "approve", label: "Approve" },
                  { id: "reject", label: "Reject" },
                ],
              },
            ],
          },
          {
            id: "yes-node",
            type: "yes-node",
            title: "Approved Path",
            inputs: [],
            outputs: [],
            config: [],
          },
          {
            id: "no-node",
            type: "no-node",
            title: "Rejected Path",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "confirm->yes",
            fromNodeId: "confirm-node",
            toNodeId: "yes-node",
            kind: "conditional",
            label: "approved",
          },
          {
            id: "confirm->no",
            fromNodeId: "confirm-node",
            toNodeId: "no-node",
            kind: "conditional",
            label: "rejected",
          },
        ],
      },
    });

    const waitingState = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(waitingState.instance.status).toBe("WAITING_INPUT");

    const rejectedState = await engine.resume(workflow.id, {
      optionId: "reject",
      branchKey: "rejected",
    });
    expect(rejectedState.instance.status).toBe("EXECUTED");
    expect(rejectedState.instance.output).toMatchObject({
      confirmation: "rejected",
    });
    expect(rejectedState.instance.variables).toMatchObject({
      selectedOptionId: "reject",
      branchKey: "rejected",
    });
    expect(rejectedState.instance.currentNodeId).toBe("no-node");
    expect(
      rejectedState.instance.edgeTransitions.find(edge => edge.edgeId === "confirm->no")?.status,
    ).toBe("executed");
  });

  it("executes condition nodes through the runtime built-in condition adapter", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-condition-node" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const successAdapter: WorkflowNodeAdapter = {
      type: "success-node",
      async execute() {
        return {
          kind: "complete",
          output: {
            path: "true-branch",
          },
        };
      },
    };
    const failureAdapter: WorkflowNodeAdapter = {
      type: "failure-node",
      async execute() {
        return {
          kind: "complete",
          output: {
            path: "false-branch",
          },
        };
      },
    };

    engine.registerAdapter(successAdapter);
    engine.registerAdapter(failureAdapter);
    engine.initialize({
      workflowId: workflow.id,
      variables: {
        approved: true,
      },
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "condition-node-slice",
        source: "inline",
        entryNodeId: "condition-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "condition-node",
            type: "condition",
            title: "Condition Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "expression",
                label: "Expression",
                valueType: "string",
                defaultValue: "approved == true",
              },
            ],
          },
          {
            id: "success-node",
            type: "success-node",
            title: "Success Path",
            inputs: [],
            outputs: [],
            config: [],
          },
          {
            id: "failure-node",
            type: "failure-node",
            title: "Failure Path",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "condition->success",
            fromNodeId: "condition-node",
            toNodeId: "success-node",
            kind: "conditional",
            label: "true",
          },
          {
            id: "condition->failure",
            fromNodeId: "condition-node",
            toNodeId: "failure-node",
            kind: "conditional",
            label: "false",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.output).toMatchObject({
      path: "true-branch",
    });
    expect(state.instance.variables).toMatchObject({
      approved: true,
      conditionMatched: true,
      branchKey: "true",
      conditionExpression: "approved == true",
    });
    expect(
      state.instance.edgeTransitions.find(edge => edge.edgeId === "condition->success")?.status,
    ).toBe("executed");
  });

  it("marks invalid condition expressions as runtime exceptions", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-condition-error" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    engine.initialize({
      workflowId: workflow.id,
      variables: {
        approved: true,
      },
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "condition-error-slice",
        source: "inline",
        entryNodeId: "condition-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "condition-node",
            type: "condition",
            title: "Condition Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "expression",
                label: "Expression",
                valueType: "string",
                defaultValue: "approved => true",
              },
            ],
          },
        ],
        edgeSchemas: [],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXCEPTION");
    expect(state.instance.error).toContain("Invalid condition expression");
    expect(state.instance.nodeRuns[0]).toMatchObject({
      nodeId: "condition-node",
      status: "EXCEPTION",
      error: expect.stringContaining("Invalid condition expression"),
    });
  });

  it("completes end nodes with structured output after branch selection", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-end" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "end-slice",
        source: "inline",
        entryNodeId: "selection-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "selection-node",
            type: "selection",
            title: "Select Branch",
            description: "Choose the final branch",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "prompt",
                label: "Prompt",
                valueType: "string",
                defaultValue: "Choose the final branch",
              },
              {
                key: "options",
                label: "Options",
                valueType: "array",
                defaultValue: [
                  { id: "approved", label: "Approved" },
                  { id: "rejected", label: "Rejected" },
                ],
              },
            ],
          },
          {
            id: "end-approved",
            type: "end",
            title: "Approved End",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "status",
                label: "Status",
                valueType: "string",
                defaultValue: "approved",
              },
              {
                key: "summary",
                label: "Summary",
                valueType: "string",
                defaultValue: "Approved branch completed",
              },
              {
                key: "output",
                label: "Output",
                valueType: "object",
                defaultValue: {
                  outcome: "$.selectedOptionId",
                  branch: "$.branchKey",
                },
              },
              {
                key: "artifacts",
                label: "Artifacts",
                valueType: "array",
                defaultValue: [
                  {
                    kind: "decision",
                    ref: "$.branchKey",
                  },
                ],
              },
            ],
          },
          {
            id: "end-rejected",
            type: "end",
            title: "Rejected End",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "status",
                label: "Status",
                valueType: "string",
                defaultValue: "rejected",
              },
              {
                key: "summary",
                label: "Summary",
                valueType: "string",
                defaultValue: "Rejected branch completed",
              },
              {
                key: "output",
                label: "Output",
                valueType: "object",
                defaultValue: {
                  outcome: "$.selectedOptionId",
                  branch: "$.branchKey",
                },
              },
            ],
          },
        ],
        edgeSchemas: [
          {
            id: "selection->approved-end",
            fromNodeId: "selection-node",
            toNodeId: "end-approved",
            kind: "conditional",
            label: "approved",
          },
          {
            id: "selection->rejected-end",
            fromNodeId: "selection-node",
            toNodeId: "end-rejected",
            kind: "conditional",
            label: "rejected",
          },
        ],
      },
    });

    const waitingState = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(waitingState.instance.status).toBe("WAITING_INPUT");
    expect(waitingState.instance.checkpoint?.waitingFor).toBe("Choose the final branch");

    const approvedState = await engine.resume(workflow.id, { optionId: "approved" });
    expect(approvedState.instance.status).toBe("EXECUTED");
    expect(approvedState.instance.currentNodeId).toBe("end-approved");
    expect(approvedState.instance.output).toMatchObject({
      status: "approved",
      summary: "Approved branch completed",
      result: {
        outcome: "approved",
        branch: "approved",
      },
      artifacts: [
        {
          kind: "decision",
          ref: "approved",
        },
      ],
      finalVariables: {
        selectedOptionId: "approved",
        branchKey: "approved",
      },
    });
    expect(
      approvedState.instance.edgeTransitions.find(
        edge => edge.edgeId === "selection->approved-end",
      )?.status,
    ).toBe("executed");
    expect(
      approvedState.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "end-approved")?.status,
    ).toBe("EXECUTED");
    expect(
      approvedState.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "end-rejected")?.status,
    ).toBe("PENDING");
    expect(runtime.__test.finalReports).toHaveLength(1);
    expect(runtime.__test.finalReports[0]).toMatchObject({
      workflowId: workflow.id,
      workflow: {
        rootAgentId: "web-aigc-runtime",
      },
      stats: {
        taskCount: 0,
      },
    });
    expect(runtime.__test.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "workflow_complete",
        workflowId: workflow.id,
        status: "completed",
        summary: "Approved branch completed",
      }),
    );
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "node.started",
          workflowId: workflow.id,
          nodeId: "selection-node",
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "node.waiting_input",
          workflowId: workflow.id,
          nodeId: "selection-node",
          waitingFor: "Choose the final branch",
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "edge.transitioned",
          workflowId: workflow.id,
          edgeId: "selection->approved-end",
          fromNodeId: "selection-node",
          toNodeId: "end-approved",
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "node.completed",
          workflowId: workflow.id,
          nodeId: "end-approved",
        }),
      ]),
    );
  });

  it("terminates a runtime instance through explicit control entry", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-terminate" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const stuckAdapter: WorkflowNodeAdapter = {
      type: "waiter",
      async execute() {
        return {
          kind: "wait",
          waitingFor: "operator intervention",
        };
      },
    };

    engine.registerAdapter(stuckAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "terminate-slice",
        source: "inline",
        entryNodeId: "wait-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          missionId: "mission-terminate",
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "wait-node",
            type: "waiter",
            title: "Wait Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [],
      },
    });

    await engine.runToCheckpoint({ workflowId: workflow.id });
    const terminated = engine.terminate(workflow.id, {
      requestedBy: "operator-1",
      reason: "Operator stopped the stuck runtime",
    });

    expect(terminated.instance.status).toBe("FORCE_TERMINATED");
    expect(terminated.instance.checkpoint).toBeUndefined();
    expect(terminated.instance.variables).toMatchObject({
      runtimeTermination: {
        requestedBy: "operator-1",
        reason: "Operator stopped the stuck runtime",
      },
    });
    expect(runtime.__test.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "web_aigc_runtime_event",
        eventKey: "instance.terminated",
        workflowId: workflow.id,
        status: "FORCE_TERMINATED",
        metadata: expect.objectContaining({
          requestedBy: "operator-1",
          reason: "Operator stopped the stuck runtime",
        }),
      }),
    );
  });

  it("retries a retryable failed node from the runtime control entry", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-retry" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    let attempts = 0;
    const flakyAdapter: WorkflowNodeAdapter = {
      type: "flaky",
      async execute() {
        attempts += 1;
        if (attempts === 1) {
          return {
            kind: "error",
            message: "temporary provider outage",
            retryable: true,
          };
        }
        return {
          kind: "complete",
          output: {
            recovered: true,
            attempts,
          },
        };
      },
    };

    engine.registerAdapter(flakyAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "retry-slice",
        source: "inline",
        entryNodeId: "flaky-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "flaky-node",
            type: "flaky",
            title: "Flaky Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [],
      },
    });

    const failed = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(failed.instance.status).toBe("EXCEPTION");
    expect(failed.instance.nodeRuns[0]).toMatchObject({
      status: "EXCEPTION",
      retryable: true,
    });

    const recovered = await engine.retry(workflow.id, {
      requestedBy: "operator-2",
      reason: "Retry transient outage",
      maxSteps: 2,
    });

    expect(recovered.instance.status).toBe("EXECUTED");
    expect(recovered.instance.output).toMatchObject({
      recovered: true,
      attempts: 2,
    });
    expect(recovered.instance.variables).toMatchObject({
      runtimeRetry: {
        requestedBy: "operator-2",
        reason: "Retry transient outage",
        nodeId: "flaky-node",
      },
    });
    expect(runtime.__test.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "web_aigc_runtime_event",
        eventKey: "instance.retry_requested",
        workflowId: workflow.id,
        metadata: expect.objectContaining({
          requestedBy: "operator-2",
          reason: "Retry transient outage",
          nodeId: "flaky-node",
        }),
      }),
    );
  });

  it("escalates a runtime instance into a human review checkpoint", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-escalate" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const failingAdapter: WorkflowNodeAdapter = {
      type: "failing",
      async execute() {
        return {
          kind: "error",
          message: "need compliance review",
          retryable: false,
        };
      },
    };

    engine.registerAdapter(failingAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "escalate-slice",
        source: "inline",
        entryNodeId: "failing-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          missionId: "mission-escalate",
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "failing-node",
            type: "failing",
            title: "Failing Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [],
      },
    });

    const failed = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(failed.instance.status).toBe("EXCEPTION");

    const escalated = engine.escalate(workflow.id, {
      requestedBy: "operator-3",
      reason: "Escalate to human review",
    });

    expect(escalated.instance.status).toBe("WAITING_INPUT");
    expect(escalated.instance.checkpoint).toMatchObject({
      waitingFor: "human escalation review",
    });
    expect(escalated.instance.variables).toMatchObject({
      runtimeEscalation: {
        requestedBy: "operator-3",
        reason: "Escalate to human review",
        nodeId: "failing-node",
      },
    });
    expect(runtime.__test.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "web_aigc_runtime_event",
        eventKey: "instance.escalated",
        workflowId: workflow.id,
        waitingFor: "human escalation review",
        metadata: expect.objectContaining({
          requestedBy: "operator-3",
          reason: "Escalate to human review",
        }),
      }),
    );
  });

  it("automatically retries a retryable node when retry budget is configured", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-auto-retry" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    let attempts = 0;
    const flakyAdapter: WorkflowNodeAdapter = {
      type: "auto-flaky",
      async execute() {
        attempts += 1;
        if (attempts === 1) {
          return {
            kind: "error",
            message: "temporary upstream issue",
            retryable: true,
          };
        }
        return {
          kind: "complete",
          output: {
            autoRecovered: true,
            attempts,
          },
        };
      },
    };

    engine.registerAdapter(flakyAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "auto-retry-slice",
        source: "inline",
        entryNodeId: "auto-flaky-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "auto-flaky-node",
            type: "auto-flaky",
            title: "Auto Flaky Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "retryBudget",
                label: "Retry Budget",
                valueType: "number",
                defaultValue: 1,
              },
              {
                key: "retryDelayMs",
                label: "Retry Delay",
                valueType: "number",
                defaultValue: 0,
              },
            ],
          },
        ],
        edgeSchemas: [],
      },
    });

    const recovered = await engine.runToCheckpoint({
      workflowId: workflow.id,
      maxSteps: 3,
    });

    expect(recovered.instance.status).toBe("EXECUTED");
    expect(recovered.instance.output).toMatchObject({
      autoRecovered: true,
      attempts: 2,
    });
    expect(recovered.instance.variables).toMatchObject({
      runtimeRetry: {
        requestedBy: "runtime.auto_retry",
        nodeId: "auto-flaky-node",
      },
      runtimeAutoRetry: {
        "auto-flaky-node": 1,
      },
    });
    expect(runtime.__test.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "web_aigc_runtime_event",
        eventKey: "instance.retry_requested",
        workflowId: workflow.id,
        metadata: expect.objectContaining({
          requestedBy: "runtime.auto_retry",
          automatic: true,
          retryAttempt: 1,
          retryBudget: 1,
        }),
      }),
    );
  });

  it("automatically escalates when retry budget is exhausted and escalation is enabled", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-auto-escalate" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    let attempts = 0;
    const alwaysFailingAdapter: WorkflowNodeAdapter = {
      type: "always-failing",
      async execute() {
        attempts += 1;
        return {
          kind: "error",
          message: `failing attempt ${attempts}`,
          retryable: true,
        };
      },
    };

    engine.registerAdapter(alwaysFailingAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "auto-escalate-slice",
        source: "inline",
        entryNodeId: "always-failing-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "always-failing-node",
            type: "always-failing",
            title: "Always Failing Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "retryBudget",
                label: "Retry Budget",
                valueType: "number",
                defaultValue: 1,
              },
              {
                key: "autoEscalateOnFailure",
                label: "Auto Escalate",
                valueType: "boolean",
                defaultValue: true,
              },
              {
                key: "escalateOnRetryExhausted",
                label: "Escalate On Exhausted",
                valueType: "boolean",
                defaultValue: true,
              },
            ],
          },
        ],
        edgeSchemas: [],
      },
    });

    const escalated = await engine.runToCheckpoint({
      workflowId: workflow.id,
      maxSteps: 4,
    });

    expect(escalated.instance.status).toBe("WAITING_INPUT");
    expect(escalated.instance.checkpoint).toMatchObject({
      waitingFor: "human escalation review",
    });
    expect(escalated.instance.variables).toMatchObject({
      runtimeAutoRetry: {
        "always-failing-node": 1,
      },
      runtimeEscalation: {
        requestedBy: "runtime.auto_escalate",
        nodeId: "always-failing-node",
        trigger: "retry_exhausted",
      },
    });
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "instance.retry_requested",
          workflowId: workflow.id,
          metadata: expect.objectContaining({
            automatic: true,
            retryAttempt: 1,
          }),
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "instance.escalated",
          workflowId: workflow.id,
          waitingFor: "human escalation review",
          metadata: expect.objectContaining({
            requestedBy: "runtime.auto_escalate",
            automatic: true,
            trigger: "retry_exhausted",
          }),
        }),
      ]),
    );
  });

  it("executes llm nodes through the runtime built-in chat adapter", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-llm-node" });
    const runtime = createRuntime(workflow);
    runtime.llmProvider = {
      async call(messages) {
        const lastMessage = messages[messages.length - 1];
        const content =
          typeof lastMessage?.content === "string"
            ? lastMessage.content
            : JSON.stringify(lastMessage?.content ?? "");
        return {
          content: `runtime-llm:${content}`,
          usage: {
            prompt_tokens: 9,
            completion_tokens: 6,
            total_tokens: 15,
          },
        };
      },
      async callJson() {
        return {};
      },
    };
    const engine = new WorkflowRuntimeEngine(runtime);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "llm-node-slice",
        source: "inline",
        entryNodeId: "llm-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "llm-node",
            type: "llm",
            title: "LLM Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "systemPrompt",
                label: "System Prompt",
                valueType: "string",
                defaultValue: "You are helpful.",
              },
              {
                key: "prompt",
                label: "Prompt",
                valueType: "string",
                defaultValue: "Summarize the runtime state",
              },
            ],
          },
        ],
        edgeSchemas: [],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.output).toMatchObject({
      nodeType: "llm",
      content: "runtime-llm:Summarize the runtime state",
      result: "runtime-llm:Summarize the runtime state",
      model: expect.any(String),
      usage: {
        prompt_tokens: 9,
        completion_tokens: 6,
        total_tokens: 15,
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "llm-node")?.status,
    ).toBe("EXECUTED");
  });

  it("executes dialogue nodes through the runtime built-in chat adapter and persists session evidence", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-dialogue-node" });
    const runtime = createRuntime(workflow);
    const storedMessages: MessageRecord[] = [];
    const llmExchanges: Array<{
      agentId: string;
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: unknown;
    }> = [];

    runtime.workflowRepo.createMessage = (message) => {
      const created: MessageRecord = {
        id: storedMessages.length + 1,
        created_at: "2026-04-22T00:00:00.000Z",
        ...message,
      };
      storedMessages.push(created);
      return created;
    };
    runtime.memoryRepo.appendLLMExchange = (agentId, options) => {
      llmExchanges.push({ agentId, ...options });
    };
    runtime.llmProvider = {
      async call(messages) {
        const lastMessage = messages[messages.length - 1];
        const content =
          typeof lastMessage?.content === "string"
            ? lastMessage.content
            : JSON.stringify(lastMessage?.content ?? "");
        return {
          content: `runtime-dialogue:${content}`,
          usage: {
            prompt_tokens: 13,
            completion_tokens: 8,
            total_tokens: 21,
          },
        };
      },
      async callJson() {
        return {};
      },
    };
    const engine = new WorkflowRuntimeEngine(runtime);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "dialogue-node-slice",
        source: "inline",
        entryNodeId: "dialogue-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          sessionId: "session-runtime-1",
          missionId: "mission-runtime-1",
        },
        nodeSchemas: [
          {
            id: "dialogue-node",
            type: "dialogue",
            title: "Dialogue Node",
            agentId: "dialogue-agent-runtime",
            stageKey: "dialogue_runtime",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "prompt",
                label: "Prompt",
                valueType: "string",
                defaultValue: "Explain the latest runtime checkpoint",
              },
              {
                key: "citations",
                label: "Citations",
                valueType: "array",
                defaultValue: ["doc-1", "doc-2"],
              },
              {
                key: "thinking",
                label: "Thinking",
                valueType: "string",
                defaultValue: "Prefer the latest runtime evidence.",
              },
            ],
          },
        ],
        edgeSchemas: [],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.output).toMatchObject({
      nodeType: "dialogue",
      content: "runtime-dialogue:Explain the latest runtime checkpoint",
      result: "runtime-dialogue:Explain the latest runtime checkpoint",
      observability: {
        workflowId: workflow.id,
        sessionId: "session-runtime-1",
        missionId: "mission-runtime-1",
        agentId: "dialogue-agent-runtime",
        stage: "dialogue_runtime",
        persistedToWorkflow: true,
        persistedToSession: true,
        citations: ["doc-1", "doc-2"],
        thinking: "Prefer the latest runtime evidence.",
      },
    });
    expect(storedMessages).toHaveLength(2);
    expect(storedMessages[0]).toMatchObject({
      workflow_id: workflow.id,
      from_agent: "workflow-user",
      to_agent: "dialogue-agent-runtime",
      stage: "dialogue_runtime",
      content: "Explain the latest runtime checkpoint",
    });
    expect(storedMessages[1]).toMatchObject({
      workflow_id: workflow.id,
      from_agent: "dialogue-agent-runtime",
      to_agent: "workflow-user",
      stage: "dialogue_runtime",
      content: "runtime-dialogue:Explain the latest runtime checkpoint",
    });
    expect(llmExchanges).toHaveLength(1);
    expect(llmExchanges[0]).toMatchObject({
      agentId: "dialogue-agent-runtime",
      workflowId: workflow.id,
      stage: "dialogue_runtime",
      prompt: "Explain the latest runtime checkpoint",
      response: "runtime-dialogue:Explain the latest runtime checkpoint",
      metadata: expect.objectContaining({
        nodeType: "dialogue",
        sessionId: "session-runtime-1",
        missionId: "mission-runtime-1",
      }),
    });
  });

  it("executes knowledge_qa through a runtime-registered adapter with citations and evidence", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-knowledge-node" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const knowledgeAdapter: WorkflowNodeAdapter = {
      type: "knowledge_qa",
      async execute() {
        return {
          kind: "complete",
          output: {
            nodeType: "knowledge_qa",
            answer: "Knowledge answer",
            citations: ["CodeModule:auth-module"],
            evidenceList: [
              {
                kind: "entity",
                title: "auth-module",
                detail: "A test module",
              },
            ],
          },
        };
      },
    };

    engine.registerAdapter(knowledgeAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "knowledge-node-slice",
        source: "inline",
        entryNodeId: "knowledge-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-22T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "knowledge-node",
            type: "knowledge_qa",
            title: "Knowledge Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.output).toMatchObject({
      nodeType: "knowledge_qa",
      answer: "Knowledge answer",
      citations: ["CodeModule:auth-module"],
      evidenceList: [
        {
          kind: "entity",
          title: "auth-module",
          detail: "A test module",
        },
      ],
    });
  });
});
