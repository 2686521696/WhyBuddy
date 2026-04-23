import type { KnowledgeService } from "../../knowledge/knowledge-service.js";
import type {
  UnifiedKnowledgeResult,
  UnifiedQueryOptions,
} from "../../../shared/knowledge/types.js";

export type KnowledgeNodeType = "knowledge_qa" | "qa_search";

export interface KnowledgeNodeInput {
  question?: string;
  projectId?: string;
  options?: Partial<UnifiedQueryOptions>;
  maxResults?: number;
}

export interface KnowledgeNodeExecutionRequest {
  nodeType: KnowledgeNodeType;
  input?: KnowledgeNodeInput;
}

export type KnowledgeNodeDownstreamConsumer =
  | "condition"
  | "dialogue"
  | "end"
  | "variable_assignment";

export interface KnowledgeNodeMetadata {
  projectId: string;
  question: string;
  mode: UnifiedQueryOptions["mode"];
  citationCount: number;
  evidenceCount: number;
  matchCount?: number;
  maxResults?: number;
  downstreamConsumers: KnowledgeNodeDownstreamConsumer[];
}

export interface KnowledgeNodeObservability {
  eventKey: "external.knowledge_retrieval";
  nodeType: KnowledgeNodeType;
  projectId: string;
  question: string;
  mode: UnifiedQueryOptions["mode"];
  structuredEntityCount: number;
  relationCount: number;
  semanticHitCount: number;
  citationCount: number;
  evidenceCount: number;
  matchCount?: number;
  topScore?: number;
}

interface KnowledgeNodeBaseOutput {
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
  metadata: KnowledgeNodeMetadata;
  observability: KnowledgeNodeObservability;
}

export interface KnowledgeQaNodeExecutionResult {
  ok: true;
  nodeType: "knowledge_qa";
  output: KnowledgeNodeBaseOutput;
}

export interface QaSearchNodeMatch {
  source: "entity" | "relation" | "semantic";
  question: string;
  answer: string;
  score: number;
}

export interface QaSearchNodeExecutionResult {
  ok: true;
  nodeType: "qa_search";
  output: KnowledgeNodeBaseOutput & {
    score: number;
    context: string;
    matches: QaSearchNodeMatch[];
  };
}

export type KnowledgeNodeExecutionResult =
  | KnowledgeQaNodeExecutionResult
  | QaSearchNodeExecutionResult;

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
  return value === "knowledge_qa" || value === "qa_search";
}

function normalizeMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }

  return Math.max(1, Math.min(10, Math.floor(value)));
}

function normalizeScore(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
}

function buildDownstreamConsumers(
  nodeType: KnowledgeNodeType,
): KnowledgeNodeDownstreamConsumer[] {
  return nodeType === "qa_search"
    ? ["condition", "dialogue", "end", "variable_assignment"]
    : ["dialogue", "end", "variable_assignment"];
}

function buildKnowledgeMetadata(input: {
  nodeType: KnowledgeNodeType;
  projectId: string;
  question: string;
  mode: UnifiedQueryOptions["mode"];
  citations: string[];
  evidenceList: KnowledgeNodeBaseOutput["evidenceList"];
  maxResults?: number;
  matchCount?: number;
}): KnowledgeNodeMetadata {
  return {
    projectId: input.projectId,
    question: input.question,
    mode: input.mode,
    citationCount: input.citations.length,
    evidenceCount: input.evidenceList.length,
    ...(typeof input.matchCount === "number" ? { matchCount: input.matchCount } : {}),
    ...(typeof input.maxResults === "number" ? { maxResults: input.maxResults } : {}),
    downstreamConsumers: buildDownstreamConsumers(input.nodeType),
  };
}

function buildKnowledgeObservability(input: {
  nodeType: KnowledgeNodeType;
  projectId: string;
  question: string;
  mode: UnifiedQueryOptions["mode"];
  evidence: KnowledgeNodeBaseOutput["evidence"];
  citations: string[];
  evidenceList: KnowledgeNodeBaseOutput["evidenceList"];
  matchCount?: number;
  topScore?: number;
}): KnowledgeNodeObservability {
  return {
    eventKey: "external.knowledge_retrieval",
    nodeType: input.nodeType,
    projectId: input.projectId,
    question: input.question,
    mode: input.mode,
    structuredEntityCount: input.evidence.structuredEntityCount,
    relationCount: input.evidence.relationCount,
    semanticHitCount: input.evidence.semanticHitCount,
    citationCount: input.citations.length,
    evidenceCount: input.evidenceList.length,
    ...(typeof input.matchCount === "number" ? { matchCount: input.matchCount } : {}),
    ...(typeof input.topScore === "number" ? { topScore: input.topScore } : {}),
  };
}

