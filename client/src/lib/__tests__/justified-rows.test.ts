/**
 * 两端对齐行布局。
 *
 * 这些断言钉的是**设计稿那几条结构性质**，不是实现细节——只要这几条成立，
 * 排出来就是那个样子；反之改坏了立刻能看出来。
 */
import { describe, expect, it } from "vitest";

import { justifiedRows } from "../justified-rows";

/** 真实设备档的宽高比（与 AppRuntimeScreen 的 DEVICE_SPECS 同源） */
const DESKTOP = 1440 / 810; // 1.778
const PHONE = 390 / 844; //   0.462

const ar = (n: number) => ({ aspectRatio: n });

describe("justifiedRows", () => {
  it("同一行里所有卡片高度一致——这是「等高变宽」的定义", () => {
    const r = justifiedRows([DESKTOP, DESKTOP, PHONE, DESKTOP, PHONE, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 260,
    });
    const byRow = new Map<number, number[]>();
    for (const b of r.boxes) byRow.set(b.row, [...(byRow.get(b.row) ?? []), b.height]);
    for (const [row, heights] of byRow) {
      expect(new Set(heights).size, `第 ${row} 行高度不一致: ${heights}`).toBe(1);
    }
  });

  it("每一行正好铺满容器宽度（末行除外）——「两端对齐」的定义", () => {
    const r = justifiedRows(Array.from({ length: 11 }, (_, i) => ar(i % 3 === 0 ? PHONE : DESKTOP)), {
      containerWidth: 1400,
      targetRowHeight: 260,
      spacing: 12,
    });
    const rows = [...new Set(r.boxes.map(b => b.row))];
    const lastRow = Math.max(...rows);
    for (const row of rows) {
      if (row === lastRow) continue; // 末行允许留白
      const inRow = r.boxes.filter(b => b.row === row);
      const total =
        inRow.reduce((s, b) => s + b.width, 0) + (inRow.length - 1) * 12;
      expect(Math.abs(total - 1400), `第 ${row} 行没铺满: ${total}`).toBeLessThan(1);
    }
  });

  it("手机档（0.46）自动变窄竖条，桌面档（1.78）变宽幅——设计稿那两根窄列的来历", () => {
    // 设计稿里「待办事项」「消息中心」不是手工摆的窄列，是宽高比 0.46 的卡片
    // 落进等高行里的必然结果。这条断言就是钉这个因果。
    // 行高目标越小，一行装得越多——这里用 240 让手机档和桌面档落进同一行。
    // （原先写 300 时行在两张桌面卡处就封了，手机被推到下一行：那不是算法
    // 的问题，是我这条用例的参数选错了。）
    const r = justifiedRows([DESKTOP, DESKTOP, PHONE, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 240,
    });
    const first = r.boxes.filter(b => b.row === 0);
    expect(first.length, "手机档没落进第一行，这条用例的参数要重挑").toBeGreaterThanOrEqual(3);
    const phoneBox = first.find(b => b.aspectRatio === PHONE)!;
    const deskBox = first.find(b => b.aspectRatio === DESKTOP)!;
    expect(phoneBox.height).toBe(deskBox.height); // 等高
    expect(phoneBox.width).toBeLessThan(deskBox.width / 3); // 窄得多（1.778 / 0.462 ≈ 3.8）
  });

  it("行高在目标值附近浮动，不会离谱", () => {
    const r = justifiedRows(Array.from({ length: 20 }, (_, i) => ar(i % 4 === 0 ? PHONE : DESKTOP)), {
      containerWidth: 1400,
      targetRowHeight: 260,
      targetRowHeightTolerance: 0.25,
    });
    const rows = [...new Set(r.boxes.map(b => b.row))];
    const lastRow = Math.max(...rows);
    for (const h of r.rowHeights.slice(0, lastRow)) {
      expect(h).toBeGreaterThan(260 * 0.5);
      expect(h).toBeLessThan(260 * 2);
    }
  });

  it("单张超宽卡自己占一行，不会把别人挤变形", () => {
    const r = justifiedRows([ar(8), ar(DESKTOP), ar(DESKTOP)], {
      containerWidth: 1400,
      targetRowHeight: 260,
    });
    expect(r.boxes[0].row).toBe(0);
    expect(r.boxes.filter(b => b.row === 0)).toHaveLength(1);
  });

  it("末行不足时默认左对齐留白，不强行拉满（单张拉满会变成巨幅卡）", () => {
    const left = justifiedRows([DESKTOP, DESKTOP, DESKTOP, DESKTOP, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 260,
    });
    const justify = justifiedRows([DESKTOP, DESKTOP, DESKTOP, DESKTOP, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 260,
      lastRowBehavior: "justify",
    });
    const lastLeft = left.rowHeights.at(-1)!;
    const lastJustify = justify.rowHeights.at(-1)!;
    expect(lastLeft).toBe(260);
    expect(lastJustify).toBeGreaterThan(lastLeft);
  });

  it("空输入与零宽容器不炸", () => {
    expect(justifiedRows([], { containerWidth: 1400 }).boxes).toEqual([]);
    expect(justifiedRows([ar(DESKTOP)], { containerWidth: 0 }).boxes).toEqual([]);
  });

  it("卡片不重叠：同行左边界递增，行与行之间 top 递增", () => {
    const r = justifiedRows(Array.from({ length: 14 }, (_, i) => ar(i % 5 === 0 ? PHONE : DESKTOP)), {
      containerWidth: 1400,
      targetRowHeight: 260,
      spacing: 12,
    });
    for (const row of [...new Set(r.boxes.map(b => b.row))]) {
      const inRow = r.boxes.filter(b => b.row === row).sort((a, b) => a.left - b.left);
      for (let i = 1; i < inRow.length; i++) {
        expect(inRow[i].left).toBeGreaterThanOrEqual(inRow[i - 1].left + inRow[i - 1].width);
      }
    }
    const tops = r.rowHeights.map((_, i) => r.boxes.find(b => b.row === i)!.top);
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  });
});
