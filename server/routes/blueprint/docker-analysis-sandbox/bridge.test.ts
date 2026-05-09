/**
 * Docker Capability Bridge — 主算法单元测试（Task 11）
 *
 * 本测试覆盖 `createDockerCapabilityBridge(ctx)` 的三条核心路径：
 *
 * - 11.1 Happy path（real 执行）：注入一套正常工作的 fake `executorClient` +
 *   fake `executorCallbackDispatcher`，`BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED=true`
 *   → 终态事件 `job.completed` 返回 → 断言 `invocation.provenance.executionMode === "real"`
 *   以及 `containerId / artifactUrl / durationMs / outputSummary` 等真实字段来自
 *   执行器回调，而非 fallback 模板。
 *
 * - 11.2 Timeout → fallback：`dispatchPlan` 成功但 `awaitTerminal` 始终抛出
 *   `Error("callback timeout")` → 断言 `executionMode === "simulated_fallback"`、
 *   `error === "callback timeout"`、`cancelJob` 恰好被调用一次；并断言
 *   `outputSummary / logs / durationMs` 完全等同于 `buildCapabilityOutputSummary`
 *   / `buildCapabilityInvocationLogs` / `deterministicCapabilityDuration` 的
 *   模板化产出（与今天 simulated 路径形态等价）。
 *
 * - 11.3 Unreachable → fallback：`executorClient.assertReachable` 抛
 *   `new ExecutorClientError("executor down", "unavailable")` → 断言
 *   `executionMode === "simulated_fallback"`、`error` 匹配 `/executor unreachable/`、
 *   `dispatchPlan` 未被调用、`ctx.logger.warn` 被调用且包含 `"executor unreachable"`。
 *
 * 所有用例都通过 fake ctx 驱动：不启动真实 Docker、不发真实 HTTP 请求，
 * 不依赖 `services/lobster-executor` 任何实现，符合 design §2 D1 / §2 D2 约束。
 *
 * 测试风格：全部 example-based（需求 9.3 明确禁止 PBT）。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 *
 * - requirements 2.1 / 2.2 / 2.3 / 2.4 / 3.1 / 3.2 / 3.3 / 4.1 / 4.2 / 4.3 /
 *   4.5 / 6.4 / 6.5 / 9.2
 * - design §4.6（主算法）、§4.7（real invocation 构造）、§4.8（fallback 构造）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutorClientError, type ExecutorClient } from "../../../core/executor-client.js";
import {
  buildCapabilityInvocationLogs,
  buildCapabilityOutputSummary,
  deterministicCapabilityDuration,
} from "../../blueprint.js";
import { buildBlueprintServiceContext } from "../context.js";
import type {
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";
import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutorEvent,
  type ExecutionPlan,
} from "../../../../shared/executor/contracts.js";

import { createDockerCapabilityBridge } from "./bridge.js";
import { createDefaultDockerCapabilityPolicy } from "./policy.js";
import type {
  BlueprintExecutorCallbackDispatcher,
  DockerCapabilityBridgeInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures —— 与 `execution-plan.test.ts` 同源，便于后续共享抽离
// ---------------------------------------------------------------------------

/**
 * 构造最小可用的 `BlueprintRuntimeCapability` fixture。
 *
 * 字段值参考 `server/routes/blueprint.ts` 中 `getDefaultRuntimeCapabilities()`
 * 里 `docker-analysis-sandbox` 条目，保持与生产路径同源。
 */
function buildCapabilityFixture(
  overrides: Partial<BlueprintRuntimeCapability> = {},
): BlueprintRuntimeCapability {
  return {
    id: "docker-analysis-sandbox",
    label: "Docker analysis sandbox",
    kind: "docker",
    purpose:
      "Run isolated repository analysis and deterministic command previews.",
    description:
      "Sandboxed container adapter for blueprint runtime inspection without host writes.",
    tags: ["runtime", "sandbox", "analysis"],
    securityLevel: "sandboxed",
    status: "available",
    adapter: "blueprint.runtime.docker.simulated",
    inputSchema: "text/plain",
    outputTypes: ["log", "document"],
    supportedStages: ["route_generation", "spec_tree", "runtime_capability"],
    requiresApproval: false,
    projectScoped: true,
    ...overrides,
  };
}

function buildRouteFixture(
  overrides: Partial<BlueprintRouteCandidate> = {},
): BlueprintRouteCandidate {
  return {
    id: "route_primary_001",
    kind: "primary",
    title: "Quick analysis",
    summary: "Quickly analyze the target repository for structure insights.",
    rationale: "Default primary route for repository analysis.",
    riskLevel: "low",
    costLevel: "low",
    complexity: "light",
    estimatedEffort: "<1h",
    capabilities: [],
    steps: [],
    outputs: ["RouteSet outline"],
    ...overrides,
  };
}

