/**
 * BlueprintWallTexture — dagre 布局 + Canvas2D 绘制流程图纹理。
 *
 * 原理：
 * 1. dagre 纯 JS 计算节点坐标（不需要 DOM）
 * 2. 原生 Canvas2D 直接绘制节点卡片和贝塞尔连线
 * 3. Three.js CanvasTexture 贴到墙面 mesh 上
 *
 * 优势：不需要隐藏 DOM 容器，不依赖 G6 的可见性要求，纯内存操作。
 */

import { useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import dagre from "dagre";

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationJob,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type {
  BrainstormGraphConsoleLine,
  BrainstormGraphTelemetry,
  BrainstormReasoningEdge,
  BrainstormReasoningGraph,
  BrainstormReasoningNode,
} from "@shared/blueprint";
import type { BlueprintEffectPreviewSnapshot } from "@/lib/blueprint-api";
import type { AppLocale } from "@/lib/locale";

import {
  BLUEPRINT_WALL_GRAPH_POSITION,
  BLUEPRINT_WALL_GRAPH_WIDTH,
  BLUEPRINT_WALL_GRAPH_HEIGHT,
  BLUEPRINT_WALL_GRAPH_BACKING_WIDTH,
  BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT,
} from "./blueprint-wall-placement";
import type {
  BlueprintWallArtifactInput,
  CapabilityOwner,
  CapabilityStatus,
  RolePhase,
} from "./blueprint-wall-process-data";
import {
  deriveBlueprintWallReasoningGraph,
  type BlueprintWallReasoningGraphViewModel,
} from "./blueprint-wall-reasoning-graph";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BlueprintWallTextureProps {
  job: BlueprintGenerationJob | null | undefined;
  routeSet?: BlueprintRouteSet | null;
  specTree?: BlueprintSpecTree | null;
  effectPreviews?: BlueprintEffectPreviewSnapshot[];
  structuredReasoningGraphs?: BrainstormReasoningGraph[];
  agentReasoningEntries?: AgentReasoningEntry[];
  capabilityStatuses?: Record<string, CapabilityStatus>;
  capabilityOwners?: Record<string, CapabilityOwner>;
  rolePhases?: Record<string, RolePhase>;
  roleLabels?: Record<string, string>;
  artifacts?: BlueprintWallArtifactInput[];
  locale?: AppLocale;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const W = BLUEPRINT_WALL_GRAPH_WIDTH;
const H = BLUEPRINT_WALL_GRAPH_HEIGHT;
const NODE_W = 600;
const NODE_H = 100;
const PADDING = 120;
const MAX_TEXTURE_ROLE_BRANCHES = 8;

// 节点类型颜色
const TYPE_COLORS: Record<string, string> = {
  question: "#0f766e",
  clarification: "#2563eb",
  hypothesis: "#7c3aed",
  evidence: "#059669",
  constraint: "#d97706",
  risk: "#dc2626",
  gap: "#be123c",
  decision: "#0891b2",
  synthesis: "#16a34a",
  route_root: "#0d9488",
  route_step: "#6366f1",
  route_spec: "#0284c7",
  spec_node: "#2563eb",
  brainstorm: "#0d9488",
  capability: "#f59e0b",
  preview: "#ec4899",
  final: "#10b981",
  default: "#64748b",
};

// ---------------------------------------------------------------------------
// dagre 布局计算
// ---------------------------------------------------------------------------

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  title: string;
  type: string;
  status: string;
  body: string;
  roleLabel?: string;
  height: number;
}

interface LayoutEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  points: Array<{ x: number; y: number }>;
  label?: string;
  type?: string;
  sourceKind?: string;
}

interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  consoleLines?: BrainstormGraphConsoleLine[];
  telemetry?: BrainstormGraphTelemetry;
  hiddenNodeCount?: number;
  mode?: BlueprintWallReasoningGraphViewModel["mode"];
}

type GraphData = {
  nodes: Array<{ id: string; data?: Record<string, unknown> }>;
  edges: Array<{
    source: string;
    target: string;
    label?: string;
    type?: string;
    sourceKind?: string;
  }>;
  consoleLines?: BrainstormGraphConsoleLine[];
  telemetry?: BrainstormGraphTelemetry;
  hiddenNodeCount?: number;
  mode?: BlueprintWallReasoningGraphViewModel["mode"];
};

/** Line height for node title text */
const LINE_H = 36;
/** Vertical padding inside node card */
const NODE_PAD_Y = 20;
/** Font used for node title measurement */
const NODE_FONT = "bold 32px system-ui, sans-serif";
/** Max text lines before ellipsis */
const MAX_TEXT_LINES = 3;
/** Min node height */
const MIN_NODE_H = 56;

/**
 * Measure a node's required height based on its text content.
 * Uses an offscreen canvas for measureText.
 * Includes space for: title lines + type label line + padding.
 */
function measureNodeHeight(text: string, measureCtx: CanvasRenderingContext2D): number {
  measureCtx.font = NODE_FONT;
  const lines = wrapTextSimple(text, NODE_W - 60, measureCtx);
  const lineCount = Math.min(lines.length, MAX_TEXT_LINES);
  // title lines + type label row (28px) + status dot row included in top padding
  return Math.max(MIN_NODE_H, lineCount * LINE_H + NODE_PAD_Y * 2 + 32);
}

/**
 * Simple word-wrap without needing the full canvas wrapText (used pre-layout).
 */
function wrapTextSimple(text: string, maxWidth: number, ctx: CanvasRenderingContext2D): string[] {
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let end = remaining.length;
    while (ctx.measureText(remaining.slice(0, end)).width > maxWidth && end > 1) {
      end--;
    }
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return lines.length > 0 ? lines : [""];
}

