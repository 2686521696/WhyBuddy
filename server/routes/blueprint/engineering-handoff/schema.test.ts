import { describe, expect, it } from "vitest";

import type {
  BlueprintEffectPreview,
  BlueprintImplementationPromptPackage,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

import {
  createEngineeringHandoffLlmResponseSchema,
  type EngineeringHandoffSchemaInput,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function buildPromptPackage(
  overrides: Partial<BlueprintImplementationPromptPackage> = {},
): BlueprintImplementationPromptPackage {
  return {
    id: "prompt-package-1",
    jobId: "job-1",
    treeId: "tree-1",
    nodeIds: ["node-1", "node-2"],
    sourceDocumentIds: ["doc-1"],
    sourcePreviewIds: ["preview-1"],
    targetPlatform: "codex",
    target: {
      platform: "codex",
      label: "Codex CLI",
      executionMode: "agent",
    },
    title: "Example package",
    summary: "Example summary",
    content: "Example content",
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
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<EngineeringHandoffSchemaInput> = {},
): EngineeringHandoffSchemaInput {
  return {
    promptPackage: buildPromptPackage(),
    sourceNodes: [] as BlueprintSpecTreeNode[],
    sourceDocuments: [] as BlueprintSpecDocument[],
    sourcePreviews: [] as BlueprintEffectPreview[],
    ...overrides,
  };
}

type MinimalPayload = {
  title: string;
  summary: string;
  missionSummary: string;
  missionMetadata?: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  acceptanceCriteria: string[];
  riskNotes: Array<Record<string, unknown>>;
  handoffs: Array<Record<string, unknown>>;
};

function minimalPayload(): MinimalPayload {
  return {
    title: "Deploy release",
    summary: "Ship a change safely.",
    missionSummary: "Ensure rollback plan is in place.",
    missionMetadata: {},
    steps: [
      {
        title: "Configure build",
        summary: "Prepare CI pipeline",
        mode: "automatic",
      },
    ],
    acceptanceCriteria: ["Smoke tests pass"],
    riskNotes: [],
    handoffs: [{ platform: "codex" }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createEngineeringHandoffLlmResponseSchema", () => {
  // 4.1 — minimal valid payload passes
  it("parses a minimal valid payload", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const parsed = schema.safeParse(minimalPayload());
    expect(parsed.success).toBe(true);
  });

  // 4.2 — full valid payload passes
  it("parses a full valid payload with all enum combinations", () => {
    const input = buildInput();
    const schema = createEngineeringHandoffLlmResponseSchema(input);
    const steps = Array.from({ length: 15 }, (_, i) => ({
      id: `step-${i}`,
      title: `Step ${i}`,
      summary: `Summary ${i}`,
      mode: ["automatic", "manual", "handoff"][i % 3],
      riskLevel: ["low", "medium", "high"][i % 3],
    }));
    const handoffs = [
      { platform: "codex", promptPackageId: input.promptPackage.id },
      { platform: "codex" },
      { platform: "codex" },
      { platform: "codex" },
      { platform: "codex" },
    ];
    const riskNotes = Array.from({ length: 8 }, (_, i) => ({
      level: ["info", "warning", "critical"][i % 3],
      message: `Risk ${i}`,
    }));
    const payload = {
      title: "Title",
      summary: "Summary",
      missionSummary: "Mission summary",
      steps,
      acceptanceCriteria: Array.from({ length: 10 }, (_, i) => `Criterion ${i}`),
      riskNotes,
      handoffs,
    };
    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  // 4.3 — missing required top-level fields fail
  it("fails when required top-level fields are missing", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const required = [
      "title",
      "summary",
      "missionSummary",
      "steps",
      "acceptanceCriteria",
      "handoffs",
    ] as const;
    for (const key of required) {
      const payload = minimalPayload() as Record<string, unknown>;
      delete payload[key];
      const parsed = schema.safeParse(payload);
      expect(parsed.success, `expected missing ${key} to fail`).toBe(false);
    }
  });

  // 4.4 — array bounds
  it("fails when arrays exceed min/max bounds", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    const emptySteps = { ...minimalPayload(), steps: [] };
    expect(schema.safeParse(emptySteps).success).toBe(false);

    const tooManySteps = {
      ...minimalPayload(),
      steps: Array.from({ length: 31 }, (_, i) => ({
        title: `t${i}`,
        summary: `s${i}`,
        mode: "automatic",
      })),
    };
    expect(schema.safeParse(tooManySteps).success).toBe(false);

    const emptyHandoffs = { ...minimalPayload(), handoffs: [] };
    expect(schema.safeParse(emptyHandoffs).success).toBe(false);

    const tooManyHandoffs = {
      ...minimalPayload(),
      handoffs: Array.from({ length: 11 }, () => ({ platform: "codex" })),
    };
    expect(schema.safeParse(tooManyHandoffs).success).toBe(false);

    const emptyAcceptance = { ...minimalPayload(), acceptanceCriteria: [] };
    expect(schema.safeParse(emptyAcceptance).success).toBe(false);

    const tooManyAcceptance = {
      ...minimalPayload(),
      acceptanceCriteria: Array.from({ length: 21 }, (_, i) => `c${i}`),
    };
    expect(schema.safeParse(tooManyAcceptance).success).toBe(false);

    const tooManyRiskNotes = {
      ...minimalPayload(),
      riskNotes: Array.from({ length: 21 }, () => ({
        level: "info",
        message: "x",
      })),
    };
    expect(schema.safeParse(tooManyRiskNotes).success).toBe(false);
  });

  // 4.5 — invalid enum values fail
  it("fails on invalid enum values", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    const badMode = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "invalid",
        },
      ],
    };
    expect(schema.safeParse(badMode).success).toBe(false);

    const badRiskLevel = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          riskLevel: "critical",
        },
      ],
    };
    expect(schema.safeParse(badRiskLevel).success).toBe(false);

    const badNoteLevel = {
      ...minimalPayload(),
      riskNotes: [{ level: "low", message: "x" }],
    };
    expect(schema.safeParse(badNoteLevel).success).toBe(false);

    const badPlatform = {
      ...minimalPayload(),
      handoffs: [{ platform: "openai" }],
    };
    expect(schema.safeParse(badPlatform).success).toBe(false);
  });

  // 4.6 — duplicate step ids (same-case)
  it("fails when steps[*].id is duplicated within the plan", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const payload = {
      ...minimalPayload(),
      steps: [
        {
          id: "step-1",
          title: "A",
          summary: "a",
          mode: "automatic",
        },
        {
          id: "step-1",
          title: "B",
          summary: "b",
          mode: "manual",
        },
      ],
    };
    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(i => i.message.toLowerCase());
      expect(messages.some(m => m.includes("unique") || m.includes("duplicate"))).toBe(true);
    }
  });

  // 4.7 — duplicate step ids (case / trim variant)
  it("fails when steps[*].id duplicates only after trim + lowercase", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const payload = {
      ...minimalPayload(),
      steps: [
        { id: "STEP-1", title: "A", summary: "a", mode: "automatic" },
        { id: " step-1 ", title: "B", summary: "b", mode: "manual" },
      ],
    };
    expect(schema.safeParse(payload).success).toBe(false);
  });

  // 4.8 — sourceNodeIds does not resolve
  it("fails when steps[*].sourceNodeIds references unknown node", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const payload = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          sourceNodeIds: ["unknown-node"],
        },
      ],
    };
    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const joined = parsed.error.issues.map(i => i.message).join(" ");
      expect(joined).toContain("unknown-node");
      expect(joined.toLowerCase()).toMatch(/resolve|unknown/);
    }
  });

  // 4.9 — sourceDocumentIds / sourcePreviewIds unresolved
  it("fails when sourceDocumentIds or sourcePreviewIds are unresolved", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    const docBad = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          sourceDocumentIds: ["unknown-doc"],
        },
      ],
    };
    expect(schema.safeParse(docBad).success).toBe(false);

    const previewBad = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          sourcePreviewIds: ["unknown-preview"],
        },
      ],
    };
    expect(schema.safeParse(previewBad).success).toBe(false);
  });

  // 4.10 — promptPackageIds must equal input.promptPackage.id
  it("fails when promptPackageIds contains a mismatch", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const payload = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          promptPackageIds: ["other-package"],
        },
      ],
    };
    expect(schema.safeParse(payload).success).toBe(false);
  });

  // 4.11 — handoffs[*].platform mismatch
  it("fails when handoffs[*].platform does not equal input.promptPackage.targetPlatform", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const payload = {
      ...minimalPayload(),
      handoffs: [{ platform: "claude" }],
    };
    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const joined = parsed.error.issues.map(i => i.message).join(" ");
      expect(joined).toContain("codex");
      expect(joined).toContain("claude");
    }
  });

  // 4.12 — handoffs[*].promptPackageId mismatch
  it("fails when handoffs[*].promptPackageId does not equal input.promptPackage.id", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const payload = {
      ...minimalPayload(),
      handoffs: [{ platform: "codex", promptPackageId: "other-package" }],
    };
    expect(schema.safeParse(payload).success).toBe(false);
  });

  // 4.13 — top-level whitespace-only strings
  it("fails when title/summary/missionSummary are whitespace-only", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    for (const key of ["title", "summary", "missionSummary"] as const) {
      const payload = { ...minimalPayload(), [key]: "   " };
      expect(schema.safeParse(payload).success, `${key} whitespace-only`).toBe(false);
    }
  });

  // 4.14 — whitespace-only strings in nested fields
  it("fails when nested strings are whitespace-only", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    const stepTitleBad = {
      ...minimalPayload(),
      steps: [{ title: "   ", summary: "s", mode: "automatic" }],
    };
    expect(schema.safeParse(stepTitleBad).success).toBe(false);

    const acceptanceBad = {
      ...minimalPayload(),
      acceptanceCriteria: ["   "],
    };
    expect(schema.safeParse(acceptanceBad).success).toBe(false);
  });

  // 4.15 — string length out of bounds
  it("fails when strings exceed max length", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    const tooLongTitle = { ...minimalPayload(), title: "a".repeat(201) };
    expect(schema.safeParse(tooLongTitle).success).toBe(false);

    const tooLongSummary = { ...minimalPayload(), summary: "a".repeat(501) };
    expect(schema.safeParse(tooLongSummary).success).toBe(false);

    const tooLongMission = { ...minimalPayload(), missionSummary: "a".repeat(1001) };
    expect(schema.safeParse(tooLongMission).success).toBe(false);

    const tooLongStepTitle = {
      ...minimalPayload(),
      steps: [
        { title: "a".repeat(201), summary: "s", mode: "automatic" },
      ],
    };
    expect(schema.safeParse(tooLongStepTitle).success).toBe(false);

    const tooLongAcceptance = {
      ...minimalPayload(),
      acceptanceCriteria: ["a".repeat(501)],
    };
    expect(schema.safeParse(tooLongAcceptance).success).toBe(false);
  });

  // 4.16 — nested array bounds
  it("fails when nested arrays exceed max length", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    const fileScopesTooMany = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          fileScopes: Array.from({ length: 51 }, (_, i) => `f${i}`),
        },
      ],
    };
    expect(schema.safeParse(fileScopesTooMany).success).toBe(false);

    const verificationTooMany = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          verificationCommands: Array.from({ length: 21 }, (_, i) => `v${i}`),
        },
      ],
    };
    expect(schema.safeParse(verificationTooMany).success).toBe(false);

    const sourceNodeIdsTooMany = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          sourceNodeIds: Array.from({ length: 51 }, (_, i) => `n${i}`),
        },
      ],
    };
    expect(schema.safeParse(sourceNodeIdsTooMany).success).toBe(false);

    const promptPackageIdsTooMany = {
      ...minimalPayload(),
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          promptPackageIds: Array.from({ length: 11 }, (_, i) => `p${i}`),
        },
      ],
    };
    expect(schema.safeParse(promptPackageIdsTooMany).success).toBe(false);
  });

  // 4.17 — missionMetadata default
  it("applies default for missionMetadata when empty or missing", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());

    const emptyObj = { ...minimalPayload(), missionMetadata: {} };
    expect(schema.safeParse(emptyObj).success).toBe(true);

    const payload = minimalPayload() as Record<string, unknown>;
    delete payload.missionMetadata;
    expect(schema.safeParse(payload).success).toBe(true);
  });

  // 4.18 — unknown fields are silently dropped (strip behavior)
  it("silently strips unknown top-level and nested fields", () => {
    const schema = createEngineeringHandoffLlmResponseSchema(buildInput());
    const payload = {
      ...minimalPayload(),
      author: "alice",
      extraData: { foo: "bar" },
      steps: [
        {
          title: "t",
          summary: "s",
          mode: "automatic",
          unknownStepField: 123,
        },
      ],
      handoffs: [{ platform: "codex", unknownHandoffField: true }],
      riskNotes: [{ level: "info", message: "x", unknownRiskField: "y" }],
      missionMetadata: { unknownMetaField: "z" },
    };
    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as unknown as { author?: string }).author).toBeUndefined();
      expect(
        (parsed.data.steps[0] as unknown as { unknownStepField?: unknown }).unknownStepField,
      ).toBeUndefined();
    }
  });
});
