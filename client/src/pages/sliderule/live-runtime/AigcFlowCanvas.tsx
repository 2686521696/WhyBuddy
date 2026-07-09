/**
 * AigcFlowCanvas — AIGC 编排三期：自由画布（React Flow 图编辑器）。
 *
 * 对标用户 MIT 项目 web-aigc 编排设计器的三栏范式：
 *   左 = 节点面板（模型声明的 AIGC 能力 + 条件节点——节点锚在五系统模型上）
 *   中 = 图画布（拖拽布点、连线即校验：字段衔接断裂的线拒连并提示原因）
 *   右 = 属性面板（选中节点的字段绑定 / 条件配置；画布级手工输入 + 试跑）
 * 试跑走浏览器端 FlowExecutor（拓扑/重试/fail-fast），节点按执行状态实时
 * 着色；条件节点本地求值（零 LLM）驱动分支跳过。设计存本地层（会话级），
 * 与页面设计覆盖同哲学：不改推演产出的模型本体，可一键清空。
 */

import React from "react";
import {
  Background,
  Controls,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type AigcCapability,
  type FiveSystemModel,
  resolveFieldRef,
} from "../system-screens/five-system-model";
import {
  canConnect,
  clearFlowDesign,
  designManualInputRefs,
  designToFlowDefinition,
  evalCondition,
  loadFlowDesign,
  saveFlowDesign,
  type ConditionConfig,
  type DesignNode,
  type FlowDesign,
} from "./flow-design";
import { executeFlow, type FlowResult, type NodeRunStatus } from "./flow-executor";
import { makeAigcNodeRunner } from "./flow-definition";

type CanvasNodeData = {
  label: string;
  kind: "capability" | "condition";
  inputs: string[];
  output?: string;
  status?: NodeRunStatus;
  [key: string]: unknown;
};

const STATUS_BORDER: Record<NodeRunStatus, string> = {
  running: "#ec4899",
  success: "#10b981",
  failed: "#ef4444",
  skipped: "#d6d3d1",
};

