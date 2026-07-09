import { describe, expect, it } from "vitest";

import {
  buildWorkflowFormRuntime,
  buildWorkflowCrossRuntimeEdges,
  createWorkflowDataModelRuntimeEvidence,
  createWorkflowRbacRuntimeEvidence,
  createWorkflowPageRuntimeEvidence,
  createWorkflowToAppBundleRuntimeEvidence,
  createWorkflowInstanceSnapshot,
  leaveApprovalWorkflow,
  normalizeWorkflowRuntimeContextForSkill,
  policyEvidence,
  purchaseApprovalWorkflow,
  resolveWorkflowAssignees,
  startWorkflowInstance,
  traceWorkflowRuntimeEvidenceToAppBundleClosureEvidence,
  traceWorkflowTaskStateToPageTaskSurfaceEvidence,
  transitionWorkflowInstance,
  validateWorkflowInstanceSnapshot,
  WF_ASSIGNEE_PDP_DENIED,
  WF_DATAMODEL_RUNTIME_EVIDENCE,
  WF_PAGE_RUNTIME_EVIDENCE,
  WF_RBAC_RUNTIME_EVIDENCE,
  WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE,
  WF_WORKFLOW_TO_APPBUNDLE_TRACE,
  WF_WORKFLOW_TO_PAGE_TRACE,
  workflowSkill,
  WF_RUNTIME_INVALID_TRANSITION,
  createWorkflowAssigneePolicyEvidenceFromDecision,
} from "./workflowSkill";
import type { WorkflowInstance, WorkflowInstanceSnapshot, WorkflowModel, WorkflowTransitionCommand } from "./workflowModel";
import { leaveApprovalRbac, purchaseApprovalRbac, rbacSkill, decideRbacPolicy } from "../rbac/rbacSkill";
import { dataModelSkill, leaveRequestDataModel } from "../datamodel/dataModelSkill";
import { leaveApprovalPage } from "../page/pageSkill";
import { evaluateAppBundleRuntimeClosure, leaveApprovalAppBundle } from "../appbundle/appBundleSkill";
import type { PolicyDecision } from "../rbac/rbacModel";

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
    delete broken.nodes.find(n => n.id === "a_mgr")!.assigneeRoleRef;
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
    broken.nodes.find(n => n.id === "a_mgr")!.assigneeRoleRef = "director";
    const report = workflowSkill.validate(broken, { external: rbacSurface });
    expect(report.ok).toBe(false);
    const hit = report.errors.find(e => e.code === "WF_ASSIGNEE_MISSING_ROLE");
    expect(hit).toBeTruthy();
    expect(hit!.message).toContain("director");
  });

  it("uses assigneeRoleRef as the authoritative RBAC PDP role ref", () => {
    const broken = clone(leaveApprovalWorkflow);
    const approval = broken.nodes.find(n => n.id === "a_mgr")!;
    approval.assigneeRole = "manager";
    approval.assigneeRoleRef = "director";

    const report = workflowSkill.validate(broken, { external: rbacSurface });

    expect(report.ok).toBe(false);
    const hit = report.errors.find(e => e.code === "WF_ASSIGNEE_MISSING_ROLE");
    expect(hit).toBeTruthy();
    expect(hit!.path).toBe("nodes[a_mgr].assigneeRoleRef");
    expect(hit!.message).toContain("director");
  });

  it("requires assigneeRoleRef on approval nodes even when legacy assigneeRole exists", () => {
    const broken = clone(leaveApprovalWorkflow);
    const approval = broken.nodes.find(n => n.id === "a_mgr")!;
    approval.assigneeRole = "manager";
    delete approval.assigneeRoleRef;

    const report = workflowSkill.validate(broken, { external: rbacSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_ASSIGNEE_ROLE_REF_REQUIRED")).toBe(true);
  });
});

