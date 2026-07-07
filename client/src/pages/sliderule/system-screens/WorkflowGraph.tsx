/**
 * WorkflowGraph — G6 渲染的业务流程活图（Workflow 屏主路径）。
 *
 * 取代 mermaid 的静态流程图：节点卡按审批人角色着色（左侧色条 + 角色 chip，
 * 色板经 CVD 校验，角色名文字始终在场——不靠颜色单独传达）、始/终徽标、
 * 条件转移边带标签；订阅运行时状态，「试运行」里推进的实例实时高亮
 * 当前停留节点（珊瑚描边 + 实例计数徽标）——流程图和试运行合成一张活图。
 */

import React from "react";
import { Graph } from "@antv/g6";
import {
  deriveWorkflowGraphData,
  type FiveSystemModel,
  type WfGraphNode,
} from "./five-system-model";
import { useG6Graph } from "./use-g6";
import { loadRuntimeState, subscribeRuntimeChanged } from "../live-runtime/runtime-persistence";

// 经 dataviz 校验的分类色板（CVD ΔE 22.8 PASS；低对比两色由角色名文字补偿）
const ROLE_PALETTE = ["#1677ff", "#fa8c16", "#722ed1", "#13c2c2", "#c41d7f", "#5b8c00"];
const ROLE_FALLBACK = "#8c8c8c";
const HIGHLIGHT = "#D97757";

const CARD_W = 200;

function roleColor(role: string | null, roles: string[]): string {
  if (!role) return ROLE_FALLBACK;
  const idx = roles.indexOf(role);
  return idx >= 0 ? ROLE_PALETTE[idx % ROLE_PALETTE.length] : ROLE_FALLBACK;
}

function cardHeight(node: WfGraphNode): number {
  return node.role ? 64 : 44;
}

function nodeHtml(node: WfGraphNode, color: string, runningCount: number): string {
  const badges: string[] = [];
  if (node.isStart)
    badges.push('<span style="background:#e6f4ff;color:#1677ff;border-radius:8px;padding:0 6px;font-size:9px">始</span>');
  if (node.isTerminal)
    badges.push('<span style="background:#f6ffed;color:#5b8c00;border-radius:8px;padding:0 6px;font-size:9px">终</span>');
  if (runningCount > 0)
    badges.push(
      `<span style="background:${HIGHLIGHT};color:#fff;border-radius:8px;padding:0 7px;font-size:9px;font-weight:600">● ${runningCount} 实例在此</span>`
    );
  const roleChip = node.role
    ? `<div style="display:flex;align-items:center;gap:5px;margin-top:5px">
        <span style="width:7px;height:7px;border-radius:4px;background:${node.roleResolved ? color : "#ff4d4f"};flex-shrink:0"></span>
        <span style="font-size:10px;color:${node.roleResolved ? "#6b6558" : "#ff4d4f"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
          node.roleResolved ? "" : "✗ "
        }@${node.role}</span>
      </div>`
    : "";
  const border = runningCount > 0 ? `2px solid ${HIGHLIGHT}` : "1px solid #E3DED2";
  const glow = runningCount > 0 ? `0 0 0 4px rgba(217,119,87,0.15), 0 2px 8px rgba(90,80,60,0.10)` : "0 2px 8px rgba(90,80,60,0.10)";
  return `<div style="width:${CARD_W}px;box-sizing:border-box;background:#fff;border:${border};border-left:4px solid ${node.roleResolved ? color : "#ff4d4f"};border-radius:10px;padding:8px 10px;box-shadow:${glow};font-family:inherit">
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:12px;font-weight:600;color:#33302a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${node.name}</span>
      ${badges.join("")}
    </div>
    ${roleChip}
  </div>`;
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
  const roles = model.rbac?.roles ?? [];

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

  const containerRef = useG6Graph(
    data
      ? (container, width, height) =>
          new Graph({
            container,
            width,
            height,
            autoFit: { type: "view", options: { when: "always" } },
            padding: 24,
            data: {
              nodes: data.nodes.map((n) => ({
                id: n.id,
                style: {
                  size: [CARD_W, cardHeight(n)],
                  innerHTML: nodeHtml(n, roleColor(n.role, roles), runningByNode[n.id] ?? 0),
                },
              })),
              edges: data.edges.map((e, i) => ({
                id: `t-${i}`,
                source: e.from,
                target: e.to,
                style: { labelText: e.condition ?? "" },
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
            layout: { type: "antv-dagre", rankdir: "TB", nodesep: 32, ranksep: 48 },
            behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
          })
      : null,
    [data, roles.join("|"), runningByNode]
  );

  if (!data) return null;

  return (
    <div className={`relative h-full w-full ${className}`} data-testid="workflow-graph">
      <div ref={containerRef} className="h-full w-full" />
      <span className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-black/20 px-2 py-0.5 text-[9px] text-white/90">
        拖拽移动 · 滚轮缩放 · 试运行实例实时高亮
      </span>
    </div>
  );
}
