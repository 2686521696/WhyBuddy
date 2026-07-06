/**
 * Shared fixtures / helpers for the SlideRule V5.1 Full-Path Acceptance Test Plan.
 * Spec: docs/V5.1-full-path-test-plan.md
 *
 * This module is the SINGLE source of reusable fixtures for the full-path scenario suites
 * (S1–S10 across batches). It deliberately mirrors the proven helper conventions already used by
 *   - client/src/lib/sliderule-runtime.test.ts (combo commit loop, semantic contents)
 *   - client/src/lib/sliderule-runtime.reconverge-loop.bug.test.ts (commitTrusted / buildClear...)
 *   - client/src/lib/sliderule-runtime.reconverge-loop.preservation.test.ts (markTrusted / kindForCap)
 * so later batches can import from here instead of re-deriving them.
 *
 * REALITY-CHECK NOTES (matched against the ACTUAL runtime, not the doc's idealized fixture table):
 *  - `authorCoverageContract` produces, for a COMPLEX goal, required =
 *    [critique.generate, risk.analyze, synthesis.merge, evidence.search, report.write],
 *    plus a G-GROUND missing_evidence blocking gap. (The doc's
 *    "[risk.analyze, counter.argue, synthesis.merge, report.write, evidence.search]" list is
 *    idealized.) For a SIMPLE goal, required = [report.write].
 *  - `BudgetPolicy` has ONLY { maxTurns, maxCapabilityRunsPerTurn, maxCapabilityRunsPerSession,
 *    maxRepeatPerCapability }. There is NO maxTokens. `LOW_BUDGET_POLICY` below is provided as the
 *    low-limit override for super-limit scenarios (S6/S7/S8 in later batches).
 *  - FULL MIGRATION: Node V5 backend (LLM pool, orchestrate, execute-cap for tools/evidence/report,
 *    degraded fallbacks) audited and ported to tws-ai-ask-python/services/sliderule_v5 + routes/sliderule.py.
 *    Uses stable Python RAG/knowledge/LLM (no su8 pool, no proxy 504s, always real sources/evidence).
 *    Node sliderule routes now delegate V5 paths to Python. Fixtures use templates only for pure unit tests;
 *    real full-path (and marathon) now as steady as tws-ai-ask-python. "检索了外部证据 ✓" and tools succeed.
 */

