/**
 * Docker Capability Bridge — HMAC Callback Dispatcher（Task 7）
 *
 * 本文件实现 `BlueprintExecutorCallbackDispatcher`：在 Docker capability
 * bridge 进行真实派发后，等待来自 `services/lobster-executor` 的终态回调
 * （`job.completed` / `job.failed`）并可选收集日志流（`job.log_stream` /
 * `job.log`）。接口形状已由 `./types.ts` 锁定；本文件只提供
 * `createBlueprintExecutorCallbackDispatcher(options)` 工厂实现。
 *
 * 运行期链路（与 design §4.5 / §4.6 对齐）：
 *
 * 1. `server/index.ts` 的 `/api/executor/events` 中间件（Task 14）在
 *    HMAC 签名校验通过并让既有 mission interceptor 先消费后，调用
 *    `blueprintCallbackDispatcher.handleEvent(event)` 二次分发；
 * 2. `bridge.ts`（Task 10）在 `executorClient.dispatchPlan()` 返回成功
 *    后调用 `dispatcher.collectLogs(jobId, ...)` 与 `awaitTerminal(jobId, ...)`，
 *    两者调用顺序由 bridge 决定，本实现支持任意先后；
 * 3. 事件到达时 `handleEvent` 按类型分发：log 类事件流入 collector，
 *    终态事件 resolve 挂起的 waiter；
 * 4. bridge 在 `awaitTerminal` resolve/reject 后读出日志、digest 并
 *    调用 `dispose()` 释放内存。
 *
 * 设计约束（硬约束，code review 阶段应直接拒绝违反者）：
 *
 * - 不得 `import` `services/lobster-executor/*` 内部实现；仅使用
 *   `shared/executor/contracts.ts` 的 `ExecutorEvent` 类型。
 * - 不得持有模块级单例：所有状态通过 `createBlueprintExecutorCallbackDispatcher(...)`
 *   的闭包独占，保证多 dispatcher 实例互不干扰（测试友好）。
 * - 不做任何 I/O：事件已由 `installExecutorInterceptor` 独立写入 replay
 *   store，本 dispatcher 只做 transient in-memory 分发。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 *
 * - requirements 2.6 / 3.2 / 3.6 / 4.1：真实 Docker 执行下的终态等待、
 *   脱敏日志收集、超时回退触发源。
 * - design §4.5（接口形状、实现要点、server/index.ts 接线）。
 * - design §4.6（bridge 主算法 step 5-8 消费 dispatcher 的方式）。
 */

import { createHash, type Hash } from "node:crypto";

import type { ExecutorEvent } from "../../../../shared/executor/contracts.js";
import type { BlueprintLogger } from "../context.js";
import type { BlueprintExecutorCallbackDispatcher } from "./types.js";

/**
 * Re-export `BlueprintExecutorCallbackDispatcher` 从 `./types.ts` 的 canonical 定义。
 *
 * 让下游消费者既可以 `import from "./callback-waiter.js"`（与工厂同源），
 * 也可以 `import from "./types.js"`（与 bridge 其它类型同源），两路最终指向
 * 同一类型，避免出现第二份竞争定义。
 */
export type { BlueprintExecutorCallbackDispatcher } from "./types.js";

/**
 * `createBlueprintExecutorCallbackDispatcher(options)` 的可选装配参数。
 *
 * 字段语义与 `BlueprintServiceContext` 对齐（design §4.5）：
 *
 * - `now` 注入可替换的时间源；当前工厂未直接使用，但保留参数位以便
 *   未来补心跳 / 空转清理时不破坏构造签名（design §2 D1 的 DI 口径）。
 * - `logger` 注入可选观测通道；当前工厂内部只在 "collector 被丢弃
 *   但 digest 从未被读出" 这类调试路径发 debug，不影响行为。
 */
export interface CreateBlueprintExecutorCallbackDispatcherOptions {
  readonly now?: () => Date;
  readonly logger?: BlueprintLogger;
}

/**
 * Pending terminal waiter 状态。
 *
 * 一个 jobId 同时只允许存在一个挂起 waiter；重复注册会在 `awaitTerminal`
 * 中被直接 reject（"callback waiter already registered"），避免两份逻辑
 * 互相覆盖导致 timer 泄漏或 resolve 串流。
 */
