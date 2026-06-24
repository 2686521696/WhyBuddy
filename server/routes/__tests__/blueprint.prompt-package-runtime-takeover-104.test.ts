import { describe, expect, it, vi } from "vitest";

import {
  getBlueprintPromptPackageRuntimeTakeoverPython,
  assertNoProductionTakeoverForRetained,
  assertNodeFallbackPreservedWhenNoTakeover,
  computeLocalPromptPackageRuntimeTakeover,
  BLUEPRINT_PROMPT_PACKAGE_RUNTIME_TAKEOVER_CONTRACT,
} from "../blueprint/prompt-package-runtime-takeover-python.js";

describe("Blueprint prompt package runtime takeover 104", () => {
  it("returns stable envelope with surface, fallback from bridge", async () => {
    const d = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "all" });
    expect(d.contractVersion).toBe(BLUEPRINT_PROMPT_PACKAGE_RUNTIME_TAKEOVER_CONTRACT);
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("migrationDenominator");
    expect(d).toHaveProperty("fallback");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks promptPackage node-retained with no takeover and node fallback", async () => {
    const d = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "promptPackage" });
    expect(d.ownership).toBe("node-retained");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks validationSlice python-owned but productionTakeover remains false and fallback node", async () => {
    const d = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "validationSlice" });
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("node bridge asserts retained surfaces preserve node fallback when no takeover", async () => {
    const d = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "promptPackage" });
    expect(() => assertNoProductionTakeoverForRetained(d)).not.toThrow();
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(d)).not.toThrow();

    const badTakeover = { ...d, productionTakeover: true, ownership: "node-retained" as const };
    expect(() => assertNoProductionTakeoverForRetained(badTakeover as any)).toThrow();

    const badFallback = { ...d, fallback: "python" };
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(badFallback as any)).toThrow();
  });

  it("simulate all retained forces node retained and node fallback", async () => {
    const d = computeLocalPromptPackageRuntimeTakeover({ surface: "validationSlice", simulate: { forceNodeRetained: true } });
    expect(d.ownership).toBe("node-retained");
    expect(d.fallback).toBe("node");
  });

  it("migration denominator excludes retained promptPackage from python numerator", async () => {
    const d = await getBlueprintPromptPackageRuntimeTakeoverPython();
    expect(d.migrationDenominator.total).toBeGreaterThanOrEqual(2);
    expect(d.migrationDenominator.nodeRetained).toBeGreaterThanOrEqual(1);
    expect(d.migrationDenominator.pythonOwned).toBeGreaterThanOrEqual(1);
  });

  it("no node-retained surface is reported as production complete", async () => {
    const d = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "promptPackage" });
    expect(d.productionTakeover).toBe(false);
    if (d.ownership === "node-retained") {
      expect(d.productionTakeover).not.toBe(true);
    }
  });

  it("envelope separates python-owned, node-retained, out-of-scope", async () => {
    const all = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "all" });
    const own = all.ownership as Record<string, string>;
    expect(own.promptPackage).toBe("node-retained");
    expect(own.validationSlice).toBe("python-owned");
    const unknown = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "nonexistent" });
    expect(unknown.ownership).toBe("out-of-scope");
    expect(unknown.productionTakeover).toBe(false);
  });

  it("node bridge consumes provided python decider result (uses Python output, not just node mirror)", async () => {
    const pythonDecider = {
      decide: vi.fn(async (inp?: any) => {
        const base = computeLocalPromptPackageRuntimeTakeover(inp);
        return {
          ...base,
          provenance: "python-blueprint-prompt-package-runtime-takeover-104",
        } as any;
      }),
    };
    const d = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "validationSlice" }, pythonDecider);
    expect(pythonDecider.decide).toHaveBeenCalled();
    expect(d.provenance).toBe("python-blueprint-prompt-package-runtime-takeover-104");
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);

    // also for retained
    const d2 = await getBlueprintPromptPackageRuntimeTakeoverPython({ surface: "promptPackage" }, pythonDecider);
    expect(d2.ownership).toBe("node-retained");
  });

  it("computeLocal and bridge never allow productionTakeover on retained via simulate", () => {
    const dPkg = computeLocalPromptPackageRuntimeTakeover({ surface: "promptPackage", simulate: { productionTakeover: true } });
    expect(dPkg.ownership).toBe("node-retained");
    expect(dPkg.productionTakeover).toBe(false);

    const dSlice = computeLocalPromptPackageRuntimeTakeover({ surface: "validationSlice", simulate: { productionTakeover: true } });
    expect(dSlice.ownership).toBe("python-owned");
    expect(dSlice.productionTakeover).toBe(true);
  });
});
