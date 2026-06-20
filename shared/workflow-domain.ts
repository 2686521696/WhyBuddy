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

// ---------------------------------------------------------------------------
// Python Contract Slice: Workflow Runtime
// ---------------------------------------------------------------------------

export const WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION =
  "workflow.runtime.v1" as const;

export type WorkflowPythonRuntimeOperation =
  | "graph_validation"
  | "run_start"
  | "node_result"
  | "error";

export type WorkflowPythonRuntimeNodeStatus =
  | "pending"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

export type WorkflowPythonRuntimeFailureStatus = "failed" | "cancelled";

export interface WorkflowPythonRuntimeError {
  code: string;
  message: string;
  field?: string;
  retryable?: boolean;
}

export interface WorkflowPythonRuntimeNodePermission {
  required: boolean;
  guardId?: string;
  [key: string]: unknown;
}

export interface WorkflowPythonRuntimeGraphNode {
  nodeId: string;
  type: string;
  title: string;
  permission?: WorkflowPythonRuntimeNodePermission;
  [key: string]: unknown;
}

export interface WorkflowPythonRuntimeGraphEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: WebAigcEdgeKind;
  [key: string]: unknown;
}

export interface WorkflowPythonRuntimeGraph {
  workflowId: string;
  entryNodeId: string;
  nodes: WorkflowPythonRuntimeGraphNode[];
  edges: WorkflowPythonRuntimeGraphEdge[];
  [key: string]: unknown;
}

export interface WorkflowPythonRuntimeNodeResultEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  status: "known" | "traversed" | "blocked";
  kind?: WebAigcEdgeKind;
  [key: string]: unknown;
}

export interface WorkflowPythonRuntimeNodeResult {
  nodeId: string;
  status: WorkflowPythonRuntimeNodeStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  edge?: WorkflowPythonRuntimeNodeResultEdge;
  error?: WorkflowPythonRuntimeError;
}

export interface WorkflowPythonRuntimeRun {
  runId: string;
  workflowId: string;
  status: "running" | "done" | WorkflowPythonRuntimeFailureStatus;
  currentNodeId?: string;
  startedAt?: string;
  completedAt?: string;
  nodeResults: WorkflowPythonRuntimeNodeResult[];
  edgeTransitions: WorkflowPythonRuntimeNodeResultEdge[];
}

interface WorkflowPythonRuntimeBaseResult {
  contractVersion: typeof WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION;
  runtime: "python-contract";
  operation: WorkflowPythonRuntimeOperation;
  ok: boolean;
  status: string;
}

export type WorkflowPythonRuntimeGraphValidationResult =
  | (WorkflowPythonRuntimeBaseResult & {
      operation: "graph_validation";
      ok: true;
      status: "validated";
      graph: WorkflowPythonRuntimeGraph;
    })
  | (WorkflowPythonRuntimeBaseResult & {
      operation: "graph_validation";
      ok: false;
      status: "failed";
      error: WorkflowPythonRuntimeError;
    });

export type WorkflowPythonRuntimeRunStartResult =
  WorkflowPythonRuntimeBaseResult & {
    operation: "run_start";
    ok: true;
    status: "running";
    workflowId: string;
    run: WorkflowPythonRuntimeRun & { status: "running" };
  };

export type WorkflowPythonRuntimeNodeResultResult =
  WorkflowPythonRuntimeBaseResult & {
    operation: "node_result";
    ok: true;
    status: WorkflowPythonRuntimeNodeStatus;
    workflowId: string;
    runId: string;
    nodeResult: WorkflowPythonRuntimeNodeResult;
  };

export type WorkflowPythonRuntimeFailureResult =
  WorkflowPythonRuntimeBaseResult & {
    operation: "error";
    ok: false;
    status: WorkflowPythonRuntimeFailureStatus;
    workflowId: string;
    runId?: string;
    nodeId?: string;
    error: WorkflowPythonRuntimeError;
  };

export type WorkflowPythonRuntimeResult =
  | WorkflowPythonRuntimeGraphValidationResult
  | WorkflowPythonRuntimeRunStartResult
  | WorkflowPythonRuntimeNodeResultResult
  | WorkflowPythonRuntimeFailureResult;

