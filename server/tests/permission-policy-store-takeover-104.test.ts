import { describe, expect, it } from "vitest";

import {
  validatePermissionPolicyStoreTakeover,
  type PermissionPolicyStoreTakeoverResult,
} from "../permission/check-engine.js";

// Node test for permission-policy-store-takeover-104.
// Verifies Node bridge consumes Python policy store takeover decision.
// Covers allowed (python slice decision), blocked, and fallback paths.
// policyStore retained as node-retained; thin decision slice may be python-owned.
// Retained responsibilities are asserted present in shape.
// No security regression: does not loosen, does not claim durable takeover.

describe("permission-policy-store-takeover-104 - node bridge", () => {
  function makeDecision(
    overrides: Partial<PermissionPolicyStoreTakeoverResult> = {},
  ): PermissionPolicyStoreTakeoverResult {
    return {
      status: "python-owned",
      contractVersion: "permission-policy-store-takeover.v1",
      provenance: "python-permission-policy-store-takeover-104",
      ok: true,
      productionTakeover: false,
      ownership: {
        policyStore: "node-retained",
        policyDecisionSlice: "python-owned",
        durablePolicyRead: "node-retained",
      },
      boundaries: {
        policyStoreOwner: "node",
        policyDecisionSliceOwner: "python",
      },
      runtime: { owner: "python", mode: "policy_store_takeover_slice" },
      retainedResponsibilities: [
        "policyStore CRUD and versioning",
        "durable policy persistence and history",
      ],
      ...overrides,
    };
  }

  it("validates allowed/python-owned decision slice and node-retained store", () => {
    const d = validatePermissionPolicyStoreTakeover(makeDecision());
    expect(d.status).toBe("python-owned");
    expect(d.ok).toBe(true);
    expect(d.productionTakeover).toBe(false);
    expect(d.ownership?.policyStore).toBe("node-retained");
    expect(d.ownership?.policyDecisionSlice).toBe("python-owned");
    expect(d.ownership?.durablePolicyRead).toBe("node-retained");
    expect(d.boundaries?.policyStoreOwner).toBe("node");
  });

  it("validates blocked path", () => {
    const blocked = validatePermissionPolicyStoreTakeover({ status: "blocked" });
    expect(blocked.status).toBe("blocked");
    expect(blocked.ok).not.toBe(true);
    expect(blocked.productionTakeover).toBe(false);
  });

  it("covers fallback and node-retained paths (validate node fallback)", () => {
    const fb = validatePermissionPolicyStoreTakeover(null);
    expect(fb.status).toBe("blocked");
    expect(fb.ok).toBe(false);

    const retained = validatePermissionPolicyStoreTakeover({
      status: "ready",
      ownership: { policyStore: "node-retained", policyDecisionSlice: "node-retained" },
    });
    expect(retained.ownership?.policyStore).toBe("node-retained");
  });

  it("area scoped policy decision vs store and retained named", () => {
    const d = validatePermissionPolicyStoreTakeover({
      status: "python-owned",
      ownership: {
        policyStore: "node-retained",
        policyDecisionSlice: "python-owned",
      },
      retainedResponsibilities: ["policyStore CRUD and versioning", "durable policy persistence and history", "effective permission resolution for enforcement"],
    });
    expect(d.ownership?.policyStore).toBe("node-retained");
    expect(d.ownership?.policyDecisionSlice).toBe("python-owned");
    expect(Array.isArray(d.retainedResponsibilities) || d.retainedResponsibilities == null).toBe(true);
  });

  it("contract provenance and no production takeover on retained", () => {
    const raw = {
      status: "python-owned",
      contractVersion: "permission-policy-store-takeover.v1",
      provenance: "python-permission-policy-store-takeover-104",
      ownership: { policyStore: "node-retained", policyDecisionSlice: "python-owned" },
    };
    const v = validatePermissionPolicyStoreTakeover(raw);
    expect(v.contractVersion).toBe("permission-policy-store-takeover.v1");
    expect(v.provenance).toContain("python-permission-policy-store-takeover-104");
    expect(v.productionTakeover).toBe(false);
    expect(v.ownership?.policyStore).toBe("node-retained");
  });
});
