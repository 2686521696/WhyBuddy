/**
 * 刀 2 的几何：块节点摆在哪、整页 iframe 怎么裁（2026-08-27）。
 *
 * 照 canvas-board-layout 的规矩来：**凡是能算出数字的都算在这一层**，
 * 组件只负责把数字贴到 DOM 上。理由同那边头注——画布组件在 jsdom 里跑不动，
 * 判据只能落在纯函数上，否则只写得出"渲染了没报错"这种一改还是绿的假判据。
 *
 * ## 摆位：块条带跟着**画板现在的位置**走
 *
 * 条带排在画板右侧，坐标从 `placedBoxes`（含手工拖动后的位置）算，不是从
 * `layoutArtboards` 的原始网格算。这样拖动画板时它的块跟着一起走——正是
 * 用户裁决的「页组框能拖、块不能拖」：块没有自己的位置，它的位置是画板的
 * 位置推出来的。
 *
 * ⚠ 这条同时避开了一个坑：块若有自己可拖的位置，就得存档、得处理"画板挪了
 *   而块没挪"的漂移。canvas-board-layout 头注里记着"位置只留这一份"的教训
 *   （D5 那趟：节点位置和连线选边各存一份，拖完线就没了）。
 *
 * ## 裁剪：块片段**不能单独渲染**
 *
 * 块的 Tailwind 类来自页面注入的样式表，布局还依赖父级 flex/grid，抠出来
 * 就变形。所以块节点里装的是**整页**，只是用 overflow:hidden 开一个洞，
 * 把那一块挪到洞口。`crop` 里给的就是这个洞的参数。
 *
 * 代价是 iframe 数量——那是 `block-node-fit.ts` 那道阶梯管的事。
 */

import type { ArtboardBox } from "./canvas-board-layout";
import type { BlockRect } from "./block-rects";
import { blockKey } from "./block-rects";

/**
 * 条带几何，画布坐标。
 *
 * ⚠ `width` 要够宽到能看清块里的字（画布常态缩放 13%~25%，520 画布单位在
 *   25% 下约 130 屏幕像素）。太窄就成了一排看不懂的小色块，那还不如不摊开。
 */
export const BLOCK_STRIP = {
  /** 画板右缘到条带左缘 */
  gap: 72,
  /** 条带宽度 */
  width: 520,
  /** 块节点之间的竖直间距（要装得下节点上方那行标签） */
  vGap: 56,
  /**
   * 一块**至少**占的行高（画布坐标）。
   *
   * ⚠ 这不是审美参数，跟 canvas-board-layout 的 LABEL_BAND 是同一类东西：
   *   块标签是**反缩放**的（屏幕上恒为 ~11px），而矮块在画布坐标里可能只有
   *   三四十单位高。缩到 17% 看全景时，步距 (36+56)×0.17 ≈ 15 屏幕像素，
   *   比标签本身还矮 —— 真机上量到的样子是**一列标签糊成一片互相压住**，
   *   而每个节点各自都渲染正常，没有任何报错。
   *
   *   150 是按 17%（真机全景常用档）反推的：(150+56)×0.17 ≈ 35px，
   *   装得下一行 11px 的标签还有余量。
   */
  minRow: 150,
  /**
   * 单个块节点的高宽比上限。
   *
   * ⚠ 真机上有"长表格"这种块，原始高宽比能到 6:1，按宽度等比放大后条带会
   *   拖出几千个画布单位长，把下一排画板全盖住。超过就**只裁上半截**
   *   （如实截断，不压扁——压扁会让里面的字变形，那是在骗人）。
   */
  maxAspect: 2.4,
} as const;

