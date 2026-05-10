/**
 * `BlueprintServiceContext`：蓝图栈统一的运行期依赖容器。
 *
 * 本文件是 wt1 引入的共享上下文，8 个子域服务将在后续任务（任务 6-13）
 * 逐步迁出 `server/routes/blueprint.ts`，并改为通过本 context 获取依赖，
 * 不再直接 `import` 模块级单例（`defaultJobStore`、`blueprintStores`）。
 *
 * 本轮任务 4 只定义类型与工厂，不立即切走现有 `createBlueprintRouter` 的装配路径；
 * 任务 14 合并阶段再把 `createBlueprintRouter(deps)` 内部切到 `buildBlueprintServiceContext(deps)`。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 3.1（Context 包含全部子域所需的运行期依赖，每一项可替换）
 * - 需求 3.3（`createBlueprintRouter(deps)` 未显式提供 Context 时能自行构建默认值）
 * - 需求 3.4（`BlueprintJobStore` 工厂收敛为默认实现来源，不并存多套竞争实现）
 * - 需求 3.5（`blueprintStores` 与 `BlueprintJobStore` 的抽象边界）
 */

import path from "node:path";

import { getAIConfig, type AIConfig } from "../../core/ai-config.js";
import { callLLMJson } from "../../core/llm-client.js";
import type { ExecutorClient } from "../../core/executor-client.js";
import {
  createFileBlueprintJobStore,
  type BlueprintJobStore,
} from "./job-store.js";
import type {
  BlueprintClarificationSession,
  BlueprintGenerationArtifact,
  BlueprintGenerationEvent,
  BlueprintGenerationEventType,
  BlueprintGenerationJob,
  BlueprintIntake,
  BlueprintProjectDomainContext,
} from "../../../shared/blueprint/index.js";
import type {
  McpToolExecutionRequest,
  McpToolExecutionResult,
} from "../../tool/api/mcp-tool-adapter.js";
import { createBlueprintEventBus } from "./event-bus.js";
import {
  createRouteSetLlmGenerator,
  type RouteSetLlmGenerator,
} from "./routeset/route-llm-generator.js";
import type {
  BlueprintExecutorCallbackDispatcher,
  DockerCapabilityBridge,
  DockerCapabilityPolicy,
} from "./docker-analysis-sandbox/types.js";
import { createBlueprintExecutorCallbackDispatcher } from "./docker-analysis-sandbox/callback-waiter.js";
import { createDefaultDockerCapabilityPolicy } from "./docker-analysis-sandbox/policy.js";
import { createDockerCapabilityBridge } from "./docker-analysis-sandbox/bridge.js";
import {
  createMcpGithubCapabilityBridge,
  type McpGithubCapabilityBridge,
  type McpGithubCapabilityBridgeInput,
  type McpGithubCapabilityBridgeOutput,
} from "./mcp-github-source/bridge.js";
import type {
  BlueprintHttpFetcher,
  BlueprintHttpResponse,
} from "./mcp-github-source/http-fetcher.js";
import {
  createDefaultMcpGithubCapabilityPolicy,
  type McpGithubCapabilityPolicy,
} from "./mcp-github-source/policy.js";
import {
  createAigcSpecNodeCapabilityBridge,
  type AigcSpecNodeCapabilityBridge,
} from "./aigc-spec-node/bridge.js";
import {
  createDefaultAigcSpecNodeCapabilityPolicy,
  type AigcSpecNodeCapabilityPolicy,
} from "./aigc-spec-node/policy.js";
import { createRoleSystemArchitectureCapabilityBridge } from "./role-system-architecture/bridge.js";
import { createDefaultRoleSystemArchitectureCapabilityPolicy } from "./role-system-architecture/policy.js";
import {
  createDefaultEffectPreviewLlmPolicy,
  type EffectPreviewLlmPolicy,
} from "./effect-preview/policy.js";
import type { EffectPreviewLlmService } from "./effect-preview/service.js";
import { createEffectPreviewLlmService } from "./effect-preview/service.js";
import type { AgentCrewStageActivationPolicy } from "./agent-crew-stage-activation/policy.js";
import { createDefaultAgentCrewStageActivationPolicy } from "./agent-crew-stage-activation/policy.js";
import type { AgentCrewStageActivationDriver } from "./agent-crew-stage-activation/driver.js";
import type { SpecTreeLlmPolicy } from "./spec-tree/policy.js";
import type { SpecTreeLlmService } from "./spec-tree/service.js";
import { createDefaultSpecTreeLlmPolicy } from "./spec-tree/policy.js";
import { createSpecTreeLlmService } from "./spec-tree/service.js";
import type { SpecDocumentsLlmPolicy } from "./spec-documents/policy.js";
import { createDefaultSpecDocumentsLlmPolicy } from "./spec-documents/policy.js";
import type { SpecDocumentsLlmService } from "./spec-documents/service.js";
import { createSpecDocumentsLlmService } from "./spec-documents/service.js";
import type { PromptPackageLlmPolicy } from "./prompt-package/policy.js";
import { createDefaultPromptPackageLlmPolicy } from "./prompt-package/policy.js";
import type { PromptPackageLlmService } from "./prompt-package/service.js";
import { createPromptPackageLlmService } from "./prompt-package/service.js";
import type { EngineeringHandoffLlmPolicy } from "./engineering-handoff/policy.js";
import { createDefaultEngineeringHandoffLlmPolicy } from "./engineering-handoff/policy.js";
import type { EngineeringHandoffLlmService } from "./engineering-handoff/service.js";
import { createEngineeringHandoffLlmService } from "./engineering-handoff/service.js";

/**
 * Role System Architecture capability policy interface.
 *
 * Contains security, quota, and configuration constraints for the role
 * architecture bridge. The full implementation will be provided by task 7
 * (`server/routes/blueprint/role-system-architecture/policy.ts`); this
 * declaration enables the `BlueprintServiceContext` type extension without
 * importing the factory implementation (avoiding circular dependencies).
 *
 * @see design §2.D2 / §4.3
 */
