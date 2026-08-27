/**
 * 刀 2 几何的判据（2026-08-27）。
 *
 * 最要紧的一条是**块的左上角对到节点原点**——裁剪参数一改块就飘，而飘了
 * 之后画布上仍然是"一排卡片"，看着完全正常。这是刀 2 最该被变异咬住的地方。
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_STRIP,
  BLOCK_STRIP_EXTRA_GAP_X,
  blockStripHeight,
  layoutBlockNodes,
} from "../block-node-layout";
import type { BlockRect } from "../block-rects";

const BOARD = { pageId: "p1", x: 100, y: 200, w: 1920, h: 1080 };

function rect(
  name: string,
  left: number,
  top: number,
  width: number,
  height: number
): BlockRect {
  return {
    name,
    kind: "card",
    label: name,
    kindLabel: "卡片",
    rect: { left, top, width, height },
  };
}

describe("条带摆位", () => {
  it("排在画板右侧，第一块与画板顶对齐", () => {
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 0, 0, 520, 260)]);
    expect(a.x).toBe(BOARD.x + BOARD.w + BLOCK_STRIP.gap);
    expect(a.y).toBe(BOARD.y);
    expect(a.w).toBe(BLOCK_STRIP.width);
  });

  it("跟着画板**现在**的位置走（拖过之后块也跟着走）", () => {
    // 变异：改成从原始网格算，这条红。真机表现是拖走画板，块留在原地。
    const moved = { ...BOARD, x: 5000, y: 7000 };
    const [a] = layoutBlockNodes(moved, [rect("甲", 0, 0, 520, 260)]);
    expect(a.x).toBe(5000 + BOARD.w + BLOCK_STRIP.gap);
    expect(a.y).toBe(7000);
  });

  it("依次往下摞，块之间留 vGap", () => {
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 520),
      rect("乙", 0, 300, 520, 520),
    ]);
    expect(boxes[1].y).toBe(boxes[0].y + boxes[0].h + BLOCK_STRIP.vGap);
  });

  it("矮块按 minRow 兜底步距——标签是反缩放的，会互相压住", () => {
    // 真机（17% 全景）量到过：矮块步距只有 15 屏幕像素，一列标签糊成一片，
    // 而每个节点各自渲染正常、无报错。
    const boxes = layoutBlockNodes(BOARD, [
      rect("矮", 0, 0, 5200, 200), // 缩放后只有 20 高
      rect("乙", 0, 0, 520, 520),
    ]);
    expect(boxes[0].h).toBeLessThan(BLOCK_STRIP.minRow);
    expect(boxes[1].y - boxes[0].y).toBe(BLOCK_STRIP.minRow + BLOCK_STRIP.vGap);
  });

  it("反向：兜底撑的是**间距**，节点高度不许被抬高", () => {
    // 变异：把 h 直接抬到 minRow，矮块的裁剪窗口会比块本身大，
    // 露出下面那块的半截内容——用户会以为块划错了，比标签重叠更糟。
    const [a] = layoutBlockNodes(BOARD, [rect("矮", 0, 0, 5200, 200)]);
    expect(a.h).toBeCloseTo(200 * (BLOCK_STRIP.width / 5200), 6);
    expect(a.h).not.toBe(BLOCK_STRIP.minRow);
  });

  it("键是跨页唯一的（含 pageId）", () => {
    const a = layoutBlockNodes(BOARD, [rect("统计概览", 0, 0, 100, 100)])[0];
    const b = layoutBlockNodes({ ...BOARD, pageId: "p2" }, [
      rect("统计概览", 0, 0, 100, 100),
    ])[0];
    expect(a.key).not.toBe(b.key);
  });
});

describe("⚠ 裁剪：块的左上角必须对到节点原点", () => {
  it("按宽度铺满条带，缩放比 = 条带宽 / 块宽", () => {
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 260, 130, 1040, 520)]);
    expect(a.crop.scale).toBeCloseTo(BLOCK_STRIP.width / 1040, 6);
    expect(a.h).toBeCloseTo(520 * (BLOCK_STRIP.width / 1040), 6);
  });

  it("位移是**设计坐标**（CSS 的 scale 会替我们乘，这里不许先乘一遍）", () => {
    // 变异：crop.left 写成 b.rect.left * scale（乘两次），块会飘到左上角外面。
    // 消费侧是 `scale(s) translate(-left, -top)`，CSS 先 translate 再 scale。
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 260, 130, 1040, 520)]);
    expect(a.crop.left).toBe(260);
    expect(a.crop.top).toBe(130);
  });

  it("反向：块在页面原点时位移就是 0（别硬加偏移）", () => {
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 0, 0, 1040, 520)]);
    expect(a.crop.left).toBe(0);
    expect(a.crop.top).toBe(0);
  });

  it("整页缩放后，那一块正好落在洞口 —— 逐数对账", () => {
    // 把裁剪参数当成"整页缩放 scale 后左上挪 (left, top)"来算一遍，
    // 检查块的四个角是否落在 [0,w]×[0,h] 上。这条是上面几条的合并对账。
    const r = rect("甲", 300, 600, 800, 400);
    const [a] = layoutBlockNodes(BOARD, [r]);
    const { scale, left, top } = a.crop;
    /* 按消费侧那条公式复算：scale(s) translate(-left,-top) 之后，
       块的左上角落在 (rect.left - left) * s。 */
    const blockLeftInNode = (r.rect.left - left) * scale;
    const blockTopInNode = (r.rect.top - top) * scale;
    expect(blockLeftInNode).toBeCloseTo(0, 6);
    expect(blockTopInNode).toBeCloseTo(0, 6);
    expect(r.rect.width * scale).toBeCloseTo(a.w, 6);
    expect(r.rect.height * scale).toBeCloseTo(a.h, 6);
  });
});

