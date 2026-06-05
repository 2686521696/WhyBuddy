/**
 * `blueprint-v4-full-alignment` Module F (R19) — Provenance 产出测试。
 *
 * 验证：
 * - 成功路径 → source:"model", ok:true, retryCount
 * - env-disabled / key-missing → source:"template", ok:true（合法，非造假）
 * - timeout → source:"fallback", ok:false, ["read_timeout_no_retry"]，不重试
 * - 503 → 重试至 maxRetries 后 source:"fallback", ok:false, ["503_exhausted"]
 * - 失败不写 .png（失败节点不进 imageBase64ByNodeId）
 */

import { describe, expect, it, vi } from "vitest";

import type { BlueprintSpecDocument } from "../../../../../shared/blueprint/contracts.js";
import type {
  ImageApiClient,
  ImageApiRequest,
  ImageApiResult,
} from "../image-api-client.js";
import {
  createImageService,
  type ImageServiceDeps,
} from "../image-service.js";
import type {
  PromptTemplateLibrary,
  PromptStyleKey,
} from "../prompt-template-library.js";
import type {
  EffectPreviewScheduler,
  ProgressPlanEntry,
  SchedulerPlanInput,
} from "../scheduler.js";
import type {
  SvgArchitectureDrafter,
  SvgDraftResult,
} from "../svg-architecture-drafter.js";

function buildSpecDocument(id: string): BlueprintSpecDocument {
  return {
    id,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: "node-x",
    type: "requirements",
    status: "accepted",
    version: 1,
    title: `Spec ${id}`,
    summary: `Summary ${id}.`,
    content: `Body ${id}.`,
    format: "markdown",
    createdAt: "2026-05-07T00:00:00.000Z",
    provenance: {
      jobId: "job-1",
      projectId: "project-1",
      sourceId: "source-1",
      targetText: "test",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "spec_document",
      nodeTitle: "X",
      nodeSummary: "X node.",
      dependencies: [],
      outputs: [],
    },
  };
}

function buildDeps(
  generateImpl: (req: ImageApiRequest, callIndex: number) => ImageApiResult,
): { deps: ImageServiceDeps; generateSpy: ReturnType<typeof vi.fn> } {
  const styleList: ReadonlyArray<PromptStyleKey> = ["system_architecture_diagram"];
  const promptTemplateLibrary: PromptTemplateLibrary = {
    render: vi.fn(() => "prompt") as PromptTemplateLibrary["render"],
    styles: () => styleList,
  };
  const svgArchitectureDrafter: SvgArchitectureDrafter = {
    draft: vi.fn(async (): Promise<SvgDraftResult> => ({ kind: "skipped", reason: "no-architecture-notes" })) as SvgArchitectureDrafter["draft"],
  };
  const planSpy = vi.fn((input: SchedulerPlanInput): ReadonlyArray<ProgressPlanEntry> =>
    input.dependencyOrder.map((nodeId) => ({ nodeId, state: "pending" as const })),
  );
  const scheduler: EffectPreviewScheduler = {
    plan: planSpy as EffectPreviewScheduler["plan"],
    markCompleted: vi.fn((plan: ReadonlyArray<ProgressPlanEntry>, nodeId: string) =>
      plan.map((e) => (e.nodeId === nodeId ? { ...e, state: "completed" as const } : e)),
    ) as EffectPreviewScheduler["markCompleted"],
    markFailed: vi.fn((plan: ReadonlyArray<ProgressPlanEntry>, nodeId: string, tier: ProgressPlanEntry["fallbackTier"], summary: string) =>
      plan.map((e) => (e.nodeId === nodeId ? { ...e, state: "failed" as const, fallbackTier: tier, errorSummary: summary } : e)),
    ) as EffectPreviewScheduler["markFailed"],
  };
  let callIndex = 0;
  const generateSpy = vi.fn(async (request: ImageApiRequest): Promise<ImageApiResult> => {
    const idx = callIndex;
    callIndex += 1;
    return generateImpl(request, idx);
  });
  const imageApiClient: ImageApiClient = { generate: generateSpy as ImageApiClient["generate"] };
  return {
    deps: { promptTemplateLibrary, svgArchitectureDrafter, scheduler, imageApiClient },
    generateSpy,
  };
}

const baseInput = {
  missionId: "mission-1",
  specDocuments: [buildSpecDocument("d1")],
  dependencyOrder: ["node-x"],
  rasterTargets: ["node-x"],
  architectureNotes: [] as string[],
};

