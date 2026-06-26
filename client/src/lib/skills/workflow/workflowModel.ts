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
  /** approval node: 或签(any) / 会签(all). */
  approvalMode?: "any" | "all";
  /** branch node: the field whose value selects the outgoing edge. */
  field?: string;
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
  /** the fields this process operates on, so branch conditions can be checked. */
  fields: FieldDecl[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
