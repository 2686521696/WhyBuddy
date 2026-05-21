/**
 * `autopilot-role-container-loader` spec Task 3：角色能力包解析与资源预算工具。
 *
 * 本文件是 loader 子域的**纯函数层**，只处理类型解析、默认值合并与命名空间化 key。
 * 不触发任何 I/O、不 emit 事件、不读取 `process.env`；所有运行期副作用由
 * `loader.ts` / `lifecycle-manager.ts` 在上层组合时承担。
 *
 * 设计锚点：
 * - design §4.1：`RoleCapabilityPackage` 数据模型。
 * - design §D10 / §4.1：资源预算默认值与边界。
 * - design §D3：三段绑定（`alwaysBound` / `onDemand` / `shared`）。
 * - 需求 1.1 / 1.2 / 1.4 / 1.5 / 1.6 / 9.1-9.4 / 11.6。
 *
 * 与 shared 类型的一致性：
 * - `RoleCapabilityPackageBinding` 采用 **flat union**（`{ kind, id, ... }`），
 *   而 `onDemand` 的子结构仍是 `{ mcps?: Binding[]; skills?: Binding[]; aigcNodes?: Binding[] }`。
 * - 本文件导出的 `groupBindingsByKind(...)` 把 flat union 按 `kind` 分桶，
 *   为 binder / orchestrator 提供便利投影；不改变 shared 类型形态。
 *
 * 硬约束：
 * - 本模块**永不抛错**；对越界值做截断 + 单次 warn，不向调用方冒泡异常（需求 11.6）。
 */

import type {
  BlueprintAgentRole,
  BlueprintGenerationStage,
  RoleCapabilityPackage,
  RoleCapabilityPackageBinding,
  RoleResourceBudget,
} from "../../../../shared/blueprint/index.js";
import type { BlueprintLogger } from "../context.js";

/**
 * 角色容器的规范化主键：`(roleId, stageId, jobId)`。
 *
 * 见需求 2.4：不同 `jobId` 下的相同 `(roleId, stageId)` 视为不同容器。
 */
export interface RoleContainerKey {
  roleId: string;
  stageId: BlueprintGenerationStage;
  jobId: string;
}

/**
 * 资源预算合法范围。与 `shared/blueprint/role-container/types.ts` 的 JSDoc
 * 注释保持同步；这里作为**运行期真相源**，`mergeBudget` 会把越界值截断到
 * 这些边界并单次 warn（需求 9.1-9.4）。
 */
const BUDGET_BOUNDS = {
  provisionTimeoutMs: { min: 5_000, max: 180_000, fallback: 30_000 },
  maxConcurrentAigcNodes: { min: 1, max: 8, fallback: 1 },
  memoryMiB: { min: 128, max: 8192, fallback: 512 },
  cpuCores: { min: 0.1, max: 8, fallback: 1 },
  mcpProbeTimeoutMs: { min: 1_000, max: 30_000, fallback: 5_000 },
} as const;

const DEFAULT_ROLE_CAPABILITY_PACKAGE_ALIASES: Record<string, string> = {
  "role-product-decision": "decision-coordinator",
  "role-architecture-planner": "planning-architect",
  "role-runtime-executor": "execution-engineer",
  "role-quality-auditor": "audit-reviewer",
  "role-experience-presenter": "presentation-designer",
  "role-memory-curator": "memory-librarian",
  planner: "planning-architect",
  clarifier: "decision-coordinator",
  analyzer: "planning-architect",
  generator: "execution-engineer",
  operator: "execution-engineer",
  reviewer: "audit-reviewer",
  auditor: "audit-reviewer",
};

const DEFAULT_ROLE_GROUP_CAPABILITY_PACKAGE_ALIASES: Record<string, string> = {
  decision: "decision-coordinator",
  planning: "planning-architect",
  execution: "execution-engineer",
  audit: "audit-reviewer",
  presentation: "presentation-designer",
  memory: "memory-librarian",
};

