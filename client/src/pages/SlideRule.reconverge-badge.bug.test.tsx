/**
 * Bug Condition Exploration Test (edge case) — SlideRule STATUS bar conclusion badge after a challenge
 * Spec: .kiro/specs/sliderule-reconverge-loop-fix/ (Task 1, Property 1 — STATUS bar binding, C-2)
 *
 * CRITICAL: This test is written against UNFIXED code and is EXPECTED TO FAIL.
 * The failure confirms the C-2 defect: after a session reaches goal.status === "clear" and a
 * challenge stales the supporting report, `invalidateForIntervention` leaves goal.status === "clear",
 * so the STATUS badge (bound to sessionState.goal.status) still shows the stale "已收敛 / clear"
 * label between the challenge and the next GCOV re-evaluation, instead of "待细化" (needs_refinement).
 *
 * After the fix (Task 3.2 / 3.3) the invalidation path downgrades goal.status to "needs_refinement"
 * through the single-writer applyGoalConclusion, flipping this test from FAIL -> PASS.
 *
 * Test strategy follows this repo's existing React component test convention:
 *   - NO @testing-library/react / jsdom / happy-dom.
 *   - Use react-dom/server `renderToStaticMarkup` + `vi.mock` and assert on the SSR output.
 *
 * Validates: Requirements 1.6, 2.7
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Stub the heavy reasoning surface so SSR focuses on the STATUS bar.
vi.mock('@/components/autopilot/ReasoningFlowSurface', () => ({
  ReasoningFlowSurface: () => null,
}));

vi.mock('./sliderule/useSlideRuleSession', async () => {
  const rt = await vi.importActual<typeof import('@/lib/sliderule-runtime')>(
    '@/lib/sliderule-runtime'
  );
  // Mirror the runtime mock staging: challenged converged session with stale report.
  let staged = rt.createInitialSessionState('分析权限系统的风险并给出最终报告', 'badge-reconverge');
  const commitTrusted = (st: any, id: string, cap: any, role: string, kind: any, runId: string, inputs: string[] = []) => {
    const { updatedState } = rt.commitArtifact(
      st,
      { id, kind, provenance: 'ai_generated', producedBy: { capabilityRunId: `run-${id}`, capabilityId: cap, roleId: role }, title: id, summary: id, content: `${role} 通过 ${cap} 贡献了内容。` } as any,
      runId,
      false,
      inputs
    );
    const a = (updatedState.artifacts || []).find((x: any) => x.id === id);
    if (a) { a.trustLevel = 'gated_pass'; a.passedGates = ['commit']; }
    return updatedState;
  };
  staged = commitTrusted(staged, 'risk-1', 'risk.analyze', '安全', 'risk', 'b-r0');
  staged = commitTrusted(staged, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 'b-r1');
  staged = commitTrusted(staged, 'report-1', 'report.write', '综合', 'report', 'b-r2', rt.findInputsForCapability(staged, 'report.write'));
  staged = rt.applyGoalConclusion(staged, 'clear');
  staged = rt.invalidateForIntervention(staged, { targetArtifactId: 'report-1', intent: 'challenge', text: '我质疑这个结论' } as any);

  return {
    useSlideRuleSession: () => ({
      goal: '分析权限系统的风险并给出最终报告',
      sessionState: staged,
      uiTurns: [],
      input: '',
      setInput: () => {},
      isRunning: false,
      liveAction: null,
      sendMessage: async () => {},
      runTurn: async () => {},
      challengeTurn: async () => {},
    }),
  };
});

// Stage the page's initial sessionState as a "just-challenged" converged session built with the
// REAL runtime: a trusted committed report, goal.status === "clear", then a challenge that stales
// the supporting report through the real invalidateForIntervention (the function under test).
vi.mock('@/lib/sliderule-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sliderule-runtime')>(
    '@/lib/sliderule-runtime'
  );

  const commitTrusted = (
    st: any,
    id: string,
    capabilityId: any,
    roleId: string,
    kind: any,
    runId: string,
    inputs: string[] = []
  ) => {
    const { updatedState } = actual.commitArtifact(
      st,
      {
        id,
        kind,
        provenance: 'ai_generated',
        producedBy: { capabilityRunId: `run-${id}`, capabilityId, roleId },
        passedGates: [],
        title: id,
        summary: id,
        content: `${roleId} 通过 ${capabilityId} 贡献了内容。`,
      } as any,
      runId,
      false,
      inputs
    );
    const a = (updatedState.artifacts || []).find((x: any) => x.id === id);
    if (a) {
      a.trustLevel = 'gated_pass';
      a.passedGates = ['commit'];
    }
    return updatedState;
  };

  let staged = actual.createInitialSessionState('分析权限系统的风险并给出最终报告', 'badge-reconverge');
  staged = commitTrusted(staged, 'risk-1', 'risk.analyze', '安全', 'risk', 'b-r0');
  staged = commitTrusted(staged, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 'b-r1');
  const reportInputs = actual.findInputsForCapability(staged, 'report.write');
  staged = commitTrusted(staged, 'report-1', 'report.write', '综合', 'report', 'b-r2', reportInputs);

  // Converged conclusion written through the single writer (mirrors the GCOV-pass write).
  staged = actual.applyGoalConclusion(staged, 'clear');

  // User challenges the supporting report — the moment the STATUS badge must not lie.
  staged = actual.invalidateForIntervention(staged, {
    targetArtifactId: 'report-1',
    intent: 'challenge',
    text: '我质疑这个结论',
  } as any);

  return {
    ...actual,
    createInitialSessionState: () => staged,
  };
});

import SlideRule from './SlideRule';

describe('BUG: SlideRule STATUS badge shows a stale "clear" after a challenge (Property 1 edge case — EXPECTED TO FAIL on unfixed code)', () => {
  it('renders the conclusion badge as "待细化" after a challenge on a converged conclusion', () => {
    const html = renderToStaticMarkup(React.createElement(SlideRule));

    // Sanity: the conclusion badge bound to sessionState.goal.status is present.
    expect(html).toContain('data-testid="sliderule-conclusion-badge"');

    // EXPECTED (design Property 2 / Req 1.6, 2.7): after the challenge the conclusion is downgraded,
    // so the badge surfaces "待细化". FAILS on unfixed code — invalidateForIntervention leaves
    // goal.status === "clear", so the badge still shows the stale "已收敛 / clear".
    expect(html).toContain('待细化');
    expect(html).not.toMatch(/已收敛\s*\/\s*clear/);
  });
});