describe("workflowSkill — projector", () => {
  it("derives a top-down flow diagram with branch shape + condition labels", () => {
    const projection = workflowSkill.project(leaveApprovalWorkflow);
    expect(projection.mermaid.startsWith("flowchart TD")).toBe(true);
    expect(projection.mermaid).toContain('wf_b{"审批结果<br/>leave_request.approved"}'); // branch shows SSOT field ref
    expect(projection.mermaid).toContain("@manager"); // approval shows its delegated PDP role ref
    expect(projection.mermaid).toContain("默认"); // the else edge label
    expect(projection.mermaid).toContain("(any)"); // approval mode in diagram
    expect(projection.mermaid).toContain("v1.0.0"); // version in diagram / version node
    expect(projection.nodes.some(n => n.kind === "version")).toBe(true); // version node projected
    expect(projection.mermaid).toContain("wf_wf_leave_approval_ver"); // version node id in mermaid
  });

  it("projects approval nodes with dashed edges to RBAC role nodes", () => {
    const projection = workflowSkill.project(leaveApprovalWorkflow);

    expect(projection.nodes.some(n => n.id === "role_manager" && n.kind === "rbacRole")).toBe(true);
    expect(projection.edges.some(e => e.from === "wf_a_mgr" && e.to === "role_manager" && e.kind === "cross")).toBe(true);
    expect(projection.mermaid).toContain("wf_a_mgr -.->|PDP role| role_manager");
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
    broken.fieldRefs = ["leave_request.missing_approved"];
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

describe("workflowSkill ←→ dataModelSkill (fieldRef lifecycle deprecation gate)", () => {
  const cloneDM = (m: any) => structuredClone(m);

  it("warns (ok=true) when Workflow fieldRef or branch fieldRef binds to deprecated DataModel SSOT field", () => {
    const depDM = cloneDM(leaveRequestDataModel);
    depDM.entities.find((e: any) => e.id === "leave_request")!.fields.find((f: any) => f.key === "approved")!.lifecycle = "deprecated";
    const surf = { datamodel: dataModelSkill.resolve(depDM) };

    const w = clone(leaveApprovalWorkflow);
    // model fieldRefs and branch fieldRef
    w.fieldRefs = ["leave_request.approved"];
    w.nodes.find((n: any) => n.id === "b")!.fieldRef = "leave_request.approved";

    const report = workflowSkill.validate(w, { external: surf });

    expect(report.ok).toBe(true);
    expect(report.warnings.some(ww => ww.code === "WF_SSOT_FIELD_DEPRECATED" && ww.message.includes("leave_request.approved"))).toBe(true);
  });

  it("errors (ok=false) when Workflow fieldRef or branch fieldRef binds to removed DataModel SSOT field", () => {
    const remDM = cloneDM(leaveRequestDataModel);
    remDM.entities.find((e: any) => e.id === "leave_request")!.fields.find((f: any) => f.key === "approved")!.lifecycle = "removed";
    const surf = { datamodel: dataModelSkill.resolve(remDM) };

    const w = clone(leaveApprovalWorkflow);
    w.fieldRefs = ["leave_request.approved"];
    w.nodes.find((n: any) => n.id === "b")!.fieldRef = "leave_request.approved";

    const report = workflowSkill.validate(w, { external: surf });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_SSOT_FIELD_REMOVED" && e.message.includes("leave_request.approved"))).toBe(true);
  });

  it("passes cleanly for active fields without emitting dep/removed lifecycle codes (existing compat)", () => {
    const dmSurface = { datamodel: dataModelSkill.resolve(leaveRequestDataModel) };
    const report = workflowSkill.validate(leaveApprovalWorkflow, { external: dmSurface });
    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.code === "WF_SSOT_FIELD_DEPRECATED")).toBe(false);
    expect(report.errors.some(e => e.code === "WF_SSOT_FIELD_REMOVED")).toBe(false);
  });
});

describe("workflowSkill — mandatory SSOT binding gate (fieldRefs/fieldRef required, local-only quarantined)", () => {
  const dmSurface = { datamodel: dataModelSkill.resolve(leaveRequestDataModel) };

  it("ERRORS with WF_SSOT_BINDING_REQUIRED when model declares local fields without fieldRefs (binding not optional)", () => {
    const broken = clone(leaveApprovalWorkflow);
    delete (broken as any).fieldRefs;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_SSOT_BINDING_REQUIRED")).toBe(true);
    expect(report.errors.some(e => e.message.includes("fieldRefs") || e.message.includes("绑定"))).toBe(true);
  });

  it("ERRORS with WF_SSOT_BINDING_REQUIRED when branch uses local field without fieldRef (must bind to entity.field SSOT)", () => {
    const broken = clone(leaveApprovalWorkflow);
    const bnode = broken.nodes.find((n: any) => n.id === "b")!;
    delete (bnode as any).fieldRef;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_SSOT_BINDING_REQUIRED")).toBe(true);
    expect(report.errors.some(e => e.path.includes("fieldRef") || e.message.includes("fieldRef"))).toBe(true);
  });

  it("passes cleanly when fieldRefs and branch fieldRef bindings are declared (positive case; compat with purchase/leave)", () => {
    const report = workflowSkill.validate(leaveApprovalWorkflow, { external: dmSurface });
    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "WF_SSOT_BINDING_REQUIRED")).toBe(false);
  });

  it("ERRORS with WF_SSOT_BINDING_REQUIRED when model fieldRefs uses bare local key instead of entity.field ref", () => {
    const broken = clone(leaveApprovalWorkflow);
    broken.fieldRefs = ["approved"];
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_SSOT_BINDING_REQUIRED")).toBe(true);
    expect(report.errors.some(e => e.message.includes("entity.field") || e.message.includes("本地字段 key"))).toBe(true);
  });

  it("ERRORS with WF_SSOT_BINDING_REQUIRED when branch fieldRef is bare local key instead of entity.field SSOT ref", () => {
    const broken = clone(leaveApprovalWorkflow);
    const bnode = broken.nodes.find((n: any) => n.id === "b")!;
    bnode.fieldRef = "approved";
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_SSOT_BINDING_REQUIRED")).toBe(true);
    expect(report.errors.some(e => e.path.includes("fieldRef") || e.message.includes("fieldRef"))).toBe(true);
  });
});

describe("workflowSkill — approvalMode (any/all/sequential/percentage) gate coverage", () => {
  it("passes when using supported approvalModes (positive)", () => {
    const report = workflowSkill.validate(purchaseApprovalWorkflow);
    expect(report.ok).toBe(true);
    // no invalid mode errors
    expect(report.errors.some(e => e.code === "WF_APPROVAL_INVALID_MODE")).toBe(false);
  });

  it("purchaseApprovalWorkflow fixture covers differentiated modes for department manager, buyer/procurement and finance", () => {
    const mgr = purchaseApprovalWorkflow.nodes.find(n => n.id === "manager")!;
    const fin = purchaseApprovalWorkflow.nodes.find(n => n.id === "finance")!;
    const buyer = purchaseApprovalWorkflow.nodes.find(n => n.id === "procurement")!;
    expect(mgr.approvalMode).toBe("sequential");
    expect(fin.approvalMode).toBe("percentage");
    expect(buyer.approvalMode).toBe("all");
    expect(buyer.name).toContain("Buyer");
  });

  it("rejects invalid approvalMode on approval node (negative gate case)", () => {
    const broken = clone(leaveApprovalWorkflow);
    (broken.nodes.find(n => n.id === "a_mgr") as any).approvalMode = "countersign";
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_APPROVAL_INVALID_MODE")).toBe(true);
    const hit = report.errors.find(e => e.code === "WF_APPROVAL_INVALID_MODE");
    expect(hit && hit.message).toContain("approvalMode");
  });

  it("leave fixture remains compatible with 'any' (or-sign)", () => {
    const mgr = leaveApprovalWorkflow.nodes.find(n => n.id === "a_mgr")!;
    expect(mgr.approvalMode).toBe("any");
    const report = workflowSkill.validate(leaveApprovalWorkflow);
    expect(report.ok).toBe(true);
  });

  it("CATCHES percentage mode with missing threshold (negative; hardens purchase-style fixture)", () => {
    const broken = clone(purchaseApprovalWorkflow);
    const fin = broken.nodes.find(n => n.id === "finance")!;
    delete (fin as any).threshold;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_APPROVAL_INVALID_THRESHOLD")).toBe(true);
  });

  it("CATCHES percentage mode with threshold below range (0)", () => {
    const broken = clone(purchaseApprovalWorkflow);
    const fin = broken.nodes.find(n => n.id === "finance")!;
    (fin as any).threshold = 0;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_APPROVAL_INVALID_THRESHOLD")).toBe(true);
  });

  it("CATCHES percentage mode with threshold above range (101)", () => {
    const broken = clone(purchaseApprovalWorkflow);
    const fin = broken.nodes.find(n => n.id === "finance")!;
    (fin as any).threshold = 101;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_APPROVAL_INVALID_THRESHOLD")).toBe(true);
  });

  it("accepts percentage with valid threshold (positive case alongside invalid-mode gate)", () => {
    const okw = clone(purchaseApprovalWorkflow);
    (okw.nodes.find(n => n.id === "finance") as any).threshold = 75;
    const report = workflowSkill.validate(okw);
    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "WF_APPROVAL_INVALID_THRESHOLD")).toBe(false);
  });
});

