import { afterEach, describe, expect, it, vi } from "vitest";

import type { AIConfig } from "../../core/ai-config.js";
import type {
  BlueprintClarificationSession,
  BlueprintGenerationJob,
  BlueprintGenerationRequest,
  BlueprintSpecTreeNode,
} from "../../../shared/blueprint/index.js";
import { createMemoryBlueprintJobStore } from "../blueprint.js";
import { buildBlueprintServiceContext, type BlueprintLlmDependencies } from "../blueprint/context.js";
import { createSpecDocumentsLlmService } from "../blueprint/spec-documents/service.js";

const FIXED_TIMESTAMP = "2026-06-19T00:00:00.000Z";

function makeAIConfig(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    apiKey: "node-key",
    baseUrl: "https://node-llm.example.test",
    model: "gpt-5.5",
    modelReasoningEffort: "medium",
    maxContext: 128000,
    providerName: "node-provider",
    wireApi: "chat_completions",
    timeoutMs: 30000,
    stream: false,
    ...overrides,
  };
}

function makeRequest(): BlueprintGenerationRequest {
  return {
    projectId: "project-smoke",
    sourceId: "source-smoke",
    targetText: "Build a checkout flow with confirmation and error states",
    githubUrls: [],
    clarificationSessionId: "session-smoke",
  };
}

function makeNode(): BlueprintSpecTreeNode {
  return {
    id: "node-smoke",
    title: "Checkout Flow",
    summary: "Captures checkout requirements and handoff boundaries",
    type: "route_step",
    status: "draft",
    priority: 1,
    dependencies: [],
    outputs: [],
    children: [],
  };
}

function makeSession(): BlueprintClarificationSession {
  return {
    id: "session-smoke",
    intakeId: "intake-smoke",
    projectId: "project-smoke",
    strategyId: "target_first",
    templateId: "template-smoke",
    questions: [],
    answers: [],
    readiness: {
      status: "ready",
      score: 1,
      answeredRequired: 1,
      requiredTotal: 1,
      missingQuestionIds: [],
    },
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  };
}

function makeJob(request: BlueprintGenerationRequest): BlueprintGenerationJob {
  return {
    id: "job-smoke",
    request,
    status: "pending",
    stage: "input",
    version: "v1",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    artifacts: [],
    events: [],
  };
}

function makeCtx() {
  const callJson = vi.fn() as unknown as BlueprintLlmDependencies["callJson"];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const ctx = buildBlueprintServiceContext({
    jobStore: createMemoryBlueprintJobStore(),
    llm: { callJson, getConfig: () => makeAIConfig() },
    logger,
  });
  return { ctx, callJson, logger };
}

async function callService() {
  const { ctx, callJson, logger } = makeCtx();
  const service = createSpecDocumentsLlmService(ctx);
  const request = makeRequest();
  const result = await service({
    jobId: "job-smoke",
    job: makeJob(request),
    request,
    specTreeNode: makeNode(),
    targetDocumentType: "requirements",
    clarificationSession: makeSession(),
    createdAt: FIXED_TIMESTAMP,
  });
  return { result, callJson, logger };
}

describe("Blueprint spec-docs Python proxy smoke gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("smokes the Node proxy path and preserves the Python response shape", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-smoke.test/");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-smoke");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          generationSource: "llm",
          title: "Requirements: Checkout Flow",
          summary: "Python generated checkout summary",
          content: "# Requirements: Checkout Flow\n\nPython generated checkout content\n",
          status: "draft",
          promptId: "blueprint.spec-documents.v1",
          model: "python-blueprint-spec-docs-contract",
          promptFingerprint: "sha256:abc",
          responseDigest: "sha256:def",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { result, callJson } = await callService();

    expect(result).toMatchObject({
      generationSource: "llm",
      title: "Requirements: Checkout Flow",
      status: "draft",
      promptId: "blueprint.spec-documents.v1",
      model: "python-blueprint-spec-docs-contract",
    });
    expect(result.content).toContain("Python generated checkout content");
    expect(result.promptFingerprint).toMatch(/^sha256:/);
    expect(result.responseDigest).toMatch(/^sha256:/);
    expect(callJson).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://python-smoke.test/api/blueprint/spec-documents/generate-one");
    expect((init as RequestInit).headers).toMatchObject({
      "X-Internal-Key": "internal-smoke",
    });
  });

  it("reports service-unavailable failures as Python proxy failures", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-smoke.test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:9700"),
    );

    const { result, callJson, logger } = await callService();

    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error).toContain("python proxy failed");
    expect(result.error).toContain("ECONNREFUSED");
    expect(callJson).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "spec-documents python proxy failed, using fallback",
      expect.objectContaining({ error: expect.stringContaining("ECONNREFUSED") }),
    );
  });

  it("reports invalid Python response shape as a contract failure", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-smoke.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          generationSource: "llm",
          title: "Missing required fields",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { result, callJson } = await callService();

    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error).toContain("invalid shape");
    expect(callJson).not.toHaveBeenCalled();
  });
});
