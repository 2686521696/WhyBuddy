import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";
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

const NODE_TYPE_PRIORITY: Record<BrainstormReasoningNodeType, number> = {
  question: 0,
  clarification: 1,
  constraint: 2,
  hypothesis: 3,
  evidence: 4,
  risk: 5,
  gap: 6,
  decision: 7,
  synthesis: 8,
};

const FALLBACK_EMPTY_TELEMETRY: BrainstormGraphTelemetry = {
  tokenBurn: null,
  sourceCount: null,
  elapsedMs: null,
  remainingBudget: null,
  activeRoleCount: null,
};

export function deriveBlueprintWallReasoningGraph(
  input: DeriveBlueprintWallReasoningGraphInput
): BlueprintWallReasoningGraphViewModel {
  const maxVisibleNodes = input.maxVisibleNodes ?? DEFAULT_MAX_VISIBLE_NODES;
  const maxConsoleLines = input.maxConsoleLines ?? DEFAULT_MAX_CONSOLE_LINES;
  const job = input.job;

  if (!job?.id) {
    return emptyView("no-job");
  }

  const structured = pickStructuredGraph(input.structuredGraphs, job.id, input.activeSubStage);
  if (structured !== null) {
    return toViewModel(structured, "structured", maxVisibleNodes, maxConsoleLines);
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
  return NODE_TYPE_PRIORITY[a.type] - NODE_TYPE_PRIORITY[b.type];
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

  contributionEntries.forEach((entry, index) => {
    const node = nodeFromEntry(entry, input.roleLabels, index + 1);
    nodes.push(node);
    edges.push({
      id: `fallback-edge-question-${node.id}`,
      source: questionNode.id,
      target: node.id,
      type: edgeTypeForNode(node),
      label: edgeLabelForNode(node),
      sourceKind: "fallback",
    });
  });

  const terminalCandidates = nodes.filter(node =>
    node.type === "decision" || node.type === "synthesis" || node.type === "evidence"
  );
  if (terminalCandidates.length > 0) {
    const synthesisNode: BrainstormReasoningNode = {
      id: "fallback-synthesis",
      type: "synthesis",
      title: "SPEC reasoning synthesis",
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
        label: "synthesizes",
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
  if (node.type === "evidence") return "depends_on";
  return "refines";
}

function edgeLabelForNode(node: BrainstormReasoningNode): string {
  if (node.type === "synthesis" || node.type === "decision") return "synthesizes";
  if (node.type === "evidence") return "evidence";
  return "refines";
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
  switch (type) {
    case "clarification":
      return "Clarification";
    case "hypothesis":
      return "Hypothesis";
    case "evidence":
      return "Evidence";
    case "constraint":
      return "Constraint";
    case "risk":
      return "Risk";
    case "gap":
      return "Information gap";
    case "decision":
      return "Decision";
    case "synthesis":
      return "Synthesis";
    case "question":
      return "Question";
    default:
      return type satisfies never;
  }
}
