/**
 * Docker Capability Bridge — 工厂与主算法（Task 10）
 *
 * 本文件提供 `createDockerCapabilityBridge(ctx)` 工厂：它返回一个纯异步的
 * `DockerCapabilityBridge` 函数，由 `createRouteGenerationSandboxDerivation()`
 * 在命中 `capability.id === "docker-analysis-sandbox"` 分支时调用。
 *
 * 运行期行为（对应 design §4.6 伪代码）：
 *
 * 1. 早退：`ctx.executorClient` / `ctx.executorCallbackDispatcher` /
 *    `ctx.dockerCapabilityPolicy` 任一未注入，或环境变量
 *    `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED !== "true"` → 直接
 *    `buildFallbackOutput(input, { reason: "capability bridge not configured" })`。
 *    此路径不打印 warn 级别日志（dev 默认状态），仅走 `ctx.logger.debug`。
 * 2. `executorClient.assertReachable()` 失败 → fallback with
 *    `"executor unreachable: {message}"`。
 * 3. `checkDockerCapabilityPolicy(policy, { image })` 返回 `allowed: false`
 *    → fallback with `"policy denied: {reason}"`。
 * 4. `buildDockerCapabilityExecutionPlan({ bridgeInput, policy })`。
 * 5. `executorClient.dispatchPlan(plan, { jobId, idempotencyKey })`：失败重试
 *    1 次；`ExecutorClientError.kind === "rejected"` **不重试**；最终失败
 *    → fallback with `"dispatch failed: {message}"`。
 * 6. `dispatcher.collectLogs(...)` + `dispatcher.awaitTerminal(jobId, timeoutMs)`：
 *    - 超时 → best-effort `executorClient.cancelJob?.(invocationId)` +
 *      fallback with reason `"callback timeout"` 字面量。
 *    - 其它 reject → best-effort cancel + fallback with
 *      `"callback failed: {message}"`。
 * 7. 终态事件判断：
 *    - `type === "job.completed"` → 构造 `buildRealInvocation(...)`。
 *    - `type === "job.failed"` → fallback with
 *      `"executor failure: {message || 'unknown'}"`。
 * 8. 无论 real 还是 fallback 路径，在 finally 中 `collector.dispose()`。
 *
 * 设计约束（硬约束，code review 阶段应直接拒绝违反者）：
 *
 * - 不得 `import { DockerRunner, MockRunner } from "../../../../services/lobster-executor/..."`。
 * - 不得 `new ExecutorClient(...)` 自己装配执行器；全部通过 `ctx.executorClient` 注入。
 * - 不得 `import "dockerode"` 或其它 docker runtime 依赖。
 * - 不得持有模块级单例状态；工厂每次调用返回独立闭包。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 *
 * - requirements 2.1 / 2.2 / 2.3 / 2.4 / 2.5 / 2.6 / 3.1 / 3.2 / 3.3 / 3.5 /
 *   3.6 / 4.1 / 4.2 / 4.5 / 4.6 / 6.1 / 6.2 / 7.1 / 7.5。
 * - design §4.2（类型定义）、§4.6（主算法）、§4.7（real invocation 构造）、
 *   §4.8（fallback 构造）。
 */

import { ExecutorClientError } from "../../../core/executor-client.js";
import {
  buildCapabilityInvocationLogs,
  buildCapabilityOutputSummary,
  deterministicCapabilityDuration,
} from "../../blueprint.js";
import type { BlueprintServiceContext } from "../context.js";
import type {
  BlueprintCapabilityInvocation,
  BlueprintGenerationEvent,
} from "../../../../shared/blueprint/index.js";
import type { ExecutorEvent } from "../../../../shared/executor/contracts.js";

import { buildDockerCapabilityExecutionPlan } from "./execution-plan.js";
import { checkDockerCapabilityPolicy } from "./policy.js";
import type {
  BlueprintExecutorCallbackDispatcher,
  DockerCapabilityBridge,
  DockerCapabilityBridgeInput,
  DockerCapabilityBridgeOutput,
  DockerCapabilityPolicy,
} from "./types.js";

/**
 * Re-export canonical 类型，让消费者既可以 `import from "./bridge.js"`（与
 * 工厂同源），也可以 `import from "./types.js"`（与其它子域模块同源）。
 *
 * 使用 `export type ... from` 形态，保证不引入运行时实体。
 */
export type {
  DockerCapabilityBridge,
  DockerCapabilityBridgeInput,
  DockerCapabilityBridgeOutput,
} from "./types.js";

