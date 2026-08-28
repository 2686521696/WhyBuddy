/**
 * 刀 2 几何的判据（2026-08-27）。
 *
 * 最要紧的一条是**块的左上角对到节点原点**——裁剪参数一改块就飘，而飘了
 * 之后画布上仍然是"一排卡片"，看着完全正常。这是刀 2 最该被变异咬住的地方。
 *
 * 2026-08-28 改成 √n 网格（抄 ComfyUI_frontend useArrangeNodes 的 arrangeGrid，
 * 本地 clone commit 5d24e4e），判据跟着它的三条要害走：
 *   · 列数 = ceil(sqrt(n))，不是一长条
 *   · 逐行取**最大视觉高**，视觉高含标签带
 *   · 摆完把标签带加回去换成内容坐标
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_CELL,
  chooseBlockGridColumns,
  MAX_BLOCK_COLS,
  blockGridExtraGapX,
  blockGridHeight,
  blockGridWidth,
  blockDetailZoomThreshold,
  layoutBlockNodes,
  shouldDrawBlockDetail,
  BLOCK_LABEL_FONT_PX,
  MIN_READABLE_FONT_PX,
  BLOCK_KIND_TINT,
  blockKindTint,
} from "../block-node-layout";
import { BLOCK_KINDS } from "../page-blocks";
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

describe("网格摆位", () => {
  it("⚠ 列数选到**装得进画板高度**为止，不是拍 √n", () => {
    /*
     * 2026-08-28 真机（4 页 15 块）量到的：
     *     画板行距          1312（1080 高 + 232 间距）
     *     远程审方页的网格   y 0 → 1832 —— 越过下一排画板 520
     * √n 只管形状方不方，不管跟画板比起来多高。溢出之后整张图在垂直方向
     * 被撑开，放大到工作档位看到的就是大片空白里几条线穿过。
     * 变异：改回 ceil(sqrt(n))，这条红。
     */
    const tall = Array.from({ length: 6 }, (_, i) =>
      rect(`b${i}`, 0, 0, 520, 520)
    );
    // 6 块 × (520+56) = 3456 > 1080，√6 = 3 列仍然 1152+ 高，得再加一列
    const cols = chooseBlockGridColumns(tall, 1080);
    const boxes = layoutBlockNodes({ ...BOARD, h: 1080 }, tall);
    const top = Math.min(...boxes.map(b => b.y - BLOCK_CELL.labelBand));
    const bottom = Math.max(...boxes.map(b => b.y + b.h));
    expect(bottom - top).toBeLessThanOrEqual(1080);
    expect(cols).toBeGreaterThan(Math.ceil(Math.sqrt(tall.length)) - 1);
  });

  it("块少且矮时就一列——不为了方而硬加列", () => {
    const few = [rect("甲", 0, 0, 520, 200)];
    expect(chooseBlockGridColumns(few, 1080)).toBe(1);
  });

  it("⚠ 列数有上限：块特别多也不许把右边那页推到天边", () => {
    // 装不下就如实溢出一点，不假装。
    const many = Array.from({ length: 60 }, (_, i) =>
      rect(`b${i}`, 0, 0, 520, 1200)
    );
    expect(chooseBlockGridColumns(many, 1080)).toBe(MAX_BLOCK_COLS);
  });

  it("空清单回 1 列，不炸也不回 0", () => {
    expect(chooseBlockGridColumns([], 1080)).toBe(1);
  });

  it("排在画板右侧，第一格与画板顶对齐（顶上留出标签带）", () => {
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 0, 0, 520, 260)]);
    expect(a.x).toBe(BOARD.x + BOARD.w + BLOCK_CELL.stripGap);
    // ⚠ 内容顶 = 视觉顶 + 标签带；视觉顶就是画板顶
    expect(a.y).toBe(BOARD.y);
    expect(a.w).toBe(BLOCK_CELL.width);
  });

  it("跟着画板**现在**的位置走（拖过之后块也跟着走）", () => {
    const moved = { ...BOARD, x: 5000, y: 7000 };
    const [a] = layoutBlockNodes(moved, [rect("甲", 0, 0, 520, 260)]);
    expect(a.x).toBe(5000 + BOARD.w + BLOCK_CELL.stripGap);
    expect(a.y).toBe(7000);
  });

  it("列与列之间横向间距是 gap", () => {
    /* ⚠ 得用**高到一列装不下**的块，才逼得出第二列——列数现在是按
       "装得进画板高度"选的，两块矮的会老老实实叠成一列。 */
    const boxes = layoutBlockNodes({ ...BOARD, h: 1080 }, [
      rect("甲", 0, 0, 440, 900),
      rect("乙", 0, 0, 440, 900),
    ]);
    expect(boxes[1].x - boxes[0].x).toBe(BLOCK_CELL.width + BLOCK_CELL.gap);
    expect(boxes[0].y).toBe(boxes[1].y);
  });

  it("⚠ 瀑布流：每块落进当前最矮的那一列（不是按行填）", () => {
    // 2026-08-28 用户要"自由散布"的观感。严格网格会让所有块顶边对齐成一条
    // 直线，那是"电子表格感"的来源。
    // 变异：改回按行填（col = i % cols），这条红。
    const boxes = layoutBlockNodes(BOARD, [
      rect("高", 0, 0, 520, 800), // 第 1 列，很高
      rect("矮", 0, 0, 520, 100), // 第 2 列
      rect("第三块", 0, 0, 520, 100),
    ]);
    // 3 块 → 2 列。第 3 块该落进**矮的那一列**（第 2 列），不是回到第 1 列
    expect(boxes[2].x).toBe(boxes[1].x);
    expect(boxes[2].x).not.toBe(boxes[0].x);
  });

  it("⚠ 同一列里，下一块的**视觉顶**接在上一块底下（含标签带）", () => {
    // 抄 ComfyUI `visualHeight = size + titleHeight` 的那条。
    // 变异：列高只累加内容高（去掉 labelBand），下一块的标签会叠在
    // 上一块的内容上——不报错，只是看着糊。
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 200),
      rect("乙", 0, 0, 520, 200),
      rect("丙", 0, 0, 520, 200),
      rect("丁", 0, 0, 520, 200),
    ]);
    // 4 块 → 2 列，同列的是 [甲, 丙] 和 [乙, 丁]
    const sameCol = boxes.filter(b => b.x === boxes[0].x);
    expect(sameCol.length).toBeGreaterThanOrEqual(2);
    const gapBetween = sameCol[1].y - (sameCol[0].y + sameCol[0].h);
    expect(gapBetween).toBe(BLOCK_CELL.gap + BLOCK_CELL.labelBand);
  });

  it("反向：块之间不许重叠（瀑布流最容易写坏的地方）", () => {
    const boxes = layoutBlockNodes(
      BOARD,
      Array.from({ length: 9 }, (_, i) =>
        rect(`b${i}`, 0, 0, 520, 100 + i * 90)
      )
    );
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        /* 视觉盒（含标签带）都不许相交 */
        const aTop = a.y - BLOCK_CELL.labelBand;
        const bTop = b.y - BLOCK_CELL.labelBand;
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        const overlapY = aTop < bTop + b.h + BLOCK_CELL.labelBand &&
          bTop < aTop + a.h + BLOCK_CELL.labelBand;
        expect(
          overlapX && overlapY,
          `${a.name} 和 ${b.name} 叠了`
        ).toBe(false);
      }
    }
  });

  it("确定性：同一份输入永远同一个结果（块不许在画布上跳）", () => {
    // 变异：用随机抖动做"自由散布"，这条红。
    const input = Array.from({ length: 7 }, (_, i) =>
      rect(`b${i}`, 0, 0, 520, 120 + i * 60)
    );
    const a = layoutBlockNodes(BOARD, input);
    const b = layoutBlockNodes(BOARD, input);
    expect(a).toEqual(b);
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
    expect(a.crop.scale).toBeCloseTo(BLOCK_CELL.width / 1040, 6);
    expect(a.h).toBeCloseTo(520 * (BLOCK_CELL.width / 1040), 6);
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
    // 原始 6:1 的长表格。画板给足够高，让高宽比那条成为生效的上限。
    const [a] = layoutBlockNodes(
      { ...BOARD, h: 4000 },
      [rect("长表", 0, 0, 400, 2400)]
    );
    expect(a.truncated).toBe(true);
    expect(a.h).toBe(BLOCK_CELL.width * BLOCK_CELL.maxAspect);
  });

  it("⚠ 单块高度也按**画板高度**封顶（否则永远装不进画板）", () => {
    /*
     * 2026-08-28 真机：一个长表格块自己就 440×2.4 = 1056 高，加标签带
     * 1112 > 画板 1080——那一页无论分几列都装不下，"列数选到装得下为止"
     * 这条规则永远达不成，网格照样溢出到下一排（量到 1832，越过 520）。
     * 变异：把这条上限去掉，只留高宽比，这条红。
     */
    const [a] = layoutBlockNodes(
      { ...BOARD, h: 1080 },
      [rect("长表", 0, 0, 400, 2400)]
    );
    expect(a.h).toBe(1080 - BLOCK_CELL.labelBand);
    expect(a.h).toBeLessThan(BLOCK_CELL.width * BLOCK_CELL.maxAspect);
    expect(a.truncated).toBe(true);
  });

  it("⚠ 选列数和摆位用**同一条**高度上限（不然选的时候以为装得下）", () => {
    const tall = Array.from({ length: 5 }, (_, i) =>
      rect(`b${i}`, 0, 0, 400, 2400)
    );
    const boxes = layoutBlockNodes({ ...BOARD, h: 1080 }, tall);
    const cols = chooseBlockGridColumns(tall, 1080);
    const top = Math.min(...boxes.map(b => b.y - BLOCK_CELL.labelBand));
    const bottom = Math.max(...boxes.map(b => b.y + b.h));
    // 5 块每块都顶满一列 → 需要 5 列，但封顶 4 列，如实溢出一点
    expect(cols).toBe(MAX_BLOCK_COLS);
    expect(bottom - top).toBeGreaterThan(0);
    // 每一块自己都不许超过画板高度
    for (const b of boxes) expect(b.h).toBeLessThanOrEqual(1080);
  });

  it("反向：没超的不许被标成截断", () => {
    // 变异：把 truncated 恒写 true，用户会看到每一块都挂"只显示上半截"，
    // 那是在谎报。
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 0, 0, 520, 260)]);
    expect(a.truncated).toBe(false);
  });

  it("截断**不压扁**：缩放比仍按宽度算，字不变形", () => {
    const [a] = layoutBlockNodes(BOARD, [rect("长表", 0, 0, 400, 2400)]);
    expect(a.crop.scale).toBeCloseTo(BLOCK_CELL.width / 400, 6);
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

  it("空块清单 → 网格高 0（不是一个标签带）", () => {
    // 多算一行会让外接盒每页虚高一截，「适应画布」跟着偏。
    expect(blockGridHeight([])).toBe(0);
  });

  it("网格高从**视觉顶**（首行标签上沿）量到末行底", () => {
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 260),
      rect("乙", 0, 0, 520, 520),
    ]);
    const top = Math.min(...boxes.map(b => b.y - BLOCK_CELL.labelBand));
    const bottom = Math.max(...boxes.map(b => b.y + b.h));
    expect(blockGridHeight(boxes)).toBe(bottom - top);
  });

  it("画板要多留的横向间距 = 间隙 + **块最多那页**的网格宽", () => {
    // 少留的话网格会盖住右边那列画板，而全景下只是"看着有点挤"，不报错。
    // 变异：按平均块数留，块多的那页照样盖住邻居。
    expect(blockGridExtraGapX(3)).toBe(BLOCK_CELL.stripGap + blockGridWidth(3));
    expect(blockGridExtraGapX(3)).toBeGreaterThan(blockGridExtraGapX(2));
    expect(blockGridExtraGapX(0)).toBe(0);
  });

  it("网格宽 = 列数 × 格宽 + 列间距", () => {
    expect(blockGridWidth(2)).toBe(2 * BLOCK_CELL.width + BLOCK_CELL.gap);
    expect(blockGridWidth(1)).toBe(BLOCK_CELL.width);
    expect(blockGridWidth(0)).toBe(0);
  });
});

