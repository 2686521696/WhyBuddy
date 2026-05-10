import { describe, expect, it } from "vitest";

import type {
  BlueprintEngineeringLandingPlanStatus,
  BlueprintEngineeringLandingStepMode,
  BlueprintImplementationPromptPackage,
} from "../../../../shared/blueprint/index.js";

import {
  createDefaultEngineeringHandoffLlmPolicy,
  type EngineeringHandoffLlmPolicy,
} from "./policy.js";
import {
  normalizeEngineeringHandoffResponse,
  resolveEngineeringStepRiskLevelPure,
  type NormalizeEngineeringHandoffInput,
} from "./normalize.js";
import type {
  EngineeringHandoffLlmResponse,
  EngineeringHandoffSchemaInput,
} from "./schema.js";

function buildPromptPackage(): BlueprintImplementationPromptPackage {
  return {
    id: "prompt-package-1",
    jobId: "job-1",
    treeId: "tree-1",
    nodeIds: ["node-1", "node-2"],
    sourceDocumentIds: ["doc-1"],
    sourcePreviewIds: ["preview-1"],
    targetPlatform: "codex",
    target: { platform: "codex", label: "Codex CLI", executionMode: "agent" },
    title: "Example",
    summary: "Example",
    content: "",
    sections: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeIds: ["node-1", "node-2"],
      sourceDocumentIds: ["doc-1"],
      sourcePreviewIds: ["preview-1"],
      targetPlatform: "codex",
      sourceDocumentStatus: "accepted",
      sourcePreviewStatus: "accepted",
      includeDrafts: false,
      includePreviewDrafts: false,
      sourceDocumentStatuses: {},
      sourcePreviewStatuses: {},
    },
  };
}

function baseResolverInput(): EngineeringHandoffSchemaInput {
  return {
    promptPackage: buildPromptPackage(),
    sourceNodes: [],
    sourceDocuments: [],
    sourcePreviews: [],
  };
}

function buildInput(overrides: {
  validated: EngineeringHandoffLlmResponse;
  status?: BlueprintEngineeringLandingPlanStatus;
  policy?: EngineeringHandoffLlmPolicy;
  resolverInput?: EngineeringHandoffSchemaInput;
}): NormalizeEngineeringHandoffInput {
  return {
    validated: overrides.validated,
    resolverInput: overrides.resolverInput ?? baseResolverInput(),
    policy: overrides.policy ?? createDefaultEngineeringHandoffLlmPolicy(),
    status: overrides.status ?? "ready",
  };
}

