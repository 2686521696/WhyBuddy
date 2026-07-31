import * as React from "react";

/**
 * masonic 的滚动源替换：把「窗口滚动」换成「最近的可滚动祖先」。
 *
 * 为什么必须换 —— masonic 自带的 `<Masonry>` 内部是
 * `useScroller()` → `@react-hook/window-scroll`，只认 `window.scrollY`；
 * 视口高度也取 `window.innerHeight`。而本应用的滚动容器是 `.native-content`
 * （dashboard.css `overflow: auto`），**window 从头到尾一格都不滚**。
 * 直接用 `<Masonry>` 的后果是 scrollTop 恒为 0：
 *   use-masonry.js:82  rangeEnd = scrollTop + height * overscanBy
 * 取件窗口永远锁在 [0, 2×窗口高]，往下滚只会看到空白——卡片根本没挂载。
 * 页面卡片少时可能碰巧全落在窗口内而不暴露，但那是运气不是正确性。
 *
 * 返回值直接喂 `useMasonry`。注意它要的 `scrollTop` 是**相对网格**的，不是
 * 相对文档的——照抄官方 use-scroller.js 最后那行 `Math.max(0, scrollTop - offset)`。
 *
 * @param gridRef 网格容器的 ref（同一个 ref 也传给 useMasonry 的 containerRef）
 * @param fps     状态更新频率上限，默认 12（与 masonic 默认一致）
 */
export function useScrollerIn(
  gridRef: React.MutableRefObject<HTMLElement | null>,
  fps = 12,
): { scrollTop: number; isScrolling: boolean; height: number } {
  const [state, setState] = React.useState({
    scrollTop: 0,
    isScrolling: false,
    // 初值给窗口高度而不是 0：首帧还没量到容器，height=0 会让取件窗口塌成
    // [0,0]，一张卡都不渲染，然后要等一次滚动才活过来。
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });

  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const scroller = findScrollParent(grid);
    // 找不到可滚动祖先就退回文档滚动（页面本身在滚），行为等同官方实现。
    const target: HTMLElement | Window = scroller ?? window;

    let frame = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const minGap = 1000 / fps;

    const measure = () => {
      frame = 0;
      const g = gridRef.current;
      if (!g) return;
      let raw: number;
      let height: number;
      let offset: number;
      if (scroller) {
        raw = scroller.scrollTop;
        height = scroller.clientHeight;
        // 网格顶在滚动内容里的位置：两个 rect 的差 + 当前已滚距离。
        // 不能用 offsetTop —— 中间只要有一层 position:relative 就断。
        offset =
          g.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          raw;
      } else {
        raw = window.scrollY;
        height = window.innerHeight;
        offset = g.getBoundingClientRect().top + raw;
      }
      const scrollTop = Math.max(0, raw - offset);
      setState(prev =>
        prev.scrollTop === scrollTop && prev.height === height && prev.isScrolling
          ? prev
          : { scrollTop, height, isScrolling: true },
      );
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => setState(prev => (prev.isScrolling ? { ...prev, isScrolling: false } : prev)),
        40 + minGap,
      );
    };

    const onScroll = () => {
      // rAF 合帧 + 最小间隔节流：滚动事件本身能到 100+/s，每次都 setState 会
      // 把整面墙的 diff 拖进滚动帧里。
      const now = Date.now();
      if (frame || now - last < minGap) return;
      last = now;
      frame = requestAnimationFrame(measure);
    };

    // 首帧先量一次：height 要拿容器的真实 clientHeight 顶掉上面那个初值。
    measure();
    setState(prev => (prev.isScrolling ? { ...prev, isScrolling: false } : prev));

    target.addEventListener("scroll", onScroll, { passive: true });
    // 容器变高变矮（窗口缩放 / 侧栏收起）都要重算视口高度。
    const ro =
      typeof ResizeObserver === "undefined" || !scroller
        ? null
        : new ResizeObserver(() => measure());
    if (ro && scroller) ro.observe(scroller);
    window.addEventListener("resize", measure);

    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
    };
  }, [gridRef, fps]);

  return state;
}

/** 往上找第一个真正会滚的祖先；找不到返回 null（表示文档在滚）。 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
