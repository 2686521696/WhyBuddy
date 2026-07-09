/**
 * Brainstorm Graph Store — manages the brainstorm session state for the
 * frontend realtime Wall Graph visualization.
 *
 * Handles brainstorm.* events from the Socket.IO relay:
 * - brainstorm.session.started → reset state, set sessionId/status
 * - brainstorm.node.created → append node, add edge if parentNodeId exists
 * - brainstorm.node.updated → update node status/content/confidence
 * - brainstorm.session.completed → freeze session
 *
 * Enforces bounded queue invariant: max 500 nodes per session (FIFO drop).
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §7
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { create } from "zustand";

import type {
  BranchNode,
  BranchEdge,
  BranchNodeStatus,
  BranchNodeType,
  BrainstormRoleId,
  CollaborationMode,
} from "@shared/blueprint/brainstorm-contracts";
import type { BrainstormRuntimeGraphEventType } from "@shared/blueprint/brainstorm-runtime-graph";

// Re-export for convenience
export type { BranchNode, BranchEdge };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of nodes per active session (FIFO drop). */
export const MAX_BRAINSTORM_NODES = 500;
export const MAX_CHALLENGE_EDGES = 500;
const DEFAULT_RUNTIME_ROLES: BrainstormRoleId[] = [
  "decider",
  "planner",
  "architect",
  "executor",
  "auditor",
];

// ---------------------------------------------------------------------------
// State Shape
// ---------------------------------------------------------------------------

export interface BrainstormSessionMetadata {
  mode: CollaborationMode | null;
  roles: BrainstormRoleId[];
  startedAt: string | null;
  completedAt: string | null;
  totalTokenUsage: number;
}

export type BrainstormSessionStatus =
  | "idle"
  | "active"
  | "synthesizing"
  | "completed"
  | "failed";

export interface BrainstormGraphState {
  sessionId: string | null;
  sessionStatus: BrainstormSessionStatus;
  nodes: BranchNode[];
  edges: BranchEdge[];
  currentRound: number | null;
  convergenceScore: number | null;
  challengeEdges: ChallengeEdge[];
  voteOutcome: VoteOutcomeView | null;
  sessionMetadata: BrainstormSessionMetadata;
}

export interface ChallengeEdge {
  challengerRoleId: BrainstormRoleId;
  targetRoleId: BrainstormRoleId;
  summary: string;
  roundNumber: number;
  kind?: "challenge" | "support";
}

