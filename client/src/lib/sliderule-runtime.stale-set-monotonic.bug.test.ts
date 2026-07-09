/**
 * Bug Condition Exploration Test — SlideRule V5.1 Stale-Set Monotonicity
 * Spec: .kiro/specs/sliderule-stale-set-monotonic/ (Task 1, Property 1: Bug Condition)
 *
 * CRITICAL: These tests are written against UNFIXED code and are EXPECTED TO FAIL.
 * The failure confirms the bug: `invalidateForIntervention` overwrites the session's stale
 * set with ONLY the freshly-computed cascade (`staleArtifactIds = Array.from(affected)`),
 * silently un-staling any artifact that an earlier challenge had staled but that the new
 * cascade does not re-cover.
 *
 * DO NOT "fix" these tests or the production code here. They encode the EXPECTED behavior
 * (design Property 1 / isBugCondition) and will be re-run after the fix lands (Task 3.2),
 * where they MUST flip from FAIL -> PASS.
 *
 * Property 1 (design): For any input where the bug condition holds (isBugCondition === true —
 *   a challenge with a defined cascade target applied to a session whose prior
 *   `staleArtifactIds` is non-empty and NOT a subset of the new cascade), the fixed
 *   `invalidateForIntervention` SHALL set the resulting `staleArtifactIds` to the UNION of the
 *   prior `state.staleArtifactIds` and the new cascade, so that
 *     result.staleArtifactIds ⊇ state.staleArtifactIds AND result.staleArtifactIds ⊇ cascade.
 *   No previously-stale id is dropped by a later challenge.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createInitialSessionState, invalidateForIntervention } from './sliderule-runtime';
import type {
  V5SessionState,
  Artifact,
  DependencyEdge,
  UserIntervention,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

// ---- helpers ----------------------------------------------------------------

/** A fully-formed, trusted artifact (so graph-node marking + C-2 checks never throw). */
function makeArtifact(id: string, kind: Artifact['kind'], cap: V5CapabilityId): Artifact {
  return {
    id,
    kind,
    provenance: 'ai_generated',
    trustLevel: 'gated_pass',
    producedBy: {
      capabilityRunId: `run-${id}`,
      capabilityId: cap,
      roleId: '综合',
    },
    passedGates: ['commit'],
    title: `artifact ${id}`,
    summary: `artifact ${id}`,
    content: `artifact ${id}`,
  };
}

/** Mirror of the cascade closure inside `invalidateForIntervention` (edges: from=input → to=output). */
function computeCascade(targetId: string, deps: DependencyEdge[]): Set<string> {
  const affected = new Set<string>([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of deps) {
      if (affected.has(e.fromArtifactId) && !affected.has(e.toArtifactId)) {
        affected.add(e.toArtifactId);
        changed = true;
      }
    }
  }
  return affected;
}

const isSubset = (a: Set<string>, b: Set<string>): boolean =>
  [...a].every((x) => b.has(x));

/**
 * Construct a session whose `staleArtifactIds` is already non-empty (simulating an earlier
 * challenge) with an explicit dependency graph and artifact set. Non-converged on purpose so
 * the stale-set semantics are isolated from the C-2 conclusion downgrade.
 */
function buildSession(opts: {
  staleIds: string[];
  deps: DependencyEdge[];
  artifactIds: string[];
}): V5SessionState {
  const base = createInitialSessionState(
    '分析权限系统的风险并给出最终报告',
    'stale-monotonic-test'
  );
  const artifacts = opts.artifactIds.map((id, i) =>
    i % 2 === 0
      ? makeArtifact(id, 'risk', 'risk.analyze')
      : makeArtifact(id, 'report', 'report.write')
  );
  return {
    ...base,
    goal: { ...base.goal, status: 'needs_refinement' },
    artifacts,
    graph: { ...base.graph, nodes: [] },
    dependencyGraph: opts.deps,
    staleArtifactIds: [...opts.staleIds],
  };
}

// =====================================================================================
// Concrete failing seeds (deterministic, reproducible counterexamples)
// =====================================================================================

