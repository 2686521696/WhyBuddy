import { describe, expect, it } from "vitest";

import {
  getBlueprintJobStoreRuntimeTakeoverPython,
  assertNoProductionTakeoverForRetained,
  assertNodeFallbackPreservedWhenNoTakeover,
  computeLocalJobStoreRuntimeTakeover,
  BLUEPRINT_JOB_STORE_RUNTIME_TAKEOVER_CONTRACT,
} from "../blueprint/job-store-runtime-takeover-python.js";

describe("Blueprint job store runtime takeover 104", () => {
  it("returns stable envelope with surface, fallback from bridge", async () => {
    const d = await getBlueprintJobStoreRuntimeTakeoverPython({ surface: "all" });
    expect(d.contractVersion).toBe(BLUEPRINT_JOB_STORE_RUNTIME_TAKEOVER_CONTRACT);
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("migrationDenominator");
    expect(d).toHaveProperty("fallback");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks jobStore and durable surfaces node-retained with no takeover and node fallback", async () => {
    for (const surface of ["jobStore", "eventBus", "ledger", "replan", "promptPackage", "previewState"]) {
      const d = await getBlueprintJobStoreRuntimeTakeoverPython({ surface });
      expect(d.ownership).toBe("node-retained");
      expect(d.productionTakeover).toBe(false);
      expect(d.fallback).toBe("node");
    }
  });

  it("marks jobStateRuntimeSlice python-owned but productionTakeover remains false and fallback node", async () => {
    const d = await getBlueprintJobStoreRuntimeTakeoverPython({ surface: "jobStateRuntimeSlice" });
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("node bridge asserts retained surfaces preserve node fallback when no takeover", async () => {
    const d = await getBlueprintJobStoreRuntimeTakeoverPython({ surface: "jobStore" });
    expect(() => assertNoProductionTakeoverForRetained(d)).not.toThrow();
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(d)).not.toThrow();

    const badTakeover = { ...d, productionTakeover: true, ownership: "node-retained" as const };
    expect(() => assertNoProductionTakeoverForRetained(badTakeover as any)).toThrow();

    const badFallback = { ...d, fallback: "python" };
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(badFallback as any)).toThrow();
  });

  it("simulate all retained forces node retained and node fallback", async () => {
    const d = computeLocalJobStoreRuntimeTakeover({ surface: "jobStateRuntimeSlice", simulate: { forceNodeRetained: true } });
    expect(d.ownership).toBe("node-retained");
    expect(d.fallback).toBe("node");
  });

  it("migration denominator excludes retained durable surfaces from python numerator", async () => {
    const d = await getBlueprintJobStoreRuntimeTakeoverPython();
    expect(d.migrationDenominator.total).toBeGreaterThanOrEqual(7);
    expect(d.migrationDenominator.nodeRetained).toBeGreaterThanOrEqual(6);
    // pythonOwned is only thin slice, not durable jobStore
    expect(d.migrationDenominator.pythonOwned).toBeLessThanOrEqual(1);
  });

  it("no node-retained surface is reported as production complete", async () => {
    const d = await getBlueprintJobStoreRuntimeTakeoverPython({ surface: "jobStore" });
    expect(d.productionTakeover).toBe(false);
    if (d.ownership === "node-retained") {
      expect(d.productionTakeover).not.toBe(true);
    }
  });
});