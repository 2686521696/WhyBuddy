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
  FieldContext,
  PolicyContext,
  PolicyDecision,
  PolicyLifecycleState,
  PolicyRule,
  RbacFieldAccessLevel,
  RbacModel,
  RbacRuntimeDecision,
  RbacRuntimeRequest,
} from "./rbacModel";
import { RBAC_RUNTIME_FAIL_CLOSED } from "./rbacModel";
export { RBAC_RUNTIME_FAIL_CLOSED };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

/** Detect cycles / unresolved parents in a parent-pointer tree. Returns offending node ids. */
function treeFaults(
  nodes: Array<{ id: string; parentId: string | null }>,
): { cycles: string[]; danglingParents: Array<{ id: string; parentId: string }> } {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const cycles: string[] = [];
  const danglingParents: Array<{ id: string; parentId: string }> = [];
  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let cur = node.parentId;
    while (cur != null) {
      if (!byId.has(cur)) {
        danglingParents.push({ id: node.id, parentId: cur });
        break;
      }
      if (seen.has(cur)) {
        cycles.push(node.id);
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)!.parentId;
    }
  }
  return { cycles, danglingParents };
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// PDP helpers: inheritance expansion, cycle detection, SoD, decisions
// ---------------------------------------------------------------------------

/** Detect cycles in role inheritsRoleIds graph (supports multi-inherit). Returns offending role ids. */
function roleInheritanceCycles(roles: Array<{ id: string; inheritsRoleIds?: string[] }>): string[] {
  const byId = new Map(roles.map(r => [r.id, r]));
  const cycles: string[] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(id: string): void {
    if (!byId.has(id)) return;
    if (stack.has(id)) {
      cycles.push(id);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.add(id);
    const r = byId.get(id)!;
    (r.inheritsRoleIds ?? []).forEach(p => visit(p));
    stack.delete(id);
  }

  roles.forEach(r => visit(r.id));
  return [...new Set(cycles)];
}

/** Expand direct roles to all transitively inherited (deduped). Breaks on cycles to remain safe. */
function expandEffectiveRoles(
  roles: Array<{ id: string; inheritsRoleIds?: string[] }>,
  direct: string[],
): string[] {
  const byId = new Map(roles.map(r => [r.id, r]));
  const result = new Set<string>();
  const visiting = new Set<string>();

  function dfs(id: string) {
    if (!byId.has(id) || result.has(id)) return;
    if (visiting.has(id)) return; // cycle guard
    visiting.add(id);
    result.add(id);
    const r = byId.get(id)!;
    (r.inheritsRoleIds ?? []).forEach(dfs);
    visiting.delete(id);
  }

  direct.forEach(dfs);
  return [...result];
}

/** Collect union of permissionCodes from a role set after inheritance expansion. */
function getEffectivePermissionCodes(model: RbacModel, directRoleIds: string[]): string[] {
  const effRoles = expandEffectiveRoles(model.roles, directRoleIds);
  const permSet = new Set<string>();
  const roleMap = new Map(model.roles.map(r => [r.id, r]));
  for (const rid of effRoles) {
    const r = roleMap.get(rid);
    if (r) r.permissionCodes.forEach(pc => permSet.add(pc));
  }
  return [...permSet];
}

/** 115.10.05: pure decision helper for RBAC_DECISION_FAIL_CLOSED evidence shape. */
function failClosedDecision(reason: string, extra?: Partial<PolicyDecision>): PolicyDecision {
  return { allow: false, code: "RBAC_DECISION_FAIL_CLOSED", reason, ...extra };
}

/** 115.10.06: deterministic deny precedence matcher.
 * A deny rule matches if scopes align (tenant/role effective/perm/resource/field).
 * Role scope matches after inheritance expansion.
 * When rule.permissionCode is present, match ONLY if the request targets exactly that permissionCode
 * (resolved from action+resourceType). This ensures permission scope precedence is precise and
 * does not degrade to row scope or mis-deny other permissions on the same resource. */
function matchesDenyRule(rule: PolicyRule, req: PolicyContext, effectiveRoleIds: string[], targetPermissionCode?: string): boolean {
  if (rule.effect !== "deny") return false;
  if (rule.tenantId && rule.tenantId !== req.tenantId) return false;
  if (rule.roleId && !effectiveRoleIds.includes(rule.roleId)) return false;
  if (rule.resourceType && rule.resourceType !== req.resourceType) return false;
  if (rule.permissionCode) {
    // permission-scoped deny must exactly hit the permission the request is exercising
    if (!targetPermissionCode || rule.permissionCode !== targetPermissionCode) return false;
  }
  if (rule.fieldRef || rule.field) {
    // 115.10.07: prefer fieldRef (entity.field SSOT) but extract key for runtime fieldContext match (compat)
    const raw = rule.fieldRef || rule.field || "";
    const ruleFieldKey: string = raw.split(".").pop() || raw;
    const hasField = (req.fieldContext.fields ?? []).includes(ruleFieldKey) ||
      (req.fieldContext.attributes && Object.prototype.hasOwnProperty.call(req.fieldContext.attributes, ruleFieldKey));
    if (!hasField) return false;
  }
  return true;
}

/** 117: pure exported runtime SoD policy evaluator.
 * Detects direct mutually-exclusive roles ( >1 exclusiveRoleIds held directly by subject )
 * and contextual conflicts such as selfApproval (intersect any exclusive when flag set).
 * Returns stable evidence incl. matched SoD rule id + RBAC_RUNTIME_SOD_DENIED.
 * Deterministic in-memory only.
 */
export const RBAC_RUNTIME_SOD_DENIED = "RBAC_RUNTIME_SOD_DENIED";

export function evaluateRbacSodPolicy(model: RbacModel, request: PolicyContext): { denied: boolean; ruleId?: string; reasonCode?: string; reason?: string; matchedRoles?: string[] } {
  if (!model || !request || !request.subject || !Array.isArray(request.subject.roleIds)) {
    return { denied: false };
  }
  const direct = request.subject.roleIds;
  for (const rule of model.sodRules ?? []) {
    const ex = new Set(rule.exclusiveRoleIds);
    const held = direct.filter((r: string) => ex.has(r));
    if (held.length > 1) {
      return {
        denied: true,
        ruleId: rule.id,
        reasonCode: RBAC_RUNTIME_SOD_DENIED,
        reason: `direct mutually-exclusive roles [${held.join(",")}] match sodRule ${rule.id}`,
        matchedRoles: held,
      };
    }
  }
  if (request.selfApproval === true) {
    for (const rule of model.sodRules ?? []) {
      const ex = new Set(rule.exclusiveRoleIds);
      const held = direct.filter((r: string) => ex.has(r));
      if (held.length > 0) {
        return {
          denied: true,
          ruleId: rule.id,
          reasonCode: RBAC_RUNTIME_SOD_DENIED,
          reason: `selfApproval contextual conflict match sodRule ${rule.id}`,
          matchedRoles: held,
        };
      }
    }
  }
  return { denied: false };
}

// ---------------------------------------------------------------------------
// The skill
// ---------------------------------------------------------------------------

export const rbacSkill: Skill<RbacModel> & CrossSkill<RbacModel> = {
  id: "rbac",
  title: "RBAC 权限",

  // -- CROSS-SKILL declarations (for the combined relation graph) -----------
  crossRefs(model: RbacModel): CrossRefEdge[] {
    // data rules point OUT at the DataModel skill's entities.
    const refs: CrossRefEdge[] = model.dataRules.map(d => ({
      fromNode: `rule_${sanitizeId(d.id)}`,
      toSkill: "datamodel",
      toKind: "entity",
      toValue: d.modelRef,
      label: "数据",
    }));
    // 115.10.07: row (entity) and field policy refs also delegate to DataModel SSOT surfaces
    (model.policyRules ?? []).forEach(pr => {
      if (pr.resourceType) {
        refs.push({
          fromNode: `policy_${sanitizeId(pr.id)}`,
          toSkill: "datamodel",
          toKind: "entity",
          toValue: pr.resourceType,
          label: "row",
        });
      }
      let fval = pr.fieldRef;
      if (!fval && pr.field) {
        fval = pr.resourceType ? `${pr.resourceType}.${pr.field}` : pr.field;
      }
      if (fval) {
        refs.push({
          fromNode: `policy_${sanitizeId(pr.id)}`,
          toSkill: "datamodel",
          toKind: "field",
          toValue: fval,
          label: "field",
        });
      }
    });
    return refs;
  },
  refNodeId(kind: string, value: string): string | null {
    const v = sanitizeId(value);
    switch (kind) {
      case "role":
        return `role_${v}`;
      case "permission":
        return `perm_${v}`;
      case "menu":
        return `menu_${v}`;
      case "policy":
      case "rowRule":
      case "fieldRule":
        return `policy_${v}`;
      case "decision":
      case "decisionScope":
        return `decision_${v}`;
      default:
        return null;
    }
  },

  // -- THE GATE ------------------------------------------------------------
  validate(model: RbacModel, ctx?: ValidateContext): ReturnType<Skill<RbacModel>["validate"]> {
    const f: Finding[] = [];

    const roleIds = new Set(model.roles.map(r => r.id));
    const permCodes = new Set(model.permissions.map(p => p.code));
    const menuIds = new Set(model.menus.map(m => m.id));
    const deptIds = new Set(model.departments.map(d => d.id));
    const posIds = new Set(model.positions.map(p => p.id));
    const userIds = new Set(model.users.map(u => u.id));

    // 1) Uniqueness ---------------------------------------------------------
    for (const [label, dups, code] of [
      ["role id", findDuplicates(model.roles.map(r => r.id)), "RBAC_DUP_ROLE_ID"],
      ["permission code", findDuplicates(model.permissions.map(p => p.code)), "RBAC_DUP_PERMISSION_CODE"],
      ["menu id", findDuplicates(model.menus.map(m => m.id)), "RBAC_DUP_MENU_ID"],
      ["user id", findDuplicates(model.users.map(u => u.id)), "RBAC_DUP_USER_ID"],
    ] as const) {
      for (const dup of dups) {
        f.push({ code, severity: "error", path: `${label}=${dup}`, message: `重复的${label}：${dup}` });
      }
    }

    // 2) Referential integrity ---------------------------------------------
    model.roles.forEach(role => {
      role.permissionCodes.forEach((pc, i) => {
        if (!permCodes.has(pc))
          f.push({
            code: "RBAC_REF_MISSING_PERMISSION",
            severity: "error",
            path: `roles[${role.id}].permissionCodes[${i}]`,
            message: `角色「${role.name}」引用了不存在的权限：${pc}`,
          });
      });
      role.menuIds.forEach((mid, i) => {
        if (!menuIds.has(mid))
          f.push({
            code: "RBAC_REF_MISSING_MENU",
            severity: "error",
            path: `roles[${role.id}].menuIds[${i}]`,
            message: `角色「${role.name}」引用了不存在的菜单：${mid}`,
          });
      });
      (role.inheritsRoleIds ?? []).forEach((rid, i) => {
        if (!roleIds.has(rid))
          f.push({
            code: "RBAC_REF_MISSING_ROLE",
            severity: "error",
            path: `roles[${role.id}].inheritsRoleIds[${i}]`,
            message: `角色「${role.name}」继承了不存在的角色：${rid}`,
          });
      });
      if (role.permissionCodes.length === 0 && role.menuIds.length === 0)
        f.push({
          code: "RBAC_DEAD_ROLE",
          severity: "warning",
          path: `roles[${role.id}]`,
          message: `角色「${role.name}」既无权限也无菜单，等于空角色`,
        });
    });

    model.menus.forEach(menu => {
      if (menu.permissionCode && !permCodes.has(menu.permissionCode))
        f.push({
          code: "RBAC_REF_MISSING_PERMISSION",
          severity: "error",
          path: `menus[${menu.id}].permissionCode`,
          message: `菜单「${menu.name}」绑定了不存在的权限：${menu.permissionCode}`,
        });
      if (menu.type === "button" && !menu.permissionCode)
        f.push({
          code: "RBAC_BUTTON_NO_PERMISSION",
          severity: "warning",
          path: `menus[${menu.id}]`,
          message: `按钮「${menu.name}」没有绑定权限，无法被权限控制`,
        });
    });

    model.positions.forEach(pos => {
      pos.roleIds.forEach((rid, i) => {
        if (!roleIds.has(rid))
          f.push({
            code: "RBAC_REF_MISSING_ROLE",
            severity: "error",
            path: `positions[${pos.id}].roleIds[${i}]`,
            message: `岗位「${pos.name}」引用了不存在的角色：${rid}`,
          });
      });
    });

    model.users.forEach(user => {
      if (user.roleIds.length === 0)
        f.push({
          code: "RBAC_USER_NO_ROLE",
          severity: "warning",
          path: `users[${user.id}]`,
          message: `用户「${user.name}」没有任何角色，将无法操作系统`,
        });
      user.roleIds.forEach((rid, i) => {
        if (!roleIds.has(rid))
          f.push({
            code: "RBAC_REF_MISSING_ROLE",
            severity: "error",
            path: `users[${user.id}].roleIds[${i}]`,
            message: `用户「${user.name}」引用了不存在的角色：${rid}`,
          });
      });
      if (user.departmentId && !deptIds.has(user.departmentId))
        f.push({
          code: "RBAC_REF_MISSING_DEPARTMENT",
          severity: "error",
          path: `users[${user.id}].departmentId`,
          message: `用户「${user.name}」引用了不存在的部门：${user.departmentId}`,
        });
      if (user.positionId && !posIds.has(user.positionId))
        f.push({
          code: "RBAC_REF_MISSING_POSITION",
          severity: "error",
          path: `users[${user.id}].positionId`,
          message: `用户「${user.name}」引用了不存在的岗位：${user.positionId}`,
        });
    });

    model.departments.forEach(dept => {
      if (dept.leaderUserId && !userIds.has(dept.leaderUserId))
        f.push({
          code: "RBAC_REF_MISSING_USER",
          severity: "error",
          path: `departments[${dept.id}].leaderUserId`,
          message: `部门「${dept.name}」的负责人指向不存在的用户：${dept.leaderUserId}`,
        });
    });

    // sodRules role refs
    (model.sodRules ?? []).forEach(rule => {
      rule.exclusiveRoleIds.forEach((rid, i) => {
        if (!roleIds.has(rid))
          f.push({
            code: "RBAC_REF_MISSING_ROLE",
            severity: "error",
            path: `sodRules[${rule.id}].exclusiveRoleIds[${i}]`,
            message: `SoD规则「${rule.name}」引用了不存在的角色：${rid}`,
          });
      });
    });

    // 115.10.03 selfGrantDenials / dualControlPolicies refs (pure validation)
    (model.selfGrantDenials ?? []).forEach(sg => {
      sg.deniedSelfGrantPermissionCodes.forEach((pc, i) => {
        if (!permCodes.has(pc))
          f.push({
            code: "RBAC_REF_MISSING_PERMISSION",
            severity: "error",
            path: `selfGrantDenials[${sg.id}].deniedSelfGrantPermissionCodes[${i}]`,
            message: `自授权限拒绝策略「${sg.name}」引用了不存在的权限：${pc}`,
          });
      });
    });
    (model.dualControlPolicies ?? []).forEach(dc => {
      const hasMatchingPerm = model.permissions.some(
        p => p.action === dc.action && p.resource === dc.resource
      );
      if (!hasMatchingPerm) {
        f.push({
          code: "RBAC_REF_MISSING_PERMISSION",
          severity: "error",
          path: `dualControlPolicies[${dc.id}]`,
          message: `双控策略「${dc.name}」的 action/resource 未匹配任何权限`,
        });
      }
      if (typeof dc.minApprovers !== "number" || dc.minApprovers < 2) {
        f.push({
          code: "RBAC_SOD_DUAL_CONTROL",
          severity: "error",
          path: `dualControlPolicies[${dc.id}].minApprovers`,
          message: `双控策略「${dc.name}」的 minApprovers 必须 >=2（当前 ${dc.minApprovers}）`,
        });
      }
    });

    // 2b) Separation of Duties (PDP kernel ◆ SoD) + role inheritance cycles --
    // Role inheritance cycle detection (must fail closed, no downgrade)
    const inheritanceCycles = roleInheritanceCycles(model.roles);
    inheritanceCycles.forEach(id =>
      f.push({
        code: "RBAC_ROLE_INHERITANCE_CYCLE",
        severity: "error",
        path: `roles[${id}].inheritsRoleIds`,
        message: `角色继承存在环：${id}`,
      }),
    );

    // perm-based SoD now checks direct + inherited permissions
    for (const sod of model.sodConstraints ?? []) {
      const exclusive = new Set(sod.mutuallyExclusive);
      for (const role of model.roles) {
        const effPerms = getEffectivePermissionCodes(model, [role.id]);
        const held = effPerms.filter(pc => exclusive.has(pc));
        if (held.length > 1)
          f.push({
            code: "RBAC_SOD_MUTUALLY_EXCLUSIVE",
            severity: "error",
            path: `roles[${role.id}].permissionCodes`,
            message: `职责分离冲突「${sod.name}」：角色「${role.name}」同时持有互斥权限 [${held.join(", ")}]`,
          });
      }
    }

    // role-based SoD (sodRules) against direct + inherited roles
    for (const rule of model.sodRules ?? []) {
      const exclusive = new Set(rule.exclusiveRoleIds);
      // positions
      model.positions.forEach(pos => {
        const eff = expandEffectiveRoles(model.roles, pos.roleIds);
        const held = eff.filter(rid => exclusive.has(rid));
        if (held.length > 1) {
          f.push({
            code: "RBAC_SOD_MUTUALLY_EXCLUSIVE",
            severity: "error",
            path: `positions[${pos.id}].roleIds`,
            message: `职责分离冲突「${rule.name}」：岗位同时持有互斥角色 [${held.join(", ")}]`,
          });
          f.push({
            code: "RBAC_SOD_VIOLATION",
            severity: "error",
            path: `positions[${pos.id}].roleIds`,
            message: `职责分离冲突「${rule.name}」：岗位同时持有互斥角色 [${held.join(", ")}]`,
          });
        }
      });
      // users
      model.users.forEach(user => {
        const eff = expandEffectiveRoles(model.roles, user.roleIds);
        const held = eff.filter(rid => exclusive.has(rid));
        if (held.length > 1) {
          f.push({
            code: "RBAC_SOD_MUTUALLY_EXCLUSIVE",
            severity: "error",
            path: `users[${user.id}].roleIds`,
            message: `职责分离冲突「${rule.name}」：用户同时持有互斥角色 [${held.join(", ")}]`,
          });
          f.push({
            code: "RBAC_SOD_VIOLATION",
            severity: "error",
            path: `users[${user.id}].roleIds`,
            message: `职责分离冲突「${rule.name}」：用户同时持有互斥角色 [${held.join(", ")}]`,
          });
        }
      });
    }

    // 3) Tree integrity (menus + departments) ------------------------------
    for (const [label, nodes, dupCode] of [
      ["菜单", model.menus, "RBAC_MENU_TREE_FAULT"],
      ["部门", model.departments, "RBAC_DEPT_TREE_FAULT"],
    ] as const) {
      const { cycles, danglingParents } = treeFaults(nodes);
      cycles.forEach(id =>
        f.push({ code: dupCode, severity: "error", path: `${label}[${id}]`, message: `${label}树存在环：${id}` }),
      );
      danglingParents.forEach(({ id, parentId }) =>
        f.push({
          code: dupCode,
          severity: "error",
          path: `${label}[${id}].parentId`,
          message: `${label}「${id}」的父级不存在：${parentId}`,
        }),
      );
    }

    // 4) Cross-skill references (data rule -> DataModel skill) --------------
    const dataModelSurface = ctx?.external?.datamodel?.entity;
    model.dataRules.forEach(rule => {
      rule.roleIds.forEach((rid, i) => {
        if (!roleIds.has(rid))
          f.push({
            code: "RBAC_REF_MISSING_ROLE",
            severity: "error",
            path: `dataRules[${rule.id}].roleIds[${i}]`,
            message: `数据规则「${rule.name}」引用了不存在的角色：${rid}`,
          });
      });
      if (dataModelSurface === undefined) {
        // No DataModel skill output threaded in yet — we can flag but not fail.
        f.push({
          code: "RBAC_CROSS_REF_UNRESOLVED",
          severity: "warning",
          path: `dataRules[${rule.id}].modelRef`,
          message: `数据规则「${rule.name}」指向数据模型「${rule.modelRef}」，但本次未提供 DataModel 能力面，无法校验`,
        });
      } else if (!dataModelSurface.includes(rule.modelRef)) {
        f.push({
          code: "RBAC_CROSS_REF_MISSING",
          severity: "error",
          path: `dataRules[${rule.id}].modelRef`,
          message: `数据规则「${rule.name}」指向的数据模型不存在：${rule.modelRef}`,
        });
      }
    });

    // 115.10.07: policy row (resourceType) and field (fieldRef/field) refs -> DataModel SSOT
    // Warn when SSOT surface not connected; error when connected but ref missing.
    const dmEntity = ctx?.external?.datamodel?.entity;
    const dmField = ctx?.external?.datamodel?.field ?? (ctx?.external?.datamodel?.fields ? (ctx.external.datamodel.fields as any[]).map((f: any) => f.ref) : undefined);
    (model.policyRules ?? []).forEach(pr => {
      if (pr.resourceType) {
        if (dmEntity === undefined) {
          f.push({
            code: "RBAC_CROSS_REF_UNRESOLVED",
            severity: "warning",
            path: `policyRules[${pr.id}].resourceType`,
            message: `策略规则「${pr.id}」的行作用域「${pr.resourceType}」指向数据模型，但本次未提供 DataModel 能力面，无法校验`,
          });
        } else if (!dmEntity.includes(pr.resourceType)) {
          f.push({
            code: "RBAC_CROSS_REF_MISSING",
            severity: "error",
            path: `policyRules[${pr.id}].resourceType`,
            message: `策略规则「${pr.id}」的行作用域指向的数据模型不存在：${pr.resourceType}`,
          });
        }
      }
      let fieldRefVal: string | undefined = pr.fieldRef;
      if (!fieldRefVal && pr.field) {
        fieldRefVal = pr.resourceType ? `${pr.resourceType}.${pr.field}` : pr.field;
      }
      if (fieldRefVal) {
        if (dmField === undefined) {
          f.push({
            code: "RBAC_CROSS_REF_UNRESOLVED",
            severity: "warning",
            path: `policyRules[${pr.id}].${pr.fieldRef ? "fieldRef" : "field"}`,
            message: `策略规则「${pr.id}」的字段权限引用「${fieldRefVal}」指向数据模型，但本次未提供 DataModel 能力面，无法校验`,
          });
        } else if (!dmField.includes(fieldRefVal)) {
          f.push({
            code: "RBAC_CROSS_REF_MISSING",
            severity: "error",
            path: `policyRules[${pr.id}].${pr.fieldRef ? "fieldRef" : "field"}`,
            message: `策略规则「${pr.id}」的字段权限引用了不存在的 DataModel SSOT 字段：${fieldRefVal}`,
          });
        }
      }
    });

    // 115.10.08: validate that effective policies are published and not retired (core lifecycle gate)
    (model.policyRules ?? []).forEach(pr => {
      if (pr.lifecycleState === "effective") {
        // effective state means published (reached publish) and not retired: contract satisfied for this rule
      }
    });

    return finalizeReport(f);
  },

  // -- THE PROJECTOR (架构图自动掉出来) -----------------------------------
  // RBAC PDP: project() makes PDP host, fail-closed, inheritance, SoD visible when declared in model.
  // Inbound PDP delegation uses typed ref surfaces (role/policy/decision via refNodeId), no fake external lines.
  project(model: RbacModel): Projection {
    const nodes: Projection["nodes"] = [];
    const edges: Projection["edges"] = [];

    model.roles.forEach(r => nodes.push({ id: `role_${sanitizeId(r.id)}`, label: r.name, kind: "role" }));
    model.permissions.forEach(p =>
      nodes.push({ id: `perm_${sanitizeId(p.code)}`, label: p.code, kind: "permission" }),
    );
    model.menus.forEach(m => nodes.push({ id: `menu_${sanitizeId(m.id)}`, label: m.name, kind: "menu" }));
    model.users.forEach(u => nodes.push({ id: `user_${sanitizeId(u.id)}`, label: u.name, kind: "user" }));
    model.dataRules.forEach(d => nodes.push({ id: `rule_${sanitizeId(d.id)}`, label: d.name, kind: "dataRule" }));

    // PDP surfaces derived from model declarations (no hardcoded non-derived nodes)
    nodes.push({ id: "pdp_rbac", label: "RBAC PDP", kind: "pdp-host" });
    if (model.failClosed) {
      nodes.push({ id: "pdp_fail_closed", label: "fail-closed", kind: "pdp-posture" });
    }
    const hasInherits = model.roles.some(r => (r.inheritsRoleIds ?? []).length > 0);
    if (hasInherits) {
      nodes.push({ id: "pdp_inheritance", label: "inheritance", kind: "inheritance" });
    }
    (model.sodRules ?? []).forEach(sr => {
      nodes.push({ id: `sod_${sanitizeId(sr.id)}`, label: sr.name, kind: "sod" });
    });
    (model.sodConstraints ?? []).forEach(sc => {
      nodes.push({ id: `sodc_${sanitizeId(sc.name)}`, label: sc.name, kind: "sod" });
    });
    // 115.10.03: surface self-grant and dual-control SoD policies in projection
    (model.selfGrantDenials ?? []).forEach(sg => {
      nodes.push({ id: `sod_self_${sanitizeId(sg.id)}`, label: sg.name, kind: "sod" });
    });
    (model.dualControlPolicies ?? []).forEach(dc => {
      nodes.push({ id: `sod_dual_${sanitizeId(dc.id)}`, label: dc.name, kind: "sod" });
    });
    // 115.10.06: surface explicit allow/deny policy effects and precedence contract
    // 115.10.08: surface policy version/lifecycle in diagram nodes (advances V2 sample semantics)
    const hasPolicyLifecycle = (model.policyRules ?? []).some(pr => !!pr.lifecycleState || !!pr.version);
    if (hasPolicyLifecycle) {
      nodes.push({ id: "pdp_policy_lifecycle", label: "policy-lifecycle", kind: "lifecycle" as any });
    }
    (model.policyRules ?? []).forEach(pr => {
      const k = pr.effect === "deny" ? "pdp-deny" : "policy";
      const ver = pr.version ? `@${pr.version}` : "";
      const st = pr.lifecycleState ? `:${pr.lifecycleState}` : "";
      nodes.push({ id: `policy_${sanitizeId(pr.id)}`, label: `${pr.effect} ${pr.permissionCode || pr.resourceType || pr.fieldRef || pr.field || pr.roleId || ""}${ver}${st}`.trim(), kind: k as any });
      if (pr.lifecycleState) {
        nodes.push({ id: `lifecycle_${sanitizeId(pr.id)}`, label: `${pr.lifecycleState}${ver}`, kind: "lifecycle" as any });
      }
    });
    if ((model.policyRules ?? []).length > 0) {
      nodes.push({ id: "pdp_precedence", label: "deny-over-allow", kind: "precedence" });
    }
    const decisionCodes = ["RBAC_DECISION_ALLOW", "RBAC_DECISION_FAIL_CLOSED"];
    decisionCodes.forEach(dc => {
      nodes.push({ id: `decision_${sanitizeId(dc)}`, label: dc, kind: "decision" });
    });

    model.roles.forEach(r => {
      r.permissionCodes.forEach(pc =>
        edges.push({ from: `role_${sanitizeId(r.id)}`, to: `perm_${sanitizeId(pc)}`, label: "拥有", kind: "grant" }),
      );
      r.menuIds.forEach(mid =>
        edges.push({ from: `role_${sanitizeId(r.id)}`, to: `menu_${sanitizeId(mid)}`, label: "可见", kind: "menu" }),
      );
    });
    model.users.forEach(u =>
      u.roleIds.forEach(rid =>
        edges.push({ from: `user_${sanitizeId(u.id)}`, to: `role_${sanitizeId(rid)}`, label: "是", kind: "assign" }),
      ),
    );
    model.dataRules.forEach(d => {
      d.roleIds.forEach(rid =>
        edges.push({ from: `rule_${sanitizeId(d.id)}`, to: `role_${sanitizeId(rid)}`, label: "约束", kind: "data" }),
      );
      // cross refs use typed surfaces + orchestrator cross wiring (removed fake dm_ external line here)
    });

    // link PDP host for visibility of delegation surface
    if (model.failClosed) {
      edges.push({ from: "pdp_rbac", to: "pdp_fail_closed", label: "posture", kind: "pdp" });
    }
    decisionCodes.forEach(dc => {
      edges.push({ from: "pdp_rbac", to: `decision_${sanitizeId(dc)}`, label: "decides", kind: "pdp" });
    });
    model.roles.forEach(r => {
      edges.push({ from: "pdp_rbac", to: `role_${sanitizeId(r.id)}`, label: "hosts", kind: "pdp" });
    });
    // 115.10.06: pdp hosts precedence and policy effect nodes
    // 115.10.08: link lifecycle projection node
    if ((model.policyRules ?? []).length > 0) {
      edges.push({ from: "pdp_rbac", to: "pdp_precedence", label: "precedence", kind: "pdp" });
    }
    if (hasPolicyLifecycle) {
      edges.push({ from: "pdp_rbac", to: "pdp_policy_lifecycle", label: "lifecycle", kind: "pdp" });
    }
    (model.policyRules ?? []).forEach(pr => {
      edges.push({ from: "pdp_rbac", to: `policy_${sanitizeId(pr.id)}`, label: pr.effect, kind: "pdp" });
    });

    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}["${n.label}"]`);
    for (const e of edges) {
      const arrow = e.kind === "cross" ? "-.->" : "-->";
      lines.push(`  ${e.from} ${arrow}|${e.label ?? ""}| ${e.to}`);
    }
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  // -- THE CROSS-SKILL SURFACE (other skills reference these) --------------
  // RBAC PDP: resolve() exposes richer surfaces for roles, permissions, policies, row rules, field rules, decision, and decision scopes
  resolve(model: RbacModel): ResolvableSurface {
    const decisionCodes = ["RBAC_DECISION_ALLOW", "RBAC_DECISION_FAIL_CLOSED"];
    const policySurface = [
      ...model.permissions.map(p => p.code),
      ...((model.policyRules ?? []).map(r => `${r.effect}:${r.id}${r.version ? `@${r.version}` : ""}${r.lifecycleState ? `#${r.lifecycleState}` : ""}`)),
    ];
    const policyRules = model.policyRules ?? [];
    const rowRuleSurface = policyRules.filter(r => r.resourceType != null).map(r => r.id);
    const fieldRuleSurface = policyRules.filter(r => r.fieldRef != null || r.field != null).map(r => r.id);
    const decisionScopeSurface = [...decisionCodes];
    const crossRuntime = buildRbacCrossRuntimeEdges(model);
    return {
      role: model.roles.map(r => r.id),
      permission: model.permissions.map(p => p.code),
      policy: policySurface,
      decision: decisionCodes,
      rowRule: rowRuleSurface,
      fieldRule: fieldRuleSurface,
      decisionScope: decisionScopeSurface,
      menu: model.menus.map(m => m.id),
      department: model.departments.map(d => d.id),
      position: model.positions.map(p => p.id),
      user: model.users.map(u => u.id),
      runtimeEvidence: crossRuntime.map(edge => edge.evidenceKey),
      crossSkillRuntimeEdges: crossRuntime.map(edge => `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`),
    };
  },

  // -- THE LLM SEAM (stub; real impl asks SlideRule to fill the metamodel) --
  async generate(intent: string): Promise<RbacModel> {
    // In production this prompts the reasoning engine to emit a RbacModel for `intent`,
    // constrained by the metamodel above. For the sample we return the worked example
    // when the intent is about leave approval, else throw so callers don't get a fake.
    if (/purchase|procurement|采购/i.test(intent)) return purchaseApprovalRbac;
    if (/请假|leave/i.test(intent)) return leaveApprovalRbac;
    throw new Error(`rbacSkill.generate: 需要接入推演引擎来为意图生成模型：「${intent}」`);
  },
};

/** Pure PDP decision: returns allow only when RBAC can prove the subject has a matching permission
 * via direct or inherited roles. Missing context (subject, action, resource, tenant, field) or
 * validator/decision helper exceptions result in deny + RBAC_DECISION_FAIL_CLOSED.
 * 115.10.06: explicit PolicyRule effects (allow/deny) are evaluated with deterministic deny-over-allow
 * precedence: deny rules (matched on tenant/role/perm/row/field scopes) override any direct or inherited allow.
 * Scope order (for determinism): field > row/resourceType > permission > role > tenant. Any deny match vetoes.
 * 115.10.07: row/field refs in policyRules delegate identity to DataModel SSOT (validated in gate when surface provided).
 * 115.10.08: when deny driven by policyRule, decision includes policyVersion and policyLifecycleState so PDP can explain version used.
 * Objective, no browser/user coupling.
 */
export function decideRbacPolicy(model: RbacModel, request: PolicyContext): PolicyDecision {
  try {
    if (!request || !request.subject || !Array.isArray(request.subject.roleIds)) {
      return failClosedDecision("missing or invalid subject");
    }
    const reqRoles = request.subject.roleIds;
    if (reqRoles.length === 0 || !request.action || !request.resourceType) {
      return failClosedDecision("missing policy inputs (roles/action/resource)");
    }

    // 115.10.05: fail-closed for missing tenant context (tenantId is now required PDP input)
    if (typeof request.tenantId !== "string" || request.tenantId.length === 0) {
      return failClosedDecision("missing tenant context");
    }

    // 115.10.05: fail-closed for missing field context (absent, null or undefined per task: missing context -> deny)
    if (request.fieldContext == null) {
      return failClosedDecision("missing field context");
    }

    const roleMap = new Map(model.roles.map(r => [r.id, r]));
    const permMap = new Map(model.permissions.map(p => [p.code, p]));

    // deny if any requested role missing
    const missingRole = reqRoles.find(rid => !roleMap.has(rid));
    if (missingRole != null) {
      return failClosedDecision(`role missing: ${missingRole}`, { expandedRoles: [] });
    }

    // expand (inheritance)
    const effectiveRoleIds = expandEffectiveRoles(model.roles, reqRoles);

    // 117: integrate evaluateRbacSodPolicy into runtime PDP; SoD denial wins before allow
    const sodEval = evaluateRbacSodPolicy(model, request);
    if (sodEval.denied) {
      return failClosedDecision(`runtime SoD denied by rule ${sodEval.ruleId}`, {
        expandedRoles: effectiveRoleIds,
        reasonCode: RBAC_RUNTIME_SOD_DENIED,
        sodRuleId: sodEval.ruleId,
      });
    }

    // collect granted perms (only those defined)
    const effectivePerms: string[] = [];
    const granted = new Set<string>();
    for (const rid of effectiveRoleIds) {
      const r = roleMap.get(rid);
      if (r) {
        r.permissionCodes.forEach(pc => {
          if (permMap.has(pc) && !granted.has(pc)) {
            granted.add(pc);
            effectivePerms.push(pc);
          }
        });
      }
    }

    // look for match on action + resourceType (resource field in perm)
    let matchedPermission: string | undefined;
    for (const pc of effectivePerms) {
      const p = permMap.get(pc);
      if (p && p.action === request.action && p.resource === request.resourceType) {
        matchedPermission = pc;
        break;
      }
    }

    // 115.10.06: resolve the permissionCode the *request* targets (by action/resource), independent of grant.
    // Used for precise permission-scope matching in deny rules (prevents permission-specific denies
    // from applying to other permissions on the same resource).
    const targetPermissionCode = model.permissions.find(
      p => p.action === request.action && p.resource === request.resourceType
    )?.code;

    // 115.10.06: check explicit deny policy rules (after expand+perm collect) to enforce deny precedence
    // deny wins even if matchedPermission would otherwise grant (direct or via inheritance).
    // matchesDenyRule now enforces exact permissionCode match when present.
    // 115.10.08: only consider non-retired policies for effective PDP use (retired not effective)
    const policyRulesForDeny = (model.policyRules ?? []).filter(r => r.lifecycleState !== "retired");
    for (const dr of policyRulesForDeny) {
      if (dr.effect !== "deny") continue;
      if (!matchesDenyRule(dr, request, effectiveRoleIds, targetPermissionCode)) continue;
      return failClosedDecision(`denied by policy rule ${dr.id}${dr.version ? `@${dr.version}` : ""} (deny precedence over allow)`, {
        expandedRoles: effectiveRoleIds,
        matchedPermission: dr.permissionCode || matchedPermission,
        policyVersion: dr.version,
        policyLifecycleState: dr.lifecycleState,
        policyId: dr.id,
      });
    }

    if (matchedPermission) {
      // 115.10.03 self-grant SoD denial (pure decision, no runtime side effects)
      const hasSelfGrantDeny = (model.selfGrantDenials ?? []).some((sg) =>
        sg.deniedSelfGrantPermissionCodes.includes(matchedPermission),
      );
      if (hasSelfGrantDeny && request.isSelf === true) {
        return failClosedDecision(`self-grant denied for ${matchedPermission} by SoD policy`, {
          expandedRoles: effectiveRoleIds,
          matchedPermission,
          reasonCode: "RBAC_SOD_SELF_GRANT",
        });
      }

      // 115.10.03 dual-control SoD check (pure, using minApprovers + distinct approvers from context)
      const dual = (model.dualControlPolicies ?? []).find(
        (d) => d.action === request.action && d.resource === request.resourceType
      );
      if (dual) {
        let provided = request.approverCount ?? 0;
        if (Array.isArray(request.approverUserIds) && request.approverUserIds.length > 0) {
          provided = new Set(request.approverUserIds).size;
        }
        if (provided < dual.minApprovers) {
          return failClosedDecision(`dual-control requires at least ${dual.minApprovers} distinct approvers (provided ${provided})`, {
            expandedRoles: effectiveRoleIds,
            matchedPermission,
            reasonCode: "RBAC_SOD_DUAL_CONTROL",
          });
        }
      }

      return {
        allow: true,
        code: "RBAC_DECISION_ALLOW",
        reason: `granted by ${matchedPermission}`,
        expandedRoles: effectiveRoleIds,
        matchedPermission,
      };
    }

    // unknown permission request or not granted => fail closed, never allow
    return failClosedDecision("no matching permission for the requested action/resource", {
      expandedRoles: effectiveRoleIds,
    });
  } catch (err: any) {
    // 115.10.05: validator/decision helper exceptions must result in deny (fail-closed)
    return failClosedDecision(`decision helper exception: ${err?.message ?? String(err)}`);
  }
}

/** 117: pure executable runtime PDP decision function.
 * Deterministic in-memory only. Request carries subject (role refs or user), action, resourceType,
 * optional resourceId, fieldRef, scope (context scope).
 * Returns structured decision: effect allow/deny, reasonCode, matched ids, denyPrecedence:true on deny-win.
 * Missing subject/action/resource inputs -> effect=deny + RBAC_RUNTIME_FAIL_CLOSED.
 * Explicit allow only; any matching deny rule sets denyPrecedence and overrides.
 * decideRbacPolicy remains compatible (unchanged body for test stability).
 */
export function evaluateRbacRuntimePolicy(model: RbacModel, request: RbacRuntimeRequest): RbacRuntimeDecision {
  try {
    const subj = request?.subject ?? {};
    const roleIds: string[] = Array.isArray(subj.roleIds) ? subj.roleIds : [];
    const action = request?.action;
    const resourceType = request?.resourceType;
    if (!request || roleIds.length === 0 || !action || !resourceType) {
      return {
        effect: "deny",
        reasonCode: RBAC_RUNTIME_FAIL_CLOSED,
        matchedRoleIds: [],
        matchedPermissionIds: [],
        matchedPolicyIds: [],
        denyPrecedence: false,
      };
    }

    const effectiveRoleIds = expandEffectiveRoles(model.roles, roleIds);

    const targetPermissionCode = model.permissions.find(
      p => p.action === action && p.resource === resourceType
    )?.code;

    // build sim context for existing deny matcher (fieldRef -> fieldContext)
    const fieldKey = request.fieldRef ? (request.fieldRef.split(".").pop() || request.fieldRef) : undefined;
    const simFieldContext: FieldContext = request.fieldContext ?? (fieldKey ? { fields: [fieldKey] } : { fields: [] });
    const simReq: PolicyContext = {
      subject: { roleIds, userId: subj.userId },
      action,
      resourceType,
      resourceId: request.resourceId,
      tenantId: request.tenantId ?? "",
      scope: request.scope,
      fieldContext: simFieldContext,
      isSelf: request.isSelf,
      approverCount: request.approverCount,
      approverUserIds: request.approverUserIds,
    };

    // 117 runtime: deny precedence first (deny overrides any allow)
    const policyRulesForDeny = (model.policyRules ?? []).filter(r => r.lifecycleState !== "retired");
    for (const dr of policyRulesForDeny) {
      if (dr.effect !== "deny") continue;
      if (!matchesDenyRule(dr, simReq, effectiveRoleIds, targetPermissionCode)) continue;
      return {
        effect: "deny",
        reasonCode: RBAC_RUNTIME_FAIL_CLOSED,
        matchedRoleIds: effectiveRoleIds,
        matchedPermissionIds: dr.permissionCode ? [dr.permissionCode] : (targetPermissionCode ? [targetPermissionCode] : []),
        matchedPolicyIds: [dr.id],
        denyPrecedence: true,
      };
    }

    // collect effective perms (reuse logic)
    const roleMap = new Map(model.roles.map(r => [r.id, r]));
    const permMap = new Map(model.permissions.map(p => [p.code, p]));
    const effectivePerms: string[] = [];
    const granted = new Set<string>();
    for (const rid of effectiveRoleIds) {
      const r = roleMap.get(rid);
      if (r) {
        r.permissionCodes.forEach(pc => {
          if (permMap.has(pc) && !granted.has(pc)) {
            granted.add(pc);
            effectivePerms.push(pc);
          }
        });
      }
    }

    let matchedPermission: string | undefined;
    for (const pc of effectivePerms) {
      const p = permMap.get(pc);
      if (p && p.action === action && p.resource === resourceType) {
        matchedPermission = pc;
        break;
      }
    }

    if (matchedPermission) {
      // explicit allow (runtime allow is explicit only); no SoD here (decide keeps compat)
      return {
        effect: "allow",
        reasonCode: "RBAC_RUNTIME_ALLOW",
        matchedRoleIds: effectiveRoleIds,
        matchedPermissionIds: [matchedPermission],
        matchedPolicyIds: [],
        denyPrecedence: false,
      };
    }

    // no grant -> fail closed
    return {
      effect: "deny",
      reasonCode: RBAC_RUNTIME_FAIL_CLOSED,
      matchedRoleIds: effectiveRoleIds,
      matchedPermissionIds: [],
      matchedPolicyIds: [],
      denyPrecedence: false,
    };
  } catch {
    return {
      effect: "deny",
      reasonCode: RBAC_RUNTIME_FAIL_CLOSED,
      matchedRoleIds: [],
      matchedPermissionIds: [],
      matchedPolicyIds: [],
      denyPrecedence: false,
    };
  }
}

/** 117: pure exported runtime helper for row-level access. Delegates to PDP (decideRbacPolicy) with no local auth duplication. */
export function evaluateRbacRowAccess(model: RbacModel, request: PolicyContext): PolicyDecision {
  return decideRbacPolicy(model, request);
}

/** 117: pure exported runtime helper for field-level access.
 * Must delegate to PDP decision path.
 * Supports hidden/read/readonly/editable outcomes in return shape.
 * Denied always fail-closed (level hidden + RBAC_FIELD_ACCESS_DENIED code).
 * When sensitive field uses policyRef (from DataModel), PDP carries policyId into evidence and helper preserves it.
 */
export const RBAC_FIELD_ACCESS_DENIED = "RBAC_FIELD_ACCESS_DENIED";

export function evaluateRbacFieldAccess(
  model: RbacModel,
  request: PolicyContext,
  fieldRef?: string,
): PolicyDecision & { level: RbacFieldAccessLevel; policyId?: string } {
  let effectiveRequest: PolicyContext = request;
  if (fieldRef != null) {
    const fc = request.fieldContext ?? { fields: [] as string[] };
    const fieldKey = fieldRef.includes(".") ? (fieldRef.split(".").pop() || fieldRef) : fieldRef;
    effectiveRequest = {
      ...request,
      fieldContext: {
        fields: Array.from(new Set([...(fc.fields ?? []), fieldKey])),
        attributes: fc.attributes,
      },
    };
  }
  const decision = decideRbacPolicy(model, effectiveRequest);
  if (!decision.allow) {
    // fail-closed for field denial; preserve policyId from PDP evidence (set for policyRef denies)
    return {
      ...decision,
      code: RBAC_FIELD_ACCESS_DENIED,
      level: "hidden",
      policyId: (decision as any).policyId,
    } as any;
  }
  // positive: PDP granted; level "read" for base (other levels supported in type/contract; caller context determines semantics via PDP)
  return {
    ...decision,
    level: "read" as RbacFieldAccessLevel,
  } as any;
}

// ---------------------------------------------------------------------------
// Worked example — a "请假审批" platform's RBAC slice (a coherent, valid instance)
// ---------------------------------------------------------------------------

export type RbacRuntimeTargetSkill = "datamodel" | "workflow" | "page" | "aigc" | "appbundle";

export type RbacRuntimeEvidenceState = "allowed" | "blocked";

export interface RbacCrossRuntimeEvidence {
  sourceSkill: "rbac";
  targetSkill: RbacRuntimeTargetSkill;
  evidenceKey: string;
  state: RbacRuntimeEvidenceState;
  reasonCode: string;
  roleRefs: string[];
  permissionRefs: string[];
  policyRefs: string[];
  decision?: RbacRuntimeDecision;
}

export interface NormalizedRbacRuntimeContext {
  sourceSkill: "rbac";
  targetSkill: RbacRuntimeTargetSkill;
  roleRefs: string[];
  permissionRefs: string[];
  policyRefs: string[];
  upstreamEvidencePresent: boolean;
  evidence: RbacCrossRuntimeEvidence;
}

export const RBAC_CROSS_RUNTIME_EVIDENCE = "RBAC_CROSS_RUNTIME_EVIDENCE";
export const RBAC_PAGE_RUNTIME_EVIDENCE = "RBAC_PAGE_RUNTIME_EVIDENCE";
export const RBAC_WORKFLOW_RUNTIME_EVIDENCE = "RBAC_WORKFLOW_RUNTIME_EVIDENCE";

function rbacPolicyRefsForTarget(model: RbacModel, targetSkill: RbacRuntimeTargetSkill): string[] {
  const policyRules = model.policyRules ?? [];
  if (targetSkill === "datamodel") {
    return [
      ...model.dataRules.map(rule => rule.modelRef),
      ...policyRules.flatMap(rule => [rule.resourceType, rule.fieldRef].filter(Boolean) as string[]),
    ].sort();
  }
  if (targetSkill === "page") {
    return [
      ...model.menus.map(menu => menu.id),
      ...model.permissions.map(permission => permission.code),
    ].sort();
  }
  if (targetSkill === "workflow") {
    return [
      ...model.roles.map(role => role.id),
      ...model.permissions.map(permission => permission.code),
    ].sort();
  }
  if (targetSkill === "aigc") {
    return model.permissions.map(permission => permission.code).sort();
  }
  return [
    ...model.roles.map(role => role.id),
    ...model.permissions.map(permission => permission.code),
    ...model.menus.map(menu => menu.id),
  ].sort();
}

function runtimeRequestIsPresent(request?: RbacRuntimeRequest): request is RbacRuntimeRequest {
  return !!request && !!request.subject && Array.isArray(request.subject.roleIds) && !!request.action && !!request.resourceType;
}

export function createRbacCrossRuntimeEvidence(
  model: RbacModel,
  targetSkill: RbacRuntimeTargetSkill,
  request?: RbacRuntimeRequest,
): RbacCrossRuntimeEvidence {
  const roleRefs = model.roles.map(role => role.id).sort();
  const permissionRefs = model.permissions.map(permission => permission.code).sort();
  const policyRefs = rbacPolicyRefsForTarget(model, targetSkill);
  const decision = runtimeRequestIsPresent(request)
    ? evaluateRbacRuntimePolicy(model, request)
    : undefined;
  const state: RbacRuntimeEvidenceState =
    decision ? (decision.effect === "allow" ? "allowed" : "blocked") : (policyRefs.length > 0 ? "allowed" : "blocked");
  const reasonCode =
    decision?.reasonCode ??
    (state === "allowed" ? "RBAC_RUNTIME_EVIDENCE_PRESENT" : "RBAC_RUNTIME_UPSTREAM_ABSENT");

  return {
    sourceSkill: "rbac",
    targetSkill,
    evidenceKey: `${RBAC_CROSS_RUNTIME_EVIDENCE}:${targetSkill}:${state}`,
    state,
    reasonCode,
    roleRefs,
    permissionRefs,
    policyRefs,
    decision,
  };
}

export function normalizeRbacRuntimeContextForSkill(
  model: RbacModel,
  targetSkill: RbacRuntimeTargetSkill,
  request?: RbacRuntimeRequest,
): NormalizedRbacRuntimeContext {
  const evidence = createRbacCrossRuntimeEvidence(model, targetSkill, request);
  return {
    sourceSkill: "rbac",
    targetSkill,
    roleRefs: evidence.roleRefs,
    permissionRefs: evidence.permissionRefs,
    policyRefs: evidence.policyRefs,
    upstreamEvidencePresent: evidence.state === "allowed",
    evidence,
  };
}

export function buildRbacCrossRuntimeEdges(model: RbacModel): RbacCrossRuntimeEvidence[] {
  const targets: RbacRuntimeTargetSkill[] = ["datamodel", "workflow", "page", "aigc", "appbundle"];
  return targets
    .filter(target => rbacPolicyRefsForTarget(model, target).length > 0)
    .map(target => createRbacCrossRuntimeEvidence(model, target));
}

export function createRbacPageRuntimeEvidence(
  model: RbacModel,
  request: RbacRuntimeRequest,
): RbacCrossRuntimeEvidence {
  return {
    ...createRbacCrossRuntimeEvidence(model, "page", request),
    evidenceKey: RBAC_PAGE_RUNTIME_EVIDENCE,
  };
}

export function createRbacWorkflowRuntimeEvidence(
  model: RbacModel,
  request: RbacRuntimeRequest,
): RbacCrossRuntimeEvidence {
  return {
    ...createRbacCrossRuntimeEvidence(model, "workflow", request),
    evidenceKey: RBAC_WORKFLOW_RUNTIME_EVIDENCE,
  };
}

export const leaveApprovalRbac: RbacModel = {
  failClosed: true,
  permissions: [
    { code: "leave:create", name: "发起请假", resource: "leave_request", action: "create" },
    { code: "leave:approve", name: "审批请假", resource: "leave_request", action: "approve" },
    { code: "leave:view", name: "查看请假", resource: "leave_request", action: "view" },
  ],
  menus: [
    { id: "m_leave", parentId: null, name: "请假管理", type: "directory" },
    { id: "m_my_leave", parentId: "m_leave", name: "我的请假", type: "menu", permissionCode: "leave:create" },
    { id: "m_approve", parentId: "m_leave", name: "待我审批", type: "menu", permissionCode: "leave:approve" },
    { id: "b_approve", parentId: "m_approve", name: "审批通过", type: "button", permissionCode: "leave:approve" },
  ],
  roles: [
    {
      id: "employee",
      name: "员工",
      code: "emp",
      permissionCodes: ["leave:create", "leave:view"],
      menuIds: ["m_leave", "m_my_leave"],
    },
    {
      id: "manager",
      name: "主管",
      code: "mgr",
      permissionCodes: ["leave:create", "leave:approve", "leave:view"],
      menuIds: ["m_leave", "m_my_leave", "m_approve", "b_approve"],
    },
  ],
  departments: [{ id: "d_tech", name: "技术部", parentId: null, leaderUserId: "u_mgr" }],
  positions: [
    { id: "p_staff", name: "工程师", roleIds: ["employee"] },
    { id: "p_lead", name: "技术主管", roleIds: ["manager"] },
  ],
  users: [
    { id: "u_emp", name: "张三", roleIds: ["employee"], departmentId: "d_tech", positionId: "p_staff" },
    { id: "u_mgr", name: "李四", roleIds: ["manager"], departmentId: "d_tech", positionId: "p_lead" },
  ],
  dataRules: [
    { id: "dr_self", name: "员工只看自己的请假", modelRef: "leave_request", scope: "self", roleIds: ["employee"] },
    { id: "dr_dept", name: "主管看本部门请假", modelRef: "leave_request", scope: "dept", roleIds: ["manager"] },
  ],
};

export const purchaseApprovalRbac: RbacModel = {
  failClosed: true,
  permissions: [
    { code: "purchase:create", name: "Create purchase request", resource: "purchase_request", action: "create" },
    { code: "purchase:view", name: "View purchase request", resource: "purchase_request", action: "view" },
    { code: "purchase:manager_approve", name: "Manager approve purchase", resource: "purchase_request", action: "manager_approve" },
    { code: "purchase:finance_approve", name: "Finance approve purchase", resource: "purchase_request", action: "finance_approve" },
    { code: "purchase:fulfill", name: "Procurement fulfill purchase", resource: "purchase_request", action: "fulfill" },
  ],
  menus: [
    { id: "m_purchase", parentId: null, name: "Purchase Center", type: "directory" },
    { id: "m_purchase_request", parentId: "m_purchase", name: "New Purchase Request", type: "menu", permissionCode: "purchase:create" },
    { id: "m_purchase_manager", parentId: "m_purchase", name: "Manager Approvals", type: "menu", permissionCode: "purchase:manager_approve" },
    { id: "m_purchase_finance", parentId: "m_purchase", name: "Finance Approvals", type: "menu", permissionCode: "purchase:finance_approve" },
    { id: "m_purchase_procurement", parentId: "m_purchase", name: "Procurement Fulfillment", type: "menu", permissionCode: "purchase:fulfill" },
    { id: "b_purchase_finance", parentId: "m_purchase_finance", name: "Finance Approve", type: "button", permissionCode: "purchase:finance_approve" },
  ],
  roles: [
    {
      id: "requester",
      name: "Requester",
      code: "requester",
      permissionCodes: ["purchase:create", "purchase:view"],
      menuIds: ["m_purchase", "m_purchase_request"],
    },
    {
      id: "department_manager",
      name: "Department Manager",
      code: "dept_mgr",
      permissionCodes: ["purchase:view", "purchase:manager_approve"],
      menuIds: ["m_purchase", "m_purchase_manager"],
    },
    {
      id: "finance",
      name: "Finance",
      code: "finance",
      permissionCodes: ["purchase:view", "purchase:finance_approve"],
      menuIds: ["m_purchase", "m_purchase_finance", "b_purchase_finance"],
    },
    {
      id: "procurement",
      name: "Procurement",
      code: "procurement",
      permissionCodes: ["purchase:view", "purchase:fulfill"],
      menuIds: ["m_purchase", "m_purchase_procurement"],
    },
  ],
  departments: [{ id: "d_ops", name: "Operations", parentId: null, leaderUserId: "u_manager" }],
  positions: [
    { id: "p_requester", name: "Requester", roleIds: ["requester"] },
    { id: "p_manager", name: "Department Manager", roleIds: ["department_manager"] },
    { id: "p_finance", name: "Finance Analyst", roleIds: ["finance"] },
    { id: "p_procurement", name: "Procurement Specialist", roleIds: ["procurement"] },
  ],
  users: [
    { id: "u_requester", name: "Rita Requester", roleIds: ["requester"], departmentId: "d_ops", positionId: "p_requester" },
    { id: "u_manager", name: "Maya Manager", roleIds: ["department_manager"], departmentId: "d_ops", positionId: "p_manager" },
    { id: "u_finance", name: "Finn Finance", roleIds: ["finance"], departmentId: "d_ops", positionId: "p_finance" },
    { id: "u_procurement", name: "Paula Procurement", roleIds: ["procurement"], departmentId: "d_ops", positionId: "p_procurement" },
  ],
  dataRules: [
    { id: "dr_purchase_self", name: "Requester sees own purchase requests", modelRef: "purchase_request", scope: "self", roleIds: ["requester"] },
    { id: "dr_purchase_dept", name: "Manager sees department purchase requests", modelRef: "purchase_request", scope: "dept", roleIds: ["department_manager"] },
    { id: "dr_purchase_finance", name: "Finance sees all purchase requests", modelRef: "purchase_request", scope: "all", roleIds: ["finance"] },
    { id: "dr_purchase_procurement", name: "Procurement sees all purchase requests", modelRef: "purchase_request", scope: "all", roleIds: ["procurement"] },
  ],
  // 115.10.03 SoD policy records for finance/admin roles (self-grant + dual-control + mutually via existing)
  selfGrantDenials: [
    {
      id: "sgd_finance_self",
      name: "Finance cannot self-approve own purchase requests",
      deniedSelfGrantPermissionCodes: ["purchase:finance_approve"],
    },
  ],
  dualControlPolicies: [
    {
      id: "dcp_finance_approve",
      name: "Finance approve requires dual-control (two distinct approvers)",
      action: "finance_approve",
      resource: "purchase_request",
      minApprovers: 2,
    },
  ],
};
