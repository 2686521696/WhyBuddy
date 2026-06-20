import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintGenerationRequest,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "../../../shared/blueprint/index.js";
import {
  createBlueprintRouter,
  createMemoryBlueprintJobStore,
} from "../blueprint.js";

const FIXED_TIMESTAMP = "2026-06-19T00:00:00.000Z";

function makeRequest(): BlueprintGenerationRequest {
  return {
    projectId: "project-1",
    sourceId: "source-1",
    targetText: "Build a user authentication system",
    githubUrls: [],
    clarificationSessionId: "session-1",
  };
}

function makeNode(id: string, title: string): BlueprintSpecTreeNode {
  return {
    id,
    title,
    summary: `${title} summary`,
    type: "route_step",
    status: "draft",
    priority: id === "node-1" ? 1 : 2,
    dependencies: [],
    outputs: [],
    children: [],
  };
}

function makeSpecTree(): BlueprintSpecTree {
  const nodes = [
    makeNode("node-1", "Authentication Module"),
    makeNode("node-2", "Session Store"),
  ];
  return {
    id: "tree-1",
    jobId: "job-1",
    version: 1,
    status: "draft",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    alternativeRouteIds: [],
    nodes,
    provenance: {
      jobId: "job-1",
      projectId: "project-1",
      sourceId: "source-1",
      targetText: "Build a user authentication system",
      githubUrls: [],
      generationSource: "template",
    },
  };
}

function makeJob(): BlueprintGenerationJob {
  const request = makeRequest();
  const specTree = makeSpecTree();
  const artifact: BlueprintGenerationArtifact = {
    id: "artifact-spec-tree",
    type: "spec_tree",
    title: "SPEC tree",
    summary: "Generated SPEC tree",
    createdAt: FIXED_TIMESTAMP,
    payload: specTree,
  };
  return {
    id: "job-1",
    projectId: "project-1",
    sourceId: "source-1",
    request,
    status: "pending",
    stage: "spec_tree",
    version: "v1",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    artifacts: [artifact],
    events: [],
  };
}

async function withBlueprintServer(
  job: BlueprintGenerationJob,
  handler: (input: {
    baseUrl: string;
    store: ReturnType<typeof createMemoryBlueprintJobStore>;
  }) => Promise<void>,
): Promise<void> {
  const store = createMemoryBlueprintJobStore([job]);
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/api/blueprint",
    createBlueprintRouter({
      jobStore: store,
      now: () => new Date(FIXED_TIMESTAMP),
    }),
  );

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
    await handler({ baseUrl, store });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("Blueprint spec-docs batch Python proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates batch generation to Python once and keeps artifact writes in Node", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test/");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-test");
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
      if (String(url).startsWith("http://python.test")) {
        return new Response(
          JSON.stringify({
            jobId: "job-1",
            overallSource: "llm",
            results: [
              {
                ok: true,
                nodeId: "node-1",
                targetDocumentType: "requirements",
                document: {
                  generationSource: "llm",
                  title: "Requirements: Authentication Module",
                  summary: "Python requirements summary",
                  content: "# Requirements: Authentication Module\n\nPython requirements\n",
                  status: "draft",
                  promptId: "blueprint.spec-documents.v1",
                  model: "python-blueprint-spec-docs-contract",
                  promptFingerprint: "sha256:req",
                  responseDigest: "sha256:req-resp",
                },
              },
              {
                ok: true,
                nodeId: "node-1",
                targetDocumentType: "design",
                document: {
                  generationSource: "llm",
                  title: "Design: Authentication Module",
                  summary: "Python design summary",
                  content: "# Design: Authentication Module\n\nPython design\n",
                  status: "draft",
                  promptId: "blueprint.spec-documents.v1",
                  model: "python-blueprint-spec-docs-contract",
                  promptFingerprint: "sha256:design",
                  responseDigest: "sha256:design-resp",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(url, init);
    }) as typeof fetch);

    await withBlueprintServer(makeJob(), async ({ baseUrl, store }) => {
      const response = await fetch(`${baseUrl}/api/blueprint/jobs/job-1/spec-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "node-1", types: ["requirements", "design"] }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.documents).toHaveLength(2);
      const documentsByType = new Map(
        body.documents.map((doc: { type: string; content: string }) => [doc.type, doc]),
      );
      expect(documentsByType.get("requirements")?.content).toBe(
        "# Requirements: Authentication Module\n\nPython requirements\n",
      );
      expect(documentsByType.get("design")?.content).toBe(
        "# Design: Authentication Module\n\nPython design\n",
      );
      expect(body.documents.every((doc: { provenance: { generationSource: string } }) =>
        doc.provenance.generationSource === "llm",
      )).toBe(true);
      expect(store.get("job-1")?.artifacts.filter((artifact) =>
        artifact.type === "requirements" || artifact.type === "design",
      )).toHaveLength(2);
    });

    const pythonCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).startsWith("http://python.test"),
    );
    expect(pythonCalls).toHaveLength(1);
    const [url, init] = pythonCalls[0];
    expect(url).toBe("http://python.test/api/blueprint/spec-documents/generate-batch");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": "internal-test",
    });
    const requestBody = JSON.parse(String((init as RequestInit).body));
    expect(requestBody.jobId).toBe("job-1");
    expect(requestBody.items.map((item: { nodeId: string; targetDocumentType: string }) => ({
      nodeId: item.nodeId,
      targetDocumentType: item.targetDocumentType,
    }))).toEqual([
      { nodeId: "node-1", targetDocumentType: "requirements" },
      { nodeId: "node-1", targetDocumentType: "design" },
    ]);
  });

  it("does not call Python when the proxy switch is disabled", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await withBlueprintServer(makeJob(), async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/blueprint/jobs/job-1/spec-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "node-1", types: ["requirements"] }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0].provenance.generationSource).toBe("template");
    });

    expect(fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("python.test") ||
      String(url).includes("/generate-batch"),
    )).toHaveLength(0);
  });

  it("preserves partial Python failures as per-document template fallback", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test");
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
      if (String(url).startsWith("http://python.test")) {
        return new Response(
          JSON.stringify({
            jobId: "job-1",
            overallSource: "partial",
            results: [
              {
                ok: true,
                nodeId: "node-1",
                targetDocumentType: "requirements",
                document: {
                  generationSource: "llm",
                  title: "Requirements: Authentication Module",
                  summary: "Python requirements summary",
                  content: "# Requirements: Authentication Module\n\nPython requirements\n",
                  status: "draft",
                  promptId: "blueprint.spec-documents.v1",
                  model: "python-blueprint-spec-docs-contract",
                  promptFingerprint: "sha256:req",
                  responseDigest: "sha256:req-resp",
                },
              },
              {
                ok: false,
                nodeId: "node-1",
                targetDocumentType: "design",
                error: "python item failed",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(url, init);
    }) as typeof fetch);

    await withBlueprintServer(makeJob(), async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/blueprint/jobs/job-1/spec-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "node-1", types: ["requirements", "design"] }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.documents).toHaveLength(2);
      const requirements = body.documents.find((doc: { type: string }) => doc.type === "requirements");
      const design = body.documents.find((doc: { type: string }) => doc.type === "design");
      expect(requirements.content).toBe("# Requirements: Authentication Module\n\nPython requirements\n");
      expect(requirements.provenance.generationSource).toBe("llm");
      expect(design.provenance.generationSource).toBe("llm_fallback");
      expect(design.provenance.error).toContain("python item failed");
      expect(design.content).toContain("Authentication Module summary");
    });
  });
});
