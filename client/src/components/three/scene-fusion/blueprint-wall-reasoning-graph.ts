import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
  V5CapabilityId,
} from "@shared/blueprint/contracts";
import { STAGE_TO_V5_CAPABILITIES } from "@shared/blueprint/contracts";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BrainstormGraphConsoleLine,
  BrainstormGraphTelemetry,
  BrainstormReasoningEdge,
  BrainstormReasoningGraph,
  BrainstormReasoningNode,
  BrainstormReasoningNodeStatus,
  BrainstormReasoningNodeType,
} from "@shared/blueprint";

type ActiveReasoningStage = "spec_tree" | "spec_documents" | "effect_preview" | string;

type ReasoningEntryWithRole = AgentReasoningEntry & {
  roleId?: string;
  roleLabel?: string;
};

export interface DeriveBlueprintWallReasoningGraphInput {
  job: BlueprintGenerationJob | null | undefined;
  activeSubStage?: ActiveReasoningStage;
  structuredGraphs?: BrainstormReasoningGraph[];
  agentReasoningEntries?: AgentReasoningEntry[];
  roleLabels?: Record<string, string>;
  specTree?: BlueprintSpecTree | null;
  selectedSpecNodeId?: string | null;
  maxVisibleNodes?: number;
  maxConsoleLines?: number;
}

export interface BlueprintWallReasoningGraphViewModel {
  graph: BrainstormReasoningGraph | null;
  mode: "structured" | "fallback" | "empty";
  emptyReason?: "no-job" | "no-stage-data" | "no-reasoning-data";
  visibleNodes: BrainstormReasoningNode[];
  visibleEdges: BrainstormReasoningEdge[];
  hiddenNodeCount: number;
  consoleLines: BrainstormGraphConsoleLine[];
  telemetry: BrainstormGraphTelemetry;
}

const DEFAULT_MAX_VISIBLE_NODES = 16;
const DEFAULT_MAX_CONSOLE_LINES = 6;

const NODE_TYPE_PRIORITY: Partial<Record<BrainstormReasoningNodeType, number>> = {
  question: 0,
  clarification: 1,
  constraint: 2,
  hypothesis: 3,
  evidence: 4,
  risk: 5,
  gap: 6,
  decision: 7,
  synthesis: 8,
  // NOTE: critique/rebuttal deliberately omitted here.
  // Effect/Reasoning Flow deriver MUST reject debate protocol nodes (see stripDebateProtocolNodes).
  // They belong exclusively to the realtime brainstorm debate store + overlays.
};

const FALLBACK_EMPTY_TELEMETRY: BrainstormGraphTelemetry = {
  tokenBurn: null,
  sourceCount: null,
  elapsedMs: null,
  remainingBudget: null,
  activeRoleCount: null,
};

/** Debate protocol node types belong only to the realtime brainstorm debate path.
 * Effect/Reasoning Flow (this deriver) must refuse them so they never bleed into
 * the main wall process/reasoning texture or its console/rail views.
 */
const DEBATE_PROTOCOL_NODE_TYPES = new Set<BrainstormReasoningNodeType>([
  "critique",
  "rebuttal",
]);

function isDebateProtocolNode(node: BrainstormReasoningNode): boolean {
  return DEBATE_PROTOCOL_NODE_TYPES.has(node.type);
}

export function stripDebateProtocolNodes(
  graph: BrainstormReasoningGraph
): BrainstormReasoningGraph {
  const debateNodeIds = new Set(
    graph.nodes.filter(isDebateProtocolNode).map((n) => n.id)
  );
  if (debateNodeIds.size === 0) return graph;

  const keptNodes = graph.nodes.filter((n) => !debateNodeIds.has(n.id));
  const keptEdges = graph.edges.filter(
    (e) => !debateNodeIds.has(e.source) && !debateNodeIds.has(e.target)
  );

  // When we had to strip debate protocol nodes, also drop any consoleLines that
  // came with the debate graph. Effect/Reasoning Flow must not consume
  // brainstorm_reasoning_graph.consoleLines (or debate-sourced lines) in its
  // main wall texture / console / rail views.
  return {
    ...graph,
    nodes: keptNodes,
    edges: keptEdges,
    consoleLines: [],
    // telemetry left as-is (aggregate numbers are usually harmless)
  };
}

