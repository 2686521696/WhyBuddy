import { describe, expect, it } from "vitest";

import { slideRule } from "./slideRule";
import { leaveRequestDataModel } from "./datamodel/dataModelSkill";
import { leaveApprovalRbac, rbacSkill } from "./rbac/rbacSkill";
import type { RbacModel } from "./rbac/rbacModel";
import { leaveApprovalWorkflow } from "./workflow/workflowSkill";
import type {
  DependencyRef,
  ImpactReport,
  KernelRole,
  PolicyDecision,
  PublishGateReport,
  SkillCapabilitySurface,
  SkillDefinition,
  SkillRuntimeRole,
  VersionPin,
} from "./skill";

const models = {
  datamodel: leaveRequestDataModel,
  rbac: leaveApprovalRbac,
  workflow: leaveApprovalWorkflow,
};

describe("kernel 3 - Separation of Duties design gate", () => {
  it("catches a role that holds two mutually-exclusive duties", () => {
    const withSod: RbacModel = {
      ...leaveApprovalRbac,
      sodConstraints: [{ name: "leave requester cannot self approve", mutuallyExclusive: ["leave:create", "leave:approve"] }],
    };
    const report = rbacSkill.validate(withSod);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "RBAC_SOD_VIOLATION")).toBe(true);
  });

  it("passes when no SoD constraints are declared", () => {
    expect(rbacSkill.validate(leaveApprovalRbac).ok).toBe(true);
  });
});

describe("kernel 6 - publish gate (cross-system closure)", () => {
  it("an internally-consistent app is publishable", () => {
    const gate = slideRule.publishGate(models);
    expect(gate.publishable).toBe(true);
    expect(gate.blockers).toHaveLength(0);
  });

  it("blocks publish when a cross-system reference does not resolve", () => {
    const badWorkflow = structuredClone(leaveApprovalWorkflow);
    badWorkflow.nodes.find(n => n.id === "a_mgr")!.assigneeRole = "director";
    const gate = slideRule.publishGate({ ...models, workflow: badWorkflow });
    expect(gate.publishable).toBe(false);
    expect(gate.blockers.some(b => b.code === "PUBLISH_DANGLING_CROSSREF")).toBe(true);
  });

  it("blocks publish when DataModel is missing", () => {
    const gate = slideRule.publishGate({ rbac: leaveApprovalRbac, workflow: leaveApprovalWorkflow });
    expect(gate.publishable).toBe(false);
    expect(gate.blockers.some(b => b.code === "PUBLISH_DANGLING_CROSSREF")).toBe(true);
  });
});

describe("V2 shared contract - kernel vocabulary", () => {
  it("declares PDP and SSOT roles using both compact and host wording", () => {
    const compactPdp: KernelRole = "pdp";
    const hostPdp: KernelRole = "pdp-host";
    const compactSsot: KernelRole = "ssot";
    const hostSsot: KernelRole = "ssot-host";
    expect([compactPdp, hostPdp, compactSsot, hostSsot]).toEqual(["pdp", "pdp-host", "ssot", "ssot-host"]);
  });

  it("declares PEP and assembly-root semantics", () => {
    const pep: SkillDefinition = {
      id: "workflow",
      title: "Workflow",
      kernelRole: "pep",
      runtimeRole: "pep",
      delegatesTo: [{ skill: "rbac", kind: "role" } as DependencyRef],
      bindsTo: [{ skill: "datamodel", kind: "entity" } as DependencyRef],
    };
    const assembly: SkillDefinition = {
      id: "appbundle",
      title: "AppBundle",
      kernelRole: "assembly-root",
      runtimeRole: "assembly",
      provides: { app: ["leave_app"] },
      versionPin: { skill: "rbac", version: "113.0" } as VersionPin,
      capability: { versionPins: [] } as SkillCapabilitySurface,
    };
    expect(pep.kernelRole).toBe("pep");
    expect(pep.delegatesTo).toHaveLength(1);
    expect(assembly.kernelRole).toBe("assembly-root");
  });

  it("accepts the V2 diagram field names used by queue task implementations", () => {
    const runtime: SkillRuntimeRole = "kernel";
    const dep: DependencyRef = { to: "datamodel", kind: "entity", ref: "leaveRequest" };
    const pin: VersionPin = { skillId: "rbac", version: "1.0.0" };
    const decision: PolicyDecision = { decision: "allow", ruleId: "rbac:1" };
    const publish: PublishGateReport = { publishable: true, blockers: [] };
    const impact: ImpactReport = { affectedSkills: ["workflow"], summary: "minor" };
    const surface: SkillCapabilitySurface = {
      kernelRole: "pdp-host",
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
      capability: surface,
    };
    expect(def.kernelRole).toBe("pdp-host");
    expect(def.capability?.provides).toContain("role");
  });

  it("typed surfaces are usable with compact field names", () => {
    const decision: PolicyDecision = { effect: "deny", reasonCode: "RBAC_NO_MATCH" };
    const gateReport: PublishGateReport = { publishable: false, blockers: [] };
    const impact: ImpactReport = { target: { skill: "rbac", kind: "role", value: "x" }, safe: true, impacted: [] };
    expect(decision.effect).toBe("deny");
    expect(gateReport.publishable).toBe(false);
    expect(impact.safe).toBe(true);
  });

  it("does not break existing validate/project/resolve/generate usage", () => {
    expect(rbacSkill.validate(leaveApprovalRbac).ok).toBe(true);
    const proj = rbacSkill.project(leaveApprovalRbac);
    expect(proj.nodes.length).toBeGreaterThan(0);
    const res = rbacSkill.resolve(leaveApprovalRbac);
    expect(res).toBeDefined();
    if (rbacSkill.generate) {
      expect(typeof rbacSkill.generate).toBe("function");
    }
  });
});
