/**
 * 场景指令客户端 SDK — 传输层无关的类型安全指令发送
 *
 * 提供 Promise 风格的请求-响应封装，支持超时、批量请求与断连清理。
 * 通过 IClientTransport 接口抽象底层连接，可适配 WebSocket、Socket.IO 等传输方式。
 */
import type {
  SceneCommand,
  SceneCommandResult,
  MoveToParams,
  PlayAnimationParams,
  SetPresetParams,
  CameraTransitionParams,
  SetStateParams,
  EffectPlayParams,
  EffectStopParams,
} from "@shared/scene-command";
import { SCENE_ERROR_CODES } from "@shared/scene-command";

// ─── 客户端传输层抽象 ──────────────────────────────────────────────

/** 客户端传输层接口：抽象底层连接，使 SDK 与具体传输协议解耦 */
export interface IClientTransport {
  /** 发送原始消息 */
  send(data: string): void;
  /** 注册消息接收回调 */
  onMessage(handler: (data: string) => void): void;
  /** 建立连接 */
  connect(): Promise<void>;
  /** 关闭连接 */
  disconnect(): void;
}

// ─── 内部类型 ───────────────────────────────────────────────────────

/** 待处理请求的追踪记录 */
interface PendingRequest {
  resolve: (result: SceneCommandResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── 客户端配置 ─────────────────────────────────────────────────────

/** 客户端配置选项 */
export interface SceneCommandClientOptions {
  /** 请求超时时间（毫秒），默认 10000 */
  timeout?: number;
}

const DEFAULT_TIMEOUT = 10_000;

// ─── 客户端类 ───────────────────────────────────────────────────────

export class SceneCommandClient {
  private readonly transport: IClientTransport;
  private readonly timeout: number;
  private readonly pending = new Map<string, PendingRequest>();
  private connected = false;

  constructor(
    transport: IClientTransport,
    options?: SceneCommandClientOptions
  ) {
    this.transport = transport;
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    // 注册消息接收处理
    this.transport.onMessage(data => {
      this.handleMessage(data);
    });
  }

  // ─── 连接管理 ─────────────────────────────────────────────────

  /** 建立连接 */
  async connect(): Promise<void> {
    await this.transport.connect();
    this.connected = true;
  }

  /** 断开连接，拒绝所有待处理请求 */
  disconnect(): void {
    this.connected = false;

    // 拒绝所有待处理请求
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(
        new Error(`Disconnected (code: ${SCENE_ERROR_CODES.NOT_CONNECTED})`)
      );
    }
    this.pending.clear();

    this.transport.disconnect();
  }

  /** 当前是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  // ─── 类型安全的指令方法 ───────────────────────────────────────

  /** 角色移动 */
  moveTo(params: MoveToParams): Promise<SceneCommandResult> {
    return this.send(
      "character.moveTo",
      params as unknown as Record<string, unknown>
    );
  }

  /** 播放动画 */
  playAnimation(params: PlayAnimationParams): Promise<SceneCommandResult> {
    return this.send(
      "character.playAnimation",
      params as unknown as Record<string, unknown>
    );
  }

  /** 设置镜头预设 */
  setCamera(params: SetPresetParams): Promise<SceneCommandResult> {
    return this.send(
      "camera.setPreset",
      params as unknown as Record<string, unknown>
    );
  }

  /** 镜头过渡 */
  transitionCamera(
    params: CameraTransitionParams
  ): Promise<SceneCommandResult> {
    return this.send(
      "camera.transition",
      params as unknown as Record<string, unknown>
    );
  }

  /** 设置场景状态 */
  setSceneState(params: SetStateParams): Promise<SceneCommandResult> {
    return this.send(
      "scene.setState",
      params as unknown as Record<string, unknown>
    );
  }

  /** 播放特效 */
  playEffect(params: EffectPlayParams): Promise<SceneCommandResult> {
    return this.send(
      "effect.play",
      params as unknown as Record<string, unknown>
    );
  }

  /** 停止特效 */
  stopEffect(params: EffectStopParams): Promise<SceneCommandResult> {
    return this.send(
      "effect.stop",
      params as unknown as Record<string, unknown>
    );
  }

  // ─── 通用发送方法 ─────────────────────────────────────────────

  /** 发送单条指令（支持自定义扩展指令） */
  send(
    method: string,
    params: Record<string, unknown>
  ): Promise<SceneCommandResult> {
    if (!this.connected) {
      return Promise.reject(
        new Error(`Not connected (code: ${SCENE_ERROR_CODES.NOT_CONNECTED})`)
      );
    }

    const id = crypto.randomUUID();
    const command: SceneCommand = {
      jsonrpc: "2.0",
      method,
      params,
      id,
    };

    return new Promise<SceneCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Request ${id} timed out after ${this.timeout}ms (code: ${SCENE_ERROR_CODES.TIMEOUT})`
          )
        );
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(JSON.stringify(command));
    });
  }

  /** 批量发送指令 */
  sendBatch(commands: SceneCommand[]): Promise<SceneCommandResult[]> {
    if (!this.connected) {
      return Promise.reject(
        new Error(`Not connected (code: ${SCENE_ERROR_CODES.NOT_CONNECTED})`)
      );
    }

    if (commands.length === 0) {
      return Promise.resolve([]);
    }

    // 为每条指令创建独立的 Promise 追踪
    const promises = commands.map(cmd => {
      return new Promise<SceneCommandResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(cmd.id);
          reject(
            new Error(
              `Request ${cmd.id} timed out after ${this.timeout}ms (code: ${SCENE_ERROR_CODES.TIMEOUT})`
            )
          );
        }, this.timeout);

        this.pending.set(cmd.id, { resolve, reject, timer });
      });
    });

    // 发送批量请求
    this.transport.send(JSON.stringify(commands));

    return Promise.all(promises);
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  /** 处理收到的消息 */
  private handleMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // 忽略无法解析的消息
      return;
    }

    // 批量响应
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        this.resolveResponse(item as SceneCommandResult);
      }
      return;
    }

    // 单条响应
    this.resolveResponse(parsed as SceneCommandResult);
  }

  /** 匹配并解决待处理请求 */
  private resolveResponse(result: SceneCommandResult): void {
    if (!result || typeof result !== "object" || !result.id) {
      return;
    }

    const pending = this.pending.get(result.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(result.id);
    pending.resolve(result);
  }
}