function computeBrainstormLayout(
  graphData: GraphData,
  nodeHeights: Map<string, number>
): LayoutResult {
  const nodesById = new Map(graphData.nodes.map(node => [node.id, node]));
  const brainstormNodes = graphData.nodes.filter(
    node => node.data?.type === "brainstorm"
  );
  const synthesisNodes = graphData.nodes.filter(
    node => node.data?.type === "final" && node.id.includes("-synthesis")
  );
  const stageNodes = graphData.nodes.filter(
    node => node.id.startsWith("stage-") && node.data?.type === "capability"
  );
  const roleIndex = new Map(brainstormNodes.map((node, index) => [node.id, index]));
  const synthesisIndex = new Map(synthesisNodes.map((node, index) => [node.id, index]));
  const stageIndex = new Map(stageNodes.map((node, index) => [node.id, index]));
  const roleCount = Math.max(brainstormNodes.length, 1);
  const roleColumns = Math.min(4, Math.max(2, Math.ceil(roleCount / 2)));
  const roleRows = Math.ceil(roleCount / roleColumns);
  const roleStartX = W * 0.38;
  const roleEndX = W * 0.68;
  const roleStartY = H * 0.24;
  const roleEndY = H * 0.76;

  const toLayoutNode = (
    node: GraphData["nodes"][number],
    x: number,
    y: number
  ): LayoutNode => ({
    id: node.id,
    x,
    y,
    title: (node.data?.title as string) ?? node.id,
    type: (node.data?.type as string) ?? "default",
    status: (node.data?.status as string) ?? "pending",
    body: (node.data?.body as string) ?? "",
    roleLabel: (node.data?.roleLabel as string) ?? undefined,
    height: nodeHeights.get(node.id) ?? MIN_NODE_H,
  });

  const nodes: LayoutNode[] = graphData.nodes.map(node => {
    if (node.id === "root") {
      return toLayoutNode(node, W * 0.12, H * 0.5);
    }

    const rolePos = roleIndex.get(node.id);
    if (rolePos !== undefined) {
      const col = rolePos % roleColumns;
      const row = Math.floor(rolePos / roleColumns);
      const colT = roleColumns === 1 ? 0.5 : col / (roleColumns - 1);
      const rowT = roleRows === 1 ? 0.5 : row / (roleRows - 1);
      const stagger = row % 2 === 0 ? 0 : (roleEndX - roleStartX) / (roleColumns * 2);
      return toLayoutNode(
        node,
        roleStartX + (roleEndX - roleStartX) * colT + stagger,
        roleStartY + (roleEndY - roleStartY) * rowT
      );
    }

    const synthesisPos = synthesisIndex.get(node.id);
    if (synthesisPos !== undefined) {
      const total = Math.max(synthesisNodes.length, 1);
      const y = H * (0.42 + (synthesisPos - (total - 1) / 2) * 0.18);
      return toLayoutNode(node, W * 0.86, y);
    }

    const stagePos = stageIndex.get(node.id);
    if (stagePos !== undefined) {
      const total = Math.max(stageNodes.length, 1);
      const y = H * (0.36 + (stagePos - (total - 1) / 2) * 0.22);
      return toLayoutNode(node, W * 0.25, y);
    }

    return toLayoutNode(node, W * 0.25, H * 0.82);
  });

  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const edges: LayoutEdge[] = graphData.edges
    .filter(edge => nodesById.has(edge.source) && nodesById.has(edge.target))
    .map(edge => {
      const from = nodeMap.get(edge.source);
      const to = nodeMap.get(edge.target);
      return {
        from: { x: from?.x ?? 0, y: from?.y ?? 0 },
        to: { x: to?.x ?? 0, y: to?.y ?? 0 },
        points: [],
        label: edge.label,
        type: edge.type,
        sourceKind: edge.sourceKind,
      };
    });

  return {
    nodes,
    edges,
    consoleLines: graphData.consoleLines,
    telemetry: graphData.telemetry,
    hiddenNodeCount: graphData.hiddenNodeCount,
    mode: graphData.mode,
  };
}

function computeReasoningLayout(
  graphData: GraphData,
  nodeHeights: Map<string, number>
): LayoutResult {
  const nodesById = new Map(graphData.nodes.map(node => [node.id, node]));
  const groups: Record<string, GraphData["nodes"]> = {
    question: [],
    setup: [],
    middle: [],
    resolution: [],
  };

  for (const node of graphData.nodes) {
    const type = String(node.data?.type ?? "");
    if (type === "question") {
      groups.question.push(node);
    } else if (type === "clarification" || type === "constraint") {
      groups.setup.push(node);
    } else if (type === "decision" || type === "synthesis") {
      groups.resolution.push(node);
    } else {
      groups.middle.push(node);
    }
  }

  const toLayoutNode = (
    node: GraphData["nodes"][number],
    x: number,
    y: number
  ): LayoutNode => ({
    id: node.id,
    x,
    y,
    title: (node.data?.title as string) ?? node.id,
    type: (node.data?.type as string) ?? "default",
    status: (node.data?.status as string) ?? "pending",
    body: (node.data?.body as string) ?? "",
    roleLabel: (node.data?.roleLabel as string) ?? undefined,
    height: nodeHeights.get(node.id) ?? MIN_NODE_H,
  });

  const placeColumn = (
    columnNodes: GraphData["nodes"],
    x: number,
    top: number,
    bottom: number
  ): LayoutNode[] => {
    const count = Math.max(columnNodes.length, 1);
    return columnNodes.map((node, index) => {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const stagger = index % 2 === 0 ? 0 : 46;
      return toLayoutNode(node, x + stagger, top + (bottom - top) * t);
    });
  };

  const nodes = [
    ...placeColumn(groups.question, W * 0.13, H * 0.36, H * 0.64),
    ...placeColumn(groups.setup, W * 0.31, H * 0.2, H * 0.78),
    ...placeColumn(groups.middle, W * 0.55, H * 0.16, H * 0.84),
    ...placeColumn(groups.resolution, W * 0.84, H * 0.28, H * 0.72),
  ];
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const edges: LayoutEdge[] = graphData.edges
    .filter(edge => nodesById.has(edge.source) && nodesById.has(edge.target))
    .map(edge => {
      const from = nodeMap.get(edge.source);
      const to = nodeMap.get(edge.target);
      return {
        from: { x: from?.x ?? 0, y: from?.y ?? 0 },
        to: { x: to?.x ?? 0, y: to?.y ?? 0 },
        points: [],
        label: edge.label,
        type: edge.type,
        sourceKind: edge.sourceKind,
      };
    });

  return {
    nodes,
    edges,
    consoleLines: graphData.consoleLines,
    telemetry: graphData.telemetry,
    hiddenNodeCount: graphData.hiddenNodeCount,
    mode: graphData.mode,
  };
}

