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
} from "../../shared/a2a/contracts.js";

// Re-export for test and route consumption convenience
export { validateA2ACoreRouteCutover, type A2ACoreRouteCutoverResult, A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION };

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
