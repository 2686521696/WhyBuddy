import { describe, expect, it } from "vitest";

import { decideRbacPolicy, leaveApprovalRbac, rbacSkill } from "./rbacSkill";
import type { PolicyContext, PolicyDecision, RbacModel } from "./rbacModel";

// Deep clone so each test can mutate a fresh copy without leaking.
const clone = (m: RbacModel): RbacModel => structuredClone(m);

describe("rbacSkill — the gate (validate)", () => {
  it("passes a coherent 请假审批 model (only a cross-skill warning, no errors)", () => {
    const report = rbacSkill.validate(leaveApprovalRbac);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    // data rules point at the DataModel skill, which wasn't threaded in → honest warning, not a lie.
    expect(report.warnings.some(w => w.code === "RBAC_CROSS_REF_UNRESOLVED")).toBe(true);
  });

  it("CATCHES a dangling permission reference (the gate earns its keep)", () => {
    const broken = clone(leaveApprovalRbac);
    broken.roles[0].permissionCodes.push("leave:delete"); // never defined
    const report = rbacSkill.validate(broken);
    expect(report.ok).toBe(false);
    const hit = report.errors.find(e => e.code === "RBAC_REF_MISSING_PERMISSION");
    expect(hit).toBeTruthy();
    expect(hit!.path).toBe("roles[employee].permissionCodes[2]");
  });

  it("CATCHES a user pointing at a non-existent role", () => {
    const broken = clone(leaveApprovalRbac);
    broken.users[0].roleIds = ["ghost_role"];
    const report = rbacSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "RBAC_REF_MISSING_ROLE")).toBe(true);
  });

  it("CATCHES a cycle in the menu tree", () => {
    const broken = clone(leaveApprovalRbac);
    // make m_leave point to its own grandchild → cycle
    broken.menus.find(m => m.id === "m_leave")!.parentId = "b_approve";
    const report = rbacSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "RBAC_MENU_TREE_FAULT")).toBe(true);
  });

  it("resolves a cross-skill data model ref to a hard ERROR when the entity is absent", () => {
    const report = rbacSkill.validate(leaveApprovalRbac, {
      external: { datamodel: { entity: ["something_else"] } },
    });
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "RBAC_CROSS_REF_MISSING")).toBe(true);
  });

  it("passes cleanly when the DataModel surface DOES contain the referenced entity", () => {
    const report = rbacSkill.validate(leaveApprovalRbac, {
      external: { datamodel: { entity: ["leave_request"] } },
    });
    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.code === "RBAC_CROSS_REF_UNRESOLVED")).toBe(false);
  });
});

describe("rbacSkill — cross-skill surface (resolve)", () => {
  it("exposes role ids for other skills (e.g. Workflow assignee) to reference", () => {
    const surface = rbacSkill.resolve(leaveApprovalRbac);
    expect(surface.role).toEqual(["employee", "manager"]);
    expect(surface.permission).toContain("leave:approve");
  });

  it("exposes role, permission, policy, and decision surfaces", () => {
    const surface = rbacSkill.resolve(leaveApprovalRbac);
    expect(surface.role).toBeDefined();
    expect(surface.permission).toBeDefined();
    expect(surface.policy).toBeDefined();
    expect(Array.isArray(surface.policy)).toBe(true);
    expect(surface.decision).toBeDefined();
    expect(Array.isArray(surface.decision)).toBe(true);
    expect(surface.decision).toContain("RBAC_DECISION_FAIL_CLOSED");
  });

  it("refNodeId(\"role\", \"manager\") maps to the real role node", () => {
    const nodeId = rbacSkill.refNodeId("role", "manager");
    expect(nodeId).toBe("role_manager");
    const proj = rbacSkill.project(leaveApprovalRbac);
    expect(proj.nodes.some(n => n.id === nodeId)).toBe(true);
  });
});