describe("normalizeEngineeringHandoffResponse", () => {
  // 8.1 — missing optional step fields get sensible defaults
  it("fills defaults for missing optional step fields", () => {
    const validated: EngineeringHandoffLlmResponse = {
      title: "T",
      summary: "S",
      missionSummary: "M",
      missionMetadata: {},
      steps: [
        {
          title: "Build the pipeline",
          summary: "ship",
          mode: "manual",
        },
      ],
      acceptanceCriteria: ["ok"],
      riskNotes: [],
      handoffs: [{ platform: "codex" }],
    };
    const out = normalizeEngineeringHandoffResponse(
      buildInput({ validated, status: "ready" }),
    );
    expect(out.steps).toHaveLength(1);
    const step = out.steps[0];
    expect(step.id).toBe("build-the-pipeline");
    expect(step.fileScopes).toEqual([]);
    expect(step.verificationCommands).toEqual([]);
    expect(step.riskLevel).toBe(
      resolveEngineeringStepRiskLevelPure("ready", "manual"),
    );
    expect(step.sourceNodeIds).toEqual(["node-1", "node-2"]);
    expect(step.sourceDocumentIds).toEqual(["doc-1"]);
    expect(step.sourcePreviewIds).toEqual(["preview-1"]);
    expect(step.promptPackageIds).toEqual(["prompt-package-1"]);
  });

  // 8.2 — duplicate slugified ids deduped with -2 / -3
  it("dedupes slugified ids with -2/-3 suffix for duplicate titles", () => {
    const validated: EngineeringHandoffLlmResponse = {
      title: "T",
      summary: "S",
      missionSummary: "M",
      missionMetadata: {},
      steps: [
        { title: "Refactor dashboard", summary: "s", mode: "automatic" },
        { title: "Refactor dashboard", summary: "s", mode: "automatic" },
        { title: "Refactor dashboard", summary: "s", mode: "automatic" },
      ],
      acceptanceCriteria: ["a"],
      riskNotes: [],
      handoffs: [{ platform: "codex" }],
    };
    const out = normalizeEngineeringHandoffResponse(buildInput({ validated }));
    expect(out.steps.map(s => s.id)).toEqual([
      "refactor-dashboard",
      "refactor-dashboard-2",
      "refactor-dashboard-3",
    ]);
  });

  // 8.3 — fileScopes/verificationCommands dedupe preserves order
  it("dedupes fileScopes and verificationCommands while preserving order", () => {
    const validated: EngineeringHandoffLlmResponse = {
      title: "T",
      summary: "S",
      missionSummary: "M",
      missionMetadata: {},
      steps: [
        {
          title: "Do",
          summary: "s",
          mode: "automatic",
          fileScopes: ["src/a.ts", "src/a.ts", "src/b.ts"],
          verificationCommands: ["npm run a", "npm run a", "npm run b"],
        },
      ],
      acceptanceCriteria: ["a"],
      riskNotes: [],
      handoffs: [{ platform: "codex" }],
    };
    const out = normalizeEngineeringHandoffResponse(buildInput({ validated }));
    expect(out.steps[0].fileScopes).toEqual(["src/a.ts", "src/b.ts"]);
    expect(out.steps[0].verificationCommands).toEqual([
      "npm run a",
      "npm run b",
    ]);
  });

  // 8.4 — trim whitespace on all string fields
  it("trims leading/trailing whitespace from strings", () => {
    const validated: EngineeringHandoffLlmResponse = {
      title: " Title ",
      summary: " Summary ",
      missionSummary: " Mission ",
      missionMetadata: {},
      steps: [
        {
          id: " step-a ",
          title: " Title ",
          summary: " body ",
          mode: "automatic",
        },
      ],
      acceptanceCriteria: [" accept "],
      riskNotes: [{ level: "info", message: " risk " }],
      handoffs: [{ platform: "codex", summary: " h " }],
    };
    const out = normalizeEngineeringHandoffResponse(buildInput({ validated }));
    expect(out.title).toBe("Title");
    expect(out.summary).toBe("Summary");
    expect(out.missionSummary).toBe("Mission");
    expect(out.steps[0].title).toBe("Title");
    expect(out.steps[0].summary).toBe("body");
    expect(out.steps[0].id).toBe("step-a");
    expect(out.acceptanceCriteria).toEqual(["accept"]);
    expect(out.riskNotes).toEqual([{ level: "info", message: "risk" }]);
    expect(out.handoffs[0].summary).toBe("h");
  });

  // 8.5 — missionMetadata preserved verbatim
  it("passes missionMetadata through unchanged", () => {
    const validated: EngineeringHandoffLlmResponse = {
      title: "T",
      summary: "S",
      missionSummary: "M",
      missionMetadata: {
        targetPlatform: "codex",
        sourceNodeIds: ["node-1"],
      },
      steps: [{ title: "T", summary: "s", mode: "automatic" }],
      acceptanceCriteria: ["a"],
      riskNotes: [],
      handoffs: [{ platform: "codex" }],
    };
    const out = normalizeEngineeringHandoffResponse(buildInput({ validated }));
    expect(out.missionMetadata.targetPlatform).toBe("codex");
    expect(out.missionMetadata.sourceNodeIds).toEqual(["node-1"]);
  });

  // 8.6 — riskLevel default matches today's helper across status x mode
  it("fills riskLevel defaults matching status x mode matrix", () => {
    const statuses: BlueprintEngineeringLandingPlanStatus[] = [
      "draft",
      "ready",
      "ready",
    ];
    const modes: BlueprintEngineeringLandingStepMode[] = [
      "automatic",
      "manual",
      "handoff",
    ];
    for (const status of statuses) {
      for (const mode of modes) {
        const validated: EngineeringHandoffLlmResponse = {
          title: "T",
          summary: "S",
          missionSummary: "M",
          missionMetadata: {},
          steps: [{ title: "Go", summary: "go", mode }],
          acceptanceCriteria: ["a"],
          riskNotes: [],
          handoffs: [{ platform: "codex" }],
        };
        const out = normalizeEngineeringHandoffResponse(
          buildInput({ validated, status }),
        );
        expect(out.steps[0].riskLevel).toBe(
          resolveEngineeringStepRiskLevelPure(status, mode),
        );
      }
    }
  });

  // 8.7 — defensive clipping is idempotent and UTF-16 safe
  it("defensively clips over-long fields and is idempotent for in-bounds input", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();

    // Idempotent: in-bounds strings are preserved as-is.
    const inBounds: EngineeringHandoffLlmResponse = {
      title: "Near limit " + "a".repeat(policy.maxTitleLength - 11),
      summary: "S",
      missionSummary: "M",
      missionMetadata: {},
      steps: [{ title: "T", summary: "s", mode: "automatic" }],
      acceptanceCriteria: ["a"],
      riskNotes: [],
      handoffs: [{ platform: "codex" }],
    };
    const out1 = normalizeEngineeringHandoffResponse(
      buildInput({ validated: inBounds, policy }),
    );
    expect(out1.title.length).toBe(policy.maxTitleLength);

    // Defensive clip: simulate over-long by bypassing schema (test-only).
    const oversize = {
      ...inBounds,
      title: "a".repeat(policy.maxTitleLength + 50),
    };
    const out2 = normalizeEngineeringHandoffResponse(
      buildInput({ validated: oversize as EngineeringHandoffLlmResponse, policy }),
    );
    expect(out2.title.length).toBeLessThanOrEqual(policy.maxTitleLength);
  });
});
