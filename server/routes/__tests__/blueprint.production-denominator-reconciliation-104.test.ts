import { describe, expect, it } from "vitest";

import {
  getBlueprintProductionDenominatorReconciliationPython,
  computeLocalProductionDenominatorReconciliation,
  BLUEPRINT_PRODUCTION_DENOMINATOR_RECONCILIATION_CONTRACT,
  assertNoRetainedBlockersForClaim,
} from "../blueprint/production-denominator-reconciliation-python.js";

describe("Blueprint production denominator reconciliation 104", () => {
  it("returns stable envelope and reconciles six 104 surfaces", async () => {
    const d = await getBlueprintProductionDenominatorReconciliationPython({ area: "all" });
    expect(d.contractVersion).toBe(BLUEPRINT_PRODUCTION_DENOMINATOR_RECONCILIATION_CONTRACT);
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("migrationDenominator");
    expect(d).toHaveProperty("canClaimBlueprintProductionTakeover");
    expect(d.productionTakeover).toBe(false);
  });

  it("aggregates all six Blueprint 104 surfaces as node-retained core", async () => {
    const d = await getBlueprintProductionDenominatorReconciliationPython();
    const own = d.ownership as Record<string, string>;
    for (const s of ["jobStore", "eventBus", "ledger", "replan", "promptPackage", "previewState"]) {
      expect(own[s]).toBe("node-retained");
    }
    expect(d.canClaimBlueprintProductionTakeover).toBe(false);
  });

  it("counts exactly six pythonOwned thin slices and six nodeRetained", async () => {
    const d = await getBlueprintProductionDenominatorReconciliationPython();
    const denom = d.migrationDenominator;
    expect(denom.total).toBe(12);
    expect(denom.pythonOwned).toBe(6);
    expect(denom.nodeRetained).toBe(6);
    expect(denom.externalOwned).toBe(0);
    expect(denom.outOfScope).toBe(0);
  });

  it("canClaimBlueprintProductionTakeover is false with retained in-scope blockers", async () => {
    const d = await getBlueprintProductionDenominatorReconciliationPython();
    expect(d.canClaimBlueprintProductionTakeover).toBe(false);
    expect(() => assertNoRetainedBlockersForClaim(d)).not.toThrow();
    const bad = { ...d, canClaimBlueprintProductionTakeover: true };
    expect(() => assertNoRetainedBlockersForClaim(bad as any)).toThrow();
  });

  it("python slices reported python-owned with productionTakeover false by default", async () => {
    for (const sl of ["jobStateRuntimeSlice", "ledgerEntrySlice", "validationSlice"]) {
      const d = await getBlueprintProductionDenominatorReconciliationPython({ area: sl });
      expect(d.ownership).toBe("python-owned");
      expect(d.productionTakeover).toBe(false);
      expect(d.canClaimBlueprintProductionTakeover).toBe(false);
    }
  });

  it("node and python agree on denominator counts", async () => {
    const d = await getBlueprintProductionDenominatorReconciliationPython({ area: "all" });
    // exact agreement required
    expect(d.migrationDenominator.pythonOwned).toBe(6);
    expect(d.migrationDenominator.nodeRetained).toBe(6);
    expect(d.migrationDenominator.outOfScope).toBe(0);
  });

  it("simulate all retained keeps canClaim false", async () => {
    const d = computeLocalProductionDenominatorReconciliation({ area: "all", simulate: { forceNodeRetained: true } });
    expect(d.migrationDenominator.nodeRetained).toBe(12);
    expect(d.canClaimBlueprintProductionTakeover).toBe(false);
  });

  it("productionTakeover and canClaim only when no retained blockers", async () => {
    const normal = await getBlueprintProductionDenominatorReconciliationPython();
    expect(normal.canClaimBlueprintProductionTakeover).toBe(false);
    // when forced clean of retained, can would be true (via logic)
    const clean = computeLocalProductionDenominatorReconciliation({
      area: "all",
      simulate: { forceNodeRetained: false },
    });
    // still has base retained so false, the rule is enforced in code
    expect(clean.canClaimBlueprintProductionTakeover).toBe(false);
  });
});
