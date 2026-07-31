/**
 * 支持跨列的瀑布流渲染层 —— masonic 的 `useMasonry` 换掉、其余照旧。
 *
 * ## 为什么不能继续用 useMasonry
 *
 * 它把每个格子的宽度写死成全局列宽（dist/module/use-masonry.js:93 的
 * `width: columnWidth`，以及传给 render 的第三个参数）。跨列卡即使定位算对了，
 * 外层 div 还是一列宽，卡片只能画成一列。这不是配置能绕开的，只能自己渲染。
 *
 * ## 为什么连 useResizeObserver 也自己写
 *
 * masonic 的 `createResizeObserver` 靠模块私有的 `elementsCache`（一张
 * WeakMap<Element, index>）把 resize 事件映射回格子下标，而 `elements-cache`
 * **没有出现在包的导出列表里**（dist/module/index.js 只导出 11 个模块，不含它）。
 * 也就是说自己写 ref 回调就填不进那张表，事件回来查不到 index，量高整条链断掉。
 * 与其去 import 一个私有路径（升级即碎），不如自己维护这张映射——三十行，
 * 而且从此不依赖 masonic 的内部实现。
 *
 * 仍然复用 masonic 的：`createIntervalTree`（O(log n) 视口查询，见
 * span-positioner.ts）、`useContainerPosition`。滚动源仍是本地容器（useScrollerIn）。
 *
 * 落位规则在 span-positioner.ts，那里是纯函数、有单测；这里只管渲染。
 */

import * as React from "react";
import {
  createSpanPositioner,
  type SpanPositioner,
  type SpanPositionerOptions,
} from "./span-positioner";

/** masonic `getColumns()` 的同款算法：由容器宽度推列数，再把列宽撑满剩余空间。 */
export function computeColumns(
  width: number,
  minColumnWidth: number,
  gutter: number,
  maxColumnCount?: number
): [columnWidth: number, columnCount: number] {
  const count =
    Math.min(
      Math.floor((width + gutter) / (minColumnWidth + gutter)),
      maxColumnCount ?? Infinity
    ) || 1;
  const columnWidth = Math.floor((width - gutter * (count - 1)) / count);
  return [columnWidth, count];
}

/**
 * 建/换定位器。换列数或换数据集时重建，并把已量到的高度迁移过去
 * （照 masonic usePositioner 的做法：重建后按旧 index 把 height 重新 set 一遍，
 * 否则换个窗口宽度就要把所有卡重新量一次，首屏会闪）。
 */
function useSpanPositioner(
  opts: SpanPositionerOptions,
  deps: React.DependencyList
): SpanPositioner {
  const { columnCount, columnWidth, columnGutter, rowGutter, maxSpanWhitespace } = opts;
  // getSpan 每次渲染都是新函数，不能进依赖数组；用 ref 让定位器始终读到最新的。
  const getSpanRef = React.useRef(opts.getSpan);
  getSpanRef.current = opts.getSpan;

  const init = React.useCallback(
    () =>
      createSpanPositioner({
        columnCount,
        columnWidth,
        columnGutter,
        rowGutter,
        maxSpanWhitespace,
        getSpan: i => getSpanRef.current(i),
      }),
    [columnCount, columnWidth, columnGutter, rowGutter, maxSpanWhitespace]
  );

  const ref = React.useRef<SpanPositioner | undefined>(undefined);
  if (ref.current === undefined) ref.current = init();
  const prevKey = React.useRef<React.DependencyList>([
    columnCount,
    columnWidth,
    columnGutter,
    rowGutter,
    ...deps,
  ]);
  const key = [columnCount, columnWidth, columnGutter, rowGutter, ...deps];
  if (key.length !== prevKey.current.length || key.some((v, i) => prevKey.current[i] !== v)) {
    const prev = ref.current;
    const next = init();
    const size = prev.size();
    for (let i = 0; i < size; i++) {
      const pos = prev.get(i);
      next.set(i, pos ? pos.height : 0);
    }
    prevKey.current = key;
    ref.current = next;
  }
  return ref.current;
}

/** 自建的 element→index 映射 + ResizeObserver。理由见文件头。 */
function useSpanResizeObserver(positioner: SpanPositioner) {
  const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
  const indexOf = React.useRef(new WeakMap<Element, number>()).current;
  const observer = React.useMemo(() => {
    if (typeof ResizeObserver === "undefined") return null;
    return new ResizeObserver(entries => {
      const updates: number[] = [];
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const index = indexOf.get(el);
        if (index === undefined) continue;
        const height = el.offsetHeight;
        if (height <= 0) continue;
        const pos = positioner.get(index);
        if (pos !== undefined && height !== pos.height) updates.push(index, height);
      }
      if (updates.length > 0) {
        positioner.update(updates);
        forceUpdate();
      }
    });
    // 定位器换了（列数变了）就得换一个观察器，旧的还盯着已经作废的下标。
  }, [positioner, indexOf]);

  React.useEffect(() => () => observer?.disconnect(), [observer]);

  const setRef = React.useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el === null) return;
      indexOf.set(el, index);
      observer?.observe(el);
      // 首次挂载就量一次——ResizeObserver 的首帧回调赶不上这一轮渲染。
      if (positioner.get(index) === undefined) positioner.set(index, el.offsetHeight);
    },
    [observer, positioner, indexOf]
  );

  return { setRef, forceUpdate };
}

