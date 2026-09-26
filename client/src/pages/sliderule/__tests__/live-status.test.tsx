/**
 * 回合进行中的状态行：没有工具在跑时，不许把一个做完了的动作说成「正在」。
 *
 * ⚠ 2026-09-26 隔离真机 sr-20260926043506-7B49NNSE1M：模型写生成脚本的 4 分 20 秒
 *   里，状态行一直是「◌ 已创建工程 · 已等待 2 分 16 秒」——工程早建好了。
 *
 * 第二组渲染真的 ClaudeChatSurface（不是只测纯函数）：把 SlideRule.tsx 里
 * liveStatusText 那处调用换回 `liveAction?.label || latestStepText`，第二组变红。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClaudeChatSurface } from "../../SlideRule";
import { THINKING_NEXT, liveStatusText } from "../live-status";
import type { TurnStep, UiTurn } from "../types";

const chip = (label: string, progressType: "acting" | "completed" | "failed"): TurnStep => ({
  id: `c-${label}`,
  kind: "chip",
  capabilityId: "project_create",
  roleId: "system",
  label,
  realLlm: false,
  progressType,
});

/** 真机那一刻的待办（todo_write 回执原样：t1 进行中）。 */
const TODO = [
  { id: "t1", content: "搭建 10 页 PPT 内容与统一视觉样式", status: "in_progress" },
  { id: "t2", content: "生成可编辑 PPTX 文件并检查页数与可打开性", status: "pending" },
];

const streaming = (steps: TurnStep[]): UiTurn => ({
  id: "t1",
  user: "帮我做一份季度复盘 PPT",
  status: "streaming",
  steps,
  routeFacts: { turnId: "t1" },
  routeExpanded: false,
  routeLitCount: 0,
  assistant: "",
  assistantSource: "llm",
  main: null,
  actions: [],
});

describe("liveStatusText", () => {
  const base = { latestStepText: "已创建工程", runtimeKind: "project" as const, fallback: "正在推演..." };

  it("工具在跑：说它", () => {
    expect(liveStatusText({ ...base, liveActionLabel: "正在运行命令", latestStep: chip("已创建工程", "completed") }))
      .toBe("正在运行命令");
  });

  it("最后一步已做完、没有工具在跑：模型在想下一步，带上它自己标的进行中待办", () => {
    expect(liveStatusText({ ...base, latestStep: chip("已创建工程", "completed"), todo: TODO }))
      .toBe(`${THINKING_NEXT}：搭建 10 页 PPT 内容与统一视觉样式`);
    expect(liveStatusText({ ...base, latestStep: chip("执行失败：运行命令", "failed") }))
      .toBe(THINKING_NEXT);
  });

  it("反向：还在跑的 chip、模型的开口、HTML 推演都照旧", () => {
    expect(liveStatusText({ ...base, latestStepText: "正在创建工程", latestStep: chip("正在创建工程", "acting"), todo: TODO }))
      .toBe("正在创建工程");
    const speech: TurnStep = { id: "n", kind: "narration", text: "先确认口径", source: "llm" };
    expect(liveStatusText({ ...base, latestStepText: "先确认口径", latestStep: speech, todo: TODO })).toBe("先确认口径");
    expect(liveStatusText({ ...base, runtimeKind: "html-prototype", latestStep: chip("已创建工程", "completed"), todo: TODO }))
      .toBe("已创建工程");
  });
});

describe("接在页面上", () => {
  const render = (steps: TurnStep[]) => {
    const turn = streaming(steps);
    return renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[turn]}
        isRunning
        liveAction={null}
        latestTurn={turn}
        onChallenge={() => {}}
        runtimeKind="project"
        controlTodo={TODO}
      />
    );
  };

  it("真机那一刻：状态行说在想下一步，不说「已创建工程」是正在进行的事", () => {
    const html = render([chip("已创建工程", "completed")]);
    expect(html).toContain(`${THINKING_NEXT}：搭建 10 页 PPT 内容与统一视觉样式`);
  });

  it("反向：命令还在跑时说的是那条命令", () => {
    const html = render([chip("正在运行命令", "acting")]);
    expect(html).toContain("正在运行命令");
    expect(html).not.toContain(THINKING_NEXT);
  });
});