describe("rbacSkill — projector (architecture diagram falls out of the model)", () => {
  it("derives nodes/edges and a mermaid diagram from the model, not by hand", () => {
    const projection = rbacSkill.project(leaveApprovalRbac);
    expect(projection.nodes.some(n => n.kind === "role" && n.label === "主管")).toBe(true);
    // 主管 role -> leave:approve permission edge exists
    expect(
      projection.edges.some(e => e.from === "role_manager" && e.to === "perm_leave_approve"),
    ).toBe(true);
    expect(projection.mermaid.startsWith("flowchart LR")).toBe(true);
  });

  it("contains PDP host, fail-closed, inheritance, and SoD nodes when the model declares them", () => {
    const projection = rbacSkill.project(leaveApprovalRbac);
    expect(projection.nodes.some(n => n.kind === "pdp-host" && n.label === "RBAC PDP")).toBe(true);
    expect(projection.nodes.some(n => n.label === "fail-closed")).toBe(true);
    expect(projection.nodes.some(n => n.kind === "decision")).toBe(true);
    // add inheritance + SoD to model (base declares failClosed)
    const m = clone(leaveApprovalRbac);
    m.roles.find(r => r.id === "manager")!.inheritsRoleIds = ["employee"];
    m.sodRules = [
      {
        id: "sod_test",
        name: "测试SoD",
        exclusiveRoleIds: ["employee", "manager"],
        severity: "error",
      },
    ];
    const p2 = rbacSkill.project(m);
    expect(p2.nodes.some(n => n.kind === "inheritance")).toBe(true);
    expect(p2.nodes.some(n => n.kind === "sod" && n.id.includes("sod_test"))).toBe(true);
  });
});

// V2 PDP model extensions (inheritance, SoD rules, PolicyContext, fail-closed)
describe("rbac model — V2 PDP extensions (113.02)", () => {
  it("supports role inheritance metadata via inheritsRoleIds", () => {
    const m = clone(leaveApprovalRbac);
    const manager = m.roles.find(r => r.id === "manager")!;
    manager.inheritsRoleIds = ["employee"];
    expect(manager.inheritsRoleIds).toEqual(["employee"]);
    // manager now inherits from employee while keeping own perms
    expect(m.roles.some(r => r.inheritsRoleIds && r.inheritsRoleIds.includes("employee"))).toBe(true);
  });

  it("supports SoD metadata via sodRules (role-based separation of duty)", () => {
    const m: RbacModel = {
      ...clone(leaveApprovalRbac),
      sodRules: [
        {
          id: "sod_create_approve",
          name: "发起与审批不得同一角色",
          exclusiveRoleIds: ["employee", "manager"],
          severity: "error",
        },
      ],
    };
    expect(m.sodRules).toBeDefined();
    expect(m.sodRules![0].id).toBe("sod_create_approve");
    expect(m.sodRules![0].exclusiveRoleIds).toContain("employee");
  });

  it("exposes typed PolicyContext for PDP requests", () => {
    const ctx: PolicyContext = {
      subject: { roleIds: ["manager"] },
      action: "approve",
      resourceType: "leave_request",
      resourceId: "lr_42",
      tenantId: "t1",
      scope: "dept",
    };
    expect(ctx.subject.roleIds).toContain("manager");
    expect(ctx.action).toBe("approve");
    expect(ctx.resourceType).toBe("leave_request");
  });

  it("requires/declares failClosed: true for fail-closed posture on the leave approval sample", () => {
    expect(leaveApprovalRbac.failClosed).toBe(true);
    // do not allow permissive default in tests
    expect(leaveApprovalRbac.failClosed).not.toBe(false);
  });

  it("fail-closed defaults posture is fail-closed (not permissive)", () => {
    // new models should declare failClosed true to be explicit; absence is treated strict in V2 PDP
    const fresh: RbacModel = {
      ...clone(leaveApprovalRbac),
      failClosed: true,
      sodRules: [],
    };
    expect(fresh.failClosed).toBe(true);
    // existing sample remains valid (optional field)
    const report = rbacSkill.validate(leaveApprovalRbac);
    expect(report.ok).toBe(true);
  });
});