export interface RoleSystemArchitectureCapabilityPolicy {
  maxInvocationTimeoutMs: number;
  temperature: number;
  maxLogLines: number;
  maxLogBytes: number;
  maxStructuredPayloadSummaryBytes: number;
  redactionKeywords: readonly string[];
  redactedEmailPattern: RegExp;
  redactedApiKeyPattern: RegExp;
  redactedGithubPatPattern: RegExp;
  callJsonRetryAttempts: number;
}

/**
 * Role System Architecture capability bridge function type.
 *
 * A pure async function: accepts bridge input (capability / route / request /
 * primaryRouteId etc.), returns an output containing either a real invocation
 * (with structured roles) or a fallback invocation. The full implementation
 * will be provided by task 14
 * (`server/routes/blueprint/role-system-architecture/bridge.ts`); this type
 * alias enables the `BlueprintServiceContext` field declaration without
 * importing the factory (avoiding circular dependencies).
 *
 * @see design §2.D1 / §4.2
 */
export type RoleSystemArchitectureCapabilityBridge = (
  input: any
) => Promise<RoleSystemArchitectureCapabilityBridgeOutput>;

/**
 * Minimal input shape for the Role System Architecture capability bridge.
 * Full definition will be provided by task 14.
 */
export interface RoleSystemArchitectureCapabilityBridgeInput {
  capability: unknown;
  route: unknown;
  jobId: string;
  request: unknown;
  routeSet: unknown;
  primaryRouteId: string;
  clarificationSession?: unknown;
  createdAt: unknown;
  invocationId: string;
  roleId: string;
  [key: string]: unknown;
}

/**
 * Minimal output shape for the Role System Architecture capability bridge.
 * Full definition will be provided by task 14.
 */
export interface RoleSystemArchitectureCapabilityBridgeOutput {
  invocation: unknown;
  executionMode: "real" | "simulated_fallback";
  additionalEvents?: unknown[];
  structuredRoles?: unknown;
  structuredRolesMeta?: { digest: string; byteSize: number; summary: string };
}

export type {
  BlueprintHttpFetcher,
  BlueprintHttpResponse,
  McpGithubCapabilityBridge,
  McpGithubCapabilityBridgeInput,
  McpGithubCapabilityBridgeOutput,
  McpGithubCapabilityPolicy,
  AigcSpecNodeCapabilityBridge,
  AigcSpecNodeCapabilityPolicy,
};

/**
 * 纯内存 Map 三件套：存放尚未进入 jobStore 的 intake / clarification / project context。
 *
 * 和 {@link BlueprintJobStore} 的边界：
 * - 这里的是**会话期纯内存状态**，重启即丢失；
 * - {@link BlueprintJobStore} 是**作业级持久化状态**，由 `createFileBlueprintJobStore` 默认落盘。
 *
 * 两者通过 `BlueprintServiceContext` 一并提供给子域，不允许子域自行实例化。
 *
 * 对应需求 3.5。
 */
export interface BlueprintIntakeStores {
  intakes: Map<string, BlueprintIntake>;
  clarificationSessions: Map<string, BlueprintClarificationSession>;
  projectContexts: Map<string, BlueprintProjectDomainContext>;
}

/**
 * 创建默认的纯内存 `BlueprintIntakeStores`。
 *
 * 用于 `buildBlueprintServiceContext()` 未显式注入时的兜底。
 */
export function createDefaultBlueprintStores(): BlueprintIntakeStores {
  return {
    intakes: new Map<string, BlueprintIntake>(),
    clarificationSessions: new Map<string, BlueprintClarificationSession>(),
    projectContexts: new Map<string, BlueprintProjectDomainContext>(),
  };
}

/**
 * LLM 依赖子集：蓝图栈只关心 JSON 模式调用与配置读取。
 *
 * 之所以拆出独立 interface，是为了在测试里按需替换其中之一。
 */
export interface BlueprintLlmDependencies {
  callJson: typeof callLLMJson;
  getConfig: () => AIConfig;
}

/**
 * 事件总线最小接口。
 *
 * 实现在任务 5（`createBlueprintEventBus`）里给出，
 * 本文件只定义它与 Context 的协作形状。
 *
 * 约束：
 * - `emit` 接受的事件 `type` 必须是 `BlueprintGenerationEventType` 的成员。
 * - `emit` 需要在事件写入 `jobStore.events` 后才返回，保证 Artifact Replay 可见性。
 *
 * 对应需求 5.1 / 5.2 / 5.3。
 */
export interface BlueprintEventBus {
  emit(event: BlueprintGenerationEvent): void;
  /** 订阅所有事件；用于 Artifact Replay 与监控面。 */
  subscribe(listener: (event: BlueprintGenerationEvent) => void): () => void;
}

/**
 * 沙箱推导作业的最小执行接口（任务 9 会落地实现，本轮只定义形状）。
 *
 * 它对应 `agent-crew/sandbox-derivation.ts` 的主执行器职责：接收一个作业请求，
 * 产出一组 artifacts / events。本轮为了让 Context 字段完整，暂时以 `unknown` 宽松签名
 * 占位；任务 9 会把它收窄为精确签名。
 */
export type BlueprintSandboxDerivationRunner = (
  job: BlueprintGenerationJob
) => Promise<{
  artifacts: BlueprintGenerationArtifact[];
  events: BlueprintGenerationEvent[];
}>;

/**
 * Artifact Replay 存储适配器。
 *
 * 为了满足需求 5.3（Artifact Replay 只消费统一事件流，不维护旁路源），
 * 默认实现 `createJobBackedReplayStore(jobStore)` 会从 `job.events + job.artifacts`
 * 现场拼装快照，不持有独立事件存储。任务 13 会给出具体实现。
 */
export interface BlueprintReplayStore {
  listEvents(jobId: string): BlueprintGenerationEvent[];
  listArtifacts(jobId: string): BlueprintGenerationArtifact[];
}

/**
 * 默认 replay store：纯投影，事件与 artifacts 都回 `jobStore.get(jobId)`。
 */
export function createJobBackedReplayStore(
  jobStore: BlueprintJobStore
): BlueprintReplayStore {
  return {
    listEvents(jobId) {
      return jobStore.get(jobId)?.events ?? [];
    },
    listArtifacts(jobId) {
      return jobStore.get(jobId)?.artifacts ?? [];
    },
  };
}

