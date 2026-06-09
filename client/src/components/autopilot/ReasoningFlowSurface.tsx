/**
 * ReasoningFlowSurface — 独立的 2D 无限画布式 Reasoning Graph 工作区。
 *
 * 目标：达到截图中“成熟 2D reasoning map / canvas 产品感”。
 *
 * 设计原则（按用户 review 要求）：
 * - 主渲染用 HTML 卡片 + SVG 边（文字清晰、可 hover、可精确 label 定位）。
 * - 使用 dagre LR 布局（复用项目中已在 BlueprintWallTexture 证明可用的 dagre）。
 * - 轻量圆角卡片：浅底、细边、类型/状态色区分（青绿/紫/红等）。
 * - 细虚线贝塞尔 + 中文关系标签（产品推演语义：支撑 / 反证 / 拆解 / 收敛 等）。
 * - 支持平移、缩放、minimap、telemetry、console overlay、控制按钮。
 * - 节点 hover 高亮上下游路径（祖先+后代节点 + 路径边高亮，其余淡化），让 reasoning map 可探索。
 * - 优先作为纯 2D surface 实现（Autopilot 页面主视图或独立面板），后期再考虑投射到 3D 墙面 texture 或 R3F <Html>。
 *
 * 数据来源：消费已隔离干净的 Effect/Reasoning Flow 数据
 * （deriveBlueprintWallReasoningGraph 返回的 viewModel，或直接的 BrainstormReasoningGraph）。
 *
 * 与现有模块关系：
 * - 复用 / 参考 blueprint-wall-reasoning-graph.ts 的 derive 逻辑和 GraphData 映射。
 * - 参考 BlueprintWallGraphNodeCard 的浅色卡片视觉语言，但做更轻量的 2D canvas 版本。
 * - 复用项目里已有的 telemetry / consoleLines 结构。
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dagre from "dagre";

import type {
  BrainstormGraphConsoleLine,
  BrainstormGraphTelemetry,
  BrainstormReasoningGraph,
  BrainstormReasoningNode,
  BrainstormReasoningEdge,
} from "@shared/blueprint/brainstorm-reasoning-graph";

import {
  stripDebateProtocolNodes,
  type BlueprintWallReasoningGraphViewModel,
} from "@/components/three/scene-fusion/blueprint-wall-reasoning-graph";

// ------------------------------------------------------------------------
// Types & Constants
// ------------------------------------------------------------------------

export interface ReasoningFlowSurfaceProps {
  /**
   * 推荐：传入已通过 `deriveBlueprintWallReasoningGraph` 处理的 viewModel。
   * 它会自动经过 stripDebateProtocolNodes，保障 Effect/Reasoning Flow 隔离
   * （debate protocol nodes + 其 consoleLines 不会泄漏）。
   *
   * 组件内部仍会做 defense-in-depth（区分 visible 与 source）：
   * - 渲染用的节点/边基于 visibleNodes/visibleEdges 过滤（尊重调用方提供的干净可见集）。
   * - consoleLines 置空决策使用更宽的 source 检测（visible + viewModel.graph / safeSource.nodes），
   *   防止“visible 已干净但 graph + console 仍污染”的半污染 viewModel 场景。
   * 整体与 stripDebateProtocolNodes 语义对齐。
   */
  viewModel?: BlueprintWallReasoningGraphViewModel | null;
  /**
   * 直接传 raw `BrainstormReasoningGraph` 时，组件内部会主动调用
   * `stripDebateProtocolNodes` 做边界保护。仍建议优先使用 viewModel 路径。
   */
  graph?: BrainstormReasoningGraph | null;
  /** 初始缩放。 */
  initialScale?: number;
  /** 容器 className（方便在 Autopilot 页面或 dev harness 里控制尺寸）。 */
  className?: string;
  /** 是否显示完整 chrome（telemetry / console / minimap / controls）。默认 true。 */
  showChrome?: boolean;
}

interface PositionedNode extends BrainstormReasoningNode {
  x: number;
  y: number;
}

interface EdgeWithPath {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  path: string; // SVG path d
  midX: number;
  midY: number;
}

const NODE_WIDTH = 245;
const NODE_HEIGHT = 86; // 统一高度 + 更紧凑密度，配合内部紧凑排版实现成熟 reasoning map 质感
const PADDING = 60;
const RANK_SEP = 420;
const NODE_SEP = 36;

