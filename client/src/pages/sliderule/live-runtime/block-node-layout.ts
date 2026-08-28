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
export const BLOCK_CELL = {
  /** 画板右缘到块网格左缘 */
  stripGap: 72,
  /**
   * 单元格宽度。
   *
   * ⚠ 440 不是随手写的：列数封顶 4 时网格总宽 4×440+3×56 = 1928，
   *   跟画板本身（1920）差不多——一页的"成品 + 零件"合起来约两个画板宽。
   *   上一版是 520，4 列就 2248，比画板还宽一大截，整张图被横向拉开，
   *   真机上「适应画布」的缩放从 16% 掉到 12%，反而更看不清。
   */
  width: 440,
  /**
   * 单元格之间的间距，**横竖同一个数**——横竖不一样的话看着就不是网格，
   * 是"一列一列硬凑的"。
   */
  gap: 56,
  /**
   * 标签占的高度（画布坐标）。
   *
   * ⚠ 标签画在节点**上方**（节点盒子外面），但排布必须**把它算进视觉盒**。
   *   这是抄 ComfyUI_frontend `src/composables/graph/useArrangeNodes.ts`
   *   （本地 clone，commit 5d24e4e）的 `toBox`：
   *
   *       visualHeight: node.size[1] + titleHeight
   *       position:     { y: visualTop + box.titleHeight }
   *
   *   排布全程按**视觉盒**算，摆完再把标题高度加回去换成内容坐标。
   *
   *   上一版没这么做——排布按内容高度算，标签在盒子外面白占地方，于是矮块
   *   的标签互相压住。当时是加了个 `minRow` 兜底步距硬撑开的，那是在治症状。
   *   现在按 ComfyUI 的口径把标签算进盒子，minRow 就不需要了，已删。
   *
   *   跟 canvas-board-layout 的 `LABEL_BAND`（画板标题条）是同一件事，
   *   只是尺度不同。
   */
  labelBand: 56,
  /**
   * 单个块节点的高宽比上限。
   *
   * ⚠ 真机上有"长表格"这种块，原始高宽比能到 6:1，按宽度等比放大后会拖出
   *   几千个画布单位长。超过就**只裁上半截**（如实截断，不压扁——压扁会让
   *   里面的字变形，那是在骗人）。
   */
  maxAspect: 2.4,
} as const;

/**
 * 列数上限。
 *
 * ⚠ 4 是跟格宽配套定的：4×440+3×56 = 1928 ≈ 画板宽（1920）。再多就把
 *   右边那一页推得太远，整张图横向拉开，「适应画布」的缩放跟着掉。
 */
export const MAX_BLOCK_COLS = 4;

/**
 * 单块内容的高度上限。
 *
 * ⚠ 两条一起卡：高宽比上限，**以及画板高度**。
 *   只卡高宽比的话，一个特别长的表格块自己就有 440×2.4 = 1056 高，
 *   加上标签带 1112 > 画板 1080——那一页无论分几列都装不进画板高度，
 *   "列数选到装得下为止"这条规则就永远达不成。真机上量到过：
 *   远程审方页的网格 1832 高，越过下一排画板 520。
 */
function cellMaxHeight(boardHeight: number): number {
  return Math.min(
    BLOCK_CELL.width * BLOCK_CELL.maxAspect,
    Math.max(BLOCK_CELL.labelBand, boardHeight - BLOCK_CELL.labelBand)
  );
}

/** 一块按格宽铺满之后占多高（含标签带）。 */
function cellVisualHeight(rect: BlockRect, boardHeight: number): number {
  const scale = BLOCK_CELL.width / rect.rect.width;
  const wanted = rect.rect.height * scale;
  return Math.min(wanted, cellMaxHeight(boardHeight)) + BLOCK_CELL.labelBand;
}

/** 瀑布流按 cols 列packing 之后的总高。 */
function masonryHeight(heights: readonly number[], cols: number): number {
  const bottoms = new Array<number>(cols).fill(0);
  for (const h of heights) {
    let col = 0;
    for (let c = 1; c < cols; c += 1) {
      if (bottoms[c] < bottoms[col] - 0.5) col = c;
    }
    bottoms[col] += h + BLOCK_CELL.gap;
  }
  /* 末尾那个 gap 不算进总高 */
  return Math.max(0, Math.max(...bottoms) - BLOCK_CELL.gap);
}

