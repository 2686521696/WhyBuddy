/**
 * Bug Condition Exploration Test — SlideRule Artifact-Health Predicate Unification
 * Spec: .kiro/specs/sliderule-artifact-health-predicate/ (Task 1, Property 1: Bug Condition)
 *
 * CRITICAL: These tests are written against UNFIXED code and are EXPECTED TO FAIL.
 * The failure confirms the bug: three call sites in `client/src/lib/sliderule-runtime.ts`
 * decide whether an artifact "counts" as present / usable for a (state, capability) using
 * INCONSISTENT rules:
 *
 *   | Call site                                   | Excludes stale? | Excludes untrusted? |
 *   | ------------------------------------------- | --------------- | ------------------- |
 *   | pickNextCapabilities kind-presence          | yes             | NO   (bug)          |
 *   | hasTrustedCommittedForCap (GCOV, correct)   | yes             | yes                 |
 *   | findInputsForCapability                     | NO   (bug)      | NO   (bug)          |
 *
 * DO NOT "fix" these tests or the production code here. They encode the EXPECTED behavior
 * (design Property 1 / isBugCondition) and will be re-run after the fix lands (Task 3.2),
 * where they MUST flip from FAIL -> PASS.
 *
 * Property 1 (design): For any input where the bug condition holds (isBugCondition === true —
 *   an artifact whose present/usable verdict differs across the three sites because it is
 *   untrusted (trustLevel ∉ {gated_pass, audited}) or stale (id ∈ staleArtifactIds)), the
 *   fixed runtime SHALL compute every site's present/usable verdict as
 *     isHealthyArtifact(artifact, staleSet) = (trustLevel ∈ {gated_pass, audited}) AND (id ∉ staleSet),
 *   so that:
 *     pickPresent'(state, artifact)  = isHealthyArtifact(...)   // untrusted/stale kind reads as absent -> re-scheduled
 *     gatedHealthy'(state, artifact) = isHealthyArtifact(...)   // unchanged (already correct)
 *     inputUsable'(state, artifact)  = isHealthyArtifact(...)   // stale/untrusted never selected as input
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createInitialSessionState,
  pickNextCapabilities,
  findInputsForCapability,
  commitArtifact,
  invalidateForIntervention,
} from './sliderule-runtime';
import {
  COMPLEX_GOAL_TEXT,
  CONVERGE_TEXT,
  createRawArtifact,
  buildClearStateWithTrustedReport,
  driveConvergeTurn,
} from './sliderule-fullpath-fixtures';
import type {
  V5SessionState,
  Artifact,
  UserIntervention,
} from '@shared/blueprint/v5-reasoning-state';

// ---- shared health rule (the canonical rule hasTrustedCommittedForCap already applies inline) ----

const TRUSTED = new Set<Artifact['trustLevel']>(['gated_pass', 'audited']);

/** isHealthyArtifact(artifact, staleSet) = trustLevel ∈ {gated_pass, audited} AND id ∉ staleSet. */
function isHealthy(
  artifact: { id: string; trustLevel: Artifact['trustLevel'] },
  staleSet: Set<string>
): boolean {
  return TRUSTED.has(artifact.trustLevel) && !staleSet.has(artifact.id);
}

// ---- single-`risk`-kind probe session: the candidate is the ONLY artifact of its kind ----

/**
 * Build a clean session whose only artifact is a single `risk`-kind artifact with the given
 * trustLevel and stale-set membership. `risk` is the kind exercised by S10/S4, and making it the
 * only artifact of its kind lets us read each site's verdict observably.
 */
function buildSingleRiskSession(
  trustLevel: Artifact['trustLevel'],
  stale: boolean
): { state: V5SessionState; riskId: string } {
  const riskId = 'probe-risk';
  const base = createInitialSessionState(COMPLEX_GOAL_TEXT, 'artifact-health-probe');
  const raw = createRawArtifact(riskId, 'risk.analyze', '安全', 'risk');
  const artifact: Artifact = { ...raw, trustLevel };
  return {
    state: {
      ...base,
      artifacts: [artifact],
      staleArtifactIds: stale ? [riskId] : [],
    },
    riskId,
  };
}

/**
 * pickPresent verdict for the probe `risk` kind: the kind reads as "present" iff the picker does
 * NOT re-schedule `risk.analyze`. (CONVERGE_TEXT triggers the report/gap-filling branch, which
 * pushes risk.analyze only when hasRisk is false.)
 */
function pickPresentRisk(state: V5SessionState): boolean {
  const caps = pickNextCapabilities(state, CONVERGE_TEXT).map((p) => p.capabilityId);
  return !caps.includes('risk.analyze');
}

