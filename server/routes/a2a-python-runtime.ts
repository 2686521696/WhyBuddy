/**
 * A2A Python runtime bridge (cutover 101).
 *
 * Thin consumption layer only.
 * - Does NOT rewrite full A2A protocol.
 * - Does NOT take over stream/invoke/chat/report production paths.
 * - Provides cutover decision consumption for registry/session/stream/cancel/chat/report readiness.
 *
 * Real A2A routing, stream transport, agent registry mutation, and business chat/report stay Node-owned.
 */

import {
  validateA2ACoreRouteCutover,
  type A2ACoreRouteCutoverResult,
  A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
  validateA2ASessionStreamSliceResult,
  type A2ASessionStreamSliceResult,
  A2A_SESSION_STREAM_SLICE_CONTRACT_VERSION,
  validateA2AProductionTransportOwnership,
  type A2AProductionTransportOwnershipResult,
  A2A_PRODUCTION_TRANSPORT_OWNERSHIP_CONTRACT_VERSION,
  type ProviderSummary,
  type A2aSummary,
  type MigrationDenom,
  type FinalProviderA2aScopeReconciliation,
} from "../../shared/a2a/contracts.js";

// Re-export for test and route consumption convenience
export {
  validateA2ACoreRouteCutover,
  type A2ACoreRouteCutoverResult,
  A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
  validateA2ASessionStreamSliceResult,
  type A2ASessionStreamSliceResult,
  A2A_SESSION_STREAM_SLICE_CONTRACT_VERSION,
  validateA2AProductionTransportOwnership,
  type A2AProductionTransportOwnershipResult,
  A2A_PRODUCTION_TRANSPORT_OWNERSHIP_CONTRACT_VERSION,
};

// Also surface python-contract version for parity (from protocol, but re-exported here for a2a-python-runtime consumers)
export { A2A_PYTHON_RUNTIME_CONTRACT_VERSION, isA2APythonRuntimeResult } from "../../shared/a2a-protocol.js";

// Thin bridge runner for core route cutover decision from python
export interface A2APythonRuntimeCutoverDep {
  execute(payload: Record<string, unknown>): A2ACoreRouteCutoverResult | Promise<A2ACoreRouteCutoverResult>;
}

export async function runA2ACoreRouteCutover(
  pythonCutover: A2APythonRuntimeCutoverDep | undefined,
  payload: Record<string, unknown>,
): Promise<A2ACoreRouteCutoverResult> {
  if (!pythonCutover) {
    return validateA2ACoreRouteCutover({
      status: "skipped-live",
      contractVersion: A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      cutoverSummary: {
        status: "skipped-live",
        components: {
          registry: "node",
          session: "node",
          stream: "node",
          cancel: "node",
          chat: "node",
          report: "node",
        },
        metadata: { note: "python not wired" },
      },
    });
  }
  try {
    const raw = await Promise.resolve(pythonCutover.execute(payload));
    return validateA2ACoreRouteCutover(raw);
  } catch {
    return validateA2ACoreRouteCutover({
      status: "skipped-live",
      contractVersion: A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      cutoverSummary: {
        status: "skipped-live",
        components: {
          registry: "node",
          session: "node",
          stream: "node",
          cancel: "node",
          chat: "node",
          report: "node",
        },
        metadata: { note: "python cutover bridge error" },
      },
      error: { code: "bridge_error", message: "A2A core route cutover fetch failed" },
    });
  }
}

// Bridge helper that Node uses to decide route ownership for a given component (readiness only)
export function getA2ARouteOwnershipDecision(cutover: A2ACoreRouteCutoverResult, component: string): string {
  const summary = cutover.cutoverSummary;
  if (summary && summary.components && component in summary.components) {
    return summary.components[component as keyof typeof summary.components] || "skipped-live";
  }
  return "skipped-live";
}

// ---------------------------------------------------------------------------
// 103: Session stream runtime slice bridge (thin, not production transport)
// ---------------------------------------------------------------------------

export interface A2ASessionStreamSliceDep {
  create(payload: Record<string, unknown>): A2ASessionStreamSliceResult | Promise<A2ASessionStreamSliceResult>;
  append?(sessionId: string, chunk: Record<string, unknown>, state?: any): A2ASessionStreamSliceResult | Promise<A2ASessionStreamSliceResult>;
  cancel?(sessionId: string, envelope?: any): A2ASessionStreamSliceResult | Promise<A2ASessionStreamSliceResult>;
}