describe("workflowSkill — timeout action model (V2 115 hardening)", () => {
  it("accepts valid timeoutDuration + timeoutTarget + escalationRoleRef + autoAction on approval (positive case)", () => {
    const w = clone(leaveApprovalWorkflow);
    const mgr = w.nodes.find(n => n.id === "a_mgr")!;
    (mgr as any).timeoutDuration = 24;
    (mgr as any).timeoutTarget = "e_no";
    (mgr as any).escalationRoleRef = "manager";
    (mgr as any).autoAction = "escalate";
    // explicit timeout edge also allowed
    w.edges.push({ id: "t_timeout", from: "a_mgr", to: "e_no", isTimeout: true } as any);
    const report = workflowSkill.validate(w, { external: rbacSurface });
    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "WF_TIMEOUT_INVALID_DURATION" || e.code === "WF_TIMEOUT_INVALID_TARGET" || e.code === "WF_ESCALATION_ROLE_MISSING")).toBe(false);
  });

  it("CATCHES invalid timeoutTarget node (negative gate case)", () => {
    const broken = clone(leaveApprovalWorkflow);
    const mgr = broken.nodes.find(n => n.id === "a_mgr")!;
    (mgr as any).timeoutDuration = 12;
    (mgr as any).timeoutTarget = "nonexistent_node";
    (mgr as any).autoAction = "escalate";
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_TIMEOUT_INVALID_TARGET")).toBe(true);
  });

  it("CATCHES non-positive or non-int timeoutDuration (negative)", () => {
    const broken = clone(leaveApprovalWorkflow);
    const mgr = broken.nodes.find(n => n.id === "a_mgr")!;
    (mgr as any).timeoutDuration = 0;
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_TIMEOUT_INVALID_DURATION")).toBe(true);
  });

  it("CATCHES invalid autoAction (negative)", () => {
    const broken = clone(leaveApprovalWorkflow);
    const mgr = broken.nodes.find(n => n.id === "a_mgr")!;
    (mgr as any).timeoutDuration = 8;
    (mgr as any).autoAction = "invalidAction";
    const report = workflowSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_TIMEOUT_INVALID_ACTION")).toBe(true);
  });

  it("CATCHES escalationRoleRef to unknown RBAC role (negative)", () => {
    const broken = clone(leaveApprovalWorkflow);
    const mgr = broken.nodes.find(n => n.id === "a_mgr")!;
    (mgr as any).timeoutDuration = 5;
    (mgr as any).timeoutTarget = "e_ok";
    (mgr as any).escalationRoleRef = "director"; // not in sample rbac
    const report = workflowSkill.validate(broken, { external: rbacSurface });
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_ESCALATION_ROLE_MISSING")).toBe(true);
  });

  it("projects timeout edges (synthetic + explicit) and metadata in mermaid diagram (positive projector)", () => {
    const w = clone(leaveApprovalWorkflow);
    const mgr = w.nodes.find(n => n.id === "a_mgr")!;
    (mgr as any).timeoutDuration = 48;
    (mgr as any).timeoutTarget = "e_no";
    (mgr as any).escalationRoleRef = "manager";
    (mgr as any).autoAction = "escalate";
    const projection = workflowSkill.project(w);
    expect(projection.mermaid.startsWith("flowchart TD")).toBe(true);
    expect(projection.mermaid).toContain("⏱48"); // duration shown
    expect(projection.mermaid).toContain("timeout"); // timeout label or synthetic
    // projection data includes timeout kind edges
    expect(projection.edges.some(e => e.kind === "timeout" || e.label.includes("timeout"))).toBe(true);
  });

  it("leaves purchaseApprovalWorkflow and leave fixtures unchanged (compat)", () => {
    expect((purchaseApprovalWorkflow.nodes.find(n => n.id === "finance") as any).timeoutDuration).toBeUndefined();
    expect((leaveApprovalWorkflow.nodes.find(n => n.id === "a_mgr") as any).timeoutDuration).toBeUndefined();
    const rp = workflowSkill.validate(purchaseApprovalWorkflow);
    expect(rp.ok).toBe(true);
  });
});

