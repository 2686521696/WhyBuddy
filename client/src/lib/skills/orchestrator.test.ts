import { describe, expect, it } from "vitest";

import { deriveApplication, slideRule } from "./slideRule";
import { leaveApprovalRbac } from "./rbac/rbacSkill";
import { leaveApprovalWorkflow } from "./workflow/workflowSkill";
import type { WorkflowModel } from "./workflow/workflowModel";
import { dataModelSkill, leaveRequestDataModel } from "./datamodel/dataModelSkill";

describe("SlideRule orchestrator — end-to-end (一句话 → 架构 + gate)", () => {
  it("derives a coherent application from one intent, with the gate green", async () => {
    const result = await deriveApplication("我要一个请假审批平台");

    expect(result.ok).toBe(true);
    expect(result.report.totals.errors).toBe(0);
    expect(result.report.bySkill.map(s => s.skillId)).toEqual(["datamodel", "rbac", "workflow", "page", "appbundle"]);

    // unified SPEC carries every skill's model
    expect(result.spec.skills.datamodel).toBeTruthy();
    expect(result.spec.skills.rbac).toBeTruthy();
    expect(result.spec.skills.workflow).toBeTruthy();
    expect(result.spec.skills.page).toBeTruthy();
    expect(result.spec.skills.appbundle).toBeTruthy();
  });

  it("wiring in DataModel RESOLVES RBAC's previously-dangling data-rule reference", async () => {
    const result = await deriveApplication("请假审批");
    const rbac = result.report.bySkill.find(s => s.skillId === "rbac")!;
    // the warning that existed before DataModel was registered is now gone — the ref resolves.
    expect(rbac.warnings.some(w => w.code === "RBAC_CROSS_REF_UNRESOLVED")).toBe(false);
    expect(result.report.totals.warnings).toBe(0);
  });

  it("threads RBAC roles into Workflow so the cross-skill assignee resolves (no unresolved warning)", async () => {
    const result = await deriveApplication("请假审批");
    const wf = result.report.bySkill.find(s => s.skillId === "workflow")!;
    // because RBAC ran first and its surface was threaded in, the assignee is RESOLVED
    expect(wf.warnings.some(w => w.code === "WF_ASSIGNEE_UNRESOLVED")).toBe(false);
  });

  it("threads DataModel surfaces into Workflow so fieldRef/SSOT cross-refs resolve (no unresolved for DataModel)", async () => {
    const result = await deriveApplication("请假审批");
    const wf = result.report.bySkill.find(s => s.skillId === "workflow")!;
    // DataModel surface makes WF field SSOT refs resolve (no dangling)
    expect(wf.warnings.some(w => w.code === "WF_FIELD_UNRESOLVED")).toBe(false);
    // diagram cross edges are real (not ghost)
    expect(result.mermaid).toContain("wf_b -.->|字段| dm_leave_request_approved");
  });

  it("the combined diagram now has 5 subgraphs, the cross-skill edges resolve to REAL nodes, ghost gone", async () => {
    const result = await deriveApplication("请假审批");
    expect(result.mermaid).toContain('subgraph datamodel["数据中台"]');
    expect(result.mermaid).toContain('subgraph rbac["RBAC 权限"]');
    expect(result.mermaid).toContain('subgraph workflow["工作流"]');
    expect(result.mermaid).toContain("subgraph page[");
    expect(result.mermaid).toContain("subgraph appbundle[");
    expect(result.mermaid).toMatch(/cmp_approve -\.->\|.*\| dm_leave_request/);
    expect(result.mermaid).toMatch(/cmp_approve -\.->\|.*\| role_manager/);
    expect(result.mermaid).toMatch(/app_app_leave_approval -\.->\|.*\| page_page_leave_request/);
    expect(result.mermaid).toMatch(/app_app_leave_approval -\.->\|.*\| wf_wf_leave_approval/);
    // workflow approval node -.-> rbac role node
    expect(result.mermaid).toContain("wf_a_mgr -.->|审批人| role_manager");
    // workflow branch/form to DataModel SSOT (cross-refs resolve through DataModel surface)
    expect(result.mermaid).toContain("wf_b -.->|字段| dm_leave_request_approved");
    // RBAC data rule now points at the REAL datamodel entity node, not a ghost
    expect(result.mermaid).toContain("-.->|数据| dm_leave_request");
    expect(result.mermaid).not.toContain("(未接入)");
    // derive real SSOT entity and field nodes from model (no hard-coded field node ids)
    const dmProj = dataModelSkill.project(leaveRequestDataModel);
    const dmEntityNode = dmProj.nodes.find((n: any) => n.kind === "entity" && n.id.includes("leave_request"))!.id;
    const dmFieldNode = dmProj.nodes.find((n: any) => n.kind === "field" && n.id.includes("leave_request"))!.id;
    expect(dmEntityNode).toBe("dm_leave_request");
    expect(dmFieldNode).toMatch(/^dm_leave_request_/);
    // diagram now includes the derived real SSOT field node (in addition to entity)
    expect(result.mermaid).toContain(dmEntityNode);
    expect(result.mermaid).toContain(dmFieldNode);
  });

  it("the aggregate gate goes RED when a cross-skill ref is broken", () => {
    // feed an inconsistent pair: workflow assigns approval to a role RBAC never defined.
    const badWorkflow: WorkflowModel = structuredClone(leaveApprovalWorkflow);
    badWorkflow.nodes.find(n => n.id === "a_mgr")!.assigneeRole = "director";

    const result = slideRule.assemble("请假审批", {
      rbac: leaveApprovalRbac,
      workflow: badWorkflow,
    });

    expect(result.ok).toBe(false);
    const wf = result.report.bySkill.find(s => s.skillId === "workflow")!;
    expect(wf.errors.some(e => e.code === "WF_ASSIGNEE_MISSING_ROLE")).toBe(true);
  });
});
