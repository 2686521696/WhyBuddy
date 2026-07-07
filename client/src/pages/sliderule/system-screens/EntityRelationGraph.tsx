/**
 * EntityRelationGraph — G6 渲染的实体关系图（DataModel 屏主路径）。
 *
 * 取代 mermaid 的静态 ER 输出：实体卡片节点（html 节点，字段行 + ref 高亮）、
 * antv-dagre 自动布局、正交连线带字段名标签，画布可拖拽/滚轮缩放/整图适配。
 * 数据来自 deriveErGraphData（与 mermaid 路径同一套 ref 关联推断）。
 * 图仅在浏览器 effect 里创建，SSR/静态渲染只输出容器（node 测试环境安全）。
 */

import React from "react";
import { Graph } from "@antv/g6";
import {
  deriveErGraphData,
  type ErGraphNode,
  type FiveSystemModel,
} from "./five-system-model";

const CARD_W = 232;
const ROW_H = 22;
const TITLE_H = 30;
const MAX_ROWS = 9;

function cardHeight(node: ErGraphNode): number {
  return TITLE_H + Math.min(node.fields.length, MAX_ROWS) * ROW_H + (node.fields.length > MAX_ROWS ? ROW_H : 0) + 6;
}

function cardHtml(node: ErGraphNode): string {
  const rows = node.fields.slice(0, MAX_ROWS).map((f) => {
    const ref = f.refTarget
      ? `<span style="margin-left:auto;color:#C4633F;font-size:9px;white-space:nowrap">→ ${f.refTarget}</span>`
      : "";
    return `<div style="display:flex;align-items:center;gap:6px;height:${ROW_H}px;padding:0 10px;border-top:1px solid #f4f1ea">
      <span style="color:#8c8c8c;font-size:9px;width:44px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.type}</span>
      <span style="color:#3b3b3b;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
      ${ref}
    </div>`;
  });
  const more =
    node.fields.length > MAX_ROWS
      ? `<div style="height:${ROW_H}px;line-height:${ROW_H}px;padding:0 10px;border-top:1px solid #f4f1ea;color:#bbb;font-size:10px">… 共 ${node.fields.length} 个字段</div>`
      : "";
  return `<div style="width:${CARD_W}px;background:#fff;border:1px solid #E3DED2;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(90,80,60,0.10);font-family:inherit">
    <div style="height:${TITLE_H}px;display:flex;align-items:center;gap:7px;padding:0 10px;background:#F5F1EA">
      <span style="width:7px;height:7px;border-radius:4px;background:#1677ff;flex-shrink:0"></span>
      <span style="font-size:12px;font-weight:600;color:#33302a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${node.name}</span>
      <span style="margin-left:auto;color:#b8b2a4;font-size:9px;font-family:monospace">${node.id}</span>
    </div>
    ${rows.join("")}${more}
    <div style="height:4px"></div>
  </div>`;
}

export function EntityRelationGraph({
  datamodel,
  className = "",
}: {
  datamodel: FiveSystemModel["datamodel"] | null | undefined;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const data = React.useMemo(() => deriveErGraphData(datamodel), [datamodel]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;
    // 屏可能以 hidden 状态常挂载（ActiveSystemScreen），尺寸为 0 时建图会
    // 退化成 100×100 默认画布——延迟到容器真正有尺寸再创建，并随尺寸跟随。
    let graph: Graph | null = null;
    let destroyed = false;
    const ensure = (w: number, h: number) => {
      if (destroyed || w <= 0 || h <= 0) return;
      if (graph) {
        graph.setSize(w, h);
        graph.fitView().catch(() => {});
        return;
      }
      graph = createGraph(container, w, h);
      graph.render();
    };
    const createGraph = (el: HTMLElement, width: number, height: number) => new Graph({
      container: el,
      width,
      height,
      autoFit: { type: "view", options: { when: "always" } },
      padding: 24,
      data: {
        nodes: data.nodes.map((n) => ({
          id: n.id,
          data: {},
          style: {
            size: [CARD_W, cardHeight(n)],
            innerHTML: cardHtml(n),
          },
        })),
        edges: data.edges.map((e, i) => ({
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          style: {
            labelText: e.label,
          },
        })),
      },
      node: { type: "html" },
      edge: {
        type: "polyline",
        style: {
          router: { type: "orth" },
          radius: 8,
          stroke: "#C9C2B2",
          lineWidth: 1.5,
          endArrow: true,
          endArrowType: "vee",
          endArrowSize: 9,
          labelFontSize: 10,
          labelFill: "#8c8577",
          labelBackground: true,
          labelBackgroundFill: "#FCFBF8",
          labelBackgroundRadius: 4,
          labelPadding: [1, 4],
        },
      },
      layout: {
        type: "antv-dagre",
        rankdir: "LR",
        nodesep: 28,
        ranksep: 64,
      },
      behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    });

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
  }, [data]);

  if (!data) return null;

  return (
    <div className={`relative h-full w-full ${className}`} data-testid="er-graph">
      <div ref={containerRef} className="h-full w-full" />
      <span className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-black/20 px-2 py-0.5 text-[9px] text-white/90">
        拖拽移动 · 滚轮缩放
      </span>
    </div>
  );
}