/**
 * 这一页的块该摆几列。
 *
 * ## ⚠ 2026-08-28：从 `ceil(sqrt(n))` 改成「**装得进画板高度**为止」
 *
 * √n 只管形状方不方，不管**跟画板比起来多高**。真机上量到（4 页 15 块）：
 *
 *     画板行距            1312（1080 高 + 232 间距）
 *     远程审方页的块网格   y 0 → 1832 —— 越过下一排画板 520
 *
 * 后果就是用户报的那个：缩小时看着还行，一放大就是大片空白里几条线穿过——
 * 因为网格把整张图在垂直方向撑开了，画板之间被拉出很远的空隙。
 *
 * 改成从 1 列开始试，直到瀑布流的总高装得进画板高度。这样块簇始终跟它的
 * 画板齐平，整张图横成一条带，放大到任何一档看到的都是"一页 + 它的块"。
 *
 * ⚠ 有上限（MAX_BLOCK_COLS）：块特别多的页装不进去也不许无限加列，
 *   否则会把右边那一页推到天边。装不下就如实溢出一点，不假装。
 */
export function chooseBlockGridColumns(
  rects: readonly BlockRect[],
  boardHeight: number
): number {
  const usable = rects.filter(b => b.rect.width > 0 && b.rect.height > 0);
  if (usable.length === 0) return 1;
  const heights = usable.map(r => cellVisualHeight(r, boardHeight));
  for (let cols = 1; cols <= MAX_BLOCK_COLS; cols += 1) {
    if (masonryHeight(heights, cols) <= boardHeight) return cols;
  }
  return MAX_BLOCK_COLS;
}