/** 一个块节点的盒子（画布坐标）+ 它那个"洞"的参数。 */
export interface BlockNodeBox {
  /** `blockKey(pageId, name)`——跨页唯一。 */
  key: string;
  pageId: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 裁剪参数。消费侧照这个用，**顺序不能反**：
   *
   *     transform: scale(scale) translate(-left px, -top px)
   *     transform-origin: top left
   *
   * `left`/`top` 是**设计坐标**（页面原尺寸里的位置），不是缩放后的像素。
   * CSS 的 transform 是右结合：先 translate 再 scale，所以最终位移正好是
   * `-left * scale`。
   *
   * ## ⚠ 整页必须保持**原尺寸**，只用 transform 缩放（2026-08-27 真机）
   *
   * 第一版把内层盒子的宽高写成 `board.w * scale`，也就是**改 iframe 的尺寸**。
   * 后果是 iframe 里的文档宽度跟着变，页面按新宽度**重新响应式布局**了——
   * 于是块在新布局里的位置跟量测那一刻完全不同，裁出来的是别处的内容。
   *
   * 真机上的样子：标着「表格·物资台账出入库实时流水」的节点里显示的是壳里
   * 的用户下拉。块框位置是对的（AH 通过），内容是错的——两件事各自都"看着
   * 正常"，合起来才看得出不对。
   *
   * 这跟 canvas-board-layout 头注那条是同一条纪律：画板在画布坐标里就是
   * 原尺寸，缩放整个交给 transform。
   */
  crop: { left: number; top: number; scale: number };
  /** 原始矩形被高宽比上限截断过（节点里只看得到上半截）。 */
  truncated: boolean;
}

/**
 * 把一页的块摆成画板右侧的一条竖带。
 *
 * @param board 画板盒子（**当前**位置，含拖动后的）
 * @param rects 这一页量到的块矩形（画板节点坐标，即与 board.w/h 同一尺度）
 */
export function layoutBlockNodes(
  board: ArtboardBox,
  rects: readonly BlockRect[]
): BlockNodeBox[] {
  const out: BlockNodeBox[] = [];
  if (!(board.w > 0) || !(board.h > 0)) return out;

  const x = board.x + board.w + BLOCK_STRIP.gap;
  let y = board.y;

  for (const b of rects) {
    if (!(b.rect.width > 0) || !(b.rect.height > 0)) continue;
    // 按宽度铺满条带
    const scale = BLOCK_STRIP.width / b.rect.width;
    const wanted = b.rect.height * scale;
    const maxH = BLOCK_STRIP.width * BLOCK_STRIP.maxAspect;
    const h = Math.min(wanted, maxH);
    out.push({
      key: blockKey(board.pageId, b.name),
      pageId: board.pageId,
      name: b.name,
      x,
      y,
      w: BLOCK_STRIP.width,
      h,
      crop: {
        /* 设计坐标，**不乘 scale**——消费侧是 scale(s) translate(-left,-top)，
           CSS 会替我们乘。这里先乘一遍等于乘两次。 */
        left: b.rect.left,
        top: b.rect.top,
        scale,
      },
      truncated: wanted > maxH,
    });
    /* ⚠ 步距按 minRow 兜底，**但节点高度不变**：撑高的是间距，不是内容。
       把 h 直接抬到 minRow 会让矮块的裁剪窗口比块本身大，露出下面那块的
       半截内容——那比标签重叠更糟（用户会以为块划错了）。 */
    y += Math.max(h, BLOCK_STRIP.minRow) + BLOCK_STRIP.vGap;
  }
  return out;
}

/**
 * 开着块条带时，画板之间要多留的横向间距。
 *
 * ⚠ 不留的话条带会盖住右边那一列画板——而"盖住了"在缩到 13% 的全景下
 *   看起来只是"有点挤"，不会有任何报错。
 */
export const BLOCK_STRIP_EXTRA_GAP_X = BLOCK_STRIP.gap + BLOCK_STRIP.width;

/**
 * 一条竖带的总高（含块之间的间距）。给"这一页的块摆不摆得下"用。
 *
 * ⚠ 空数组回 0，不回 vGap——多算一个间距会让外接盒每页都虚高一截，
 *   「适应画布」跟着偏。
 */
export function blockStripHeight(boxes: readonly BlockNodeBox[]): number {
  if (boxes.length === 0) return 0;
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  return last.y + last.h - first.y;
}