export function deriveBlueprintWallReasoningGraph(
  input: DeriveBlueprintWallReasoningGraphInput
): BlueprintWallReasoningGraphViewModel {
  const maxVisibleNodes = input.maxVisibleNodes ?? DEFAULT_MAX_VISIBLE_NODES;
  const maxConsoleLines = input.maxConsoleLines ?? DEFAULT_MAX_CONSOLE_LINES;
  const job = input.job;

  if (!job?.id) {
    return emptyView("no-job");
  }

  const rawStructured = pickStructuredGraph(input.structuredGraphs, job.id, input.activeSubStage);
  if (rawStructured !== null) {
    const structured = stripDebateProtocolNodes(rawStructured);
    // Refuse: if after stripping debate protocol nodes there is nothing left for Effect Flow,
    // or if it was purely a debate graph, fall through to fallback/empty for this wall.
    if (structured.nodes.length > 0) {
      return toViewModel(structured, "structured", maxVisibleNodes, maxConsoleLines);
    }
  }

  const entries = filterEntriesForJob(input.agentReasoningEntries ?? [], job.id);
  const fallback = buildFallbackGraph({
    job,
    activeSubStage: input.activeSubStage,
    entries,
    roleLabels: input.roleLabels ?? {},
    specTree: input.specTree ?? null,
    selectedSpecNodeId: input.selectedSpecNodeId ?? null,
    maxConsoleLines,
  });

  if (fallback.nodes.length <= 1) {
    return emptyView("no-reasoning-data");
  }

  return toViewModel(fallback, "fallback", maxVisibleNodes, maxConsoleLines);
}

function emptyView(
  emptyReason: NonNullable<BlueprintWallReasoningGraphViewModel["emptyReason"]>
): BlueprintWallReasoningGraphViewModel {
  return {
    graph: null,
    mode: "empty",
    emptyReason,
    visibleNodes: [],
    visibleEdges: [],
    hiddenNodeCount: 0,
    consoleLines: [],
    telemetry: { ...FALLBACK_EMPTY_TELEMETRY },
  };
}

function pickStructuredGraph(
  graphs: BrainstormReasoningGraph[] | undefined,
  jobId: string,
  activeSubStage: string | undefined
): BrainstormReasoningGraph | null {
  const candidates = (graphs ?? []).filter(graph =>
    graph.jobId === jobId && isGraphRenderable(graph)
  );
  if (candidates.length === 0) return null;
  const activeStageAliases = stageAliases(activeSubStage);
  const stageMatched = activeSubStage
    ? candidates.find(graph =>
        activeStageAliases.has(normalizeReasoningStage(graph.stage)) ||
        activeStageAliases.has(normalizeReasoningStage(graph.subStage))
      )
    : undefined;
  return stageMatched ?? candidates[0] ?? null;
}

function stageAliases(stage: string | undefined): Set<string> {
  const normalized = normalizeReasoningStage(stage);
  if (!normalized) return new Set<string>();
  const aliases = new Set<string>([normalized]);
  if (normalized === "spec_docs") aliases.add("spec_documents");
  if (normalized === "spec_documents") aliases.add("spec_docs");
  return aliases;
}

function normalizeReasoningStage(stage: string | undefined): string {
  return typeof stage === "string" ? stage.trim() : "";
}

function isGraphRenderable(graph: BrainstormReasoningGraph): boolean {
  if (!graph.id || !graph.jobId) return false;
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  if (nodeIds.size === 0) return false;
  return graph.edges.every(edge =>
    Boolean(edge.id) && nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );
}

