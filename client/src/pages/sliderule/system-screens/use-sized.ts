/**
 * useContainerSized — 容器尺寸门控（React Flow 图共用）。
 *
 * 系统屏常以 hidden 状态挂载（ActiveSystemScreen 全屏常挂避免闪烁），
 * 零尺寸容器里挂 ReactFlow 会得到空画布——门控到容器真正有尺寸再渲染。
 */

import React from "react";

export function useContainerSized(): {
  ref: React.RefObject<HTMLDivElement | null>;
  sized: boolean;
} {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [sized, setSized] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setSized(el.clientWidth > 0 && el.clientHeight > 0);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, sized };
}
