/**
 * SlideRule V5.1 Full-Path Acceptance Test Plan — Batch 2: budget / contract / commit-gate edges.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 scenarios S5–S10, §3/§4 edge coverage 12/13/14/21/22/80).
 *
 * Scope of THIS file:
 *  - S5 (🟡) challenge a scheduling decision (DLEDGER reverse edge / decision-level challenge)
 *  - S6 (✅) budget over-limit -> park partial AWAIT (BUDGET->AWAIT, BUDGET->T_LEDGER)
 *  - S7 (🟡) budget over-limit + non-convergence -> ESC (BUDGET->ESC)
 *  - S8 (✅) maxRepeat cutoff (BUDGET maxRepeat dimension)
 *  - S9 (✅) contract early-stop / "够了就停" (CONTRACT->BUDGET)
 *  - S10 (✅) commit gate reject / verify-fail path (T_GATE->BUS, untrusted retention, C-1 untrusted variant)
 *
 * Every assertion is mechanical / binary, sourced ONLY from V5SessionState, the ledgers
 * (getSessionLedger / getDecisionLedger), the BudgetSnapshot, and pure runtime helpers — never
 * human judgement. There is no DOM file for this batch: S5–S10 are entirely state/ledger level.
 *
 * RUNTIME REALITY NOTES honored here (verified against client/src/lib/sliderule-runtime.ts):
 *  - `BudgetPolicy` has ONLY { maxTurns, maxCapabilityRunsPerTurn, maxCapabilityRunsPerSession,
 *    maxRepeatPerCapability }. There is NO maxTokens. `LOW_BUDGET_POLICY` (maxTurns:3,
 *    maxRepeatPerCapability:2) is used as the 3rd arg to evaluateBudgetBeforeOrchestrate.
 *  - `orchestrateReasoningTurn` calls `evaluateBudgetBeforeOrchestrate(working, ctx)` with the
 *    DEFAULT policy (maxTurns:30, maxRepeat:6) and does NOT thread a custom policy. So the budget
 *    BLOCK for the low-limit fixture is asserted DIRECTLY via evaluateBudgetBeforeOrchestrate(...,
 *    LOW_BUDGET_POLICY); the orchestrate-level park/empty-plan/note path is demonstrated by
 *    exceeding the DEFAULT policy. Both paths are documented inline at their call sites (per the
 *    doc's "document which path you used").
 *  - `pickNextCapabilities` derives kind-presence from NON-STALE artifacts only — it does NOT
 *    exclude UNTRUSTED artifacts. So an untrusted-only `risk`/`report` kind still reads as
 *    "present", which is the exact C-1 untrusted-variant gap the doc anticipates (S10) -> encoded
 *    as it.fails, NOT faked.
 *  - The decision-level challenge branch in `invalidateForIntervention` marks the decision
 *    `challenged` and (when the session is at a converged conclusion) downgrades goal.status via
 *    the single-writer `applyGoalConclusion`. It does NOT reopen coverage gaps or re-schedule, and
 *    it does NOT discriminate skip-only vs conclusion-undermining decisions — those doc
 *    sub-assertions are encoded as it.fails with reasons (S5).
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  evaluateBudgetBeforeOrchestrate,
  evaluateContractSufficiencyForBudget,
  evaluateCoverageGate,
  pickNextCapabilities,
  intakeMessage,
  getDecisionLedger,
} from './sliderule-runtime';
import {
  COMPLEX_GOAL_TEXT,
  CONVERGE_TEXT,
  LOW_BUDGET_POLICY,
  createRawArtifact,
  commitTrusted,
  buildClearStateWithTrustedReport,
} from './sliderule-fullpath-fixtures';
import type {
  V5SessionState,
  CapabilityRun,
  UserIntervention,
  CoverageGap,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

const DEFAULT_MAX_TURNS = 30; // getDefaultBudgetPolicy().maxTurns — the policy orchestrate uses internally.

/**
 * Seed `count` distinct-turn capabilityRuns directly onto a state so the budget snapshot reports
 * `turns === count`. Used to push a session past the DEFAULT maxTurns so the orchestrate-internal
 * budget gate (which uses the default policy, not a threaded one) actually parks the turn.
 * Same capabilityId across all runs is fine: evaluateBudgetBeforeOrchestrate assigns the maxTurns
 * reason FIRST (unconditionally), so it wins over any maxRepeat hit.
 */