/**
 * 创建默认资源预算。所有字段都有显式默认值，便于上层通过
 * `Required<RoleResourceBudget>` 语义消费（如 `executorClient.dispatchPlan`
 * 的资源参数需要完整字段）。
 */
export function createDefaultRoleResourceBudget(): Required<RoleResourceBudget> {
  return {
    provisionTimeoutMs: BUDGET_BOUNDS.provisionTimeoutMs.fallback,
    maxConcurrentAigcNodes: BUDGET_BOUNDS.maxConcurrentAigcNodes.fallback,
    orchestrationMode: "serial",
    memoryMiB: BUDGET_BOUNDS.memoryMiB.fallback,
    cpuCores: BUDGET_BOUNDS.cpuCores.fallback,
    mcpProbeTimeoutMs: BUDGET_BOUNDS.mcpProbeTimeoutMs.fallback,
  };
}

/**
 * 按照「role 显式声明 > defaultsCatalog 命中 > undefined」优先级解析
 * {@link RoleCapabilityPackage}。未命中时返回 `undefined`，由调用方决定是否
 * 使用空包（见 loader §4.6 伪代码 "空包 fallback" 分支）。
 *
 * 需求 1.4：未声明且目录未命中时 `ctx.logger.debug` 记录一次。
 */
export function resolveCapabilityPackage(
  roleId: string,
  role: BlueprintAgentRole | undefined,
  defaultsCatalog: Record<string, RoleCapabilityPackage>,
  logger?: BlueprintLogger,
): RoleCapabilityPackage | undefined {
  if (role?.capabilityPackage) {
    return role.capabilityPackage;
  }
  const fallback = defaultsCatalog[roleId];
  if (fallback) {
    return fallback;
  }
  const aliasId = DEFAULT_ROLE_CAPABILITY_PACKAGE_ALIASES[roleId];
  if (aliasId && defaultsCatalog[aliasId]) {
    return defaultsCatalog[aliasId];
  }
  const groupAliasId = role?.group
    ? DEFAULT_ROLE_GROUP_CAPABILITY_PACKAGE_ALIASES[role.group]
    : undefined;
  if (groupAliasId && defaultsCatalog[groupAliasId]) {
    return defaultsCatalog[groupAliasId];
  }
  logger?.debug("role container loader: capability package not found", {
    roleId,
    aliasId,
    groupAliasId,
  });
  return undefined;
}

/**
 * 把 `value` 截断到 `[min, max]` 范围内；命中截断时发出一次 warn（由调用方
 * 提供 logger），不抛错。
 */
function clampAndWarn(
  value: number,
  bounds: { min: number; max: number },
  field: string,
  logger?: BlueprintLogger,
): number {
  if (!Number.isFinite(value)) {
    logger?.warn("role container loader: budget field is not finite, using default", {
      field,
      value,
    });
    return bounds.min;
  }
  if (value < bounds.min) {
    logger?.warn("role container loader: budget field below minimum, clamping", {
      field,
      value,
      min: bounds.min,
    });
    return bounds.min;
  }
  if (value > bounds.max) {
    logger?.warn("role container loader: budget field above maximum, clamping", {
      field,
      value,
      max: bounds.max,
    });
    return bounds.max;
  }
  return value;
}

/**
 * 合并 `partial` 与 `defaults`；对越界数值字段做截断并 warn。
 *
 * 约定：
 * - `partial === undefined` 直接返回 `defaults` 深拷贝（保持调用方修改隔离）。
 * - 未声明字段使用 `defaults` 对应值。
 * - `orchestrationMode` 非法值（非 `"serial"|"parallel"`）会回落到 defaults。
 */