describe("workflowSkill — V2 115.30 workflow instance snapshot (freeze process version + form refs + initial vars)", () => {
  const dmSurface = { datamodel: dataModelSkill.resolve(leaveRequestDataModel) };
  const rbacSurf = { rbac: rbacSkill.resolve(leaveApprovalRbac) };

  it("positive: create snapshot from published workflow freezes version, fieldRefs, initialVariables; validate passes", () => {
    const snap = createWorkflowInstanceSnapshot(
      leaveApprovalWorkflow,
      "inst_001",
      { requestId: "req-42", user: "emp1" }
    );
    expect(snap.workflowId).toBe("wf_leave_approval");
    expect(snap.processVersion).toBe("1.0.0");
    expect(snap.versionPublished).toBe(true);
    expect(snap.frozenFormFieldRefs).toEqual(["leave_request.approved"]);
    expect(snap.initialVariables).toEqual({ requestId: "req-42", user: "emp1" });

    // snapshot validate (the gate)
    const report = validateWorkflowInstanceSnapshot(snap);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);

    // model with version/published also validates cleanly (compat + new gate)
    const modelReport = workflowSkill.validate(leaveApprovalWorkflow, { external: { ...rbacSurf, ...dmSurface } });
    expect(modelReport.ok).toBe(true);
    expect(modelReport.errors.some(e => e.code.startsWith("WF_SNAPSHOT"))).toBe(false);
  });

  it("negative: snapshot pointing to unpublished version fails the published gate (WF_INSTANCE_SNAPSHOT_UNPUBLISHED)", () => {
    const badSnap: WorkflowInstanceSnapshot = {
      id: "inst_bad",
      workflowId: "wf_leave_approval",
      processVersion: "2.0.0",
      versionPublished: false,
      frozenFormFieldRefs: ["leave_request.approved"],
      initialVariables: {},
    };
    const report = validateWorkflowInstanceSnapshot(badSnap);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_INSTANCE_SNAPSHOT_UNPUBLISHED")).toBe(true);
    expect(report.errors[0].message).toContain("published");
  });

  it("CATCHES model published=false via main validate (WF_SNAPSHOT_UNPUBLISHED_VERSION)", () => {
    const unpublished = structuredClone(leaveApprovalWorkflow);
    unpublished.published = false;
    unpublished.version = "9.9.9";
    const report = workflowSkill.validate(unpublished);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "WF_SNAPSHOT_UNPUBLISHED_VERSION")).toBe(true);
  });

  it("snapshot form bindings and vars remain independent of live model (freeze semantics)", () => {
    const base = structuredClone(leaveApprovalWorkflow);
    const snap1 = createWorkflowInstanceSnapshot(base, "i1");
    // mutate a clone after snapshot (should not affect frozen)
    const mutated = structuredClone(base);
    mutated.fieldRefs = [...(mutated.fieldRefs ?? []), "leave_request.extra"];
    const snap2 = createWorkflowInstanceSnapshot(mutated, "i2");
    expect(snap1.frozenFormFieldRefs).toEqual(["leave_request.approved"]);
    expect(snap2.frozenFormFieldRefs).toContain("leave_request.extra");
  });
});

describe("workflowSkill — variable reference gate (SSOT field or defined process variable)", () => {
  it("passes when condition references a defined process variable (positive)", () => {
    const w = clone(leaveApprovalWorkflow) as any;
    w.variables = ["score", "level"];
    const t3 = w.edges.find((e: any) => e.id === "t3")!;
    t3.when = { op: "==", value: true, varRef: "score" };
    const report = workflowSkill.validate(w);
    expect(report.ok).toBe(true);
    expect(report.errors.some((e: any) => e.code === "WF_VAR_REF_UNKNOWN")).toBe(false);
  });

  it("passes when condition varRef points to a declared SSOT fieldRef (positive)", () => {
    const w = clone(leaveApprovalWorkflow) as any;
    // no extra variables; use a declared fieldRef as var ref in condition
    const t3 = w.edges.find((e: any) => e.id === "t3")!;
    t3.when = { op: "==", value: true, varRef: "leave_request.approved" };
    const report = workflowSkill.validate(w);
    expect(report.ok).toBe(true);
    expect(report.errors.some((e: any) => e.code === "WF_VAR_REF_UNKNOWN")).toBe(false);
  });

  it("ERRORS when branch condition references an undefined process variable (negative)", () => {
    const w = clone(leaveApprovalWorkflow) as any;
    w.variables = ["onlyDefined"];
    const t3 = w.edges.find((e: any) => e.id === "t3")!;
    t3.when = { op: "==", value: true, varRef: "undefinedProcessVar" };
    const report = workflowSkill.validate(w);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e: any) => e.code === "WF_VAR_REF_UNKNOWN" && e.message.includes("undefinedProcessVar"))).toBe(true);
  });

  it("ERRORS on branch variable reference mismatch (fieldRef not declared in fieldRefs)", () => {
    const w = clone(leaveApprovalWorkflow);
    const bnode = w.nodes.find((n: any) => n.id === "b")!;
    bnode.fieldRef = "leave_request.unboundField";
    // leave fieldRefs as-is (does not contain it) -> mismatch/unknown
    const report = workflowSkill.validate(w);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e: any) => e.code === "WF_VAR_REF_UNKNOWN" && e.message.includes("unboundField"))).toBe(true);
  });

  it("purchase and leave fixtures remain compatible (no var refs beyond declared SSOT)", () => {
    const r1 = workflowSkill.validate(purchaseApprovalWorkflow);
    const r2 = workflowSkill.validate(leaveApprovalWorkflow);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.errors.some((e: any) => e.code === "WF_VAR_REF_UNKNOWN")).toBe(false);
    expect(r2.errors.some((e: any) => e.code === "WF_VAR_REF_UNKNOWN")).toBe(false);
  });
});

