/**
 * `autopilot-role-container-loader` spec Task 9：RoleContainerLoader 主模块。
 *
 * 负责组装 capability-package / lifecycle-manager / mcp-binder / skills-binder /
 * aigc-orchestrator / handoff-context 六个子模块，统一呈现为四个 public API：
 *
 * - `provisionRoleContainer(key)`：等价于 design §4.6 的伪代码；
 * - `tearDownRoleContainer(key)`：等价于 design §4.10 的伪代码；
 * - `onStageTransitionHook(input, stageRoleStateMap)`：driver 集成点；
 * - `getDiagnostics()`：从 `ctx.runtimeDiagnostics.snapshot` 中透出 loader entry。
 *
 * 关键约束（需求 11.6）：
 * - 所有 public API 永不向调用方抛错：外层 try/catch 返回降级值
 *   （provision → stub ctx / teardown → undefined）。
 * - Tier 1 gate：`BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED !== "true"` 时早退，
 *   不触发 executor / mcpToolAdapter / skillRegistry / eventBus / diagnostics。
 * - 幂等：同 key 二次 provision 命中缓存返回同一 runtime ctx，
 *   `dispatchPlan` 只调一次，`role.container.provisioning` 只 emit 一次，
 *   `role.container.ready` 则用 `cached: true` 标记第二次 emit（需求 2.2）。
 * - 事件 payload 字段见 design §4.6 与 Task 14 订阅器口径：
 *   - `role.container.provisioning`：`{ key, bindingSummary }`
 *   - `role.container.ready`：`{ key, containerMode, executionMode, fallbackReason?, bindingSummary, cached? }`
 *   - `role.container.teardown`：`{ key, containerMode, executionMode, orphan?, handoffArtifactAppended }`
 *   - `role.container.failed`：`{ key, error }`
 *
 * 与 diagnostics-store 的关系：
 * - `recordBridgeInvocation("roleContainerLoader", { mode, error? })` 已经存在。
 * - `recordTeardown` / `noteOrphanContainer` 由 Task 13 新增；本模块采用
 *   duck-typed 调用（`typeof maybeMethod === "function"`）以保持向前兼容，
 *   当这两个方法缺失时只记 logger.debug 不抛错。
 */

import { randomUUID } from "node:crypto";

import type {
  BlueprintAgentRole,
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintRolePresenceState,
  RoleCapabilityPackage,
  RoleCapabilityPackageBinding,
} from "../../../../shared/blueprint/index.js";
import { BlueprintEventName } from "../../../../shared/blueprint/events.js";
import type { BlueprintServiceContext } from "../context.js";

import {
  canonicalKey,
  createDefaultRoleResourceBudget,
  groupBindingsByKind,
  mergeBudget,
  resolveCapabilityPackage,
  type RoleContainerKey,
} from "./capability-package.js";
import {
  createLifecycleManager,
  type LifecycleManager,
  type PhysicalContainer,
  type RoleContainerLifecycleState,
} from "./lifecycle-manager.js";
import {
  bindRoleMcps,
  createInitialBindingReport,
  type BindingReport,
  type McpSessionHandle,
} from "./mcp-binder.js";
import {
  bindRoleSkills,
  type SkillHandle,
  type SkillRegistryDependency,
} from "./skills-binder.js";
import {
  buildMergedSummary,
  orchestrateAigcInvocation,
  registerOnDemandAigcNodes,
  type AigcNodeHandle,
  type AigcNodeInvocation,
  type AigcNodeInvoker,
  type OrchestratedAigcResult,
} from "./aigc-orchestrator.js";
import { createRoleContainerAigcNodeInvoker } from "./aigc-node-invoker-adapter.js";
import {
  buildStageHandoffContext,
  type HandoffSourceContext,
  type StageHandoffContext,
} from "./handoff-context.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * 绑定使用计数器：供 handoff 快照消费。
 */
interface McpUsageStats {
  invocationCount: number;
  lastStatus: "ok" | "failed";
}

interface SkillUsageStats {
  invocationCount: number;
  lastInput: unknown;
  lastOutput: unknown;
}

interface AigcUsageStats {
  partialFailure: boolean;
}

/**
 * 运行时 ctx：对 loader 内部可变，对外只暴露 readonly 门面。
 */
