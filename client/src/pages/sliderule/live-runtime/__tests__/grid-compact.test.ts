import { describe, it, expect } from "vitest";
import { autoPlaceGrid, compactVertical } from "../grid-compact";

describe("grid-compact (2026-07-24 真实撞到的 monitor 空档 bug 修复)", () => {
  it("复现原 bug 场景：2 张矮卡 + 2 张摞起来的高卡，不应留空档", () => {
    // 对应真实撞到的场景：图表(114px, 1行) vs 排行+动态(各~115px, 摞起来233px)。
    // 3 列布局：图表A、图表B、排行 先填满第一行，动态卡该落到最短的那一列。
    const placed = autoPlaceGrid(
      [
        { i: "chartA", h: 114 },
        { i: "chartB", h: 114 },
        { i: "ranking", h: 115 },
        { i: "feed", h: 118 },
      ],
      3
    );
    const byId = Object.fromEntries(placed.map(p => [p.i, p]));
    // 前 3 张各占一列，同一行（y=0）
    expect(byId.chartA.y).toBe(0);
    expect(byId.chartB.y).toBe(0);
    expect(byId.ranking.y).toBe(0);
    expect(new Set([byId.chartA.x, byId.chartB.x, byId.ranking.x]).size).toBe(3);
    // 第 4 张落进最短的那一列（chartA 或 chartB 所在列），紧贴着上面卡片
    // 底部往上压实，不是另起一行留白。
    const feedCol = byId.feed.x;
    const aboveInSameCol = [byId.chartA, byId.chartB, byId.ranking].find(
      p => p.x === feedCol
    );
    expect(aboveInSameCol).toBeDefined();
    expect(byId.feed.y).toBe(aboveInSameCol!.y + aboveInSameCol!.h);
  });

  it("不产生卡片重叠", () => {
    const placed = autoPlaceGrid(
      [
        { i: "a", h: 200 },
        { i: "b", h: 80 },
        { i: "c", h: 150 },
        { i: "d", h: 60 },
        { i: "e", h: 120 },
      ],
      3
    );
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const sameCol = a.x === b.x;
        const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(sameCol && overlapY).toBe(false);
      }
    }
  });

  it("单列输入等价于简单顺序堆叠", () => {
    const placed = autoPlaceGrid(
      [
        { i: "a", h: 100 },
        { i: "b", h: 50 },
      ],
      1
    );
    const byId = Object.fromEntries(placed.map(p => [p.i, p]));
    expect(byId.a.y).toBe(0);
    expect(byId.b.y).toBe(100);
  });

  it("compactVertical 能把留了空档的初始布局压实", () => {
    // 手工构造一个"没有充分压实"的初始布局：b 明明可以往上贴到 a 底部，
    // 却留在更靠下的位置。
    const gapped = [
      { i: "a", x: 0, y: 0, w: 1, h: 50 },
      { i: "b", x: 0, y: 120, w: 1, h: 50 },
    ];
    const packed = compactVertical(gapped);
    const b = packed.find(p => p.i === "b")!;
    expect(b.y).toBe(50);
  });
});
