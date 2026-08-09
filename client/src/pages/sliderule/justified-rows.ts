/**
 * 对齐分行（justified rows）—— 每行等比缩放，正好铺满整宽。
 *
 * ## 抄的是谁
 *
 * `igordanchenko/react-photo-album` 的 `layouts/rows/rows.ts`（MIT，拉到本地读过）。
 * 照片墙领域的成熟解法，两条照搬：
 *
 *   · **行高由宽高比反推**：`行高 = (容器宽 − 间距总和) / Σ宽高比`。
 *     这一行就是"等比缩放填满整宽"的全部数学。
 *   · **DP 求全局最优分行**：断点建成 DAG（节点=断点，边 i→j=第 i..j 张成一行，
 *     边权=偏离目标行高的平方×卡数），单趟前向松弛求最短路。贪心
 *     （flickr/justified-layout 那种逐行断）会在末行留下难看的残行。
 *
 * 还照搬了 `TIEBREAKER_EPSILON`：原注释说代价差可低到 1e-12，不设死区重渲染
 * 之间布局会来回抖。**跟 span-positioner 为"落位不许变"修的是同一类病**。
 *
 * ## ⚠ 用之前必须知道：这套的前提在 UI 卡片上只是近似成立
 *
 * 照片的宽高比是内容的**固有属性**，缩放无损保真。区块卡没有固有宽度——
 * `designWidth` 是我们定的，而且因果方向是反的：**高度是内容在某个宽度下的
 * 排版结果**（`高 = f(宽)`，且 `f` 不是 `宽/比例`）。
 *
 * 拿高度反推宽度的直接后果：为了让同一行等高，算法会把**高的卡排窄、矮的卡
 * 排宽**。对照片是保真；对 UI 是"内容多的表格因为太高被挤成窄条"。
 *
 * 实测（2026-08-09，30 个区块，自然高度 56~1062px，相差 18.96 倍）：
 *
 *     缩放 0.70~1.15（跨度 1.6x） → 无解
 *     缩放 0.50~1.30（跨度 2.6x） → 无解
 *     缩放 0.35~1.50（跨度 4.3x） → 无解
 *     缩放 0.25~1.60（跨度 6.4x） → 无解
 *     缩放 0.15~2.00（跨度 13.3x）→ 排得出来
 *
 * 也就是说要让它在真实数据上有解，必须允许把某些卡缩到 15%（12px 正文变
 * 1.8px）、另一些放大到 2 倍。用户 2026-08-09 明确裁决"字看不清没关系"，
 * 据此启用。**这条约束别当成参数随手调**——它决定的是版面还能不能看。
 *
 * 详细论证见 `docs/区块最佳实践-开源调研.md` 末尾那节。
 */

/** 参与分行的一项：只需要一个恒定的宽高比。 */
export interface JustifiedItem {
  /** 设计宽度 ÷ 自然高度。必须 > 0。 */
  ratio: number;
}

export interface JustifiedOptions {
  /** 可用总宽（已扣掉容器内边距）。 */
  containerWidth: number;
  /** 卡片之间的水平/垂直间距。 */
  spacing: number;
  /** 期望的行高；DP 让各行尽量靠近它。 */
  targetRowHeight: number;
  /** 缩放下限（含）。低于它的排法判为不可行。 */
  minScale: number;
  /** 缩放上限（含）。 */
  maxScale: number;
  /** 每张卡渲染时用的设计宽度；scale = 实际宽 / 它。 */
  designWidth: number;
  /** 一行最多几张，防止极端窄卡挤成一行。 */
  maxPerRow?: number;
}

export interface PlacedItem {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** 实际宽 ÷ designWidth，渲染时用 transform: scale() 施加。 */
  scale: number;
}

/** 与 react-photo-album 同款死区：代价差小于这个倍数就不换方案，防抖。 */
const TIEBREAKER_EPSILON = 1.005;

/** 一行的公共高度：`(可用宽 − 间距总和) / Σ宽高比`。 */
function commonHeight(
  ratioSums: readonly number[],
  i: number,
  j: number,
  containerWidth: number,
  spacing: number
): number {
  return (containerWidth - (j - i - 1) * spacing) / (ratioSums[j] - ratioSums[i]);
}

/**
 * 末行的行高 —— **不强制铺满**。
 *
 * "每行正好铺满整宽"与"缩放有上限"在末行天然冲突：末行只剩一张卡时，铺满
 * 意味着把它拉到整个容器宽，必然越界，于是 DP 整体无解。第一版就栽在这儿。
 * `flickr/justified-layout` 专门给了末行选项，做法是末行左对齐、不拉伸。
 *
 * 取值：在"所有卡缩放都合法"的区间里挑最接近 targetRowHeight 的高度，
 * 且不超过"正好铺满"的那个高度（超了会横向溢出）。区间为空 → 这行排不出来。
 */
