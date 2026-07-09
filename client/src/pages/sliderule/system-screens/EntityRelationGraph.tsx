/**
 * EntityRelationGraph — React Flow 渲染的实体关系图（DataModel 屏主路径）。
 *
 * 实体卡是真 React 组件（标题栏 + 逐字段行，ref 字段珊瑚色标注 → 目标实体），
 * @dagrejs/dagre 计算左→右布局，smoothstep 平滑边带字段名标签——标签是
 * 纯 DOM，永远水平（取代 G6 版：其边标签随线段旋转导致文字倾斜）。
 * 数据来自 deriveErGraphData（与 mermaid 降级路径同一套 ref 关联推断）。
 */

import React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  deriveErGraphData,
  type ErGraphNode,
  type FiveSystemModel,
} from "./five-system-model";
import { useContainerSized } from "./use-sized";

const CARD_W = 236;
const ROW_H = 22;
const TITLE_H = 30;
const MAX_ROWS = 9;

function cardHeight(node: ErGraphNode): number {
  return TITLE_H + Math.min(node.fields.length, MAX_ROWS) * ROW_H + (node.fields.length > MAX_ROWS ? ROW_H : 0) + 6;
}

type ErFlowNode = Node<{ er: ErGraphNode }, "erNode">;

function ErNodeCard({ data }: NodeProps<ErFlowNode>) {
  const { er } = data;
  const rows = er.fields.slice(0, MAX_ROWS);
  return (
    <div
      style={{
        width: CARD_W,
        boxSizing: "border-box",
        background: "#fff",
        border: "1px solid #E3DED2",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(90,80,60,0.10)",
        fontFamily: "inherit",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div
        style={{
          height: TITLE_H,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 10px",
          background: "#eef0f4",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 4, background: "#1677ff", flexShrink: 0 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#33302a",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {er.name}
        </span>
        <span style={{ marginLeft: "auto", color: "#b8b2a4", fontSize: 9, fontFamily: "monospace" }}>{er.id}</span>
      </div>
      {rows.map((f) => (
        <div
          key={f.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: ROW_H,
            padding: "0 10px",
            borderTop: "1px solid #f4f1ea",
          }}
        >
          <span
            style={{
              color: "#8c8c8c",
              fontSize: 9,
              width: 46,
              flexShrink: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {f.type}
          </span>
          <span
            style={{
              color: "#3b3b3b",
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {f.name}
          </span>
          {f.refTarget && (
            <span style={{ marginLeft: "auto", color: "#0958d9", fontSize: 9, whiteSpace: "nowrap" }}>
              → {f.refTarget}
            </span>
          )}
        </div>
      ))}
      {er.fields.length > MAX_ROWS && (
        <div
          style={{
            height: ROW_H,
            lineHeight: `${ROW_H}px`,
            padding: "0 10px",
            borderTop: "1px solid #f4f1ea",
            color: "#bbb",
            fontSize: 10,
          }}
        >
          … 共 {er.fields.length} 个字段
        </div>
      )}
      <div style={{ height: 4 }} />
    </div>
  );
}

const NODE_TYPES = { erNode: ErNodeCard };

function layoutPositions(data: {
  nodes: ErGraphNode[];
  edges: Array<{ source: string; target: string; label: string }>;
}) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 44, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of data.nodes) g.setNode(n.id, { width: CARD_W, height: cardHeight(n) });
  // dagre 的 LR 秩沿边方向增长；ER 边是"多→一"，反着喂让被引用实体排前面。
  // 把标签实际尺寸喂给 dagre（labelpos:c）——列间距按最长字段名自动撑开，
  // 标签不再钻进卡片底下（节点层在边层之上，盖住即不可读）。
  for (const [i, e] of data.edges.entries()) {
    g.setEdge(
      e.target,
      e.source,
      { width: Math.max(e.label.length * 6.4 + 16, 40), height: 18, labelpos: "c" },
      `e-${i}`
    );
  }
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of data.nodes) {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - CARD_W / 2, y: p.y - cardHeight(n) / 2 };
  }
  return pos;
}

export function EntityRelationGraph({
  datamodel,
  className = "",
}: {
  datamodel: FiveSystemModel["datamodel"] | null | undefined;
  className?: string;
}) {
  const data = React.useMemo(() => deriveErGraphData(datamodel), [datamodel]);
  const { ref: containerRef, sized } = useContainerSized();

  const flowNodes: ErFlowNode[] = React.useMemo(() => {
    if (!data) return [];
    const positions = layoutPositions(data);
    return data.nodes.map((n) => ({
      id: n.id,
      type: "erNode" as const,
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: { er: n },
    }));
  }, [data]);

  const flowEdges: Edge[] = React.useMemo(
    () =>
      (data?.edges ?? []).map((e, i) => ({
        id: `r-${i}`,
        // 视觉上从"一"侧指向"多"侧持 ref 的实体？不——箭头语义保持"多引用一"：
        // 源 = 持 ref 实体，靶 = 被引用实体，与 er 图 crow-foot 阅读习惯一致
        source: e.target,
        target: e.source,
        type: "smoothstep",
        pathOptions: { borderRadius: 12 },
        label: e.label,
        style: { stroke: "#C9C2B2", strokeWidth: 1.5 },
        labelStyle: { fontSize: 10, fill: "#8c8577" },
        labelBgStyle: { fill: "#FCFBF8", fillOpacity: 1 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: "arrowclosed" as const, color: "#C9C2B2", width: 18, height: 18 },
      })),
    [data]
  );

  if (!data) return null;

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className}`} data-testid="er-graph">
      {sized && (
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          deleteKeyCode={null}
        >
          <Background gap={18} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      )}
      <span className="pointer-events-none absolute bottom-2 left-3 rounded-full bg-black/20 px-2 py-0.5 text-[9px] text-white/90">
        拖拽移动 · 滚轮缩放
      </span>
    </div>
  );
}