/**
 * 最小 Logger 接口：仅用于可观测性，不影响行为。
 */
export interface BlueprintLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * 默认静默 logger：所有方法 no-op。
 */
export function createSilentBlueprintLogger(): BlueprintLogger {
  return {
    debug: () => void 0,
    info: () => void 0,
    warn: () => void 0,
    error: () => void 0,
  };
}

/**
 * MCP 工具执行入口（只暴露 `execute(request)` 这一个能力）。
 *
 * 设计目标：让 `server/routes/blueprint/mcp-github-source/` 子域只通过
 * 这一最小接口消费主线 `McpToolAdapter.execute()`，避免直接 `import` 类本身
 * 或任何单例（需求 2.3 / 6.2 的硬约束）。主线装配时 `server/index.ts`
 * 会把已有 `McpToolAdapter` 实例以结构化类型（duck-typing）传入。
 *
 * 注意：此处仅 `import type` 依赖，**绝不** import 实现；所有运行时耦合通过
 * 注入到 {@link BlueprintServiceContext.mcpToolAdapter} 实现。
 */
export interface McpToolAdapterDependency {
  execute(request: McpToolExecutionRequest): Promise<McpToolExecutionResult>;
}

// `createFallbackEventBus` 保留用于文档说明；当前默认总线由 `createBlueprintEventBus`
// 在 `buildBlueprintServiceContext` 中直接装配。

/**
 * 默认 sandbox runner 占位：直接返回空 artifacts / 空 events。
 * 真实实现在任务 9 里从 `server/routes/blueprint.ts` 迁出。
 */
function createDefaultSandboxDerivationRunner(): BlueprintSandboxDerivationRunner {
  return async () => ({ artifacts: [], events: [] });
}

/**
 * 蓝图栈的统一运行期上下文。
 *
 * 8 个子域服务（intake / clarification / jobs / agent-crew / routeset /
 * spec-documents / downstream / artifact-memory）都通过此 context 获取依赖：
 * 子域不允许再 `import defaultJobStore` 或 `import { blueprintStores }`（需求 3.2、3.6）。
 *
 * 字段分层说明：
 * - 基础设施（必填、可替换）：`now`、`blueprintStores`、`jobStore`、`llm`、`eventBus`、
 *   `generateClarificationQuestions`、`sandboxDerivationRunner`、`replayStore`。
 * - 可选覆盖：`specsRoot`（`/specs` 扫描根）、`logger`（可观测性）。
 */
