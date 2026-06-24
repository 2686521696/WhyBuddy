/**
 * Blueprint Production Denominator Reconciliation 104 - Node thin bridge / consumer.
 *
 * Python service returns the reconciled report aggregating six 104 takeover attempts.
 * Surfaces: 6 node-retained main (jobStore/eventBus/ledger/replan/promptPackage/previewState)
 * + 6 python-owned thin slices only.
 *
 * Node mirrors for contract tests; asserts:
 *   - node-retained never allow canClaimBlueprintProductionTakeover or productionTakeover
 *   - counts for pythonOwned/nodeRetained/externalOwned/outOfScope agree with python
 *   - canClaim true ONLY when zero retained in-scope blockers
 *
 * This does NOT migrate any durable/core Blueprint surface.
 * Thin slices only for denominator accounting.
 */

export const BLUEPRINT_PRODUCTION_DENOMINATOR_RECONCILIATION_CONTRACT =
  "blueprint.production-denominator-reconciliation.v1" as const;

export type BlueprintProductionDenominatorOwnership =
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope";

export interface BlueprintProductionDenominatorReconciliation {
  area?: string;
  ownership: BlueprintProductionDenominatorOwnership | Record<string, BlueprintProductionDenominatorOwnership>;
  productionTakeover: boolean;
  migrationDenominator: {
    total: number;
    pythonOwned: number;
    nodeRetained: number;
    externalOwned: number;
    outOfScope: number;
  };
  canClaimBlueprintProductionTakeover: boolean;
  reason?: string;
  evidence: Record<string, unknown>;
  contractVersion: typeof BLUEPRINT_PRODUCTION_DENOMINATOR_RECONCILIATION_CONTRACT;
  provenance: string;
  ok: boolean;
  surfaces?: Record<string, BlueprintProductionDenominatorOwnership>;
}

const BASE_SURFACES: Record<string, BlueprintProductionDenominatorOwnership> = {
  jobStore: "node-retained",
  eventBus: "node-retained",
  ledger: "node-retained",
  replan: "node-retained",
  promptPackage: "node-retained",
  previewState: "node-retained",
  jobStateRuntimeSlice: "python-owned",
  eventProjectionSlice: "python-owned",
  ledgerEntrySlice: "python-owned",
  previewStateRuntimeSlice: "python-owned",
  validationSlice: "python-owned",
  replanDecisionSlice: "python-owned",
};

const DEFAULT_RECONCILIATION: BlueprintProductionDenominatorReconciliation = {
  area: "all",
  ownership: BASE_SURFACES,
  productionTakeover: false,
  migrationDenominator: {
    total: 12,
    pythonOwned: 6,
    nodeRetained: 6,
    externalOwned: 0,
    outOfScope: 0,
  },
  canClaimBlueprintProductionTakeover: false,
  reason: "reconciled-104-six-surfaces;node-retains-durable-core;python-thin-slices-only",
  evidence: {
    source: "104-six-takeovers + 103-scope + 102-ownership-closure",
    six104Attempts: ["jobStore", "eventBus", "ledger", "replan", "promptPackage", "previewState"],
    nodeRetains: ["jobStore", "eventBus", "ledger", "replan", "promptPackage", "previewState"],
    pythonOnlySlices: [
      "jobStateRuntimeSlice",
      "eventProjectionSlice",
      "ledgerEntrySlice",
      "previewStateRuntimeSlice",
      "validationSlice",
      "replanDecisionSlice",
    ],
    realDurableRetained: "node",
    thinSlicesOnly: true,
  },
  contractVersion: BLUEPRINT_PRODUCTION_DENOMINATOR_RECONCILIATION_CONTRACT,
  provenance: "node-blueprint-production-denominator-reconciliation-104",
  ok: true,
};

function computeCanClaim(own: Record<string, BlueprintProductionDenominatorOwnership> | string): boolean {
  if (typeof own === "string") {
    return own !== "node-retained";
  }
  return Object.values(own).every((v) => v !== "node-retained");
}

export function computeLocalProductionDenominatorReconciliation(input?: {
  surface?: string;
  area?: string;
  simulate?: Record<string, unknown>;
}): BlueprintProductionDenominatorReconciliation {
  const requested = (input?.surface as string) || (input?.area as string) || "all";
  const sim = (input?.simulate || {}) as Record<string, unknown>;
  let base: Record<string, BlueprintProductionDenominatorOwnership> = { ...BASE_SURFACES };
  if (sim.forceNodeRetained || sim.allRetained) {
    Object.keys(base).forEach((k) => (base[k] = "node-retained"));
  }
  let ownership: BlueprintProductionDenominatorOwnership | Record<string, BlueprintProductionDenominatorOwnership>;
  let area = "all";
  if (requested === "all") {
    area = "all";
    ownership = base;
  } else if (requested in base) {
    area = requested;
    ownership = base[requested];
  } else {
    area = requested;
    ownership = "out-of-scope";
  }

  let productionTakeover = false;
  if (sim.productionTakeover) {
    if (area === "all") {
      productionTakeover = computeCanClaim(base);
    } else if (typeof ownership === "string" && ownership === "python-owned") {
      productionTakeover = true;
    }
  }

  const canClaim = computeCanClaim(base);

  let denom: any;
  if (area === "all") {
    const vals = Object.values(base);
    denom = {
      total: vals.length,
      pythonOwned: vals.filter((v) => v === "python-owned").length,
      nodeRetained: vals.filter((v) => v === "node-retained").length,
      externalOwned: vals.filter((v) => v === "external-owned").length,
      outOfScope: vals.filter((v) => v === "out-of-scope").length,
    };
  } else {
    const v = typeof ownership === "string" ? ownership : "node-retained";
    denom = {
      total: 1,
      pythonOwned: v === "python-owned" ? 1 : 0,
      nodeRetained: v === "node-retained" ? 1 : 0,
      externalOwned: v === "external-owned" ? 1 : 0,
      outOfScope: v === "out-of-scope" ? 1 : 0,
    };
  }

  const surfacesForAll = area === "all" ? base : undefined;

  return {
    ...DEFAULT_RECONCILIATION,
    area,
    ownership,
    productionTakeover,
    migrationDenominator: denom,
    canClaimBlueprintProductionTakeover: canClaim,
    surfaces: surfacesForAll,
  };
}

export async function getBlueprintProductionDenominatorReconciliationPython(
  input?: { surface?: string; area?: string; simulate?: Record<string, unknown> }
): Promise<BlueprintProductionDenominatorReconciliation> {
  // Local mirror; real would call python service.
  return computeLocalProductionDenominatorReconciliation(input);
}

export function assertNoRetainedBlockersForClaim(decision: BlueprintProductionDenominatorReconciliation): void {
  const own = decision.ownership;
  const hasRetained = typeof own === "string"
    ? own === "node-retained"
    : Object.values(own).some((v) => v === "node-retained");
  if (hasRetained && decision.canClaimBlueprintProductionTakeover) {
    throw new Error("retained in-scope blockers must prevent canClaimBlueprintProductionTakeover");
  }
  if (decision.canClaimBlueprintProductionTakeover && decision.migrationDenominator.nodeRetained > 0) {
    throw new Error("canClaim true requires zero nodeRetained");
  }
}
