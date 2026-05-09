/**
 * Docker Capability Bridge — 类型占位骨架（Task 2 基线）
 *
 * 本文件只定义类型与接口（type-only），不包含任何运行时代码、日志副作用、
 * 模块级单例或 I/O 操作，目的是让 `BlueprintServiceContext` 能在 Task 2 阶段
 * 引用这些可选依赖字段的类型名，同时保证 `node --run check` 类型检查通过。
 *
 * 设计约束：
 * - 本文件属于 `server/routes/blueprint/docker-analysis-sandbox/` 子域，
 *   仅存放类型骨架；policy.ts、callback-waiter.ts、bridge.ts 将在后续任务
 *   （Task 3 / 7 / 10）引入具体实现，届时会从本文件导入同名类型继续沿用，
 *   或在子域内再细化（例如通过 `readonly` 收紧字段、补缺省实现工厂等）。
 * - 不允许在本文件 `import` `services/lobster-executor/*` 内部模块；
 *   只允许依赖 `shared/executor/contracts.ts` 这类现有的公开类型入口。
 * - 不允许在本文件产生 runtime 导出（没有函数实现、没有常量、没有 class）。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/design.md`：
 * - §4.3 `DockerCapabilityPolicy` 字段定义
 * - §4.5 `BlueprintExecutorCallbackDispatcher` 方法签名
 * - §4.2 `DockerCapabilityBridge` / `DockerCapabilityBridgeInput` /
 *   `DockerCapabilityBridgeOutput` 形状
 */