export async function runA2ASessionStreamSlice(
  pythonSlice: A2ASessionStreamSliceDep | undefined,
  action: "create" | "append" | "cancel",
  payload: Record<string, unknown>,
): Promise<A2ASessionStreamSliceResult> {
  if (!pythonSlice) {
    return validateA2ASessionStreamSliceResult({
      ok: false,
      status: "skipped-live",
      contractVersion: A2A_SESSION_STREAM_SLICE_CONTRACT_VERSION,
      provenance: "node-fallback",
      runtime: { owner: "node", mode: "local_fallback" },
      note: "python session stream slice not wired",
    });
  }
  try {
    let raw: any;
    if (action === "create") {
      raw = await Promise.resolve(pythonSlice.create(payload));
    } else if (action === "append" && pythonSlice.append) {
      const sid = (payload as any).sessionId || "unknown";
      raw = await Promise.resolve(pythonSlice.append(sid, (payload as any).chunk || {}, (payload as any).state));
    } else if (action === "cancel" && pythonSlice.cancel) {
      raw = await Promise.resolve(pythonSlice.cancel((payload as any).sessionId || "", (payload as any).envelope));
    } else {
      raw = await Promise.resolve(pythonSlice.create(payload));
    }
    return validateA2ASessionStreamSliceResult(raw);
  } catch {
    return validateA2ASessionStreamSliceResult({
      ok: false,
      status: "failed",
      contractVersion: A2A_SESSION_STREAM_SLICE_CONTRACT_VERSION,
      provenance: "node-fallback",
      runtime: { owner: "node", mode: "local_fallback" },
      error: { code: "bridge_error", message: "slice bridge error" },
    });
  }
}

export function getA2ASessionStreamSliceOwnership(slice: A2ASessionStreamSliceResult): string {
  return slice.runtime?.owner || "node";
}

// 102 ownership closure bridge (explicit retained)
export interface A2ATransportOwnershipDep {
  decide(payload?: Record<string, unknown>): A2AProductionTransportOwnershipResult | Promise<A2AProductionTransportOwnershipResult>;
}

export async function runA2AProductionTransportOwnership(
  pythonOwner: A2ATransportOwnershipDep | undefined,
  payload?: Record<string, unknown>,
): Promise<A2AProductionTransportOwnershipResult> {
  if (!pythonOwner) {
    return validateA2AProductionTransportOwnership({
      status: "success",
      contractVersion: A2A_PRODUCTION_TRANSPORT_OWNERSHIP_CONTRACT_VERSION,
      provenance: "node-fallback",
      productionTakeover: false,
      ownership: { realStreamTransport: "node-retained", externalAgentInvoke: "external-agent-required" },
      ok: true,
      note: "python ownership not wired; node-retained",
    });
  }
  try {
    const raw = await Promise.resolve(pythonOwner.decide(payload));
    return validateA2AProductionTransportOwnership(raw);
  } catch {
    return validateA2AProductionTransportOwnership({
      status: "success",
      contractVersion: A2A_PRODUCTION_TRANSPORT_OWNERSHIP_CONTRACT_VERSION,
      provenance: "node-fallback",
      productionTakeover: false,
      ownership: { realStreamTransport: "node-retained" },
      ok: true,
    });
  }
}

// ---------------------------------------------------------------------------
// 104: Final provider A2A scope reconciliation (Node mirror)
// This lives in production Node file (thin runtime contract layer) so that
// Node runtime can return the denominator summary.
// Mirrors Python decide_final_provider_a2a_scope_reconciliation shape + counts.
// Does NOT fake live readiness; skipped/synthetic/external-owned/external-agent-required
// excluded from completion math. Real takeover only with explicit python-owned evidence.
// ---------------------------------------------------------------------------

const PROVIDER_BASE: ProviderSummary = {
  total: 19,
  liveReady: 0,
  skippedLive: 8,
  synthetic: 10,
  externalOwned: 1,
  realPythonTakeover: 0,
};

const A2A_SCOPE_BASE: Record<string, string> = {
  registry: 'node-retained',
  sessionStreamSliceDecision: 'python-owned',
  realStreamTransport: 'node-retained',
  externalAgentInvoke: 'external-agent-required',
  chatReporting: 'node-retained',
};

