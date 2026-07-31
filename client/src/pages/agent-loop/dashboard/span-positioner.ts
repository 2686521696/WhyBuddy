/**
 * 支持「跨列」的瀑布流定位器 —— masonic 的 Positioner 接口 + Pinterest 的跨列放置规则。
 *
 * ## 为什么要自己写这一个
 *
 * masonic 自带的 `usePositioner` 里，一格恒等于一列：
 *     set(index, height) { 找最矮列; items[index] = { left: column * (w + g), ... } }
 * 宽度没有逐项的概念，`useMasonry` 渲染时也是把 `positioner.columnWidth` 直接写死到
 * 每个格子的 style 上（dist/module/use-masonry.js:93）。所以「让某些卡占两列」这件事
 * 在 masonic 的模型里表达不出来，不是配置问题。
 *
 * 而我们**必须**有跨列：应用中心的卡片高度是 `列宽 / 设备宽高比` 算出来的，设备只有
 * 桌面/平板/手机三档，线上真实分布是桌面 12、手机 2、空串 5（空串按桌面算）——
 * 89% 的卡走同一个比例。实测 1920px 下 12 张卡里 11 张高度**恰好都是 234px**，
 * 一个像素不差。瀑布流算法再好，输入是常数，输出就只能是整齐网格。花瓣/Pinterest
 * 的错落来自图片宽高比本身千差万别，那个前提我们没有，只能另找一个**真实的**
 * 差异来源——跨列就是 Pinterest 自己给出的答案。
 *
 * ## 放置规则的出处
 *
 * 照抄 Pinterest 开源设计系统 gestalt 的 `Masonry/multiColumnLayout.ts`
 * （https://github.com/pinterest/gestalt，pinterest.com 线上在跑的那个组件）：
 *
 *   · 单列格子 —— 落最矮列（`mindex.ts`，跟 masonic 原生一致）
 *   · 跨列格子 —— `getMultiColItemPosition()`：
 *       ① 在所有长度为 span 的**相邻列窗口**里，挑「高度差最小」的那个窗口起点
 *          （即最平的一段，跨上去产生的空白最少）
 *       ② top 取该窗口内**最高**的那列——取最矮会盖住旁边已有的卡
 *       ③ 落位后把窗口内**每一列**都抬到 `top + height + rowGutter`
 *     ①的度量取他们 `_multiColPositionAlgoV2` 那一支（窗口内总空白
 *     `Σ(max - h)`）而不是老的相邻两列差绝对值：老那支的推导只在 span=2 成立，
 *     span≥3 要另外再求一次均值；总空白的写法对任意 span 都是同一个式子。
 *   · 首行特例 —— gestalt 用 `heights.indexOf(0)` 让能塞进首行的跨列格子靠左对齐，
 *     否则第一排就会先在左边留一个洞。这里收紧成「窗口内每列都还是 0」，因为
 *     `indexOf(0)` 只检查了起点那一列。
 *
 * ## 与 masonic 原生实现的一处**故意**不同：update 走全量重排
 *
 * masonic 的 `update()` 是按列增量重排（二分找到该列第一个受影响的格子，只往下推）。
 * 那个优化的前提是「一格只影响一列」——有了跨列就不成立了：一张跨列卡改高，两列
 * 都要往下推，而这两列各自后面的格子又可能是别的跨列卡，影响会横向扩散。写增量
 * 版要维护一张列间依赖图，容易出「偶发重叠」这种最难查的 bug。
 *
 * 所以这里 `update()` 直接按记录下来的高度全量重排一遍。代价是 O(n)，但：量高只对
 * 视口内的格子发生、ResizeObserver 那层已经按 rAF 批处理过、n 是页面上的应用数量级。
 * 拿一个常数倍的开销换「不可能重叠」，这笔划算。
 */

import { createIntervalTree } from "masonic";

/** 一个格子的落位结果。比 masonic 的 PositionerItem 多了 width/span。 */
export interface SpanPositionerItem {
  top: number;
  left: number;
  height: number;
  width: number;
  /** 起始列。跨列格子记的是最左那一列。 */
  column: number;
  span: number;
}

export interface SpanPositionerOptions {
  columnCount: number;
  columnWidth: number;
  columnGutter: number;
  rowGutter: number;
  /**
   * 第 index 个格子占几列。返回值会被钳进 [1, columnCount]——
   * 窄屏只有 1 列时，「跨 2 列」必须自动退回 1 列，否则整张卡会画到容器外面。
   */
  getSpan: (index: number) => number;
}

/**
 * masonic `useMasonry`/`useResizeObserver` 依赖的那套接口。
 * 字段名不能改：`createResizeObserver` 会直接调 `positioner.update(updates)`。
 */
export interface SpanPositioner {
  columnCount: number;
  columnWidth: number;
  set: (index: number, height: number) => void;
  get: (index: number) => SpanPositionerItem | undefined;
  update: (updates: number[]) => void;
  range: (
    lo: number,
    hi: number,
    cb: (index: number, left: number, top: number) => void
  ) => void;
  size: () => number;
  estimateHeight: (itemCount: number, defaultItemHeight: number) => number;
  shortestColumn: () => number;
  all: () => SpanPositionerItem[];
}