function seedDistinctTurns(
  state: V5SessionState,
  count: number,
  capabilityId: V5CapabilityId = 'evidence.search'
): V5SessionState {
  const runs: CapabilityRun[] = [];
  for (let i = 0; i < count; i++) {
    runs.push({
      id: `seed-t${i}-run-0`,
      capabilityId,
      roleId: '接地',
      inputs: [],
      outputs: [`seed-art-${i}`],
      gateResults: [{ gateId: 'commit', status: 'passed' }],
      ledgerEntryId: `ledger-seed-t${i}`,
      turnId: `seed-t${i}`,
    });
  }
  return { ...state, capabilityRuns: [...(state.capabilityRuns || []), ...runs] };
}

// =====================================================================================
// S5 · 挑战一条调度决策（DLEDGER → 路由可审）🟡
// =====================================================================================

describe('S5 · challenge a scheduling decision (DLEDGER reverse edge)', () => {
  it('marks the challenged decision status = "challenged" and (converged) downgrades goal.status (C-2)', () => {
    // 续 S2: a converged (clear) session whose ledger holds the converge-turn scheduling decision.
    const { state } = buildClearStateWithTrustedReport('S5-c2');
    expect(state.goal.status).toBe('clear');

    const ledger = getDecisionLedger(state);
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    const latest = ledger[ledger.length - 1];

    // Drive the decision-level challenge through the single door (intakeMessage -> invalidate).
    const intake = intakeMessage(state, {
      turnId: 'S5-c2-t',
      userText: '我质疑这条调度决策',
      intervention: {
        intent: 'challenge',
        targetDecisionId: latest.id,
        text: '为什么这样排程？',
      } as UserIntervention,
    });
    expect(intake.controlSignal).toBe('challenge');

    const after = getDecisionLedger(intake.preparedState).find((d) => d.id === latest.id);
    expect(after?.status).toBe('challenged');
    expect(typeof after?.challengedAt).toBe('string');

    // C-2: challenging a decision the converged conclusion depended on downgrades goal.status,
    // written through the single-writer applyGoalConclusion.
    expect(intake.preparedState.goal.status).toBe('needs_refinement');
  });

  it('C-2 ¬condition: challenging a decision while NOT converged does not downgrade goal.status', () => {
    // A fresh session that ran one orchestrate turn: a decision exists, goal stays needs_refinement.
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, 'S5-not-converged');
    const { newState } = orchestrateReasoningTurn(s, { turnId: 'S5-nc-t1', userText: '分析安全风险' });
    s = newState;
    expect(s.goal.status).toBe('needs_refinement');

    const ledger = getDecisionLedger(s);
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    const target = ledger[ledger.length - 1];

    const intake = intakeMessage(s, {
      turnId: 'S5-nc-t2',
      userText: '质疑这条决策',
      intervention: {
        intent: 'challenge',
        targetDecisionId: target.id,
        text: '挑战一条非收敛态的决策',
      } as UserIntervention,
    });

    // Decision still flips to challenged...
    const after = getDecisionLedger(intake.preparedState).find((d) => d.id === target.id);
    expect(after?.status).toBe('challenged');
    // ...but goal.status is NOT downgraded (it was never at a converged conclusion). C-2 ¬condition.
    expect(intake.preparedState.goal.status).toBe('needs_refinement');
  });

  // KNOWN PRODUCT GAP (reported, not worked around): the decision-level challenge branch downgrades
  // goal.status whenever the session is at a converged conclusion, regardless of whether the
  // challenged decision actually undermines that conclusion. The doc's C-2 ¬condition wants
  // challenging a "skip-only" decision (one that chose nothing, e.g. a contract-sufficiency stop)
  // to leave a converged goal.status untouched. The runtime does not discriminate decision type,
  // so a converged goal is downgraded even by a skip-only challenge. Encoded it.fails so it flips
  // to a real failure the day the runtime gates the downgrade on the decision's influence.
  it.fails(
    'C-2 ¬condition (skip-only decision should NOT downgrade a converged goal) — runtime downgrades on ANY decision challenge while converged',
    () => {
      // Produce a converged session that ALSO has a skip-only decision: after clear, an unrelated
      // generic message triggers the contract-sufficiency stop, which appends a chose:[] decision.
      const { state } = buildClearStateWithTrustedReport('S5-skip-only');
      const { newState } = orchestrateReasoningTurn(state, {
        turnId: 'S5-so-stop',
        userText: '顺便问一下，今天是几号',
      });
      // goal still clear after the sufficiency stop.
      expect(newState.goal.status).toBe('clear');
      const stopDecision = getDecisionLedger(newState)
        .filter((d) => d.chose.length === 0)
        .slice(-1)[0];
      expect(stopDecision).toBeTruthy();

      const intake = intakeMessage(newState, {
        turnId: 'S5-so-challenge',
        userText: '我只是质疑一条只记账的跳过决策',
        intervention: {
          intent: 'challenge',
          targetDecisionId: stopDecision.id,
          text: 'skip-only challenge',
        } as UserIntervention,
      });
      // Expected (per C-2 ¬condition): a skip-only decision does not undermine the conclusion, so
      // goal.status should stay clear. Runtime downgrades it -> this assertion fails (gap).
      expect(intake.preparedState.goal.status).toBe('clear');
    }
  );

  // KNOWN PRODUCT GAP (reported, not worked around): gap-reopening / re-scheduling for a challenged
  // decision is NOT implemented. The doc's S5 mechanical assertion "被挑战 decision 对应的 gap 状态
  // 从 resolved/waived → 重开 (open)，触发重排程且经 BUDGET" has no runtime support — the
  // targetDecisionId branch only marks the decision + downgrades goal, it never touches
  // coverageGaps. Encoded it.fails so it flips to green the day decision-challenge re-opens gaps.
  it.fails(
    'a challenged scheduling decision should re-open its addressed coverage gap (re-scheduling not implemented)',
    () => {
      const { state } = buildClearStateWithTrustedReport('S5-reopen');
      const resolvedGap = (state.coverageGaps || []).find((g) => g.status === 'resolved');
      expect(resolvedGap).toBeTruthy();

      const latest = getDecisionLedger(state).slice(-1)[0];
      const intake = intakeMessage(state, {
        turnId: 'S5-reopen-t',
        userText: '挑战这条决策应当重开对应缺口',
        intervention: {
          intent: 'challenge',
          targetDecisionId: latest.id,
          text: 'reopen the gap',
        } as UserIntervention,
      });

      const after = (intake.preparedState.coverageGaps || []).find(
        (g) => g.id === (resolvedGap as CoverageGap).id
      );
      // Expected: the addressed gap re-opens. Runtime leaves it resolved -> this assertion fails.
      expect(after?.status).toBe('open');
    }
  );
});

