/**
 * @description Session → BrainstormReasoningGraph projection (Effect/Reasoning Flow path).
 *
 * Maps a runtime `BrainstormSession` into the shared `BrainstormReasoningGraph`
 * contract for the main blueprint wall reasoning texture / console / rail
 * (Effect Flow and SPEC reasoning views).
 *
 * IMPORTANT BOUNDARY: This projection MUST NOT emit first-class debate protocol
 * nodes (type "critique" / "rebuttal") or their direct edges into the output
 * graph. Those belong exclusively to the realtime multi-agent debate path:
 *   - brainstorm.* socket events
 *   - BrainstormGraphStore (with ChallengeEdge + VoteOutcome)
 *   - BrainstormWallGraphConnected + deliberation overlay (for the dedicated
 *     3D layered debate DAG wall with "质疑"/"反驳"/"针对" cards and stances).
 *
 * The Effect/Reasoning deriver on the client will strip any that leak in, but
 * the producer is responsible for the clean boundary.
 *
 * Hard guarantees (pure function, no IO, never throws):
 *  - The output ALWAYS satisfies the wall renderability invariant...
 *  - ...
 *
 * @see .kiro/specs/autopilot-brainstorm-companion-runtime/design.md §3
 * Requirements: 3.1, 3.2, 3.4, 3.5
 */

import type {
  BranchNode,
  BranchNodeStatus,
  BranchNodeType,
  BrainstormRoleId,
  BrainstormSession,
} from "../../../../shared/blueprint/brainstorm-contracts";
import type {
  BrainstormGraphConsoleLine,
  BrainstormGraphConsoleLineKind,
  BrainstormGraphTelemetry,
  BrainstormReasoningEdge,
  BrainstormReasoningEdgeType,
  BrainstormReasoningGraph,
  BrainstormReasoningNode,
  BrainstormReasoningNodeStatus,
  BrainstormReasoningNodeType,
} from "../../../../shared/blueprint/brainstorm-reasoning-graph";

import { getBrainstormRole } from "./role-registry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable id for the always-present central question node. */
export const CENTRAL_QUESTION_NODE_ID = "central-question";

const CENTRAL_QUESTION_FALLBACK_TITLE = "Current brainstorm question";

/** Cap on console lines emitted so the wall console stays readable. */
const MAX_CONSOLE_LINES = 8;

