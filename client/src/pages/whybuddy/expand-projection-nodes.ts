import type {
  BrainstormReasoningEdge,
  BrainstormReasoningNode,
} from "@shared/blueprint/brainstorm-reasoning-graph";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { UiTurn } from "./types";
import type { ProjectionDensity } from "./whybuddy-projection-constants";

const MAX_EVIDENCE_CHILDREN = 8;
const MAX_TREE_DEPTH = 4;

function isProjectionChildId(id: string): boolean {
  return id.includes("::ev-") || id.includes("::phase-") || id.includes("::tree-");
}

function artifactForNode(
  state: V5SessionState,
  node: BrainstormReasoningNode & {
    producedArtifactId?: string;
    capabilityRunId?: string;
  }
) {
  const id = node.producedArtifactId;
  if (id) {
    return (state.artifacts || []).find((a) => a.id === id);
  }
  const runId = node.capabilityRunId;
  if (!runId) return undefined;
  return (state.artifacts || []).find((a) => a.producedBy?.capabilityRunId === runId);
}

function expandEvidenceChildren(
  state: V5SessionState,
  parent: BrainstormReasoningNode
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const art = artifactForNode(state, parent as any);
  const refs = (art?.evidenceRefs || []).slice(0, MAX_EVIDENCE_CHILDREN);
  const nodes: BrainstormReasoningNode[] = [];
  const edges: BrainstormReasoningEdge[] = [];

  for (const refId of refs) {
    const upstream = (state.artifacts || []).find((a) => a.id === refId);
    const childId = `${parent.id}::ev-${refId}`;
    nodes.push({
      id: childId,
      type: "evidence",
      title: upstream?.title || `来源 ${refId}`,
      body: (upstream?.summary || upstream?.content || "").slice(0, 160),
      status: "resolved",
      roleId: upstream?.producedBy?.roleId || "接地",
      roleLabel: "来源",
      conclusionBadge: "来源",
      producedArtifactId: refId,
      derivedFrom: [parent.id],
    });
    edges.push({
      id: `${parent.id}-ev-${refId}`,
      source: parent.id,
      target: childId,
      type: "cites",
      label: "来源",
    });
  }
  return { nodes, edges };
}

function parseSpecTreeLines(content: string): Array<{ id: string; title: string; depth: number }> {
  const rows: Array<{ id: string; title: string; depth: number }> = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^(\s*)(?:[-*]|\[(\w+)\])\s*(.+)$/);
    if (!m) continue;
    const depth = Math.min(MAX_TREE_DEPTH, Math.floor(m[1].length / 2) + 1);
    const id = m[2] || `line-${rows.length}`;
    rows.push({ id, title: m[3].trim().slice(0, 80), depth });
    if (rows.length >= 12) break;
  }
  return rows;
}

function expandSpecTreeChildren(
  state: V5SessionState,
  parent: BrainstormReasoningNode
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const art = artifactForNode(state, parent as any);
  if (art?.kind !== "spec_tree") return { nodes: [], edges: [] };

  const rows = parseSpecTreeLines(String(art.content || ""));
  const nodes: BrainstormReasoningNode[] = [];
  const edges: BrainstormReasoningEdge[] = [];
  let prevId = parent.id;

  for (const row of rows) {
    const childId = `${parent.id}::tree-${row.id}`;
    nodes.push({
      id: childId,
      type: row.depth <= 1 ? "clarification" : "hypothesis",
      title: row.title,
      body: `SPEC Tree · depth ${row.depth}`,
      status: "resolved",
      roleId: "架构",
      roleLabel: "结构",
      conclusionBadge: "结构",
      derivedFrom: [prevId],
    });
    edges.push({
      id: `${prevId}-tree-${row.id}`,
      source: prevId,
      target: childId,
      type: "refines",
      label: "拆解",
    });
    prevId = childId;
  }
  return { nodes, edges };
}

function rebuildPhaseChild(
  parent: BrainstormReasoningNode,
  kind: "thinking" | "observing" | "completed",
  label: string
): BrainstormReasoningNode {
  return {
    id: `${parent.id}::phase-${kind}`,
    type: "clarification",
    title: label,
    body: `${parent.title || parent.id} · ${label}`,
    status: "resolved",
    roleId: parent.roleId,
    roleLabel: parent.roleLabel,
    conclusionBadge: label,
    derivedFrom: [parent.id],
  };
}

/** Knife B: expand main projection nodes with evidence/tree/phase children (DERIVE only). */
export function expandProjectionNodes(
  state: V5SessionState,
  baseNodes: BrainstormReasoningNode[],
  baseEdges: BrainstormReasoningEdge[],
  density: ProjectionDensity,
  latestUiTurn?: UiTurn | null
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  if (density === "compact") {
    return { nodes: baseNodes, edges: baseEdges };
  }

  const extraNodes: BrainstormReasoningNode[] = [];
  const extraEdges: BrainstormReasoningEdge[] = [];

  const mains = baseNodes.filter((n) => !isProjectionChildId(n.id));

  for (const parent of mains) {
    if (parent.type === "question") continue;

    const { nodes: evNodes, edges: evEdges } = expandEvidenceChildren(state, parent);
    extraNodes.push(...evNodes);
    extraEdges.push(...evEdges);

    const { nodes: treeNodes, edges: treeEdges } = expandSpecTreeChildren(state, parent);
    extraNodes.push(...treeNodes);
    extraEdges.push(...treeEdges);

    const capId = parent.capabilityId;
    if (capId && parent.status === "resolved") {
      for (const kind of ["thinking", "observing", "completed"] as const) {
        const label =
          kind === "thinking" ? "思考" : kind === "observing" ? "观察" : "完成";
        const child = rebuildPhaseChild(parent, kind, label);
        extraNodes.push(child);
        extraEdges.push({
          id: `${parent.id}-phase-${kind}`,
          source: parent.id,
          target: child.id,
          type: "refines",
          label,
        });
      }
    }
  }

  if (latestUiTurn?.steps?.length) {
    for (const step of latestUiTurn.steps) {
      if (step.kind !== "chip" || !step.progressType) continue;
      const runNode = mains.find((n) => n.capabilityId === step.capabilityId);
      if (!runNode) continue;
      const childId = `${runNode.id}::phase-live-${step.progressType}`;
      if (extraNodes.some((n) => n.id === childId)) continue;
      extraNodes.push({
        id: childId,
        type: "clarification",
        title: step.label,
        body: step.label,
        status: step.progressType === "failed" ? "failed" : "active",
        roleId: step.roleId,
        conclusionBadge: step.progressType,
        derivedFrom: [runNode.id],
      });
      extraEdges.push({
        id: `${runNode.id}-live-${step.id}`,
        source: runNode.id,
        target: childId,
        type: "refines",
        label: "进行中",
      });
    }
  }

  return {
    nodes: [...baseNodes, ...extraNodes],
    edges: [...baseEdges, ...extraEdges],
  };
}