/**
 * 瀑布流「追加」判定 —— 下一页不该把已经落下的卡重拍。
 *
 * GitHub 上这件事有标准答案，不是口味问题：
 *
 *   · desandro/masonry：新卡走 `appended()`，禁止对整墙再调 `layout()`
 *     https://github.com/desandro/masonry/issues/747
 *   · pinterest/gestalt Masonry：MeasurementStore / positionStore 按**卡片身份**
 *     缓存；`loadItems` 只给还没量过的卡落位，已有卡的 left/top 不动
 *     https://github.com/pinterest/gestalt/blob/master/packages/gestalt/src/Masonry.tsx
 *   · 本仓 span-positioner.ts 已经写过同一条：测量结果可以变，落位决策不能变。
 *
 * 2026-08-18 首页滚动分页接上之后，下一页一到就把 `items` 换成长数组，
 * 定位器按「内容指纹」整实例重建、跨列集合按全表现算——已落位的卡换列，
 * 用户看见的就是「重新拍了」。这两条函数把「这是追加还是换了一面墙」钉死。
 */

/** 新列表是旧列表的前缀加尾巴（无限流下一页）。换筛选/换排序不是。 */
export function isKeyPrefixAppend(
  prevKeys: readonly string[],
  nextKeys: readonly string[],
): boolean {
  if (prevKeys.length === 0) return false;
  if (nextKeys.length < prevKeys.length) return false;
  for (let i = 0; i < prevKeys.length; i++) {
    if (prevKeys[i] !== nextKeys[i]) return false;
  }
  return true;
}

/**
 * 追加时定位器实例能不能留。空 → 有算同一轮开场，不换实例。
 * ⚠ 别把「长度变了就 +1」写回来：那正是下一页整墙重拍的开关。
 */
export function nextLayoutEpoch(
  prevKeys: readonly string[],
  nextKeys: readonly string[],
  epoch: number,
): number {
  if (prevKeys.length === 0) return epoch;
  if (isKeyPrefixAppend(prevKeys, nextKeys)) return epoch;
  return epoch + 1;
}

/**
 * 无限流露出的卡片顺序：已经在墙上的卡不许被新一页「按时间插队」挤走。
 *
 * 画廊每次都是 `merge + 全表 sort`。第二页应用的 created_at 一旦插进
 * 第一页（会话卡夹在中间时必现），前 12 个 key 就不是前缀——定位器换代、
 * 顶部已经落下的卡换列。用户看见的就是「滚到底，顶上那批又重拍了」。
 *
 *   · 只多不少 → 冻结旧序，新卡按新列表相对序接在后面
 *   · 丢了旧 key / 同一批换序（筛选、改排序）→ 听新列表
 *
 * ⚠ 别把「超集也 return nextItems」写回来：那正是插队重拍。
 */
export function appendStableItems<T>(
  prevKeys: readonly string[],
  nextItems: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  if (prevKeys.length === 0) return [...nextItems];
  const nextSet = new Set(nextItems.map(keyOf));
  if (prevKeys.some(key => !nextSet.has(key))) return [...nextItems];
  const prevSet = new Set(prevKeys);
  if (nextItems.length === prevKeys.length && nextItems.every(item => prevSet.has(keyOf(item)))) {
    return [...nextItems];
  }
  const byKey = new Map(nextItems.map(item => [keyOf(item), item]));
  const kept = prevKeys.map(key => byKey.get(key)!);
  const added = nextItems.filter(item => !prevSet.has(keyOf(item)));
  return [...kept, ...added];
}

/**
 * 本地已经露出的卡看完了，该向服务端要下一页。
 *
 * ⚠ 必须是 `>=` 不是 `>`。墙上 52 张、shown 也是 52 时，再 +12 才会变成
 * `>`；而 onReachEnd 用 lastAsked===itemCount 防重入，墙高过两屏且
 * scrollTop 没跟上（绑错滚动源）时那一下永远不来——shown 停在 52，
 * `>` 判据把取数也挡死。2026-08-18 首页「滚到底不加载」就是这两条叠在一起。
 */
export function shouldFetchAppPage(
  shown: number,
  visibleCount: number,
  hasMore: boolean,
): boolean {
  return hasMore && visibleCount > 0 && shown >= visibleCount;
}