// V2 PDP gate tests (113.03): inheritance cycles, SoD, fail-closed decisions. Do not weaken.
describe("rbac PDP gate — decideRbacPolicy and validate errors (113.03)", () => {
  it("CATCHES inheritance cycle and emits RBAC_ROLE_INHERITANCE_CYCLE", () => {
    const broken = clone(leaveApprovalRbac);
    // cycle: employee <-> manager
    broken.roles.find(r => r.id === "employee")!.inheritsRoleIds = ["manager"];
    broken.roles.find(r => r.id === "manager")!.inheritsRoleIds = ["employee"];
    const report = rbacSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "RBAC_ROLE_INHERITANCE_CYCLE")).toBe(true);
  });

  it("CATCHES mutually exclusive roles (direct) and emits RBAC_SOD_VIOLATION", () => {
    const m: RbacModel = {
      ...clone(leaveApprovalRbac),
      sodRules: [
        {
          id: "sod_emp_mgr",
          name: "员工与主管互斥",
          exclusiveRoleIds: ["employee", "manager"],
          severity: "error",
        },
      ],
    };
    m.users[0].roleIds = ["employee", "manager"];
    const report = rbacSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "RBAC_SOD_VIOLATION")).toBe(true);
  });

  it("CATCHES SoD via inherited roles and emits RBAC_SOD_VIOLATION", () => {
    const m: RbacModel = {
      ...clone(leaveApprovalRbac),
      sodRules: [
        {
          id: "sod_emp_mgr",
          name: "员工与主管互斥",
          exclusiveRoleIds: ["employee", "manager"],
          severity: "error",
        },
      ],
    };
    // manager inherits employee => assigning manager alone triggers via expand
    m.roles.find(r => r.id === "manager")!.inheritsRoleIds = ["employee"];
    m.users[0].roleIds = ["manager"];
    const report = rbacSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "RBAC_SOD_VIOLATION")).toBe(true);
  });

  it("decideRbacPolicy allows when permission is granted directly or via inheritance", () => {
    const m = clone(leaveApprovalRbac);
    m.roles.find(r => r.id === "manager")!.inheritsRoleIds = ["employee"];
    const d1 = decideRbacPolicy(m, {
      subject: { roleIds: ["employee"] },
      action: "create",
      resourceType: "leave_request",
    });
    expect(d1.allow).toBe(true);
    expect(d1.code).toBe("RBAC_DECISION_ALLOW");

    const d2 = decideRbacPolicy(m, {
      subject: { roleIds: ["manager"] },
      action: "approve",
      resourceType: "leave_request",
    });
    expect(d2.allow).toBe(true);
    expect(d2.code).toBe("RBAC_DECISION_ALLOW");
    expect(d2.expandedRoles).toContain("employee");
  });

  it("decideRbacPolicy denies unknown role and uses RBAC_DECISION_FAIL_CLOSED", () => {
    const dec = decideRbacPolicy(leaveApprovalRbac, {
      subject: { roleIds: ["ghost_role"] },
      action: "approve",
      resourceType: "leave_request",
    });
    expect(dec.allow).toBe(false);
    expect(dec.code).toBe("RBAC_DECISION_FAIL_CLOSED");
  });

  it("decideRbacPolicy denies missing policy inputs and uses RBAC_DECISION_FAIL_CLOSED", () => {
    const dec1 = decideRbacPolicy(leaveApprovalRbac, {
      subject: { roleIds: [] },
      action: "approve",
      resourceType: "leave_request",
    });
    expect(dec1.allow).toBe(false);
    expect(dec1.code).toBe("RBAC_DECISION_FAIL_CLOSED");

    const dec2 = decideRbacPolicy(leaveApprovalRbac, {
      subject: { roleIds: ["employee"] },
      action: "",
      resourceType: "leave_request",
    } as PolicyContext);
    expect(dec2.allow).toBe(false);
    expect(dec2.code).toBe("RBAC_DECISION_FAIL_CLOSED");
  });

  it("decideRbacPolicy denies unknown permission request and uses RBAC_DECISION_FAIL_CLOSED", () => {
    const dec = decideRbacPolicy(leaveApprovalRbac, {
      subject: { roleIds: ["employee"] },
      action: "delete",
      resourceType: "leave_request",
    });
    expect(dec.allow).toBe(false);
    expect(dec.code).toBe("RBAC_DECISION_FAIL_CLOSED");
  });

  it("decideRbacPolicy denies when role lacks the permission (no allow leak)", () => {
    const dec = decideRbacPolicy(leaveApprovalRbac, {
      subject: { roleIds: ["employee"] },
      action: "approve",
      resourceType: "leave_request",
    });
    expect(dec.allow).toBe(false);
    expect(dec.code).toBe("RBAC_DECISION_FAIL_CLOSED");
  });
});
