/**
 * 迭代环一期（编辑重跑 / 重新推演）静态渲染回归。
 *
 * 锁三件事：
 *   1. 完成轮带用户文本 → 「重新推演」与「编辑重跑」都渲染；
 *   2. 恢复轮（无 turn.user）→ 两个按钮都不出现（不发空意图）；
 *   3. 运行中 → 「重新推演」禁用（重入保护；点击行为在 sendMessage
 *      textOverride 的 typeof 守卫下有独立单测价值，但静态渲染只锁 disabled）。
 *
 * 仓库约定：react-dom/server renderToStaticMarkup，不引 jsdom/RTL。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeChatSurface } from "../../SlideRule";
import type { UiTurn } from "../types";
import {
  buildRehearsalClockView,
  idleRehearsalCursor,
  startRehearsalCursor,
} from "../derive-status-bar";

const completeTurn = (over: Partial<UiTurn> = {}): UiTurn => ({
  id: "t1",
  user: "做一个宠物医院预约系统",
  status: "complete",
  steps: [],
  routeFacts: { turnId: "t1" },
  routeExpanded: false,
  routeLitCount: 0,
  assistant: "推演完成",
  assistantSource: "llm",
  main: { artifactId: "a1", kind: "report", realLlm: true },
  actions: [],
  ...over,
});

const surface = (turns: UiTurn[], isRunning = false) =>
  renderToStaticMarkup(
    <ClaudeChatSurface
      uiTurns={turns}
      isRunning={isRunning}
      liveAction={null}
      latestTurn={turns.at(-1) ?? null}
      onChallenge={() => {}}
    />
  );

describe("迭代环一期：编辑重跑 / 重新推演", () => {
  it("完成轮带用户文本 → 两个按钮都渲染，且与质疑本轮同排", () => {
    const html = surface([completeTurn()]);
    expect(html).toContain('data-testid="sliderule-rerun-turn"');
    expect(html).toContain("重新推演");
    expect(html).toContain('data-testid="sliderule-edit-rerun"');
    expect(html).toContain("编辑重跑");
    expect(html).toContain("质疑本轮");
  });

  it("恢复轮（无 turn.user）→ 不渲染迭代按钮（不发空意图）", () => {
    const html = surface([completeTurn({ user: "", main: null })]);
    expect(html).not.toContain('data-testid="sliderule-rerun-turn"');
    expect(html).not.toContain('data-testid="sliderule-edit-rerun"');
  });

  it("运行中 → 重新推演禁用（重入保护）", () => {
    const html = surface([completeTurn()], true);
    const btn = html.slice(html.indexOf('data-testid="sliderule-rerun-turn"') - 200);
    expect(btn).toContain("disabled");
  });

  it("用户块是灰底不是品牌蓝气泡（不该有：#e6f4ff 聊天气泡）", () => {
    const html = surface([completeTurn()]);
    const start = html.indexOf('data-testid="sliderule-user-bubble"');
    expect(start).toBeGreaterThan(-1);
    const bubble = html.slice(start, html.indexOf("编辑重跑"));
    expect(bubble).toContain("bg-[#f3f4f6]");
    expect(bubble).not.toContain("bg-[#e6f4ff]");
  });
});

describe("对话区 / 输入条 Cursor 尺度（装在真链路上）", () => {
  it("停靠输入条不再用渐变发送和大投影", () => {
    const userFn = readFileSync(
      new URL("../../SlideRule.tsx", import.meta.url),
      "utf8",
    );
    const slice = userFn.slice(
      userFn.indexOf("function ImUserMessage"),
      userFn.indexOf("function ImAssistantMessage"),
    );
    expect(slice).toContain("bg-[#f3f4f6]");
    expect(slice).not.toContain("bg-[#e6f4ff]");

    const dock = readFileSync(
      new URL("../ComposerDock.tsx", import.meta.url),
      "utf8",
    );
    expect(dock).not.toContain("from-[#E08663]");
    expect(dock).not.toContain("shadow-[0_10px_36px");
    expect(dock).toContain("ArrowUp");
    // 会话内跟空态同一张多行卡片。变异回单行胶囊 / 28px 必红。
    expect(dock).toContain("grid-cols-[auto_auto_1fr_auto]");
    expect(dock).toContain("min-h-[72px]");
    expect(dock).toContain("const minH = 72");
    expect(dock).not.toContain("hero ? 72 : 28");
    expect(dock).not.toContain("hero ? 88 : 32");
    expect(dock).not.toContain("min-h-7");
    expect(dock).not.toContain("rounded-[24px]");
    expect(dock).not.toContain("{hero ? null : sendButton}");
    expect(dock).not.toContain("min-w-0 flex-1 pb-0.5");
  });
});

describe("产品对话列的六步钟（不打开轨迹也能看见）", () => {
  /**
   * ⚠ 2026-09-05 重写。原判据要的是「永远画 6 步、第 1 步显示成 skipped」。
   *   2026-09-02 `7afc6a9`（钟跟本趟 goal.tools 走）把它改了，
   *   `buildRehearsalClockView` 末尾写着：
   *
   *     // 抄 grok：进度只画选中的步。skipped 留在状态机里，钟上不占格——
   *     // 永远六格就是死日历。
   *
   *   于是 skipped 的格子**根本不渲染**，`data-status="skipped"` 再也不会出现，
   *   钟从第 2 格起画。真机截图上顶栏就是「2 起草 SPEC … 6 汇合过闸」五格。
   *   代码改了、判据没改，红了三天——而长期红着的判据比没有更坏。
   *
   *   现在按那个决定重写：只画会跑的那几步，不画死日历，仍然不许有假 ETA。
   */
  it("钟只画会跑的那几步（skipped 不占格），无假 ETA", () => {
    const clock = buildRehearsalClockView(startRehearsalCursor(), {
      isRunning: true,
    });
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[]}
        isRunning
        liveAction={null}
        latestTurn={null}
        onChallenge={() => {}}
        rehearsalClock={clock}
        hud={{
          gatedEvidenceCount: 0,
          narrativeTokens: 0,
          hasServerTokenFacts: false,
        }}
      />
    );
    expect(html).toContain('data-testid="sliderule-rehearsal-clock"');
    // 会跑的那几格在，第一格是当前步
    expect(html).toContain('data-step="2"');
    expect(html).toContain('data-step="6"');
    expect(html).toContain("起草 SPEC");
    expect(html).toContain("汇合过闸");
    // ★ 反向配对：跳过的格子不占位，也不许把状态漏到页面上
    expect(html).not.toContain('data-step="1"');
    expect(html).not.toContain('data-status="skipped"');
    expect(html).toContain("大约数分钟，第一页会先出现");
    expect(html).not.toContain("8–9");
    expect(html).not.toContain("8 分钟");
    expect(html).not.toContain("约 2 分钟");
    expect(html).not.toContain("20 分钟");
  });

  it("不传钟就不渲染 HUD（删掉 ClaudeChatSurface 的 rehearsalClock 必红）", () => {
    const html = surface([], true);
    expect(html).not.toContain('data-testid="sliderule-rehearsal-clock"');
  });

  it("刷新后无进度格仍保留证据/token 行", () => {
    const idleClock = buildRehearsalClockView(idleRehearsalCursor(), {
      isRunning: false,
    });
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[]}
        isRunning={false}
        liveAction={null}
        latestTurn={null}
        onChallenge={() => {}}
        rehearsalClock={idleClock}
        hud={{
          gatedEvidenceCount: 0,
          narrativeTokens: 0,
          hasServerTokenFacts: false,
        }}
        publishClosure={{
          blocked: true,
          evidencePresentCount: 0,
          skillCount: 6,
          versionPinsChecked: false,
          topBlockers: [],
          tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
        }}
      />
    );
    expect(html).toContain('data-testid="sliderule-context-hud"');
    expect(html).not.toContain('data-testid="sliderule-rehearsal-clock"');
    expect(html).toContain('data-token-known="false"');
    expect(html).toContain("—");
  });
});