function buildQaSearchMatches(
  result: UnifiedKnowledgeResult,
  maxResults: number,
): QaSearchNodeMatch[] {
  const entityMatches: QaSearchNodeMatch[] = result.structuredResults.entities.map(
    entity => ({
      source: "entity",
      question: entity.name,
      answer: entity.description || entity.entityType,
      score: normalizeScore(entity.confidence, 0.5),
    }),
  );
  const relationMatches: QaSearchNodeMatch[] = result.structuredResults.relations.map(
    relation => ({
      source: "relation",
      question: relation.relationType,
      answer: relation.evidence || `${relation.sourceEntityId} -> ${relation.targetEntityId}`,
      score: normalizeScore(relation.confidence, 0.5),
    }),
  );
  const semanticMatches: QaSearchNodeMatch[] = result.semanticResults.map(
    (hit, index) => {
      const candidate =
        typeof hit === "object" && hit !== null
          ? (hit as { id?: unknown; content?: unknown; score?: unknown })
          : {};
      const answer =
        typeof candidate.content === "string" && candidate.content.trim().length > 0
          ? candidate.content.trim()
          : result.mergedSummary;
      const semanticId =
        typeof candidate.id === "string" && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : `semantic-${index + 1}`;

      return {
        source: "semantic" as const,
        question: semanticId,
        answer,
        score: normalizeScore(candidate.score, 0.6),
      };
    },
  );

  return [...semanticMatches, ...entityMatches, ...relationMatches]
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);
}

function buildQaSearchContext(matches: QaSearchNodeMatch[]): string {
  if (matches.length === 0) {
    return "No QA-style matches found.";
  }

  return matches
    .map(
      (match, index) =>
        `${index + 1}. [${match.source}] ${match.question}\nscore=${match.score.toFixed(2)}\n${match.answer}`,
    )
    .join("\n\n");
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

  const mode = normalizeMode(input.options?.mode);
  const maxResults = normalizeMaxResults(input.maxResults);
  const result = await deps.knowledgeService.query(question, projectId, {
    mode,
  });

  const answer = result.mergedSummary;
  const citations = buildKnowledgeCitations(result);
  const evidenceList = buildKnowledgeEvidenceList(result);
  const baseOutput: KnowledgeNodeBaseOutput = {
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
    metadata: buildKnowledgeMetadata({
      nodeType: request.nodeType,
      projectId,
      question,
      mode,
      citations,
      evidenceList,
      ...(request.nodeType === "qa_search" ? { maxResults } : {}),
    }),
    observability: buildKnowledgeObservability({
      nodeType: request.nodeType,
      projectId,
      question,
      mode,
      evidence: {
        structuredEntityCount: result.structuredResults.entities.length,
        relationCount: result.structuredResults.relations.length,
        semanticHitCount: result.semanticResults.length,
      },
      citations,
      evidenceList,
    }),
  };

  if (request.nodeType === "qa_search") {
    const matches = buildQaSearchMatches(result, maxResults);

    return {
      ok: true,
      nodeType: request.nodeType,
      output: {
        ...baseOutput,
        score: matches[0]?.score ?? 0,
        context: buildQaSearchContext(matches),
        matches,
        metadata: buildKnowledgeMetadata({
          nodeType: request.nodeType,
          projectId,
          question,
          mode,
          citations,
          evidenceList,
          maxResults,
          matchCount: matches.length,
        }),
        observability: buildKnowledgeObservability({
          nodeType: request.nodeType,
          projectId,
          question,
          mode,
          evidence: baseOutput.evidence,
          citations,
          evidenceList,
          matchCount: matches.length,
          topScore: matches[0]?.score,
        }),
      },
    };
  }

  return {
    ok: true,
    nodeType: request.nodeType,
    output: baseOutput,
  };
}