const TYPE_COLORS: Record<string, string> = {
  question: "#0d9488",     // teal
  clarification: "#6366f1",
  hypothesis: "#7c3aed",
  evidence: "#0d9488",
  constraint: "#f59e0b",
  risk: "#ef4444",
  gap: "#f43f5e",
  decision: "#0d9488",
  synthesis: "#10b981",
  critique: "#f43f5e",
  rebuttal: "#0ea5e9",
  default: "#64748b",
};

// 中文化短标签（用于卡片头部，产品推演平台语义）
// 节点类型围绕“意图 → 洞察 → 方案 → 推演 → 决策 → 执行”闭环设计
const NODE_TYPE_LABELS: Record<string, string> = {
  question: "意图",
  clarification: "澄清",
  hypothesis: "假设",
  evidence: "洞察",
  constraint: "约束",
  risk: "风险",
  gap: "缺口",
  decision: "决策",
  synthesis: "收敛",
  critique: "已隔离",
  rebuttal: "已隔离",
  default: "节点",
};

// Defense-in-depth: even if a caller passes a viewModel with debate nodes in visibleNodes
// (or raw graph somehow bypasses strip), the 2D surface must refuse to render critique/rebuttal
// as normal reasoning cards. These are debate protocol and belong only to realtime brainstorm path.
// Complements the stripDebateProtocolNodes choke point used on the raw graph path and in derive.
const DEBATE_PROTOCOL_TYPES = new Set<string>(["critique", "rebuttal"]);

// Edge/relation colors for Product Reasoning Map（产品推演平台）
// 边表达“推演关系”，而非法律证据链
const EDGE_COLORS: Record<string, string> = {
  cites: "#0d9488",        // 来源 / 引用 - teal
  supports: "#10b981",     // 支撑 / 验证 - green
  refines: "#7c3aed",      // 拆解 / 细化 - violet
  synthesizes: "#6366f1",  // 收敛 - indigo
  questions: "#f59e0b",    // 提出 / 澄清 - amber
  conflicts: "#ef4444",    // 反证 / 冲突 - red
  default: "#64748b",
};

function getEdgeColor(edge: { type?: string; label?: string }): string {
  if (edge.type && EDGE_COLORS[edge.type]) return EDGE_COLORS[edge.type];
  const label = (edge.label || "").toLowerCase();
  // 产品推演语义匹配（支撑、反证、拆解、收敛、来源、提出等）
  if (label.includes("支撑") || label.includes("验证") || label.includes("证据")) return EDGE_COLORS.supports;
  if (label.includes("反证") || label.includes("冲突") || label.includes("风险") || label.includes("阻塞")) return EDGE_COLORS.conflicts;
  if (label.includes("拆解") || label.includes("细化") || label.includes("派生")) return EDGE_COLORS.refines;
  if (label.includes("收敛") || label.includes("决策") || label.includes("综合")) return EDGE_COLORS.synthesizes;
  if (label.includes("来源") || label.includes("引用")) return EDGE_COLORS.cites;
  if (label.includes("提出") || label.includes("澄清")) return EDGE_COLORS.questions;
  return EDGE_COLORS.default;
}

function estimateLabelWidth(label: string): number {
  // Better estimate for mixed Chinese/English labels (Chinese chars are wider)
  const units = [...label].reduce((sum, ch) => sum + (/[\u4e00-\u9fff]/.test(ch) ? 11 : 6.5), 0);
  return Math.max(36, units + 16); // padding + min width
}

// ------------------------------------------------------------------------
// Pure Layout (复用/简化项目中 computeLayout + dagre 思路)
// ------------------------------------------------------------------------

function computeReasoningPositions(
  nodes: BrainstormReasoningNode[],
  edges: BrainstormReasoningEdge[]
): { positioned: PositionedNode[]; width: number; height: number } {
  if (nodes.length === 0) return { positioned: [], width: 800, height: 600 };

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: PADDING,
    marginy: PADDING,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const positioned: PositionedNode[] = nodes.map((node) => {
    const n = g.node(node.id);
    const x = n.x - NODE_WIDTH / 2;
    const y = n.y - NODE_HEIGHT / 2;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + NODE_WIDTH);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + NODE_HEIGHT);

    return { ...node, x, y };
  });

  const width = maxX - minX + PADDING * 2;
  const height = maxY - minY + PADDING * 2;

  return { positioned, width, height };
}

