/**
 * SystemLinkageGraph — 五系统整体联动图（AppBundle 屏「联动图」视图）。
 *
 * 参照用户提供的分组流程图范式：每个系统一个圆角分组容器（数据中台/
 * 页面设计器/工作流/权限/AIGC 中台），成员为容器内小节点，跨系统引用
 * 以语义着色的连线表达（页面→实体蓝、页面→流程紫、节点→角色橙、
 * AIGC→实体/角色粉），顶部图例条与线色一一对应（颜色从不单独传达，
 * 图例文字常在）。数据来自 deriveSystemLinkageGraph（只画真实解析出的
 * 引用，成员截断如实计数）。
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
import {
  deriveSystemLinkageGraph,
  type FiveSystemModel,
  type LinkageGroup,
  type LinkageSystem,
} from "./five-system-model";
import { useContainerSized } from "./use-sized";

const SYSTEM_TINT: Record<
  LinkageSystem,
  { dot: string; bg: string; border: string }
> = {
  datamodel: { dot: "#1677ff", bg: "#F5F8FF", border: "#D6E4FF" },
  page: { dot: "#0d9488", bg: "#F0FAF8", border: "#C7EAE4" },
  workflow: { dot: "#722ed1", bg: "#F8F5FF", border: "#E3D7F7" },
  rbac: { dot: "#fa8c16", bg: "#FFF9F0", border: "#F7E3C7" },
  aigc: { dot: "#c41d7f", bg: "#FDF4F9", border: "#F3D4E6" },
};

// 边语义 → 颜色（与图例一致；dataviz 校验过的分类色板成员）
const EDGE_KIND_META: Record<
  string,
  { color: string; label: string; dashed?: boolean }
> = {
  "page-entity": { color: "#1677ff", label: "页面 → 实体（字段绑定）" },
  "page-workflow": { color: "#722ed1", label: "页面 → 流程（应用装配）" },
  "node-role": { color: "#fa8c16", label: "流程节点 → 审批角色" },
  "aigc-entity": { color: "#c41d7f", label: "AIGC → 输出实体" },
  "aigc-role": { color: "#c41d7f", label: "AIGC → 可用角色", dashed: true },
};

const ITEM_W = 176;
const ITEM_H = 34;
const ITEM_GAP = 8;
const GROUP_PAD = 14;
const GROUP_TITLE_H = 36;
// 全部成员展开：组内超过 12 个自动分内列（组变宽不变超高）
const ITEMS_PER_INNER_COL = 12;

function innerCols(g: LinkageGroup): number {
  return Math.max(1, Math.ceil(g.items.length / ITEMS_PER_INNER_COL));
}

function groupWidth(g: LinkageGroup): number {
  const cols = innerCols(g);
  return GROUP_PAD * 2 + cols * ITEM_W + (cols - 1) * ITEM_GAP;
}

function groupHeight(g: LinkageGroup): number {
  const rows = Math.min(g.items.length, ITEMS_PER_INNER_COL);
  return GROUP_TITLE_H + rows * (ITEM_H + ITEM_GAP) + GROUP_PAD;
}

type GroupNode = Node<{ group: LinkageGroup }, "sysGroup">;
type ItemNode = Node<{ name: string; system: LinkageSystem }, "sysItem">;

function SysGroupCard({ data }: NodeProps<GroupNode>) {
  const { group } = data;
  const tint = SYSTEM_TINT[group.system];
  return (
    <div
      style={{
        width: groupWidth(group),
        height: groupHeight(group),
        boxSizing: "border-box",
        background: tint.bg,
        border: `1.5px solid ${tint.border}`,
        borderRadius: 14,
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: GROUP_TITLE_H,
          padding: `0 ${GROUP_PAD}px`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: tint.dot,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#33302a",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {group.label}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#98a2b3" }}>
          {group.items.length}
        </span>
      </div>
    </div>
  );
}

function SysItemCard({ data }: NodeProps<ItemNode>) {
  const tint = SYSTEM_TINT[data.system];
  return (
    <div
      style={{
        width: ITEM_W,
        height: ITEM_H,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        background: "#fff",
        border: "1px solid #E3DED2",
        borderLeft: `3px solid ${tint.dot}`,
        borderRadius: 8,
        padding: "0 9px",
        fontSize: 11,
        color: "#3b3b3b",
        boxShadow: "0 1px 4px rgb(90 80 60 / 0.07)",
        fontFamily: "inherit",
      }}
      title={data.name}
    >
      <Handle
        id="t-left"
        type="target"
        position={Position.Left}
        style={{ opacity: 0 }}
      />
      <Handle
        id="t-right"
        type="target"
        position={Position.Right}
        style={{ opacity: 0 }}
      />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.name}
      </span>
      <Handle
        id="s-left"
        type="source"
        position={Position.Left}
        style={{ opacity: 0 }}
      />
      <Handle
        id="s-right"
        type="source"
        position={Position.Right}
        style={{ opacity: 0 }}
      />
    </div>
  );
}

const NODE_TYPES = { sysGroup: SysGroupCard, sysItem: SysItemCard };

/**
 * 手排布局（组数固定为 ≤5，无需布局引擎）：
 * 主流向严格从左到右：数据中台 → 页面 → 工作流 → 权限（蓝/紫/橙边全部单向），
 * AIGC 沉底行居中——向左上连实体（粉实线）、向右上连角色（粉虚线），互不穿组。
 */