function toViewModel(
  graph: BrainstormReasoningGraph,
  mode: "structured" | "fallback",
  maxVisibleNodes: number,
  maxConsoleLines: number
): BlueprintWallReasoningGraphViewModel {
  const sortedNodes = [...graph.nodes].sort(compareNodes);
  const visibleNodes = sortedNodes.slice(0, maxVisibleNodes);
  const visibleNodeIds = new Set(visibleNodes.map(node => node.id));
  const visibleEdges = graph.edges.filter(edge =>
    visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );

  return {
    graph,
    mode,
    visibleNodes,
    visibleEdges,
    hiddenNodeCount: Math.max(0, sortedNodes.length - visibleNodes.length),
    consoleLines: (graph.consoleLines ?? []).slice(-maxConsoleLines),
    telemetry: {
      ...FALLBACK_EMPTY_TELEMETRY,
      ...(graph.telemetry ?? {}),
    },
  };
}

function compareNodes(a: BrainstormReasoningNode, b: BrainstormReasoningNode): number {
  const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  const pa = NODE_TYPE_PRIORITY[a.type] ?? 999;
  const pb = NODE_TYPE_PRIORITY[b.type] ?? 999;
  return pa - pb;
}

function filterEntriesForJob(
  entries: AgentReasoningEntry[],
  jobId: string
): ReasoningEntryWithRole[] {
  return entries.filter(entry => !entry.jobId || entry.jobId === jobId) as ReasoningEntryWithRole[];
}

function buildFallbackGraph(input: {
  job: BlueprintGenerationJob;
  activeSubStage?: string;
  entries: ReasoningEntryWithRole[];
  roleLabels: Record<string, string>;
  specTree: BlueprintSpecTree | null;
  selectedSpecNodeId: string | null;
  maxConsoleLines: number;
}): BrainstormReasoningGraph {
  const questionNode = buildQuestionNode(input);
  const nodes: BrainstormReasoningNode[] = [questionNode];
  const edges: BrainstormReasoningEdge[] = [];

  const contributionEntries = input.entries.filter(entry =>
    entry.phase !== "iteration_started" && entry.phase !== "iteration_completed"
  );

  // Build contribution nodes (each carries roleLabel + the "发表的意见" as title/body).
  // Connect every one from central question (so "对啥" 意图 is clear).
  // Additionally build a temporal discussion chain between consecutive contributions.
  // This creates visible "谁跟谁" flow (roleA's point -> roleB's response/推进) while
  // still showing all tied to the root intent. Layout (LR dagre) will surface the main
  // discussion trunk + branches.
  let prevContribId: string | null = null;
  contributionEntries.forEach((entry, index) => {
    const node = nodeFromEntry(entry, input.roleLabels, index + 1);
    nodes.push(node);

    // Always link back to question for "对中央问题发表的意见" visibility
    edges.push({
      id: `fallback-edge-question-${node.id}`,
      source: questionNode.id,
      target: node.id,
      type: edgeTypeForNode(node),
      label: edgeLabelForNode(node),
      sourceKind: "fallback",
    });

    // Sequential discussion chain: who -> who (temporal order of entries = discussion turns)
    if (prevContribId) {
      edges.push({
        id: `fallback-edge-discuss-${prevContribId}-${node.id}`,
        source: prevContribId,
        target: node.id,
        type: "refines",
        label: "推进",
        sourceKind: "fallback",
      });
    }
    prevContribId = node.id;
  });

  const terminalCandidates = nodes.filter(node =>
    node.type === "decision" || node.type === "synthesis" || node.type === "evidence"
  );
  if (terminalCandidates.length > 0) {
    const synthesisNode: BrainstormReasoningNode = {
      id: "fallback-synthesis",
      type: "synthesis",
      title: "收敛 / 决策",
      body: "Fallback synthesis from current runtime reasoning entries.",
      status: "resolved",
      order: nodes.length + 1,
      sourceRefs: [{ kind: "job", id: input.job.id }],
    };
    nodes.push(synthesisNode);
    for (const node of terminalCandidates.slice(-4)) {
      edges.push({
        id: `fallback-edge-${node.id}-synthesis`,
        source: node.id,
        target: synthesisNode.id,
        type: "synthesizes",
        label: "收敛",
        sourceKind: "fallback",
      });
    }
  }

  return {
    id: `fallback-reasoning-${input.job.id}-${input.activeSubStage ?? "stage"}`,
    jobId: input.job.id,
    stage: input.activeSubStage ?? input.job.stage,
    centralQuestion: {
      id: questionNode.id,
      title: questionNode.title,
      body: questionNode.body,
      sourceRefs: questionNode.sourceRefs,
    },
    nodes,
    edges: edges.filter(edge =>
      nodes.some(node => node.id === edge.source) &&
      nodes.some(node => node.id === edge.target)
    ),
    telemetry: {
      ...FALLBACK_EMPTY_TELEMETRY,
      tokenBurn: sumOptionalNumbers(contributionEntries.map(entry => entry.tokensUsed)),
      remainingBudget: lastFinite(contributionEntries.map(entry => entry.budgetRemaining)),
      activeRoleCount: countRoles(contributionEntries, input.roleLabels),
    },
    consoleLines: deriveConsoleLines(contributionEntries).slice(-input.maxConsoleLines),
    source: "fallback",
  };
}

