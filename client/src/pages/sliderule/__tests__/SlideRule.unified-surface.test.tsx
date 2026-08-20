/**
 * Unified single-surface contract for /sliderule (2026-07 merge).
 *
 * The former chat / reasoning / studio surfaces were merged into ONE page:
 *   - studio skeleton (left conversation + right skill rail) is the only surface;
 *   - the 聊天/推演 toggle pills and the surface-mode localStorage key are gone;
 *   - one header row (brand/topic + STATUS + 交付物/重置会话/Dev);
 *   - one empty state (short greeting + composer + 3 suggestion chips);
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
    // 空会话不挂图标簇（交付物/重置也会占一条底边）
    expect(html).not.toContain('data-testid="sliderule-status-bar"');
  });

  it("empty session hides the chrome cluster（交付物/重置也占一条底边，空态不挂）", () => {
    const html = renderPage();
    expect(html).not.toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain('data-testid="sliderule-deliverables-open"');
    expect(html).not.toContain('data-testid="sliderule-reset-session"');
    expect(html).not.toContain('data-testid="sliderule-layout-controls"');
  });

  it("有轮次才挂交付物/重置，且只出现一次（不占整页顶栏）", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });

    // Work 模式迁私有主仓：公开仓不再有模式切换
    expect(html).not.toContain('data-testid="sliderule-surface-mode"');
    expect(html).not.toContain('data-testid="sliderule-mode-work"');
    expect(html).not.toContain('data-testid="sliderule-conclusion-badge"');
    expect(html).not.toContain('data-testid="sliderule-goal-display"');
    expect(html.match(/data-testid="sliderule-status-bar"/g)?.length).toBe(1);
    expect(html).toContain('data-testid="sliderule-deliverables-open"');
    expect(html).toContain('data-testid="sliderule-reset-session"');
    expect(html).toContain('data-testid="sliderule-layout-controls"');
    expect(html).not.toContain(">交付物<");
    expect(html).not.toContain(">重置会话<");
    // E28：Dev 入口移除（用户裁决）——工程驾驶舱直接访问 /sliderule/dev
    expect(html).not.toContain('href="/sliderule/dev"');
  });

  it("empty session shows THE single empty state: greeting + Cursor composer card + chips + inspiration", () => {
    const html = renderPage();

    expect(html.match(/data-testid="sliderule-empty-state"/g)?.length).toBe(1);
    expect(html).toContain("想推演成什么应用？");
    // 不该有：落地页主张句 / logo / 回车提示。变异：把旧文案加回必红。
    expect(html).not.toContain("把一句模糊想法");
    expect(html).not.toContain("能跑起来");
    expect(html).not.toContain("miantuan-mark.png");
    // 2026-08-20：空态芯片下要有键盘提示（设置页同一事实）。旧空格写法是落地页残留。
    expect(html).toContain('data-testid="sliderule-empty-enter-hint"');
    expect(html).toContain("Enter 发送 · Shift+Enter 始终换行");
    expect(html).not.toContain("Shift + Enter 换行");
    // 输入框 → 芯片 → 键盘提示共用外层 gap-7。变异：再套一层更小的 gap-2.5 必红。
    const stack = html.slice(
      html.indexOf('data-testid="sliderule-hero-composer"'),
      html.indexOf('data-testid="sliderule-empty-enter-hint"')
    );
    expect(stack).not.toContain("gap-2.5");
    // E39：模式模板卡整块移除（用户裁决：右侧密度做减法）
    expect(html).not.toContain('data-testid="sliderule-home-mode-');
    // 三个快速开始 chips（完整场景名，无小标题）
    expect(html).toContain('data-testid="sliderule-quick-start-采购审批应用"');
    expect(html).toContain('data-testid="sliderule-quick-start-员工入职流程"');
    expect(html).toContain('data-testid="sliderule-quick-start-客户管理系统"');
    expect(html).not.toContain("从需求文档开始");
    expect(html).not.toContain(">快速开始<");
    // Cursor 卡片输入：没有粉紫光晕。变异：把 glow 加回必红。
    expect(html).not.toContain('data-testid="sliderule-hero-glow"');
    expect(html).not.toContain("rgba(167,139,250");
    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("需要灵感？");
    expect(html).toContain("Fork一下，快人一步");
    expect(html).toContain('data-testid="sliderule-inspiration"');
    expect(html).toContain('data-testid="sliderule-inspiration-all"');
    expect(html).not.toContain(
      'data-testid="sliderule-inspiration-采购审批应用"'
    );
    expect(html).not.toContain('data-testid="sliderule-inspiration-wall"');
    expect(html).not.toContain("应用中心还没有可展示的项目");
    // hero composer 仍在首页流里，且全页仍只有一个 ComposerDock
    expect(html).toContain('data-testid="sliderule-hero-composer"');
    expect(html).toContain('data-testid="sliderule-composer-device"');
    expect(html).toContain('data-testid="sliderule-composer-device-phone"');
    expect(html).toContain('data-testid="sliderule-composer-device-desktop"');
    const phoneChip = html.slice(
      html.indexOf("sliderule-composer-device-phone"),
      html.indexOf("sliderule-composer-device-desktop")
    );
    expect(phoneChip).toContain("应用");
    expect(html).toContain("描述你想构建的业务系统");
    // 静态营销网点仍禁；鼠标点阵空态和工作台都有。
    expect(html).not.toContain('data-testid="sliderule-empty-dot-field"');
    expect(html).toContain('data-testid="sliderule-home-hover-dots"');
    expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(
      1
    );
    expect(html).not.toContain('data-testid="sliderule-composer-footer"');
    expect(html).not.toContain('data-testid="sliderule-composer-actions"');
    expect(html).not.toContain('data-testid="sliderule-composer-context"');
    // the old duplicate empty-state copy is gone
    expect(html).not.toContain("把应用意图发给 SlideRule");
    expect(html).not.toContain("Welcome to SlideRule V5.");
  });

  it("开聊后输入条贴在会话流底部，不再整页浮层截断分隔线", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });
    expect(html).toContain('data-testid="sliderule-composer-footer"');
    expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(
      1
    );
    expect(html).not.toContain('data-testid="sliderule-hero-composer"');
    expect(html).not.toContain('data-testid="sliderule-empty-enter-hint"');
    expect(html).not.toContain('data-testid="sliderule-composer-device"');
    expect(html).not.toContain('data-testid="sliderule-empty-dot-field"');
    expect(html).toContain('data-testid="sliderule-home-hover-dots"');
    expect(html).not.toContain("pb-[104px]");
    const footer = html.slice(
      html.indexOf('data-testid="sliderule-composer-footer"'),
      html.indexOf('data-testid="sliderule-composer-dock"')
    );
    expect(footer).toContain("max-w-[720px]");
    expect(footer).not.toContain("border-t");
    // Cursor 三行：芯片 / 胶囊 / 状态。空态 hero 不画这三行。
    expect(html).toContain('data-testid="sliderule-composer-actions"');
    expect(html).toContain('data-testid="sliderule-composer-hint-chip"');
    expect(html).toContain('data-testid="sliderule-composer-context"');
    expect(html).toContain("推演");
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
    expect(html).toContain('data-testid="sliderule-layout-stage"');
    expect(html).toContain('aria-label="隐藏页面"');
    expect(html).toContain('data-testid="sliderule-layout-maximize"');
    expect(html).toContain('data-testid="sliderule-layout-reset"');
    expect(html).not.toContain('data-testid="sliderule-layout-sidebar"');
    expect(html).not.toContain('data-testid="sliderule-layout-chat"');
    expect(html).not.toContain("折叠舞台");
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
    expect(html).toContain("字");
    expect(html).not.toContain("字符");
    expect(html).not.toContain("推演过程");
    // 归档默认折叠：正文不直接出现在 DOM（点开才渲染）
    expect(html).not.toContain("版本合并冲突的可视化成本");
    // 归档态无流式光标
    expect(html).not.toContain("▊");
  });

  it("会话在场但未运行（无模型）→ board：接线沙盘 + Checks，不是六圆钮", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });

    expect(html).toContain('data-testid="sliderule-architecture-stage"');
    expect(html).toContain('data-testid="architecture-checks"');
    expect(html).toContain("Checks");
    // 不该有：顶栏彩色圆钮。变异：把 SkillThumbnailBar 加回必红。
    expect(html).not.toContain("bg-blue-400");
    expect(html).not.toContain("bg-emerald-400");
    expect(html).not.toContain("发布证据看板");
  });

  it("while running the left column carries the live process; the rail stays on 系统画面", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
      liveAction: { label: "C_EVID · 证据收集中", external: false },
    });

    // conversation shows the live turn + 活动行（动词去掉「正在」）
    expect(html).toContain("做一个采购审批应用");
    expect(html).toContain("解析意图并规划六系统推演");
    expect(html).toContain('data-testid="sliderule-activity-row"');
    expect(html).not.toContain("正在解析意图并规划六系统推演");
    expect(html).toContain('data-authority="agent"');
    // rail is the system screens, never a duplicate process feed
    expect(html).not.toContain('data-testid="sliderule-rail-process"');
    // no empty state while a run is on screen
    expect(html).not.toContain('data-testid="sliderule-empty-state"');
  });

  it("左栏拆出 Agent 选 和 配方轨，未到的配方步是 pending", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      isRunning: true,
      uiTurns: [
        {
          ...streamingTurn,
          routeFacts: {
            rounds: [],
            planSelectedCount: 2,
            planSource: "llm",
          },
          steps: [
            {
              id: "s0",
              kind: "narration",
              text: "指令已接收 · 启动推理",
              source: "fallback",
            },
            {
              id: "s1",
              kind: "chip",
              capabilityId: "intent.parse",
              roleId: "system",
              label: "第 1 轮 · 正在澄清需求",
              realLlm: false,
            },
            {
              id: "s2",
              kind: "chip",
              capabilityId: "intent.parse",
              roleId: "system",
              label:
                "第 2 轮 · 正在执行 起草规格：成功判据、需求节点与页面清单",
              realLlm: true,
            },
          ],
        },
      ],
    });
    expect(html).toContain("Agent 选");
    expect(html).toContain("配方");
    expect(html).toContain("起草规格");
    expect(html).toContain("接上数据");
    expect(html).toContain('data-status="pending"');
    expect(html).toContain('data-authority="recipe"');
    expect(html).not.toContain("ChainOfThought");
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

  it("reload restores every iterated user message, not just the first or last turn", () => {
    // 2026-08-18 真机：刷新后只剩首轮，后面发出的精修指令从左栏消失。
    // 反向：若 conversationTurns 仍是 [latestTurn]，这里只会看到最后一句。
    const html = renderPage({
      goal: "给连锁烘焙店做一套门店订货与损耗管控系统",
      uiTurns: [],
      sessionState: {
        sessionId: "sliderule-unified-test",
        goal: { text: "给连锁烘焙店做一套门店订货与损耗管控系统", status: "clear" },
        artifacts: [],
        coverageGaps: [],
        runtimePhase: "concluded",
        lastTurnId: "turn-3-drive-full",
        capabilityRuns: [
          {
            capabilityId: "synthesis.merge",
            roleId: "agent",
            turnId: "turn-3-drive-full",
            gateResults: [],
          },
        ],
        decisionLedger: [
          {
            id: "dl-3",
            turnId: "turn-3-drive-full",
            source: "llm",
            chose: ["synthesis.merge"],
          },
        ],
        modelVersions: [
          {
            id: "mv-1",
            turnId: "turn-1-drive-full",
            instruction: "给连锁烘焙店做一套门店订货与损耗管控系统",
          },
          {
            id: "mv-2",
            turnId: "turn-2-drive-full",
            instruction: "损耗登记页加临期预警",
          },
          {
            id: "mv-3",
            turnId: "turn-3-drive-full",
            instruction: "收货对账页给到货差异加一键发起补货申请",
          },
        ],
      },
    });

    expect(html).not.toContain('data-testid="sliderule-empty-state"');
    expect(html).toContain("损耗登记页加临期预警");
    expect(html).toContain("收货对账页给到货差异加一键发起补货申请");
    expect(html).toContain("给连锁烘焙店做一套门店订货与损耗管控系统");
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
    // 叠在输入框上方，不进 flex 流顶走输入。变异：改回 mb-2 占位必红。
    const card = html.slice(
      html.indexOf("sliderule-clarification-card") - 420,
      html.indexOf("sliderule-clarification-card") + 40
    );
    expect(card).toContain("absolute");
    expect(card).toContain("bottom-full");
    expect(card).toContain("sr-composer-pop");
    const hero = html.slice(
      html.indexOf("sliderule-hero-composer"),
      html.indexOf("sliderule-composer-dock")
    );
    expect(hero).toContain("sliderule-clarification-card");
  });
});

describe("buildImItems（消息 id 对账——重复 id 会让 assistant-ui 整页崩）", () => {
  // 2026-08-18 步伴真机：两个同 id 轮次进了外部存储，MessageRepository
  // 对重复消息 id 直接抛错，整页只剩 "An unexpected error occurred"。
  // 适配层是最后一道闸：撞 id 只许丢一条 + console.warn，不许崩页面。
  const turn = (id: string, user: string) =>
    ({
      id,
      user,
      status: "complete",
      steps: [],
      routeFacts: { turnId: id },
      routeExpanded: false,
      routeLitCount: 0,
      assistant: "",
      assistantSource: "llm",
      main: null,
      actions: [],
    }) as never;

  it("正常轮次：用户+助手成对展开，顺序不变", async () => {
    const { buildImItems } = await import("@/pages/SlideRule");
    const items = buildImItems([turn("t1", "第一句"), turn("t2", "第二句")]);
    expect(items.map(i => i.id)).toEqual([
      "t1-user", "t1-assistant", "t2-user", "t2-assistant",
    ]);
  });

  it("撞 id 时丢先出现的、留后出现的，绝不外泄重复 id", async () => {
    const { buildImItems } = await import("@/pages/SlideRule");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const items = buildImItems([turn("t1", "旧的一份"), turn("t1", "新的一份")]);
      const ids = items.map(i => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      // 留下的是后出现（更新）的那轮
      expect(items.find(i => i.id === "t1-user")?.turn.user).toBe("新的一份");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
