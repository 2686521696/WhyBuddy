import { describe, expect, it } from "vitest";

import { slideRule } from "./slideRule";
import { leaveApprovalRbac } from "./rbac/rbacSkill";
import { leaveApprovalWorkflow } from "./workflow/workflowSkill";
import { leaveRequestDataModel } from "./datamodel/dataModelSkill";

// The assembled application all three skills describe.
const models = {
  datamodel: leaveRequestDataModel,
  rbac: leaveApprovalRbac,
  workflow: leaveApprovalWorkflow,
};

describe("cross-system impact analysis (review finding P0-2, executable)", () => {
  it("a RBAC role change ripples into the WORKFLOW that references it", () => {
    const report = slideRule.impact(models, { skill: "rbac", kind: "role", value: "manager" });
    expect(report.safe).toBe(false);
    // the workflow approval node "主管审批" depends on rbac role manager (via 审批人)
    const hit = report.impacted.find(i => i.skill === "workflow");
    expect(hit).toBeTruthy();
    expect(hit!.label).toBe("主管审批");
    expect(hit!.via).toBe("审批人");
  });

  it("a DataModel entity change ripples into the RBAC data rules that reference it", () => {
    const report = slideRule.impact(models, { skill: "datamodel", kind: "entity", value: "leave_request" });
    expect(report.safe).toBe(false);
    const rbacHits = report.impacted.filter(i => i.skill === "rbac");
    // both data rules (员工只看自己 / 主管看本部门) point at leave_request
    expect(rbacHits.length).toBe(2);
    expect(rbacHits.every(h => h.via === "数据")).toBe(true);
  });

  it("an unreferenced role is SAFE to change (nothing depends on it)", () => {
    const report = slideRule.impact(models, { skill: "rbac", kind: "role", value: "employee" });
    // no workflow assignee or other cross-ref points at employee → safe
    expect(report.safe).toBe(true);
    expect(report.impacted).toHaveLength(0);
  });

  it("reports nothing for a resource that does not exist", () => {
    const report = slideRule.impact(models, { skill: "rbac", kind: "role", value: "ghost" });
    expect(report.safe).toBe(true);
  });
});
