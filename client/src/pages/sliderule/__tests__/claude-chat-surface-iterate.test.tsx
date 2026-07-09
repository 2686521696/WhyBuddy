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
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeChatSurface } from "../../SlideRule";
import type { UiTurn } from "../types";

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
});