const WORKFLOW_PYTHON_RUNTIME_OPERATIONS: readonly WorkflowPythonRuntimeOperation[] = [
  "graph_validation",
  "run_start",
  "node_result",
  "error",
];

const WORKFLOW_PYTHON_RUNTIME_NODE_STATUSES: readonly WorkflowPythonRuntimeNodeStatus[] = [
  "pending",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
  "skipped",
];

const WORKFLOW_PYTHON_RUNTIME_FAILURE_STATUSES: readonly WorkflowPythonRuntimeFailureStatus[] = [
  "failed",
  "cancelled",
];

export function validateWorkflowPythonRuntimeGraph(
  value: unknown,
): WorkflowPythonRuntimeGraphValidationResult {
  const graph = readWorkflowPythonRuntimeGraph(value);
  if (graph.ok) {
    return {
      contractVersion: WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
      runtime: "python-contract",
      operation: "graph_validation",
      ok: true,
      status: "validated",
      graph: graph.graph,
    };
  }

  return {
    contractVersion: WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
    runtime: "python-contract",
    operation: "graph_validation",
    ok: false,
    status: "failed",
    error: graph.error,
  };
}

export function isWorkflowPythonRuntimeResult(
  value: unknown,
): value is WorkflowPythonRuntimeResult {
  const record = workflowRuntimeAsRecord(value);
  if (!record) return false;
  if (record.contractVersion !== WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION) return false;
  if (record.runtime !== "python-contract") return false;
  if (!workflowRuntimeOneOf(record.operation, WORKFLOW_PYTHON_RUNTIME_OPERATIONS)) {
    return false;
  }

  if (record.operation === "graph_validation") {
    if (record.ok === true && record.status === "validated") {
      return readWorkflowPythonRuntimeGraph(record.graph).ok;
    }
    return (
      record.ok === false &&
      record.status === "failed" &&
      isWorkflowPythonRuntimeError(record.error)
    );
  }

  if (record.operation === "run_start") {
    if (record.ok !== true || record.status !== "running") return false;
    if (!workflowRuntimeNonEmptyString(record.workflowId)) return false;
    return isWorkflowPythonRuntimeRun(record.run, record.workflowId, "running");
  }

  if (record.operation === "node_result") {
    if (record.ok !== true) return false;
    if (!workflowRuntimeOneOf(record.status, WORKFLOW_PYTHON_RUNTIME_NODE_STATUSES)) {
      return false;
    }
    if (record.status === "failed" || record.status === "cancelled") return false;
    if (!workflowRuntimeNonEmptyString(record.workflowId)) return false;
    if (!workflowRuntimeNonEmptyString(record.runId)) return false;
    const nodeResult = workflowRuntimeAsRecord(record.nodeResult);
    if (!isWorkflowPythonRuntimeNodeResult(nodeResult)) return false;
    return nodeResult.status === record.status;
  }

  if (record.ok !== false) return false;
  if (!workflowRuntimeOneOf(record.status, WORKFLOW_PYTHON_RUNTIME_FAILURE_STATUSES)) {
    return false;
  }
  if (!workflowRuntimeNonEmptyString(record.workflowId)) return false;
  if (record.runId !== undefined && !workflowRuntimeNonEmptyString(record.runId)) return false;
  if (record.nodeId !== undefined && !workflowRuntimeNonEmptyString(record.nodeId)) return false;
  return isWorkflowPythonRuntimeError(record.error);
}

