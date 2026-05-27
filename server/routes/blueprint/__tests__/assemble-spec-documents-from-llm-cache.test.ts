/**
 * Unit tests for `assembleSpecDocumentsFromLlmCache`.
 *
 * **Feature: spec-docs-runtime-perception-double-pass**
 * **Validates: Requirements 2, 2.3, 3.2, 3.6**
 *
 * Preconditions (documented here per Task 3.4 case (d)):
 * - The helper assumes `args.llmOutput.generationSource === "llm"`.
 * - The helper assumes that for every `type` in `args.targetTypes`,
 *   `pickSpecDocsLlmMarkdownForType(args.llmOutput, type)` returns a non-empty string.
 * - Pre-validation of these preconditions is the call site's responsibility,
 *   NOT the helper's. The helper does NOT re-check them.
 */

import { describe, it, expect } from "vitest";

import { assembleSpecDocumentsFromLlmCache } from "../assemble-spec-documents-from-llm-cache.js";
import type { SpecDocsLlmNodeOutput } from "../spec-docs-llm-generation.js";
import type {
  BlueprintClarificationSession,
  BlueprintGenerationJob,
  BlueprintProjectDomainContext,
  BlueprintRoleTimelineEntry,
  BlueprintRouteCandidate,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/contracts.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function createMockJob(): BlueprintGenerationJob {
  return {
    id: "job-001",
    projectId: "project-001",
    sourceId: "source-001",
    request: {
      targetText: "Build a user authentication system",
      githubUrls: ["https://github.com/example/repo"],
    },
    status: "completed",
    stage: "spec_documents",
    version: "1.0.0",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    artifacts: [],
    events: [],
  } as unknown as BlueprintGenerationJob;
}

function createMockSpecTree(): BlueprintSpecTree {
  return {
    id: "tree-001",
    routeSetId: "routeset-001",
    selectionId: "selection-001",
    selectedRouteId: "route-001",
    rootNodeId: "node-root",
    version: 3,
    status: "ready",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    alternativeRouteIds: [],
    nodes: [],
    provenance: {
      jobId: "job-001",
      githubUrls: [],
    },
  } as unknown as BlueprintSpecTree;
}

function createMockNode(): BlueprintSpecTreeNode {
  return {
    id: "node-auth",
    title: "User Authentication",
    summary: "Handles user login and registration",
    type: "feature",
    status: "ready",
    priority: 1,
    dependencies: ["node-db", "node-config"],
    outputs: ["auth-module"],
    children: [],
  } as BlueprintSpecTreeNode;
}

function createMockLlmOutput(): SpecDocsLlmNodeOutput {
  return {
    nodeId: "node-auth",
    generationSource: "llm",
    contextTier: "full",
    requirements: "# Requirements\n\nUser authentication requirements...",
    design: "# Design\n\nAuthentication design document...",
    tasks: "# Tasks\n\n- [ ] Implement login\n- [ ] Implement registration",
    promptId: "blueprint.spec-documents.v1",
    model: "gpt-4o-2024-05-13",
    promptFingerprint: "sha256:abc123def456",
    responseDigest: "sha256:789xyz000111",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("assembleSpecDocumentsFromLlmCache", () => {
  const createdAt = "2026-05-01T12:00:00.000Z";

  // Case (a): All 3 doc types produce 3 BlueprintSpecDocument with correct type discriminators
  it("builds 3 documents from all 3 target types with correct type discriminators", () => {
    const targetTypes: BlueprintSpecDocumentType[] = [
      "requirements",
      "design",
      "tasks",
    ];

    const result = assembleSpecDocumentsFromLlmCache({
      job: createMockJob(),
      specTree: createMockSpecTree(),
      node: createMockNode(),
      llmOutput: createMockLlmOutput(),
      primaryRoute: undefined,
      createdAt,
      previousRoleFindings: undefined,
      clarificationSession: undefined,
      domainContext: undefined,
      targetTypes,
    });

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("requirements");
    expect(result[1].type).toBe("design");
    expect(result[2].type).toBe("tasks");

    // Each document has a unique id
    const ids = result.map((d) => d.id);
    expect(new Set(ids).size).toBe(3);

    // Each id starts with the expected prefix
    for (const doc of result) {
      expect(doc.id).toMatch(/^blueprint-spec-document-/);
    }

    // Titles follow the pattern "Label: NodeTitle"
    expect(result[0].title).toBe("Requirements: User Authentication");
    expect(result[1].title).toBe("Design: User Authentication");
    expect(result[2].title).toBe("Tasks: User Authentication");

    // Content matches the LLM output
    expect(result[0].content).toBe(
      "# Requirements\n\nUser authentication requirements...",
    );
    expect(result[1].content).toBe(
      "# Design\n\nAuthentication design document...",
    );
    expect(result[2].content).toBe(
      "# Tasks\n\n- [ ] Implement login\n- [ ] Implement registration",
    );

    // Common fields
    for (const doc of result) {
      expect(doc.jobId).toBe("job-001");
      expect(doc.treeId).toBe("tree-001");
      expect(doc.nodeId).toBe("node-auth");
      expect(doc.status).toBe("draft");
      expect(doc.version).toBe(1);
      expect(doc.sourceDocumentId).toBe(doc.id);
      expect(doc.summary).toBe("Handles user login and registration");
      expect(doc.format).toBe("markdown");
      expect(doc.createdAt).toBe(createdAt);
      expect(doc.updatedAt).toBe(createdAt);
    }
  });

  // Case (b): Provenance fields carried through from llmOutput
  it("carries provenance fields from llmOutput unchanged", () => {
    const llmOutput = createMockLlmOutput();
    const targetTypes: BlueprintSpecDocumentType[] = [
      "requirements",
      "design",
      "tasks",
    ];

    const result = assembleSpecDocumentsFromLlmCache({
      job: createMockJob(),
      specTree: createMockSpecTree(),
      node: createMockNode(),
      llmOutput,
      primaryRoute: undefined,
      createdAt,
      previousRoleFindings: undefined,
      clarificationSession: undefined,
      domainContext: undefined,
      targetTypes,
    });

    for (const doc of result) {
      expect(doc.provenance.generationSource).toBe("llm");
      expect(doc.provenance.promptId).toBe("blueprint.spec-documents.v1");
      expect(doc.provenance.model).toBe("gpt-4o-2024-05-13");
      expect(doc.provenance.promptFingerprint).toBe("sha256:abc123def456");
      expect(doc.provenance.responseDigest).toBe("sha256:789xyz000111");

      // Job-level provenance
      expect(doc.provenance.jobId).toBe("job-001");
      expect(doc.provenance.projectId).toBe("project-001");
      expect(doc.provenance.sourceId).toBe("source-001");
      expect(doc.provenance.targetText).toBe(
        "Build a user authentication system",
      );
      expect(doc.provenance.githubUrls).toEqual([
        "https://github.com/example/repo",
      ]);

      // Tree-level provenance
      expect(doc.provenance.treeVersion).toBe(3);

      // Node-level provenance
      expect(doc.provenance.nodeType).toBe("feature");
      expect(doc.provenance.nodeTitle).toBe("User Authentication");
      expect(doc.provenance.nodeSummary).toBe(
        "Handles user login and registration",
      );
      expect(doc.provenance.dependencies).toEqual(["node-db", "node-config"]);
      expect(doc.provenance.outputs).toEqual(["auth-module"]);
    }
  });

  // Case (c): targetTypes subset ["requirements"] builds exactly 1 document
  it("builds exactly 1 document when targetTypes is ['requirements']", () => {
    const result = assembleSpecDocumentsFromLlmCache({
      job: createMockJob(),
      specTree: createMockSpecTree(),
      node: createMockNode(),
      llmOutput: createMockLlmOutput(),
      primaryRoute: undefined,
      createdAt,
      previousRoleFindings: undefined,
      clarificationSession: undefined,
      domainContext: undefined,
      targetTypes: ["requirements"],
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("requirements");
    expect(result[0].content).toBe(
      "# Requirements\n\nUser authentication requirements...",
    );
  });

  // Case (d): Preconditions documented — see file-level JSDoc comment above.
  // The helper is synchronous: no async, no Promise wrapping (Task 3.3).
  it("returns synchronously (no Promise wrapping)", () => {
    const result = assembleSpecDocumentsFromLlmCache({
      job: createMockJob(),
      specTree: createMockSpecTree(),
      node: createMockNode(),
      llmOutput: createMockLlmOutput(),
      primaryRoute: undefined,
      createdAt,
      previousRoleFindings: undefined,
      clarificationSession: undefined,
      domainContext: undefined,
      targetTypes: ["requirements", "design", "tasks"],
    });

    // The result is a plain array, not a Promise
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("populates reusedRoleFindingIds from previousRoleFindings", () => {
    const previousRoleFindings: BlueprintRoleTimelineEntry[] = [
      {
        id: "finding-1",
        eventId: "event-1",
        jobId: "job-001",
        stage: "spec_documents",
        roleId: "role-planner",
        presenceState: "active",
        type: "stage_started",
        occurredAt: "2026-05-01T00:00:00.000Z",
        summary: "Planning started",
        evidenceId: "evidence-1",
        sourceIds: {
          capabilityEvidenceIds: ["cap-ev-1", "cap-ev-2"],
        },
      } as unknown as BlueprintRoleTimelineEntry,
    ];

    const result = assembleSpecDocumentsFromLlmCache({
      job: createMockJob(),
      specTree: createMockSpecTree(),
      node: createMockNode(),
      llmOutput: createMockLlmOutput(),
      primaryRoute: undefined,
      createdAt,
      previousRoleFindings,
      clarificationSession: undefined,
      domainContext: undefined,
      targetTypes: ["requirements"],
    });

    expect(result[0].provenance.reusedRoleFindingIds).toEqual(["finding-1"]);
    expect(result[0].provenance.reusedRoleIds).toEqual(["role-planner"]);
    expect(result[0].provenance.reusedEvidenceIds).toEqual([
      "evidence-1",
      "cap-ev-1",
      "cap-ev-2",
    ]);
  });
});
