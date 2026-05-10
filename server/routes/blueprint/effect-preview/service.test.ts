/**
 * Example-based unit tests for `createEffectPreviewLlmService(ctx)`.
 *
 * Validates: Requirements 5.3, 9.2
 *
 * Covers R9.2 four hard requirements + ~4 supplementary tests (task 12):
 *
 *  12.1 Happy path (R9.2 happy) — fake `callJson` returns a schema-valid
 *       payload → `generationSource === "llm"`, content fields populated,
 *       `promptId === "blueprint.effect-preview.v1"`,
 *       `structuredPayloadDigest` matches sha256 shape, `error` undefined.
 *  12.2 Malformed JSON (R9.2 malformed) — `callJson` returns undefined /
 *       non-object → `"llm_fallback"` with `error` matching
 *       `/non-json response/` and content fields all undefined.
 *  12.3 Schema fails (R9.2 schema-fail) — multiple sub-scenarios where the
 *       payload is structurally invalid per
 *       `EffectPreviewLlmResponseSchema` → `"llm_fallback"` with
 *       `"schema validation failed"` or constraint-specific tokens.
 *  12.4 ApiKey missing (R9.2 apiKey-missing) — fake `getConfig` returns
 *       empty apiKey → `generationSource === "template"`, `callJson` spy
 *       never called, `error / promptId / model` all undefined.
 *  12.5 Not enabled — `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED` unset →
 *       `"template"` + spy never called + `ctx.logger.debug` invoked.
 *  12.6 Timeout — `callJson` throws `"Request aborted due to timeout"` →
 *       `"llm_fallback"` with `error` matching `/llm timeout/`.
 *  12.7 Redaction E2E — thrown error containing an `sk-...` key literal
 *       is redacted so `result.error` does not contain the original
 *       substring.
 *  12.8 Per-preview isolation — two successive calls on the same service
 *       instance keep `generationSource / error / promptFingerprint /
 *       responseDigest` independent (no closure state leakage; validates
 *       requirement 4.7).
 *
 * All tests run entirely in-process via a fake `ctx` constructed per-test:
 *  - No real LLM calls.
 *  - No real network / HTTP requests.
 *  - No reliance on the real `process.env` beyond `vi.stubEnv` /
 *    `vi.unstubAllEnvs` wrapping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintClarificationSession,
  BlueprintGenerationJob,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

import type { BlueprintServiceContext } from "../context.js";
import { createDefaultEffectPreviewLlmPolicy } from "./policy.js";
import { createEffectPreviewLlmService } from "./service.js";
import type { EffectPreviewLlmServiceInput } from "./service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_API_KEY = "sk-test-valid-apikey-0123456789abcdef";
const CREATED_AT = "2026-05-07T10:30:00.000Z";

function buildSpecTreeNode(
  overrides: Partial<BlueprintSpecTreeNode> = {},
): BlueprintSpecTreeNode {
  return {
    id: overrides.id ?? "node-cockpit-root",
    parentId: overrides.parentId,
    title: overrides.title ?? "Release Dashboard Cockpit",
    summary:
      overrides.summary ??
      "Ship the first effect preview cockpit slice for operator handoff.",
    type: overrides.type ?? "spec_document",
    status: overrides.status ?? "ready",
    priority: overrides.priority ?? 1,
    routeId: overrides.routeId ?? "route-primary",
    routeStepId: overrides.routeStepId ?? "route-step-1",
    dependencies: overrides.dependencies ?? [],
    outputs: overrides.outputs ?? ["hud-release-dashboard"],
    children: overrides.children ?? [],
    metadata: overrides.metadata,
  };
}

function buildSpecDocument(
  id: string,
  overrides: Partial<BlueprintSpecDocument> = {},
): BlueprintSpecDocument {
  return {
    id,
    jobId: overrides.jobId ?? "job-1",
    treeId: overrides.treeId ?? "tree-1",
    nodeId: overrides.nodeId ?? "node-cockpit-root",
    type: overrides.type ?? "requirements",
    status: overrides.status ?? "accepted",
    version: overrides.version ?? 1,
    sourceDocumentId: overrides.sourceDocumentId,
    title: overrides.title ?? `Spec Document ${id}`,
    summary: overrides.summary ?? `Summary for ${id}.`,
    content: overrides.content ?? `Content body for ${id}.`,
    format: "markdown",
    createdAt: overrides.createdAt ?? "2026-05-07T00:00:00.000Z",
    updatedAt: overrides.updatedAt,
    provenance: overrides.provenance ?? {
      jobId: "job-1",
      projectId: "project-1",
      sourceId: "source-1",
      targetText: "Ship the release dashboard cockpit.",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "spec_document",
      nodeTitle: "Release Dashboard Cockpit",
      nodeSummary: "spec node summary",
      dependencies: [],
      outputs: [],
    },
  };
}

function buildPrimaryRoute(
  overrides: Partial<BlueprintRouteCandidate> = {},
): BlueprintRouteCandidate {
  return {
    id: overrides.id ?? "route-primary",
    kind: overrides.kind ?? "primary",
    title: overrides.title ?? "Primary Route",
    summary: overrides.summary ?? "Primary route summary.",
    rationale: overrides.rationale ?? "Primary route rationale.",
    riskLevel: overrides.riskLevel ?? "medium",
    costLevel: overrides.costLevel ?? "medium",
    complexity: overrides.complexity ?? "balanced",
    estimatedEffort: overrides.estimatedEffort ?? "1 sprint",
    capabilities: overrides.capabilities ?? [
      {
        id: "cap-1",
        label: "Cap One",
        kind: "aigc_node",
        purpose: "node-level reasoning",
      },
    ],
    steps: overrides.steps ?? [
      {
        id: "step-1",
        title: "Step 1",
        description: "Initialise cockpit scaffold.",
        role: "planner",
        status: "pending",
      },
    ],
    outputs: overrides.outputs ?? ["hud-release-dashboard"],
  };
}

function buildJob(
  overrides: Partial<BlueprintGenerationJob> = {},
): BlueprintGenerationJob {
  const request: BlueprintGenerationRequest = overrides.request ?? {
    projectId: "project-1",
    sourceId: "source-1",
    targetText: "Ship the release dashboard cockpit.",
    githubUrls: ["https://github.com/example/repo-a"],
    clarificationSessionId: "clar-1",
  };
  return {
    id: overrides.id ?? "job-1",
    request,
    status: overrides.status ?? "running",
    stage: overrides.stage ?? "effect_preview",
    projectId: overrides.projectId ?? "project-1",
    sourceId: overrides.sourceId ?? "source-1",
    version: overrides.version ?? "v1",
    createdAt: overrides.createdAt ?? "2026-05-07T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-07T01:00:00.000Z",
    artifacts: overrides.artifacts ?? [],
    events: overrides.events ?? [],
  };
}

function buildClarificationSession(): BlueprintClarificationSession {
  return {
    id: "clar-1",
    intakeId: "intake-1",
    projectId: "project-1",
    strategyId: "target_first",
    templateId: "template-1",
    questions: [],
    answers: [],
    readiness: {
      status: "ready",
      score: 100,
      answeredRequired: 0,
      requiredTotal: 0,
      missingQuestionIds: [],
    },
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:30:00.000Z",
  };
}

function buildServiceInput(
  overrides: Partial<EffectPreviewLlmServiceInput> = {},
): EffectPreviewLlmServiceInput {
  return {
    jobId: overrides.jobId ?? "job-1",
    job: overrides.job ?? buildJob(),
    specTreeNode: overrides.specTreeNode ?? buildSpecTreeNode(),
    sourceDocuments:
      overrides.sourceDocuments ?? [buildSpecDocument("doc-a")],
    primaryRoute:
      overrides.primaryRoute === undefined
        ? buildPrimaryRoute()
        : overrides.primaryRoute,
    clarificationSession:
      overrides.clarificationSession === undefined
        ? buildClarificationSession()
        : overrides.clarificationSession,
    domainContext: overrides.domainContext,
    capabilityInvocations: overrides.capabilityInvocations,
    capabilityEvidence: overrides.capabilityEvidence,
    includeDrafts: overrides.includeDrafts ?? false,
    createdAt: overrides.createdAt ?? CREATED_AT,
  };
}

// ---------------------------------------------------------------------------
// Fake context factory
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

interface BuildCtxOptions {
  callJson?: (messages: unknown, opts?: unknown) => Promise<unknown>;
  getConfig?: () => { model: string; apiKey: string };
  apiKey?: string;
  model?: string;
  logger?: ReturnType<typeof makeLogger>;
}

function buildCtx(opts: BuildCtxOptions = {}): BlueprintServiceContext {
  const logger = opts.logger ?? makeLogger();
  const fakeCallJson = opts.callJson ?? vi.fn(async () => undefined);
  const getConfig =
    opts.getConfig ??
    (() => ({
      model: opts.model ?? "gpt-4-turbo",
      apiKey: opts.apiKey ?? VALID_API_KEY,
    }));

  const ctx: Partial<BlueprintServiceContext> = {
    now: () => new Date("2026-05-07T10:30:00.000Z"),
    blueprintStores: {
      intakes: new Map(),
      clarificationSessions: new Map(),
      projectContexts: new Map(),
    },
    jobStore: {
      list: () => [],
      get: () => null,
      save: () => {},
      latest: () => null,
    } as unknown as BlueprintServiceContext["jobStore"],
    llm: {
      callJson:
        fakeCallJson as unknown as BlueprintServiceContext["llm"]["callJson"],
      getConfig:
        getConfig as unknown as BlueprintServiceContext["llm"]["getConfig"],
    },
    sandboxDerivationRunner: (async () => ({
      artifacts: [],
      events: [],
    })) as BlueprintServiceContext["sandboxDerivationRunner"],
    replayStore: {
      listEvents: () => [],
      listArtifacts: () => [],
    },
    eventBus: {
      emit: () => {},
      subscribe: () => () => {},
    },
    specsRoot: "/tmp/specs",
    logger,
    effectPreviewLlmPolicy: createDefaultEffectPreviewLlmPolicy(),
  };

  return ctx as BlueprintServiceContext;
}

// ---------------------------------------------------------------------------
// Valid schema-compliant LLM payload factory
// ---------------------------------------------------------------------------

function buildValidLlmPayload(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  // Default = 3 architectureNotes, 4 prototypeNotes, 3 progressPlan,
  // 3 consoleLines, 3 logTimeline with level info / warning / success.
  const base: Record<string, unknown> = {
    summary:
      "Ship the cockpit preview with HUD, console lines and log timeline.",
    architectureNotes: [
      "Anchor runtime projection behind the service boundary.",
      "Keep HUD state mutable from normalisation output.",
      "Surface console + log timeline through the unified channel.",
    ],
    prototypeNotes: [
      "Render hero cockpit with HUD badges.",
      "Stream console lines via runtime projection channel.",
      "Timeline entries drive cockpit log drawer.",
      "Browser preview mirrors cockpit HUD when present.",
    ],
    progressPlan: [
      {
        title: "Ship beta",
        summary: "Deliver the first releasable cockpit slice.",
        target: "Internal demo milestone",
      },
      {
        title: "Stabilise telemetry",
        summary: "Wire telemetry to the cockpit HUD badges.",
        target: "Observability review",
      },
      {
        title: "Lock runtime contract",
        summary: "Freeze runtime adapter contract with downstream teams.",
        target: "Contract freeze review",
      },
    ],
    runtimeProjection: {
      hudState: {
        title: "Release Dashboard HUD",
        summary: "HUD surfaces progress, risk and takeover.",
        progressPercent: 42,
      },
      consoleLines: [
        "preview: cockpit boot sequence ready",
        "preview: runtime projection warm",
        "preview: operator panel rendered",
      ],
      logTimeline: [
        {
          id: "log-alpha",
          level: "info",
          message: "preview: cockpit log stream initialised",
        },
        {
          id: "log-beta",
          level: "warning",
          message: "preview: runtime projection degraded",
        },
        {
          id: "log-gamma",
          level: "success",
          message: "preview: takeover rehearsal passed",
        },
      ],
    },
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createEffectPreviewLlmService", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // 12.1 Happy path (R9.2 happy)
  // -------------------------------------------------------------------------

  it("12.1 happy path: returns generationSource === 'llm' with content fields populated and sha256 digests", async () => {
    const ctx = buildCtx({
      callJson: async () => buildValidLlmPayload(),
    });
    const service = createEffectPreviewLlmService(ctx);
    const result = await service(buildServiceInput());

    expect(result.generationSource).toBe("llm");
    expect(result.summary).toBeDefined();
    expect(result.summary).not.toHaveLength(0);
    expect(result.architectureNotes).toHaveLength(3);
    expect(result.prototypeNotes).toHaveLength(4);
    expect(result.progressPlan).toHaveLength(3);
    expect(result.renderedHudState?.title).toBeDefined();
    expect(result.renderedHudState?.title.length).toBeGreaterThan(0);
    expect(result.renderedConsoleLines).toHaveLength(3);
    expect(result.renderedLogTimeline).toHaveLength(3);
    expect(result.renderedLogTimeline?.map((entry) => entry.level)).toEqual([
      "info",
      "warning",
      "success",
    ]);
    expect(result.promptId).toBe("blueprint.effect-preview.v1");
    expect(result.model).toBe("gpt-4-turbo");
    expect(result.promptFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.responseDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.structuredPayloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.error).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 12.2 Malformed JSON (R9.2 malformed)
  // -------------------------------------------------------------------------

  describe("12.2 malformed JSON response", () => {
    it("returns llm_fallback with 'non-json response' when callJson yields undefined", async () => {
      const ctx = buildCtx({ callJson: async () => undefined });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/non-json response/);
      expect(result.summary).toBeUndefined();
      expect(result.architectureNotes).toBeUndefined();
      expect(result.prototypeNotes).toBeUndefined();
      expect(result.progressPlan).toBeUndefined();
      expect(result.renderedHudState).toBeUndefined();
      expect(result.renderedConsoleLines).toBeUndefined();
      expect(result.renderedLogTimeline).toBeUndefined();
      expect(result.renderedBrowserPreview).toBeUndefined();
      expect(result.responseDigest).toBeUndefined();
      expect(result.structuredPayloadDigest).toBeUndefined();
      // promptId / model / promptFingerprint MAY be populated because the
      // prompt was successfully constructed before the fallback path.
      expect(result.promptId).toBe("blueprint.effect-preview.v1");
    });

    it("returns llm_fallback with 'non-json response' when callJson yields a plain string", async () => {
      const ctx = buildCtx({
        callJson: async () => "garbage string" as unknown as undefined,
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/non-json response/);
    });

    it("returns llm_fallback with 'non-json response' when callJson yields a number", async () => {
      const ctx = buildCtx({
        callJson: async () => 42 as unknown as undefined,
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/non-json response/);
    });
  });

  // -------------------------------------------------------------------------
  // 12.3 Schema fails (R9.2 schema-fail)
  // -------------------------------------------------------------------------

  describe("12.3 schema validation failures", () => {
    it("(a) rejects empty progressPlan", async () => {
      const payload = buildValidLlmPayload({ progressPlan: [] });
      const ctx = buildCtx({ callJson: async () => payload });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
      expect(result.error).toMatch(/progressPlan/);
    });

    it("(b) rejects empty logTimeline", async () => {
      const base = buildValidLlmPayload();
      const runtimeProjection = {
        ...(base.runtimeProjection as Record<string, unknown>),
        logTimeline: [],
      };
      const ctx = buildCtx({
        callJson: async () => ({ ...base, runtimeProjection }),
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
    });

    it("(c) rejects missing hudState.title", async () => {
      const base = buildValidLlmPayload();
      const runtimeProjection = base.runtimeProjection as Record<
        string,
        unknown
      >;
      const hudState = {
        ...(runtimeProjection.hudState as Record<string, unknown>),
      };
      delete (hudState as { title?: unknown }).title;
      const ctx = buildCtx({
        callJson: async () => ({
          ...base,
          runtimeProjection: { ...runtimeProjection, hudState },
        }),
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
      expect(result.error).toMatch(/hudState/);
    });

    it("(d) rejects logTimeline level = 'debug'", async () => {
      const base = buildValidLlmPayload();
      const runtimeProjection = base.runtimeProjection as Record<
        string,
        unknown
      >;
      const logTimeline = (
        runtimeProjection.logTimeline as Array<Record<string, unknown>>
      ).map((entry, index) =>
        index === 0 ? { ...entry, level: "debug" } : entry,
      );
      const ctx = buildCtx({
        callJson: async () => ({
          ...base,
          runtimeProjection: { ...runtimeProjection, logTimeline },
        }),
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
      expect(result.error).toMatch(/level/);
    });

    it("(e) rejects summary exceeding 500 characters", async () => {
      const payload = buildValidLlmPayload({ summary: "x".repeat(501) });
      const ctx = buildCtx({ callJson: async () => payload });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
    });

    it("(f) rejects case-insensitive duplicate progressPlan titles", async () => {
      const payload = buildValidLlmPayload({
        progressPlan: [
          {
            title: "Ship",
            summary: "First milestone.",
            target: "Demo",
          },
          {
            title: "ship",
            summary: "Second milestone with duplicated title.",
            target: "Demo",
          },
          {
            title: "Stabilise",
            summary: "Third milestone.",
            target: "Review",
          },
        ],
      });
      const ctx = buildCtx({ callJson: async () => payload });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/duplicated/);
    });

    it("(g) rejects duplicated logTimeline ids", async () => {
      const base = buildValidLlmPayload();
      const runtimeProjection = base.runtimeProjection as Record<
        string,
        unknown
      >;
      const logTimeline = [
        {
          id: "shared-id",
          level: "info",
          message: "first entry",
        },
        {
          id: "shared-id",
          level: "warning",
          message: "second entry with duplicated id",
        },
        {
          id: "log-gamma",
          level: "success",
          message: "third entry",
        },
      ];
      const ctx = buildCtx({
        callJson: async () => ({
          ...base,
          runtimeProjection: { ...runtimeProjection, logTimeline },
        }),
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/duplicated/);
    });

    it("(h) rejects hudState.status = 'unknown'", async () => {
      const base = buildValidLlmPayload();
      const runtimeProjection = base.runtimeProjection as Record<
        string,
        unknown
      >;
      const hudState = {
        ...(runtimeProjection.hudState as Record<string, unknown>),
        status: "unknown",
      };
      const ctx = buildCtx({
        callJson: async () => ({
          ...base,
          runtimeProjection: { ...runtimeProjection, hudState },
        }),
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
    });

    it("(i) rejects hudState.stage = 'invalid'", async () => {
      const base = buildValidLlmPayload();
      const runtimeProjection = base.runtimeProjection as Record<
        string,
        unknown
      >;
      const hudState = {
        ...(runtimeProjection.hudState as Record<string, unknown>),
        stage: "invalid",
      };
      const ctx = buildCtx({
        callJson: async () => ({
          ...base,
          runtimeProjection: { ...runtimeProjection, hudState },
        }),
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
    });

    it("(j) rejects hudState.progressPercent = 150", async () => {
      const base = buildValidLlmPayload();
      const runtimeProjection = base.runtimeProjection as Record<
        string,
        unknown
      >;
      const hudState = {
        ...(runtimeProjection.hudState as Record<string, unknown>),
        progressPercent: 150,
      };
      const ctx = buildCtx({
        callJson: async () => ({
          ...base,
          runtimeProjection: { ...runtimeProjection, hudState },
        }),
      });
      const service = createEffectPreviewLlmService(ctx);
      const result = await service(buildServiceInput());

      expect(result.generationSource).toBe("llm_fallback");
      expect(result.error).toMatch(/schema validation failed/);
    });
  });

  // -------------------------------------------------------------------------
  // 12.4 ApiKey missing (R9.2 apiKey-missing)
  // -------------------------------------------------------------------------

  it("12.4 apiKey missing: returns 'template' and never calls callJson", async () => {
    const callJsonSpy = vi.fn();
    const ctx = buildCtx({
      callJson:
        callJsonSpy as unknown as BuildCtxOptions["callJson"],
      getConfig: () => ({ model: "gpt-4-turbo", apiKey: "" }),
    });
    const service = createEffectPreviewLlmService(ctx);
    const result = await service(buildServiceInput());

    expect(result.generationSource).toBe("template");
    expect(callJsonSpy).not.toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.promptId).toBeUndefined();
    expect(result.model).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 12.5 Not enabled (supplementary)
  // -------------------------------------------------------------------------

  it("12.5 not enabled: returns 'template', never calls callJson, and logger.debug is invoked", async () => {
    vi.unstubAllEnvs();
    // Explicitly leave BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED unset.

    const callJsonSpy = vi.fn();
    const logger = makeLogger();
    const ctx = buildCtx({
      callJson:
        callJsonSpy as unknown as BuildCtxOptions["callJson"],
      logger,
    });
    const service = createEffectPreviewLlmService(ctx);
    const result = await service(buildServiceInput());

    expect(result.generationSource).toBe("template");
    expect(callJsonSpy).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.promptId).toBeUndefined();
    expect(result.model).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 12.6 Timeout (supplementary)
  // -------------------------------------------------------------------------

  it("12.6 timeout: recognises 'Request aborted due to timeout' as llm timeout", async () => {
    const ctx = buildCtx({
      callJson: async () => {
        throw new Error("Request aborted due to timeout");
      },
    });
    const service = createEffectPreviewLlmService(ctx);
    const result = await service(buildServiceInput());

    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error).toMatch(/llm timeout/);
  });

  // -------------------------------------------------------------------------
  // 12.7 Redaction E2E (supplementary)
  // -------------------------------------------------------------------------

  it("12.7 redaction: thrown error containing a raw sk-... api key is redacted from result.error", async () => {
    const leakedKey = "sk-ABCDEFGHIJKLMNOP1234567890";
    const ctx = buildCtx({
      callJson: async () => {
        throw new Error(`upstream failure leaked ${leakedKey}`);
      },
    });
    const service = createEffectPreviewLlmService(ctx);
    const result = await service(buildServiceInput());

    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain(leakedKey);
  });

  // -------------------------------------------------------------------------
  // 12.8 Per-preview isolation (supplementary, validates requirement 4.7)
  // -------------------------------------------------------------------------

  it("12.8 per-preview isolation: two successive calls on the same service instance keep generationSource / error / promptFingerprint / responseDigest independent", async () => {
    let callIndex = 0;
    const ctx = buildCtx({
      callJson: async () => {
        callIndex++;
        if (callIndex === 1) {
          return buildValidLlmPayload();
        }
        throw new Error("second invocation failure");
      },
    });
    const service = createEffectPreviewLlmService(ctx);

    const firstResult = await service(buildServiceInput());
    const secondResult = await service(
      buildServiceInput({
        specTreeNode: buildSpecTreeNode({
          id: "node-secondary",
          title: "Secondary cockpit slice",
        }),
      }),
    );

    // First call — happy path.
    expect(firstResult.generationSource).toBe("llm");
    expect(firstResult.error).toBeUndefined();
    expect(firstResult.promptFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(firstResult.responseDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Second call — fallback due to thrown error.
    expect(secondResult.generationSource).toBe("llm_fallback");
    expect(secondResult.error).toBeDefined();
    // Fallback path does not populate a responseDigest (no raw payload was
    // decoded), so the two calls must not share a cached value.
    expect(secondResult.responseDigest).toBeUndefined();

    // Independence checks: results are distinct per call.
    expect(firstResult.generationSource).not.toBe(
      secondResult.generationSource,
    );
    // promptFingerprint is derived from the prompt input tuple, so the
    // two calls (different specTreeNode) must produce distinct
    // fingerprints — confirming no closure-level caching across calls.
    expect(firstResult.promptFingerprint).not.toBe(
      secondResult.promptFingerprint,
    );
    // error is independent per call.
    expect(firstResult.error).not.toBe(secondResult.error);
  });
});
