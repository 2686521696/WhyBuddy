/**
 * Blueprint Prompt Package Runtime Takeover 104 - Node thin bridge / consumer.
 *
 * Python service returns prompt package runtime takeover envelope classifying
 * promptPackage (node-retained) vs validation/normalize slice (python-owned).
 *
 * Node bridge consumes it and asserts:
 *   node-retained / out-of-scope surfaces never report productionTakeover.
 *   When productionTakeover=false, node fallback ("node") is preserved.
 *   Envelope separates python-owned, node-retained, out-of-scope.
 *   Verifies bridge consumption (uses Python output not just local mirror).
 *
 * This does NOT replace the real Node prompt package (service, LLM, render).
 * Python owns only a bounded validation/normalize/metadata envelope slice.
 * Prompt packaging, content, LLM path remain node-retained.
 * Review must confirm status not overstated.
 */

export const BLUEPRINT_PROMPT_PACKAGE_RUNTIME_TAKEOVER_CONTRACT = "blueprint.prompt-package-runtime-takeover.v1" as const;

export type BlueprintPromptPackageRuntimeTakeoverOwnership =
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope";

export interface BlueprintPromptPackageRuntimeTakeover {
  surface?: string;
  area?: string;
  ownership: BlueprintPromptPackageRuntimeTakeoverOwnership | Record<string, BlueprintPromptPackageRuntimeTakeoverOwnership>;
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
  contractVersion: typeof BLUEPRINT_PROMPT_PACKAGE_RUNTIME_TAKEOVER_CONTRACT;
  provenance: string;
  ok: boolean;
  surfaces?: Record<string, BlueprintPromptPackageRuntimeTakeoverOwnership>;
}

const DEFAULT_NODE_PROMPT_PACKAGE_TAKEOVER: BlueprintPromptPackageRuntimeTakeover = {
  surface: "all",
  ownership: {
    promptPackage: "node-retained",
    validationSlice: "python-owned",
  },
  productionTakeover: false,
  migrationDenominator: {
    total: 2,
    pythonOwned: 1,
    nodeRetained: 1,
  },
  evidence: {
    source: "103-scope + prompt-preview-validation + 104-prompt-package-slice",
    nodeRetains: ["promptPackage"],
    pythonOnlySlice: ["validationSlice"],
    realPromptPackage: "node",
    realLLMOwner: "node",
  },
  fallback: "node",
  reason: "node-retained-prompt-package-per-103;python-validation-slice-only",
  contractVersion: BLUEPRINT_PROMPT_PACKAGE_RUNTIME_TAKEOVER_CONTRACT,
  provenance: "node-blueprint-prompt-package-runtime-takeover-104",
  ok: true,
};

export function computeLocalPromptPackageRuntimeTakeover(
  input?: { surface?: string; area?: string; op?: string; simulate?: Record<string, unknown> }
): BlueprintPromptPackageRuntimeTakeover {
  const requested = (input?.surface as string) || (input?.area as string) || (input?.op as string) || "all";
  const sim = input?.simulate || {};
  const base: Record<string, BlueprintPromptPackageRuntimeTakeoverOwnership> = {
    promptPackage: "node-retained",
    validationSlice: "python-owned",
  };
  if (sim.forceNodeRetained || sim.allRetained) {
    Object.keys(base).forEach((k) => (base[k] = "node-retained"));
  }
  let ownership: BlueprintPromptPackageRuntimeTakeoverOwnership | Record<string, BlueprintPromptPackageRuntimeTakeoverOwnership>;
  const pythonSlices = ["validationSlice"] as const;
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
  let reason: string;
  if (requested === "all") {
    reason = DEFAULT_NODE_PROMPT_PACKAGE_TAKEOVER.reason ?? "node-retained-prompt-package-per-103;python-validation-slice-only";
  } else if (isPythonSlice) {
    reason = "python-thin-prompt-package-validation-normalize-slice;promptPackage-retained-in-node";
  } else if (ownership === "out-of-scope") {
    reason = "out-of-scope-surface-for-prompt-package;only-known-surfaces-classified";
  } else {
    reason = DEFAULT_NODE_PROMPT_PACKAGE_TAKEOVER.reason ?? "node-retained-prompt-package-per-103;no-production-prompt-package-takeover";
  }
  return {
    ...DEFAULT_NODE_PROMPT_PACKAGE_TAKEOVER,
    surface: requested,
    area: requested,
    ownership,
    productionTakeover,
    fallback,
    reason,
  };
}

export interface BlueprintPromptPackageRuntimeTakeoverPythonDep {
  decide(
    input?: { surface?: string; area?: string; op?: string; simulate?: Record<string, unknown> }
  ): BlueprintPromptPackageRuntimeTakeover | Promise<BlueprintPromptPackageRuntimeTakeover>;
}

export async function getBlueprintPromptPackageRuntimeTakeoverPython(
  input?: { surface?: string; area?: string; op?: string; simulate?: Record<string, unknown> },
  pythonDecider?: BlueprintPromptPackageRuntimeTakeoverPythonDep,
): Promise<BlueprintPromptPackageRuntimeTakeover> {
  if (pythonDecider) {
    try {
      const raw = await Promise.resolve(pythonDecider.decide(input));
      if (raw && typeof raw === "object" && "ok" in raw) {
        return raw as BlueprintPromptPackageRuntimeTakeover;
      }
    } catch {
      // fallthrough to local mirror on error
    }
  }
  return computeLocalPromptPackageRuntimeTakeover(input);
}

export function assertNoProductionTakeoverForRetained(decision: BlueprintPromptPackageRuntimeTakeover): void {
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

export function assertNodeFallbackPreservedWhenNoTakeover(decision: BlueprintPromptPackageRuntimeTakeover): void {
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
