import type {
  BrainstormGraphConsoleLine,
  BrainstormGraphConsoleLineKind,
  BrainstormGraphTelemetry,
  BrainstormReasoningEdge,
  BrainstormReasoningNode,
  BrainstormReasoningNodeStatus,
} from "@shared/blueprint/brainstorm-reasoning-graph";
import type { BlueprintWallReasoningGraphViewModel } from "@/components/three/scene-fusion/blueprint-wall-reasoning-graph";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { getPropositionRootNode } from "@/lib/whybuddy-runtime";
import { projectSessionGraphForDisplay } from "@shared/blueprint/whybuddy-graph-projection";
import { CAPABILITY_PROCESS_LABELS } from "@shared/blueprint/capability-process-labels";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";

function artifactForNode(
  state: V5SessionState,
  node: BrainstormReasoningNode & { producedArtifactId?: string }
) {
  const id = node.producedArtifactId;
  if (!id) return undefined;
  return (state.artifacts || []).find((a) => a.id === id);
}

/** Map graph node + artifact trust → wall-style conclusion status. */
function enrichNodeStatus(
  state: V5SessionState,
  node: BrainstormReasoningNode & { producedArtifactId?: string }
): BrainstormReasoningNodeStatus {
  if (node.type === "question") return node.status ?? "active";
  const stale = new Set(state.staleArtifactIds || []);
  const art = artifactForNode(state, node);
  if (!art) {
    if (node.status === "challenged") return "challenged";
    if (node.status === "resolved" || node.status === "supported") return node.status;
    return node.status ?? "active";
  }
  if (stale.has(art.id) || art.trustLevel === "untrusted") return "challenged";
  if (art.trustLevel === "gated_pass" || art.trustLevel === "audited") return "resolved";
  return node.status ?? "active";
}

export function conclusionKindLabel(
  node: BrainstormReasoningNode,
  isPropositionRoot = false
): string {
  if (isPropositionRoot || (node.type === "question" && node.id.endsWith("-proposition"))) {
    return "用户命题";
  }
  const id = String(node.id || "");
  if (/-scaffold-(clarify|hypo-alt|hypo|evidence|risk|gap|synthesis|scope)$/.test(id)) {
    if (node.type === "clarification" || id.includes("clarify")) return "澄清中";
    if (node.type === "hypothesis") return "假设待验";
    if (node.type === "evidence") return "待检索";
    if (node.type === "risk") return "待扫描";
    if (node.type === "gap") return "待补缺口";
    if (node.type === "synthesis") return "待收敛";
    return "管道占位";
  }
  if (node.status === "resolved" || node.status === "supported") return "结论明确";
  if (node.status === "failed") return "信息缺失";
  if (node.status === "challenged") return "结论待完善";
  if (node.status === "open" || node.status === "active") return "推演中";
  return "结论待完善";
}

function consoleKindForCapability(capId: string): BrainstormGraphConsoleLineKind {
  if (capId === "evidence.search" || capId === "repo.inspect" || capId === "mcp.call")
    return "Tool";
  if (capId === "report.write" || capId === "document.draft") return "Report";
  if (capId === "intent.clarify" || capId === "gap.ask" || capId === "intent.parse") return "Ask";
  return "Thinking";
}

function consoleKindFromConversation(text: string): BrainstormGraphConsoleLineKind {
  if (/\[G-GROUND\]/i.test(text)) return "System";
  if (/\[GCOV\]/i.test(text)) return "System";
  if (/\[BUDGET\]/i.test(text)) return "System";
  if (/evidence|github|来源|检索/i.test(text)) return "Tool";
  if (/报告|report|收敛|可行性/i.test(text)) return "Report";
  return "System";
}

function buildRichConsoleLines(
  state: V5SessionState,
  liveAction?: LiveAction | null
): BrainstormGraphConsoleLine[] {
  const lines: BrainstormGraphConsoleLine[] = [];

  if (liveAction?.label) {
    lines.push({
      id: "live-action",
      kind: liveAction.external ? "Tool" : "Thinking",
      text: liveAction.label,
    });
  }

  for (const d of (state.decisionLedger || []).slice(-8)) {
    const chose = (d.chose || []).filter(Boolean).join("、") || "无";
    const rationale = String(d.rationale || "").slice(0, 120);
    lines.push({
      id: `dledger-${d.id}`,
      kind: "Thinking",
      text: rationale ? `调度 ${chose} — ${rationale}` : `调度 ${chose}`,
    });
  }

  const artifactByRun = new Map(
    (state.artifacts || [])
      .filter((a) => a.producedBy?.capabilityRunId)
      .map((a) => [a.producedBy!.capabilityRunId!, a])
  );

  for (const run of state.capabilityRuns || []) {
    const cap = String(run.capabilityId || "");
    const art = artifactByRun.get(run.id);
    const entry = CAPABILITY_PROCESS_LABELS[cap as V5CapabilityId];
    const live =
      typeof entry?.liveLabel === "function"
        ? entry.liveLabel({})
        : entry?.liveLabel || cap;
    const text = art?.title || art?.content?.split("\n")[0]?.slice(0, 100) || String(live);
    lines.push({
      id: `run-${run.id}`,
      kind: consoleKindForCapability(cap),
      text,
      roleId: (run as { roleId?: string }).roleId || art?.producedBy?.roleId,
    });
  }

  for (const c of state.conversation || []) {
    const text = String(c.text || "");
    if (!text.trim()) continue;
    if (c.role === "user") continue;
    lines.push({
      id: c.id || `conv-${lines.length}`,
      kind: consoleKindFromConversation(text),
      text: text.slice(0, 160),
      roleId: c.role,
    });
  }

  return lines.slice(-14);
}

