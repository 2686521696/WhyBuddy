/**
 * SlideRule V5.1 Full-Path Acceptance Test Plan — Batch 1 STATUS-bar (DOM) assertions.
 * Spec: docs/V5.1-full-path-test-plan.md (S2 STATUS conclusion badge binding).
 *
 * This sibling file covers the ONE full-path STATUS-bar assertion that maps to a rendered DOM
 * field: S2's "STATUS 条结论徽章显示「已收敛 / clear」且绑定 sessionState.goal.status". It follows
 * this repo's React test convention (NO jsdom / @testing-library): react-dom/server
 * renderToStaticMarkup + vi.mock, asserting on the SSR output. See
 * client/src/pages/SlideRule.reconverge-badge.bug.test.tsx for the same pattern.
 *
 * The companion S1 STATUS line ("轮次=1、已调用能力数>0") has no dedicated DOM field (round count is
 * bound to interaction-driven chatTurns state and there is no capability-count element), so it is
 * asserted as STATE fields in sliderule-runtime.fullpath-core.test.ts per the doc's degrade rule.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Stub the heavy reasoning surface so SSR focuses on the STATUS bar.
vi.mock('@/components/autopilot/ReasoningFlowSurface', () => ({
  ReasoningFlowSurface: () => null,
}));

// Stage the page's initial sessionState as a CONVERGED ("clear") session, built with the REAL
// runtime via the single-writer applyGoalConclusion (the GCOV-pass write path).
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

  let staged = actual.createInitialSessionState('分析权限系统的风险并给出最终报告', 'status-s2-clear');
  staged = commitTrusted(staged, 'risk-1', 'risk.analyze', '安全', 'risk', 's-r0');
  staged = commitTrusted(staged, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 's-r1');
  const reportInputs = actual.findInputsForCapability(staged, 'report.write');
  staged = commitTrusted(staged, 'report-1', 'report.write', '综合', 'report', 's-r2', reportInputs);
  // Converged conclusion written through the single writer (mirrors the GCOV-pass write).
  staged = actual.applyGoalConclusion(staged, 'clear');

  return {
    ...actual,
    createInitialSessionState: () => staged,
  };
});

import SlideRule from '@/pages/SlideRule';

describe('S2 STATUS · conclusion badge binds to sessionState.goal.status (clear)', () => {
  it('renders the conclusion badge as "已收敛 / clear" when goal.status === "clear"', () => {
    const html = renderToStaticMarkup(React.createElement(SlideRule));

    // The conclusion badge bound to sessionState.goal.status is present.
    expect(html).toContain('data-testid="sliderule-conclusion-badge"');

    // Bound to a clear conclusion -> shows the converged label, never the needs_refinement label.
    expect(html).toContain('已收敛 / clear');
    expect(html).not.toContain('待细化');
  });
});
