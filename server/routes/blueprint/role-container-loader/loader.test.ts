import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintCapabilityInvocation,
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
  RoleCapabilityPackage,
} from "../../../../shared/blueprint/index.js";
import { BlueprintEventName } from "../../../../shared/blueprint/events.js";

import type { ExecutorClient } from "../../../core/executor-client.js";
import type {
  McpToolExecutionRequest,
  McpToolExecutionResult,
} from "../../../tool/api/mcp-tool-adapter.js";
import type {
  BlueprintEventBus,
  BlueprintServiceContext,
  McpToolAdapterDependency,
} from "../context.js";

import { createBlueprintRuntimeDiagnosticsStore } from "../runtime-enablement/diagnostics-store.js";

import {
  createInMemoryRoleRuntimeContextStore,
  createRoleContainerLoader,
  type RoleContainerLoader,
} from "./loader.js";

/**
 * Co-located 单元测试（Task 9.8）。覆盖：
 * (a) Tier 1 off 完全 no-op；
 * (b) 幂等 provision（同 key 两次 → dispatchPlan 只调一次，两次 ready 事件，
 *     第二次 cached=true）；
 * (c) 幂等 teardown（同 key 两次）；
 * (d) provision 下游 lifecycle 抛错降级 lite 不传播；
 * (e) teardown destroy 抛错计入 orphan 且事件仍 emit；
 * (f) driver hook：active→provision / sleeping→teardown / 其它 state 无触发。
 */

// ── Fakes ───────────────────────────────────────────────────────────────────

function buildLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createCapturingEventBus(): {
  bus: BlueprintEventBus;
  events: BlueprintGenerationEvent[];
} {
  const events: BlueprintGenerationEvent[] = [];
  const listeners: Array<(e: BlueprintGenerationEvent) => void> = [];
  const bus: BlueprintEventBus = {
    emit(event) {
      events.push(event);
      for (const l of listeners) l(event);
    },
    subscribe(l) {
      listeners.push(l);
      return () => {
        const idx = listeners.indexOf(l);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
  return { bus, events };
}

interface FakeJobStoreOptions {
  job?: BlueprintGenerationJob;
}

function createFakeJobStore(opts: FakeJobStoreOptions = {}) {
  const jobs = new Map<string, BlueprintGenerationJob>();
  if (opts.job) jobs.set(opts.job.id, opts.job);
  return {
    list: () => [...jobs.values()],
    get: (id: string) => jobs.get(id) ?? null,
    save: (job: BlueprintGenerationJob) => {
      jobs.set(job.id, job);
    },
    latest: () => null,
  };
}

function createFakeExecutorClient(options: {
  assertReachable?: () => Promise<void>;
  dispatchPlan?: (
    plan: unknown,
    opts?: { jobId?: string },
  ) => Promise<{
    request: unknown;
    response: { ok: true; accepted: true; jobId: string };
  }>;
  cancelJob?: (jobId: string) => Promise<void>;
} = {}): ExecutorClient {
  const fake = {
    assertReachable: options.assertReachable ?? (async () => void 0),
    dispatchPlan:
      options.dispatchPlan ??
      (async (_plan, opts) => ({
        request: { jobId: opts?.jobId ?? "fake" },
        response: {
          ok: true,
          accepted: true,
          jobId: opts?.jobId ?? "fake",
        },
      })),
    ...(options.cancelJob !== undefined ? { cancelJob: options.cancelJob } : {}),
  };
  return fake as unknown as ExecutorClient;
}

function createFakeMcpAdapter(): McpToolAdapterDependency {
  return {
    async execute(_req: McpToolExecutionRequest): Promise<McpToolExecutionResult> {
      return {
        ok: true,
        status: "completed",
        targetLabel: "t",
        operation: "meta.ping",
        resource: "",
        output: "pong",
        response: null,
        governance: {
          approval: { required: false, status: "not_required", source: "none" },
        },
        metadata: {
          serverId: "x",
          toolName: "meta.ping",
          timeoutMs: 5_000,
          fallbackUsed: false,
        },
      };
    },
  };
}

interface HarnessOptions {
  executorClient?: ExecutorClient | undefined;
  mcpToolAdapter?: McpToolAdapterDependency;
  skillRegistry?: BlueprintServiceContext["skillRegistry"];
  aigcSpecNodeCapabilityBridge?: BlueprintServiceContext["aigcSpecNodeCapabilityBridge"];
  job?: BlueprintGenerationJob;
  defaultsCatalog?: Record<string, RoleCapabilityPackage>;
  now?: () => Date;
}

function buildHarness(options: HarnessOptions = {}) {
  const { bus, events } = createCapturingEventBus();
  const logger = buildLogger();
  const jobStore = createFakeJobStore({ job: options.job });
  const runtimeDiagnostics = createBlueprintRuntimeDiagnosticsStore({
    now: options.now ?? (() => new Date("2026-05-12T00:00:00.000Z")),
  });
  const runtimeStore = createInMemoryRoleRuntimeContextStore();

  // 把最小 context 对象强制转为 BlueprintServiceContext；loader 只消费下面
  // 这些字段，其它字段保持 undefined 即可。
  const ctx = {
    now: options.now ?? (() => new Date("2026-05-12T00:00:00.000Z")),
    blueprintStores: { intakes: new Map(), clarificationSessions: new Map(), projectContexts: new Map() },
    jobStore,
    llm: {
      callJson: vi.fn(),
      getConfig: vi.fn(),
    },
    sandboxDerivationRunner: async () => ({ artifacts: [], events: [] }),
    replayStore: { listEvents: () => [], listArtifacts: () => [] },
    eventBus: bus,
    specsRoot: "/tmp",
    logger,
    executorClient: options.executorClient,
    mcpToolAdapter: options.mcpToolAdapter,
    skillRegistry: options.skillRegistry,
    aigcSpecNodeCapabilityBridge: options.aigcSpecNodeCapabilityBridge,
    runtimeDiagnostics,
    roleRuntimeContextStore: runtimeStore,
  } as unknown as BlueprintServiceContext;

  const loader = createRoleContainerLoader(ctx, options.defaultsCatalog);
  return { ctx, loader, events, logger, jobStore, runtimeStore };
}

// ── Test sequencing ─────────────────────────────────────────────────────────

function enableLoader() {
  vi.stubEnv("BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED", "true");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RoleContainerLoader — Tier 1 gate", () => {
  it("(a) flag 未启用时 provision/teardown/hook 全部 no-op 且不 emit 事件", async () => {
    // 未开 env
    const { loader, events, ctx } = buildHarness({
      executorClient: createFakeExecutorClient(),
      mcpToolAdapter: createFakeMcpAdapter(),
    });
    const assertReachable = vi.spyOn(ctx.executorClient!, "assertReachable");
    const key = { roleId: "r", stageId: "runtime_capability" as const, jobId: "j" };
    const runtime = await loader.provisionRoleContainer(key);
    expect(runtime.lifecycle.state).toBe("failed");
    expect(events).toHaveLength(0);
    expect(assertReachable).not.toHaveBeenCalled();

    const handoff = await loader.tearDownRoleContainer(key);
    expect(handoff).toBeUndefined();
    expect(events).toHaveLength(0);

    loader.onStageTransitionHook(
      { jobId: "j", stageId: "runtime_capability" },
      new Map([["r", "active"]]),
    );
    await new Promise((r) => setImmediate(r));
    expect(events).toHaveLength(0);
  });
});

describe("RoleContainerLoader — provision (real mode)", () => {
  it("(b) 幂等：同 key 两次 provision → dispatchPlan 只调一次、两次 ready 事件、第二次 cached=true", async () => {
    enableLoader();
    const dispatchPlan = vi.fn().mockResolvedValue({
      request: {},
      response: { ok: true, accepted: true, jobId: "exec-abc" },
    });
    const executorClient = createFakeExecutorClient({ dispatchPlan });
    const { loader, events } = buildHarness({
      executorClient,
      mcpToolAdapter: createFakeMcpAdapter(),
      defaultsCatalog: {
        "role-x": {
          alwaysBound: [
            { kind: "mcp", id: "github" },
          ],
        },
      },
    });

    const key = { roleId: "role-x", stageId: "runtime_capability" as const, jobId: "job-1" };
    const c1 = await loader.provisionRoleContainer(key);
    const c2 = await loader.provisionRoleContainer(key);

    expect(c1).toBe(c2); // 同一引用
    expect(c1.mode).toBe("real");
    expect(dispatchPlan).toHaveBeenCalledTimes(1);

    const readyEvents = events.filter(
      (e) => e.type === BlueprintEventName.RoleContainerReady,
    );
    const provEvents = events.filter(
      (e) => e.type === BlueprintEventName.RoleContainerProvisioning,
    );
    expect(readyEvents).toHaveLength(2);
    expect(provEvents).toHaveLength(1);
    const secondReadyPayload = readyEvents[1].payload as { cached?: boolean };
    expect(secondReadyPayload.cached).toBe(true);
  });

  it("loads always-bound skills from the configured skill registry", async () => {
    enableLoader();
    const loadForRole = vi.fn(async ({ roleId, skillId }) => ({
      roleId,
      skillId,
      loadedAt: "2026-05-12T00:00:00.000Z",
      invoke: vi.fn(async (input: unknown) => ({ skillId, input })),
    }));
    const harness = buildHarness({
      executorClient: createFakeExecutorClient(),
      skillRegistry: { loadForRole },
      defaultsCatalog: {
        "execution-engineer": {
          alwaysBound: [
            { kind: "skill", id: "execution-playbook" },
          ],
        },
      },
    });

    const runtime = await harness.loader.provisionRoleContainer({
      roleId: "role-runtime-executor",
      stageId: "runtime_capability",
      jobId: "job-1",
    });
    const output = await runtime.skill.invoke("execution-playbook", {
      directive: "ship it",
    });

    expect(loadForRole).toHaveBeenCalledWith({
      roleId: "role-runtime-executor",
      skillId: "execution-playbook",
    });
    expect(runtime.skill.list()).toEqual(["execution-playbook"]);
    expect(output).toEqual({
      skillId: "execution-playbook",
      input: { directive: "ship it" },
    });
  });

  it("on-demand AIGC nodes invoke the configured aigcSpecNodeCapabilityBridge", async () => {
    enableLoader();
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED", "true");
    const invocation: BlueprintCapabilityInvocation = {
      id: "inv-aigc-real",
      jobId: "job-1",
      capabilityId: "code-synthesis",
      capabilityLabel: "code-synthesis",
      kind: "aigc_node",
      roleId: "role-runtime-executor",
      nodeId: "code-synthesis",
      status: "completed",
      securityLevel: "sandboxed",
      safetyGate: {
        status: "allowed",
        reason: "test",
        requiresApproval: false,
        approved: true,
        securityLevel: "sandboxed",
      },
      requestedAt: "2026-05-12T00:00:00.000Z",
      completedAt: "2026-05-12T00:00:01.000Z",
      durationMs: 1000,
      input: "fixture",
      outputSummary: "real aigc output",
      logs: [],
      evidenceIds: [],
      provenance: {
        jobId: "job-1",
        githubUrls: [],
        executionMode: "real",
      },
    };
    const bridge = vi.fn(async () => ({
      invocation,
      executionMode: "real" as const,
      additionalEvents: [],
    }));
    const harness = buildHarness({
      executorClient: createFakeExecutorClient(),
      aigcSpecNodeCapabilityBridge: bridge,
      defaultsCatalog: {
        "execution-engineer": {
          onDemand: {
            aigcNodes: [{ kind: "aigc_node", id: "code-synthesis" }],
          },
        },
      },
    });

    const runtime = await harness.loader.provisionRoleContainer({
      roleId: "role-runtime-executor",
      stageId: "runtime_capability",
      jobId: "job-1",
    });
    const result = await runtime.aigcNode.orchestrate(["code-synthesis"], {
      request: { targetText: "Build real AIGC bridge" },
    });

    expect(bridge).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.nodeResults[0]?.executionMode).toBe("real");
    expect(result.mergedOutputSummary).toContain("real aigc output");
  });

  it("(d) lifecycle 抛错（executor unreachable）降级 lite，不向调用方传播", async () => {
    enableLoader();
    const executorClient = createFakeExecutorClient({
      assertReachable: async () => {
        throw new Error("executor down");
      },
    });
    const { loader, events } = buildHarness({
      executorClient,
      mcpToolAdapter: createFakeMcpAdapter(),
    });
    const key = { roleId: "role-y", stageId: "runtime_capability" as const, jobId: "job-2" };
    const runtime = await loader.provisionRoleContainer(key);
    expect(runtime.mode).toBe("lite");
    expect(runtime.lifecycle.fallbackReason).toContain("executor unreachable");
    const ready = events.find(
      (e) => e.type === BlueprintEventName.RoleContainerReady,
    );
    expect(ready).toBeDefined();
    const payload = ready!.payload as {
      executionMode: string;
      containerMode: string;
    };
    expect(payload.containerMode).toBe("lite");
    expect(payload.executionMode).toBe("simulated_fallback");
  });
});

describe("RoleContainerLoader — teardown", () => {
  it("(c) 幂等 teardown：同 key 两次 → destroy 只调一次、teardown 事件只 emit 一次", async () => {
    enableLoader();
    const cancelJob = vi.fn().mockResolvedValue(undefined);
    const executorClient = createFakeExecutorClient({ cancelJob });
    const { loader, events, jobStore } = buildHarness({
      executorClient,
      mcpToolAdapter: createFakeMcpAdapter(),
      job: {
        id: "job-3",
        createdAt: "2026-05-12T00:00:00Z",
        updatedAt: "2026-05-12T00:00:00Z",
        status: "running",
        stage: "runtime_capability",
        projectId: "p",
        request: { targetText: "t", githubUrls: [] },
        artifacts: [],
        events: [],
      } as unknown as BlueprintGenerationJob,
      defaultsCatalog: {
        "role-x": { alwaysBound: [] },
      },
    });

    const key = { roleId: "role-x", stageId: "runtime_capability" as const, jobId: "job-3" };
    await loader.provisionRoleContainer(key);
    const h1 = await loader.tearDownRoleContainer(key);
    const h2 = await loader.tearDownRoleContainer(key);

    expect(h1).toBeDefined();
    expect(h2).toBe(h1);
    expect(cancelJob).toHaveBeenCalledTimes(1);
    const teardowns = events.filter(
      (e) => e.type === BlueprintEventName.RoleContainerTeardown,
    );
    expect(teardowns).toHaveLength(1);

    // job.artifacts 已追加 handoff artifact
    const job = jobStore.get("job-3");
    expect(job?.artifacts ?? []).toHaveLength(1);
  });

  it("(e) destroy 抛错：orphan=true 且 teardown 事件仍 emit", async () => {
    enableLoader();
    const cancelJob = vi.fn().mockRejectedValue(new Error("network partition"));
    const executorClient = createFakeExecutorClient({ cancelJob });
    const { loader, events } = buildHarness({
      executorClient,
      mcpToolAdapter: createFakeMcpAdapter(),
      job: {
        id: "job-4",
        createdAt: "2026-05-12T00:00:00Z",
        updatedAt: "2026-05-12T00:00:00Z",
        status: "running",
        stage: "runtime_capability",
        projectId: "p",
        request: { targetText: "t", githubUrls: [] },
        artifacts: [],
        events: [],
      } as unknown as BlueprintGenerationJob,
      defaultsCatalog: {
        "role-x": { alwaysBound: [] },
      },
    });

    const key = { roleId: "role-x", stageId: "runtime_capability" as const, jobId: "job-4" };
    await loader.provisionRoleContainer(key);
    await loader.tearDownRoleContainer(key);
    expect(cancelJob).toHaveBeenCalledTimes(1);
    const teardown = events.find(
      (e) => e.type === BlueprintEventName.RoleContainerTeardown,
    );
    expect(teardown).toBeDefined();
    const payload = teardown!.payload as { orphan?: boolean };
    expect(payload.orphan).toBe(true);
  });
});

describe("RoleContainerLoader.onStageTransitionHook", () => {
  it("(f) active 触发 provision，sleeping 触发 teardown，其它 state 无触发", async () => {
    enableLoader();
    const dispatchPlan = vi.fn().mockResolvedValue({
      request: {},
      response: { ok: true, accepted: true, jobId: "e1" },
    });
    const cancelJob = vi.fn().mockResolvedValue(undefined);
    const executorClient = createFakeExecutorClient({ dispatchPlan, cancelJob });
    const { loader, events } = buildHarness({
      executorClient,
      mcpToolAdapter: createFakeMcpAdapter(),
      defaultsCatalog: { "role-x": { alwaysBound: [] } },
      job: {
        id: "job-5",
        createdAt: "t",
        updatedAt: "t",
        status: "running",
        stage: "runtime_capability",
        projectId: "p",
        request: { targetText: "t", githubUrls: [] },
        artifacts: [],
        events: [],
      } as unknown as BlueprintGenerationJob,
    });

    loader.onStageTransitionHook(
      { jobId: "job-5", stageId: "runtime_capability" },
      new Map<string, "active" | "watching" | "reviewing" | "sleeping">([
        ["role-x", "active"],
        ["role-w", "watching"],
        ["role-r", "reviewing"],
      ]),
    );
    // 等待 fire-and-forget 完成
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchPlan).toHaveBeenCalledTimes(1);

    loader.onStageTransitionHook(
      { jobId: "job-5", stageId: "runtime_capability" },
      new Map([["role-x", "sleeping"]]),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(cancelJob).toHaveBeenCalledTimes(1);

    // watching / reviewing 不应产生 provisioning 或 teardown 事件
    const allRoles = events
      .filter(
        (e) =>
          e.type === BlueprintEventName.RoleContainerProvisioning ||
          e.type === BlueprintEventName.RoleContainerTeardown,
      )
      .map((e) => (e.payload as { key: { roleId: string } }).key.roleId);
    expect(allRoles).toEqual(["role-x", "role-x"]);
  });
});

describe("RoleContainerLoader.getDiagnostics", () => {
  it("从 runtimeDiagnostics 读出 loader entry（缺失时 mode=unknown）", () => {
    const { loader } = buildHarness();
    // 未经过 Task 13 扩展：loader entry 读不到，降级为 unknown
    const diag = loader.getDiagnostics();
    expect(diag.mode).toBe("unknown");
    expect(diag.totalProvisions).toBe(0);
  });
});

describe("RoleContainerLoader — contract usage", () => {
  it("provision 入参非法时返回 stub，不抛错", async () => {
    enableLoader();
    const { loader } = buildHarness();
    const runtime = await loader.provisionRoleContainer({
      roleId: "",
      stageId: "runtime_capability",
      jobId: "",
    });
    expect(runtime.lifecycle.state).toBe("failed");
  });

  it("(loader as any) 显式暴露 RoleContainerLoader 接口", () => {
    const { loader } = buildHarness();
    const typed: RoleContainerLoader = loader;
    expect(typeof typed.provisionRoleContainer).toBe("function");
    expect(typeof typed.tearDownRoleContainer).toBe("function");
    expect(typeof typed.onStageTransitionHook).toBe("function");
    expect(typeof typed.getDiagnostics).toBe("function");
  });
});