/** BranchNode.type → reasoning node type. */
const NODE_TYPE_MAP: Record<BranchNodeType, BrainstormReasoningNodeType> = {
  thinking: "hypothesis",
  observation: "evidence",
  action: "constraint",
  synthesis: "synthesis",
  decision: "decision",
  error: "gap",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Project a brainstorm session into a wall-renderable reasoning graph.
 *
 * @param session             the runtime brainstorm session.
 * @param centralQuestionTitle the stage question driving the debate; falls back
 *                             to a generic title when empty.
 */
export function projectSessionToReasoningGraph(
  session: BrainstormSession,
  centralQuestionTitle: string,
): BrainstormReasoningGraph {
  const centralTitle = nonEmpty(centralQuestionTitle) ?? CENTRAL_QUESTION_FALLBACK_TITLE;

  const centralNode: BrainstormReasoningNode = {
    id: CENTRAL_QUESTION_NODE_ID,
    type: "question",
    title: centralTitle,
    status: "open",
    order: 0,
  };

  const nodes: BrainstormReasoningNode[] = [centralNode];
  const usedIds = new Set<string>([CENTRAL_QUESTION_NODE_ID]);

  // branchNode.id (as authored) → the graph node id actually used.
  const branchIdToNodeId = new Map<string, string>();
  // roleId → a representative graph node id for that role (last one wins).
  const roleToNodeId = new Map<BrainstormRoleId, string>();
  const firstRoleNodeIds = new Map<BrainstormRoleId, string>();
  // graph node id → its reasoning type (for semantic edge typing).
  const nodeTypeById = new Map<string, BrainstormReasoningNodeType>();

  const mapped: Array<{ branch: BranchNode; node: BrainstormReasoningNode }> = [];

  const branchNodes = Array.isArray(session.branchNodes) ? session.branchNodes : [];
  branchNodes.forEach((branch, index) => {
    const type = NODE_TYPE_MAP[branch.type] ?? "hypothesis";

    let nodeId = nonEmpty(branch.id) ?? `branch-node-${index}`;
    if (usedIds.has(nodeId)) {
      nodeId = `${nodeId}-${index}`;
    }
    usedIds.add(nodeId);

    const roleDef = getBrainstormRole(branch.roleId);
    const node: BrainstormReasoningNode = {
      id: nodeId,
      type,
      title: nonEmpty(branch.title) ?? nonEmpty(branch.content) ?? defaultTitleForType(type),
      body: nonEmpty(branch.content),
      roleId: branch.roleId,
      roleLabel: roleDef?.nameZh ?? roleDef?.name ?? branch.roleId,
      status: mapStatus(branch.status, type),
      confidence:
        typeof branch.confidence === "number" && Number.isFinite(branch.confidence)
          ? branch.confidence
          : undefined,
      order: index + 1,
    };

    nodes.push(node);
    nodeTypeById.set(nodeId, type);
    // Authored branch id → node id (used to resolve preserved session edges).
    branchIdToNodeId.set(branch.id, nodeId);
    if (!firstRoleNodeIds.has(branch.roleId)) {
      firstRoleNodeIds.set(branch.roleId, nodeId);
    }
    roleToNodeId.set(branch.roleId, nodeId);
    mapped.push({ branch, node });
  });

  // -------------------------------------------------------------------------
  // Edges
  // -------------------------------------------------------------------------

  const edges: BrainstormReasoningEdge[] = [];
  const edgeKeys = new Set<string>();
  let edgeSeq = 0;

  const pushEdge = (
    source: string,
    target: string,
    type: BrainstormReasoningEdgeType,
    label?: string,
  ): void => {
    const key = `${source}->${target}:${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: `bs-edge-${edgeSeq++}`,
      source,
      target,
      type,
      label,
      sourceKind: "runtime",
    });
  };

  // 1. Central question → first-level role nodes (parentNodeId === null).
  for (const { branch, node } of mapped) {
    if (branch.parentNodeId === null || branch.parentNodeId === undefined) {
      pushEdge(CENTRAL_QUESTION_NODE_ID, node.id, "questions", "提问");
    }
  }
  for (const nodeId of firstRoleNodeIds.values()) {
    pushEdge(CENTRAL_QUESTION_NODE_ID, nodeId, "questions", "提问");
  }

  // 2. Preserve session.edges, typed by the target node's reasoning type.
  const sessionEdges = Array.isArray(session.edges) ? session.edges : [];
  for (const edge of sessionEdges) {
    const source = branchIdToNodeId.get(edge.sourceNodeId);
    const target = branchIdToNodeId.get(edge.targetNodeId);
    if (!source || !target) continue;
    const targetType = nodeTypeById.get(target) ?? "hypothesis";
    pushEdge(source, target, edgeTypeForTargetType(targetType), edgeLabelForType(targetType));
  }

  // 3+4. Deliberation (challenges/rebuttals) is deliberately ignored for node/edge
  // production in *this* projection. The output `BrainstormReasoningGraph` is
  // consumed by Effect/Reasoning Flow paths (wall texture, console, rail).
  // Rich debate protocol lives exclusively on the realtime store + dedicated
  // BrainstormWallGraph + challengeEdges overlay.
  void session.deliberationSummary?.challenges;
  void session.deliberationSummary?.rebuttals;

  // 5. Synthesis nodes aggregate terminal (non-synthesis) nodes via synthesizes edges.
  const synthesisNodeIds = mapped
    .filter(({ node }) => node.type === "synthesis")
    .map(({ node }) => node.id);
  if (synthesisNodeIds.length > 0) {
    const terminalNodeIds = mapped
      .filter(({ node }) => node.type !== "synthesis")
      .map(({ node }) => node.id);
    for (const synthId of synthesisNodeIds) {
      for (const termId of terminalNodeIds) {
        if (termId !== synthId) {
          pushEdge(termId, synthId, "synthesizes", "综合");
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dangling-edge guard (renderability invariant)
  // -------------------------------------------------------------------------

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const safeEdges = edges.filter(
    (edge) => Boolean(edge.id) && nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target),
  );

  // -------------------------------------------------------------------------
  // Telemetry + console lines
  // -------------------------------------------------------------------------

  const telemetry: BrainstormGraphTelemetry = {
    tokenBurn: finiteOrNull(session.tokenUsed),
    sourceCount: branchNodes.length,
    remainingBudget: computeRemainingBudget(session),
    elapsedMs: computeElapsedMs(session.startedAt, session.completedAt),
    activeRoleCount: session.crewMembers instanceof Map ? session.crewMembers.size : 0,
  };

  const consoleLines = buildConsoleLines(centralTitle, mapped);

  const sessionIdPart = nonEmpty(session.id);
  const graphId = sessionIdPart
    ? `brainstorm-reasoning-${sessionIdPart}`
    : "brainstorm-reasoning";
  const jobId = nonEmpty(session.jobId) ?? sessionIdPart ?? "brainstorm-job";

  const createdAt = toIsoOrUndefined(session.startedAt);
  const updatedAt = toIsoOrUndefined(session.completedAt) ?? createdAt;
  const stage = nonEmpty(session.stageId) ?? "spec_documents";

  return {
    id: graphId,
    jobId,
    stage,
    subStage: stage,
    centralQuestion: {
      id: CENTRAL_QUESTION_NODE_ID,
      title: centralTitle,
    },
    nodes,
    edges: safeEdges,
    telemetry,
    consoleLines,
    source: "runtime",
    createdAt,
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function mapStatus(
  status: BranchNodeStatus,
  type: BrainstormReasoningNodeType,
): BrainstormReasoningNodeStatus {
  switch (status) {
    case "failed":
      return "failed";
    case "active":
      return "active";
    case "pending":
      return "open";
    case "completed":
      return type === "evidence" ? "supported" : "resolved";
    default:
      return "active";
  }
}

function edgeTypeForTargetType(
  type: BrainstormReasoningNodeType,
): BrainstormReasoningEdgeType {
  switch (type) {
    case "synthesis":
      return "synthesizes";
    case "evidence":
      return "cites";
    case "constraint":
      return "depends_on";
    default:
      return "refines";
  }
}

function edgeLabelForType(type: BrainstormReasoningNodeType): string {
  // 产品推演平台默认边标签（而非法律证据场景）
  switch (type) {
    case "synthesis":
      return "收敛";
    case "evidence":
      return "支撑";
    case "constraint":
      return "约束";
    default:
      return "细化";
  }
}

function defaultTitleForType(type: BrainstormReasoningNodeType): string {
  // 产品推演平台英文 fallback 标题
  switch (type) {
    case "hypothesis":
      return "Assumption";
    case "evidence":
      return "Insight";
    case "constraint":
      return "Constraint";
    case "synthesis":
      return "Convergence";
    case "decision":
      return "Decision";
    case "gap":
      return "Gap";
    default:
      return "Reasoning Node";
  }
}

function buildConsoleLines(
  centralTitle: string,
  mapped: Array<{ branch: BranchNode; node: BrainstormReasoningNode }>,
): BrainstormGraphConsoleLine[] {
  const lines: BrainstormGraphConsoleLine[] = [
    { id: "console-central", kind: "Ask", text: centralTitle },
  ];

  for (const { branch, node } of mapped) {
    lines.push({
      id: `console-${node.id}`,
      kind: consoleKindForBranchType(branch.type),
      text: nonEmpty(branch.content) ?? node.title,
      roleId: branch.roleId,
      timestamp: nonEmpty(branch.updatedAt),
    });
  }

  if (lines.length <= MAX_CONSOLE_LINES) return lines;
  // Keep the central Ask line plus the most recent derived lines.
  const recent = lines.slice(1).slice(-(MAX_CONSOLE_LINES - 1));
  return [lines[0], ...recent];
}

function consoleKindForBranchType(type: BranchNodeType): BrainstormGraphConsoleLineKind {
  switch (type) {
    case "thinking":
      return "Thinking";
    case "observation":
      return "Observation";
    case "action":
      return "Tool";
    case "decision":
    case "synthesis":
      return "Report";
    case "error":
      return "System";
    default:
      return "System";
  }
}

function computeRemainingBudget(session: BrainstormSession): number | null {
  const budget = session.tokenBudget;
  const used = session.tokenUsed;
  if (typeof budget !== "number" || !Number.isFinite(budget)) return null;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  return budget - used;
}

function computeElapsedMs(start: unknown, end: unknown): number | null {
  const startMs = toEpochMs(start);
  if (startMs === null) return null;
  const endMs = toEpochMs(end);
  if (endMs === null) return null;
  const delta = endMs - startMs;
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function toIsoOrUndefined(value: unknown): string | undefined {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isFinite(ms)) return value.toISOString();
  }
  return undefined;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