import type { ExecutorEvent } from "../../../../shared/executor/contracts.js";
import type {
  BlueprintCapabilityInvocation,
  BlueprintGenerationEvent,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";

/**
 * Docker capability 的安全与资源策略。
 *
 * 字段集合严格对应 design §4.3 的默认策略表；本阶段只定义形状，
 * `createDefaultDockerCapabilityPolicy()` 与 `checkDockerCapabilityPolicy()`
 * 的具体实现将在 Task 3 落地。
 */
export interface DockerCapabilityPolicy {
  /** 允许派发的容器镜像 allow-list（精确匹配） */
  readonly allowedImages: readonly string[];
  /** 内存上限（Docker format，例如 "512m" / "1g"） */
  readonly memoryLimit: string;
  /** CPU 上限（nanoCpus 小数形式，例如 "1.0" = 1 核） */
  readonly cpuLimit: string;
  /** 最大并发进程数 */
  readonly pidsLimit: number;
  /** 网络策略：none = 完全隔离；bridge = 默认桥接；whitelist = 白名单域名 */
  readonly networkPolicy: "none" | "bridge" | "whitelist";
  /** 当 networkPolicy === "whitelist" 时允许访问的域名/IP 列表 */
  readonly networkAllowlist?: readonly string[];
  /** 安全级别（透传 executor 侧 security-policy.ts 的 SecurityLevel） */
  readonly securityLevel: "strict" | "balanced" | "permissive";
  /** 单次调用 HMAC 回调等待上限（毫秒） */
  readonly maxCallbackTimeoutMs: number;
  /** 单次 POST /api/executor/jobs 派发上限（毫秒） */
  readonly maxDispatchTimeoutMs: number;
  /** invocation.logs 最大行数 */
  readonly maxLogLines: number;
  /** invocation.logs 累计字节上限 */
  readonly maxLogBytes: number;
}

/**
 * HMAC 执行器回调分发器。
 *
 * 运行期行为：由 `server/index.ts` 的中间件捕获 `/api/executor/events`
 * 回调体后，调用 `handleEvent(event)` 分发给在 `awaitTerminal(jobId, ...)`
 * 里挂起的等待者；同时 `collectLogs(jobId, ...)` 可选订阅一段时间窗内的
 * `job.log` / `job.log_stream` 事件。
 *
 * 本阶段只声明接口形状，具体实现在 Task 7 的 `callback-waiter.ts` 落地。
 */
export interface BlueprintExecutorCallbackDispatcher {
  /**
   * 订阅某个 `jobId` 的终态事件（`job.completed` 或 `job.failed`）。
   * 成功匹配 → resolve event；超时 → reject `Error("callback timeout")`。
   */
  awaitTerminal(jobId: string, timeoutMs: number): Promise<ExecutorEvent>;

  /**
   * `server/index.ts` 的 executor events 中间件调用：把收到的事件分发给
   * 等待者与日志收集器。非终态事件（`job.progress` 等）当前不消费。
   */
  handleEvent(event: ExecutorEvent): void;

  /**
   * 注册 per-job 的日志收集器；bridge 在 `awaitTerminal` 期间顺带收集
   * `job.log_stream` / `job.log` 事件，返回三件套用于在终态后读出结果
   * 并释放内存。超过 `maxLines` / `maxBytes` 时后续行被丢弃，但 digest
   * 仍基于完整脱敏字节计算。
   */
  collectLogs(
    jobId: string,
    maxLines: number,
    maxBytes: number
  ): {
    getLogs: () => string[];
    getDigest: () => string | undefined;
    dispose: () => void;
  };
}

/**
 * Bridge 单次调用输入。由 `createRouteGenerationSandboxDerivation()` 在
 * 命中 `capability.id === "docker-analysis-sandbox"` 分支时构造传入。
 *
 * 详见 design §4.2。
 */
export interface DockerCapabilityBridgeInput {
  /** 从 `getDefaultRuntimeCapabilities()` 查出的 docker capability 定义对象 */
  readonly capability: BlueprintRuntimeCapability;
  /** 本次 invocation 要绑定的 route */
  readonly route: BlueprintRouteCandidate;
  /** Blueprint generation job id（顶层） */
  readonly jobId: string;
  /** 原始请求；bridge 从中派生 targetText / githubUrls / projectId */
  readonly request: BlueprintGenerationRequest;
  /** 当前 RouteSet；bridge 从中派生 routeSetId */
  readonly routeSet: BlueprintRouteSet;
  /** 调用方已确定的时间戳（与外层 evidence / event / sandbox job 对齐） */
  readonly createdAt: string;
  /**
   * 调用方预生成的 invocation id；bridge 在 real 与 fallback 路径下都使用
   * 这个 id，保证外层 evidence aggregation / sandbox job `invocationIds`
   * 聚合 / capability events 的 `invocationId` 引用稳定。
   */
  readonly invocationId: string;
  /** 调用方已解析的 roleId（当前固定为运行时执行者角色，保留参数化空间） */
  readonly roleId: string;
}

/**
 * Bridge 单次调用输出。外层 `createRouteGenerationSandboxDerivation()` 把
 * `invocation` 回填到 invocations 数组；`executorJobId` 用于 real 路径的
 * 事件 payload 可选字段；`additionalEvents` 预留给未来 heartbeat 场景。
 *
 * 详见 design §4.2。
 */
export interface DockerCapabilityBridgeOutput {
  /** 一条可用的 invocation；外层 map 直接回填到 invocations 数组 */
  readonly invocation: BlueprintCapabilityInvocation;
  /** 本次执行所绑定的真实执行器 jobId（real 路径填充；fallback 路径 undefined） */
  readonly executorJobId?: string;
  /** 可选：bridge 希望额外 emit 的事件（当前为空；预留未来 heartbeat） */
  readonly additionalEvents: readonly BlueprintGenerationEvent[];
}

/**
 * Bridge 类型别名：一个纯异步函数。
 *
 * 工厂 `createDockerCapabilityBridge(ctx)` 在 Task 10 落地；届时会从本文件
 * 导入同名类型继续沿用。
 */
export type DockerCapabilityBridge = (
  input: DockerCapabilityBridgeInput
) => Promise<DockerCapabilityBridgeOutput>;
