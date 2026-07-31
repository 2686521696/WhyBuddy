/**
 * 跨列定位器的几何不变式。
 *
 * 这类布局代码最容易出的不是"算得不好看"，是**偶发重叠**——两张卡在某个高度
 * 组合下叠到一起，肉眼要滚到那一屏才看得见，截图还不一定截得到。所以这里不测
 * "长得对不对"（那是截图的活），只测几条能用数学判定的硬约束：不重叠、不越界、
 * 跨列真的抬起了每一列。
 */

import { describe, it, expect } from "vitest";
import { createSpanPositioner, bestSpanStart } from "../span-positioner";

const W = 100;
const G = 10;

function make(columnCount: number, getSpan: (i: number) => number) {
  return createSpanPositioner({
    columnCount,
    columnWidth: W,
    columnGutter: G,
    rowGutter: G,
    getSpan,
  });
}

/** 两个矩形是否相交（共边不算）。 */
function overlaps(
  a: { top: number; left: number; width: number; height: number },
  b: { top: number; left: number; width: number; height: number }
) {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

function assertNoOverlap(items: ReturnType<ReturnType<typeof make>["all"]>) {
  const real = items.filter(Boolean);
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      expect(
        overlaps(real[i], real[j]),
        `#${i} ${JSON.stringify(real[i])} 与 #${j} ${JSON.stringify(real[j])} 重叠`
      ).toBe(false);
    }
  }
}

describe("createSpanPositioner", () => {
  it("全单列时与 masonic 原生一致：落最矮列", () => {
    const p = make(3, () => 1);
    p.set(0, 100);
    p.set(1, 50);
    p.set(2, 30);
    // 三列铺满后，第四个应落到最矮的第 2 列（30）
    p.set(3, 10);
    expect(p.get(3)!.column).toBe(2);
    expect(p.get(3)!.top).toBe(30 + G);
    expect(p.get(3)!.width).toBe(W);
  });

  it("跨列卡的宽度含中间的沟槽", () => {
    const p = make(4, i => (i === 0 ? 2 : 1));
    p.set(0, 100);
    expect(p.get(0)!.width).toBe(W * 2 + G);
    expect(p.get(0)!.span).toBe(2);
  });

  it("跨列卡把跨到的每一列都抬到同一高度", () => {
    const p = make(3, i => (i === 0 ? 1 : 2));
    p.set(0, 100); // 落第 0 列
    p.set(1, 40); // 跨 2 列
    const spanItem = p.get(1)!;
    // 跨列后，被跨的两列高度必须一致（否则后续单列卡会插进缝里造成重叠）
    const next = spanItem.top + spanItem.height + G;
    p.set(2, 10);
    p.set(3, 10);
    p.set(4, 10);
    assertNoOverlap(p.all());
    // 被跨的两列此时起点相同
    const tops = [p.get(2)!, p.get(3)!, p.get(4)!].map(x => x.top);
    expect(Math.max(...tops)).toBeGreaterThanOrEqual(next - 1);
  });

  it("首行的跨列卡靠左对齐，不在第一排留洞", () => {
    const p = make(4, i => (i === 0 ? 2 : 1));
    p.set(0, 80);
    expect(p.get(0)!.column).toBe(0);
    expect(p.get(0)!.left).toBe(0);
  });

  it("span 超过列数时钳回列数，不画到容器外", () => {
    const p = make(2, () => 5);
    p.set(0, 50);
    const it = p.get(0)!;
    expect(it.span).toBe(2);
    expect(it.left + it.width).toBe(W * 2 + G);
  });

  it("单列容器上跨列自动退回一列", () => {
    const p = make(1, () => 2);
    p.set(0, 50);
    p.set(1, 50);
    expect(p.get(0)!.span).toBe(1);
    expect(p.get(0)!.width).toBe(W);
    assertNoOverlap(p.all());
  });

  it("混合跨列 + 随机高度：50 个格子无重叠、不越界", () => {
    const columnCount = 5;
    // 确定性伪随机：失败能复现
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const spans = Array.from({ length: 50 }, () => (rand() < 0.25 ? 2 : 1));
    const p = make(columnCount, i => spans[i]);
    for (let i = 0; i < 50; i++) p.set(i, Math.round(100 + rand() * 500));
    assertNoOverlap(p.all());
    const maxRight = W * columnCount + G * (columnCount - 1);
    for (const it of p.all()) {
      expect(it.left).toBeGreaterThanOrEqual(0);
      expect(it.left + it.width).toBeLessThanOrEqual(maxRight);
    }
  });

  it("update 改高之后仍然无重叠（跨列卡改高会横向扩散，这里是全量重排的理由）", () => {
    const p = make(4, i => (i % 4 === 0 ? 2 : 1));
    for (let i = 0; i < 20; i++) p.set(i, 100);
    // 把两张跨列卡和几张单列卡改高
    p.update([0, 400, 4, 30, 7, 250, 12, 90]);
    assertNoOverlap(p.all());
    expect(p.get(0)!.height).toBe(400);
    expect(p.get(4)!.height).toBe(30);
  });

  it("update 之后 size 不变（重排不能丢格子）", () => {
    const p = make(3, i => (i === 1 ? 2 : 1));
    for (let i = 0; i < 9; i++) p.set(i, 100);
    const before = p.size();
    p.update([1, 300]);
    expect(p.size()).toBe(before);
  });

  it("range 只回视口内的格子", () => {
    const p = make(2, () => 1);
    for (let i = 0; i < 10; i++) p.set(i, 100);
    const hit: number[] = [];
    p.range(0, 150, idx => hit.push(idx));
    // 前两行落在 0~150 内，第三行 top=220 不该命中
    expect(hit).toContain(0);
    expect(hit).toContain(1);
    expect(hit).not.toContain(6);
  });

  it("estimateHeight 对未量到的格子按默认高度补", () => {
    const p = make(2, () => 1);
    p.set(0, 100);
    p.set(1, 100);
    // 已量 2 个，总共 6 个 → 还有 4 个 = 2 行 × 默认高
    expect(p.estimateHeight(6, 50)).toBe(110 + 2 * 50);
    expect(p.estimateHeight(2, 50)).toBe(110);
  });
});

