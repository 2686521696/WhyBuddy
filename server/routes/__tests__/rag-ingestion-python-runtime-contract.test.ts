import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import {
  RAG_INGESTION_PYTHON_RUNTIME_CONTRACT_VERSION,
  isRAGIngestionPythonRuntimeResult,
} from "../../../shared/rag/contracts.js";
import { createRAGRouter, type RAGRouteDeps } from "../rag.js";
import { createVectorDeleteRouter } from "../vector-delete.js";
import { createVectorUpdateRouter } from "../vector-update.js";

function baseContract(operation: string, payload: Record<string, unknown>) {
  return {
    contractVersion: RAG_INGESTION_PYTHON_RUNTIME_CONTRACT_VERSION,
    runtime: "python-contract",
    operation,
    ok: true,
    status: "completed",
    ingestionId: "ingest-contract-1",
    projectId: "project-contract",
    sourceType: "document",
    sourceId: "doc-contract-1",
    storage: "contract-only",
    migratedStorage: false,
    provenance: {
      provider: "fake",
      source: "contract-test",
      auditId: "audit-rag-ingest-1",
    },
    lifecycle: {
      state: "active",
      archiveAfterDays: 90,
      deleteAfterDays: 365,
    },
    feedback: {
      helpfulChunkIds: ["document:doc-contract-1:0"],
      irrelevantChunkIds: [],
      missingContext: "none",
    },
    deadLetter: {
      entryId: "dlq-contract-1",
      retryCount: 2,
      stage: "embed",
      error: "previous fake failure",
    },
    ...payload,
  };
}

function createDeps(ingestResult: unknown): RAGRouteDeps {
  return {
    ingestionPipeline: {
      ingest: vi.fn(async () => ingestResult),
      ingestBatch: vi.fn(),
      getDeadLetters: vi.fn(async () => []),
      retryDeadLetter: vi.fn(),
    } as unknown as RAGRouteDeps["ingestionPipeline"],
    retriever: {
      search: vi.fn(async () => []),
    } as unknown as RAGRouteDeps["retriever"],
    ragPipeline: {} as RAGRouteDeps["ragPipeline"],
    feedbackCollector: {
      recordExplicit: vi.fn(),
      getStats: vi.fn(() => ({})),
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
      getByTaskId: vi.fn(() => []),
    } as unknown as RAGRouteDeps["augmentationLogger"],
  };
}

