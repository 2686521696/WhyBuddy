/**
 * 场景指令服务端 — 传输层无关的 JSON-RPC 2.0 指令接收与分发
 *
 * 设计为传输层无关：通过 ITransport 接口抽象消息收发，
 * 可适配 Socket.IO、原生 WebSocket 或其他传输方式。
 */
import {
  type SceneCommand,
  type SceneCommandResult,
  type SceneCommandBatch,
  validateCommand,
  sceneBatchSchema,
  createErrorResult,
  SCENE_ERROR_CODES,
} from "../../shared/scene-command/index.ts";
import { CommandValidator } from "./command-validator.ts";
import { CommandRouter } from "./command-router.ts";

// ─── 传输层抽象 ────────────────────────────────────────────────────

/** 连接标识 */
export type ConnectionId = string;

/** 传输层接口：抽象消息收发，使服务端与具体传输协议解耦 */
export interface ITransport {
  /** 向指定连接发送消息 */
  send(connectionId: ConnectionId, data: string): void;
  /** 注册消息接收回调 */
  onMessage(
    handler: (connectionId: ConnectionId, data: string) => void,
  ): void;
  /** 注册连接建立回调 */
  onConnect(handler: (connectionId: ConnectionId) => void): void;
  /** 注册连接断开回调 */
  onDisconnect(handler: (connectionId: ConnectionId) => void): void;
}

// ─── 服务端类 ───────────────────────────────────────────────────────

export class SceneCommandServer {
  private readonly validator: CommandValidator;
  private readonly router: CommandRouter;
  private readonly connections = new Set<ConnectionId>();

  constructor(
    private readonly transport: ITransport,
    router?: CommandRouter,
  ) {
    this.validator = new CommandValidator();
    this.router = router ?? new CommandRouter();
    this.setupTransport();
  }

  /** 获取路由器实例，用于注册方法处理器 */
  getRouter(): CommandRouter {
    return this.router;
  }

  /** 获取当前活跃连接数 */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /** 判断连接是否存在 */
  hasConnection(connectionId: ConnectionId): boolean {
    return this.connections.has(connectionId);
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  private setupTransport(): void {
    this.transport.onConnect((id) => {
      this.connections.add(id);
    });

    this.transport.onDisconnect((id) => {
      this.connections.delete(id);
    });

    this.transport.onMessage((id, data) => {
      void this.handleRawMessage(id, data);
    });
  }

  /** 处理原始消息字符串 */
  private async handleRawMessage(
    connectionId: ConnectionId,
    raw: string,
  ): Promise<void> {
    // 1. 尝试 JSON 解析
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSON 解析失败 → INVALID_REQUEST
      const errorResult = createErrorResult(
        "",
        SCENE_ERROR_CODES.INVALID_REQUEST,
        "Parse error: invalid JSON",
      );
      this.transport.send(connectionId, JSON.stringify(errorResult));
      return;
    }

    // 2. 检测批量 vs 单条请求
    if (Array.isArray(parsed)) {
      await this.handleBatch(connectionId, parsed);
    } else {
      const result = await this.handleSingle(connectionId, parsed);
      this.transport.send(connectionId, JSON.stringify(result));
    }
  }

  /** 处理单条请求 */
  private async handleSingle(
    _connectionId: ConnectionId,
    data: unknown,
  ): Promise<SceneCommandResult> {
    // 基础格式校验
    const validated = this.validator.validate(data);
    if (!validated.success) {
      return validated.error;
    }

    // 路由分发
    return this.router.dispatch(validated.command);
  }

  /** 处理批量请求 */
  private async handleBatch(
    connectionId: ConnectionId,
    items: unknown[],
  ): Promise<void> {
    if (items.length === 0) {
      const errorResult = createErrorResult(
        "",
        SCENE_ERROR_CODES.INVALID_REQUEST,
        "Invalid batch: empty array",
      );
      this.transport.send(connectionId, JSON.stringify(errorResult));
      return;
    }

    // 验证批量请求格式
    const batchParse = sceneBatchSchema.safeParse(items);
    if (!batchParse.success) {
      // 逐条处理，允许部分成功
      const results: SceneCommandResult[] = [];
      for (const item of items) {
        const result = await this.handleSingle(connectionId, item);
        results.push(result);
      }
      this.transport.send(connectionId, JSON.stringify(results));
      return;
    }

    // 批量分发
    const results: SceneCommandResult[] = [];
    for (const cmd of batchParse.data as SceneCommand[]) {
      const validated = this.validator.validate(cmd);
      if (!validated.success) {
        results.push(validated.error);
      } else {
        const result = await this.router.dispatch(validated.command);
        results.push(result);
      }
    }
    this.transport.send(connectionId, JSON.stringify(results));
  }
}