function computeRouteSetLayout(
  graphData: GraphData,
  nodeHeights: Map<string, number>
): LayoutResult {
  const nodesById = new Map(graphData.nodes.map(node => [node.id, node]));
  const routeRoots = graphData.nodes.filter(node => node.data?.type === "route_root");
  const routeNodes = graphData.nodes.filter(
    node => node.id.startsWith("route-") && node.data?.type !== "route_root"
  );
  const selectedRoutes = routeNodes.filter(node => node.data?.status === "completed");
  const candidateRoutes = routeNodes.filter(node => node.data?.status !== "completed");
  const routeDetails = graphData.nodes.filter(
    node =>
      !node.id.startsWith("route-") &&
      (node.data?.type === "route_step" || node.data?.type === "capability")
  );
  const specRoots = graphData.nodes.filter(node => node.data?.type === "route_spec");
  const specNodes = graphData.nodes.filter(node => node.data?.type === "spec_node");

  const toLayoutNode = (
    node: GraphData["nodes"][number],
    x: number,
    y: number
  ): LayoutNode => ({
    id: node.id,
    x,
    y,
    title: (node.data?.title as string) ?? node.id,
    type: (node.data?.type as string) ?? "default",
    status: (node.data?.status as string) ?? "pending",
    body: (node.data?.body as string) ?? "",
    roleLabel: (node.data?.roleLabel as string) ?? undefined,
    height: nodeHeights.get(node.id) ?? MIN_NODE_H,
  });

  const spread = (
    columnNodes: GraphData["nodes"],
    x: number,
    top: number,
    bottom: number
  ): LayoutNode[] => {
    const count = Math.max(columnNodes.length, 1);
    return columnNodes.map((node, index) => {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const stagger = index % 2 === 0 ? 0 : 42;
      return toLayoutNode(node, x + stagger, top + (bottom - top) * t);
    });
  };

  const placed = new Set<string>();
  const add = (items: LayoutNode[]) => {
    for (const item of items) placed.add(item.id);
    return items;
  };

  const nodes = [
    ...add(spread(routeRoots, W * 0.1, H * 0.42, H * 0.58)),
    ...add(spread(selectedRoutes, W * 0.34, H * 0.36, H * 0.64)),
    ...add(spread(candidateRoutes, W * 0.34, H * 0.18, H * 0.82)),
    ...add(spread(routeDetails, W * 0.55, H * 0.22, H * 0.78)),
    ...add(spread(specRoots, W * 0.72, H * 0.34, H * 0.66)),
    ...add(spread(specNodes, W * 0.9, H * 0.14, H * 0.86)),
    ...spread(
      graphData.nodes.filter(node => !placed.has(node.id)),
      W * 0.52,
      H * 0.28,
      H * 0.72
    ),
  ];

  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const edges: LayoutEdge[] = graphData.edges
    .filter(edge => nodesById.has(edge.source) && nodesById.has(edge.target))
    .map(edge => {
      const from = nodeMap.get(edge.source);
      const to = nodeMap.get(edge.target);
      return {
        from: { x: from?.x ?? 0, y: from?.y ?? 0 },
        to: { x: to?.x ?? 0, y: to?.y ?? 0 },
        points: [],
        label: edge.label,
        type: edge.type,
        sourceKind: edge.sourceKind,
      };
    });

  return {
    nodes,
    edges,
    consoleLines: graphData.consoleLines,
    telemetry: graphData.telemetry,
    hiddenNodeCount: graphData.hiddenNodeCount,
    mode: graphData.mode,
  };
}