interface WaiterState {
  readonly resolve: (event: ExecutorEvent) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Log collector 状态。
 *
 * 关键不变式：
 *
 * - `hasher` 对"脱敏后、未截断"的完整字节链计算 SHA-256 digest；
 *   即使 `lines` 因 maxLines / maxBytes 被丢弃，digest 仍覆盖完整流。
 *   这样下游消费者可以用 digest 对比是否与 executor 侧原始日志一致，
 *   而不会被 in-memory 截断误导。
 * - `lines` 与 `totalBytes` 只在未触达上限时追加；一旦任一上限触达，
 *   后续行仅进入 hasher，不进入展示列表。
 * - `finalDigest` 在首次 `getDigest()` 调用时懒计算并缓存；`Hash.digest()`
 *   一次性 API，调用后 hasher 不能继续 update，因此 once computed we
 *   freeze the state — later log events are ignored（理论上 dispose
 *   之前 handleEvent 不应继续派发到该 collector，但防御性关掉 hasher
 *   仍然更稳）。
 */
interface LogCollectorState {
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly lines: string[];
  totalBytes: number;
  readonly hasher: Hash;
  // `closed` 表示不再接受新日志（dispose 或 digest 已经计算后置位）。
  closed: boolean;
  finalDigest?: string;
}

/**
 * 单个 jobId 的聚合状态。
 *
 * `waiter` 与 `logCollector` 互相独立：`collectLogs` 与 `awaitTerminal`
 * 可按任意顺序调用；`handleEvent` 按字段分别分发。当 waiter 与 collector
 * 都不存在时，整个 entry 会被从 `jobs` 中删除以避免累积泄漏。
 */
interface JobEntry {
  waiter?: WaiterState;
  logCollector?: LogCollectorState;
}

/**
 * 判断事件是否属于"终态"（成功或失败）。
 *
 * 注意：`job.cancelled` 虽然也是终态，但在当前 bridge 算法里 cancel 走
 * best-effort 通道，不期望通过这里 resolve waiter（超时时 bridge 先 reject、
 * 再 best-effort cancel，不再读 waiter）。因此本实现只把 `job.completed`
 * 与 `job.failed` 视为 terminal；若将来需要处理 cancelled，可在此扩展。
 */
function isTerminalEventType(type: ExecutorEvent["type"]): boolean {
  return type === "job.completed" || type === "job.failed";
}

/**
 * 从事件中提取一行日志字符串。
 *
 * `job.log_stream` 事件（来自 docker-runner.ts 的 `emitLiveLogStream`）
 * 把脱敏后的一段 stdout/stderr 放在 `event.data` 字段；`job.log` 事件把
 * 结构化日志放在 `event.log.message` 字段。两类字段都是脱敏后的字符串，
 * 可直接参与 digest 累积与 lines 追加。
 *
 * 如果事件既没有 `data` 也没有 `log.message`，返回 `undefined`，由调用方
 * 忽略（不视为异常，符合 `credential-redactor` 可能把整行抹空的情况）。
 */
function extractLogChunk(event: ExecutorEvent): string | undefined {
  if (event.type === "job.log_stream") {
    if (typeof event.data === "string" && event.data.length > 0) {
      return event.data;
    }
    return undefined;
  }
  if (event.type === "job.log") {
    const message = event.log?.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    return undefined;
  }
  return undefined;
}

/**
 * 生成符合接口形状的 dispatcher 实例。
 *
 * 每个实例都有独立的 `Map<string, JobEntry>` 闭包状态；多次调用本工厂
 * 会得到互不干扰的 dispatcher（测试中可按 scenario 独立装配）。
 *
 * 默认 `logger` 是静默 no-op（见下方 `silentLogger`）；默认 `now` 是
 * `() => new Date()`，仅保留参数位用于未来扩展。
 *
 * 实现不变式：
 *
 * - `jobs` 中存在 entry ⇒ 该 jobId 至少有 waiter 或 logCollector 其一；
 * - waiter resolve/reject 或 collector dispose 时必须及时清理 entry，
 *   不允许空 entry 累积（避免大规模派发下 Map 无界增长）。
 */
export function createBlueprintExecutorCallbackDispatcher(
  options: CreateBlueprintExecutorCallbackDispatcherOptions = {},
): BlueprintExecutorCallbackDispatcher {
  const logger = options.logger ?? silentLogger;
  const jobs = new Map<string, JobEntry>();

  /**
   * 读取或新建一个 `JobEntry`（用于注册 waiter / collector 时）。
   */
  function ensureEntry(jobId: string): JobEntry {
    let entry = jobs.get(jobId);
    if (!entry) {
      entry = {};
      jobs.set(jobId, entry);
    }
    return entry;
  }

  /**
   * 清理一个 entry 中当前已经不需要的部分，并在 entry 完全空时删除。
   */
  function pruneEntry(jobId: string, entry: JobEntry): void {
    if (!entry.waiter && !entry.logCollector) {
      jobs.delete(jobId);
    }
  }

  /**
   * 终结 log collector（在终态事件或 dispose 时调用）。
   *
   * 计算并缓存 `finalDigest`，并把 collector 标记为 closed；之后到达的
   * 日志事件将被 handleEvent 忽略（防御性处理：理论上终态之后 executor
   * 不应再发 log 事件，但 race condition 下仍可能出现）。
   */
  function finalizeLogCollector(collector: LogCollectorState): void {
    if (collector.closed) {
      return;
    }
    collector.finalDigest = collector.hasher.digest("hex");
    collector.closed = true;
  }

  /**
   * 分发事件到对应 waiter / collector。
   *
   * 事件分发优先级：
   *
   * 1. 如果是 log 类事件且 collector 存在且未 closed → 追加日志 + 更新 digest。
   * 2. 如果是终态事件且 waiter 存在 → resolve waiter、清理 timer、
   *    finalize collector（让 `getDigest()` 在 bridge 侧立刻可读）。
   *
   * 其它事件（`job.started` / `job.progress` / `job.waiting` / `job.heartbeat` /
   * `job.screenshot` / `job.accepted` / `job.cancelled`）当前不消费，仅 no-op。
   */
  function handleEvent(event: ExecutorEvent): void {
    if (typeof event.jobId !== "string" || event.jobId.length === 0) {
      return;
    }
    const entry = jobs.get(event.jobId);
    if (!entry) {
      return;
    }

    // Log fan-out: always accumulate into hasher/lines even if no waiter is
    // currently registered — bridge may have called collectLogs() before
    // awaitTerminal().
    if (event.type === "job.log_stream" || event.type === "job.log") {
      const collector = entry.logCollector;
      if (collector && !collector.closed) {
        const chunk = extractLogChunk(event);
        if (chunk !== undefined) {
          // Always update digest over the complete scrubbed stream (design §4.5).
          collector.hasher.update(chunk);
          const chunkBytes = Buffer.byteLength(chunk, "utf8");
          // Only append to `lines` if we are below both caps (lines AND bytes).
          // Once either cap is reached, we drop subsequent lines but keep
          // digest coverage intact.
          if (
            collector.lines.length < collector.maxLines &&
            collector.totalBytes + chunkBytes <= collector.maxBytes
          ) {
            collector.lines.push(chunk);
            collector.totalBytes += chunkBytes;
          }
        }
      }
      return;
    }

    // Terminal fan-out: resolve waiter, clear timer, finalize collector so
    // that `getDigest()` can be read immediately afterwards by the bridge.
    if (isTerminalEventType(event.type)) {
      const waiter = entry.waiter;
      if (waiter) {
        clearTimeout(waiter.timer);
        entry.waiter = undefined;
        // Finalize collector digest so `getDigest()` is ready for the bridge
        // in `buildRealInvocation`. `dispose()` later will still release the
        // stored lines array.
        if (entry.logCollector) {
          finalizeLogCollector(entry.logCollector);
        }
        waiter.resolve(event);
        pruneEntry(event.jobId, entry);
      }
      return;
    }

    // Other event types (job.started / job.progress / job.waiting / ...)
    // are intentionally ignored at this layer (already handled by
    // installExecutorInterceptor upstream).
  }

  /**
   * 注册终态 waiter。
   *
   * 成功路径：
   *
   * 1. 在 `jobs` 中创建或复用 entry；
   * 2. 启动 timeout 定时器，超时时 reject `Error("callback timeout")`；
   * 3. 把 waiter 挂到 entry 上；
   * 4. 返回 Promise。
   *
   * 重复注册保护：同一 jobId 在同一时刻只允许有一个挂起 waiter。
   * 若上一次 `awaitTerminal` 还未 resolve/reject，本次立即 reject。
   * 这是防御性设计，实践中 bridge 对每次 invocation 只会调一次。
   */
  function awaitTerminal(
    jobId: string,
    timeoutMs: number,
  ): Promise<ExecutorEvent> {
    return new Promise<ExecutorEvent>((resolve, reject) => {
      const entry = ensureEntry(jobId);
      if (entry.waiter) {
        reject(
          new Error(
            `callback waiter already registered for jobId ${jobId}`,
          ),
        );
        pruneEntry(jobId, entry);
        return;
      }

      const timer = setTimeout(() => {
        // Timer fires → remove waiter and reject. Do NOT finalize the
        // collector here: on timeout the bridge calls dispose() explicitly,
        // and the collector state is irrelevant to fallback construction.
        const latest = jobs.get(jobId);
        if (latest && latest.waiter === currentWaiter) {
          latest.waiter = undefined;
          pruneEntry(jobId, latest);
        }
        reject(new Error("callback timeout"));
      }, timeoutMs);

      // Allow the node event loop to exit even while a waiter is parked.
      // Without unref(), a leaked waiter would keep the process alive.
      if (typeof timer.unref === "function") {
        timer.unref();
      }

      const currentWaiter: WaiterState = {
        resolve: (event) => {
          // Defensive: ensure we never resolve twice even if handleEvent
          // races with the setTimeout callback (resolve wins once).
          resolve(event);
        },
        reject: (error) => {
          reject(error);
        },
        timer,
      };
      entry.waiter = currentWaiter;
    });
  }

  /**
   * 注册 log collector。
   *
   * 行为：
   *
   * - 在 `jobs` 中创建或复用 entry；
   * - 新建 `LogCollectorState`（hasher、lines、totalBytes 初始化）；
   * - 挂到 entry 上；
   * - 返回 `{ getLogs, getDigest, dispose }` 三件套。
   *
   * 幂等性：对同一 jobId 多次调用 `collectLogs` 会覆盖之前的 collector
   * （上一次的 lines 被丢弃、hasher 状态被重置）。实践中 bridge 每次
   * invocation 只会调一次，因此覆盖不会发生；但保留覆盖语义简化测试装配。
   *
   * `getDigest()` 行为：
   *
   * - 在 `handleEvent` 触发终态之前调用：返回 `undefined`（digest 尚未冻结）。
   * - 在终态事件到达之后调用：返回 hex 编码的 SHA-256 digest。
   * - 在 `dispose()` 被调用后：继续返回之前冻结的 digest（如果已有），
   *   或 `undefined`（如果从未收到终态且未自行 finalize）。
   *
   * 注意：为支持"bridge 在超时 / failed 时不通过终态事件触达 finalize
   * 也能读到非空 digest"场景，`getDigest()` 允许在未 closed 时懒 finalize
   * 一次；之后 collector 标记为 closed 不再接受日志。
   */
  function collectLogs(
    jobId: string,
    maxLines: number,
    maxBytes: number,
  ): {
    getLogs: () => string[];
    getDigest: () => string | undefined;
    dispose: () => void;
  } {
    const entry = ensureEntry(jobId);
    const collector: LogCollectorState = {
      maxLines,
      maxBytes,
      lines: [],
      totalBytes: 0,
      hasher: createHash("sha256"),
      closed: false,
    };
    entry.logCollector = collector;

    return {
      getLogs: () => {
        // Return a snapshot so that callers mutating the returned array
        // cannot corrupt internal state (bridge copies into invocation.logs
        // which later flows into provenance / evidence — must be immutable
        // from the dispatcher's perspective).
        return collector.lines.slice();
      },
      getDigest: () => {
        if (collector.finalDigest !== undefined) {
          return collector.finalDigest;
        }
        // Lazy finalize on first read if caller explicitly wants a digest
        // before a terminal event (e.g. bridge on timeout path). This
        // guarantees the digest reflects exactly the bytes observed so far.
        if (!collector.closed) {
          finalizeLogCollector(collector);
          return collector.finalDigest;
        }
        return undefined;
      },
      dispose: () => {
        // Mark closed and drop the entry reference; hasher state is kept
        // intact only if a digest has been finalized — this keeps
        // `getDigest()` callable after dispose for late readers.
        collector.closed = true;
        const latest = jobs.get(jobId);
        if (latest && latest.logCollector === collector) {
          latest.logCollector = undefined;
          pruneEntry(jobId, latest);
        }
        // Drop lines to release memory immediately; getLogs() after dispose
        // returns an empty snapshot (safe default).
        collector.lines.length = 0;
        logger.debug("Docker capability bridge: log collector disposed", {
          jobId,
        });
      },
    };
  }

  return {
    awaitTerminal,
    handleEvent,
    collectLogs,
  };
}

/**
 * 缺省 logger：全部方法 no-op。
 *
 * 与 `createSilentBlueprintLogger()`（`../context.ts`）行为等价，但本
 * 模块不依赖 context.ts 运行期工厂以避免循环导入：context.ts 已经
 * 依赖本文件的 `BlueprintExecutorCallbackDispatcher` 类型（通过
 * `./types.ts` 间接引用），若再反向依赖 `createSilentBlueprintLogger()`
 * 则会产生类型/实现循环。
 */
const silentLogger: BlueprintLogger = {
  debug: () => void 0,
  info: () => void 0,
  warn: () => void 0,
  error: () => void 0,
};
