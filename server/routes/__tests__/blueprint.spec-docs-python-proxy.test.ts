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
    projectId: "project-1",
    sourceId: "source-1",
    targetText: "Build a user authentication system",
    githubUrls: [],
    clarificationSessionId: "session-1",
  };
}

function makeNode(): BlueprintSpecTreeNode {
  return {
    id: "node-1",
    title: "Authentication Module",
    summary: "Handles login and session management",
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
    id: "session-1",
    intakeId: "intake-1",
    projectId: "project-1",
    strategyId: "target_first",
    templateId: "template-1",
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
    id: "job-1",
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

describe("Blueprint spec-docs Python proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates single-document generation to Python and does not call Node LLM", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-test");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          generationSource: "llm",
          title: "Requirements: Authentication Module",
          summary: "Python generated summary",
          content: "# Requirements: Authentication Module\n\nPython generated content\n",
          status: "draft",
          promptId: "blueprint.spec-documents.v1",
          model: "python-blueprint-spec-docs-contract",
          promptFingerprint: "sha256:abc",
          responseDigest: "sha256:def",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { ctx, callJson } = makeCtx();
    const service = createSpecDocumentsLlmService(ctx);
    const request = makeRequest();

    const result = await service({
      jobId: "job-1",
      job: makeJob(request),
      request,
      specTreeNode: makeNode(),
      targetDocumentType: "requirements",
      clarificationSession: makeSession(),
      createdAt: FIXED_TIMESTAMP,
    });

    expect(result.generationSource).toBe("llm");
    expect(result.title).toBe("Requirements: Authentication Module");
    expect(callJson).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://python.test/api/blueprint/spec-documents/generate-one");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": "internal-test",
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.targetDocumentType).toBe("requirements");
    expect(body.specTreeNode.title).toBe("Authentication Module");
  });

  it("maps Python proxy failures to llm_fallback without calling Node LLM", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("down", { status: 503 }),
    );
    const { ctx, callJson, logger } = makeCtx();
    const service = createSpecDocumentsLlmService(ctx);
    const request = makeRequest();

    const result = await service({
      jobId: "job-1",
      job: makeJob(request),
      request,
      specTreeNode: makeNode(),
      targetDocumentType: "design",
      createdAt: FIXED_TIMESTAMP,
    });

    expect(result.generationSource).toBe("llm_fallback");
    expect(result.error).toContain("python proxy failed");
    expect(callJson).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