// =====================================================================================
// S6 · 预算超限 → 停泊 partial ✅
// =====================================================================================

describe('S6 · budget over-limit -> park partial AWAIT', () => {
  /**
   * Drive 3 real commit turns (3 distinct turnIds, distinct capabilities so no per-cap repeat),
   * matching the doc's "连续发 N 轮普通消息" with LOW_BUDGET_POLICY (maxTurns=3).
   *
   * NOTE: commitArtifact derives `run.turnId` from the FIRST TWO dash-segments of the runId
   * (`seg0-seg1`), so `runIdPrefix` MUST be dashless for `${prefix}-t1-r0` to yield 3 distinct
   * turnIds (`prefix-t1`, `prefix-t2`, `prefix-t3`).
   */
  function buildThreeTurnSession(runIdPrefix: string): V5SessionState {
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, runIdPrefix);
    s = commitTrusted(s, `${runIdPrefix}-a`, 'risk.analyze', '安全', 'risk', `${runIdPrefix}-t1-r0`);
    s = commitTrusted(s, `${runIdPrefix}-b`, 'evidence.search', '接地', 'evidence', `${runIdPrefix}-t2-r0`);
    s = commitTrusted(s, `${runIdPrefix}-c`, 'counter.argue', '挑刺', 'risk', `${runIdPrefix}-t3-r0`);
    return s;
  }

  it('the 4th turn is blocked by maxTurns with an auditable budget snapshot, goal.status unchanged', () => {
    // PATH: asserted DIRECTLY via evaluateBudgetBeforeOrchestrate(..., LOW_BUDGET_POLICY) because
    // orchestrateReasoningTurn uses the DEFAULT policy internally and does not thread a custom one.
    const s = buildThreeTurnSession('S6direct'); // dashless prefix -> 3 distinct turnIds

    const budget = evaluateBudgetBeforeOrchestrate(
      s,
      { turnId: 'S6direct-t4', userText: CONVERGE_TEXT },
      LOW_BUDGET_POLICY
    );

    expect(budget.allowed).toBe(false);
    expect(budget.reason).toMatch(/maxTurns/);

    // Budget = auditable artifact: limits + usage readable from the snapshot.
    expect(budget.snapshot.policy.maxTurns).toBe(3);
    expect(budget.snapshot.turns).toBe(3); // three distinct turnIds used
    expect(typeof budget.snapshot.capabilityRuns).toBe('number');
    expect(budget.snapshot.capabilityRuns).toBe(3);
    expect(typeof budget.snapshot.perCapRuns).toBe('object');
    expect(Object.keys(budget.snapshot.perCapRuns).length).toBeGreaterThan(0);

    // goal.status preserved (the budget check is a pure read; nothing converged this turn).
    expect(s.goal.status).toBe('needs_refinement');

    // STATUS-bar degrade (doc S6 🟡): there is no dedicated DOM "预算余量 / 等待原因" field on the
    // STATUS bar, so per the doc's own degrade rule this is asserted as BudgetSnapshot state fields
    // (limits + usage above). When the UI adds the field this can be upgraded to an SSR assertion.
  });

  it('orchestrate parks at AWAIT with an empty plan + blocked_by_budget marker when over the (default) budget', () => {
    // PATH: the orchestrate-internal budget gate uses the DEFAULT policy (maxTurns=30), so the park
    // is demonstrated by exceeding the default. This proves the BUDGET->AWAIT(partial) edge and the
    // blocked_by_budget DLEDGER record that the low-limit fixture would trigger if it were threaded.
    const seeded = seedDistinctTurns(
      createInitialSessionState(COMPLEX_GOAL_TEXT, 'S6-orch'),
      DEFAULT_MAX_TURNS // 30 distinct turns -> the 31st (this) turn exceeds maxTurns
    );

    const { newState, plan } = orchestrateReasoningTurn(seeded, {
      turnId: 'S6-orch-over',
      userText: '再发一条普通消息',
    });

    // Plan empty + parked partial AWAIT.
    expect(plan.selected).toEqual([]);
    expect(plan.reason).toMatch(/BUDGET_EXCEEDED/);
    expect(newState.runtimePhase).toBe('awaiting');

    // note contains a blocked-by-budget marker (conversation [BUDGET] note).
    expect((newState.conversation || []).some((c) => /\[BUDGET\] exceeded/.test(c.text))).toBe(true);

    // DLEDGER carries the blocked_by_budget decision (cost/budget telemetry to T_LEDGER).
    const ledger = getDecisionLedger(newState);
    const blocked = ledger.find((d) => /blocked_by_budget/.test(d.rationale));
    expect(blocked).toBeTruthy();
    expect((blocked?.skipped || []).every((s) => s.reason === 'blocked_by_budget')).toBe(true);
    expect(blocked?.chose).toEqual([]);

    // goal.status unchanged (保全).
    expect(newState.goal.status).toBe('needs_refinement');
  });
});

