/**
 * MainlineWorkbench（主线观察台）纯函数 + 静态结构回归。
 *
 * 组件数据全靠 effect 拉取，renderToStaticMarkup 不跑 effect——
 * 静态断言只看骨架；数据推导测纯函数（summarize*）。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MainlineWorkbench,
  summarizeBaseline,
  summarizeRuntimeStores,
  SESSION_PHASE_LABEL,
} from "./MainlineWorkbench";

function fakeStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  };
}

describe("summarizeRuntimeStores", () => {
  it("统计各话题行/实例数并按体量排序；损坏项与无关键跳过", () => {
    const out = summarizeRuntimeStores(
      fakeStorage({
        "sliderule:live-runtime:s1": JSON.stringify({
          entities: { a: [{ id: 1 }, { id: 2 }], b: [{ id: 3 }] },
          instances: [{ id: "i1" }],
          seq: 4,
        }),
        "sliderule:live-runtime:s2": JSON.stringify({ entities: {}, instances: [], seq: 0 }),
        "sliderule:live-runtime:broken": "not json",
        "unrelated:key": "x",
      })
    );
    expect(out).toEqual([
      { sessionId: "s1", rows: 3, instances: 1 },
      { sessionId: "s2", rows: 0, instances: 0 },
    ]);
  });
});

describe("summarizeBaseline", () => {
  it("五域基线 → gate/内容门/judge 摘要", () => {
    const summary = summarizeBaseline({
      generatedAt: "2026-07-07 09:55 UTC",
      model: "gpt-5.5",
      domains: [
        {
          gate_passed: true,
          content: { hardFailCount: 0, findings: [{ severity: "warn" }] },
          judge: { avg: 4.33 },
        },
        {
          gate_passed: false,
          content: { hardFailCount: 2, findings: [] },
          judge: null,
        },
      ],
    })!;
    expect(summary.domains).toBe(2);
    expect(summary.gatePassed).toBe(1);
    expect(summary.contentFails).toBe(2);
    expect(summary.contentWarns).toBe(1);
    expect(summary.judgeAvg).toBe(4.33); // 只均有分的域
    expect(summary.model).toBe("gpt-5.5");
  });

  it("形状不符 fail-closed 返回 null", () => {
    expect(summarizeBaseline(null)).toBeNull();
    expect(summarizeBaseline({})).toBeNull();
    expect(summarizeBaseline({ domains: [] })).toBeNull();
    expect(summarizeBaseline([1, 2])).toBeNull();
  });
});

describe("MainlineWorkbench 骨架", () => {
  it("标题/刷新/三张健康卡/legacy 指引在场", () => {
    const html = renderToStaticMarkup(<MainlineWorkbench />);
    expect(html).toContain('data-testid="mainline-workbench"');
    expect(html).toContain("主线观察台");
    expect(html).toContain('data-testid="wb-refresh"');
    expect(html).toContain('data-testid="wb-health-Node API"');
    expect(html).toContain('data-testid="wb-health-Python 推演引擎"');
    expect(html).toContain('data-testid="wb-health-LLM 推演通道"');
    expect(html).toContain("/agent-loop/workbench/legacy");
  });

  it("阶段标签表覆盖主要状态", () => {
    expect(SESSION_PHASE_LABEL.done.label).toBe("已闭环");
    expect(SESSION_PHASE_LABEL.awaiting.tone).toBe("busy");
  });
});
