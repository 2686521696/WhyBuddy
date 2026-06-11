/**
 * Bug Condition Exploration Test (edge case) — WhyBuddy STATUS bar conclusion badge
 * Spec: .kiro/specs/whybuddy-goal-conclusion-gate/ (Task 1, Property 1 — STATUS bar binding)
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

vi.mock('./whybuddy/useWhyBuddySession', async () => {
  const rt = await vi.importActual<typeof import('@/lib/whybuddy-runtime')>(
    '@/lib/whybuddy-runtime'
  );
  const base = rt.createInitialSessionState(
    '做一个权限管理系统（支持 RBAC + 数据范围）',
    'whybuddy-main-proto'
  );
  const sessionState = { ...base, goal: { ...base.goal, status: 'clear' as const } };
  return {
    useWhyBuddySession: () => ({
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
vi.mock('@/lib/whybuddy-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whybuddy-runtime')>(
    '@/lib/whybuddy-runtime'
  );
  return {
    ...actual,
    createInitialSessionState: (goalText: string, sessionId?: string) => {
      const base = actual.createInitialSessionState(goalText, sessionId);
      return { ...base, goal: { ...base.goal, status: 'clear' as const } };
    },
  };
});

import WhyBuddy from './WhyBuddy';

describe('BUG: WhyBuddy STATUS bar never surfaces sessionState.goal.status (Property 1 edge case — EXPECTED TO FAIL on unfixed code)', () => {
  it('renders a conclusion badge sourced from sessionState.goal.status showing the "clear" label', () => {
    const html = renderToStaticMarkup(React.createElement(WhyBuddy));

    // EXPECTED (design Property 1 / Req 2.4): a dedicated conclusion badge in the STATUS bar,
    // bound to sessionState.goal.status. FAILS on unfixed code (no such badge exists).
    expect(html).toContain('data-testid="whybuddy-conclusion-badge"');

    // EXPECTED: the badge surfaces the "clear" conclusion label (design: clear -> 已收敛 / clear).
    // FAILS on unfixed code (the STATUS bar only renders the local `goal` text string).
    expect(html).toMatch(/已收敛\s*\/\s*clear|已收敛/);
  });
});