function buildEdgePaths(
  positioned: PositionedNode[],
  edges: BrainstormReasoningEdge[]
): EdgeWithPath[] {
  const posById = new Map(positioned.map((n) => [n.id, n]));

  // Group edges by source for fan-out dispersion (避免多边从一个节点堆在一起)
  const edgesBySource = new Map<string, BrainstormReasoningEdge[]>();
  edges.forEach((e) => {
    if (!edgesBySource.has(e.source)) edgesBySource.set(e.source, []);
    edgesBySource.get(e.source)!.push(e);
  });

  return edges
    .map((edge) => {
      const src = posById.get(edge.source);
      const tgt = posById.get(edge.target);
      if (!src || !tgt) return null;

      const x1 = src.x + NODE_WIDTH;
      const y1 = src.y + NODE_HEIGHT / 2;
      const x2 = tgt.x;
      const y2 = tgt.y + NODE_HEIGHT / 2;

      // Fan-out dispersion: use stable array index (reliable even without id or duplicate s/t)
      const siblings = edgesBySource.get(edge.source) || [];
      const idx = siblings.indexOf(edge);
      const fan = siblings.length > 1 ? (idx - (siblings.length - 1) / 2) * 18 : 0;

      const dx = Math.max(70, (x2 - x1) * 0.42);
      const cy1 = y1 + fan;
      const cy2 = y2 + fan * 0.6;
      const path = `M ${x1} ${y1} C ${x1 + dx} ${cy1}, ${x2 - dx} ${cy2}, ${x2} ${y2}`;

      // 更好的中点 + 垂直偏移（让标签贴在曲线“上方”，避免压线）
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2 + (fan > 0 ? -12 : 12);  // 轻微垂直偏移

      const label =
        edge.label ||
        (edge.type ? edge.type.replace(/_/g, " ") : undefined);

      return {
        id: edge.id || `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label,
        type: edge.type,
        path,
        midX,
        midY,
      };
    })
    .filter(Boolean) as EdgeWithPath[];
}

// ------------------------------------------------------------------------
// Main Component
// ------------------------------------------------------------------------

export function ReasoningFlowSurface({
  viewModel,
  graph,
  initialScale = 0.85,
  className = "",
  showChrome = true,
}: ReasoningFlowSurfaceProps) {
  // 统一数据源 + defense-in-depth（与 stripDebateProtocolNodes 语义对齐）。
  // - raw graph 路径：safeSource 已经过 stripDebateProtocolNodes（移除 debate 节点/边 + 清空 consoleLines）。
  // - viewModel 路径（推荐）：derive 理论上已 strip，但我们仍做本地防御。
  //
  // 关键区分（本轮补充）：
  // - visible*（baseNodes / baseEdges）：用于实际渲染的节点卡片和边。
  //   如果调用方传入了已干净的 visibleNodes/visibleEdges，我们尊重它来渲染（不强行把 graph 里的 debate 节点“加回来”）。
  // - sourceHasDebateProtocolNodes：用于判断“这个来源是否可信”，特别用于决定是否清空 consoleLines。
  //   它会同时检查 visibleNodes + safeSource.nodes（即 viewModel.graph.nodes，当 viewModel.graph 直接透传时）。
  //   这样能防住“visibleNodes 已干净，但 viewModel.graph 仍污染 + consoleLines 仍带 debate”的半污染 viewModel 场景。
  const safeSource = useMemo<BrainstormReasoningGraph | null>(() => {
    if (viewModel?.graph) return viewModel.graph;
    if (graph) return stripDebateProtocolNodes(graph);
    return null;
  }, [viewModel?.graph, graph]);

  // 稳定化的 base 数据（避免直接把 viewModel?.xxx 作为不稳定数组 dep 传给下游 useMemo）。
  const baseNodes: BrainstormReasoningNode[] = useMemo(
    () => viewModel?.visibleNodes ?? safeSource?.nodes ?? [],
    [viewModel?.visibleNodes, safeSource?.nodes]
  );

  const baseEdges: BrainstormReasoningEdge[] = useMemo(
    () => viewModel?.visibleEdges ?? safeSource?.edges ?? [],
    [viewModel?.visibleEdges, safeSource?.edges]
  );

  // 仅基于可见数据检测 debate（用于渲染过滤：节点卡片 + 边）。
  const visibleHasDebateProtocolNodes = useMemo(
    () => baseNodes.some((n) => DEBATE_PROTOCOL_TYPES.has(n.type)),
    [baseNodes]
  );

  // 更宽的来源检测（visible + 底层 graph），专用于 consoleLines 置空决策。
  // 解决：visibleNodes 干净但 viewModel.graph 仍含 critique/rebuttal + consoleLines 污染的角落。
  const sourceHasDebateProtocolNodes = useMemo(
    () =>
      visibleHasDebateProtocolNodes ||
      (safeSource?.nodes ?? []).some((n) => DEBATE_PROTOCOL_TYPES.has(n.type)),
    [visibleHasDebateProtocolNodes, safeSource?.nodes]
  );

  // 防御过滤节点（对 polluted viewModel.visibleNodes 的 defense-in-depth）。
  // 渲染始终基于 baseNodes（调用方提供的可见集），而不是把 graph 里的 debate 节点拉进来。
  const nodes: BrainstormReasoningNode[] = useMemo(
    () => baseNodes.filter((n) => !DEBATE_PROTOCOL_TYPES.has(n.type)),
    [baseNodes]
  );

  // 同步防御过滤 edges（镜像 stripDebateProtocolNodes 的 keptEdges 逻辑）。
  // 仅当可见数据里有 debate 时才过滤（buildEdgePaths 的 posById 也会兜底）。
  const edges: BrainstormReasoningEdge[] = useMemo(() => {
    if (!visibleHasDebateProtocolNodes) return baseEdges;

    const debateIds = new Set(
      baseNodes
        .filter((n) => DEBATE_PROTOCOL_TYPES.has(n.type))
        .map((n) => n.id)
    );
    return baseEdges.filter(
      (e) => !debateIds.has(e.source) && !debateIds.has(e.target)
    );
  }, [baseEdges, visibleHasDebateProtocolNodes, baseNodes]);

  // consoleLines 防御：使用更宽的 source 检测。
  // 一旦 visible 或底层 graph 里检测到 debate nodes，就置空，避免半污染 viewModel 的 console 泄漏。
  const consoleLines: BrainstormGraphConsoleLine[] = useMemo(
    () =>
      sourceHasDebateProtocolNodes
        ? []
        : viewModel?.consoleLines ?? safeSource?.consoleLines ?? [],
    [sourceHasDebateProtocolNodes, viewModel?.consoleLines, safeSource?.consoleLines]
  );

  const telemetry: BrainstormGraphTelemetry =
    viewModel?.telemetry ?? safeSource?.telemetry ?? {};

  // Console kind styling for Ask/Search/Thinking/Report 结构化轨迹
  const getConsoleKindClass = (kind: string) => {
    const k = (kind || "").toLowerCase();
    if (/ask|question|clarif/i.test(k)) return "text-emerald-600";
    if (/search|source|repo|github/i.test(k)) return "text-blue-600";
    if (/think|reason|plan|observation/i.test(k)) return "text-amber-600";
    if (/report|result|summary|done/i.test(k)) return "text-sky-600";
    return "text-slate-400";
  };

  // 布局（纯函数，变化时重算）
  const { positioned, graphWidth, graphHeight } = useMemo(() => {
    const { positioned: pos, width, height } = computeReasoningPositions(
      nodes,
      edges
    );
    return { positioned: pos, graphWidth: width, graphHeight: height };
  }, [nodes, edges]);

  const edgePaths = useMemo(
    () => buildEdgePaths(positioned, edges),
    [positioned, edges]
  );

  // ------------------------------------------------------------------------
  // Hover path highlight (使 2D reasoning map 从静态图变成可探索 workspace)
  // - hover 任意节点 → 高亮该节点 + 所有上游祖先 + 所有下游后代
  // - 对应路径上的边也高亮（更粗、更实、不透明）
  // - 其余节点/边降 opacity 淡化
  // - 直接在卡片上挂 onMouseEnter/Leave，兼容现有 pan/zoom（卡片 pointer 优先）
  // ------------------------------------------------------------------------
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // 构建邻接表（children = 下游，parents = 上游）。图很小（<=16 节点），每次 edges 变重算即可。
  const { children: childMap, parents: parentMap } = useMemo(() => {
    const ch = new Map<string, string[]>();
    const pa = new Map<string, string[]>();
    for (const e of edges) {
      if (!ch.has(e.source)) ch.set(e.source, []);
      ch.get(e.source)!.push(e.target);
      if (!pa.has(e.target)) pa.set(e.target, []);
      pa.get(e.target)!.push(e.source);
    }
    return { children: ch, parents: pa };
  }, [edges]);

  // 当前高亮的节点集合（自己 + 祖先 + 后代）
  const highlightedNodeIds = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>();
    const set = new Set<string>([hoveredNodeId]);

    // 上游（ancestors）
    const qUp: string[] = [...(parentMap.get(hoveredNodeId) ?? [])];
    while (qUp.length > 0) {
      const id = qUp.shift()!;
      if (set.has(id)) continue;
      set.add(id);
      qUp.push(...(parentMap.get(id) ?? []));
    }

    // 下游（descendants）
    const qDown: string[] = [...(childMap.get(hoveredNodeId) ?? [])];
    while (qDown.length > 0) {
      const id = qDown.shift()!;
      if (set.has(id)) continue;
      set.add(id);
      qDown.push(...(childMap.get(id) ?? []));
    }
    return set;
  }, [hoveredNodeId, parentMap, childMap]);

  // 高亮的边：仅当边的两端都在高亮节点集合内时才算路径边
  const highlightedEdgeIds = useMemo(() => {
    if (highlightedNodeIds.size === 0) return new Set<string>();
    const set = new Set<string>();
    for (const e of edges) {
      if (highlightedNodeIds.has(e.source) && highlightedNodeIds.has(e.target)) {
        set.add(e.id);
      }
    }
    return set;
  }, [edges, highlightedNodeIds]);

  // “是否处于 hover 模式”应基于 hover 状态本身，而不是是否有高亮边。
  // 这样即使 hover 孤立节点（或未来无边节点），非相关元素仍会正确进入淡化状态。
  const isAnyHovered = hoveredNodeId !== null;

  // 视口状态（2D infinite canvas 核心）
  const [scale, setScale] = useState(initialScale);
  const [tx, setTx] = useState(120); // 初始偏移，让图不要贴边
  const [ty, setTy] = useState(80);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  // 容器尺寸（用于 fit + 视口同步 minimap）
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateSize = () => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    updateSize();

    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 简单 pan / zoom（产品级可后续增强 pointer capture、惯性等）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.max(0.25, Math.min(3.5, scale * factor));

    // 以鼠标位置为中心缩放
    const worldX = (mouseX - tx) / scale;
    const worldY = (mouseY - ty) / scale;

    const newTx = mouseX - worldX * newScale;
    const newTy = mouseY - worldY * newScale;

    setScale(newScale);
    setTx(newTx);
    setTy(newTy);
  }, [scale, tx, ty]);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    setTx((prev) => prev + dx);
    setTy((prev) => prev + dy);
    lastPointer.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // 控制按钮
  const zoomIn = () => setScale((s) => Math.min(3.5, s * 1.2));
  const zoomOut = () => setScale((s) => Math.max(0.25, s / 1.2));

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el || graphWidth === 0) return;
    const padding = 40;
    const availW = el.clientWidth - padding * 2;
    const availH = el.clientHeight - padding * 2;
    const rawS = Math.min(availW / graphWidth, availH / graphHeight, 1.6);
    const nextScale = Math.max(0.4, Math.min(rawS, 1.6));
    setScale(nextScale);
    setTx((el.clientWidth - graphWidth * nextScale) / 2);
    setTy((el.clientHeight - graphHeight * nextScale) / 2);
  }, [graphWidth, graphHeight]);

  const reset = () => {
    setScale(initialScale);
    setTx(120);
    setTy(80);
  };

  // QA keyboard shortcut: F / f triggers fit (for consistent reference composition screenshots)
  // Guard against global pollution: ignore when focus is in editable fields (inputs, textareas, contentEditable)
  // so that when this surface is embedded in AutopilotRoutePage it won't steal 'f' from text fields.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const isEditable =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          !!target?.isContentEditable;

        if (isEditable) return;

        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fit]);

  // 基础 minimap（缩略 + 视口框，后续可点击跳转）
  // On narrow containers we shrink minimap and reposition bottom overlays to avoid
  // console/minimap collision and top-controls vs telemetry overlap (see review findings).
  const minimapScale = 0.12;
  const isNarrow = containerSize.w < 640;
  const minimapW = isNarrow ? 160 : 220;
  const minimapH = isNarrow ? 104 : 140;

  const contentTransform = `translate(${tx}px, ${ty}px) scale(${scale})`;

  // 计算当前视口在 world 坐标系下的矩形（用于 minimap viewport rect）
  const viewportRect = (() => {
    const { w, h } = containerSize;
    const worldLeft = -tx / scale;
    const worldTop = -ty / scale;
    const worldRight = (w - tx) / scale;
    const worldBottom = (h - ty) / scale;
    return { left: worldLeft, top: worldTop, right: worldRight, bottom: worldBottom };
  })();

  if (!safeSource || nodes.length === 0) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-slate-50 text-slate-400 ${className}`}>
        <div className="text-center">
          <div className="mb-2 text-2xl">No reasoning graph</div>
          <div className="text-sm">等待结构化 reasoning 数据或切换到支持的阶段</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full w-full select-none flex-col overflow-hidden bg-[#f8fafc] ${className}`}
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      {/* 主画布视口 */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        {/* 轻量网格背景（产品感） - 放在内容层之后以确保在节点/边下方 */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            zIndex: 0,
            backgroundImage:
              "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            opacity: 0.35,
          }}
        />

        {/* 内容层（可变换的无限画布） */}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ zIndex: 10, transform: contentTransform, width: graphWidth, height: graphHeight }}
        >
          {/* SVG 边层 */}
          <svg
            width={graphWidth}
            height={graphHeight}
            className="absolute left-0 top-0 pointer-events-none"
            style={{ overflow: "visible" }}
          >
            <defs>
              {/* Per-color markers for reliable arrowhead colors (no currentColor inheritance fragility from defs) */}
              {Array.from(new Set(Object.values(EDGE_COLORS))).map((col) => {
                const mid = `arrow-${col.replace('#', '')}`;
                return (
                  <marker
                    key={col}
                    id={mid}
                    markerWidth="10"
                    markerHeight="10"
                    refX="9"
                    refY="3"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path d="M0,0 L0,6 L9,3 z" fill={col} />
                  </marker>
                );
              })}
            </defs>

            {edgePaths.map((edge) => {
              const ec = getEdgeColor(edge);
              const arrowId = `arrow-${ec.replace('#', '')}`;
              const isEdgeHighlighted = highlightedEdgeIds.has(edge.id);
              return (
                <g key={edge.id}>
                  <path
                    d={edge.path}
                    fill="none"
                    stroke={ec}
                    strokeWidth={isEdgeHighlighted ? 2.1 : 1.25}
                    strokeDasharray={isEdgeHighlighted ? undefined : "5 3"}
                    markerEnd={`url(#${arrowId})`}
                    opacity={isEdgeHighlighted ? 0.95 : isAnyHovered ? 0.22 : 0.65}
                  />
                {edge.label && (
                  <g opacity={isEdgeHighlighted ? 0.95 : isAnyHovered ? 0.28 : 1}>
                    {/* subtle label background for readability on canvas */}
                    {(() => {
                      const w = estimateLabelWidth(edge.label);
                      return (
                        <rect
                          x={edge.midX - w / 2}
                          y={edge.midY - 14}
                          width={w}
                          height={15}
                          rx="3"
                          fill="#ffffff"
                          fillOpacity="0.9"
                          stroke="#e2e8f0"
                          strokeWidth="0.5"
                        />
                      );
                    })()}
                    <text
                      x={edge.midX}
                      y={edge.midY - 3}
                      fontSize={10}
                      fill="#334155"
                      textAnchor="middle"
                      fontWeight="500"
                      className="pointer-events-auto"
                      style={{ userSelect: "none" }}
                    >
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          </svg>

          {/* HTML 节点卡片层（轻量 2D 产品风格） */}
          {positioned.map((node) => {
            const color = TYPE_COLORS[node.type] ?? TYPE_COLORS.default;
            const typeLabel = NODE_TYPE_LABELS[node.type] ?? node.type;
            const roleLabel = node.roleLabel || node.roleId;
            const isActive = node.status === "active" || node.status === "open";

            const isHighlighted = highlightedNodeIds.has(node.id);
            const isDimmed = highlightedNodeIds.size > 0 && !isHighlighted;

            return (
              <div
                key={node.id}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                className={`absolute rounded-xl border bg-white/95 overflow-hidden transition-all ${
                  isDimmed
                    ? "opacity-25 saturate-[0.6]"
                    : isHighlighted
                    ? "opacity-100 shadow-md scale-[1.015] border-slate-300"
                    : "border-slate-200 shadow-[0_1px_2px_rgb(0,0,0,0.04)] hover:shadow-md hover:border-slate-300"
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                  padding: "7px 10px",
                  boxSizing: "border-box",
                }}
              >
                {/* 左侧类型色条 + 状态小点 */}
                <div
                  className={`absolute left-0 top-1.5 bottom-1.5 rounded-r transition-all ${
                    isHighlighted ? "w-[4.5px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" : "w-[3.5px]"
                  }`}
                  style={{ backgroundColor: color }}
                />
                <div
                  className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: isActive ? "#10b981" : "#94a3b8" }}
                />

                <div className="pl-[7px] pr-2 flex flex-col h-full">
                  {/* 头部：role（谁）更醒目 + 类型（对啥的意见类型）。让用户直接看到“谁在对什么发表什么意见”。 */}
                  <div className="flex min-w-0 items-center gap-1.5 text-[9.5px] font-medium text-slate-500 leading-none mb-0.5">
                    {roleLabel && (
                      <span className="text-slate-600 font-semibold tracking-normal shrink-0">
                        {roleLabel}
                      </span>
                    )}
                    <span style={{ color }} className="font-semibold tracking-normal shrink-0">
                      {typeLabel}
                    </span>
                  </div>

                  {/* 标题 + 正文区域（flex-1 保证底部元信息对齐） */}
                  <div className="flex-1 min-h-0 mb-0.5">
                    {/* 标题（信息层级最高） */}
                    <div className="line-clamp-2 text-[12px] font-semibold leading-[14.5px] text-slate-800">
                      {node.title || node.id}
                    </div>

                    {/* 正文（辅助，密度优先） */}
                    {node.body && (
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-[12.5px] text-slate-600">
                        {node.body}
                      </div>
                    )}
                  </div>

                  {/* 底部元信息：置信度右对齐（统一卡片底部信息层级） */}
                  {typeof node.confidence === "number" && (
                    <div className="text-right text-[8.5px] tabular-nums text-slate-400 leading-none">
                      {(node.confidence * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chrome overlays */}
      {showChrome && (
        <>
          {/* 左上 telemetry — 左侧纵向指标栏（产品推演过程感） */}
          {/* 窄栏固定左侧：BURN / SOURCES / REMAIN / TIME / ROLES，小标题 + 大数字 */}
          <div className="absolute left-4 top-4 flex flex-col gap-0.5 rounded-md bg-white/90 px-2.5 py-1.5 text-[10px] font-mono tabular-nums text-slate-600 shadow-sm border border-slate-200 backdrop-blur">
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-400 w-9">BURN</span>
              <span className="font-semibold text-slate-800">{telemetry.tokenBurn ?? "—"}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-400 w-9">SOURCES</span>
              <span className="font-semibold text-slate-800">{telemetry.sourceCount ?? "—"}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-400 w-9">REMAIN</span>
              <span className="font-semibold text-slate-800">{telemetry.remainingBudget ?? "—"}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-400 w-9">TIME</span>
              <span className="font-semibold text-slate-800">{telemetry.elapsedMs ? `${(telemetry.elapsedMs / 1000).toFixed(1)}s` : "—"}</span>
            </div>
            <div className="flex items-baseline gap-1.5 border-t border-slate-200/60 pt-0.5 mt-0.5">
              <span className="text-slate-400 w-9">ROLES</span>
              <span className="font-semibold text-slate-800">{telemetry.activeRoleCount ?? "—"}</span>
            </div>
          </div>

          {/* 左下 console 浮层 — Ask / Search / Thinking / Report 结构化轨迹 */}
          {/* 产品感：LLM 自主推演执行日志（最近 6 条，kind 着色分类） */}
          {/* 后续可扩展成底部 full-width trace 或与 page console 协调 */}
          {consoleLines.length > 0 && (
            <div className="absolute bottom-4 left-4 rounded-lg border border-slate-200 bg-white/90 backdrop-blur shadow-sm px-3 py-1.5 text-[10px] font-mono text-slate-600 max-w-[440px] max-h-[100px] overflow-auto max-[640px]:left-3 max-[640px]:right-3 max-[640px]:max-w-none max-[640px]:bottom-[156px]">
              {consoleLines.slice(-6).map((line, idx) => {
                const rawKind = (line.kind || "").trim();
                const basis = rawKind || line.text || "";
                const displayKind =
                  /ask|question|clarif/i.test(basis) ? "Ask" :
                  /search|source|repo|github/i.test(basis) ? "Search" :
                  /think|reason|plan|observation/i.test(basis) ? "Thinking" :
                  /report|result|summary|done/i.test(basis) ? "Report" :
                  rawKind || "Trace";
                return (
                  <div key={idx} className="truncate leading-tight">
                    {(() => {
                      const r = (line as any)?.roleId || (line as any)?.roleLabel;
                      const rShort = r ? String(r).split(/[-_]/).pop()?.slice(0, 9) : null;
                      const who = rShort ? `${rShort}·` : "";
                      return (
                        <span className={`mr-1 font-medium ${getConsoleKindClass(basis)}`}>[{who}{displayKind}]</span>
                      );
                    })()}
                    {line.text}
                  </div>
                );
              })}
            </div>
          )}

          {/* 右下 minimap（可点击跳转） */}
          {/* Narrow: smaller footprint + tighter bottom/right to coexist with raised console */}
          <div
            className="absolute bottom-4 right-4 rounded-lg border border-slate-200 bg-white/95 shadow-sm overflow-hidden cursor-crosshair bg-slate-50 max-[640px]:bottom-3 max-[640px]:right-3"
            style={{ width: minimapW, height: minimapH }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const clickX = (e.clientX - rect.left) / rect.width;
              const clickY = (e.clientY - rect.top) / rect.height;

              // map minimap click back to world center
              const targetWorldX = clickX * graphWidth;
              const targetWorldY = clickY * graphHeight;

              // center the viewport on the clicked world point
              const newTx = containerSize.w / 2 - targetWorldX * scale;
              const newTy = containerSize.h / 2 - targetWorldY * scale;

              setTx(newTx);
              setTy(newTy);
            }}
            title="Click to center view"
          >
            {/* Crisp node thumbnails (outside scale transform, using % of the final 220×140 box).
                This keeps them readable instead of sub-pixel after scale(0.12). */}
            {positioned.map((n, i) => (
              <div
                key={`mini-node-${i}`}
                className="absolute bg-slate-500/85 pointer-events-none"
                style={{
                  left: `${(n.x / graphWidth) * 100}%`,
                  top: `${(n.y / graphHeight) * 100}%`,
                  width: 4,
                  height: 3,
                  transform: "translate(-50%, -50%)",
                }}
              />
            ))}

            {/* Scaled layer — now primarily carries the accurate viewport rect (uses large inner coords + scale).
                The bg-slate-50 moved to the outer container so the % dots sit on the minimap paper. */}
            <div
              className="relative h-full w-full"
              style={{ transform: `scale(${minimapScale})`, transformOrigin: "top left" }}
            >
              {/* 视口范围提示 rect（clamp + 大视口时只描边不填充，避免洗掉缩略节点） */}
              {(() => {
                const s = minimapScale;
                const miW = minimapW / s;
                const miH = minimapH / s;
                let ml = (viewportRect.left / graphWidth) * miW;
                let mt = (viewportRect.top / graphHeight) * miH;
                let mw = ((viewportRect.right - viewportRect.left) / graphWidth) * miW;
                let mh = ((viewportRect.bottom - viewportRect.top) / graphHeight) * miH;

                // clamp to minimap inner bounds
                ml = Math.max(0, Math.min(ml, miW - 2));
                mt = Math.max(0, Math.min(mt, miH - 2));
                mw = Math.max(6, Math.min(mw, miW - ml));
                mh = Math.max(6, Math.min(mh, miH - mt));

                const coversMost = (mw / miW > 0.88) || (mh / miH > 0.88);
                return (
                  <div
                    className={`absolute ${coversMost ? 'border border-blue-400/60' : 'border border-blue-500/70 bg-blue-500/10'}`}
                    style={{
                      left: ml,
                      top: mt,
                      width: mw,
                      height: mh,
                      background: coversMost ? 'transparent' : undefined,
                    }}
                  />
                );
              })()}
            </div>

            <div className="absolute bottom-0.5 right-1 text-[9px] text-slate-400">minimap (click to center)</div>
          </div>

          {/* 右上控制区 */}
          {/* Narrow viewport: drop below the left telemetry card so they don't overlap horizontally */}
          <div className="absolute right-4 top-4 flex gap-1.5 max-[520px]:top-20">
            <button onClick={zoomOut} className="rounded-md border bg-white px-2 py-1 text-sm shadow-sm active:bg-slate-100">−</button>
            <button onClick={zoomIn} className="rounded-md border bg-white px-2 py-1 text-sm shadow-sm active:bg-slate-100">+</button>
            <button onClick={fit} className="rounded-md border bg-white px-2 py-1 text-xs shadow-sm active:bg-slate-100">fit</button>
            <button onClick={reset} className="rounded-md border bg-white px-2 py-1 text-xs shadow-sm active:bg-slate-100">reset</button>
            <button className="rounded-md border bg-white px-2 py-1 text-xs shadow-sm active:bg-slate-100">⛶</button>
          </div>
        </>
      )}

      {/* 调试提示：console 激活时隐藏，避免与左下浮层重叠；产品化时可并入 telemetry 或移除 */}
      {showChrome && consoleLines.length === 0 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-slate-400">
          drag to pan • wheel to zoom • {nodes.length} nodes • {edges.length} edges
        </div>
      )}
    </div>
  );
}

export default ReasoningFlowSurface;
