import { describe, expect, it } from "vitest";

import { deriveApplication, slideRule } from "./slideRule";

function pathIncludes(report: ReturnType<typeof slideRule.impact>, nodes: string[]): boolean {
  return report.paths.some(path => {
    const pathNodes = path.steps.map(step => step.node);
    return nodes.every((node, index) => pathNodes[index] === node);
  });
}

describe("purchase approval E2E scenario", () => {
  it("assembles purchase approval across RBAC, DataModel, Workflow, Page, and AppBundle", async () => {
    const result = await deriveApplication("purchase approval");

    expect(result.ok).toBe(true);
    expect(result.report.totals.errors).toBe(0);
    expect(result.report.totals.warnings).toBe(0);
    expect(result.report.bySkill.map(skill => skill.skillId)).toEqual([
      "datamodel",
      "rbac",
      "workflow",
      "page",
      "appbundle",
    ]);
    expect(result.mermaid).not.toContain("未接入");
    expect(result.spec.skills.appbundle).toMatchObject({
      id: "app_purchase_approval",
      roleRefs: ["requester", "department_manager", "finance", "procurement"],
      workflowRefs: ["wf_purchase_approval"],
      pageRefs: ["page_purchase_request"],
    });
  });

  it("keeps the purchase approval publishGate green", async () => {
    const result = await deriveApplication("purchase approval");
    const publishGate = slideRule.publishGate(result.spec.skills);

    expect(publishGate.publishable).toBe(true);
    expect(publishGate.blockers).toHaveLength(0);
  });

  it("returns impact paths for purchase amount and finance role", async () => {
    const result = await deriveApplication("purchase approval");
    const amountImpact = slideRule.impact(result.spec.skills, {
      skill: "datamodel",
      kind: "field",
      value: "purchase_request.amount",
    });
    const financeImpact = slideRule.impact(result.spec.skills, {
      skill: "rbac",
      kind: "role",
      value: "finance",
    });

    expect(amountImpact.safe).toBe(false);
    expect(amountImpact.impacted.map(hit => hit.node)).toEqual(
      expect.arrayContaining(["cmp_amount", "page_page_purchase_request", "app_app_purchase_approval"]),
    );
    expect(pathIncludes(amountImpact, [
      "dm_purchase_request_amount",
      "cmp_amount",
      "page_page_purchase_request",
      "app_app_purchase_approval",
    ])).toBe(true);

    expect(financeImpact.safe).toBe(false);
    expect(financeImpact.impacted.map(hit => hit.node)).toEqual(
      expect.arrayContaining(["wf_finance", "cmp_financeApprove", "app_app_purchase_approval"]),
    );
    expect(pathIncludes(financeImpact, [
      "role_finance",
      "wf_finance",
      "wf_wf_purchase_approval",
      "app_app_purchase_approval",
    ])).toBe(true);
  });

  it("keeps leave approval green while purchase approval is added", async () => {
    const result = await deriveApplication("leave approval");

    expect(result.ok).toBe(true);
    expect(result.spec.skills.appbundle).toMatchObject({ id: "app_leave_approval" });
  });
});