describe("workflowSkill — pure runtime instance engine (V2 117)", () => {
  it("startWorkflowInstance creates snapshot-backed instance and freezes version at start", () => {
    const inst = startWorkflowInstance(purchaseApprovalWorkflow, {
      id: "inst_p_start",
      initialVariables: { "purchase_request.amount": 500 },
    });
    expect(inst.id).toBe("inst_p_start");
    expect(inst.snapshot.workflowId).toBe("wf_purchase_approval");
    expect(inst.snapshot.processVersion).toBe("1.0.0");
    expect(inst.snapshot.versionPublished).toBe(true);
    expect(inst.snapshot.frozenFormFieldRefs).toContain("purchase_request.amount");
    expect(inst.currentNodeId).toBe("submit");
    expect(inst.status).toBe("running");
    expect(inst.variables["purchase_request.amount"]).toBe(500);
  });

  it("purchase approval fixture can advance through at least two nodes (submit + approve with pre-set decision vars)", () => {
    const seed = {
      "purchase_request.budgetChecked": true,
      "purchase_request.financeApproved": true,
      "purchase_request.procurementFulfilled": true,
      "purchase_request.amount": 999,
    };
    let inst = startWorkflowInstance(purchaseApprovalWorkflow, { id: "purch_rt", initialVariables: seed });
    expect(inst.currentNodeId).toBe("submit");

    let res = transitionWorkflowInstance(purchaseApprovalWorkflow, inst, { type: "submit" });
    expect(res.findings).toHaveLength(0);
    expect(res.instance.currentNodeId).toBe("manager");

    res = transitionWorkflowInstance(purchaseApprovalWorkflow, res.instance, { type: "approve" });
    expect(res.findings).toHaveLength(0);
    // manager -> budget (auto-resolve) -> finance
    expect(res.instance.currentNodeId).toBe("finance");
    expect(res.instance.status).toBe("running");
  });

  it("invalid transition returns WF_RUNTIME_INVALID_TRANSITION and leaves instance unchanged (fail-closed)", () => {
    const inst = startWorkflowInstance(leaveApprovalWorkflow, { id: "bad_rt" });
    const origId = inst.currentNodeId;
    const origStatus = inst.status;

    // approve on start node is invalid
    const bad = transitionWorkflowInstance(leaveApprovalWorkflow, inst, { type: "approve" as any });
    expect(bad.findings.some((f: any) => f.code === WF_RUNTIME_INVALID_TRANSITION)).toBe(true);
    expect(bad.instance.currentNodeId).toBe(origId);
    expect(bad.instance.status).toBe(origStatus);
    expect(bad.instance.variables).toEqual(inst.variables);
  });

  it("leave approval fixture compat: can advance submit->approve and auto-resolve branch when vars preset (positive)", () => {
    const inst0 = startWorkflowInstance(leaveApprovalWorkflow, {
      id: "leave_rt",
      initialVariables: { "leave_request.approved": true },
    });
    const r1 = transitionWorkflowInstance(leaveApprovalWorkflow, inst0, { type: "submit" });
    expect(r1.instance.currentNodeId).toBe("a_mgr");

    const r2 = transitionWorkflowInstance(leaveApprovalWorkflow, r1.instance, { type: "approve" });
    expect(r2.findings).toHaveLength(0);
    expect(r2.instance.currentNodeId).toBe("e_ok");
    expect(r2.instance.status).toBe("completed");
  });

  it("timeout command supported on approval with timeoutTarget (negative if absent)", () => {
    const w = structuredClone(leaveApprovalWorkflow) as any;
    w.nodes.find((n: any) => n.id === "a_mgr").timeoutTarget = "e_no";
    const inst = startWorkflowInstance(w, { id: "to1" });
    const r1 = transitionWorkflowInstance(w, inst, { type: "submit" });
    // now at a_mgr
    const toRes = transitionWorkflowInstance(w, r1.instance, { type: "timeout" });
    expect(toRes.findings).toHaveLength(0);
    expect(toRes.instance.currentNodeId).toBe("e_no");
  });

  it("submit on non-start or approve on non-approval is rejected (fail closed)", () => {
    const inst = startWorkflowInstance(purchaseApprovalWorkflow, { id: "neg" });
    const s1 = transitionWorkflowInstance(purchaseApprovalWorkflow, inst, { type: "submit" });
    // now at manager (approval)
    const badSubmit = transitionWorkflowInstance(purchaseApprovalWorkflow, s1.instance, { type: "submit" });
    expect(badSubmit.findings.some((f: any) => f.code === WF_RUNTIME_INVALID_TRANSITION)).toBe(true);
    expect(badSubmit.instance.currentNodeId).toBe("manager"); // unchanged
  });
});

describe("workflowSkill — assignee policy runtime (V2 117, evidence-driven, fail-closed)", () => {
  const rbacSurfWithEvidence = {
    rbac: {
      ...rbacSurface.rbac,
      policyEvidence: { allow: true, role: "manager", source: "pdp" },
    },
  };

  it("positive runtime case: resolves assignee using supplied RBAC policyEvidence (depends on evidence, not local)", () => {
    const res = resolveWorkflowAssignees(leaveApprovalWorkflow, "a_mgr", { external: rbacSurfWithEvidence });
    expect(res).not.toBe(WF_ASSIGNEE_PDP_DENIED);
    const r = res as { assignees: string[]; policyEvidence?: any };
    expect(r.assignees).toContain("manager");
    expect(r.policyEvidence).toBeTruthy();
    expect(r.policyEvidence.allow).toBe(true);
  });

  it("positive runtime case with purchase fixture (compat)", () => {
    const purchaseEvidence = {
      rbac: {
        role: ["department_manager", "finance", "procurement"],
        policyEvidence: { allow: true, forNode: "manager" },
      },
    };
    const res = resolveWorkflowAssignees(purchaseApprovalWorkflow, "manager", { external: purchaseEvidence });
    expect(res).not.toBe(WF_ASSIGNEE_PDP_DENIED);
    expect((res as any).policyEvidence).toEqual({ allow: true, forNode: "manager" });
  });

  it("negative/fail-closed: missing PDP evidence returns WF_ASSIGNEE_PDP_DENIED", () => {
    // only role surface, no policyEvidence -> fail closed
    const res = resolveWorkflowAssignees(leaveApprovalWorkflow, "a_mgr", { external: { rbac: rbacSurface.rbac } });
    expect(res).toBe(WF_ASSIGNEE_PDP_DENIED);
  });

  it("negative/fail-closed: explicit deny in evidence returns WF_ASSIGNEE_PDP_DENIED", () => {
    const denyCtx = { external: { rbac: { policyEvidence: { allow: false, reason: "policy denied" } } } };
    const res = resolveWorkflowAssignees(leaveApprovalWorkflow, "a_mgr", denyCtx);
    expect(res).toBe(WF_ASSIGNEE_PDP_DENIED);
  });

  it("negative when node has no assigneeRoleRef (fail-closed)", () => {
    const res = resolveWorkflowAssignees(leaveApprovalWorkflow, "s", { external: { rbac: { policyEvidence: {} } } });
    expect(res).toBe(WF_ASSIGNEE_PDP_DENIED);
  });

  it("leaves purchase/leave fixtures and policyEvidence symbol intact for compat", () => {
    expect(policyEvidence).toBe("policyEvidence");
    expect(leaveApprovalWorkflow.nodes.some(n => n.assigneeRoleRef)).toBe(true);
    expect(purchaseApprovalWorkflow.nodes.some(n => n.assigneeRoleRef)).toBe(true);
  });
});

