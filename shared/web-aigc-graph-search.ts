import type { Entity, QueryResult, Relation, UnifiedKnowledgeResult } from "./knowledge/types.js";

export const WEB_AIGC_GRAPH_SEARCH_API = {
  EXECUTE: "POST /api/graph-search/nodes/execute",
} as const;

export const WEB_AIGC_GRAPH_SEARCH_NODE_TYPES = [
  "graph_search",
] as const;

export type GraphSearchNodeType =
  (typeof WEB_AIGC_GRAPH_SEARCH_NODE_TYPES)[number];

export const WEB_AIGC_GRAPH_SEARCH_MODES = [
  "neighbors",
  "path",
  "subgraph",
  "natural_language",
] as const;

export type WebAigcGraphSearchMode =
  (typeof WEB_AIGC_GRAPH_SEARCH_MODES)[number];

export interface WebAigcSearchProvenance {
  provider: "fake" | string;
  source: string;
  query: string;
  auditId?: string;
  permission?: Record<string, unknown>;
}

export interface GraphSearchNodeInput {
  projectId?: string;
  query?: string;
  mode?: WebAigcGraphSearchMode;
  entityId?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
  entityIds?: string[];
  relationTypes?: string[];
  depth?: number;
  includeAnswerDraft?: boolean;
  answerQuestion?: string;
  context?: Record<string, unknown>;
}

export interface GraphSearchNodeExecutionRequest {
  nodeType: GraphSearchNodeType;
  input?: GraphSearchNodeInput;
}

export interface WebAigcGraphNode {
  entityId: string;
  entityType: string;
  name: string;
  description: string;
  confidence: number;
  projectId: string;
}

export interface WebAigcGraphEdge {
  relationId: string;
  relationType: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidence: number;
  evidence: string;
}

export interface WebAigcGraphPathStep {
  entityId: string;
  name: string;
  entityType: string;
  viaRelationType?: string;
}

export interface WebAigcGraphAnswerDraft {
  question: string;
  answer: string;
  citations: string[];
  evidence: Array<{
    kind: "entity" | "relation" | "semantic";
    title: string;
    detail: string;
  }>;
  result?: UnifiedKnowledgeResult;
}

export interface GraphSearchNodeExecutionResult {
  ok: true;
  nodeType: GraphSearchNodeType;
  output: {
    status: "completed";
    query?: string;
    provenance?: WebAigcSearchProvenance;
    mode: WebAigcGraphSearchMode;
    graph: {
      nodes: WebAigcGraphNode[];
      edges: WebAigcGraphEdge[];
      path: WebAigcGraphPathStep[];
      pathFound: boolean;
      summary: string;
      isPartial: boolean;
    };
    downstream: {
      knowledgeQaReady: boolean;
      answerDraft?: WebAigcGraphAnswerDraft;
    };
    metrics: {
      nodeCount: number;
      edgeCount: number;
      pathLength: number;
    };
    context: Record<string, unknown>;
    rawResult: QueryResult;
  };
}

export function projectEntityToGraphNode(entity: Entity): WebAigcGraphNode {
  return {
    entityId: entity.entityId,
    entityType: entity.entityType,
    name: entity.name,
    description: entity.description,
    confidence: entity.confidence,
    projectId: entity.projectId,
  };
}

export function projectRelationToGraphEdge(relation: Relation): WebAigcGraphEdge {
  return {
    relationId: relation.relationId,
    relationType: relation.relationType,
    sourceEntityId: relation.sourceEntityId,
    targetEntityId: relation.targetEntityId,
    confidence: relation.confidence,
    evidence: relation.evidence,
  };
}
