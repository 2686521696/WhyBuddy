import { describe, expect, it } from "vitest";

import { slideRule } from "./slideRule";
import { leaveApprovalAppBundle } from "./appbundle/appBundleSkill";
import { leaveRequestDataModel } from "./datamodel/dataModelSkill";
import { leaveApprovalPage } from "./page/pageSkill";
import { leaveApprovalRbac } from "./rbac/rbacSkill";
import { leaveApprovalWorkflow } from "./workflow/workflowSkill";
import type { ImpactReport } from "./orchestrator";

const models = {
  datamodel: leaveRequestDataModel,
  rbac: leaveApprovalRbac,
  workflow: leaveApprovalWorkflow,
  page: leaveApprovalPage,
  appbundle: leaveApprovalAppBundle,
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
});