describe("LOD：缩放太低就不画细节（抄 ComfyUI 的可读性反推）", () => {
  it("阈值是从字号反推的，不是拍的魔数", () => {
    // threshold = 最小可读字号 / (标签字号 * sqrt(DPR))
    expect(blockDetailZoomThreshold(1)).toBeCloseTo(
      MIN_READABLE_FONT_PX / BLOCK_LABEL_FONT_PX,
      6
    );
  });

  it("高 DPR 屏阈值更低（同样的缩放下字更清楚）", () => {
    // ComfyUI 注释里的原话：高 DPR 对可读性的提升不是线性的，用 sqrt 近似。
    expect(blockDetailZoomThreshold(2)).toBeLessThan(
      blockDetailZoomThreshold(1)
    );
    expect(blockDetailZoomThreshold(2)).toBeCloseTo(
      blockDetailZoomThreshold(1) / Math.SQRT2,
      6
    );
  });

  it("真机那两档：21% 全景不画细节，100% 画", () => {
    // 21% 时标签只有 11*0.21 ≈ 2.3px，糊成一片。
    expect(shouldDrawBlockDetail(0.21, 1)).toBe(false);
    expect(shouldDrawBlockDetail(1, 1)).toBe(true);
  });

  it("反向：阈值本身必须是个正数且小于 1（不然要么全关要么全开）", () => {
    const t = blockDetailZoomThreshold(1);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  it("DPR 传 0 / 负数不炸（当 1 处理）", () => {
    expect(blockDetailZoomThreshold(0)).toBe(blockDetailZoomThreshold(1));
    expect(blockDetailZoomThreshold(-3)).toBe(blockDetailZoomThreshold(1));
  });
});

describe("块类型底色（抄 ComfyUI 低质量档「保形状保颜色、只丢细节」）", () => {
  it("每一种块类型都有底色——不许有类型落到「没颜色」", () => {
    // 变异：删掉任意一档，这条红。缺色的那类在全景下会变回白方块。
    for (const k of BLOCK_KINDS) {
      expect(BLOCK_KIND_TINT[k], `缺 ${k} 的底色`).toBeDefined();
    }
  });

  it("认不出的类型回 card 那档，不回透明", () => {
    // "认不出类型"和"没有内容"是两回事；透明就是那片白方块。
    expect(blockKindTint("不存在的类型")).toEqual(BLOCK_KIND_TINT.card);
    expect(blockKindTint("")).toEqual(BLOCK_KIND_TINT.card);
  });

  it("反向：不同类型的底色互不相同（同色等于没分类）", () => {
    const fills = BLOCK_KINDS.map(k => BLOCK_KIND_TINT[k].fill);
    expect(new Set(fills).size).toBe(fills.length);
  });
});