export interface SpanMasonryProps<T> {
  items: T[];
  /** 容器可用宽度（由调用方用 useContainerPosition 量）。 */
  width: number;
  /** 滚动容器的可视高度与当前 scrollTop（由调用方的 useScrollerIn 给）。 */
  height: number;
  scrollTop: number;
  isScrolling?: boolean;
  minColumnWidth: number;
  gutter: number;
  maxColumnCount?: number;
  /** 第 index 项占几列。会被钳进 [1, 列数]。 */
  getSpan: (item: T, index: number, columnCount: number) => number;
  /**
   * 跨列允许留下的最大空洞（px），超过就把那张卡降回单列。不给 = 不降级。
   * 详见 span-positioner.ts 的同名选项。
   */
  maxSpanWhitespace?: number;
  itemKey: (item: T, index: number) => React.Key;
  /** 渲染一格。width 是**该格**的实际宽度（跨列时更宽）。 */
  render: (item: T, index: number, width: number, columnCount: number) => React.ReactNode;
  /** 首屏还没量到真实高度时用来估总高。 */
  itemHeightEstimate?: number;
  /** 视口外多渲染几屏，默认 2。 */
  overscanBy?: number;
  className?: string;
  /** 网格容器的 ref。同一个 ref 也给 useScrollerIn / useContainerPosition 用。 */
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 滚到接近末尾时回调一次（无限流）。 */
  onReachEnd?: () => void;
}

export function SpanMasonry<T>({
  items,
  width,
  height,
  scrollTop,
  isScrolling,
  minColumnWidth,
  gutter,
  maxColumnCount,
  getSpan,
  maxSpanWhitespace,
  itemKey,
  render,
  itemHeightEstimate = 240,
  overscanBy = 2,
  className,
  containerRef,
  onReachEnd,
}: SpanMasonryProps<T>) {
  const [columnWidth, columnCount] = React.useMemo(
    () => computeColumns(width, minColumnWidth, gutter, maxColumnCount),
    [width, minColumnWidth, gutter, maxColumnCount]
  );

  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const spanRef = React.useRef(getSpan);
  spanRef.current = getSpan;

  const positioner = useSpanPositioner(
    {
      columnCount,
      columnWidth,
      columnGutter: gutter,
      rowGutter: gutter,
      maxSpanWhitespace,
      getSpan: index => {
        const item = itemsRef.current[index];
        return item === undefined ? 1 : spanRef.current(item, index, columnCount);
      },
    },
    [items.length]
  );
  const { setRef, forceUpdate } = useSpanResizeObserver(positioner);

  const itemCount = items.length;
  const measuredCount = positioner.size();
  const shortestColumnSize = positioner.shortestColumn();
  const overscan = height * overscanBy;
  const rangeEnd = scrollTop + overscan;
  const needsFreshBatch = shortestColumnSize < rangeEnd && measuredCount < itemCount;

  const children: React.ReactNode[] = [];
  // 已量到高度的：按区间树查视口内的，绝对定位画出来。
  positioner.range(Math.max(0, scrollTop - overscan / 2), rangeEnd, index => {
    const item = items[index];
    const pos = positioner.get(index);
    if (item === undefined || pos === undefined) return;
    children.push(
      <div
        key={itemKey(item, index)}
        ref={setRef(index)}
        role="listitem"
        style={{
          position: "absolute",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          writingMode: "horizontal-tb",
        }}
      >
        {render(item, index, pos.width, columnCount)}
      </div>
    );
  });

  // 还没量到高度的：先按各自的真实宽度隐藏渲染一批，量完下一轮才定位。
  // 宽度必须是**跨列后的宽度**，否则跨列卡会按一列宽换行、量出偏高的高度。
  if (needsFreshBatch) {
    const batchSize = Math.min(
      itemCount - measuredCount,
      Math.ceil(((scrollTop + overscan - shortestColumnSize) / itemHeightEstimate) * columnCount)
    );
    for (let index = measuredCount; index < measuredCount + batchSize; index++) {
      const item = items[index];
      if (item === undefined) continue;
      const span = Math.max(1, Math.min(columnCount, spanRef.current(item, index, columnCount)));
      const w = columnWidth * span + gutter * (span - 1);
      children.push(
        <div
          key={itemKey(item, index)}
          ref={setRef(index)}
          role="listitem"
          style={{
            width: w,
            zIndex: -1000,
            visibility: "hidden",
            position: "absolute",
            writingMode: "horizontal-tb",
          }}
        >
          {render(item, index, w, columnCount)}
        </div>
      );
    }
  }

  // 量完一批要再渲染一轮把它们定位上去。
  React.useEffect(() => {
    if (needsFreshBatch) forceUpdate();
  }, [needsFreshBatch, positioner, forceUpdate]);

  // 无限流：滚到只剩不到一屏就喊一次。用 ref 记住上次喊的项数，避免同一批重复喊。
  const lastAsked = React.useRef(-1);
  React.useEffect(() => {
    if (!onReachEnd) return;
    const tallest = positioner.estimateHeight(itemCount, itemHeightEstimate);
    if (scrollTop + height >= tallest - height && lastAsked.current !== itemCount) {
      lastAsked.current = itemCount;
      onReachEnd();
    }
  }, [scrollTop, height, itemCount, positioner, itemHeightEstimate, onReachEnd]);

  const estimated = Math.ceil(positioner.estimateHeight(itemCount, itemHeightEstimate));
  return (
    <div
      ref={containerRef}
      role="list"
      className={className}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        height: estimated,
        maxHeight: estimated,
        willChange: isScrolling ? "contents" : undefined,
        pointerEvents: isScrolling ? "none" : undefined,
      }}
    >
      {children}
    </div>
  );
}