describe("Module F: Provenance production", () => {
  it("success path → source:model, ok:true, retryCount:0", async () => {
    const { deps } = buildDeps(() => ({
      kind: "ok",
      b64Json: "AAAA",
      mimeType: "image/png",
      durationMs: 100,
      model: "gpt-image-2",
    }));
    const service = createImageService(deps);
    const result = await service.runStageC(baseInput);

    const record = result.imageBase64ByNodeId?.["node-x"];
    expect(record?.provenance).toMatchObject({
      source: "model",
      ok: true,
      errorIndicators: [],
      retryCount: 0,
      modelUsed: "gpt-image-2",
    });
  });

  it("env-disabled → source:template, ok:true (legitimate, not fraud)", async () => {
    const { deps } = buildDeps(() => ({
      kind: "error",
      tier: "env-disabled",
      errorSummary: "disabled",
      durationMs: 0,
    }));
    const service = createImageService(deps);
    const result = await service.runStageC(baseInput);

    // 失败不写文件
    expect(result.imageBase64ByNodeId).toBeUndefined();
    expect(result.failedProvenanceByNodeId?.["node-x"]).toMatchObject({
      source: "template",
      ok: true,
      errorIndicators: [],
    });
  });

  it("key-missing → source:template, ok:true", async () => {
    const { deps } = buildDeps(() => ({
      kind: "error",
      tier: "key-missing",
      errorSummary: "no key",
      durationMs: 0,
    }));
    const service = createImageService(deps);
    const result = await service.runStageC(baseInput);
    expect(result.failedProvenanceByNodeId?.["node-x"]).toMatchObject({
      source: "template",
      ok: true,
    });
  });

  it("timeout → source:fallback, ok:false, read_timeout_no_retry, NO retry", async () => {
    const { deps, generateSpy } = buildDeps(() => ({
      kind: "error",
      tier: "timeout",
      errorSummary: "aborted after 60000ms",
      durationMs: 60000,
    }));
    const service = createImageService(deps);
    const result = await service.runStageC(baseInput);

    expect(result.imageBase64ByNodeId).toBeUndefined();
    expect(result.failedProvenanceByNodeId?.["node-x"]).toMatchObject({
      source: "fallback",
      ok: false,
      errorIndicators: ["read_timeout_no_retry"],
      retryCount: 0,
    });
    // 不重试：只调用一次
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it("503 → retry to maxRetries then 503_exhausted", async () => {
    const { deps, generateSpy } = buildDeps(() => ({
      kind: "error",
      tier: "upstream-failure",
      errorSummary: "HTTP 503 Service Unavailable",
      durationMs: 10,
    }));
    const service = createImageService(deps);
    const result = await service.runStageC(baseInput);

    expect(result.imageBase64ByNodeId).toBeUndefined();
    const prov = result.failedProvenanceByNodeId?.["node-x"];
    expect(prov).toMatchObject({
      source: "fallback",
      ok: false,
      errorIndicators: ["503_exhausted"],
      retryCount: 2,
    });
    // 1 原始 + 2 重试 = 3 次
    expect(generateSpy).toHaveBeenCalledTimes(3);
  });

  it("503 then success on retry → source:model with retryCount", async () => {
    const { deps, generateSpy } = buildDeps((_req, idx) => {
      if (idx < 1) {
        return { kind: "error", tier: "upstream-failure", errorSummary: "HTTP 503", durationMs: 10 };
      }
      return { kind: "ok", b64Json: "AAAA", mimeType: "image/png", durationMs: 100, model: "gpt-image-2" };
    });
    const service = createImageService(deps);
    const result = await service.runStageC(baseInput);

    expect(result.imageBase64ByNodeId?.["node-x"]?.provenance).toMatchObject({
      source: "model",
      ok: true,
      retryCount: 1,
    });
    expect(generateSpy).toHaveBeenCalledTimes(2);
  });

  it("non-503 upstream-failure → NO retry, source:fallback", async () => {
    const { deps, generateSpy } = buildDeps(() => ({
      kind: "error",
      tier: "upstream-failure",
      errorSummary: "AGENT_DOMAIN_MISMATCH",
      durationMs: 10,
    }));
    const service = createImageService(deps);
    const result = await service.runStageC(baseInput);

    expect(result.failedProvenanceByNodeId?.["node-x"]).toMatchObject({
      source: "fallback",
      ok: false,
      errorIndicators: ["upstream-failure"],
      retryCount: 0,
    });
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });
});