/**
 * `buildRealInvocation()` 的参数形状。
 *
 * 外部不调用该 helper；仅用于本文件内部聚合字段。
 */
export interface BuildRealInvocationParams {
  readonly input: DockerCapabilityBridgeInput;
  readonly terminalEvent: ExecutorEvent;
  readonly durationMs: number;
  readonly logs: readonly string[];
  readonly logDigest: string | undefined;
  readonly completedAt: string;
}

/**
 * 默认 Docker 镜像（与 `execution-plan.ts` 保持一致；此处仅用于 policy 校验）。
 */
const DEFAULT_DOCKER_IMAGE = "lobster-executor:default";

/**
 * Provenance / logs / error message 截断上限（字符数）。
 */
const ERROR_TRUNCATE_LIMIT = 400;

/**
 * 把一段错误原因截断到 `max` 字符；`reason.length <= max` 时原样返回。
 *
 * 截断口径与 `autopilot-routeset-llm-generation` spec 的 `truncate(err.message, 400)`
 * 对齐；避免 ExecutorClientError 的 stack trace 污染 provenance / evidence。
 */
function truncate(reason: string, max: number): string {
  if (reason.length <= max) {
    return reason;
  }
  return reason.slice(0, max);
}

/**
 * 从任意 error-like 值中提取可读 message。
 *
 * 优先级：`Error.message` > `String(error)`；`undefined` / `null` → `"unknown"`。
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error === undefined || error === null) {
    return "unknown";
  }
  try {
    return String(error);
  } catch {
    return "unknown";
  }
}

/**
 * 判断 `ExecutorClientError` 是否属于 "rejected" 类型（不可重试）。
 *
 * "rejected" 语义：executor 主动以 4xx / policy-level 拒绝了请求（例如
 * capability 不支持、plan 格式错误）。对这类错误重试无意义，重试只会
 * 再一次返回同样的拒绝。
 *
 * 其它 kind（`"unavailable"` / `"protocol"`）表示网络 / 协议瞬态错误，
 * bridge 在 dispatch 阶段允许重试 1 次。
 */
function isNonRetryableDispatchError(error: unknown): boolean {
  return error instanceof ExecutorClientError && error.kind === "rejected";
}

/**
 * 从 terminal 事件中提取 `containerId`（design §4.7）。
 *
 * executor 侧通常把 containerId 放到 `event.payload.containerId`（优先）；
 * 未命中时尝试 `event.payload.container_id`（兼容 snake_case 变体）；
 * 都未命中返回 `undefined`（可选字段）。
 */
function extractContainerId(event: ExecutorEvent): string | undefined {
  const payload = event.payload;
  if (!payload) return undefined;
  const camel = payload.containerId;
  if (typeof camel === "string" && camel.length > 0) {
    return camel;
  }
  const snake = payload.container_id;
  if (typeof snake === "string" && snake.length > 0) {
    return snake;
  }
  return undefined;
}

/**
 * 从 terminal 事件中提取主 artifact 的 URL（design §4.7）。
 *
 * 取 `event.artifacts[0].url`（如果存在）；未命中返回 `undefined`。
 */
function extractArtifactUrl(event: ExecutorEvent): string | undefined {
  const artifacts = event.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return undefined;
  }
  const first = artifacts[0];
  if (!first) return undefined;
  const url = (first as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) {
    return url;
  }
  return undefined;
}

/**
 * 从 `event.artifacts` 中派生出展示用 outputSummary（design §4.7）。
 *
 * 当 `terminalEvent.summary` 未提供时使用：
 * - 优先 `artifacts[0].name`
 * - 否则 `"Docker analysis completed"`
 *
 * 两者都是 executor 侧已脱敏的字段（design §D9）。
 */
function deriveSummaryFromArtifacts(event: ExecutorEvent): string {
  const artifacts = event.artifacts;
  if (Array.isArray(artifacts) && artifacts.length > 0) {
    const first = artifacts[0];
    const name = (first as { name?: unknown })?.name;
    if (typeof name === "string" && name.length > 0) {
      return `Docker analysis completed: ${name}`;
    }
  }
  return "Docker analysis completed";
}

