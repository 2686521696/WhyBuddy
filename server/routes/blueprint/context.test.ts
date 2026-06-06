import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
} from "../../../shared/blueprint/index.js";
import { BlueprintEventName } from "../../../shared/blueprint/events.js";
import type { ExecutorClient } from "../../core/executor-client.js";
import { createMemoryBlueprintJobStore } from "../blueprint.js";

import {
  __resetCachedDefaultBlueprintJobStore,
  buildBlueprintServiceContext,
  createDefaultBlueprintStores,
  createJobBackedReplayStore,
  createSilentBlueprintLogger,
  rebindBlueprintServiceContextRuntimeAdapters,
} from "./context.js";

/**
 * `BlueprintServiceContext` 的 co-located 单测。
 *
 * 覆盖：
 * 1. 默认构造的基础字段均存在且可用；
 * 2. 每一项依赖都可通过 `deps` 注入覆盖（满足需求 3.1 "全部依赖可替换"）；
 * 3. `replayStore` 默认实现是对 jobStore 的投影；
 * 4. `eventBus` 默认实现的 subscribe / emit 顺序语义正确；
 * 5. `jobStoreFile` 覆盖能够绕过全局缓存（满足需求 3.4 的 lazy 语义）。
 *
 * 所有断言都是 example-based，不声称是 PBT。
 */

function makeJob(id: string): BlueprintGenerationJob {
  return {
    id,
    request: {},
    status: "pending",
    stage: "input",
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    artifacts: [],
    events: [],
  };
}

function makeEvent(id: string): BlueprintGenerationEvent {
  return {
    id,
    jobId: "job-1",
    type: BlueprintEventName.JobCreated,
    family: "job",
    stage: "input",
    status: "pending",
    message: "fixture",
    occurredAt: "2026-05-07T00:00:00.000Z",
  };
}

