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
import type { PolicyContext, PolicyDecision, RbacModel } from "./rbacModel";

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

// ---------------------------------------------------------------------------
// The skill
// ---------------------------------------------------------------------------

export const rbacSkill: Skill<RbacModel> & CrossSkill<RbacModel> = {
  id: "rbac",
  title: "RBAC 权限",

  // -- CROSS-SKILL declarations (for the combined relation graph) -----------
  crossRefs(model: RbacModel): CrossRefEdge[] {
    // data rules point OUT at the DataModel skill's entities.
    return model.dataRules.map(d => ({
      fromNode: `rule_${sanitizeId(d.id)}`,
      toSkill: "datamodel",
      toKind: "entity",
      toValue: d.modelRef,
      label: "数据",
    }));
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
        return `perm_${v}`;
      case "decision":
        return `decision_${sanitizeId(value)}`;
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
            code: "RBAC_SOD_VIOLATION",
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

    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}["${n.label}"]`);
    for (const e of edges) {
      const arrow = e.kind === "cross" ? "-.->" : "-->";
      lines.push(`  ${e.from} ${arrow}|${e.label ?? ""}| ${e.to}`);
    }
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  // -- THE CROSS-SKILL SURFACE (other skills reference these) --------------
  // RBAC PDP: resolve() exposes role, permission, policy, and decision surfaces for PDP consumers
  resolve(model: RbacModel): ResolvableSurface {
    const decisionCodes = ["RBAC_DECISION_ALLOW", "RBAC_DECISION_FAIL_CLOSED"];
    return {
      role: model.roles.map(r => r.id),
      permission: model.permissions.map(p => p.code),
      policy: model.permissions.map(p => p.code),
      decision: decisionCodes,
      menu: model.menus.map(m => m.id),
      department: model.departments.map(d => d.id),
      position: model.positions.map(p => p.id),
      user: model.users.map(u => u.id),
    };
  },

  // -- THE LLM SEAM (stub; real impl asks SlideRule to fill the metamodel) --
  async generate(intent: string): Promise<RbacModel> {
    // In production this prompts the reasoning engine to emit a RbacModel for `intent`,
    // constrained by the metamodel above. For the sample we return the worked example
    // when the intent is about leave approval, else throw so callers don't get a fake.
    if (/请假|leave/i.test(intent)) return leaveApprovalRbac;
    throw new Error(`rbacSkill.generate: 需要接入推演引擎来为意图生成模型：「${intent}」`);
  },
};

/** Pure PDP decision: returns allow only when RBAC can prove the subject has a matching permission
 * via direct or inherited roles. Missing role/perm/resource => deny + RBAC_DECISION_FAIL_CLOSED.
 * Objective, no browser/user coupling.
 */
export function decideRbacPolicy(model: RbacModel, request: PolicyContext): PolicyDecision {
  if (!request || !request.subject || !Array.isArray(request.subject.roleIds)) {
    return { allow: false, code: "RBAC_DECISION_FAIL_CLOSED", reason: "missing or invalid subject" };
  }
  const reqRoles = request.subject.roleIds;
  if (reqRoles.length === 0 || !request.action || !request.resourceType) {
    return { allow: false, code: "RBAC_DECISION_FAIL_CLOSED", reason: "missing policy inputs (roles/action/resource)" };
  }

  const roleMap = new Map(model.roles.map(r => [r.id, r]));
  const permMap = new Map(model.permissions.map(p => [p.code, p]));

  // deny if any requested role missing
  const missingRole = reqRoles.find(rid => !roleMap.has(rid));
  if (missingRole != null) {
    return { allow: false, code: "RBAC_DECISION_FAIL_CLOSED", reason: `role missing: ${missingRole}` };
  }

  // expand (inheritance)
  const effectiveRoleIds = expandEffectiveRoles(model.roles, reqRoles);

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

  if (matchedPermission) {
    return {
      allow: true,
      code: "RBAC_DECISION_ALLOW",
      reason: `granted by ${matchedPermission}`,
      expandedRoles: effectiveRoleIds,
      matchedPermission,
    };
  }

  // unknown permission request or not granted => fail closed, never allow
  return {
    allow: false,
    code: "RBAC_DECISION_FAIL_CLOSED",
    reason: "no matching permission for the requested action/resource",
    expandedRoles: effectiveRoleIds,
  };
}

// ---------------------------------------------------------------------------
// Worked example — a "请假审批" platform's RBAC slice (a coherent, valid instance)
// ---------------------------------------------------------------------------

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