/**
 * 构造 real 路径的 `BlueprintCapabilityInvocation`（design §4.7）。
 *
 * 字段填充规则：
 *
 * - `durationMs`：bridge 调用者提供的墙钟毫秒（完成时间 − 派发时间）。
 * - `logs`：来自 `collector.getLogs()`（已脱敏、已按上限截断）。
 * - `outputSummary`：`terminalEvent.summary` 优先；否则派生自 artifacts。
 * - `requestedBy: "docker-capability-bridge"`：明示 invocation 由 real 路径产出。
 * - `safetyGate.reason`：`"{capability.label} approved for real Docker execution via lobster-executor."`
 * - `provenance.executionMode: "real"` + 新字段 `containerId / artifactUrl / logDigest`。
 *
 * 未新增字段的其它属性（id / jobId / capabilityId / roleId / capabilityLabel /
 * kind / securityLevel / requestedAt / routeId / input / evidenceIds 以及
 * provenance 既有字段）与 simulated 路径形态等价。
 */
function buildRealInvocation(
  params: BuildRealInvocationParams
): BlueprintCapabilityInvocation {
  const { input, terminalEvent, durationMs, logs, logDigest, completedAt } =
    params;

  const containerId = extractContainerId(terminalEvent);
  const artifactUrl = extractArtifactUrl(terminalEvent);
  const outputSummary =
    terminalEvent.summary && terminalEvent.summary.length > 0
      ? terminalEvent.summary
      : deriveSummaryFromArtifacts(terminalEvent);

  const invocationInput = `Derive route candidate ${input.route.title} with ${input.capability.label}.`;

  return {
    id: input.invocationId,
    jobId: input.jobId,
    capabilityId: input.capability.id,
    roleId: input.roleId,
    capabilityLabel: input.capability.label,
    kind: input.capability.kind,
    status: "completed",
    securityLevel: input.capability.securityLevel,
    safetyGate: {
      status: "allowed",
      reason: `${input.capability.label} approved for real Docker execution via lobster-executor.`,
      requiresApproval: input.capability.requiresApproval,
      approved: input.capability.requiresApproval,
      securityLevel: input.capability.securityLevel,
    },
    requestedAt: input.createdAt,
    completedAt,
    requestedBy: "docker-capability-bridge",
    routeId: input.route.id,
    input: invocationInput,
    outputSummary,
    logs: [...logs],
    evidenceIds: [],
    durationMs,
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.route.id,
      roleId: input.roleId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      executionMode: "real",
      ...(containerId !== undefined ? { containerId } : {}),
      ...(artifactUrl !== undefined ? { artifactUrl } : {}),
      ...(logDigest !== undefined ? { logDigest } : {}),
    },
  };
}

/**
 * 构造 fallback 路径的 `DockerCapabilityBridgeOutput`（design §4.8）。
 *
 * 关键不变式：
 *
 * - `outputSummary` / `logs` / `durationMs` 调用同一批 helper，与今天
 *   `createRouteGenerationSandboxDerivation()` 的产出完全等价。
 * - `requestedBy: "route-generation-sandbox-derivation"` 保留今天的值；
 *   这样既有 E2E 中对 requestedBy 的隐式覆盖（不断言但不抖动）继续成立。
 * - `provenance.executionMode: "simulated_fallback"` + `error: truncate(reason, 400)`
 *   是新增可选字段；既有断言不消费，追加不破坏。
 * - 其它字段与 simulated 路径形态等价（design §4.8 锁定）。
 */
function buildFallbackOutput(
  input: DockerCapabilityBridgeInput,
  options: { reason: string }
): DockerCapabilityBridgeOutput {
  const invocationInput = `Derive route candidate ${input.route.title} with ${input.capability.label}.`;
  const outputSummary = buildCapabilityOutputSummary({
    capability: input.capability,
    routeTitle: input.route.title,
    input: invocationInput,
  });
  const logs = buildCapabilityInvocationLogs(input.capability, outputSummary);
  const durationMs = deterministicCapabilityDuration(input.capability, {
    capabilityId: input.capability.id,
    roleId: input.roleId,
    routeId: input.route.id,
    input: invocationInput,
  });

  const invocation: BlueprintCapabilityInvocation = {
    id: input.invocationId,
    jobId: input.jobId,
    capabilityId: input.capability.id,
    roleId: input.roleId,
    capabilityLabel: input.capability.label,
    kind: input.capability.kind,
    status: "completed",
    securityLevel: input.capability.securityLevel,
    safetyGate: {
      status: "allowed",
      reason: input.capability.requiresApproval
        ? `${input.capability.label} approved for deterministic route generation sandbox derivation.`
        : `${input.capability.label} allowed for deterministic route generation sandbox derivation.`,
      requiresApproval: input.capability.requiresApproval,
      approved: input.capability.requiresApproval,
      securityLevel: input.capability.securityLevel,
    },
    requestedAt: input.createdAt,
    completedAt: input.createdAt,
    requestedBy: "route-generation-sandbox-derivation",
    routeId: input.route.id,
    input: invocationInput,
    outputSummary,
    logs,
    evidenceIds: [],
    durationMs,
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.route.id,
      roleId: input.roleId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      executionMode: "simulated_fallback",
      error: truncate(options.reason, ERROR_TRUNCATE_LIMIT),
    },
  };

  return {
    invocation,
    executorJobId: undefined,
    additionalEvents: [] as BlueprintGenerationEvent[],
  };
}