// 119 assignee policy closure: direct tie to RBAC roles + PolicyDecision (positive + fail-closed negative)
describe("workflowSkill — assignee policy closure against RBAC roles and policy decisions (119)", () => {
  it("positive: createWorkflowAssigneePolicyEvidenceFromDecision with RBAC decideRbacPolicy allow produces assignees (manager role)", () => {
    const request: any = {
      subject: { roleIds: ["manager"] },
      action: "approve",
      resourceType: "leave_request",
      tenantId: "t_default",
      fieldContext: { fields: [] },
    };
    const decision: PolicyDecision = decideRbacPolicy(leaveApprovalRbac, request);
    expect(decision.allow).toBe(true);
    const res = createWorkflowAssigneePolicyEvidenceFromDecision(leaveApprovalWorkflow, "a_mgr", decision);
    expect(res).not.toBe(WF_ASSIGNEE_PDP_DENIED);
    const r = res as { assignees: string[]; policyEvidence?: any };
    expect(r.assignees).toContain("manager");
    expect(r.policyEvidence).toBeTruthy();
    expect(r.policyEvidence.allow).toBe(true);
    expect(r.policyEvidence.role).toBe("manager");
  });

  it("positive: uses RBAC decision for purchase assignee (department_manager)", () => {
    const req: any = {
      subject: { roleIds: ["department_manager"] },
      action: "manager_approve",
      resourceType: "purchase_request",
      tenantId: "t_default",
      fieldContext: { fields: [] },
    };
    const dec = decideRbacPolicy(purchaseApprovalRbac, req);
    // must use real RBAC decision (no synthetic fallback; fixture is closed)
    expect(dec.allow).toBe(true);
    const res = createWorkflowAssigneePolicyEvidenceFromDecision(purchaseApprovalWorkflow, "manager", dec);
    expect(res).not.toBe(WF_ASSIGNEE_PDP_DENIED);
    expect((res as any).assignees).toContain("department_manager");
  });

  it("fail-closed negative: RBAC policy decision allow=false yields WF_ASSIGNEE_PDP_DENIED", () => {
    const denyDecision: Partial<PolicyDecision> = { allow: false, code: "RBAC_DECISION_FAIL_CLOSED", reason: "no permission" };
    const res = createWorkflowAssigneePolicyEvidenceFromDecision(leaveApprovalWorkflow, "a_mgr", denyDecision);
    expect(res).toBe(WF_ASSIGNEE_PDP_DENIED);
  });

  it("fail-closed negative: RBAC decision via evaluate fail closed for invalid subject", () => {
    // use decide to get a real fail-closed decision
    const badReq: any = { subject: { roleIds: [] }, action: "approve", resourceType: "leave_request", tenantId: "t", fieldContext: { fields: [] } };
    const badDec = decideRbacPolicy(leaveApprovalRbac, badReq);
    expect(badDec.allow).toBe(false);
    const res = createWorkflowAssigneePolicyEvidenceFromDecision(leaveApprovalWorkflow, "a_mgr", badDec);
    expect(res).toBe(WF_ASSIGNEE_PDP_DENIED);
  });

  it("fail-closed negative: non-approval node or missing roleRef still DENIED even with allow decision", () => {
    const okDec = { allow: true };
    const resStart = createWorkflowAssigneePolicyEvidenceFromDecision(leaveApprovalWorkflow, "s", okDec);
    expect(resStart).toBe(WF_ASSIGNEE_PDP_DENIED);
  });

  it("fail-closed negative: allow=true decision but RBAC attested roles do not match workflow node assigneeRoleRef is DENIED", () => {
    // real allow from manager (leave) must not satisfy a purchase node requiring department_manager
    const mgrReq: any = {
      subject: { roleIds: ["manager"] },
      action: "approve",
      resourceType: "leave_request",
      tenantId: "t_default",
      fieldContext: { fields: [] },
    };
    const mgrDec = decideRbacPolicy(leaveApprovalRbac, mgrReq);
    expect(mgrDec.allow).toBe(true);
    const res = createWorkflowAssigneePolicyEvidenceFromDecision(purchaseApprovalWorkflow, "manager", mgrDec);
    expect(res).toBe(WF_ASSIGNEE_PDP_DENIED);
  });

  it("fail-closed negative: synthetic allow=true with mismatched expandedRoles vs assigneeRoleRef is DENIED", () => {
    const mismatchDec = { allow: true, expandedRoles: ["unrelated"], matchedPermission: "foo:bar" };
    const res = createWorkflowAssigneePolicyEvidenceFromDecision(leaveApprovalWorkflow, "a_mgr", mismatchDec);
    expect(res).toBe(WF_ASSIGNEE_PDP_DENIED);
  });
});

