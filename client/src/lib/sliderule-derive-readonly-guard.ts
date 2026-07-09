/**
 * DERIVE P3 read-only guard — SlideRule V5.1 GOAL Conclusion Gate
 * Spec: .kiro/specs/sliderule-goal-conclusion-gate/ (Task 3.3, Property 3 / P3)
 *
 * Pins the DERIVE read-only-on-STATE invariant (knife P3): `deriveNodeStatus(state)` MUST
 * change ONLY `graph.nodes[].status` and leave every authoritative STATE field deep-equal to
 * the input. The design / bugfix.md (criteria 2.5, 3.5) require this to be enforced by a
 * guard/test rather than by convention, so that a future regression that lets DERIVE write
 * `artifacts`, `goal`, `decisions`, `capabilityRuns`, gaps (`coverageGaps`) or ledgers
 * (`decisionLedger`) is caught loudly.
 *
 * This is a framework-agnostic dev/test guard: it throws a descriptive `Error` on any
 * violation (no vitest / fast-check dependency), so it can be used from the P3 preservation
 * test and from any future call site.
 *
 * Validates: Requirements 2.5, 3.5
 */
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

/**
 * Authoritative STATE fields DERIVE must NEVER write. The only field `deriveNodeStatus` may
 * change is `graph.nodes[].status` (checked separately below).
 */
export const AUTHORITATIVE_STATE_FIELDS = [
  "artifacts",
  "goal",
  "decisions",
  "capabilityRuns",
  "coverageGaps",
  "decisionLedger",
  "gates",
  "dependencyGraph",
  "evidence",
  "risks",
  "openQuestions",
  "staleArtifactIds",
  "coverageContract",
  "coverageGate",
] as const;

/**
 * Structural deep-equality. Treats an own property whose value is `undefined` as absent
 * (matching vitest `toEqual` semantics) so guard results are stable across `structuredClone`
 * and spread-copy round-trips. Inputs are plain JSON-like session-state data (no functions /
 * class instances), so this is sufficient.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return a === b;
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (!deepEqual(aa[i], bb[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Assert that `deriveNodeStatus` behaved as a pure read-only projection.
 *
 * @param before A pre-call deep clone (e.g. `structuredClone(state)`) of the input state.
 * @param after  The `deriveNodeStatus(state)` result.
 * @throws Error with a descriptive message naming the violated field if DERIVE wrote any
 *   authoritative STATE field, changed graph metadata outside `nodes`, changed the node count,
 *   or changed any node field other than `status`.
 */
export function assertDeriveReadOnly(before: V5SessionState, after: V5SessionState): void {
  const afterRec = after as unknown as Record<string, unknown>;
  const beforeRec = before as unknown as Record<string, unknown>;
  for (const field of AUTHORITATIVE_STATE_FIELDS) {
    if (!deepEqual(afterRec[field], beforeRec[field])) {
      throw new Error(
        `DERIVE P3 violation: deriveNodeStatus wrote authoritative STATE field "${field}". ` +
          "DERIVE must change only graph.nodes[].status."
      );
    }
  }

  // Graph metadata (everything except nodes) must be unchanged.
  const afterGraphMeta = { ...(after.graph as unknown as Record<string, unknown>), nodes: undefined };
  const beforeGraphMeta = { ...(before.graph as unknown as Record<string, unknown>), nodes: undefined };
  if (!deepEqual(afterGraphMeta, beforeGraphMeta)) {
    throw new Error(
      "DERIVE P3 violation: deriveNodeStatus changed graph metadata outside graph.nodes[]."
    );
  }

  // Only graph.nodes[].status may differ; node identity/shape/count must be unchanged.
  const beforeNodes = ((before.graph as { nodes?: unknown[] })?.nodes || []) as Array<Record<string, unknown>>;
  const afterNodes = ((after.graph as { nodes?: unknown[] })?.nodes || []) as Array<Record<string, unknown>>;
  if (afterNodes.length !== beforeNodes.length) {
    throw new Error(
      `DERIVE P3 violation: graph node count changed (${beforeNodes.length} -> ${afterNodes.length}).`
    );
  }
  afterNodes.forEach((an, i) => {
    const bn = beforeNodes[i] || {};
    const { status: _aStatus, ...aRest } = an || {};
    const { status: _bStatus, ...bRest } = bn;
    if (!deepEqual(aRest, bRest)) {
      throw new Error(
        `DERIVE P3 violation: graph node[${i}] changed a field other than "status".`
      );
    }
  });
}
