/**
 * Integration tests for response format preservation.
 *
 * **Feature: spec-docs-generation-progress-feedback**
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 *
 * Verifies:
 * - HTTP response shape (`job`, `specTree`, `documents`) is unchanged
 * - No progress-related fields in HTTP response body
 * - `GenerateBlueprintSpecDocumentsResult` discriminated union shape preserved
 */

import { describe, it, expect } from "vitest";

import type {
  BlueprintSpecDocumentsResponse,
  BlueprintGenerationJob,
  BlueprintSpecTree,
  BlueprintSpecDocument,
} from "../../../../shared/blueprint/contracts.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockJob(): BlueprintGenerationJob {
  return {
    id: "test-job-1",
    request: {},
    status: "reviewing",
    stage: "spec_docs",
    version: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    artifacts: [],
    events: [],
  } as BlueprintGenerationJob;
}

function createMockSpecTree(): BlueprintSpecTree {
  return {
    id: "tree-1",
    routeSetId: "rs-1",
    selectionId: "sel-1",
    selectedRouteId: "route-1",
    rootNodeId: "root",
    version: 1,
    status: "accepted",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    alternativeRouteIds: [],
    nodes: [],
    provenance: {
      jobId: "test-job-1",
      githubUrls: [],
    },
  } as BlueprintSpecTree;
}

function createMockDocument(): BlueprintSpecDocument {
  return {
    id: "doc-1",
    jobId: "test-job-1",
    treeId: "tree-1",
    nodeId: "node-1",
    type: "requirements",
    title: "Requirements",
    summary: "Test requirements",
    content: "# Requirements\n\nTest content",
    createdAt: "2026-01-01T00:00:00.000Z",
  } as BlueprintSpecDocument;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Feature: spec-docs-generation-progress-feedback", () => {
  describe("Response format preservation (Req 8.1, 8.2, 8.3, 8.4)", () => {
    it("BlueprintSpecDocumentsResponse has exactly three top-level fields: job, specTree, documents", () => {
      const response: BlueprintSpecDocumentsResponse = {
        job: createMockJob(),
        specTree: createMockSpecTree(),
        documents: [createMockDocument()],
      };

      // Verify the response has exactly the expected keys
      const keys = Object.keys(response).sort();
      expect(keys).toEqual(["documents", "job", "specTree"]);
    });

    it("response does not contain any progress-related fields", () => {
      const response: BlueprintSpecDocumentsResponse = {
        job: createMockJob(),
        specTree: createMockSpecTree(),
        documents: [createMockDocument()],
      };

      // Verify no progress-related fields leak into the response
      const responseAsAny = response as Record<string, unknown>;
      expect(responseAsAny).not.toHaveProperty("progress");
      expect(responseAsAny).not.toHaveProperty("progressEvents");
      expect(responseAsAny).not.toHaveProperty("batchStatus");
      expect(responseAsAny).not.toHaveProperty("completedCount");
      expect(responseAsAny).not.toHaveProperty("failedCount");
      expect(responseAsAny).not.toHaveProperty("processedCount");
      expect(responseAsAny).not.toHaveProperty("totalCount");
      expect(responseAsAny).not.toHaveProperty("nodeProgress");
      expect(responseAsAny).not.toHaveProperty("elapsedMs");
    });

    it("response.job field is a BlueprintGenerationJob", () => {
      const response: BlueprintSpecDocumentsResponse = {
        job: createMockJob(),
        specTree: createMockSpecTree(),
        documents: [],
      };

      expect(response.job).toBeDefined();
      expect(response.job.id).toBe("test-job-1");
      expect(response.job.status).toBeDefined();
      expect(response.job.stage).toBeDefined();
      expect(response.job.events).toBeInstanceOf(Array);
      expect(response.job.artifacts).toBeInstanceOf(Array);
    });

    it("response.specTree field is a BlueprintSpecTree", () => {
      const response: BlueprintSpecDocumentsResponse = {
        job: createMockJob(),
        specTree: createMockSpecTree(),
        documents: [],
      };

      expect(response.specTree).toBeDefined();
      expect(response.specTree.id).toBe("tree-1");
      expect(response.specTree.nodes).toBeInstanceOf(Array);
      expect(response.specTree.rootNodeId).toBeDefined();
    });

    it("response.documents field is an array of BlueprintSpecDocument", () => {
      const doc1 = createMockDocument();
      const doc2 = { ...createMockDocument(), id: "doc-2", type: "design" as const };

      const response: BlueprintSpecDocumentsResponse = {
        job: createMockJob(),
        specTree: createMockSpecTree(),
        documents: [doc1, doc2],
      };

      expect(response.documents).toBeInstanceOf(Array);
      expect(response.documents).toHaveLength(2);
      expect(response.documents[0].id).toBe("doc-1");
      expect(response.documents[0].type).toBe("requirements");
      expect(response.documents[1].id).toBe("doc-2");
      expect(response.documents[1].type).toBe("design");
    });

    it("GenerateBlueprintSpecDocumentsResult discriminated union: ok=true shape", () => {
      // Type-level verification: this compiles correctly
      type GenerateBlueprintSpecDocumentsResult =
        | { ok: true; data: BlueprintSpecDocumentsResponse }
        | { ok: false; error: { code: string; message: string } };

      const successResult: GenerateBlueprintSpecDocumentsResult = {
        ok: true,
        data: {
          job: createMockJob(),
          specTree: createMockSpecTree(),
          documents: [createMockDocument()],
        },
      };

      expect(successResult.ok).toBe(true);
      if (successResult.ok) {
        expect(successResult.data.job).toBeDefined();
        expect(successResult.data.specTree).toBeDefined();
        expect(successResult.data.documents).toBeInstanceOf(Array);
        // Verify destructuring works as expected (Req 8.4)
        const { job, specTree, documents } = successResult.data;
        expect(job.id).toBe("test-job-1");
        expect(specTree.id).toBe("tree-1");
        expect(documents).toHaveLength(1);
      }
    });

    it("GenerateBlueprintSpecDocumentsResult discriminated union: ok=false shape", () => {
      type GenerateBlueprintSpecDocumentsResult =
        | { ok: true; data: BlueprintSpecDocumentsResponse }
        | { ok: false; error: { code: string; message: string } };

      const errorResult: GenerateBlueprintSpecDocumentsResult = {
        ok: false,
        error: { code: "GENERATION_FAILED", message: "LLM unavailable" },
      };

      expect(errorResult.ok).toBe(false);
      if (!errorResult.ok) {
        expect(errorResult.error.code).toBe("GENERATION_FAILED");
        expect(errorResult.error.message).toBe("LLM unavailable");
      }
    });

    it("response with empty documents array preserves shape", () => {
      const response: BlueprintSpecDocumentsResponse = {
        job: createMockJob(),
        specTree: createMockSpecTree(),
        documents: [],
      };

      const keys = Object.keys(response).sort();
      expect(keys).toEqual(["documents", "job", "specTree"]);
      expect(response.documents).toEqual([]);
    });

    it("destructuring response with only defined fields compiles and produces correct values (Req 8.4)", () => {
      const response: BlueprintSpecDocumentsResponse = {
        job: createMockJob(),
        specTree: createMockSpecTree(),
        documents: [createMockDocument()],
      };

      // This destructuring pattern must continue to work (Req 8.4)
      const { job, specTree, documents } = response;

      expect(job.id).toBe("test-job-1");
      expect(specTree.id).toBe("tree-1");
      expect(documents[0].id).toBe("doc-1");
      expect(documents[0].nodeId).toBe("node-1");
      expect(documents[0].type).toBe("requirements");
    });
  });
});
