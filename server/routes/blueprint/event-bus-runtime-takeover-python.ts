/**
 * Blueprint Event Bus Runtime Takeover 104 - Node thin bridge / consumer.
 *
 * Python service returns event bus runtime takeover envelope classifying
 * append/project/replay ownership + runs deterministic projection slice.
 *
 * Node bridge consumes it and asserts:
 *   node-retained / out-of-scope surfaces never report productionTakeover.
 *   When productionTakeover=false, node fallback ("node") is preserved.
 *   Envelope separates python-owned, node-retained, out-of-scope.
 *
 * This does NOT replace the real Node event bus (createBlueprintEventBus).
 * Python owns only a bounded projection/replay slice for accounting.
 * Durable append + transport remain node-retained.
 */

export const BLUEPRINT_EVENT_BUS_RUNTIME_TAKEOVER_CONTRACT = "blueprint.event-bus-runtime-takeover.v1" as const;

export type BlueprintEventBusRuntimeTakeoverOwnership =
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope";

export interface BlueprintEventBusRuntimeTakeover {
  area?: string;
  op?: string;
  ownership: BlueprintEventBusRuntimeTakeoverOwnership | Record<string, BlueprintEventBusRuntimeTakeoverOwnership>;
  productionTakeover: boolean;
  migrationDenominator: {
    total: number;
    pythonOwned: number;
    nodeRetained: number;
    externalOwned?: number;
    outOfScope?: number;
  };
  evidence: Record<string, unknown>;
  fallback: string;
  reason?: string;
  contractVersion: typeof BLUEPRINT_EVENT_BUS_RUNTIME_TAKEOVER_CONTRACT;
  provenance: string;
  ok: boolean;
  areas?: Record<string, BlueprintEventBusRuntimeTakeoverOwnership>;
}

const DEFAULT_NODE_EVENT_BUS_TAKEOVER: BlueprintEventBusRuntimeTakeover = {
  area: "all",
  ownership: {
    eventBus: "node-retained",
    append: "node-retained",
    project: "python-owned",
    replay: "python-owned",
    eventProjectionSlice: "python-owned",
  },
  productionTakeover: false,
  migrationDenominator: {
    total: 5,
    pythonOwned: 3,
    nodeRetained: 2,
  },
  evidence: {
    source: "103-scope + job-event-stream + 104-event-bus-slice",
    nodeRetains: ["eventBus", "append"],
    pythonOnlySlice: ["project", "replay", "eventProjectionSlice"],
    realEventBus: "node",
    realAppendOwner: "node",
  },
  fallback: "node",
  reason: "node-retained-event-bus-per-103;no-production-event-transport-takeover",
  contractVersion: BLUEPRINT_EVENT_BUS_RUNTIME_TAKEOVER_CONTRACT,
  provenance: "node-blueprint-event-bus-runtime-takeover-104",
  ok: true,
};

