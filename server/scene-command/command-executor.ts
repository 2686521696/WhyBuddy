/**
 * 指令执行器 — 编排队列、路由与超时控制
 *
 * 职责：
 * - 接收指令并提交到队列
 * - 为每条指令绑定超时计时器（默认 10 秒）
 * - 超时后自动取消并返回 TIMEOUT 错误
 * - 连接断开时清理该连接的所有待处理指令并返回 NOT_CONNECTED 错误
 * - 指令完成后清除超时计时器
 *
 * 设计原则：
 * - 与传输层解耦，通过回调通知调用方
 * - 不直接操作 WebSocket，只关注指令生命周期
 */
import type {
  SceneCommand,
  SceneCommandResult,
} from "../../shared/scene-command/index.ts";
import {
  createErrorResult,
  SCENE_ERROR_CODES,
} from "../../shared/scene-command/index.ts";
import { CommandQueue } from "./command-queue.ts";
import { CommandRouter } from "./command-router.ts";

// ─── 配置 ───────────────────────────────────────────────────────────

/** 默认指令超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 10_000;

// ─── 待处理指令跟踪 ─────────────────────────────────────────────────

/** 待处理指令的内部跟踪记录 */
interface PendingCommand {
  /** 指令本体 */
  command: SceneCommand;
  /** 所属连接 ID */
  connectionId: string;
  /** 超时计时器句柄 */
  timeoutHandle: ReturnType<typeof setTimeout>;
}

// ─── 结果回调类型 ───────────────────────────────────────────────────

/** 指令结果回调：当指令完成、超时或被取消时调用 */
export type ResultCallback = (
  connectionId: string,
  result: SceneCommandResult,
) => void;

// ─── 指令执行器 ─────────────────────────────────────────────────────

export class CommandExecutor {
  private readonly queue: CommandQueue;
  private readonly router: CommandRouter;
  private readonly timeoutMs: number;

  /** 按 requestId 跟踪待处理指令 */
  private readonly pending = new Map<string, PendingCommand>();

  /** 结果回调 */
  private resultCallback: ResultCallback | null = null;

  constructor(options?: {
    queue?: CommandQueue;
    router?: CommandRouter;
    timeoutMs?: number;
  }) {
    this.queue = options?.queue ?? new CommandQueue();
    this.router = options?.router ?? new CommandRouter();
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─── 公共 API ─────────────────────────────────────────────────

  /** 注册结果回调 */
  onResult(callback: ResultCallback): void {
    this.resultCallback = callback;
  }

  /** 获取路由器实例 */
  getRouter(): CommandRouter {
    return this.router;
  }

  /** 获取队列实例 */
  getQueue(): CommandQueue {
    return this.queue;
  }

  /** 获取当前待处理指令数量 */
  getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * 提交指令执行
   *
   * 1. 将指令加入队列
   * 2. 绑定超时计时器
   * 3. 异步分发到路由器执行
   * 4. 执行完成后清除计时器并通知结果
   *
   * @param command 场景指令
   * @param connectionId 发起连接的 ID
   * @param priority 队列优先级
   */
  submit(
    command: SceneCommand,
    connectionId: string,
    priority?: number,
  ): void {
    // 入队
    const enqueueResult = this.queue.enqueue(command, priority);
    if (!enqueueResult.success) {
      // 队列已满
      const errorResult = createErrorResult(
        command.id,
        SCENE_ERROR_CODES.QUEUE_FULL,
        "Command queue is full",
      );
      this.emitResult(connectionId, errorResult);
      return;
    }

    // 绑定超时计时器
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(command.id);
    }, this.timeoutMs);

    // 跟踪待处理指令
    this.pending.set(command.id, {
      command,
      connectionId,
      timeoutHandle,
    });

    // 从队列取出并异步执行
    const dequeued = this.queue.dequeue();
    if (dequeued) {
      void this.executeCommand(dequeued);
    }
  }

  /**
   * 处理连接断开
   *
   * 找到该连接的所有待处理指令，取消它们并返回 NOT_CONNECTED 错误。
   *
   * @param connectionId 断开的连接 ID
   */
  handleDisconnect(connectionId: string): void {
    const toCancel: PendingCommand[] = [];

    // 收集该连接的所有待处理指令
    for (const [requestId, entry] of this.pending) {
      if (entry.connectionId === connectionId) {
        toCancel.push(entry);
      }
    }

    // 逐一取消
    for (const entry of toCancel) {
      // 清除超时计时器
      clearTimeout(entry.timeoutHandle);

      // 从待处理列表移除
      this.pending.delete(entry.command.id);

      // 尝试从队列中取消（可能已经出队执行中）
      this.queue.cancel(entry.command.id);

      // 返回 NOT_CONNECTED 错误
      const errorResult = createErrorResult(
        entry.command.id,
        SCENE_ERROR_CODES.NOT_CONNECTED,
        "Connection disconnected",
      );
      this.emitResult(connectionId, errorResult);
    }
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  /** 处理指令超时 */
  private handleTimeout(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return; // 已经完成或被取消
    }

    // 从待处理列表移除
    this.pending.delete(requestId);

    // 尝试从队列中取消
    this.queue.cancel(requestId);

    // 返回 TIMEOUT 错误
    const errorResult = createErrorResult(
      requestId,
      SCENE_ERROR_CODES.TIMEOUT,
      "Command execution timed out",
    );
    this.emitResult(entry.connectionId, errorResult);
  }

  /** 异步执行指令并处理结果 */
  private async executeCommand(command: SceneCommand): Promise<void> {
    const result = await this.router.dispatch(command);

    // 检查指令是否仍在待处理列表中（可能已超时或被取消）
    const entry = this.pending.get(command.id);
    if (!entry) {
      return; // 已超时或已取消，不再通知
    }

    // 清除超时计时器
    clearTimeout(entry.timeoutHandle);

    // 从待处理列表移除
    this.pending.delete(command.id);

    // 通知结果
    this.emitResult(entry.connectionId, result);
  }

  /** 发送结果通知 */
  private emitResult(
    connectionId: string,
    result: SceneCommandResult,
  ): void {
    this.resultCallback?.(connectionId, result);
  }
}
