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
import { getPropositionRootNode } from "@/lib/sliderule-runtime";
import {
  projectSessionGraphForDisplay,
  roleIdToDisplayLabel,
} from "@shared/blueprint/sliderule-graph-projection";
import { eventsByRun, foldEventsForOverview } from "@shared/blueprint/sliderule-reasoning-events.js"; // V5.3 P4
import { expandReasoningChain } from "./expand-projection-nodes.js"; // V5.3 P4
import { CAPABILITY_PROCESS_LABELS } from "@shared/blueprint/capability-process-labels";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";
import { expandProjectionNodes } from "./expand-projection-nodes";
import { deriveTerminalProjection, type TerminalNodeMeta } from "./derive-terminal-node";
import type { UiTurn } from "./types";
import type { ProjectionDensity } from "./sliderule-projection-constants";

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
  density?: ProjectionDensity;
  latestUiTurn?: UiTurn | null;
  lineageHighlightIds?: string[];
  /** V5.3 #4: overview(turn 视图) | collaboration(默认展开多角色立场+质疑边) | reasoning(思考链子步)。 */
  viewMode?: "overview" | "collaboration" | "reasoning";
};

export type SlideRuleReasoningViewModel = BlueprintWallReasoningGraphViewModel & {
  terminalNode: BrainstormReasoningNode | null;
  terminalMeta: TerminalNodeMeta | null;
  density: ProjectionDensity;
  lineageHighlightIds: string[];
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

  // R2.5 多角色面板：把面板真实参与角色计入「角色 N」（密度无关 —— 直接读产物 payload）。
  // Supports both critique direct shape and synthesis { panel: { positions, ... } } shape.
  const panelRoles = new Set<string>();
  for (const a of state.artifacts || []) {
    const raw = (a as any).payload || {};
    let positions = Array.isArray(raw?.positions) ? raw.positions : null;
    if (!positions && raw?.panel && typeof raw.panel === "object") {
      positions = Array.isArray(raw.panel.positions) ? raw.panel.positions : null;
    }
    if (positions) {
      for (const p of positions) {
        const r = String(p?.v5Role || p?.roleId || "").trim();
        if (r) panelRoles.add(r);
      }
    }
  }

  return {
    tokenBurn: tokenBurn > 0 ? tokenBurn : null,
    sourceCount: grounded.length > 0 ? grounded.length : trustedArtifacts.length || null,
    remainingBudget: blockingOpen > 0 ? blockingOpen : openGaps || null,
    elapsedMs,
    activeRoleCount:
      Math.max(activeRoles.size, runRoles.size, panelRoles.size) ||
      (runs.length > 0 ? Math.min(6, runs.length) : null),
  };
}

function emptySlideRuleViewModel(): SlideRuleReasoningViewModel {
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
    terminalNode: null,
    terminalMeta: null,
    density: "compact",
    lineageHighlightIds: [],
  };
}

