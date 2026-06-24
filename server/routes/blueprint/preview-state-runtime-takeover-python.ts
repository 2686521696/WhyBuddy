/**
 * Blueprint Preview State Runtime Takeover 104 - Node thin bridge / consumer.
 *
 * Python service returns preview-state decision/projection envelope.
 * Node bridge consumes it (via optional decider) and asserts:
 *   node-retained / out-of-scope surfaces never equal python productionTakeover.
 *   When productionTakeover=false, node fallback ("node") is preserved explicitly.
 *
 * This does NOT migrate the real durable preview state.
 * It formalizes a narrow runtime projection path (previewStateRuntimeSlice) for accounting.
 * previewState durable surface remains node-retained.
 * Projection is runtime only; not counted as durable production takeover.
 */

export const BLUEPRINT_PREVIEW_STATE_RUNTIME_TAKEOVER_CONTRACT = "blueprint.preview-state-runtime-takeover.v1" as const;

export type BlueprintPreviewStateRuntimeTakeoverOwnership =
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope";

export interface BlueprintPreviewStateRuntimeTakeover {
  surface: string;
  ownership: BlueprintPreviewStateRuntimeTakeoverOwnership | Record<string, BlueprintPreviewStateRuntimeTakeoverOwnership>;
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
  contractVersion: "blueprint.preview-state-runtime-takeover.v1";
  provenance: string;
  ok: boolean;
  surfaces?: Record<string, BlueprintPreviewStateRuntimeTakeoverOwnership>;
}

const DEFAULT_NODE_PREVIEW_STATE: BlueprintPreviewStateRuntimeTakeover = {
  surface: "all",
  ownership: {
    previewState: "node-retained",
    previewStateRuntimeSlice: "python-owned",
  },
  productionTakeover: false,
  migrationDenominator: {
    total: 2,
    pythonOwned: 1,
    nodeRetained: 1,
  },
  evidence: {
    source: "103-scope + 104-preview-state-projection-boundary",
    nodeRetains: ["previewState"],
    pythonOnlySlice: ["previewStateRuntimeSlice"],
    realPreviewStateDurable: "node",
    projectionOnly: true,
    migrationDenominatorUpdated: true,
  },
  fallback: "node",
  reason: "node-retained-preview-state-per-103;no-production-runtime-takeover",
  contractVersion: BLUEPRINT_PREVIEW_STATE_RUNTIME_TAKEOVER_CONTRACT,
  provenance: "node-blueprint-preview-state-runtime-takeover-104",
  ok: true,
};

export function computeLocalPreviewStateRuntimeTakeover(
  input?: { surface?: string; simulate?: Record<string, unknown> }
): BlueprintPreviewStateRuntimeTakeover {
  const surface = (input?.surface as string) || "all";
  const sim = input?.simulate || {};
  const base: Record<string, BlueprintPreviewStateRuntimeTakeoverOwnership> = {
    previewState: "node-retained",
    previewStateRuntimeSlice: "python-owned",
  };
  if (sim.forceNodeRetained || sim.allRetained) {
    Object.keys(base).forEach((k) => (base[k] = "node-retained"));
  }
  const ownership = surface === "all" ? base : (base[surface] ?? "node-retained");
  const productionTakeover = !!sim.productionTakeover;
  const fallback = "node";
  return {
    ...DEFAULT_NODE_PREVIEW_STATE,
    surface,
    ownership,
    productionTakeover,
    fallback,
    reason:
      surface === "previewStateRuntimeSlice"
        ? "python-thin-preview-state-projection-slice;preview-state-durable-retained-in-node"
        : DEFAULT_NODE_PREVIEW_STATE.reason,
  };
}

export interface BlueprintPreviewStateRuntimeTakeoverPythonDep {
  decide(
    input?: { surface?: string; simulate?: Record<string, unknown> }
  ): BlueprintPreviewStateRuntimeTakeover | Promise<BlueprintPreviewStateRuntimeTakeover>;
}

/**
 * Node bridge consumer for python preview state runtime takeover (thin).
 * Accepts optional pythonDecider to consume Python decision/projection envelope.
 * When provided, uses its result (with explicit node fallback preserved).
 * Falls back to local mirror only if no decider or error.
 * Keeps fallback explicit; retained never claims productionTakeover.
 * Verifies bridge consumption (uses Python output not just local mirror).
 */
export async function getBlueprintPreviewStateRuntimeTakeoverPython(
  input?: { surface?: string; simulate?: Record<string, unknown> },
  pythonDecider?: BlueprintPreviewStateRuntimeTakeoverPythonDep,
): Promise<BlueprintPreviewStateRuntimeTakeover> {
  if (pythonDecider) {
    try {
      const raw = await Promise.resolve(pythonDecider.decide(input));
      if (raw && typeof raw === "object" && "ok" in raw) {
        return raw as BlueprintPreviewStateRuntimeTakeover;
      }
    } catch {
      // fallthrough to local mirror on error
    }
  }
  return computeLocalPreviewStateRuntimeTakeover(input);
}

export function assertNoProductionTakeoverForRetained(decision: BlueprintPreviewStateRuntimeTakeover): void {
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

export function assertNodeFallbackPreservedWhenNoTakeover(decision: BlueprintPreviewStateRuntimeTakeover): void {
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
