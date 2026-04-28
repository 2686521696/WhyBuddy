# 场景指令客户端 SDK

## 概述

`SceneCommandClient` 是一个传输层无关的 TypeScript 客户端 SDK，用于向场景指令服务端发送 JSON-RPC 2.0 指令。它提供类型安全的方法、Promise 风格的请求-响应封装、超时处理与断连清理。

## 快速开始

```typescript
import { SceneCommandClient, type IClientTransport } from "./scene-command-client";

// 1. 实现传输层（以 WebSocket 为例）
class WebSocketTransport implements IClientTransport {
  private ws: WebSocket | null = null;
  private handler: ((data: string) => void) | null = null;

  send(data: string): void {
    this.ws?.send(data);
  }

  onMessage(handler: (data: string) => void): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket("ws://localhost:3001/scene");
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => this.handler?.(e.data);
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}

// 2. 创建客户端并连接
const transport = new WebSocketTransport();
const client = new SceneCommandClient(transport, { timeout: 10000 });
await client.connect();

// 3. 发送指令
const result = await client.moveTo({
  characterId: "hero",
  x: 100,
  y: 0,
  z: 200,
  speed: 5,
});

console.log(result.result?.success); // true
```

## API 参考

### 构造函数

```typescript
new SceneCommandClient(transport: IClientTransport, options?: SceneCommandClientOptions)
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `transport` | `IClientTransport` | 传输层实现 |
| `options.timeout` | `number` | 请求超时时间（毫秒），默认 `10000` |

### 连接管理

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `connect()` | `Promise<void>` | 建立连接 |
| `disconnect()` | `void` | 断开连接，拒绝所有待处理请求 |
| `isConnected()` | `boolean` | 当前是否已连接 |

### 类型安全指令方法

所有方法返回 `Promise<SceneCommandResult>`。

| 方法 | 参数类型 | 对应指令 |
|------|----------|----------|
| `moveTo(params)` | `MoveToParams` | `character.moveTo` |
| `playAnimation(params)` | `PlayAnimationParams` | `character.playAnimation` |
| `setCamera(params)` | `SetPresetParams` | `camera.setPreset` |
| `transitionCamera(params)` | `CameraTransitionParams` | `camera.transition` |
| `setSceneState(params)` | `SetStateParams` | `scene.setState` |
| `playEffect(params)` | `EffectPlayParams` | `effect.play` |
| `stopEffect(params)` | `EffectStopParams` | `effect.stop` |

### 通用方法

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `send(method, params)` | `Promise<SceneCommandResult>` | 发送自定义扩展指令 |
| `sendBatch(commands)` | `Promise<SceneCommandResult[]>` | 批量发送指令 |

## 参数类型

```typescript
interface MoveToParams {
  characterId: string;
  x: number;
  y: number;
  z: number;
  speed?: number;
}

interface PlayAnimationParams {
  characterId: string;
  animationName: string;
  loop?: boolean;
  blendTime?: number;
}

interface SetPresetParams {
  presetName: string;
}

interface CameraTransitionParams {
  targetPosition: { x: number; y: number; z: number };
  targetRotation?: { pitch: number; yaw: number; roll: number };
  duration: number;
  easing?: string;
}

interface SetStateParams {
  key: string;
  value: unknown;
}

interface EffectPlayParams {
  effectId: string;
  position?: { x: number; y: number; z: number };
  scale?: number;
}

interface EffectStopParams {
  effectId: string;
  fadeOut?: number;
}
```

## 自定义扩展指令

使用 `send()` 方法发送协议未预定义的自定义指令：

```typescript
const result = await client.send("custom.spawnNPC", {
  npcType: "merchant",
  position: { x: 50, y: 0, z: 100 },
});
```

## 批量请求

使用 `sendBatch()` 一次发送多条指令，服务端会返回对应的结果数组：

```typescript
import { createCommand } from "@shared/scene-command";

const commands = [
  createCommand("character.moveTo", { characterId: "hero", x: 10, y: 0, z: 20 }),
  createCommand("effect.play", { effectId: "dust" }),
  createCommand("camera.transition", {
    targetPosition: { x: 10, y: 5, z: 20 },
    duration: 1.5,
  }),
];

const results = await client.sendBatch(commands);
// results[0] — moveTo 结果
// results[1] — playEffect 结果
// results[2] — transitionCamera 结果
```

## 错误处理

### 服务端错误

服务端返回的错误不会导致 Promise reject，而是通过 `result.error` 字段返回：

```typescript
const result = await client.moveTo({ characterId: "hero", x: 0, y: 0, z: 0 });

if (result.error) {
  console.error(`错误 ${result.error.code}: ${result.error.message}`);
  if (result.error.retryable) {
    // 可重试
  }
}
```

### 超时

请求超时会导致 Promise reject：

```typescript
try {
  await client.moveTo({ characterId: "hero", x: 0, y: 0, z: 0 });
} catch (err) {
  if (err.message.includes("timed out")) {
    console.error("指令执行超时");
  }
}
```

### 未连接

在未连接状态下发送指令会立即 reject：

```typescript
try {
  await client.send("test", {});
} catch (err) {
  if (err.message.includes("Not connected")) {
    await client.connect();
    // 重试
  }
}
```

### 断连清理

调用 `disconnect()` 时，所有待处理的请求会被自动 reject：

```typescript
const promise = client.moveTo({ characterId: "hero", x: 0, y: 0, z: 0 });
client.disconnect();
// promise 会被 reject，错误信息包含 NOT_CONNECTED 错误码
```

## 错误码

| 错误码 | 名称 | 说明 |
|--------|------|------|
| `-32600` | `INVALID_REQUEST` | 请求格式不合法 |
| `-32601` | `METHOD_NOT_FOUND` | 指令类型不存在 |
| `-32602` | `INVALID_PARAMS` | 参数校验失败 |
| `-32000` | `EXECUTION_FAILED` | UE 侧执行失败 |
| `-32001` | `TIMEOUT` | 指令执行超时 |
| `-32002` | `QUEUE_FULL` | 队列已满 |
| `-32003` | `NOT_CONNECTED` | 连接不可用 |

## 传输层接口

实现 `IClientTransport` 接口即可适配任意传输协议：

```typescript
interface IClientTransport {
  /** 发送原始消息 */
  send(data: string): void;
  /** 注册消息接收回调 */
  onMessage(handler: (data: string) => void): void;
  /** 建立连接 */
  connect(): Promise<void>;
  /** 关闭连接 */
  disconnect(): void;
}
```
