import { describe, expect, it, vi } from "vitest";

import type {
  BlueprintAgentRole,
  RoleCapabilityPackage,
  RoleCapabilityPackageBinding,
} from "../../../../shared/blueprint/index.js";

import {
  canonicalKey,
  createDefaultRoleResourceBudget,
  groupBindingsByKind,
  mergeBudget,
  resolveCapabilityPackage,
  resolveContainerImage,
} from "./capability-package.js";

/**
 * Co-located 单元测试：覆盖 Task 3.6 所列 6 个场景 + groupBindingsByKind /
 * canonicalKey 两个 smoke 用例。example-based only（需求 11.5）。
 */

function buildRole(overrides: Partial<BlueprintAgentRole>): BlueprintAgentRole {
  return {
    id: "role-x",
    group: "execution",
    responsibility: "",
    defaultStages: ["runtime_capability"],
    activationStages: ["runtime_capability"],
    permissions: [],
    displayName: "Role X",
    displayLabelZh: "角色 X",
    description: "",
    ...overrides,
  } as BlueprintAgentRole;
}

function buildLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("resolveCapabilityPackage", () => {
  it("(a) role 显式 package 优先于默认目录", () => {
    const rolePkg: RoleCapabilityPackage = {
      alwaysBound: [{ kind: "mcp", id: "github" }],
    };
    const catalogPkg: RoleCapabilityPackage = {
      alwaysBound: [{ kind: "mcp", id: "default-mcp" }],
    };
    const role = buildRole({ capabilityPackage: rolePkg });
    const result = resolveCapabilityPackage("role-x", role, {
      "role-x": catalogPkg,
    });
    expect(result).toBe(rolePkg);
  });

  it("(b) role 未声明时按 id 命中默认目录", () => {
    const catalogPkg: RoleCapabilityPackage = {
      alwaysBound: [{ kind: "skill", id: "s1" }],
    };
    const role = buildRole({ capabilityPackage: undefined });
    const result = resolveCapabilityPackage("role-x", role, {
      "role-x": catalogPkg,
    });
    expect(result).toBe(catalogPkg);
  });

  it("Agent Crew role id 会映射到默认能力包目录 id", () => {
    const executionPkg: RoleCapabilityPackage = {
      alwaysBound: [{ kind: "skill", id: "execution-playbook" }],
    };
    const role = buildRole({
      id: "role-runtime-executor",
      group: "execution",
      capabilityPackage: undefined,
    });
    const result = resolveCapabilityPackage("role-runtime-executor", role, {
      "execution-engineer": executionPkg,
    });
    expect(result).toBe(executionPkg);
  });

  it("agent-driven planner role id 会映射到 planning-architect 能力包", () => {
    const planningPkg: RoleCapabilityPackage = {
      alwaysBound: [{ kind: "skill", id: "plan-synthesis" }],
    };
    const result = resolveCapabilityPackage("planner", undefined, {
      "planning-architect": planningPkg,
    });
    expect(result).toBe(planningPkg);
  });

  it("(c) 未命中返回 undefined 并 logger.debug", () => {
    const logger = buildLogger();
    const role = buildRole({ capabilityPackage: undefined });
    const result = resolveCapabilityPackage("role-missing", role, {}, logger);
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug.mock.calls[0]?.[0]).toContain("capability package not found");
  });
});

describe("mergeBudget", () => {
  it("(d) budget 越界截断并 warn", () => {
    const defaults = createDefaultRoleResourceBudget();
    const logger = buildLogger();
    const merged = mergeBudget(
      {
        provisionTimeoutMs: 200_000, // 超过 max=180_000
        memoryMiB: 16, // 低于 min=128
        cpuCores: 100, // 超过 max=8
        mcpProbeTimeoutMs: 100, // 低于 min=1_000
        maxConcurrentAigcNodes: 99, // 超过 max=8
      },
      defaults,
      logger,
    );
    expect(merged.provisionTimeoutMs).toBe(180_000);
    expect(merged.memoryMiB).toBe(128);
    expect(merged.cpuCores).toBe(8);
    expect(merged.mcpProbeTimeoutMs).toBe(1_000);
    expect(merged.maxConcurrentAigcNodes).toBe(8);
    // 5 次越界 warn
    expect(logger.warn).toHaveBeenCalledTimes(5);
  });

  it("未提供 partial 时返回 defaults 的副本", () => {
    const defaults = createDefaultRoleResourceBudget();
    const merged = mergeBudget(undefined, defaults);
    expect(merged).toEqual(defaults);
    expect(merged).not.toBe(defaults); // 独立副本
  });

  it("非法 orchestrationMode 回落到 defaults", () => {
    const defaults = createDefaultRoleResourceBudget();
    const merged = mergeBudget(
      { orchestrationMode: "invalid" as unknown as "serial" },
      defaults,
    );
    expect(merged.orchestrationMode).toBe(defaults.orchestrationMode);
  });
});

describe("resolveContainerImage", () => {
  it("(e) 未声明镜像 + 无 aigcNodes → default", () => {
    const pkg: RoleCapabilityPackage = {
      alwaysBound: [{ kind: "mcp", id: "github" }],
    };
    expect(resolveContainerImage(pkg)).toBe("lobster-executor:default");
  });

  it("(f) 未声明镜像 + 有 aigcNodes → ai", () => {
    const pkg: RoleCapabilityPackage = {
      onDemand: { aigcNodes: [{ kind: "aigc_node", id: "subsystem-decompose" }] },
    };
    expect(resolveContainerImage(pkg)).toBe("lobster-executor:ai");
  });

  it("显式声明优先", () => {
    const pkg: RoleCapabilityPackage = {
      containerImage: "custom:tag",
      onDemand: { aigcNodes: [{ kind: "aigc_node", id: "node-1" }] },
    };
    expect(resolveContainerImage(pkg)).toBe("custom:tag");
  });
});

describe("groupBindingsByKind", () => {
  it("按 kind 分桶返回 id 数组", () => {
    const bindings: RoleCapabilityPackageBinding[] = [
      { kind: "mcp", id: "github" },
      { kind: "skill", id: "architecture" },
      { kind: "aigc_node", id: "subsystem-decompose" },
      { kind: "mcp", id: "search" },
    ];
    const grouped = groupBindingsByKind(bindings);
    expect(grouped.mcps).toEqual(["github", "search"]);
    expect(grouped.skills).toEqual(["architecture"]);
    expect(grouped.aigcNodes).toEqual(["subsystem-decompose"]);
  });

  it("空或 undefined 输入返回空三件套", () => {
    expect(groupBindingsByKind(undefined)).toEqual({ mcps: [], skills: [], aigcNodes: [] });
    expect(groupBindingsByKind([])).toEqual({ mcps: [], skills: [], aigcNodes: [] });
  });
});

describe("canonicalKey", () => {
  it("序列化为 jobId::stageId::roleId", () => {
    const key = canonicalKey({
      roleId: "role-x",
      stageId: "runtime_capability",
      jobId: "job-1",
    });
    expect(key).toBe("job-1::runtime_capability::role-x");
  });
});