export interface BlueprintServiceContext {
  now: () => Date;
  blueprintStores: BlueprintIntakeStores;
  jobStore: BlueprintJobStore;
  llm: BlueprintLlmDependencies;
  generateClarificationQuestions?: BlueprintClarificationQuestionGenerator;
  /**
   * Optional RouteSet LLM driven generator (see
   * `.kiro/specs/autopilot-routeset-llm-generation/design.md` 2.D3 / 4.3).
   * When `buildBlueprintServiceContext` is invoked without
   * `deps.routeSetLlmGenerator`, a default instance is constructed via
   * `createRouteSetLlmGenerator(ctx)` and attached here. Tests can inject a
   * mock through `BlueprintServiceContextDeps.routeSetLlmGenerator` to
   * completely short-circuit LLM calls, matching the semantics of
   * `generateClarificationQuestions`.
   */
  routeSetLlmGenerator?: RouteSetLlmGenerator;
  sandboxDerivationRunner: BlueprintSandboxDerivationRunner;
  replayStore: BlueprintReplayStore;
  eventBus: BlueprintEventBus;
  specsRoot: string;
  logger: BlueprintLogger;
  /**
   * 可选：真实 Docker 执行器客户端。
   *
   * 由 `.kiro/specs/autopilot-capability-bridge-docker` 引入：当 Docker capability
   * bridge 命中 `docker-analysis-sandbox` 时，通过这个客户端向 `services/lobster-executor`
   * 派发真实作业。未注入时 bridge 走 simulated fallback（design §2 D2 / §4.6 step 1）。
   *
   * 本字段当前为类型可选；默认装配在 Task 13 处理，Task 2 只保证 "类型可选且不传也不崩"。
   */
  executorClient?: ExecutorClient;
  /**
   * 可选：HMAC 执行器回调分发器。
   *
   * 由 `server/index.ts` 的 `/api/executor/events` 中间件在 Task 14 接线，将收到的
   * 回调事件通过 `handleEvent(event)` 分发给 bridge 的 `awaitTerminal(jobId, ...)`
   * 等待者（design §4.5）。
   *
   * 接口形状定义在 `./docker-analysis-sandbox/types.ts`，具体实现将于 Task 7 落地。
   */
  executorCallbackDispatcher?: BlueprintExecutorCallbackDispatcher;
  /**
   * 可选：Docker capability 的安全与资源策略。
   *
   * 包含镜像 allow-list、内存 / CPU / pids 上限、网络策略、安全级别、
   * 回调 / 派发超时、日志行数 / 字节上限等。`createDefaultDockerCapabilityPolicy()`
   * 将于 Task 3 提供默认值（design §4.3）。
   */
  dockerCapabilityPolicy?: DockerCapabilityPolicy;
  /**
   * 可选：Docker capability bridge 实例本身。
   *
   * 一个纯异步函数：接收 bridge 输入（capability / route / request 等），返回
   * 包含真实 invocation 或 fallback invocation 的输出（design §4.2 / §4.6）。
   *
   * 测试装配中可直接替换整个 bridge；默认装配由 `createDockerCapabilityBridge(ctx)`
   * 在 Task 10 / Task 13 提供。
   */
  dockerCapabilityBridge?: DockerCapabilityBridge;
  /**
   * MCP 工具执行入口。未注入时 {@link McpGithubCapabilityBridge} 直接走 fallback。
   * 装配规则见 `server/index.ts`（仅在 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED === "true"`
   * 时传入主线已装配的 `McpToolAdapter` 实例，以 {@link McpToolAdapterDependency} 形状注入）。
   */
  mcpToolAdapter?: McpToolAdapterDependency;
  /**
   * HTTPS GET 专用 fetcher。未注入时桥直接走 fallback；只接受 https / allow-list 内 URL。
   * 实现见 `server/routes/blueprint/mcp-github-source/http-fetcher.ts`，主线装配位于
   * `server/index.ts` 的 composition root（可选）。
   */
  httpFetcher?: BlueprintHttpFetcher;
  /**
   * MCP GitHub 能力桥安全策略。未注入时默认使用 `createDefaultMcpGithubCapabilityPolicy()`。
   */
  mcpGithubCapabilityPolicy?: McpGithubCapabilityPolicy;
  /**
   * MCP GitHub 能力桥本体。默认装配 `createMcpGithubCapabilityBridge(ctx)`；
   * 测试可以通过 `buildBlueprintServiceContext({ mcpGithubCapabilityBridge: fake })` 注入。
   */
  mcpGithubCapabilityBridge?: McpGithubCapabilityBridge;
  /**
   * AIGC Spec Node capability policy. Defaults are wired by
   * {@link buildBlueprintServiceContext}; callers may override for tests.
   *
   * Task 15 now default-wires this via
   * `createDefaultAigcSpecNodeCapabilityPolicy()`. The field stays optional so
   * custom {@link BlueprintServiceContext} shapes assembled directly (without
   * {@link buildBlueprintServiceContext}) remain backwards compatible.
   */
  aigcSpecNodeCapabilityPolicy?: AigcSpecNodeCapabilityPolicy;
  /**
   * AIGC Spec Node capability bridge. Defaults to
   * `createAigcSpecNodeCapabilityBridge(ctx)` when not provided.
   *
   * The bridge performs its own tier-1 early-exit when
   * `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED !== "true"` or when the
   * resolved apiKey is empty, so always wiring a bridge instance does not
   * incur LLM traffic in default deployments.
   */
  aigcSpecNodeCapabilityBridge?: AigcSpecNodeCapabilityBridge;
  /**
   * Optional: Role System Architecture capability policy.
   *
   * Contains security/quota/configuration constraints for the role architecture
   * bridge. When not injected, `buildBlueprintServiceContext` will wire a
   * default via `createDefaultRoleSystemArchitectureCapabilityPolicy()` (task
   * 17). The field stays optional so custom contexts assembled directly remain
   * backwards compatible.
   *
   * @see design §2.D2 / §4.3
   */
  roleSystemArchitectureCapabilityPolicy?: RoleSystemArchitectureCapabilityPolicy;
  /**
   * Optional: Role System Architecture capability bridge instance.
   *
   * A pure async function that performs real LLM-driven role architecture
   * reasoning or falls back to simulated output. When not injected,
   * `buildBlueprintServiceContext` will wire a default via
   * `createRoleSystemArchitectureCapabilityBridge(ctx)` (task 17). The bridge
   * performs its own tier-1 early-exit when
   * `BLUEPRINT_ROLE_CAPABILITY_BRIDGE_ENABLED !== "true"` or when the resolved
   * apiKey is empty, so always wiring a bridge instance does not incur LLM
   * traffic in default deployments.
   *
   * @see design §2.D1 / §4.2
   */
  roleSystemArchitectureCapabilityBridge?: RoleSystemArchitectureCapabilityBridge;
  /**
   * Optional: Effect Preview LLM capability policy.
   *
   * Contains security / schema upper bounds / redaction patterns for the
   * Effect Preview LLM service (see
   * `server/routes/blueprint/effect-preview/policy.ts` +
   * `.kiro/specs/autopilot-effect-preview-llm/design.md` §4.3). When not
   * injected, `buildBlueprintServiceContext` wires a default via
   * `createDefaultEffectPreviewLlmPolicy()`. The field stays optional so
   * custom {@link BlueprintServiceContext} shapes assembled directly
   * remain backwards compatible.
   *
   * @see design §2.D2 / §4.3
   */
  effectPreviewLlmPolicy?: EffectPreviewLlmPolicy;
  /**
   * Optional: Effect Preview LLM service instance.
   *
   * A pure async function that performs per-preview LLM-driven Effect
   * Preview generation or falls back to the templated path. When not
   * injected, `buildBlueprintServiceContext` wires a default via
   * `createEffectPreviewLlmService(ctx)`. The service performs its own
   * tier-1 early-exit when `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED !== "true"`
   * or when the resolved apiKey is empty, so always wiring a service
   * instance does not incur LLM traffic in default deployments.
   *
   * @see design §2.D1 / §2.D2 / §4.2 / §4.6
   */
  effectPreviewLlmService?: EffectPreviewLlmService;
  /**
   * Agent Crew Stage Activation policy (pure data, stateless).
   * Controls event suppression, idempotence, redaction rules and schema
   * version allow-list. Defaults to `createDefaultAgentCrewStageActivationPolicy()`
   * when not provided via deps.
   */
  agentCrewStageActivationPolicy?: AgentCrewStageActivationPolicy;
  /**
   * Agent Crew Stage Activation driver instance.
   * **Not default-assembled** — the driver is per-job lifecycle (internal
   * tracker state), so the outer layer lazy-constructs it at each job start
   * via `createAgentCrewStageActivationDriver(ctx)` and writes it back here.
   * See design §2.D2.
   */
  agentCrewStageActivationDriver?: AgentCrewStageActivationDriver;
  /**
   * Optional: SPEC Tree LLM generation policy (pure data, stateless).
   * Controls timeout, temperature, retry attempts, schema bounds, and
   * redaction rules. When not injected, `buildBlueprintServiceContext` wires
   * a default via `createDefaultSpecTreeLlmPolicy()`.
   *
   * @see design §2.D2 / §4.3
   */
  specTreeLlmPolicy?: SpecTreeLlmPolicy;
  /**
   * Optional: SPEC Tree LLM service instance.
   * A pure async function that performs LLM-driven SPEC Tree generation or
   * falls back to template output. When not injected,
   * `buildBlueprintServiceContext` wires a default via
   * `createSpecTreeLlmService(ctx)`. The service performs its own tier-1
   * early-exit when `BLUEPRINT_SPEC_TREE_LLM_ENABLED !== "true"` or when the
   * resolved apiKey is empty, so always wiring a service instance does not
   * incur LLM traffic in default deployments.
   *
   * @see design §2.D1 / §4.2
   */
  specTreeLlmService?: SpecTreeLlmService;
  /**
   * Optional: SPEC Documents LLM service policy.
   *
   * Controls schema upper bounds (sections / body / title length), redaction
   * patterns, retry attempts and timeout ceiling for the SPEC Documents LLM
   * driven generation path. When omitted, {@link buildBlueprintServiceContext}
   * wires {@link createDefaultSpecDocumentsLlmPolicy}.
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §4.3
   */
  specDocumentsLlmPolicy?: SpecDocumentsLlmPolicy;
  /**
   * Optional: SPEC Documents LLM service instance (per-document LLM driver).
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §2.D2 / §4.2 / §4.6
   */
  specDocumentsLlmService?: SpecDocumentsLlmService;
  /**
   * Optional: Prompt Package LLM service policy (pure data, stateless).
   * When omitted, `buildBlueprintServiceContext` wires a default via
   * `createDefaultPromptPackageLlmPolicy()`.
   */
  promptPackageLlmPolicy?: PromptPackageLlmPolicy;
  /**
   * Optional: Prompt Package LLM service. When omitted,
   * `buildBlueprintServiceContext` wires `createPromptPackageLlmService(ctx)`.
   */
  promptPackageLlmService?: PromptPackageLlmService;
  /**
   * Optional: Engineering Handoff LLM policy (pure data, stateless).
   * When omitted, `buildBlueprintServiceContext` wires
   * `createDefaultEngineeringHandoffLlmPolicy()`.
   */
  engineeringHandoffLlmPolicy?: EngineeringHandoffLlmPolicy;
  /**
   * Optional: Engineering Handoff LLM service. When omitted,
   * `buildBlueprintServiceContext` wires
   * `createEngineeringHandoffLlmService(ctx)`.
   */
  engineeringHandoffLlmService?: EngineeringHandoffLlmService;
}

