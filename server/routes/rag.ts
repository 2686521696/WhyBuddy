/**
 * RAG REST API 路由
 *
 * Requirements: 1.4, 3.6, 4.1, 6.5, 7.4, 8.4, 8.5, 9.6
 */

import { Router } from 'express';
import { AuditEventType } from '../../shared/audit/contracts.js';
import {
  isRAGIngestionPythonRuntimeResult,
  type IngestionPayload,
} from '../../shared/rag/contracts.js';
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
import { auditCollector } from '../audit/audit-collector.js';
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

type PythonRagDelegateResult =
  | { delegated: true; result: unknown; error?: string }
  | { delegated: false; error?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUnavailableResult(value: unknown): boolean {
  return isRecord(value) && (value.ok === false || value.status === "unavailable");
}

function statusCodeForUnavailableResult(value: unknown): number {
  return isRecord(value) && value.status === "unavailable" ? 503 : 500;
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
  const tokenValue = candidate?.["token"];
  const token =
    typeof tokenValue === 'string' && tokenValue.trim()
      ? tokenValue.trim()
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

function tryRecordAudit(input: Parameters<typeof auditCollector.record>[0]): void {
  try {
    auditCollector.record(input);
  } catch {
    // Audit is best-effort here; retrieval should not fail just because the
    // audit chain is not initialized in lightweight test/runtime setups.
  }
}

export function createRAGRouter(deps: RAGRouteDeps): Router {
  const router = Router();

  // RAG query/search behavior classification (task 37): /search + /ingest* are PYTHON_FIRST_COMPAT.
  // Python FastAPI (slide-rule-python/routes/rag.py + services/rag_service.py) owns the query/search semantics and contract.
  // Node is explicit thin compatibility shell: tryDelegateToPythonRag always attempted first; when Python responds (ok or error) the result is used verbatim.
  // Only on connect-fail or 404 fallback to Node retained impl (keeps public surface working during cutover but does not own business when Python live).
  // Provenance signals ("backend":"slide-rule-python", "source":"python", "provenance":"python-rag-query") must surface on Python path.
  // Degraded/unavailable from Python delegate are forwarded (visible); no silent Node success when delegate active.
  // Thin shell proven by test: server/tests/rag-config.test.ts (delegate success => !retriever.search && !ingestionPipeline.ingest).
  // Vector ingestion provider boundary already in Python (services/rag_ingestion.py); this task moves the query/search entrypoint.

  function resolvePythonRagBase(): string {
    return (
      process.env.PYTHON_SLIDE_RULE_BASE_URL ||
      process.env.SLIDE_RULE_PYTHON_BASE_URL ||
      "http://localhost:9700"
    ).replace(/\/+$/, "");
  }

  function isVitestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === "test" ||
      process.env.VITEST === "true" ||
      process.env.VITEST_WORKER_ID !== undefined ||
      process.env.VITEST_POOL_ID !== undefined
    );
  }

  async function tryDelegateToPythonRag(
    operation: "ingest" | "search" | "upsert" | "delete" | "batch",
    payload: any,
  ): Promise<PythonRagDelegateResult> {
    // Delegate to Python (PYTHON_FIRST_COMPAT for query/search per task 37).
    // Connection failure or 404 -> delegated:false (explicit fallback only; thin compat).
    // Any response from Python (ok or error body) -> delegated:true and use it verbatim (Python owns).
    // Signals from Python: backend/slide-rule-python + provenance:python-rag-query expected.
    // Degraded visible from Python path.
    //
    // 测试环境默认关（与 blueprint 的 python 代理同款守卫）：路由测试注入的是
    // mock retriever，本机若恰好跑着 :9700 会把请求真委托出去、断言随环境漂移。
    // 需要验证委托行为的测试用 RAG_PYTHON_DELEGATE=true 显式打开。
    if (isVitestEnvironment() && process.env.RAG_PYTHON_DELEGATE !== "true") {
      return { delegated: false };
    }
    const base = resolvePythonRagBase();
    const internalKey = process.env.PYTHON_SLIDE_RULE_INTERNAL_KEY || "dev-slide-rule-internal";
    const url = `${base}/api/rag/${operation === "search" ? "search" : "ingest"}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": internalKey,
        },
        body: JSON.stringify({ payload: payload?.payload ?? payload, operation }),
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.status === 404) {
        // No Python /api/rag route in this vector store slice -> delegate unavailable, use explicit Node compat fallback.
        return { delegated: false };
      }
      if (resp.ok) {
        return { delegated: true, result: body };
      }
      // Non-404 error response from Python: delegate result drives response (visible py failure, no Node dep fallback).
      const degraded = body && (body.ok === false || body.status === "unavailable" || body.error)
        ? { ...body, status: "unavailable" }
        : {
            ok: false,
            status: "unavailable",
            error: { code: "python_rag_delegate_http", message: `python http ${resp.status}`, retryable: true },
            storage: "unavailable",
            migratedStorage: false,
          };
      return { delegated: true, result: degraded };
    } catch (e: any) {
      // Network/connect failure (no Python runtime listening) -> delegate unavailable, explicit compat fallback to Node shell.
      return { delegated: false };
    }
  }

  function recordRetrievalMetric(latencyMs: number, resultCount: number): void {
    deps.metrics.recordRetrieval(latencyMs, resultCount > 0);
  }

  async function runWebAigcSearch(
    reqBody: Partial<WebAigcSearchRequest> | undefined,
    projector: typeof projectDocumentSearchResponse | typeof projectFragmentSearchResponse,
    nodeType: 'document_search' | 'fragment_search' = 'document_search',
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

    tryRecordAudit({
      eventType: AuditEventType.DATA_ACCESSED,
      actor: { type: 'system', id: 'rag-router' },
      action:
        nodeType === 'fragment_search'
          ? 'Fragment search executed for web-aigc node'
          : 'Document search executed for web-aigc node',
      resource: {
        type: nodeType === 'fragment_search' ? 'fragment-search-node' : 'document-search-node',
        id: request.scope.projectId,
        name: nodeType,
      },
      result: 'success',
      metadata: {
        eventKey: 'external.knowledge_retrieval',
        nodeType,
        projectId: request.scope.projectId,
        queryMode: mode,
        latencyMs,
        structuredEntityCount: 0,
        semanticHitCount: body.totalCandidates,
        totalCandidates: body.totalCandidates,
        documentFilterCount: request.scope.documentIds?.length ?? 0,
      },
    });

    return {
      status: 200,
      body,
    };
  }

  // POST /api/rag/ingest
  // PYTHON_FIRST_COMPAT (task 37): Python owns query/ingest behavior. Node is thin proxy.
  // Delegate result drives (py success or py-reported failure); fallback only explicit compat when delegate unavailable.
  // Python route: /api/rag/ingest (routes/rag.py) returns provenance.
  router.post('/ingest', async (req, res) => {
    try {
      const payload = req.body?.payload as IngestionPayload;
      if (!payload?.sourceType || !payload?.sourceId || !payload?.content) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }
      const delegate = await tryDelegateToPythonRag("ingest", req.body).catch(
        (): PythonRagDelegateResult => ({ delegated: false }),
      );
      if (delegate.delegated) {
        const r = delegate.result;
        if (isUnavailableResult(r)) {
          return res.status(statusCodeForUnavailableResult(r)).json(r);
        }
        return res.json(r);
      }
      // Fallback only when delegate did not produce result (thin proxy prefers Python delegate result)
      const result = await deps.ingestionPipeline.ingest(payload);
      if (isUnavailableResult(result)) {
        return res.status(statusCodeForUnavailableResult(result)).json(result);
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /api/rag/ingest/batch
  // PYTHON_FIRST_COMPAT (task 37): Python owns; Node thin proxy only.
  router.post('/ingest/batch', async (req, res) => {
    try {
      const payloads = req.body?.payloads as IngestionPayload[];
      if (!Array.isArray(payloads)) {
        return res.status(400).json({ error: 'payloads must be an array' });
      }
      const delegate = await tryDelegateToPythonRag("batch", req.body).catch(
        (): PythonRagDelegateResult => ({ delegated: false }),
      );
      if (delegate.delegated) {
        const r = delegate.result;
        if (isUnavailableResult(r)) {
          return res.status(statusCodeForUnavailableResult(r)).json(r);
        }
        return res.json(r);
      }
      const result = await deps.ingestionPipeline.ingestBatch(payloads);
      if (isUnavailableResult(result)) {
        return res.status(statusCodeForUnavailableResult(result)).json(result);
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/rag/search
  // PYTHON_FIRST_COMPAT (task 37): RAG query/search behavior moved to Python.
  // Delegate drives outcome (result from /api/rag/search in Python with python-rag-query provenance).
  // Fallback only on unavailable (explicit compat shell); Node retriever no longer owns when Python live.
  router.post('/search', async (req, res) => {
    try {
      const { query, options } = req.body;
      if (!query || !options?.projectId) {
        return res.status(400).json({ error: 'query and options.projectId required' });
      }
      const delegate = await tryDelegateToPythonRag("search", req.body).catch(
        (): PythonRagDelegateResult => ({ delegated: false }),
      );
      if (delegate.delegated) {
        const r = delegate.result;
        if (isUnavailableResult(r)) {
          return res.status(statusCodeForUnavailableResult(r)).json(r);
        }
        return res.json(r);
      }
      const start = Date.now();
      const results = await deps.retriever.search(query, options || {});
      const latencyMs = Date.now() - start;
      const totalCandidates = Array.isArray(results) ? results.length : 0;
      // 与 web-aigc 搜索分支同口径：本地检索路径同样记录检索指标
      //（此前只有 web-aigc 分支记，通用 /search 的 Node 路径漏记）。
      recordRetrievalMetric(latencyMs, totalCandidates);
      return res.json({
        results: results || [],
        totalCandidates,
        latencyMs,
        mode: options?.mode ?? 'hybrid',
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
        'document_search',
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
        'fragment_search',
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
  // Explicitly retained Node compatibility shell for this task.
  // Reason: admin lifecycle purge not part of vector store provider (RAGVectorStoreProvider) takeover slice.
  // Python has delete provider path; Node lifecycleManager retained until later slice.
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
  // Explicitly retained Node compatibility shell (DLQ admin not migrated in this vector boundary slice).
  router.get('/admin/dlq', async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const entries = await deps.ingestionPipeline.getDeadLetters({ limit, offset });
    return res.json({ entries, total: entries.length });
  });

  // POST /api/admin/rag/dlq/:entryId/retry
  // Explicitly retained Node compatibility shell (retryDeadLetter retained; Python delete covered in provider tests).
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