describe('BUG: SlideRule stale set is NOT monotonic across challenges (Property 1, exploration — EXPECTED TO FAIL on unfixed code)', () => {
  it('S4 "两圈半" core: prior {risk_A, report_A}, second challenge cascade {risk_B, report_B} => prior must be preserved', () => {
    // Loop-1 already staled risk_A + report_A. Reconverged with a new lineage (risk_B → report_B).
    const deps: DependencyEdge[] = [
      { fromArtifactId: 'risk_A', toArtifactId: 'report_A', reason: 'report depends on risk (loop 1)' },
      { fromArtifactId: 'risk_B', toArtifactId: 'report_B', reason: 'report depends on risk (loop 2)' },
    ];
    const state = buildSession({
      staleIds: ['risk_A', 'report_A'],
      deps,
      artifactIds: ['risk_A', 'report_A', 'risk_B', 'report_B'],
    });

    // Challenge loop-2's risk → cascade closes over {risk_B, report_B}.
    const cascade = computeCascade('risk_B', deps);
    expect([...cascade].sort()).toEqual(['report_B', 'risk_B']);

    const result = invalidateForIntervention(state, {
      targetArtifactId: 'risk_B',
      intent: 'challenge',
      text: '我质疑第二圈的风险分析',
    } as UserIntervention);

    const resultSet = new Set(result.staleArtifactIds);

    // EXPECTED (design Property 1) — FAILS on unfixed code (overwrites to {risk_B, report_B}).
    // result must be a superset of the prior stale set...
    expect(resultSet.has('risk_A')).toBe(true);
    expect(resultSet.has('report_A')).toBe(true);
    // ...and of the new cascade.
    expect(resultSet.has('risk_B')).toBe(true);
    expect(resultSet.has('report_B')).toBe(true);
  });

  it('Unrelated-lineage challenge: prior {x}, new challenge cascade {y} => x must remain stale', () => {
    const deps: DependencyEdge[] = []; // y has no dependents → cascade is just {y}
    const state = buildSession({
      staleIds: ['x'],
      deps,
      artifactIds: ['x', 'y'],
    });

    const cascade = computeCascade('y', deps);
    expect([...cascade]).toEqual(['y']);

    const result = invalidateForIntervention(state, {
      targetArtifactId: 'y',
      intent: 'challenge',
      text: '我质疑这条无关产物',
    } as UserIntervention);

    const resultSet = new Set(result.staleArtifactIds);

    // EXPECTED — FAILS on unfixed code (overwrites to {y}, dropping x).
    expect(resultSet.has('x')).toBe(true);
    expect(resultSet.has('y')).toBe(true);
  });

  // ===================================================================================
  // Property over the bug-condition domain (scoped PBT, fc.pre-filtered)
  // ===================================================================================

  it('PROPERTY: for all challenges where the bug condition holds, result.staleArtifactIds ⊇ prior AND ⊇ cascade', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const edgeArb = fc.record({
      fromArtifactId: fc.constantFrom(...pool),
      toArtifactId: fc.constantFrom(...pool),
    });

    fc.assert(
      fc.property(
        fc.array(edgeArb, { maxLength: 8 }),
        fc.subarray(pool, { minLength: 1 }), // prior stale set is non-empty
        fc.constantFrom(...pool), // challenge target (always defined)
        (rawEdges, prior, target) => {
          const deps: DependencyEdge[] = rawEdges
            .filter((e) => e.fromArtifactId !== e.toArtifactId)
            .map((e) => ({ ...e, reason: 'test edge' }));

          const cascade = computeCascade(target, deps);
          const priorSet = new Set(prior);

          // Scope to the bug condition: target IS DEFINED (always here) AND prior IS NON-EMPTY
          // (minLength 1) AND NOT isSubset(prior, cascade) — some prior id would be dropped.
          fc.pre(!isSubset(priorSet, cascade));

          const state = buildSession({ staleIds: prior, deps, artifactIds: pool });
          const result = invalidateForIntervention(state, {
            targetArtifactId: target,
            intent: 'challenge',
            text: '质疑',
          } as UserIntervention);

          const resultSet = new Set(result.staleArtifactIds);

          // EXPECTED (design Property 1) — FAILS on unfixed code for every bug-condition input.
          for (const id of priorSet) {
            expect(resultSet.has(id)).toBe(true);
          }
          for (const id of cascade) {
            expect(resultSet.has(id)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