export function mergeBudget(
  partial: RoleResourceBudget | undefined,
  defaults: Required<RoleResourceBudget>,
  logger?: BlueprintLogger,
): Required<RoleResourceBudget> {
  if (!partial) {
    return { ...defaults };
  }

  const provisionTimeoutMs = partial.provisionTimeoutMs !== undefined
    ? clampAndWarn(
      partial.provisionTimeoutMs,
      BUDGET_BOUNDS.provisionTimeoutMs,
      "provisionTimeoutMs",
      logger,
    )
    : defaults.provisionTimeoutMs;

  const maxConcurrentAigcNodes = partial.maxConcurrentAigcNodes !== undefined
    ? clampAndWarn(
      partial.maxConcurrentAigcNodes,
      BUDGET_BOUNDS.maxConcurrentAigcNodes,
      "maxConcurrentAigcNodes",
      logger,
    )
    : defaults.maxConcurrentAigcNodes;

  const memoryMiB = partial.memoryMiB !== undefined
    ? clampAndWarn(partial.memoryMiB, BUDGET_BOUNDS.memoryMiB, "memoryMiB", logger)
    : defaults.memoryMiB;

  const cpuCores = partial.cpuCores !== undefined
    ? clampAndWarn(partial.cpuCores, BUDGET_BOUNDS.cpuCores, "cpuCores", logger)
    : defaults.cpuCores;

  const mcpProbeTimeoutMs = partial.mcpProbeTimeoutMs !== undefined
    ? clampAndWarn(
      partial.mcpProbeTimeoutMs,
      BUDGET_BOUNDS.mcpProbeTimeoutMs,
      "mcpProbeTimeoutMs",
      logger,
    )
    : defaults.mcpProbeTimeoutMs;

  const orchestrationMode: "serial" | "parallel" =
    partial.orchestrationMode === "serial" || partial.orchestrationMode === "parallel"
      ? partial.orchestrationMode
      : defaults.orchestrationMode;

  return {
    provisionTimeoutMs,
    maxConcurrentAigcNodes,
    orchestrationMode,
    memoryMiB,
    cpuCores,
    mcpProbeTimeoutMs,
  };
}

/**
 * 解析容器镜像：
 * - 显式声明优先。
 * - 未声明时，按 `onDemand.aigcNodes.length > 0 ⇒ "lobster-executor:ai"`，
 *   否则 `"lobster-executor:default"`（需求 1.6）。
 */
export function resolveContainerImage(pkg: RoleCapabilityPackage): string {
  if (pkg.containerImage && pkg.containerImage.length > 0) {
    return pkg.containerImage;
  }
  const aigcCount = pkg.onDemand?.aigcNodes?.length ?? 0;
  return aigcCount > 0 ? "lobster-executor:ai" : "lobster-executor:default";
}

/**
 * 把 flat union `RoleCapabilityPackageBinding[]` 按 `kind` 分桶，返回 id 数组。
 *
 * 便利函数：shared 类型采用 flat union 以便在 JSON 目录里平铺声明；而 binder
 * / orchestrator 通常按能力种类分开调度，需要这层投影。
 *
 * 未知 `kind` 的 binding 会被静默跳过（向后兼容：允许 shared 类型未来扩展）。
 */
export function groupBindingsByKind(
  bindings: readonly RoleCapabilityPackageBinding[] | undefined,
): { mcps: string[]; skills: string[]; aigcNodes: string[] } {
  const mcps: string[] = [];
  const skills: string[] = [];
  const aigcNodes: string[] = [];
  if (!bindings) {
    return { mcps, skills, aigcNodes };
  }
  for (const binding of bindings) {
    if (!binding || typeof binding.id !== "string" || binding.id.length === 0) {
      continue;
    }
    switch (binding.kind) {
      case "mcp":
        mcps.push(binding.id);
        break;
      case "skill":
        skills.push(binding.id);
        break;
      case "aigc_node":
        aigcNodes.push(binding.id);
        break;
      default:
        // 未知 kind：向前兼容忽略。
        break;
    }
  }
  return { mcps, skills, aigcNodes };
}

/**
 * 把 {@link RoleContainerKey} 序列化为规范化字符串。
 * 顺序：`jobId :: stageId :: roleId`；与 design §D8 的幂等主键语义一致。
 */
export function canonicalKey(input: RoleContainerKey): string {
  return `${input.jobId}::${input.stageId}::${input.roleId}`;
}
