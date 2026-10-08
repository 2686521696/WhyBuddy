/**
 * 技能步骤表真的接到了页面上：会话状态 → ClaudeChatSurface → 待办卡收起条 / 最新一轮的结果卡。
 *
 * skill-stages-visible.test.tsx 只直接画两个组件；这里画整个对话面（SSR，跟 plan-todo-dock.test.tsx 同一套：
 * ClaudeChatSurface 拉 assistant-stream，jsdom 没有 TransformStream）。没有这条，把 SlideRule.tsx 里的传参删掉，
 * 组件判据照样全绿——CLAUDE.md §三「函数写对了 ≠ 它被调用了」。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeChatSurface } from "../../SlideRule";
import type { UiTurn } from "../types";

const REAL = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../slide-rule-python/tests/fixtures/skill_stages_purchase.json"), "utf-8"),
);

const turn = {
  id: "t1", user: "做采购审批应用", status: "complete",
  steps: [{ id: "chip-file_write", kind: "chip", roleId: "control", label: "file_write", realLlm: true,
            progressType: "completed", capabilityId: "file_write" }],
  routeFacts: {}, routeExpanded: false, routeLitCount: 0,
  assistant: "已完成", assistantSource: "llm", actions: [],
  main: { artifactId: "a1", kind: "page", realLlm: true },
} as unknown as UiTurn;

function surface(stages: unknown, todos = REAL.titledTodos, running = false) {
  return renderToStaticMarkup(
    <ClaudeChatSurface
      uiTurns={[turn]}
      isRunning={running}
      liveAction={null}
      latestTurn={turn}
      onChallenge={() => {}}
      runtimeKind="project"
      projectRevision="prv-1"
      controlTodo={todos}
      controlSkillStages={stages}
      composerSlot={<div data-testid="sliderule-composer-dock" />}
    />,
  );
}

describe("技能步骤表接到页面上", () => {
  it("待办卡收起条：当前在做的那条带「技能 · 步骤」", () => {
    const todos = REAL.titledTodos.map((t: { id: string; status: string }) => ({
      ...t, status: t.id === "s3" ? "in_progress" : t.id === "t1" ? "completed" : t.status }));
    expect(surface(REAL.titledTable, todos)).toContain("doc-coauthoring · Stage 3: Reader Testing");
  });

  it("最新、已跑完的那一轮结果卡下列出没做完的技能步骤", () => {
    const html = surface(REAL.roundTable);
    expect(html).toContain('data-testid="turn-result-status"');           // 卡得先画出来
    expect(html).toContain('data-testid="turn-result-skill-stages-open"');
  });

  it("反向：还在跑的时候结果卡不下结论（表是此刻的，步骤可能马上就做）", () => {
    expect(surface(REAL.roundTable, REAL.roundTodos, true)).not.toContain('data-testid="turn-result-skill-stages-open"');
  });

  it("页面把会话状态里的表交给对话面（刷新后从后端读回来的那份）", () => {
    const page = readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(page).toContain("controlSkillStages={sessionState.controlSkillStages}");
  });
});