const GROUP_COLUMN: Record<LinkageSystem, { col: number; row: number }> = {
  datamodel: { col: 0, row: 0 },
  page: { col: 1, row: 0 },
  workflow: { col: 2, row: 0 },
  rbac: { col: 3, row: 0 },
  aigc: { col: 1.5, row: 1 },
};
const COL_GAP = 170;
const ROW_GAP = 110;

export function SystemLinkageGraph({
  model,
  className = "",
}: {
  model: FiveSystemModel | null | undefined;
  className?: string;
}) {
  const data = React.useMemo(() => deriveSystemLinkageGraph(model), [model]);
  const { ref: containerRef, sized } = useContainerSized();

  const { flowNodes, flowEdges, legendKinds } = React.useMemo(() => {
    if (!data)
      return {
        flowNodes: [] as Node[],
        flowEdges: [] as Edge[],
        legendKinds: [] as string[],
      };
    const row0 = data.groups.filter(g => GROUP_COLUMN[g.system].row === 0);
    const row0Height = Math.max(0, ...row0.map(groupHeight));
    // 整列槽位：每个整数列取该列实际最宽组，槽位 x 累计（组可加宽不重叠）
    const widthOfCol = (c: number) =>
      Math.max(
        ITEM_W + GROUP_PAD * 2,
        ...data.groups
          .filter(g => GROUP_COLUMN[g.system].col === c)
          .map(groupWidth)
      );
    const slotX: number[] = [];
    for (let c = 0; c <= 3; c++)
      slotX[c] = c === 0 ? 0 : slotX[c - 1] + widthOfCol(c - 1) + COL_GAP;
    const xOfCol = (col: number) => {
      if (Number.isInteger(col)) return slotX[col] ?? 0;
      const lo = Math.floor(col);
      const hi = Math.ceil(col);
      return ((slotX[lo] ?? 0) + (slotX[hi] ?? 0)) / 2;
    };
    const nodes: Node[] = [];
    for (const g of data.groups) {
      const { col, row } = GROUP_COLUMN[g.system];
      const x = xOfCol(col);
      const y = row === 0 ? 0 : row0Height + ROW_GAP;
      nodes.push({
        id: `g-${g.system}`,
        type: "sysGroup",
        position: { x, y },
        data: { group: g },
        draggable: true,
      });
      g.items.forEach((item, i) => {
        const innerCol = Math.floor(i / ITEMS_PER_INNER_COL);
        const innerRow = i % ITEMS_PER_INNER_COL;
        nodes.push({
          id: item.key,
          type: "sysItem",
          parentId: `g-${g.system}`,
          extent: "parent",
          draggable: false,
          position: {
            x: GROUP_PAD + innerCol * (ITEM_W + ITEM_GAP),
            y: GROUP_TITLE_H + innerRow * (ITEM_H + ITEM_GAP),
          },
          data: { name: item.name, system: item.system },
        });
      });
    }
    const colOf = (key: string) =>
      GROUP_COLUMN[key.split(":")[0] as LinkageSystem]?.col ?? 0;
    const edges: Edge[] = data.edges.map((e, i) => {
      const meta = EDGE_KIND_META[e.kind];
      const rightward = colOf(e.to) >= colOf(e.from);
      return {
        id: `l-${i}`,
        source: e.from,
        target: e.to,
        sourceHandle: rightward ? "s-right" : "s-left",
        targetHandle: rightward ? "t-left" : "t-right",
        type: "smoothstep",
        pathOptions: { borderRadius: 10 },
        style: {
          stroke: meta.color,
          strokeWidth: 1.5,
          strokeDasharray: meta.dashed ? "6 4" : undefined,
          opacity: 0.8,
        },
        markerEnd: {
          type: "arrowclosed" as const,
          color: meta.color,
          width: 16,
          height: 16,
        },
      };
    });
    const legendKinds = [...new Set(data.edges.map(e => e.kind))];
    return { flowNodes: nodes, flowEdges: edges, legendKinds };
  }, [data]);

  if (!data) return null;

  return (
    <div
      className={`flex h-full w-full flex-col ${className}`}
      data-testid="system-linkage-graph"
    >
      {/* 图例条：只列实际出现的边语义，颜色与线一致 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#e8eaee] bg-[#FBF9F4] px-4 py-1.5">
        <span className="text-[10px] text-stone-400">图例</span>
        {legendKinds.map(kind => {
          const meta = EDGE_KIND_META[kind];
          return (
            <span
              key={kind}
              className="inline-flex items-center gap-1.5 text-[10px] text-stone-500"
            >
              <svg width="22" height="6" aria-hidden>
                <line
                  x1="0"
                  y1="3"
                  x2="22"
                  y2="3"
                  stroke={meta.color}
                  strokeWidth="2"
                  strokeDasharray={meta.dashed ? "5 3" : undefined}
                />
              </svg>
              {meta.label}
            </span>
          );
        })}
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {sized && (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.12 }}
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
          拖拽移动 · 滚轮缩放 · 组可整体拖动
        </span>
      </div>
    </div>
  );
}
