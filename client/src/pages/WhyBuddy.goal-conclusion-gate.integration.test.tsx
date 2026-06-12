/**
 * Integration Tests — WhyBuddy V5.1 GOAL Conclusion Gate (Task 4)
 * Spec: .kiro/specs/whybuddy-goal-conclusion-gate/
 *
 * These tests close the loop between the runtime (`orchestrateReasoningTurn`) and the page
 * STATUS bar (`WhyBuddy.tsx`). Unlike the Task 1 edge-case render test
 * (`WhyBuddy.conclusion-badge.bug.test.tsx`, which force-mocks `goal.status = "clear"`), here
 * the rendered conclusion is the genuine output of a full driven flow:
 *
 *   1. CLEAR flow:      ordinary/converge turns drive a real GCOV-pass → `goal.status === "clear"`
 *                       → the STATUS bar conclusion badge shows the `clear` label.
 *   2. HARD-BLOCK flow: a converge turn with missing pre-reqs parks at a partial AWAIT
 *                       → `goal.status` stays `"needs_refinement"`
 *                       → the STATUS bar conclusion badge shows the `待细化` label.
 *
 * Test strategy follows this repo's existing React component test convention:
 *   - NO @testing-library/react / jsdom / happy-dom.
 *   - Use react-dom/server `renderToStaticMarkup` + `vi.mock` and assert on the SSR output.
 *   - The page bootstraps `sessionState` from `createInitialSessionState`; we inject a
 *     runtime-derived state through a hoisted ref so the rendered badge reflects a real flow.
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 3.1, 3.6
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  V5SessionState,
  Artifact,
  CoverageGateResult,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';
import { commitGroundedEvidence } from '@/lib/whybuddy-fullpath-fixtures';

type RuntimeModule = typeof import('@/lib/whybuddy-runtime');

// Hoisted holder: the page's createInitialSessionState returns whatever state we stage here,
// so the rendered STATUS bar reflects a genuine runtime-driven flow (set per test).
const staged = vi.hoisted(() => ({ current: null as V5SessionState | null }));

// Stub the heavy reasoning surface so SSR focuses on the STATUS bar.
vi.mock('@/components/autopilot/ReasoningFlowSurface', () => ({
  ReasoningFlowSurface: () => null,
}));

vi.mock('./whybuddy/useWhyBuddySession', () => ({
  useWhyBuddySession: () => {
    const state = staged.current;
    if (!state) throw new Error('staged session state not set for integration render');
    return {
      goal: state.goal?.text || '',
      sessionState: state,
      uiTurns: [],
      input: '',
      setInput: () => {},
      isRunning: false,
      liveAction: null,
      sendMessage: async () => {},
      runTurn: async () => {},
      challengeTurn: async () => {},
      toggleRouteExpanded: () => {},
      sessionHydrated: true,
    };
  },
}));

// Override ONLY createInitialSessionState; every other runtime export stays real so the
// states we build below come from the genuine orchestrate/commit/coverage logic.
vi.mock('@/lib/whybuddy-runtime', async () => {
  const actual = await vi.importActual<RuntimeModule>('@/lib/whybuddy-runtime');
  return {
    ...actual,
    createInitialSessionState: (goalText: string, sessionId?: string) =>
      staged.current ?? actual.createInitialSessionState(goalText, sessionId),
  };
});

// ---- helpers (mirror conventions from the Task 1/2 runtime tests) ----

function createRawArtifact(
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  content = `${roleId} 通过 ${capabilityId} 贡献了内容。`
): Omit<Artifact, 'trustLevel' | 'passedGates'> {
  return {
    id,
    kind,
    provenance: 'ai_generated',
    producedBy: { capabilityRunId: `run-${id}`, capabilityId, roleId },
    title: content.split('\n')[0]?.slice(0, 80),
    summary: content.slice(0, 200),
    content,
  };
}

/** Commit a trusted (gated_pass) capability run so its required pre-req is satisfied for GCOV. */
function commitTrusted(
  rt: RuntimeModule,
  state: V5SessionState,
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  runId: string
): V5SessionState {
  const { updatedState } = rt.commitArtifact(
    state,
    createRawArtifact(id, capabilityId, roleId, kind),
    runId,
    false,
    []
  );
  const art = (updatedState.artifacts || []).find(
    (a: any) => a.producedBy?.capabilityId === capabilityId && a.id === id
  );
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
  return updatedState;
}