/**
 * {@link BlueprintServiceContext} 的构造参数。全部可选，未提供的字段使用默认实现。
 *
 * 这是需求 3.3 的实现：`createBlueprintRouter(deps)` 在未显式提供 Context 时，
 * 通过把 `deps` 转成 `BlueprintServiceContextDeps` 一并交给 `buildBlueprintServiceContext`
 * 即可得到完整 Context。
 */
export interface BlueprintServiceContextDeps {
  now?: () => Date;
  blueprintStores?: BlueprintIntakeStores;
  jobStore?: BlueprintJobStore;
  llm?: Partial<BlueprintLlmDependencies>;
  generateClarificationQuestions?: BlueprintClarificationQuestionGenerator;
  /**
   * Optional RouteSet LLM generator override. When omitted,
   * `buildBlueprintServiceContext` wires a default via
   * `createRouteSetLlmGenerator(ctx)`.
   */
  routeSetLlmGenerator?: RouteSetLlmGenerator;
  sandboxDerivationRunner?: BlueprintSandboxDerivationRunner;
  replayStore?: BlueprintReplayStore;
  eventBus?: BlueprintEventBus;
  specsRoot?: string;
  jobStoreFile?: string;
  logger?: BlueprintLogger;
  /**
   * 可选：注入自定义 `ExecutorClient`（测试场景常用）。
   * 未提供时 ctx 上 `executorClient` 字段保持 `undefined`，bridge 将据此走 fallback
   * （Task 13 默认装配策略：不自动构造默认 `ExecutorClient` 以避免 dev 默认装配下的
   * 额外网络往返）。
   */
  executorClient?: ExecutorClient;
  /**
   * 可选：注入自定义 `BlueprintExecutorCallbackDispatcher`。
   * 未提供时由 `buildBlueprintServiceContext` 在 Task 13 装配默认实例。
   */
  executorCallbackDispatcher?: BlueprintExecutorCallbackDispatcher;
  /**
   * 可选：注入自定义 Docker capability 策略。
   * 未提供时默认装配使用 `createDefaultDockerCapabilityPolicy()`（Task 3 / Task 13）。
   */
  dockerCapabilityPolicy?: DockerCapabilityPolicy;
  /**
   * 可选：直接注入 Docker capability bridge 实例。
   * 未提供时由 Task 13 通过 `createDockerCapabilityBridge(ctx)` 装配默认实例。
   */
  dockerCapabilityBridge?: DockerCapabilityBridge;
  /** See {@link BlueprintServiceContext.mcpToolAdapter}. */
  mcpToolAdapter?: McpToolAdapterDependency;
  /** See {@link BlueprintServiceContext.httpFetcher}. */
  httpFetcher?: BlueprintHttpFetcher;
  /** See {@link BlueprintServiceContext.mcpGithubCapabilityPolicy}. */
  mcpGithubCapabilityPolicy?: McpGithubCapabilityPolicy;
  /** See {@link BlueprintServiceContext.mcpGithubCapabilityBridge}. */
  mcpGithubCapabilityBridge?: McpGithubCapabilityBridge;
  /**
   * Optional override for the AIGC Spec Node policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultAigcSpecNodeCapabilityPolicy}.
   */
  aigcSpecNodeCapabilityPolicy?: AigcSpecNodeCapabilityPolicy;
  /**
   * Optional override for the AIGC Spec Node bridge. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createAigcSpecNodeCapabilityBridge} using the fully-constructed
   * context (so the bridge sees the same `llm` / `logger` / `now` /
   * `aigcSpecNodeCapabilityPolicy` that the rest of the app uses).
   */
  aigcSpecNodeCapabilityBridge?: AigcSpecNodeCapabilityBridge;
  /**
   * Optional override for the Role System Architecture capability policy.
   * When omitted, {@link buildBlueprintServiceContext} will wire a default via
   * `createDefaultRoleSystemArchitectureCapabilityPolicy()` (task 17).
   *
   * @see design §2.D2 / §4.3
   */
  roleSystemArchitectureCapabilityPolicy?: RoleSystemArchitectureCapabilityPolicy;
  /**
   * Optional override for the Role System Architecture capability bridge.
   * When omitted, {@link buildBlueprintServiceContext} will wire a default via
   * `createRoleSystemArchitectureCapabilityBridge(ctx)` (task 17).
   *
   * @see design §2.D1 / §4.2
   */
  roleSystemArchitectureCapabilityBridge?: RoleSystemArchitectureCapabilityBridge;
  /**
   * Optional override for the Effect Preview LLM policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultEffectPreviewLlmPolicy}.
   *
   * @see design §2.D2 / §4.3
   */
  effectPreviewLlmPolicy?: EffectPreviewLlmPolicy;
  /**
   * Optional override for the Effect Preview LLM service. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createEffectPreviewLlmService} using the fully-constructed
   * context (so the service sees the same `llm` / `logger` / `now` /
   * `effectPreviewLlmPolicy` that the rest of the app uses).
   *
   * @see design §2.D1 / §2.D2 / §4.2 / §4.6
   */
  effectPreviewLlmService?: EffectPreviewLlmService;
  /**
   * Optional override for the Agent Crew Stage Activation policy.
   * When omitted, {@link buildBlueprintServiceContext} wires
   * {@link createDefaultAgentCrewStageActivationPolicy}.
   */
  agentCrewStageActivationPolicy?: AgentCrewStageActivationPolicy;
  /**
   * Optional: inject a pre-constructed Agent Crew Stage Activation driver.
   * When omitted, `buildBlueprintServiceContext` does NOT default-assemble a
   * driver (per-job lifecycle; design §2.D2). The outer layer lazy-constructs
   * it at each job start.
   */
  agentCrewStageActivationDriver?: AgentCrewStageActivationDriver;
  /**
   * Optional override for the SPEC Tree LLM policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultSpecTreeLlmPolicy}.
   *
   * @see design §2.D2 / §4.3
   */
  specTreeLlmPolicy?: SpecTreeLlmPolicy;
  /**
   * Optional override for the SPEC Tree LLM service. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createSpecTreeLlmService} using the fully-constructed context
   * (so the service sees the same `llm` / `logger` / `now` /
   * `specTreeLlmPolicy` that the rest of the app uses).
   *
   * @see design §2.D1 / §4.2
   */
  specTreeLlmService?: SpecTreeLlmService;
  /**
   * Optional override for the SPEC Documents LLM policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultSpecDocumentsLlmPolicy}.
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §4.3
   */
  specDocumentsLlmPolicy?: SpecDocumentsLlmPolicy;
  /**
   * Optional override for the SPEC Documents LLM service. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createSpecDocumentsLlmService} using the fully-constructed context
   * so the service sees the same `llm` / `logger` / `now` /
   * `specDocumentsLlmPolicy` that the rest of the app uses.
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §2.D2 / §4.6
   */
  specDocumentsLlmService?: SpecDocumentsLlmService;
  /** See {@link BlueprintServiceContext.promptPackageLlmPolicy}. */
  promptPackageLlmPolicy?: PromptPackageLlmPolicy;
  /** See {@link BlueprintServiceContext.promptPackageLlmService}. */
  promptPackageLlmService?: PromptPackageLlmService;
  /** See {@link BlueprintServiceContext.engineeringHandoffLlmPolicy}. */
  engineeringHandoffLlmPolicy?: EngineeringHandoffLlmPolicy;
  /** See {@link BlueprintServiceContext.engineeringHandoffLlmService}. */
  engineeringHandoffLlmService?: EngineeringHandoffLlmService;
}

