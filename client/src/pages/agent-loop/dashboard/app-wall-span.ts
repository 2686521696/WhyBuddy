/**
 * 决定卡片墙上哪些卡跨两列。
 *
 * ## 为什么需要它
 *
 * 卡片高度是 `列宽 / 设备宽高比` 算出来的，而设备只有桌面/平板/手机三档，线上
 * 真实分布是桌面 12、手机 2、空串 5（空串按桌面算）——89% 的卡走同一个比例。
 * 1920px 下实测 12 张卡里 11 张高度**恰好都是 234px**。瀑布流的输入是常数，
 * 输出就只能是整齐网格，这跟用哪个瀑布流库无关。
 *
 * 花瓣/Pinterest 的错落来自图片宽高比本身千差万别，那个前提我们没有。Pinterest
 * 自己在 gestalt 里给出的答案是**跨列**（`Masonry/multiColumnLayout.ts` 的
 * `ColumnSpanConfig`），这里照这个思路走。
 *
 * ## 凭什么判"这张该宽"——必须是真实信息，不能是随机
 *
 * 随机跨列能立刻做出错落感，但那是**假信息**：用户会以为宽卡代表什么，其实什么
 * 都不代表，而且每次刷新还会变。这里的规则是两条都能讲清楚的事实：
 *
 *   ① 只有**桌面档**有资格。宽版应用本来就是横向内容（1440×810），给两列是让它
 *      显示得更完整——跟花瓣上横构图的图片占两列是同一个道理。手机档是 405×720（9:16）
 *      的竖比例，跨两列会算出 1400px 以上的巨条，把整面墙拉垮。
 *   ② 在有资格的卡里按**页面数**降序取前 ratio。页面多 = 应用做得更完整，值得
 *      更大的展位。页面数在列表接口 (`AppStoreSummary.page_count`) 里就有，
 *      同步可得——不用等详情加载，所以不会出现"加载完详情整面墙重排一次"。
 *
 * ratio 默认 0.25 是量出来的：在真实高度分布（22 张卡、桌面 234px 为主、5 列）
 * 上逐档试过，每 3 张跨 1 张时墙高 1994、列底参差 494；每 4 张跨 1 张时墙高 1750、
 * 参差 250；每 5 张跨 1 张参差 244 但错落感明显变弱。1/4 是"够错落又不散"的那一档。
 */

import type { GalleryItem } from "./AppsWorkbench";

/** 只有这一档允许跨列，理由见文件头 ①。 */
const SPANNABLE_DEVICE = "desktop";

/** 空串 device 按桌面处理——跟 aspectForDevice 的取向保持一致。 */
function isSpannableDevice(item: GalleryItem): boolean {
  if (item.source !== "app" || !item.summary) return false;
  const device = (item.summary.device || "").trim().toLowerCase();
  return device === "" || device === SPANNABLE_DEVICE;
}

/**
 * 算出该跨两列的卡片 key 集合。
 *
 * 纯函数、结果只由入参决定：同一份列表两次调用给同一个集合，刷新页面不会换一批。
 *
 * @param items 当前要铺墙的卡片（已筛选、已排序的那一份）
 * @param ratio 跨列卡占**有资格卡**的比例，默认 0.25
 */
export function computeSpanKeys(items: GalleryItem[], ratio = 0.25): Set<string> {
  const eligible = items.filter(isSpannableDevice);
  if (eligible.length === 0) return new Set();
  const take = Math.floor(eligible.length * ratio);
  if (take === 0) return new Set();

  const ranked = [...eligible].sort((a, b) => {
    const pa = a.summary?.page_count ?? 0;
    const pb = b.summary?.page_count ?? 0;
    if (pb !== pa) return pb - pa;
    // 页面数相同就按 key 排——不加这一条，Array.sort 在不同引擎/不同输入顺序下
    // 对相等元素的处理不保证一致，同一份数据可能给出不同的跨列集合。
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return new Set(ranked.slice(0, take).map(i => i.key));
}

/**
 * 卡片墙实际用的 span：列数不够时必须退回 1。
 *
 * 单列（窄屏/手机档浏览器）下"跨 2 列"没有意义，定位器虽然也会钳，但这里先钳掉
 * 能让隐藏量高那一批直接按正确宽度渲染，少一次重排。
 */
export function spanForColumnCount(isSpan: boolean, columnCount: number): number {
  if (!isSpan) return 1;
  return columnCount >= 3 ? 2 : 1;
}
