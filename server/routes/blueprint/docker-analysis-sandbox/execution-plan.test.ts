/**
 * Docker Capability Bridge — ExecutionPlan 单元测试（Task 6）
 *
 * 本测试覆盖 `buildDockerCapabilityExecutionPlan()` 的关键对外契约：
 *
 * - 6.1 三条断言：
 *   1. `plan.jobs[0].id === input.bridgeInput.invocationId`
 *      —— HMAC 回调匹配锚点，executor 侧 `job.completed` / `job.failed` 事件
 *      的 `jobId` 必须命中同一个 invocationId，bridge 才能从 waiter 里取出
 *      正在等待的 Promise 并 resolve。
 *   2. `plan.jobs[0].payload.requiredCapabilities` 包含 `"runtime.docker"`
 *      —— `ExecutorClient.validatePlanCapabilities()` 在派发前用它来校验
 *      executor 当前是否支持 Docker 模式；native / mock 模式会因此被提前拒绝。
 *   3. `plan.metadata.blueprintJobId === bridgeInput.jobId` 且
 *      `plan.metadata.capabilityId === "docker-analysis-sandbox"`
 *      —— executor 侧日志、replay、运维面识别派发来源的稳定字段。
 *
 * - 6.2 两条断言：
 *   1. `plan.jobs[0].payload.analysisInput.githubUrls` 严格按
 *      `request.githubUrls ?? []` 填充（既覆盖提供的数组、也覆盖 undefined）。
 *   2. `request.targetText` 缺失时 `plan.objective` 仍能构造且非空，使用
 *      固定降级 `(no target)` 字符串，而不是拼出 `"undefined"` noise。
 *
 * 测试风格：全部 example-based（需求 9.3 明确禁止 PBT）。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 * - requirements 2.2 / 2.5 / 9.2
 * - design §4.4（plan 字段填充表）
 */

import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";

import { buildDockerCapabilityExecutionPlan } from "./execution-plan.js";
import { createDefaultDockerCapabilityPolicy } from "./policy.js";
import type { DockerCapabilityBridgeInput } from "./types.js";

/**
 * 构造最小可用的 `BlueprintRuntimeCapability` fixture。
 *
 * 字段值参考 `server/routes/blueprint.ts` 中 `getDefaultRuntimeCapabilities()`
 * 里 `docker-analysis-sandbox` 条目，保持与生产路径同源，便于 execution-plan
 * 纯函数在读取 `capability.id` 等字段时与真实场景一致。
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

/**
 * 构造最小可用的 `BlueprintRouteCandidate` fixture。
 *
 * 实现只消费 `route.id` / `route.title`，其它字段仅做类型合法性保留。
 */
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

/**
 * 构造最小可用的 `BlueprintRouteSet` fixture。
 *
 * 实现只消费 `routeSet.id`，其它字段仅做类型合法性保留。
 */
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

/**
 * 构造 `BlueprintGenerationRequest` fixture；默认提供 `targetText` 与 `githubUrls`。
 *
 * 某些用例会传入 `targetText: undefined`（通过 Partial 覆盖）以测试降级路径；
 * 此时 spread 会让 `targetText` 字段存在但值为 `undefined`，`fixture.request.targetText`
 * 仍是可选字段语义，符合 `BlueprintGenerationRequest.targetText?: string` 的类型。
 */
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

/**
 * 构造一个完整的 `DockerCapabilityBridgeInput`，默认覆盖场景充分。
 *
 * 调用方通过 `overrides.request` / `overrides.route` 等传入更具体的
 * 子 fixture；最外层字段（jobId / invocationId / createdAt / roleId）
 * 可以通过顶层 overrides 覆盖。
 */
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

