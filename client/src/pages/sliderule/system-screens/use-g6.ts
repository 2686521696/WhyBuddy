/**
 * useG6Graph — G6 图的尺寸安全挂载 hook（EntityRelationGraph / WorkflowGraph 共用）。
 *
 * 系统屏常以 hidden 状态挂载（ActiveSystemScreen 全屏常挂避免 mermaid 闪烁），
 * G6 在零尺寸容器里初始化会退化成 100×100 默认画布——这里延迟到容器真正
 * 有尺寸再建图，并用 ResizeObserver 跟随 setSize + fitView。
 */

import React from "react";
import type { Graph } from "@antv/g6";

export function useG6Graph(
  create: ((container: HTMLElement, width: number, height: number) => Graph) | null,
  deps: React.DependencyList
): React.RefObject<HTMLDivElement | null> {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const container = ref.current;
    if (!container || !create) return;
    let graph: Graph | null = null;
    let destroyed = false;
    const ensure = (w: number, h: number) => {
      if (destroyed || w <= 0 || h <= 0) return;
      if (graph) {
        graph.setSize(w, h);
        graph.fitView().catch(() => {});
        return;
      }
      graph = create(container, w, h);
      graph.render();
    };
    ensure(container.clientWidth, container.clientHeight);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => ensure(container.clientWidth, container.clientHeight))
        : null;
    ro?.observe(container);
    return () => {
      destroyed = true;
      ro?.disconnect();
      graph?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
