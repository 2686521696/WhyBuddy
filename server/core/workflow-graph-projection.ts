import type { MissionRecord } from "../../shared/mission/contracts.js";
import type {
  GraphEdgeTransitionSnapshot,
  GraphInstanceSnapshot,
  GraphNodeRunSnapshot,
  GraphRuntimeStatus,
} from "../../shared/workflow-graph.js";
import type {
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
} from "../../shared/workflow-runtime.js";
import type {
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "../../shared/organization-schema.js";

function mapWorkflowStatusToGraphStatus(
  workflowStatus: string,
  mission?: Pick<MissionRecord, "status" | "waitingFor">,
): GraphRuntimeStatus {
  if (mission?.status === "waiting" || mission?.waitingFor) {
    return "WAITING_INPUT";
  }

  switch (workflowStatus) {
    case "pending":
      return "PENDING";
    case "running":
      return "EXECUTING";
    case "completed":
    case "completed_with_errors":
      return "EXECUTED";
    case "failed":
      return "EXCEPTION";
    case "cancelled":
    case "force_terminated":
      return "FORCE_TERMINATED";
    default:
      return "EXECUTING";
  }
}

function mapTaskStatusToNodeStatus(taskStatus?: string): GraphRuntimeStatus {
  switch (taskStatus) {
    case "pending":
    case "queued":
    case "created":
      return "PENDING";
    case "running":
    case "in_progress":
    case "submitted":
    case "reviewed":
      return "EXECUTING";
    case "waiting":
    case "waiting_input":
      return "WAITING_INPUT";
    case "done":
    case "completed":
    case "verified":
    case "passed":
      return "EXECUTED";
    case "failed":
    case "rejected":
    case "error":
      return "EXCEPTION";
    case "cancelled":
    case "terminated":
      return "FORCE_TERMINATED";
    default:
      return "PENDING";
  }
}

function buildOutputPreview(task?: Pick<TaskRecord, "deliverable" | "deliverable_v2" | "deliverable_v3">): string | undefined {
  if (!task) return undefined;

  const deliverable =
    task.deliverable_v3 || task.deliverable_v2 || task.deliverable || "";
  const text = deliverable.trim();
  if (!text) return undefined;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function buildNodeRunSnapshot(
  node: WorkflowOrganizationNode,
  task?: TaskRecord,
): GraphNodeRunSnapshot {
  return {
    nodeId: node.id,
    agentId: node.agentId,
    parentNodeId: node.parentId,
    title: node.title || node.name,
    role: node.role,
    departmentId: node.departmentId,
    departmentLabel: node.departmentLabel,
    status: mapTaskStatusToNodeStatus(task?.status),
    stageKey: task?.status ?? null,
    taskId: task?.id,
    taskStatus: task?.status,
    outputPreview: buildOutputPreview(task),
  };
}

function buildFallbackNodeRuns(
  workflow: WorkflowRecord,
  tasks: TaskRecord[],
): GraphNodeRunSnapshot[] {
  if (tasks.length > 0) {
    return tasks.map(task => ({
      nodeId: `task-${task.id}`,
      agentId: task.worker_id,
      parentNodeId: null,
      title: task.description,
      status: mapTaskStatusToNodeStatus(task.status),
      stageKey: task.status,
      taskId: task.id,
      taskStatus: task.status,
      outputPreview: buildOutputPreview(task),
    }));
  }

  return [
    {
      nodeId: "workflow-root",
      title: workflow.directive,
      status: mapWorkflowStatusToGraphStatus(workflow.status),
      stageKey: workflow.current_stage,
    },
  ];
}

function buildEdgeTransitions(
  organization?: WorkflowOrganizationSnapshot,
  nodeRuns?: GraphNodeRunSnapshot[],
): GraphEdgeTransitionSnapshot[] {
  if (organization?.nodes?.length) {
    return organization.nodes
      .filter(node => node.parentId)
      .map(node => ({
        edgeId: `${node.parentId}->${node.id}`,
        fromNodeId: node.parentId as string,
        toNodeId: node.id,
        kind: "parent_child" as const,
        status: "known" as const,
      }));
  }

  if (!nodeRuns || nodeRuns.length <= 1) {
    return [];
  }

  return nodeRuns.slice(1).map((nodeRun, index) => ({
    edgeId: `${nodeRuns[index].nodeId}->${nodeRun.nodeId}`,
    fromNodeId: nodeRuns[index].nodeId,
    toNodeId: nodeRun.nodeId,
    kind: "parent_child" as const,
    status: "known" as const,
  }));
}

export function buildWorkflowGraphInstanceSnapshot(input: {
  workflow: WorkflowRecord;
  tasks: TaskRecord[];
  messages: MessageRecord[];
  mission?: MissionRecord;
}): GraphInstanceSnapshot {
  const { workflow, tasks, messages, mission } = input;
  const organization = workflow.results?.organization as
    | WorkflowOrganizationSnapshot
    | undefined;

  const taskByAgentId = new Map(tasks.map(task => [task.worker_id, task]));
  const nodeRuns = organization?.nodes?.length
    ? organization.nodes.map(node => buildNodeRunSnapshot(node, taskByAgentId.get(node.agentId)))
    : buildFallbackNodeRuns(workflow, tasks);

  const errorCount = nodeRuns.filter(node => node.status === "EXCEPTION").length;

  return {
    kind: "graph_instance_snapshot",
    version: 1,
    instanceId: workflow.id,
    workflowId: workflow.id,
    missionId: mission?.id,
    sessionId: mission?.topicId,
    directive: workflow.directive,
    status: mapWorkflowStatusToGraphStatus(workflow.status, mission),
    workflowStatus: workflow.status,
    missionStatus: mission?.status,
    currentStage: workflow.current_stage,
    createdAt: workflow.created_at,
    startedAt: workflow.started_at,
    completedAt: workflow.completed_at,
    links: {
      workflowId: workflow.id,
      missionId: mission?.id,
      sessionId: mission?.topicId,
      replayId: workflow.id,
    },
    nodeRuns,
    edgeTransitions: buildEdgeTransitions(organization, nodeRuns),
    telemetry: {
      messageCount: messages.length,
      taskCount: tasks.length,
      errorCount,
      waitingFor: mission?.waitingFor,
    },
  };
}
