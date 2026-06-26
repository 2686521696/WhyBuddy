import { describe, expect, it } from "vitest";

import { leaveApprovalRbac, rbacSkill } from "./rbacSkill";
import type { RbacModel } from "./rbacModel";

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
});
