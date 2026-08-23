/**
 * 两端对齐行卡片墙（B 方案）的几何不变式。
 *
 * 跟 span-positioner 那份同一个取向：不测「长得好不好看」（那是截图的活），
 * 只测能用数学判定的硬约束。这类布局最容易出的不是排得难看，是**偶发重叠**——
 * 两张卡在某个宽高比组合下叠一起，肉眼要滚到那一屏才看得见。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { justifiedRows, aspectForDevice, DEVICE_ASPECT } from "@/lib/justified-rows";

const W = 1594;
const SP = 16;
/** 线上真实分布：桌面 30、手机 38（2026-08-23 查库）。 */
const REAL_MIX = [
  ...Array(30).fill("desktop"),
  ...Array(38).fill("phone"),
].map(d => ({ aspectRatio: aspectForDevice(d) }));

function layout(items = REAL_MIX, target = 200) {
  return justifiedRows(items, {
    containerWidth: W,
    targetRowHeight: target,
    spacing: SP,
    lastRowBehavior: "left",
  });
}

describe("两端对齐行的几何", () => {
  it("每一行都铺满容器宽度（最后一行除外）", () => {
    const res = layout();
    const rows = new Map<number, typeof res.boxes>();
    for (const b of res.boxes) {
      if (!rows.has(b.row)) rows.set(b.row, []);
      rows.get(b.row)!.push(b);
    }
    const lastRow = Math.max(...rows.keys());
    for (const [row, boxes] of rows) {
      if (row === lastRow) continue; // 最后一行左对齐留白，本来就不铺满
      const right = Math.max(...boxes.map(b => b.left + b.width));
      expect(Math.abs(right - W)).toBeLessThan(1.5);
    }
  });

  it("**任意两张卡不重叠**", () => {
    const res = layout();
    for (let i = 0; i < res.boxes.length; i++) {
      for (let j = i + 1; j < res.boxes.length; j++) {
        const a = res.boxes[i];
        const b = res.boxes[j];
        const hit =
          a.left < b.left + b.width &&
          b.left < a.left + a.width &&
          a.top < b.top + b.height &&
          b.top < a.top + a.height;
        expect(hit).toBe(false);
      }
    }
  });

  it("同一行里高度一致——这就是「等高变宽」的定义", () => {
    const res = layout();
    const byRow = new Map<number, Set<number>>();
    for (const b of res.boxes) {
      if (!byRow.has(b.row)) byRow.set(b.row, new Set());
      byRow.get(b.row)!.add(Math.round(b.height));
    }
    for (const hs of byRow.values()) expect(hs.size).toBe(1);
  });

  it("宽度按宽高比分：手机卡必然比同行的桌面卡窄", () => {
    const mixed = [
      { aspectRatio: DEVICE_ASPECT.desktop },
      { aspectRatio: DEVICE_ASPECT.phone },
      { aspectRatio: DEVICE_ASPECT.desktop },
    ];
    const res = justifiedRows(mixed, { containerWidth: W, targetRowHeight: 200, spacing: SP });
    expect(res.boxes[1].width).toBeLessThan(res.boxes[0].width);
    expect(res.boxes[1].width).toBeLessThan(res.boxes[2].width);
  });

  it("**同一份输入算两遍逐格相同** —— 纯函数，才敢每帧重算", () => {
    const a = layout();
    const b = layout();
    expect(a.boxes).toEqual(b.boxes);
    expect(a.containerHeight).toBe(b.containerHeight);
  });

  it("容器宽为 0 / 空列表不崩，返回空布局", () => {
    expect(justifiedRows(REAL_MIX, { containerWidth: 0 }).boxes).toEqual([]);
    expect(justifiedRows([], { containerWidth: W }).boxes).toEqual([]);
  });

  it("真实分布下的量纲跟效果图对得上（行高 200 档）", () => {
    const res = layout();
    const desktop = res.boxes.filter(b => b.aspectRatio > 1).map(b => Math.round(b.width));
    const phone = res.boxes.filter(b => b.aspectRatio < 1).map(b => Math.round(b.width));
    // 目标行高 200，为铺满会在 ±25% 容差内浮动，实测落在 235~237
    expect(Math.min(...res.rowHeights)).toBeGreaterThan(180);
    expect(Math.max(...res.rowHeights)).toBeLessThan(260);
    // 桌面卡明显比原来那版瀑布流的 306px 宽
    expect(Math.min(...desktop)).toBeGreaterThan(306);
    // 手机卡是窄条——这是明确取舍，钉住免得哪天被"顺手调宽"改掉
    expect(Math.max(...phone)).toBeLessThan(200);
  });
});

function stripped(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("接在活路径上", () => {
  it("墙用 justifiedRows，且视口裁切是纯的", () => {
    const src = stripped("../JustifiedWall.tsx");
    expect(src).toContain("justifiedRows");
    expect(src).toMatch(/layout\.boxes\.filter/);
    // ⚠ 存了"已渲染过"的状态，就把 2026-08-23 那个死锁请回来了
    //   （落位表是可变状态、丢了补不回来）。这条钉住它。
    expect(src).not.toContain("useState");
    expect(src).not.toContain("ResizeObserver");
  });

  it("窄卡收起指标行——110px 里放不下三个徽标加状态", () => {
    const src = stripped("../AppsWorkbench.tsx");
    expect(src).toMatch(/const compact = cellW < 200/);
    expect(src).toContain("compact={compact}");
    expect(src).toMatch(/compact \? null : metrics/);
  });
});
