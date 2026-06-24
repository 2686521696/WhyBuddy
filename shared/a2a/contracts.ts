/**
 * A2A cutover contracts (101 slice).
 * Advisory readiness only. Does not replace shared/a2a-protocol.ts
 * or claim full protocol ownership.
 */

export type A2ACoreRouteComponent =
  | "registry"
  | "session"
  | "stream"
  | "cancel"
  | "chat"
  | "report";

export type A2ACoreRouteCutoverStatus = "ready" | "blocked" | "degraded" | "skipped-live";

export interface A2ACoreRouteCutoverSummary {
  status: A2ACoreRouteCutoverStatus;
  components: Record<A2ACoreRouteComponent, A2ACoreRouteCutoverStatus>;
  metadata?: Record<string, unknown>;
}

export interface A2ACoreRouteCutoverResult {
  status: A2ACoreRouteCutoverStatus;
  contractVersion: string;
  provenance: string;
  ok: boolean;
  runtime: { owner: "python" | "node"; mode: "cutover_readiness" | "local_fallback" };
  cutoverSummary?: A2ACoreRouteCutoverSummary;
  error?: { code: string; message: string };
}

export const A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION = "a2a.core-route-cutover.v1" as const;

export function validateA2ACoreRouteCutover(payload: unknown): A2ACoreRouteCutoverResult {
  if (!payload || typeof payload !== "object") {
    return {
      status: "skipped-live",
      contractVersion: A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      error: { code: "invalid", message: "Invalid A2A cutover payload" },
    };
  }
  const p = payload as Record<string, unknown>;
  const rawStatus = (p.status as string) || "skipped-live";
  const normalized: A2ACoreRouteCutoverStatus =
    rawStatus === "ready" || rawStatus === "blocked" || rawStatus === "degraded" || rawStatus === "skipped-live"
      ? (rawStatus as A2ACoreRouteCutoverStatus)
      : "skipped-live";
  const cs = (p.cutoverSummary as any) || {
    status: normalized,
    components: {
      registry: "skipped-live",
      session: "skipped-live",
      stream: "skipped-live",
      cancel: "skipped-live",
      chat: "skipped-live",
      report: "skipped-live",
    },
    metadata: {},
  };
  return {
    status: normalized,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
    provenance: typeof p.provenance === "string" ? p.provenance : "node-fallback",
    ok: normalized === "ready",
    runtime: (p.runtime as any) || { owner: "node", mode: "local_fallback" },
    cutoverSummary: cs,
    ...(p.error ? { error: p.error as any } : {}),
  };
}

export function isA2ACoreRouteCutoverReady(result: unknown): boolean {
  const v = validateA2ACoreRouteCutover(result);
  return v.ok && v.status === "ready" && !!v.cutoverSummary;
}

// ---------------------------------------------------------------------------
// A2A session stream runtime slice (103) and production transport ownership (102)
// Advisory slice only. Production transport NOT taken over.
// ---------------------------------------------------------------------------

export interface A2ASessionStreamSliceResult {
  ok: boolean;
  status: string;
  session?: any;
  streamChunk?: any;
  error?: any;
  response?: any;
  contractVersion: string;
  provenance: string;
  runtime: { owner: "python" | "node"; mode: string };
}

export const A2A_SESSION_STREAM_SLICE_CONTRACT_VERSION = "a2a.session-stream-runtime-slice.v1" as const;

export function validateA2ASessionStreamSliceResult(payload: unknown): A2ASessionStreamSliceResult {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      status: "failed",
      contractVersion: A2A_SESSION_STREAM_SLICE_CONTRACT_VERSION,
      provenance: "node-fallback",
      runtime: { owner: "node", mode: "local_fallback" },
    };
  }
  const p = payload as any;
  return {
    ok: !!p.ok,
    status: p.status || "failed",
    session: p.session,
    streamChunk: p.streamChunk,
    error: p.error,
    response: p.response,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : A2A_SESSION_STREAM_SLICE_CONTRACT_VERSION,
    provenance: typeof p.provenance === "string" ? p.provenance : "node-fallback",
    runtime: p.runtime || { owner: "node", mode: "local_fallback" },
  };
}

export interface A2AProductionTransportOwnershipResult {
  status: string;
  contractVersion: string;
  provenance: string;
  productionTakeover: boolean;
  ownership: Record<string, string>;
  nodeBoundaries?: Record<string, string>;
  ok: boolean;
  note?: string;
  area?: string;
}

export const A2A_PRODUCTION_TRANSPORT_OWNERSHIP_CONTRACT_VERSION = "a2a.production-transport-ownership-closure.v1" as const;

export function validateA2AProductionTransportOwnership(payload: unknown): A2AProductionTransportOwnershipResult {
  if (!payload || typeof payload !== "object") {
    return {
      status: "success",
      contractVersion: A2A_PRODUCTION_TRANSPORT_OWNERSHIP_CONTRACT_VERSION,
      provenance: "node-fallback",
      productionTakeover: false,
      ownership: { realStreamTransport: "node-retained" },
      ok: true,
    };
  }
  const p = payload as any;
  return {
    status: p.status || "success",
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : A2A_PRODUCTION_TRANSPORT_OWNERSHIP_CONTRACT_VERSION,
    provenance: typeof p.provenance === "string" ? p.provenance : "node-fallback",
    productionTakeover: p.productionTakeover === true ? true : false,
    ownership: p.ownership || {},
    nodeBoundaries: p.nodeBoundaries,
    ok: p.ok !== false,
    note: p.note,
    area: p.area,
  };
}

// ---------------------------------------------------------------------------
// 104: Final provider + A2A scope reconciliation types (for parity contract)
// Python decide_final_provider_a2a_scope_reconciliation and Node mirror
// must agree on these shapes. skipped-live/synthetic/external-owned/external-agent-required
// excluded from numerator; real live-ready only with explicit python-owned evidence.
// ---------------------------------------------------------------------------

export interface ProviderSummary {
  total: number;
  liveReady: number;
  skippedLive: number;
  synthetic: number;
  externalOwned: number;
  realPythonTakeover: number;
}

export interface A2aSummary {
  total: number;
  pythonOwned: number;
  nodeRetained: number;
  externalAgentRequired: number;
  blocked: number;
  productionTakeover: boolean;
}

export interface MigrationDenom {
  totalSurfaces: number;
  pythonOwned: number;
  nodeRetained: number;
  externalOwnedOrSkipped?: number;
  externalAgentOrBlocked?: number;
  canClaimCompletion: boolean;
}

export interface FinalProviderA2aScopeReconciliation {
  area: string;
  ok: boolean;
  productionTakeover: boolean;
  providerSummary: ProviderSummary;
  a2aSummary: A2aSummary;
  migrationDenominator: MigrationDenom;
  excludedFromNumerator: string[];
  blockers: string[];
  note?: string;
  contractVersion?: string;
  provenance?: string;
  reason?: string;
  surfaces?: Record<string, unknown>;
}