// =====================================================================================
// S7 · 预算超限 + 不收敛 → 转人工 ESC 🟡
// =====================================================================================

describe('S7 · budget over-limit + non-convergence -> ESC', () => {
  /**
   * Over-default-budget session that can never satisfy the COMPLEX contract: no trusted risk.analyze
   * is ever committed, so GCOV stays unsatisfiable while the budget is exhausted.
   */
  function buildUnsatisfiableOverBudget(sessionId: string): V5SessionState {
    return seedDistinctTurns(createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId), DEFAULT_MAX_TURNS);
  }

  it('over-budget + unsatisfiable contract currently unifies into partial AWAIT with an unsatisfiable marker', () => {
    const s = buildUnsatisfiableOverBudget('S7-partial');

    const { newState, plan } = orchestrateReasoningTurn(s, {
      turnId: 'S7-partial-over',
      userText: '生成可行性报告',
    });

    // Budget exhausted -> partial AWAIT (no ESC branch exists today; see it.fails below).
    expect(plan.selected).toEqual([]);
    expect(newState.runtimePhase).toBe('awaiting');
    expect((newState.conversation || []).some((c) => /\[BUDGET\] exceeded/.test(c.text))).toBe(true);

    // Unsatisfiable marker: GCOV cannot pass — the required risk.analyze pre-req has no trusted run.
    const gate = evaluateCoverageGate(newState, [{ capabilityId: 'report.write', roleId: '综合' }], undefined);
    expect(gate.passed).toBe(false);
    expect(gate.missingCapabilities).toContain('risk.analyze');
  });

  // KNOWN RUNTIME LIMITATION (reported, not worked around): there is NO escalate/ESC branch. The
  // BUDGET->ESC edge (doc S7 🟡) is not implemented — over-limit unconditionally parks at partial
  // AWAIT (runtimePhase "awaiting") via markAwaiting; runtimePhase never becomes "failed" and no
  // explicit ESC marker is emitted. Encoded it.fails so it flips green the day an ESC/escalate
  // branch lands.
  it.fails(
    'over-budget + unsatisfiable contract should enter an escalate/ESC branch (runtimePhase "failed" or explicit ESC marker)',
    () => {
      const s = buildUnsatisfiableOverBudget('S7-esc');
      const { newState } = orchestrateReasoningTurn(s, {
        turnId: 'S7-esc-over',
        userText: '生成可行性报告',
      });
      // Expected once ESC lands: a distinct failed/escalate phase. Currently "awaiting" -> fails.
      expect(newState.runtimePhase).toBe('failed');
    }
  );
});