function computeLayout(graphData: GraphData): LayoutResult {
  // Create a measurement canvas for text width calculation
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d")!;

  // Pre-compute each node's height
  const nodeHeights = new Map<string, number>();
  for (const node of graphData.nodes) {
    const title = (node.data?.title as string) ?? node.id;
    const body = (node.data?.body as string) ?? "";
    const fullText = body ? `${title} — ${body}` : title;
    const h = measureNodeHeight(fullText, measureCtx);
    nodeHeights.set(node.id, h);
  }

  if (graphData.nodes.some(node => node.data?.type === "route_root")) {
    return computeRouteSetLayout(graphData, nodeHeights);
  }

  if (graphData.nodes.some(node => node.data?.type === "brainstorm")) {
    return computeBrainstormLayout(graphData, nodeHeights);
  }

  if (graphData.nodes.some(node => node.data?.type === "question")) {
    return computeReasoningLayout(graphData, nodeHeights);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 150,
    ranksep: 900,
    marginx: PADDING,
    marginy: PADDING,
    align: "UL",
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graphData.nodes) {
    g.setNode(node.id, { width: NODE_W, height: nodeHeights.get(node.id) ?? MIN_NODE_H });
  }
  for (const edge of graphData.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const graphInfo = g.graph();
  const graphWidth = (graphInfo.width ?? W - PADDING * 2) + PADDING * 2;
  const graphHeight = (graphInfo.height ?? H - PADDING * 2) + PADDING * 2;
  const scaleX = (W - PADDING * 2) / (graphWidth - PADDING * 2);
  const scaleY = (H - PADDING * 2) / (graphHeight - PADDING * 2);
  const scale = Math.min(scaleX, scaleY, 1.5);
  const offsetX = (W - (graphWidth - PADDING * 2) * scale) / 2;
  const offsetY = (H - (graphHeight - PADDING * 2) * scale) / 2;

  const nodes: LayoutNode[] = graphData.nodes.map(n => {
    const pos = g.node(n.id);
    const rawX = (pos?.x ?? 0) - PADDING;
    const rawY = (pos?.y ?? 0) - PADDING;
    return {
      id: n.id,
      x: rawX * scale + offsetX,
      y: rawY * scale + offsetY,
      title: (n.data?.title as string) ?? n.id,
      type: (n.data?.type as string) ?? "default",
      status: (n.data?.status as string) ?? "pending",
      body: (n.data?.body as string) ?? "",
      roleLabel: (n.data?.roleLabel as string) ?? undefined,
      height: nodeHeights.get(n.id) ?? MIN_NODE_H,
    };
  });

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges: LayoutEdge[] = graphData.edges.map(e => {
    const from = nodeMap.get(e.source);
    const to = nodeMap.get(e.target);
    const edgeData = g.edge(e.source, e.target);
    const points = (edgeData?.points ?? []).map((p: { x: number; y: number }) => ({
      x: (p.x - PADDING) * scale + offsetX,
      y: (p.y - PADDING) * scale + offsetY,
    }));
    return {
      from: { x: from?.x ?? 0, y: from?.y ?? 0 },
      to: { x: to?.x ?? 0, y: to?.y ?? 0 },
      points,
      label: e.label,
      type: e.type,
      sourceKind: e.sourceKind,
    };
  });

  return {
    nodes,
    edges,
    consoleLines: graphData.consoleLines,
    telemetry: graphData.telemetry,
    hiddenNodeCount: graphData.hiddenNodeCount,
    mode: graphData.mode,
  };
}

// ---------------------------------------------------------------------------
/**
 * Wrap text into multiple lines that fit within maxWidth.
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let end = remaining.length;
    while (ctx.measureText(remaining.slice(0, end)).width > maxWidth && end > 1) {
      end--;
    }
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return lines.length > 0 ? lines : [""];
}

// Canvas2D 绘制
// ---------------------------------------------------------------------------

function isSpecBranchStage(stageId: string): boolean {
  return stageId === "spec_tree" || stageId === "spec_docs";
}

function sanitizeRoleNodeId(roleId: string): string {
  return roleId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatRoleLabel(roleId: string, roleLabels?: Record<string, string>): string {
  const explicit = roleLabels?.[roleId];
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  return roleId
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function entryMatchesRole(entry: AgentReasoningEntry, roleId: string): boolean {
  const entryRole = sanitizeRoleNodeId(
    ((entry as AgentReasoningEntry & { roleId?: string }).roleId) ?? ""
  );
  const targetRole = sanitizeRoleNodeId(roleId);
  return entryRole.length > 0 && entryRole === targetRole;
}

function isStageTwoJob(job: BlueprintGenerationJob | null | undefined): boolean {
  return job?.stage === "spec_tree" || job?.stage === "spec_docs";
}

function shouldRenderRouteSetWall(job: BlueprintGenerationJob | null | undefined): boolean {
  const stage = String((job as { stage?: string } | null | undefined)?.stage ?? "");
  return stage === "route_generation" || stage === "route_selection";
}

function reasoningGraphToGraphData(
  viewModel: BlueprintWallReasoningGraphViewModel
): GraphData {
  return {
    nodes: viewModel.visibleNodes.map(node => ({
      id: node.id,
      data: reasoningNodeData(node),
    })),
    edges: viewModel.visibleEdges.map(edge => reasoningEdgeData(edge)),
    consoleLines: viewModel.consoleLines,
    telemetry: viewModel.telemetry,
    hiddenNodeCount: viewModel.hiddenNodeCount,
    mode: viewModel.mode,
  };
}

function reasoningNodeData(node: BrainstormReasoningNode): Record<string, unknown> {
  return {
    title: node.title,
    type: node.type,
    status: node.status,
    body: node.body ?? "",
    roleLabel: node.roleLabel ?? node.roleId ?? "",
  };
}

function reasoningEdgeData(edge: BrainstormReasoningEdge): GraphData["edges"][number] {
  return {
    source: edge.source,
    target: edge.target,
    label: edge.label ?? edge.type.replace(/_/g, " "),
    type: edge.type,
    sourceKind: edge.sourceKind,
  };
}

function readSelectedRouteIdFromJob(
  job: BlueprintGenerationJob | null | undefined
): string | null {
  const selectionArtifact = job?.artifacts?.find(
    artifact => artifact.type === "route_selection"
  );
  const payload =
    selectionArtifact?.payload && typeof selectionArtifact.payload === "object"
      ? selectionArtifact.payload as Record<string, unknown>
      : {};
  const routeId = payload.routeId ?? payload.selectedRouteId ?? payload.selectedPathId;
  return typeof routeId === "string" && routeId.length > 0 ? routeId : null;
}

function buildRouteSetGraphData(
  routeSet: BlueprintRouteSet,
  job: BlueprintGenerationJob | null | undefined,
  locale: AppLocale | undefined,
  specTree?: BlueprintSpecTree | null
): GraphData {
  const nodes: GraphData["nodes"] = [];
  const edges: GraphData["edges"] = [];
  const selectedRouteId = readSelectedRouteIdFromJob(job) ?? routeSet.primaryRouteId;
  const rootId = "routes-root";
  const selectedRoute = routeSet.routes.find(route => route.id === selectedRouteId);
  const selectedRouteNodeId = selectedRoute ? `route-${selectedRoute.id}` : null;

  nodes.push({
    id: rootId,
    data: {
      title: locale === "zh-CN" ? "路线选择" : "Route selection",
      type: "route_root",
      status: selectedRoute ? "completed" : "running",
      body:
        selectedRoute?.title ??
        (locale === "zh-CN"
          ? `${routeSet.routes.length} 条候选路线`
          : `${routeSet.routes.length} candidate routes`),
    },
  });

  for (const route of routeSet.routes.slice(0, 4)) {
    const isSelected = route.id === selectedRouteId;
    const routeNodeId = `route-${route.id}`;
    nodes.push({
      id: routeNodeId,
      data: {
        title: route.title,
        type: isSelected ? "decision" : "route_step",
        status: isSelected ? "completed" : "ready",
        body: route.summary || route.rationale || route.estimatedEffort,
      },
    });
    edges.push({
      source: rootId,
      target: routeNodeId,
      label: isSelected
        ? locale === "zh-CN" ? "已选" : "selected"
        : locale === "zh-CN" ? "候选" : "candidate",
      type: isSelected ? "supports" : "refines",
      sourceKind: "route_set",
    });

    const visibleSteps = route.steps.slice(0, 4);
    for (const [index, step] of visibleSteps.entries()) {
      const stepNodeId = `${routeNodeId}-step-${step.id}`;
      nodes.push({
        id: stepNodeId,
        data: {
          title: step.title,
          type: step.status === "blocked" ? "risk" : "capability",
          status: step.status === "blocked" ? "failed" : step.status,
          body: step.description || step.role,
          roleLabel: step.role,
        },
      });
      edges.push({
        source: index === 0 ? routeNodeId : `${routeNodeId}-step-${visibleSteps[index - 1].id}`,
        target: stepNodeId,
        label: locale === "zh-CN" ? `步骤 ${index + 1}` : `step ${index + 1}`,
        type: "depends_on",
        sourceKind: "route_set",
      });
    }

    const visibleCapabilities = route.capabilities.slice(0, 3);
    for (const capability of visibleCapabilities) {
      const capabilityNodeId = `${routeNodeId}-cap-${capability.id}`;
      nodes.push({
        id: capabilityNodeId,
        data: {
          title: capability.label,
          type: "capability",
          status: isSelected ? "running" : "ready",
          body: capability.purpose,
          roleLabel: capability.kind,
        },
      });
      edges.push({
        source: routeNodeId,
        target: capabilityNodeId,
        label: locale === "zh-CN" ? "能力" : "capability",
        type: "supports",
        sourceKind: "route_set",
      });
    }
  }

  const specTreeNodes = specTree?.nodes ?? [];
  const specRoot = specTreeNodes.find(node => node.id === specTree?.rootNodeId) ?? specTreeNodes[0];
  if (specRoot && selectedRouteNodeId) {
    const specRootId = `route-spec-${specRoot.id}`;
    nodes.push({
      id: specRootId,
      data: {
        title: locale === "zh-CN" ? "SPEC 树" : "SPEC tree",
        type: "route_spec",
        status: "running",
        body: specRoot.title || specRoot.summary || specTree?.id,
      },
    });
    edges.push({
      source: selectedRouteNodeId,
      target: specRootId,
      label: locale === "zh-CN" ? "派生" : "derives",
      type: "synthesizes",
      sourceKind: "route_set",
    });

    const childIds = Array.isArray(specRoot.children) ? specRoot.children : [];
    const topSpecNodes = specTreeNodes
      .filter(node => childIds.includes(node.id))
      .slice(0, 6);
    for (const specNode of topSpecNodes) {
      const specNodeId = `route-spec-node-${specNode.id}`;
      nodes.push({
        id: specNodeId,
        data: {
          title: specNode.title,
          type: "spec_node",
          status: "ready",
          body: specNode.summary,
          roleLabel: specNode.type,
        },
      });
      edges.push({
        source: specRootId,
        target: specNodeId,
        label: locale === "zh-CN" ? "规格节点" : "spec node",
        type: "depends_on",
        sourceKind: "route_set",
      });
    }
  }

  return {
    nodes,
    edges,
    telemetry: {
      tokenBurn: null,
      sourceCount: routeSet.provenance.githubUrls?.length ?? 0,
      elapsedMs: null,
      remainingBudget: null,
      activeRoleCount: new Set(
        routeSet.routes.flatMap(route => route.steps.map(step => step.role))
      ).size,
    },
    consoleLines: [
      {
        id: `${routeSet.id}-console`,
        kind: "Report",
        text: selectedRoute
          ? `Selected route: ${selectedRoute.title}`
          : `RouteSet ${routeSet.id} has ${routeSet.routes.length} candidates.`,
      },
    ],
    mode: "fallback",
  };
}

function edgeColor(edge: LayoutEdge): string {
  if (edge.sourceKind === "fallback") return "rgba(100, 116, 139, 0.38)";
  switch (edge.type) {
    case "supports":
      return "rgba(5, 150, 105, 0.62)";
    case "conflicts":
      return "rgba(220, 38, 38, 0.62)";
    case "questions":
      return "rgba(37, 99, 235, 0.58)";
    case "cites":
    case "depends_on":
      return "rgba(14, 116, 144, 0.56)";
    case "synthesizes":
      return "rgba(22, 163, 74, 0.66)";
    case "refines":
    default:
      return "rgba(124, 58, 237, 0.52)";
  }
}

function telemetryText(telemetry: BrainstormGraphTelemetry | undefined): string[] {
  const format = (label: string, value: number | null | undefined, suffix = "") =>
    `${label}: ${typeof value === "number" ? `${value}${suffix}` : "--"}`;
  return [
    format("tokens", telemetry?.tokenBurn),
    format("sources", telemetry?.sourceCount),
    format("elapsed", telemetry?.elapsedMs ? Math.round(telemetry.elapsedMs / 1000) : null, "s"),
    format("budget", telemetry?.remainingBudget),
    format("roles", telemetry?.activeRoleCount),
  ];
}

function drawWall(ctx: CanvasRenderingContext2D, layout: LayoutResult | null) {
  // 背景
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, "#f0fdf9");
  gradient.addColorStop(1, "#ecfdf5");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // 网格装饰点
  ctx.fillStyle = "rgba(148, 163, 184, 0.12)";
  for (let x = 90; x < W; x += 150) {
    for (let y = 90; y < H; y += 150) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!layout || layout.nodes.length === 0) {
    // 空态
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("蓝图流程图", W / 2, H / 2 - 36);
    ctx.font = "39px system-ui, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("等待执行数据…", W / 2, H / 2 + 42);
    return;
  }

  // 绘制连线（贝塞尔曲线虚线）
  ctx.lineWidth = 5;
  ctx.setLineDash([18, 12]);

  for (const edge of layout.edges) {
    // 使用水平贝塞尔曲线（从右侧出发到左侧到达）
    const fromX = edge.from.x + NODE_W / 2;
    const fromY = edge.from.y;
    const toX = edge.to.x - NODE_W / 2;
    const toY = edge.to.y;

    // 曲线控制点偏移量（水平距离的 40%）
    const cpOffset = Math.abs(toX - fromX) * 0.4;

    ctx.lineWidth = edge.sourceKind === "fallback" ? 4 : 6;
    ctx.setLineDash(edge.sourceKind === "fallback" ? [16, 14] : []);
    ctx.strokeStyle = edgeColor(edge);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.bezierCurveTo(
      fromX + cpOffset, fromY,
      toX - cpOffset, toY,
      toX, toY
    );
    ctx.stroke();

    // 箭头圆点
    ctx.setLineDash([]);
    ctx.fillStyle = edgeColor(edge);
    ctx.beginPath();
    ctx.arc(toX, toY, 9, 0, Math.PI * 2);
    ctx.fill();
    if (edge.label) {
      const labelX = (fromX + toX) / 2;
      const labelY = (fromY + toY) / 2 - 12;
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labelWidth = ctx.measureText(edge.label).width + 28;
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.beginPath();
      ctx.roundRect(labelX - labelWidth / 2, labelY - 18, labelWidth, 36, 18);
      ctx.fill();
      ctx.fillStyle = edgeColor(edge);
      ctx.fillText(edge.label, labelX, labelY + 1);
    }
  }

  ctx.setLineDash([]);

  // 绘制节点卡片
  for (const node of layout.nodes) {
    const x = node.x - NODE_W / 2;
    const y = node.y - node.height / 2;
    const typeColor = TYPE_COLORS[node.type] ?? TYPE_COLORS.default;

    // 阴影
    ctx.shadowColor = "rgba(0,0,0,0.06)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;

    // 卡片背景
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(x, y, NODE_W, node.height, 18);
    ctx.fill();

    // 边框
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 左侧颜色条
    ctx.fillStyle = typeColor;
    ctx.beginPath();
    ctx.roundRect(x, y, 12, node.height, [18, 0, 0, 18]);
    ctx.fill();

    // 状态圆点
    const statusColor =
      node.status === "completed" || node.status === "resolved" || node.status === "supported"
        ? "#10b981"
        : node.status === "running" || node.status === "active" || node.status === "open"
          ? "#3b82f6"
          : node.status === "failed" || node.status === "challenged"
            ? "#ef4444"
            : "#94a3b8";
    ctx.fillStyle = statusColor;
    ctx.beginPath();
    ctx.arc(x + NODE_W - 30, y + 28, 10, 0, Math.PI * 2);
    ctx.fill();

    // 标题 — 动态行数，最多3行，超出省略号
    ctx.fillStyle = "#1e293b";
    ctx.font = NODE_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const fullText = node.body ? `${node.title} - ${node.body}` : node.title;
    const allLines = wrapText(ctx, fullText, NODE_W - 60);
    for (let i = 0; i < Math.min(allLines.length, MAX_TEXT_LINES); i++) {
      let line = allLines[i];
      if (i === MAX_TEXT_LINES - 1 && allLines.length > MAX_TEXT_LINES) {
        while (ctx.measureText(`${line}...`).width > NODE_W - 60 && line.length > 1) {
          line = line.slice(0, -1);
        }
        line += "...";
      }
      ctx.fillText(line, x + 30, y + NODE_PAD_Y + i * LINE_H);
    }

    if (node.roleLabel) {
      // 更醒目的 role（谁）：更大字号 + 稍醒目色，底部右侧；让用户一眼看到“谁在说”
      const roleText = node.roleLabel.length > 18 ? node.roleLabel.slice(0, 15) + "…" : node.roleLabel;
      ctx.fillStyle = "#475569";
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(roleText, x + NODE_W - 58, y + node.height - 32);
    }

    // 类型标签（底部左侧）——与 role 同排 meta 信息
    ctx.fillStyle = typeColor;
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(node.type.toUpperCase().replace(/_/g, " "), x + 30, y + node.height - 32);
  }

  if (layout.mode) {
    const telemetryLines = telemetryText(layout.telemetry);
    ctx.fillStyle = "rgba(15, 23, 42, 0.74)";
    ctx.beginPath();
    ctx.roundRect(70, 62, 760, 76, 18);
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `Reasoning graph: ${layout.mode}${layout.hiddenNodeCount ? `, +${layout.hiddenNodeCount} hidden` : ""}`,
      96,
      92
    );
    ctx.font = "19px system-ui, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(telemetryLines.join("   "), 96, 122);
  }

  if (layout.consoleLines && layout.consoleLines.length > 0) {
    const consoleX = 70;
    const consoleY = H - 390;
    const consoleW = 1040;
    const consoleH = 310;
    ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
    ctx.beginPath();
    ctx.roundRect(consoleX, consoleY, consoleW, consoleH, 20);
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 25px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("讨论轨迹 / Reasoning Trace", consoleX + 28, consoleY + 42);
    ctx.font = "21px system-ui, sans-serif";
    layout.consoleLines.slice(-6).forEach((line, index) => {
      const y = consoleY + 82 + index * 34;
      const roleId = (line as any)?.roleId || (line as any)?.roleLabel;
      const roleShort = roleId ? String(roleId).split(/[-_]/).pop()?.slice(0, 10) : null;
      ctx.fillStyle = "#94a3b8";
      const kindLabel = roleShort ? `[${roleShort}·${line.kind}]` : `[${line.kind}]`;
      ctx.fillText(kindLabel, consoleX + 28, y);
      ctx.fillStyle = "#f8fafc";
      const text = line.text.length > 88 ? `${line.text.slice(0, 85)}...` : line.text;
      ctx.fillText(text, consoleX + (roleShort ? 195 : 150), y);
    });
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function BlueprintWallTexture({
  job,
  routeSet,
  specTree,
  effectPreviews,
  structuredReasoningGraphs,
  agentReasoningEntries,
  capabilityStatuses,
  capabilityOwners,
  rolePhases,
  roleLabels,
  artifacts,
  locale,
}: BlueprintWallTextureProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const needsRedrawRef = useRef(true);

  const reasoningViewModel = useMemo(
    () =>
      deriveBlueprintWallReasoningGraph({
        job,
        activeSubStage: job?.stage,
        structuredGraphs: structuredReasoningGraphs,
        agentReasoningEntries,
        roleLabels,
        specTree,
      }),
    [agentReasoningEntries, job, roleLabels, specTree, structuredReasoningGraphs]
  );

  // 优先使用 derive 的 graph (structured 或 fallback)，这样早期阶段 (input, clarification, route selection) 的讨论 (来自 console 的 entries) 也能产生丰富分支的 graph。
  // derive fallback 现加入讨论链 (谁->谁 推进边) + 角色在卡片/ console 更醒目显示，解决“没有看到谁跟谁讨论，然后讨论出来个啥，大家对啥发表意见”。
  const graphData = useMemo(() => {
    if (reasoningViewModel && reasoningViewModel.visibleNodes && reasoningViewModel.visibleNodes.length > 0) {
      return reasoningGraphToGraphData(reasoningViewModel);
    }

    const entries = agentReasoningEntries ?? [];
    if (routeSet && shouldRenderRouteSetWall(job)) {
      return buildRouteSetGraphData(routeSet, job, locale, specTree);
    }
    if (isStageTwoJob(job) && reasoningViewModel.mode === "fallback") {
      return reasoningGraphToGraphData(reasoningViewModel);
    }
    if (entries.length === 0) return { nodes: [], edges: [] };

    const nodes: Array<{ id: string; data: Record<string, unknown> }> = [];
    const edges: Array<{ source: string; target: string }> = [];

    // 根节点
    const rootId = "root";
    nodes.push({
      id: rootId,
      data: {
        title: (job as unknown as { title?: string })?.title ?? "Blueprint 执行",
        type: "route_root",
        status: job?.status ?? "running",
        body: "",
      },
    });

    // 按 stageId 分组（每个 stage 是一个主分支）
    const stageMap = new Map<string, typeof entries>();
    for (const entry of entries) {
      if (entry.phase === "iteration_started" || entry.phase === "iteration_completed") continue;
      const stage = entry.stageId ?? "unknown";
      if (!stageMap.has(stage)) stageMap.set(stage, []);
      stageMap.get(stage)!.push(entry);
    }

    // 每个 stage 作为一级分支
    for (const [stageId, stageEntries] of stageMap) {
      const stageNodeId = `stage-${stageId}`;
      nodes.push({
        id: stageNodeId,
        data: {
          title: stageId.replace(/_/g, " "),
          type: "capability",
          status: stageEntries.some(e => e.phase === "completed") ? "completed" : "running",
          body: `${stageEntries.length} 步骤`,
        },
      });
      edges.push({ source: rootId, target: stageNodeId });

      const seenRoleBranchIds = new Set<string>();
      const roleBranches =
        isSpecBranchStage(stageId) && roleLabels
          ? Object.keys(roleLabels)
              .map(rawRoleId => ({
                rawRoleId,
                roleId: sanitizeRoleNodeId(rawRoleId),
              }))
              .filter(({ roleId }) => {
                if (!roleId || seenRoleBranchIds.has(roleId)) return false;
                seenRoleBranchIds.add(roleId);
                return true;
              })
              .slice(0, MAX_TEXTURE_ROLE_BRANCHES)
          : [];
      const roleBranchIdSet = new Set(roleBranches.map(role => role.roleId));
      const roleBranchNodeIds: string[] = [];
      for (const { rawRoleId, roleId } of roleBranches) {
        const matchingEntries = stageEntries.filter(entry =>
          entryMatchesRole(entry, roleId)
        );
        const roleNodeId = `${stageNodeId}-role-${roleId}`;
        roleBranchNodeIds.push(roleNodeId);
        nodes.push({
          id: roleNodeId,
          data: {
            title: formatRoleLabel(rawRoleId, roleLabels),
            type: "brainstorm",
            status: matchingEntries.some(entry => entry.phase === "completed")
              ? "completed"
              : "running",
            body:
              matchingEntries.length > 0
                ? `${matchingEntries.length} runtime signals`
                : "LLM role branch",
          },
        });
        edges.push({ source: stageNodeId, target: roleNodeId });
      }

      if (roleBranches.length > 0 && isSpecBranchStage(stageId)) {
        const synthesisNodeId = `${stageNodeId}-synthesis`;
        nodes.push({
          id: synthesisNodeId,
          data: {
            title: locale === "zh-CN" ? "SPEC 共识合成" : "SPEC consensus synthesis",
            type: "final",
            status: stageEntries.some(entry => entry.phase === "completed")
              ? "completed"
              : "running",
            body:
              locale === "zh-CN"
                ? "多角色结论汇聚"
                : "multi-role convergence",
          },
        });
        for (let i = 0; i < roleBranchNodeIds.length; i++) {
          edges.push({ source: roleBranchNodeIds[i], target: synthesisNodeId });
          if (i + 1 < roleBranchNodeIds.length) {
            edges.push({
              source: roleBranchNodeIds[i],
              target: roleBranchNodeIds[i + 1],
            });
          }
        }
        continue;
      }

      // 在每个 stage 内，按 iteration 再分组为子分支
      const iterMap = new Map<number, typeof entries>();
      for (const entry of stageEntries) {
        const iter = entry.iteration ?? 1;
        if (!iterMap.has(iter)) iterMap.set(iter, []);
        iterMap.get(iter)!.push(entry);
      }

      for (const [iterNum, iterEntries] of iterMap) {
        // 如果只有一个迭代，直接把 entries 挂在 stage 下
        const parentId = iterMap.size > 1 ? `${stageNodeId}-iter-${iterNum}` : stageNodeId;

        if (iterMap.size > 1) {
          nodes.push({
            id: parentId,
            data: {
              title: `迭代 #${iterNum}`,
              type: "route_step",
              status: iterEntries.some(e => e.phase === "completed") ? "completed" : "running",
              body: "",
            },
          });
          edges.push({ source: stageNodeId, target: parentId });
        }

        const pickParentId = (entry: AgentReasoningEntry): string => {
          if (roleBranchIdSet.size === 0) return parentId;
          const matchedRole = roleBranches.find(role =>
            entryMatchesRole(entry, role.roleId)
          );
          return matchedRole ? `${stageNodeId}-role-${matchedRole.roleId}` : parentId;
        };

        // 每个 entry 按 phase 类型分组为子分支
        const thinkingEntries = iterEntries.filter(e => e.phase === "thinking");
        const actingEntries = iterEntries.filter(e => e.phase === "acting");
        const observingEntries = iterEntries.filter(e => e.phase === "observing");
        const completedEntries = iterEntries.filter(e => e.phase === "completed" || e.phase === "error");

        // thinking 分支
        for (const entry of thinkingEntries) {
          nodes.push({
            id: entry.id,
            data: {
              title: entry.thought?.slice(0, 50) ?? "思考中…",
              type: "route_step",
              status: "completed",
              body: entry.iterationLabel ?? "",
            },
          });
          edges.push({ source: pickParentId(entry), target: entry.id });
        }

        // acting 分支
        for (const entry of actingEntries) {
          nodes.push({
            id: entry.id,
            data: {
              title: entry.actionToolId ?? "执行动作",
              type: "capability",
              status: "completed",
              body: entry.thought?.slice(0, 30) ?? "",
            },
          });
          edges.push({ source: pickParentId(entry), target: entry.id });
        }

        // observing 分支
        for (const entry of observingEntries) {
          nodes.push({
            id: entry.id,
            data: {
              title: entry.observationSummary?.slice(0, 50) ?? "观察结果",
              type: "preview",
              status: entry.observationSuccess === false ? "failed" : "completed",
              body: "",
            },
          });
          // observing 连接到对应的 acting（如果有的话）
          const lastActing = actingEntries[actingEntries.length - 1];
          edges.push({ source: lastActing?.id ?? pickParentId(entry), target: entry.id });
        }

        // completed/error 分支
        for (const entry of completedEntries) {
          nodes.push({
            id: entry.id,
            data: {
              title: entry.phase === "error"
                ? (entry.error?.slice(0, 40) ?? "错误")
                : (entry.reason?.slice(0, 40) ?? "完成"),
              type: "final",
              status: entry.phase === "error" ? "failed" : "completed",
              body: "",
            },
          });
          // completed 连接到最后一个 observing（如果有的话）
          const lastObserving = observingEntries[observingEntries.length - 1];
          edges.push({ source: lastObserving?.id ?? pickParentId(entry), target: entry.id });
        }
      }
    }

    return { nodes, edges };
  }, [agentReasoningEntries, job, locale, reasoningViewModel, roleLabels, routeSet, specTree]);

  const isEmpty = graphData.nodes.length === 0;

  // dagre 布局计算
  const layout = useMemo<LayoutResult | null>(() => {
    if (isEmpty) return null;
    try {
      return computeLayout(graphData);
    } catch {
      return null;
    }
  }, [graphData, isEmpty]);

  // 创建 canvas + texture（一次性）
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvasRef.current = canvas;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textureRef.current = texture;

    // 立即绘制初始状态
    const ctx = canvas.getContext("2d");
    if (ctx) drawWall(ctx, null);
    texture.needsUpdate = true;

    return () => {
      texture.dispose();
      textureRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  // 数据变化时标记需要重绘
  useEffect(() => {
    needsRedrawRef.current = true;
  }, [layout]);

  // 每帧检查是否需要重绘
  useFrame(() => {
    if (!needsRedrawRef.current) return;
    needsRedrawRef.current = false;

    const canvas = canvasRef.current;
    const texture = textureRef.current;
    if (!canvas || !texture) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawWall(ctx, layout);
    texture.needsUpdate = true;

    // 确保 mesh 材质绑定了纹理
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      if (!mat.map) {
        mat.map = texture;
        mat.needsUpdate = true;
      }
    }
  });

  return (
    <mesh ref={meshRef} position={BLUEPRINT_WALL_GRAPH_POSITION} receiveShadow>
      <planeGeometry args={[BLUEPRINT_WALL_GRAPH_BACKING_WIDTH, BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT]} />
      <meshBasicMaterial />
    </mesh>
  );
}

export default BlueprintWallTexture;
