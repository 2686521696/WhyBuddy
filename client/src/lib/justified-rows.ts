/**
 * 两端对齐行布局（justified rows）——「作品墙」那种排布方式的算法。
 *
 * 为什么是这个算法：把设计稿的几何量出来后，特征很明确——**每一带里卡片高度
 * 基本一致、宽度差别很大，每带正好铺满容器宽度，高度逐带递减**（实测三带约
 * 300 / 275 / 215px，第一带三张卡宽 585 / 550 / 222）。
 *
 * 这不是 Pinterest 那种 masonry（等宽、变高），恰恰相反。它是 Flickr explore /
 * Google Photos 那种两端对齐相册的排法。
 *
 * 逻辑照 flickr/justified-layout（MIT，lib/row.js 的 addItem）实现，没引它的包
 * ——那是个纯函数库，核心就下面这几十行，而我们需要 TS 版且要跟设备档拼接。
 * 原库的 widow 处理 / breakout row / edge-case 高度钳制没有实现：那些是相册
 * 场景的收尾优化，这里最后一行不足时按左对齐留白即可（见 lastRowBehavior）。
 *
 * ## 为什么这个算法正好解决我们的问题
 *
 * 输入是**宽高比**，不是尺寸。而我们每个应用的宽高比由设备档决定：
 *     桌面 1440×810 → 1.778     手机 390×844 → 0.462
 * 同一行里高度一致，于是**手机档应用自动变成窄竖条、桌面档变成宽幅卡**——
 * 设计稿里「待办事项」「消息中心」那两根窄列不是手工摆的，是宽高比 0.46 的
 * 卡片落进等高行里的必然结果。大中小交错也是这么来的，不需要"随机"。
 *
 * 配合 AppRuntimeScreen 的 scaleFit="width"（宽度定缩放、高度跟内容），
 * 卡片不留边也不裁切。
 */

export interface JustifiedItem {
  /** 宽 / 高。桌面 1.778、手机 0.462（见 DEVICE_SPECS） */
  aspectRatio: number;
}

export interface JustifiedBox {
  index: number;
  aspectRatio: number;
  top: number;
  left: number;
  width: number;
  height: number;
  /** 所在行序号，便于调试与断言 */
  row: number;
}

export interface JustifiedResult {
  containerHeight: number;
  boxes: JustifiedBox[];
  /** 每行的行高，用来检查"逐带递减"这类性质 */
  rowHeights: number[];
}

export interface JustifiedOptions {
  containerWidth: number;
  /** 目标行高。算法尽量贴近它，但会为了铺满宽度而上下浮动 */
  targetRowHeight?: number;
  /** 行高容差（0~1）。行高可在 target × (1 ± tolerance) 间浮动 */
  targetRowHeightTolerance?: number;
  /** 卡片间距（横向与纵向同值，与 CSS gap 语义一致） */
  spacing?: number;
  /**
   * 最后一行不足一行时怎么办。
   *   left    — 按目标行高左对齐，右侧留白（默认，相册通行做法）
   *   justify — 强行拉满整行（最后一行只有一张时会变成巨幅卡，慎用）
   */
  lastRowBehavior?: "left" | "justify";
}

export function justifiedRows(
  items: readonly JustifiedItem[],
  opts: JustifiedOptions
): JustifiedResult {
  const {
    containerWidth,
    targetRowHeight = 260,
    targetRowHeightTolerance = 0.25,
    spacing = 12,
    lastRowBehavior = "left",
  } = opts;

  const boxes: JustifiedBox[] = [];
  const rowHeights: number[] = [];
  if (containerWidth <= 0 || items.length === 0) {
    return { containerHeight: 0, boxes, rowHeights };
  }

  // 行"装满"的判据用宽高比之和，而不是累加像素宽度——因为行高还没定，
  // 像素宽度算不出来。宽高比之和 × 行高 = 行宽，所以给定目标行高，
  // 就有一个目标宽高比之和。这是整个算法的支点（照 row.js 的 min/maxAspectRatio）。
  const minAspectRatio = (containerWidth / targetRowHeight) * (1 - targetRowHeightTolerance);
  const maxAspectRatio = (containerWidth / targetRowHeight) * (1 + targetRowHeightTolerance);

  let cursor = 0;
  let top = 0;
  let rowIndex = 0;

  const flush = (rowItems: Array<{ index: number; aspectRatio: number }>, height: number) => {
    let left = 0;
    for (const it of rowItems) {
      const width = height * it.aspectRatio;
      boxes.push({
        index: it.index,
        aspectRatio: it.aspectRatio,
        top,
        left,
        width,
        height,
        row: rowIndex,
      });
      left += width + spacing;
    }
    rowHeights.push(height);
    top += height + spacing;
    rowIndex += 1;
  };

  while (cursor < items.length) {
    const rowItems: Array<{ index: number; aspectRatio: number }> = [];
    let closed = false;

    while (cursor < items.length && !closed) {
      const candidate = { index: cursor, aspectRatio: items[cursor].aspectRatio };
      const nextSum =
        rowItems.reduce((s, i) => s + i.aspectRatio, 0) + candidate.aspectRatio;
      // 间距不参与缩放，先从可用宽度里扣掉
      const widthWithoutSpacing = containerWidth - rowItems.length * spacing;
      const targetSum = widthWithoutSpacing / targetRowHeight;

      if (nextSum < minAspectRatio) {
        // 还太窄（等价于行高会超出上限）：收下，行继续开着
        rowItems.push(candidate);
        cursor += 1;
      } else if (nextSum > maxAspectRatio) {
        if (rowItems.length === 0) {
          // 单张就已经超宽（超宽幅应用）：只能自己占一行
          rowItems.push(candidate);
          cursor += 1;
          flush(rowItems, widthWithoutSpacing / nextSum);
          closed = true;
        } else {
          const prevWidthWithoutSpacing = containerWidth - (rowItems.length - 1) * spacing;
          const prevSum = rowItems.reduce((s, i) => s + i.aspectRatio, 0);
          const prevTargetSum = prevWidthWithoutSpacing / targetRowHeight;
          // 收下它离目标更远，就不收；更近就收下。两边都会立刻封行。
          if (Math.abs(nextSum - targetSum) > Math.abs(prevSum - prevTargetSum)) {
            flush(rowItems, prevWidthWithoutSpacing / prevSum);
          } else {
            rowItems.push(candidate);
            cursor += 1;
            flush(rowItems, widthWithoutSpacing / nextSum);
          }
          closed = true;
        }
      } else {
        // 落在容差内：收下并封行
        rowItems.push(candidate);
        cursor += 1;
        flush(rowItems, widthWithoutSpacing / nextSum);
        closed = true;
      }
    }

    // 走到末尾还没封行 = 最后一行没装满
    if (!closed && rowItems.length > 0) {
      const widthWithoutSpacing = containerWidth - (rowItems.length - 1) * spacing;
      const sum = rowItems.reduce((s, i) => s + i.aspectRatio, 0);
      flush(
        rowItems,
        lastRowBehavior === "justify" ? widthWithoutSpacing / sum : targetRowHeight
      );
    }
  }

  return {
    // 最后一行后面那个 spacing 不算进容器高度
    containerHeight: Math.max(0, top - spacing),
    boxes,
    rowHeights,
  };
}