function buildQuestionNode(input: {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree | null;
  selectedSpecNodeId: string | null;
}): BrainstormReasoningNode {
  const selectedNode = findSpecNode(input.specTree, input.selectedSpecNodeId);
  const jobLike = input.job as BlueprintGenerationJob & {
    title?: string;
    prompt?: string;
    objective?: string;
  };
  const title =
    selectedNode?.title ??
    pickString(jobLike.title) ??
    pickString(jobLike.objective) ??
    pickString(jobLike.prompt) ??
    "Current SPEC reasoning question";
  const body =
    selectedNode?.summary ??
    pickString(jobLike.objective) ??
    pickString(jobLike.prompt);

  return {
    id: selectedNode ? `question-spec-${selectedNode.id}` : "question-current",
    type: "question",
    title,
    body,
    status: "open",
    order: 0,
    sourceRefs: [
      { kind: "job", id: input.job.id },
      ...(selectedNode ? [{ kind: "spec_node" as const, id: selectedNode.id }] : []),
    ],
  };
}

function findSpecNode(
  specTree: BlueprintSpecTree | null,
  selectedSpecNodeId: string | null
): BlueprintSpecTreeNode | null {
  if (!specTree || !selectedSpecNodeId) return null;
  return specTree.nodes.find(node => node.id === selectedSpecNodeId) ?? null;
}

function nodeFromEntry(
  entry: ReasoningEntryWithRole,
  roleLabels: Record<string, string>,
  order: number
): BrainstormReasoningNode {
  const type = nodeTypeForEntry(entry);
  const roleId = pickString(entry.roleId);
  const roleLabel =
    (roleId ? roleLabels[roleId] : undefined) ??
    pickString(entry.roleLabel) ??
    roleId;
  const title =
    pickString(entry.thought) ??
    pickString(entry.observationSummary) ??
    pickString(entry.reason) ??
    pickString(entry.error) ??
    fallbackTitleForType(type);
  const body =
    pickString(entry.observationSummary) ??
    pickString(entry.reason) ??
    pickString(entry.actionToolId) ??
    pickString(entry.error);

  return {
    id: `fallback-node-${entry.id}`,
    type,
    title: truncate(title, 96),
    body: body ? truncate(body, 140) : undefined,
    roleId,
    roleLabel,
    status: statusForEntry(entry, type),
    order,
    // V5: capabilityId 映射（legacy stage → capability），使 graph 成为 capability invocation graph。
    // 详见 V5 文档：orchestrator 才是权威调度源。
    capabilityId: entry.stageId
      ? (STAGE_TO_V5_CAPABILITIES[entry.stageId as keyof typeof STAGE_TO_V5_CAPABILITIES]?.[0] as V5CapabilityId | undefined)
      : undefined,
    sourceRefs: [
      { kind: "reasoning_entry", id: entry.id },
      ...(entry.stageId ? [{ kind: "stage" as const, id: entry.stageId }] : []),
      ...(roleId ? [{ kind: "role" as const, id: roleId, label: roleLabel }] : []),
    ],
  };
}

