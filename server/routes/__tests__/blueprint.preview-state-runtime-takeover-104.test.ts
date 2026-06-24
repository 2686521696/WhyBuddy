import { describe, expect, it, vi } from "vitest";

import {
  getBlueprintPreviewStateRuntimeTakeoverPython,
  assertNoProductionTakeoverForRetained,
  assertNodeFallbackPreservedWhenNoTakeover,
  computeLocalPreviewStateRuntimeTakeover,
  BLUEPRINT_PREVIEW_STATE_RUNTIME_TAKEOVER_CONTRACT,
} from "../blueprint/preview-state-runtime-takeover-python.js";

describe("Blueprint preview state runtime takeover 104", () => {
  it("returns stable envelope with surface, fallback from bridge", async () => {
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "all" });
    expect(d.contractVersion).toBe(BLUEPRINT_PREVIEW_STATE_RUNTIME_TAKEOVER_CONTRACT);
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("migrationDenominator");
    expect(d).toHaveProperty("fallback");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks previewState node-retained with no takeover and node fallback", async () => {
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "previewState" });
    expect(d.ownership).toBe("node-retained");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks previewStateRuntimeSlice python-owned but productionTakeover false and fallback node", async () => {
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "previewStateRuntimeSlice" });
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("node bridge asserts retained surfaces preserve node fallback when no takeover", async () => {
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "previewState" });
    expect(() => assertNoProductionTakeoverForRetained(d)).not.toThrow();
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(d)).not.toThrow();

    const badTakeover = { ...d, productionTakeover: true, ownership: "node-retained" as const };
    expect(() => assertNoProductionTakeoverForRetained(badTakeover as any)).toThrow();

    const badFallback = { ...d, fallback: "python" };
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(badFallback as any)).toThrow();
  });

  it("simulate all retained forces node retained and node fallback", async () => {
    const d = computeLocalPreviewStateRuntimeTakeover({ surface: "previewStateRuntimeSlice", simulate: { forceNodeRetained: true } });
    expect(d.ownership).toBe("node-retained");
    expect(d.fallback).toBe("node");
  });

  it("migration denominator is updated and excludes retained durable from python numerator", async () => {
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython();
    expect(d.migrationDenominator.total).toBeGreaterThanOrEqual(2);
    expect(d.migrationDenominator.nodeRetained).toBeGreaterThanOrEqual(1);
    expect(d.migrationDenominator.pythonOwned).toBeLessThanOrEqual(1);
    // code-level evidence for denominator update
    expect(d.evidence?.migrationDenominatorUpdated).toBe(true);
  });

  it("no node-retained surface is reported as production complete", async () => {
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "previewState" });
    expect(d.productionTakeover).toBe(false);
    if (d.ownership === "node-retained") {
      expect(d.productionTakeover).not.toBe(true);
    }
  });

  it("node consumes python projection decision shape (fallback explicit)", async () => {
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "previewStateRuntimeSlice" });
    // projection path keeps fallback explicit, never durable
    expect(d.fallback).toBe("node");
    expect(d.productionTakeover).toBe(false);
  });

  it("node bridge consumes provided python decider result (uses Python output, not just node mirror)", async () => {
    const pythonDecider = {
      decide: vi.fn(async (inp?: any) => {
        const base = computeLocalPreviewStateRuntimeTakeover(inp);
        return {
          ...base,
          provenance: "python-blueprint-preview-state-runtime-takeover-104",
        } as any;
      }),
    };
    const d = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "previewStateRuntimeSlice" }, pythonDecider);
    expect(pythonDecider.decide).toHaveBeenCalled();
    expect(d.provenance).toBe("python-blueprint-preview-state-runtime-takeover-104");
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");

    // retained surface also consumes python result
    const d2 = await getBlueprintPreviewStateRuntimeTakeoverPython({ surface: "previewState" }, pythonDecider);
    expect(d2.ownership).toBe("node-retained");
    expect(d2.fallback).toBe("node");
  });
});