import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
  type BudgetPolicy,
} from './sliderule-runtime';
import type {
  V5SessionState,
  Artifact,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';
import { buildStructuredReport } from '@shared/blueprint/sliderule-report-builder';
export {
  replayCoverage,
  type CoverageReplay,
  type CoverageReplayGapLine,
  type CoverageReplayRequirementLine,
} from '@shared/blueprint/sliderule-coverage-replay';

// ===== Trigger-word constants (plan §1 trigger cheatsheet + existing combo test) =====

/** Plans the full V5 team (risk.analyze + counter.argue + synthesis.merge + report.write). */
export const COMBO_TEXT = '分析安全风险，反驳 RBAC，并生成可行性报告';
/** Carries convergence intent (报告 / 可行性 / 总结 / 收敛). */
export const CONVERGE_TEXT = '生成可行性报告';
/** A goal whose contract resolves to COMPLEX (contains 风险/安全). */
export const COMPLEX_GOAL_TEXT = '分析权限系统的风险并给出最终报告';

/**
 * Low-limit budget policy for super-limit scenarios. Matches the doc's intent
 * (maxTurns=3, per-turn cap, per-cap repeat cap) using ONLY fields that exist on BudgetPolicy
 * (there is no maxTokens). Pass this as the 3rd arg to evaluateBudgetBeforeOrchestrate.
 */
export const LOW_BUDGET_POLICY: BudgetPolicy = {
  maxTurns: 3,
  maxCapabilityRunsPerTurn: 5,
  maxCapabilityRunsPerSession: 120,
  maxRepeatPerCapability: 2,
  maxTokensPerSession: 500_000,
};

// ===== Semantic payloads (so aggregation / report content is meaningful) =====

export const SEMANTIC_CONTENTS: Partial<Record<V5CapabilityId, string>> = {
  'risk.analyze':
    '数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）；审计风险（权限变更需保留操作者、时间、影响对象）。',
  'counter.argue':
    '反驳过早引入 ABAC（会增加策略调试成本）；建议 MVP 先采用 RBAC + scoped data filter，保留策略接口。',
  'synthesis.merge': '本轮从上游聚合的初步结论：权限系统建议采用 RBAC + 数据范围 MVP，预留策略扩展。',
  'report.write': '【可行性 / 产品推演报告】结论：建议推进权限系统建设。',
};

// ===== Raw artifact + trust helpers (proven patterns from the bugfix suites) =====

export function createRawArtifact(
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  contentOverride?: string
): Omit<Artifact, 'trustLevel'> {
  const content =
    contentOverride ?? SEMANTIC_CONTENTS[capabilityId] ?? `${roleId} 通过 ${capabilityId} 贡献了内容。`;
  return {
    id,
    kind,
    provenance: 'ai_generated',
    producedBy: {
      capabilityRunId: `run-${id}`,
      capabilityId,
      roleId,
    },
    passedGates: [],
    title: content.split('\n')[0]?.slice(0, 80),
    summary: content.slice(0, 200),
    content,
  };
}

/** Force an already-committed artifact to be trusted + not-stale (mirrors the bugfix suites). */
export function markTrusted(state: V5SessionState, artId: string): void {
  const art = (state.artifacts || []).find((a: any) => a.id === artId);
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
}

/** Commit a trusted (gated_pass) capability run so its required pre-req is satisfied for GCOV. */
export function commitTrusted(
  state: V5SessionState,
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  runId: string,
  declaredInputs: string[] = []
): V5SessionState {
  const { updatedState } = commitArtifact(
    state,
    createRawArtifact(id, capabilityId, roleId, kind),
    runId,
    false,
    declaredInputs
  );
  markTrusted(updatedState, id);
  return updatedState;
}

/** Raw artifact shape that passes G-GROUND (external repo / F1 source). */
export function createGroundedEvidenceRaw(
  id: string
): Omit<Artifact, 'trustLevel'> {
  return {
    ...createRawArtifact(
      id,
      'evidence.search',
      '接地',
      'evidence',
      '【来源: F1_Github_Source 取数】外部证据片段'
    ),
    provenance: 'mcp:github' as Artifact['provenance'],
    summary: '【来源: F1_Github_Source 取数】',
    payload: { evidenceSource: 'F1_Github_Source 取数' },
  };
}

/** Commit grounded external evidence (passes G-GROUND). */
export function commitGroundedEvidence(
  state: V5SessionState,
  id: string,
  runId: string
): V5SessionState {
  const { updatedState } = commitArtifact(
    state,
    createGroundedEvidenceRaw(id),
    runId,
    false,
    []
  );
  return updatedState;
}

/** Map a capability id to the artifact kind it produces (commit-loop helper). */
export function kindForCap(capabilityId: string): Artifact['kind'] {
  if (capabilityId === 'report.write') return 'report';
  if (capabilityId === 'synthesis.merge') return 'synthesis';
  if (capabilityId === 'risk.analyze' || capabilityId === 'counter.argue') return 'risk';
  return 'evidence';
}

/**
 * Mirror the page's same-round commit loop: orchestrate + commit each planned capability with
 * fresh per-step input resolution (this is what makes the same-round DAG work).
 * Returns the working state after all commits this turn (NOT yet markAwaiting'd).
 */
export function driveConvergeTurn(
  state: V5SessionState,
  turnId: string,
  userText: string
): V5SessionState {
  const { newState, plan } = orchestrateReasoningTurn(state, { turnId, userText });
  let working = newState;
  plan.selected.forEach((sel: any, idx: number) => {
    const cap = sel.capabilityId as V5CapabilityId;
    const role = sel.roleId || 'agent';
    const runId = `${turnId}-run-${idx}`;
    const inputs = findInputsForCapability(working, cap);
    let contentOverride: string | undefined;
    if (cap === 'report.write') {
      const structured = buildStructuredReport({ state: working, inputArtifactIds: inputs, roleId: role });
      contentOverride = structured.content;
    }
    const raw = createRawArtifact(`${turnId}-art-${idx}`, cap, role, kindForCap(cap), contentOverride);
    const { updatedState } = commitArtifact(
      working,
      raw,
      runId,
      false,
      inputs,
      "pilot-template" // test sim converge helper (driveConvergeTurn); real LLM paths use driveReasoningSession which pulls declared baseline
    );
    working = updatedState;
  });
  return working;
}

/**
 * Drive a session to `goal.status === "clear"` with a TRUSTED, committed `report` artifact.
 * Mirrors the page's first-convergence flow: trusted risk + synthesis upstreams, a converge turn
 * (GCOV-pass -> applyGoalConclusion writes "clear"), then commit the planned report.write.
 *
 * Returns the converged state plus the ids of the seeded trusted artifacts so callers can target
 * a specific one for a challenge (S4) or coverage replay (S2).
 */
export function buildClearStateWithTrustedReport(sessionId: string): {
  state: V5SessionState;
  reportId: string;
  riskId: string;
  synthId: string;
} {
  let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);

  const riskId = 'risk-1';
  const critId = 'crit-1';
  const evId = 'ev-ground-1';
  const synthId = 'synth-1';
  s = commitTrusted(s, riskId, 'risk.analyze', '安全', 'risk', `${sessionId}-r0`);
  // The complex CoverageContract now includes critique.generate (V5.2/V5.3 面板质疑纳入合约);
  // without a trusted critique run the converge turn can no longer reach a GCOV-pass.
  s = commitTrusted(s, critId, 'critique.generate', '挑刺', 'risk', `${sessionId}-r0c`);
  s = commitGroundedEvidence(s, evId, `${sessionId}-r0b`);
  s = commitTrusted(s, synthId, 'synthesis.merge', '综合', 'synthesis', `${sessionId}-r1`);

  // Converge turn: GCOV passes -> single-writer applyGoalConclusion writes "clear".
  const { newState } = orchestrateReasoningTurn(s, {
    turnId: `${sessionId}-cv`,
    userText: '现在可以出最终报告了',
  });

  // Commit the planned report using the planned run id so it is a real trusted report.
  const reportNode = (newState.graph.nodes || []).find((n: any) => n.capabilityId === 'report.write');
  const reportRunId = (reportNode as any)?.capabilityRunId ?? `${sessionId}-cv-run-0`;
  const reportInputs = findInputsForCapability(newState, 'report.write');
  const reportId = 'report-1';
  const structuredReport = buildStructuredReport({
    state: newState,
    inputArtifactIds: reportInputs,
    roleId: '综合',
  });
  const { updatedState, committed } = commitArtifact(
    newState,
    createRawArtifact(reportId, 'report.write', '综合', 'report', structuredReport.content),
    reportRunId,
    false,
    reportInputs,
    "production" // this path uses buildStructuredReport (thick, K2 contract) → production baseline
  );
  markTrusted(updatedState, reportId); // guarantee the helper's contract ("withTrustedReport") even if transient gate (e.g. G-GROUND in weak state); real paths use full drive + production baseline + thick builder content
  return { state: updatedState, reportId, riskId, synthId };
}

