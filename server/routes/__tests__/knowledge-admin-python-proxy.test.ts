import express from "express";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphStore } from "../../knowledge/graph-store.js";
import { OntologyRegistry } from "../../knowledge/ontology-registry.js";
import { KnowledgeReviewQueue } from "../../knowledge/review-queue.js";
import { createKnowledgeAdminRouter } from "../knowledge-admin.js";

type TestDeps = {
  graphStore: GraphStore;
  ontologyRegistry: OntologyRegistry;
  reviewQueue: KnowledgeReviewQueue;
};

const ADMIN_ACTOR = {
  id: "admin-1",
  permissions: ["knowledge.admin"],
};

function createTestDeps(): TestDeps {
  const graphStore = new GraphStore();
  const ontologyRegistry = new OntologyRegistry();
  const reviewQueue = new KnowledgeReviewQueue(graphStore);
  return { graphStore, ontologyRegistry, reviewQueue };
}

async function withServer(
  handler: (baseUrl: string, deps: TestDeps) => Promise<void>,
): Promise<void> {
  const deps = createTestDeps();
  const app = express();
  app.use(express.json());
  app.use("/api/admin/knowledge", createKnowledgeAdminRouter(deps));
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
    await handler(baseUrl, deps);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function postProxy(baseUrl: string, body: Record<string, unknown>) {
  const url = new URL("/api/admin/knowledge/proxy", baseUrl);
  const payload = JSON.stringify(body);

  return new Promise<{ status: number; json: () => Promise<any> }>((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            json: async () => JSON.parse(text || "{}"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("knowledge admin Python proxy contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates list/upsert/delete to Python when proxy is enabled", async () => {
    vi.stubEnv("KNOWLEDGE_ADMIN_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-admin.test/");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-test");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          operation: "list",
          items: [{ id: "kb-1", title: "Python item" }],
          storage: "contract-only",
          migratedStorage: false,
          provenance: "python-knowledge-admin-contract",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await withServer(async (baseUrl) => {
      const res = await postProxy(baseUrl, {
        operation: "list",
        projectId: "project-1",
        actor: ADMIN_ACTOR,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        operation: "list",
        storage: "contract-only",
        migratedStorage: false,
        provenance: "python-knowledge-admin-contract",
      });
      expect(body.items).toEqual([{ id: "kb-1", title: "Python item" }]);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://python-admin.test/api/admin/knowledge/proxy");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": "internal-test",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      operation: "list",
      projectId: "project-1",
      actor: ADMIN_ACTOR,
    });
  });

  it("uses Node fallback when Python proxy is disabled without mutating storage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await withServer(async (baseUrl, deps) => {
      const upsert = await postProxy(baseUrl, {
        operation: "upsert",
        projectId: "project-legacy",
        actor: ADMIN_ACTOR,
        item: { id: "kb-1", title: "Legacy fallback" },
      });
      expect(upsert.status).toBe(200);
      expect(await upsert.json()).toMatchObject({
        ok: true,
        operation: "upsert",
        stored: false,
        storage: "node-fallback-contract",
        migratedStorage: false,
        provenance: "node-knowledge-admin-fallback-contract",
      });
      expect(deps.graphStore.getAllEntities("project-legacy")).toHaveLength(0);

      const list = await postProxy(baseUrl, {
        operation: "list",
        projectId: "project-legacy",
        actor: ADMIN_ACTOR,
      });
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({
        ok: true,
        operation: "list",
        items: [],
        storage: "node-fallback-contract",
        migratedStorage: false,
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to Node contract when Python is unavailable", async () => {
    vi.stubEnv("KNOWLEDGE_ADMIN_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-admin.test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));

    await withServer(async (baseUrl) => {
      const res = await postProxy(baseUrl, {
        operation: "delete",
        projectId: "project-1",
        actor: ADMIN_ACTOR,
        itemId: "kb-1",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        operation: "delete",
        deleted: false,
        deletedId: "kb-1",
        storage: "node-fallback-contract",
        migratedStorage: false,
        provenance: "node-knowledge-admin-fallback-contract",
        fallbackReason: expect.stringContaining("python proxy failed"),
      });
    });
  });

  it("does not convert Python permission failure into fallback success", async () => {
    vi.stubEnv("KNOWLEDGE_ADMIN_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-admin.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          operation: "upsert",
          error: "permission_denied",
          reason: "missing_knowledge_admin_permission",
          message: "knowledge admin permission denied",
          permissionFailure: true,
          statusCode: 403,
          provenance: "python-knowledge-admin-contract",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );

    await withServer(async (baseUrl) => {
      const res = await postProxy(baseUrl, {
        operation: "upsert",
        projectId: "project-1",
        actor: { id: "viewer-1", permissions: ["knowledge.read"] },
        item: { id: "kb-1", title: "Denied" },
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        ok: false,
        operation: "upsert",
        error: "permission_denied",
        reason: "missing_knowledge_admin_permission",
        message: "knowledge admin permission denied",
        permissionFailure: true,
        statusCode: 403,
        provenance: "python-knowledge-admin-contract",
      });
    });
  });
});
