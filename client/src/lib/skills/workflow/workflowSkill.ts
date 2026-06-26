import {
  finalizeReport,
  type CrossRefEdge,
  type CrossSkill,
  type Finding,
  type Projection,
  type ResolvableSurface,
  type Skill,
  type ValidateContext,
} from "../skill";
import type { WorkflowEdge, WorkflowModel, WorkflowNode } from "./workflowModel";

// ---------------------------------------------------------------------------
// Graph helpers — this is where "the hard skill" lives: execution semantics.
// ---------------------------------------------------------------------------

function outAdjacency(model: WorkflowModel): Map<string, WorkflowEdge[]> {
  const m = new Map<string, WorkflowEdge[]>();
  for (const n of model.nodes) m.set(n.id, []);
  for (const e of model.edges) m.get(e.from)?.push(e);
  return m;
}

/** Nodes reachable from `start` following out-edges. */
function reachableFrom(start: string, adj: Map<string, WorkflowEdge[]>): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of adj.get(cur) ?? []) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

/** Set of nodes from which SOME end node is reachable (termination analysis). */
function canReachEnd(model: WorkflowModel, adj: Map<string, WorkflowEdge[]>): Set<string> {
  const endIds = new Set(model.nodes.filter(n => n.type === "end").map(n => n.id));
  // reverse adjacency
  const rev = new Map<string, string[]>();
  for (const n of model.nodes) rev.set(n.id, []);
  for (const [from, edges] of adj) for (const e of edges) rev.get(e.to)?.push(from);
  const seen = new Set<string>(endIds);
  const stack = [...endIds];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const prev of rev.get(cur) ?? []) {
      if (!seen.has(prev)) {
        seen.add(prev);
        stack.push(prev);
      }
    }
  }
  return seen;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// The skill
// ---------------------------------------------------------------------------