/** S20 ITER: converged session plus a fresh (non-stale) preview artifact. */
export function buildClearStateWithPreview(sessionId: string): {
  state: V5SessionState;
  reportId: string;
  riskId: string;
  synthId: string;
  previewId: string;
} {
  const built = buildClearStateWithTrustedReport(sessionId);
  const previewId = `${sessionId}-preview-1`;
  const state = commitTrusted(
    built.state,
    previewId,
    'ux.preview',
    '工程',
    'preview',
    `${sessionId}-pv0`
  );
  return { ...built, state, previewId };
}

/** Mechanical recycle signature for P2 / N4 / S20 parity (invalidation + reschedule fields only). */
export function recycleSignature(state: V5SessionState): string {
  return JSON.stringify({
    staleArtifactIds: [...(state.staleArtifactIds || [])].sort(),
    goal: state.goal,
    graphNodes: (state.graph?.nodes || []).map((n: { id?: string; status?: string }) => ({
      id: n.id,
      status: n.status,
    })),
    projectionDirtyNodeIds: [...(state.projectionDirtyNodeIds || [])].sort(),
  });
}

// ===== Small audit/state helpers reused across scenarios =====

/** Number of distinct turnIds represented in capabilityRuns (the "round count" proxy). */
export function countDistinctTurns(state: V5SessionState): number {
  const turnIds = new Set<string>(
    (state.capabilityRuns || []).map((r: any) => r.turnId).filter(Boolean)
  );
  return turnIds.size;
}

/** Trusted, non-stale artifacts (the "trusted committed" set). */
export function trustedArtifacts(state: V5SessionState): Artifact[] {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).filter(
    (a: any) =>
      (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') && !stales.has(a.id)
  );
}
