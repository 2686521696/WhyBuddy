/**
 * UE 侧指令执行桥 — TypeScript 模拟实现
 *
 * 模拟 UE5 蓝图侧的 WebSocket 客户端行为：
 * - 连接到 SceneCommandServer（通过 CommandRouter 注册处理器）
 * - 将 SceneCommandMethod 映射到处理函数（模拟蓝图函数调用）
 * - 执行指令并返回带执行时长的 SceneCommandResult
 *
 * 在生产环境中，真正的 UE5 侧会：
 * - 通过原始 WebSocket 连接
 * - 解析 JSON-RPC 消息
 * - 调用蓝图函数
 * - 发送 JSON-RPC 响应
 *
 * 本 TypeScript 桥提供处理器接口与默认模拟实现，用于测试与参考。
 */
import type {
  SceneCommand,
  SceneCommandMethod,
  SceneCommandResult,
} from "../../shared/scene-command/index.ts";
import {
  SCENE_COMMAND_METHODS,
  createSuccessResult,
  createErrorResult,
  SCENE_ERROR_CODES,
} from "../../shared/scene-command/index.ts";
import { CommandRouter } from "./command-router.ts";

// ─── 处理器类型 ─────────────────────────────────────────────────────

/**
 * UE 侧指令处理函数签名
 *
 * 接收已解析的指令，返回执行结果。
 * 支持异步处理器（模拟 UE 执行耗时）。
 */
export type UECommandHandler = (
  command: SceneCommand,
) => SceneCommandResult | Promise<SceneCommandResult>;

/**
 * 方法名到处理函数的映射类型
 */
export type UECommandHandlerMap = Partial<
  Record<SceneCommandMethod | string, UECommandHandler>
>;

// ─── 连接状态 ───────────────────────────────────────────────────────

export type UEBridgeConnectionState = "disconnected" | "connected";

// ─── 默认 Echo 处理器 ──────────────────────────────────────────────

/**
 * 创建默认 echo 处理器 — 模拟 UE 执行
 *
 * 返回成功结果，附带模拟执行时长。
 * @param delayMs 模拟执行延迟（毫秒），默认 50ms
 */
export function createEchoHandler(delayMs = 50): UECommandHandler {
  return async (command: SceneCommand): Promise<SceneCommandResult> => {
    const start = Date.now();
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const duration = Date.now() - start;
    return createSuccessResult(command.id, { success: true, duration });
  };
}

/**
 * 为所有已知方法创建默认 echo 处理器映射
 */
export function createDefaultHandlerMap(
  delayMs = 50,
): UECommandHandlerMap {
  const map: UECommandHandlerMap = {};
  for (const method of SCENE_COMMAND_METHODS) {
    map[method] = createEchoHandler(delayMs);
  }
  return map;
}

// ─── UE 执行桥 ─────────────────────────────────────────────────────

export class UEBridge {
  private state: UEBridgeConnectionState = "disconnected";
  private router: CommandRouter | null = null;
  private readonly handlers: Map<string, UECommandHandler> = new Map();

  /**
   * @param handlerMap 可选的初始处理器映射；未提供时使用默认 echo 处理器
   */
  constructor(handlerMap?: UECommandHandlerMap) {
    const map = handlerMap ?? createDefaultHandlerMap();
    for (const [method, handler] of Object.entries(map)) {
      if (handler) {
        this.handlers.set(method, handler);
      }
    }
  }

  // ─── 连接管理 ─────────────────────────────────────────────────

  /** 获取当前连接状态 */
  getConnectionState(): UEBridgeConnectionState {
    return this.state;
  }

  /**
   * 连接到 CommandRouter，注册所有处理器
   *
   * 将桥中的每个处理器包装后注册到路由器，
   * 包装层负责：
   * 1. 检查连接状态
   * 2. 执行处理器
   * 3. 报告执行时长
   */
  connect(router: CommandRouter): void {
    if (this.state === "connected") {
      return; // 已连接，幂等操作
    }

    this.router = router;
    this.state = "connected";

    // 将所有处理器注册到路由器
    for (const [method] of this.handlers) {
      router.register(method, (command) => this.executeCommand(command));
    }
  }

  /**
   * 断开连接，注销所有处理器
   */
  disconnect(): void {
    if (this.state === "disconnected") {
      return; // 已断开，幂等操作
    }

    // 从路由器注销所有处理器
    if (this.router) {
      for (const [method] of this.handlers) {
        this.router.unregister(method);
      }
      this.router = null;
    }

    this.state = "disconnected";
  }

  // ─── 处理器管理 ───────────────────────────────────────────────

  /**
   * 注册或替换指令处理器
   *
   * 如果桥已连接，同时更新路由器注册。
   */
  registerHandler(method: string, handler: UECommandHandler): void {
    this.handlers.set(method, handler);

    // 如果已连接，同步注册到路由器
    if (this.state === "connected" && this.router) {
      this.router.register(method, (command) =>
        this.executeCommand(command),
      );
    }
  }

  /**
   * 注销指令处理器
   *
   * 如果桥已连接，同时从路由器注销。
   */
  unregisterHandler(method: string): boolean {
    const existed = this.handlers.delete(method);

    if (this.state === "connected" && this.router) {
      this.router.unregister(method);
    }

    return existed;
  }

  /** 检查是否有指定方法的处理器 */
  hasHandler(method: string): boolean {
    return this.handlers.has(method);
  }

  /** 获取所有已注册的方法名 */
  getRegisteredMethods(): string[] {
    return Array.from(this.handlers.keys());
  }

  // ─── 内部执行 ─────────────────────────────────────────────────

  /**
   * 执行指令 — 桥的核心逻辑
   *
   * 1. 检查连接状态
   * 2. 查找处理器
   * 3. 执行并计时
   * 4. 返回带时长的结果
   */
  private async executeCommand(
    command: SceneCommand,
  ): Promise<SceneCommandResult> {
    // 检查连接状态
    if (this.state !== "connected") {
      return createErrorResult(
        command.id,
        SCENE_ERROR_CODES.NOT_CONNECTED,
        "UE bridge is not connected",
      );
    }

    // 查找处理器
    const handler = this.handlers.get(command.method);
    if (!handler) {
      return createErrorResult(
        command.id,
        SCENE_ERROR_CODES.METHOD_NOT_FOUND,
        `No UE handler for method: ${command.method}`,
      );
    }

    // 执行并计时
    const startTime = performance.now();
    try {
      const result = await handler(command);

      // 如果处理器返回的成功结果没有 duration，补充执行时长
      if (result.result && result.result.duration === undefined) {
        const duration = Math.round(performance.now() - startTime);
        return createSuccessResult(command.id, {
          ...result.result,
          duration,
        });
      }

      return result;
    } catch (err) {
      const duration = Math.round(performance.now() - startTime);
      const message =
        err instanceof Error ? err.message : "Unknown UE execution error";
      return createErrorResult(
        command.id,
        SCENE_ERROR_CODES.EXECUTION_FAILED,
        `UE execution failed (${duration}ms): ${message}`,
      );
    }
  }
}
