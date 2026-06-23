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
