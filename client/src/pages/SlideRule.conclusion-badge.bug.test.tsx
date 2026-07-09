/**
 * Bug Condition Exploration Test (edge case) — SlideRule STATUS bar conclusion badge
 * Spec: .kiro/specs/sliderule-goal-conclusion-gate/ (Task 1, Property 1 — STATUS bar binding)
 *
 * CRITICAL: This test is written against UNFIXED code and is EXPECTED TO FAIL.
 * The failure confirms the bug: the STATUS bar renders the page's local `goal` text string
 * and never surfaces `sessionState.goal.status`, so the conclusion is invisible even after a
 * GCOV-pass. After the fix (Task 3.4) a conclusion badge bound to `sessionState.goal.status`
 * MUST surface the "clear" label, flipping this test from FAIL -> PASS.
 *
 * Test strategy follows this repo's existing React component test convention:
 *   - NO @testing-library/react / jsdom / happy-dom.
 *   - Use react-dom/server `renderToStaticMarkup` + `vi.mock` and assert on the SSR output.
 *
 * Validates: Requirements 1.3, 2.4
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
  const base = rt.createInitialSessionState(
    '做一个权限管理系统（支持 RBAC + 数据范围）',
    'sliderule-main-proto'
  );
  const sessionState = { ...base, goal: { ...base.goal, status: 'clear' as const } };
  return {
    useSlideRuleSession: () => ({
      goal: '做一个权限管理系统（支持 RBAC + 数据范围）',
      sessionState,
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

// Make the page's initial sessionState a GCOV-passed one (goal.status === "clear")
// by overriding only createInitialSessionState; everything else stays real.
vi.mock('@/lib/sliderule-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sliderule-runtime')>(
    '@/lib/sliderule-runtime'
  );
  return {
    ...actual,
    createInitialSessionState: (goalText: string, sessionId?: string) => {
      const base = actual.createInitialSessionState(goalText, sessionId);
      return { ...base, goal: { ...base.goal, status: 'clear' as const } };
    },
  };
});

import SlideRule from './SlideRule';

describe('BUG: SlideRule STATUS bar never surfaces sessionState.goal.status (Property 1 edge case — EXPECTED TO FAIL on unfixed code)', () => {
  it('renders a conclusion badge sourced from sessionState.goal.status showing the "clear" label', () => {
    const html = renderToStaticMarkup(React.createElement(SlideRule));

    // EXPECTED (design Property 1 / Req 2.4): a dedicated conclusion badge in the STATUS bar,
    // bound to sessionState.goal.status. FAILS on unfixed code (no such badge exists).
    expect(html).toContain('data-testid="sliderule-conclusion-badge"');

    // EXPECTED: the badge surfaces the "clear" conclusion label (design: clear -> 已收敛 / clear).
    // FAILS on unfixed code (the STATUS bar only renders the local `goal` text string).
    expect(html).toMatch(/已收敛\s*\/\s*clear|已收敛/);
  });
});
