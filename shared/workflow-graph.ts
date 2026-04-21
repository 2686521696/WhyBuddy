export const GRAPH_RUNTIME_STATUSES = [
  "PENDING",
  "EXECUTING",
  "WAITING_INPUT",
  "EXECUTED",
  "EXCEPTION",
  "FORCE_TERMINATED",
] as const;

export type GraphRuntimeStatus = (typeof GRAPH_RUNTIME_STATUSES)[number];

export interface GraphProjectionLinks {
  workflowId: string;
  missionId?: string;
  sessionId?: string;
  replayId?: string;
  auditId?: string;
}

export interface GraphNodeRunSnapshot {
  nodeId: string;
  agentId?: string;
  parentNodeId?: string | null;
  title: string;
  role?: string;
  departmentId?: string;
  departmentLabel?: string;
  status: GraphRuntimeStatus;
  stageKey?: string | null;
  taskId?: number;
  taskStatus?: string;
  outputPreview?: string;
  error?: string;
}

export interface GraphEdgeTransitionSnapshot {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: "parent_child";
  status: "known" | "executed" | "blocked";
}

export interface GraphInstanceTelemetry {
  messageCount: number;
  taskCount: number;
  errorCount: number;
  waitingFor?: string;
}

export interface GraphInstanceSnapshot {
  kind: "graph_instance_snapshot";
  version: 1;
  instanceId: string;
  workflowId: string;
  missionId?: string;
  sessionId?: string;
  directive: string;
  status: GraphRuntimeStatus;
  workflowStatus: string;
  missionStatus?: string;
  currentStage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  links: GraphProjectionLinks;
  nodeRuns: GraphNodeRunSnapshot[];
  edgeTransitions: GraphEdgeTransitionSnapshot[];
  telemetry: GraphInstanceTelemetry;
}