describe("bestSpanStart", () => {
  it("先比落位后的 top（窗口内最大值），不是先比空白", () => {
    // 窗口 [0,100]→top 100、[100,110]→top 110、[110,20]→top 110
    // 按空白算会选 index 1（空白 10，最平）；按 top 算选 index 0（落得最高）。
    // 选 top 是量过的决定，理由见 bestSpanStart 的文档。
    expect(bestSpanStart([0, 100, 110, 20], 2)).toBe(0);
  });

  it("top 并列时才用空白破平", () => {
    // [50,50]→top 50 空白 0；[50,50] 之后 [50,10]→top 50 空白 40
    // 两个窗口 top 都是 50，取空白小的 index 0
    expect(bestSpanStart([50, 50, 10], 2)).toBe(0);
  });

  it("span=1 时退化成最矮列（与 masonic 原生逐字一致）", () => {
    expect(bestSpanStart([100, 30, 80], 1)).toBe(1);
    expect(bestSpanStart([0, 0, 0], 1)).toBe(0);
  });

  it("首行（全 0）时取最左，不需要特例分支", () => {
    expect(bestSpanStart([0, 0, 0, 0], 2)).toBe(0);
  });

  it("只有部分列为 0 时选全 0 的那个窗口", () => {
    // [50,0]→top 50、[0,0]→top 0、[0,80]→top 80
    expect(bestSpanStart([50, 0, 0, 80], 2)).toBe(1);
  });

  it("跨列卡不会全部堆在最左边（反馈环回归）", () => {
    // 纯空白规则下，跨列卡把两列设成完全相等 → "最平窗口"永远是这一对 →
    // 后续每张跨列卡都落回 left=0。实测 10 张全在第 0 列。这里钉住不再复发。
    const CC = 5;
    const heights = new Array(CC).fill(0);
    const starts: number[] = [];
    for (let i = 0; i < 24; i++) {
      const span = i % 3 === 0 ? 2 : 1;
      const s = bestSpanStart(heights, span);
      if (span === 2) starts.push(s);
      let top = heights[s];
      for (let j = s + 1; j < s + span; j++) if (heights[j] > top) top = heights[j];
      for (let j = s; j < s + span; j++) heights[j] = top + 234 + 16;
    }
    expect(new Set(starts).size).toBeGreaterThan(1);
  });
});
