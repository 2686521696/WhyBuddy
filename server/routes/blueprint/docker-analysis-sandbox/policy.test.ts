/**
 * Docker Capability Bridge — Policy 单元测试（Task 4）
 *
 * 本测试文件覆盖 `policy.ts` 三大能力：
 *
 * - 4.1 `checkDockerCapabilityPolicy(policy, request)` 的 4 条场景（
 *   default accept / image reject / network none 拒绝 bridge /
 *   whitelist domain 不在 allowlist）。
 * - 4.2 `createDefaultDockerCapabilityPolicy()` 返回值每个字段与
 *   design §4.3 默认值严格一致。
 * - 4.3 `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS` 与
 *   `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_DISPATCH_TIMEOUT_MS` 环境变量覆盖生效，
 *   以及无效值下 fallback 回默认值。
 *
 * 测试风格：全部 example-based（需求 9.3 明确禁止 PBT）。
 *
 * 环境变量管理：使用 Vitest 的 `vi.stubEnv` / `vi.unstubAllEnvs`，
 * 避免直接写 `process.env.X = ...` 造成跨用例污染；每条用例前后都会
 * 清空 stub，保证 4.2 的"默认值严格一致"断言不受前一条 4.3 用例影响。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 * - requirements 7.1 / 7.2 / 7.5 / 9.2
 * - design §4.3（策略默认值表、校验规则表、环境变量覆盖口径）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkDockerCapabilityPolicy,
  createDefaultDockerCapabilityPolicy,
  type DockerCapabilityPolicy,
} from "./policy.js";

describe("checkDockerCapabilityPolicy", () => {
  beforeEach(() => {
    // 每条校验用例都基于 `createDefaultDockerCapabilityPolicy()` 派生策略，
    // 保证默认值未被前一个 describe 块的环境变量污染。
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts allow-listed image under default policy", () => {
    const policy = createDefaultDockerCapabilityPolicy();

    const result = checkDockerCapabilityPolicy(policy, {
      image: "lobster-executor:default",
    });

    expect(result).toEqual({ allowed: true });
  });

  it("rejects image not in allow-list with locked reason literal", () => {
    const policy = createDefaultDockerCapabilityPolicy();

    const result = checkDockerCapabilityPolicy(policy, {
      image: "malicious:latest",
    });

    expect(result).toEqual({
      allowed: false,
      reason: "image not in allow-list",
    });
  });

  it("rejects bridge network when policy.networkPolicy is none", () => {
    const policy = createDefaultDockerCapabilityPolicy();

    const result = checkDockerCapabilityPolicy(policy, {
      image: "lobster-executor:default",
      requestedNetwork: "bridge",
    });

    expect(result).toEqual({
      allowed: false,
      reason: "network policy denied",
    });
  });

  it("rejects non-allow-listed domain under whitelist policy", () => {
    const policy: DockerCapabilityPolicy = {
      ...createDefaultDockerCapabilityPolicy(),
      networkPolicy: "whitelist",
      networkAllowlist: ["api.github.com"],
    };

    const result = checkDockerCapabilityPolicy(policy, {
      image: "lobster-executor:default",
      requestedNetworkDomain: "evil.example.com",
    });

    expect(result).toEqual({
      allowed: false,
      reason: "network allowlist denied",
    });
  });
});

describe("createDefaultDockerCapabilityPolicy — design §4.3 defaults", () => {
  beforeEach(() => {
    // 4.2 断言的是"干净环境下"的默认值，必须先清理可能的环境变量 stub。
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns exact default values from design §4.3", () => {
    const policy = createDefaultDockerCapabilityPolicy();

    // Allow-list 按 design §4.3 锁定镜像清单。
    expect(policy.allowedImages).toEqual([
      "lobster-executor:ai",
      "lobster-executor:default",
      "node:20-slim",
    ]);

    // 资源上限严格对齐 executor 侧 SecurityResourceLimits 默认值。
    expect(policy.memoryLimit).toBe("512m");
    expect(policy.cpuLimit).toBe("1.0");
    expect(policy.pidsLimit).toBe(256);

    // 网络默认完全隔离。
    expect(policy.networkPolicy).toBe("none");
    // `networkAllowlist` 是可选字段，默认不设置。
    expect(policy.networkAllowlist).toBeUndefined();

    // 安全级别透传 executor strict 模板。
    expect(policy.securityLevel).toBe("strict");

    // Bridge 超时锁定 45s / 派发 10s（未设环境变量时）。
    expect(policy.maxCallbackTimeoutMs).toBe(45_000);
    expect(policy.maxDispatchTimeoutMs).toBe(10_000);

    // invocation.logs 展示上限。
    expect(policy.maxLogLines).toBe(50);
    expect(policy.maxLogBytes).toBe(10_240);
  });
});

describe("createDefaultDockerCapabilityPolicy — env overrides", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("respects BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS override", () => {
    vi.stubEnv(
      "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS",
      "60000",
    );

    const policy = createDefaultDockerCapabilityPolicy();

    expect(policy.maxCallbackTimeoutMs).toBe(60_000);
    // 其它字段未受影响。
    expect(policy.maxDispatchTimeoutMs).toBe(10_000);
  });

  it("respects BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_DISPATCH_TIMEOUT_MS override", () => {
    vi.stubEnv(
      "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_DISPATCH_TIMEOUT_MS",
      "8000",
    );

    const policy = createDefaultDockerCapabilityPolicy();

    expect(policy.maxDispatchTimeoutMs).toBe(8_000);
    // 其它字段未受影响。
    expect(policy.maxCallbackTimeoutMs).toBe(45_000);
  });

  it("falls back to default when callback timeout env is not a positive integer", () => {
    vi.stubEnv(
      "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS",
      "not-a-number",
    );

    const policy = createDefaultDockerCapabilityPolicy();

    expect(policy.maxCallbackTimeoutMs).toBe(45_000);
  });
});