export type DeriveReasoningViewModelOptions = {
  liveAction?: LiveAction | null;
};

function buildTelemetry(state: V5SessionState, visibleNodes: BrainstormReasoningNode[]): BrainstormGraphTelemetry {
  const stale = new Set(state.staleArtifactIds || []);
  const trustedArtifacts = (state.artifacts || []).filter(
    (a) =>
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") && !stale.has(a.id)
  );
  const grounded = trustedArtifacts.filter(
    (a) =>
      a.kind === "evidence" ||
      String(a.provenance || "").includes("mcp") ||
      String(a.provenance || "").includes("github")
  );

  const openGaps = (state.coverageGaps || []).filter((g) => g.status === "open").length;
  const blockingOpen = (state.coverageContract as { blockingGapIds?: string[] } | undefined)
    ?.blockingGapIds?.length
    ? (state.coverageGaps || []).filter(
        (g) =>
          g.status === "open" &&
          (state.coverageContract as any).blockingGapIds?.includes(g.id)
      ).length
    : openGaps;

  const tokenBurn =
    (state.costLedger || []).reduce(
      (sum, e) => sum + (e.estimatedTokens ?? 0),
      0
    ) || (state.capabilityRuns || []).length * 420;

  const runs = state.capabilityRuns || [];
  const elapsedMs = runs.length > 0 ? runs.length * 950 : null;

  const activeRoles = new Set(
    visibleNodes
      .filter((n) => n.status === "active" || n.status === "open")
      .map((n) => n.roleId)
      .filter(Boolean)
  );
  const runRoles = new Set(
    runs
      .slice(-8)
      .map((r) => (r as { roleId?: string }).roleId || (r as any).producedBy?.roleId)
      .filter(Boolean)
  );

  return {
    tokenBurn: tokenBurn > 0 ? tokenBurn : null,
    sourceCount: grounded.length > 0 ? grounded.length : trustedArtifacts.length || null,
    remainingBudget: blockingOpen > 0 ? blockingOpen : openGaps || null,
    elapsedMs,
    activeRoleCount:
      Math.max(activeRoles.size, runRoles.size) ||
      (runs.length > 0 ? Math.min(6, runs.length) : null),
  };
}

export function deriveWhyBuddyReasoningViewModel(
  state: V5SessionState,
  options: DeriveReasoningViewModelOptions = {}
): BlueprintWallReasoningGraphViewModel {
  const graph = state.graph;
  if (!graph?.nodes?.length) {
    return {
      graph: null,
      mode: "empty",
      emptyReason: "no-reasoning-data",
      visibleNodes: [],
      visibleEdges: [],
      hiddenNodeCount: 0,
      consoleLines: [],
      telemetry: {
        tokenBurn: null,
        sourceCount: null,
        elapsedMs: null,
        remainingBudget: null,
        activeRoleCount: null,
      },
    };
  }

  const root = getPropositionRootNode(state);
  const { nodes: projectedNodes, edges: projectedEdges } = projectSessionGraphForDisplay(
    state,
    root?.id
  );

  const visibleNodes: BrainstormReasoningNode[] = projectedNodes.map((n) => {
    const enriched = enrichNodeStatus(state, n as any);
    const isRoot = n.id === root?.id;
    return {
      ...n,
      status: enriched,
      roleLabel: conclusionKindLabel({ ...n, status: enriched }, isRoot),
    };
  });

  const visibleEdges: BrainstormReasoningEdge[] = projectedEdges;

  const consoleLines = buildRichConsoleLines(state, options.liveAction);
  const telemetry = buildTelemetry(state, visibleNodes);

  return {
    graph: {
      ...graph,
      telemetry,
      consoleLines,
    },
    mode: "structured",
    visibleNodes,
    visibleEdges,
    hiddenNodeCount: Math.max(0, (graph.nodes?.length ?? 0) - visibleNodes.length),
    consoleLines,
    telemetry,
  };
}