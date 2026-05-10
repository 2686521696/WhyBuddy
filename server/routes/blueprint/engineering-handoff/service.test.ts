import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintEffectPreview,
  BlueprintGenerationJob,
  BlueprintImplementationPromptPackage,
  BlueprintSpecDocument,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

import type {
  BlueprintLlmDependencies,
  BlueprintLogger,
  BlueprintServiceContext,
} from "../context.js";

import { createEngineeringHandoffLlmService } from "./service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildPromptPackage(
  overrides: Partial<BlueprintImplementationPromptPackage> = {},
): BlueprintImplementationPromptPackage {
  return {
    id: "prompt-package-1",
    jobId: "job-1",
    treeId: "tree-1",
    nodeIds: ["node-1"],
    sourceDocumentIds: ["doc-1"],
    sourcePreviewIds: ["preview-1"],
    targetPlatform: "codex",
    target: { platform: "codex", label: "Codex CLI", executionMode: "agent" },
    title: "Package title",
    summary: "Package summary",
    content: "",
    sections: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeIds: ["node-1"],
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

function buildSpecTree(): BlueprintSpecTree {
  return {
    id: "tree-1",
    jobId: "job-1",
    version: 1,
    nodes: [
      {
        id: "node-1",
        title: "Example node",
        summary: "summary",
      } as BlueprintSpecTreeNode,
    ],
  } as unknown as BlueprintSpecTree;
}

function buildJob(): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: { targetText: "Deploy dashboard", githubUrls: [] },
  } as unknown as BlueprintGenerationJob;
}

function buildLogger(): BlueprintLogger & {
  calls: Array<{ level: "debug" | "info" | "warn" | "error"; message: string; meta?: Record<string, unknown> }>;
} {
  const calls: Array<{ level: "debug" | "info" | "warn" | "error"; message: string; meta?: Record<string, unknown> }> = [];
  return {
    debug: (m, meta) => calls.push({ level: "debug", message: m, meta }),
    info: (m, meta) => calls.push({ level: "info", message: m, meta }),
    warn: (m, meta) => calls.push({ level: "warn", message: m, meta }),
    error: (m, meta) => calls.push({ level: "error", message: m, meta }),
    calls,
  };
}

function buildMinimalCtx(options: {
  callJson: BlueprintLlmDependencies["callJson"];
  getConfig?: BlueprintLlmDependencies["getConfig"];
  logger?: BlueprintLogger & {
    calls: Array<{ level: string; message: string; meta?: Record<string, unknown> }>;
  };
}): BlueprintServiceContext & {
  logger: ReturnType<typeof buildLogger>;
} {
  const logger = options.logger ?? buildLogger();
  return {
    now: () => new Date(0),
    blueprintStores: {
      intakes: new Map(),
      clarificationSessions: new Map(),
      projectContexts: new Map(),
    },
    jobStore: {} as BlueprintServiceContext["jobStore"],
    llm: {
      callJson: options.callJson,
      getConfig:
        options.getConfig ??
        (() =>
          ({ model: "gpt-4-turbo", apiKey: "sk-test-key" }) as ReturnType<BlueprintLlmDependencies["getConfig"]>),
    },
    sandboxDerivationRunner: async () => ({ artifacts: [], events: [] }),
    replayStore: {} as BlueprintServiceContext["replayStore"],
    eventBus: { emit: () => undefined, subscribe: () => () => undefined },
    specsRoot: "",
    logger,
  } as BlueprintServiceContext & { logger: ReturnType<typeof buildLogger> };
}

