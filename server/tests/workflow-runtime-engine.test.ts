import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { AuditEventType } from "../../shared/audit/contracts.js";
import type { WorkflowRuntime } from "../../shared/workflow-runtime.js";
import type { WorkflowNodeAdapter } from "../../shared/workflow-runtime-engine.js";
import {
  webAigcRuntimeEngine,
  WorkflowRuntimeEngine,
} from "../core/workflow-runtime-engine.js";
import {
  mirrorWebAigcRuntimeEvent,
  setWebAigcRuntimeObservabilityDeps,
} from "../core/web-aigc-runtime-observability.js";
import {
  installWebAigcRuntimeExtraAdapters,
  registerWebAigcRuntimeExtraAdapters,
} from "../core/web-aigc-runtime-extra-adapters.js";
import { serverRuntime } from "../runtime/server-runtime.js";
import type {
  AgentEvent,
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("waits and resumes param_collection nodes with normalized form data", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-param-collection" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const doneAdapter: WorkflowNodeAdapter = {
      type: "done-node",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            collected: context.variables.formData,
          },
        };
      },
    };

    engine.registerAdapter(doneAdapter);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "param-collection-slice",
        source: "inline",
        entryNodeId: "param-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "param-node",
            type: "param_collection",
            title: "Collect Params",
            description: "Collect structured parameters",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "prompt",
                label: "Prompt",
                valueType: "string",
                defaultValue: "Collect structured parameters",
              },
              {
                key: "fields",
                label: "Fields",
                valueType: "array",
                defaultValue: [
                  {
                    key: "region",
                    label: "Region",
                    type: "selection",
                    required: true,
                    options: [
                      { value: "cn", label: "China" },
                      { value: "us", label: "United States" },
                    ],
                  },
                  {
                    key: "priority",
                    label: "Priority",
                    type: "number",
                    defaultValue: 3,
                  },
                  {
                    key: "approved",
                    label: "Approved",
                    type: "boolean",
                  },
                ],
              },
            ],
          },
          {
            id: "done-node",
            type: "done-node",
            title: "Done",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "param->done",
            fromNodeId: "param-node",
            toNodeId: "done-node",
            kind: "success",
          },
        ],
      },
    });

    const waitingState = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(waitingState.instance.status).toBe("WAITING_INPUT");
    expect(waitingState.instance.checkpoint?.inputSchema).toMatchObject([
      {
        key: "region",
        valueType: "string",
        required: true,
      },
      {
        key: "priority",
        valueType: "number",
        defaultValue: 3,
      },
      {
        key: "approved",
        valueType: "boolean",
      },
    ]);

    const resumed = await engine.resume(workflow.id, {
      formData: {
        region: "cn",
        priority: "7",
        approved: "true",
      },
    });

    expect(resumed.instance.status).toBe("EXECUTED");
    expect(resumed.instance.currentNodeId).toBe("done-node");
    expect(resumed.instance.variables).toMatchObject({
      formData: {
        region: "cn",
        priority: 7,
        approved: true,
      },
      fieldCount: 3,
    });
    expect(resumed.instance.output).toMatchObject({
      collected: {
        region: "cn",
        priority: 7,
        approved: true,
      },
    });
  });

  it("rejects invalid param_collection payloads during resume", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-param-invalid" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "param-collection-invalid-slice",
        source: "inline",
        entryNodeId: "param-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "param-node",
            type: "param_collection",
            title: "Collect Params",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "fields",
                label: "Fields",
                valueType: "array",
                defaultValue: [
                  {
                    key: "region",
                    label: "Region",
                    type: "selection",
                    required: true,
                    options: [{ value: "cn", label: "China" }],
                  },
                ],
              },
            ],
          },
        ],
        edgeSchemas: [],
      },
    });

    await engine.runToCheckpoint({ workflowId: workflow.id });
    const failed = await engine.resume(workflow.id, {
      formData: {
        region: "eu",
      },
    });

    expect(failed.instance.status).toBe("EXCEPTION");
    expect(failed.instance.error).toContain("Region");
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

  it("executes variable_assignment nodes through the runtime built-in adapter", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-variable-assignment" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const successAdapter: WorkflowNodeAdapter = {
      type: "success-node",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            path: "assigned",
            observedScorePassed: context.variables.scorePassed,
            observedLocalFlag:
              (context.variables.runtimeVariableScopes as Record<string, unknown>)?.local,
          },
        };
      },
    };

    engine.registerAdapter(successAdapter);
    engine.initialize({
      workflowId: workflow.id,
      variables: {
        score: 91,
      },
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "variable-assignment-slice",
        source: "inline",
        entryNodeId: "assign-node",
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
            id: "assign-node",
            type: "variable_assignment",
            title: "Assign score pass",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "target",
                label: "Target",
                valueType: "string",
                defaultValue: "scorePassed",
              },
              {
                key: "scope",
                label: "Scope",
                valueType: "string",
                defaultValue: "local",
              },
              {
                key: "expression",
                label: "Expression",
                valueType: "string",
                defaultValue: "score >= 90",
              },
            ],
          },
          {
            id: "success-node",
            type: "success-node",
            title: "Success Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "assign->success",
            fromNodeId: "assign-node",
            toNodeId: "success-node",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    if (state.instance.status !== "EXECUTED") {
      console.log(
        "[orchestration-runtime-debug]",
        JSON.stringify(
          {
            status: state.instance.status,
            error: state.instance.error,
            currentNodeId: state.instance.currentNodeId,
            nodeRuns: state.instance.nodeRuns,
            edgeTransitions: state.instance.edgeTransitions,
            variables: state.instance.variables,
          },
          null,
          2,
        ),
      );
    }

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.variables).toMatchObject({
      score: 91,
      scorePassed: true,
      lastAssignedVariable: "scorePassed",
      lastAssignedScope: "local",
      lastAssignedValue: true,
      runtimeVariableScopes: {
        local: {
          scorePassed: true,
        },
      },
    });
    expect(state.instance.variables.runtimeVariableChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "assign-node",
          scope: "local",
          target: "scorePassed",
          previousValue: undefined,
          nextValue: true,
        }),
      ]),
    );
    expect(state.instance.nodeRuns.find(node => node.nodeId === "assign-node")?.output).toMatchObject({
      scorePassed: true,
      lastAssignedScope: "local",
      runtimeVariableLastChange: expect.objectContaining({
        nodeId: "assign-node",
        target: "scorePassed",
        nextValue: true,
      }),
    });
    expect(
      state.instance.edgeTransitions.find(edge => edge.edgeId === "assign->success")?.status,
    ).toBe("executed");
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "variable.assigned",
          workflowId: workflow.id,
          nodeId: "assign-node",
          metadata: expect.objectContaining({
            scope: "local",
            target: "scorePassed",
            nextValue: true,
          }),
        }),
      ]),
    );
  });

  it("mirrors emitted variable_assignment runtime events into replay and audit through the observability bridge", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-variable-assignment-observability" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);
    const replayEmit = vi.fn();
    const auditRecord = vi.fn();

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: {
        emit: replayEmit,
      },
      auditCollector: {
        record: auditRecord,
      },
    });

    const successAdapter: WorkflowNodeAdapter = {
      type: "success-node",
      async execute() {
        return {
          kind: "complete",
          output: {
            path: "assigned",
          },
        };
      },
    };

    engine.registerAdapter(successAdapter);
    engine.initialize({
      workflowId: workflow.id,
      variables: {
        score: 91,
      },
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "variable-assignment-observability-slice",
        source: "inline",
        entryNodeId: "assign-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "assign-node",
            type: "variable_assignment",
            title: "Assign score pass",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "target",
                label: "Target",
                valueType: "string",
                defaultValue: "scorePassed",
              },
              {
                key: "scope",
                label: "Scope",
                valueType: "string",
                defaultValue: "local",
              },
              {
                key: "expression",
                label: "Expression",
                valueType: "string",
                defaultValue: "score >= 90",
              },
            ],
          },
          {
            id: "success-node",
            type: "success-node",
            title: "Success Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "assign->success",
            fromNodeId: "assign-node",
            toNodeId: "success-node",
            kind: "success",
          },
        ],
      },
    });

    try {
      const state = await engine.runToCheckpoint({ workflowId: workflow.id });

      expect(state.instance.status).toBe("EXECUTED");

      const variableAssignedEvent = runtime.__test.emittedEvents.find(
        (event): event is Extract<AgentEvent, { type: "web_aigc_runtime_event" }> =>
          event.type === "web_aigc_runtime_event" &&
          event.eventKey === "variable.assigned",
      );

      expect(variableAssignedEvent).toBeDefined();

      mirrorWebAigcRuntimeEvent(variableAssignedEvent!);

      expect(replayEmit).toHaveBeenCalledTimes(1);
      expect(replayEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: workflow.id,
          eventType: "MILESTONE_REACHED",
          sourceAgent: "assign-node",
          eventData: expect.objectContaining({
            eventKey: "variable.assigned",
            nodeId: "assign-node",
            metadata: expect.objectContaining({
              scope: "local",
              target: "scorePassed",
              nextValue: true,
            }),
          }),
          metadata: {
            phase: "web_aigc_runtime",
            stageKey: "variable.assigned",
          },
        }),
      );
      expect(auditRecord).toHaveBeenCalledTimes(1);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.DECISION_MADE,
          action: "Runtime variable assigned: scorePassed",
          resource: {
            type: "workflow-variable",
            id: "scorePassed",
            name: "variable.assigned",
          },
          metadata: expect.objectContaining({
            eventKey: "variable.assigned",
            workflowId: workflow.id,
            nodeId: "assign-node",
            scope: "local",
            target: "scorePassed",
            nextValue: true,
          }),
        }),
      );
    } finally {
      setWebAigcRuntimeObservabilityDeps({
        replayCollector: null,
        auditCollector: null,
      });
    }
  });

  it("lets variable_assignment feed downstream condition nodes in runtime", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-variable-condition" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const successAdapter: WorkflowNodeAdapter = {
      type: "success-node",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            path: "true-branch",
            observedDecision: context.variables.decision,
          },
        };
      },
    };
    const failureAdapter: WorkflowNodeAdapter = {
      type: "failure-node",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            path: "false-branch",
            observedDecision: context.variables.decision,
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
        name: "variable-condition-slice",
        source: "inline",
        entryNodeId: "assign-node",
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
            id: "assign-node",
            type: "variable_assignment",
            title: "Assign decision",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "target",
                label: "Target",
                valueType: "string",
                defaultValue: "decision",
              },
              {
                key: "scope",
                label: "Scope",
                valueType: "string",
                defaultValue: "global",
              },
              {
                key: "source",
                label: "Source",
                valueType: "string",
                defaultValue: "$.approved",
              },
            ],
          },
          {
            id: "condition-node",
            type: "condition",
            title: "Decision condition",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "expression",
                label: "Expression",
                valueType: "string",
                defaultValue: "decision == true",
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
            id: "assign->condition",
            fromNodeId: "assign-node",
            toNodeId: "condition-node",
            kind: "success",
          },
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
      observedDecision: true,
    });
    expect(state.instance.variables).toMatchObject({
      approved: true,
      decision: true,
      conditionMatched: true,
      branchKey: "true",
      conditionExpression: "decision == true",
    });
    expect(
      state.instance.edgeTransitions.find(edge => edge.edgeId === "assign->condition")?.status,
    ).toBe("executed");
    expect(
      state.instance.edgeTransitions.find(edge => edge.edgeId === "condition->success")?.status,
    ).toBe("executed");
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
        governance: {
          policy: {},
          state: {
            automaticRetryCount: 0,
            manualRetryCount: 0,
            totalRetryCount: 0,
          },
          remaining: {},
        },
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
          governance: expect.objectContaining({
            policy: {},
            state: expect.objectContaining({
              automaticRetryCount: 0,
              manualRetryCount: 0,
              totalRetryCount: 0,
            }),
          }),
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
        governance: {
          policy: {},
          state: {
            automaticRetryCount: 0,
            manualRetryCount: 1,
            totalRetryCount: 1,
            lastRetryMode: "manual",
            lastNodeId: "flaky-node",
            lastRequestedBy: "operator-2",
            lastReason: "Retry transient outage",
          },
          remaining: {},
        },
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
          retryMode: "manual",
          governance: expect.objectContaining({
            policy: {},
            state: expect.objectContaining({
              manualRetryCount: 1,
              totalRetryCount: 1,
              lastRetryMode: "manual",
              lastNodeId: "flaky-node",
              lastRequestedBy: "operator-2",
              lastReason: "Retry transient outage",
            }),
          }),
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
        governance: {
          policy: {},
          state: {
            automaticRetryCount: 0,
            manualRetryCount: 0,
            totalRetryCount: 0,
          },
          remaining: {},
        },
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
          governance: expect.objectContaining({
            policy: {},
            state: expect.objectContaining({
              automaticRetryCount: 0,
              manualRetryCount: 0,
              totalRetryCount: 0,
            }),
          }),
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

  it("applies instance-level automatic retry governance across multiple failing nodes", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-governance-auto-budget" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    let firstAttempts = 0;
    let secondAttempts = 0;
    engine.registerAdapter({
      type: "first-flaky",
      async execute() {
        firstAttempts += 1;
        if (firstAttempts === 1) {
          return {
            kind: "error",
            message: "first transient failure",
            retryable: true,
          };
        }
        return {
          kind: "advance",
          output: {
            firstRecovered: true,
          },
        };
      },
    });
    engine.registerAdapter({
      type: "second-flaky",
      async execute() {
        secondAttempts += 1;
        return {
          kind: "error",
          message: `second failure ${secondAttempts}`,
          retryable: true,
        };
      },
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "runtime-governance-auto-budget",
        source: "inline",
        entryNodeId: "first-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        metadata: {
          runtimeGovernance: {
            maxAutomaticRetries: 1,
            maxTotalRetries: 1,
            escalateOnRetryBlocked: true,
          },
        },
        nodeSchemas: [
          {
            id: "first-node",
            type: "first-flaky",
            title: "First Flaky Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "retryBudget",
                label: "Retry Budget",
                valueType: "number",
                defaultValue: 1,
              },
            ],
          },
          {
            id: "second-node",
            type: "second-flaky",
            title: "Second Flaky Node",
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
        edgeSchemas: [
          {
            id: "first->second",
            fromNodeId: "first-node",
            toNodeId: "second-node",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({
      workflowId: workflow.id,
      maxSteps: 6,
    });

    expect(state.instance.status).toBe("WAITING_INPUT");
    expect(state.instance.currentNodeId).toBe("second-node");
    expect(state.instance.variables).toMatchObject({
      runtimeGovernanceState: {
        automaticRetryCount: 1,
        totalRetryCount: 1,
        lastBlockedReason: "automatic_retry_budget_exhausted",
      },
      runtimeRetryBlocked: {
        blockedReason: "automatic_retry_budget_exhausted",
      },
      runtimeEscalation: {
        requestedBy: "runtime.auto_escalate",
        trigger: "retry_exhausted",
        governance: {
          policy: {
            maxAutomaticRetries: 1,
            maxTotalRetries: 1,
            escalateOnRetryBlocked: true,
          },
          state: {
            automaticRetryCount: 1,
            totalRetryCount: 1,
          },
          remaining: {
            automaticRetries: 0,
            totalRetries: 0,
          },
        },
      },
    });
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "instance.retry_requested",
          metadata: expect.objectContaining({
            retryMode: "automatic",
            governance: expect.objectContaining({
              remaining: expect.objectContaining({
                automaticRetries: 0,
                totalRetries: 0,
              }),
            }),
          }),
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "instance.escalated",
          metadata: expect.objectContaining({
            governance: expect.objectContaining({
              policy: expect.objectContaining({
                maxAutomaticRetries: 1,
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("blocks manual retry when instance-level manual retry governance is exhausted", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-governance-manual-budget" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    engine.registerAdapter({
      type: "always-fail-manual",
      async execute() {
        return {
          kind: "error",
          message: "manual retry candidate failed",
          retryable: true,
        };
      },
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "runtime-governance-manual-budget",
        source: "inline",
        entryNodeId: "manual-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        metadata: {
          runtimeGovernance: {
            maxManualRetries: 0,
            maxTotalRetries: 0,
          },
        },
        nodeSchemas: [
          {
            id: "manual-node",
            type: "always-fail-manual",
            title: "Manual Retry Node",
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

    await expect(
      engine.retry(workflow.id, {
        requestedBy: "operator-manual",
        reason: "Try one more time",
      }),
    ).rejects.toThrow(/Runtime retry blocked by governance policy/i);

    const blocked = engine.getState(workflow.id);
    expect(blocked?.instance.variables).toMatchObject({
      runtimeGovernanceState: {
        manualRetryCount: 0,
        totalRetryCount: 0,
        lastBlockedReason: "manual_retry_budget_exhausted",
      },
      runtimeRetryBlocked: {
        requestedBy: "operator-manual",
        blockedReason: "manual_retry_budget_exhausted",
        governance: {
          remaining: {
            manualRetries: 0,
            totalRetries: 0,
          },
        },
      },
    });
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "instance.retry_requested",
          workflowId: workflow.id,
          error: expect.stringMatching(/Runtime retry blocked by governance policy/i),
          metadata: expect.objectContaining({
            requestedBy: "operator-manual",
            reason: "Try one more time",
            retryMode: "manual",
            allowed: false,
            blockedReason: "manual_retry_budget_exhausted",
            governance: expect.objectContaining({
              remaining: expect.objectContaining({
                manualRetries: 0,
                totalRetries: 0,
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("emits edge.loop_iterated when a loop edge is taken", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-loop-edge" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const loopAdapter: WorkflowNodeAdapter = {
      type: "loop-node",
      async execute(context) {
        const currentIteration =
          typeof context.variables.iteration === "number"
            ? context.variables.iteration
            : 0;
        if (currentIteration >= 1) {
          return {
            kind: "advance",
            output: {
              iteration: currentIteration,
            },
            nextNodeId: "done-node",
          };
        }
        return {
          kind: "advance",
          output: {
            iteration: currentIteration + 1,
          },
          nextNodeId: "loop-node",
        };
      },
    };

    const doneAdapter: WorkflowNodeAdapter = {
      type: "done-node",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            done: true,
            iteration: context.variables.iteration,
          },
        };
      },
    };

    engine.registerAdapter(loopAdapter);
    engine.registerAdapter(doneAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "loop-edge-slice",
        source: "inline",
        entryNodeId: "loop-node",
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
            id: "loop-node",
            type: "loop-node",
            title: "Loop Node",
            inputs: [],
            outputs: [],
            config: [],
          },
          {
            id: "done-node",
            type: "done-node",
            title: "Done Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "loop-node->loop-node",
            fromNodeId: "loop-node",
            toNodeId: "loop-node",
            kind: "loop",
            label: "iterate",
          },
          {
            id: "loop-node->done-node",
            fromNodeId: "loop-node",
            toNodeId: "done-node",
            kind: "success",
          },
        ],
      },
      variables: {
        iteration: 0,
      },
    });

    const state = await engine.runToCheckpoint({
      workflowId: workflow.id,
      maxSteps: 4,
    });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.output).toMatchObject({
      done: true,
      iteration: 1,
    });
    expect(state.instance.variables).toMatchObject({
      iteration: 1,
      runtimeLoopIterations: {
        "loop-node->loop-node": 1,
      },
    });
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "edge.transitioned",
          workflowId: workflow.id,
          edgeId: "loop-node->loop-node",
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "edge.loop_iterated",
          workflowId: workflow.id,
          edgeId: "loop-node->loop-node",
          metadata: expect.objectContaining({
            kind: "loop",
            loopKey: "loop-node->loop-node",
            iterationIndex: 1,
          }),
        }),
      ]),
    );
  });

  it("force terminates when a loop edge exceeds maxIterations metadata", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-loop-max-iterations" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const loopAdapter: WorkflowNodeAdapter = {
      type: "loop-node",
      async execute(context) {
        const currentIteration =
          typeof context.variables.iteration === "number"
            ? context.variables.iteration
            : 0;
        return {
          kind: "advance",
          output: {
            iteration: currentIteration + 1,
          },
          nextNodeId: "loop-node",
        };
      },
    };

    engine.registerAdapter(loopAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "loop-max-iterations-slice",
        source: "inline",
        entryNodeId: "loop-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "loop-node",
            type: "loop-node",
            title: "Loop Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "loop-node->loop-node",
            fromNodeId: "loop-node",
            toNodeId: "loop-node",
            kind: "loop",
            metadata: {
              maxIterations: 1,
            },
          },
        ],
      },
      variables: {
        iteration: 0,
      },
    });

    const state = await engine.runToCheckpoint({
      workflowId: workflow.id,
      maxSteps: 4,
    });

    expect(state.instance.status).toBe("FORCE_TERMINATED");
    expect(state.instance.variables).toMatchObject({
      iteration: 2,
      runtimeLoopIterations: {
        "loop-node->loop-node": 1,
      },
      runtimeLoopTermination: {
        loopKey: "loop-node->loop-node",
        iterationIndex: 2,
        reason: "max_iterations_exceeded",
        maxIterations: 1,
        edgeId: "loop-node->loop-node",
      },
      runtimeTermination: {
        requestedBy: "runtime.loop_guard",
        reason: "Loop edge loop-node->loop-node exceeded maxIterations (1).",
        loop: expect.objectContaining({
          loopKey: "loop-node->loop-node",
          iterationIndex: 1,
          maxIterations: 1,
        }),
      },
    });
    expect(state.instance.edgeTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeId: "loop-node->loop-node",
          status: "blocked",
        }),
      ]),
    );
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "edge.loop_iterated",
          workflowId: workflow.id,
          edgeId: "loop-node->loop-node",
          metadata: expect.objectContaining({
            iterationIndex: 1,
          }),
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "instance.terminated",
          workflowId: workflow.id,
          status: "FORCE_TERMINATED",
          metadata: expect.objectContaining({
            requestedBy: "runtime.loop_guard",
            trigger: "loop_guard.max_iterations",
            loopKey: "loop-node->loop-node",
            iterationIndex: 2,
            maxIterations: 1,
          }),
        }),
      ]),
    );
  });

  it("force terminates when a loop edge exceeds maxDurationMs metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));

    const workflow = makeWorkflow({ id: "wf-runtime-loop-max-duration" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const loopAdapter: WorkflowNodeAdapter = {
      type: "loop-node",
      async execute(context) {
        const currentIteration =
          typeof context.variables.iteration === "number"
            ? context.variables.iteration
            : 0;
        const nextIteration = currentIteration + 1;
        if (nextIteration >= 2) {
          vi.setSystemTime(new Date("2026-04-23T00:00:00.025Z"));
        }
        return {
          kind: "advance",
          output: {
            iteration: nextIteration,
          },
          nextNodeId: "loop-node",
        };
      },
    };

    engine.registerAdapter(loopAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "loop-max-duration-slice",
        source: "inline",
        entryNodeId: "loop-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "loop-node",
            type: "loop-node",
            title: "Loop Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "loop-node->loop-node",
            fromNodeId: "loop-node",
            toNodeId: "loop-node",
            kind: "loop",
            metadata: {
              maxDurationMs: 10,
            },
          },
        ],
      },
      variables: {
        iteration: 0,
      },
    });

    const state = await engine.runToCheckpoint({
      workflowId: workflow.id,
      maxSteps: 4,
    });

    expect(state.instance.status).toBe("FORCE_TERMINATED");
    expect(state.instance.variables).toMatchObject({
      iteration: 2,
      runtimeLoopIterations: {
        "loop-node->loop-node": 1,
      },
      runtimeLoopTermination: {
        loopKey: "loop-node->loop-node",
        iterationIndex: 2,
        reason: "max_duration_exceeded",
        maxDurationMs: 10,
        elapsedMs: 25,
      },
      runtimeTermination: {
        requestedBy: "runtime.loop_guard",
        reason: "Loop edge loop-node->loop-node exceeded maxDurationMs (10ms).",
        loop: expect.objectContaining({
          loopKey: "loop-node->loop-node",
          maxDurationMs: 10,
        }),
      },
    });
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "instance.terminated",
          workflowId: workflow.id,
          metadata: expect.objectContaining({
            requestedBy: "runtime.loop_guard",
            trigger: "loop_guard.max_duration",
            loopKey: "loop-node->loop-node",
            iterationIndex: 2,
            maxDurationMs: 10,
            elapsedMs: 25,
          }),
        }),
      ]),
    );
  });

  it("preserves latest loop checkpoint context when operators terminate a looping runtime", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-loop-operator-terminate" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const loopAdapter: WorkflowNodeAdapter = {
      type: "loop-node",
      async execute(context) {
        const currentIteration =
          typeof context.variables.iteration === "number"
            ? context.variables.iteration
            : 0;
        if (currentIteration >= 1) {
          return {
            kind: "wait",
            waitingFor: "operator approval to continue loop",
            output: {
              iteration: currentIteration,
            },
          };
        }
        return {
          kind: "advance",
          output: {
            iteration: currentIteration + 1,
          },
          nextNodeId: "loop-node",
        };
      },
    };

    engine.registerAdapter(loopAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "loop-operator-terminate-slice",
        source: "inline",
        entryNodeId: "loop-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "loop-node",
            type: "loop-node",
            title: "Loop Node",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "loop-node->loop-node",
            fromNodeId: "loop-node",
            toNodeId: "loop-node",
            kind: "loop",
            metadata: {
              maxIterations: 5,
            },
          },
        ],
      },
      variables: {
        iteration: 0,
      },
    });

    const waitingState = await engine.runToCheckpoint({
      workflowId: workflow.id,
      maxSteps: 3,
    });
    expect(waitingState.instance.status).toBe("WAITING_INPUT");

    const terminated = engine.terminate(workflow.id, {
      requestedBy: "operator-7",
      reason: "Stop after first loop pass",
    });

    expect(terminated.instance.status).toBe("FORCE_TERMINATED");
    expect(terminated.instance.variables).toMatchObject({
      runtimeLoopIterations: {
        "loop-node->loop-node": 1,
      },
      runtimeTermination: {
        requestedBy: "operator-7",
        reason: "Stop after first loop pass",
        loop: expect.objectContaining({
          loopKey: "loop-node->loop-node",
          iterationIndex: 1,
          maxIterations: 5,
        }),
      },
    });
    expect(runtime.__test.emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "web_aigc_runtime_event",
        eventKey: "instance.terminated",
        workflowId: workflow.id,
        metadata: expect.objectContaining({
          requestedBy: "operator-7",
          reason: "Stop after first loop pass",
          loop: expect.objectContaining({
            loopKey: "loop-node->loop-node",
            iterationIndex: 1,
          }),
        }),
      }),
    );
  });

  it("executes flow_jump nodes through explicit jump edges across branches", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-flow-jump" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const laneOneAdapter: WorkflowNodeAdapter = {
      type: "lane-one",
      async execute() {
        return {
          kind: "advance",
          output: {
            enteredLane: "one",
          },
        };
      },
    };
    const targetAdapter: WorkflowNodeAdapter = {
      type: "jump-target",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            landedAt: context.node.id,
            enteredLane: context.variables.enteredLane,
            jumpTargetNodeId: context.variables.jumpTargetNodeId,
            jumpReason: context.variables.jumpReason,
          },
        };
      },
    };

    engine.registerAdapter(laneOneAdapter);
    engine.registerAdapter(targetAdapter);
    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "flow-jump-slice",
        source: "inline",
        entryNodeId: "lane-one-start",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          replayId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "lane-one-start",
            type: "lane-one",
            title: "Lane One Start",
            inputs: [],
            outputs: [],
            config: [],
          },
          {
            id: "jump-node",
            type: "flow_jump",
            title: "Jump To Branch B",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "targetNodeId",
                label: "Jump Target",
                valueType: "string",
                defaultValue: "branch-b-entry",
              },
              {
                key: "reason",
                label: "Jump Reason",
                valueType: "string",
                defaultValue: "route_to_branch_b",
              },
            ],
          },
          {
            id: "branch-a-end",
            type: "jump-target",
            title: "Branch A End",
            inputs: [],
            outputs: [],
            config: [],
          },
          {
            id: "branch-b-entry",
            type: "jump-target",
            title: "Branch B Entry",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "lane-one-start->jump-node",
            fromNodeId: "lane-one-start",
            toNodeId: "jump-node",
            kind: "success",
          },
          {
            id: "jump-node->branch-b-entry",
            fromNodeId: "jump-node",
            toNodeId: "branch-b-entry",
            kind: "jump",
            label: "jump-to-branch-b",
          },
          {
            id: "jump-node->branch-a-end",
            fromNodeId: "jump-node",
            toNodeId: "branch-a-end",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.currentNodeId).toBe("branch-b-entry");
    expect(state.instance.output).toMatchObject({
      landedAt: "branch-b-entry",
      enteredLane: "one",
      jumpTargetNodeId: "branch-b-entry",
      jumpReason: "route_to_branch_b",
    });
    expect(
      state.instance.edgeTransitions.find(edge => edge.edgeId === "jump-node->branch-b-entry")?.status,
    ).toBe("executed");
    expect(
      state.instance.edgeTransitions.find(edge => edge.edgeId === "jump-node->branch-a-end")?.status,
    ).toBe("known");
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "edge.transitioned",
          workflowId: workflow.id,
          edgeId: "jump-node->branch-b-entry",
          fromNodeId: "jump-node",
          toNodeId: "branch-b-entry",
          metadata: expect.objectContaining({
            kind: "jump",
          }),
        }),
      ]),
    );
  });

  it("rejects flow_jump nodes without an explicit jump edge to the target", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-flow-jump-invalid" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "flow-jump-invalid-slice",
        source: "inline",
        entryNodeId: "jump-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "jump-node",
            type: "flow_jump",
            title: "Invalid Jump",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "targetNodeId",
                label: "Jump Target",
                valueType: "string",
                defaultValue: "branch-b-entry",
              },
            ],
          },
          {
            id: "branch-b-entry",
            type: "end",
            title: "Branch B Entry",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "jump-node->branch-b-entry-success",
            fromNodeId: "jump-node",
            toNodeId: "branch-b-entry",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXCEPTION");
    expect(state.instance.error).toBe(
      "Flow jump node jump-node cannot jump to branch-b-entry without an explicit jump edge.",
    );
    expect(
      state.instance.nodeRuns.find(node => node.nodeId === "jump-node")?.output,
    ).toMatchObject({
      requestedTargetNodeId: "branch-b-entry",
      jumpValidated: false,
    });
    expect(
      state.instance.edgeTransitions.find(
        edge => edge.edgeId === "jump-node->branch-b-entry-success",
      )?.status,
    ).toBe("known");
  });

  it("executes orchestration_recognition_jump through runtime extra adapters and inherits context", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-orchestration-jump" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    const targetAdapter: WorkflowNodeAdapter = {
      type: "jump-target",
      async execute(context) {
        return {
          kind: "complete",
          output: {
            landedAt: context.node.id,
            jumpReason: context.variables.jumpReason,
            jumpTargetNodeId: context.variables.jumpTargetNodeId,
            contextBridge: context.variables.contextBridge,
          },
        };
      },
    };

    engine.registerAdapter(targetAdapter);
    installWebAigcRuntimeExtraAdapters(engine, {
      orchestrationRecognitionJumpRuntime: {
        permissionEngine: {
          checkPermission() {
            return { allowed: true };
          },
        },
        auditLogger: {
          log() {},
        },
      },
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "runtime-orchestration-jump",
        source: "inline",
        entryNodeId: "recognition-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          missionId: "mission-orchestration-jump-1",
          sessionId: "session-orchestration-jump-1",
        },
        nodeSchemas: [
          {
            id: "recognition-node",
            type: "orchestration_recognition_jump",
            title: "Recognize Orchestration",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "query",
                label: "Query",
                valueType: "string",
                defaultValue: "payment release",
              },
              {
                key: "agentId",
                label: "Agent",
                valueType: "string",
                defaultValue: "agent-jump",
              },
              {
                key: "token",
                label: "Token",
                valueType: "string",
                defaultValue: "token-jump",
              },
              {
                key: "candidates",
                label: "Candidates",
                valueType: "array",
                defaultValue: [
                  {
                    orchestrationId: "orch-release",
                    entryNodeId: "release-entry",
                    label: "payment release",
                    keywords: ["payment", "release"],
                    aliases: ["payment-release"],
                  },
                ],
              },
              {
                key: "context",
                label: "Context",
                valueType: "object",
                defaultValue: {
                  traceId: "trace-orch-1",
                  operatorId: "operator-1",
                },
              },
            ],
          },
          {
            id: "release-entry",
            type: "jump-target",
            title: "Release Entry",
            inputs: [],
            outputs: [],
            config: [],
          },
        ],
        edgeSchemas: [
          {
            id: "recognition->release-entry",
            fromNodeId: "recognition-node",
            toNodeId: "release-entry",
            kind: "jump",
            label: "cross-orchestration-jump",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.currentNodeId).toBe("release-entry");
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "recognition-node")
        ?.output,
    ).toMatchObject({
      jumpTargetNodeId: "release-entry",
      jumpValidated: true,
      jump: {
        nextNodeId: "release-entry",
      },
      context: {
        inheritedContext: {
          traceId: "trace-orch-1",
          operatorId: "operator-1",
        },
      },
    });
    expect(state.instance.output).toMatchObject({
      landedAt: "release-entry",
    });
    expect(
      state.instance.edgeTransitions.find(
        edge => edge.edgeId === "recognition->release-entry",
      )?.status,
    ).toBe("executed");
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "edge.transitioned",
          workflowId: workflow.id,
          edgeId: "recognition->release-entry",
          metadata: expect.objectContaining({
            links: expect.objectContaining({
              workflowId: workflow.id,
              instanceId: workflow.id,
              replayId: workflow.id,
              nodeId: "recognition-node",
              edgeId: "recognition->release-entry",
              traceId: "trace-orch-1",
            }),
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

  it("lets the runtime built-in dialogue adapter use an injected documentSearch executor", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-dialogue-document-search" });
    const runtime = createRuntime(workflow);
    const documentSearchCalls: Array<{ query: string; projectId: string }> = [];
    const storedMessages: MessageRecord[] = [];
    const llmExchanges: Array<{
      agentId: string;
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: unknown;
    }> = [];
    const llmMessages: Array<Array<{ role: string; content: string }>> = [];

    runtime.workflowRepo.createMessage = (message) => {
      const created: MessageRecord = {
        id: storedMessages.length + 1,
        created_at: "2026-04-23T00:00:00.000Z",
        ...message,
      };
      storedMessages.push(created);
      return created;
    };
    runtime.memoryRepo.appendLLMExchange = (agentId, options) => {
      llmExchanges.push({ agentId, ...options });
    };

    runtime.documentSearch = async (request) => {
      documentSearchCalls.push({
        query: request.query,
        projectId: request.scope.projectId,
      });

      return {
        query: request.query,
        totalCandidates: 1,
        latencyMs: 9,
        mode: "hybrid",
        results: [
          {
            documentId: "doc-runtime-1",
            sourceType: "document",
            score: 0.91,
            summary: "运行时文档检索命中认证链路说明。",
            highlights: ["认证链路", "运行时注入"],
            fragments: [],
          },
        ],
      };
    };
    runtime.llmProvider = {
      async call(messages) {
        llmMessages.push(
          messages.map((message) => ({
            role: message.role,
            content:
              typeof message.content === "string"
                ? message.content
                : JSON.stringify(message.content ?? ""),
          })),
        );
        const lastMessage = messages[messages.length - 1];
        return {
          content: `runtime-dialogue-search:${String(lastMessage?.content ?? "")}`,
          usage: {
            prompt_tokens: 18,
            completion_tokens: 9,
            total_tokens: 27,
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
        name: "dialogue-document-search-runtime-slice",
        source: "inline",
        entryNodeId: "dialogue-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          sessionId: "session-dialogue-search-1",
          missionId: "mission-dialogue-search-1",
        },
        nodeSchemas: [
          {
            id: "dialogue-node",
            type: "dialogue",
            title: "Dialogue Search Node",
            agentId: "dialogue-agent-runtime",
            stageKey: "dialogue_document_search",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "prompt",
                label: "Prompt",
                valueType: "string",
                defaultValue: "请总结认证链路的运行时依赖",
              },
              {
                key: "documentSearch",
                label: "Document Search",
                valueType: "object",
                defaultValue: {
                  scope: {
                    projectId: "proj-runtime-dialogue",
                    documentIds: ["doc-runtime-1"],
                  },
                  options: {
                    topK: 2,
                    mode: "hybrid",
                  },
                },
              },
            ],
          },
        ],
        edgeSchemas: [],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(documentSearchCalls).toEqual([
      {
        query: "请总结认证链路的运行时依赖",
        projectId: "proj-runtime-dialogue",
      },
    ]);
    expect(state.instance.output).toMatchObject({
      nodeType: "dialogue",
      content: "runtime-dialogue-search:请总结认证链路的运行时依赖",
      result: "runtime-dialogue-search:请总结认证链路的运行时依赖",
      observability: {
        workflowId: workflow.id,
        sessionId: "session-dialogue-search-1",
        missionId: "mission-dialogue-search-1",
        agentId: "dialogue-agent-runtime",
        stage: "dialogue_document_search",
        persistedToWorkflow: true,
        persistedToSession: true,
        citations: [
          "doc-runtime-1: 运行时文档检索命中认证链路说明。 [认证链路 | 运行时注入]",
        ],
        toolCalls: [
          expect.objectContaining({
            name: "document_search",
          }),
        ],
      },
    });

    const systemMessage = llmMessages[0]?.find(message => message.role === "system");
    expect(systemMessage?.content).toContain("Retrieved citations");
    expect(systemMessage?.content).toContain("Tool results");
    expect(systemMessage?.content).toContain("doc-runtime-1");
    expect(systemMessage?.content).toContain("documentSearch");

    expect(storedMessages).toHaveLength(2);
    expect(storedMessages[0]).toMatchObject({
      workflow_id: workflow.id,
      from_agent: "workflow-user",
      to_agent: "dialogue-agent-runtime",
      stage: "dialogue_document_search",
      content: "请总结认证链路的运行时依赖",
    });
    expect(storedMessages[1]).toMatchObject({
      workflow_id: workflow.id,
      from_agent: "dialogue-agent-runtime",
      to_agent: "workflow-user",
      stage: "dialogue_document_search",
      content: "runtime-dialogue-search:请总结认证链路的运行时依赖",
      metadata: expect.objectContaining({
        nodeType: "dialogue",
        sessionId: "session-dialogue-search-1",
        missionId: "mission-dialogue-search-1",
        agentId: "dialogue-agent-runtime",
        stage: "dialogue_document_search",
        citations: [
          "doc-runtime-1: 运行时文档检索命中认证链路说明。 [认证链路 | 运行时注入]",
        ],
        toolCalls: [
          expect.objectContaining({
            name: "document_search",
            result:
              "Matched 1 documents in 9ms. Mode: hybrid. Top hits: doc-runtime-1(0.91).",
          }),
        ],
      }),
    });

    expect(llmExchanges).toHaveLength(1);
    expect(llmExchanges[0]).toMatchObject({
      agentId: "dialogue-agent-runtime",
      workflowId: workflow.id,
      stage: "dialogue_document_search",
      prompt: "请总结认证链路的运行时依赖",
      response: "runtime-dialogue-search:请总结认证链路的运行时依赖",
      metadata: storedMessages[1]?.metadata,
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

  it("executes web_search and get_device_info through installed extra runtime adapters", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-extra-adapters" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    installWebAigcRuntimeExtraAdapters(engine, {
      executeWebSearch: async (request) => ({
        query: request.query,
        results: [
          {
            title: "Runtime search result",
            url: "https://example.test/runtime-search",
            snippet: "Runtime search adapter output.",
            source: "runtime-test",
          },
        ],
        totalCandidates: 1,
        latencyMs: 12,
        mode: request.options?.mode ?? "hybrid",
      }),
      deviceRuntime: {
        processPlatform: "win32",
        processArch: "x64",
        processVersion: "v22.0.0",
      },
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "runtime-extra-adapters",
        source: "inline",
        entryNodeId: "search-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          sessionId: "session-extra-1",
          missionId: "mission-extra-1",
        },
        nodeSchemas: [
          {
            id: "search-node",
            type: "web_search",
            title: "Search Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "query",
                label: "Query",
                valueType: "string",
                defaultValue: "runtime extra adapters",
              },
              {
                key: "options",
                label: "Options",
                valueType: "object",
                defaultValue: {
                  topK: 1,
                  mode: "hybrid",
                },
              },
            ],
          },
          {
            id: "device-node",
            type: "get_device_info",
            title: "Device Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "clientHints",
                label: "Client Hints",
                valueType: "object",
                defaultValue: {
                  userAgent:
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
                  platform: "desktop-web",
                  locale: "zh-cn",
                  timezone: "Asia/Shanghai",
                },
              },
            ],
          },
        ],
        edgeSchemas: [
          {
            id: "search-node->device-node",
            fromNodeId: "search-node",
            toNodeId: "device-node",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(state.instance.output).toMatchObject({
      status: "completed",
      runtime: {
        runtime: "node",
        platform: "win32",
        arch: "x64",
        nodeVersion: "v22.0.0",
      },
      client: {
        platform: "desktop-web",
        browserFamily: "Chrome",
        osFamily: "Windows",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      },
      context: {
        workflowId: workflow.id,
        missionId: "mission-extra-1",
        sessionId: "session-extra-1",
        nodeId: "device-node",
        nodeType: "get_device_info",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "search-node")?.output,
    ).toMatchObject({
      query: "runtime extra adapters",
      totalCandidates: 1,
      observability: {
        eventKey: "external.web_search",
      },
    });
  });

  it("executes audio_recognition, ocr_recognition, static_webpage_read, graph_search, image_search, long_text_extraction, intent_recognition, and similarity_match through installed extra runtime adapters", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-extra-adapters-extended" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    installWebAigcRuntimeExtraAdapters(engine, {
      audioRecognitionRuntime: {
        recognizeAudio: async () => ({
          transcript: "请整理支付发布前检查项",
        }),
      },
      ocrRecognitionRuntime: {
        recognizeImages: async () =>
          new Map([
            [
              "release-checklist.png",
              {
                text: "发布检查清单",
                fragments: [
                  {
                    text: "发布检查清单",
                    page: 1,
                    region: "top-left" as const,
                  },
                ],
                pages: [{ page: 1, text: "发布检查清单" }],
                rawResponse: '{"text":"发布检查清单"}',
              },
            ],
          ]),
        persistArtifacts: async () => ({
          outputId: "ocr-runtime-output",
          artifacts: [
            {
              kind: "file" as const,
              name: "ocr-results.json",
              path: "tmp/vision-outputs/ocr-runtime-output/ocr-results.json",
              mimeType: "application/json",
              downloadUrl: "/api/vision/outputs/ocr-runtime-output/ocr-results.json",
              description: "OCR output artifact (ocr-results.json)",
            },
          ],
        }),
      },
      fetchStaticWebpageHtml: async () => `
        <html>
          <head><title>支付发布手册</title></head>
          <body>
            <article>
              <p>发布前先检查监控、告警、回滚预案。</p>
              <a href="https://example.test/checklist">检查清单</a>
            </article>
          </body>
        </html>
      `,
      queryService: {
        async getNeighbors() {
          return {
            entities: [],
            relations: [],
            contextSummary: "no-op",
            isPartial: false,
          };
        },
        async findPath() {
          return {
            entities: [
              {
                entityId: "payment-api",
                entityType: "CodeModule",
                name: "payment-api",
                description: "支付接口",
                createdAt: "2026-04-23T00:00:00.000Z",
                updatedAt: "2026-04-23T00:00:00.000Z",
                source: "code_analysis",
                confidence: 0.9,
                projectId: "proj-runtime",
                status: "active",
                needsReview: false,
                linkedMemoryIds: [],
                extendedAttributes: {},
              },
              {
                entityId: "release-check",
                entityType: "BusinessRule",
                name: "release-check",
                description: "发布检查规则",
                createdAt: "2026-04-23T00:00:00.000Z",
                updatedAt: "2026-04-23T00:00:00.000Z",
                source: "llm_inferred",
                confidence: 0.86,
                projectId: "proj-runtime",
                status: "active",
                needsReview: false,
                linkedMemoryIds: [],
                extendedAttributes: {},
              },
            ],
            relations: [
              {
                relationId: "rel-runtime-1",
                relationType: "IMPLEMENTS",
                sourceEntityId: "payment-api",
                targetEntityId: "release-check",
                weight: 1,
                evidence: "payment-api follows release-check",
                createdAt: "2026-04-23T00:00:00.000Z",
                source: "code_analysis",
                confidence: 0.82,
                needsReview: false,
              },
            ],
            contextSummary: "Found a runtime graph path.",
            isPartial: false,
          };
        },
        async subgraph() {
          return {
            entities: [],
            relations: [],
            contextSummary: "no-op",
            isPartial: false,
          };
        },
        async naturalLanguageQuery() {
          return {
            entities: [],
            relations: [],
            contextSummary: "no-op",
            isPartial: false,
          };
        },
      },
      knowledgeService: {
        async query(question, projectId) {
          return {
            structuredResults: {
              entities: [
                {
                  entityId: "payment-api",
                  entityType: "CodeModule",
                  name: "payment-api",
                  description: "支付接口",
                  createdAt: "2026-04-23T00:00:00.000Z",
                  updatedAt: "2026-04-23T00:00:00.000Z",
                  source: "code_analysis",
                  confidence: 0.9,
                  projectId,
                  status: "active",
                  needsReview: false,
                  linkedMemoryIds: [],
                  extendedAttributes: {},
                },
              ],
              relations: [],
            },
            semanticResults: [],
            mergedSummary: `knowledge:${question}`,
          };
        },
      },
      executeImageSearch: async () => ({
        query: "支付发布检查配图",
        normalized: {
          textQuery: "支付发布检查配图",
          tags: ["dashboard"],
          referenceTags: ["release"],
        },
        results: [
          {
            imageId: "runtime-image-1",
            title: "支付发布仪表盘",
            summary: "展示支付发布检查项的仪表盘插画。",
            previewUrl: "https://example.test/runtime/payment-release-preview.jpg",
            sourceUrl: "https://example.test/runtime/payment-release",
            source: "runtime-mock",
            tags: ["dashboard", "release", "payment"],
            availability: "available",
            score: 0.92,
            matchedBy: ["query", "tags"],
          },
        ],
        totalCandidates: 1,
        degraded: false,
        warnings: [],
        mode: "hybrid",
      }),
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "runtime-extra-adapters-extended",
        source: "inline",
        entryNodeId: "audio-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          sessionId: "session-extra-2",
          missionId: "mission-extra-2",
        },
        nodeSchemas: [
          {
            id: "audio-node",
            type: "audio_recognition",
            title: "Audio Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "source",
                label: "Source",
                valueType: "object",
                defaultValue: {
                  audioBase64: Buffer.from("runtime-audio").toString("base64"),
                  mimeType: "audio/webm",
                },
              },
            ],
          },
          {
            id: "ocr-node",
            type: "ocr_recognition",
            title: "OCR Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "images",
                label: "Images",
                valueType: "array",
                defaultValue: [
                  {
                    name: "release-checklist.png",
                    base64DataUrl: "data:image/png;base64,cmVsZWFzZS1jaGVja2xpc3Q=",
                  },
                ],
              },
              {
                key: "artifact",
                label: "Artifact",
                valueType: "object",
                defaultValue: {
                  outputFormats: ["json"],
                },
              },
            ],
          },
          {
            id: "static-node",
            type: "static_webpage_read",
            title: "Static Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "url",
                label: "URL",
                valueType: "string",
                defaultValue: "https://example.test/release-playbook",
              },
            ],
          },
          {
            id: "graph-node",
            type: "graph_search",
            title: "Graph Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "mode",
                label: "Mode",
                valueType: "string",
                defaultValue: "path",
              },
              {
                key: "projectId",
                label: "Project",
                valueType: "string",
                defaultValue: "proj-runtime",
              },
              {
                key: "sourceEntityId",
                label: "Source Entity",
                valueType: "string",
                defaultValue: "payment-api",
              },
              {
                key: "targetEntityId",
                label: "Target Entity",
                valueType: "string",
                defaultValue: "release-check",
              },
              {
                key: "includeAnswerDraft",
                label: "Answer Draft",
                valueType: "boolean",
                defaultValue: true,
              },
              {
                key: "answerQuestion",
                label: "Question",
                valueType: "string",
                defaultValue: "支付接口如何落到发布检查规则？",
              },
            ],
          },
          {
            id: "intent-node",
            type: "intent_recognition",
            title: "Intent Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "commandText",
                label: "Command Text",
                valueType: "string",
                defaultValue: "整理支付发布前检查项",
              },
              {
                key: "userId",
                label: "User",
                valueType: "string",
                defaultValue: "user-runtime",
              },
              {
                key: "priority",
                label: "Priority",
                valueType: "string",
                defaultValue: "high",
              },
              {
                key: "locale",
                label: "Locale",
                valueType: "string",
                defaultValue: "zh-CN",
              },
              {
                key: "planId",
                label: "Plan Id",
                valueType: "string",
                defaultValue: "runtime-plan-1",
              },
            ],
          },
          {
            id: "image-node",
            type: "image_search",
            title: "Image Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "query",
                label: "Query",
                valueType: "string",
                defaultValue: "支付发布检查配图",
              },
              {
                key: "tags",
                label: "Tags",
                valueType: "array",
                defaultValue: ["dashboard"],
              },
              {
                key: "referenceImage",
                label: "Reference",
                valueType: "object",
                defaultValue: {
                  description: "release dashboard",
                  tags: ["release"],
                },
              },
              {
                key: "options",
                label: "Options",
                valueType: "object",
                defaultValue: {
                  mode: "hybrid",
                  topK: 1,
                  minScore: 0.2,
                },
              },
            ],
          },
          {
            id: "long-text-node",
            type: "long_text_extraction",
            title: "Long Text Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "title",
                label: "Title",
                valueType: "string",
                defaultValue: "支付发布知识整理",
              },
              {
                key: "text",
                label: "Text",
                valueType: "string",
                defaultValue:
                  "支付系统发布前需要检查监控、告警、回滚预案，并整理发布摘要供后续归档和格式化输出使用。",
              },
              {
                key: "mode",
                label: "Mode",
                valueType: "string",
                defaultValue: "balanced",
              },
              {
                key: "maxKeywords",
                label: "Keywords",
                valueType: "number",
                defaultValue: 5,
              },
              {
                key: "maxFragments",
                label: "Fragments",
                valueType: "number",
                defaultValue: 2,
              },
            ],
          },
          {
            id: "similarity-node",
            type: "similarity_match",
            title: "Similarity Node",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "query",
                label: "Query",
                valueType: "string",
                defaultValue: "支付发布检查清单",
              },
              {
                key: "candidates",
                label: "Candidates",
                valueType: "array",
                defaultValue: [
                  {
                    candidateId: "candidate-release",
                    label: "发布检查",
                    text: "支付发布检查清单",
                  },
                  {
                    candidateId: "candidate-chat",
                    label: "闲聊",
                    text: "天气不错一起吃饭",
                  },
                ],
              },
              {
                key: "options",
                label: "Options",
                valueType: "object",
                defaultValue: {
                  mode: "hybrid",
                  threshold: 0.6,
                  topK: 1,
                },
              },
            ],
          },
        ],
        edgeSchemas: [
          {
            id: "audio-node->ocr-node",
            fromNodeId: "audio-node",
            toNodeId: "ocr-node",
            kind: "success",
          },
          {
            id: "ocr-node->static-node",
            fromNodeId: "ocr-node",
            toNodeId: "static-node",
            kind: "success",
          },
          {
            id: "static-node->graph-node",
            fromNodeId: "static-node",
            toNodeId: "graph-node",
            kind: "success",
          },
          {
            id: "graph-node->intent-node",
            fromNodeId: "graph-node",
            toNodeId: "intent-node",
            kind: "success",
          },
          {
            id: "intent-node->image-node",
            fromNodeId: "intent-node",
            toNodeId: "image-node",
            kind: "success",
          },
          {
            id: "image-node->long-text-node",
            fromNodeId: "image-node",
            toNodeId: "long-text-node",
            kind: "success",
          },
          {
            id: "long-text-node->similarity-node",
            fromNodeId: "long-text-node",
            toNodeId: "similarity-node",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "audio-node")?.output,
    ).toMatchObject({
      transcript: "请整理支付发布前检查项",
      observability: {
        eventKey: "multimodal.audio_recognition",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "ocr-node")?.output,
    ).toMatchObject({
      text: "发布检查清单",
      pages: [{ page: 1, text: "发布检查清单" }],
      observability: {
        eventKey: "multimodal.ocr_recognition",
      },
      artifact: {
        outputId: "ocr-runtime-output",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "static-node")?.output,
    ).toMatchObject({
      status: "completed",
      observability: {
        eventKey: "external.static_webpage_read",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "graph-node")?.output,
    ).toMatchObject({
      mode: "path",
      graph: {
        pathFound: true,
      },
      downstream: {
        knowledgeQaReady: true,
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "intent-node")?.output,
    ).toMatchObject({
      recognition: {
        intent: "release_execution",
      },
      routing: {
        nextNodeType: "command_list",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "image-node")?.output,
    ).toMatchObject({
      status: "completed",
      mode: "hybrid",
      totalCandidates: 1,
      results: [
        expect.objectContaining({
          imageId: "runtime-image-1",
          availability: "available",
        }),
      ],
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "long-text-node")?.output,
    ).toMatchObject({
      status: "completed",
      title: "支付发布知识整理",
      summary: {
        short: expect.any(String),
      },
      keywords: expect.any(Array),
      fragments: expect.any(Array),
      structured: {
        summary: expect.any(String),
      },
    });
    expect(state.instance.output).toMatchObject({
      status: "completed",
      summary: {
        matched: true,
      },
      branch: {
        selected: "matched",
      },
      observability: {
        eventKey: "external.similarity_match",
      },
    });
  });

  it("executes ai_ppt, excel_read, dynamic_chart, file_slicing, file_translation, and file_generation through installed extra runtime adapters", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-extra-adapters-office" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["月份", "营收"],
      ["一月", 120],
      ["二月", 150],
      ["三月", 180],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    const workbookBase64 = XLSX.write(workbook, {
      type: "base64",
      bookType: "xlsx",
    });

    installWebAigcRuntimeExtraAdapters(engine, {
      aiPptRuntime: {
        generateDeck: async () => ({
          title: "周报简报",
          summary: "本周关键动作与结果总结",
          slides: [
            {
              slideNumber: 1,
              title: "本周概览",
              bullets: ["完成接线", "验证测试"],
            },
          ],
        }),
      },
      fileGenerationRuntime: {
        writeArtifactFile: async ({ outputId, filename, content }) => ({
          outputId: outputId ?? "runtime-file-output",
          absolutePath: `C:/virtual/${filename}`,
          artifact: {
            kind: "file",
            name: filename,
            path: `tmp/web-aigc-file-generation/${outputId ?? "runtime-file-output"}/${filename}`,
            mimeType: "application/json",
            downloadUrl: `/api/file-generation/outputs/${outputId ?? "runtime-file-output"}/${filename}?download=1`,
            previewUrl: `/api/file-generation/outputs/${outputId ?? "runtime-file-output"}/${filename}/preview`,
            description: `File generation output artifact (${filename})`,
          },
        }),
        readArtifactPreview: async () => ({
          inlineText: "{\"ok\":true}",
          truncated: false,
          sizeBytes: 11,
          contentType: "application/json",
        }),
      },
      fileTranslationRuntime: {
        translateSegment: async ({ text, targetLanguage, kind }) =>
          `${targetLanguage}:${kind}:${text}`,
      },
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "runtime-extra-adapters-office",
        source: "inline",
        entryNodeId: "ppt-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          sessionId: "session-office-1",
          missionId: "mission-office-1",
        },
        nodeSchemas: [
          {
            id: "ppt-node",
            type: "ai_ppt",
            title: "AI PPT",
            inputs: [],
            outputs: [],
            config: [
              { key: "topic", label: "Topic", valueType: "string", defaultValue: "周报简报" },
              { key: "brief", label: "Brief", valueType: "string", defaultValue: "输出本周工作汇总" },
            ],
          },
          {
            id: "excel-node",
            type: "excel_read",
            title: "Excel Read",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "workbookBase64",
                label: "Workbook",
                valueType: "string",
                defaultValue: workbookBase64,
              },
              { key: "sheetIndex", label: "Sheet", valueType: "number", defaultValue: 1 },
              { key: "maxRows", label: "Rows", valueType: "number", defaultValue: 3 },
            ],
          },
          {
            id: "chart-node",
            type: "dynamic_chart",
            title: "Chart",
            inputs: [],
            outputs: [],
            config: [
              { key: "title", label: "Title", valueType: "string", defaultValue: "营收图表" },
              { key: "chartType", label: "Chart Type", valueType: "string", defaultValue: "bar" },
              {
                key: "dataset",
                label: "Dataset",
                valueType: "object",
                defaultValue: {
                  sheetName: "Sheet1",
                  headers: ["月份", "营收"],
                  rows: [
                    ["一月", 120],
                    ["二月", 150],
                    ["三月", 180],
                  ],
                },
              },
            ],
          },
          {
            id: "slice-node",
            type: "file_slicing",
            title: "File Slicing",
            inputs: [],
            outputs: [],
            config: [
              { key: "sourceId", label: "Source", valueType: "string", defaultValue: "report-1" },
              { key: "projectId", label: "Project", valueType: "string", defaultValue: "proj-office" },
              { key: "fileType", label: "FileType", valueType: "string", defaultValue: "markdown" },
              { key: "content", label: "Content", valueType: "string", defaultValue: "# 周报\n\n第一段内容。\n\n第二段内容。" },
              {
                key: "strategy",
                label: "Strategy",
                valueType: "object",
                defaultValue: {
                  mode: "paragraph",
                  maxChars: 30,
                  overlapChars: 5,
                  preserveParagraphs: true,
                },
              },
            ],
          },
          {
            id: "file-node",
            type: "file_generation",
            title: "File Generation",
            inputs: [],
            outputs: [],
            config: [
              { key: "title", label: "Title", valueType: "string", defaultValue: "图表摘要" },
              { key: "filename", label: "Filename", valueType: "string", defaultValue: "chart-summary" },
              { key: "format", label: "Format", valueType: "string", defaultValue: "json" },
              {
                key: "structuredContent",
                label: "Structured Content",
                valueType: "object",
                defaultValue: {
                  chart: "营收图表",
                  status: "ready",
                },
              },
            ],
          },
          {
            id: "translation-node",
            type: "file_translation",
            title: "File Translation",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "file",
                label: "File",
                valueType: "object",
                defaultValue: {
                  name: "weekly-report.md",
                  mimeType: "text/markdown; charset=utf-8",
                  content: "# Weekly Summary\n\n- Completed runtime wiring\n- Updated progress dashboard",
                },
              },
              { key: "sourceLanguage", label: "Source", valueType: "string", defaultValue: "en" },
              { key: "targetLanguage", label: "Target", valueType: "string", defaultValue: "zh-CN" },
              { key: "preserveStructure", label: "Preserve", valueType: "boolean", defaultValue: true },
              {
                key: "artifact",
                label: "Artifact",
                valueType: "object",
                defaultValue: {
                  outputId: "runtime-file-translation-output",
                  outputFormat: "md",
                },
              },
            ],
          },
        ],
        edgeSchemas: [
          { id: "ppt->excel", fromNodeId: "ppt-node", toNodeId: "excel-node", kind: "success" },
          { id: "excel->chart", fromNodeId: "excel-node", toNodeId: "chart-node", kind: "success" },
          { id: "chart->slice", fromNodeId: "chart-node", toNodeId: "slice-node", kind: "success" },
          { id: "slice->translation", fromNodeId: "slice-node", toNodeId: "translation-node", kind: "success" },
          { id: "translation->file", fromNodeId: "translation-node", toNodeId: "file-node", kind: "success" },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "ppt-node")?.output,
    ).toMatchObject({
      status: "completed",
      deck: {
        title: "周报简报",
      },
      observability: {
        eventKey: "content.ai_ppt",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "excel-node")?.output,
    ).toMatchObject({
      status: "completed",
      workbook: {
        totalSheets: expect.any(Number),
      },
      dynamicChart: {
        compatible: expect.any(Boolean),
      },
      observability: {
        eventKey: "content.excel_read",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "chart-node")?.output,
    ).toMatchObject({
      status: "completed",
      chartType: "bar",
      observability: {
        eventKey: "ui.dynamic_chart",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "slice-node")?.output,
    ).toMatchObject({
      status: "completed",
      observability: {
        eventKey: "content.file_slicing",
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "translation-node")?.output,
    ).toMatchObject({
      status: "completed",
      translation: {
        sourceLanguage: "en",
        targetLanguage: "zh-CN",
        structurePreserved: true,
        text: expect.stringContaining("zh-CN:heading:Weekly Summary"),
      },
      artifact: {
        outputId: "runtime-file-translation-output",
        format: "md",
        artifact: {
          name: "weekly-report.zh-CN.md",
        },
      },
      observability: {
        eventKey: "content.file_translation",
      },
    });
    expect(state.instance.output).toMatchObject({
      status: "completed",
      filename: "chart-summary.json",
      metadata: {
        artifactManaged: true,
      },
      observability: {
        eventKey: "content.file_generation",
      },
    });
  });

  it("waits and resumes transaction_flow nodes through installed extra runtime adapters", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-transaction-flow" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    installWebAigcRuntimeExtraAdapters(engine, {
      transactionFlowRuntime: {
        permissionEngine: {
          checkPermission() {
            return { allowed: true };
          },
        },
        auditLogger: {
          log() {},
        },
        now: () => "2026-04-23T09:00:00.000Z",
        createId: () => "runtime-transaction-id",
      },
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "runtime-transaction-flow",
        source: "inline",
        entryNodeId: "transaction-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
          missionId: "mission-transaction-1",
          sessionId: "session-transaction-1",
        },
        nodeSchemas: [
          {
            id: "transaction-node",
            type: "transaction_flow",
            title: "Transaction Flow",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "agentId",
                label: "Agent",
                valueType: "string",
                defaultValue: "agent-transaction",
              },
              {
                key: "token",
                label: "Token",
                valueType: "string",
                defaultValue: "token-transaction",
              },
              {
                key: "transaction",
                label: "Transaction",
                valueType: "object",
                defaultValue: {
                  service: "billing",
                  action: "refund_order",
                  resource: "orders",
                  targetId: "order-1",
                  summary: "退款订单 order-1",
                },
              },
              {
                key: "compensation",
                label: "Compensation",
                valueType: "object",
                defaultValue: {
                  strategy: "manual_compensation",
                  summary: "退款失败后需要人工对账",
                  steps: ["核对退款流水", "人工执行补偿"],
                },
              },
            ],
          },
          {
            id: "end-node",
            type: "end",
            title: "End",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "status",
                label: "Status",
                valueType: "string",
                defaultValue: "$.status",
              },
              {
                key: "summary",
                label: "Summary",
                valueType: "string",
                defaultValue: "事务流程执行完成",
              },
              {
                key: "output",
                label: "Output",
                valueType: "object",
                defaultValue: {
                  status: "$.status",
                  audit: "$.audit",
                  compensation: "$.compensation",
                  result: "$.result",
                },
              },
            ],
          },
        ],
        edgeSchemas: [
          {
            id: "transaction->end",
            fromNodeId: "transaction-node",
            toNodeId: "end-node",
            kind: "success",
          },
        ],
      },
    });

    const waitingState = await engine.runToCheckpoint({ workflowId: workflow.id });
    expect(waitingState.instance.status).toBe("WAITING_INPUT");
    expect(waitingState.instance.checkpoint?.waitingFor).toContain("请确认是否执行高风险事务");
    expect(waitingState.instance.checkpoint?.payload).toMatchObject({
      nodeType: "transaction_flow",
      decisionId: "decision_runtime-transaction-id",
    });
    expect(
      waitingState.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "transaction-node")?.output,
    ).toMatchObject({
      status: "approval_required",
      approval: {
        required: true,
        status: "pending",
      },
      audit: {
        eventKey: "node.waiting_input",
      },
    });

    const resumedState = await engine.resume(workflow.id, {
      decision: "approved",
      actorId: "approver-1",
      comment: "审批通过",
      ticketId: "ticket-1",
    });

    expect(resumedState.instance.status).toBe("EXECUTED");
    expect(
      resumedState.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "transaction-node")?.output,
    ).toMatchObject({
      status: "completed",
      audit: {
        eventKey: "human.approved",
      },
      compensation: {
        summary: "退款失败后需要人工对账",
      },
      result: {
        state: "committed",
        service: "billing",
        action: "refund_order",
        targetId: "order-1",
      },
    });
    expect(resumedState.instance.output).toMatchObject({
      status: "completed",
      result: {
        status: "completed",
        result: {
          state: "committed",
        },
      },
    });
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "node.waiting_input",
          workflowId: workflow.id,
          nodeId: "transaction-node",
          metadata: expect.objectContaining({
            links: expect.objectContaining({
              workflowId: workflow.id,
              instanceId: workflow.id,
              replayId: workflow.id,
              nodeId: "transaction-node",
              decisionId: "decision_runtime-transaction-id",
            }),
          }),
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "node.completed",
          workflowId: workflow.id,
          nodeId: "transaction-node",
        }),
      ]),
    );
  });

  it("executes knowledge_qa, qa_search, and mcp through installed extra runtime adapters", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-knowledge-mcp" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);

    installWebAigcRuntimeExtraAdapters(engine, {
      knowledgeService: {
        async query(question, projectId) {
          return {
            query: question,
            projectId,
            mergedSummary: `knowledge:${question}`,
            structuredResults: {
              entities: [
                {
                  id: "entity-auth",
                  entityType: "CodeModule",
                  name: "auth-module",
                  description: "认证模块",
                  confidence: 0.9,
                },
              ],
              relations: [
                {
                  relationType: "depends_on",
                  sourceEntityId: "auth-module",
                  targetEntityId: "token-service",
                  evidence: "认证模块依赖 token-service",
                  confidence: 0.8,
                },
              ],
            },
            semanticResults: [
              {
                id: "semantic-1",
                content: "认证链路依赖 token-service 提供签发能力。",
                score: 0.88,
              },
            ],
          } as any;
        },
      },
      executeMcp: async (request) => ({
        ok: true,
        status: "completed",
        targetLabel: `${request.serverId}/${request.toolName}`,
        operation: "mcp_tool",
        resource: `mcp://${request.serverId}/${request.toolName}`,
        output: JSON.stringify({
          ok: true,
          serverId: request.serverId,
          toolName: request.toolName,
        }),
        response: {
          ok: true,
          serverId: request.serverId,
          toolName: request.toolName,
        },
        governance: {
          approval: {
            required: false,
            status: "not_required",
            source: "none",
          },
        },
        metadata: {
          serverId: request.serverId,
          toolName: request.toolName,
          workflowId: request.workflowId,
          stage: request.stage,
          timeoutMs: request.timeoutMs ?? 15000,
          fallbackUsed: false,
        },
      }),
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "knowledge-mcp-runtime-slice",
        source: "inline",
        entryNodeId: "knowledge-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "knowledge-node",
            type: "knowledge_qa",
            title: "Knowledge QA",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "question",
                label: "Question",
                valueType: "string",
                defaultValue: "认证模块依赖谁？",
              },
              {
                key: "projectId",
                label: "Project",
                valueType: "string",
                defaultValue: "proj-runtime",
              },
            ],
          },
          {
            id: "qa-search-node",
            type: "qa_search",
            title: "QA Search",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "question",
                label: "Question",
                valueType: "string",
                defaultValue: "认证链路的证据是什么？",
              },
              {
                key: "projectId",
                label: "Project",
                valueType: "string",
                defaultValue: "proj-runtime",
              },
              {
                key: "maxResults",
                label: "Max Results",
                valueType: "number",
                defaultValue: 3,
              },
            ],
          },
          {
            id: "mcp-node",
            type: "mcp",
            title: "MCP Node",
            agentId: "agent-mcp-runtime",
            stageKey: "node_mcp",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "serverId",
                label: "Server",
                valueType: "string",
                defaultValue: "workspace.memory",
              },
              {
                key: "toolName",
                label: "Tool",
                valueType: "string",
                defaultValue: "recent_memory",
              },
              {
                key: "input",
                label: "Input",
                valueType: "string",
                defaultValue: "读取最近记忆",
              },
              {
                key: "arguments",
                label: "Arguments",
                valueType: "object",
                defaultValue: {
                  sessionId: "sess-runtime-knowledge-mcp",
                  limit: 3,
                },
              },
              {
                key: "token",
                label: "Token",
                valueType: "string",
                defaultValue: "token-runtime-mcp",
              },
            ],
          },
        ],
        edgeSchemas: [
          {
            id: "knowledge->qa-search",
            fromNodeId: "knowledge-node",
            toNodeId: "qa-search-node",
            kind: "success",
          },
          {
            id: "qa-search->mcp",
            fromNodeId: "qa-search-node",
            toNodeId: "mcp-node",
            kind: "success",
          },
        ],
      },
    });

    const state = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(state.instance.status).toBe("EXECUTED");
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "knowledge-node")?.output,
    ).toMatchObject({
      nodeType: "knowledge_qa",
      answer: "knowledge:认证模块依赖谁？",
      citations: expect.arrayContaining(["CodeModule:auth-module"]),
      evidence: {
        structuredEntityCount: 1,
        relationCount: 1,
        semanticHitCount: 1,
      },
    });
    expect(
      state.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "qa-search-node")?.output,
    ).toMatchObject({
      nodeType: "qa_search",
      answer: "knowledge:认证链路的证据是什么？",
      matches: expect.any(Array),
      context: expect.stringContaining("semantic"),
    });
    expect(state.instance.output).toMatchObject({
      nodeType: "mcp",
      status: "completed",
      operation: "mcp_tool",
      targetLabel: "workspace.memory/recent_memory",
      response: {
        ok: true,
        serverId: "workspace.memory",
        toolName: "recent_memory",
      },
    });
  });

  it("waits and resumes mcp nodes through installed extra runtime adapters", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-mcp-approval" });
    const runtime = createRuntime(workflow);
    const engine = new WorkflowRuntimeEngine(runtime);
    const mcpExecuteMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: "approval_required",
        targetLabel: "workspace.memory/recent_memory",
        operation: "mcp_tool",
        resource: "mcp://workspace.memory/recent_memory",
        output: "manual approval required",
        response: null,
        escalationId: "esc-runtime-mcp-1",
        governance: {
          approval: {
            required: true,
            status: "pending",
            source: "manual_gate",
            escalationId: "esc-runtime-mcp-1",
          },
        },
        metadata: {
          serverId: "workspace.memory",
          toolName: "recent_memory",
          workflowId: workflow.id,
          stage: "node_mcp",
          timeoutMs: 15000,
          fallbackUsed: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: "completed",
        targetLabel: "workspace.memory/recent_memory",
        operation: "mcp_tool",
        resource: "mcp://workspace.memory/recent_memory",
        output: '{"ok":true}',
        response: {
          ok: true,
          approved: true,
        },
        governance: {
          approval: {
            required: false,
            status: "not_required",
            source: "none",
          },
        },
        metadata: {
          serverId: "workspace.memory",
          toolName: "recent_memory",
          workflowId: workflow.id,
          stage: "node_mcp",
          timeoutMs: 15000,
          fallbackUsed: false,
        },
      });

    installWebAigcRuntimeExtraAdapters(engine, {
      executeMcp: (request) => mcpExecuteMock(request),
    });

    engine.initialize({
      workflowId: workflow.id,
      definition: {
        kind: "graph_definition",
        version: 1,
        definitionId: workflow.id,
        code: workflow.id,
        name: "mcp-runtime-approval",
        source: "inline",
        entryNodeId: "mcp-node",
        graphVersion: {
          kind: "graph_version",
          version: 1,
          definitionId: workflow.id,
          graphVersion: "v1",
          createdAt: "2026-04-23T00:00:00.000Z",
        },
        links: {
          workflowId: workflow.id,
        },
        nodeSchemas: [
          {
            id: "mcp-node",
            type: "mcp",
            title: "MCP Approval Node",
            agentId: "agent-mcp-runtime",
            stageKey: "node_mcp",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "serverId",
                label: "Server",
                valueType: "string",
                defaultValue: "workspace.memory",
              },
              {
                key: "toolName",
                label: "Tool",
                valueType: "string",
                defaultValue: "recent_memory",
              },
              {
                key: "input",
                label: "Input",
                valueType: "string",
                defaultValue: "读取最近记忆",
              },
              {
                key: "requireApproval",
                label: "RequireApproval",
                valueType: "boolean",
                defaultValue: true,
              },
              {
                key: "approverList",
                label: "Approvers",
                valueType: "array",
                defaultValue: ["admin-1"],
              },
              {
                key: "token",
                label: "Token",
                valueType: "string",
                defaultValue: "token-runtime-mcp",
              },
            ],
          },
          {
            id: "end-node",
            type: "end",
            title: "End",
            inputs: [],
            outputs: [],
            config: [
              {
                key: "status",
                label: "Status",
                valueType: "string",
                defaultValue: "$.status",
              },
              {
                key: "output",
                label: "Output",
                valueType: "object",
                defaultValue: {
                  status: "$.status",
                  response: "$.response",
                  approval: "$.approval",
                  audit: "$.audit",
                },
              },
            ],
          },
        ],
        edgeSchemas: [
          {
            id: "mcp->end",
            fromNodeId: "mcp-node",
            toNodeId: "end-node",
            kind: "success",
          },
        ],
      },
    });

    const waitingState = await engine.runToCheckpoint({ workflowId: workflow.id });

    expect(waitingState.instance.status).toBe("WAITING_INPUT");
    expect(waitingState.instance.checkpoint?.waitingFor).toContain("请审批 MCP 工具调用");
    expect(waitingState.instance.checkpoint?.payload).toMatchObject({
      nodeType: "mcp",
      escalationId: "esc-runtime-mcp-1",
      targetLabel: "workspace.memory/recent_memory",
    });
    expect(
      waitingState.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "mcp-node")?.output,
    ).toMatchObject({
      nodeType: "mcp",
      status: "approval_required",
      audit: {
        eventKey: "node.waiting_input",
      },
    });

    const resumedState = await engine.resume(workflow.id, {
      decision: "approved",
      actorId: "approver-1",
      comment: "审批通过",
      ticketId: "ticket-mcp-1",
    });

    expect(resumedState.instance.status).toBe("EXECUTED");
    expect(
      resumedState.instance.nodeRuns.find(nodeRun => nodeRun.nodeId === "mcp-node")?.output,
    ).toMatchObject({
      nodeType: "mcp",
      status: "completed",
      response: {
        ok: true,
        approved: true,
      },
      approval: {
        decision: "approved",
        actorId: "approver-1",
        ticketId: "ticket-mcp-1",
        escalationId: "esc-runtime-mcp-1",
      },
      audit: {
        eventKey: "human.approved",
      },
    });
    expect(resumedState.instance.output).toMatchObject({
      status: "completed",
      result: {
        status: "completed",
        response: {
          ok: true,
          approved: true,
        },
      },
    });
    expect(runtime.__test.emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "node.waiting_input",
          workflowId: workflow.id,
          nodeId: "mcp-node",
          waitingFor: expect.stringContaining("请审批 MCP 工具调用"),
        }),
        expect.objectContaining({
          type: "web_aigc_runtime_event",
          eventKey: "node.completed",
          workflowId: workflow.id,
          nodeId: "mcp-node",
        }),
      ]),
    );
    expect(mcpExecuteMock).toHaveBeenCalledTimes(2);
    expect(mcpExecuteMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        requireApproval: false,
        metadata: expect.objectContaining({
          approval: expect.objectContaining({
            decision: "approved",
            actorId: "approver-1",
            ticketId: "ticket-mcp-1",
            escalationId: "esc-runtime-mcp-1",
          }),
        }),
      }),
    );
  });

  it("can register mcp runtime execution through the shared global adapter registry", async () => {
    const workflow = makeWorkflow({ id: "wf-runtime-mcp-global-registry" });
    const executeMcp = vi.fn(async (request) => ({
      ok: true,
      status: "completed",
      targetLabel: `${request.serverId}/${request.toolName}`,
      operation: "mcp_tool",
      resource: `mcp://${request.serverId}/${request.toolName}`,
      output: '{"ok":true}',
      response: {
        ok: true,
        toolName: request.toolName,
      },
      governance: {
        approval: {
          required: false,
          status: "not_required",
          source: "none",
        },
      },
      metadata: {
        serverId: request.serverId,
        toolName: request.toolName,
        workflowId: request.workflowId,
        stage: request.stage,
        timeoutMs: request.timeoutMs ?? 15000,
        fallbackUsed: false,
      },
    }));
    const globalWorkflow = makeWorkflow({
      id: workflow.id,
      directive: workflow.directive,
    });
    const previousDocumentSearch = serverRuntime.documentSearch;
    const originalGetWorkflow = serverRuntime.workflowRepo.getWorkflow;
    const originalUpdateWorkflow = serverRuntime.workflowRepo.updateWorkflow;
    const originalGetWorkflows = serverRuntime.workflowRepo.getWorkflows;

    serverRuntime.documentSearch = undefined;
    serverRuntime.workflowRepo.getWorkflow = (id) =>
      id === workflow.id ? globalWorkflow : originalGetWorkflow.call(serverRuntime.workflowRepo, id);
    serverRuntime.workflowRepo.updateWorkflow = (id, updates) => {
      if (id === workflow.id) {
        Object.assign(globalWorkflow, updates);
        return;
      }
      return originalUpdateWorkflow.call(serverRuntime.workflowRepo, id, updates);
    };
    serverRuntime.workflowRepo.getWorkflows = () => [
      globalWorkflow,
      ...originalGetWorkflows.call(serverRuntime.workflowRepo).filter(
        candidate => candidate.id !== workflow.id,
      ),
    ];

    try {
      registerWebAigcRuntimeExtraAdapters({
        executeMcp,
      });

      webAigcRuntimeEngine.initialize({
        workflowId: workflow.id,
        definition: {
          kind: "graph_definition",
          version: 1,
          definitionId: workflow.id,
          code: workflow.id,
          name: "mcp-global-registry-slice",
          source: "inline",
          entryNodeId: "mcp-node",
          graphVersion: {
            kind: "graph_version",
            version: 1,
            definitionId: workflow.id,
            graphVersion: "v1",
            createdAt: "2026-04-23T00:00:00.000Z",
          },
          links: {
            workflowId: workflow.id,
          },
          nodeSchemas: [
            {
              id: "mcp-node",
              type: "mcp",
              title: "Global MCP Node",
              agentId: "agent-global-mcp",
              stageKey: "node_mcp",
              inputs: [],
              outputs: [],
              config: [
                {
                  key: "serverId",
                  label: "Server",
                  valueType: "string",
                  defaultValue: "workspace.memory",
                },
                {
                  key: "toolName",
                  label: "Tool",
                  valueType: "string",
                  defaultValue: "recent_memory",
                },
                {
                  key: "input",
                  label: "Input",
                  valueType: "string",
                  defaultValue: "读取最近记忆",
                },
                {
                  key: "token",
                  label: "Token",
                  valueType: "string",
                  defaultValue: "token-global-mcp",
                },
              ],
            },
          ],
          edgeSchemas: [],
        },
      });

      const state = await webAigcRuntimeEngine.runToCheckpoint({
        workflowId: workflow.id,
      });

      expect(state.instance.status).toBe("EXECUTED");
      expect(state.instance.output).toMatchObject({
        nodeType: "mcp",
        status: "completed",
        response: {
          ok: true,
          toolName: "recent_memory",
        },
      });
      expect(executeMcp).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: "workspace.memory",
          toolName: "recent_memory",
          workflowId: workflow.id,
          stage: "node_mcp",
          agentId: "agent-global-mcp",
          token: "token-global-mcp",
        }),
      );
    } finally {
      serverRuntime.documentSearch = previousDocumentSearch;
      serverRuntime.workflowRepo.getWorkflow = originalGetWorkflow;
      serverRuntime.workflowRepo.updateWorkflow = originalUpdateWorkflow;
      serverRuntime.workflowRepo.getWorkflows = originalGetWorkflows;
    }
  });
});