function readWorkflowPythonRuntimeGraph(
  value: unknown,
):
  | { ok: true; graph: WorkflowPythonRuntimeGraph }
  | { ok: false; error: WorkflowPythonRuntimeError } {
  const graph = workflowRuntimeAsRecord(value);
  if (!graph) {
    return graphValidationError("graph must be an object", "graph");
  }
  if (!workflowRuntimeNonEmptyString(graph.workflowId)) {
    return graphValidationError("graph.workflowId must be a non-empty string", "graph.workflowId");
  }
  if (!workflowRuntimeNonEmptyString(graph.entryNodeId)) {
    return graphValidationError("graph.entryNodeId must be a non-empty string", "graph.entryNodeId");
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return graphValidationError("graph.nodes must contain at least one node", "graph.nodes");
  }
  if (!Array.isArray(graph.edges)) {
    return graphValidationError("graph.edges must be an array", "graph.edges");
  }

  const nodeIds = new Set<string>();
  const nodes: WorkflowPythonRuntimeGraphNode[] = [];
  for (const [index, nodeValue] of graph.nodes.entries()) {
    const node = workflowRuntimeAsRecord(nodeValue);
    if (!node) {
      return graphValidationError("node must be an object", `graph.nodes[${index}]`);
    }
    if (!workflowRuntimeNonEmptyString(node.nodeId)) {
      return graphValidationError("node.nodeId must be a non-empty string", `graph.nodes[${index}].nodeId`);
    }
    if (nodeIds.has(node.nodeId)) {
      return graphValidationError("node.nodeId duplicates another node", `graph.nodes[${index}].nodeId`);
    }
    if (!workflowRuntimeNonEmptyString(node.type)) {
      return graphValidationError("node.type must be a non-empty string", `graph.nodes[${index}].type`);
    }
    if (!workflowRuntimeNonEmptyString(node.title)) {
      return graphValidationError("node.title must be a non-empty string", `graph.nodes[${index}].title`);
    }
    if (node.permission !== undefined && !isWorkflowPythonRuntimePermission(node.permission)) {
      return graphValidationError("node.permission must be a permission object", `graph.nodes[${index}].permission`);
    }
    nodeIds.add(node.nodeId);
    nodes.push(node as unknown as WorkflowPythonRuntimeGraphNode);
  }

  if (!nodeIds.has(graph.entryNodeId)) {
    return graphValidationError("graph.entryNodeId references unknown node", "graph.entryNodeId");
  }

  const edgeIds = new Set<string>();
  const edges: WorkflowPythonRuntimeGraphEdge[] = [];
  for (const [index, edgeValue] of graph.edges.entries()) {
    const edge = workflowRuntimeAsRecord(edgeValue);
    if (!edge) {
      return graphValidationError("edge must be an object", `graph.edges[${index}]`);
    }
    if (!workflowRuntimeNonEmptyString(edge.edgeId)) {
      return graphValidationError("edge.edgeId must be a non-empty string", `graph.edges[${index}].edgeId`);
    }
    if (edgeIds.has(edge.edgeId)) {
      return graphValidationError("edge.edgeId duplicates another edge", `graph.edges[${index}].edgeId`);
    }
    if (!workflowRuntimeNonEmptyString(edge.fromNodeId)) {
      return graphValidationError("edge.fromNodeId must be a non-empty string", `graph.edges[${index}].fromNodeId`);
    }
    if (!nodeIds.has(edge.fromNodeId)) {
      return graphValidationError("edge.fromNodeId references unknown node", `graph.edges[${index}].fromNodeId`);
    }
    if (!workflowRuntimeNonEmptyString(edge.toNodeId)) {
      return graphValidationError("edge.toNodeId must be a non-empty string", `graph.edges[${index}].toNodeId`);
    }
    if (!nodeIds.has(edge.toNodeId)) {
      return graphValidationError("edge.toNodeId references unknown node", `graph.edges[${index}].toNodeId`);
    }
    if (!workflowRuntimeOneOf(edge.kind, WEB_AIGC_EDGE_KINDS)) {
      return graphValidationError("edge.kind must be a known workflow edge kind", `graph.edges[${index}].kind`);
    }
    edgeIds.add(edge.edgeId);
    edges.push(edge as unknown as WorkflowPythonRuntimeGraphEdge);
  }

  return {
    ok: true,
    graph: {
      ...(graph as Record<string, unknown>),
      workflowId: graph.workflowId,
      entryNodeId: graph.entryNodeId,
      nodes,
      edges,
    } as WorkflowPythonRuntimeGraph,
  };
}

function graphValidationError(
  message: string,
  field: string,
): { ok: false; error: WorkflowPythonRuntimeError } {
  return {
    ok: false,
    error: {
      code: "graph_validation_failed",
      message,
      field,
    },
  };
}

