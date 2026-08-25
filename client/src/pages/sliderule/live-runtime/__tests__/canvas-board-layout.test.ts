/**
 * 画布档的几何判据。
 *
 * 这些判据都是**照着真机踩到的那次翻车**写的，不是"覆盖一下函数"。每条都
 * 试过把修复改回去确认它变红（本仓第二条纪律）。改这个文件之前先读
 * canvas-board-layout.ts 的头注。
 */
import { describe, expect, it } from "vitest";

import {
  BOARD_GAP,
  LABEL_BAND,
  MAX_ZOOM,
  MIN_ZOOM,
  artboardLabel,
  boardColumns,
  boardsBounds,
  boxToScreen,
  containScale,
  gridAspect,
  labelCounterScale,
  labelMaxCssWidth,
  layoutArtboards,
  pickLinkSides,
  shouldMountBoard,
  SPOTLIGHT_REST,
  spotlightAnchor,
} from "../canvas-board-layout";

const DESKTOP = { w: 1920, h: 1080 };
const PHONE = { w: 390, h: 844 };
const pages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ pageId: `p${i + 1}` }));

describe("排版顺序", () => {
  it("画板次序就是 pages 的次序（跟页面档同一个导航序）", () => {
    const boxes = layoutArtboards(pages(5), DESKTOP, 1);
    expect(boxes.map(b => b.pageId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("行优先铺开：同一行 y 相同、x 递增；换行 y 增加", () => {
    const boxes = layoutArtboards(pages(5), DESKTOP, 2.4); // 宽舞台 → 3 列
    expect(boxes.filter(b => b.y === boxes[0]!.y)).toHaveLength(3);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
    expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes[3]!.x).toBe(boxes[0]!.x);
  });

  it("画板尺寸恒等于设计分辨率原值——画布上不做第二级缩放", () => {
    for (const b of layoutArtboards(pages(4), DESKTOP)) {
      expect(b.w).toBe(1920);
      expect(b.h).toBe(1080);
    }
  });

  it("上下两排之间的净空装得下标题条", () => {
    // 标题条画在画板**上方** LABEL_BAND 高的位置。行距小于它，
    // 上一排的画板底边就会压住下一排的标题。
    expect(BOARD_GAP.desktop.y).toBeGreaterThanOrEqual(LABEL_BAND);
    expect(BOARD_GAP.phone.y).toBeGreaterThanOrEqual(LABEL_BAND);
  });
});

describe("列数按容器长宽比选（2026-08-25 真机 12% 那次）", () => {
  /**
   * 真机现场：舞台 805×829（对话栏占掉左半屏），5 页桌面稿。
   * 写死 3 列时 fitView 给出 12%，五块画板挤在上半部分、下面空一整屏。
   */
  const NARROW = { width: 805, height: 829 };

  it("接近正方形的舞台上选 2 列，不是写死的 3 列", () => {
    expect(boardColumns(5, DESKTOP, NARROW.width / NARROW.height)).toBe(2);
  });

  it("宽舞台上仍然摊成 3 列（不是一律收窄）", () => {
    expect(boardColumns(5, DESKTOP, 2.4)).toBe(3);
  });

  it("**看得更大**：按长宽比选的列数，contain 缩放严格大于写死 3 列", () => {
    // 这条是这次改动的真正判据——列数选得"对"没有意义，看得更大才有。
    const chosen = layoutArtboards(
      pages(5),
      DESKTOP,
      NARROW.width / NARROW.height
    );
    const fixed3 = layoutArtboards(pages(5), DESKTOP, 2.4); // 3 列
    const sChosen = containScale(chosen, NARROW);
    const sFixed = containScale(fixed3, NARROW);
    expect(sChosen).toBeGreaterThan(sFixed);
    // 真机量到的量级：12% → 19%。放宽到 1.4 倍留余量，但不能放到"随便就过"。
    expect(sChosen / sFixed).toBeGreaterThan(1.4);
  });

  it("列数不会超过页数（3 页不会排出 5 列的空位）", () => {
    expect(boardColumns(3, DESKTOP, 8)).toBeLessThanOrEqual(3);
    expect(boardColumns(1, DESKTOP, 8)).toBe(1);
  });

  it("还没量到容器尺寸时给出可用的兜底排布，不炸也不塌成一列", () => {
    expect(boardColumns(5, DESKTOP, undefined)).toBe(3);
    expect(boardColumns(5, DESKTOP, 0)).toBe(3);
    expect(boardColumns(5, PHONE, undefined)).toBe(5);
  });

  it("gridAspect：列数越多外接盒越宽", () => {
    const g = BOARD_GAP.desktop;
    expect(gridAspect(6, 3, DESKTOP, g)).toBeGreaterThan(
      gridAspect(6, 2, DESKTOP, g)
    );
  });
});

describe("外接盒含标题条", () => {
  it("顶上要多留出 LABEL_BAND，否则适应画布会把第一排的标题切掉", () => {
    const boxes = layoutArtboards(pages(2), DESKTOP, 2.4);
    const b = boardsBounds(boxes);
    expect(b.y).toBe(-LABEL_BAND);
    expect(b.h).toBe(1080 + LABEL_BAND);
  });

  it("空清单不炸", () => {
    expect(boardsBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(containScale([], { width: 800, height: 600 })).toBe(0);
  });
});

describe("屏幕坐标与挂载剔除", () => {
  const box = { pageId: "p1", x: 0, y: 0, w: 1920, h: 1080 };
  const size = { width: 800, height: 600 };

  it("先缩放再平移（跟 React Flow 的 transform 同一个次序）", () => {
    const s = boxToScreen(
      { ...box, x: 100, y: 50 },
      { x: 30, y: 10, zoom: 0.5 }
    );
    expect(s).toEqual({ left: 80, top: 35, width: 960, height: 540 });
  });

  it("视口里的画板要挂", () => {
    expect(shouldMountBoard(box, { x: 0, y: 0, zoom: 0.3 }, size)).toBe(true);
  });

  it("远在视口外的画板不挂", () => {
    expect(shouldMountBoard(box, { x: -20000, y: 0, zoom: 0.3 }, size)).toBe(
      false
    );
  });

  it("刚出视口但在余量内的仍然挂——慢速平移不该看到白板闪", () => {
    // 画板右边缘停在视口左侧 300px 处：出界了，但在 MOUNT_MARGIN(600) 内。
    const vp = { x: -1920 * 0.3 - 300, y: 0, zoom: 0.3 };
    expect(boxToScreen(box, vp).left + 1920 * 0.3).toBeLessThan(0);
    expect(shouldMountBoard(box, vp, size)).toBe(true);
  });

  it("容器还没量到尺寸时不挂（fitView 之前别抢着加载 iframe）", () => {
    expect(
      shouldMountBoard(box, { x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 })
    ).toBe(false);
  });
});

describe("标题反缩放", () => {
  it("缩到很小时把标题放大回可读——屏幕尺寸近似恒定", () => {
    for (const zoom of [0.2, 0.5, 1, 1.8]) {
      const onScreen = 13 * zoom * labelCounterScale(zoom);
      expect(onScreen).toBeGreaterThan(6);
      expect(onScreen).toBeLessThan(30);
    }
  });

  it("夹上限：缩到 5% 时标题不会比画板还大", () => {
    expect(labelCounterScale(0.05)).toBe(6);
    expect(labelCounterScale(MIN_ZOOM)).toBeLessThanOrEqual(6);
  });

  it("zoom 为 0 / 负数不返回 Infinity", () => {
    expect(labelCounterScale(0)).toBe(1);
    expect(labelCounterScale(-1)).toBe(1);
  });

  it("缩放上下限本身是合理的", () => {
    expect(MIN_ZOOM).toBeGreaterThan(0);
    expect(MAX_ZOOM).toBeGreaterThan(1);
  });
});

describe("画板标题的两条来源（第四条纪律：别只补一条）", () => {
  it("落库那条：用导航里的人话名", () => {
    expect(artboardLabel({ pageId: "p1", name: "团长工作台" })).toBe(
      "团长工作台"
    );
  });

  it("SSE 那条没有 name：从 HTML 的 <title> 扒出来，不能露出 p1", () => {
    // 推演中走 spec_page 事件的页面只有 pageId/html——这条一旦没有，
    // 跑的过程中满屏 p1 p2 p3，跑完刷新才突然变中文。
    const html =
      "<!DOCTYPE html><html><head><title>订单核销页</title></head><body>x</body></html>";
    expect(artboardLabel({ pageId: "p3", html })).toBe("订单核销页");
  });

  it("name 优先于 <title>", () => {
    expect(
      artboardLabel({ pageId: "p1", name: "甲", html: "<title>乙</title>" })
    ).toBe("甲");
  });

  it("两条都没有才退回 pageId（如实，不编）", () => {
    expect(artboardLabel({ pageId: "p9" })).toBe("p9");
    expect(
      artboardLabel({ pageId: "p9", name: "   ", html: "<title> </title>" })
    ).toBe("p9");
  });

  it("多行 <title> 与属性写法都认", () => {
    expect(
      artboardLabel({
        pageId: "p1",
        html: '<title lang="zh">\n  复盘看板\n</title>',
      })
    ).toBe("复盘看板");
  });
});

describe("反缩放标签的宽度上限（2026-08-25 素材卡标签糊成一坨那次）", () => {
  it("屏幕上的标签宽度不超过它所属卡片的屏幕宽度", () => {
    // 推导见 labelMaxCssWidth 的注释：cssWidth × labelScale ≤ boxW。
    for (const zoom of [0.05, 0.18, 0.5, 1, 2]) {
      for (const boxW of [420, 1920]) {
        const css = labelMaxCssWidth(boxW, zoom);
        expect(css * labelCounterScale(zoom)).toBeLessThanOrEqual(boxW + 1e-9);
      }
    }
  });

  it("窄卡片在低缩放下算出来的上限确实很小——紧凑态必须存在", () => {
    // 真机：素材卡 420 画布 px、18% 缩放 → 上限 ≈ 76 CSS px，
    // 放不下 "placehold.co/120x120 [占位图] 1 页" 整行。组件据此切紧凑态。
    expect(labelMaxCssWidth(420, 0.18)).toBeLessThan(100);
    // 同样缩放下画板（1920）宽裕得多——同一个 bug 只在窄的东西上先现形。
    expect(labelMaxCssWidth(1920, 0.18)).toBeGreaterThan(300);
  });

  it("尺寸为 0 / 缩放为 0 时返回 0，不返回 Infinity", () => {
    expect(labelMaxCssWidth(0, 1)).toBe(0);
    expect(labelMaxCssWidth(420, 0)).toBeGreaterThan(0); // zoom=0 时 scale 兜底为 1
    expect(Number.isFinite(labelMaxCssWidth(420, 0))).toBe(true);
  });
});

describe("连线接在哪条边（网格里别绕路）", () => {
  const at = (x: number, y: number) => ({ x, y, w: 1920, h: 1080 });

  it("正下方的画板走上下，得到一条笔直竖线", () => {
    // ⚠ 第一版把 source 写死在右、target 写死在左，这条线要绕过整块画板
    //   再兜回来——截图上就是一条不知从哪来到哪去的线。
    expect(pickLinkSides(at(0, 0), at(0, 1312))).toEqual({
      source: "b",
      target: "t",
    });
  });

  it("正上方走上下（反向）", () => {
    expect(pickLinkSides(at(0, 1312), at(0, 0))).toEqual({
      source: "t",
      target: "b",
    });
  });

  it("同排右侧走左右", () => {
    expect(pickLinkSides(at(0, 0), at(2088, 0))).toEqual({
      source: "r",
      target: "l",
    });
  });

  it("同排左侧走左右（反向）", () => {
    expect(pickLinkSides(at(2088, 0), at(0, 0))).toEqual({
      source: "l",
      target: "r",
    });
  });

  it("斜着的按位移大的那条轴走", () => {
    // 右下但水平位移更大 → 走左右
    expect(pickLinkSides(at(0, 0), at(4000, 1200)).source).toBe("r");
    // 右下但垂直位移更大 → 走上下
    expect(pickLinkSides(at(0, 0), at(600, 4000)).source).toBe("b");
  });

  it("位移相等时稳定走水平，不在横竖之间跳", () => {
    expect(pickLinkSides(at(0, 0), at(1000, 1000)).source).toBe("r");
  });
});

describe("聚光灯落点", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };

  it("容器正中 = 50% / 50%", () => {
    expect(spotlightAnchor(rect, 300, 150)).toEqual({ x: 50, y: 50 });
  });

  it("按容器左上角换算，不是按视口", () => {
    // ⚠ 少减 rect.left/top 的话，画布越靠右灯偏得越离谱——
    //   属性面板一开画布左边界就右移 300px，那时候才发现就晚了。
    expect(spotlightAnchor(rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(spotlightAnchor(rect, 500, 250)).toEqual({ x: 100, y: 100 });
  });

  it("指针出了容器要夹回边缘，不许让灯跑出去", () => {
    // 画布右边紧挨着属性面板，鼠标划过去时灯跟着跑出画布 = "光突然灭了"；
    // 夹住才是"光停在边上"。
    expect(spotlightAnchor(rect, 9999, 9999)).toEqual({ x: 100, y: 100 });
    expect(spotlightAnchor(rect, -9999, -9999)).toEqual({ x: 0, y: 0 });
  });

  it("容器还没量到尺寸时不炸（除零）", () => {
    const zero = { left: 0, top: 0, width: 0, height: 0 };
    const at = spotlightAnchor(zero, 10, 10);
    expect(Number.isFinite(at.x)).toBe(true);
    expect(Number.isFinite(at.y)).toBe(true);
  });

  it("静止时的落点偏上居中——正好照在第一排画板上", () => {
    expect(SPOTLIGHT_REST.x).toBe(50);
    expect(SPOTLIGHT_REST.y).toBeLessThan(50);
  });
});
