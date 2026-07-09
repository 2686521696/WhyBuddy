import type {
  BrainstormReasoningGraph,
  BrainstormReasoningGraphArtifactPayload,
} from "@shared/blueprint";
import type {
  BlueprintGenerationArtifactType,
  BlueprintGenerationJob,
} from "@shared/blueprint/contracts";

export function readJobArtifactPayloads(
  job: BlueprintGenerationJob | null | undefined,
  type: BlueprintGenerationArtifactType
): unknown[] {
  if (!job) return [];
  return job.artifacts
    .filter(artifact => artifact.type === type)
    .map(artifact => artifact.payload)
    .filter(payload => payload !== undefined && payload !== null);
}

export function readLatestJobArtifactPayload(
  job: BlueprintGenerationJob | null | undefined,
  type: BlueprintGenerationArtifactType
): unknown {
  return readJobArtifactPayloads(job, type).at(-1);
}

export function readBrainstormReasoningGraphs(
  job: BlueprintGenerationJob | null | undefined
): BrainstormReasoningGraph[] {
  return readJobArtifactPayloads(job, "brainstorm_reasoning_graph")
    .map(payload => readBrainstormReasoningGraphPayload(payload))
    .filter((graph): graph is BrainstormReasoningGraph => graph !== null);
}

function readBrainstormReasoningGraphPayload(
  payload: unknown
): BrainstormReasoningGraph | null {
  const record = asRecord(payload);
  if (!record) return null;

  const graph =
    isBrainstormReasoningGraph(record)
      ? record
      : readArtifactWrappedGraph(record);
  return graph && isBrainstormReasoningGraph(graph) ? graph : null;
}

function readArtifactWrappedGraph(
  record: Record<string, unknown>
): BrainstormReasoningGraph | null {
  if (record.type !== "brainstorm_reasoning_graph") return null;
  const graph = (record as Partial<BrainstormReasoningGraphArtifactPayload>).graph;
  return isBrainstormReasoningGraph(graph) ? graph : null;
}

function isBrainstormReasoningGraph(
  value: unknown
): value is BrainstormReasoningGraph {
  const graph = asRecord(value);
  if (!graph) return false;
  if (!isNonEmptyString(graph.id)) return false;
  if (!isNonEmptyString(graph.jobId)) return false;
  if (!isNonEmptyString(graph.stage)) return false;
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) return false;
  if (!Array.isArray(graph.edges)) return false;

  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    const nodeRecord = asRecord(node);
    if (!nodeRecord || !isNonEmptyString(nodeRecord.id)) return false;
    if (!isNonEmptyString(nodeRecord.type)) return false;
    if (!isNonEmptyString(nodeRecord.title)) return false;
    if (!isNonEmptyString(nodeRecord.status)) return false;
    nodeIds.add(nodeRecord.id);
  }

  for (const edge of graph.edges) {
    const edgeRecord = asRecord(edge);
    if (!edgeRecord || !isNonEmptyString(edgeRecord.id)) return false;
    if (!isNonEmptyString(edgeRecord.source)) return false;
    if (!isNonEmptyString(edgeRecord.target)) return false;
    if (!isNonEmptyString(edgeRecord.type)) return false;
    if (!nodeIds.has(edgeRecord.source) || !nodeIds.has(edgeRecord.target)) {
      return false;
    }
  }

  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
