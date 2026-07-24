import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance, FreeformNode } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";

/** 2026-07-24 修复：dataRef 之前只在 Python 侧校验过"实体/字段真实存在"，
 * 从没真正驱动过显示内容——渲染的是 LLM 自己写的 text 字面量，"数字必须
 * 真实、不能编"这个承诺在渲染这一步从没兑现。这里验证：有 aggregate 时
 * 渲染器必须现算，不能相信 LLM 写的 text（哪怕 text 是编的假数字，页面
 * 上也必须显示真实值）。 */
describe("FreeformInsight dataRef → 真实渲染（不信任 LLM 写的 text）", () => {
  function block(root: FreeformNode): ExperienceBlockInstance {
    return {
      id: "b1",
      type: "FreeformInsight",
      freeformContent: { root: root as unknown as Record<string, unknown> },
    };
  }

  function renderWithRows(
    root: FreeformNode,
    entityRows: Record<string, RuntimeRow[]>
  ): string {
    return renderToStaticMarkup(
      <ExperienceBlockBoundary block={block(root)} entityRows={entityRows} />
    );
  }

  const rows = (n: number, fieldVal: (i: number) => number): RuntimeRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      values: { amount: fieldVal(i) },
      createdAt: "2026-07-24T00:00:00.000Z",
    }));

  it("count 聚合：忽略 LLM 写的假数字，显示真实行数", () => {
    const root: FreeformNode = {
      tag: "div",
      text: "9999", // LLM 编的假数字——不能被信任
      dataRef: { entityRef: "ticket", aggregate: "count" },
    };
    const html = renderWithRows(root, { ticket: rows(3, () => 0) });
    expect(html).toContain(">3<");
    expect(html).not.toContain("9999");
  });

  it("sum 聚合：现算真实总和，不是 LLM 写的字面量", () => {
    const root: FreeformNode = {
      tag: "div",
      text: "假的",
      dataRef: { entityRef: "order", aggregate: "sum:amount" },
    };
    const html = renderWithRows(root, {
      order: rows(3, i => [100, 200, 50][i]),
    });
    expect(html).toContain("350");
    expect(html).not.toContain("假的");
  });

  it("实体在 entityRows 里查不到：如实显示「—」，不回退到 LLM 的 text", () => {
    const root: FreeformNode = {
      tag: "div",
      text: "编的数字",
      dataRef: { entityRef: "missing_entity", aggregate: "count" },
    };
    const html = renderWithRows(root, { ticket: rows(3, () => 0) });
    expect(html).toContain("—");
    expect(html).not.toContain("编的数字");
  });

  it("没有 aggregate（纯引用实体）：不是数字承诺，正常显示 LLM 的 text", () => {
    const root: FreeformNode = {
      tag: "div",
      text: "工单概览",
      dataRef: { entityRef: "ticket" },
    };
    const html = renderWithRows(root, { ticket: rows(3, () => 0) });
    expect(html).toContain("工单概览");
  });

  it("avg 聚合：现算真实平均值", () => {
    const root: FreeformNode = {
      tag: "div",
      text: "0",
      dataRef: { entityRef: "review", aggregate: "avg:amount" },
    };
    const html = renderWithRows(root, {
      review: rows(4, i => [4, 5, 3, 4][i]),
    });
    expect(html).toContain("4");
  });
});
