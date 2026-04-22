import type { KnowledgeService } from "../../knowledge/knowledge-service.js";
import type {
  UnifiedKnowledgeResult,
  UnifiedQueryOptions,
} from "../../../shared/knowledge/types.js";

export type KnowledgeNodeType = "knowledge_qa";

export interface KnowledgeNodeInput {
  question?: string;
  projectId?: string;
  options?: Partial<UnifiedQueryOptions>;
}

export interface KnowledgeNodeExecutionRequest {
  nodeType: KnowledgeNodeType;
  input?: KnowledgeNodeInput;
}

export interface KnowledgeNodeExecutionResult {
  ok: true;
  nodeType: KnowledgeNodeType;
  output: {
    answer: string;
    reply: {
      role: "assistant";
      content: string;
    };
    evidence: {
      structuredEntityCount: number;
      relationCount: number;
      semanticHitCount: number;
    };
    citations: string[];
    evidenceList: Array<{
      kind: "entity" | "relation" | "semantic";
      title: string;
      detail: string;
    }>;
    result: UnifiedKnowledgeResult;
  };
}

function buildKnowledgeCitations(
  result: UnifiedKnowledgeResult,
): string[] {
  const entityCitations = result.structuredResults.entities.map(
    entity => `${entity.entityType}:${entity.name}`,
  );
  const relationCitations = result.structuredResults.relations.map(
    relation =>
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

function buildKnowledgeEvidenceList(
  result: UnifiedKnowledgeResult,
): Array<{
  kind: "entity" | "relation" | "semantic";
  title: string;
  detail: string;
}> {
  const entityEvidence = result.structuredResults.entities.map(entity => ({
    kind: "entity" as const,
    title: entity.name,
    detail: entity.description || entity.entityType,
  }));
  const relationEvidence = result.structuredResults.relations.map(relation => ({
    kind: "relation" as const,
    title: relation.relationType,
    detail: relation.evidence,
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

function normalizeMode(value: unknown): UnifiedQueryOptions["mode"] {
  if (
    value === "preferStructured" ||
    value === "preferSemantic" ||
    value === "balanced"
  ) {
    return value;
  }
  return "balanced";
}

export function isKnowledgeNodeType(value: unknown): value is KnowledgeNodeType {
  return value === "knowledge_qa";
}

export async function executeKnowledgeNode(
  request: KnowledgeNodeExecutionRequest,
  deps: {
    knowledgeService: KnowledgeService;
  },
): Promise<KnowledgeNodeExecutionResult> {
  if (!isKnowledgeNodeType(request.nodeType)) {
    throw new Error("Unsupported knowledge node type.");
  }

  const input = request.input ?? {};
  const question =
    typeof input.question === "string" ? input.question.trim() : "";
  const projectId =
    typeof input.projectId === "string" ? input.projectId.trim() : "";

  if (!question) {
    throw new Error("Knowledge node input requires question.");
  }

  if (!projectId) {
    throw new Error("Knowledge node input requires projectId.");
  }

  const result = await deps.knowledgeService.query(question, projectId, {
    mode: normalizeMode(input.options?.mode),
  });

  const answer = result.mergedSummary;
  const citations = buildKnowledgeCitations(result);
  const evidenceList = buildKnowledgeEvidenceList(result);

  return {
    ok: true,
    nodeType: request.nodeType,
    output: {
      answer,
      reply: {
        role: "assistant",
        content: answer,
      },
      evidence: {
        structuredEntityCount: result.structuredResults.entities.length,
        relationCount: result.structuredResults.relations.length,
        semanticHitCount: result.semanticResults.length,
      },
      citations,
      evidenceList,
      result,
    },
  };
}
