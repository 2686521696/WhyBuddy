/**
 * 指令方法路由器 — 将已校验的指令分发到对应处理器
 *
 * 维护方法名到处理函数的注册表，支持内置方法与自定义扩展方法。
 * 未注册的内置方法返回 METHOD_NOT_FOUND 错误；
 * 未注册的自定义扩展方法同样返回 METHOD_NOT_FOUND 错误。
 */
import {
  type SceneCommand,
  type SceneCommandResult,
  type SceneCommandSuccessResult,
  isKnownMethod,
  createSuccessResult,
  createErrorResult,
  SCENE_ERROR_CODES,
} from "../../shared/scene-command/index.ts";

/** 指令处理函数签名 */
export type CommandHandler = (
  command: SceneCommand,
) => SceneCommandResult | Promise<SceneCommandResult>;

export class CommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  /**
   * 注册方法处理器
   * @param method 方法名（如 "character.moveTo" 或自定义 "custom.doSomething"）
   * @param handler 处理函数
   */
  register(method: string, handler: CommandHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * 注销方法处理器
   * @param method 方法名
   * @returns 是否成功注销
   */
  unregister(method: string): boolean {
    return this.handlers.delete(method);
  }

  /**
   * 检查方法是否已注册处理器
   */
  hasHandler(method: string): boolean {
    return this.handlers.has(method);
  }

  /**
   * 获取所有已注册的方法名
   */
  getRegisteredMethods(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 将已校验的指令分发到对应处理器
   *
   * 查找顺序：
   * 1. 精确匹配已注册的处理器
   * 2. 未找到 → 返回 METHOD_NOT_FOUND
   */
  async dispatch(command: SceneCommand): Promise<SceneCommandResult> {
    const handler = this.handlers.get(command.method);

    if (handler) {
      try {
        return await handler(command);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown execution error";
        return createErrorResult(
          command.id,
          SCENE_ERROR_CODES.EXECUTION_FAILED,
          message,
        );
      }
    }

    // 未注册的方法 → METHOD_NOT_FOUND
    return createErrorResult(
      command.id,
      SCENE_ERROR_CODES.METHOD_NOT_FOUND,
      `Method not found: ${command.method}`,
    );
  }
}
