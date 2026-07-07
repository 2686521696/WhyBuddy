/**
 * WorkflowGraph — React Flow 渲染的业务流程活图（Workflow 屏主路径）。
 *
 * 节点是真 React 组件（角色色条 + @role chip + 始/终徽标），边为 smoothstep
 * 平滑折线带条件标签，@dagrejs/dagre 计算自上而下布局，自带缩放控制器与
 * 网格底纹。订阅运行时状态：「试运行」推进的实例实时高亮当前停留节点
 * （珊瑚描边 + 实例计数徽标，出边流动动画）——流程图 = 运行监视器。
 *
 * 色板经 dataviz 校验（CVD ΔE 22.8 PASS），角色名文字始终在场，
 * 不靠颜色单独传达。屏常挂载（hidden）时容器零尺寸：门控到实际
 * 有尺寸再挂 ReactFlow，避免空画布。
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
  deriveWorkflowGraphData,
  type FiveSystemModel,
  type WfGraphNode,
} from "./five-system-model";
import { loadRuntimeState, subscribeRuntimeChanged } from "../live-runtime/runtime-persistence";

// 经 dataviz 校验的分类色板（低对比两色由角色名文字补偿）
const ROLE_PALETTE = ["#1677ff", "#fa8c16", "#722ed1", "#13c2c2", "#c41d7f", "#5b8c00"];
const ROLE_FALLBACK = "#8c8c8c";
const HIGHLIGHT = "#D97757";

const CARD_W = 208;
const CARD_H = 66;

function roleColor(role: string | null, roles: string[]): string {
  if (!role) return ROLE_FALLBACK;
  const idx = roles.indexOf(role);
  return idx >= 0 ? ROLE_PALETTE[idx % ROLE_PALETTE.length] : ROLE_FALLBACK;
}

type WfFlowNode = Node<{ wf: WfGraphNode; color: string; running: number }, "wfNode">;

function WfNodeCard({ data }: NodeProps<WfFlowNode>) {
  const { wf, color, running } = data;
  const barColor = wf.roleResolved ? color : "#ff4d4f";
  return (
    <div
      style={{
        width: CARD_W,
        boxSizing: "border-box",
        background: "#fff",
        border: running > 0 ? `2px solid ${HIGHLIGHT}` : "1px solid #E3DED2",
        borderLeft: `4px solid ${barColor}`,
        borderRadius: 10,
        padding: "8px 10px",
        boxShadow:
          running > 0
            ? "0 0 0 4px rgba(217,119,87,0.15), 0 2px 8px rgba(90,80,60,0.10)"
            : "0 2px 8px rgba(90,80,60,0.10)",
        fontFamily: "inherit",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#33302a",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {wf.name}
        </span>
        {wf.isStart && (
          <span style={{ background: "#e6f4ff", color: "#1677ff", borderRadius: 8, padding: "0 6px", fontSize: 9 }}>始</span>
        )}
        {wf.isTerminal && (
          <span style={{ background: "#f6ffed", color: "#5b8c00", borderRadius: 8, padding: "0 6px", fontSize: 9 }}>终</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, minHeight: 14 }}>
        {wf.role ? (
          <>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: barColor, flexShrink: 0 }} />
            <span
              style={{
                fontSize: 10,
                color: wf.roleResolved ? "#6b6558" : "#ff4d4f",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {wf.roleResolved ? "" : "✗ "}@{wf.role}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 10, color: "#c9c2b2" }}>无审批人</span>
        )}
        {running > 0 && (
          <span
            style={{
              marginLeft: "auto",
              background: HIGHLIGHT,
              color: "#fff",
              borderRadius: 8,
              padding: "0 7px",
              fontSize: 9,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            ● {running} 实例在此
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { wfNode: WfNodeCard };

/** dagre TB 布局：返回 nodeId → 左上角坐标（React Flow 用左上角定位）。 */
function layoutPositions(
  nodes: WfGraphNode[],
  edges: Array<{ from: string; to: string }>
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 56 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: CARD_W, height: CARD_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - CARD_W / 2, y: p.y - CARD_H / 2 };
  }
  return pos;
}

export function WorkflowGraph({
  model,
  sessionId,
  className = "",
}: {
  model: FiveSystemModel;
  sessionId?: string;
  className?: string;
}) {
  const data = React.useMemo(() => deriveWorkflowGraphData(model), [model]);
  const roles = React.useMemo(() => model.rbac?.roles ?? [], [model.rbac?.roles]);

  // 「试运行」推进实例 → runtime-changed 事件 → 重算各节点停留实例数
  const [runtimeVersion, setRuntimeVersion] = React.useState(0);
  React.useEffect(() => {
    if (!sessionId) return;
    return subscribeRuntimeChanged(sessionId, () => setRuntimeVersion((v) => v + 1));
  }, [sessionId]);
  const runningByNode = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (!sessionId) return counts;
    const state = loadRuntimeState(sessionId);
    for (const inst of state?.instances ?? []) {
      if (inst.status === "running") counts[inst.currentNodeId] = (counts[inst.currentNodeId] ?? 0) + 1;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, runtimeVersion]);

  // 布局只依赖结构；高亮变化不重排
  const positions = React.useMemo(
    () => (data ? layoutPositions(data.nodes, data.edges) : {}),
    [data]
  );

  const flowNodes: WfFlowNode[] = React.useMemo(
    () =>
      (data?.nodes ?? []).map((n) => ({
        id: n.id,
        type: "wfNode" as const,
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: { wf: n, color: roleColor(n.role, roles), running: runningByNode[n.id] ?? 0 },
      })),
    [data, positions, roles, runningByNode]
  );

  const flowEdges: Edge[] = React.useMemo(
    () =>
      (data?.edges ?? []).map((e, i) => ({
        id: `t-${i}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        label: e.condition ?? undefined,
        // 实例正停留的节点，出边流动动画——下一步会走向哪里一眼可见
        animated: (runningByNode[e.from] ?? 0) > 0,
        style: { stroke: "#C9C2B2", strokeWidth: 1.5 },
        labelStyle: { fontSize: 10, fill: "#8c8577" },
        labelBgStyle: { fill: "#FCFBF8", fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: "arrowclosed" as const, color: "#C9C2B2", width: 18, height: 18 },
      })),
    [data, runningByNode]
  );

  // 屏常挂载（hidden）：容器有实际尺寸才挂 ReactFlow（否则空画布警告）
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [sized, setSized] = React.useState(false);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => setSized(el.clientWidth > 0 && el.clientHeight > 0);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data) return null;

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className}`} data-testid="workflow-graph">
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
          <Background gap={18} size={1} color="#E7E2D9" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      )}
      <span className="pointer-events-none absolute bottom-2 left-3 rounded-full bg-black/20 px-2 py-0.5 text-[9px] text-white/90">
        拖拽移动 · 滚轮缩放 · 试运行实例实时高亮
      </span>
    </div>
  );
}