function nodeTypeForEntry(entry: AgentReasoningEntry): BrainstormReasoningNodeType {
  if (entry.phase === "thinking") {
    return /clarif|澄清|question|ask/i.test(entry.thought ?? "")
      ? "clarification"
      : "hypothesis";
  }
  if (entry.phase === "observing") {
    return entry.observationSuccess === false ? "risk" : "evidence";
  }
  if (entry.phase === "error") return "gap";
  if (entry.phase === "completed") return "decision";
  if (entry.phase === "acting") return "constraint";
  return "hypothesis";
}

function statusForEntry(
  entry: AgentReasoningEntry,
  type: BrainstormReasoningNodeType
): BrainstormReasoningNodeStatus {
  if (entry.phase === "error") return "failed";
  if (type === "risk" || type === "gap") return "challenged";
  if (entry.phase === "completed") return "resolved";
  if (entry.phase === "observing" && entry.observationSuccess !== false) return "supported";
  return "active";
}

function edgeTypeForNode(node: BrainstormReasoningNode): BrainstormReasoningEdge["type"] {
  if (node.type === "synthesis" || node.type === "decision") return "synthesizes";
  if (node.type === "evidence") return "cites";
  return "refines";
}

function edgeLabelForNode(node: BrainstormReasoningNode): string {
  // 产品推演语义（与 projection + 2D surface 对齐）：谁对中央问题/前序发表了什么意见
  if (node.type === "synthesis" || node.type === "decision") return "收敛";
  if (node.type === "evidence") return "支撑";
  return "细化";
}

function deriveConsoleLines(entries: ReasoningEntryWithRole[]): BrainstormGraphConsoleLine[] {
  return entries.map(entry => ({
    id: `console-${entry.id}`,
    kind: consoleKindForEntry(entry),
    text: consoleTextForEntry(entry),
    roleId: pickString(entry.roleId),
    timestamp: entry.timestamp,
  }));
}

function consoleKindForEntry(entry: AgentReasoningEntry): BrainstormGraphConsoleLine["kind"] {
  if (entry.phase === "thinking") return "Thinking";
  if (entry.phase === "acting") return "Tool";
  if (entry.phase === "observing") return "Observation";
  if (entry.phase === "completed") return "Report";
  if (entry.phase === "error") return "System";
  return "System";
}

function consoleTextForEntry(entry: AgentReasoningEntry): string {
  return (
    pickString(entry.thought) ??
    pickString(entry.actionToolId) ??
    pickString(entry.observationSummary) ??
    pickString(entry.reason) ??
    pickString(entry.error) ??
    entry.phase
  );
}

function countRoles(
  entries: ReasoningEntryWithRole[],
  roleLabels: Record<string, string>
): number | null {
  const roleIds = new Set(
    entries.map(entry => pickString(entry.roleId)).filter((value): value is string => Boolean(value))
  );
  if (roleIds.size > 0) return roleIds.size;
  return Object.keys(roleLabels).length || null;
}

function sumOptionalNumbers(values: Array<number | undefined>): number | null {
  const finite = values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0);
}

function lastFinite(values: Array<number | undefined>): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function fallbackTitleForType(type: BrainstormReasoningNodeType): string {
  // 产品推演平台英文 fallback 标题（与 2D surface 中文化标签对齐）
  switch (type) {
    case "clarification":
      return "Clarification";
    case "hypothesis":
      return "Assumption";
    case "evidence":
      return "Insight";
    case "constraint":
      return "Constraint";
    case "risk":
      return "Risk";
    case "gap":
      return "Gap";
    case "decision":
      return "Decision";
    case "synthesis":
      return "Convergence";
    case "question":
      return "Intent";
    // critique / rebuttal are debate protocol and must not appear in Effect/Reasoning
    // Flow graphs (including fallback). If they ever reach here the type boundary
    // was violated upstream; make it obvious instead of giving them a normal title.
    case "critique":
    case "rebuttal":
      return "(debate protocol — isolated to realtime path)";
    default:
      return type satisfies never;
  }
}
