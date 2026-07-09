import { describe, expect, it } from "vitest";

import { deriveApplication, slideRule } from "./slideRule";
import { leaveApprovalRbac, rbacSkill } from "./rbac/rbacSkill";
import { leaveApprovalWorkflow } from "./workflow/workflowSkill";
import type { WorkflowModel } from "./workflow/workflowModel";
import { dataModelSkill, leaveRequestDataModel } from "./datamodel/dataModelSkill";
import { normalizeCrossRef } from "./skill";
import { Orchestrator } from "./orchestrator";
import type { Skill, CrossSkill } from "./skill";

describe("SlideRule orchestrator — end-to-end (一句话 → 架构 + gate)", () => {
  it("derives a coherent application from one intent, with the gate green", async () => {
    const result = await deriveApplication("我要一个请假审批平台");

    expect(result.ok).toBe(true);
    expect(result.report.totals.errors).toBe(0);
    expect(result.report.bySkill.map(s => s.skillId)).toEqual(["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]);

    // unified SPEC carries every skill's model
    expect(result.spec.skills.datamodel).toBeTruthy();
    expect(result.spec.skills.rbac).toBeTruthy();
    expect(result.spec.skills.workflow).toBeTruthy();
    expect(result.spec.skills.page).toBeTruthy();
    expect(result.spec.skills.aigc).toBeTruthy();
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

  it("the combined diagram now has 6 subgraphs, the cross-skill edges resolve to REAL nodes, ghost gone", async () => {
    const result = await deriveApplication("请假审批");
    expect(result.mermaid).toContain('subgraph datamodel["数据中台"]');
    expect(result.mermaid).toContain('subgraph rbac["RBAC 权限"]');
    expect(result.mermaid).toContain('subgraph workflow["工作流"]');
    expect(result.mermaid).toContain("subgraph page[");
    expect(result.mermaid).toContain("subgraph aigc[");
    expect(result.mermaid).toContain("subgraph appbundle[");
    expect(result.mermaid).toMatch(/cmp_approve -\.->\|.*\| dm_leave_request/);
    expect(result.mermaid).toMatch(/cmp_approve -\.->\|.*\| role_manager/);
    expect(result.mermaid).toMatch(/cmp_submit -\.->\|.*\| perm_leave_create/);
    expect(result.mermaid).toMatch(/cmp_approve -\.->\|.*\| perm_leave_approve/);
    expect(result.mermaid).toMatch(/app_app_leave_approval -\.->\|.*\| page_page_leave_request/);
    expect(result.mermaid).toMatch(/app_app_leave_approval -\.->\|.*\| wf_wf_leave_approval/);
    expect(result.mermaid).toContain("aigc_empty_leave");
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
    badWorkflow.nodes.find(n => n.id === "a_mgr")!.assigneeRoleRef = "director";

    const result = slideRule.assemble("请假审批", {
      rbac: leaveApprovalRbac,
      workflow: badWorkflow,
    });

    expect(result.ok).toBe(false);
    const wf = result.report.bySkill.find(s => s.skillId === "workflow")!;
    expect(wf.errors.some(e => e.code === "WF_ASSIGNEE_MISSING_ROLE")).toBe(true);
  });

  it("normalizeCrossRef standardizes fields (fromNode/toSkill/toKind/toValue/label/severity) with defaults", () => {
    const norm = normalizeCrossRef({
      fromNode: "  wf_a  ",
      toSkill: " rbac ",
      toKind: " role ",
      toValue: " manager ",
      label: " 审批人 ",
      severity: undefined,
    });
    expect(norm).toEqual({
      fromNode: "wf_a",
      toSkill: "rbac",
      toKind: "role",
      toValue: "manager",
      label: "审批人",
      severity: "error",
    });

    const normWarn = normalizeCrossRef({ fromNode: "n", toSkill: "s", toKind: "k", toValue: "v", severity: "warning" });
    expect(normWarn.severity).toBe("warning");
  });

  it("unresolved cross-skill references remain explicit as ghosts (未接入) in combined projection (negative case)", () => {
    // Provide rbac+workflow but omit datamodel: workflow's fieldRef and rbac's dataRule will dangle
    const result = slideRule.assemble("请假审批", {
      rbac: leaveApprovalRbac,
      workflow: leaveApprovalWorkflow,
    });
    expect(result.mermaid).toContain("(未接入)");
    expect(result.mermaid).toMatch(/ext_datamodel_/);
    // cross edges to ghost are present (do not disappear)
    expect(result.mermaid).toMatch(/-\.->.*ext_datamodel/);
  });

  it("publishGate positive: all cross-skill refs resolve when full skills present", async () => {
    const full = await deriveApplication("请假审批");
    const gate = slideRule.publishGate(full.spec.skills);
    expect(gate.publishable).toBe(true);
    expect(gate.blockers).toHaveLength(0);
    expect(gate.unresolvedRefs?.length ?? 0).toBe(0);
    expect(gate.result.mermaid).not.toContain("(未接入)");
  });

  it("publishGate negative: unresolved cross-skill refs make publishGate fail and stay explicit", () => {
    // missing datamodel => cross refs from rbac/workflow to datamodel are unresolved
    const gate = slideRule.publishGate({
      rbac: leaveApprovalRbac,
      workflow: leaveApprovalWorkflow,
    });
    expect(gate.publishable).toBe(false);
    expect(gate.blockers.some(b => b.code === "PUBLISH_DANGLING_CROSSREF")).toBe(true);
    expect(gate.unresolvedRefs && gate.unresolvedRefs.length > 0).toBe(true);
    expect(gate.result.mermaid).toContain("(未接入)");
    // normalized refs are present
    expect(gate.unresolvedRefs!.some(r => r.toSkill === "datamodel" && r.severity === "error")).toBe(true);
  });

  it("assembles the cross-runtime evidence graph from all six skill surfaces", async () => {
    const result = await deriveApplication("purchase approval");

    expect(result.crossRuntimeGraph.edges.length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(result.crossRuntimeGraph.bySkill)).toEqual([
      "datamodel",
      "rbac",
      "workflow",
      "page",
      "aigc",
      "appbundle",
    ]);
    expect(result.crossRuntimeGraph.edges.map(edge => `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`)).toEqual(
      expect.arrayContaining([
        "datamodel->rbac:allowed",
        "rbac->page:allowed",
        "workflow->appbundle:allowed",
        "page->appbundle:allowed",
        "aigc->rbac:allowed",
        "appbundle->aigc:allowed",
      ]),
    );
    expect(result.crossRuntimeGraph.evidenceBySkill.appbundle).toEqual(
      expect.arrayContaining([
        expect.stringContaining("APPBUNDLE_CROSS_RUNTIME_EVIDENCE:app_purchase_approval:aigc"),
      ]),
    );
  });

  it("buildCrossRuntimeGraph works as a pure aggregation API over assembled models", async () => {
    const result = await deriveApplication("purchase approval");
    const graph = slideRule.buildCrossRuntimeGraph(result.spec.skills);

    expect(graph.edges).toEqual(result.crossRuntimeGraph.edges);
    expect(graph.bySkill.rbac.some(edge => edge.targetSkill === "page" && edge.state === "allowed")).toBe(true);
    expect(graph.bySkill.datamodel.some(edge => edge.targetSkill === "aigc" && edge.evidenceKey?.includes("DM_CROSS_RUNTIME_EVIDENCE"))).toBe(true);
  });

  it("publishGate respects severity: warning dangling cross-refs do not block (positive soft), error does (negative)", () => {
    // helper to build a minimal skill pair for focused gate test (runtime-less)
    function makeSkills(warningRef: boolean) {
      const provider: Skill<{}> & CrossSkill<{}> = {
        id: "provider",
        title: "Provider",
        validate: () => ({ ok: true, errors: [], warnings: [] }),
        project: () => ({ nodes: [], edges: [], mermaid: "" }),
        resolve: () => ({}),
        crossRefs: () => [],
        refNodeId: () => null,
      };
      const consumer: Skill<{}> & CrossSkill<{}> = {
        id: "consumer",
        title: "Consumer",
        validate: () => ({ ok: true, errors: [], warnings: [] }),
        project: () => ({ nodes: [{ id: "c_node", label: "c", kind: "node" }], edges: [], mermaid: "" }),
        resolve: () => ({}),
        crossRefs: () => [{
          fromNode: "c_node",
          toSkill: "provider",
          toKind: "role",
          toValue: "admin",
          label: "ref",
          severity: warningRef ? "warning" : "error",
        }],
        refNodeId: () => null,
      };
      return { provider, consumer };
    }

    // warning case: unresolved but soft => publishable true, no blockers from dangling
    const w = makeSkills(true);
    const orchW = new Orchestrator().use(w.provider).use(w.consumer);
    const gateW = orchW.publishGate({ provider: {}, consumer: {} });
    expect(gateW.publishable).toBe(true);
    expect(gateW.blockers).toHaveLength(0);
    expect(gateW.unresolvedRefs && gateW.unresolvedRefs.length > 0).toBe(true);
    expect(gateW.unresolvedRefs!.some(r => r.severity === "warning")).toBe(true);

    // error case: unresolved hard => publishable false, has blocker
    const e = makeSkills(false);
    const orchE = new Orchestrator().use(e.provider).use(e.consumer);
    const gateE = orchE.publishGate({ provider: {}, consumer: {} });
    expect(gateE.publishable).toBe(false);
    expect(gateE.blockers.some(b => b.code === "PUBLISH_DANGLING_CROSSREF")).toBe(true);
    expect(gateE.unresolvedRefs!.some(r => r.severity === "error")).toBe(true);
  });
});

// 115.10.09: orchestrator tests for workflow/page/appbundle references into RBAC new PDP resolve surfaces
describe("orchestrator cross-skill RBAC PDP resolve boundary — workflow/page/appbundle refs to new surfaces", () => {
  it("rbac resolve surfaces (rowRule/fieldRule/decisionScope/policy) are exposed and resolvable by workflow/page/appbundle-style consumers (positive cross boundary)", () => {
    const rbacM = {
      ...leaveApprovalRbac,
      policyRules: [
        { id: "pr_wf_row", effect: "deny", resourceType: "leave_request" },
        { id: "pr_wf_fld", effect: "allow", fieldRef: "leave_request.status" },
      ],
    } as any;
    const surf = rbacSkill.resolve(rbacM);
    expect(surf.rowRule).toContain("pr_wf_row");
    expect(surf.fieldRule).toContain("pr_wf_fld");
    expect(surf.decisionScope).toContain("RBAC_DECISION_FAIL_CLOSED");
    expect(Array.isArray(surf.policy)).toBe(true);

    // simulate wf/page/appbundle ref resolution against the surface (as done in publishGate)
    const surfaces = { rbac: surf };
    const rowRef = { toSkill: "rbac", toKind: "rowRule", toValue: "pr_wf_row" };
    const fldRef = { toSkill: "rbac", toKind: "fieldRule", toValue: "pr_wf_fld" };
    const polRef = { toSkill: "rbac", toKind: "policy", toValue: surf.policy[0] };
    const decRef = { toSkill: "rbac", toKind: "decisionScope", toValue: "RBAC_DECISION_ALLOW" };
    expect(surfaces.rbac[rowRef.toKind]?.includes(rowRef.toValue)).toBe(true);
    expect(surfaces.rbac[fldRef.toKind]?.includes(fldRef.toValue)).toBe(true);
    expect(surfaces.rbac[polRef.toKind]?.includes(polRef.toValue)).toBe(true);
    expect(surfaces.rbac[decRef.toKind]?.includes(decRef.toValue)).toBe(true);
  });

  it("assemble and publishGate compute rbac surfaces with new keys and legacy role/permission remain usable by appbundle/workflow (compat)", () => {
    const result = slideRule.assemble("rbac surface compat", {
      rbac: leaveApprovalRbac,
    });
    const rbacModel = result.spec.skills.rbac;
    const surf = rbacSkill.resolve(rbacModel as any);
    // new surfaces always present (even if empty)
    expect(Array.isArray(surf.rowRule)).toBe(true);
    expect(Array.isArray(surf.fieldRule)).toBe(true);
    expect(Array.isArray(surf.decisionScope)).toBe(true);
    // workflow/app/page can still ref role/permission
    expect(surf.role.length).toBeGreaterThan(0);
    expect(surf.permission.length).toBeGreaterThan(0);
    // use datamodel to close rbac's dataRule cross (otherwise dangling prevents publishable); new surfaces compat not affected
    const gate = slideRule.publishGate({ rbac: leaveApprovalRbac, datamodel: leaveRequestDataModel });
    // surfaces are computed regardless; with minimal pair the rbac cross closes, publishable may be true for this pair
    expect(gate.unresolvedRefs?.some(r => r.toSkill === "datamodel") ?? false).toBe(false);
  });
});