/**
 * 判断 Docker bridge 是否"已配置"：所有必要依赖都已注入且环境变量允许真实派发。
 *
 * 这几个条件必须同时满足才进入真实 Docker 路径；任一缺失都要走 fallback。
 * 环境变量 `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED` opt-in 语义见
 * design §D2：让"真实 Docker"成为显式选择，保证 dev 默认状态不拖慢响应、
 * 保证既有 E2E 在默认装配下继续走 fallback。
 */
function isBridgeConfigured(
  ctx: BlueprintServiceContext
): ctx is BlueprintServiceContext & {
  executorClient: NonNullable<BlueprintServiceContext["executorClient"]>;
  executorCallbackDispatcher: BlueprintExecutorCallbackDispatcher;
  dockerCapabilityPolicy: DockerCapabilityPolicy;
} {
  if (!ctx.executorClient) return false;
  if (!ctx.executorCallbackDispatcher) return false;
  if (!ctx.dockerCapabilityPolicy) return false;
  if (process.env.BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED !== "true") {
    return false;
  }
  return true;
}

/**
 * 工厂：把 `BlueprintServiceContext` 绑定为一个可重入的纯异步 `DockerCapabilityBridge`。
 *
 * 返回的函数：
 *
 * - 多次调用互不干扰（ctx 字段读取在每次调用内部完成；不缓存 `executorClient`
 *   等可变依赖，保证测试替换 ctx 后下一次调用立即生效）。
 * - 绝不抛异常到调用方：所有错误都被捕获并转换为 fallback output（design §5.1）。
 * - 不修改传入的 `input`（纯函数式对 input 的只读消费）。
 */
