/**
 * SystemLinkageGraph — 全局大沙盘（AppBundle 屏「沙盘」视图）。
 *
 * 参照分组流程图范式：每个系统一个圆角分组容器（数据中台/页面设计器/
 * 工作流/权限/AIGC 中台），成员为容器内小节点，跨系统引用以语义着色的
 * 连线表达，顶部图例条与线色一一对应（颜色从不单独传达，图例文字常在）。
 *
 * ⚑ 2026-08-14（晚）从"联动图"升级成沙盘——「接线通不通，一眼就知道」：
 *   · 数据换 deriveSandboxGraph：页→实体画**全部**真实引用（不只主导实体）、
 *     补角色→页面边（权限那只手此前在图上没连到页面）
 *   · 点选联动：点一个成员，它的线全亮、无关的线和成员变暗，再点空白复原
 *     ——线多了以后"看一根线"必须靠这个，不然就是毛线团（模式同 React Flow
 *     官方 highlight 示例：选中态只改样式，不改图数据）
 *   · 断线体检条：孤岛成员逐个点名（没人读的实体、没有手的角色、零数据孔
 *     的页面、输出悬空的 AIGC），点名字直接选中定位。结构闸查"引用悬空"，
 *     体检查反面"东西不在网里"——空数组没有引用，闸永远不会替这个说话
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
import type { FiveSystemModel, LinkageGroup, LinkageSystem } from "./five-system-model";
import { deriveSandboxGraph, type SandboxProblem } from "./sandbox-graph";
import { useContainerSized } from "./use-sized";

const SYSTEM_TINT: Record<LinkageSystem, { dot: string; bg: string; border: string }> = {
  datamodel: { dot: "#1677ff", bg: "#F5F8FF", border: "#D6E4FF" },
  page: { dot: "#0d9488", bg: "#F0FAF8", border: "#C7EAE4" },
  workflow: { dot: "#722ed1", bg: "#F8F5FF", border: "#E3D7F7" },
  rbac: { dot: "#fa8c16", bg: "#FFF9F0", border: "#F7E3C7" },
  aigc: { dot: "#c41d7f", bg: "#FDF4F9", border: "#F3D4E6" },
};

// 边语义 → 颜色（与图例一致；dataviz 校验过的分类色板成员）
const EDGE_KIND_META: Record<string, { color: string; label: string; dashed?: boolean }> = {
  "page-entity": { color: "#1677ff", label: "页面 → 实体（字段绑定）" },
  "page-workflow": { color: "#722ed1", label: "页面 → 流程（应用装配）" },
  "node-role": { color: "#fa8c16", label: "流程节点 → 审批角色" },
  "role-page": { color: "#fa8c16", label: "角色 → 页面（可进入）", dashed: true },
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
type ItemNode = Node<
  {
    name: string;
    system: LinkageSystem;
    /** 有选中时，不相邻的成员整体变暗（选中态只改样式不改图数据） */
    dimmed?: boolean;
    selected?: boolean;
    /** 断线体检点名的原因（有值即在卡上亮红点） */
    problem?: string;
  },
  "sysItem"
