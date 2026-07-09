/**
 * TurnRouteTimeline 多轮折叠标签回归测试。
 *
 * 修复前 bug: 折叠行用 `第 {r + 1} 轮`,而 r 已是 1-based roundIndex(见
 * sliderule-turn-route.ts:671 `第 ${round.roundIndex} 轮`),导致折叠摘要轮次比真实轮次多 1。
 * 静态沉浸浮层(非 streaming + immersionOverlay + ≥2 轮)下,历史轮(非最新轮)默认折叠,
 * SSR 初始渲染即可断言折叠行文案。
 *
 * 本仓库 React 组件测试约定:用 react-dom/server renderToStaticMarkup,不引入 jsdom/RTL。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnRouteTimeline } from "../TurnRouteTimeline";
import type { TurnRouteFacts } from "@shared/blueprint/sliderule-turn-route";

const twoRoundFacts: TurnRouteFacts = {
  turnId: "turn-1",
  timestamp: "2026-06-11T10:42:03.000Z",
  goalStatusBefore: "needs_refinement",
  goalStatusAfter: "clear",
  planReason: "picked",
  planSelectedCount: 2,
  planSource: "llm",
  dledgerDecisionId: "turn-1-r1-dledger",
  committedCount: 2,
  trustPassedCount: 2,
  trustTotalCount: 2,
  runtimePhase: "awaiting",
  selectedCapabilities: undefined,
  rounds: [
    {
      roundIndex: 1,
      planSelectedCount: 2,
      planSource: "llm",
      dledgerDecisionId: "turn-1-r1-dledger",
      selectedCapabilities: [
        { capabilityId: "evidence.search", roleId: "接地" },
        { capabilityId: "risk.analyze", roleId: "安全" },
      ],
    },
    {
      roundIndex: 2,
      planSelectedCount: 1,
      planSource: "llm",
      dledgerDecisionId: "turn-1-r2-dledger",
      selectedCapabilities: [{ capabilityId: "synthesis.merge", roleId: "综合" }],
    },
  ],
} as TurnRouteFacts;

describe("TurnRouteTimeline 多轮折叠标签", () => {
  it("历史轮折叠行用 1-based 真实轮次(第 1 轮,不是第 2 轮)", () => {
    const html = renderToStaticMarkup(
      <TurnRouteTimeline
        facts={twoRoundFacts}
        steps={[]}
        actions={[]}
        sessionId="sliderule-test"
        expanded
        onToggle={() => {}}
        litCount={0}
        streaming={false}
        liveAction={null}
        immersionOverlay
      />
    );
    // 第 1 轮是历史轮(maxRound=2),默认折叠 → 出现折叠行 + 1-based 文案。
    expect(html).toContain('data-testid="sliderule-timeline-round-fold-1"');
    expect(html).toContain("第 1 轮");
    // 回归断言: 不得再出现 off-by-one 的「第 2 轮 … 已折叠」(第 2 轮是最新轮,不折叠)。
    expect(html).not.toContain("sliderule-timeline-round-fold-2");
  });
});