export const workflowSkill: Skill<WorkflowModel> & CrossSkill<WorkflowModel> = {
  id: "workflow",
  title: "工作流",

  // -- CROSS-SKILL declarations --------------------------------------------
  crossRefs(model: WorkflowModel): CrossRefEdge[] {
    const refs: CrossRefEdge[] = [];
    // every approval node points OUT at an RBAC role (workflow ←→ rbac) — cross uses assigneeRole for compatibility with existing ref tests
    model.nodes
      .filter(n => n.type === "approval" && n.assigneeRole)
      .forEach(n => {
        refs.push({
          fromNode: `wf_${sanitizeId(n.id)}`,
          toSkill: "rbac",
          toKind: "role",
          toValue: n.assigneeRole!,
          label: "审批人",
        });
      });
    // branch/form nodes bind fields to DataModel SSOT (PEP delegation)
    model.nodes
      .filter(n => n.type === "branch" && n.fieldRef)
      .forEach(n => {
        refs.push({
          fromNode: `wf_${sanitizeId(n.id)}`,
          toSkill: "datamodel",
          toKind: "field",
          toValue: n.fieldRef!,
          label: "字段",
        });
      });
    // model-level fieldRefs also declare DataModel SSOT binding for PEP
    (model.fieldRefs || []).forEach(fr => {
      const wfRoot = `wf_${sanitizeId(model.id)}`;
      const alreadyFromBranch = refs.some(r => r.toSkill === "datamodel" && r.toValue === fr);
      if (!alreadyFromBranch) {
        refs.push({
          fromNode: wfRoot,
          toSkill: "datamodel",
          toKind: "field",
          toValue: fr,
          label: "SSOT字段",
        });
      }
    });
    return refs;
  },
  refNodeId(kind: string, value: string): string | null {
    if (kind === "workflow") return `wf_${sanitizeId(value)}`;
    // other skills may reference a workflow node by id.
    return kind === "node" ? `wf_${sanitizeId(value)}` : null;
  },

  // -- THE GATE (execution semantics, not just refs) -----------------------
  validate(model: WorkflowModel, ctx?: ValidateContext): ReturnType<Skill<WorkflowModel>["validate"]> {
    const f: Finding[] = [];
    const nodeIds = new Set(model.nodes.map(n => n.id));
    const fieldKeys = new Set(model.fields.map(fl => fl.key));
    const byId = new Map(model.nodes.map(n => [n.id, n]));

    // 1) Structural ---------------------------------------------------------
    const starts = model.nodes.filter(n => n.type === "start");
    const ends = model.nodes.filter(n => n.type === "end");
    if (starts.length === 0)
      f.push({ code: "WF_NO_START", severity: "error", path: "nodes", message: "流程缺少开始节点" });
    if (starts.length > 1)
      f.push({ code: "WF_MULTI_START", severity: "error", path: "nodes", message: `流程有多个开始节点：${starts.map(s => s.id).join(", ")}` });
    if (ends.length === 0)
      f.push({ code: "WF_NO_END", severity: "error", path: "nodes", message: "流程缺少结束节点" });

    model.edges.forEach(e => {
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to))
        f.push({
          code: "WF_DANGLING_EDGE",
          severity: "error",
          path: `edges[${e.id}]`,
          message: `连线 ${e.id} 的端点不存在：${e.from} → ${e.to}`,
        });
    });

    const adj = outAdjacency(model);
    model.nodes.forEach(n => {
      const outs = adj.get(n.id) ?? [];
      if (n.type === "end" && outs.length > 0)
        f.push({ code: "WF_END_HAS_OUTGOING", severity: "error", path: `nodes[${n.id}]`, message: `结束节点「${n.name}」不应有出边` });
      if (n.type !== "end" && outs.length === 0)
        f.push({ code: "WF_DEAD_END", severity: "error", path: `nodes[${n.id}]`, message: `节点「${n.name}」没有出边,流程会卡死` });
    });

    // 2) Reachability + termination ----------------------------------------
    if (starts.length === 1) {
      const reach = reachableFrom(starts[0].id, adj);
      model.nodes.forEach(n => {
        if (!reach.has(n.id))
          f.push({ code: "WF_UNREACHABLE_NODE", severity: "error", path: `nodes[${n.id}]`, message: `节点「${n.name}」从开始节点不可达` });
      });
      if (!ends.some(e => reach.has(e.id)))
        f.push({ code: "WF_END_UNREACHABLE", severity: "error", path: "nodes", message: "从开始节点走不到任何结束节点" });

      const terminating = canReachEnd(model, adj);
      model.nodes.forEach(n => {
        if (n.type !== "end" && reach.has(n.id) && !terminating.has(n.id))
          f.push({ code: "WF_NON_TERMINATING", severity: "error", path: `nodes[${n.id}]`, message: `节点「${n.name}」无论怎么走都到不了结束节点(死循环/断头)` });
      });
    }

    // 3) Branch coverage (the path-coverage gate) --------------------------
    model.nodes.filter(n => n.type === "branch").forEach(branch => {
      const outs = adj.get(branch.id) ?? [];
      if (!branch.field) {
        f.push({ code: "WF_BRANCH_NO_FIELD", severity: "error", path: `nodes[${branch.id}]`, message: `分支「${branch.name}」未指定判断字段` });
        return;
      }
      if (!fieldKeys.has(branch.field))
        f.push({ code: "WF_REF_MISSING_FIELD", severity: "error", path: `nodes[${branch.id}].field`, message: `分支「${branch.name}」引用了不存在的字段：${branch.field}` });

      const defaults = outs.filter(e => e.isDefault);
      const conditional = outs.filter(e => e.when);
      const bare = outs.filter(e => !e.isDefault && !e.when);
      bare.forEach(e =>
        f.push({ code: "WF_BRANCH_UNCONDITIONAL_EDGE", severity: "error", path: `edges[${e.id}]`, message: `分支「${branch.name}」的出边 ${e.id} 既无条件也非默认,路由不确定` }),
      );
      if (defaults.length > 1)
        f.push({ code: "WF_BRANCH_MULTI_DEFAULT", severity: "error", path: `nodes[${branch.id}]`, message: `分支「${branch.name}」有多个默认分支` });

      const fieldDecl = model.fields.find(fl => fl.key === branch.field);
      if (fieldDecl?.type === "enum") {
        // exhaustive iff every enum value is covered by an equality edge, OR a default exists
        const covered = new Set(conditional.filter(e => e.when?.op === "==").map(e => String(e.when!.value)));
        const missing = (fieldDecl.enumValues ?? []).filter(v => !covered.has(v));
        if (missing.length > 0 && defaults.length === 0)
          f.push({ code: "WF_BRANCH_NOT_EXHAUSTIVE", severity: "error", path: `nodes[${branch.id}]`, message: `分支「${branch.name}」未覆盖取值 [${missing.join(", ")}] 且无默认分支,这些情况会卡死` });
        // bonus: enum value typo
        conditional.forEach(e => {
          if (e.when?.op === "==" && !(fieldDecl.enumValues ?? []).includes(String(e.when.value)))
            f.push({ code: "WF_BAD_ENUM_VALUE", severity: "warning", path: `edges[${e.id}]`, message: `分支条件值 "${e.when.value}" 不在字段「${branch.field}」的枚举范围内` });
        });
      } else {
        // non-enumerable field MUST have a default, else some value matches nothing → stuck
        if (defaults.length === 0)
          f.push({ code: "WF_BRANCH_NO_DEFAULT", severity: "error", path: `nodes[${branch.id}]`, message: `分支「${branch.name}」判断的是非枚举字段,必须有默认分支兜底,否则未匹配的取值会卡死` });
      }
    });

    // 4) Approval assignee — CROSS-SKILL to RBAC ---------------------------
    const rbacRoles = ctx?.external?.rbac?.role;
    model.nodes.filter(n => n.type === "approval").forEach(node => {
      if (!node.assigneeRole) {
        f.push({ code: "WF_APPROVAL_NO_ASSIGNEE", severity: "error", path: `nodes[${node.id}]`, message: `审批节点「${node.name}」没有指定审批人角色` });
        return;
      }
      if (rbacRoles === undefined) {
        f.push({ code: "WF_ASSIGNEE_UNRESOLVED", severity: "warning", path: `nodes[${node.id}].assigneeRole`, message: `审批节点「${node.name}」的审批人角色「${node.assigneeRole}」未接入 RBAC 能力面,无法校验` });
      } else if (!rbacRoles.includes(node.assigneeRole)) {
        f.push({ code: "WF_ASSIGNEE_MISSING_ROLE", severity: "error", path: `nodes[${node.id}].assigneeRole`, message: `审批节点「${node.name}」指定的审批人角色在 RBAC 中不存在：${node.assigneeRole}` });
      }
    });

    // 5) PEP delegation guard: Workflow is PEP only; approvals/policy must delegate to RBAC PDP (never local auth)
    const hasApprovals = model.nodes.some(n => n.type === "approval");
    if (hasApprovals) {
      if (!model.pep) {
        f.push({ code: "WF_PEP_BYPASS", severity: "error", path: "pep", message: "工作流包含审批节点但未声明 pep 委托标记，会导致本地授权而绕过 PDP" });
      }
      if (!model.actorRoleRef) {
        f.push({ code: "WF_PEP_BYPASS", severity: "error", path: "actorRoleRef", message: "工作流包含审批节点但未声明 actorRoleRef 委托给 RBAC PDP" });
      }
      if (!model.policyCheckRefs || model.policyCheckRefs.length === 0) {
        f.push({ code: "WF_PEP_BYPASS", severity: "error", path: "policyCheckRefs", message: "工作流包含审批节点但未声明 policyCheckRefs，会在本地而非 PDP 执行权限检查" });
      }
    }

    // 6) DataModel SSOT bindings for declared fieldRefs (branch/form fields); do not silently accept when refs declared
    const dmFields = ctx?.external?.datamodel?.field;
    (model.fieldRefs || []).forEach((fr, i) => {
      if (dmFields === undefined) {
        f.push({ code: "WF_FIELD_UNRESOLVED", severity: "warning", path: `fieldRefs[${i}]`, message: `Workflow fieldRef「${fr}」未接入 DataModel 能力面,无法校验` });
      } else if (!dmFields.includes(fr)) {
        f.push({ code: "WF_SSOT_MISSING_FIELD", severity: "error", path: `fieldRefs[${i}]`, message: `Workflow fieldRef 引用了 DataModel 中不存在的 SSOT 字段：${fr}` });
      }
    });
    model.nodes.filter(n => n.type === "branch" && n.fieldRef).forEach(node => {
      if (dmFields === undefined) {
        f.push({ code: "WF_FIELD_UNRESOLVED", severity: "warning", path: `nodes[${node.id}].fieldRef`, message: `分支「${node.name}」的 fieldRef 未接入 DataModel 能力面,无法校验` });
      } else if (!dmFields.includes(node.fieldRef!)) {
        f.push({ code: "WF_SSOT_MISSING_FIELD", severity: "error", path: `nodes[${node.id}].fieldRef`, message: `分支「${node.name}」引用了不存在的 DataModel SSOT 字段：${node.fieldRef}` });
      }
    });

    void byId; // (kept for future per-node lookups)
    return finalizeReport(f);
  },

  // -- THE PROJECTOR -------------------------------------------------------
  project(model: WorkflowModel): Projection {
    const shape = (n: WorkflowNode): [string, string] => {
      const id = `wf_${sanitizeId(n.id)}`;
      let label = n.name;
      if (n.type === "approval") {
        const role = n.assigneeRoleRef || n.assigneeRole;
        if (role) label = `${n.name}<br/>@${role}`;
      } else if (n.type === "branch") {
        const fref = n.fieldRef || n.field;
        if (fref) label = `${n.name}<br/>${fref}`;
      }
      switch (n.type) {
        case "start":
        case "end":
          return [id, `${id}(["${label}"])`];
        case "branch":
          return [id, `${id}{"${label}"}`];
        default:
          return [id, `${id}["${label}"]`];
      }
    };
    const idOf = new Map(model.nodes.map(n => [n.id, `wf_${sanitizeId(n.id)}`]));
    const workflowId = `wf_${sanitizeId(model.id)}`;
    const startNodes = model.nodes.filter(n => n.type === "start");
    const nodes = [
      { id: workflowId, label: model.name, kind: "workflow" },
      ...model.nodes.map(n => ({ id: idOf.get(n.id)!, label: n.name, kind: n.type })),
    ];
    const edges = [
      ...startNodes.map(n => ({
        from: workflowId,
        to: idOf.get(n.id) ?? `wf_${sanitizeId(n.id)}`,
        label: "entry",
        kind: "workflow",
      })),
      ...model.edges.map(e => ({
        from: idOf.get(e.from) ?? `wf_${sanitizeId(e.from)}`,
        to: idOf.get(e.to) ?? `wf_${sanitizeId(e.to)}`,
        label: e.isDefault ? "默认" : e.when ? `${e.when.op}${e.when.value}` : "",
        kind: "flow",
      })),
    ];

    const lines: string[] = ["flowchart TD"];
    lines.push(`  ${workflowId}["${model.name}"]`);
    for (const n of model.nodes) lines.push(`  ${shape(n)[1]}`);
    for (const e of edges) lines.push(`  ${e.from} -->${e.label ? `|${e.label}|` : ""} ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  // -- CROSS-SKILL SURFACE -------------------------------------------------
  resolve(model: WorkflowModel): ResolvableSurface {
    return {
      workflow: [model.id],
      node: model.nodes.map(n => n.id),
    };
  },

  async generate(intent: string): Promise<WorkflowModel> {
    if (/请假|leave|审批/i.test(intent)) return leaveApprovalWorkflow;
    throw new Error(`workflowSkill.generate: 需要接入推演引擎来为意图生成流程：「${intent}」`);
  },
};

// ---------------------------------------------------------------------------
// Worked example — the "请假审批" flow, designed to reference the RBAC sample's roles.
//   start → 主管审批(@manager) → 审批结果? → 通过 / 驳回
// ---------------------------------------------------------------------------

export const leaveApprovalWorkflow: WorkflowModel = {
  id: "wf_leave_approval",
  name: "请假审批流程",
  pep: "pep",
  actorRoleRef: "employee",
  policyCheckRefs: ["leave:approve"],
  fieldRefs: ["leave_request.approved"],
  traceSpan: "wf.leave.approval",
  fields: [{ key: "approved", type: "boolean" }],
  nodes: [
    { id: "s", type: "start", name: "发起请假" },
    { id: "a_mgr", type: "approval", name: "主管审批", assigneeRole: "manager", assigneeRoleRef: "manager", approvalMode: "any" },
    { id: "b", type: "branch", name: "审批结果", field: "approved", fieldRef: "leave_request.approved" },
    { id: "e_ok", type: "end", name: "通过" },
    { id: "e_no", type: "end", name: "驳回" },
  ],
  edges: [
    { id: "t1", from: "s", to: "a_mgr" },
    { id: "t2", from: "a_mgr", to: "b" },
    { id: "t3", from: "b", to: "e_ok", when: { op: "==", value: true } },
    { id: "t4", from: "b", to: "e_no", isDefault: true },
  ],
};