export function computeLocalEventBusRuntimeTakeover(
  input?: { op?: string; area?: string; surface?: string; simulate?: Record<string, unknown> }
): BlueprintEventBusRuntimeTakeover {
  const requested = (input?.op as string) || (input?.area as string) || (input?.surface as string) || "all";
  const sim = input?.simulate || {};
  const base: Record<string, BlueprintEventBusRuntimeTakeoverOwnership> = {
    eventBus: "node-retained",
    append: "node-retained",
    project: "python-owned",
    replay: "python-owned",
    eventProjectionSlice: "python-owned",
  };
  if (sim.forceNodeRetained || sim.allRetained) {
    Object.keys(base).forEach((k) => (base[k] = "node-retained"));
  }
  let ownership: BlueprintEventBusRuntimeTakeoverOwnership | Record<string, BlueprintEventBusRuntimeTakeoverOwnership>;
  const pythonSlices = ["project", "replay", "eventProjectionSlice"] as const;
  if (requested === "all") {
    ownership = { ...base };
  } else if (requested in base) {
    ownership = base[requested];
  } else {
    ownership = "out-of-scope";
  }
  const isPythonSlice = requested !== "all" && pythonSlices.includes(requested as any);
  const productionTakeover = !!sim.productionTakeover && isPythonSlice;
  const fallback = "node";
  const retainedReason = DEFAULT_NODE_EVENT_BUS_TAKEOVER.reason || "node-retained-event-bus-per-103;no-production-event-transport-takeover";
  let reason: string;
  if (requested === "all") {
    reason = DEFAULT_NODE_EVENT_BUS_TAKEOVER.reason ?? retainedReason;
  } else if (isPythonSlice) {
    reason = "python-thin-event-projection-replay-slice;event-bus-transport-retained-in-node";
  } else if (ownership === "out-of-scope") {
    reason = "out-of-scope-op-for-event-bus-runtime;only-known-ops-classified";
  } else {
    reason = DEFAULT_NODE_EVENT_BUS_TAKEOVER.reason ?? retainedReason;
  }
  return {
    ...DEFAULT_NODE_EVENT_BUS_TAKEOVER,
    area: requested,
    op: requested,
    ownership,
    productionTakeover,
    fallback,
    reason,
  };
}

export interface BlueprintEventBusRuntimeTakeoverPythonDep {
  decide(
    input?: { op?: string; area?: string; surface?: string; simulate?: Record<string, unknown> }
  ): BlueprintEventBusRuntimeTakeover | Promise<BlueprintEventBusRuntimeTakeover>;
}

/**
 * Node bridge consumer for python event bus runtime takeover decision (thin).
 * When pythonDecider provided, delegates and consumes its result (proves bridge uses Python output).
 * Without, falls back to local mirror (for contract tests). Real proxy would delegate over wire.
 */
export async function getBlueprintEventBusRuntimeTakeoverPython(
  input?: { op?: string; area?: string; surface?: string; simulate?: Record<string, unknown> },
  pythonDecider?: BlueprintEventBusRuntimeTakeoverPythonDep,
): Promise<BlueprintEventBusRuntimeTakeover> {
  if (pythonDecider) {
    try {
      const raw = await Promise.resolve(pythonDecider.decide(input));
      if (raw && typeof raw === "object" && "ok" in raw) {
        return raw as BlueprintEventBusRuntimeTakeover;
      }
    } catch {
      // fallthrough to local mirror on error
    }
  }
  return computeLocalEventBusRuntimeTakeover(input);
}

export function assertNoProductionTakeoverForRetained(decision: BlueprintEventBusRuntimeTakeover): void {
  const own = decision.ownership;
  if (typeof own === "string") {
    if ((own === "node-retained" || own === "out-of-scope") && decision.productionTakeover) {
      throw new Error("node-retained must not equal productionTakeover");
    }
  } else if (own && typeof own === "object") {
    for (const [k, v] of Object.entries(own)) {
      if ((v === "node-retained" || v === "out-of-scope") && decision.productionTakeover) {
        throw new Error(`node-retained surface ${k} must not report productionTakeover`);
      }
    }
  }
}

export function assertNodeFallbackPreservedWhenNoTakeover(decision: BlueprintEventBusRuntimeTakeover): void {
  if (decision.productionTakeover === false) {
    if (decision.fallback !== "node") {
      throw new Error("node fallback must be preserved when productionTakeover is false");
    }
  }
  const own = decision.ownership;
  if (typeof own === "string") {
    if ((own === "node-retained" || own === "out-of-scope") && decision.fallback !== "node") {
      throw new Error("retained surfaces must report node fallback");
    }
  } else if (own && typeof own === "object") {
    for (const [k, v] of Object.entries(own)) {
      if ((v === "node-retained" || v === "out-of-scope") && decision.fallback !== "node") {
        throw new Error(`node-retained surface ${k} must preserve node fallback`);
      }
    }
  }
}
