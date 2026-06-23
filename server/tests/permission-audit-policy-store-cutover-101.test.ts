import { describe, expect, it } from "vitest";

import {
  validatePermissionAuditPolicyStoreCutover,
  type PermissionAuditPolicyStoreCutoverResult,
} from "../permission/check-engine.js";

// Node test for permission-audit policy-store cutover 101.
// Verifies Node bridge consumes Python cutover decision without taking ownership
// of durable policy store, audit durable store, external audit platform, or route auth.
// Permission checks, rate limits, and audit boundaries remain enforced in Node.

describe("permission-audit-policy-store-cutover-101 - node bridge", () => {
  function makeDecision(
    overrides: Partial<PermissionAuditPolicyStoreCutoverResult> = {},
  ): PermissionAuditPolicyStoreCutoverResult {
    return {
      decision: "ready",
      decisions: { policyStore: "ready", auditStore: "ready", externalAudit: "ready" },
      canParticipate: { policyStore: true, auditStore: true, externalAudit: true },
      contractVersion: "permission-audit-policy-store-cutover.v1",
      provenance: "python-permission-audit-policy-store-cutover",
      runtime: { owner: "python", mode: "cutover_decision", durableStoreOwner: "node" },
      boundaries: { durableStoreOwner: "node", externalAuditPlatformOwner: "node", routeAuthOwner: "node" },
      ok: true,
      productionTakeover: false,
      ...overrides,
    };
  }

  it("validates ready decision and preserves node boundaries", () => {
    const d = validatePermissionAuditPolicyStoreCutover(
      makeDecision(),
    );
    expect(d.decision).toBe("ready");
    expect(d.ok).toBe(true);
    expect(d.boundaries?.durableStoreOwner).toBe("node");
    expect(d.boundaries?.externalAuditPlatformOwner).toBe("node");
    expect(d.productionTakeover).toBe(false);
    expect(d.runtime?.durableStoreOwner).toBe("node");
  });

  it("validates blocked and unsupported never become ready", () => {
    const blocked = validatePermissionAuditPolicyStoreCutover({ decision: "blocked" });
    expect(blocked.decision).toBe("blocked");
    expect(blocked.ok).not.toBe(true);

    const unsup = validatePermissionAuditPolicyStoreCutover({ decision: "unsupported" });
    expect(unsup.decision).toBe("unsupported");
    expect(unsup.ok).not.toBe(true);
    expect(unsup.decisions.policyStore).toBe("unsupported");
  });

  it("area scoped decisions respect boundary (e.g. policyStore only)", () => {
    const d = validatePermissionAuditPolicyStoreCutover({
      decision: "ready",
      decisions: { policyStore: "ready", auditStore: "unsupported", externalAudit: "unsupported" },
      canParticipate: { policyStore: true, auditStore: false, externalAudit: false },
      boundaries: { durableStoreOwner: "node", routeAuthOwner: "node" },
    });
    expect(d.decision).toBe("ready");
    expect(d.decisions.policyStore).toBe("ready");
    expect(d.decisions.auditStore).toBe("unsupported");
    expect(d.canParticipate.auditStore).toBe(false);
  });

  it("node bridge decision does not grant permission bypass (advisory only)", () => {
    const d = validatePermissionAuditPolicyStoreCutover(makeDecision());
    // decision alone never equals an allow result from check engine
    expect(d.decision).not.toBe("allow");
    // explicit: no productionTakeover
    expect(d.productionTakeover).not.toBe(true);
    // boundaries assert node ownership of stores and auth
    expect(d.boundaries?.durableStoreOwner).toBe("node");
    expect(d.boundaries?.routeAuthOwner).toBe("node");
  });

  it("degraded and error cases stay non-takeover", () => {
    const deg = validatePermissionAuditPolicyStoreCutover({ decision: "degraded" });
    expect(deg.decision).toBe("degraded");
    expect(deg.productionTakeover).toBe(false);

    const bad = validatePermissionAuditPolicyStoreCutover(null);
    expect(bad.decision).toBe("unsupported");
    expect(bad.ok).toBe(false);
  });

  it("contract and provenance roundtrip", () => {
    const raw = {
      decision: "ready",
      decisions: { policyStore: "ready", auditStore: "ready", externalAudit: "ready" },
      canParticipate: { policyStore: true, auditStore: true, externalAudit: true },
      contractVersion: "permission-audit-policy-store-cutover.v1",
      provenance: "python-permission-audit-policy-store-cutover",
    };
    const v = validatePermissionAuditPolicyStoreCutover(raw);
    expect(v.contractVersion).toBe("permission-audit-policy-store-cutover.v1");
    expect(v.provenance).toContain("python-permission-audit-policy-store-cutover");
  });
});