/** inputUsable verdict for the probe risk: counter.argue needs a `risk` input. */
function inputUsableRisk(state: V5SessionState, riskId: string): boolean {
  return findInputsForCapability(state, 'counter.argue').includes(riskId);
}

// =====================================================================================
// Pinned case — Untrusted-only kind (S10 / Finding #2)
// Mirrors fullpath-budget.test.ts "C-1 untrusted variant" it.fails.
// =====================================================================================

describe('BUG: artifact-health disagreement — pickNextCapabilities counts UNTRUSTED kinds as present (S10, EXPECTED TO FAIL on unfixed code)', () => {
  /**
   * Reset session -> commit risk + counter with forceGateFail=true (untrusted) -> commit a report
   * referencing those untrusted upstreams (auto gate-fail). Same construction as the V5.1 S10 suite.
   */
  function buildVerifyFailSession(sessionId: string): V5SessionState {
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);
    s = commitArtifact(
      s,
      createRawArtifact(`${sessionId}-risk`, 'risk.analyze', '安全', 'risk'),
      `${sessionId}-t1-run-0`,
      true, // forceGateFail -> untrusted
      []
    ).updatedState;
    s = commitArtifact(
      s,
      createRawArtifact(`${sessionId}-counter`, 'counter.argue', '挑刺', 'risk'),
      `${sessionId}-t1-run-1`,
      true, // forceGateFail -> untrusted
      []
    ).updatedState;
    s = commitArtifact(
      s,
      createRawArtifact(`${sessionId}-report`, 'report.write', '综合', 'report'),
      `${sessionId}-t1-run-2`,
      false,
      [`${sessionId}-risk`, `${sessionId}-counter`] // references untrusted upstreams -> auto fail
    ).updatedState;
    return s;
  }

  it('next picks SHALL re-include risk.analyze / counter.argue / report.write when the only artifacts of those kinds are untrusted-only', () => {
    const state = buildVerifyFailSession('S10-c1-untrusted');

    // Sanity: the risk/report artifacts exist but are all untrusted.
    const untrusted = state.artifacts.filter((a) => a.trustLevel === 'untrusted');
    expect(untrusted.length).toBeGreaterThanOrEqual(2);

    const caps = pickNextCapabilities(state, CONVERGE_TEXT).map((p) => p.capabilityId);

    // EXPECTED (design Property 1, pickPresent' = isHealthyArtifact = false for untrusted):
    // an untrusted-only kind reads as ABSENT and is re-scheduled.
    // FAILS on unfixed code: existingKinds excludes stale only, so the untrusted risk/report
    // count as "present" and the picker drops them.
    expect(caps).toContain('risk.analyze');
    expect(caps).toContain('counter.argue');
    expect(caps).toContain('report.write');
  });
});

// =====================================================================================
// Pinned case — Stale upstream as input (S4 / Finding #1)
// Mirrors fullpath-core.test.ts "challenging an UPSTREAM risk" it.fails.
// =====================================================================================

describe('BUG: artifact-health disagreement — findInputsForCapability selects STALE/untrusted upstreams (S4, EXPECTED TO FAIL on unfixed code)', () => {
  it('findInputsForCapability SHALL NOT select a stale risk as an input', () => {
    const staleRiskId = 'stale-risk';
    const base = createInitialSessionState(COMPLEX_GOAL_TEXT, 'S4-stale-input');
    const raw = createRawArtifact(staleRiskId, 'risk.analyze', '安全', 'risk');
    const state: V5SessionState = {
      ...base,
      // Trusted-but-stale: the ONLY risk of the needed input kind is stale.
      artifacts: [{ ...raw, trustLevel: 'gated_pass' }],
      staleArtifactIds: [staleRiskId],
    };

    const inputs = findInputsForCapability(state, 'counter.argue'); // counter.argue needs a `risk` input

    // EXPECTED (design Property 1, inputUsable' = isHealthyArtifact = false for stale):
    // the stale upstream is never selected as an input.
    // FAILS on unfixed code: findInputsForCapability excludes neither stale nor untrusted, so it
    // grabs the stale risk.
    expect(inputs).not.toContain(staleRiskId);
  });

  it('reconverging after challenging an UPSTREAM risk SHALL produce a fresh trusted report (integration mirror of S4 it.fails)', () => {
    const { state, riskId } = buildClearStateWithTrustedReport('S4-upstream-explore');
    const challenged = invalidateForIntervention(state, {
      targetArtifactId: riskId,
      intent: 'challenge',
      text: '请重新评估风险并生成最终报告',
    } as UserIntervention);

    const reconverged = driveConvergeTurn(challenged, 'S4-uf-explore', '请基于现有证据重新生成最终报告');
    const stales = new Set(reconverged.staleArtifactIds || []);
    const freshReports = reconverged.artifacts.filter(
      (a) =>
        a.kind === 'report' &&
        a.producedBy?.capabilityId === 'report.write' &&
        TRUSTED.has(a.trustLevel) &&
        !stales.has(a.id)
    );

    // EXPECTED: a fresh trusted report is produced because input resolution selects only healthy
    // upstreams. FAILS on unfixed code: findInputsForCapability grabs the leftover stale risk, so
    // the reconverged report auto gate-fails (untrusted upstream) and there is no fresh trusted report.
    expect(freshReports.length).toBeGreaterThan(0);
  });
});