export function computeFinalProviderA2aScopeReconciliation(
  input?: { area?: string; simulate?: Record<string, any> }
): FinalProviderA2aScopeReconciliation {
  const areaReq = (input?.area as string) || (input as any)?.surface || 'all';
  const sim = (input?.simulate || {}) as Record<string, any>;

  // providers from 103 contract baseline (no live python owned real)
  let ps: ProviderSummary = { ...PROVIDER_BASE };
  if (sim.forceProviderCounts) {
    const fc = sim.forceProviderCounts;
    ps = {
      total: (fc.liveReady || 0) + (fc.skippedLive || 0) + (fc.synthetic || 0) + (fc.externalOwned || 0),
      liveReady: fc.liveReady || 0,
      skippedLive: fc.skippedLive || 8,
      synthetic: fc.synthetic || 10,
      externalOwned: fc.externalOwned || 1,
      realPythonTakeover: 0,
    };
  }
  if (sim.liveReadyPython) {
    // external simulate never grants python takeover per rules
    ps.realPythonTakeover = 0;
    ps.liveReady = 0;
  }

  // a2a surfaces
  let a2aBase: Record<string, string> = { ...A2A_SCOPE_BASE };
  if (sim.blockA2a || sim.block) {
    for (const k of ['registry', 'realStreamTransport', 'externalAgentInvoke', 'chatReporting']) {
      if (k in a2aBase) a2aBase[k] = 'blocked';
    }
  }

  const a2aPy = Object.values(a2aBase).filter((v) => v === 'python-owned').length;
  const a2aNode = Object.values(a2aBase).filter((v) => v === 'node-retained').length;
  const a2aExt = Object.values(a2aBase).filter((v) => v === 'external-agent-required').length;
  const a2aBlk = Object.values(a2aBase).filter((v) => v === 'blocked').length;

  const a2aS: A2aSummary = {
    total: Object.keys(a2aBase).length,
    pythonOwned: a2aPy,
    nodeRetained: a2aNode,
    externalAgentRequired: a2aExt,
    blocked: a2aBlk,
    productionTakeover: false,
  };

  let denom: MigrationDenom;
  if (areaReq === 'all' || !areaReq) {
    const tot = ps.total + a2aS.total;
    denom = {
      totalSurfaces: tot,
      pythonOwned: ps.realPythonTakeover + a2aPy,
      nodeRetained: a2aNode + ps.externalOwned,
      externalOwnedOrSkipped: ps.skippedLive + ps.synthetic,
      externalAgentOrBlocked: a2aExt + a2aBlk,
      canClaimCompletion: false,
    };
  } else if (areaReq === 'providers' || areaReq === 'provider') {
    denom = {
      totalSurfaces: ps.total,
      pythonOwned: ps.realPythonTakeover,
      nodeRetained: ps.externalOwned,
      externalOwnedOrSkipped: ps.skippedLive + ps.synthetic,
      canClaimCompletion: false,
    };
  } else if (areaReq === 'a2a' || areaReq === 'a2aScope') {
    denom = {
      totalSurfaces: a2aS.total,
      pythonOwned: a2aPy,
      nodeRetained: a2aNode,
      externalAgentOrBlocked: a2aExt + a2aBlk,
      canClaimCompletion: false,
    };
  } else {
    denom = { totalSurfaces: 0, pythonOwned: 0, nodeRetained: 0, externalOwnedOrSkipped: 0, canClaimCompletion: false };
  }

  return {
    area: areaReq === 'all' ? 'all' : areaReq,
    ok: true,
    productionTakeover: false,
    providerSummary: ps,
    a2aSummary: a2aS,
    migrationDenominator: denom,
    excludedFromNumerator: ['skipped-live', 'synthetic', 'external-owned', 'external-agent-required', 'node-retained'],
    blockers: Object.keys(a2aBase).filter((k) => ['node-retained', 'external-agent-required', 'blocked'].includes(a2aBase[k])),
    note: 'skipped-live, synthetic, external-owned, and external-agent-required stay excluded from completion math. Real live-ready claim possible only with explicit live-ready ownership and takeover evidence (python-owned only).',
  };
}

// Re-export types for consumers
export type {
  ProviderSummary,
  A2aSummary,
  MigrationDenom,
  FinalProviderA2aScopeReconciliation,
};