describe("workflowSkill - 118 cross-runtime evidence", () => {
  it("exposes deterministic workflow cross-runtime edges through resolve", () => {
    const surface = workflowSkill.resolve(leaveApprovalWorkflow) as any;

    expect(surface.runtimeEvidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("WF_CROSS_RUNTIME_EVIDENCE:rbac"),
        expect.stringContaining("WF_CROSS_RUNTIME_EVIDENCE:datamodel"),
      ]),
    );
    expect(surface.crossSkillRuntimeEdges).toEqual(
      expect.arrayContaining(["workflow->rbac:allowed", "workflow->datamodel:allowed"]),
    );
  });

  it("builds rbac runtime evidence and carries snapshot refs", () => {
    const snapshot = createWorkflowInstanceSnapshot(leaveApprovalWorkflow, "wf-inst-118", {});
    const evidence = createWorkflowRbacRuntimeEvidence(leaveApprovalWorkflow, rbacSurface.rbac, snapshot);

    expect(evidence.evidenceKey).toBe(WF_RBAC_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("rbac");
    expect(evidence.state).toBe("allowed");
    expect(evidence.roleRefs).toContain("manager");
    expect(evidence.snapshotRef).toBe("wf-inst-118");
  });

  it("fails closed for datamodel evidence when upstream datamodel surface is absent", () => {
    const evidence = createWorkflowDataModelRuntimeEvidence(leaveApprovalWorkflow);

    expect(evidence.evidenceKey).toBe(WF_DATAMODEL_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("datamodel");
    expect(evidence.state).toBe("blocked");
    expect(evidence.reasonCode).toBe("WF_RUNTIME_UPSTREAM_ABSENT");
  });

  it("normalizes workflow runtime context for appbundle and preserves transitions", () => {
    const ctx = normalizeWorkflowRuntimeContextForSkill(
      purchaseApprovalWorkflow,
      "appbundle",
      { app: ["app_purchase_approval"] },
    );

    expect(ctx.targetSkill).toBe("appbundle");
    expect(ctx.upstreamEvidencePresent).toBe(true);
    expect(ctx.roleRefs).toContain("finance");
    expect(ctx.transitionRefs.length).toBeGreaterThan(0);
    expect(buildWorkflowCrossRuntimeEdges(purchaseApprovalWorkflow).map(edge => edge.targetSkill)).toEqual(
      expect.arrayContaining(["rbac", "datamodel", "page", "aigc", "appbundle"]),
    );
  });
});

describe("workflowSkill — V2 117 workflow form binding runtime (buildWorkflowFormRuntime)", () => {
  const dmSurface = { datamodel: dataModelSkill.resolve(leaveRequestDataModel) };
  const cloneAny = (x: any) => structuredClone(x);

  it("positive: buildWorkflowFormRuntime returns fields from frozenFormFieldRefs, lifecycle from DM, allowed pdp when no field deny (purchase/leave compat)", () => {
    const snap = createWorkflowInstanceSnapshot(leaveApprovalWorkflow, "inst_pos_117");
    // pass raw model for runtime decide under rbacModel (surface also present for other use)
    const ctx = { external: { datamodel: dmSurface.datamodel, rbacModel: leaveApprovalRbac } };
    const rt = buildWorkflowFormRuntime(leaveApprovalWorkflow, snap, ctx);

    expect(rt.formFieldRefs).toEqual(["leave_request.approved"]);
    expect(rt.fields.length).toBe(1);
    expect(rt.fields[0].ref).toBe("leave_request.approved");
    expect(rt.fields[0].lifecycle).toBe("active");
    expect(rt.fields[0].pdpState).not.toBe("WF_FORM_FIELD_PDP_DENIED");
    expect(rt.fields[0].editable).toBe(true);
    expect(rt.findings.length).toBe(0);

    // snapshot frozen honored vs live model mutation (compat positive)
    const mut = clone(leaveApprovalWorkflow);
    mut.fieldRefs = [...(mut.fieldRefs ?? []), "leave_request.extra"];
    const snapMut = createWorkflowInstanceSnapshot(mut, "inst_mut");
    const rtFrozen = buildWorkflowFormRuntime(leaveApprovalWorkflow, snap, { external: { datamodel: dmSurface.datamodel } });
    const rtLive = buildWorkflowFormRuntime(mut, snapMut, { external: { datamodel: dmSurface.datamodel } });
    expect(rtFrozen.formFieldRefs).toEqual(["leave_request.approved"]);
    expect(rtLive.formFieldRefs).toContain("leave_request.extra");

    // purchase fixture also produces runtime (compat)
    const pSnap = createWorkflowInstanceSnapshot(purchaseApprovalWorkflow, "inst_p");
    const prt = buildWorkflowFormRuntime(purchaseApprovalWorkflow, pSnap, { external: {} });
    expect(prt.formFieldRefs.length).toBeGreaterThan(3);
    expect(prt.fields.every((f: any) => f.pdpState !== "WF_FORM_FIELD_PDP_DENIED")).toBe(true);
  });

  it("negative/fail-closed: removed DM field + RBAC field deny produce stable findings and WF_FORM_FIELD_PDP_DENIED, not editable", () => {
    const base = clone(leaveApprovalWorkflow);
    const snap = createWorkflowInstanceSnapshot(base, "inst_neg_117");

    // removed lifecycle
    const remDM = cloneAny(leaveRequestDataModel);
    const lr = remDM.entities.find((e: any) => e.id === "leave_request")!;
    const ap = lr.fields.find((f: any) => f.key === "approved")!;
    ap.lifecycle = "removed";
    const remDmSurf = { datamodel: dataModelSkill.resolve(remDM) };

    // rbac with explicit field deny rule
    const denyRbac = cloneAny(leaveApprovalRbac);
    denyRbac.policyRules = [
      { id: "pr_field_deny_approved", effect: "deny", resourceType: "leave_request", fieldRef: "leave_request.approved" },
    ];

    const ctx = { external: { datamodel: remDmSurf.datamodel, rbacModel: denyRbac } };
    const rt = buildWorkflowFormRuntime(base, snap, ctx);

    expect(rt.formFieldRefs).toEqual(["leave_request.approved"]);
    expect(rt.fields[0].lifecycle).toBe("removed");
    expect(rt.fields[0].pdpState).toBe("WF_FORM_FIELD_PDP_DENIED");
    expect(rt.fields[0].editable).toBe(false);
    // stable findings for both removed and pdp denied
    expect(rt.findings.some((f: any) => f.code === "WF_SSOT_FIELD_REMOVED" && f.message.includes("removed"))).toBe(true);
    expect(rt.findings.some((f: any) => f.code === "WF_FORM_FIELD_PDP_DENIED")).toBe(true);
  });

  it("frozenFormFieldRefs from instance snapshot take precedence; missing ctx surfaces are graceful (no crash, allowed default)", () => {
    const snap = createWorkflowInstanceSnapshot(leaveApprovalWorkflow, "inst_frozen");
    const rt = buildWorkflowFormRuntime(leaveApprovalWorkflow, snap, undefined);
    expect(rt.formFieldRefs).toEqual(["leave_request.approved"]);
    expect(rt.fields[0].pdpState).toBe("allowed");
    expect(rt.findings.length).toBe(0);
  });
});

