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
import type {
  WorkflowEdge,
  WorkflowFormRuntime,
  WorkflowInstance,
  WorkflowInstanceSnapshot,
  WorkflowModel,
  WorkflowNode,
  WorkflowTransitionCommand,
} from "./workflowModel";
import { getFieldLifecycle } from "../datamodel/dataModelSkill";
import { decideRbacPolicy } from "../rbac/rbacSkill";
import type { PolicyDecision } from "../rbac/rbacModel";
import type { PageModel } from "../page/pageModel";
import {
  PAGE_WORKFLOW_TASK_VIEW_INVALID,
  projectWorkflowTaskView,
} from "../page/pageSkill";

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
function reachableFrom(
  start: string,
  adj: Map<string, WorkflowEdge[]>
): Set<string> {
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
function canReachEnd(
  model: WorkflowModel,
  adj: Map<string, WorkflowEdge[]>
): Set<string> {
  const endIds = new Set(
    model.nodes.filter(n => n.type === "end").map(n => n.id)
  );
  // reverse adjacency
  const rev = new Map<string, string[]>();
  for (const n of model.nodes) rev.set(n.id, []);
  for (const [from, edges] of adj)
    for (const e of edges) rev.get(e.to)?.push(from);
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
      .filter(n => n.type === "approval" && n.assigneeRoleRef)
      .forEach(n => {
        refs.push({
          fromNode: `wf_${sanitizeId(n.id)}`,
          toSkill: "rbac",
          toKind: "role",
          toValue: n.assigneeRoleRef!,
          label: "审批人",
        });
      });
    // V2 115: escalationRoleRef for timeout also cross to RBAC
    model.nodes
      .filter(n => n.escalationRoleRef)
      .forEach(n => {
        refs.push({
          fromNode: `wf_${sanitizeId(n.id)}`,
          toSkill: "rbac",
          toKind: "role",
          toValue: n.escalationRoleRef!,
          label: "超时升级",
        });
      });
    // branch/form nodes bind fields to DataModel SSOT (PEP delegation) -- fieldRef is now required
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
      const alreadyFromBranch = refs.some(
        r => r.toSkill === "datamodel" && r.toValue === fr
      );
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
    if (kind === "version") return `wf_${sanitizeId(value)}_ver`;
    // other skills may reference a workflow node by id.
    return kind === "node" ? `wf_${sanitizeId(value)}` : null;
  },

  // -- THE GATE (execution semantics, not just refs) -----------------------
  validate(
    model: WorkflowModel,
    ctx?: ValidateContext
  ): ReturnType<Skill<WorkflowModel>["validate"]> {
    const f: Finding[] = [];
    const nodeIds = new Set(model.nodes.map(n => n.id));
    const fieldKeys = new Set(model.fields.map(fl => fl.key));
    const byId = new Map(model.nodes.map(n => [n.id, n]));

    // 1) Structural ---------------------------------------------------------
    const starts = model.nodes.filter(n => n.type === "start");
    const ends = model.nodes.filter(n => n.type === "end");
    if (starts.length === 0)
      f.push({
        code: "WF_NO_START",
        severity: "error",
        path: "nodes",
        message: "流程缺少开始节点",
      });
    if (starts.length > 1)
      f.push({
        code: "WF_MULTI_START",
        severity: "error",
        path: "nodes",
        message: `流程有多个开始节点：${starts.map(s => s.id).join(", ")}`,
      });
    if (ends.length === 0)
      f.push({
        code: "WF_NO_END",
        severity: "error",
        path: "nodes",
        message: "流程缺少结束节点",
      });

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
        f.push({
          code: "WF_END_HAS_OUTGOING",
          severity: "error",
          path: `nodes[${n.id}]`,
          message: `结束节点「${n.name}」不应有出边`,
        });
      if (n.type !== "end" && outs.length === 0)
        f.push({
          code: "WF_DEAD_END",
          severity: "error",
          path: `nodes[${n.id}]`,
          message: `节点「${n.name}」没有出边,流程会卡死`,
        });
    });

    // 2) Reachability + termination ----------------------------------------
    if (starts.length === 1) {
      const reach = reachableFrom(starts[0].id, adj);
      model.nodes.forEach(n => {
        if (!reach.has(n.id))
          f.push({
            code: "WF_UNREACHABLE_NODE",
            severity: "error",
            path: `nodes[${n.id}]`,
            message: `节点「${n.name}」从开始节点不可达`,
          });
      });
      if (!ends.some(e => reach.has(e.id)))
        f.push({
          code: "WF_END_UNREACHABLE",
          severity: "error",
          path: "nodes",
          message: "从开始节点走不到任何结束节点",
        });

      const terminating = canReachEnd(model, adj);
      model.nodes.forEach(n => {
        if (n.type !== "end" && reach.has(n.id) && !terminating.has(n.id))
          f.push({
            code: "WF_NON_TERMINATING",
            severity: "error",
            path: `nodes[${n.id}]`,
            message: `节点「${n.name}」无论怎么走都到不了结束节点(死循环/断头)`,
          });
      });
    }

    // 3) Branch coverage (the path-coverage gate) --------------------------
    // NOTE: local model.fields FieldDecl (type/enumValues) drive coverage only for exec path analysis.
    // Local field-schema semantics are quarantined; form/branch fields must bind to DataModel SSOT via fieldRef.
    model.nodes
      .filter(n => n.type === "branch")
      .forEach(branch => {
        const outs = adj.get(branch.id) ?? [];
        const effField =
          branch.field ||
          (branch.fieldRef ? branch.fieldRef.split(".").pop() : undefined);
        if (!effField) {
          f.push({
            code: "WF_BRANCH_NO_FIELD",
            severity: "error",
            path: `nodes[${branch.id}]`,
            message: `分支「${branch.name}」未指定判断字段`,
          });
          return;
        }
        // SSOT binding gate (required, not optional): must declare fieldRef; cannot rely on local field only
        if (!branch.fieldRef) {
          f.push({
            code: "WF_SSOT_BINDING_REQUIRED",
            severity: "error",
            path: `nodes[${branch.id}].fieldRef`,
            message: `分支「${branch.name}」必须声明 fieldRef 绑定到 DataModel SSOT 字段（entity.field），表单字段不能继续拥有本地字段定义`,
          });
        }
        if (!fieldKeys.has(effField))
          f.push({
            code: "WF_REF_MISSING_FIELD",
            severity: "error",
            path: `nodes[${branch.id}].field`,
            message: `分支「${branch.name}」引用了不存在的字段：${effField}`,
          });

        const defaults = outs.filter(e => e.isDefault);
        const conditional = outs.filter(e => e.when);
        const bare = outs.filter(e => !e.isDefault && !e.when);
        bare.forEach(e =>
          f.push({
            code: "WF_BRANCH_UNCONDITIONAL_EDGE",
            severity: "error",
            path: `edges[${e.id}]`,
            message: `分支「${branch.name}」的出边 ${e.id} 既无条件也非默认,路由不确定`,
          })
        );
        if (defaults.length > 1)
          f.push({
            code: "WF_BRANCH_MULTI_DEFAULT",
            severity: "error",
            path: `nodes[${branch.id}]`,
            message: `分支「${branch.name}」有多个默认分支`,
          });

        const fieldDecl = model.fields.find(fl => fl.key === effField);
        if (fieldDecl?.type === "enum") {
          // exhaustive iff every enum value is covered by an equality edge, OR a default exists
          const covered = new Set(
            conditional
              .filter(e => e.when?.op === "==")
              .map(e => String(e.when!.value))
          );
          const missing = (fieldDecl.enumValues ?? []).filter(
            v => !covered.has(v)
          );
          if (missing.length > 0 && defaults.length === 0)
            f.push({
              code: "WF_BRANCH_NOT_EXHAUSTIVE",
              severity: "error",
              path: `nodes[${branch.id}]`,
              message: `分支「${branch.name}」未覆盖取值 [${missing.join(", ")}] 且无默认分支,这些情况会卡死`,
            });
          // bonus: enum value typo
          conditional.forEach(e => {
            if (
              e.when?.op === "==" &&
              !(fieldDecl.enumValues ?? []).includes(String(e.when.value))
            )
              f.push({
                code: "WF_BAD_ENUM_VALUE",
                severity: "warning",
                path: `edges[${e.id}]`,
                message: `分支条件值 "${e.when.value}" 不在字段「${effField}」的枚举范围内`,
              });
          });
        } else {
          // non-enumerable field MUST have a default, else some value matches nothing → stuck
          if (defaults.length === 0)
            f.push({
              code: "WF_BRANCH_NO_DEFAULT",
              severity: "error",
              path: `nodes[${branch.id}]`,
              message: `分支「${branch.name}」判断的是非枚举字段,必须有默认分支兜底,否则未匹配的取值会卡死`,
            });
        }
      });

    // 4) Approval assignee — CROSS-SKILL to RBAC ---------------------------
    const rbacRoles = ctx?.external?.rbac?.role;
    model.nodes
      .filter(n => n.type === "approval")
      .forEach(node => {
        const am = node.approvalMode;
        if (
          am != null &&
          !["any", "all", "sequential", "percentage"].includes(am)
        ) {
          f.push({
            code: "WF_APPROVAL_INVALID_MODE",
            severity: "error",
            path: `nodes[${node.id}].approvalMode`,
            message: `审批节点「${node.name}」的 approvalMode 无效：${am}，仅支持 any/all/sequential/percentage`,
          });
        }
        if (am === "percentage") {
          const th = (node as any).threshold;
          if (
            th == null ||
            typeof th !== "number" ||
            !Number.isFinite(th) ||
            !Number.isInteger(th) ||
            th < 1 ||
            th > 100
          ) {
            f.push({
              code: "WF_APPROVAL_INVALID_THRESHOLD",
              severity: "error",
              path: `nodes[${node.id}].threshold`,
              message: `审批节点「${node.name}」的 approvalMode 为 percentage 时必须设置 1~100 的整数 threshold`,
            });
          }
        }
        if (!node.assigneeRole && !node.assigneeRoleRef) {
          f.push({
            code: "WF_APPROVAL_NO_ASSIGNEE",
            severity: "error",
            path: `nodes[${node.id}]`,
            message: `审批节点「${node.name}」没有指定审批人角色`,
          });
          return;
        }
        if (!node.assigneeRoleRef) {
          f.push({
            code: "WF_ASSIGNEE_ROLE_REF_REQUIRED",
            severity: "error",
            path: `nodes[${node.id}].assigneeRoleRef`,
            message: `approval node must use assigneeRoleRef for RBAC PDP delegation`,
          });
          return;
        }
        if (rbacRoles === undefined) {
          f.push({
            code: "WF_ASSIGNEE_UNRESOLVED",
            severity: "warning",
            path: `nodes[${node.id}].assigneeRoleRef`,
            message: `审批节点「${node.name}」的审批人角色「${node.assigneeRoleRef}」未接入 RBAC 能力面,无法校验`,
          });
        } else if (!rbacRoles.includes(node.assigneeRoleRef)) {
          f.push({
            code: "WF_ASSIGNEE_MISSING_ROLE",
            severity: "error",
            path: `nodes[${node.id}].assigneeRoleRef`,
            message: `审批节点「${node.name}」指定的审批人角色在 RBAC 中不存在：${node.assigneeRoleRef}`,
          });
        }
      });

    // 5) Timeout action model validation (V2 115, runtime-less) ---------------
    model.nodes.forEach(node => {
      const td = (node as any).timeoutDuration;
      if (td != null) {
        if (
          typeof td !== "number" ||
          !Number.isFinite(td) ||
          td <= 0 ||
          !Number.isInteger(td)
        ) {
          f.push({
            code: "WF_TIMEOUT_INVALID_DURATION",
            severity: "error",
            path: `nodes[${node.id}].timeoutDuration`,
            message: `节点「${node.name}」的 timeoutDuration 必须是正整数`,
          });
        }
        const tgt = (node as any).timeoutTarget;
        if (tgt != null) {
          if (typeof tgt !== "string" || !nodeIds.has(tgt)) {
            f.push({
              code: "WF_TIMEOUT_INVALID_TARGET",
              severity: "error",
              path: `nodes[${node.id}].timeoutTarget`,
              message: `节点「${node.name}」的 timeoutTarget 指向不存在的节点：${tgt}`,
            });
          } else if (tgt === node.id) {
            f.push({
              code: "WF_TIMEOUT_SELF_TARGET",
              severity: "error",
              path: `nodes[${node.id}].timeoutTarget`,
              message: `节点「${node.name}」的 timeoutTarget 不能指向自身`,
            });
          }
        }
        const aa = (node as any).autoAction;
        if (
          aa != null &&
          !["escalate", "approve", "reject", "notify"].includes(aa)
        ) {
          f.push({
            code: "WF_TIMEOUT_INVALID_ACTION",
            severity: "error",
            path: `nodes[${node.id}].autoAction`,
            message: `节点「${node.name}」的 autoAction 无效，仅支持 escalate/approve/reject/notify`,
          });
        }
      }
    });
    // escalation role ref validation (cross-skill to RBAC like assignee)
    const escRbacRoles = ctx?.external?.rbac?.role;
    model.nodes.forEach(node => {
      const esc = (node as any).escalationRoleRef;
      if (esc) {
        if (escRbacRoles === undefined) {
          f.push({
            code: "WF_ESCALATION_ROLE_UNRESOLVED",
            severity: "warning",
            path: `nodes[${node.id}].escalationRoleRef`,
            message: `节点「${node.name}」的 escalationRoleRef「${esc}」未接入 RBAC 能力面,无法校验`,
          });
        } else if (!escRbacRoles.includes(esc)) {
          f.push({
            code: "WF_ESCALATION_ROLE_MISSING",
            severity: "error",
            path: `nodes[${node.id}].escalationRoleRef`,
            message: `节点「${node.name}」的 escalationRoleRef 在 RBAC 中不存在：${esc}`,
          });
        }
      }
    });

    // 6) PEP delegation guard: Workflow is PEP only; approvals/policy must delegate to RBAC PDP (never local auth)
    const hasApprovals = model.nodes.some(n => n.type === "approval");
    if (hasApprovals) {
      if (!model.pep) {
        f.push({
          code: "WF_PEP_BYPASS",
          severity: "error",
          path: "pep",
          message:
            "工作流包含审批节点但未声明 pep 委托标记，会导致本地授权而绕过 PDP",
        });
      }
      if (!model.actorRoleRef) {
        f.push({
          code: "WF_PEP_BYPASS",
          severity: "error",
          path: "actorRoleRef",
          message: "工作流包含审批节点但未声明 actorRoleRef 委托给 RBAC PDP",
        });
      }
      if (!model.policyCheckRefs || model.policyCheckRefs.length === 0) {
        f.push({
          code: "WF_PEP_BYPASS",
          severity: "error",
          path: "policyCheckRefs",
          message:
            "工作流包含审批节点但未声明 policyCheckRefs，会在本地而非 PDP 执行权限检查",
        });
      }
    }

    // 7) SSOT form binding contract gate: fieldRefs / branch.fieldRef MUST be entity.field refs to DataModel SSOT.
    // Bare local keys (e.g. "approved") are rejected even without DM surface (no more local masquerading as binding).
    (model.fieldRefs || []).forEach((fr, i) => {
      if (typeof fr !== "string" || !fr.includes(".")) {
        f.push({
          code: "WF_SSOT_BINDING_REQUIRED",
          severity: "error",
          path: `fieldRefs[${i}]`,
          message: `fieldRefs 必须使用 "entity.field" 格式绑定到 DataModel SSOT，不能使用本地字段 key（如 "${fr}"）`,
        });
      }
    });
    model.nodes
      .filter(n => n.type === "branch" && n.fieldRef)
      .forEach(node => {
        if (
          typeof node.fieldRef !== "string" ||
          !node.fieldRef!.includes(".")
        ) {
          f.push({
            code: "WF_SSOT_BINDING_REQUIRED",
            severity: "error",
            path: `nodes[${node.id}].fieldRef`,
            message: `分支「${node.name}」的 fieldRef 必须是 "entity.field" DataModel SSOT 绑定，不能是本地字段 key`,
          });
        }
      });

    // 7b) SSOT binding required gate (fixes optional gate): local fields must bind via fieldRefs; branch nodes must use fieldRef
    // This prevents workflows from continuing to own local field definitions without DataModel SSOT binding.
    if ((model.fields || []).length > 0) {
      if (!model.fieldRefs || model.fieldRefs.length === 0) {
        f.push({
          code: "WF_SSOT_BINDING_REQUIRED",
          severity: "error",
          path: "fieldRefs",
          message:
            "Workflow 声明了本地 fields，必须声明 fieldRefs 将表单字段绑定到 DataModel SSOT（entity.field refs），不能继续拥有本地字段定义",
        });
      } else {
        const unbound = (model.fields || []).filter(
          fl => !(model.fieldRefs || []).some(fr => fr.endsWith("." + fl.key))
        );
        if (unbound.length > 0) {
          f.push({
            code: "WF_SSOT_BINDING_REQUIRED",
            severity: "error",
            path: "fieldRefs",
            message: `本地字段 [${unbound.map(u => u.key).join(", ")}] 未绑定到对应 DataModel entity.field（fieldRefs 中缺失）`,
          });
        }
      }
    }

    // 8) DataModel SSOT bindings for declared fieldRefs (branch/form fields).
    // Gate above requires fieldRefs/fieldRef declarations (binding not optional); here we validate the declared refs against DM surface (existence + lifecycle).
    const dmFields = ctx?.external?.datamodel?.field;
    const dmSurface = ctx?.external?.datamodel;
    (model.fieldRefs || []).forEach((fr, i) => {
      if (dmFields === undefined) {
        f.push({
          code: "WF_FIELD_UNRESOLVED",
          severity: "warning",
          path: `fieldRefs[${i}]`,
          message: `Workflow fieldRef「${fr}」未接入 DataModel 能力面,无法校验`,
        });
      } else if (!dmFields.includes(fr)) {
        f.push({
          code: "WF_SSOT_MISSING_FIELD",
          severity: "error",
          path: `fieldRefs[${i}]`,
          message: `Workflow fieldRef 引用了 DataModel 中不存在的 SSOT 字段：${fr}`,
        });
      } else {
        const lc = getFieldLifecycle(dmSurface, fr);
        if (lc === "deprecated") {
          f.push({
            code: "WF_SSOT_FIELD_DEPRECATED",
            severity: "warning",
            path: `fieldRefs[${i}]`,
            message: `Workflow fieldRef references deprecated DataModel SSOT field: ${fr}`,
          });
        } else if (lc === "removed") {
          f.push({
            code: "WF_SSOT_FIELD_REMOVED",
            severity: "error",
            path: `fieldRefs[${i}]`,
            message: `Workflow fieldRef references removed DataModel SSOT field: ${fr}`,
          });
        }
      }
    });
    model.nodes
      .filter(n => n.type === "branch" && n.fieldRef)
      .forEach(node => {
        if (dmFields === undefined) {
          f.push({
            code: "WF_FIELD_UNRESOLVED",
            severity: "warning",
            path: `nodes[${node.id}].fieldRef`,
            message: `分支「${node.name}」的 fieldRef 未接入 DataModel 能力面,无法校验`,
          });
        } else if (!dmFields.includes(node.fieldRef!)) {
          f.push({
            code: "WF_SSOT_MISSING_FIELD",
            severity: "error",
            path: `nodes[${node.id}].fieldRef`,
            message: `分支「${node.name}」引用了不存在的 DataModel SSOT 字段：${node.fieldRef}`,
          });
        } else {
          const lc = getFieldLifecycle(dmSurface, node.fieldRef!);
          if (lc === "deprecated") {
            f.push({
              code: "WF_SSOT_FIELD_DEPRECATED",
              severity: "warning",
              path: `nodes[${node.id}].fieldRef`,
              message: `分支「${node.name}」的 fieldRef references deprecated DataModel SSOT field: ${node.fieldRef}`,
            });
          } else if (lc === "removed") {
            f.push({
              code: "WF_SSOT_FIELD_REMOVED",
              severity: "error",
              path: `nodes[${node.id}].fieldRef`,
              message: `分支「${node.name}」的 fieldRef references removed DataModel SSOT field: ${node.fieldRef}`,
            });
          }
        }
      });

    void byId; // (kept for future per-node lookups)

    // 10) V2 115.30.09 workflow variable reference gate: every variable reference
    // (fieldRefs, branch.fieldRef, refs inside branch/action conditions) must point to
    // a known SSOT field (declared in fieldRefs) or defined process variable (model.variables).
    // This is in addition to (not replacing) format/entity checks and external DM surface checks.
    const declaredSSOT = new Set<string>(model.fieldRefs || []);
    const declaredProcessVars = new Set<string>((model as any).variables || []);
    const allKnownVars = new Set<string>([
      ...declaredSSOT,
      ...declaredProcessVars,
    ]);

    const usedVariableRefs = new Set<string>();
    (model.fieldRefs || []).forEach(fr => usedVariableRefs.add(fr));
    model.nodes
      .filter(n => n.type === "branch" && n.fieldRef)
      .forEach(n => usedVariableRefs.add(n.fieldRef!));
    // support process var refs inside branch/action conditions (e.g. when.varRef on edges for rhs dynamic compare)
    model.nodes
      .filter(n => n.type === "branch")
      .forEach(n => {
        const vr = (n as any).varRef;
        if (typeof vr === "string") usedVariableRefs.add(vr);
      });
    model.edges.forEach(e => {
      const w: any = e.when;
      if (w && typeof w.varRef === "string") {
        usedVariableRefs.add(w.varRef);
      }
    });

    usedVariableRefs.forEach(ref => {
      if (!allKnownVars.has(ref)) {
        f.push({
          code: "WF_VAR_REF_UNKNOWN",
          severity: "error",
          path: "variables",
          message: `变量引用 "${ref}" 未指向已知 SSOT 字段或已定义 process variable`,
        });
      }
    });

    // 9) V2 115.30 workflow instance snapshot: versions + published state (snapshots must freeze published versions)
    if (model.version !== undefined) {
      if (typeof model.version !== "string" || model.version.trim() === "") {
        f.push({
          code: "WF_SNAPSHOT_INVALID_VERSION",
          severity: "error",
          path: "version",
          message: "workflow version 必须是有效非空字符串",
        });
      }
    }
    if (model.published === false) {
      f.push({
        code: "WF_SNAPSHOT_UNPUBLISHED_VERSION",
        severity: "error",
        path: "published",
        message: "实例 snapshot 只能冻结 published=true 的 workflow version",
      });
    }

    return finalizeReport(f);
  },

  // -- THE PROJECTOR -------------------------------------------------------
  project(model: WorkflowModel): Projection {
    const shape = (n: WorkflowNode): [string, string] => {
      const id = `wf_${sanitizeId(n.id)}`;
      let label = n.name;
      if (n.type === "approval") {
        const role = n.assigneeRoleRef || n.assigneeRole;
        const mode = n.approvalMode ? `(${n.approvalMode})` : "";
        if (role) label = `${n.name}<br/>@${role} ${mode}`.trim();
      } else if (n.type === "branch") {
        const fref = n.fieldRef || n.field;
        if (fref) label = `${n.name}<br/>${fref}`;
      }
      // V2 115: show timeout metadata in diagram labels
      const td = (n as any).timeoutDuration;
      const tgt = (n as any).timeoutTarget;
      const esc = (n as any).escalationRoleRef;
      const act = (n as any).autoAction;
      if (td != null) {
        const tinfo = `⏱${td}${tgt ? `→${tgt}` : ""}${esc ? `@${esc}` : ""}${act ? ` ${act}` : ""}`;
        label = `${label}<br/>${tinfo}`;
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
    const idOf = new Map(
      model.nodes.map(n => [n.id, `wf_${sanitizeId(n.id)}`])
    );
    const workflowId = `wf_${sanitizeId(model.id)}`;
    const startNodes = model.nodes.filter(n => n.type === "start");
    const approvalRoleRefs = [
      ...new Set(
        model.nodes
          .filter(n => n.type === "approval" && n.assigneeRoleRef)
          .map(n => n.assigneeRoleRef!)
      ),
    ];
    const nodes = [
      { id: workflowId, label: model.name, kind: "workflow" },
      ...(model.version
        ? [
            {
              id: `${workflowId}_ver`,
              label: `v${model.version}`,
              kind: "version",
            },
          ]
        : []),
      ...model.nodes.map(n => ({
        id: idOf.get(n.id)!,
        label: n.name,
        kind: n.type,
      })),
      ...approvalRoleRefs.map(role => ({
        id: `role_${sanitizeId(role)}`,
        label: `RBAC role: ${role}`,
        kind: "rbacRole",
      })),
    ];
    const edges = [
      ...(model.version
        ? [
            {
              from: `${workflowId}_ver`,
              to: workflowId,
              label: "version",
              kind: "version",
            },
          ]
        : []),
      ...startNodes.map(n => ({
        from: workflowId,
        to: idOf.get(n.id) ?? `wf_${sanitizeId(n.id)}`,
        label: "entry",
        kind: "workflow",
      })),
      ...model.edges.map(e => ({
        from: idOf.get(e.from) ?? `wf_${sanitizeId(e.from)}`,
        to: idOf.get(e.to) ?? `wf_${sanitizeId(e.to)}`,
        label: e.isTimeout
          ? "timeout"
          : e.isDefault
            ? "默认"
            : e.when
              ? `${e.when.op}${e.when.value}`
              : "",
        kind: e.isTimeout ? "timeout" : "flow",
      })),
    ];
    model.nodes
      .filter(n => n.type === "approval" && n.assigneeRoleRef)
      .forEach(n => {
        edges.push({
          from: idOf.get(n.id) ?? `wf_${sanitizeId(n.id)}`,
          to: `role_${sanitizeId(n.assigneeRoleRef!)}`,
          label: "PDP role",
          kind: "cross",
        });
      });
    // V2 115: synthesize timeout edges from node timeoutTarget for diagram projection (even if not explicit edge)
    model.nodes.forEach(n => {
      const td = (n as any).timeoutDuration;
      const tgt = (n as any).timeoutTarget as string | undefined;
      if (td != null && tgt) {
        const fromId = idOf.get(n.id)!;
        const toId = idOf.get(tgt) ?? `wf_${sanitizeId(tgt)}`;
        // avoid duplicate if explicit timeout edge already present
        const hasExplicit = edges.some(
          ed => ed.from === fromId && ed.to === toId && ed.kind === "timeout"
        );
        if (!hasExplicit) {
          edges.push({
            from: fromId,
            to: toId,
            label: `timeout(${td})`,
            kind: "timeout",
          });
        }
      }
    });

    const lines: string[] = ["flowchart TD"];
    const verSuffix = model.version ? ` v${model.version}` : "";
    lines.push(`  ${workflowId}["${model.name}${verSuffix}"]`);
    if (model.version) {
      const verId = `${workflowId}_ver`;
      lines.push(`  ${verId}{{"v${model.version}"}}`);
      lines.push(`  ${verId} -.->|version| ${workflowId}`);
    }
    for (const n of model.nodes) lines.push(`  ${shape(n)[1]}`);
    for (const e of edges) {
      const arrow = e.kind === "cross" ? "-.->" : "-->";
      lines.push(
        `  ${e.from} ${arrow}${e.label ? `|${e.label}|` : ""} ${e.to}`
      );
    }
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  // -- CROSS-SKILL SURFACE -------------------------------------------------
  resolve(model: WorkflowModel): ResolvableSurface {
    const crossRuntime = buildWorkflowCrossRuntimeEdges(model);
    const surface: any = {
      workflow: [model.id],
      node: model.nodes.map(n => n.id),
      runtimeEvidence: crossRuntime.map(edge => edge.evidenceKey),
      crossSkillRuntimeEdges: crossRuntime.map(
        edge => `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`
      ),
      ...(model.version ? { version: [model.id] } : {}),
      workflowToPageTrace:
        traceWorkflowTaskStateToPageTaskSurfaceEvidence(model),
      workflowToAppBundleTrace:
        traceWorkflowRuntimeEvidenceToAppBundleClosureEvidence(model),
    };
    if (!surface.runtimeEvidence.includes(WF_PAGE_RUNTIME_EVIDENCE)) {
      surface.runtimeEvidence = [
        ...surface.runtimeEvidence,
        WF_PAGE_RUNTIME_EVIDENCE,
      ];
    }
    if (
      !surface.runtimeEvidence.includes(
        WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE
      )
    ) {
      surface.runtimeEvidence = [
        ...surface.runtimeEvidence,
        WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE,
      ];
    }
    return surface;
  },

  async generate(intent: string): Promise<WorkflowModel> {
    if (/purchase|procurement|采购/i.test(intent))
      return purchaseApprovalWorkflow;
    if (/请假|leave|审批/i.test(intent)) return leaveApprovalWorkflow;
    throw new Error(
      `workflowSkill.generate: 需要接入推演引擎来为意图生成流程：「${intent}」`
    );
  },
};

// ---------------------------------------------------------------------------
// V2 115.30: runtime-less instance snapshot surfaces (pure data + validation)
// ---------------------------------------------------------------------------

/** Pure factory: freeze a snapshot of a workflow definition (process version + form bindings + vars) at start time. */
export function createWorkflowInstanceSnapshot(
  model: WorkflowModel,
  instanceId: string,
  initialVariables: Record<string, unknown> = {}
): WorkflowInstanceSnapshot {
  return {
    id: instanceId,
    workflowId: model.id,
    processVersion: model.version ?? "0.0.0",
    versionPublished: model.published === true,
    frozenFormFieldRefs: [...(model.fieldRefs ?? [])],
    initialVariables: { ...initialVariables },
  };
}

/** Pure validator for instance snapshots: enforces they point only to published workflow versions. */
export function validateWorkflowInstanceSnapshot(
  snapshot: WorkflowInstanceSnapshot
): ReturnType<Skill<WorkflowModel>["validate"]> {
  const f: Finding[] = [];
  if (!snapshot.versionPublished) {
    f.push({
      code: "WF_INSTANCE_SNAPSHOT_UNPUBLISHED",
      severity: "error",
      path: "versionPublished",
      message: `实例快照必须指向 published workflow version，当前 ${snapshot.workflowId}@${snapshot.processVersion} 未发布`,
    });
  }
  if (
    typeof snapshot.processVersion !== "string" ||
    snapshot.processVersion.trim() === ""
  ) {
    f.push({
      code: "WF_INSTANCE_SNAPSHOT_INVALID_VERSION",
      severity: "error",
      path: "processVersion",
      message: "snapshot processVersion 必须是有效字符串",
    });
  }
  if (!Array.isArray(snapshot.frozenFormFieldRefs)) {
    f.push({
      code: "WF_INSTANCE_SNAPSHOT_INVALID_BINDINGS",
      severity: "error",
      path: "frozenFormFieldRefs",
      message: "frozenFormFieldRefs 必须是数组",
    });
  }
  return finalizeReport(f);
}

// ---------------------------------------------------------------------------
// V2 117: pure workflow instance runtime (deterministic, in-memory only)
// ---------------------------------------------------------------------------

export const WF_RUNTIME_INVALID_TRANSITION = "WF_RUNTIME_INVALID_TRANSITION";

/** Find outgoing edges for a node. */
function getOutgoing(model: WorkflowModel, nodeId: string): WorkflowEdge[] {
  return model.edges.filter(e => e.from === nodeId);
}

function getNode(model: WorkflowModel, id: string): WorkflowNode | undefined {
  return model.nodes.find(n => n.id === id);
}

function resolveVarValue(
  key: string | undefined,
  vars: Record<string, unknown>
): unknown {
  if (!key) return undefined;
  if (key in vars) return vars[key];
  if (key.includes(".")) {
    const parts = key.split(".");
    let cur: any = vars;
    for (const p of parts) {
      if (cur != null && typeof cur === "object" && p in cur) {
        cur = cur[p];
      } else {
        return undefined;
      }
    }
    return cur;
  }
  return undefined;
}

function matchesWhen(
  when: { op: any; value: any } | undefined,
  actual: unknown
): boolean {
  if (!when) return false;
  const v = when.value;
  const a = actual;
  switch (when.op) {
    case "==":
      return a == v;
    case "!=":
      return a != v;
    case ">":
      return (a as any) > v;
    case ">=":
      return (a as any) >= v;
    case "<":
      return (a as any) < v;
    case "<=":
      return (a as any) <= v;
    default:
      return false;
  }
}

function resolveBranchNext(
  model: WorkflowModel,
  branchId: string,
  vars: Record<string, unknown>
): string | null {
  const outs = getOutgoing(model, branchId);
  const branch = getNode(model, branchId);
  if (!branch) return null;
  const eff = (branch as any).fieldRef || branch.field || "";
  const actual =
    resolveVarValue(eff, vars) ?? resolveVarValue(eff.split(".").pop(), vars);
  // conditionals first
  for (const e of outs) {
    if (e.when && matchesWhen(e.when as any, actual)) {
      return e.to;
    }
  }
  const def = outs.find(e => e.isDefault);
  if (def) return def.to;
  return null;
}

/** Apply command at current actionable node to pick immediate next (no auto branch here). */
function pickNextByCommand(
  model: WorkflowModel,
  currentId: string,
  command: WorkflowTransitionCommand,
  vars: Record<string, unknown>
): {
  nextId: string | null;
  updatedVars: Record<string, unknown>;
  invalid: boolean;
} {
  const node = getNode(model, currentId);
  if (!node) return { nextId: null, updatedVars: vars, invalid: true };
  const outs = getOutgoing(model, currentId);
  let nextId: string | null = null;
  let updatedVars = { ...vars };
  let invalid = false;

  if (node.type === "start") {
    if (command.type !== "submit") {
      invalid = true;
    } else {
      if (outs.length > 0) {
        nextId = outs[0].to;
      } else {
        invalid = true;
      }
      if (command.variables) {
        updatedVars = { ...updatedVars, ...command.variables };
      }
    }
  } else if (node.type === "approval") {
    if (command.type === "approve" || command.type === "reject") {
      if (outs.length > 0) {
        nextId = outs[0].to;
      } else {
        invalid = true;
      }
    } else if (command.type === "timeout") {
      const tgt = (node as any).timeoutTarget as string | undefined;
      if (tgt && getNode(model, tgt)) {
        nextId = tgt;
      } else {
        invalid = true;
      }
    } else {
      invalid = true;
    }
    if (command.variables && !invalid) {
      updatedVars = { ...updatedVars, ...command.variables };
    }
  } else if (node.type === "branch") {
    if (command.type === "submit" && command.variables) {
      updatedVars = { ...updatedVars, ...command.variables };
      nextId = resolveBranchNext(model, currentId, updatedVars);
      if (!nextId) invalid = true;
    } else {
      invalid = true;
    }
  } else if (node.type === "end") {
    invalid = true;
  } else {
    invalid = true;
  }

  if (!invalid && !nextId) invalid = true;
  return { nextId, updatedVars, invalid };
}

export function startWorkflowInstance(
  model: WorkflowModel,
  input: { id?: string; initialVariables?: Record<string, unknown> } = {}
): WorkflowInstance {
  const instId =
    input.id ??
    `inst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const initialVars = { ...(input.initialVariables ?? {}) };
  const snapshot = createWorkflowInstanceSnapshot(model, instId, initialVars);
  const start = model.nodes.find(n => n.type === "start");
  const currentNodeId = start ? start.id : (model.nodes[0]?.id ?? "start");
  return {
    id: instId,
    snapshot,
    currentNodeId,
    status: "running",
    variables: initialVars,
  };
}

export function transitionWorkflowInstance(
  model: WorkflowModel,
  instance: WorkflowInstance,
  command: WorkflowTransitionCommand
): { instance: WorkflowInstance; findings: any[] } {
  const findings: any[] = [];
  // never mutate caller instance
  const baseVars: Record<string, unknown> = { ...instance.variables };
  const currentId = instance.currentNodeId;

  const node = getNode(model, currentId);
  if (
    !node ||
    instance.status === "completed" ||
    instance.status === "rejected"
  ) {
    findings.push({
      code: WF_RUNTIME_INVALID_TRANSITION,
      severity: "error",
      path: "currentNodeId",
      message: `Invalid transition: no active node at ${currentId}`,
    });
    return { instance: structuredClone(instance), findings };
  }

  const pick = pickNextByCommand(model, currentId, command, baseVars);
  if (pick.invalid || !pick.nextId) {
    findings.push({
      code: WF_RUNTIME_INVALID_TRANSITION,
      severity: "error",
      path: `command/${command.type}`,
      message: `Invalid transition ${command.type} at node ${currentId} (type=${node.type})`,
    });
    return { instance: structuredClone(instance), findings };
  }

  let nextId = pick.nextId!;
  let nextVars = pick.updatedVars;

  // auto-follow branches (data-driven, until action or end)
  const MAX = 25;
  let guard = 0;
  while (guard++ < MAX) {
    const n = getNode(model, nextId);
    if (!n || n.type === "end") break;
    if (n.type !== "branch") break;
    const resolved = resolveBranchNext(model, nextId, nextVars);
    if (!resolved) break;
    nextId = resolved;
  }

  const landed = getNode(model, nextId);
  const newStatus = landed && landed.type === "end" ? "completed" : "running";

  const nextInstance: WorkflowInstance = {
    id: instance.id,
    snapshot: instance.snapshot, // frozen at start, never mutate
    currentNodeId: nextId,
    status: newStatus,
    variables: nextVars,
  };

  return { instance: nextInstance, findings: [] };
}

// V2 117: Workflow assignee policy runtime (pure, consumes RBAC PDP evidence from ctx)
// ---------------------------------------------------------------------------

export const WF_ASSIGNEE_PDP_DENIED = "WF_ASSIGNEE_PDP_DENIED";

export const policyEvidence = "policyEvidence";

/** Pure exported runtime helper.
 *  Resolves assignees for approval nodeId using RBAC decision evidence / policy surface
 *  supplied in ctx.external.rbac (never decides locally or calls PDP here).
 *  Missing evidence or deny evidence returns WF_ASSIGNEE_PDP_DENIED (fail-closed).
 */
export function resolveWorkflowAssignees(
  model: WorkflowModel,
  nodeId: string,
  ctx: { external?: { rbac?: any } } = {}
):
  | { assignees: string[]; policyEvidence?: any }
  | typeof WF_ASSIGNEE_PDP_DENIED {
  const node = model.nodes.find(n => n.id === nodeId);
  if (!node || node.type !== "approval") {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  const roleRef = node.assigneeRoleRef || node.assigneeRole;
  if (!roleRef) {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  const rbac = ctx?.external?.rbac;
  if (!rbac) {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  // Consume RBAC decision evidence specifically via policyEvidence (or the exported key); static surfaces (e.g. .decision, .role) do not count as runtime PDP evidence.
  // Missing/ absent -> fail closed per spec.
  const evid = rbac.policyEvidence ?? rbac[policyEvidence];
  if (evid == null) {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  if (
    typeof evid === "object" &&
    evid !== null &&
    (evid.allow === false ||
      evid.denied === true ||
      evid.code === WF_ASSIGNEE_PDP_DENIED)
  ) {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  // runtime resolution delegates to supplied evidence; return roleRef target + attached evidence
  return {
    assignees: [roleRef],
    policyEvidence: evid,
  };
}

/**
 * 119 closure adapter: closes Workflow assignee policy evidence against RBAC roles and PolicyDecision.
 * Consumes a PolicyDecision (from decideRbacPolicy / RBAC PDP) + workflow node roleRef.
 * Deterministic positive: allow decision -> returns assignees + evidence.
 * Fail-closed negative: !allow / missing / bad node -> WF_ASSIGNEE_PDP_DENIED (no silent allow).
 * Pure local, no side effects; stable addition, resolveWorkflowAssignees remains primary evidence consumer.
 */
export function createWorkflowAssigneePolicyEvidenceFromDecision(
  model: WorkflowModel,
  nodeId: string,
  decision:
    | PolicyDecision
    | { allow?: boolean; effect?: string }
    | null
    | undefined
):
  | { assignees: string[]; policyEvidence: any }
  | typeof WF_ASSIGNEE_PDP_DENIED {
  const node = model.nodes.find(n => n.id === nodeId);
  if (!node || node.type !== "approval") {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  const roleRef = node.assigneeRoleRef || node.assigneeRole;
  if (!roleRef) {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  if (!decision || typeof decision !== "object") {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  const allow =
    (decision as any).allow === true || (decision as any).effect === "allow";
  if (!allow) {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  // 119: bind RBAC PolicyDecision roles to the node's assigneeRoleRef (major review fix).
  // Fail-closed: an allow decision whose expandedRoles/subject roles do not include this roleRef
  // (or carries no role attestation) must not produce evidence for an unrelated approval node.
  const d: any = decision;
  const expanded: string[] = Array.isArray(d.expandedRoles)
    ? d.expandedRoles
    : [];
  const subjRoles: string[] = Array.isArray(d.subject?.roleIds)
    ? d.subject.roleIds
    : Array.isArray(d.roleIds)
      ? d.roleIds
      : [];
  const attested = [...expanded, ...subjRoles];
  if (attested.length === 0 || !attested.includes(roleRef)) {
    return WF_ASSIGNEE_PDP_DENIED;
  }
  return {
    assignees: [roleRef],
    policyEvidence: {
      ...(decision as any),
      role: roleRef,
      source: "rbac-policy-decision",
    },
  };
}

// V2 117: pure runtime form binding (DataModel lifecycle + RBAC field PDP)
// Pure deterministic in-memory only. Honors frozen snapshot. Removed/denied -> stable findings.
// ---------------------------------------------------------------------------

export const WF_FORM_FIELD_PDP_DENIED = "WF_FORM_FIELD_PDP_DENIED";

/** Pure executable runtime: bind workflow task form fields using frozen snapshot refs,
 * DataModel lifecycle metadata, and RBAC PDP field permission evidence.
 * Returns field refs (for current context), per-field state, and stable findings for removed/denied.
 */
export function buildWorkflowFormRuntime(
  model: WorkflowModel,
  instance: WorkflowInstanceSnapshot,
  ctx?: any
): WorkflowFormRuntime {
  const findings: Array<{
    code: string;
    severity: string;
    path: string;
    message: string;
  }> = [];
  // Honor snapshot frozenFormFieldRefs (V2 115.30 freeze contract); fallback to model only if absent.
  const frozenRefs: string[] =
    Array.isArray(instance?.frozenFormFieldRefs) &&
    instance.frozenFormFieldRefs.length > 0
      ? [...instance.frozenFormFieldRefs]
      : [...(model.fieldRefs ?? [])];

  const dmSurf = ctx?.external?.datamodel;
  const rbacModel: any = ctx?.external?.rbacModel ?? ctx?.external?.rbac;

  const fields: Array<{
    ref: string;
    lifecycle?: string;
    pdpState: string;
    editable: boolean;
  }> = [];

  const actorRole = model.actorRoleRef;
  const resourceFromModel =
    model.policyCheckRefs && model.policyCheckRefs.length > 0
      ? model.policyCheckRefs[0].split(":")[0] || "leave_request"
      : "leave_request";

  for (const ref of frozenRefs) {
    const lifecycle = getFieldLifecycle(dmSurf, ref);
    let pdpState = "allowed";
    let editable = true;

    if (lifecycle === "removed") {
      findings.push({
        code: "WF_SSOT_FIELD_REMOVED",
        severity: "error",
        path: `fieldRefs[${ref}]`,
        message: `Workflow form fieldRef references removed DataModel SSOT field: ${ref}`,
      });
      editable = false;
    }

    // RBAC field PDP evidence: use decide + direct rule match for stable field deny detection (fail-closed)
    let fieldDenied = false;
    const fieldKey = ref.split(".").pop() || ref;
    const resourceType = ref.split(".")[0] || resourceFromModel;

    if (rbacModel && typeof decideRbacPolicy === "function") {
      // Direct policyRule inspection for field-scoped deny (stable, independent of base perm match)
      const prs = rbacModel.policyRules ?? [];
      const matchingDeny = prs.some(
        (pr: any) =>
          pr &&
          pr.effect === "deny" &&
          (pr.fieldRef === ref ||
            pr.field === fieldKey ||
            pr.fieldRef === `${resourceType}.${fieldKey}`) &&
          (pr.lifecycleState == null || pr.lifecycleState !== "retired") &&
          (!pr.roleId || (actorRole && pr.roleId === actorRole))
      );
      if (matchingDeny) {
        fieldDenied = true;
      } else {
        // Fallback: run decide with fieldContext; field deny rules veto even without exact perm match in precedence
        const candidateRoles = actorRole ? [actorRole] : ["employee"];
        const cands = ["approve", "create", "view"];
        for (const act of cands) {
          try {
            const dec = decideRbacPolicy(rbacModel, {
              subject: { roleIds: candidateRoles },
              action: act,
              resourceType,
              tenantId: "t_default",
              fieldContext: { fields: [fieldKey, ref] },
            } as any);
            if (
              !dec.allow &&
              (dec.reason || "").toLowerCase().includes("policy rule")
            ) {
              fieldDenied = true;
              break;
            }
          } catch {
            // pure: exceptions already fail-closed inside decide
          }
        }
      }
    }

    if (fieldDenied) {
      pdpState = WF_FORM_FIELD_PDP_DENIED;
      editable = false;
      findings.push({
        code: WF_FORM_FIELD_PDP_DENIED,
        severity: "error",
        path: `fieldRefs[${ref}]`,
        message: `Workflow form field ${ref} is denied by RBAC PDP field permission rule`,
      });
    }

    fields.push({ ref, lifecycle, pdpState, editable });
  }

  return {
    formFieldRefs: frozenRefs,
    fields,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Worked example — the "请假审批" flow, designed to reference the RBAC sample's roles.
//   start → 主管审批(@manager) → 审批结果? → 通过 / 驳回
// ---------------------------------------------------------------------------

export type WorkflowRuntimeTargetSkill =
  | "rbac"
  | "datamodel"
  | "page"
  | "aigc"
  | "appbundle";

export type WorkflowRuntimeEvidenceState = "allowed" | "blocked";

export interface WorkflowCrossRuntimeEvidence {
  sourceSkill: "workflow";
  targetSkill: WorkflowRuntimeTargetSkill;
  evidenceKey: string;
  state: WorkflowRuntimeEvidenceState;
  reasonCode: string;
  workflowId: string;
  nodeRefs: string[];
  roleRefs: string[];
  fieldRefs: string[];
  transitionRefs: string[];
  snapshotRef?: string;
}

export interface NormalizedWorkflowRuntimeContext {
  sourceSkill: "workflow";
  targetSkill: WorkflowRuntimeTargetSkill;
  workflowId: string;
  nodeRefs: string[];
  roleRefs: string[];
  fieldRefs: string[];
  transitionRefs: string[];
  upstreamEvidencePresent: boolean;
  evidence: WorkflowCrossRuntimeEvidence;
}

export const WF_CROSS_RUNTIME_EVIDENCE = "WF_CROSS_RUNTIME_EVIDENCE";
export const WF_RBAC_RUNTIME_EVIDENCE = "WF_RBAC_RUNTIME_EVIDENCE";
export const WF_DATAMODEL_RUNTIME_EVIDENCE = "WF_DATAMODEL_RUNTIME_EVIDENCE";

function workflowRoleRefs(model: WorkflowModel): string[] {
  return [
    ...(model.actorRoleRef ? [model.actorRoleRef] : []),
    ...model.nodes.flatMap(
      node =>
        [
          node.assigneeRoleRef,
          node.assigneeRole,
          node.escalationRoleRef,
        ].filter(Boolean) as string[]
    ),
  ].sort();
}

function workflowTransitionRefs(model: WorkflowModel): string[] {
  return model.edges
    .map(edge => `${edge.from}->${edge.to}${edge.isTimeout ? ":timeout" : ""}`)
    .sort();
}

function workflowRefsForTarget(
  model: WorkflowModel,
  targetSkill: WorkflowRuntimeTargetSkill
): string[] {
  if (targetSkill === "rbac")
    return [
      ...workflowRoleRefs(model),
      ...(model.policyCheckRefs ?? []),
    ].sort();
  if (targetSkill === "datamodel")
    return [
      ...(model.fieldRefs ?? []),
      ...model.nodes.flatMap(node => (node.fieldRef ? [node.fieldRef] : [])),
    ].sort();
  if (targetSkill === "page")
    return [
      model.id,
      ...model.nodes.map(node => node.id),
      ...workflowTransitionRefs(model),
    ].sort();
  if (targetSkill === "aigc")
    return [
      ...workflowTransitionRefs(model),
      ...(model.fieldRefs ?? []),
    ].sort();
  return [
    model.id,
    ...workflowRoleRefs(model),
    ...(model.fieldRefs ?? []),
    ...workflowTransitionRefs(model),
  ].sort();
}

export function createWorkflowCrossRuntimeEvidence(
  model: WorkflowModel,
  targetSkill: WorkflowRuntimeTargetSkill,
  upstreamSurface?: unknown,
  snapshot?: WorkflowInstanceSnapshot
): WorkflowCrossRuntimeEvidence {
  const targetRefs = workflowRefsForTarget(model, targetSkill);
  const upstreamEvidencePresent =
    upstreamSurface !== undefined && upstreamSurface !== null;
  const state: WorkflowRuntimeEvidenceState =
    targetRefs.length > 0 && upstreamEvidencePresent ? "allowed" : "blocked";

  return {
    sourceSkill: "workflow",
    targetSkill,
    evidenceKey: `${WF_CROSS_RUNTIME_EVIDENCE}:${targetSkill}:${state}`,
    state,
    reasonCode:
      state === "allowed"
        ? "WF_RUNTIME_EVIDENCE_PRESENT"
        : "WF_RUNTIME_UPSTREAM_ABSENT",
    workflowId: model.id,
    nodeRefs: model.nodes.map(node => node.id).sort(),
    roleRefs: workflowRoleRefs(model),
    fieldRefs: [
      ...(model.fieldRefs ?? []),
      ...model.nodes.flatMap(node => (node.fieldRef ? [node.fieldRef] : [])),
    ].sort(),
    transitionRefs: workflowTransitionRefs(model),
    snapshotRef: snapshot?.id,
  };
}

export function normalizeWorkflowRuntimeContextForSkill(
  model: WorkflowModel,
  targetSkill: WorkflowRuntimeTargetSkill,
  upstreamSurface?: unknown,
  snapshot?: WorkflowInstanceSnapshot
): NormalizedWorkflowRuntimeContext {
  const evidence = createWorkflowCrossRuntimeEvidence(
    model,
    targetSkill,
    upstreamSurface,
    snapshot
  );
  return {
    sourceSkill: "workflow",
    targetSkill,
    workflowId: model.id,
    nodeRefs: evidence.nodeRefs,
    roleRefs: evidence.roleRefs,
    fieldRefs: evidence.fieldRefs,
    transitionRefs: evidence.transitionRefs,
    upstreamEvidencePresent: evidence.state === "allowed",
    evidence,
  };
}

export function buildWorkflowCrossRuntimeEdges(
  model: WorkflowModel
): WorkflowCrossRuntimeEvidence[] {
  const targets: WorkflowRuntimeTargetSkill[] = [
    "rbac",
    "datamodel",
    "page",
    "aigc",
    "appbundle",
  ];
  return targets
    .filter(target => workflowRefsForTarget(model, target).length > 0)
    .map(target =>
      createWorkflowCrossRuntimeEvidence(model, target, {
        declared: workflowRefsForTarget(model, target),
      })
    );
}

export function createWorkflowRbacRuntimeEvidence(
  model: WorkflowModel,
  upstreamSurface: unknown,
  snapshot?: WorkflowInstanceSnapshot
): WorkflowCrossRuntimeEvidence {
  return {
    ...createWorkflowCrossRuntimeEvidence(
      model,
      "rbac",
      upstreamSurface,
      snapshot
    ),
    evidenceKey: WF_RBAC_RUNTIME_EVIDENCE,
  };
}

export function createWorkflowDataModelRuntimeEvidence(
  model: WorkflowModel,
  upstreamSurface?: unknown,
  snapshot?: WorkflowInstanceSnapshot
): WorkflowCrossRuntimeEvidence {
  return {
    ...createWorkflowCrossRuntimeEvidence(
      model,
      "datamodel",
      upstreamSurface,
      snapshot
    ),
    evidenceKey: WF_DATAMODEL_RUNTIME_EVIDENCE,
  };
}

export const WF_PAGE_RUNTIME_EVIDENCE = "WF_PAGE_RUNTIME_EVIDENCE";
export const WF_WORKFLOW_TO_PAGE_TRACE = "WF_WORKFLOW_TO_PAGE_TRACE";
export const WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE =
  "WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE";
export const WF_WORKFLOW_TO_APPBUNDLE_TRACE = "WF_WORKFLOW_TO_APPBUNDLE_TRACE";

export function createWorkflowPageRuntimeEvidence(
  model: WorkflowModel,
  upstreamSurface?: unknown,
  snapshot?: WorkflowInstanceSnapshot
): WorkflowCrossRuntimeEvidence {
  return {
    ...createWorkflowCrossRuntimeEvidence(
      model,
      "page",
      upstreamSurface,
      snapshot
    ),
    evidenceKey: WF_PAGE_RUNTIME_EVIDENCE,
  };
}

export interface WorkflowToPageTrace {
  traceId: typeof WF_WORKFLOW_TO_PAGE_TRACE;
  sourceSkill: "workflow";
  targetSkill: "page";
  state: "closed" | "blocked";
  reasonCode: string;
  workflowId: string;
  currentNodeId?: string;
  pageTaskSurfaceValid: boolean;
  evidenceKey: string;
}

export interface WorkflowToAppBundleTrace {
  traceId: typeof WF_WORKFLOW_TO_APPBUNDLE_TRACE;
  sourceSkill: "workflow";
  targetSkill: "appbundle";
  state: "closed" | "blocked";
  reasonCode: string;
  workflowId: string;
  hasRuntimeRefs: boolean;
  appBundleEvidencePresent: boolean;
  evidenceKey: string;
}

interface WorkflowTaskStateLike {
  currentNodeId?: string;
  workflowId?: string;
  status?: string;
  variables?: Record<string, unknown>;
}

export function traceWorkflowTaskStateToPageTaskSurfaceEvidence(
  model: WorkflowModel,
  instance?: WorkflowTaskStateLike,
  page?: PageModel
): WorkflowToPageTrace {
  const currentNodeId = instance?.currentNodeId;
  const hasTaskState =
    typeof currentNodeId === "string" && currentNodeId.length > 0;
  let pageTaskSurfaceValid = false;

  if (hasTaskState && page) {
    try {
      pageTaskSurfaceValid =
        projectWorkflowTaskView(
          page,
          instance as unknown as WorkflowInstance
        ) !== PAGE_WORKFLOW_TASK_VIEW_INVALID;
    } catch {
      pageTaskSurfaceValid = false;
    }
  } else if (hasTaskState) {
    pageTaskSurfaceValid = model.nodes.some(node => node.id === currentNodeId);
  }

  const closed = hasTaskState && pageTaskSurfaceValid;

  return {
    traceId: WF_WORKFLOW_TO_PAGE_TRACE,
    sourceSkill: "workflow",
    targetSkill: "page",
    state: closed ? "closed" : "blocked",
    reasonCode: closed
      ? "WF_PAGE_TASK_SURFACE_POSITIVE_CLOSED"
      : "WF_PAGE_TASK_SURFACE_FAIL_CLOSED",
    workflowId: model.id,
    currentNodeId,
    pageTaskSurfaceValid,
    evidenceKey: `${WF_WORKFLOW_TO_PAGE_TRACE}:${closed ? "closed" : "blocked"}`,
  };
}

export function traceWorkflowRuntimeEvidenceToAppBundleClosureEvidence(
  model: WorkflowModel,
  appBundleSurface?: unknown
): WorkflowToAppBundleTrace {
  const nodeCount = Array.isArray(model.nodes) ? model.nodes.length : 0;
  const fieldRefCount = Array.isArray(model.fieldRefs)
    ? model.fieldRefs.length
    : 0;
  const transitionCount = Array.isArray(model.edges) ? model.edges.length : 0;
  const hasRuntimeRefs =
    nodeCount > 0 ||
    fieldRefCount > 0 ||
    transitionCount > 0 ||
    model.published === true;
  const upstreamPresent =
    appBundleSurface !== undefined && appBundleSurface !== null;
  const closed = hasRuntimeRefs && upstreamPresent;

  return {
    traceId: WF_WORKFLOW_TO_APPBUNDLE_TRACE,
    sourceSkill: "workflow",
    targetSkill: "appbundle",
    state: closed ? "closed" : "blocked",
    reasonCode: closed
      ? "WF_APPBUNDLE_RUNTIME_EVIDENCE_POSITIVE_CLOSED"
      : "WF_APPBUNDLE_RUNTIME_FAIL_CLOSED",
    workflowId: model.id,
    hasRuntimeRefs,
    appBundleEvidencePresent: closed,
    evidenceKey: `${WF_WORKFLOW_TO_APPBUNDLE_TRACE}:${closed ? "closed" : "blocked"}`,
  };
}

export function createWorkflowToAppBundleRuntimeEvidence(
  model: WorkflowModel,
  appBundleSurface?: unknown,
  snapshot?: WorkflowInstanceSnapshot
): WorkflowCrossRuntimeEvidence {
  return {
    ...createWorkflowCrossRuntimeEvidence(
      model,
      "appbundle",
      appBundleSurface,
      snapshot
    ),
    evidenceKey: WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE,
  };
}

export const leaveApprovalWorkflow: WorkflowModel = {
  id: "wf_leave_approval",
  name: "请假审批流程",
  pep: "pep",
  actorRoleRef: "employee",
  policyCheckRefs: ["leave:approve"],
  fieldRefs: ["leave_request.approved"],
  traceSpan: "wf.leave.approval",
  version: "1.0.0",
  published: true,
  fields: [{ key: "approved", type: "boolean" }],
  nodes: [
    { id: "s", type: "start", name: "发起请假" },
    {
      id: "a_mgr",
      type: "approval",
      name: "主管审批",
      assigneeRole: "manager",
      assigneeRoleRef: "manager",
      approvalMode: "any",
    },
    {
      id: "b",
      type: "branch",
      name: "审批结果",
      field: "approved",
      fieldRef: "leave_request.approved",
    },
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

export const purchaseApprovalWorkflow: WorkflowModel = {
  id: "wf_purchase_approval",
  name: "Purchase Approval Workflow",
  pep: "pep",
  actorRoleRef: "requester",
  policyCheckRefs: [
    "purchase:create",
    "purchase:manager_approve",
    "purchase:finance_approve",
    "purchase:fulfill",
  ],
  fieldRefs: [
    "purchase_request.amount",
    "purchase_request.budgetChecked",
    "purchase_request.managerApproved",
    "purchase_request.financeApproved",
    "purchase_request.procurementFulfilled",
  ],
  traceSpan: "wf.purchase.approval",
  version: "1.0.0",
  published: true,
  fields: [
    { key: "amount", type: "number" },
    { key: "budgetChecked", type: "boolean" },
    { key: "managerApproved", type: "boolean" },
    { key: "financeApproved", type: "boolean" },
    { key: "procurementFulfilled", type: "boolean" },
  ],
  nodes: [
    { id: "submit", type: "start", name: "Submit purchase request" },
    {
      id: "manager",
      type: "approval",
      name: "Department manager approval",
      assigneeRole: "department_manager",
      assigneeRoleRef: "department_manager",
      approvalMode: "sequential",
    },
    {
      id: "budget",
      type: "branch",
      name: "Budget check",
      field: "budgetChecked",
      fieldRef: "purchase_request.budgetChecked",
    },
    {
      id: "finance",
      type: "approval",
      name: "Finance approval",
      assigneeRole: "finance",
      assigneeRoleRef: "finance",
      approvalMode: "percentage",
      // threshold: V2 hardening requires for percentage; cast bypasses WorkflowNode interface (edit scope limits)
      ...({ threshold: 60 } as any),
    },
    {
      id: "finance_result",
      type: "branch",
      name: "Finance result",
      field: "financeApproved",
      fieldRef: "purchase_request.financeApproved",
    },
    {
      id: "procurement",
      type: "approval",
      name: "Buyer / Procurement fulfillment",
      assigneeRole: "procurement",
      assigneeRoleRef: "procurement",
      approvalMode: "all",
    },
    {
      id: "fulfillment",
      type: "branch",
      name: "Fulfillment result",
      field: "procurementFulfilled",
      fieldRef: "purchase_request.procurementFulfilled",
    },
    { id: "approved", type: "end", name: "Approved" },
    { id: "rejected", type: "end", name: "Rejected" },
  ],
  edges: [
    { id: "p1", from: "submit", to: "manager" },
    { id: "p2", from: "manager", to: "budget" },
    {
      id: "p3",
      from: "budget",
      to: "finance",
      when: { op: "==", value: true },
    },
    { id: "p4", from: "budget", to: "rejected", isDefault: true },
    { id: "p5", from: "finance", to: "finance_result" },
    {
      id: "p6",
      from: "finance_result",
      to: "procurement",
      when: { op: "==", value: true },
    },
    { id: "p7", from: "finance_result", to: "rejected", isDefault: true },
    { id: "p8", from: "procurement", to: "fulfillment" },
    {
      id: "p9",
      from: "fulfillment",
      to: "approved",
      when: { op: "==", value: true },
    },
    { id: "p10", from: "fulfillment", to: "rejected", isDefault: true },
  ],
};
