/**
 * Blueprint Job Store Runtime Takeover 104 - Node thin bridge / consumer.
 *
 * Python service returns runtime takeover envelope.
 * Node bridge consumes it and asserts:
 *   node-retained / out-of-scope surfaces never equal python productionTakeover.
 *   When productionTakeover=false, node fallback ("node") is preserved.
 *
 * This does NOT migrate the real durable job store.
 * It formalizes a runtime decision surface (e.g. jobStateRuntimeSlice) for accounting.
 * Durable store, eventBus etc remain node-retained.
 */
import type {
  BlueprintJobStoreRuntimeTakeover,
  BlueprintJobStoreRuntimeTakeoverOwnership,
} from "../../../shared/blueprint/jobs/types.js";

export const BLUEPRINT_JOB_STORE_RUNTIME_TAKEOVER_CONTRACT = "blueprint.job-store-runtime-takeover.v1" as const;

export type { BlueprintJobStoreRuntimeTakeover, BlueprintJobStoreRuntimeTakeoverOwnership };

const DEFAULT_NODE_RUNTIME_TAKEOVER: BlueprintJobStoreRuntimeTakeover = {
  surface: "all",
  ownership: {
    jobStore: "node-retained",
    eventBus: "node-retained",
    ledger: "node-retained",
    replan: "node-retained",
    promptPackage: "node-retained",
    previewState: "node-retained",
    jobStateRuntimeSlice: "python-owned",
  },
  productionTakeover: false,
  migrationDenominator: {
    total: 7,
    pythonOwned: 1,
    nodeRetained: 6,
  },
  evidence: {
    source: "103-scope + job-runtime-proxy-boundary + 104-runtime-decision",
    nodeRetains: ["jobStore", "eventBus", "ledger", "replan", "promptPackage", "previewState"],
    pythonOnlySlice: ["jobStateRuntimeSlice"],
    durableStore: "node",
    realPersistenceOwner: "node",
  },
  fallback: "node",
  reason: "node-retained-durable-job-store-per-103;no-production-runtime-takeover",
  contractVersion: BLUEPRINT_JOB_STORE_RUNTIME_TAKEOVER_CONTRACT,
  provenance: "node-blueprint-job-store-runtime-takeover-104",
  ok: true,
};

export function computeLocalJobStoreRuntimeTakeover(input?: { surface?: string; simulate?: Record<string, unknown> }): BlueprintJobStoreRuntimeTakeover {
  const surface = (input?.surface as string) || "all";
  const sim = input?.simulate || {};
  const base: Record<string, BlueprintJobStoreRuntimeTakeoverOwnership> = {
    jobStore: "node-retained",
    eventBus: "node-retained",
    ledger: "node-retained",
    replan: "node-retained",
    promptPackage: "node-retained",
    previewState: "node-retained",
    jobStateRuntimeSlice: "python-owned",
  };
  if (sim.forceNodeRetained || sim.allRetained) {
    Object.keys(base).forEach((k) => (base[k] = "node-retained"));
  }
  const ownership = surface === "all" ? base : (base[surface] ?? "node-retained");
  const productionTakeover = !!sim.productionTakeover;
  const fallback = "node";
  return {
    ...DEFAULT_NODE_RUNTIME_TAKEOVER,
    surface,
    ownership,
    productionTakeover,
    fallback,
    reason:
      surface === "jobStateRuntimeSlice"
        ? "python-thin-job-state-runtime-slice; durable-job-store-retained-in-node"
        : DEFAULT_NODE_RUNTIME_TAKEOVER.reason,
  };
}

/**
 * Node bridge consumer for python runtime takeover decision (thin).
 * Supports local for contract tests. Real would proxy to python.
 * Asserts retained surfaces preserve node fallback when no takeover.
 */
export async function getBlueprintJobStoreRuntimeTakeoverPython(
  input?: { surface?: string; simulate?: Record<string, unknown> }
): Promise<BlueprintJobStoreRuntimeTakeover> {
  return computeLocalJobStoreRuntimeTakeover(input);
}

export function assertNoProductionTakeoverForRetained(decision: BlueprintJobStoreRuntimeTakeover): void {
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

export function assertNodeFallbackPreservedWhenNoTakeover(decision: BlueprintJobStoreRuntimeTakeover): void {
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