export interface VoteOutcomeView {
  winningOption: string;
  margin: number;
  isNarrow: boolean;
  minority?: string[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface BrainstormGraphActions {
  /** Handle brainstorm.session.started event */
  handleSessionStarted(payload: {
    sessionId: string;
    mode?: CollaborationMode;
    roles?: BrainstormRoleId[];
  }): void;

  /** Handle brainstorm.node.created event */
  handleNodeCreated(payload: {
    sessionId: string;
    nodeId: string;
    parentNodeId: string | null;
    roleId: BrainstormRoleId;
    nodeType: BranchNodeType;
    status: BranchNodeStatus;
    title?: string;
    content?: string;
    sequenceNumber?: number;
  }): void;

  /** Handle brainstorm.node.updated event */
  handleNodeUpdated(payload: {
    sessionId: string;
    nodeId: string;
    status?: BranchNodeStatus;
    content?: string;
    confidence?: number;
    tokenUsage?: number;
  }): void;

  /** Handle brainstorm.session.completed event */
  handleSessionCompleted(payload: {
    sessionId: string;
    tokenUsed?: number;
  }): void;

  /** Handle brainstorm.session.synthesizing event */
  handleSessionSynthesizing(payload: { sessionId: string }): void;

  /** Handle brainstorm.session.failed event */
  handleSessionFailed(payload: { sessionId: string }): void;

  handleRoundCompleted(payload: {
    sessionId: string;
    roundNumber: number;
    convergenceScore: number;
  }): void;

  handleChallengeIssued(payload: {
    sessionId: string;
    challengerRoleId: BrainstormRoleId;
    targetRoleId: BrainstormRoleId;
    summary: string;
    roundNumber: number;
    kind?: "challenge" | "support";
  }): void;

  handleVoteCompleted(payload: {
    sessionId: string;
    winningOption: string;
    margin: number;
    isNarrow: boolean;
    minority?: string[];
  }): void;

  /** Reset the entire store */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Selectors (standalone functions for external consumption)
// ---------------------------------------------------------------------------

export function selectAllNodes(state: BrainstormGraphState): BranchNode[] {
  return state.nodes;
}

export function selectNodesByRole(
  state: BrainstormGraphState,
  roleId: BrainstormRoleId
): BranchNode[] {
  return state.nodes.filter(n => n.roleId === roleId);
}

export function selectNodesByStatus(
  state: BrainstormGraphState,
  status: BranchNodeStatus
): BranchNode[] {
  return state.nodes.filter(n => n.status === status);
}

export function selectSessionMetadata(
  state: BrainstormGraphState
): BrainstormSessionMetadata {
  return state.sessionMetadata;
}

export function selectChallengeEdges(
  state: BrainstormGraphState
): ChallengeEdge[] {
  return state.challengeEdges;
}

export function selectVoteOutcome(
  state: BrainstormGraphState
): VoteOutcomeView | null {
  return state.voteOutcome;
}

export function selectCurrentRound(state: BrainstormGraphState): number | null {
  return state.currentRound;
}

export function selectConvergenceScore(
  state: BrainstormGraphState
): number | null {
  return state.convergenceScore;
}

export function selectIsActive(state: BrainstormGraphState): boolean {
  return (
    state.sessionStatus === "active" || state.sessionStatus === "synthesizing"
  );
}

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

export const INITIAL_BRAINSTORM_GRAPH: BrainstormGraphState = {
  sessionId: null,
  sessionStatus: "idle",
  nodes: [],
  edges: [],
  currentRound: null,
  convergenceScore: null,
  challengeEdges: [],
  voteOutcome: null,
  sessionMetadata: {
    mode: null,
    roles: [],
    startedAt: null,
    completedAt: null,
    totalTokenUsage: 0,
  },
};

function seedRoleAnchorNodes(
  sessionId: string,
  roles: BrainstormRoleId[] = []
): { nodes: BranchNode[]; edges: BranchEdge[] } {
  const now = new Date().toISOString();
  const uniqueRoles = Array.from(new Set(roles));
  const nodes: BranchNode[] = uniqueRoles.map((roleId, index) => ({
    id: `role:${roleId}`,
    sessionId,
    parentNodeId: index === 0 ? null : `role:${uniqueRoles[index - 1]}`,
    roleId,
    type: "decision",
    status: "completed",
    title: roleId,
    createdAt: now,
    updatedAt: now,
    sequenceNumber: index + 1,
  }));
  const edges: BranchEdge[] = uniqueRoles.slice(1).map((roleId, index) => ({
    sourceNodeId: `role:${uniqueRoles[index]}`,
    targetNodeId: `role:${roleId}`,
  }));
  return { nodes, edges };
}

function addUniqueEdges(
  edges: BranchEdge[],
  additions: BranchEdge[]
): BranchEdge[] {
  const seen = new Set(
    edges.map(edge => `${edge.sourceNodeId}->${edge.targetNodeId}`)
  );
  const next = [...edges];
  for (const edge of additions) {
    const key = `${edge.sourceNodeId}->${edge.targetNodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(edge);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useBrainstormGraphStore = create<
  BrainstormGraphState & BrainstormGraphActions
>((set, get) => ({
  ...INITIAL_BRAINSTORM_GRAPH,

  handleSessionStarted(payload) {
    const seeded = seedRoleAnchorNodes(payload.sessionId, payload.roles ?? []);
    set({
      sessionId: payload.sessionId,
      sessionStatus: "active",
      nodes: seeded.nodes,
      edges: seeded.edges,
      currentRound: null,
      convergenceScore: null,
      challengeEdges: [],
      voteOutcome: null,
      sessionMetadata: {
        mode: payload.mode ?? null,
        roles: payload.roles ?? [],
        startedAt: new Date().toISOString(),
        completedAt: null,
        totalTokenUsage: 0,
      },
    });
  },

  handleNodeCreated(payload) {
    const state = get();

    // Reject if session is completed/failed (freeze invariant)
    if (
      state.sessionStatus === "completed" ||
      state.sessionStatus === "failed"
    ) {
      return;
    }

    // Reject if sessionId doesn't match
    if (state.sessionId && payload.sessionId !== state.sessionId) {
      return;
    }

    const now = new Date().toISOString();
    const node: BranchNode = {
      id: payload.nodeId,
      sessionId: payload.sessionId,
      parentNodeId: payload.parentNodeId,
      roleId: payload.roleId,
      type: payload.nodeType,
      status: payload.status ?? "active",
      title: payload.title ?? "",
      content: payload.content,
      createdAt: now,
      updatedAt: now,
      sequenceNumber: payload.sequenceNumber ?? state.nodes.length + 1,
    };

    let nextNodes = [...state.nodes];
    let nextEdges = [...state.edges];

    // Bounded queue enforcement: drop oldest (FIFO)
    if (nextNodes.length >= MAX_BRAINSTORM_NODES) {
      const droppedNode = nextNodes[0];
      nextNodes = nextNodes.slice(1);
      // Remove edges referencing the dropped node
      nextEdges = nextEdges.filter(
        e =>
          e.sourceNodeId !== droppedNode.id && e.targetNodeId !== droppedNode.id
      );
    }

    nextNodes.push(node);

    // Add edge if parentNodeId is non-null
    if (payload.parentNodeId) {
      nextEdges.push({
        sourceNodeId: payload.parentNodeId,
        targetNodeId: payload.nodeId,
      });
    }

    set({ nodes: nextNodes, edges: nextEdges });
  },

  handleNodeUpdated(payload) {
    const state = get();

    // Reject if session is completed/failed (freeze invariant)
    if (
      state.sessionStatus === "completed" ||
      state.sessionStatus === "failed"
    ) {
      return;
    }

    // Reject if sessionId doesn't match
    if (state.sessionId && payload.sessionId !== state.sessionId) {
      return;
    }

    const nodeIndex = state.nodes.findIndex(n => n.id === payload.nodeId);
    if (nodeIndex === -1) return;

    const updatedNode = { ...state.nodes[nodeIndex] };
    if (payload.status !== undefined) updatedNode.status = payload.status;
    if (payload.content !== undefined) updatedNode.content = payload.content;
    if (payload.confidence !== undefined)
      updatedNode.confidence = payload.confidence;
    if (payload.tokenUsage !== undefined)
      updatedNode.tokenUsage = payload.tokenUsage;
    updatedNode.updatedAt = new Date().toISOString();

    const nextNodes = [...state.nodes];
    nextNodes[nodeIndex] = updatedNode;
    set({ nodes: nextNodes });
  },

  handleSessionCompleted(payload) {
    const state = get();
    if (state.sessionId && payload.sessionId !== state.sessionId) return;

    set({
      sessionStatus: "completed",
      sessionMetadata: {
        ...state.sessionMetadata,
        completedAt: new Date().toISOString(),
        totalTokenUsage:
          payload.tokenUsed ?? state.sessionMetadata.totalTokenUsage,
      },
    });
  },

  handleSessionSynthesizing(payload) {
    const state = get();
    if (state.sessionId && payload.sessionId !== state.sessionId) return;
    set({ sessionId: payload.sessionId, sessionStatus: "synthesizing" });
  },

  handleSessionFailed(payload) {
    const state = get();
    if (state.sessionId && payload.sessionId !== state.sessionId) return;
    set({ sessionStatus: "failed" });
  },

  handleRoundCompleted(payload) {
    const state = get();
    if (state.sessionId && payload.sessionId !== state.sessionId) return;
    set({
      currentRound: payload.roundNumber,
      convergenceScore: payload.convergenceScore,
    });
  },

  handleChallengeIssued(payload) {
    const state = get();
    if (state.sessionId && payload.sessionId !== state.sessionId) return;
    const hasChallenger = state.nodes.some(
      node => node.roleId === payload.challengerRoleId
    );
    const hasTarget = state.nodes.some(
      node => node.roleId === payload.targetRoleId
    );
    if (!hasChallenger || !hasTarget) return;

    const edge: ChallengeEdge = {
      challengerRoleId: payload.challengerRoleId,
      targetRoleId: payload.targetRoleId,
      summary: payload.summary,
      roundNumber: payload.roundNumber,
      kind: payload.kind ?? "challenge",
    };
    if (
      state.challengeEdges.some(
        candidate =>
          candidate.challengerRoleId === edge.challengerRoleId &&
          candidate.targetRoleId === edge.targetRoleId &&
          candidate.summary === edge.summary &&
          candidate.roundNumber === edge.roundNumber &&
          (candidate.kind ?? "challenge") === (edge.kind ?? "challenge")
      )
    ) {
      return;
    }
    const next = state.challengeEdges.concat(edge);
    set({
      challengeEdges:
        next.length > MAX_CHALLENGE_EDGES
          ? next.slice(next.length - MAX_CHALLENGE_EDGES)
          : next,
    });
  },

  handleVoteCompleted(payload) {
    const state = get();
    if (state.sessionId && payload.sessionId !== state.sessionId) return;
    set({
      voteOutcome: {
        winningOption: payload.winningOption,
        margin: payload.margin,
        isNarrow: payload.isNarrow,
        ...(payload.isNarrow && payload.minority
          ? { minority: payload.minority }
          : {}),
      },
    });
  },

  reset() {
    set(INITIAL_BRAINSTORM_GRAPH);
  },
}));

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

const RUNTIME_GRAPH_EVENT_TYPES = new Set<BrainstormRuntimeGraphEventType>([
  "decision.marker.emitted",
  "edge.condition.evaluated",
  "edge.triggered",
  "edge.suppressed",
  "tool.action.selected",
  "loop.continued",
  "loop.stopped",
  "synthesis.started",
  "synthesis.completed",
]);

function isRuntimeGraphEventType(
  type: string
): type is BrainstormRuntimeGraphEventType {
  return RUNTIME_GRAPH_EVENT_TYPES.has(type as BrainstormRuntimeGraphEventType);
}

function ensureRuntimeSession(
  payload: Record<string, unknown>,
  store: BrainstormGraphState & BrainstormGraphActions
): string | null {
  const sessionId = payload.sessionId;
  if (typeof sessionId !== "string") return null;
  if (store.sessionId !== sessionId) {
    store.handleSessionStarted({
      sessionId,
      mode: "discussion",
      roles: DEFAULT_RUNTIME_ROLES,
    });
  }
  return sessionId;
}

function hasNode(nodeId: string): boolean {
  return useBrainstormGraphStore
    .getState()
    .nodes.some(node => node.id === nodeId);
}

function runtimeRoleId(roleId: unknown): BrainstormRoleId {
  if (
    roleId === "decider" ||
    roleId === "planner" ||
    roleId === "architect" ||
    roleId === "executor" ||
    roleId === "auditor" ||
    roleId === "ui_previewer"
  ) {
    return roleId;
  }
  return "decider";
}

function roleIdFromRuntimeNodeId(nodeId: string): BrainstormRoleId | null {
  if (!nodeId.startsWith("role:")) return null;
  return runtimeRoleId(nodeId.slice("role:".length));
}

function runtimeSummaryFromPayload(
  payload: Record<string, unknown>,
  fallback: string
): string {
  return typeof payload.rationale === "string"
    ? payload.rationale
    : typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.reason === "string"
        ? payload.reason
        : fallback;
}

function ensureRuntimeNode(input: {
  sessionId: string;
  nodeId: string;
  roleId: BrainstormRoleId;
  nodeType: BranchNodeType;
  title: string;
  content?: string;
  parentNodeId?: string | null;
  status?: BranchNodeStatus;
}): void {
  if (hasNode(input.nodeId)) return;
  useBrainstormGraphStore.getState().handleNodeCreated({
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    parentNodeId: input.parentNodeId ?? null,
    roleId: input.roleId,
    nodeType: input.nodeType,
    status: input.status ?? "completed",
    title: input.title,
    content: input.content,
  });
}

function dispatchRuntimeGraphEvent(
  type: BrainstormRuntimeGraphEventType,
  payload: Record<string, unknown>
): void {
  const store = useBrainstormGraphStore.getState();
  const sessionId = ensureRuntimeSession(payload, store);
  if (!sessionId) return;

  if (type === "decision.marker.emitted") {
    const nodeId =
      typeof payload.nodeId === "string" ? payload.nodeId : "decision-marker";
    const roleId = runtimeRoleId(payload.roleId);
    if (!hasNode(nodeId)) {
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId,
        nodeId,
        parentNodeId: null,
        roleId,
        nodeType: "decision",
        status: "completed",
        title:
          typeof payload.marker === "string"
            ? `决策: ${payload.marker}`
            : "决策标记",
        content:
          typeof payload.rationale === "string"
            ? payload.rationale
            : typeof payload.summary === "string"
              ? payload.summary
              : undefined,
      });
    }
    const marker = typeof payload.marker === "string" ? payload.marker : "";
    if (marker === "BRANCH" || marker === "BRAINSTORM") {
      const state = useBrainstormGraphStore.getState();
      const fanoutEdges = state.nodes
        .filter(node => node.id.startsWith("role:"))
        .map(node => ({
          sourceNodeId: nodeId,
          targetNodeId: node.id,
        }));
      useBrainstormGraphStore.setState({
        edges: addUniqueEdges(state.edges, fanoutEdges),
      });
    }
    if (marker === "CHALLENGE" || marker === "SUPPORT") {
      const targetRoleId = runtimeRoleId(payload.targetRoleId);
      const state = useBrainstormGraphStore.getState();
      const roleEdges = [
        {
          sourceNodeId: `role:${roleId}`,
          targetNodeId: `role:${targetRoleId}`,
        },
      ];
      useBrainstormGraphStore.setState({
        edges: addUniqueEdges(state.edges, roleEdges),
      });
      useBrainstormGraphStore.getState().handleChallengeIssued({
        sessionId,
        challengerRoleId: roleId,
        targetRoleId,
        summary: runtimeSummaryFromPayload(
          payload,
          marker === "SUPPORT"
            ? "Runtime support response"
            : "Runtime challenge"
        ),
        roundNumber:
          typeof payload.roundNumber === "number" ? payload.roundNumber : 1,
        kind: marker === "SUPPORT" ? "support" : "challenge",
      });
    }
    return;
  }

  if (type === "edge.condition.evaluated") {
    const edgeId =
      typeof payload.edgeId === "string" ? payload.edgeId : "runtime-edge";
    const sourceNodeId =
      typeof payload.sourceNodeId === "string"
        ? payload.sourceNodeId
        : "decision-marker";
    const nodeId = `edge-condition:${edgeId}`;
    if (!hasNode(nodeId)) {
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId,
        nodeId,
        parentNodeId: hasNode(sourceNodeId) ? sourceNodeId : null,
        roleId: "auditor",
        nodeType: "observation",
        status: "completed",
        title:
          typeof payload.condition === "string"
            ? payload.condition
            : "运行时边条件",
        content: `匹配=${String(payload.matched)}`,
      });
    }
    return;
  }

  if (type === "edge.triggered" || type === "edge.suppressed") {
    const sourceNodeId =
      typeof payload.sourceNodeId === "string"
        ? payload.sourceNodeId
        : "decision-marker";
    const targetNodeId =
      typeof payload.targetNodeId === "string"
        ? payload.targetNodeId
        : type === "edge.triggered"
          ? "runtime-target"
          : "runtime-suppressed";
    const sourceRoleId = roleIdFromRuntimeNodeId(sourceNodeId);
    if (sourceRoleId) {
      ensureRuntimeNode({
        sessionId,
        nodeId: sourceNodeId,
        roleId: sourceRoleId,
        nodeType: "decision",
        title: sourceRoleId,
      });
    }
    const targetRoleId = roleIdFromRuntimeNodeId(targetNodeId);
    if (targetRoleId) {
      ensureRuntimeNode({
        sessionId,
        nodeId: targetNodeId,
        roleId: targetRoleId,
        nodeType: "decision",
        title: targetRoleId,
        parentNodeId: hasNode(sourceNodeId) ? sourceNodeId : null,
      });
    }
    if (!hasNode(targetNodeId)) {
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId,
        nodeId: targetNodeId,
        parentNodeId: hasNode(sourceNodeId) ? sourceNodeId : null,
        roleId: type === "edge.triggered" ? "planner" : "auditor",
        nodeType: type === "edge.triggered" ? "action" : "observation",
        status: type === "edge.triggered" ? "active" : "completed",
        title: type === "edge.triggered" ? "边触发" : "边抑制",
        content:
          typeof payload.reason === "string" ? payload.reason : undefined,
      });
    }
    if (sourceRoleId && targetRoleId && type === "edge.triggered") {
      const edgeId = typeof payload.edgeId === "string" ? payload.edgeId : "";
      useBrainstormGraphStore.getState().handleChallengeIssued({
        sessionId,
        challengerRoleId: sourceRoleId,
        targetRoleId,
        summary:
          typeof payload.reason === "string"
            ? payload.reason
            : "Runtime role interaction",
        roundNumber:
          typeof payload.roundNumber === "number" ? payload.roundNumber : 1,
        kind: edgeId.startsWith("rebuttal:") ? "support" : "challenge",
      });
    }
    return;
  }

  if (type === "synthesis.started") {
    useBrainstormGraphStore.getState().handleSessionSynthesizing({ sessionId });
    return;
  }

  if (type === "tool.action.selected") {
    const toolId =
      typeof payload.toolId === "string" ? payload.toolId : "runtime-tool";
    const sourceNodeId =
      typeof payload.nodeId === "string"
        ? payload.nodeId
        : `role:${runtimeRoleId(payload.roleId)}`;
    const nodeId = `tool:${toolId}:${String(payload.id ?? Date.now())}`;
    ensureRuntimeNode({
      sessionId,
      nodeId,
      roleId: runtimeRoleId(payload.roleId),
      nodeType: "action",
      title: `工具: ${toolId}`,
      content:
        typeof payload.rationale === "string" ? payload.rationale : undefined,
      parentNodeId: hasNode(sourceNodeId) ? sourceNodeId : null,
      status: "completed",
    });
    return;
  }

  if (type === "loop.continued" || type === "loop.stopped") {
    const sourceNodeId =
      typeof payload.nodeId === "string"
        ? payload.nodeId
        : `role:${runtimeRoleId(payload.roleId)}`;
    const loopId =
      type === "loop.continued"
        ? `loop:${String(payload.nextRoundNumber ?? "next")}`
        : "loop:stopped";
    ensureRuntimeNode({
      sessionId,
      nodeId: loopId,
      roleId: runtimeRoleId(payload.roleId),
      nodeType: type === "loop.continued" ? "observation" : "synthesis",
      title: type === "loop.continued" ? "循环继续" : "循环停止",
      content: typeof payload.reason === "string" ? payload.reason : undefined,
      parentNodeId: hasNode(sourceNodeId) ? sourceNodeId : null,
      status: "completed",
    });
    if (
      type === "loop.continued" &&
      typeof payload.nextRoundNumber === "number"
    ) {
      useBrainstormGraphStore.getState().handleRoundCompleted({
        sessionId,
        roundNumber: payload.nextRoundNumber,
        convergenceScore:
          useBrainstormGraphStore.getState().convergenceScore ?? 0,
      });
    }
    return;
  }

  if (type === "synthesis.completed") {
    const synthesisNodeId =
      typeof payload.synthesisNodeId === "string"
        ? payload.synthesisNodeId
        : typeof payload.nodeId === "string"
          ? payload.nodeId
          : "synthesis";
    const sourceNodeIds = Array.isArray(payload.sourceNodeIds)
      ? payload.sourceNodeIds.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    const parentNodeId = sourceNodeIds.find(nodeId => hasNode(nodeId)) ?? null;

    if (!hasNode(synthesisNodeId)) {
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId,
        nodeId: synthesisNodeId,
        parentNodeId,
        roleId: "decider",
        nodeType: "synthesis",
        status: "completed",
        title: "综合",
        content:
          typeof payload.summary === "string" ? payload.summary : undefined,
      });
    }
    useBrainstormGraphStore.getState().handleNodeUpdated({
      sessionId,
      nodeId: synthesisNodeId,
      status: "completed",
      content:
        typeof payload.summary === "string" ? payload.summary : undefined,
      confidence:
        typeof payload.confidence === "number" ? payload.confidence : undefined,
    });
  }
}

export function dispatchBrainstormGraphEvent(event: {
  type: string;
  payload?: unknown;
}): void {
  const payload = asRecord(event.payload);
  if (isRuntimeGraphEventType(event.type)) {
    dispatchRuntimeGraphEvent(event.type, payload);
    return;
  }
  if (!event.type.startsWith("brainstorm.")) return;

  const store = useBrainstormGraphStore.getState();

  switch (event.type) {
    case "brainstorm.gate.evaluated": {
      const jobId = payload.jobId;
      const stageId = payload.stageId;
      if (typeof jobId !== "string" || typeof stageId !== "string") return;
      const sessionId = `gate:${jobId}:${stageId}`;
      store.handleSessionStarted({
        sessionId,
        mode:
          typeof payload.recommendedMode === "string"
            ? (payload.recommendedMode as CollaborationMode)
            : undefined,
        roles: Array.isArray(payload.requiredRoles)
          ? (payload.requiredRoles as BrainstormRoleId[])
          : undefined,
      });
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId,
        nodeId: sessionId,
        parentNodeId: null,
        roleId: "decider",
        nodeType: "decision",
        status: "completed",
        title: "Decision Gate",
        content:
          typeof payload.reasoning === "string"
            ? payload.reasoning
            : `Brainstorm needed: ${String(payload.brainstormNeeded)}`,
        sequenceNumber: 1,
      });
      break;
    }
    case "brainstorm.session.started": {
      const sessionId = payload.sessionId;
      if (typeof sessionId !== "string") return;
      store.handleSessionStarted({
        sessionId,
        mode:
          typeof payload.mode === "string"
            ? (payload.mode as CollaborationMode)
            : undefined,
        roles: Array.isArray(payload.roles)
          ? (payload.roles as BrainstormRoleId[])
          : undefined,
      });
      break;
    }
    case "brainstorm.session.synthesizing": {
      const sessionId = payload.sessionId;
      if (typeof sessionId === "string") {
        store.handleSessionSynthesizing({ sessionId });
      }
      break;
    }
    case "brainstorm.node.created": {
      const sessionId = payload.sessionId;
      const nodeId = payload.nodeId;
      const roleId = payload.roleId;
      const nodeType = payload.nodeType;
      if (
        typeof sessionId !== "string" ||
        typeof nodeId !== "string" ||
        typeof roleId !== "string" ||
        typeof nodeType !== "string"
      ) {
        return;
      }
      store.handleNodeCreated({
        sessionId,
        nodeId,
        parentNodeId:
          typeof payload.parentNodeId === "string"
            ? payload.parentNodeId
            : null,
        roleId: roleId as BrainstormRoleId,
        nodeType: nodeType as BranchNodeType,
        status:
          typeof payload.status === "string"
            ? (payload.status as BranchNodeStatus)
            : "active",
        title: typeof payload.title === "string" ? payload.title : undefined,
        sequenceNumber:
          typeof payload.sequenceNumber === "number"
            ? payload.sequenceNumber
            : undefined,
      });
      break;
    }
    case "brainstorm.node.updated": {
      const sessionId = payload.sessionId;
      const nodeId = payload.nodeId;
      if (typeof sessionId !== "string" || typeof nodeId !== "string") return;
      store.handleNodeUpdated({
        sessionId,
        nodeId,
        status:
          typeof payload.status === "string"
            ? (payload.status as BranchNodeStatus)
            : undefined,
        content:
          typeof payload.content === "string" ? payload.content : undefined,
        confidence:
          typeof payload.confidence === "number"
            ? payload.confidence
            : undefined,
        tokenUsage:
          typeof payload.tokenUsage === "number"
            ? payload.tokenUsage
            : undefined,
      });
      break;
    }
    case "brainstorm.session.completed": {
      const sessionId = payload.sessionId;
      if (typeof sessionId === "string") {
        store.handleSessionCompleted({
          sessionId,
          tokenUsed:
            typeof payload.tokenUsed === "number"
              ? payload.tokenUsed
              : undefined,
        });
      }
      break;
    }
    case "brainstorm.session.failed": {
      const sessionId = payload.sessionId;
      if (typeof sessionId === "string") {
        store.handleSessionFailed({ sessionId });
      }
      break;
    }
    case "brainstorm.round.completed": {
      const sessionId = payload.sessionId;
      const roundNumber = payload.roundNumber;
      const convergenceScore = payload.convergenceScore;
      if (
        typeof sessionId !== "string" ||
        typeof roundNumber !== "number" ||
        typeof convergenceScore !== "number"
      ) {
        return;
      }
      store.handleRoundCompleted({
        sessionId,
        roundNumber,
        convergenceScore,
      });
      break;
    }
    case "brainstorm.challenge.issued": {
      const sessionId = payload.sessionId;
      const challengerRoleId = payload.challengerRoleId;
      const targetRoleId = payload.targetRoleId;
      // Structured (real-collaboration) path emits the critique text as
      // `critiqueSummary`; the legacy heuristic path uses `challengeSummary`;
      // runtime-graph markers may use `summary`. Read all three so the edge
      // label carries the actual critique content, not an empty/role string.
      const summary =
        typeof payload.summary === "string"
          ? payload.summary
          : typeof payload.challengeSummary === "string"
            ? payload.challengeSummary
            : payload.critiqueSummary;
      const roundNumber = payload.roundNumber;
      if (
        typeof sessionId !== "string" ||
        typeof challengerRoleId !== "string" ||
        typeof targetRoleId !== "string" ||
        typeof summary !== "string" ||
        typeof roundNumber !== "number"
      ) {
        return;
      }
      store.handleChallengeIssued({
        sessionId,
        challengerRoleId: challengerRoleId as BrainstormRoleId,
        targetRoleId: targetRoleId as BrainstormRoleId,
        summary,
        roundNumber,
      });
      break;
    }
    case "brainstorm.rebuttal.issued": {
      const sessionId = payload.sessionId;
      const responderRoleId = payload.responderRoleId;
      const challengerRoleId = payload.challengerRoleId;
      const summary =
        typeof payload.summary === "string"
          ? payload.summary
          : payload.rebuttalSummary;
      const roundNumber = payload.roundNumber;
      if (
        typeof sessionId !== "string" ||
        typeof responderRoleId !== "string" ||
        typeof challengerRoleId !== "string" ||
        typeof summary !== "string" ||
        typeof roundNumber !== "number"
      ) {
        return;
      }
      store.handleChallengeIssued({
        sessionId,
        challengerRoleId: responderRoleId as BrainstormRoleId,
        targetRoleId: challengerRoleId as BrainstormRoleId,
        summary,
        roundNumber,
        kind: "support",
      });
      break;
    }
    case "brainstorm.vote.completed": {
      const sessionId = payload.sessionId;
      const winningOption = payload.winningOption;
      const margin = payload.margin;
      const isNarrow = payload.isNarrow;
      if (
        typeof sessionId !== "string" ||
        typeof winningOption !== "string" ||
        typeof margin !== "number" ||
        typeof isNarrow !== "boolean"
      ) {
        return;
      }
      store.handleVoteCompleted({
        sessionId,
        winningOption,
        margin,
        isNarrow,
        minority: Array.isArray(payload.minority)
          ? payload.minority.filter(
              (item): item is string => typeof item === "string"
            )
          : undefined,
      });
      break;
    }
  }
}
