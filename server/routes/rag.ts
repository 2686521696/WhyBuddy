/**
 * RAG REST API 路由
 *
 * Requirements: 1.4, 3.6, 4.1, 6.5, 7.4, 8.4, 8.5, 9.6
 */

import { Router } from 'express';
import type { IngestionPayload } from '../../shared/rag/contracts.js';
import type { IngestionPipeline } from '../rag/ingestion/ingestion-pipeline.js';
import type { RAGRetriever } from '../rag/retrieval/rag-retriever.js';
import type { RAGPipeline } from '../rag/augmentation/rag-pipeline.js';
import type { FeedbackCollector } from '../rag/feedback/feedback-collector.js';
import type { LifecycleManager } from '../rag/lifecycle/lifecycle-manager.js';
import type { HealthChecker } from '../rag/observability/health-checker.js';
import type { RAGMetrics } from '../rag/observability/metrics.js';
import type { AugmentationLogger } from '../rag/augmentation/augmentation-logger.js';
import type {
  WebAigcSearchRequest,
  WebAigcSearchMode,
} from '../../shared/rag/web-aigc-search.js';
import type { PermissionCheckResult } from '../../shared/permission/contracts.js';
import {
  normalizeWebAigcSearchRequest,
  projectDocumentSearchResponse,
  projectFragmentSearchResponse,
  validateWebAigcSearchRequest,
} from '../rag/web-aigc-search-adapter.js';
import { getPermissionCheckEngine } from '../core/agent.js';

export interface RAGRouteDeps {
  ingestionPipeline: IngestionPipeline;
  retriever: RAGRetriever;
  ragPipeline: RAGPipeline;
  feedbackCollector: FeedbackCollector;
  lifecycleManager: LifecycleManager;
  healthChecker: HealthChecker;
  metrics: RAGMetrics;
  augmentationLogger: AugmentationLogger;
}

interface WebAigcSearchIdentity {
  agentId: string;
  token: string;
}

function resolveWebAigcSearchIdentity(
  body: Partial<WebAigcSearchRequest> | undefined,
): WebAigcSearchIdentity | null {
  const candidate = body as
    | (Partial<WebAigcSearchRequest> & {
        agentId?: unknown;
        token?: unknown;
      })
    | undefined;

  const agentId =
    typeof candidate?.agentId === 'string' && candidate.agentId.trim()
      ? candidate.agentId.trim()
      : typeof body?.scope?.agentId === 'string' && body.scope.agentId.trim()
        ? body.scope.agentId.trim()
        : '';
  const token =
    typeof candidate?.token === 'string' && candidate.token.trim()
      ? candidate.token.trim()
      : '';

  if (!agentId || !token) {
    return null;
  }

  return { agentId, token };
}

function buildWebAigcSearchResource(projectId: string): string {
  return `rag_${projectId}`;
}

function toPermissionDeniedResponse(result: PermissionCheckResult) {
  return {
    status: 403,
    body: {
      error: result.reason || 'Permission denied for document search',
      suggestion: result.suggestion,
    },
  };
}

