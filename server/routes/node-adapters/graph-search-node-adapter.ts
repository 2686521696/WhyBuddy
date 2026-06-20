import type { KnowledgeGraphQuery } from "../../knowledge/query-service.js";
import type { UnifiedKnowledgeResult, UnifiedQueryOptions } from "../../../shared/knowledge/types.js";
import {
  projectEntityToGraphNode,
  projectRelationToGraphEdge,
  type GraphSearchNodeExecutionRequest,
  type GraphSearchNodeExecutionResult,
  type GraphSearchNodeInput,
  type GraphSearchNodeType,
  type WebAigcGraphAnswerDraft,
  type WebAigcGraphPathStep,
  type WebAigcGraphSearchMode,
  type WebAigcSearchProvenance,
} from "../../../shared/web-aigc-graph-search.js";

export interface GraphSearchNodeAdapterDeps {
  queryService: Pick<
    KnowledgeGraphQuery,
    "getNeighbors" | "findPath" | "subgraph" | "naturalLanguageQuery"
  >;
  knowledgeService?: {
    query(
      question: string,
      projectId: string,
      options?: Partial<UnifiedQueryOptions>,
    ): Promise<UnifiedKnowledgeResult>;
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeProvenance(value: unknown, query: string | undefined): WebAigcSearchProvenance | undefined {
  const record = normalizeRecord(value);
  const provider = normalizeString(record.provider);
  const source = normalizeString(record.source);
  const provenanceQuery = normalizeString(record.query) || query;

  if (!provider || !source || !provenanceQuery) {
    return undefined;
  }

  const auditId = normalizeString(record.auditId);
  const permission = normalizeRecord(record.permission);

  return {
    provider,
    source,
    query: provenanceQuery,
    ...(auditId ? { auditId } : {}),
    ...(Object.keys(permission).length > 0 ? { permission } : {}),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMode(value: unknown): WebAigcGraphSearchMode {
  if (
    value === "neighbors" ||
    value === "path" ||
    value === "subgraph" ||
    value === "natural_language"
  ) {
    return value;
  }

  return "natural_language";
}

function normalizeDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(4, Math.floor(value)));
}

function isTruthyBoolean(value: unknown): boolean {
  return value === true;
}

function buildCitations(result: UnifiedKnowledgeResult): string[] {
  const entityCitations = result.structuredResults.entities.map(
    (entity) => `${entity.entityType}:${entity.name}`,
  );
  const relationCitations = result.structuredResults.relations.map(
    (relation) =>
      `${relation.relationType}:${relation.sourceEntityId}->${relation.targetEntityId}`,
  );
  const semanticCitations = result.semanticResults.map((hit, index) => {
    const candidate =
      typeof hit === "object" && hit !== null && "id" in hit
        ? (hit as { id?: unknown }).id
        : undefined;
    return `semantic:${typeof candidate === "string" ? candidate : index + 1}`;
  });

  return [...entityCitations, ...relationCitations, ...semanticCitations];
}

function buildEvidence(result: UnifiedKnowledgeResult): WebAigcGraphAnswerDraft["evidence"] {
  const entityEvidence = result.structuredResults.entities.map((entity) => ({
    kind: "entity" as const,
    title: entity.name,
    detail: entity.description || entity.entityType,
  }));
  const relationEvidence = result.structuredResults.relations.map((relation) => ({
    kind: "relation" as const,
    title: relation.relationType,
    detail: relation.evidence || `${relation.sourceEntityId} -> ${relation.targetEntityId}`,
  }));
  const semanticEvidence = result.semanticResults.map((hit, index) => {
    const candidate =
      typeof hit === "object" && hit !== null
        ? (hit as { content?: unknown; score?: unknown })
        : {};
    return {
      kind: "semantic" as const,
      title: `semantic-${index + 1}`,
      detail:
        typeof candidate.content === "string"
          ? candidate.content
          : typeof candidate.score === "number"
            ? `score=${candidate.score}`
            : "semantic hit",
    };
  });

  return [...entityEvidence, ...relationEvidence, ...semanticEvidence];
}

function buildPath(
  mode: WebAigcGraphSearchMode,
  input: GraphSearchNodeInput,
  rawResult: GraphSearchNodeExecutionResult["output"]["rawResult"],
): WebAigcGraphPathStep[] {
  if (mode !== "path") {
    return [];
  }

  const sourceEntityId = normalizeString(input.sourceEntityId);
  const targetEntityId = normalizeString(input.targetEntityId);
  if (!sourceEntityId || !targetEntityId) {
    return [];
  }

  const byId = new Map(rawResult.entities.map((entity) => [entity.entityId, entity]));
  const pathEntityIds: string[] = [];

  if (sourceEntityId === targetEntityId && byId.has(sourceEntityId)) {
    pathEntityIds.push(sourceEntityId);
  } else if (rawResult.relations.length > 0) {
    let currentEntityId = sourceEntityId;
    pathEntityIds.push(currentEntityId);
    for (const relation of rawResult.relations) {
      if (relation.sourceEntityId === currentEntityId) {
        currentEntityId = relation.targetEntityId;
      } else if (relation.targetEntityId === currentEntityId) {
        currentEntityId = relation.sourceEntityId;
      } else {
        break;
      }

      pathEntityIds.push(currentEntityId);
      if (currentEntityId === targetEntityId) {
        break;
      }
    }
  }

  return pathEntityIds
    .map((entityId, index) => {
      const entity = byId.get(entityId);
      if (!entity) {
        return undefined;
      }

      const nextId = pathEntityIds[index + 1];
      const relation = nextId
        ? rawResult.relations.find(
            (item) =>
              (item.sourceEntityId === entityId && item.targetEntityId === nextId) ||
              (item.sourceEntityId === nextId && item.targetEntityId === entityId),
          )
        : undefined;

      return {
        entityId: entity.entityId,
        name: entity.name,
        entityType: entity.entityType,
        ...(relation ? { viaRelationType: relation.relationType } : {}),
      };
    })
    .filter((item): item is WebAigcGraphPathStep => Boolean(item));
}

function isGraphSearchNodeType(value: unknown): value is GraphSearchNodeType {
  return value === "graph_search";
}

function resolveQuestionForAnswerDraft(input: GraphSearchNodeInput): string | undefined {
  return normalizeString(input.answerQuestion) || normalizeString(input.query);
}

export { isGraphSearchNodeType };

async function executeGraphQueryByMode(
  input: GraphSearchNodeInput,
  deps: GraphSearchNodeAdapterDeps,
): Promise<{
  mode: WebAigcGraphSearchMode;
  rawResult: GraphSearchNodeExecutionResult["output"]["rawResult"];
}> {
  const mode = normalizeMode(input.mode);

  if (mode === "neighbors") {
    const entityId = normalizeString(input.entityId);
    if (!entityId) {
      throw new Error("Graph search neighbors mode requires entityId.");
    }

    const rawResult = await deps.queryService.getNeighbors(
      entityId,
      normalizeStringArray(input.relationTypes),
      normalizeDepth(input.depth),
    );
    return { mode, rawResult };
  }

  if (mode === "path") {
    const sourceEntityId = normalizeString(input.sourceEntityId);
    const targetEntityId = normalizeString(input.targetEntityId);
    if (!sourceEntityId || !targetEntityId) {
      throw new Error("Graph search path mode requires sourceEntityId and targetEntityId.");
    }

    const rawResult = await deps.queryService.findPath(sourceEntityId, targetEntityId);
    return { mode, rawResult };
  }

  if (mode === "subgraph") {
    const entityIds = normalizeStringArray(input.entityIds);
    if (entityIds.length === 0) {
      throw new Error("Graph search subgraph mode requires entityIds.");
    }

    const rawResult = await deps.queryService.subgraph(entityIds);
    return { mode, rawResult };
  }

  const projectId = normalizeString(input.projectId);
  const query = normalizeString(input.query);
  if (!projectId) {
    throw new Error("Graph search natural language mode requires projectId.");
  }
  if (!query) {
    throw new Error("Graph search natural language mode requires query.");
  }

  let rawResult = await deps.queryService.naturalLanguageQuery(query, projectId);
  if (
    rawResult.entities.length === 0 &&
    rawResult.relations.length === 0 &&
    deps.knowledgeService
  ) {
    const fallback = await deps.knowledgeService.query(query, projectId, {
      mode: "preferStructured",
    });
    rawResult = {
      entities: fallback.structuredResults.entities,
      relations: fallback.structuredResults.relations,
      contextSummary: fallback.mergedSummary,
      isPartial: false,
    };
  }

  return { mode, rawResult };
}

async function maybeBuildAnswerDraft(
  input: GraphSearchNodeInput,
  deps: GraphSearchNodeAdapterDeps,
): Promise<WebAigcGraphAnswerDraft | undefined> {
  if (!isTruthyBoolean(input.includeAnswerDraft)) {
    return undefined;
  }

  const question = resolveQuestionForAnswerDraft(input);
  const projectId = normalizeString(input.projectId);
  if (!question || !projectId || !deps.knowledgeService) {
    return undefined;
  }

  const result = await deps.knowledgeService.query(question, projectId, {
    mode: "preferStructured",
  });

  return {
    question,
    answer: result.mergedSummary,
    citations: buildCitations(result),
    evidence: buildEvidence(result),
    result,
  };
}

export async function executeGraphSearchNode(
  request: GraphSearchNodeExecutionRequest,
  deps: GraphSearchNodeAdapterDeps,
): Promise<GraphSearchNodeExecutionResult> {
  if (!isGraphSearchNodeType(request.nodeType)) {
    throw new Error("Unsupported graph_search node type.");
  }

  const input = request.input ?? {};
  const { mode, rawResult } = await executeGraphQueryByMode(input, deps);
  const answerDraft = await maybeBuildAnswerDraft(input, deps);
  const nodes = rawResult.entities.map(projectEntityToGraphNode);
  const edges = rawResult.relations.map(projectRelationToGraphEdge);
  const path = buildPath(mode, input, rawResult);
  const query = resolveQuestionForAnswerDraft(input);
  const provenance = normalizeProvenance(input.context?.provenance, query);

  return {
    ok: true,
    nodeType: "graph_search",
    output: {
      status: "completed",
      ...(query ? { query } : {}),
      ...(provenance ? { provenance } : {}),
      mode,
      graph: {
        nodes,
        edges,
        path,
        pathFound: path.length > 0 || (mode !== "path" && edges.length > 0),
        summary: rawResult.contextSummary,
        isPartial: rawResult.isPartial,
      },
      downstream: {
        knowledgeQaReady: Boolean(answerDraft),
        ...(answerDraft ? { answerDraft } : {}),
      },
      metrics: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        pathLength: path.length,
      },
      context: normalizeRecord(input.context),
      rawResult,
    },
  };
}