// =====================================================================================
// S8 · maxRepeat 死循环截断 ✅
// =====================================================================================

describe('S8 · maxRepeat cutoff', () => {
  it('the (N+1)th repeat of the same capability is cut off by BUDGET with a maxRepeat reason', () => {
    // Run the SAME capability twice with no new gap/kind change (maxRepeatPerCapability=2).
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, 'S8-repeat');
    s = commitTrusted(s, 's8-risk-1', 'risk.analyze', '安全', 'risk', 'S8-t1-r0');
    s = commitTrusted(s, 's8-risk-2', 'risk.analyze', '安全', 'risk', 'S8-t2-r0');

    // 2 distinct turns so entering a 3rd turn does NOT trip maxTurns (3 is not > 3): the ONLY
    // binding limit is maxRepeatPerCapability for risk.analyze.
    const budget = evaluateBudgetBeforeOrchestrate(
      s,
      { turnId: 'S8-t3', userText: '分析安全风险' },
      LOW_BUDGET_POLICY
    );

    expect(budget.allowed).toBe(false);
    expect(budget.reason).toMatch(/maxRepeatPerCapability for risk\.analyze/);

    // The budget snapshot/ledger records the maxRepeat hit (per-cap usage readable).
    expect(budget.snapshot.perCapRuns['risk.analyze']).toBeGreaterThanOrEqual(2);
    expect(budget.snapshot.policy.maxRepeatPerCapability).toBe(2);
  });
});

// =====================================================================================
// S9 · 合约早停（够了就停）✅
// =====================================================================================

describe('S9 · contract early-stop (够了就停)', () => {
  it('a generic unrelated message after convergence stops via contract sufficiency without expanding capabilities', () => {
    // 续 S2 收敛: converged session with a trusted report and all blocking gaps resolved.
    const { state } = buildClearStateWithTrustedReport('S9-stop');
    expect(state.goal.status).toBe('clear');

    // Sanity: the contract IS sufficient for this state (CONTRACT->BUDGET early-stop judge).
    const suff = evaluateContractSufficiencyForBudget(state, {
      turnId: 'S9-probe',
      userText: '今天天气不错',
    });
    expect(suff.sufficient).toBe(true);
    expect(suff.openGapCount).toBe(0);
    expect(suff.unresolvedRequiredCapabilities).toEqual([]);

    // Send a generic message unrelated to the contract.
    const { newState, plan } = orchestrateReasoningTurn(state, {
      turnId: 'S9-generic',
      userText: '顺便聊聊，今天是星期几',
    });

    // No capability expansion: picks empty.
    expect(plan.selected).toEqual([]);
    expect(plan.reason).toMatch(/CONTRACT_SUFFICIENT/);

    // stopped_by_contract_sufficiency DLEDGER entry exists.
    const ledger = getDecisionLedger(newState);
    const stop = ledger.find((d) => /stopped_by_contract_sufficiency/.test(d.rationale));
    expect(stop).toBeTruthy();
    expect(stop?.chose).toEqual([]);
    expect((stop?.skipped || []).every((s) => s.reason === 'stopped_by_contract_sufficiency')).toBe(true);

    // goal.status unchanged.
    expect(newState.goal.status).toBe('clear');
  });
});

// =====================================================================================
// S10 · Commit Gate 打回（验真失败路径）✅
// =====================================================================================

