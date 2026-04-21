import { describe, expect, it } from "vitest";

import type { MissionRecord } from "../../shared/mission/contracts.js";
import type { WorkflowOrganizationSnapshot } from "../../shared/organization-schema.js";
import type { MessageRecord, TaskRecord, WorkflowRecord } from "../../shared/workflow-runtime.js";
import { buildWorkflowGraphInstanceSnapshot } from "../core/workflow-graph-projection.js";

const ORGANIZATION: WorkflowOrganizationSnapshot = {
  kind: "workflow_organization",
  version: 1,
  workflowId: "wf-graph",
  directive: "Build a graph projection",
  generatedAt: "2026-04-22T00:00:00.000Z",
  source: "generated",
  taskProfile: "analysis",
  reasoning: "Need manager and worker nodes.",
  rootNodeId: "node-root",
  rootAgentId: "agent-root",
  departments: [
    {
      id: "dept-ai",
      label: "AI",
      managerNodeId: "node-manager",
      direction: "Answer user request",
      strategy: "parallel",
      maxConcurrency: 2,
    },
  ],
  nodes: [
    {
      id: "node-root",
      agentId: "agent-root",
      parentId: null,
      departmentId: "dept-ai",
      departmentLabel: "AI",
      name: "Root",
      title: "Root Orchestrator",
      role: "ceo",
      responsibility: "Orchestrate graph",
      responsibilities: ["Orchestrate graph"],
      goals: ["Complete mission"],
      summaryFocus: ["status"],
      skills: [],
      mcp: [],
      model: { model: "gpt-5.4", temperature: 0.2, maxTokens: 4000 },
      execution: { mode: "orchestrate", strategy: "parallel", maxConcurrency: 2 },
    },
    {
      id: "node-manager",
      agentId: "agent-manager",
      parentId: "node-root",
      departmentId: "dept-ai",
      departmentLabel: "AI",
      name: "Manager",
      title: "Knowledge Manager",
      role: "manager",
      responsibility: "Coordinate work",
      responsibilities: ["Coordinate work"],
      goals: ["Route tasks"],
      summaryFocus: ["quality"],
      skills: [],
      mcp: [],
      model: { model: "gpt-5.4", temperature: 0.2, maxTokens: 4000 },
      execution: { mode: "review", strategy: "parallel", maxConcurrency: 2 },
    },
    {
      id: "node-worker",
      agentId: "agent-worker",
      parentId: "node-manager",
      departmentId: "dept-ai",
      departmentLabel: "AI",
      name: "Worker",
      title: "Knowledge Worker",
      role: "worker",
      responsibility: "Answer question",
      responsibilities: ["Answer question"],
      goals: ["Deliver answer"],
      summaryFocus: ["answer"],
      skills: [],
      mcp: [],
      model: { model: "gpt-5.4", temperature: 0.2, maxTokens: 4000 },
      execution: { mode: "execute", strategy: "parallel", maxConcurrency: 2 },
    },
  ],
};

function makeWorkflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "wf-graph",
    directive: "Build a graph projection",
    status: "running",
    current_stage: "execution",
    departments_involved: ["dept-ai"],
    started_at: "2026-04-22T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-04-22T00:00:00.000Z",
    results: {
      organization: ORGANIZATION,
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 1,
    workflow_id: "wf-graph",
    worker_id: "agent-worker",
    manager_id: "agent-manager",
    department: "AI",
    description: "Answer the user question",
    deliverable: "A concise answer with citations.",
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
    workflow_id: "wf-graph",
    from_agent: "agent-worker",
    to_agent: "agent-manager",
    stage: "execution",
    content: "Current answer draft",
    metadata: {},
    created_at: "2026-04-22T00:00:01.000Z",
    ...overrides,
  };
}

function makeMission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "mission-graph",
    kind: "chat",
    title: "Graph mission",
    sourceText: "Build a graph projection",
    topicId: "session-1",
    status: "waiting",
    progress: 55,
    currentStageKey: "execute",
    stages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    waitingFor: "user confirmation",
    ...overrides,
  };
}

describe("buildWorkflowGraphInstanceSnapshot", () => {
  it("projects workflow organization into graph node runs and edges", () => {
    const instance = buildWorkflowGraphInstanceSnapshot({
      workflow: makeWorkflow(),
      tasks: [makeTask()],
      messages: [makeMessage()],
      mission: makeMission(),
    });

    expect(instance.kind).toBe("graph_instance_snapshot");
    expect(instance.instanceId).toBe("wf-graph");
    expect(instance.missionId).toBe("mission-graph");
    expect(instance.sessionId).toBe("session-1");
    expect(instance.status).toBe("WAITING_INPUT");
    expect(instance.nodeRuns).toHaveLength(3);
    expect(instance.edgeTransitions).toHaveLength(2);
    expect(instance.telemetry).toMatchObject({
      messageCount: 1,
      taskCount: 1,
      errorCount: 0,
      waitingFor: "user confirmation",
    });
  });

  it("maps worker task status onto the matching node run", () => {
    const instance = buildWorkflowGraphInstanceSnapshot({
      workflow: makeWorkflow(),
      tasks: [makeTask({ status: "completed", deliverable_v3: "Final answer." })],
      messages: [],
      mission: makeMission({ status: "running", waitingFor: undefined }),
    });

    const workerNode = instance.nodeRuns.find(node => node.agentId === "agent-worker");
    expect(workerNode).toBeDefined();
    expect(workerNode?.status).toBe("EXECUTED");
    expect(workerNode?.taskStatus).toBe("completed");
    expect(workerNode?.outputPreview).toBe("Final answer.");
  });

  it("falls back to synthetic node runs when organization is missing", () => {
    const instance = buildWorkflowGraphInstanceSnapshot({
      workflow: makeWorkflow({ results: {} }),
      tasks: [makeTask({ id: 7, worker_id: "agent-fallback", description: "Fallback task" })],
      messages: [],
      mission: undefined,
    });

    expect(instance.nodeRuns).toHaveLength(1);
    expect(instance.nodeRuns[0]).toMatchObject({
      nodeId: "task-7",
      agentId: "agent-fallback",
      title: "Fallback task",
    });
    expect(instance.edgeTransitions).toHaveLength(0);
  });
});
