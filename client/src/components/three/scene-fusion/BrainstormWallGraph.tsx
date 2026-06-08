/**
 * BrainstormWallGraph — dagre 布局 + Canvas2D 绘制多智能体协作思维导图纹理。
 *
 * 与 BlueprintWallTexture 遵循同一模式：
 * 1. dagre 纯 JS 计算节点坐标（LR 方向）
 * 2. Canvas2D 绘制节点卡片（type→color）和贝塞尔虚线连线
 * 3. Three.js CanvasTexture 贴到墙面 mesh 上
 * 4. 新节点 fade-in 动画（300ms opacity 0→1）
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §8
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import type { BranchNode, BranchEdge } from "@/lib/brainstorm-graph-store";
import type { BrainstormSessionStatus } from "@/lib/brainstorm-graph-store";
import { useBrainstormGraphStore } from "@/lib/brainstorm-graph-store";

import {
  BLUEPRINT_WALL_GRAPH_POSITION,
  BLUEPRINT_WALL_GRAPH_BACKING_WIDTH,
  BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT,
} from "./blueprint-wall-placement";

import {
  CANVAS_W,
  CANVAS_H,
  BRAINSTORM_NODE_W,
  BRAINSTORM_NODE_H,
  BRAINSTORM_PADDING,
  computeAdaptiveScale,
  drawBrainstormGraph,
} from "./brainstorm-wall-graph-logic";
import type {
  BrainstormDeliberationOverlay,
  LayoutNode,
  LayoutEdge,
  LayoutResult,
} from "./brainstorm-wall-graph-logic";

const BRAINSTORM_WALL_GRAPH_POSITION: [number, number, number] = [
  BLUEPRINT_WALL_GRAPH_POSITION[0],
  BLUEPRINT_WALL_GRAPH_POSITION[1],
  BLUEPRINT_WALL_GRAPH_POSITION[2] + 0.018,
];

// Re-export from logic module for backward compatibility
export {
  truncateTitle,
  computeAdaptiveScale,
  BRAINSTORM_NODE_COLORS,
  BRAINSTORM_NODE_W,
  BRAINSTORM_NODE_H,
  BRAINSTORM_PADDING,
  MAX_TITLE_LENGTH,
  CANVAS_W,
  CANVAS_H,
  drawBrainstormGraph,
} from "./brainstorm-wall-graph-logic";
export type { LayoutNode, LayoutEdge, LayoutResult } from "./brainstorm-wall-graph-logic";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrainstormWallGraphProps {
  nodes: BranchNode[];
  edges: BranchEdge[];
  sessionStatus: BrainstormSessionStatus;
  deliberation?: BrainstormDeliberationOverlay;
}

function isCentralDecisionMarker(node: BranchNode): boolean {
  if (node.id === "decision-gate" || node.id === "decision-marker") return true;
  const normalizedTitle = node.title.trim().toUpperCase();
  return (
    normalizedTitle === "DECISION: BRANCH" ||
    normalizedTitle === "DECISION: BRAINSTORM"
  );
}

// ---------------------------------------------------------------------------
// dagre Layout Computation
// ---------------------------------------------------------------------------

export function computeBrainstormLayout(
  nodes: BranchNode[],
  edges: BranchEdge[],
  canvasWidth: number = CANVAS_W,
  canvasHeight: number = CANVAS_H
): LayoutResult | null {
  if (nodes.length === 0) return null;

  const roleOrder: Array<BranchNode["roleId"]> = [
    "decider",
    "planner",
    "architect",
    "executor",
    "auditor",
    "ui_previewer",
  ];
  const fallbackRoles = Array.from(new Set(nodes.map((node) => node.roleId)));
  const roles = [
    ...roleOrder.filter((role) => fallbackRoles.includes(role)),
    ...fallbackRoles.filter((role) => !roleOrder.includes(role)),
  ];
  const laneRoles: Array<BranchNode["roleId"]> = roles.length > 0 ? roles : ["decider"];
  const runtimeRoleNodes = nodes.filter((node) => node.id === `role:${node.roleId}`);

  if (runtimeRoleNodes.length >= 3) {
    const synthesisNodes = nodes.filter((node) => node.type === "synthesis");
    const normalNodes = nodes.filter((node) => node.type !== "synthesis");
    const decisionMarker = nodes.find(
      (node) => !node.id.startsWith("role:") && isCentralDecisionMarker(node),
    );
    const anchorByRole = new Map(runtimeRoleNodes.map((node) => [node.roleId, node]));
    const orderedRuntimeRoles = [
      ...laneRoles.filter((role) => anchorByRole.has(role)),
      ...runtimeRoleNodes
        .map((node) => node.roleId)
        .filter((role) => !laneRoles.includes(role)),
    ];
    const left = BRAINSTORM_PADDING + BRAINSTORM_NODE_W / 2;
    const right = canvasWidth - BRAINSTORM_PADDING - BRAINSTORM_NODE_W / 2;
    const roleLeft = decisionMarker
      ? Math.min(right, left + BRAINSTORM_NODE_W + 240)
      : left;
    const top = BRAINSTORM_PADDING + BRAINSTORM_NODE_H / 2;
    const bottom = canvasHeight - BRAINSTORM_PADDING - BRAINSTORM_NODE_H / 2;
    const centerY = canvasHeight / 2;
    const roleAnchorPosition = new Map<BranchNode["roleId"], { x: number; y: number }>();

    orderedRuntimeRoles.forEach((role, index) => {
      const denominator = Math.max(1, orderedRuntimeRoles.length - 1);
      const x = roleLeft + (right - roleLeft) * (index / denominator);
      const isUpper = index % 2 === 0;
      const bandY = isUpper ? top + canvasHeight * 0.08 : bottom - canvasHeight * 0.08;
      const y = orderedRuntimeRoles.length === 3 && index === 1 ? centerY : bandY;
      roleAnchorPosition.set(role, { x, y });
    });

    const roleBranchIndex = new Map<BranchNode["roleId"], number>();
    const layoutNodes: LayoutNode[] = nodes.map((node) => {
      const anchorPosition = roleAnchorPosition.get(node.roleId);
      const isRuntimeAnchor = node.id === `role:${node.roleId}` && anchorPosition;
      const synthesisIndex = synthesisNodes.findIndex((candidate) => candidate.id === node.id);
      let x: number;
      let y: number;

      if (synthesisIndex >= 0) {
        x = canvasWidth - BRAINSTORM_PADDING - BRAINSTORM_NODE_W / 2;
        y = centerY + (synthesisIndex - (synthesisNodes.length - 1) / 2) * (BRAINSTORM_NODE_H + 72);
      } else if (decisionMarker?.id === node.id) {
        x = left;
        y = centerY;
      } else if (isRuntimeAnchor && anchorPosition) {
        x = anchorPosition.x;
        y = anchorPosition.y;
      } else if (anchorPosition) {
        const branchIndex = roleBranchIndex.get(node.roleId) ?? 0;
        roleBranchIndex.set(node.roleId, branchIndex + 1);
        const roleOrderIndex = Math.max(0, orderedRuntimeRoles.indexOf(node.roleId));
        const direction = roleOrderIndex % 2 === 0 ? 1 : -1;
        const branchOffsetX = Math.min(360, 150 + branchIndex * 96);
        const branchOffsetY = direction * (BRAINSTORM_NODE_H + 72 + branchIndex * 54);
        x = Math.max(left, Math.min(right, anchorPosition.x + branchOffsetX));
        y = Math.max(top, Math.min(bottom, anchorPosition.y + branchOffsetY));
      } else {
        const normalIndex = normalNodes.findIndex((candidate) => candidate.id === node.id);
        const roundIndex = Math.max(0, Math.floor(Math.max(0, normalIndex) / Math.max(1, laneRoles.length)));
        const laneIndex = laneRoles.indexOf(node.roleId) >= 0
          ? laneRoles.indexOf(node.roleId)
          : Math.max(0, normalIndex % Math.max(1, laneRoles.length));
        x = left + roundIndex * (BRAINSTORM_NODE_W + 180);
        y = top + laneIndex * (BRAINSTORM_NODE_H + 120);
      }

      return {
        id: node.id,
        x,
        y,
        title: node.title,
        type: node.type,
        status: node.status,
        roleId: node.roleId,
        confidence: node.confidence,
        opacity: 1,
      };
    });

    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));
    const layoutEdges: LayoutEdge[] = edges
      .filter((e) => nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId))
      .map((e) => ({
        from: { x: nodeMap.get(e.sourceNodeId)!.x, y: nodeMap.get(e.sourceNodeId)!.y },
        to: { x: nodeMap.get(e.targetNodeId)!.x, y: nodeMap.get(e.targetNodeId)!.y },
      }));

    return { nodes: layoutNodes, edges: layoutEdges, scale: 1 };
  }

  const normalNodes = nodes.filter((node) => node.type !== "synthesis");
  const synthesisNodes = nodes.filter((node) => node.type === "synthesis");
  const nodesPerRound = Math.max(1, laneRoles.length);
  const roundCount = Math.max(1, Math.ceil(normalNodes.length / nodesPerRound));
  const columnCount = roundCount + (synthesisNodes.length > 0 ? 1 : 0);
  const laneCount = laneRoles.length + (synthesisNodes.length > 0 ? 1 : 0);
  const xStep = Math.max(
    BRAINSTORM_NODE_W + 180,
    (canvasWidth - BRAINSTORM_PADDING * 2 - BRAINSTORM_NODE_W) /
      Math.max(1, columnCount - 1),
  );
  const yStep = Math.max(
    BRAINSTORM_NODE_H + 120,
    (canvasHeight - BRAINSTORM_PADDING * 2 - BRAINSTORM_NODE_H) /
      Math.max(1, laneCount - 1),
  );
  const xStart = BRAINSTORM_PADDING + BRAINSTORM_NODE_W / 2;
  const yStart = BRAINSTORM_PADDING + BRAINSTORM_NODE_H / 2;
  const roleLane = new Map(laneRoles.map((role, index) => [role, index]));

  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const normalIndex = normalNodes.findIndex((candidate) => candidate.id === node.id);
    const synthesisIndex = synthesisNodes.findIndex((candidate) => candidate.id === node.id);
    const isSynthesis = synthesisIndex >= 0;
    const roundIndex = isSynthesis
      ? roundCount
      : Math.max(0, Math.floor(Math.max(0, normalIndex) / nodesPerRound));
    const laneIndex = isSynthesis
      ? laneRoles.length
      : roleLane.get(node.roleId) ?? Math.max(0, normalIndex % nodesPerRound);
    return {
      id: node.id,
      x: xStart + roundIndex * xStep,
      y: yStart + laneIndex * yStep,
      title: node.title,
      type: node.type,
      status: node.status,
      roleId: node.roleId,
      confidence: node.confidence,
      opacity: 1,
    };
  });

  const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));
  const layoutEdges: LayoutEdge[] = edges
    .filter((e) => nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId))
    .map((e) => ({
      from: { x: nodeMap.get(e.sourceNodeId)!.x, y: nodeMap.get(e.sourceNodeId)!.y },
      to: { x: nodeMap.get(e.targetNodeId)!.x, y: nodeMap.get(e.targetNodeId)!.y },
    }));

  const graphWidth =
    BRAINSTORM_NODE_W + Math.max(0, columnCount - 1) * xStep + BRAINSTORM_PADDING * 2;
  const graphHeight =
    BRAINSTORM_NODE_H + Math.max(0, laneCount - 1) * yStep + BRAINSTORM_PADDING * 2;
  const scale = computeAdaptiveScale(
    graphWidth,
    graphHeight,
    canvasWidth,
    canvasHeight,
    BRAINSTORM_PADDING,
  );

  return { nodes: layoutNodes, edges: layoutEdges, scale };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * BrainstormWallGraph renders the multi-agent brainstorm session as a
 * dagre-laid-out mind map on a Three.js wall surface.
 */
