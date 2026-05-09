/**
 * Shared pure helpers for deterministic (simulated fallback) capability
 * invocation output. Extracted from `server/routes/blueprint.ts` so the
 * MCP GitHub capability bridge can consume them without creating a
 * circular module-value import with the router file.
 *
 * Semantics (and tests that rely on them) remain unchanged: these three
 * helpers produce the exact same outputs as before, preserving the 45
 * baseline E2E + 48 subdomain assertions.
 */

import type {
  BlueprintCapabilityInvocationRequest,
  BlueprintRuntimeCapability,
} from "../../../shared/blueprint/index.js";

export function buildCapabilityOutputSummary(input: {
  capability: BlueprintRuntimeCapability;
  routeTitle?: string;
  nodeTitle?: string;
  input?: string;
}): string {
  const target = input.nodeTitle ?? input.routeTitle ?? "job context";
  const normalizedInput = input.input
    ? input.input.replace(/\s+/g, " ").slice(0, 120)
    : "no explicit input";

  return `${input.capability.label} simulated ${input.capability.kind} execution for ${target} using ${normalizedInput}.`;
}

export function buildCapabilityInvocationLogs(
  capability: BlueprintRuntimeCapability,
  outputSummary: string,
): string[] {
  return [
    `adapter=${capability.adapter}`,
    `security=${capability.securityLevel}`,
    `status=completed`,
    outputSummary,
  ];
}

export function deterministicCapabilityDuration(
  capability: BlueprintRuntimeCapability,
  request: BlueprintCapabilityInvocationRequest,
): number {
  const seed = `${capability.id}:${request.routeId ?? ""}:${request.nodeId ?? ""}:${request.input ?? ""}`;
  return 200 + (seed.length % 37) * 25;
}
