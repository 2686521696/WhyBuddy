import type { GraphProjectionLinks, GraphRuntimeStatus } from "./workflow-graph.js";

export const WEB_AIGC_RUNTIME_STATUSES = [
  "PENDING",
  "EXECUTING",
  "WAITING_INPUT",
  "EXECUTED",
  "EXCEPTION",
  "FORCE_TERMINATED",
] as const;

export type WebAigcRuntimeStatus = GraphRuntimeStatus;

export const WEB_AIGC_NODE_RUN_STATUSES = [
  ...WEB_AIGC_RUNTIME_STATUSES,
  "SKIPPED",
] as const;

export type WebAigcNodeRunStatus = (typeof WEB_AIGC_NODE_RUN_STATUSES)[number];

export type CubeWorkflowProjectionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "force_terminated";

export const WEB_AIGC_VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "any",
] as const;

export type WebAigcValueType = (typeof WEB_AIGC_VALUE_TYPES)[number];

export const WEB_AIGC_EDGE_KINDS = [
  "success",
  "failure",
  "conditional",
  "loop",
  "jump",
] as const;

export type WebAigcEdgeKind = (typeof WEB_AIGC_EDGE_KINDS)[number];

export interface WebAigcFieldSchema {
  key: string;
  label: string;
  valueType: WebAigcValueType;
  required?: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface WebAigcNodeSchema {
  id: string;
  type: string;
  title: string;
  description?: string;
  agentId?: string;
  stageKey?: string | null;
  inputs: WebAigcFieldSchema[];
  outputs: WebAigcFieldSchema[];
  config: WebAigcFieldSchema[];
  metadata?: Record<string, unknown>;
}

export interface WebAigcEdgeSchema {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: WebAigcEdgeKind;
  label?: string;
  condition?: string;
  metadata?: Record<string, unknown>;
}

export interface WebAigcGraphVersion {
  kind: "graph_version";
  version: 1;
  definitionId: string;
  graphVersion: string;
  checksum?: string;
  createdAt: string;
}

export interface WebAigcGraphDefinition {
  kind: "graph_definition";
  version: 1;
  definitionId: string;
  code: string;
  name: string;
  source: "stored" | "organization_projection" | "task_projection" | "inline";
  entryNodeId: string;
  graphVersion: WebAigcGraphVersion;
  links: Partial<GraphProjectionLinks>;
  nodeSchemas: WebAigcNodeSchema[];
  edgeSchemas: WebAigcEdgeSchema[];
  metadata?: Record<string, unknown>;
}

export interface WebAigcSessionLink extends Partial<GraphProjectionLinks> {
  workflowId?: string;
  missionId?: string;
  sessionId?: string;
  replayId?: string;
  auditId?: string;
}

export interface WebAigcNodeRunRecord {
  nodeId: string;
  status: WebAigcNodeRunStatus;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  waitingFor?: string;
  transitionEdgeId?: string;
  error?: string;
  retryable?: boolean;
}

export interface WebAigcEdgeTransitionRecord {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: WebAigcEdgeKind;
  status: "known" | "executed" | "blocked";
  timestamp?: string;
}

export interface WebAigcGraphCheckpoint {
  nodeId: string;
  waitingFor: string;
  createdAt: string;
  resumeCount: number;
  inputSchema?: WebAigcFieldSchema[];
  payload?: Record<string, unknown>;
}

export interface WebAigcGraphInstance {
  kind: "graph_instance";
  version: 1;
  instanceId: string;
  definitionId: string;
  status: WebAigcRuntimeStatus;
  currentNodeId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  links: WebAigcSessionLink;
  variables: Record<string, unknown>;
  nodeRuns: WebAigcNodeRunRecord[];
  edgeTransitions: WebAigcEdgeTransitionRecord[];
  output?: Record<string, unknown>;
  checkpoint?: WebAigcGraphCheckpoint;
  error?: string;
}

export interface StoredWebAigcRuntimeState {
  domainModelVersion: 1;
  definition: WebAigcGraphDefinition;
  instance: WebAigcGraphInstance;
  updatedAt: string;
}

export function isTerminalWebAigcStatus(status: WebAigcRuntimeStatus): boolean {
  return (
    status === "EXECUTED" ||
    status === "EXCEPTION" ||
    status === "FORCE_TERMINATED"
  );
}

export function toCubeWorkflowStatus(
  status: WebAigcRuntimeStatus,
): CubeWorkflowProjectionStatus {
  switch (status) {
    case "PENDING":
      return "pending";
    case "EXECUTING":
    case "WAITING_INPUT":
      return "running";
    case "EXECUTED":
      return "completed";
    case "FORCE_TERMINATED":
      return "force_terminated";
    case "EXCEPTION":
    default:
      return "failed";
  }
}

export function toWebAigcRuntimeStatus(
  value?: string | null,
  options: { waitingFor?: boolean | string | null } = {},
): WebAigcRuntimeStatus {
  if (options.waitingFor) {
    return "WAITING_INPUT";
  }

  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "pending":
    case "queued":
    case "created":
      return "PENDING";
    case "executing":
    case "running":
    case "in_progress":
    case "submitted":
    case "reviewed":
    case "audited":
    case "revising":
      return "EXECUTING";
    case "waiting":
    case "waiting_input":
      return "WAITING_INPUT";
    case "executed":
    case "completed":
    case "done":
    case "passed":
    case "verified":
      return "EXECUTED";
    case "completed_with_errors":
    case "exception":
    case "failed":
    case "error":
    case "rejected":
      return "EXCEPTION";
    case "cancelled":
    case "terminated":
    case "force_terminated":
      return "FORCE_TERMINATED";
    default:
      return "EXECUTING";
  }
}

export function toWebAigcNodeRunStatus(
  value?: string | null,
  options: { waitingFor?: boolean | string | null } = {},
): WebAigcNodeRunStatus {
  if (options.waitingFor) {
    return "WAITING_INPUT";
  }

  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "pending":
    case "queued":
    case "created":
      return "PENDING";
    case "executing":
    case "running":
    case "in_progress":
    case "submitted":
    case "reviewed":
    case "audited":
    case "revising":
      return "EXECUTING";
    case "waiting":
    case "waiting_input":
      return "WAITING_INPUT";
    case "executed":
    case "completed":
    case "done":
    case "passed":
    case "verified":
      return "EXECUTED";
    case "skipped":
      return "SKIPPED";
    case "completed_with_errors":
    case "exception":
    case "failed":
    case "error":
    case "rejected":
      return "EXCEPTION";
    case "cancelled":
    case "terminated":
    case "force_terminated":
      return "FORCE_TERMINATED";
    default:
      return "PENDING";
  }
}