export interface RoleRuntimeContext {
  key: RoleContainerKey;
  mode: "real" | "lite";
  package: RoleCapabilityPackage;
  lifecycle: RoleContainerLifecycle;
  /** capability invocations 由 loader 外部（例如 sandbox-derivation）追加。 */
  tracker: {
    capabilitiesInvoked: Array<{
      capabilityId: string;
      invocationId: string;
      executionMode: "real" | "simulated_fallback";
    }>;
  };
  mcp: {
    execute(serverId: string): Promise<{ ok: boolean }>;
    list(): string[];
  };
  skill: {
    invoke(skillId: string, input: unknown): Promise<unknown>;
    list(): string[];
  };
  aigcNode: {
    orchestrate(nodeIds: string[], input: unknown): Promise<OrchestratedAigcResult>;
    list(): string[];
  };
  lastHandoffContext?: StageHandoffContext;
}

export interface RoleContainerLifecycle {
  key: RoleContainerKey;
  state: RoleContainerLifecycleState;
  mode: "real" | "lite";
  physicalContainerId?: string;
  provisionedAt?: string;
  readyAt?: string;
  teardownAt?: string;
  bindingReport: BindingReport;
  fallbackReason?: string;
  lastError?: string;
}

/**
 * 诊断投影：loader.getDiagnostics() 返回的形状。设计 §D9。
 */
export interface RoleContainerLoaderDiagnostics {
  mode: "real" | "lite" | "disabled" | "unknown";
  totalProvisions: number;
  realProvisions: number;
  liteProvisions: number;
  teardownCount: number;
  orphanContainerWarning: number;
  lastInvocationAt: string | undefined;
  lastMode: "real" | "simulated_fallback" | undefined;
  lastError: string | undefined;
}

/**
 * `RoleContainerLoader` 主接口（design §4.5）。
 */
export interface RoleContainerLoader {
  provisionRoleContainer(input: RoleContainerKey): Promise<RoleRuntimeContext>;
  tearDownRoleContainer(
    input: RoleContainerKey,
  ): Promise<StageHandoffContext | undefined>;
  onStageTransitionHook(
    input: { jobId: string; stageId: BlueprintGenerationStage },
    stageRoleStateMap: ReadonlyMap<string, BlueprintRolePresenceState>,
  ): void;
  getDiagnostics(): RoleContainerLoaderDiagnostics;
}

/**
 * RuntimeCtx 存储接口。
 */
export interface RoleRuntimeContextStore {
  get(key: string): RoleRuntimeContext | undefined;
  put(key: string, ctx: RoleRuntimeContext): void;
  delete(key: string): boolean;
  snapshot(): RoleRuntimeContext[];
}