/**
 * 跨列格子的起始列：在所有长度为 span 的相邻列窗口里，**先**挑落位后 top 最低的
 * （`max(窗口内列高)` 最小），并列时**再**挑窗口内总空白 `Σ(max - h)` 最小的。
 *
 * ## 这里跟 gestalt 不一样，是量过之后**故意**的
 *
 * gestalt `getAdjacentColumnHeightDeltas` 只按空白择窗口（不看 top）。照搬过来在
 * 我们的数据上会退化：跨列卡落位后会把跨到的每一列设成**完全相等**，而"最平的
 * 窗口"从此永远是这一对——下一张跨列卡又落回同一处，自我强化。实测 50 格随机
 * 高度下 10 张跨列卡**全部** left=0，堆成最左边一竖条。
 *
 * 两条规则在**我们的真实高度分布**（22 张卡、桌面档 234px 占压倒多数、手机档
 * 728px 两张、5 列）上逐档量过：
 *
 *   每 3 张跨 1 张   空白优先 → 起始列 {0:8}        墙高 2494  列底参差 1244
 *                   top 优先  → 起始列 {0:6,2:1,3:1} 墙高 1994  列底参差  494
 *   每 4 张跨 1 张   空白优先 → {0:3,1:3}  墙高 1750  参差 500
 *                   top 优先  → {0:2,1:3,2:1} 墙高 1750  参差 250
 *   每 5 张跨 1 张   两者墙高相同，参差 250 vs 244
 *
 * top 优先在每一档都不劣，密集档明显更好。反过来在**高度剧烈变化**的数据上
 * （随机 100~600px）空白优先的墙确实更紧（4451 vs 4560）——所以 gestalt 的选择
 * 对他们的图片墙是对的，只是前提跟我们不同：我们的卡片高度近似恒等，这正是
 * 一开始要引入跨列的原因。换了数据形态要重新量，别照抄这里的结论。
 *
 * 附带的好处：span=1 时"窗口内最大值"就是那一列自己的高度，规则**退化成最矮列**，
 * 跟 masonic/gestalt 的单列行为逐字一致——单列和跨列不再是两套逻辑。
 *
 * 首行不需要特例：全 0 窗口的 max 是 0，天然就是全局最小，且并列时取最左，
 * 等价于 gestalt 那句 `heights.indexOf(0)`（而且比它更严——它只检查了起点那列）。
 *
 * 导出是为了单测能直接打这个规则，不用绕整个定位器。
 */
export function bestSpanStart(heights: number[], span: number): number {
  const last = heights.length - span;
  let bestIndex = 0;
  let bestTop = Number.POSITIVE_INFINITY;
  let bestWhitespace = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= last; i++) {
    let max = heights[i];
    for (let j = i + 1; j < i + span; j++) if (heights[j] > max) max = heights[j];
    let whitespace = 0;
    for (let j = i; j < i + span; j++) whitespace += max - heights[j];
    if (max < bestTop || (max === bestTop && whitespace < bestWhitespace)) {
      bestTop = max;
      bestWhitespace = whitespace;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function createSpanPositioner(opts: SpanPositionerOptions): SpanPositioner {
  const { columnCount, columnWidth, columnGutter, rowGutter, getSpan } = opts;
  const columnWidthAndGutter = columnWidth + columnGutter;

  let intervalTree = createIntervalTree();
  let columnHeights: number[] = new Array(columnCount).fill(0);
  const items: SpanPositionerItem[] = [];
  /** 量到的原始高度，按 index 存。全量重排时的唯一输入。 */
  const measured: number[] = [];

  /** 把第 index 个格子按当前列高落位（追加语义，不回溯）。 */
  function place(index: number, height: number) {
    const span = Math.max(1, Math.min(columnCount, Math.floor(getSpan(index)) || 1));
    // 单列走同一条规则——bestSpanStart 在 span=1 时退化成"最矮列"，见其文档。
    const column = bestSpanStart(columnHeights, span);
    // top 取窗口内最高的那列：取最矮会压在旁边已有的卡上面。
    let top = columnHeights[column];
    for (let j = column + 1; j < column + span; j++) {
      if (columnHeights[j] > top) top = columnHeights[j];
    }
    const width = columnWidth * span + columnGutter * (span - 1);
    const next = top + height + rowGutter;
    for (let j = column; j < column + span; j++) columnHeights[j] = next;
    items[index] = {
      top,
      left: column * columnWidthAndGutter,
      height,
      width,
      column,
      span,
    };
    intervalTree.insert(top, top + height, index);
  }

  /** 按记录的高度从头重排。update 走这条，理由见文件头。 */
  function relayout() {
    intervalTree = createIntervalTree();
    columnHeights = new Array(columnCount).fill(0);
    for (let index = 0; index < measured.length; index++) {
      if (measured[index] === undefined) continue;
      place(index, measured[index]);
    }
  }

  return {
    columnCount,
    columnWidth,
    set(index, height = 0) {
      measured[index] = height;
      place(index, height);
    },
    get: index => items[index],
    update(updates) {
      // updates 是 [index, height, index, height, ...] 的扁平数组（masonic 的约定）。
      for (let i = 0; i < updates.length - 1; i += 2) {
        measured[updates[i]] = updates[i + 1];
      }
      relayout();
    },
    range(lo, hi, cb) {
      intervalTree.search(lo, hi, (index: number, top: number) => {
        const item = items[index];
        if (item) cb(index, item.left, top);
      });
    },
    size: () => intervalTree.size,
    estimateHeight(itemCount, defaultItemHeight) {
      const tallest = Math.max(0, ...columnHeights);
      if (itemCount === intervalTree.size) return tallest;
      return (
        tallest +
        Math.ceil((itemCount - intervalTree.size) / columnCount) * defaultItemHeight
      );
    },
    shortestColumn: () =>
      columnHeights.length > 1 ? Math.min(...columnHeights) : columnHeights[0] || 0,
    all: () => items,
  };
}
