import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBlueprintRouter,
  createMemoryBlueprintJobStore,
  type BlueprintJobStore,
} from "../blueprint.js";
import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "../../../shared/blueprint/index.js";

const FIXED_NOW = "2026-06-20T00:00:00.000Z";

async function withServer(
  jobStore: BlueprintJobStore,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/blueprint",
    createBlueprintRouter({
      jobStore,
      now: () => new Date(FIXED_NOW),
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
  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function makeSpecTree(): BlueprintSpecTree {
  return {
    id: "tree-1",
    jobId: "job-1",
    rootNodeId: "node-1",
    version: 1,
    nodes: [
      {
        id: "node-1",
        title: "Authentication Module",
        summary: "Handles login and session management",
        type: "route_step",
        status: "draft",
        priority: 1,
        dependencies: [],
        outputs: [],
        children: [],
      },
    ],
    provenance: {
      jobId: "job-1",
      githubUrls: [],
    },
  };
}

function makeDocument(): BlueprintSpecDocument {
  return {
    id: "doc-1",
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: "node-1",
    type: "requirements",
    status: "draft",
    version: 1,
    sourceDocumentId: "doc-1",
    title: "Requirements Authentication Module",
    summary: "Spec document summary",
    content: "# Requirements Authentication Module\n\nContract body\n",
    format: "markdown",
    createdAt: "2026-06-19T00:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "route_step",
      nodeTitle: "Authentication Module",
      nodeSummary: "Handles login and session management",
      dependencies: [],
      outputs: [],
      generationSource: "template",
    },
  };
}

function makeJob(): BlueprintGenerationJob {
  const specTree = makeSpecTree();
  const document = makeDocument();
  const artifacts: BlueprintGenerationArtifact[] = [
    {
      id: "artifact-tree",
      type: "spec_tree",
      title: "SPEC tree",
      summary: "Tree",
      createdAt: "2026-06-19T00:00:00.000Z",
      payload: specTree,
    },
    {
      id: "artifact-doc-1",
      type: "requirements",
      title: document.title,
      summary: document.summary,
      createdAt: document.createdAt,
      payload: document,
    },
  ];

  return {
    id: "job-1",
    request: {
      projectId: "project-1",
      sourceId: "source-1",
      targetText: "Build authentication",
      githubUrls: [],
    },
    status: "reviewing",
    stage: "spec_docs",
    version: "v1",
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    artifacts,
    events: [],
  };
}

describe("Blueprint review/export Python proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates SPEC document review to Python when the proxy switch is enabled", async () => {
    vi.stubEnv("BLUEPRINT_REVIEW_EXPORT_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-review.test/");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-review");
    const pythonDocument = {
      ...makeDocument(),
      status: "accepted",
      updatedAt: FIXED_NOW,
      reviewedAt: FIXED_NOW,
      acceptedAt: FIXED_NOW,
      reviewedBy: "reviewer-1",
      reviewNote: "Ready",
    };
    const pythonJob = {
      ...makeJob(),
      updatedAt: FIXED_NOW,
      artifacts: makeJob().artifacts.map((artifact) =>
        artifact.type === "requirements" ? { ...artifact, payload: pythonDocument } : artifact,
      ),
    };
    const originalFetch = globalThis.fetch.bind(globalThis);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("http://127.0.0.1:")) {
        return originalFetch(input, init);
      }
      return new Response(
        JSON.stringify({
          job: pythonJob,
          specTree: makeSpecTree(),
          document: pythonDocument,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const jobStore = createMemoryBlueprintJobStore([makeJob()]);

    await withServer(jobStore, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/blueprint/jobs/job-1/spec-documents/doc-1/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "accepted",
            reviewedBy: "reviewer-1",
            reviewNote: "Ready",
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(body.document.status).toBe("accepted");
      expect(jobStore.get("job-1")?.updatedAt).toBe(FIXED_NOW);
      const pythonCalls = fetchSpy.mock.calls.filter(
        ([url]) => !String(url instanceof Request ? url.url : url).startsWith("http://127.0.0.1:"),
      );
      expect(pythonCalls).toHaveLength(1);
      const [url, init] = pythonCalls[0];
      expect(url).toBe("http://python-review.test/api/blueprint/spec-documents/review");
      expect((init as RequestInit).headers).toMatchObject({
        "Content-Type": "application/json",
        "X-Internal-Key": "internal-review",
      });
      const payload = JSON.parse(String((init as RequestInit).body));
      expect(payload.documentId).toBe("doc-1");
      expect(payload.request.status).toBe("accepted");
      expect(payload.job.id).toBe("job-1");
      expect(payload.specTree.id).toBe("tree-1");
      expect(payload.now).toBe(FIXED_NOW);
    });
  });

  it("propagates Python export permission failures instead of falling back to Node export", async () => {
    vi.stubEnv("BLUEPRINT_REVIEW_EXPORT_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-export.test");
    const originalFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("http://127.0.0.1:")) {
        return originalFetch(input, init);
      }
      return new Response(JSON.stringify({ detail: "Invalid key" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    });
    const jobStore = createMemoryBlueprintJobStore([makeJob()]);

    await withServer(jobStore, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/blueprint/jobs/job-1/spec-documents/export?granularity=single&nodeId=node-1&type=requirements`,
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe("python review/export proxy failed");
      expect(JSON.stringify(body)).not.toContain("Contract body");
    });
  });

  it("falls back to the Node export when the Python proxy is unreachable", async () => {
    vi.stubEnv("BLUEPRINT_REVIEW_EXPORT_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-export.test");
    const originalFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("http://127.0.0.1:")) {
        return originalFetch(input, init);
      }
      throw new Error("connect ECONNREFUSED 127.0.0.1:9700");
    });
    const jobStore = createMemoryBlueprintJobStore([makeJob()]);

    await withServer(jobStore, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/blueprint/jobs/job-1/spec-documents/export?granularity=single&nodeId=node-1&type=requirements`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      expect(await response.text()).toContain("Contract body");
    });
  });

  it("uses the existing Node export path when the Python proxy switch is disabled", async () => {
    vi.stubEnv("BLUEPRINT_REVIEW_EXPORT_PYTHON_PROXY", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const jobStore = createMemoryBlueprintJobStore([makeJob()]);

    await withServer(jobStore, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/blueprint/jobs/job-1/spec-documents/export?granularity=single&nodeId=node-1&type=requirements`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      expect(response.headers.get("content-disposition")).toContain("requirements.md");
      expect(await response.text()).toContain("Contract body");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toContain("/api/blueprint/jobs/job-1/spec-documents/export");
    });
  });
});
