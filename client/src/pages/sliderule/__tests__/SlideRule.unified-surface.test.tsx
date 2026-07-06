/**
 * Unified single-surface contract for /sliderule (2026-07 merge).
 *
 * The former chat / reasoning / studio surfaces were merged into ONE page:
 *   - studio skeleton (left conversation + right skill rail) is the only surface;
 *   - the 聊天/推演 toggle pills and the surface-mode localStorage key are gone;
 *   - one header row (brand/topic + STATUS + 交付物/重置会话/Dev);
 *   - one empty state (classical logo watermark + hero copy + 3 suggestion chips);
 *   - the execution timeline + SKILL LINKAGE fold into the right rail as 推演过程;
 *   - the pan/zoom reasoning canvas is no longer rendered here (?im=dev keeps
 *     the split engineering cockpit).
 *
 * Convention: react-dom/server renderToStaticMarkup + vi.mock (no jsdom).
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deploy-target", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deploy-target")>();
  return { ...actual, IS_GITHUB_PAGES: false };
});

vi.mock("../TurnRouteTimeline", () => ({
  TurnRouteTimeline: () => <div data-testid="mock-turn-route-timeline" />,
}));

vi.mock("@/components/autopilot/ReasoningFlowSurface", () => ({
  ReasoningFlowSurface: () => <div data-testid="mock-reasoning-canvas" />,
}));

const hookState: { value: Record<string, unknown> } = { value: {} };

function baseHookReturn() {
  return {
    goal: "",
    sessionState: {
      sessionId: "sliderule-unified-test",
      goal: { text: "" },
      artifacts: [],
      capabilityRuns: [],
      coverageGaps: [],
      decisionLedger: [],
    },
    uiTurns: [] as unknown[],
    input: "",
    setInput: () => {},
    isRunning: false,
    liveAction: null,
    sendMessage: async () => {},
    challengeTurn: async () => {},
    resetSession: () => {},
    retryCapability: async () => {},
    toggleRouteExpanded: () => {},
    driveMode: "single" as const,
    setDriveMode: () => {},
    stop: () => {},
    executorMode: "server-llm" as const,
    driveFullStatus: "idle" as const,
    activeSkillId: null,
    skillContents: {},
    latestMermaid: null,
    pendingClarifications: [] as unknown[],
    answerClarifications: () => {},
    generateDeliverables: () => {},
  };
}

vi.mock("../useSlideRuleSession", () => ({
  useSlideRuleSession: () => ({ ...baseHookReturn(), ...hookState.value }),
}));

import SlideRule from "@/pages/SlideRule";

function renderPage(overrides: Record<string, unknown> = {}) {
  hookState.value = overrides;
  try {
    return renderToStaticMarkup(React.createElement(SlideRule));
  } finally {
    hookState.value = {};
  }
}

const streamingTurn = {
  id: "turn-run-1",
  user: "做一个采购审批应用",
  assistant: "",
  assistantSource: "llm",
  status: "streaming" as const,
  steps: [
    { id: "s1", kind: "narration", text: "正在解析意图并规划六系统推演" },
  ],
  actions: [],
  routeFacts: { rounds: [], planSelectedCount: 2 },
  routeExpanded: true,
  routeLitCount: 2,
  main: null,
};

describe("unified /sliderule surface (single mental model)", () => {
  it("renders ONE surface: no 聊天/推演 pills, no surface-mode toggle, no reasoning canvas", () => {
    const html = renderPage();

    expect(html).toContain('data-testid="sliderule-root"');
    expect(html).not.toContain("sliderule-surfacemode-toggle");
    expect(html).not.toContain("sliderule-viewmode-toggle");
    // v4 pan/zoom canvas never renders on the default page
    expect(html).not.toContain("mock-reasoning-canvas");
    // exactly one header bar (the merged STATUS header)
    expect(html.match(/data-testid="sliderule-status-bar"/g)?.length).toBe(1);
  });

  it("single header row carries STATUS summary (待细化/话题/阶段) plus 交付物/重置会话/Dev actions", () => {
    const html = renderPage();

    expect(html).toContain('data-testid="sliderule-conclusion-badge"');
    expect(html).toContain("待细化");
    expect(html).toContain("话题");
    expect(html).toContain("阶段");
    expect(html).toContain('data-testid="sliderule-deliverables-open"');
    expect(html).toContain('data-testid="sliderule-reset-session"');
    expect(html).toContain('href="/sliderule/dev"');
  });

  it("empty session shows THE single empty state: logo watermark + hero copy + 3 suggestion chips + composer", () => {
    const html = renderPage();

    expect(html.match(/data-testid="sliderule-empty-state"/g)?.length).toBe(1);
    expect(html).toContain("/assets/sliderule-logo.png");
    expect(html).toContain("我能帮你把意图推演成应用闭环");
    expect(html).toContain("发一句业务目标，SlideRule 串起五系统");
    expect(html).toContain("做一个采购审批应用，含采购单、经理审批、财务确认和字段权限");
    expect(html).toContain("设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理");
    // 第三条 chip 是新颖域（非内置演示域）——用户从 chips 就能体验真实 LLM 路径
    expect(html).toContain("做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养");
    // single bottom composer, unchanged
    expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(1);
    // the old duplicate empty-state copy is gone
    expect(html).not.toContain("把应用意图发给 SlideRule");
    expect(html).not.toContain("Welcome to SlideRule V5.");
  });

  it("right rail always offers the six skill thumbnails and the 系统画面/推演过程 tabs", () => {
    const html = renderPage();

    for (const label of ["DataModel", "Workflow", "RBAC", "Page", "AIGC", "AppBundle"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('data-testid="sliderule-rail-tab-screens"');
    expect(html).toContain('data-testid="sliderule-rail-tab-process"');
  });

  it("while running (before any skill activates) the rail defaults to the 推演过程 execution feed", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
      liveAction: { label: "C_EVID · 证据收集中", external: false },
    });

    // conversation shows the live turn + thinking feed
    expect(html).toContain("做一个采购审批应用");
    expect(html).toContain("正在解析意图并规划六系统推演");
    // right rail folds the execution timeline in as 推演过程 (default during a run)
    expect(html).toContain('data-testid="sliderule-rail-process"');
    expect(html).toContain('data-testid="sliderule-arch-process-panel"');
    expect(html).toContain('data-variant="rail"');
    // no empty state while a run is on screen
    expect(html).not.toContain('data-testid="sliderule-empty-state"');
  });

  it("SSE skill activation shows the active system screen (rail switches to 系统画面)", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
      activeSkillId: "dataModel",
      liveAction: { label: "DataModel 建模中", external: false },
    });

    // screens view (not the process feed) once a skill is live
    expect(html).not.toContain('data-testid="sliderule-rail-process"');
    expect(html).toContain("实体关系");
  });

  it("reload restores: persisted state rebuilds the latest turn instead of the empty state", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [],
      sessionState: {
        sessionId: "sliderule-unified-test",
        goal: { text: "做一个采购审批应用", status: "clear" },
        artifacts: [],
        coverageGaps: [],
        runtimePhase: "concluded",
        lastTurnId: "turn-restored",
        capabilityRuns: [
          { capabilityId: "evidence.collect", roleId: "agent", turnId: "turn-restored", gateResults: [] },
        ],
        decisionLedger: [
          { id: "dl-1", turnId: "turn-restored", source: "llm", chose: ["evidence.collect"] },
        ],
      },
    });

    expect(html).not.toContain('data-testid="sliderule-empty-state"');
    // restored conclusion surfaces in the merged header
    expect(html).toContain("已收敛");
  });

  it("pending clarifications still surface above the composer", () => {
    const html = renderPage({
      pendingClarifications: [
        { id: "gap-1", prompt: "这个审批流需要几级审批？", type: "free_text" },
      ],
      answerClarifications: () => {},
    });

    expect(html).toContain("这个审批流需要几级审批？");
  });
});
