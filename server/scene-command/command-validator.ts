/**
 * 指令校验中间件 — 基于 Zod Schema 的两层校验
 *
 * 第一层：JSON-RPC 2.0 基础格式校验（jsonrpc、method、params、id）
 * 第二层：方法特定参数校验（character.moveTo 的 x/y/z 等）
 *
 * 校验失败时返回标准 JSON-RPC 错误响应，校验通过时透传给路由器。
 */
import {
  type SceneCommand,
  type SceneCommandResult,
  validateCommand,
  validateParams,
  createErrorResult,
  SCENE_ERROR_CODES,
} from "../../shared/scene-command/index.ts";

/** 校验成功结果 */
export interface ValidationSuccess {
  success: true;
  command: SceneCommand;
}

/** 校验失败结果 */
export interface ValidationFailure {
  success: false;
  error: SceneCommandResult;
}

/** 校验结果联合类型 */
export type ValidationResult = ValidationSuccess | ValidationFailure;

export class CommandValidator {
  /**
   * 对原始数据执行两层校验：
   * 1. JSON-RPC 2.0 基础格式
   * 2. 方法特定参数
   */
  validate(data: unknown): ValidationResult {
    // 第一层：基础格式校验
    const baseResult = validateCommand(data);
    if (!baseResult.success) {
      const issues = baseResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return {
        success: false,
        error: createErrorResult(
          this.extractId(data),
          SCENE_ERROR_CODES.INVALID_REQUEST,
          `Invalid request: ${issues}`,
        ),
      };
    }

    const command = baseResult.data as SceneCommand;

    // 第二层：方法特定参数校验
    const paramsResult = validateParams(command.method, command.params);
    if (!paramsResult.success) {
      return {
        success: false,
        error: createErrorResult(
          command.id,
          SCENE_ERROR_CODES.INVALID_PARAMS,
          `Invalid params: ${paramsResult.error}`,
        ),
      };
    }

    return { success: true, command };
  }

  /** 尝试从原始数据中提取 id 字段，用于错误响应 */
  private extractId(data: unknown): string {
    if (
      data !== null &&
      typeof data === "object" &&
      "id" in data &&
      typeof (data as Record<string, unknown>).id === "string"
    ) {
      return (data as Record<string, unknown>).id as string;
    }
    return "";
  }
}
