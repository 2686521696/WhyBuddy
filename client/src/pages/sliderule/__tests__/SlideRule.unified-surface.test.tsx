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

vi.mock("@/lib/deploy-target", async importOriginal => {
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

  it("single header row：交付物/重置会话（STATUS、Work/Code 胶囊与 Dev 入口均退役）", () => {
    const html = renderPage();

    // Work 模式迁私有主仓：公开仓不再有模式切换
    expect(html).not.toContain('data-testid="sliderule-surface-mode"');
    expect(html).not.toContain('data-testid="sliderule-mode-work"');
    expect(html).not.toContain('data-testid="sliderule-conclusion-badge"');
    expect(html).not.toContain('data-testid="sliderule-goal-display"');
    expect(html).toContain('data-testid="sliderule-deliverables-open"');
    expect(html).toContain('data-testid="sliderule-reset-session"');
    // E28：Dev 入口移除（用户裁决）——工程驾驶舱直接访问 /sliderule/dev
    expect(html).not.toContain('href="/sliderule/dev"');
  });

  it("empty session shows THE single empty state: hero + 4 mode cards + quick starts + composer (E34)", () => {
    const html = renderPage();

    expect(html.match(/data-testid="sliderule-empty-state"/g)?.length).toBe(1);
    expect(html).toContain("把一句模糊想法，快速推演成可执行的完整应用");
    expect(html).toContain("能跑起来");
    // 四张模式模板卡（同一推演管线的起手式，不是假功能入口）
    for (const key of ["app", "model", "verify", "clone"]) {
      expect(html).toContain(`data-testid="sliderule-home-mode-${key}"`);
    }
    expect(html).toContain("应用推演");
    expect(html).toContain("页面复刻");
    // 快速开始 chips（含「从需求文档开始」拉起附件选择器）
    expect(html).toContain("快速开始");
    expect(html).toContain('data-testid="sliderule-quick-start-采购审批"');
    expect(html).toContain(
      'data-testid="sliderule-quick-start-从需求文档开始"'
    );
    // single bottom composer, unchanged
    expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(
      1
    );
    // the old duplicate empty-state copy is gone
    expect(html).not.toContain("把应用意图发给 SlideRule");
    expect(html).not.toContain("Welcome to SlideRule V5.");
  });

  it("empty session hides the right stage entirely（欢迎页独占全宽，不摆空壳看板）", () => {
    const html = renderPage();

    for (const label of [
      "DataModel",
      "Workflow",
      "RBAC",
      "Page",
      "AIGC",
      "AppBundle",
    ]) {
      expect(html).not.toContain(`>${label}<`);
    }
    expect(html).not.toContain("发布证据看板");
  });

  it("推演中应用未成形 → 右栏 live 占位（不许闪回六系统老看板）", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
    });

    // 用户反馈：发了消息右侧还是老面板——推演中必须是 live 占位
    expect(html).toContain('data-testid="sliderule-live-stage"');
    expect(html).toContain("推演中");
    expect(html).not.toContain("发布证据看板");
    // 「推演过程」右栏标签页已删（与左栏步骤流+LLM 实时草稿完全重复）
    expect(html).not.toContain('data-testid="sliderule-rail-tab-screens"');
    expect(html).not.toContain('data-testid="sliderule-rail-tab-process"');
    expect(html).not.toContain('data-testid="sliderule-rail-process"');
  });

  it("+ 菜单是实用动作（文件/示例/技能库），模式选择器已删（用户裁决 2026-07-10）", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });
    expect(html).toContain('data-testid="sliderule-actions-menu"');
    expect(html).toContain("添加文件或图片");
    expect(html).toContain("填入示例意图");
    expect(html).toContain("选择注入的技能"); // 就地勾选（不再直接跳走）
    // 深思一轮/持续推演不再出现在产品面（引擎的马拉松能力保留在 Dev 面）
    expect(html).not.toContain("sliderule-mode-menu");
    expect(html).not.toContain("深思一轮");
    expect(html).not.toContain("持续推演");
  });

  it("思考流留档：完成轮保留 llm_output 记录（默认折叠、无光标）", () => {
    const doneTurn = {
      ...streamingTurn,
      id: "turn-done-1",
      status: "complete" as const,
      assistant: "推演完成，应用已闭环。",
      steps: [
        ...streamingTurn.steps,
        {
          id: "s-arch-1",
          kind: "llm_output" as const,
          title: "分析风险",
          text: "主要风险是版本合并冲突的可视化成本较高，建议先做只读预览。",
          formatJson: false,
        },
        {
          id: "s-arch-2",
          kind: "llm_output" as const,
          title: "起草五系统模型",
          text: '{"datamodel":{"entities":[]}}',
          formatJson: true,
        },
      ],
    };
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [doneTurn],
      isRunning: false,
    });
    expect(html).toContain('data-testid="sliderule-llm-archives"');
    expect(html).toContain("分析风险");
    expect(html).toContain("起草五系统模型");
    // 归档默认折叠：正文不直接出现在 DOM（点开才渲染）
    expect(html).not.toContain("版本合并冲突的可视化成本");
    // 归档态无流式光标
    expect(html).not.toContain("▊");
  });

  it("会话在场但未运行（无模型）→ board：六系统缩略 + 证据看板", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });

    for (const label of [
      "DataModel",
      "Workflow",
      "RBAC",
      "Page",
      "AIGC",
      "AppBundle",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("while running the left column carries the live process; the rail stays on 系统画面", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
      liveAction: { label: "C_EVID · 证据收集中", external: false },
    });

    // conversation shows the live turn + thinking feed
    expect(html).toContain("做一个采购审批应用");
    expect(html).toContain("正在解析意图并规划六系统推演");
    // rail is the system screens, never a duplicate process feed
    expect(html).not.toContain('data-testid="sliderule-rail-process"');
    // no empty state while a run is on screen
    expect(html).not.toContain('data-testid="sliderule-empty-state"');
  });

  it("SSE skill activation keeps the minimal live stage (no mid-run system screens)", () => {
    // 用户裁决 2026-07-14：执行期不看中间过程——即使 SSE 激活了某个系统，
    // 右栏也只显示"推演中 + 当前动作"极简态；系统画面等闭环后随效果页呈现。
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
      activeSkillId: "dataModel",
      liveAction: { label: "DataModel 建模中", external: false },
    });

    expect(html).not.toContain('data-testid="sliderule-rail-process"');
    expect(html).toContain('data-testid="sliderule-live-stage"');
    expect(html).toContain("DataModel 建模中");
    expect(html).not.toContain("实体关系");
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
          {
            capabilityId: "evidence.collect",
            roleId: "agent",
            turnId: "turn-restored",
            gateResults: [],
          },
        ],
        decisionLedger: [
          {
            id: "dl-1",
            turnId: "turn-restored",
            source: "llm",
            chose: ["evidence.collect"],
          },
        ],
      },
    });

    // 持久化状态重建成功的判据：不落回空态、恢复轮以对话形态回归且回答就位
    // （STATUS 头部摘要已随状态盒退役；E16 起正文由 streamdown Response 在
    // 客户端填充，SSR 静态渲染为空——以容器属性断言回答存在，不再钉文案）
    expect(html).not.toContain('data-testid="sliderule-empty-state"');
    expect(html).toContain('data-testid="sliderule-turn-answer"');
    expect(html).toContain('data-answer-present="true"');
  });

  it("Work 模式已迁私有主仓：旧偏好残留也不再切走界面", () => {
    const prev = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (k === "sliderule:surface-mode" ? "work" : null),
      setItem: () => {},
      removeItem: () => {},
    };
    try {
      const html = renderPage();
      expect(html).not.toContain('data-testid="sliderule-work-mode"');
      // 推演主界面照常（含输入条）
      expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(
        1
      );
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
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
