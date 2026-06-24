/**
 * Blueprint Replan Runtime Takeover 104 - Node thin bridge / consumer.
 *
 * Python service returns replan runtime takeover envelope + deterministic branch/replan classification.
 * Node bridge consumes it and asserts:
 *   node-retained surfaces (replan) never equal python productionTakeover.
 *   When productionTakeover=false, node fallback ("node") is preserved.
 *
 * This does NOT migrate the real replan route, branch-creator, handlers or 409 conflict logic.
 * Python owns only a bounded decision slice (replanDecisionSlice) for classification of branch validation.
 * Core replan surfaces, downstream invalidation enforcement and conflict handling remain node-retained.
 *
 * The helper test proves the Python decision is used for the bounded slice via optional pythonDecider.
 */

export const BLUEPRINT_REPLAN_RUNTIME_TAKEOVER_CONTRACT = "blueprint.replan-runtime-takeover.v1" as const;

export type BlueprintReplanRuntimeTakeoverOwnership =
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope";

export interface BlueprintReplanRuntimeTakeover {
  surface: string;
  ownership: BlueprintReplanRuntimeTakeoverOwnership | Record<string, BlueprintReplanRuntimeTakeoverOwnership>;
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
  contractVersion: typeof BLUEPRINT_REPLAN_RUNTIME_TAKEOVER_CONTRACT;
  provenance: string;
  ok: boolean;
  surfaces?: Record<string, BlueprintReplanRuntimeTakeoverOwnership>;
  classification?: Record<string, unknown>;
}

export interface BlueprintReplanRuntimeTakeoverPythonDep {
  decide(
    input?: { surface?: string; simulate?: Record<string, unknown> }
  ): BlueprintReplanRuntimeTakeover | Promise<BlueprintReplanRuntimeTakeover>;
  classifyReplanDecision?(
    input?: { replanRequest?: any; fromStage?: string; mode?: string; job?: any; [k: string]: unknown }
  ): any | Promise<any>;
}

const DEFAULT_NODE_REPLAN_TAKEOVER: BlueprintReplanRuntimeTakeover = {
  surface: "all",
  ownership: {
    replan: "node-retained",
    replanDecisionSlice: "python-owned",
  },
  productionTakeover: false,
  migrationDenominator: {
    total: 2,
    pythonOwned: 1,
    nodeRetained: 1,
  },
  evidence: {
    source: "103-replan-node-retained + 104-replan-decision-slice",
    nodeRetains: ["replan"],
    pythonOnlySlice: ["replanDecisionSlice"],
    branchValidation: "python-decision-slice",
    downstreamInvalidation: "node-owns-409-conflict",
    realReplanOwner: "node",
  },
  fallback: "node",
  reason: "node-retained-replan-per-103;no-production-replan-takeover",
  contractVersion: BLUEPRINT_REPLAN_RUNTIME_TAKEOVER_CONTRACT,
  provenance: "node-blueprint-replan-runtime-takeover-104",
  ok: true,
};

export function computeLocalReplanRuntimeTakeover(input?: { surface?: string; simulate?: Record<string, unknown> }): BlueprintReplanRuntimeTakeover {
  const surface = (input?.surface as string) || "all";
  const sim = input?.simulate || {};
  const base: Record<string, BlueprintReplanRuntimeTakeoverOwnership> = {
    replan: "node-retained",
    replanDecisionSlice: "python-owned",
  };
  if (sim.forceNodeRetained || sim.allRetained) {
    Object.keys(base).forEach((k) => (base[k] = "node-retained"));
  }
  const ownership = surface === "all" ? { ...base } : (base[surface] ?? "node-retained");
  const productionTakeover = !!sim.productionTakeover && (surface === "replanDecisionSlice" || surface === "all");
  const fallback = "node";
  const reason =
    surface === "replanDecisionSlice"
      ? "python-replan-decision-slice;branch-validation-and-conflict-classification;core-replan-node-retained"
      : DEFAULT_NODE_REPLAN_TAKEOVER.reason;
  return {
    ...DEFAULT_NODE_REPLAN_TAKEOVER,
    surface,
    ownership,
    productionTakeover: surface === "replanDecisionSlice" ? productionTakeover : false,
    fallback,
    reason,
  };
}

/**
 * Node bridge consumer for python replan runtime takeover decision (thin).
 * When pythonDecider provided, delegates to it (proves Node uses Python decision for bounded slice).
 * Without, falls back to local mirror (for contract/gate tests).
 */
export async function getBlueprintReplanRuntimeTakeoverPython(
  input?: { surface?: string; simulate?: Record<string, unknown> },
  pythonDecider?: BlueprintReplanRuntimeTakeoverPythonDep,
): Promise<BlueprintReplanRuntimeTakeover> {
  if (pythonDecider && typeof pythonDecider.decide === "function") {
    try {
      const raw = await Promise.resolve(pythonDecider.decide(input));
      if (raw && typeof raw === "object" && "ok" in raw) {
        return raw as BlueprintReplanRuntimeTakeover;
      }
    } catch {
      // fallthrough to local
    }
  }
  return computeLocalReplanRuntimeTakeover(input);
}

/**
 * Bridge helper that calls Python classify when provided, proving consumption of
 * deterministic branch/replan classification result from realistic input.
 */
export async function classifyBlueprintReplanDecisionPython(
  input?: { replanRequest?: any; fromStage?: string; mode?: string; job?: any; [k: string]: unknown },
  pythonDecider?: BlueprintReplanRuntimeTakeoverPythonDep,
): Promise<any> {
  if (pythonDecider && typeof (pythonDecider as any).classifyReplanDecision === "function") {
    try {
      const raw = await Promise.resolve((pythonDecider as any).classifyReplanDecision(input));
      if (raw && typeof raw === "object" && ("classification" in raw || raw.ok === true)) {
        return raw;
      }
    } catch {
      // fallthrough
    }
  }
  // Local mirror classification (simple deterministic)
  const req = (input && (input.replanRequest || input)) || {};
  const fromStage = (req.fromStage as string) || (input && (input.fromStage as string)) || "input";
  const mode = (req.mode as string) || (input && (input.mode as string)) || "branch";
  const classification = mode === "branch" ? "branch" : "in_place";
  let valid = true;
  let conflictReason: string | null = null;
  if (["final_artifact", "publish", "final"].includes(fromStage)) {
    valid = mode !== "branch";
    if (!valid) conflictReason = "downstream_final_stage";
  }
  return {
    ok: true,
    classification: {
      fromStage,
      mode,
      classification,
      valid,
      conflictReason,
      downstreamInvalidated: conflictReason ? [fromStage] : [],
    },
    ownership: "python-owned",
    productionTakeover: false,
    provenance: "node-blueprint-replan-runtime-takeover-104",
    contractVersion: BLUEPRINT_REPLAN_RUNTIME_TAKEOVER_CONTRACT,
  };
}

export function assertNoProductionTakeoverForRetained(decision: BlueprintReplanRuntimeTakeover): void {
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

export function assertNodeFallbackPreservedWhenNoTakeover(decision: BlueprintReplanRuntimeTakeover): void {
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
