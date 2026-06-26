import { describe, expect, it } from "vitest";

import { leaveApprovalWorkflow, workflowSkill } from "./workflowSkill";
import type { WorkflowModel } from "./workflowModel";
import { leaveApprovalRbac, rbacSkill } from "../rbac/rbacSkill";
import { dataModelSkill, leaveRequestDataModel } from "../datamodel/dataModelSkill";

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
    expect(projection.mermaid).toContain('wf_b{"审批结果<br/>leave_request.approved"}'); // branch shows SSOT field ref
    expect(projection.mermaid).toContain("@manager"); // approval shows its delegated PDP role ref
    expect(projection.mermaid).toContain("默认"); // the else edge label
  });
});

describe("workflowSkill — V2 PEP model delegation (without changing execution semantics)", () => {
  it("Workflow model expresses PEP via actorRoleRef/policyCheckRefs/fieldRefs/traceSpan and pep marker", () => {
    expect(leaveApprovalWorkflow.pep).toBe("pep");
    expect(leaveApprovalWorkflow.actorRoleRef).toBe("employee");
    expect(leaveApprovalWorkflow.policyCheckRefs).toContain("leave:approve");
    expect(leaveApprovalWorkflow.fieldRefs).toContain("leave_request.approved");
    expect(leaveApprovalWorkflow.traceSpan).toBe("wf.leave.approval");
  });

  it("approval node mirrors assignee into assigneeRoleRef for RBAC PDP while keeping assigneeRole", () => {
    const mgr = leaveApprovalWorkflow.nodes.find(n => n.id === "a_mgr")!;
    expect(mgr.assigneeRole).toBe("manager");
    expect(mgr.assigneeRoleRef).toBe("manager");
  });

  it("branch node uses fieldRef as DataModel SSOT ref (local field kept for reachability)", () => {
    const branch = leaveApprovalWorkflow.nodes.find(n => n.id === "b")!;
    expect(branch.field).toBe("approved");
    expect(branch.fieldRef).toBe("leave_request.approved");
  });

  it("PEP refs can be set on model and validate/reachability/termination unchanged", () => {
    const pepClone = clone(leaveApprovalWorkflow);
    // PEP delegation fields do not affect graph
    pepClone.actorRoleRef = "employee";
    pepClone.policyCheckRefs = ["leave:approve", "leave:view"];
    pepClone.fieldRefs = ["leave_request.approved"];
    pepClone.traceSpan = "trace-113";
    const report = workflowSkill.validate(pepClone, { external: rbacSurface });
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    // reachability preserved: would have failed the original unreachable/non-term tests if broken
    expect(pepClone.nodes.length).toBeGreaterThan(3);
  });

  it("CATCHES local auth checks without PDP delegation (approvals present but no PEP/policy refs) with WF_PEP_BYPASS", () => {
    const broken = clone(leaveApprovalWorkflow);
    delete (broken as any).policyCheckRefs;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_PEP_BYPASS")).toBe(true);
  });
});

describe("workflowSkill ←→ dataModelSkill (SSOT field binding for PEP)", () => {
  const dmSurface = { datamodel: dataModelSkill.resolve(leaveRequestDataModel) };

  it("passes cleanly when branch fieldRef and model fieldRefs resolve to DataModel", () => {
    const report = workflowSkill.validate(leaveApprovalWorkflow, { external: dmSurface });
    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "WF_SSOT_MISSING_FIELD")).toBe(false);
  });

  it("ERRORS when a workflow branch/form field referencing a missing DataModel field with Workflow-specific missing SSOT code", () => {
    const broken = clone(leaveApprovalWorkflow);
    broken.nodes.find(n => n.id === "b")!.fieldRef = "leave_request.missing_approved";
    const report = workflowSkill.validate(broken, { external: dmSurface });
    expect(report.ok).toBe(false);
    const hit = report.errors.find(e => e.code === "WF_SSOT_MISSING_FIELD");
    expect(hit).toBeTruthy();
    expect(hit!.message).toContain("leave_request.missing_approved");
  });

  it("ERRORS on model-level fieldRefs missing in DataModel SSOT", () => {
    const broken = clone(leaveApprovalWorkflow);
    broken.fieldRefs = ["leave_request.nonexistent"];
    const report = workflowSkill.validate(broken, { external: dmSurface });
    expect(report.errors.some(e => e.code === "WF_SSOT_MISSING_FIELD")).toBe(true);
  });
});
