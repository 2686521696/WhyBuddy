import { describe, expect, it } from "vitest";

import { slideRule } from "./slideRule";
import { purchaseRiskAigcModel } from "./aigc/aigcSkill";
import { leaveApprovalAppBundle, purchaseApprovalAppBundle } from "./appbundle/appBundleSkill";
import { leaveRequestDataModel, purchaseApprovalDataModel } from "./datamodel/dataModelSkill";
import { leaveApprovalPage, purchaseApprovalPage } from "./page/pageSkill";
import { leaveApprovalRbac, purchaseApprovalRbac } from "./rbac/rbacSkill";
import { leaveApprovalWorkflow, purchaseApprovalWorkflow } from "./workflow/workflowSkill";
import type { ImpactReport } from "./orchestrator";

const models = {
  datamodel: leaveRequestDataModel,
  rbac: leaveApprovalRbac,
  workflow: leaveApprovalWorkflow,
  page: leaveApprovalPage,
  appbundle: leaveApprovalAppBundle,
};

const purchaseModels = {
  datamodel: purchaseApprovalDataModel,
  rbac: purchaseApprovalRbac,
  workflow: purchaseApprovalWorkflow,
  page: purchaseApprovalPage,
  aigc: purchaseRiskAigcModel,
  appbundle: purchaseApprovalAppBundle,
};

function impactedNodes(report: ImpactReport): string[] {
  return report.impacted.map(hit => hit.node);
}

function hasPath(report: ImpactReport, expectedNodes: string[]): boolean {
  return report.paths.some(path => {
    const nodes = path.steps.map(step => step.node);
    return expectedNodes.every((node, index) => nodes[index] === node);
  });
}