describe("buildBlueprintServiceContext", () => {
  it("提供默认值：每一项都不是 undefined", () => {
    __resetCachedDefaultBlueprintJobStore();
    const ctx = buildBlueprintServiceContext({
      jobStore: createMemoryBlueprintJobStore(),
    });

    expect(typeof ctx.now()).toBe("object");
    expect(ctx.blueprintStores.intakes).toBeInstanceOf(Map);
    expect(ctx.blueprintStores.clarificationSessions).toBeInstanceOf(Map);
    expect(ctx.blueprintStores.projectContexts).toBeInstanceOf(Map);
    expect(typeof ctx.llm.callJson).toBe("function");
    expect(typeof ctx.llm.getConfig).toBe("function");
    expect(typeof ctx.sandboxDerivationRunner).toBe("function");
    expect(ctx.replayStore.listArtifacts("whatever")).toEqual([]);
    expect(ctx.replayStore.listEvents("whatever")).toEqual([]);
    expect(typeof ctx.eventBus.emit).toBe("function");
    expect(typeof ctx.eventBus.subscribe).toBe("function");
    expect(typeof ctx.specsRoot).toBe("string");
    expect(ctx.specsRoot.length).toBeGreaterThan(0);
    expect(typeof ctx.logger.info).toBe("function");
  });

  it("deps 可覆盖每一项依赖", () => {
    const now = () => new Date("2026-06-01T08:00:00.000Z");
    const jobStore = createMemoryBlueprintJobStore();
    const blueprintStores = createDefaultBlueprintStores();
    const fakeLogger = createSilentBlueprintLogger();
    const fakeCallJson = vi.fn();
    const fakeGetConfig = vi.fn().mockReturnValue({
      apiKey: "fake",
      baseURL: "https://example.test",
      model: "fake-model",
    });
    const sandboxDerivationRunner = vi.fn(async () => ({
      artifacts: [],
      events: [],
    }));

    const ctx = buildBlueprintServiceContext({
      now,
      jobStore,
      blueprintStores,
      llm: {
        callJson: fakeCallJson as unknown as typeof ctxLlmCallJsonFixture,
        getConfig: fakeGetConfig as unknown as () => ReturnType<
          typeof fakeGetConfig
        >,
      },
      sandboxDerivationRunner,
      logger: fakeLogger,
      specsRoot: "/tmp/spec-root-fixture",
    });

    expect(ctx.now().toISOString()).toBe("2026-06-01T08:00:00.000Z");
    expect(ctx.jobStore).toBe(jobStore);
    expect(ctx.blueprintStores).toBe(blueprintStores);
    expect(ctx.llm.callJson).toBe(fakeCallJson);
    expect(ctx.llm.getConfig).toBe(fakeGetConfig);
    expect(ctx.sandboxDerivationRunner).toBe(sandboxDerivationRunner);
    expect(ctx.logger).toBe(fakeLogger);
    expect(ctx.specsRoot).toBe("/tmp/spec-root-fixture");
  });

  it("默认 replayStore 是对 jobStore 的投影", () => {
    const jobStore = createMemoryBlueprintJobStore();
    const job = makeJob("job-1");
    job.events = [makeEvent("evt-1"), makeEvent("evt-2")];
    jobStore.save(job);

    const ctx = buildBlueprintServiceContext({ jobStore });
    expect(ctx.replayStore.listEvents("job-1")).toHaveLength(2);
    expect(ctx.replayStore.listArtifacts("job-1")).toHaveLength(0);
    expect(ctx.replayStore.listEvents("unknown")).toEqual([]);
  });

  it("传入自定义 replayStore 会跳过默认投影", () => {
    const listEvents = vi.fn(() => [makeEvent("custom")]);
    const ctx = buildBlueprintServiceContext({
      jobStore: createMemoryBlueprintJobStore(),
      replayStore: {
        listEvents,
        listArtifacts: () => [],
      },
    });

    expect(ctx.replayStore.listEvents("anything")).toHaveLength(1);
    expect(listEvents).toHaveBeenCalledWith("anything");
  });

  it("late runtime adapter rebind patches MCP/HTTP deps and refreshes LLM factories", () => {
    const ctx = buildBlueprintServiceContext({
      jobStore: createMemoryBlueprintJobStore(),
    });
    const oldSpecTreeDerivation = ctx.specTreeLlmDerivation;
    const oldSpecDocsGeneration = ctx.specDocsLlmGeneration;
    const mcpToolAdapter = { execute: vi.fn() };
    const httpFetcher = vi.fn();

    rebindBlueprintServiceContextRuntimeAdapters(ctx, {
      mcpToolAdapter,
      httpFetcher,
    });

    expect(ctx.mcpToolAdapter).toBe(mcpToolAdapter);
    expect(ctx.httpFetcher).toBe(httpFetcher);
    expect(ctx.specTreeLlmDerivation).toBeDefined();
    expect(ctx.specTreeLlmDerivation).not.toBe(oldSpecTreeDerivation);
    expect(ctx.specDocsLlmGeneration).toBeDefined();
    expect(ctx.specDocsLlmGeneration).not.toBe(oldSpecDocsGeneration);
  });

  it("late runtime adapter rebind patches skill registry and rebuilds role loader when enabled", () => {
    const previousFlag = process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED;
    process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED = "true";
    try {
      const ctx = buildBlueprintServiceContext({
        jobStore: createMemoryBlueprintJobStore(),
      });
      const oldRoleContainerLoader = ctx.roleContainerLoader;
      const skillRegistry = { loadForRole: vi.fn() };

      rebindBlueprintServiceContextRuntimeAdapters(ctx, {
        skillRegistry,
      });

      expect(ctx.skillRegistry).toBe(skillRegistry);
      expect(ctx.roleContainerLoader).toBeDefined();
      expect(ctx.roleContainerLoader).not.toBe(oldRoleContainerLoader);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED;
      } else {
        process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED = previousFlag;
      }
    }
  });

  it("默认事件总线 emit 会把事件推给所有订阅者，unsubscribe 后不再收到", () => {
    const ctx = buildBlueprintServiceContext({
      jobStore: createMemoryBlueprintJobStore(),
    });

    const received: BlueprintGenerationEvent[] = [];
    const unsubscribe = ctx.eventBus.subscribe(event => {
      received.push(event);
    });

    const e1 = makeEvent("e1");
    ctx.eventBus.emit(e1);
    expect(received).toEqual([e1]);

    unsubscribe();

    const e2 = makeEvent("e2");
    ctx.eventBus.emit(e2);
    expect(received).toEqual([e1]);
  });

  it("assembles roleAgentDelegator with executor real-mode dispatcher when agent pipeline is enabled", async () => {
    const previousAgentPipeline = process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED;
    const previousRoleAgent = process.env.BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED;
    const previousBuildTarget = process.env.BUILD_TARGET;
    process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED = "true";
    process.env.BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED = "true";
    process.env.BUILD_TARGET = "development";

    const tempDir = mkdtempSync(path.join(tmpdir(), "context-role-agent-real-"));
    const artifactPath = path.join(tempDir, "agent-output.json");
    const agentOutput = {
      jobId: "context-real-job",
      roleId: "planner",
      status: "completed" as const,
      output: {
        routes: [
          {
            title: "Primary runtime path",
            summary: "Use executor-backed role agent runtime.",
            kind: "primary",
          },
          {
            title: "Fallback runtime path",
            summary: "Keep lite mode available for degraded execution.",
            kind: "alternative",
          },
        ],
      },
      iterations: 1,
      totalTokens: 0,
      durationMs: 25,
      trace: [],
    };
    writeFileSync(artifactPath, `${JSON.stringify(agentOutput)}\n`, "utf-8");

    const assertReachable = vi.fn(async () => undefined);
    const dispatchPlan = vi.fn(async (_plan, dispatch: { jobId?: string } = {}) => ({
      request: { executor: "lobster", jobId: dispatch.jobId ?? "executor-job" },
      response: {
        ok: true,
        accepted: true,
        requestId: "request-1",
        missionId: "context-real-job",
        jobId: dispatch.jobId ?? "executor-job",
        receivedAt: "2026-05-22T00:00:00.000Z",
      },
    }));
    const getJob = vi.fn(async () => ({
      requestId: "request-1",
      missionId: "context-real-job",
      jobId: "executor-job",
      jobKey: "role_agent.run",
      jobLabel: "Run role agent",
      kind: "execute",
      status: "completed",
      progress: 100,
      message: "done",
      receivedAt: "2026-05-22T00:00:00.000Z",
      callbackMode: "pending",
      artifactCount: 1,
      artifacts: [
        {
          kind: "report",
          name: "agent-output.json",
          path: artifactPath,
          previewType: "json",
        },
      ],
      events: [],
      dataDirectory: tempDir,
      logFile: path.join(tempDir, "executor.log"),
    }));

    try {
      const ctx = buildBlueprintServiceContext({
        jobStore: createMemoryBlueprintJobStore(),
        llm: {
          callJson: vi.fn(async () => ({
            finish: { output: agentOutput.output },
            thought: "test fallback",
          })) as unknown as typeof ctxLlmCallJsonFixture,
          getConfig: vi.fn().mockReturnValue({
            apiKey: "fake",
            baseURL: "https://example.test",
            model: "fake-model",
          }),
        },
        executorClient: {
          assertReachable,
          dispatchPlan,
          getJob,
        } as unknown as ExecutorClient,
      });

      expect(ctx.roleAgentDelegator).toBeDefined();
      const out = await ctx.roleAgentDelegator!.delegate({
        roleId: "planner",
        stageId: "route_generation",
        jobId: "context-real-job",
        goal: "Generate routes through real mode",
        systemPrompt: "You are a planner",
        context: {
          routeSetId: "routeset-context",
          primaryRouteId: "routeset-context:primary",
          request: { targetText: "Runtime connectivity" },
        },
        budget: {
          maxIterations: 5,
          maxTokens: 20_000,
          timeoutMs: 30_000,
          toolTimeoutMs: 5_000,
          allowParallelTools: false,
        },
        outputSchema: {
          type: "object",
          required: ["routes"],
          properties: { routes: { type: "array" } },
        },
      });

      expect(out.executionMode).toBe("real");
      expect(assertReachable).toHaveBeenCalled();
      expect(dispatchPlan).toHaveBeenCalledTimes(1);
      expect(getJob).toHaveBeenCalled();
    } finally {
      if (previousAgentPipeline === undefined) {
        delete process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED;
      } else {
        process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED = previousAgentPipeline;
      }
      if (previousRoleAgent === undefined) {
        delete process.env.BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED;
      } else {
        process.env.BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED = previousRoleAgent;
      }
      if (previousBuildTarget === undefined) {
        delete process.env.BUILD_TARGET;
      } else {
        process.env.BUILD_TARGET = previousBuildTarget;
      }
    }
  });
});

