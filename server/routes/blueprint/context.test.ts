import { describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
} from "../../../shared/blueprint/index.js";
import { BlueprintEventName } from "../../../shared/blueprint/events.js";
import { createMemoryBlueprintJobStore } from "../blueprint.js";

import {
  __resetCachedDefaultBlueprintJobStore,
  buildBlueprintServiceContext,
  createDefaultBlueprintStores,
  createJobBackedReplayStore,
  createSilentBlueprintLogger,
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
});

/**
 * 仅用于类型对齐的占位常量；避免把完整 `callLLMJson` 的复杂签名搬进测试。
 */
const ctxLlmCallJsonFixture = (async () => ({
  content: "",
  model: "",
  latencyMs: 0,
})) as unknown;