describe("workflowSkill - 120 workflow task state to page surface trace", () => {
  it("traces workflow task state to Page task surface as a closed path", () => {
    const instance = startWorkflowInstance(leaveApprovalWorkflow, { id: "inst_wf_page_positive" });
    const trace = traceWorkflowTaskStateToPageTaskSurfaceEvidence(leaveApprovalWorkflow, instance, leaveApprovalPage);

    expect(trace.traceId).toBe(WF_WORKFLOW_TO_PAGE_TRACE);
    expect(trace.sourceSkill).toBe("workflow");
    expect(trace.targetSkill).toBe("page");
    expect(trace.state).toBe("closed");
    expect(trace.reasonCode).toBe("WF_PAGE_TASK_SURFACE_POSITIVE_CLOSED");
    expect(trace.currentNodeId).toBe(instance.currentNodeId);
    expect(trace.pageTaskSurfaceValid).toBe(true);
  });

  it("traces missing workflow task state to Page as fail-closed", () => {
    const trace = traceWorkflowTaskStateToPageTaskSurfaceEvidence(
      leaveApprovalWorkflow,
      { workflowId: leaveApprovalWorkflow.id, currentNodeId: "" } as any,
      leaveApprovalPage,
    );

    expect(trace.state).toBe("blocked");
    expect(trace.reasonCode).toBe("WF_PAGE_TASK_SURFACE_FAIL_CLOSED");
    expect(trace.pageTaskSurfaceValid).toBe(false);
  });

  it("exposes dedicated page runtime evidence and workflowToPageTrace on resolve", () => {
    const surface = workflowSkill.resolve(leaveApprovalWorkflow) as any;
    const evidence = createWorkflowPageRuntimeEvidence(
      leaveApprovalWorkflow,
      { page: true },
      createWorkflowInstanceSnapshot(leaveApprovalWorkflow, "inst_wf_page_evidence"),
    );

    expect(evidence.evidenceKey).toBe(WF_PAGE_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("page");
    expect(surface.runtimeEvidence).toEqual(expect.arrayContaining([WF_PAGE_RUNTIME_EVIDENCE]));
    expect(surface.workflowToPageTrace).toBeTruthy();
    expect(surface.workflowToPageTrace.traceId).toBe(WF_WORKFLOW_TO_PAGE_TRACE);
  });
});

describe("workflowSkill - 120 workflow runtime to appbundle closure trace", () => {
  it("traces Workflow runtime refs to AppBundle closure as a closed path", () => {
    const trace = traceWorkflowRuntimeEvidenceToAppBundleClosureEvidence(
      leaveApprovalWorkflow,
      leaveApprovalAppBundle,
    );

    expect(trace.traceId).toBe(WF_WORKFLOW_TO_APPBUNDLE_TRACE);
    expect(trace.sourceSkill).toBe("workflow");
    expect(trace.targetSkill).toBe("appbundle");
    expect(trace.state).toBe("closed");
    expect(trace.reasonCode).toBe("WF_APPBUNDLE_RUNTIME_EVIDENCE_POSITIVE_CLOSED");
    expect(trace.workflowId).toBe(leaveApprovalWorkflow.id);
    expect(trace.hasRuntimeRefs).toBe(true);
    expect(trace.appBundleEvidencePresent).toBe(true);
  });

  it("traces missing AppBundle upstream or empty Workflow runtime refs as fail-closed", () => {
    const missingBundle = traceWorkflowRuntimeEvidenceToAppBundleClosureEvidence(leaveApprovalWorkflow);
    const emptyWorkflow = { id: "wf_empty", nodes: [], edges: [], fieldRefs: [] } as any;
    const missingRefs = traceWorkflowRuntimeEvidenceToAppBundleClosureEvidence(emptyWorkflow, leaveApprovalAppBundle);

    expect(missingBundle.state).toBe("blocked");
    expect(missingBundle.reasonCode).toBe("WF_APPBUNDLE_RUNTIME_FAIL_CLOSED");
    expect(missingRefs.state).toBe("blocked");
    expect(missingRefs.hasRuntimeRefs).toBe(false);
  });

  it("resolve and AppBundle runtime closure expose Workflow to AppBundle evidence", () => {
    const surface = workflowSkill.resolve(leaveApprovalWorkflow) as any;
    const evidence = createWorkflowToAppBundleRuntimeEvidence(leaveApprovalWorkflow, leaveApprovalAppBundle);
    const report = evaluateAppBundleRuntimeClosure({
      workflow: leaveApprovalWorkflow,
      appbundle: leaveApprovalAppBundle,
    });
    const workflowInfo = report.perSkillEvidence.workflow as any;

    expect(evidence.evidenceKey).toBe(WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE);
    expect(evidence.targetSkill).toBe("appbundle");
    expect(surface.runtimeEvidence).toEqual(expect.arrayContaining([WF_WORKFLOW_RUNTIME_TO_APPBUNDLE_EVIDENCE]));
    expect(surface.workflowToAppBundleTrace.traceId).toBe(WF_WORKFLOW_TO_APPBUNDLE_TRACE);
    expect(workflowInfo.workflowRuntimeToAppBundleEvidence.state).toBe("closed");
  });
});