export function createDockerCapabilityBridge(
  ctx: BlueprintServiceContext
): DockerCapabilityBridge {
  return async function dockerCapabilityBridge(
    input: DockerCapabilityBridgeInput
  ): Promise<DockerCapabilityBridgeOutput> {
    // Step 1: 早退 —— bridge 未配置或未启用。
    // debug 级别：dev 默认走这条路径，warn 会刷屏。
    if (!isBridgeConfigured(ctx)) {
      ctx.logger.debug(
        "Docker capability bridge: not configured, using fallback",
        {
          capabilityId: input.capability.id,
          jobId: input.jobId,
        }
      );
      return buildFallbackOutput(input, {
        reason: "capability bridge not configured",
      });
    }

    const executorClient = ctx.executorClient;
    const dispatcher = ctx.executorCallbackDispatcher;
    const policy = ctx.dockerCapabilityPolicy;

    // Step 2: Health check（不重试：health 失败重试只会多消耗时间）。
    try {
      await executorClient.assertReachable();
    } catch (error) {
      const reason = `executor unreachable: ${errorMessage(error)}`;
      ctx.logger.warn(
        "Docker capability bridge: executor unreachable, using fallback",
        {
          error: errorMessage(error),
          capabilityId: input.capability.id,
          jobId: input.jobId,
        }
      );
      return buildFallbackOutput(input, { reason });
    }

    // Step 3: Policy 校验（镜像 allow-list / 网络策略）。
    // V1 固定镜像 "lobster-executor:default"，后续若扩展为 per-route 多镜像，
    // 这里的 request.image 需改为从 bridgeInput 中派生。
    const policyCheck = checkDockerCapabilityPolicy(policy, {
      image: DEFAULT_DOCKER_IMAGE,
    });
    if (!policyCheck.allowed) {
      const reason = `policy denied: ${policyCheck.reason ?? "unknown reason"}`;
      ctx.logger.warn(
        "Docker capability bridge: policy rejected, using fallback",
        {
          policyReason: policyCheck.reason,
          capabilityId: input.capability.id,
          jobId: input.jobId,
        }
      );
      return buildFallbackOutput(input, { reason });
    }

    // Step 4: 构造 execution plan。
    const plan = buildDockerCapabilityExecutionPlan({
      bridgeInput: input,
      policy,
    });

    // Step 5: Dispatch + retry 1 次（"rejected" kind 不重试）。
    let dispatchError: Error | undefined;
    let dispatchSucceeded = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await executorClient.dispatchPlan(plan, {
          jobId: input.invocationId,
          requestId: `blueprint-dispatch:${input.invocationId}:${attempt}`,
          idempotencyKey: `blueprint:${input.invocationId}`,
        });
        dispatchError = undefined;
        dispatchSucceeded = true;
        break;
      } catch (error) {
        dispatchError = error instanceof Error ? error : new Error(errorMessage(error));
        // Policy-level 拒绝：重试无意义，直接 fallback。
        if (isNonRetryableDispatchError(error)) {
          break;
        }
      }
    }
    if (!dispatchSucceeded) {
      const reason = `dispatch failed: ${errorMessage(dispatchError)}`;
      ctx.logger.warn(
        "Docker capability bridge: dispatch failed, using fallback",
        {
          error: errorMessage(dispatchError),
          capabilityId: input.capability.id,
          jobId: input.jobId,
        }
      );
      return buildFallbackOutput(input, { reason });
    }

    // Step 6: Register log collector + wait for terminal event.
    //
    // collector 必须在 try/finally 中 dispose，保证任何路径（成功 / 超时 /
    // callback failed / 构造 real invocation 抛错）都能释放内存与关闭 hasher。
    //
    // dispatchedAt 用 `ctx.now()` 读取：保证测试可以用 fake now 控制墙钟。
    const collector = dispatcher.collectLogs(
      input.invocationId,
      policy.maxLogLines,
      policy.maxLogBytes
    );
    const dispatchedAt = ctx.now();

    try {
      let terminalEvent: ExecutorEvent;
      try {
        terminalEvent = await dispatcher.awaitTerminal(
          input.invocationId,
          policy.maxCallbackTimeoutMs
        );
      } catch (error) {
        const message = errorMessage(error);
        // 区分 "callback timeout" 与其它 reject：两类都 best-effort cancel，
        // 但 reason 字面量不同（design §4.6 step 6）。
        const isTimeout = message === "callback timeout";
        const reason = isTimeout
          ? "callback timeout"
          : `callback failed: ${message}`;
        // Best-effort cancel；不阻塞 fallback 返回。
        // `cancelJob` 当前未在 ExecutorClient 声明（见 design §5.4）：
        // 这里用 optional chaining 兼容 "client 没有实现 cancelJob" 的场景，
        // 此时直接降级为"不 cancel"（最多让孤儿容器在 executor 侧跑完被 reap）。
        try {
          const maybeCancel = (
            executorClient as unknown as {
              cancelJob?: (jobId: string) => Promise<unknown> | unknown;
            }
          ).cancelJob;
          if (typeof maybeCancel === "function") {
            await Promise.resolve(
              maybeCancel.call(executorClient, input.invocationId)
            ).catch(() => void 0);
          }
        } catch {
          // 吞掉 cancelJob 查找 / 调用本身的异常，绝不影响 fallback 返回。
        }
        ctx.logger.warn(
          `Docker capability bridge: ${isTimeout ? "callback timeout" : "callback failed"}, using fallback`,
          {
            error: message,
            capabilityId: input.capability.id,
            jobId: input.jobId,
          }
        );
        return buildFallbackOutput(input, { reason });
      }

      // Step 7: 终态判断。
      if (terminalEvent.type === "job.failed") {
        const reason = `executor failure: ${terminalEvent.message || "unknown"}`;
        ctx.logger.warn(
          "Docker capability bridge: job failed, using fallback",
          {
            errorCode: terminalEvent.errorCode,
            message: terminalEvent.message,
            capabilityId: input.capability.id,
            jobId: input.jobId,
          }
        );
        return buildFallbackOutput(input, { reason });
      }

      // job.completed（success）— 构造 real invocation。
      const completedAt = ctx.now();
      const durationMs = Math.max(
        0,
        completedAt.getTime() - dispatchedAt.getTime()
      );
      const collectedLogs = collector.getLogs();
      const logDigest = collector.getDigest();

      const invocation = buildRealInvocation({
        input,
        terminalEvent,
        durationMs,
        logs: collectedLogs,
        logDigest,
        completedAt: completedAt.toISOString(),
      });

      return {
        invocation,
        executorJobId: input.invocationId,
        additionalEvents: [] as BlueprintGenerationEvent[],
      };
    } finally {
      // Step 8: 释放 collector 资源（成功 / 失败路径都走这里）。
      try {
        collector.dispose();
      } catch {
        // 吞掉 dispose 自身的异常；不影响调用方返回值。
      }
    }
  };
}
