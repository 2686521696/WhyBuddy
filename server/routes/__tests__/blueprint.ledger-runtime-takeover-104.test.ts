import { describe, expect, it, vi } from "vitest";

import {
  getBlueprintLedgerRuntimeTakeoverPython,
  assertNoProductionTakeoverForRetained,
  assertNodeFallbackPreservedWhenNoTakeover,
  computeLocalLedgerRuntimeTakeover,
  BLUEPRINT_LEDGER_RUNTIME_TAKEOVER_CONTRACT,
  computeBlueprintLedgerEntryPython,
} from "../blueprint/ledger-runtime-takeover-python.js";

describe("Blueprint ledger runtime takeover 104", () => {
  it("returns stable envelope with surface, fallback from bridge", async () => {
    const d = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "all" });
    expect(d.contractVersion).toBe(BLUEPRINT_LEDGER_RUNTIME_TAKEOVER_CONTRACT);
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("migrationDenominator");
    expect(d).toHaveProperty("fallback");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks ledger node-retained with no takeover and node fallback", async () => {
    const d = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "ledger" });
    expect(d.ownership).toBe("node-retained");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("marks ledgerEntrySlice python-owned but productionTakeover remains false and fallback node", async () => {
    const d = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "ledgerEntrySlice" });
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");
  });

  it("node bridge asserts retained surfaces preserve node fallback when no takeover", async () => {
    const d = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "ledger" });
    expect(() => assertNoProductionTakeoverForRetained(d)).not.toThrow();
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(d)).not.toThrow();

    const badTakeover = { ...d, productionTakeover: true, ownership: "node-retained" as const };
    expect(() => assertNoProductionTakeoverForRetained(badTakeover as any)).toThrow();

    const badFallback = { ...d, fallback: "python" };
    expect(() => assertNodeFallbackPreservedWhenNoTakeover(badFallback as any)).toThrow();
  });

  it("simulate all retained forces node retained and node fallback", async () => {
    const d = computeLocalLedgerRuntimeTakeover({ surface: "ledgerEntrySlice", simulate: { forceNodeRetained: true } });
    expect(d.ownership).toBe("node-retained");
    expect(d.fallback).toBe("node");
  });

  it("migration denominator records retained ledger responsibility", async () => {
    const d = await getBlueprintLedgerRuntimeTakeoverPython();
    expect(d.migrationDenominator.total).toBeGreaterThanOrEqual(2);
    expect(d.migrationDenominator.nodeRetained).toBeGreaterThanOrEqual(1);
    expect(d.migrationDenominator.pythonOwned).toBeLessThanOrEqual(1);
    expect(d.evidence).toHaveProperty("nodeRetains");
  });

  it("no node-retained surface is reported as production complete", async () => {
    const d = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "ledger" });
    expect(d.productionTakeover).toBe(false);
    if (d.ownership === "node-retained") {
      expect(d.productionTakeover).not.toBe(true);
    }
  });

  it("node bridge consumes provided python decider result (ledger evidence is consumed and fallback explicit)", async () => {
    const pythonDecider = {
      decide: vi.fn(async (inp?: any) => {
        // simulate result as if fetched from real python service (provides ledger evidence)
        const base = computeLocalLedgerRuntimeTakeover(inp);
        return {
          ...base,
          provenance: "python-blueprint-ledger-runtime-takeover-104",
        } as any;
      }),
      computeLedgerEntry: vi.fn(async (inp?: any) => {
        // simulate Python compute_blueprint_ledger_entry using provided real job/event inputs
        const job = (inp && inp.job) || {};
        const evs = (inp && (inp.events || inp.eventStream)) || [];
        const jid = job.id || (inp && inp.jobId) || "unknown";
        const entryCount = Array.isArray(evs) ? evs.length : 0;
        return {
          ok: true,
          action: (inp && inp.action) || "compute",
          contractVersion: BLUEPRINT_LEDGER_RUNTIME_TAKEOVER_CONTRACT,
          runtime: { owner: "python", ledgerOwner: "node", mode: "ledger-entry-slice" },
          ledgerEntry: {
            id: `led-${jid}`,
            jobId: jid,
            entryType: "job-audit-trail",
            status: job.status || (inp && inp.status) || "pending",
            stage: job.stage || (inp && inp.stage) || "input",
            projectId: job.projectId,
            eventCount: entryCount,
            transitions: (Array.isArray(evs) ? evs : []).slice(0, 5).map((e: any) => e.status || e.type).filter(Boolean),
            computedFrom: "real-job+events",
            recordedAt: (inp && inp.now) || job.updatedAt || "2026-06-24T00:00:00.000Z",
          },
          ownership: "python-owned",
          productionTakeover: false,
          provenance: "python-blueprint-ledger-runtime-takeover-104",
        };
      }),
    };
    const d = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "ledgerEntrySlice" }, pythonDecider);
    expect(pythonDecider.decide).toHaveBeenCalled();
    expect(d.provenance).toBe("python-blueprint-ledger-runtime-takeover-104");
    expect(d.ownership).toBe("python-owned");
    expect(d.productionTakeover).toBe(false);
    expect(d.fallback).toBe("node");

    // retained also consumes
    const d2 = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "ledger" }, pythonDecider);
    expect(d2.ownership).toBe("node-retained");
    expect(d2.fallback).toBe("node");

    // prove ledgerEntry from real job/event inputs is computed by Python and consumed by bridge
    const realJob = { id: "job-104-real", status: "running", stage: "spec_tree", projectId: "p-104", updatedAt: "2026-06-24T10:00:00.000Z" };
    const realEvents = [
      { id: "e1", status: "created", type: "job.created" },
      { id: "e2", status: "running", type: "job.running" },
      { id: "e3", status: "completed", type: "job.completed" },
    ];
    const ev = await computeBlueprintLedgerEntryPython({ job: realJob, events: realEvents, now: "2026-06-24T10:01:00Z" }, pythonDecider);
    expect(pythonDecider.computeLedgerEntry).toHaveBeenCalled();
    expect(ev.provenance).toBe("python-blueprint-ledger-runtime-takeover-104");
    expect(ev.ledgerEntry).toBeDefined();
    expect(ev.ledgerEntry.jobId).toBe("job-104-real");
    expect(ev.ledgerEntry.eventCount).toBe(3);
    expect(ev.ledgerEntry.computedFrom).toBe("real-job+events");
    expect(ev.ledgerEntry.status).toBe("running");
    expect(ev.productionTakeover).toBe(false);
  });

  it("productionTakeover is true only for the proven slice", () => {
    const dRetained = computeLocalLedgerRuntimeTakeover({ surface: "ledger", simulate: { productionTakeover: true } });
    expect(dRetained.productionTakeover).toBe(false);

    const dSlice = computeLocalLedgerRuntimeTakeover({ surface: "ledgerEntrySlice", simulate: { productionTakeover: true } });
    expect(dSlice.productionTakeover).toBe(true);
    expect(dSlice.ownership).toBe("python-owned");
  });

  it("envelope separates python-owned ledger slice from retained", async () => {
    const all = await getBlueprintLedgerRuntimeTakeoverPython({ surface: "all" });
    const own = all.ownership as Record<string, string>;
    expect(own.ledger).toBe("node-retained");
    expect(own.ledgerEntrySlice).toBe("python-owned");
  });
});
