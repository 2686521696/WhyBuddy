import { describe, expect, it, vi } from "vitest";

import { createBlueprintEventBus } from "../blueprint/event-bus.js";
import {
  getBlueprintEventBusRuntimeTakeoverPython,
  assertNoProductionTakeoverForRetained,
  assertNodeFallbackPreservedWhenNoTakeover,
  computeLocalEventBusRuntimeTakeover,
  BLUEPRINT_EVENT_BUS_RUNTIME_TAKEOVER_CONTRACT,
} from "../blueprint/event-bus-runtime-takeover-python.js";

import type { BlueprintGenerationEvent } from "../../../shared/blueprint/index.js";

function makeMemoryJobStore() {
  const jobs: Record<string, any> = {};
  return {
    get(id: string) {
      return jobs[id] ? { ...jobs[id] } : undefined;
    },
    save(j: any) {
      jobs[j.id] = { ...j, events: [...(j.events || [])] };
    },
    listEvents(jobId: string) {
      return (jobs[jobId]?.events || []).slice();
    },
  };
}

describe("Blueprint event bus runtime takeover 104", () => {
  it("returns stable envelope with op/area, fallback from bridge", async () => {
    const d = await getBlueprintEventBusRuntimeTakeoverPython({ area: "all" });
    expect(d.contractVersion).toBe(BLUEPRINT_EVENT_BUS_RUNTIME_TAKEOVER_CONTRACT);
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("migrationDenominator");
    expect(d).toHaveProperty("fallback");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks eventBus and append node-retained with no takeover and node fallback", async () => {
    for (const op of ["eventBus", "append"]) {
      const d = await getBlueprintEventBusRuntimeTakeoverPython({ op });
      expect(d.ownership).toBe("node-retained");
      expect(d.productionTakeover).toBe(false);
      expect(d.fallback).toBe("node");
    }
  });

  it("marks project/replay/eventProjectionSlice python-owned but productionTakeover remains false and fallback node", async () => {
    for (const op of ["project", "replay", "eventProjectionSlice"]) {
      const d = await getBlueprintEventBusRuntimeTakeoverPython({ area: op });
      expect(d.ownership).toBe("python-owned");
      expect(d.productionTakeover).toBe(false);
      expect(d.fallback).toBe("node");
    }
  });

  it("node bridge asserts retained surfaces preserve node fallback when no takeover", async () => {
    const d = await getBlueprintEventBusRuntimeTakeoverPython({ op: "eventBus" });
    expect(() => assertNoProductionTakeoverForRetained(d)).not.toThrow();
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(d)).not.toThrow();

    const badTakeover = { ...d, productionTakeover: true, ownership: "node-retained" as const };
    expect(() => assertNoProductionTakeoverForRetained(badTakeover as any)).toThrow();

    const badFallback = { ...d, fallback: "python" };
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(badFallback as any)).toThrow();
  });

  it("simulate all retained forces node retained and node fallback", async () => {
    const d = computeLocalEventBusRuntimeTakeover({ area: "project", simulate: { forceNodeRetained: true } });
    expect(d.ownership).toBe("node-retained");
    expect(d.fallback).toBe("node");
  });

  it("migration denominator excludes retained durable eventBus surfaces from python numerator", async () => {
    const d = await getBlueprintEventBusRuntimeTakeoverPython();
    expect(d.migrationDenominator.total).toBeGreaterThanOrEqual(5);
    expect(d.migrationDenominator.nodeRetained).toBeGreaterThanOrEqual(2);
    expect(d.migrationDenominator.pythonOwned).toBeLessThanOrEqual(3);
  });

  it("no node-retained surface is reported as production complete", async () => {
    const d = await getBlueprintEventBusRuntimeTakeoverPython({ op: "eventBus" });
    expect(d.productionTakeover).toBe(false);
    if (d.ownership === "node-retained") {
      expect(d.productionTakeover).not.toBe(true);
    }
  });

  it("envelope separates python-owned, node-retained, out-of-scope", async () => {
    const all = await getBlueprintEventBusRuntimeTakeoverPython({ area: "all" });
    const own = all.ownership as Record<string, string>;
    expect(own.eventBus).toBe("node-retained");
    expect(own.append).toBe("node-retained");
    expect(own.project).toBe("python-owned");
    expect(own.replay).toBe("python-owned");
    // verify out-of-scope classification for unknown (bridge must express the third bucket)
    const unknown = await getBlueprintEventBusRuntimeTakeoverPython({ area: "nonexistentOp" });
    expect(unknown.ownership).toBe("out-of-scope");
    expect(unknown.productionTakeover).toBe(false);
  });

  it("node bridge consumes provided python decider result (uses Python output, not just node mirror)", async () => {
    const pythonDecider = {
      decide: vi.fn(async (inp?: any) => {
        // simulate result as if fetched from real python service
        const base = computeLocalEventBusRuntimeTakeover(inp);
        return {
          ...base,
          provenance: "python-blueprint-event-bus-runtime-takeover-104",
        } as any;
      }),
    };
    const d = await getBlueprintEventBusRuntimeTakeoverPython({ area: "project" }, pythonDecider);
    expect(pythonDecider.decide).toHaveBeenCalled();
    expect(d.provenance).toBe("python-blueprint-event-bus-runtime-takeover-104");
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);

    // also for retained, still consumes
    const d2 = await getBlueprintEventBusRuntimeTakeoverPython({ op: "eventBus" }, pythonDecider);
    expect(d2.ownership).toBe("node-retained");
  });

  it("computeLocal and bridge never allow productionTakeover on retained via simulate", () => {
    const dBus = computeLocalEventBusRuntimeTakeover({ op: "eventBus", simulate: { productionTakeover: true } });
    expect(dBus.ownership).toBe("node-retained");
    expect(dBus.productionTakeover).toBe(false);

    const dProj = computeLocalEventBusRuntimeTakeover({ area: "project", simulate: { productionTakeover: true } });
    expect(dProj.ownership).toBe("python-owned");
    expect(dProj.productionTakeover).toBe(true);
  });

  it("node event bus + bridge coexist without breaking existing bus behavior", async () => {
    const jobStore = makeMemoryJobStore();
    const job = {
      id: "job-eb-104",
      status: "running",
      stage: "input",
      events: [],
      updatedAt: "2026-06-24T00:00:00Z",
    };
    jobStore.save(job);

    const bus = createBlueprintEventBus(jobStore as any);

    const evt: BlueprintGenerationEvent = {
      id: "evt-104-1",
      jobId: "job-eb-104",
      type: "job.stage" as any,
      family: "job",
      stage: "spec_tree",
      status: "running",
      message: "from node bus in 104 test",
      occurredAt: "2026-06-24T00:00:01Z",
    } as any;

    bus.emit(evt);

    const stored = jobStore.get("job-eb-104");
    expect(stored?.events?.length).toBe(1);
    expect(stored.events[0].message).toBe("from node bus in 104 test");

    // bridge still works alongside
    const takeover = await getBlueprintEventBusRuntimeTakeoverPython({ op: "eventBus" });
    expect(takeover.ownership).toBe("node-retained");
    expect(takeover.productionTakeover).toBe(false);

    // python projection slice is independent
    const projTake = await getBlueprintEventBusRuntimeTakeoverPython({ op: "project" });
    expect(projTake.ownership).toBe("python-owned");
  });
});