async function withApp(
  configure: (app: express.Express) => void,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  configure(app);
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
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("RAG ingestion Python runtime contract", () => {
  it("accepts ingest, chunk, embed, upsert, and delete contract envelopes", () => {
    const chunk = {
      chunkId: "document:doc-contract-1:0",
      sourceType: "document",
      sourceId: "doc-contract-1",
      projectId: "project-contract",
      chunkIndex: 0,
      content: "First paragraph for ingestion.",
      tokenCount: 4,
      metadata: {
        ingestedAt: "2026-06-20T00:00:00.000Z",
        lastAccessedAt: "2026-06-20T00:00:00.000Z",
        contentHash: "fake-sha256:abc",
        title: "Contract document",
      },
    };
    const ingest = baseContract("ingest", {
      ingest: {
        accepted: true,
        chunkCount: 1,
        deduplicated: false,
        contentHash: "fake-sha256:abc",
      },
    });
    const chunked = baseContract("chunk", { chunks: [chunk] });
    const embedded = baseContract("embed", {
      embeddings: [
        {
          chunkId: "document:doc-contract-1:0",
          provider: "fake-contract-embedding",
          model: "fake-rag-ingestion-v1",
          dimension: 4,
          vector: [0.1, 0.2, 0.3, 0.4],
        },
      ],
    });
    const upsert = baseContract("upsert", {
      upsert: {
        collection: "rag_project-contract",
        attempted: true,
        stored: false,
        upsertedCount: 0,
        recordIds: ["document:doc-contract-1:0"],
      },
    });
    const deleted = baseContract("delete", {
      delete: {
        collection: "rag_project-contract",
        attempted: true,
        deleted: false,
        deletedCount: 0,
        targetIds: ["document:doc-contract-1:0"],
      },
    });

    for (const result of [ingest, chunked, embedded, upsert, deleted]) {
      expect(isRAGIngestionPythonRuntimeResult(result)).toBe(true);
      expect(result.provenance).toMatchObject({ provider: "fake" });
      expect(result.lifecycle).toMatchObject({ state: "active" });
      expect(result.feedback).toMatchObject({
        helpfulChunkIds: ["document:doc-contract-1:0"],
      });
      expect(result.deadLetter).toMatchObject({
        entryId: "dlq-contract-1",
        retryCount: 2,
      });
    }
  });

  it("rejects unavailable failure masquerading as completed ingest", () => {
    const unavailable = {
      ...baseContract("ingest", {}),
      ok: false,
      status: "unavailable",
      error: {
        code: "python_rag_ingestion_unavailable",
        message: "RAG ingestion Python runtime is unavailable.",
        retryable: true,
      },
    };
    const mutated = {
      ...unavailable,
      ok: true,
      status: "completed",
      ingest: {
        accepted: true,
        chunkCount: 0,
        deduplicated: false,
        contentHash: "fake-sha256:mutated",
      },
    };

    expect(isRAGIngestionPythonRuntimeResult(unavailable)).toBe(true);
    expect(isRAGIngestionPythonRuntimeResult(mutated)).toBe(false);
  });

  it("ingest route returns Python unavailable as safe failure without fallback success", async () => {
    const unavailable = {
      ...baseContract("ingest", {}),
      ok: false,
      status: "unavailable",
      error: {
        code: "python_rag_ingestion_unavailable",
        message: "RAG ingestion Python runtime is unavailable.",
        retryable: true,
      },
    };
    const deps = createDeps(unavailable);

    await withApp(
      (app) => app.use("/api/rag", createRAGRouter(deps)),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/rag/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payload: {
              sourceType: "document",
              sourceId: "doc-contract-1",
              projectId: "project-contract",
              content: "Contract body",
              metadata: {},
              timestamp: "2026-06-20T00:00:00.000Z",
            },
          }),
        });

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toEqual(unavailable);
        expect(body.ok).toBe(false);
        expect(body.status).toBe("unavailable");
        expect(body.provenance).toMatchObject({ source: "contract-test" });
        expect(body.lifecycle).toMatchObject({ state: "active" });
        expect(body.feedback).toMatchObject({
          helpfulChunkIds: ["document:doc-contract-1:0"],
        });
      },
    );

    expect(deps.ingestionPipeline.ingest).toHaveBeenCalledTimes(1);
  });

  it("vector update route maps Python contract unavailable to 503 and preserves provenance", async () => {
    const execute = vi.fn(async () => ({
      ok: false,
      action: "rag_ingestion_upsert",
      status: "unavailable",
      provenance: {
        provider: "fake",
        source: "contract-test",
      },
      lifecycle: {
        state: "active",
      },
      feedback: {
        helpfulChunkIds: [],
        irrelevantChunkIds: [],
      },
      deadLetter: {
        entryId: "dlq-upsert-1",
        retryCount: 0,
        stage: "store",
        error: "python unavailable",
      },
      error: {
        code: "python_rag_ingestion_unavailable",
        message: "RAG ingestion Python runtime is unavailable.",
        retryable: true,
      },
    }));

    await withApp(
      (app) =>
        app.use(
          "/api/vector-update",
          createVectorUpdateRouter({
            vectorUpdateAdapter: { execute } as any,
          }),
        ),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/vector-update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: "agent-1",
            token: "token-1",
            namespace: "tenant_alpha",
            projectId: "project-contract",
            selection: { ids: ["document:doc-contract-1:0"] },
            metadataPatch: { lifecycleState: "active" },
          }),
        });

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.status).toBe("unavailable");
        expect(body.provenance).toMatchObject({ source: "contract-test" });
        expect(body.deadLetter).toMatchObject({ stage: "store" });
      },
    );
  });

  it("vector delete route maps Python contract unavailable to 503 without real delete success", async () => {
    const execute = vi.fn(async () => ({
      ok: false,
      action: "rag_ingestion_delete",
      status: "unavailable",
      deletedIds: [],
      provenance: {
        provider: "fake",
        source: "contract-test",
      },
      lifecycle: {
        state: "pending_delete",
      },
      feedback: {
        helpfulChunkIds: [],
        irrelevantChunkIds: [],
      },
      deadLetter: {
        entryId: "dlq-delete-1",
        retryCount: 0,
        stage: "store",
        error: "python unavailable",
      },
      error: {
        code: "python_rag_ingestion_unavailable",
        message: "RAG ingestion Python runtime is unavailable.",
        retryable: true,
      },
    }));

    await withApp(
      (app) =>
        app.use(
          "/api/vector-delete",
          createVectorDeleteRouter({
            vectorDeleteAdapter: { execute } as any,
          }),
        ),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/vector-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: "agent-1",
            token: "token-1",
            namespace: "tenant_alpha",
            target: { ids: ["document:doc-contract-1:0"] },
            confirmation: { confirmed: true },
          }),
        });

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.status).toBe("unavailable");
        expect(body.deletedIds).toEqual([]);
        expect(body.provenance).toMatchObject({ source: "contract-test" });
        expect(body.lifecycle).toMatchObject({ state: "pending_delete" });
      },
    );
  });
});
