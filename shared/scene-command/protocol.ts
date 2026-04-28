/**
 * 场景指令协议 — JSON-RPC 2.0 over WebSocket
 *
 * 定义 LLM 导演与 UE5 渲染引擎之间的结构化指令格式、
 * 参数校验规则、错误码与验证函数。
 */
import { z } from "zod";

// ─── JSON-RPC 2.0 基础消息格式 ─────────────────────────────────────

/** 支持的指令方法 */
export type SceneCommandMethod =
  | "character.moveTo"
  | "character.playAnimation"
  | "camera.setPreset"
  | "camera.transition"
  | "scene.setState"
  | "effect.play"
  | "effect.stop";

/** 所有已知方法列表，用于运行时校验 */
export const SCENE_COMMAND_METHODS: readonly SceneCommandMethod[] = [
  "character.moveTo",
  "character.playAnimation",
  "camera.setPreset",
  "camera.transition",
  "scene.setState",
  "effect.play",
  "effect.stop",
] as const;

/** JSON-RPC 2.0 请求 */
export interface SceneCommand {
  jsonrpc: "2.0";
  method: SceneCommandMethod | string; // string 允许自定义扩展指令
  params: Record<string, unknown>;
  id: string;
}

/** JSON-RPC 2.0 成功结果 */
export interface SceneCommandSuccessResult {
  success: boolean;
  duration?: number;
}

/** JSON-RPC 2.0 响应 */
export interface SceneCommandResult {
  jsonrpc: "2.0";
  result?: SceneCommandSuccessResult;
  error?: SceneCommandError;
  id: string;
}

/** JSON-RPC 2.0 通知（无 id，不期望响应） */
export interface SceneCommandNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

/** 批量请求类型 */
export type SceneCommandBatch = SceneCommand[];

// ─── 错误码枚举 ────────────────────────────────────────────────────

/** 标准错误码 */
export const SCENE_ERROR_CODES = {
  /** 请求格式不合法 */
  INVALID_REQUEST: -32600,
  /** 指令类型不存在 */
  METHOD_NOT_FOUND: -32601,
  /** 参数校验失败 */
  INVALID_PARAMS: -32602,
  /** UE 侧执行失败 */
  EXECUTION_FAILED: -32000,
  /** 指令执行超时 */
  TIMEOUT: -32001,
  /** 队列已满 */
  QUEUE_FULL: -32002,
  /** UE 连接不可用 */
  NOT_CONNECTED: -32003,
} as const;

export type SceneErrorCode =
  (typeof SCENE_ERROR_CODES)[keyof typeof SCENE_ERROR_CODES];

/** 错误码到名称的映射 */
export const SCENE_ERROR_NAMES: Record<SceneErrorCode, string> = {
  [SCENE_ERROR_CODES.INVALID_REQUEST]: "INVALID_REQUEST",
  [SCENE_ERROR_CODES.METHOD_NOT_FOUND]: "METHOD_NOT_FOUND",
  [SCENE_ERROR_CODES.INVALID_PARAMS]: "INVALID_PARAMS",
  [SCENE_ERROR_CODES.EXECUTION_FAILED]: "EXECUTION_FAILED",
  [SCENE_ERROR_CODES.TIMEOUT]: "TIMEOUT",
  [SCENE_ERROR_CODES.QUEUE_FULL]: "QUEUE_FULL",
  [SCENE_ERROR_CODES.NOT_CONNECTED]: "NOT_CONNECTED",
};

/** 可重试的错误码集合 */
export const RETRYABLE_ERROR_CODES: ReadonlySet<SceneErrorCode> = new Set([
  SCENE_ERROR_CODES.EXECUTION_FAILED,
  SCENE_ERROR_CODES.TIMEOUT,
  SCENE_ERROR_CODES.NOT_CONNECTED,
]);

/** 错误响应体 */
export interface SceneCommandError {
  code: SceneErrorCode | number;
  message: string;
  data?: unknown;
  retryable?: boolean;
}

// ─── 各指令参数类型 ─────────────────────────────────────────────────

/** character.moveTo 参数 */
export interface MoveToParams {
  characterId: string;
  x: number;
  y: number;
  z: number;
  speed?: number;
}

/** character.playAnimation 参数 */
export interface PlayAnimationParams {
  characterId: string;
  animationName: string;
  loop?: boolean;
  blendTime?: number;
}

/** camera.setPreset 参数 */
export interface SetPresetParams {
  presetName: string;
}

/** camera.transition 参数 */
export interface CameraTransitionParams {
  targetPosition: { x: number; y: number; z: number };
  targetRotation?: { pitch: number; yaw: number; roll: number };
  duration: number;
  easing?: string;
}