/**
 * 澄清问题生成器签名：与 `server/routes/blueprint.ts` 中现有同名类型保持兼容。
 *
 * 本文件不回拉 `blueprint.ts` 中的 `BlueprintClarificationQuestionGenerator`，
 * 是为了避免循环 import；签名在两处保持一致，由任务 7 的 clarification 子域迁出时统一。
 */
export type BlueprintClarificationQuestionGenerator = (
  input: unknown
) => Promise<unknown>;

let cachedDefaultJobStore: BlueprintJobStore | null = null;

/**
 * 懒加载默认 {@link BlueprintJobStore}。
 *
 * 需求 3.4 要求把 `createFileBlueprintJobStore` 收敛为默认实现来源；此处只在第一次
 * 被 `buildBlueprintServiceContext` 需要且未注入 `jobStore` 时才实例化，避免模块加载
 * 时的磁盘副作用（原来的 `const defaultJobStore = createFileBlueprintJobStore()` 在
 * `.kiro/blueprint-assets/` 目录不存在时会产生读写噪音）。
 */
function getDefaultJobStore(storageFile?: string): BlueprintJobStore {
  if (storageFile) {
    return createFileBlueprintJobStore(storageFile);
  }
  if (!cachedDefaultJobStore) {
    cachedDefaultJobStore = createFileBlueprintJobStore();
  }
  return cachedDefaultJobStore;
}

/**
 * 构造 {@link BlueprintServiceContext}。
 *
 * - 所有字段都可以通过 `deps` 显式覆盖。
 * - 未提供的字段使用默认实现（全部为 lazy / 幂等）。
 * - 本函数不持有全局状态；多次调用会返回多个独立的 Context 实例，
 *   因此测试可以按需 `buildBlueprintServiceContext({ jobStore: createMemoryBlueprintJobStore() })`
 *   得到一个完全隔离的装配。
 */