describe("长块截断", () => {
  it("超过高宽比上限就截断，并如实标记", () => {
    // 原始 6:1 的长表格
    const [a] = layoutBlockNodes(BOARD, [rect("长表", 0, 0, 400, 2400)]);
    expect(a.truncated).toBe(true);
    expect(a.h).toBe(BLOCK_STRIP.width * BLOCK_STRIP.maxAspect);
  });

  it("反向：没超的不许被标成截断", () => {
    // 变异：把 truncated 恒写 true，用户会看到每一块都挂"只显示上半截"，
    // 那是在谎报。
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 0, 0, 520, 260)]);
    expect(a.truncated).toBe(false);
  });

  it("截断**不压扁**：缩放比仍按宽度算，字不变形", () => {
    const [a] = layoutBlockNodes(BOARD, [rect("长表", 0, 0, 400, 2400)]);
    expect(a.crop.scale).toBeCloseTo(BLOCK_STRIP.width / 400, 6);
  });
});

describe("反向判据", () => {
  it("塌成 0 的块不进条带（跟量测那一侧同一条规则）", () => {
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 260),
      rect("塌了", 0, 0, 0, 0),
    ]);
    expect(boxes.map(b => b.name)).toEqual(["甲"]);
  });

  it("画板尺寸为 0 时回空数组，不抛也不算出 NaN", () => {
    expect(layoutBlockNodes({ ...BOARD, w: 0 }, [rect("甲", 0, 0, 1, 1)])).toEqual(
      []
    );
  });

  it("空块清单 → 条带高 0（不是一个 vGap）", () => {
    // 多算一个间距会让外接盒每页虚高一截，「适应画布」跟着偏。
    expect(blockStripHeight([])).toBe(0);
  });

  it("条带高 = 首块顶到末块底", () => {
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 260),
      rect("乙", 0, 0, 520, 520),
    ]);
    expect(blockStripHeight(boxes)).toBe(
      boxes[1].y + boxes[1].h - boxes[0].y
    );
  });

  it("开条带时画板要多留的横向间距 = 间隙 + 条带宽", () => {
    // 少留的话条带会盖住右边那列画板，而全景下只是"看着有点挤"，不报错。
    expect(BLOCK_STRIP_EXTRA_GAP_X).toBe(BLOCK_STRIP.gap + BLOCK_STRIP.width);
  });
});