export function BrainstormWallGraph({
  nodes,
  edges,
  sessionStatus,
  deliberation,
}: BrainstormWallGraphProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const needsRedrawRef = useRef(true);
  const lastRenderTimeRef = useRef<number>(Date.now());
  const fadeNodesRef = useRef<Map<string, { startTime: number }>>(new Map());

  // Compute layout
  const layout = useMemo<LayoutResult | null>(() => {
    if (nodes.length === 0) return null;
    try {
      return computeBrainstormLayout(nodes, edges);
    } catch {
      return null;
    }
  }, [nodes, edges]);

  // Create canvas + texture (once)
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    canvasRef.current = canvas;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textureRef.current = texture;

    // Initial empty draw
    const ctx = canvas.getContext("2d");
    if (ctx) drawBrainstormGraph(ctx, null);
    texture.needsUpdate = true;

    return () => {
      texture.dispose();
      textureRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  // Mark redraw on layout change
  useEffect(() => {
    needsRedrawRef.current = true;

    // Track new nodes for fade-in
    const now = Date.now();
    for (const node of nodes) {
      const createdAt = new Date(node.createdAt).getTime();
      // Nodes created within the last 500ms are "new"
      if (now - createdAt < 500 && !fadeNodesRef.current.has(node.id)) {
        fadeNodesRef.current.set(node.id, { startTime: now });
      }
    }
    lastRenderTimeRef.current = now;
  }, [layout, nodes]);

  // Per-frame render
  useFrame(() => {
    const canvas = canvasRef.current;
    const texture = textureRef.current;
    if (!canvas || !texture) return;

    // Check if any fade animations are active
    const now = Date.now();
    let hasFading = false;
    for (const [nodeId, fade] of fadeNodesRef.current.entries()) {
      const elapsed = now - fade.startTime;
      if (elapsed < 300) {
        hasFading = true;
      } else {
        fadeNodesRef.current.delete(nodeId);
      }
    }

    if (!needsRedrawRef.current && !hasFading) return;
    needsRedrawRef.current = false;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Apply fade-in opacity to layout nodes
    let drawLayout = layout;
    if (drawLayout && fadeNodesRef.current.size > 0) {
      const fadedNodes = drawLayout.nodes.map((n) => {
        const fade = fadeNodesRef.current.get(n.id);
        if (fade) {
          const elapsed = now - fade.startTime;
          const opacity = Math.min(elapsed / 300, 1);
          return { ...n, opacity };
        }
        return n;
      });
      drawLayout = { ...drawLayout, nodes: fadedNodes };
    }

    drawBrainstormGraph(ctx, drawLayout, CANVAS_W, CANVAS_H, deliberation);
    texture.needsUpdate = true;

    // Ensure mesh material has the texture bound
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      if (!mat.map) {
        mat.map = texture;
        mat.needsUpdate = true;
      }
    }
  });

  // Keep the completed brainstorm visible on the wall until the next reset.
  // The session often completes before the user visually inspects the 3D HUD;
  // hiding on "completed" made the real /autopilot wall fall back to the older
  // empty/route texture immediately.
  if (sessionStatus === "idle" || sessionStatus === "failed") {
    return null;
  }

  return (
    <mesh
      ref={meshRef}
      position={BRAINSTORM_WALL_GRAPH_POSITION}
      renderOrder={20}
      receiveShadow
    >
      <planeGeometry
        args={[BLUEPRINT_WALL_GRAPH_BACKING_WIDTH, BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT]}
      />
      <meshBasicMaterial depthWrite={false} />
    </mesh>
  );
}

/**
 * Connected version that reads from the brainstormGraph store.
 */
export function BrainstormWallGraphConnected() {
  const {
    nodes,
    edges,
    sessionStatus,
    currentRound,
    convergenceScore,
    challengeEdges,
    voteOutcome,
  } = useBrainstormGraphStore();
  return (
    <BrainstormWallGraph
      nodes={nodes}
      edges={edges}
      sessionStatus={sessionStatus}
      deliberation={{
        currentRound,
        convergenceScore,
        challengeEdges,
        voteOutcome,
      }}
    />
  );
}

export default BrainstormWallGraph;