export function createRAGRouter(deps: RAGRouteDeps): Router {
  const router = Router();

  function recordRetrievalMetric(latencyMs: number, resultCount: number): void {
    deps.metrics.recordRetrieval(latencyMs, resultCount > 0);
  }

  async function runWebAigcSearch(
    reqBody: Partial<WebAigcSearchRequest> | undefined,
    projector: typeof projectDocumentSearchResponse | typeof projectFragmentSearchResponse,
  ) {
    const validationError = validateWebAigcSearchRequest(reqBody);
    if (validationError) {
      return {
        status: 400,
        body: { error: validationError },
      };
    }

    const request = reqBody as WebAigcSearchRequest;
    const normalizedOptions = normalizeWebAigcSearchRequest(request);
    const permissionEngine = getPermissionCheckEngine();
    if (permissionEngine) {
      const identity = resolveWebAigcSearchIdentity(reqBody);
      if (!identity) {
        return {
          status: 400,
          body: {
            error:
              'agentId and token are required when document_search permission enforcement is enabled',
          },
        };
      }

      const permission = permissionEngine.checkPermission(
        identity.agentId,
        'database',
        'select',
        buildWebAigcSearchResource(request.scope.projectId),
        identity.token,
      );

      if (!permission.allowed) {
        return toPermissionDeniedResponse(permission);
      }
    }

    const mode = (normalizedOptions.mode ?? 'hybrid') as WebAigcSearchMode;
    const start = Date.now();
    const results = await deps.retriever.search(request.query, normalizedOptions);
    const latencyMs = Date.now() - start;
    const body = projector({
      query: request.query,
      results,
      documentIds: request.scope.documentIds,
      latencyMs,
      mode,
    });
    recordRetrievalMetric(latencyMs, body.totalCandidates);

    return {
      status: 200,
      body,
    };
  }

  // POST /api/rag/ingest
  router.post('/ingest', async (req, res) => {
    try {
      const payload = req.body?.payload as IngestionPayload;
      if (!payload?.sourceType || !payload?.sourceId || !payload?.content) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }
      const result = await deps.ingestionPipeline.ingest(payload);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /api/rag/ingest/batch
  router.post('/ingest/batch', async (req, res) => {
    try {
      const payloads = req.body?.payloads as IngestionPayload[];
      if (!Array.isArray(payloads)) {
        return res.status(400).json({ error: 'payloads must be an array' });
      }
      const result = await deps.ingestionPipeline.ingestBatch(payloads);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/rag/search
  router.post('/search', async (req, res) => {
    try {
      const { query, options } = req.body;
      if (!query || !options?.projectId) {
        return res.status(400).json({ error: 'query and options.projectId required' });
      }
      const start = Date.now();
      const results = await deps.retriever.search(query, options);
      const latencyMs = Date.now() - start;
      recordRetrievalMetric(latencyMs, results.length);
      return res.json({
        results,
        totalCandidates: results.length,
        latencyMs,
        mode: options.mode ?? 'hybrid',
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/rag/web-aigc/document-search
  router.post('/web-aigc/document-search', async (req, res) => {
    try {
      const response = await runWebAigcSearch(
        req.body as Partial<WebAigcSearchRequest>,
        projectDocumentSearchResponse,
      );
      return res.status(response.status).json(response.body);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/rag/web-aigc/fragment-search
  router.post('/web-aigc/fragment-search', async (req, res) => {
    try {
      const response = await runWebAigcSearch(
        req.body as Partial<WebAigcSearchRequest>,
        projectFragmentSearchResponse,
      );
      return res.status(response.status).json(response.body);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/rag/feedback
  router.post('/feedback', (req, res) => {
    try {
      const { taskId, agentId, helpfulChunkIds, irrelevantChunkIds, missingContext } = req.body;
      if (!taskId || !agentId) {
        return res.status(400).json({ error: 'taskId and agentId required' });
      }
      deps.feedbackCollector.recordExplicit({
        taskId, agentId, projectId: req.body.projectId ?? '',
        helpfulChunkIds: helpfulChunkIds ?? [],
        irrelevantChunkIds: irrelevantChunkIds ?? [],
        missingContext,
      });
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/rag/feedback/stats
  router.get('/feedback/stats', (req, res) => {
    const stats = deps.feedbackCollector.getStats({
      projectId: req.query.projectId as string,
      since: req.query.since as string,
      until: req.query.until as string,
    });
    return res.json(stats);
  });

  // GET /api/workflows/:workflowId/tasks/:taskId/rag
  // Note: mounted at /api/rag but we handle the full path pattern
  router.get('/task-rag/:taskId', (req, res) => {
    const logs = deps.augmentationLogger.getByTaskId(req.params.taskId);
    return res.json({ logs });
  });

  // GET /api/admin/rag/health
  router.get('/admin/health', async (_req, res) => {
    try {
      const health = await deps.healthChecker.check();
      return res.json(health);
    } catch (err) {
      return res.status(500).json({ status: 'unhealthy', error: String(err) });
    }
  });

  // POST /api/admin/rag/purge
  router.post('/admin/purge', async (req, res) => {
    try {
      const result = await deps.lifecycleManager.purge({
        projectId: req.body.projectId,
        sourceType: req.body.sourceType,
        before: req.body.before,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/admin/rag/dlq
  router.get('/admin/dlq', async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const entries = await deps.ingestionPipeline.getDeadLetters({ limit, offset });
    return res.json({ entries, total: entries.length });
  });

  // POST /api/admin/rag/dlq/:entryId/retry
  router.post('/admin/dlq/:entryId/retry', async (req, res) => {
    try {
      const result = await deps.ingestionPipeline.retryDeadLetter(req.params.entryId);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/admin/rag/metrics
  router.get('/admin/metrics', (_req, res) => {
    return res.json(deps.metrics.snapshot());
  });

  // POST /api/admin/rag/reembed — placeholder
  router.post('/admin/reembed', (_req, res) => {
    return res.json({ message: 'Re-embedding not yet implemented' });
  });

  // POST /api/admin/rag/backfill — placeholder
  router.post('/admin/backfill', (_req, res) => {
    return res.json({ message: 'Backfill not yet implemented' });
  });

  return router;
}