/**
 * 仅用于类型对齐的占位常量；避免把完整 `callLLMJson` 的复杂签名搬进测试。
 */
const ctxLlmCallJsonFixture = (async () => ({
  content: "",
  model: "",
  latencyMs: 0,
})) as unknown;

/**
 * `blueprint-v4-full-alignment` 全流程上电（opt-out on）集成校验。
 *
 * 验证 5 个 v4 gate 的"装配真相"：
 * - 5 个 gate 全开时，context 真实实例化 companionLayer / contentQuality /
 *   traceabilityMatrixService / previewAuditService / checksLedger；
 * - 5 个 gate 全关时，对应字段一律 undefined（保护既有 85+ E2E 基线：
 *   测试默认不设 gate，全部走 no-op optional-chaining 路径）。
 *
 * 这一组断言对应 `dev:all` 注入的 opt-out-on 语义在 context 层的落点。
 */
describe("buildBlueprintServiceContext v4 alignment gates", () => {
  const V4_GATES = [
    "BLUEPRINT_CHECKS_LEDGER_ENABLED",
    "BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED",
    "BLUEPRINT_COMPANION_ENABLED",
    "BLUEPRINT_TRACEABILITY_MATRIX_ENABLED",
    "BLUEPRINT_PREVIEW_AUDIT_ENABLED",
  ] as const;

  function withGates(value: "true" | "off", run: () => void): void {
    const saved = new Map<string, string | undefined>();
    for (const key of V4_GATES) {
      saved.set(key, process.env[key]);
      if (value === "true") {
        process.env[key] = "true";
      } else {
        delete process.env[key];
      }
    }
    try {
      run();
    } finally {
      for (const key of V4_GATES) {
        const prev = saved.get(key);
        if (prev === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = prev;
        }
      }
    }
  }

  it("5 个 gate 全开：companion / content-quality / matrix / preview-audit / ledger 全部装配", () => {
    withGates("true", () => {
      const ctx = buildBlueprintServiceContext({
        jobStore: createMemoryBlueprintJobStore(),
      });
      expect(ctx.checksLedger).toBeDefined();
      expect(ctx.contentQuality).toBeDefined();
      expect(ctx.companionLayer).toBeDefined();
      expect(ctx.traceabilityMatrixService).toBeDefined();
      expect(ctx.previewAuditService).toBeDefined();
      // 子服务可用性自检（不发起任何 LLM / IO）：
      expect(typeof ctx.companionLayer!.evaluateAll).toBe("function");
      expect(typeof ctx.contentQuality!.validateDocuments).toBe("function");
      expect(typeof ctx.traceabilityMatrixService!.generateMatrix).toBe(
        "function",
      );
      expect(typeof ctx.previewAuditService!.auditPreviews).toBe("function");
    });
  });

  it("5 个 gate 全关：对应字段一律 undefined（保护既有 E2E 基线）", () => {
    withGates("off", () => {
      const ctx = buildBlueprintServiceContext({
        jobStore: createMemoryBlueprintJobStore(),
      });
      expect(ctx.checksLedger).toBeUndefined();
      expect(ctx.contentQuality).toBeUndefined();
      expect(ctx.companionLayer).toBeUndefined();
      expect(ctx.traceabilityMatrixService).toBeUndefined();
      expect(ctx.previewAuditService).toBeUndefined();
    });
  });
});