function buildServiceInput(
  overrides: Partial<Parameters<ReturnType<typeof createEngineeringHandoffLlmService>>[0]> = {},
) {
  return {
    jobId: "job-1",
    job: buildJob(),
    specTree: buildSpecTree(),
    promptPackage: buildPromptPackage(),
    sourceNodes: [] as BlueprintSpecTreeNode[],
    sourceDocuments: [] as BlueprintSpecDocument[],
    sourcePreviews: [] as BlueprintEffectPreview[],
    status: "ready" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function happyPayload(
  promptPackageId = "prompt-package-1",
  platform = "codex",
): Record<string, unknown> {
  return {
    title: "Deploy dashboard",
    summary: "Ship the dashboard safely.",
    missionSummary: "Include rollback and monitoring.",
    missionMetadata: {},
    steps: [
      {
        title: "Configure build",
        summary: "Prepare the CI pipeline",
        mode: "automatic",
      },
    ],
    acceptanceCriteria: ["Smoke test passes"],
    riskNotes: [],
    handoffs: [{ platform, promptPackageId }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createEngineeringHandoffLlmService", () => {
  const ENV_KEY = "BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED";
  let originalEnabled: string | undefined;

  beforeEach(() => {
    originalEnabled = process.env[ENV_KEY];
    process.env[ENV_KEY] = "true";
  });

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnabled;
    }
  });

  // 14.1 — Happy path
  it("returns generationSource=llm with structured fields on valid LLM payload", async () => {
    const callJson = vi.fn().mockResolvedValue(happyPayload());
    const ctx = buildMinimalCtx({ callJson });
    const service = createEngineeringHandoffLlmService(ctx);
    const result = await service(buildServiceInput());

    expect(result.generationSource).toBe("llm");
    expect(result.renderedTitle).toBe("Deploy dashboard");
    expect(result.renderedSteps).toHaveLength(1);
    expect(result.renderedSummaryWithMissionPrefix).toContain(
      "**Mission summary**",
    );
    expect(result.promptId).toBe("blueprint.engineering-handoff.v1");
    expect(result.structuredPayloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.responseDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.promptFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.error).toBeUndefined();
  });

  // 14.2 — Malformed JSON
  it("falls back when callJson returns non-object values", async () => {
    for (const bad of [undefined, "garbage string", 42]) {
      const callJson = vi.fn().mockResolvedValue(bad);
      const ctx = buildMinimalCtx({ callJson });
      const service = createEngineeringHandoffLlmService(ctx);
      const result = await service(buildServiceInput());
      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/non-json response/);
      expect(result.renderedSteps).toBeUndefined();
    }
  });

  // 14.3 — Schema fails across diverse payloads
  it("falls back on schema violations", async () => {
    const scenarios: Array<{
      label: string;
      payload: Record<string, unknown>;
      errorContains?: RegExp;
    }> = [
      { label: "empty steps", payload: { ...happyPayload(), steps: [] } },
      { label: "empty handoffs", payload: { ...happyPayload(), handoffs: [] } },
      {
        label: "empty acceptance",
        payload: { ...happyPayload(), acceptanceCriteria: [] },
      },
      {
        label: "duplicate step id",
        payload: {
          ...happyPayload(),
          steps: [
            { id: "step-1", title: "a", summary: "a", mode: "automatic" },
            { id: "step-1", title: "b", summary: "b", mode: "manual" },
          ],
        },
        errorContains: /duplicate|unique/i,
      },
      {
        label: "invalid mode",
        payload: {
          ...happyPayload(),
          steps: [{ title: "t", summary: "s", mode: "unknown" }],
        },
      },
      {
        label: "unknown sourceNodeIds",
        payload: {
          ...happyPayload(),
          steps: [
            {
              title: "t",
              summary: "s",
              mode: "automatic",
              sourceNodeIds: ["ghost"],
            },
          ],
        },
        errorContains: /resolve|unknown/i,
      },
      {
        label: "platform mismatch",
        payload: {
          ...happyPayload("prompt-package-1", "claude"),
        },
        errorContains: /platform/i,
      },
      {
        label: "promptPackageId mismatch",
        payload: {
          ...happyPayload(),
          handoffs: [{ platform: "codex", promptPackageId: "other" }],
        },
      },
      {
        label: "whitespace title",
        payload: { ...happyPayload(), title: "   " },
      },
    ];
    for (const scenario of scenarios) {
      const callJson = vi.fn().mockResolvedValue(scenario.payload);
      const ctx = buildMinimalCtx({ callJson });
      const service = createEngineeringHandoffLlmService(ctx);
      const result = await service(buildServiceInput());
      expect(result.generationSource, scenario.label).toBe("llm_fallback");
      expect(result.error, scenario.label).toMatch(/schema validation failed/);
      if (scenario.errorContains) {
        expect(result.error, scenario.label).toMatch(scenario.errorContains);
      }
    }
  });

  // 14.4 — apiKey missing
  it("returns generationSource=template when apiKey is missing without calling callJson", async () => {
    const callJson = vi.fn();
    const ctx = buildMinimalCtx({
      callJson,
      getConfig: () =>
        ({ model: "gpt-4-turbo", apiKey: "" }) as ReturnType<BlueprintLlmDependencies["getConfig"]>,
    });
    const service = createEngineeringHandoffLlmService(ctx);
    const result = await service(buildServiceInput());
    expect(result.generationSource).toBe("template");
    expect(result.error).toBeUndefined();
    expect(result.promptId).toBeUndefined();
    expect(result.model).toBeUndefined();
    expect(callJson).not.toHaveBeenCalled();
  });

  // 14.5 — Not enabled
  it("returns generationSource=template when feature flag is not set", async () => {
    delete process.env[ENV_KEY];
    const callJson = vi.fn();
    const logger = buildLogger();
    const ctx = buildMinimalCtx({ callJson, logger });
    const service = createEngineeringHandoffLlmService(ctx);
    const result = await service(buildServiceInput());
    expect(result.generationSource).toBe("template");
    expect(callJson).not.toHaveBeenCalled();
    expect(logger.calls.some(c => c.level === "debug")).toBe(true);
  });

  // 14.6 — Timeout
  it("falls back with 'llm timeout' when callJson throws an abort/timeout error", async () => {
    const callJson = vi
      .fn()
      .mockRejectedValue(new Error("Request aborted due to timeout"));
    const ctx = buildMinimalCtx({ callJson });
    const service = createEngineeringHandoffLlmService(ctx);
    const result = await service(buildServiceInput());
    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error).toMatch(/llm timeout/);
  });

  // 14.7 — Redaction E2E
  it("redacts secrets from error strings and logger meta", async () => {
    const secretApiKey = "sk-ABCDEFGHIJKLMNOP1234567890";
    const secretEmail = "alice@example.com";
    const callJson = vi
      .fn()
      .mockRejectedValue(new Error(`failure ${secretApiKey} contact ${secretEmail}`));
    const logger = buildLogger();
    const ctx = buildMinimalCtx({ callJson, logger });
    const service = createEngineeringHandoffLlmService(ctx);
    const result = await service(buildServiceInput());
    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error ?? "").not.toContain(secretApiKey);
    expect(result.error ?? "").not.toContain(secretEmail);
    for (const call of logger.calls) {
      const serialized = JSON.stringify(call.meta ?? {});
      expect(serialized).not.toContain(secretApiKey);
      expect(serialized).not.toContain(secretEmail);
    }
  });

  // 14.8 — Per-plan isolation
  it("keeps per-plan results isolated across calls", async () => {
    const goodPayload = happyPayload();
    const callJson = vi
      .fn()
      .mockImplementation(async () => {
        if (callJson.mock.calls.length === 1) return goodPayload;
        throw new Error("second plan error");
      });
    const ctx = buildMinimalCtx({ callJson });
    const service = createEngineeringHandoffLlmService(ctx);
    const resultA = await service(buildServiceInput());
    const resultB = await service(
      buildServiceInput({ promptPackage: buildPromptPackage({ id: "prompt-package-2" }) }),
    );
    expect(resultA.generationSource).toBe("llm");
    expect(resultB.generationSource).toBe("llm_fallback");
    expect(resultA.error).toBeUndefined();
    expect(resultB.error).toMatch(/second plan error/);
    expect(resultA.promptFingerprint).not.toBe(resultB.promptFingerprint);
  });

  // 14.9 — Platform mismatch recovery
  it("detects platform mismatch and surfaces it in the error", async () => {
    const payload = happyPayload("prompt-package-1", "claude");
    const callJson = vi.fn().mockResolvedValue(payload);
    const ctx = buildMinimalCtx({ callJson });
    const service = createEngineeringHandoffLlmService(ctx);
    const result = await service(buildServiceInput());
    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error ?? "").toMatch(/platform/i);
  });

  // 14.10 — Logger meta includes promptPackageId
  it("logger meta always includes promptPackageId for per-plan triage", async () => {
    const callJson = vi.fn().mockRejectedValue(new Error("something"));
    const logger = buildLogger();
    const ctx = buildMinimalCtx({ callJson, logger });
    const service = createEngineeringHandoffLlmService(ctx);
    await service(buildServiceInput());
    expect(
      logger.calls.some(
        c =>
          c.level === "warn" &&
          c.meta !== undefined &&
          (c.meta as Record<string, unknown>).promptPackageId ===
            "prompt-package-1",
      ),
    ).toBe(true);
  });
});
