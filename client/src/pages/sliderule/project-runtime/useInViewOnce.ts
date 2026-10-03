import { useEffect, useRef, useState } from "react";

/**
 * 元素第一次进视口（含预取边距）后返回 true，之后一直是 true——滚出去不撤。
 *
 * ⚠ 2026-10-03「我的应用」：113 份文件、64 个网页工程的卡一打开全部开工——文件卡 84 张一起画，
 *   网页卡 82 张一起查验收（本地 p50 3.3 秒），屏幕上那一排反而最后出来。只给进了视口的卡开工。
 *   没有 IntersectionObserver 的环境（jsdom、老浏览器）直接当作已进视口（fail-open：宁可多画，不许不画）。
 */
export function useInViewOnce<T extends Element>(rootMargin = "300px 0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (inView || !ref.current) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setInView(true);
        io.disconnect();
      }
    }, { rootMargin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView] as const;
}