/** Drive a full flow to a real GCOV-pass and return the resulting state (goal.status === "clear"). */
function buildClearFlowState(rt: RuntimeModule): V5SessionState {
  const goalText = '分析权限系统的风险并给出最终报告';
  let s = rt.createInitialSessionState(goalText, 'integration-clear');

  // Ordinary upstream turns produce trusted required pre-reqs (incl. grounded evidence for G-GROUND).
  s = commitTrusted(rt, s, 'risk-1', 'risk.analyze', '安全', 'risk', 'int-r0');
  s = commitGroundedEvidence(s, 'ev-ground-1', 'int-r0b');
  s = commitTrusted(rt, s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 'int-r1');

  // Converge turn drives the GCOV-gated conclusion write.
  const { newState } = rt.orchestrateReasoningTurn(s, {
    turnId: 'int-converge',
    userText: '现在可以出最终报告了',
  });
  return newState;
}

/** Drive a converge turn with missing pre-reqs to a hard-block partial AWAIT (goal.status unchanged). */
function buildHardBlockFlowState(rt: RuntimeModule): V5SessionState {
  const goalText = '有风险的权限系统最终可行性报告';
  let s = rt.createInitialSessionState(goalText, 'integration-hardblock');

  const { updatedState: sWithRisk } = rt.commitArtifact(
    s,
    createRawArtifact('untrusted-risk', 'risk.analyze', '安全', 'risk'),
    'int-hb-run-risk',
    true,
    []
  );
  s = commitTrusted(
    rt,
    sWithRisk,
    'trusted-synth',
    'synthesis.merge',
    '综合',
    'synthesis',
    'int-hb-run-synth'
  );
  s = { ...s, openQuestions: [{ id: 'q1', text: '边界？' }] } as any;

  const { newState } = rt.orchestrateReasoningTurn(s, {
    turnId: 'int-hardblock',
    userText: '路线对比 拆解结构 预览效果',
  });
  return newState;
}

describe('INTEGRATION (Task 4): full /whybuddy flow surfaces the GCOV conclusion in the STATUS bar', () => {
  let clearState: V5SessionState;
  let hardBlockState: V5SessionState;

  beforeAll(async () => {
    const rt = await vi.importActual<RuntimeModule>('@/lib/whybuddy-runtime');
    clearState = buildClearFlowState(rt);
    hardBlockState = buildHardBlockFlowState(rt);
  });

  async function renderWith(state: V5SessionState): Promise<string> {
    staged.current = state;
    vi.resetModules();
    const mod = await import('./WhyBuddy');
    const WhyBuddy = mod.default;
    return renderToStaticMarkup(React.createElement(WhyBuddy));
  }

  it('CLEAR flow: converge → GCOV-pass → goal.status "clear" → STATUS bar shows the clear label', async () => {
    // The flow genuinely reached a GCOV-pass and wrote the conclusion.
    const gate = clearState.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(true);
    expect(clearState.goal.status).toBe('clear');

    const html = await renderWith(clearState);

    // The STATUS bar renders the conclusion badge bound to sessionState.goal.status.
    expect(html).toContain('data-testid="whybuddy-conclusion-badge"');
    expect(html).toMatch(/已收敛\s*\/\s*clear|已收敛/);
    // The not-yet-converged / not-recommended labels must NOT appear for a clear conclusion.
    expect(html).not.toContain('不建议');
  });

  it('HARD-BLOCK flow: converge with missing pre-reqs → partial AWAIT → STATUS bar stays "待细化"', async () => {
    // The flow hard-blocked into a partial AWAIT and left goal.status unchanged.
    const gate = hardBlockState.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(false);
    expect(hardBlockState.runtimePhase).toBe('awaiting');
    expect(hardBlockState.goal.status).toBe('needs_refinement');

    const html = await renderWith(hardBlockState);

    // The conclusion badge is present but shows the needs_refinement label, never "clear".
    expect(html).toContain('data-testid="whybuddy-conclusion-badge"');
    expect(html).toContain('待细化');
    expect(html).not.toMatch(/已收敛\s*\/\s*clear/);
  });
});