export function deriveSlideRuleReasoningViewModel(
  state: V5SessionState,
  options: DeriveReasoningViewModelOptions = {}
): SlideRuleReasoningViewModel {
  const density = options.density ?? "compact";
  const lineageHighlightIds = options.lineageHighlightIds ?? [];
  // V5.3 P3.4: viewMode for overview | collaboration (default expand panel + challenges) | reasoning (P4)
  const viewMode = (options as any).viewMode ?? "overview";

  // K6.5: 简模式回跳静默失效修复 - 当 lineage 高亮 ::ev- (ReportReader 证据回跳) 时自动切详模式
  // 避免在 compact 下点击报告证据后子节点不可见
  let effectiveDensity = density;
  if (density === "compact" && lineageHighlightIds.some((id) => id.includes("::ev-"))) {
    effectiveDensity = "detailed";
  }

  const graph = state.graph;
  if (!graph?.nodes?.length) {
    return emptySlideRuleViewModel();
  }

  const root = getPropositionRootNode(state);
  const { nodes: projectedNodes, edges: projectedEdges } = projectSessionGraphForDisplay(
    state,
    root?.id
  );

  const visibleNodes: BrainstormReasoningNode[] = projectedNodes.map((n) => {
    const enriched = enrichNodeStatus(state, n as any);
    const isRoot = n.id === root?.id;
    const kind = conclusionKindLabel({ ...n, status: enriched }, isRoot);
    const conclusionBadge = /结论明确|结论待完善|用户命题|信息缺失/.test(kind)
      ? kind
      : undefined;
    return {
      ...n,
      status: enriched,
      roleLabel: roleIdToDisplayLabel(n.roleId) || n.roleLabel,
      conclusionBadge,
    };
  });

  let visibleEdges: BrainstormReasoningEdge[] = projectedEdges;

  // V5.3 P3/P4: collaboration / reasoning 模式需要展开子节点(角色立场/思考链),
  // 不受简/详密度影响 —— 否则 compact 下 expandProjectionNodes 直接返回 base,panel 角色节点永不出现。
  const expansionDensity: ProjectionDensity =
    viewMode === "collaboration" || viewMode === "reasoning" ? "detailed" : effectiveDensity;
  const expanded = expandProjectionNodes(
    state,
    visibleNodes,
    visibleEdges,
    expansionDensity,
    options.latestUiTurn
  );
  let finalNodes = expanded.nodes;
  let finalEdges = expanded.edges;

  // V5.3 P4: reasoning chain + overview badges based on viewMode
  if (viewMode === "reasoning") {
    const byRun = eventsByRun(state);
    finalNodes = finalNodes.map((n: any) => {
      const runId = n.capabilityRunId || (n as any).producedBy?.capabilityRunId;
      if (!runId) return n;
      const evs = byRun.get(runId) || [];
      const extra = expandReasoningChain(n, evs as any);
      return {
        ...n,
        // attach for surface if needed
        ...(extra.nodes.length ? { _reasoningSubsteps: extra.nodes } : {}),
      };
    });
    // also append the sub nodes and edges for visibility (surface will render if present)
    const allExtraNodes: any[] = [];
    const allExtraEdges: any[] = [];
    finalNodes.forEach((n: any) => {
      const runId = n.capabilityRunId || (n as any).producedBy?.capabilityRunId;
      if (runId) {
        const evs = byRun.get(runId) || [];
        const extra = expandReasoningChain(n, evs as any);
        allExtraNodes.push(...extra.nodes);
        allExtraEdges.push(...extra.edges);
      }
    });
    finalNodes = [...finalNodes, ...allExtraNodes];
    finalEdges = [...finalEdges, ...allExtraEdges];
  } else if (viewMode === "overview") {
    const byRun = eventsByRun(state);
    finalNodes = finalNodes.map((n: any) => {
      const runId = n.capabilityRunId || (n as any).producedBy?.capabilityRunId;
      if (!runId) return n;
      const evs = byRun.get(runId) || [];
      const fold = foldEventsForOverview(evs as any);
      const badge = `💭${fold.think}·🔍${fold.observe}·🔧${fold.tool}·👥${fold.role}`.replace(/·0/g, "");
      return {
        ...n,
        overviewBadge: badge || undefined,
      };
    });
  }

  const terminal = deriveTerminalProjection(state);
  if (terminal) {
    finalNodes = [...finalNodes, terminal.node];
    if (terminal.edge) {
      finalEdges = [...finalEdges, terminal.edge];
    }
  }

  const consoleLines = buildRichConsoleLines(state, options.liveAction);
  const telemetry = buildTelemetry(state, finalNodes);

  return {
    graph: {
      ...graph,
      telemetry,
      consoleLines,
    },
    mode: "structured",
    visibleNodes: finalNodes,
    visibleEdges: finalEdges,
    hiddenNodeCount: Math.max(0, (graph.nodes?.length ?? 0) - visibleNodes.length),
    consoleLines,
    telemetry,
    terminalNode: terminal?.node ?? null,
    terminalMeta: terminal?.meta ?? null,
    density: effectiveDensity,
    lineageHighlightIds,
  };
}