// =====================================================================================
// Three-site disagreement — Property 1 over the bug-condition domain (scoped PBT)
// =====================================================================================

describe('BUG: three sites DISAGREE on artifact health under the bug condition (Property 1, EXPECTED TO FAIL on unfixed code)', () => {
  it('untrusted, non-stale artifact: the three verdicts disagree on UNFIXED code (pickPresent=true, gatedHealthy=false, inputUsable=true)', () => {
    const { state, riskId } = buildSingleRiskSession('untrusted', false);
    const staleSet = new Set(state.staleArtifactIds);
    const artifact = state.artifacts[0];
    const healthy = isHealthy(artifact, staleSet); // false (untrusted)

    // Observed disagreement on UNFIXED code (documented counterexample):
    //   pickPresent = true (untrusted counts as present), gatedHealthy = false, inputUsable = true.
    // EXPECTED (design Property 1): all three SHALL equal isHealthyArtifact = false.
    expect(pickPresentRisk(state)).toBe(healthy); // FAILS: pickPresent = true ≠ false
    expect(isHealthy(artifact, staleSet)).toBe(healthy); // gatedHealthy already correct
    expect(inputUsableRisk(state, riskId)).toBe(healthy); // FAILS: inputUsable = true ≠ false
  });

  it('trusted-but-stale artifact: input resolution disagrees on UNFIXED code (inputUsable=true while the other two exclude it)', () => {
    const { state, riskId } = buildSingleRiskSession('gated_pass', true);
    const staleSet = new Set(state.staleArtifactIds);
    const artifact = state.artifacts[0];
    const healthy = isHealthy(artifact, staleSet); // false (stale)

    expect(pickPresentRisk(state)).toBe(healthy); // already false (stale excluded)
    expect(isHealthy(artifact, staleSet)).toBe(healthy);
    expect(inputUsableRisk(state, riskId)).toBe(healthy); // FAILS: inputUsable = true ≠ false
  });

  it('PROPERTY: for all artifacts where the bug condition holds, all three sites SHALL equal isHealthyArtifact', () => {
    const trustArb = fc.constantFrom<Artifact['trustLevel']>('untrusted', 'gated_pass', 'audited');
    const staleArb = fc.boolean();

    fc.assert(
      fc.property(trustArb, staleArb, (trustLevel, stale) => {
        const { state, riskId } = buildSingleRiskSession(trustLevel, stale);
        const artifact = state.artifacts[0];

        // The three sites' verdicts as defined formally in the spec's isBugCondition.
        const pickPresentFormal = !stale; // pickNextCapabilities: stale-only exclusion
        const gatedHealthyFormal = TRUSTED.has(trustLevel) && !stale; // correct rule
        const inputUsableFormal = true; // findInputsForCapability: excludes neither

        // Scope to the bug condition: the three formal verdicts are NOT all equal.
        const isBugCondition = !(
          pickPresentFormal === gatedHealthyFormal && gatedHealthyFormal === inputUsableFormal
        );
        fc.pre(isBugCondition);

        const staleSet = new Set(state.staleArtifactIds);
        const healthy = isHealthy(artifact, staleSet);

        // EXPECTED (design Property 1) — FAILS on unfixed code for every bug-condition input.
        expect(pickPresentRisk(state)).toBe(healthy);
        expect(isHealthy(artifact, staleSet)).toBe(healthy);
        expect(inputUsableRisk(state, riskId)).toBe(healthy);
      }),
      { numRuns: 200 }
    );
  });

  it('EDGE (non-bug): a healthy gated_pass non-stale artifact already has all three verdicts true on UNFIXED code', () => {
    const { state, riskId } = buildSingleRiskSession('gated_pass', false);
    const staleSet = new Set(state.staleArtifactIds);
    const artifact = state.artifacts[0];

    // Confirms the bug is specific to untrusted/stale: healthy artifacts already agree (this passes
    // on unfixed code and documents the preserved baseline).
    expect(pickPresentRisk(state)).toBe(true);
    expect(isHealthy(artifact, staleSet)).toBe(true);
    expect(inputUsableRisk(state, riskId)).toBe(true);
  });
});