export function buildBlueprintServiceContext(
  deps: BlueprintServiceContextDeps = {}
): BlueprintServiceContext {
  // 装配顺序（Task 13.3）：
  // 1. 先解析 `now` / `logger`（基础依赖）；
  // 2. 再装配 `executorCallbackDispatcher`（依赖 `now` / `logger`）；
  // 3. 再装配 `dockerCapabilityPolicy`（纯数据，无上游依赖）；
  // 4. 最后装配 `dockerCapabilityBridge`（依赖 ctx 本体 —— 见下文说明）。
  //
  // bridge 的工厂签名是 `createDockerCapabilityBridge(ctx)`，它在闭包内持有
  // 对 ctx 的引用，每次调用时从 ctx 读取 `executorClient` /
  // `executorCallbackDispatcher` / `dockerCapabilityPolicy` / `logger` / `now`。
  // 因此构造分两步：
  //   a. 先组装除 `dockerCapabilityBridge` 外的所有字段（含 dispatcher / policy /
  //      可选 executorClient 透传）；
  //   b. 以 baseCtx 调用 `createDockerCapabilityBridge(baseCtx)` 得到 bridge；
  //   c. 返回带 bridge 字段的最终 ctx（baseCtx 与最终 ctx 字段完全等价，仅
  //      bridge 从 `undefined` 变为真实实例）。
  //
  // 此处不把 bridge 闭包绑定到 "未带 bridge 的 baseCtx"，因为 bridge 自身不会
  // 通过 `ctx.dockerCapabilityBridge` 调自己；其它字段 dispatcher / policy /
  // executorClient 在 baseCtx 上已经就位，bridge 每次调用时的字段查找都命中真值。
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? createSilentBlueprintLogger();
  const jobStore = deps.jobStore ?? getDefaultJobStore(deps.jobStoreFile);
  // Task 13.1：executorCallbackDispatcher / dockerCapabilityPolicy 默认装配。
  // Task 13.2：executorClient 继续透传，不强行装配默认实例 —— bridge 在 ctx 上
  // `executorClient` 为 `undefined` 时会走 simulated fallback 早退路径（design
  // §4.6 step 1），保证 dev 默认装配下不会因默认 HTTP executor 连接尝试而拖慢
  // 响应，也保证测试默认装配行为等价于今天（design §2 D10）。
  const executorCallbackDispatcher =
    deps.executorCallbackDispatcher ??
    createBlueprintExecutorCallbackDispatcher({ now, logger });
  const dockerCapabilityPolicy =
    deps.dockerCapabilityPolicy ?? createDefaultDockerCapabilityPolicy();

  // AIGC Spec Node policy default (pure data, dependency-free).
  const aigcSpecNodePolicy =
    deps.aigcSpecNodeCapabilityPolicy ??
    createDefaultAigcSpecNodeCapabilityPolicy();

  // Agent Crew Stage Activation policy default (pure data, stateless).
  // Driver is NOT default-assembled here — it is per-job lifecycle (design §2.D2).
  const agentCrewStageActivationPolicy =
    deps.agentCrewStageActivationPolicy ??
    createDefaultAgentCrewStageActivationPolicy();

  // SPEC Documents LLM policy default (pure data, dependency-free).
  const specDocumentsLlmPolicy =
    deps.specDocumentsLlmPolicy ?? createDefaultSpecDocumentsLlmPolicy();

  const baseCtx: BlueprintServiceContext = {
    now,
    blueprintStores: deps.blueprintStores ?? createDefaultBlueprintStores(),
    jobStore,
    llm: {
      callJson: deps.llm?.callJson ?? callLLMJson,
      getConfig: deps.llm?.getConfig ?? (() => getAIConfig()),
    },
    generateClarificationQuestions: deps.generateClarificationQuestions,
    // `routeSetLlmGenerator` is assigned below after `ctx` is fully built so
    // the default generator can bind to the finalized `llm` / `logger`.
    routeSetLlmGenerator: undefined,
    sandboxDerivationRunner:
      deps.sandboxDerivationRunner ?? createDefaultSandboxDerivationRunner(),
    replayStore: deps.replayStore ?? createJobBackedReplayStore(jobStore),
    eventBus: deps.eventBus ?? createBlueprintEventBus(jobStore, deps.logger),
    specsRoot:
      deps.specsRoot ?? path.resolve(process.cwd(), ".kiro", "specs"),
    logger,
    // Docker capability bridge 相关依赖：
    // - executorClient 仅透传（Task 13.2）；
    // - executorCallbackDispatcher / dockerCapabilityPolicy 默认装配（Task 13.1）；
    // - dockerCapabilityBridge 先占位为 undefined，下一步用 baseCtx 构造默认实例。
    executorClient: deps.executorClient,
    executorCallbackDispatcher,
    dockerCapabilityPolicy,
    dockerCapabilityBridge: undefined,
    // —— MCP GitHub capability bridge 相关字段（本 spec 任务 17 默认装配）——
    // `mcpToolAdapter` / `httpFetcher` 未注入时保持 undefined；桥检测到两条真
    // 实路径都不可用时自动走 fallback（design §2.D2）。
    mcpToolAdapter: deps.mcpToolAdapter,
    httpFetcher: deps.httpFetcher,
    // Policy 是纯数据，默认值来自 `createDefaultMcpGithubCapabilityPolicy()`；
    // 支持通过 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED` + env overrides 调参。
    mcpGithubCapabilityPolicy:
      deps.mcpGithubCapabilityPolicy ??
      createDefaultMcpGithubCapabilityPolicy(),
    // Bridge 本体 — 懒绑定，下方填充。需要先构造 ctx 才能把 ctx 作为闭包入参
    // 传给 `createMcpGithubCapabilityBridge`。
    mcpGithubCapabilityBridge: deps.mcpGithubCapabilityBridge,
    // AIGC Spec Node capability: policy eagerly resolved, bridge late-bound.
    aigcSpecNodeCapabilityPolicy: aigcSpecNodePolicy,
    aigcSpecNodeCapabilityBridge: deps.aigcSpecNodeCapabilityBridge,
    // Role System Architecture capability: policy eagerly resolved, bridge late-bound.
    roleSystemArchitectureCapabilityPolicy:
      deps.roleSystemArchitectureCapabilityPolicy ??
      createDefaultRoleSystemArchitectureCapabilityPolicy(),
    roleSystemArchitectureCapabilityBridge:
      deps.roleSystemArchitectureCapabilityBridge,
    // Effect Preview LLM: policy eagerly resolved, service late-bound.
    effectPreviewLlmPolicy:
      deps.effectPreviewLlmPolicy ?? createDefaultEffectPreviewLlmPolicy(),
    effectPreviewLlmService: deps.effectPreviewLlmService,
    // Agent Crew Stage Activation: policy eagerly resolved, driver NOT
    // default-assembled (per-job lifecycle; design §2.D2).
    agentCrewStageActivationPolicy,
    agentCrewStageActivationDriver: deps.agentCrewStageActivationDriver,
    // SPEC Tree LLM: policy eagerly resolved, service late-bound.
    specTreeLlmPolicy: deps.specTreeLlmPolicy ?? createDefaultSpecTreeLlmPolicy(),
    specTreeLlmService: deps.specTreeLlmService,
    // SPEC Documents LLM: policy eagerly resolved, service late-bound below
    // (needs finalized `ctx` for `llm` / `logger` / `now` closure).
    specDocumentsLlmPolicy,
    specDocumentsLlmService: deps.specDocumentsLlmService,
    // Prompt Package LLM: policy eagerly resolved, service late-bound below.
    promptPackageLlmPolicy:
      deps.promptPackageLlmPolicy ?? createDefaultPromptPackageLlmPolicy(),
    promptPackageLlmService: deps.promptPackageLlmService,
    // Engineering Handoff LLM: policy eagerly resolved, service late-bound below.
    engineeringHandoffLlmPolicy:
      deps.engineeringHandoffLlmPolicy ??
      createDefaultEngineeringHandoffLlmPolicy(),
    engineeringHandoffLlmService: deps.engineeringHandoffLlmService,
  };

  // Task 13.1 / 13.3 最后一步：用 baseCtx 构造默认 docker bridge（或透传注入的 bridge）。
  const dockerCapabilityBridge =
    deps.dockerCapabilityBridge ?? createDockerCapabilityBridge(baseCtx);

  const ctx: BlueprintServiceContext = {
    ...baseCtx,
    dockerCapabilityBridge,
  };

  // MCP GitHub capability bridge late-bind：必须在 ctx 组装完毕后构造，因为
  // `createMcpGithubCapabilityBridge(ctx)` 会闭包持有 ctx 引用，运行期从 ctx
  // 读取 `mcpToolAdapter` / `httpFetcher` / `mcpGithubCapabilityPolicy`。
  if (!ctx.mcpGithubCapabilityBridge) {
    ctx.mcpGithubCapabilityBridge = createMcpGithubCapabilityBridge(ctx);
  }

  // AIGC Spec Node bridge late-bind：bridge 闭包需要 ctx.aigcSpecNodeCapabilityPolicy /
  // ctx.llm / ctx.logger / ctx.now 都已就位。
  if (!ctx.aigcSpecNodeCapabilityBridge) {
    ctx.aigcSpecNodeCapabilityBridge = createAigcSpecNodeCapabilityBridge(ctx);
  }

  // Role System Architecture bridge late-bind: bridge closure needs
  // ctx.roleSystemArchitectureCapabilityPolicy / ctx.llm / ctx.logger / ctx.now.
  if (!ctx.roleSystemArchitectureCapabilityBridge) {
    ctx.roleSystemArchitectureCapabilityBridge =
      createRoleSystemArchitectureCapabilityBridge(ctx);
  }

  // Effect Preview LLM service late-bind: service closure reads
  // `ctx.effectPreviewLlmPolicy` / `ctx.llm` / `ctx.logger` from ctx on
  // each invocation. See `.kiro/specs/autopilot-effect-preview-llm/design.md`
  // §4.2 / §4.6 for the factory contract. The default service performs its
  // own tier-1 env-gate + tier-2 apiKey check, so wiring the instance here
  // does not incur LLM traffic in default deployments.
  if (!ctx.effectPreviewLlmService) {
    ctx.effectPreviewLlmService = createEffectPreviewLlmService(ctx);
  }

  // RouteSet LLM generator late-bind: the default generator needs the fully
  // assembled `ctx` (including llm / logger / dockerCapabilityBridge) so we
  // bind it here after `ctx` is finalized. See design 4.7 for the late-bind
  // rationale.
  ctx.routeSetLlmGenerator =
    deps.routeSetLlmGenerator ?? createRouteSetLlmGenerator(ctx);

  // SPEC Tree LLM: policy eagerly resolved (pure data), service late-bound.
  // The service closure needs ctx.llm / ctx.logger / ctx.now / ctx.specTreeLlmPolicy.
  if (!ctx.specTreeLlmService) {
    ctx.specTreeLlmService = createSpecTreeLlmService(ctx);
  }

  // SPEC Documents LLM service late-bind: service closure needs
  // ctx.specDocumentsLlmPolicy / ctx.llm / ctx.logger / ctx.now to be fully
  // resolved. The service performs its own tier-1 (env var not enabled) and
  // tier-2 (apiKey missing) early-exit to the template path, so always wiring
  // a default instance does not incur LLM traffic in default deployments.
  // See `.kiro/specs/autopilot-spec-documents-llm/design.md` §4.6.
  if (!ctx.specDocumentsLlmService) {
    ctx.specDocumentsLlmService = createSpecDocumentsLlmService(ctx);
  }

  // Prompt Package LLM service late-bind.
  if (!ctx.promptPackageLlmService) {
    ctx.promptPackageLlmService = createPromptPackageLlmService(ctx);
  }

  // Engineering Handoff LLM service late-bind.
  if (!ctx.engineeringHandoffLlmService) {
    ctx.engineeringHandoffLlmService = createEngineeringHandoffLlmService(ctx);
  }
  return ctx;
}

/**
 * 仅给测试使用：重置缓存的默认 jobStore，让下一次 `buildBlueprintServiceContext()`
 * 重新实例化 `createFileBlueprintJobStore()`。
 *
 * 不导出到生产代码。
 *
 * @internal
 */
export function __resetCachedDefaultBlueprintJobStore(): void {
  cachedDefaultJobStore = null;
}

/**
 * 占位：当实现中发现事件 `type` 不属于已定义的家族时触发。
 *
 * 任务 5 的 `createBlueprintEventBus` 会把这里换成真正的守卫。
 */
export function assertBlueprintEventType(
  type: BlueprintGenerationEventType
): BlueprintGenerationEventType {
  return type;
}
