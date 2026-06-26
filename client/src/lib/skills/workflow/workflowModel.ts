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
  /** approval node: 或签(any) / 会签(all). */
  approvalMode?: "any" | "all";
  /** branch node: the field whose value selects the outgoing edge. */
  field?: string;
  /** V2: DataModel SSOT field ref (preferred over plain local for form/branch binding in PEP). */
  fieldRef?: string;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  /** on a branch node, the case this edge handles, e.g. { op: "==", value: true }. */
  when?: { op: CompareOp; value: string | number | boolean };
  /** the else-edge of a branch; taken when no `when` matches. */
  isDefault?: boolean;
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
  /** V2 PEP: form/branch field refs bound to DataModel SSOT. */
  fieldRefs?: string[];
  /** optional trace span for PEP execution. */
  traceSpan?: string;
  /** the fields this process operates on, so branch conditions can be checked. (local keys kept for exec semantics) */
  fields: FieldDecl[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
