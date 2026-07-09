// Workflow metamodel — distilled from rbac-system-pc's workflow tables, runtime stripped:
//   workflow_flow_templates (flow_schema), workflow_process_configs, workflow_tasks
//   (node_type, assignee_type, assignee_id), workflow_branch_conditions,
//   workflow_parallel_executions, simulation_path_coverage.
// Pure data. The HARD skill: its validator checks EXECUTION SEMANTICS (reachability,
// termination, branch coverage), not just static references.

export type NodeType = "start" | "approval" | "branch" | "end";

export type CompareOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface FieldDecl {
  key: string;
  type: "string" | "number" | "boolean" | "enum";
  enumValues?: string[];
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  /** approval node: CROSS-SKILL reference to an RBAC role id (workflow ←→ rbac). */
  assigneeRole?: string;
  /** V2 PEP mirror: typed RBAC role ref for PDP delegation (keeps backward compat with assigneeRole). */
  assigneeRoleRef?: string;
  /** approval node: 或签(any) / 会签(all) / 顺序(sequential) / 百分比(percentage). */
  approvalMode?: "any" | "all" | "sequential" | "percentage";
  /** branch node: the (local) field key used for branch coverage execution semantics. */
  field?: string;
  /** V2 REQUIRED: DataModel SSOT binding as entity.field ref. Workflow form/branch fields must bind to SSOT instead of owning local field definitions. Local field schema decisions are quarantined to internal coverage analysis only. */
  fieldRef?: string;
  /** V2 115 timeout action model (runtime-less): duration (positive int, e.g. minutes), timeout target node, escalation role, auto action metadata. */
  timeoutDuration?: number;
  /** timeout target node id for automatic transition on timeout. */
  timeoutTarget?: string;
  /** escalation role ref for timeout handling (cross-skill to rbac, like assignee). */
  escalationRoleRef?: string;
  /** automatic action to take on timeout. */
  autoAction?: "escalate" | "approve" | "reject" | "notify";
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  /** on a branch node, the case this edge handles, e.g. { op: "==", value: true }. */
  when?: { op: CompareOp; value: string | number | boolean };
  /** the else-edge of a branch; taken when no `when` matches. */
  isDefault?: boolean;
  /** V2 115: marks this as a timeout transition edge for automatic action projection. */
  isTimeout?: boolean;
}

export interface WorkflowModel {
  id: string;
  name: string;
  /** V2 PEP marker: Workflow declares itself as PEP execution point (delegates actor/perms to PDP, fields to SSOT). */
  pep?: "pep";
  /** V2 PEP: actor role ref delegated to RBAC PDP (does not own auth). */
  actorRoleRef?: string;
  /** V2 PEP: policy check refs delegated to RBAC PDP. */
  policyCheckRefs?: string[];
  /** V2 PEP: form/branch field refs bound to DataModel SSOT. REQUIRED: local form fields must bind here (entity.field) instead of owning definitions. */
  fieldRefs?: string[];
  /** optional trace span for PEP execution. */
  traceSpan?: string;
  /** V2 115.30: process version frozen by instance snapshots at start time. */
  version?: string;
  /** V2 115.30: only published workflow versions may be snapshotted by instances. */
  published?: boolean;
  /** local decls (keys + type/enum) quarantined strictly for branch coverage path-semantics gate (exec analysis). Field schema authority is DataModel SSOT via fieldRefs binding. */
  fields: FieldDecl[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** V2 115.30: Workflow instance snapshot — freezes process version + form field refs + initial variables at start time.
 * Pure data model. Snapshots must reference a published workflow version.
 */
export interface WorkflowInstanceSnapshot {
  id: string;
  workflowId: string;
  /** frozen process version (from the workflow definition at start) */
  processVersion: string;
  /** must be true: snapshots only valid for published versions */
  versionPublished: boolean;
  /** frozen copy of form field refs (model.fieldRefs) at instantiation */
  frozenFormFieldRefs: string[];
  /** snapshot of caller-provided initial variables at start (pure data) */
  initialVariables: Record<string, unknown>;
}

/** V2 117: pure runtime instance state (snapshot-backed, no side effects). */
export interface WorkflowInstance {
  id: string;
  snapshot: WorkflowInstanceSnapshot;
  currentNodeId: string;
  status: "running" | "completed" | "rejected";
  variables: Record<string, unknown>;
}

/** V2 117: commands for transitionWorkflowInstance. */
export interface WorkflowTransitionCommand {
  type: "approve" | "reject" | "submit" | "timeout";
  variables?: Record<string, unknown>;
}

/** V2 117 runtime: form field binding result for task forms at runtime (DataModel lifecycle + RBAC field PDP state). */
export interface WorkflowFormField {
  ref: string;
  lifecycle?: string;
  pdpState: string;
  editable: boolean;
}

export interface WorkflowFormRuntime {
  formFieldRefs: string[];
  fields: WorkflowFormField[];
  findings: Array<{ code: string; severity: string; path: string; message: string }>;
}