function buildRouteSetFixture(
  overrides: Partial<BlueprintRouteSet> = {},
): BlueprintRouteSet {
  return {
    id: "rs_001",
    requestId: "req_001",
    createdAt: "2026-01-01T00:00:00.000Z",
    primaryRouteId: "route_primary_001",
    routes: [],
    nextAsset: {
      type: "spec_tree",
      menu: "deduction",
      description: "Next asset for route selection.",
    },
    provenance: {
      githubUrls: [],
    },
    ...overrides,
  };
}

function buildRequestFixture(
  overrides: Partial<BlueprintGenerationRequest> = {},
): BlueprintGenerationRequest {
  return {
    projectId: "proj_001",
    targetText: "https://github.com/foo/bar",
    githubUrls: ["https://github.com/foo/bar"],
    ...overrides,
  };
}

function buildBridgeInput(
  overrides: Partial<DockerCapabilityBridgeInput> = {},
): DockerCapabilityBridgeInput {
  return {
    capability: buildCapabilityFixture(),
    route: buildRouteFixture(),
    jobId: "job_default_123",
    request: buildRequestFixture(),
    routeSet: buildRouteSetFixture(),
    createdAt: "2026-01-01T00:00:00.000Z",
    invocationId: "inv_default_456",
    roleId: "role-runtime-executor",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake dependencies —— executor client + callback dispatcher + logger
// ---------------------------------------------------------------------------

/**
 * 构造一个满足 bridge 运行期消费的 fake `ExecutorClient`。
 *
 * Bridge 只调用 `assertReachable`、`dispatchPlan` 以及（duck-typed 的）`cancelJob`；
 * `ExecutorClient` 类型上其它方法 bridge 不会触达，此处用 `as unknown as ExecutorClient`
 * 强制收束类型，不必实现 `getCapabilities / validatePlanCapabilities / buildJobRequest`
 * 等无关方法。
 */
function createFakeExecutorClient(overrides: {
  assertReachable?: () => Promise<void>;
  dispatchPlan?: (
    plan: ExecutionPlan,
    options?: { jobId?: string; requestId?: string; idempotencyKey?: string },
  ) => Promise<{ request: unknown; response: { ok: true; accepted: true; jobId: string } }>;
  cancelJob?: (jobId: string) => Promise<void>;
}): ExecutorClient {
  const fake = {
    assertReachable:
      overrides.assertReachable ?? (async () => {
        // default: reachable
      }),
    dispatchPlan:
      overrides.dispatchPlan ??
      (async (_plan: ExecutionPlan, options?: { jobId?: string }) => ({
        request: {},
        response: {
          ok: true as const,
          accepted: true as const,
          jobId: options?.jobId ?? "job_fake",
        },
      })),
    // `cancelJob` 是 duck-typed 可选方法（design §5.4）；bridge 仅在
    // callback failed / timeout 场景中用 optional chaining 调用。未在
    // overrides 中提供时留空即可。
    ...(overrides.cancelJob !== undefined ? { cancelJob: overrides.cancelJob } : {}),
  };
  return fake as unknown as ExecutorClient;
}

/**
 * 构造一个满足 bridge 运行期消费的 fake `BlueprintExecutorCallbackDispatcher`。
 *
 * - `awaitTerminal` 默认抛出 "not implemented"，强制调用方在 overrides 中明确行为；
 * - `handleEvent` 默认 no-op，bridge 本身不在测试路径上调用它；
 * - `collectLogs` 默认返回一个空的 collector，`getDigest` 返回固定 stub hex，
 *   用例可通过 overrides 注入日志序列。
 */
function createFakeCallbackDispatcher(overrides: {
  awaitTerminal?: (jobId: string, timeoutMs: number) => Promise<ExecutorEvent>;
  handleEvent?: (event: ExecutorEvent) => void;
  collectLogs?: (
    jobId: string,
    maxLines: number,
    maxBytes: number,
  ) => {
    getLogs: () => string[];
    getDigest: () => string | undefined;
    dispose: () => void;
  };
}): BlueprintExecutorCallbackDispatcher {
  return {
    awaitTerminal:
      overrides.awaitTerminal ??
      (async () => {
        throw new Error("awaitTerminal not implemented in fake dispatcher");
      }),
    handleEvent: overrides.handleEvent ?? (() => {}),
    collectLogs:
      overrides.collectLogs ??
      (() => ({
        getLogs: () => [],
        getDigest: () => "0".repeat(64),
        dispose: () => {},
      })),
  };
}

/**
 * 创建一个带 spy 的 logger，四个方法全部收集调用参数。
 *
 * `BlueprintLogger` 接口包含 `debug / info / warn / error`；
 * 这里用 `vi.fn()` 保留调用现场，便于 11.3 用例断言 warn 收到了
 * 预期信息。
 */
function createSpyLogger(): {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("createDockerCapabilityBridge — 11.1 Happy path（real 执行）", () => {
  beforeEach(() => {
    // bridge 只有在 BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED === "true" 时
    // 才会进入真实 Docker 路径（design §D2 opt-in）。这里全程在测试期 stub。
    vi.stubEnv("BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a real invocation when executor completes successfully", async () => {
    // 准备一个合法的 job.completed 终态事件：summary / metrics / artifacts / payload
    // 都非空，bridge 应该据此构造 real invocation。
    const terminalEvent: ExecutorEvent = {
      version: EXECUTOR_CONTRACT_VERSION,
      eventId: "evt_terminal",
      missionId: "blueprint:job_test_happy",
      jobId: "inv_test_happy",
      executor: "lobster",
      type: "job.completed",
      status: "completed",
      occurredAt: "2026-01-01T00:00:01.834Z",
      message: "Docker analysis finished.",
      summary: "Docker analysis completed: 3 risks, 2 recommendations.",
      metrics: { durationMs: 1834 },
      artifacts: [
        {
          kind: "report",
          name: "analysis.json",
          url: "/executor/artifacts/analysis.json",
        },
      ],
      payload: { containerId: "ctr_abc123" },
    };

    const fakeExecutor = createFakeExecutorClient({});
    const fakeDispatcher = createFakeCallbackDispatcher({
      awaitTerminal: async () => terminalEvent,
      collectLogs: () => ({
        getLogs: () => ["[INFO] analysis started\n", "[INFO] 3 risks detected\n"],
        getDigest: () => "a".repeat(64),
        dispose: () => {},
      }),
    });

    // 使用受控的 now：第一次调用作为 dispatchedAt，第二次作为 completedAt，
    // 保证 `durationMs > 0`，同时避免墙钟抖动。
    const times = [
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:01.834Z"),
    ];
    let nowIndex = 0;
    const now = () => times[Math.min(nowIndex++, times.length - 1)];

    const ctx = buildBlueprintServiceContext({
      executorClient: fakeExecutor,
      executorCallbackDispatcher: fakeDispatcher,
      dockerCapabilityPolicy: createDefaultDockerCapabilityPolicy(),
      now,
    });

    const bridge = createDockerCapabilityBridge(ctx);
    const input = buildBridgeInput({
      invocationId: "inv_test_happy",
      jobId: "job_test_happy",
    });
    const output = await bridge(input);

    // 核心断言：真实 Docker 执行路径生效。
    expect(output.invocation.provenance.executionMode).toBe("real");
    expect(output.invocation.provenance.containerId).toBe("ctr_abc123");
    expect(output.invocation.provenance.artifactUrl).toMatch(/analysis\.json$/);
    expect(output.invocation.durationMs).toBeGreaterThan(0);

    // outputSummary 来自 terminalEvent.summary，而不是 buildCapabilityOutputSummary 模板。
    expect(output.invocation.outputSummary).toBe(
      "Docker analysis completed: 3 risks, 2 recommendations.",
    );
    const invocationInput = `Derive route candidate ${input.route.title} with ${input.capability.label}.`;
    const templateSummary = buildCapabilityOutputSummary({
      capability: input.capability,
      routeTitle: input.route.title,
      input: invocationInput,
    });
    expect(output.invocation.outputSummary).not.toBe(templateSummary);

    // requestedBy 标记为 real 路径产出。
    expect(output.invocation.requestedBy).toBe("docker-capability-bridge");

    // logDigest 被透传。
    expect(output.invocation.provenance.logDigest).toBe("a".repeat(64));

    // executorJobId 在 real 路径下是 invocationId 的同值（HMAC 回调匹配锚点）。
    expect(output.executorJobId).toBe(input.invocationId);

    // provenance 的 error 字段不应被 real 路径填充。
    expect(output.invocation.provenance.error).toBeUndefined();
  });
});

describe("createDockerCapabilityBridge — 11.2 Timeout → fallback", () => {
  beforeEach(() => {
    vi.stubEnv("BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to simulated output and calls cancelJob once when awaitTerminal times out", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const dispatchSpy = vi.fn(async (_plan: ExecutionPlan, options?: { jobId?: string }) => ({
      request: {},
      response: {
        ok: true as const,
        accepted: true as const,
        jobId: options?.jobId ?? "inv_test_timeout",
      },
    }));

    const fakeExecutor = createFakeExecutorClient({
      dispatchPlan: dispatchSpy,
      cancelJob: cancelSpy,
    });
    const fakeDispatcher = createFakeCallbackDispatcher({
      awaitTerminal: async () => {
        throw new Error("callback timeout");
      },
    });

    const ctx = buildBlueprintServiceContext({
      executorClient: fakeExecutor,
      executorCallbackDispatcher: fakeDispatcher,
      dockerCapabilityPolicy: createDefaultDockerCapabilityPolicy(),
    });

    const bridge = createDockerCapabilityBridge(ctx);
    const input = buildBridgeInput({
      invocationId: "inv_test_timeout",
      jobId: "job_test_timeout",
    });
    const output = await bridge(input);

    // Fallback 特征字段：executionMode + error 文案锁定（design §4.6 step 6）。
    expect(output.invocation.provenance.executionMode).toBe("simulated_fallback");
    expect(output.invocation.provenance.error).toBe("callback timeout");

    // cancelJob 按 best-effort 精确触发一次，且参数为 invocationId。
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith("inv_test_timeout");

    // Fallback 路径下 outputSummary / logs / durationMs 与模板 helper 的
    // 产出完全一致（design §4.8 等价性锁定）。
    const invocationInput = `Derive route candidate ${input.route.title} with ${input.capability.label}.`;
    const expectedSummary = buildCapabilityOutputSummary({
      capability: input.capability,
      routeTitle: input.route.title,
      input: invocationInput,
    });
    const expectedLogs = buildCapabilityInvocationLogs(
      input.capability,
      expectedSummary,
    );
    const expectedDuration = deterministicCapabilityDuration(input.capability, {
      capabilityId: input.capability.id,
      roleId: input.roleId,
      routeId: input.route.id,
      input: invocationInput,
    });

    expect(output.invocation.outputSummary).toBe(expectedSummary);
    expect(output.invocation.logs).toEqual(expectedLogs);
    expect(output.invocation.durationMs).toBe(expectedDuration);

    // Fallback 路径保留今天的 requestedBy 字面量（design §4.8）。
    expect(output.invocation.requestedBy).toBe("route-generation-sandbox-derivation");

    // executorJobId 在 fallback 路径下为 undefined。
    expect(output.executorJobId).toBeUndefined();
  });
});

describe("createDockerCapabilityBridge — 11.3 Unreachable → fallback", () => {
  beforeEach(() => {
    vi.stubEnv("BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back and does not dispatch when assertReachable throws ExecutorClientError", async () => {
    const dispatchSpy = vi.fn();
    const fakeExecutor = createFakeExecutorClient({
      assertReachable: async () => {
        throw new ExecutorClientError("executor down", "unavailable");
      },
      dispatchPlan: dispatchSpy as unknown as (
        plan: ExecutionPlan,
        options?: { jobId?: string; requestId?: string; idempotencyKey?: string },
      ) => Promise<{ request: unknown; response: { ok: true; accepted: true; jobId: string } }>,
    });
    const fakeDispatcher = createFakeCallbackDispatcher({});
    const logger = createSpyLogger();

    const ctx = buildBlueprintServiceContext({
      executorClient: fakeExecutor,
      executorCallbackDispatcher: fakeDispatcher,
      dockerCapabilityPolicy: createDefaultDockerCapabilityPolicy(),
      logger,
    });

    const bridge = createDockerCapabilityBridge(ctx);
    const input = buildBridgeInput({
      invocationId: "inv_test_unreachable",
      jobId: "job_test_unreachable",
    });
    const output = await bridge(input);

    // Fallback 特征字段与 error 文案前缀锁定（design §4.6 step 2）。
    expect(output.invocation.provenance.executionMode).toBe("simulated_fallback");
    expect(output.invocation.provenance.error).toMatch(/executor unreachable/);

    // 关键不变式：assertReachable 抛错后 dispatchPlan 不应被触达。
    expect(dispatchSpy).not.toHaveBeenCalled();

    // logger.warn 被调用，且首个实参（message）包含 "executor unreachable"。
    expect(logger.warn).toHaveBeenCalled();
    const warnCalls = logger.warn.mock.calls;
    const matchedCall = warnCalls.find(
      call => typeof call[0] === "string" && call[0].includes("executor unreachable"),
    );
    expect(matchedCall).toBeDefined();
  });
});
