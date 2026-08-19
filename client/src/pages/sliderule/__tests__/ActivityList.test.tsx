import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityList } from "../ActivityList";
import { deriveStageBands } from "../stage-authority";
import type { TurnStep } from "../types";

const STEPS = [
  "指令已接收 · 启动推理",
  "第 1 轮 · 正在澄清需求",
  "⚙ 数据模型 系统画面生成中...",
  "✓ 数据模型 证据落地 · LLM 生成",
];

function narrSteps(texts: string[]): TurnStep[] {
  return texts.map((text, i) => ({
    id: `s${i}`,
    kind: "narration",
    text,
    source: "fallback",
  }));
}

describe("ActivityList", () => {
  it("完成态是一行缩略，展开后是整齐活动行，不是装饰日志", () => {
    const groups = deriveStageBands({
      steps: narrSteps(STEPS),
      streaming: false,
    });
    const html = renderToStaticMarkup(
      <ActivityList
        groups={groups}
        streaming={false}
        header="4 步 · 12s"
        closureMeta="6/6"
      />
    );
    expect(html).toContain('data-testid="sliderule-turn-steps-toggle"');
    expect(html).toContain("4 步 · 12s");
    expect(html).toContain("6/6");
    expect(html).not.toContain("推演过程");
    expect(html).not.toContain("Brain");
    expect(html).not.toContain('data-testid="sliderule-activity-row"');
    expect(html).not.toContain("系统画面生成中");
    expect(html).not.toContain("指令已接收");
  });

  it("流式时直接铺活动行，并标出闸 / 规则选 / 配方", () => {
    const groups = deriveStageBands({
      steps: narrSteps(STEPS),
      streaming: true,
    });
    const html = renderToStaticMarkup(
      <ActivityList groups={groups} streaming header="4 步" />
    );
    expect(html).toContain('data-testid="sliderule-activity-row"');
    expect(html).toContain("生成画面");
    expect(html).toContain("数据模型");
    expect(html).toContain("澄清需求");
    expect(html).toContain("接收意图");
    expect(html).toContain("规则选");
    expect(html).toContain("配方");
    expect(html).toContain('data-authority="agent"');
    expect(html).toContain('data-authority="recipe"');
    expect(html).not.toContain("系统画面生成中");
    expect(html).not.toContain("正在澄清需求");
    expect(html).not.toContain("指令已接收");
    expect(html).not.toContain('data-testid="sliderule-turn-steps-toggle"');
  });

  it("配方轨铺未到的步骤，正文块不进阶段名单", () => {
    const groups = deriveStageBands({
      steps: [
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
          label: "第 2 轮 · 正在执行 起草规格：成功判据、需求节点与页面清单",
          realLlm: true,
        },
      ],
      streaming: true,
      planSource: "llm",
    });
    const html = renderToStaticMarkup(
      <ActivityList groups={groups} streaming header="2 步" />
    );
    expect(html).toContain("Agent 选");
    expect(html).toContain("配方");
    expect(html).toContain("起草规格");
    expect(html).toContain("接上数据");
    expect(html).toContain('data-status="pending"');
    expect(html).toContain('data-stage-id="specfirst.bind"');
  });
});