describe("buildDockerCapabilityExecutionPlan — 6.1 回调匹配 / capability / metadata 锚点", () => {
  it("sets plan.jobs[0].id to bridgeInput.invocationId (HMAC callback anchor)", () => {
    const bridgeInput = buildBridgeInput({ invocationId: "inv_unique_123" });

    const plan = buildDockerCapabilityExecutionPlan({
      bridgeInput,
      policy: createDefaultDockerCapabilityPolicy(),
    });

    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0].id).toBe("inv_unique_123");
    expect(plan.jobs[0].id).toBe(bridgeInput.invocationId);
  });

  it("includes runtime.docker in payload.requiredCapabilities", () => {
    const plan = buildDockerCapabilityExecutionPlan({
      bridgeInput: buildBridgeInput(),
      policy: createDefaultDockerCapabilityPolicy(),
    });

    // `payload` 是 `Record<string, unknown>`；断言时先声明
    // `requiredCapabilities` 是字符串数组再做 `toContain` 匹配。
    const payload = plan.jobs[0].payload as Record<string, unknown>;
    const requiredCapabilities = payload.requiredCapabilities as readonly string[];

    expect(Array.isArray(requiredCapabilities)).toBe(true);
    expect(requiredCapabilities).toContain("runtime.docker");
  });

  it("carries blueprintJobId and capabilityId in plan.metadata", () => {
    const bridgeInput = buildBridgeInput({
      jobId: "job_abc",
      capability: buildCapabilityFixture({ id: "docker-analysis-sandbox" }),
    });

    const plan = buildDockerCapabilityExecutionPlan({
      bridgeInput,
      policy: createDefaultDockerCapabilityPolicy(),
    });

    expect(plan.metadata).toBeDefined();
    const metadata = plan.metadata as Record<string, unknown>;
    expect(metadata.blueprintJobId).toBe("job_abc");
    expect(metadata.capabilityId).toBe("docker-analysis-sandbox");
    // source 是稳定的派发来源识别字段，一并锁定（design §4.4）。
    expect(metadata.source).toBe("blueprint-docker-capability-bridge");
  });
});

describe("buildDockerCapabilityExecutionPlan — 6.2 analysisInput.githubUrls 与 targetText 降级", () => {
  it("populates analysisInput.githubUrls from request.githubUrls when provided", () => {
    const bridgeInput = buildBridgeInput({
      request: buildRequestFixture({
        githubUrls: ["https://github.com/a/b", "https://github.com/c/d"],
      }),
    });

    const plan = buildDockerCapabilityExecutionPlan({
      bridgeInput,
      policy: createDefaultDockerCapabilityPolicy(),
    });

    const payload = plan.jobs[0].payload as Record<string, unknown>;
    const analysisInput = payload.analysisInput as Record<string, unknown>;

    expect(analysisInput.githubUrls).toEqual([
      "https://github.com/a/b",
      "https://github.com/c/d",
    ]);
  });

  it("falls back to empty array when request.githubUrls is undefined", () => {
    const bridgeInput = buildBridgeInput({
      request: buildRequestFixture({ githubUrls: undefined }),
    });

    const plan = buildDockerCapabilityExecutionPlan({
      bridgeInput,
      policy: createDefaultDockerCapabilityPolicy(),
    });

    const payload = plan.jobs[0].payload as Record<string, unknown>;
    const analysisInput = payload.analysisInput as Record<string, unknown>;

    expect(analysisInput.githubUrls).toEqual([]);
  });

  it("constructs a non-empty objective when request.targetText is missing", () => {
    const bridgeInput = buildBridgeInput({
      request: buildRequestFixture({ targetText: undefined }),
      route: buildRouteFixture({ id: "route_missing_target_x" }),
    });

    const plan = buildDockerCapabilityExecutionPlan({
      bridgeInput,
      policy: createDefaultDockerCapabilityPolicy(),
    });

    // 不应抛错、objective 仍为非空字符串，并使用锁定的降级字面量
    // `(no target)`（design §4.4），同时保留 routeId 便于运维回溯。
    expect(typeof plan.objective).toBe("string");
    expect(plan.objective.length).toBeGreaterThan(0);
    expect(plan.objective).toContain("(no target)");
    expect(plan.objective).toContain("route_missing_target_x");
    // sourceText 直接透传 request.targetText，此路径下应为 undefined。
    expect(plan.sourceText).toBeUndefined();
  });
});