function lastRowHeight(
  items: readonly JustifiedItem[],
  ratioSums: readonly number[],
  i: number,
  j: number,
  o: JustifiedOptions
): number | undefined {
  let lo = 0;
  let hi = Number.POSITIVE_INFINITY;
  for (let k = i; k < j; k++) {
    const natural = o.designWidth / items[k].ratio;
    lo = Math.max(lo, natural * o.minScale);
    hi = Math.min(hi, natural * o.maxScale);
  }
  hi = Math.min(hi, commonHeight(ratioSums, i, j, o.containerWidth, o.spacing));
  if (!(hi > 0) || lo > hi) return undefined;
  return Math.min(Math.max(o.targetRowHeight, lo), hi);
}

/** 第 i..j 张成一行的代价；行高 ≤ 0 或有卡缩放越界都判不可行。 */
function rowCost(
  items: readonly JustifiedItem[],
  ratioSums: readonly number[],
  i: number,
  j: number,
  o: JustifiedOptions
): number | undefined {
  const h = commonHeight(ratioSums, i, j, o.containerWidth, o.spacing);
  if (!(h > 0)) return undefined;
  for (let k = i; k < j; k++) {
    const scale = (h * items[k].ratio) / o.designWidth;
    if (scale < o.minScale - 1e-9 || scale > o.maxScale + 1e-9) return undefined;
  }
  return (h - o.targetRowHeight) ** 2 * (j - i);
}

/**
 * 求最优分行并落位。
 *
 * 返回 null 表示**在给定缩放范围内排不出来**。调用方据此回落到原来的固定列宽
 * 布局——排不出来时如实退回，别硬排一个越界的版面。
 */
export function layoutJustifiedRows(
  items: readonly JustifiedItem[],
  o: JustifiedOptions
): { placed: PlacedItem[]; totalHeight: number } | null {
  const n = items.length;
  if (n === 0) return { placed: [], totalHeight: 0 };
  if (!(o.containerWidth > 0) || !(o.designWidth > 0)) return null;
  if (items.some(it => !(it.ratio > 0))) return null;

  const maxPerRow = Math.max(1, o.maxPerRow ?? n);

  // 宽高比前缀和：每个候选行的代价降到 O(1)，整趟 DP 是 O(n·k)
  const ratioSums = new Array<number>(n + 1);
  ratioSums[0] = 0;
  for (let i = 0; i < n; i++) ratioSums[i + 1] = ratioSums[i] + items[i].ratio;

  const dp = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n + 1).fill(-1);
  dp[0] = 0;

  for (let j = 1; j <= n; j++) {
    // i 严格递减：张数最少的排法先被选中，更长的行只有明显更优（超过死区）
    // 才顶替它——照搬原实现的取舍。
    for (let i = j - 1; i >= Math.max(0, j - maxPerRow); i--) {
      if (dp[i] === Number.POSITIVE_INFINITY) continue;
      // 末行不强制铺满，另有一套可行性判据
      const c =
        j === n
          ? lastRowHeight(items, ratioSums, i, j, o) === undefined
            ? undefined
            : 0
          : rowCost(items, ratioSums, i, j, o);
      // ⚠ 这里**不能 break**。原实现可以，因为它唯一的不可行原因"行高 ≤ 0"
      // 随张数单调。我们多了缩放越界，它**不单调**：3 张时某卡缩过头、4 张时
      // 行高更低反而可能重回范围。break 会漏掉后面可行的排法。
      if (c === undefined) continue;
      const cost = dp[i] + c;
      if (
        dp[j] === Number.POSITIVE_INFINITY ||
        (dp[j] > cost && dp[j] / cost > TIEBREAKER_EPSILON)
      ) {
        dp[j] = cost;
        prev[j] = i;
      }
    }
  }

  if (dp[n] === Number.POSITIVE_INFINITY) return null;

  const breaks: number[] = [];
  for (let node = n; node !== 0; node = prev[node]) breaks.push(node);
  breaks.push(0);
  breaks.reverse();

  const placed: PlacedItem[] = [];
  let top = 0;
  for (let r = 1; r < breaks.length; r++) {
    const i = breaks[r - 1];
    const j = breaks[r];
    const h =
      j === n
        ? lastRowHeight(items, ratioSums, i, j, o)!
        : commonHeight(ratioSums, i, j, o.containerWidth, o.spacing);
    let left = 0;
    for (let k = i; k < j; k++) {
      const w = h * items[k].ratio;
      placed.push({ index: k, left, top, width: w, height: h, scale: w / o.designWidth });
      left += w + o.spacing;
    }
    top += h + o.spacing;
  }
  return { placed, totalHeight: Math.max(0, top - o.spacing) };
}