/** scene.setState 参数 */
export interface SetStateParams {
  key: string;
  value: unknown;
}

/** effect.play 参数 */
export interface EffectPlayParams {
  effectId: string;
  position?: { x: number; y: number; z: number };
  scale?: number;
}

/** effect.stop 参数 */
export interface EffectStopParams {
  effectId: string;
  fadeOut?: number;
}

// ─── Zod Schema 定义 ────────────────────────────────────────────────

/** 三维坐标 schema */
const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/** 旋转 schema */
const rotationSchema = z.object({
  pitch: z.number(),
  yaw: z.number(),
  roll: z.number(),
});

/** character.moveTo 参数 schema */
export const moveToParamsSchema = z.object({
  characterId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  speed: z.number().positive().optional(),
});

/** character.playAnimation 参数 schema */
export const playAnimationParamsSchema = z.object({
  characterId: z.string().min(1),
  animationName: z.string().min(1),
  loop: z.boolean().optional(),
  blendTime: z.number().nonnegative().optional(),
});

/** camera.setPreset 参数 schema */
export const setPresetParamsSchema = z.object({
  presetName: z.string().min(1),
});

/** camera.transition 参数 schema */
export const cameraTransitionParamsSchema = z.object({
  targetPosition: vec3Schema,
  targetRotation: rotationSchema.optional(),
  duration: z.number().positive(),
  easing: z.string().optional(),
});

/** scene.setState 参数 schema */
export const setStateParamsSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

/** effect.play 参数 schema */
export const effectPlayParamsSchema = z.object({
  effectId: z.string().min(1),
  position: vec3Schema.optional(),
  scale: z.number().positive().optional(),
});

/** effect.stop 参数 schema */
export const effectStopParamsSchema = z.object({
  effectId: z.string().min(1),
  fadeOut: z.number().nonnegative().optional(),
});

/** 方法名到参数 schema 的映射 */
export const PARAM_SCHEMAS: Record<SceneCommandMethod, z.ZodType> = {
  "character.moveTo": moveToParamsSchema,
  "character.playAnimation": playAnimationParamsSchema,
  "camera.setPreset": setPresetParamsSchema,
  "camera.transition": cameraTransitionParamsSchema,
  "scene.setState": setStateParamsSchema,
  "effect.play": effectPlayParamsSchema,
  "effect.stop": effectStopParamsSchema,
};

/** JSON-RPC 2.0 请求基础 schema */
export const sceneCommandSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  id: z.string().min(1),
});

/** JSON-RPC 2.0 通知 schema（无 id） */
export const sceneNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
});

/** 批量请求 schema */
export const sceneBatchSchema = z.array(sceneCommandSchema).min(1);

// ─── 验证函数 ───────────────────────────────────────────────────────

/** 验证请求基础格式 */
export function validateCommand(
  data: unknown,
): z.ZodSafeParseResult<z.infer<typeof sceneCommandSchema>> {
  return sceneCommandSchema.safeParse(data);
}

/** 验证指令参数是否符合对应方法的 schema */
export function validateParams(
  method: string,
  params: Record<string, unknown>,
): { success: true } | { success: false; error: string } {
  const schema = PARAM_SCHEMAS[method as SceneCommandMethod];
  if (!schema) {
    // 自定义扩展指令，跳过参数校验
    return { success: true };
  }
  const result = schema.safeParse(params);
  if (result.success) {
    return { success: true };
  }
  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { success: false, error: issues };
}

/** 判断方法名是否为已知内置方法 */
export function isKnownMethod(method: string): method is SceneCommandMethod {
  return SCENE_COMMAND_METHODS.includes(method as SceneCommandMethod);
}

/** 判断错误码是否可重试 */
export function isRetryable(code: number): boolean {
  return RETRYABLE_ERROR_CODES.has(code as SceneErrorCode);
}

// ─── 工厂函数 ───────────────────────────────────────────────────────

/** 创建指令请求 */
export function createCommand(
  method: SceneCommandMethod | string,
  params: Record<string, unknown>,
  id?: string,
): SceneCommand {
  return {
    jsonrpc: "2.0",
    method,
    params,
    id: id ?? crypto.randomUUID(),
  };
}

/** 创建成功响应 */
export function createSuccessResult(
  id: string,
  result: SceneCommandSuccessResult = { success: true },
): SceneCommandResult {
  return { jsonrpc: "2.0", result, id };
}

/** 创建错误响应 */
export function createErrorResult(
  id: string,
  code: SceneErrorCode | number,
  message: string,
  data?: unknown,
): SceneCommandResult {
  return {
    jsonrpc: "2.0",
    error: {
      code,
      message,
      data,
      retryable: isRetryable(code),
    },
    id,
  };
}