export function createInMemoryRoleRuntimeContextStore(): RoleRuntimeContextStore {
  const map = new Map<string, RoleRuntimeContext>();
  return {
    get: (key) => map.get(key),
    put: (key, ctx) => {
      map.set(key, ctx);
    },
    delete: (key) => map.delete(key),
    snapshot: () => Array.from(map.values()),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const LOADER_BRIDGE_ID = "roleContainerLoader" as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

function truncate(raw: string, max = 400): string {
  return raw.length <= max ? raw : raw.slice(0, max);
}

function resolveRoleFromJob(
  job: BlueprintGenerationJob | null,
  roleId: string,
): BlueprintAgentRole | undefined {
  if (!job) return undefined;
  const anyRequest = job.request as unknown as {
    roles?: BlueprintAgentRole[];
  };
  const roles = Array.isArray(anyRequest?.roles) ? anyRequest.roles : undefined;
  return roles?.find((r) => r?.id === roleId);
}

/**
 * 构造一个 stub runtime ctx：Tier 1 off / 致命错误时返回。它的 facade 全部
 * no-op，避免下游 capability invocation 误以为容器已就绪。
 */
function createStubRuntimeContext(
  key: RoleContainerKey,
  pkg: RoleCapabilityPackage | undefined,
  reason: string,
): RoleRuntimeContext {
  const bindingReport = createInitialBindingReport();
  return {
    key,
    mode: "lite",
    package: pkg ?? {},
    tracker: { capabilitiesInvoked: [] },
    lifecycle: {
      key,
      state: "failed",
      mode: "lite",
      bindingReport,
      fallbackReason: reason,
      lastError: reason,
    },
    mcp: {
      execute: async () => ({ ok: false }),
      list: () => [],
    },
    skill: {
      invoke: async () => undefined,
      list: () => [],
    },
    aigcNode: {
      orchestrate: async () => ({
        success: false,
        nodeResults: [],
        mergedOutputSummary: "",
        partialFailures: 0,
      }),
      list: () => [],
    },
  };
}

function flattenBindings(
  pkg: RoleCapabilityPackage,
): { alwaysMcps: string[]; alwaysSkills: string[]; onDemandAigcNodes: string[] } {
  const always = groupBindingsByKind(pkg.alwaysBound);
  const shared = groupBindingsByKind(pkg.shared);
  // onDemand 的 aigcNodes 使用独立子字段
  const onDemandAigc = (pkg.onDemand?.aigcNodes ?? [])
    .map((b) => b.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return {
    alwaysMcps: [...always.mcps, ...shared.mcps],
    alwaysSkills: [...always.skills, ...shared.skills],
    onDemandAigcNodes: onDemandAigc,
  };
}

/**
 * 构造 bindingSummary：用于事件 payload 与诊断。
 */
function buildBindingSummary(
  mcpBindings: ReadonlyMap<string, McpSessionHandle>,
  skillBindings: ReadonlyMap<string, SkillHandle>,
  aigcHandles: ReadonlyMap<string, AigcNodeHandle>,
  report: BindingReport,
) {
  return {
    mcpCount: mcpBindings.size,
    skillCount: skillBindings.size,
    aigcNodeCount: aigcHandles.size,
    skippedMcps: report.skippedMcps.length,
    skippedSkills: report.skippedSkills.length,
  };
}

/**
 * 在 job.artifacts 中追加一条 handoff artifact。真实 BlueprintJobStore 未暴露
 * `appendArtifact`，改用 `get + push + save?`。三段式 best-effort 容错。
 */
function appendHandoffArtifact(
  ctx: BlueprintServiceContext,
  jobId: string,
  handoff: StageHandoffContext,
): boolean {
  try {
    const job = ctx.jobStore.get(jobId);
    if (!job) return false;
    // BlueprintGenerationArtifactType 是冻结的 union，未包含 "role_runtime_handoff"；
    // 此处采用 `"capability_invocation"` 作为最接近的语义类型并在 payload 里显式
    // 打标 `kind: "role_runtime_handoff"`，下游消费方通过 payload 区分即可。
    const artifact: BlueprintGenerationArtifact = {
      id: `role-runtime-handoff-${randomUUID()}`,
      type: "capability_invocation",
      title: `Role runtime handoff: ${handoff.key.roleId} @ ${handoff.key.stageId}`,
      summary: handoff.warmStartHint ?? "role runtime handoff snapshot",
      createdAt: handoff.generatedAt,
      payload: {
        kind: "role_runtime_handoff",
        handoff,
      },
    };
    const nextArtifacts: BlueprintGenerationArtifact[] = Array.isArray(
      (job as unknown as { artifacts?: BlueprintGenerationArtifact[] }).artifacts,
    )
      ? (job as unknown as { artifacts: BlueprintGenerationArtifact[] }).artifacts.concat(artifact)
      : [artifact];
    const nextJob = {
      ...job,
      artifacts: nextArtifacts,
      updatedAt: handoff.generatedAt,
    } as BlueprintGenerationJob;
    const maybeSave = (
      ctx.jobStore as unknown as {
        save?: (job: BlueprintGenerationJob) => void;
      }
    ).save;
    if (typeof maybeSave === "function") {
      maybeSave.call(ctx.jobStore, nextJob);
      return true;
    }
    // 没有 save：仅在内存中追加（ctx.jobStore.get 可能返回引用可变对象，
    // 这里额外把 artifacts 直接 push 回原对象以提高命中率）。
    const mutableJob = job as unknown as {
      artifacts?: BlueprintGenerationArtifact[];
    };
    if (Array.isArray(mutableJob.artifacts)) {
      mutableJob.artifacts.push(artifact);
      ctx.logger.debug(
        "role container loader: jobStore.save missing, pushed artifact in-memory",
        { jobId, artifactId: artifact.id },
      );
      return true;
    }
    return false;
  } catch (err) {
    ctx.logger.warn("role container loader: append handoff artifact failed", {
      jobId,
      error: errorMessage(err),
    });
    return false;
  }
}

/**
 * 尝试调用 diagnostics 的 `recordTeardown`（Task 13 新增）；缺失时仅 debug。
 */
function recordTeardown(
  ctx: BlueprintServiceContext,
  key: RoleContainerKey,
  mode: "real" | "lite",
): void {
  const maybe = (
    ctx.runtimeDiagnostics as unknown as {
      recordTeardown?: (
        bridgeId: string,
        payload: { key: RoleContainerKey; mode: "real" | "lite" },
      ) => void;
    }
  ).recordTeardown;
  if (typeof maybe !== "function") {
    ctx.logger.debug(
      "role container loader: diagnostics.recordTeardown not available yet",
      { key, mode },
    );
    return;
  }
  try {
    maybe.call(ctx.runtimeDiagnostics, LOADER_BRIDGE_ID, { key, mode });
  } catch (err) {
    ctx.logger.debug(
      "role container loader: diagnostics.recordTeardown threw, ignored",
      { error: errorMessage(err) },
    );
  }
}

function noteOrphanContainer(
  ctx: BlueprintServiceContext,
  key: RoleContainerKey,
  err: unknown,
): void {
  const maybe = (
    ctx.runtimeDiagnostics as unknown as {
      noteOrphanContainer?: (
        bridgeId: string,
        payload: { key: RoleContainerKey; err: string },
      ) => void;
    }
  ).noteOrphanContainer;
  if (typeof maybe !== "function") {
    ctx.logger.debug(
      "role container loader: diagnostics.noteOrphanContainer not available yet",
      { key, error: errorMessage(err) },
    );
    return;
  }
  try {
    maybe.call(ctx.runtimeDiagnostics, LOADER_BRIDGE_ID, {
      key,
      err: truncate(errorMessage(err)),
    });
  } catch (inner) {
    ctx.logger.debug(
      "role container loader: diagnostics.noteOrphanContainer threw, ignored",
      { error: errorMessage(inner) },
    );
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * 创建 {@link RoleContainerLoader}。默认自动装配 in-memory
 * {@link RoleRuntimeContextStore}（若 ctx 上未提供）。
 */
export function createRoleContainerLoader(
  ctx: BlueprintServiceContext,
  defaultsCatalog: Record<string, RoleCapabilityPackage> = {},
): RoleContainerLoader {
  const runtimeStore: RoleRuntimeContextStore =
    (ctx as unknown as { roleRuntimeContextStore?: RoleRuntimeContextStore })
      .roleRuntimeContextStore ?? createInMemoryRoleRuntimeContextStore();

  // 每次 loader 实例化绑定一个独立 lifecycle manager。
  const envOverride = process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_MODE_OVERRIDE;
  const lifecycleManager: LifecycleManager = createLifecycleManager({
    executorClient: ctx.executorClient,
    logger: ctx.logger,
    now: ctx.now,
    envOverride:
      envOverride === "real" || envOverride === "lite" ? envOverride : undefined,
  });

  const skillRegistry = (ctx as unknown as {
    skillRegistry?: SkillRegistryDependency;
  }).skillRegistry;

  const aigcInvoker = createRoleContainerAigcNodeInvoker(ctx);

  // 本地绑定使用统计。key = canonicalKey。
  const mcpUsageByKey = new Map<string, Map<string, McpUsageStats>>();
  const skillUsageByKey = new Map<string, Map<string, SkillUsageStats>>();
  const aigcUsageByKey = new Map<string, Map<string, AigcUsageStats>>();

  function buildHandoffSource(ctxRuntime: RoleRuntimeContext): HandoffSourceContext {
    const cKey = canonicalKey(ctxRuntime.key);
    const mcpUsages = mcpUsageByKey.get(cKey) ?? new Map();
    const skillUsages = skillUsageByKey.get(cKey) ?? new Map();
    const aigcUsages = aigcUsageByKey.get(cKey) ?? new Map();
    return {
      key: ctxRuntime.key,
      capabilitiesInvoked: ctxRuntime.tracker.capabilitiesInvoked,
      mcpSessions: ctxRuntime.mcp.list().map((serverId) => {
        const stats = mcpUsages.get(serverId) ?? { invocationCount: 0, lastStatus: "ok" };
        return {
          serverId,
          invocationCount: stats.invocationCount,
          lastStatus: stats.lastStatus,
        };
      }),
      skillHandles: ctxRuntime.skill.list().map((skillId) => {
        const stats = skillUsages.get(skillId) ?? {
          invocationCount: 0,
          lastInput: undefined,
          lastOutput: undefined,
        };
        return {
          skillId,
          invocationCount: stats.invocationCount,
          lastInput: stats.lastInput,
          lastOutput: stats.lastOutput,
        };
      }),
      aigcNodeResults: ctxRuntime.aigcNode.list().map((nodeId) => ({
        nodeId,
        partialFailure: aigcUsages.get(nodeId)?.partialFailure ?? false,
      })),
    };
  }

  async function provisionRoleContainer(
    input: RoleContainerKey,
  ): Promise<RoleRuntimeContext> {
    // 外层 try/catch：需求 11.6
    try {
      if (!input?.roleId || !input?.stageId || !input?.jobId) {
        ctx.logger.warn("role container loader: invalid provision key", { input });
        return createStubRuntimeContext(input, undefined, "invalid key");
      }

      // Tier 1 gate
      if (process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED !== "true") {
        ctx.logger.debug("role container loader: tier-1 gate off, returning stub", {
          key: input,
        });
        return createStubRuntimeContext(input, undefined, "loader disabled");
      }

      const cKey = canonicalKey(input);

      // 幂等
      const cached = runtimeStore.get(cKey);
      if (cached && (cached.lifecycle.state === "ready" || cached.lifecycle.state === "degrading")) {
        const summary = {
          mcpCount: cached.mcp.list().length,
          skillCount: cached.skill.list().length,
          aigcNodeCount: cached.aigcNode.list().length,
          skippedMcps: cached.lifecycle.bindingReport.skippedMcps.length,
          skippedSkills: cached.lifecycle.bindingReport.skippedSkills.length,
        };
        ctx.eventBus.emit({
          id: `blueprint-role-event-${randomUUID()}`,
          type: BlueprintEventName.RoleContainerReady,
          family: "role",
          jobId: input.jobId,
          stage: input.stageId,
          status: "running",
          message: `role container cached for ${input.roleId}`,
          occurredAt: ctx.now().toISOString(),
          payload: {
            key: input,
            containerMode: cached.mode,
            executionMode: cached.mode === "real" ? "real" : "simulated_fallback",
            fallbackReason: cached.lifecycle.fallbackReason,
            bindingSummary: summary,
            cached: true,
          },
        } as never);
        return cached;
      }

      // 解析 package
      const job = ctx.jobStore.get(input.jobId);
      const role = resolveRoleFromJob(job, input.roleId);
      const pkg = resolveCapabilityPackage(
        input.roleId,
        role,
        defaultsCatalog,
        ctx.logger,
      ) ?? {};
      const budget = mergeBudget(
        pkg.resourceBudget,
        createDefaultRoleResourceBudget(),
        ctx.logger,
      );

      // emit provisioning（初始摘要使用静态字段估算）
      const flat = flattenBindings(pkg);
      const provisioningSummary = {
        mcpCount: 0,
        skillCount: 0,
        aigcNodeCount: flat.onDemandAigcNodes.length,
        skippedMcps: 0,
        skippedSkills: 0,
      };
      ctx.eventBus.emit({
        id: `blueprint-role-event-${randomUUID()}`,
        type: BlueprintEventName.RoleContainerProvisioning,
        family: "role",
        jobId: input.jobId,
        stage: input.stageId,
        status: "running",
        message: `role container provisioning for ${input.roleId}`,
        occurredAt: ctx.now().toISOString(),
        payload: { key: input, bindingSummary: provisioningSummary },
      } as never);

      // 物理容器（永不抛错）
      const provisionId = `role-container-${randomUUID()}`;
      const physical = await lifecycleManager.createWithFallback({
        pkg,
        budget,
        provisionId,
        jobId: input.jobId,
      });

      // 绑定（三路）
      const bindingReport = createInitialBindingReport();
      const [mcpBindings, skillBindings] = await Promise.all([
        bindRoleMcps(
          flat.alwaysMcps,
          ctx.mcpToolAdapter,
          bindingReport,
          ctx.logger,
          ctx.now,
          budget.mcpProbeTimeoutMs,
        ),
        bindRoleSkills(
          flat.alwaysSkills,
          skillRegistry,
          input.roleId,
          bindingReport,
          ctx.logger,
        ),
      ]);

      const aigcHandles = registerOnDemandAigcNodes(
        flat.onDemandAigcNodes,
        aigcInvoker,
        ctx.logger,
        ctx.now,
      );
      bindingReport.registeredAigcNodes = [...aigcHandles.keys()];
      bindingReport.hasSkipped =
        bindingReport.skippedMcps.length > 0 ||
        bindingReport.skippedSkills.length > 0 ||
        bindingReport.skippedAigcNodes.length > 0;
      if (physical.mode === "lite") {
        bindingReport.liteBudgetAdvisory = {
          memoryMiB: budget.memoryMiB,
          cpuCores: budget.cpuCores,
          provisionTimeoutMs: budget.provisionTimeoutMs,
        };
      }

      // 初始化使用统计桶
      const mcpUsages = new Map<string, McpUsageStats>();
      for (const [serverId] of mcpBindings) {
        mcpUsages.set(serverId, { invocationCount: 0, lastStatus: "ok" });
      }
      mcpUsageByKey.set(cKey, mcpUsages);
      const skillUsages = new Map<string, SkillUsageStats>();
      for (const [skillId] of skillBindings) {
        skillUsages.set(skillId, {
          invocationCount: 0,
          lastInput: undefined,
          lastOutput: undefined,
        });
      }
      skillUsageByKey.set(cKey, skillUsages);
      const aigcUsages = new Map<string, AigcUsageStats>();
      for (const [nodeId] of aigcHandles) {
        aigcUsages.set(nodeId, { partialFailure: false });
      }
      aigcUsageByKey.set(cKey, aigcUsages);

      // 构造 runtime ctx（门面）
      const runtimeCtx: RoleRuntimeContext = {
        key: input,
        mode: physical.mode,
        package: pkg,
        tracker: { capabilitiesInvoked: [] },
        lifecycle: {
          key: input,
          state: bindingReport.hasSkipped ? "degrading" : "ready",
          mode: physical.mode,
          physicalContainerId:
            physical.mode === "real" ? physical.containerId : undefined,
          provisionedAt: ctx.now().toISOString(),
          readyAt: ctx.now().toISOString(),
          bindingReport,
          fallbackReason:
            physical.mode === "lite" ? physical.fallbackReason : undefined,
        },
        mcp: {
          async execute(serverId: string) {
            const stats = mcpUsages.get(serverId);
            if (!stats) return { ok: false };
            // loader 不代理真实 MCP 调用；调用方应通过 ctx.mcpToolAdapter 直接
            // 执行实际业务 tool，这里仅更新计数供 handoff 消费。
            stats.invocationCount += 1;
            stats.lastStatus = "ok";
            return { ok: true };
          },
          list: () => [...mcpBindings.keys()],
        },
        skill: {
          async invoke(skillId: string, input: unknown) {
            const handle = skillBindings.get(skillId);
            const stats = skillUsages.get(skillId);
            if (!handle) {
              if (stats) {
                stats.invocationCount += 1;
                stats.lastInput = input;
                stats.lastOutput = undefined;
              }
              return undefined;
            }
            try {
              const output = await handle.invoke(input);
              if (stats) {
                stats.invocationCount += 1;
                stats.lastInput = input;
                stats.lastOutput = output;
              }
              return output;
            } catch (err) {
              if (stats) {
                stats.invocationCount += 1;
                stats.lastInput = input;
                stats.lastOutput = { error: errorMessage(err) };
              }
              return undefined;
            }
          },
          list: () => [...skillBindings.keys()],
        },
        aigcNode: {
          async orchestrate(nodeIds: string[], input: unknown) {
            const result = await orchestrateAigcInvocation(
              {
                nodeIds,
                input,
                handles: aigcHandles,
                mode: budget.orchestrationMode,
              },
              { logger: ctx.logger, now: ctx.now },
            );
            for (const r of result.nodeResults) {
              const stat = aigcUsages.get(r.nodeId);
              if (stat && !r.success) stat.partialFailure = true;
            }
            return result;
          },
          list: () => [...aigcHandles.keys()],
        },
      };

      runtimeStore.put(cKey, runtimeCtx);

      // diagnostics
      // NOTE: Task 13 将在 BridgeId union 中新增 `"roleContainerLoader"`；
      // 在 Task 13 尚未落地时，使用 `as never` 下钻绕过 TS union check，保持运行期
      // 一致的 key（diagnostics-store 使用 Map<BridgeId, ...>，key 值仍然有效，只是
      // TS 类型层暂未覆盖该字面量）。
      ctx.runtimeDiagnostics.recordBridgeInvocation(LOADER_BRIDGE_ID as never, {
        mode: physical.mode === "real" ? "real" : "simulated_fallback",
        ...(physical.mode === "lite" && physical.fallbackReason
          ? { error: physical.fallbackReason }
          : {}),
      });

      // emit ready
      const bindingSummary = buildBindingSummary(
        mcpBindings,
        skillBindings,
        aigcHandles,
        bindingReport,
      );
      ctx.eventBus.emit({
        id: `blueprint-role-event-${randomUUID()}`,
        type: BlueprintEventName.RoleContainerReady,
        family: "role",
        jobId: input.jobId,
        stage: input.stageId,
        status: "running",
        message: `role container ready for ${input.roleId}`,
        occurredAt: ctx.now().toISOString(),
        payload: {
          key: input,
          containerMode: physical.mode,
          executionMode: physical.mode === "real" ? "real" : "simulated_fallback",
          fallbackReason:
            physical.mode === "lite" ? physical.fallbackReason : undefined,
          bindingSummary,
        },
      } as never);

      return runtimeCtx;
    } catch (err) {
      const reason = truncate(errorMessage(err));
      ctx.logger.warn("role container loader: provision failed (degraded)", {
        key: input,
        error: reason,
      });
      try {
        ctx.eventBus.emit({
          id: `blueprint-role-event-${randomUUID()}`,
          type: BlueprintEventName.RoleContainerFailed,
          family: "role",
          jobId: input.jobId,
          stage: input.stageId,
          status: "failed",
          message: `role container provision failed: ${reason}`,
          occurredAt: ctx.now().toISOString(),
          payload: { key: input, error: reason },
        } as never);
      } catch {
        // event bus 再抛错也不影响主流程
      }
      return createStubRuntimeContext(input, undefined, reason);
    }
  }

  async function tearDownRoleContainer(
    input: RoleContainerKey,
  ): Promise<StageHandoffContext | undefined> {
    try {
      if (!input?.roleId || !input?.stageId || !input?.jobId) {
        return undefined;
      }
      if (process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED !== "true") {
        return undefined;
      }
      const cKey = canonicalKey(input);
      const existing = runtimeStore.get(cKey);
      if (!existing) {
        ctx.logger.debug("role container loader: teardown noop (no context)", {
          key: input,
        });
        return undefined;
      }
      if (
        existing.lifecycle.state === "torn_down" ||
        existing.lifecycle.state === "tearing_down"
      ) {
        return existing.lastHandoffContext;
      }
      existing.lifecycle.state = "tearing_down";

      // 构造 handoff
      const handoff = buildStageHandoffContext(
        buildHandoffSource(existing),
        ctx.now,
      );
      const handoffAppended = appendHandoffArtifact(ctx, input.jobId, handoff);

      // 物理释放
      let orphan = false;
      const physical: PhysicalContainer =
        existing.mode === "real" && existing.lifecycle.physicalContainerId
          ? {
              mode: "real",
              containerId: existing.lifecycle.physicalContainerId,
              image: existing.package.containerImage ?? "lobster-executor:default",
            }
          : {
              mode: "lite",
              fallbackReason: existing.lifecycle.fallbackReason ?? "lite",
            };
      try {
        await lifecycleManager.destroyPhysicalContainer(physical);
      } catch (err) {
        orphan = true;
        noteOrphanContainer(ctx, input, err);
      }

      existing.lifecycle.state = "torn_down";
      existing.lifecycle.teardownAt = ctx.now().toISOString();
      existing.lastHandoffContext = handoff;

      recordTeardown(ctx, input, existing.mode);

      try {
        ctx.eventBus.emit({
          id: `blueprint-role-event-${randomUUID()}`,
          type: BlueprintEventName.RoleContainerTeardown,
          family: "role",
          jobId: input.jobId,
          stage: input.stageId,
          status: "running",
          message: `role container teardown for ${input.roleId}`,
          occurredAt: ctx.now().toISOString(),
          payload: {
            key: input,
            containerMode: existing.mode,
            executionMode: existing.mode === "real" ? "real" : "simulated_fallback",
            orphan,
            handoffArtifactAppended: handoffAppended,
          },
        } as never);
      } catch {
        // noop
      }

      return handoff;
    } catch (err) {
      ctx.logger.warn("role container loader: teardown failed (degraded)", {
        key: input,
        error: errorMessage(err),
      });
      return undefined;
    }
  }

  function onStageTransitionHook(
    input: { jobId: string; stageId: BlueprintGenerationStage },
    stageRoleStateMap: ReadonlyMap<string, BlueprintRolePresenceState>,
  ): void {
    try {
      for (const [roleId, targetState] of stageRoleStateMap) {
        const key: RoleContainerKey = {
          roleId,
          stageId: input.stageId,
          jobId: input.jobId,
        };
        if (targetState === "active") {
          provisionRoleContainer(key).catch((err) => {
            ctx.logger.warn("role container loader: fire-and-forget provision failed", {
              key,
              error: errorMessage(err),
            });
          });
        } else if (targetState === "sleeping") {
          tearDownRoleContainer(key).catch((err) => {
            ctx.logger.warn("role container loader: fire-and-forget teardown failed", {
              key,
              error: errorMessage(err),
            });
          });
        }
      }
    } catch (err) {
      ctx.logger.warn("role container loader: onStageTransitionHook threw", {
        error: errorMessage(err),
      });
    }
  }

  function getDiagnostics(): RoleContainerLoaderDiagnostics {
    try {
      const snapshot = ctx.runtimeDiagnostics.snapshot(ctx.now);
      const loaderEntry = (snapshot.bridges as Record<string, unknown>)[
        LOADER_BRIDGE_ID
      ] as
        | {
            mode?: RoleContainerLoaderDiagnostics["mode"];
            totalProvisions?: number;
            realProvisions?: number;
            liteProvisions?: number;
            teardownCount?: number;
            orphanContainerWarning?: number;
            lastInvocationAt?: string;
            lastMode?: "real" | "simulated_fallback";
            lastError?: string;
          }
        | undefined;
      if (!loaderEntry) {
        return {
          mode: "unknown",
          totalProvisions: 0,
          realProvisions: 0,
          liteProvisions: 0,
          teardownCount: 0,
          orphanContainerWarning: 0,
          lastInvocationAt: undefined,
          lastMode: undefined,
          lastError: undefined,
        };
      }
      return {
        mode: loaderEntry.mode ?? "unknown",
        totalProvisions: loaderEntry.totalProvisions ?? 0,
        realProvisions: loaderEntry.realProvisions ?? 0,
        liteProvisions: loaderEntry.liteProvisions ?? 0,
        teardownCount: loaderEntry.teardownCount ?? 0,
        orphanContainerWarning: loaderEntry.orphanContainerWarning ?? 0,
        lastInvocationAt: loaderEntry.lastInvocationAt,
        lastMode: loaderEntry.lastMode,
        lastError: loaderEntry.lastError,
      };
    } catch {
      return {
        mode: "unknown",
        totalProvisions: 0,
        realProvisions: 0,
        liteProvisions: 0,
        teardownCount: 0,
        orphanContainerWarning: 0,
        lastInvocationAt: undefined,
        lastMode: undefined,
        lastError: undefined,
      };
    }
  }

  return {
    provisionRoleContainer,
    tearDownRoleContainer,
    onStageTransitionHook,
    getDiagnostics,
  };
}

// Re-exports for test / host convenience
export type {
  AigcNodeHandle,
  AigcNodeInvocation,
  AigcNodeInvoker,
  BindingReport,
  McpSessionHandle,
  OrchestratedAigcResult,
  PhysicalContainer,
  RoleCapabilityPackageBinding,
  SkillHandle,
  SkillRegistryDependency,
  StageHandoffContext,
};
