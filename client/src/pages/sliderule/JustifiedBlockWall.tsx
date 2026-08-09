/**
 * JustifiedBlockWall —— 区块墙的「等比缩放铺满」版式。
 *
 * ## 两段式：先量，再摆
 *
 * justified 布局要求每项有一个**恒定的宽高比**。区块卡没有固有宽度，所以
 * 宽高比得自己造出来：
 *
 *   ① 全部卡片在**同一个设计宽度**下渲染一次，量各自的自然高度 H
 *   ② 宽高比 = designWidth / H（与后续缩放无关，恒定）
 *   ③ DP 分行算出每张卡的目标宽度 w，缩放 s = w / designWidth
 *   ④ 摆位时 `transform: scale(s)`，**不重新排版**
 *
 * ④ 是关键：如果换个宽度重新排版，高度会跟着变，宽高比就不再恒定，整套数学
 * 塌掉。本仓在应用中心已经这么做了——LiveAppThumb 把 AppRuntimeScreen 按
 * 1440×810 渲染再缩放（见 AppRuntimeScreen 的 useScaleToFit）。
 *
 * ## 为什么不用瀑布流那套 SpanMasonry
 *
 * 那套是**固定列宽**：卡片宽度只有 1 列 / 2 列两种，缩放无从谈起。这里每张卡
 * 的宽度是连续值，两者的落位模型不兼容，所以另起一个组件，不去动刚为"布局
 * 不稳"修好的 span-positioner。
 *
 * ## 不虚拟化
 *
 * 与 BlockWall 同样的理由（见那边 overscanBy 的注释）：每张卡是活的区块渲染，
 * 卸载再挂回来头几帧还没铺开、量到的高度偏小。这里更依赖测量准确——量错一张，
 * 它那一行的行高就错——所以干脆全挂着。
 */

import React from "react";
import { layoutJustifiedRows, type PlacedItem } from "./justified-rows";

export interface JustifiedWallProps<T> {
  items: readonly T[];
  itemKey: (item: T, index: number) => string;
  render: (item: T, index: number) => React.ReactNode;
  /** 每张卡渲染与测量时用的宽度。 */
  designWidth: number;
  spacing: number;
  targetRowHeight: number;
  minScale: number;
  maxScale: number;
  maxPerRow?: number;
  /** 排不出来时的兜底渲染（回落到原来的瀑布流）。 */
  fallback: React.ReactNode;
  className?: string;
}

export function JustifiedBlockWall<T>({
  items,
  itemKey,
  render,
  designWidth,
  spacing,
  targetRowHeight,
  minScale,
  maxScale,
  maxPerRow,
  fallback,
  className,
}: JustifiedWallProps<T>) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  /** key → 在 designWidth 下量到的自然高度。按 key 存，不按下标——
   *  筛选一次下标就串了（span-positioner 刚为同一件事修过）。 */
  const [heights, setHeights] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const keys = React.useMemo(() => items.map((it, i) => itemKey(it, i)), [items, itemKey]);
  const allMeasured = keys.length > 0 && keys.every(k => (heights[k] ?? 0) > 0);

  const layout = React.useMemo(() => {
    if (!allMeasured || containerWidth <= 0) return null;
    return layoutJustifiedRows(
      keys.map(k => ({ ratio: designWidth / heights[k] })),
      { containerWidth, spacing, targetRowHeight, minScale, maxScale, designWidth, maxPerRow }
    );
  }, [allMeasured, containerWidth, keys, heights, designWidth, spacing, targetRowHeight, minScale, maxScale, maxPerRow]);

  /** 测量批：所有卡按 designWidth 隐藏渲染一遍，拿自然高度。 */
  const measureBatch = (
    <div
      aria-hidden
      style={{ position: "absolute", visibility: "hidden", zIndex: -1000, top: 0, left: 0 }}
    >
      {items.map((item, i) => {
        const k = keys[i];
        return (
          <div
            key={k}
            style={{ width: designWidth }}
            ref={el => {
              if (!el) return;
              const h = Math.round(el.getBoundingClientRect().height);
              // 只在**第一次量到**时写入。活区块挂载后还会自己变高（图表画完），
              // 那会儿再改会让整墙重排——与 span-positioner 的「落位决策不能变」
              // 同一条纪律。
              if (h > 0 && !heights[k]) {
                setHeights(prev => (prev[k] ? prev : { ...prev, [k]: h }));
              }
            }}
          >
            {render(item, i)}
          </div>
        );
      })}
    </div>
  );

  // 量齐之前先渲染测量批；排不出来则如实回落到瀑布流。
  if (!allMeasured) {
    return (
      <div ref={hostRef} className={className} style={{ position: "relative", width: "100%" }}>
        {measureBatch}
      </div>
    );
  }
  if (!layout) {
    return (
      <div ref={hostRef} className={className} style={{ width: "100%" }}>
        {fallback}
      </div>
    );
  }

  const byIndex = new Map<number, PlacedItem>(layout.placed.map(p => [p.index, p]));

  return (
    <div
      ref={hostRef}
      className={className}
      data-testid="justified-wall"
      style={{ position: "relative", width: "100%", height: layout.totalHeight }}
    >
      {items.map((item, i) => {
        const p = byIndex.get(i);
        if (!p) return null;
        return (
          <div
            key={keys[i]}
            role="listitem"
            data-span-key={keys[i]}
            data-scale={p.scale.toFixed(3)}
            style={{
              position: "absolute",
              top: p.top,
              left: p.left,
              width: p.width,
              height: p.height,
              overflow: "hidden",
            }}
          >
            {/* 按设计宽度渲染，再整体缩放——**不是**换个宽度重新排版，
                否则高度会变、宽高比不再恒定，整套分行的数学就塌了。 */}
            <div
              style={{
                width: designWidth,
                transform: `scale(${p.scale})`,
                transformOrigin: "top left",
              }}
            >
              {render(item, i)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default JustifiedBlockWall;
