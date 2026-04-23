import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditEventType } from "../../shared/audit/contracts.js";
import type { RetrievalResult } from "../../shared/rag/contracts.js";
import { createRAGRouter, type RAGRouteDeps } from "../routes/rag.js";
import { auditCollector } from "../audit/audit-collector.js";
import { setPermissionCheckEngine } from "../core/agent.js";

function createDeps(results: RetrievalResult[] = []): RAGRouteDeps {
  return {
    ingestionPipeline: {
      ingest: vi.fn(),
      ingestBatch: vi.fn(),
      getDeadLetters: vi.fn(),
      retryDeadLetter: vi.fn(),
    } as unknown as RAGRouteDeps["ingestionPipeline"],
    retriever: {
      search: vi.fn(async () => results),
    } as unknown as RAGRouteDeps["retriever"],
    ragPipeline: {} as RAGRouteDeps["ragPipeline"],
    feedbackCollector: {
      recordExplicit: vi.fn(),
      getStats: vi.fn(),
    } as unknown as RAGRouteDeps["feedbackCollector"],
    lifecycleManager: {
      purge: vi.fn(),
    } as unknown as RAGRouteDeps["lifecycleManager"],
    healthChecker: {
      check: vi.fn(),
    } as unknown as RAGRouteDeps["healthChecker"],
    metrics: {
      snapshot: vi.fn(),
      recordRetrieval: vi.fn(),
    } as unknown as RAGRouteDeps["metrics"],
    augmentationLogger: {
      getByTaskId: vi.fn(),
    } as unknown as RAGRouteDeps["augmentationLogger"],
  };
}

async function withServer(
  deps: RAGRouteDeps,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/rag", createRAGRouter(deps));
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function makeResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    chunkId: "document:doc-1:0",
    score: 0.91,
    content: "Graph runtime compatibility content with document evidence.",
    sourceType: "document",
    sourceId: "doc-1",
    metadata: {
      ingestedAt: "2026-04-22T00:00:00.000Z",
      lastAccessedAt: "2026-04-22T00:00:00.000Z",
      contentHash: "hash-doc-1",
    },
    totalCandidates: 2,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  setPermissionCheckEngine(undefined as any);
});

