/**
 * 两端对齐行布局的卡片墙（B 方案，用户 2026-08-23 选定，目标行高 200）。
 *
 * ## 跟原来那面瀑布流墙的区别
 *
 * 瀑布流是**等宽变高**：列宽固定，高度由内容/宽高比决定。这面墙是**等高变宽**：
 * 同一行里高度一致、宽度按各自宽高比分配，每行正好铺满容器——Flickr explore /
 * Google Photos 那种相册排法。算法在 `@/lib/justified-rows`，移植自
 * flickr/justified-layout（MIT，lib/row.js 的 addItem），逐段对过。
 *
 * ## 为什么换
 *
 * 卡片宽高比只有三档、89% 是同一个值，瀑布流的输入是常数，输出只能是整齐网格
 * （见 app-wall-span.ts 的实测）。原来靠"按页面数取前 1/4 跨两列"人工制造错落。
 * 等高变宽这条路上，错落是**宽高比的必然结果**，不需要那条规则。
 *
 * 真实数据（68 个应用、桌面 30 / 手机 38、容器 1594px、目标行高 200）实测：
 *   桌面卡宽 348~421（原来 306），**应用截图第一次看得清里面写了什么**
 *   手机卡宽 110~133，9:16 的竖屏截图塞进窄格反而更贴合，不再被裁掉一大截
 *   滚动总高 2893（原来 4837），少滚 40%
 *
 * ## 落位是纯函数
 *
 * 与上一版（2026-08-23 的 pure-span-layout）同一条纪律：输入定则输出定，每帧
 * useMemo 重算，**不留跨渲染的可变状态**。那次死锁（切 tab 后只显示第一行、
 * 等多久都不好）的根子就是"落位表是挂载时写一次的可变状态"，这里结构上不成立。
 *
 * ⚠ 虚拟化按视口过滤，也是纯的（比大小，不存状态）。别改成"记住已渲染的"，
 *   那就把可丢的状态又请回来了。
 */
import * as React from "react";

import { justifiedRows, type JustifiedBox } from "@/lib/justified-rows";
import { findScrollParent } from "./useScrollerIn";

export interface JustifiedWallProps<T> {
  items: readonly T[];
  /** 容器可用宽度（调用方用 useContainerPosition 量）。 */
  width: number;
  /** 滚动容器可视高度与当前 scrollTop（调用方的 useScrollerIn 给）。 */
  height: number;
  scrollTop: number;
  /** 第 index 项的宽高比（宽/高）。桌面 1.778、手机 0.5625。 */
  aspectOf: (item: T, index: number) => number;
  itemKey: (item: T, index: number) => React.Key;
  /** 渲染一格。**宽高都由布局给**，卡片按给的尺寸铺满即可。 */
  render: (item: T, index: number, width: number, height: number) => React.ReactNode;
  targetRowHeight?: number;
  spacing?: number;
  /** 视口外多渲几屏，默认 2。 */
  overscanBy?: number;
  className?: string;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  onReachEnd?: () => void;
}

export function JustifiedWall<T>({
  items,
  width,
  height,
  scrollTop,
  aspectOf,
  itemKey,
  render,
  targetRowHeight = 200,
  spacing = 16,
  overscanBy = 2,
  className,
  containerRef,
  onReachEnd,
}: JustifiedWallProps<T>) {
  const aspectRef = React.useRef(aspectOf);
  aspectRef.current = aspectOf;
  const keyRef = React.useRef(itemKey);
  keyRef.current = itemKey;

  const keysJoined = React.useMemo(
    () => items.map((it, i) => String(keyRef.current(it, i))).join("\n"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items]
  );

  const layout = React.useMemo(() => {
    if (width <= 0 || items.length === 0) {
      return { containerHeight: 0, boxes: [] as JustifiedBox[], rowHeights: [] };
    }
    const list = items;
    return justifiedRows(
      list.map((it, i) => ({ aspectRatio: aspectRef.current(it, i) })),
      {
        containerWidth: width,
        targetRowHeight,
        spacing,
        // 最后一行不足时左对齐留白——相册通行做法。原库还支持 center，
        // 我们的移植只有 left/justify（见 justified-rows 文件头）。
        lastRowBehavior: "left",
      }
    );
    // keysJoined 覆盖"换了哪些卡"；宽高比由 aspectOf 走 ref 读，不进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysJoined, width, targetRowHeight, spacing]);

  const overscan = Math.max(height, 1) * overscanBy;
  const top = scrollTop - overscan;
  const bottom = scrollTop + height + overscan;
  // 纯粹的区间比较，不存任何"已渲染过"的状态。
  const visible = layout.boxes.filter(b => b.top + b.height >= top && b.top <= bottom);

  const estimated = Math.ceil(layout.containerHeight);

  // 无限流：底部哨兵进视口就喊一次。用 ref 记住上次喊的项数，同一批不重复喊。
  const lastAsked = React.useRef(-1);
  const onReachEndRef = React.useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;
  const itemCountRef = React.useRef(items.length);
  itemCountRef.current = items.length;
  const askMore = React.useCallback(() => {
    const more = onReachEndRef.current;
    const n = itemCountRef.current;
    if (!more || width <= 0 || n === 0 || lastAsked.current === n) return;
    lastAsked.current = n;
    more();
  }, [width]);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!onReachEnd || width <= 0) return;
    const el = sentinelRef.current;
    const grid = containerRef.current;
    if (!el || !grid || typeof IntersectionObserver === "undefined") return;
    const root = findScrollParent(grid);
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) askMore();
      },
      { root, rootMargin: "400px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // ⚠ 依赖里不许有 items.length：哨兵还在视口里时重建 IO 会立刻再报
    //   intersecting，同一页被 concat 两次（同 SpanMasonry 那条）。
  }, [onReachEnd, width, askMore, containerRef]);

  // 宽度还没量到就先挂个占位，useContainerPosition 才量得到。
  if (width <= 0) {
    return (
      <div
        ref={containerRef}
        role="list"
        className={className}
        style={{ position: "relative", width: "100%", minHeight: 1 }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      role="list"
      className={className}
      style={{ position: "relative", width: "100%", maxWidth: "100%", height: estimated }}
    >
      {visible.map(box => {
        const item = items[box.index];
        if (item === undefined) return null;
        return (
          <div
            key={itemKey(item, box.index)}
            role="listitem"
            style={{
              position: "absolute",
              top: box.top,
              left: box.left,
              width: box.width,
              height: box.height,
            }}
          >
            {render(item, box.index, box.width, box.height)}
          </div>
        );
      })}
      <div
        ref={sentinelRef}
        aria-hidden
        data-testid="masonry-end"
        style={{
          position: "absolute",
          left: 0,
          top: Math.max(0, estimated - 1),
          width: 1,
          height: 1,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
