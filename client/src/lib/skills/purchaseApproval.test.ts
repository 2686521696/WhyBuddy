import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveApplication, slideRule } from "./slideRule";
import { evaluateAppBundleRuntimeClosure, purchaseApprovalAppBundle } from "./appbundle/appBundleSkill";
import { purchaseApprovalDataModel } from "./datamodel/dataModelSkill";
import { purchaseApprovalRbac } from "./rbac/rbacSkill";
import { purchaseApprovalWorkflow } from "./workflow/workflowSkill";
import { purchaseApprovalPage } from "./page/pageSkill";
import { purchaseRiskAigcModel } from "./aigc/aigcSkill";

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
      "aigc",
      "appbundle",
    ]);
    expect(result.mermaid).not.toContain("未接入");
    expect(result.spec.skills.appbundle).toMatchObject({
      id: "app_purchase_approval",
      roleRefs: ["requester", "department_manager", "finance", "procurement"],
      workflowRefs: ["wf_purchase_approval"],
      pageRefs: ["page_purchase_request"],
      aigcCapabilityRefs: ["budget_risk_summary"],
    });
    expect(result.spec.skills.aigc).toMatchObject({
      id: "aigc_purchase_risk",
    });
    expect((result.spec.skills.aigc as any).outputSchemas[0].fields.map((field: any) => field.key)).toContain("recommendedAction");
    expect(result.mermaid).toContain("budget_risk_summary");
  });

  it("keeps the purchase approval publishGate green", async () => {
    const result = await deriveApplication("purchase approval");
    const publishGate = slideRule.publishGate(result.spec.skills);

    expect(publishGate.publishable).toBe(true);
    expect(publishGate.blockers).toHaveLength(0);
  });

  it("returns AppBundle runtime closure evidence from publishGate", async () => {
    const result = await deriveApplication("purchase approval");
    const publishGate = slideRule.publishGate(result.spec.skills);

    expect(publishGate.runtimeClosure).toBeDefined();
    expect(publishGate.runtimeClosure?.blocked).toBe(false);
    expect(publishGate.runtimeClosure?.blockers).toHaveLength(0);
    expect(publishGate.runtimeClosure?.runtimeClosure?.skillsChecked).toEqual(
      expect.arrayContaining(["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]),
    );
    expect(publishGate.runtimeClosure?.perSkillEvidence.aigc.aigcInvocationOutputPolicy).toBe(true);
    expect(publishGate.runtimeClosure?.perSkillEvidence.page.workflowPageTaskViewConsistency).toBe(true);
    expect(publishGate.runtimeClosure?.perSkillEvidence.rbac.rbacPdpDecisions).toBe(true);

    // Positive evidence: runtime closure summary attached to release artifact in publish gate return.
    expect(publishGate.releaseArtifactWithRuntimeClosure).toBeDefined();
    expect(publishGate.releaseArtifactWithRuntimeClosure?.appId).toBe("app_purchase_approval");
    expect(publishGate.releaseArtifactWithRuntimeClosure?.runtimeClosureSummary?.blocked).toBe(false);
    expect(publishGate.releaseArtifactWithRuntimeClosure?.runtimeClosureSummary?.closureId).toContain("runtime-closure");
    expect(publishGate.releaseArtifactWithRuntimeClosure?.runtimeClosureSummary?.evidencePresentCount).toBeGreaterThan(0);

    // Positive: publish closure evidence digest exposed via AppBundle publish manifest surface.
    expect(publishGate.publishManifestWithClosureDigest).toBeDefined();
    expect(publishGate.publishManifestWithClosureDigest?.appId).toBe("app_purchase_approval");
    expect(publishGate.publishManifestWithClosureDigest?.closureEvidenceDigest).toBe(publishGate.runtimeClosure?.stableDigest);
    expect(typeof publishGate.publishManifestWithClosureDigest?.closureEvidenceDigest).toBe("string");
    expect(/^[0-9a-f]{6,}$/i.test(publishGate.publishManifestWithClosureDigest?.closureEvidenceDigest ?? "")).toBe(true);
  });

  it("blocks publishGate through runtime closure when a declared Skill model is missing", async () => {
    const result = await deriveApplication("purchase approval");
    const models = { ...result.spec.skills };
    delete (models as Record<string, unknown>).aigc;
    const publishGate = slideRule.publishGate(models);

    expect(publishGate.publishable).toBe(false);
    expect(publishGate.runtimeClosure?.blocked).toBe(true);
    expect(publishGate.runtimeClosure?.perSkillEvidence.aigc.evidencePresent).toBe(false);
    expect(
      publishGate.blockers.some((blocker) => blocker.code === "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED")
    ).toBe(true);

    // Fail-closed negative: blocked summary is still attached to release artifact evidence (no weakening).
    expect(publishGate.releaseArtifactWithRuntimeClosure).toBeDefined();
    expect(publishGate.releaseArtifactWithRuntimeClosure?.runtimeClosureSummary?.blocked).toBe(true);
    expect(publishGate.releaseArtifactWithRuntimeClosure?.runtimeClosureSummary?.blockerCount).toBeGreaterThan(0);

    // Fail-closed negative: publish manifest still receives the closure evidence digest (surface exposure not weakened).
    expect(publishGate.publishManifestWithClosureDigest).toBeDefined();
    expect(publishGate.publishManifestWithClosureDigest?.closureEvidenceDigest).toBe(publishGate.runtimeClosure?.stableDigest);
    expect(typeof publishGate.publishManifestWithClosureDigest?.closureEvidenceDigest).toBe("string");
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
      expect.arrayContaining(["cmp_amount", "aigc_cap_budget_risk_summary", "page_page_purchase_request", "app_app_purchase_approval"]),
    );
    expect(pathIncludes(amountImpact, [
      "dm_purchase_request_amount",
      "cmp_amount",
      "page_page_purchase_request",
      "app_app_purchase_approval",
    ])).toBe(true);
    expect(pathIncludes(amountImpact, [
      "dm_purchase_request_amount",
      "aigc_cap_budget_risk_summary",
      "app_app_purchase_approval",
    ])).toBe(true);

    expect(financeImpact.safe).toBe(false);
    expect(financeImpact.impacted.map(hit => hit.node)).toEqual(
      expect.arrayContaining(["wf_finance", "cmp_financeApprove", "aigc_cap_budget_risk_summary", "app_app_purchase_approval"]),
    );
    expect(pathIncludes(financeImpact, [
      "role_finance",
      "wf_finance",
      "wf_wf_purchase_approval",
      "app_app_purchase_approval",
    ])).toBe(true);
    expect(pathIncludes(financeImpact, [
      "role_finance",
      "aigc_cap_budget_risk_summary",
      "app_app_purchase_approval",
    ])).toBe(true);
  });

  it("keeps leave approval green while purchase approval is added", async () => {
    const result = await deriveApplication("leave approval");

    expect(result.ok).toBe(true);
    expect(result.spec.skills.appbundle).toMatchObject({ id: "app_leave_approval" });
  });

  it("exposes explicit per-skill positive runtime closure evidence for purchase approval AppBundle (positive coverage incl aigc)", () => {
    // direct per-skill evidence using purchase fixture (incl aigc) to prove purchase AppBundle per-skill positive evidence
    const purchaseModels = {
      appbundle: purchaseApprovalAppBundle,
      datamodel: purchaseApprovalDataModel,
      rbac: purchaseApprovalRbac,
      workflow: purchaseApprovalWorkflow,
      page: purchaseApprovalPage,
      aigc: purchaseRiskAigcModel,
    };
    const report = evaluateAppBundleRuntimeClosure(purchaseModels);
    expect(report.blocked).toBe(false);
    expect(report.perSkillEvidence.datamodel?.evidencePresent).toBe(true);
    expect(report.perSkillEvidence.datamodel?.dataModelBindings).toBe(true);
    expect(report.perSkillEvidence.rbac?.evidencePresent).toBe(true);
    expect(report.perSkillEvidence.rbac?.rbacPdpDecisions).toBe(true);
    expect(report.perSkillEvidence.workflow?.evidencePresent).toBe(true);
    expect(report.perSkillEvidence.workflow?.workflowPageTaskViewConsistency).toBe(true);
    expect(report.perSkillEvidence.page?.evidencePresent).toBe(true);
    expect(report.perSkillEvidence.page?.workflowPageTaskViewConsistency).toBe(true);
    expect(report.perSkillEvidence.aigc?.evidencePresent).toBe(true);
    expect(report.perSkillEvidence.aigc?.aigcInvocationOutputPolicy).toBe(true);
    expect(report.perSkillEvidence.appbundle?.evidencePresent).toBe(true);
    expect(report.perSkillEvidence.appbundle?.versionPin?.pinned).toBe(true);
    expect(report.findingsByTier?.hard_blocker ?? []).toHaveLength(0);
    expect(report.closureId).toBe("appbundle:app_purchase_approval@1.0.0:runtime-closure");
  });

  it("loads real AppBundle publish artifacts for inspect hash rollback and block evidence", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixtureDir = resolve(here, "../../../../slide-rule-python/tests/fixtures");
    const closed = JSON.parse(
      readFileSync(resolve(fixtureDir, "closed_appbundle_publish_artifact.json"), "utf8")
    );
    const blocked = JSON.parse(
      readFileSync(resolve(fixtureDir, "blocked_appbundle_publish_artifact.json"), "utf8")
    );

    expect(closed.appId).toBe("app_purchase_approval");
    expect(closed.appVersion).toBe("1.0.0");
    expect(closed.runtimeClosureSummary?.blocked).toBe(false);
    expect(closed.runtimeClosureSummary?.evidencePresentCount).toBe(6);
    expect(closed.runtimeClosure?.skillsChecked).toEqual(
      expect.arrayContaining(["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"])
    );
    expect(closed.manifest?.closureEvidenceDigest).toBe(
      closed.runtimeClosureSummary?.stableDigest
    );
    expect(closed.perSkillEvidence.datamodel?.evidencePresent).toBe(true);
    expect(closed.perSkillEvidence.appbundle?.artifactId).toContain("artifact-");

    expect(blocked.appId).toBe("app_purchase_approval");
    expect(blocked.runtimeClosureSummary?.blocked).toBe(true);
    expect(blocked.runtimeClosureSummary?.blockerCount).toBeGreaterThan(0);
    expect(blocked.perSkillEvidence.aigc?.evidencePresent).toBe(false);
    expect(blocked.findingsByTier?.hard_blocker?.[0]?.code).toBe(
      "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED"
    );
    expect(closed.runtimeClosureSummary?.stableDigest).not.toBe(
      blocked.runtimeClosureSummary?.stableDigest
    );
  });
});
