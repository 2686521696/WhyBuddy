import { describe, expect, it } from "vitest";

import { leaveApprovalWorkflow, workflowSkill } from "./workflowSkill";
import type { WorkflowModel } from "./workflowModel";
import { leaveApprovalRbac, rbacSkill } from "../rbac/rbacSkill";

const clone = (m: WorkflowModel): WorkflowModel => structuredClone(m);

// The RBAC skill's cross-skill surface, threaded in exactly as SlideRule would do it.
const rbacSurface = { rbac: rbacSkill.resolve(leaveApprovalRbac) };

describe("workflowSkill — execution-semantics gate", () => {
  it("passes the coherent 请假审批 flow (assignee warning only, no errors)", () => {
    const report = workflowSkill.validate(leaveApprovalWorkflow);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    // no RBAC surface threaded → honest 'unresolved' warning, not a silent pass
    expect(report.warnings.some(w => w.code === "WF_ASSIGNEE_UNRESOLVED")).toBe(true);
  });

  it("CATCHES a branch with no default on a non-enum field (path would get stuck)", () => {
    const broken = clone(leaveApprovalWorkflow);
    broken.edges.find(e => e.id === "t4")!.isDefault = false; // remove the else-branch
    broken.edges.find(e => e.id === "t4")!.when = { op: "==", value: false };
    // now both edges are conditional equality on a boolean, but boolean is non-enum → needs default
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_BRANCH_NO_DEFAULT")).toBe(true);
  });

  it("CATCHES an unreachable node", () => {
    const broken = clone(leaveApprovalWorkflow);
    broken.nodes.push({ id: "orphan", type: "approval", name: "孤儿审批", assigneeRole: "manager" });
    broken.edges.push({ id: "t5", from: "orphan", to: "e_ok" });
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_UNREACHABLE_NODE")).toBe(true);
  });

  it("CATCHES a dead-end node that can never reach an end", () => {
    const broken = clone(leaveApprovalWorkflow);
    // make the approval loop back to itself instead of going forward → non-terminating
    broken.edges.find(e => e.id === "t2")!.to = "a_mgr";
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_NON_TERMINATING")).toBe(true);
  });

  it("CATCHES an approval node with no assignee role", () => {
    const broken = clone(leaveApprovalWorkflow);
    delete broken.nodes.find(n => n.id === "a_mgr")!.assigneeRole;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_APPROVAL_NO_ASSIGNEE")).toBe(true);
  });
});

describe("workflowSkill ←→ rbacSkill (the real cross-skill link)", () => {
  it("passes cleanly when the assignee role exists in the RBAC surface", () => {
    const report = workflowSkill.validate(leaveApprovalWorkflow, { external: rbacSurface });
    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.code === "WF_ASSIGNEE_UNRESOLVED")).toBe(false);
  });

  it("ERRORS when the workflow assigns approval to a role RBAC never defined", () => {
    const broken = clone(leaveApprovalWorkflow);
    broken.nodes.find(n => n.id === "a_mgr")!.assigneeRole = "director"; // not in RBAC sample
    const report = workflowSkill.validate(broken, { external: rbacSurface });
    expect(report.ok).toBe(false);
    const hit = report.errors.find(e => e.code === "WF_ASSIGNEE_MISSING_ROLE");
    expect(hit).toBeTruthy();
    expect(hit!.message).toContain("director");
  });
});

describe("workflowSkill — projector", () => {
  it("derives a top-down flow diagram with branch shape + condition labels", () => {
    const projection = workflowSkill.project(leaveApprovalWorkflow);
    expect(projection.mermaid.startsWith("flowchart TD")).toBe(true);
    expect(projection.mermaid).toContain('wf_b{"审批结果"}'); // branch rhombus
    expect(projection.mermaid).toContain("@manager"); // approval shows its RBAC role
    expect(projection.mermaid).toContain("默认"); // the else edge label
  });
});