function isWorkflowPythonRuntimePermission(
  value: unknown,
): value is WorkflowPythonRuntimeNodePermission {
  const permission = workflowRuntimeAsRecord(value);
  if (!permission) return false;
  if (typeof permission.required !== "boolean") return false;
  if (permission.guardId !== undefined && !workflowRuntimeNonEmptyString(permission.guardId)) {
    return false;
  }
  return true;
}

function isWorkflowPythonRuntimeRun(
  value: unknown,
  workflowId: unknown,
  expectedStatus?: WorkflowPythonRuntimeRun["status"],
): value is WorkflowPythonRuntimeRun {
  const run = workflowRuntimeAsRecord(value);
  if (!run) return false;
  if (!workflowRuntimeNonEmptyString(run.runId)) return false;
  if (run.workflowId !== workflowId) return false;
  if (
    run.status !== "running" &&
    run.status !== "done" &&
    run.status !== "failed" &&
    run.status !== "cancelled"
  ) {
    return false;
  }
  if (expectedStatus && run.status !== expectedStatus) return false;
  if (run.currentNodeId !== undefined && !workflowRuntimeNonEmptyString(run.currentNodeId)) {
    return false;
  }
  if (run.startedAt !== undefined && !workflowRuntimeNonEmptyString(run.startedAt)) return false;
  if (run.completedAt !== undefined && !workflowRuntimeNonEmptyString(run.completedAt)) return false;
  if (!Array.isArray(run.nodeResults) || !run.nodeResults.every(isWorkflowPythonRuntimeNodeResult)) {
    return false;
  }
  if (
    !Array.isArray(run.edgeTransitions) ||
    !run.edgeTransitions.every(isWorkflowPythonRuntimeNodeResultEdge)
  ) {
    return false;
  }
  return true;
}

function isWorkflowPythonRuntimeNodeResult(
  value: unknown,
): value is WorkflowPythonRuntimeNodeResult {
  const result = workflowRuntimeAsRecord(value);
  if (!result) return false;
  if (!workflowRuntimeNonEmptyString(result.nodeId)) return false;
  if (!workflowRuntimeOneOf(result.status, WORKFLOW_PYTHON_RUNTIME_NODE_STATUSES)) return false;
  if (typeof result.attempts !== "number" || !Number.isFinite(result.attempts) || result.attempts < 0) {
    return false;
  }
  if (result.startedAt !== undefined && !workflowRuntimeNonEmptyString(result.startedAt)) return false;
  if (result.completedAt !== undefined && !workflowRuntimeNonEmptyString(result.completedAt)) return false;
  if (result.output !== undefined && !workflowRuntimeAsRecord(result.output)) return false;
  if (result.edge !== undefined && !isWorkflowPythonRuntimeNodeResultEdge(result.edge)) return false;
  if (result.error !== undefined && !isWorkflowPythonRuntimeError(result.error)) return false;
  return true;
}

function isWorkflowPythonRuntimeNodeResultEdge(
  value: unknown,
): value is WorkflowPythonRuntimeNodeResultEdge {
  const edge = workflowRuntimeAsRecord(value);
  if (!edge) return false;
  if (!workflowRuntimeNonEmptyString(edge.edgeId)) return false;
  if (!workflowRuntimeNonEmptyString(edge.fromNodeId)) return false;
  if (!workflowRuntimeNonEmptyString(edge.toNodeId)) return false;
  if (edge.status !== "known" && edge.status !== "traversed" && edge.status !== "blocked") {
    return false;
  }
  if (edge.kind !== undefined && !workflowRuntimeOneOf(edge.kind, WEB_AIGC_EDGE_KINDS)) {
    return false;
  }
  return true;
}

function isWorkflowPythonRuntimeError(value: unknown): value is WorkflowPythonRuntimeError {
  const error = workflowRuntimeAsRecord(value);
  if (!error) return false;
  if (!workflowRuntimeNonEmptyString(error.code)) return false;
  if (!workflowRuntimeNonEmptyString(error.message)) return false;
  if (error.field !== undefined && !workflowRuntimeNonEmptyString(error.field)) return false;
  if (error.retryable !== undefined && typeof error.retryable !== "boolean") return false;
  return true;
}

function workflowRuntimeAsRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function workflowRuntimeNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function workflowRuntimeOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && options.includes(value as T);
}
