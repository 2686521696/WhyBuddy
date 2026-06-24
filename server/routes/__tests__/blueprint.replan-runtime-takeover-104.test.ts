import { describe, expect, it, vi } from "vitest";

import {
  getBlueprintReplanRuntimeTakeoverPython,
  assertNoProductionTakeoverForRetained,
  assertNodeFallbackPreservedWhenNoTakeover,
  computeLocalReplanRuntimeTakeover,
  classifyBlueprintReplanDecisionPython,
  BLUEPRINT_REPLAN_RUNTIME_TAKEOVER_CONTRACT,
} from "../blueprint/replan-runtime-takeover-python.js";

describe("Blueprint replan runtime takeover 104", () => {
  it("returns stable envelope from bridge", async () => {
    const d = await getBlueprintReplanRuntimeTakeoverPython({ surface: "all" });
    expect(d.contractVersion).toBe(BLUEPRINT_REPLAN_RUNTIME_TAKEOVER_CONTRACT);
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("migrationDenominator");
    expect(d).toHaveProperty("fallback");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks replan as node-retained with no takeover and node fallback", async () => {
    const d = await getBlueprintReplanRuntimeTakeoverPython({ surface: "replan" });
    expect(d.ownership).toBe("node-retained");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks replanDecisionSlice python-owned but productionTakeover remains false and fallback node", async () => {
    const d = await getBlueprintReplanRuntimeTakeoverPython({ surface: "replanDecisionSlice" });
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("node bridge asserts retained surfaces preserve node fallback when no takeover", async () => {
    const d = await getBlueprintReplanRuntimeTakeoverPython({ surface: "replan" });
    expect(() => assertNoProductionTakeoverForRetained(d)).not.toThrow();
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(d)).not.toThrow();

    const badTakeover = { ...d, productionTakeover: true, ownership: "node-retained" as const };
    expect(() => assertNoProductionTakeoverForRetained(badTakeover as any)).toThrow();

    const badFallback = { ...d, fallback: "python" };
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(badFallback as any)).toThrow();
  });

  it("simulate all retained forces node retained", async () => {
    const d = computeLocalReplanRuntimeTakeover({ surface: "replanDecisionSlice", simulate: { forceNodeRetained: true } });
    expect(d.ownership).toBe("node-retained");
    expect(d.fallback).toBe("node");
  });

  it("migration denominator records replan retained", async () => {
    const d = await getBlueprintReplanRuntimeTakeoverPython();
    expect(d.migrationDenominator.total).toBeGreaterThanOrEqual(2);
    expect(d.migrationDenominator.nodeRetained).toBeGreaterThanOrEqual(1);
    expect(d.migrationDenominator.pythonOwned).toBeLessThanOrEqual(1);
  });

  it("node bridge consumes provided python decider result (uses Python output for bounded replan slice)", async () => {
    const pythonDecider = {
      decide: vi.fn(async (inp?: any) => {
        const base = computeLocalReplanRuntimeTakeover(inp);
        return {
          ...base,
          provenance: "python-blueprint-replan-runtime-takeover-104",
        } as any;
      }),
    };
    const d = await getBlueprintReplanRuntimeTakeoverPython({ surface: "replanDecisionSlice" }, pythonDecider);
    expect(pythonDecider.decide).toHaveBeenCalled();
    expect(d.provenance).toBe("python-blueprint-replan-runtime-takeover-104");
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);

    const d2 = await getBlueprintReplanRuntimeTakeoverPython({ surface: "replan" }, pythonDecider);
    expect(d2.ownership).toBe("node-retained");
  });

  it("classify via bridge consumes python classification for realistic replan input", async () => {
    const pythonDecider = {
      classifyReplanDecision: vi.fn(async (inp?: any) => ({
        ok: true,
        classification: { fromStage: "spec_tree", mode: "branch", classification: "branch", valid: true },
        ownership: "python-owned",
        productionTakeover: false,
        provenance: "python-blueprint-replan-runtime-takeover-104",
        contractVersion: BLUEPRINT_REPLAN_RUNTIME_TAKEOVER_CONTRACT,
      })),
    };
    const cls = await classifyBlueprintReplanDecisionPython(
      { replanRequest: { fromStage: "spec_tree", mode: "branch" } },
      pythonDecider,
    );
    expect(pythonDecider.classifyReplanDecision).toHaveBeenCalled();
    expect(cls.classification.classification).toBe("branch");
    expect(cls.provenance).toBe("python-blueprint-replan-runtime-takeover-104");
  });

  it("replan retained surfaces never report productionTakeover", async () => {
    const d = await getBlueprintReplanRuntimeTakeoverPython({ surface: "replan" });
    expect(d.productionTakeover).toBe(false);
    if (d.ownership === "node-retained") {
      expect(d.productionTakeover).not.toBe(true);
    }
  });

  it("existing node fallback and conflict handling surfaces remain named", async () => {
    // proves retained replan named
    const d = await getBlueprintReplanRuntimeTakeoverPython({ surface: "replan" });
    expect(d.ownership).toBe("node-retained");
    expect(d.fallback).toBe("node");
    // local compute also preserves
    const local = computeLocalReplanRuntimeTakeover({ surface: "replan" });
    expect(local.ownership).toBe("node-retained");
  });
});
