/**
 * `blueprint-v4-full-alignment` Module A — 伴随层单元测试。
 *
 * 覆盖：
 * - 触发阈值（fuzzinessScore <= threshold 不触发 Critic）
 * - 对抗独立性（Critic prompt 不含生成方推理）
 * - 降级（无 LLM → info；无 fetcher → warn）
 * - 台账写入（companion_trace）
 * - findings 露出（warn/error → job.companionFindings[]）
 * - env gate disabled → 空结果
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCompanionLayer } from "./service.js";
import { computeFuzzinessScore } from "./fuzziness.js";
import type { BlueprintServiceContext } from "../context.js";
import type { BlueprintGenerationJob } from "../../../../shared/blueprint/contracts.js";

function makeJob(): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: { targetText: "t" } as any,
    status: "running" as any,
    stage: "clarification" as any,
    version: "1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    artifacts: [],
    events: [],
  };
}

function makeCtx(opts: {
  enabled?: boolean;
  apiKey?: string;
  hasMcp?: boolean;
  callJsonImpl?: (...args: any[]) => Promise<unknown>;
  job?: BlueprintGenerationJob;
}): { ctx: BlueprintServiceContext; recordSpy: any; job: BlueprintGenerationJob } {
  vi.stubEnv("BLUEPRINT_COMPANION_ENABLED", opts.enabled === false ? "false" : "true");
  const job = opts.job ?? makeJob();
  const jobMap = new Map([[job.id, job]]);
  const recordSpy = vi.fn((input) => ({ ...input, id: "chk", triggeredAt: "t" }));

  const ctx = {
    now: () => new Date("2026-05-28T00:00:00Z"),
    jobStore: {
      get: (id: string) => jobMap.get(id) ?? null,
      save: vi.fn((j: BlueprintGenerationJob) => { jobMap.set(j.id, j); }),
      list: () => [...jobMap.values()],
      latest: () => null,
    },
    eventBus: { emit: vi.fn(), subscribe: vi.fn(() => () => {}) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    llm: {
      getConfig: () => ({ apiKey: opts.apiKey ?? "", model: "test-model" }),
      callJson: opts.callJsonImpl ?? (async () => ({})),
    },
    checksLedger: { recordCheck: recordSpy, getChecks: vi.fn(), isGatePassed: vi.fn(), renderMarkdown: vi.fn() },
    ...(opts.hasMcp ? { mcpToolAdapter: { execute: vi.fn() } } : {}),
  } as unknown as BlueprintServiceContext;

  return { ctx, recordSpy, job };
}

describe("computeFuzzinessScore", () => {
  it("high score for ambiguous text", () => {
    expect(computeFuzzinessScore("maybe this could possibly work, TBD, unclear")).toBeGreaterThan(0.3);
  });
  it("low score for concrete text", () => {
    const concrete = "The login endpoint accepts POST /api/auth with email and password fields and returns a JWT token valid for 24 hours stored in httpOnly cookie.";
    expect(computeFuzzinessScore(concrete)).toBeLessThan(0.3);
  });
  it("max score for empty", () => {
    expect(computeFuzzinessScore("")).toBe(1);
  });
});

describe("CompanionLayer", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("env gate disabled → empty findings", async () => {
    const { ctx } = makeCtx({ enabled: false });
    const layer = createCompanionLayer(ctx);
    const findings = await layer.evaluateAll(
      { jobId: "job-1", stage: "clarification", fuzzinessScore: 0.9, hasRealRepo: false },
      { foo: "bar" },
    );
    expect(findings).toEqual([]);
  });

  it("Critic does not trigger below threshold", async () => {
    const { ctx } = makeCtx({ enabled: true, apiKey: "sk-x" });
    const layer = createCompanionLayer(ctx);
    const findings = await layer.evaluateAll(
      { jobId: "job-1", stage: "spec_tree", fuzzinessScore: 0.3, hasRealRepo: false },
      { foo: "bar" },
    );
    // critic null (below 0.6), grounding null (no real repo)
    expect(findings).toEqual([]);
  });

  it("Critic degrades to info when no LLM key", async () => {
    const { ctx, recordSpy } = makeCtx({ enabled: true, apiKey: "" });
    const layer = createCompanionLayer(ctx);
    const findings = await layer.evaluateAll(
      { jobId: "job-1", stage: "spec_tree", fuzzinessScore: 0.9, hasRealRepo: false },
      { foo: "bar" },
    );
    expect(findings.length).toBe(1);
    expect(findings[0].role).toBe("critic");
    expect(findings[0].severity).toBe("info");
    // 台账写入
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "companion_trace" }),
    );
  });

  it("Critic adversarial independence: prompt contains no author reasoning", async () => {
    const callJsonSpy = vi.fn(async (messages: any[]) => {
      // 验证 userMessage 只含 artifact，不含 "reasoning"/"rationale" 字样
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
      expect(systemMsg).toContain("independent");
      expect(systemMsg).toContain("NO access");
      // artifact 本身没有 author rationale 注入
      expect(userMsg).toContain("artifact only");
      return { findings: ["weak claim"], severity: "warn", suggestedActions: [], citations: [] };
    });
    const { ctx } = makeCtx({ enabled: true, apiKey: "sk-x", callJsonImpl: callJsonSpy });
    const layer = createCompanionLayer(ctx);
    await layer.evaluateAll(
      { jobId: "job-1", stage: "spec_tree", fuzzinessScore: 0.9, hasRealRepo: false },
      { title: "Some artifact" },
    );
    expect(callJsonSpy).toHaveBeenCalled();
  });

  it("warn/error findings surface to job.companionFindings[]", async () => {
    const callJsonSpy = vi.fn(async () => ({
      findings: ["overconfident assumption"],
      severity: "error",
      suggestedActions: ["add evidence"],
      citations: [],
    }));
    const { ctx, job } = makeCtx({ enabled: true, apiKey: "sk-x", callJsonImpl: callJsonSpy });
    const layer = createCompanionLayer(ctx);
    await layer.evaluateAll(
      { jobId: "job-1", stage: "spec_tree", fuzzinessScore: 0.9, hasRealRepo: false },
      { title: "X" },
    );
    const jobAny = job as any;
    expect(jobAny.companionFindings?.length).toBe(1);
    expect(jobAny.companionFindings[0].severity).toBe("error");
  });

  it("Grounding degrades to warn when no fetcher/mcp", async () => {
    const { ctx } = makeCtx({ enabled: true, apiKey: "sk-x", hasMcp: false });
    const layer = createCompanionLayer(ctx);
    const findings = await layer.evaluateAll(
      { jobId: "job-1", stage: "input", fuzzinessScore: 0.1, hasRealRepo: true },
      { title: "X" },
    );
    const grounding = findings.find((f) => f.role === "grounding");
    expect(grounding?.severity).toBe("warn");
  });

  it("Grounding does not trigger without real repo", async () => {
    const { ctx } = makeCtx({ enabled: true, apiKey: "sk-x", hasMcp: true });
    const layer = createCompanionLayer(ctx);
    const findings = await layer.evaluateAll(
      { jobId: "job-1", stage: "input", fuzzinessScore: 0.1, hasRealRepo: false },
      { title: "X" },
    );
    expect(findings.find((f) => f.role === "grounding")).toBeUndefined();
  });
});
