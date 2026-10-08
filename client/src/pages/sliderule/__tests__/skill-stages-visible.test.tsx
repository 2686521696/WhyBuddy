// @vitest-environment jsdom
/**
 * 技能步骤看得见：待办上的「技能 · 步骤」标签、收起条上的当前步骤、展开后的步骤一览、结果卡上没做完的。
 *
 * ⚠ 2026-10-08 用户本机 sr-20261008092556-8PW0MNC7ZW（@ui-ux-pro-max @office-skills 采购审批方案）：计划承诺了 8 段技能步骤，
 *   执行列的五条待办一段都没对上；页面只有「加载技能」和「待办 3/5」（plan-todo-dock.SkillStage 头注）。
 *
 * 表不是这里拼的：slide-rule-python/tests/fixtures/skill_stages_purchase.json 由 Python 宿主按真机计划 + 真机待办算出来，
 * Python 那边有判据钉着「夹具 == 宿主此刻算的」。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlanTodoDock } from "../PlanTodoDock";
import { TurnResultCard } from "../TurnResultCard";
import { consumeControlStreamResponse } from "../../../lib/sliderule-marathon-driver";
import type { UiTurn } from "../types";

const REAL = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../slide-rule-python/tests/fixtures/skill_stages_purchase.json"), "utf-8"),
) as {
  roundTodos: Array<{ id: string; status: string; content: string }>;
  roundTable: Array<{ skill: string; stage: string; status: string; todoIds: string[] }>;
  titledTodos: Array<{ id: string; status: string; content: string }>;
  titledTable: Array<{ skill: string; stage: string; status: string; todoIds: string[] }>;
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

describe("待办卡：技能步骤标签", () => {
  it("写了段落标题的那条待办带「技能 · 步骤」标签；展开后有一栏技能步骤，没进待办的照实标出", async () => {
    const el = await mount(<PlanTodoDock items={REAL.titledTodos} stages={REAL.titledTable} />);
    await act(async () => (el.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    const chips = [...el.querySelectorAll('[data-testid="plan-todo-skill-stage"]')].map(n => n.textContent);
    expect(chips).toContain("doc-coauthoring · Stage 3: Reader Testing");
    const overview = el.querySelector('[data-testid="plan-todo-skill-stages"]')!;
    expect(overview.textContent).toContain("Stage 1: Context Gathering");
    expect(overview.querySelectorAll('[data-skill-stage-status="missing"]').length).toBe(7);
    expect(overview.querySelector('[data-skill-stage-status="in_progress"]')!.textContent).toContain("进行中");
  });

  it("收起条：当前在做的那条对上了技能步骤，脸上就写「技能 · 步骤」", async () => {
    const todos = REAL.titledTodos.map(t => ({ ...t, status: t.id === "s3" ? "in_progress" : t.id === "t1" ? "completed" : t.status }));
    const el = await mount(<PlanTodoDock items={todos} stages={REAL.titledTable} />);
    expect(el.querySelector('[data-testid="plan-todo-current"]')!.textContent).toContain("doc-coauthoring · Stage 3: Reader Testing");
  });

  it("反向：没有表（直接回答、没承诺过技能步骤）就跟原来一样，不多一个字", async () => {
    const el = await mount(<PlanTodoDock items={REAL.roundTodos} stages={null} />);
    await act(async () => (el.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    expect(el.querySelector('[data-testid="plan-todo-skill-stage"]')).toBeNull();
    expect(el.querySelector('[data-testid="plan-todo-skill-stages"]')).toBeNull();
  });
});

/** 跟 office-result-card-thumbnail.test.tsx 同一个形状：这一轮真的跑过命令、产出了办公文件，结果卡才出。 */
const turn: UiTurn = {
  id: "t1", user: "做采购审批方案", status: "complete",
  steps: [{ id: "chip-shell_exec", kind: "chip", roleId: "control", label: "shell_exec", realLlm: true,
            progressType: "completed", capabilityId: "shell_exec" as never }],
  routeFacts: {} as UiTurn["routeFacts"], routeExpanded: false, routeLitCount: 0,
  assistant: "已完成", assistantSource: "llm", actions: [],
  main: { artifactId: "a1", kind: "page", realLlm: true },
} as UiTurn;

/** 真机那一轮是办公文档交付（plan deliverableKind=office-file）。 */
const OFFICE = { runtimeKind: "project" as const, projectRevision: "prv-1", deliverableKind: "office-file", hasOfficeArtifact: true };

describe("结果卡：技能步骤没做完的列出来", () => {
  it("真机那一轮：8 段全没进待办——卡下写出来，列前三段再写总数", async () => {
    const el = await mount(<TurnResultCard turn={turn} {...OFFICE} skillStages={REAL.roundTable} />);
    const row = el.querySelector('[data-testid="turn-result-skill-stages-open"]')!;
    expect(row.textContent).toContain("技能步骤没做完");
    expect(row.textContent).toContain("ui-ux-pro-max · Workflow（没进待办）");
    expect(row.textContent).toContain("等 8 段");
  });

  it("反向：都做完或说了不做（cancelled）就不出这一行", async () => {
    const done = REAL.roundTable.map((s, i) => ({ ...s, status: i % 2 ? "completed" : "cancelled" }));
    const el = await mount(<TurnResultCard turn={turn} {...OFFICE} skillStages={done} />);
    expect(el.querySelector('[data-testid="turn-result-status"]'), "卡得先画出来，否则这条反向是白绿").not.toBeNull();
    expect(el.querySelector('[data-testid="turn-result-skill-stages-open"]')).toBeNull();
  });
});

describe("§4 生成侧/消费侧：服务端发的 skillStages 客户端真的接住", () => {
  it("control_todo 事件里的 skillStages 原样交给 onControlTodo", async () => {
    const event = { type: "control_todo", todos: REAL.titledTodos, skillStages: REAL.titledTable, summary: "", line: "" };
    const got: unknown[] = [];
    const body = `data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify({ type: "complete", state: { sessionId: "s" } })}\n\n`;
    await consumeControlStreamResponse(new Response(body), {
      onControlTodo: (payload: { skillStages: unknown[] }) => got.push(payload.skillStages),
    } as never);
    expect(got).toEqual([REAL.titledTable]);
  });

  it("接住之后写进会话状态（浮层和结果卡读同一份）", () => {
    const hook = readFileSync(resolve(__dirname, "../useSlideRuleSession.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const tail = hook.split("onControlTodo:")[1].slice(0, 700);
    expect(tail).toContain("visibleSkillStages(payload.skillStages)");
    expect(tail).toContain("controlSkillStages:");
  });
});