describe("web-aigc RAG compatibility routes", () => {
  it("projects document_search results into document groups", async () => {
    const deps = createDeps([
      makeResult(),
      makeResult({
        chunkId: "document:doc-1:1",
        score: 0.72,
        content: "Second fragment about graph runtime monitoring compatibility.",
      }),
      makeResult({
        chunkId: "document:doc-2:0",
        sourceId: "doc-2",
        score: 0.88,
        content: "Another document for document search adapter.",
      }),
    ]);

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          scope: {
            projectId: "proj-web-aigc",
            sourceTypes: ["document"],
          },
          options: {
            topK: 5,
            mode: "hybrid",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.query).toBe("graph runtime");
      expect(body.mode).toBe("hybrid");
      expect(body.results).toHaveLength(2);
      expect(body.results[0].documentId).toBe("doc-1");
      expect(body.results[0].fragments).toHaveLength(2);
      expect(body.results[0].highlights.length).toBeGreaterThan(0);
    });

    expect(deps.retriever.search).toHaveBeenCalledWith(
      "graph runtime",
      expect.objectContaining({
        projectId: "proj-web-aigc",
        sourceTypes: ["document"],
        topK: 5,
        mode: "hybrid",
      }),
    );
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledTimes(1);
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledWith(
      expect.any(Number),
      true,
    );
  });

  it("records audit entries for document_search", async () => {
    const deps = createDeps([makeResult()]);
    const auditSpy = vi.spyOn(auditCollector, "record").mockImplementation(() => {});

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          scope: {
            projectId: "proj-web-aigc",
            documentIds: ["doc-1"],
          },
          options: {
            mode: "hybrid",
          },
        }),
      });

      expect(response.status).toBe(200);
    });

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AuditEventType.DATA_ACCESSED,
        action: "Document search executed for web-aigc node",
        resource: expect.objectContaining({
          type: "document-search-node",
          id: "proj-web-aigc",
          name: "document_search",
        }),
        metadata: expect.objectContaining({
          eventKey: "external.knowledge_retrieval",
          nodeType: "document_search",
          projectId: "proj-web-aigc",
          queryMode: "hybrid",
          structuredEntityCount: 0,
          semanticHitCount: 1,
          totalCandidates: 1,
          documentFilterCount: 1,
        }),
      }),
    );
  });

  it("filters fragment_search results by documentIds", async () => {
    const deps = createDeps([
      makeResult(),
      makeResult({
        chunkId: "document:doc-2:0",
        sourceId: "doc-2",
        content: "Fragment that should be filtered out.",
      }),
    ]);
    const auditSpy = vi.spyOn(auditCollector, "record").mockImplementation(() => {});

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/fragment-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          scope: {
            projectId: "proj-web-aigc",
            documentIds: ["doc-1"],
          },
          options: {
            mode: "keyword",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.mode).toBe("keyword");
      expect(body.results).toHaveLength(1);
      expect(body.results[0].documentId).toBe("doc-1");
      expect(body.results[0].summary).toContain("Graph runtime");
    });
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledTimes(1);
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledWith(
      expect.any(Number),
      true,
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AuditEventType.DATA_ACCESSED,
        metadata: expect.objectContaining({
          eventKey: "external.knowledge_retrieval",
          nodeType: "fragment_search",
          projectId: "proj-web-aigc",
          queryMode: "keyword",
          structuredEntityCount: 0,
          semanticHitCount: 1,
          totalCandidates: 1,
          documentFilterCount: 1,
        }),
      }),
    );
  });

  it("returns an empty document_search result when documentIds filter removes all hits", async () => {
    const deps = createDeps([
      makeResult(),
      makeResult({
        chunkId: "document:doc-2:0",
        sourceId: "doc-2",
        score: 0.77,
        content: "Another document that should be filtered by documentIds.",
      }),
    ]);

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          scope: {
            projectId: "proj-web-aigc",
            documentIds: ["doc-404"],
          },
          options: {
            mode: "hybrid",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.query).toBe("graph runtime");
      expect(body.results).toEqual([]);
      expect(body.totalCandidates).toBe(0);
      expect(body.mode).toBe("hybrid");
    });

    expect(deps.retriever.search).toHaveBeenCalledWith(
      "graph runtime",
      expect.objectContaining({
        projectId: "proj-web-aigc",
        sourceIds: ["doc-404"],
      }),
    );
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledTimes(1);
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledWith(
      expect.any(Number),
      false,
    );
  });

  it("returns 400 when query is missing", async () => {
    const deps = createDeps();

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: { projectId: "proj-web-aigc" },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("query");
    });
    expect(deps.metrics.recordRetrieval).not.toHaveBeenCalled();
  });

  it("returns 400 when scope.projectId is missing", async () => {
    const deps = createDeps();

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/fragment-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          scope: {},
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("scope.projectId");
    });
    expect(deps.metrics.recordRetrieval).not.toHaveBeenCalled();
  });

  it("returns 400 when permission enforcement is enabled but agentId/token are missing", async () => {
    const deps = createDeps([makeResult()]);
    setPermissionCheckEngine({
      checkPermission: vi.fn(() => ({ allowed: true })),
    } as any);

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          scope: {
            projectId: "proj-web-aigc",
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("agentId and token");
    });

    expect(deps.retriever.search).not.toHaveBeenCalled();
    expect(deps.metrics.recordRetrieval).not.toHaveBeenCalled();
  });

  it("returns 403 when permission engine denies web-aigc document_search", async () => {
    const deps = createDeps([makeResult()]);
    const permissionEngine = {
      checkPermission: vi.fn(() => ({
        allowed: false,
        reason: "No allow rule found for database:select",
        suggestion: "Request permission for database:select",
      })),
    };
    setPermissionCheckEngine(permissionEngine as any);

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          agentId: "agent-1",
          token: "token-1",
          scope: {
            projectId: "proj-web-aigc",
          },
        }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("database:select");
      expect(body.suggestion).toContain("Request permission");
    });

    expect(permissionEngine.checkPermission).toHaveBeenCalledWith(
      "agent-1",
      "database",
      "select",
      "rag_proj-web-aigc",
      "token-1",
    );
    expect(deps.retriever.search).not.toHaveBeenCalled();
    expect(deps.metrics.recordRetrieval).not.toHaveBeenCalled();
  });

  it("continues search when permission engine allows web-aigc document_search", async () => {
    const deps = createDeps([makeResult()]);
    const permissionEngine = {
      checkPermission: vi.fn(() => ({
        allowed: true,
      })),
    };
    setPermissionCheckEngine(permissionEngine as any);

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          agentId: "agent-1",
          token: "token-1",
          scope: {
            projectId: "proj-web-aigc",
            sourceTypes: ["document"],
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].documentId).toBe("doc-1");
    });

    expect(permissionEngine.checkPermission).toHaveBeenCalledWith(
      "agent-1",
      "database",
      "select",
      "rag_proj-web-aigc",
      "token-1",
    );
    expect(deps.retriever.search).toHaveBeenCalledTimes(1);
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledTimes(1);
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledWith(
      expect.any(Number),
      true,
    );
  });

  it("binds permission resource to the request projectId boundary", async () => {
    const deps = createDeps([makeResult()]);
    const permissionEngine = {
      checkPermission: vi.fn(() => ({
        allowed: true,
      })),
    };
    setPermissionCheckEngine(permissionEngine as any);

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          agentId: "agent-2",
          token: "token-2",
          scope: {
            projectId: "workspace-blue",
          },
        }),
      });

      expect(response.status).toBe(200);
    });

    expect(permissionEngine.checkPermission).toHaveBeenCalledWith(
      "agent-2",
      "database",
      "select",
      "rag_workspace-blue",
      "token-2",
    );
  });

  it("returns 500 for document_search retriever failures without recording success metrics", async () => {
    const deps = createDeps();
    deps.retriever.search = vi.fn(async () => {
      throw new Error("retriever exploded");
    }) as RAGRouteDeps["retriever"]["search"];

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/web-aigc/document-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          scope: {
            projectId: "proj-web-aigc",
          },
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        error: "Error: retriever exploded",
      });
    });

    expect(deps.metrics.recordRetrieval).not.toHaveBeenCalled();
  });

  it("records retrieval metrics for the generic search route", async () => {
    const deps = createDeps([
      makeResult(),
      makeResult({
        chunkId: "document:doc-2:0",
        sourceId: "doc-2",
        score: 0.63,
      }),
    ]);

    await withServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "graph runtime",
          options: {
            projectId: "proj-web-aigc",
            mode: "semantic",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.totalCandidates).toBe(2);
      expect(body.mode).toBe("semantic");
    });

    expect(deps.metrics.recordRetrieval).toHaveBeenCalledTimes(1);
    expect(deps.metrics.recordRetrieval).toHaveBeenCalledWith(
      expect.any(Number),
      true,
    );
  });
});