/** 一页的块网格总宽（画布坐标）。给画板之间要多留多少间距用。 */
export function blockGridWidth(cols: number): number {
  if (cols <= 0) return 0;
  return cols * BLOCK_CELL.width + (cols - 1) * BLOCK_CELL.gap;
}

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

  /* 塌成 0 的块不进网格——跟量测那一侧同一条规则。 */
  const usable = rects.filter(b => b.rect.width > 0 && b.rect.height > 0);
  if (usable.length === 0) return out;

  const cols = chooseBlockGridColumns(usable, board.h);
  const originX = board.x + board.w + BLOCK_CELL.stripGap;
  /* ⚠ 顶端是**视觉顶**（第一块标签的上沿），加回 labelBand 才是内容顶。
     同 arrangeGrid 的 `anchor.posY - anchor.titleHeight` → `visualTop + titleHeight`。 */
  const originVisualTop = board.y - BLOCK_CELL.labelBand;

  /*
   * ## 瀑布流：每块落进**当前最矮的那一列**
   *
   * 2026-08-28 用户要"节点自由散布"的观感。上一版是严格网格（逐行取最大高、
   * 行行对齐），块高低差很大时（指标卡矮、表格高）会：
   *   · 每行被最高那块撑开，矮块下面留一大片空 —— 看着像表格，不像图
   *   · 所有块的顶边对齐成一条直线 —— "电子表格感"的来源
   *
   * ⚠ 用瀑布流而**不是随机抖动**：抖动是乱，不是自由，而且每次渲染位置都
   *   得稳定（否则块会在画布上跳）。瀑布流是确定性的，同一份输入永远同一个
   *   结果，还顺带把空隙填掉了。
   *
   * ⚠ 列高累加的是**视觉高**（含标签带），理由同上一版：标签画在节点外面，
   *   不算进去的话下一块的标签会压住上一块的内容。
   */
  const colVisualBottom = new Array<number>(cols).fill(originVisualTop);

  for (const b of usable) {
    const scale = BLOCK_CELL.width / b.rect.width;
    const wanted = b.rect.height * scale;
    /* ⚠ 跟 chooseBlockGridColumns 用**同一条**上限函数——各算各的话，
       选列数时以为装得下、实际摆出来又溢出。 */
    const maxH = cellMaxHeight(board.h);
    const h = Math.min(wanted, maxH);

    /* 最矮的那一列；并列时取最左的（确定性，且从左往右填看着自然）。 */
    let col = 0;
    for (let c = 1; c < cols; c += 1) {
      if (colVisualBottom[c] < colVisualBottom[col] - 0.5) col = c;
    }

    const visualTop = colVisualBottom[col];
    out.push({
      key: blockKey(board.pageId, b.name),
      pageId: board.pageId,
      name: b.name,
      x: originX + col * (BLOCK_CELL.width + BLOCK_CELL.gap),
      /* 视觉顶 + 标签带 = 内容顶。 */
      y: visualTop + BLOCK_CELL.labelBand,
      w: BLOCK_CELL.width,
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
    colVisualBottom[col] = visualTop + BLOCK_CELL.labelBand + h + BLOCK_CELL.gap;
  }
  return out;
}

/**
 * 开着块网格时，画板之间要多留的横向间距。
 *
 * ⚠ 不留的话网格会盖住右边那一列画板——而"盖住了"在缩到 13% 的全景下
 *   看起来只是"有点挤"，不会有任何报错。
 * ⚠ 宽度跟**列数最多的那一页**走：按平均值留会让列多的那页照样盖住邻居。
 *   （列数现在是按"装得进画板高度"选的，见 chooseBlockGridColumns。）
 */
export function blockGridExtraGapX(maxCols: number): number {
  if (maxCols <= 0) return 0;
  return BLOCK_CELL.stripGap + blockGridWidth(maxCols);
}

/**
 * 一页块网格的总高（含标签带与行距）。给"这一页的块摆不摆得下"用。
 *
 * ⚠ 空数组回 0——多算一行会让外接盒每页都虚高一截，「适应画布」跟着偏。
 * ⚠ 从**视觉顶**（首行标签的上沿）量到末行底，跟排布用的是同一套盒子。
 */
export function blockGridHeight(boxes: readonly BlockNodeBox[]): number {
  if (boxes.length === 0) return 0;
  let top = Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    top = Math.min(top, b.y - BLOCK_CELL.labelBand);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return bottom - top;
}

/**
 * 细节的可读性下限（LOD）：缩放低于这一档就别画那些细节了。
 *
 * ## 抄的是谁
 *
 * ComfyUI_frontend `src/lib/litegraph/src/LGraphCanvas.ts` 的
 * `updateLowQualityThreshold()`（本地 clone，commit 5d24e4e）。
 * 它的做法是**从"字还读不读得清"反推阈值**，而不是拍一个魔数：
 *
 *     threshold = min_font_size_for_lod / (NODE_TEXT_SIZE * sqrt(DPR))
 *
 * 用 sqrt(DPR) 是它注释里的原话：高 DPR 屏对可读性的提升不是线性的，
 * DPR=2 大约提升 40%，用 sqrt 近似。
 *
 * ## 为什么我们需要它
 *
 * 真机 5 页 24 块、94 条影响线，缩到 21% 看全景时：块标签挤成一片糊字，
 * 影响线横七竖八——那一档用户要看的是"有几页、大致长什么样"，
 * 不是"哪一块叫什么名字"。ComfyUI 在这一档直接把圆角、阴影、文字全关掉。
 *
 * ⚠ 关掉的是**细节**，不是内容：块节点本身照画（同 shouldMountBoard 那条
 *   "剔除是性能手段，不是可见性判定"）。缩到看全景时正是最需要看见每块在哪
 *   的时候。
 */
export const BLOCK_LABEL_FONT_PX = 11;
/** 低于这个字号就认为读不出来了（同 ComfyUI 的 min_font_size_for_lod 默认档）。 */
export const MIN_READABLE_FONT_PX = 6;

export function blockDetailZoomThreshold(
  devicePixelRatio = typeof window !== "undefined"
    ? window.devicePixelRatio || 1
    : 1
): number {
  const dpr = Math.sqrt(devicePixelRatio > 0 ? devicePixelRatio : 1);
  return MIN_READABLE_FONT_PX / (BLOCK_LABEL_FONT_PX * dpr);
}

/** 这个缩放档位该不该画块的细节（标签、影响线）。 */
export function shouldDrawBlockDetail(
  zoom: number,
  devicePixelRatio?: number
): boolean {
  return zoom >= blockDetailZoomThreshold(devicePixelRatio);
}

/**
 * 按块类型给底色。
 *
 * ## 为什么需要
 *
 * 抄 ComfyUI 低质量档的口径：`low_quality` 时它把圆角、阴影、文字全关掉，
 * 但**照画节点的形状和颜色**（LGraphCanvas.ts:5901 那段 `shape == BOX ||
 * low_quality` 走的仍是填色的 rect）。
 *
 * 我们这边上一版在 LOD 档把标签收起来之后，降级的静态卡就成了**一片空白
 * 方块**——真机 24 块里 19 块是静态的，全景看过去就是一堆白格子，
 * 比不画还糟（看着像加载坏了）。给它按类型上色，全景下至少读得出
 * "这一页由几张表、几个指标、一个图表拼成"。
 *
 * ⚠ 颜色只用来**分类**，不表示状态（好/坏/告警）。真机上块的类型是
 *   `data-block-kind`，跟 Python 的 BLOCK_KINDS 一字不差。
 */
export const BLOCK_KIND_TINT: Record<string, { fill: string; ink: string }> = {
  chart: { fill: "#eef2ff", ink: "#4f46e5" },
  table: { fill: "#ecfeff", ink: "#0e7490" },
  form: { fill: "#f0fdf4", ink: "#15803d" },
  detail: { fill: "#fefce8", ink: "#a16207" },
  metric: { fill: "#fef2f2", ink: "#b91c1c" },
  list: { fill: "#f5f3ff", ink: "#6d28d9" },
  media: { fill: "#fff7ed", ink: "#c2410c" },
  card: { fill: "#f8fafc", ink: "#475569" },
};

/**
 * 取某一类块的底色。
 *
 * ⚠ 认不出的类型回 `card` 那档，**不回透明**：透明就是那片白方块，
 *   而"认不出类型"和"没有内容"是两回事。
 */
export function blockKindTint(kind: string): { fill: string; ink: string } {
  return BLOCK_KIND_TINT[kind] ?? BLOCK_KIND_TINT.card;
}