function CanvasNode({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData;
  const border = d.status ? STATUS_BORDER[d.status] : selected ? "#f472b6" : "#E7E2D9";
  return (
    <div
      style={{
        border: `1.5px solid ${border}`,
        borderRadius: 8,
        background: d.kind === "condition" ? "#FFFBEB" : "#fff",
        padding: "6px 10px",
        minWidth: 130,
        fontSize: 11,
        boxShadow: d.status === "running" ? "0 0 0 3px rgba(236,72,153,0.15)" : undefined,
      }}
      data-testid={`flow-canvas-node`}
      data-status={d.status ?? "idle"}
    >
      <div style={{ fontWeight: 600, color: "#44403c", display: "flex", gap: 4, alignItems: "center" }}>
        {d.status === "success" && <span style={{ color: "#10b981" }}>✓</span>}
        {d.status === "failed" && <span style={{ color: "#ef4444" }}>✗</span>}
        {d.status === "skipped" && <span style={{ color: "#a8a29e" }}>⊘</span>}
        {d.label}
      </div>
      {d.inputs.length > 0 && (
        <div style={{ color: "#a8a29e", fontSize: 9, marginTop: 2 }}>← {d.inputs.join("、")}</div>
      )}
      {d.output && <div style={{ color: "#78716c", fontSize: 9 }}>→ {d.output}</div>}
    </div>
  );
}

const nodeTypes = { canvasNode: CanvasNode };

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${uid++}`;

export function AigcFlowCanvas({
  model,
  sessionId,
  goal,
}: {
  model: FiveSystemModel;
  sessionId: string;
  goal?: string;
}) {
  const capabilities = model.aigc?.capabilities ?? [];
  const capById = React.useMemo(() => {
    const m = new Map<string, AigcCapability>();
    for (const c of capabilities) if (c.id) m.set(c.id, c);
    return m;
  }, [capabilities]);

  const [design, setDesign] = React.useState<FlowDesign>(
    () =>
      loadFlowDesign(sessionId) ?? {
        id: "canvas-1",
        name: "自由编排",
        nodes: [],
        edges: [],
      }
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [statuses, setStatuses] = React.useState<Record<string, NodeRunStatus>>({});
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<FlowResult | null>(null);
  const [connectHint, setConnectHint] = React.useState<string | null>(null);

  const persist = (next: FlowDesign) => {
    setDesign(next);
    saveFlowDesign(sessionId, next);
  };

  // Design → React Flow 视图态
  const rfNodes: Node[] = design.nodes.map((n) => {
    const cap = n.capabilityId ? capById.get(n.capabilityId) : undefined;
    return {
      id: n.id,
      type: "canvasNode",
      position: n.position,
      data: {
        label: n.kind === "condition" ? "条件判断" : cap?.name || n.capabilityId || "?",
        kind: n.kind,
        inputs:
          n.kind === "condition"
            ? [n.condition?.inputRef ?? "（上游产出）"]
            : (cap?.inputFields ?? []).map((r) => resolveFieldRef(r, model).label || r),
        output: n.kind === "condition" ? "是 / 否" : cap?.outputField,
        status: statuses[n.id],
      } satisfies CanvasNodeData,
    };
  });
  const rfEdges: Edge[] = design.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.sourcePort === "true" ? "是" : e.sourcePort === "false" ? "否" : e.sourcePort,
    labelStyle: { fontSize: 9, fill: "#78716c" },
    style: { stroke: "#d6d3d1" },
    animated: statuses[e.source] === "running",
  }));

  const onNodesChange = (changes: NodeChange[]) => {
    // 位置拖动/删除经 React Flow 变更流回写设计层
    const moved = applyNodeChanges(changes, rfNodes);
    const removedIds = new Set(
      changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id)
    );
    persist({
      ...design,
      nodes: design.nodes
        .filter((n) => !removedIds.has(n.id))
        .map((n) => {
          const rf = moved.find((m) => m.id === n.id);
          return rf ? { ...n, position: rf.position } : n;
        }),
      edges: design.edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)),
    });
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const removedIds = new Set(
      changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id)
    );
    if (removedIds.size === 0) {
      applyEdgeChanges(changes, rfEdges); // 选中态等由 RF 内部处理
      return;
    }
    persist({ ...design, edges: design.edges.filter((e) => !removedIds.has(e.id)) });
  };

  const onConnect = (conn: Connection) => {
    const source = design.nodes.find((n) => n.id === conn.source);
    const target = design.nodes.find((n) => n.id === conn.target);
    if (!source || !target) return;
    const verdict = canConnect(source, target, capById);
    if (!verdict.ok) {
      setConnectHint(verdict.reason ?? "连线不合法");
      setTimeout(() => setConnectHint(null), 3200);
      return;
    }
    // 条件节点出边：交替分配 是/否 分支（已有 true 则新边为 false）
    let port = verdict.port;
    if (source.kind === "condition") {
      const used = design.edges.filter((e) => e.source === source.id).map((e) => e.sourcePort);
      port = used.includes("true") ? "false" : "true";
    }
    persist({
      ...design,
      edges: [
        ...design.edges,
        { id: nextId("edge"), source: source.id, target: target.id, sourcePort: port, targetPort: port },
      ],
    });
  };

  const addNode = (kind: "capability" | "condition", capabilityId?: string) => {
    const offset = design.nodes.length;
    persist({
      ...design,
      nodes: [
        ...design.nodes,
        {
          id: nextId(kind === "condition" ? "cond" : capabilityId || "cap"),
          kind,
          capabilityId,
          condition: kind === "condition" ? { operator: "nonempty" } : undefined,
          position: { x: 80 + (offset % 4) * 190, y: 60 + Math.floor(offset / 4) * 130 },
        },
      ],
    });
  };

  const manualRefs = designManualInputRefs(design, capById);
  const selected = design.nodes.find((n) => n.id === selectedId) ?? null;

  const run = async () => {
    if (running || design.nodes.length === 0) return;
    setRunning(true);
    setResult(null);
    setStatuses({});
    try {
      const flowDef = designToFlowDefinition(design, { ...inputs });
      const capRunner = makeAigcNodeRunner(
        new Map(
          design.nodes
            .filter((n) => n.kind === "capability" && n.capabilityId)
            .map((n) => [n.id, capById.get(n.capabilityId!)!] as const)
        ),
        goal
      );
      const res = await executeFlow(
        flowDef,
        async (node, nodeInputs) => {
          if (node.node_type === "condition") {
            // 条件本地求值（零 LLM）——分支端口驱动执行器的 skip 语义
            return { branch: evalCondition(node.config as ConditionConfig, nodeInputs) };
          }
          return capRunner(node, nodeInputs);
        },
        { onNodeStatus: (id, s) => setStatuses((prev) => ({ ...prev, [id]: s })) }
      );
      setResult(res);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0" data-testid="aigc-flow-canvas">
      {/* 左：节点面板（能力锚定模型；条件节点本地求值） */}
      <div className="flex w-44 shrink-0 flex-col gap-1.5 overflow-auto border-r border-[#EFEBE2] bg-[#FBF9F4] p-2">
        <div className="text-[10px] font-semibold text-stone-500">能力节点</div>
        {capabilities.map((cap) => (
          <button
            key={cap.id}
            type="button"
            data-testid={`flow-palette-${cap.id}`}
            onClick={() => addNode("capability", cap.id)}
            className="rounded border border-[#E7E2D9] bg-white px-2 py-1.5 text-left text-[11px] text-stone-600 transition-colors hover:border-pink-300"
            title={`输入：${(cap.inputFields ?? []).join("、")}\n输出：${cap.outputField ?? ""}`}
          >
            + {cap.name || cap.id}
          </button>
        ))}
        <div className="mt-2 text-[10px] font-semibold text-stone-500">逻辑节点</div>
        <button
          type="button"
          data-testid="flow-palette-condition"
          onClick={() => addNode("condition")}
          className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-left text-[11px] text-amber-700 transition-colors hover:border-amber-400"
        >
          + 条件判断（是/否分支）
        </button>
        <div className="mt-auto pt-2 text-[9px] leading-4 text-stone-400">
          连线即校验：字段衔接断裂的线会被拒绝——与发布门禁同一规则
        </div>
      </div>

      {/* 中：画布 */}
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color="#EFEBE2" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {connectHint && (
          <div
            className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded bg-red-50 px-3 py-1.5 text-[11px] text-red-600 ring-1 ring-red-200"
            data-testid="flow-connect-rejected"
          >
            {connectHint}
          </div>
        )}
        {design.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-stone-300">
            从左侧点选能力节点开始编排——连线时自动校验字段衔接
          </div>
        )}
      </div>

      {/* 右：属性 + 试跑 */}
      <div className="flex w-60 shrink-0 flex-col gap-2 overflow-auto border-l border-[#EFEBE2] bg-white p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-stone-600">编排属性</span>
          <button
            type="button"
            data-testid="flow-canvas-clear"
            onClick={() => {
              clearFlowDesign(sessionId);
              setDesign({ id: "canvas-1", name: "自由编排", nodes: [], edges: [] });
              setStatuses({});
              setResult(null);
            }}
            className="text-[10px] text-stone-400 hover:text-stone-600"
          >
            清空画布
          </button>
        </div>

        {selected ? (
          selected.kind === "condition" ? (
            <div className="space-y-1.5 rounded border border-amber-200 bg-amber-50/50 p-2">
              <div className="text-[10px] font-semibold text-amber-700">条件判断配置</div>
              <select
                value={selected.condition?.operator ?? "nonempty"}
                data-testid="flow-condition-operator"
                onChange={(e) =>
                  persist({
                    ...design,
                    nodes: design.nodes.map((n) =>
                      n.id === selected.id
                        ? { ...n, condition: { ...n.condition, operator: e.target.value as ConditionConfig["operator"] } }
                        : n
                    ),
                  })
                }
                className="w-full rounded border border-[#E7E2D9] px-1.5 py-1 text-[11px]"
              >
                <option value="nonempty">上游产出非空 → 是</option>
                <option value="contains">上游产出包含关键词 → 是</option>
                <option value="equals">上游产出等于 → 是</option>
              </select>
              {(selected.condition?.operator === "contains" || selected.condition?.operator === "equals") && (
                <input
                  value={selected.condition?.value ?? ""}
                  placeholder="关键词 / 目标值"
                  onChange={(e) =>
                    persist({
                      ...design,
                      nodes: design.nodes.map((n) =>
                        n.id === selected.id
                          ? { ...n, condition: { ...n.condition, value: e.target.value } }
                          : n
                      ),
                    })
                  }
                  className="w-full rounded border border-[#E7E2D9] px-1.5 py-1 text-[11px]"
                />
              )}
              <div className="text-[9px] text-stone-400">本地求值（零 LLM）；出边自动分配 是/否 分支</div>
            </div>
          ) : (
            <div className="rounded border border-[#E7E2D9] p-2 text-[10px] text-stone-500">
              <div className="font-semibold text-stone-700">
                {capById.get(selected.capabilityId ?? "")?.name ?? selected.capabilityId}
              </div>
              <div className="mt-1">
                输入：{(capById.get(selected.capabilityId ?? "")?.inputFields ?? []).join("、") || "—"}
              </div>
              <div>输出：{capById.get(selected.capabilityId ?? "")?.outputField ?? "—"}</div>
              <div className="mt-1 text-stone-400">字段绑定来自五系统模型（只读；改能力去 AIGC 清单）</div>
            </div>
          )
        ) : (
          <div className="text-[10px] text-stone-400">点选画布节点查看属性</div>
        )}

        <div className="mt-1 border-t border-[#EFEBE2] pt-2">
          <div className="text-[11px] font-semibold text-stone-600">画布试跑</div>
          {manualRefs.map((ref) => (
            <div key={ref} className="mt-1.5">
              <div className="truncate text-[9px] text-stone-400" title={ref}>
                {resolveFieldRef(ref, model).label || ref}
              </div>
              <input
                value={inputs[ref] ?? ""}
                placeholder="输入值"
                onChange={(e) => setInputs((prev) => ({ ...prev, [ref]: e.target.value }))}
                className="mt-0.5 w-full rounded border border-[#E7E2D9] px-1.5 py-1 text-[11px] outline-none focus:border-pink-300"
              />
            </div>
          ))}
          <button
            type="button"
            data-testid="flow-canvas-run"
            disabled={running || design.nodes.length === 0}
            onClick={run}
            className="mt-2 w-full rounded-full bg-pink-500 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "画布运行中…（逐节点真跑）" : `试跑画布（${design.nodes.length} 节点）`}
          </button>
          {result && (
            <div className="mt-2 space-y-1" data-testid="flow-canvas-result">
              {result.error && (
                <div className="rounded bg-red-50 px-1.5 py-1 text-[9px] text-red-600 ring-1 ring-red-200">
                  {result.error}
                </div>
              )}
              {result.logs.map((log) => (
                <div key={log.node_id} className="rounded border border-[#EFEBE2] p-1.5 text-[9px]">
                  <span
                    className={
                      log.status === "success"
                        ? "text-emerald-600"
                        : log.status === "skipped"
                        ? "text-stone-400"
                        : "text-red-600"
                    }
                  >
                    {log.status === "success" ? "✓" : log.status === "skipped" ? "⊘" : "✗"}
                  </span>{" "}
                  <span className="text-stone-600">{log.node_id}</span>
                  {log.status === "success" && log.outputs && (
                    <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-stone-500">
                      {String(Object.values(log.outputs)[0] ?? "")}
                    </div>
                  )}
                  {log.error && <div className="mt-0.5 text-red-500">{log.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