describe("cross-system impact analysis (global dependency graph)", () => {
  it("builds the dependency graph from Skill projections and cross refs", () => {
    const graph = slideRule.buildDependencyGraph(models);

    expect(graph.nodes.some(node => node.node === "dm_leave_request_approved")).toBe(true);
    expect(graph.nodes.some(node => node.node === "cmp_approve")).toBe(true);
    expect(graph.nodes.some(node => node.node === "page_page_leave_request")).toBe(true);
    expect(graph.nodes.some(node => node.node === "app_app_leave_approval")).toBe(true);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "datamodel::dm_leave_request_approved",
          to: "page::cmp_approve",
          kind: "crossRef",
        }),
        expect.objectContaining({
          from: "page::cmp_approve",
          to: "page::page_page_leave_request",
          kind: "owner",
        }),
        expect.objectContaining({
          from: "page::page_page_leave_request",
          to: "appbundle::app_app_leave_approval",
          kind: "crossRef",
        }),
      ]),
    );
  });

  it("a DataModel field change ripples into Page binding and the AppBundle path", () => {
    const report = slideRule.impact(models, { skill: "datamodel", kind: "field", value: "leave_request.approved" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toEqual(
      expect.arrayContaining(["cmp_approve", "page_page_leave_request", "app_app_leave_approval"]),
    );
    expect(hasPath(report, [
      "dm_leave_request_approved",
      "cmp_approve",
      "page_page_leave_request",
      "app_app_leave_approval",
    ])).toBe(true);
  });

  it("a RBAC role change reports Workflow approval, Page render, menu entry, and AppBundle paths", () => {
    const report = slideRule.impact(models, { skill: "rbac", kind: "role", value: "manager" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toEqual(
      expect.arrayContaining(["wf_a_mgr", "cmp_approve", "menu_menu_leave_request", "app_app_leave_approval"]),
    );
    expect(hasPath(report, ["role_manager", "wf_a_mgr", "wf_wf_leave_approval", "app_app_leave_approval"])).toBe(true);
    expect(hasPath(report, ["role_manager", "cmp_approve", "page_page_leave_request", "app_app_leave_approval"])).toBe(true);
    expect(hasPath(report, ["role_manager", "menu_menu_leave_request", "app_app_leave_approval"])).toBe(true);
  });

  it("a Workflow change ripples into the AppBundle", () => {
    const report = slideRule.impact(models, { skill: "workflow", kind: "workflow", value: "wf_leave_approval" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toContain("app_app_leave_approval");
    expect(hasPath(report, ["wf_wf_leave_approval", "app_app_leave_approval"])).toBe(true);
  });

  it("a Workflow version change ripples into the AppBundle", () => {
    const report = slideRule.impact(models, { skill: "workflow", kind: "version", value: "wf_leave_approval" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toContain("app_app_leave_approval");
    expect(hasPath(report, ["wf_wf_leave_approval_ver", "wf_wf_leave_approval", "app_app_leave_approval"])).toBe(true);
  });

  it("a Workflow node change ripples into the AppBundle", () => {
    const report = slideRule.impact(models, { skill: "workflow", kind: "node", value: "a_mgr" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toContain("app_app_leave_approval");
    expect(hasPath(report, ["wf_a_mgr", "wf_wf_leave_approval", "app_app_leave_approval"])).toBe(true);
  });

  it("a Page change ripples into the AppBundle", () => {
    const report = slideRule.impact(models, { skill: "page", kind: "page", value: "page_leave_request" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toContain("app_app_leave_approval");
    expect(hasPath(report, ["page_page_leave_request", "app_app_leave_approval"])).toBe(true);
  });

  it("an unreferenced role is safe to change", () => {
    const report = slideRule.impact(models, { skill: "rbac", kind: "role", value: "auditor" });

    expect(report.safe).toBe(true);
    expect(report.impacted).toHaveLength(0);
    expect(report.paths).toHaveLength(0);
  });

  it("reports nothing for a resource that does not exist", () => {
    const report = slideRule.impact(models, { skill: "rbac", kind: "role", value: "ghost" });

    expect(report.safe).toBe(true);
    expect(report.impacted).toHaveLength(0);
  });

  it("a purchase_request.amount field change impacts Page components, Workflow branches, AIGC, and AppBundle (multi-hop)", () => {
    const report = slideRule.impact(purchaseModels, {
      skill: "datamodel",
      kind: "field",
      value: "purchase_request.amount",
    });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toEqual(
      expect.arrayContaining([
        "aigc_cap_budget_risk_summary",
        "cmp_amount",
        "page_page_purchase_request",
        "app_app_purchase_approval",
        "wf_wf_purchase_approval",
      ]),
    );
    expect(hasPath(report, ["dm_purchase_request_amount", "aigc_cap_budget_risk_summary"])).toBe(true);
    expect(hasPath(report, ["dm_purchase_request_amount", "cmp_amount", "page_page_purchase_request", "app_app_purchase_approval"])).toBe(true);
    expect(hasPath(report, ["dm_purchase_request_amount", "wf_wf_purchase_approval", "app_app_purchase_approval"])).toBe(true);
  });

  it("a finance role change impacts the AIGC budget risk summary and reaches purchase AppBundle", () => {
    const report = slideRule.impact(purchaseModels, {
      skill: "rbac",
      kind: "role",
      value: "finance",
    });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toEqual(expect.arrayContaining(["aigc_cap_budget_risk_summary", "app_app_purchase_approval"]));
    expect(hasPath(report, ["role_finance", "aigc_cap_budget_risk_summary"])).toBe(true);
    expect(hasPath(report, ["role_finance", "app_app_purchase_approval"])).toBe(true);
    expect(hasPath(report, ["role_finance", "aigc_cap_budget_risk_summary", "app_app_purchase_approval"])).toBe(true);
  });

  it("a RBAC fieldRule change impacts DataModel-field consumers across Workflow, Page, AIGC, and AppBundle", () => {
    const rbacWithFieldRule = structuredClone(purchaseApprovalRbac);
    rbacWithFieldRule.policyRules = [
      {
        id: "pr_amount_field_policy",
        effect: "deny",
        roleId: "finance",
        resourceType: "purchase_request",
        fieldRef: "purchase_request.amount",
        reason: "amount policy changed",
      },
    ];

    const report = slideRule.impact(
      { ...purchaseModels, rbac: rbacWithFieldRule },
      { skill: "rbac", kind: "fieldRule", value: "pr_amount_field_policy" },
    );

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toEqual(
      expect.arrayContaining([
        "dm_purchase_request_amount",
        "cmp_amount",
        "wf_wf_purchase_approval",
        "aigc_cap_budget_risk_summary",
        "app_app_purchase_approval",
      ]),
    );
    expect(hasPath(report, ["policy_pr_amount_field_policy", "dm_purchase_request_amount", "cmp_amount", "page_page_purchase_request", "app_app_purchase_approval"])).toBe(true);
    expect(hasPath(report, ["policy_pr_amount_field_policy", "dm_purchase_request_amount", "wf_wf_purchase_approval", "app_app_purchase_approval"])).toBe(true);
    expect(hasPath(report, ["policy_pr_amount_field_policy", "dm_purchase_request_amount", "aigc_cap_budget_risk_summary", "app_app_purchase_approval"])).toBe(true);
  });

  it("a purchase page change ripples into the AppBundle", () => {
    const report = slideRule.impact(purchaseModels, { skill: "page", kind: "page", value: "page_purchase_request" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toContain("app_app_purchase_approval");
    expect(hasPath(report, ["page_page_purchase_request", "app_app_purchase_approval"])).toBe(true);
  });

  it("a purchase workflow change ripples into the AppBundle", () => {
    const report = slideRule.impact(purchaseModels, { skill: "workflow", kind: "workflow", value: "wf_purchase_approval" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toContain("app_app_purchase_approval");
    expect(hasPath(report, ["wf_wf_purchase_approval", "app_app_purchase_approval"])).toBe(true);
  });

  it("an AIGC capability source change ripples into the AppBundle", () => {
    const report = slideRule.impact(purchaseModels, { skill: "aigc", kind: "capability", value: "budget_risk_summary" });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toContain("app_app_purchase_approval");
    expect(hasPath(report, ["aigc_cap_budget_risk_summary", "app_app_purchase_approval"])).toBe(true);
  });

  // field deletion and field deprecation impact examples (implementation requirement)
  it("a deprecated DataModel field change ripples into Page, RBAC (policy), and AppBundle (positive)", () => {
    const deprDm = {
      entities: [
        {
          id: "purchase_request",
          name: "Purchase Request",
          fields: [
            { key: "amount", name: "Amount", type: "number", lifecycle: "deprecated", required: false },
          ],
        },
      ],
    };
    const deprPage = {
      id: "page_purchase_request",
      name: "Purchase Request Page",
      entity: "purchase_request",
      components: [
        { id: "amount", type: "number", label: "Amount", field: "purchase_request.amount", visibleToRoles: ["finance"] },
      ],
      linkageRules: [],
    };
    const deprRbac = {
      failClosed: false,
      permissions: [],
      menus: [],
      roles: [],
      departments: [],
      positions: [],
      users: [],
      dataRules: [],
      selfGrantDenials: [],
      dualControlPolicies: [],
      policyRules: [
        { id: "pol_amount_fld", effect: "allow", fieldRef: "purchase_request.amount" },
      ],
    };
    const deprApp = {
      id: "app_purchase_approval",
      name: "Purchase Approval",
      entityRefs: ["purchase_request"],
      roleRefs: ["finance"],
      workflowRefs: [],
      pageRefs: ["page_purchase_request"],
      aigcCapabilityRefs: [],
      menuEntries: [],
      pageBindings: [],
    };
    const deprModels = { datamodel: deprDm, page: deprPage, rbac: deprRbac, appbundle: deprApp };

    const report = slideRule.impact(deprModels, {
      skill: "datamodel",
      kind: "field",
      value: "purchase_request.amount",
    });

    expect(report.safe).toBe(false);
    expect(impactedNodes(report)).toEqual(
      expect.arrayContaining(["cmp_amount", "page_page_purchase_request", "app_app_purchase_approval", "policy_pol_amount_fld"]),
    );
    expect(hasPath(report, ["dm_purchase_request_amount", "cmp_amount", "page_page_purchase_request", "app_app_purchase_approval"])).toBe(true);
    expect(hasPath(report, ["dm_purchase_request_amount", "policy_pol_amount_fld"])).toBe(true);
  });

  it("a removed DataModel field (deletion) still produces impact paths (positive)", () => {
    const remDm = {
      entities: [
        {
          id: "purchase_request",
          name: "Purchase Request",
          fields: [
            { key: "amount", name: "Amount", type: "number", lifecycle: "removed", required: false },
          ],
        },
      ],
    };
    const remPage = {
      id: "page_purchase_request",
      name: "Purchase Request Page",
      entity: "purchase_request",
      components: [{ id: "amount", type: "number", label: "Amount", field: "purchase_request.amount" }],
      linkageRules: [],
    };
    const remApp = {
      id: "app_purchase_approval",
      name: "Purchase Approval",
      entityRefs: ["purchase_request"],
      roleRefs: [],
      workflowRefs: [],
      pageRefs: ["page_purchase_request"],
      aigcCapabilityRefs: [],
      menuEntries: [],
      pageBindings: [],
    };
    const remModels = { datamodel: remDm, page: remPage, appbundle: remApp };

    const report = slideRule.impact(remModels, {
      skill: "datamodel",
      kind: "field",
      value: "purchase_request.amount",
    });

    expect(report.safe).toBe(false);
    expect(hasPath(report, ["dm_purchase_request_amount", "cmp_amount", "page_page_purchase_request", "app_app_purchase_approval"])).toBe(true);
  });

  it("a non-existent field reports safe (negative case for impact)", () => {
    const dm = {
      entities: [
        {
          id: "ghost",
          name: "Ghost",
          fields: [{ key: "secret", name: "Secret", type: "string", lifecycle: "deprecated" }],
        },
      ],
    };
    const report = slideRule.impact({ datamodel: dm }, { skill: "datamodel", kind: "field", value: "ghost.nonexistent" });

    expect(report.safe).toBe(true);
    expect(report.impacted).toHaveLength(0);
    expect(report.paths).toHaveLength(0);
  });
});