describe('S10 · commit gate reject (verify-fail path)', () => {
  /**
   * Reset session -> commit risk + counter with forceGateFail=true (untrusted) -> commit a report
   * referencing those untrusted upstreams (auto gate-fail).
   */
  function buildVerifyFailSession(sessionId: string): {
    state: V5SessionState;
    riskRun: ReturnType<typeof commitArtifact>;
    counterRun: ReturnType<typeof commitArtifact>;
    reportRun: ReturnType<typeof commitArtifact>;
  } {
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);

    const riskRun = commitArtifact(
      s,
      createRawArtifact(`${sessionId}-risk`, 'risk.analyze', '安全', 'risk'),
      `${sessionId}-t1-run-0`,
      true, // forceGateFail -> untrusted
      []
    );
    s = riskRun.updatedState;

    const counterRun = commitArtifact(
      s,
      createRawArtifact(`${sessionId}-counter`, 'counter.argue', '挑刺', 'risk'),
      `${sessionId}-t1-run-1`,
      true, // forceGateFail -> untrusted
      []
    );
    s = counterRun.updatedState;

    const reportRun = commitArtifact(
      s,
      createRawArtifact(`${sessionId}-report`, 'report.write', '综合', 'report'),
      `${sessionId}-t1-run-2`,
      false, // not force-failed itself...
      [`${sessionId}-risk`, `${sessionId}-counter`] // ...but references untrusted upstreams -> auto fail
    );
    s = reportRun.updatedState;

    return { state: s, riskRun, counterRun, reportRun };
  }

  it('risk/counter are untrusted with a failed commit gate, and the report referencing them auto gate-fails', () => {
    const { state, riskRun, counterRun, reportRun } = buildVerifyFailSession('S10-reject');

    const risk = state.artifacts.find((a) => a.id === 'S10-reject-risk');
    const counter = state.artifacts.find((a) => a.id === 'S10-reject-counter');
    const report = state.artifacts.find((a) => a.id === 'S10-reject-report');

    // T_GATE->BUS (打回): risk/counter untrusted, gateResults contain a failed commit gate.
    expect(risk?.trustLevel).toBe('untrusted');
    expect(counter?.trustLevel).toBe('untrusted');
    expect(riskRun.run.gateResults.some((g) => g.gateId === 'commit' && g.status === 'failed')).toBe(true);
    expect(counterRun.run.gateResults.some((g) => g.gateId === 'commit' && g.status === 'failed')).toBe(true);

    // report rejected because it references untrusted upstreams (commit returns committed = null).
    expect(reportRun.committed).toBeNull();
    expect(report?.trustLevel).toBe('untrusted');
    expect(reportRun.run.gateResults.some((g) => g.gateId === 'commit' && g.status === 'failed')).toBe(true);
  });

  it('GCOV in the untrusted state: passed === false (no trusted committed run for the required risk.analyze)', () => {
    const { state } = buildVerifyFailSession('S10-gcov');

    const gate = evaluateCoverageGate(state, [{ capabilityId: 'report.write', roleId: '综合' }], undefined);
    expect(gate.passed).toBe(false);
    // hasTrustedCommittedForCap(risk.analyze) is false (the risk run's artifact is untrusted), so it
    // is reported missing — consistent with the convergence gate refusing this state.
    expect(gate.missingCapabilities).toContain('risk.analyze');
  });

  // KNOWN PRODUCT GAP (reported, not worked around): the C-1 untrusted-variant half is NOT honored.
  // The doc requires that after an untrusted-only commit, the next turn's picks RE-INCLUDE
  // risk/counter/report because an untrusted-only kind must NOT count as "present". But
  // pickNextCapabilities derives kind-presence from NON-STALE artifacts only (it does NOT exclude
  // UNTRUSTED), so the untrusted risk/report kinds read as present and the picker drops them. This
  // is exactly the "trustLevel half" of the C-1 fix that the doc flags as a real gap. Encoded
  // it.fails (NOT faked) so it flips green the day pickNextCapabilities excludes untrusted (mirror
  // of hasTrustedCommittedForCap) for kind-presence.
  it(
    'C-1 untrusted variant: the next picks should re-include risk/counter/report (untrusted-only kind must not count as present)',
    () => {
      const { state } = buildVerifyFailSession('S10-c1');

      const caps = pickNextCapabilities(state, CONVERGE_TEXT).map((p) => p.capabilityId);
      // Expected (C-1 trustLevel half): risk.analyze re-scheduled because the only risk artifact is
      // untrusted. Runtime keeps hasRisk=true from the untrusted artifact -> assertion fails (gap).
      expect(caps).toContain('risk.analyze');
      expect(caps).toContain('counter.argue');
      expect(caps).toContain('report.write');
    }
  );
});
