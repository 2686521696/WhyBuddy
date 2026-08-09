/**
 * 对齐分行（2026-08-09）。
 *
 * 移植自 `igordanchenko/react-photo-album` 的 `layouts/rows/rows.ts`，多一条
 * 原实现没有的约束：缩放上下限。
 *
 * 钉的是**不变量**，不是某一版的具体排布：
 *   · 非末行正好铺满整宽（这是"等比缩放填满"的定义）
 *   · 末行不铺满（"铺满"与"缩放有上限"在末行天然冲突，不特殊处理会整体无解）
 *   · 每张卡的缩放都在范围内（越界的排法判不可行，不是事后钳）
 *   · 一张不多一张不少、顺序不变（分行只决定断点，不重排内容）
 */

import { describe, expect, it } from "vitest";
import { layoutJustifiedRows, type JustifiedItem, type JustifiedOptions } from "../justified-rows";

const BASE: JustifiedOptions = {
  containerWidth: 1200,
  spacing: 16,
  targetRowHeight: 340,
  // 真实数据需要这么宽才有解——见 justified-rows.ts 顶部那张实测表
  minScale: 0.15,
  maxScale: 2.0,
  designWidth: 420,
};

/** 造一批卡：给自然高度，宽高比按设计宽度算，跟真实链路一致。 */
const items = (...heights: number[]): JustifiedItem[] =>
  heights.map(h => ({ ratio: BASE.designWidth / h }));

/** 按 top 还原成"行"。 */
function rowsOf(placed: readonly { top: number; left: number; width: number; index: number }[]) {
  const byTop = new Map<number, typeof placed[number][]>();
  for (const p of placed) {
    const k = Math.round(p.top);
    byTop.set(k, [...(byTop.get(k) ?? []), p]);
  }
  return [...byTop.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => [...v].sort((a, b) => a.left - b.left));
}

describe("非末行正好铺满整宽", () => {
  it("行内各卡宽度 + 间距 == 容器宽", () => {
    const out = layoutJustifiedRows(items(400, 520, 300, 460, 380, 610, 340, 500), BASE);
    expect(out).not.toBeNull();
    const rows = rowsOf(out!.placed);
    for (const row of rows.slice(0, -1)) {
      const used = row.reduce((s, p) => s + p.width, 0) + (row.length - 1) * BASE.spacing;
      expect(used).toBeCloseTo(BASE.containerWidth, 6);
    }
  });

  it("末行不铺满 —— 铺满会把最后一张拉到整容器宽，必然越界、整体无解", () => {
    const out = layoutJustifiedRows(items(400, 520, 300, 460, 380), BASE)!;
    const last = rowsOf(out.placed).at(-1)!;
    const used = last.reduce((s, p) => s + p.width, 0) + (last.length - 1) * BASE.spacing;
    expect(used).toBeLessThanOrEqual(BASE.containerWidth + 1e-6);
  });

  it("同一行里所有卡等高 —— 等比缩放的必然结果", () => {
    const out = layoutJustifiedRows(items(400, 520, 300, 460, 380, 610), BASE)!;
    for (const row of rowsOf(out.placed)) {
      const hs = row.map(p => (p as unknown as { height: number }).height);
      for (const h of hs) expect(h).toBeCloseTo(hs[0], 6);
    }
  });
});

describe("缩放约束", () => {
  it("每张卡的 scale 都落在 [minScale, maxScale] 内", () => {
    const out = layoutJustifiedRows(items(300, 700, 420, 550, 380, 480, 640, 360), BASE)!;
    for (const p of out.placed) {
      expect(p.scale).toBeGreaterThanOrEqual(BASE.minScale - 1e-9);
      expect(p.scale).toBeLessThanOrEqual(BASE.maxScale + 1e-9);
    }
  });

  it("scale 与几何自洽：width === designWidth × scale", () => {
    const out = layoutJustifiedRows(items(400, 520, 300, 460), BASE)!;
    for (const p of out.placed) expect(p.width).toBeCloseTo(BASE.designWidth * p.scale, 6);
  });

  it("范围收到不可能满足时如实返回 null，不硬排一个越界的版面", () => {
    expect(
      layoutJustifiedRows(items(400, 520, 300, 460, 380), { ...BASE, minScale: 0.999, maxScale: 1.001 })
    ).toBeNull();
  });

  it("不可行不单调 —— 张数变多反而可行时不能漏掉", () => {
    // 原实现在不可行时 break（它唯一的不可行原因"行高≤0"随张数单调）。
    // 我们多了缩放越界，它不单调：张数多 → 行高低 → 缩放可能重回范围。
    const out = layoutJustifiedRows(items(900, 880, 920, 860, 900, 890, 910, 870), {
      ...BASE,
      targetRowHeight: 200,
    });
    expect(out, "本可排出却返回 null —— 大概率是 break 提前截断").not.toBeNull();
  });
});

describe("不增不减、不重排", () => {
  it("每张卡出现且只出现一次，顺序与入参一致", () => {
    const input = items(400, 520, 300, 460, 380, 610, 340, 500, 430);
    const out = layoutJustifiedRows(input, BASE)!;
    expect(out.placed).toHaveLength(input.length);
    expect(out.placed.map(p => p.index)).toEqual(input.map((_, i) => i));
  });

  it("行内从左到右、行与行从上到下，都是原顺序", () => {
    const out = layoutJustifiedRows(items(400, 520, 300, 460, 380, 610, 340), BASE)!;
    const flat = rowsOf(out.placed).flat().map(p => p.index);
    expect(flat).toEqual([...flat].sort((a, b) => a - b));
  });
});

describe("边界", () => {
  it("空输入", () => {
    expect(layoutJustifiedRows([], BASE)).toEqual({ placed: [], totalHeight: 0 });
  });

  it("单张卡自成一行，且不被拉到整容器宽", () => {
    const out = layoutJustifiedRows(items(420), BASE)!;
    expect(out.placed).toHaveLength(1);
    expect(out.placed[0].width).toBeLessThanOrEqual(BASE.containerWidth);
    expect(out.placed[0].scale).toBeLessThanOrEqual(BASE.maxScale + 1e-9);
  });

  it("脏输入如实返回 null，不抛 —— 高度是量出来的，量不到就是 0", () => {
    for (const bad of [[{ ratio: 0 }], [{ ratio: -1 }], [{ ratio: NaN }]] as JustifiedItem[][]) {
      expect(() => layoutJustifiedRows(bad, BASE)).not.toThrow();
      expect(layoutJustifiedRows(bad, BASE)).toBeNull();
    }
    expect(layoutJustifiedRows(items(400), { ...BASE, containerWidth: 0 })).toBeNull();
  });

  it("maxPerRow 生效", () => {
    const out = layoutJustifiedRows(items(...Array(12).fill(420)), { ...BASE, maxPerRow: 2 })!;
    for (const row of rowsOf(out.placed)) expect(row.length).toBeLessThanOrEqual(2);
  });

  it("totalHeight 覆盖到最后一行底边", () => {
    const out = layoutJustifiedRows(items(400, 520, 300, 460, 380, 610), BASE)!;
    const bottom = Math.max(...out.placed.map(p => p.top + p.height));
    expect(out.totalHeight).toBeCloseTo(bottom, 6);
  });
});

describe("确定性", () => {
  it("同样的输入永远给同样的结果 —— 死区就是为这个加的", () => {
    const input = items(400, 520, 300, 460, 380, 610, 340, 500);
    const a = layoutJustifiedRows(input, BASE)!;
    for (let i = 0; i < 5; i++) expect(layoutJustifiedRows(input, BASE)).toEqual(a);
  });
});
