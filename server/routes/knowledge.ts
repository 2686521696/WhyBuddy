/**
 * 知识图谱公开 API 路由
 *
 * GET  /api/knowledge/graph              → 可视化节点和边数据
 * GET  /api/knowledge/review-queue       → 待审列表
 * POST /api/knowledge/review/:entityId   → 执行审核操作
 * POST /api/knowledge/query              → 统一知识检索
 *
 * Requirements: 7.1, 7.2, 9.6
 */

import { Router } from "express";
import { performance } from "node:perf_hooks";

import { AuditEventType } from "../../shared/audit/contracts.js";
import { KNOWLEDGE_API } from "../../shared/knowledge/api.js";
import type {
  GetKnowledgeGraphResponse,
  GetReviewQueueResponse,
  PostReviewResponse,
  PostKnowledgeQueryResponse,
  KnowledgeApiErrorResponse,
} from "../../shared/knowledge/api.js";
import type { ReviewAction } from "../../shared/knowledge/types.js";
import type { GraphStore } from "../knowledge/graph-store.js";
import type { KnowledgeReviewQueue } from "../knowledge/review-queue.js";
import type { KnowledgeService } from "../knowledge/knowledge-service.js";
import {
  executeKnowledgeNode,
  isKnowledgeNodeType,
} from "./node-adapters/knowledge-node-adapter.js";

// ---------------------------------------------------------------------------
// Route prefix — strip the common prefix so we can mount at /api/knowledge
// ---------------------------------------------------------------------------

const PREFIX = "/api/knowledge";