>;

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
      <div style={{ display: "flex", alignItems: "center", gap: 7, height: GROUP_TITLE_H, padding: `0 ${GROUP_PAD}px` }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: tint.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#33302a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
        gap: 5,
        background: "#fff",
        border: data.selected ? `1.5px solid ${tint.dot}` : "1px solid #E3DED2",
        borderLeft: `3px solid ${tint.dot}`,
        borderRadius: 8,
        padding: "0 9px",
        fontSize: 11,
        color: "#3b3b3b",
        boxShadow: data.selected
          ? `0 0 0 3px ${tint.border}, 0 1px 4px rgb(90 80 60 / 0.12)`
          : "0 1px 4px rgb(90 80 60 / 0.07)",
        fontFamily: "inherit",
        opacity: data.dimmed ? 0.28 : 1,
        cursor: "pointer",
        transition: "opacity 120ms",
      }}
      title={data.problem ? `${data.name} ⚠ ${data.problem}` : data.name}
    >
      <Handle id="t-left" type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="t-right" type="target" position={Position.Right} style={{ opacity: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.name}</span>
      {data.problem && (
        <span
          aria-label="断线"
          style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: 4, background: "#e5484d", flexShrink: 0 }}
        />
      )}
      <Handle id="s-left" type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="s-right" type="source" position={Position.Right} style={{ opacity: 0 }} />
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
  const data = React.useMemo(() => deriveSandboxGraph(model), [model]);
  const { ref: containerRef, sized } = useContainerSized();
  // 选中的成员 key（`${system}:${id}`）；null = 无选中，全图常亮
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  // 选中成员的邻居集合（含自身）——决定谁保持常亮
  const neighborKeys = React.useMemo(() => {
    if (!data || !selectedKey) return null;
    const set = new Set<string>([selectedKey]);
    for (const e of data.edges) {
      if (e.from === selectedKey) set.add(e.to);
      if (e.to === selectedKey) set.add(e.from);
    }
    return set;
  }, [data, selectedKey]);

  const problemByKey = React.useMemo(() => {
    const map = new Map<string, SandboxProblem>();
    for (const p of data?.problems ?? []) map.set(p.key, p);
    return map;
  }, [data]);

  const { flowNodes, flowEdges, legendKinds } = React.useMemo(() => {
    if (!data) return { flowNodes: [] as Node[], flowEdges: [] as Edge[], legendKinds: [] as string[] };
    const row0 = data.groups.filter((g) => GROUP_COLUMN[g.system].row === 0);
    const row0Height = Math.max(0, ...row0.map(groupHeight));
    // 整列槽位：每个整数列取该列实际最宽组，槽位 x 累计（组可加宽不重叠）
    const widthOfCol = (c: number) =>
      Math.max(
        ITEM_W + GROUP_PAD * 2,
        ...data.groups.filter((g) => GROUP_COLUMN[g.system].col === c).map(groupWidth)
      );
    const slotX: number[] = [];
    for (let c = 0; c <= 3; c++) slotX[c] = c === 0 ? 0 : slotX[c - 1] + widthOfCol(c - 1) + COL_GAP;
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
      nodes.push({ id: `g-${g.system}`, type: "sysGroup", position: { x, y }, data: { group: g }, draggable: true });
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
          data: {
            name: item.name,
            system: item.system,
            selected: item.key === selectedKey,
            dimmed: neighborKeys ? !neighborKeys.has(item.key) : false,
            problem: problemByKey.get(item.key)?.reason,
          },
        });
      });
    }
    const colOf = (key: string) => GROUP_COLUMN[key.split(":")[0] as LinkageSystem]?.col ?? 0;
    const edges: Edge[] = data.edges.map((e, i) => {
      const meta = EDGE_KIND_META[e.kind];
      const rightward = colOf(e.to) >= colOf(e.from);
      // 有选中时：挨着选中成员的线加亮加粗，其余压到近乎不可见
      const touched = !selectedKey || e.from === selectedKey || e.to === selectedKey;
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
          strokeWidth: selectedKey && touched ? 2.5 : 1.5,
          strokeDasharray: meta.dashed ? "6 4" : undefined,
          opacity: touched ? (selectedKey ? 0.95 : 0.8) : 0.07,
        },
        markerEnd: { type: "arrowclosed" as const, color: meta.color, width: 16, height: 16 },
      };
    });
    const legendKinds = [...new Set(data.edges.map((e) => e.kind))];
    return { flowNodes: nodes, flowEdges: edges, legendKinds };
  }, [data, selectedKey, neighborKeys, problemByKey]);

  // 选中成员的读数卡素材：邻边按语义分类计数 + 体检点名（如有）
  const selectedDetail = React.useMemo(() => {
    if (!data || !selectedKey) return null;
    const name =
      data.groups.flatMap((g) => g.items).find((i) => i.key === selectedKey)?.name ?? selectedKey;
    const counts = new Map<string, number>();
    for (const e of data.edges) {
      if (e.from === selectedKey || e.to === selectedKey)
        counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    }
    return {
      name,
      counts: [...counts.entries()],
      problem: problemByKey.get(selectedKey)?.reason ?? null,
    };
  }, [data, selectedKey, problemByKey]);

  if (!data) return null;

  return (
    <div className={`flex h-full w-full flex-col ${className}`} data-testid="system-linkage-graph">
      {/* 图例条：只列实际出现的边语义，颜色与线一致 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#e8eaee] bg-[#FBF9F4] px-4 py-1.5">
        <span className="text-[10px] text-stone-400">图例</span>
        {legendKinds.map((kind) => {
          const meta = EDGE_KIND_META[kind];
          return (
            <span key={kind} className="inline-flex items-center gap-1.5 text-[10px] text-stone-500">
              <svg width="22" height="6" aria-hidden>
                <line x1="0" y1="3" x2="22" y2="3" stroke={meta.color} strokeWidth="2" strokeDasharray={meta.dashed ? "5 3" : undefined} />
              </svg>
              {meta.label}
            </span>
          );
        })}
      </div>
      {/* 断线体检条：孤岛逐个点名，点名字选中定位；全通时如实说全通 */}
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#e8eaee] bg-[#FBF9F4] px-4 py-1.5"
        data-testid="sandbox-problems"
      >
        <span className="text-[10px] text-stone-400">体检</span>
        {data.problems.length === 0 ? (
          <span className="text-[10px] text-emerald-600">接线全通——没有孤岛成员</span>
        ) : (
          <>
            <span className="text-[10px] font-medium text-[#e5484d]">
              断线 {data.problems.length} 处
            </span>
            {data.problems.map((p) => (
              <button
                key={p.key}
                type="button"
                title={p.reason}
                onClick={() => setSelectedKey((cur) => (cur === p.key ? null : p.key))}
                className={`rounded-full border px-2 py-0.5 text-[10px] leading-none transition-colors ${
                  selectedKey === p.key
                    ? "border-[#e5484d] bg-[#e5484d] text-white"
                    : "border-[#f0c8ca] bg-white text-[#b3383d] hover:bg-[#fdf2f2]"
                }`}
              >
                {p.name}
              </button>
            ))}
          </>
        )}
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
            onNodeClick={(_, node) => {
              if (node.type !== "sysItem") return;
              setSelectedKey((cur) => (cur === node.id ? null : node.id));
            }}
            onPaneClick={() => setSelectedKey(null)}
          >
            <Background gap={18} size={1} color="#e5e7eb" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        )}
        {/* 选中读数卡：这个成员牵着几根什么线；体检点名原话也在这 */}
        {selectedDetail && (
          <div
            className="absolute bottom-2 left-3 max-w-[320px] rounded-lg border border-[#e3ded2] bg-white/95 px-3 py-2 shadow-sm"
            data-testid="sandbox-selected-card"
          >
            <div className="text-[12px] font-semibold text-stone-700">{selectedDetail.name}</div>
            {selectedDetail.counts.length === 0 ? (
              <div className="mt-0.5 text-[11px] text-stone-400">没有任何连线</div>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {selectedDetail.counts.map(([kind, n]) => (
                  <div key={kind} className="flex items-center gap-1.5 text-[11px] text-stone-500">
                    <span
                      className="inline-block h-[3px] w-4 rounded-full"
                      style={{ background: EDGE_KIND_META[kind]?.color ?? "#999" }}
                    />
                    {EDGE_KIND_META[kind]?.label ?? kind} × {n}
                  </div>
                ))}
              </div>
            )}
            {selectedDetail.problem && (
              <div className="mt-1 text-[11px] text-[#b3383d]">⚠ {selectedDetail.problem}</div>
            )}
          </div>
        )}
        {!selectedDetail && (
          <span className="pointer-events-none absolute bottom-2 left-3 rounded-full bg-black/20 px-2 py-0.5 text-[9px] text-white/90">
            点成员看它牵的线 · 拖拽移动 · 滚轮缩放
          </span>
        )}
      </div>
    </div>
  );
}
