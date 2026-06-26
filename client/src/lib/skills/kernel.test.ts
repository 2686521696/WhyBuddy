import { describe, expect, it } from "vitest";

import { slideRule } from "./slideRule";
import { leaveApprovalRbac, rbacSkill } from "./rbac/rbacSkill";
import { leaveApprovalWorkflow } from "./workflow/workflowSkill";
import { leaveRequestDataModel } from "./datamodel/dataModelSkill";
import type { RbacModel } from "./rbac/rbacModel";
import type {
  KernelRole,
  SkillRuntimeRole,
  DependencyRef,
  VersionPin,
  PolicyDecision,
  PublishGateReport,
  ImpactReport,
  SkillCapabilitySurface,
  SkillDefinition,
} from "./skill";

const models = {
  datamodel: leaveRequestDataModel,
  rbac: leaveApprovalRbac,
  workflow: leaveApprovalWorkflow,
};

describe("kernel ① — Separation of Duties design gate", () => {
  it("CATCHES a role that holds two mutually-exclusive duties (自发起+自审批)", () => {
    const withSod: RbacModel = {
      ...leaveApprovalRbac,
      sodConstraints: [{ name: "请假不可自发起又自审批", mutuallyExclusive: ["leave:create", "leave:approve"] }],
    };
    const report = rbacSkill.validate(withSod);
    // manager holds BOTH leave:create and leave:approve → violation
    expect(report.ok).toBe(false);
    const hit = report.errors.find(e => e.code === "RBAC_SOD_VIOLATION");
    expect(hit).toBeTruthy();
    expect(hit!.message).toContain("主管");
  });

  it("passes when no SoD constraints are declared (opt-in)", () => {
    expect(rbacSkill.validate(leaveApprovalRbac).ok).toBe(true);
  });
});

describe("kernel ⑥ — publish gate (cross-system closure)", () => {
  it("an internally-consistent app is publishable", () => {
    const gate = slideRule.publishGate(models);
    expect(gate.publishable).toBe(true);
    expect(gate.blockers).toHaveLength(0);
  });

  it("BLOCKS publish when a cross-system reference does not resolve", () => {
    const badWorkflow = structuredClone(leaveApprovalWorkflow);
    badWorkflow.nodes.find(n => n.id === "a_mgr")!.assigneeRole = "director"; // not in rbac
    const gate = slideRule.publishGate({ ...models, workflow: badWorkflow });
    expect(gate.publishable).toBe(false);
    // both the skill gate (WF_ASSIGNEE_MISSING_ROLE) and the closure check fire
    expect(gate.blockers.some(b => b.code === "PUBLISH_DANGLING_CROSSREF")).toBe(true);
  });

  it("BLOCKS publish when DataModel is missing (rbac data rule dangles)", () => {
    const gate = slideRule.publishGate({ rbac: leaveApprovalRbac, workflow: leaveApprovalWorkflow });
    // no datamodel registered in this set → rbac dataRule -> datamodel entity cannot resolve
    expect(gate.publishable).toBe(false);
    expect(gate.blockers.some(b => b.code === "PUBLISH_DANGLING_CROSSREF")).toBe(true);
  });
});

describe("V2 shared contract — kernel vocabulary (PDP/SSOT/PEP/assembly)", () => {
  it("V2 Skill can declare PDP, SSOT, PEP, and assembly-root semantics", () => {
    const pdpRole: KernelRole = "pdp-host";
    const ssotRole: KernelRole = "ssot-host";
    const pepRole: KernelRole = "pep";
    const assemblyRole: KernelRole = "assembly-root";

    const runtime: SkillRuntimeRole = "kernel";

    const dep: DependencyRef = { to: "datamodel", kind: "entity", ref: "leaveRequest" };
    const pin: VersionPin = { skillId: "rbac", version: "1.0.0" };
    const decision: PolicyDecision = { decision: "allow", ruleId: "rbac:1" };

    const publish: PublishGateReport = { publishable: true, blockers: [] };
    const impact: ImpactReport = { affectedSkills: ["workflow"], summary: "minor" };

    const surface: SkillCapabilitySurface = {
      kernelRole: pdpRole,
      runtimeRole: runtime,
      provides: ["role", "permission"],
      delegatesTo: [],
      bindsTo: [dep],
      versionPins: [pin],
      policyDecisions: [decision],
      publishGates: [publish],
      impacts: [impact],
    };

    const def: SkillDefinition = {
      id: "rbac",
      title: "RBAC",
      kernelRole: "pdp-host",
      runtimeRole: "kernel",
      provides: ["role"],
      delegatesTo: [],
      bindsTo: [],
      capability: surface,
    };

    expect(pdpRole).toBe("pdp-host");
    expect(ssotRole).toBe("ssot-host");
    expect(pepRole).toBe("pep");
    expect(assemblyRole).toBe("assembly-root");
    expect(def.kernelRole).toBe("pdp-host");
    expect(def.capability?.provides).toContain("role");
  });

  it("does not break existing validate/project/resolve/generate usage", () => {
    // existing paths must continue to work
    expect(rbacSkill.validate(leaveApprovalRbac).ok).toBe(true);
    const proj = rbacSkill.project(leaveApprovalRbac);
    expect(proj.nodes.length).toBeGreaterThan(0);
    const res = rbacSkill.resolve(leaveApprovalRbac);
    expect(res).toBeDefined();
    // generate is optional and may be absent in some
    if (rbacSkill.generate) {
      // do not actually invoke without setup
      expect(typeof rbacSkill.generate).toBe("function");
    }
  });
});