function stripPrefix(route: string): string {
  return route.startsWith(PREFIX) ? route.slice(PREFIX.length) || "/" : route;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createKnowledgeRouter(deps: {
  graphStore: GraphStore;
  reviewQueue: KnowledgeReviewQueue;
  knowledgeService: KnowledgeService;
  auditCollector?: {
    record(input: {
      eventType: AuditEventType;
      actor: {
        type: "user" | "agent" | "system";
        id: string;
        name?: string;
      };
      action: string;
      resource: {
        type: string;
        id: string;
        name?: string;
      };
      result: "success" | "failure" | "denied" | "error";
      context?: {
        sessionId?: string;
        requestId?: string;
        sourceIp?: string;
        userAgent?: string;
        organizationId?: string;
      };
      metadata?: Record<string, unknown>;
      lineageId?: string;
    }): void;
  };
}): Router {
  const { graphStore, reviewQueue, knowledgeService, auditCollector } = deps;
  const router = Router();

  // -----------------------------------------------------------------------
  // GET /api/knowledge/graph — Req 9.6
  // -----------------------------------------------------------------------
  router.get(stripPrefix(KNOWLEDGE_API.graph), (req, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;

      if (!projectId) {
        const errResp: KnowledgeApiErrorResponse = {
          error: "Query parameter 'projectId' is required",
        };
        return res.status(400).json(errResp);
      }

      // Optional filters
      const entityTypesRaw = req.query.entityTypes as string | undefined;
      const entityTypes = entityTypesRaw
        ? entityTypesRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;
      const depth = req.query.depth
        ? parseInt(req.query.depth as string, 10)
        : 2;

      // Ensure project data is loaded
      graphStore.load(projectId);

      // Fetch entities with optional type filter
      let nodes = graphStore.findEntities({ projectId });
      if (entityTypes && entityTypes.length > 0) {
        nodes = nodes.filter((e) => entityTypes.includes(e.entityType));
      }

      // Fetch relations for this project
      let edges = graphStore.findRelations({ projectId });

      // If depth is specified and < default, limit to entities reachable within depth
      // from any node (for large graphs). For the visualization endpoint we return
      // all project entities/relations filtered by type — depth is used by the
      // frontend to control expansion, but we still filter edges to only include
      // those connecting returned nodes.
      const nodeIds = new Set(nodes.map((n) => n.entityId));
      edges = edges.filter(
        (e) => nodeIds.has(e.sourceEntityId) && nodeIds.has(e.targetEntityId),
      );

      const response: GetKnowledgeGraphResponse = {
        ok: true,
        nodes,
        edges,
      };

      res.json(response);
    } catch (err) {
      const errResp: KnowledgeApiErrorResponse = {
        error: err instanceof Error ? err.message : "Unknown error",
      };
      res.status(500).json(errResp);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/knowledge/review-queue — Req 7.1
  // -----------------------------------------------------------------------
  router.get(stripPrefix(KNOWLEDGE_API.reviewQueue), (req, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const entityType = req.query.entityType as string | undefined;
      const sortBy = req.query.sortBy as "confidence" | "createdAt" | undefined;

      const items = reviewQueue.getQueue({ projectId, entityType, sortBy });

      const response: GetReviewQueueResponse = {
        ok: true,
        items,
      };

      res.json(response);
    } catch (err) {
      const errResp: KnowledgeApiErrorResponse = {
        error: err instanceof Error ? err.message : "Unknown error",
      };
      res.status(500).json(errResp);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/knowledge/review/:entityId — Req 7.2
  // -----------------------------------------------------------------------
  router.post(stripPrefix(KNOWLEDGE_API.review), (req, res) => {
    try {
      const { entityId } = req.params;
      const action = req.body as ReviewAction;

      if (!action || !action.action || !action.reviewedBy || !action.reviewerType) {
        const errResp: KnowledgeApiErrorResponse = {
          error: "Request body must include action, reviewedBy, and reviewerType",
        };
        return res.status(400).json(errResp);
      }

      const entity = reviewQueue.review(entityId, action);

      const response: PostReviewResponse = {
        ok: true,
        entity,
      };

      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // Entity not found → 404
      if (message.includes("not found")) {
        const errResp: KnowledgeApiErrorResponse = { error: message };
        return res.status(404).json(errResp);
      }
      const errResp: KnowledgeApiErrorResponse = { error: message };
      res.status(500).json(errResp);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/knowledge/query — Req 5.1
  // -----------------------------------------------------------------------
  router.post(stripPrefix(KNOWLEDGE_API.query), async (req, res) => {
    try {
      const { question, projectId, options } = req.body ?? {};

      if (!question || !projectId) {
        const errResp: KnowledgeApiErrorResponse = {
          error: "Request body must include 'question' and 'projectId'",
        };
        return res.status(400).json(errResp);
      }

      const result = await knowledgeService.query(question, projectId, options);

      const response: PostKnowledgeQueryResponse = {
        ok: true,
        result,
      };

      res.json(response);
    } catch (err) {
      const errResp: KnowledgeApiErrorResponse = {
        error: err instanceof Error ? err.message : "Unknown error",
      };
      res.status(500).json(errResp);
    }
  });

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;

    if (!isKnowledgeNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be knowledge_qa or qa_search" });
    }

    const startedAt = performance.now();
    try {
      const result = await executeKnowledgeNode(
        {
          nodeType,
          input: req.body?.input,
        },
        { knowledgeService },
      );

      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const projectId =
        typeof req.body?.input?.projectId === "string"
          ? req.body.input.projectId.trim()
          : "";
      const queryMode =
        typeof req.body?.input?.options?.mode === "string"
          ? req.body.input.options.mode
          : "balanced";
      const semanticScores = result.output.result.semanticResults
        .map(hit =>
          typeof hit === "object" && hit !== null && "score" in hit
            ? (hit as { score?: unknown }).score
            : undefined,
        )
        .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

      auditCollector?.record({
        eventType: AuditEventType.DATA_ACCESSED,
        actor: { type: "system", id: "knowledge-node-router" },
        action: `Knowledge retrieval executed for ${nodeType}`,
        resource: {
          type: "knowledge-node",
          id: nodeType,
          name: projectId || "knowledge_qa",
        },
        result: "success",
        context: {
          requestId:
            typeof req.headers["x-request-id"] === "string"
              ? req.headers["x-request-id"]
              : undefined,
        },
        metadata: {
          eventKey: "external.knowledge_retrieval",
          nodeType,
          projectId: projectId || undefined,
          queryMode,
          latencyMs,
          structuredEntityCount: result.output.evidence.structuredEntityCount,
          relationCount: result.output.evidence.relationCount,
          semanticHitCount: result.output.evidence.semanticHitCount,
          citationCount: result.output.citations.length,
          evidenceCount: result.output.evidenceList.length,
          semanticScoreMax:
            semanticScores.length > 0 ? Math.max(...semanticScores) : undefined,
          semanticScoreMin:
            semanticScores.length > 0 ? Math.min(...semanticScores) : undefined,
          ...(nodeType === "qa_search" && "matches" in result.output
            ? {
                matchCount: result.output.matches.length,
                topScore: result.output.score,
              }
            : {}),
        },
      });

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = /requires question|requires projectId/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
