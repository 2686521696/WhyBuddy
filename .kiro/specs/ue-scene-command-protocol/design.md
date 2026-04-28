# 设计文档：场景指令协议

## 概述

场景指令协议是 LLM 导演与 UE5 渲染引擎之间的通信桥梁。设计上采用 JSON-RPC 2.0 over WebSocket，支持请求-响应与通知两种模式。协议层负责指令格式定义、参数校验、队列管理与错误处理，不涉及具体的 UE 蓝图实现。

关键设计决策：
- 选择 JSON-RPC 2.0 而非自定义协议，降低对接成本
- 指令队列在 Node.js 侧维护，UE 侧只负责执行当前指令
- 每条指令有独立超时，避免单条阻塞导致全队列卡死

## 架构

```
┌──────────────┐    JSON-RPC/WS    ┌──────────────┐
│  LLM 导演    │ ───────────────→  │  指令路由器   │
│  (Node.js)   │ ←───────────────  │  (Node.js)   │
└──────────────┘    响应/事件       └──────┬───────┘
                                          │
                                   ┌──────▼───────┐
                                   │  指令队列     │
                                   │  (优先级队列) │
                                   └──────┬───────┘
                                          │
                                   ┌──────▼───────┐
                                   │  UE 执行桥    │
                                   │  (WebSocket)  │
                                   └──────┬───────┘
                                          │
                                   ┌──────▼───────┐
                                   │  UE5 蓝图     │
                                   │  指令处理器   │
                                   └──────────────┘
```

## 组件与接口

### 指令格式

```typescript
// 请求
interface SceneCommand {
  jsonrpc: '2.0';
  method: SceneCommandMethod;
  params: Record<string, unknown>;
  id: string;
}

type SceneCommandMethod =
  | 'character.moveTo'
  | 'character.playAnimation'
  | 'camera.setPreset'
  | 'camera.transition'
  | 'scene.setState'
  | 'effect.play'
  | 'effect.stop';

// 响应
interface SceneCommandResult {
  jsonrpc: '2.0';
  result?: { success: boolean; duration?: number };
  error?: { code: number; message: string; data?: unknown };
  id: string;
}
```

### 指令队列

```typescript
interface CommandQueue {
  enqueue(command: SceneCommand, priority?: number): string;
  cancel(requestId: string): boolean;
  peek(): SceneCommand | null;
  size(): number;
  clear(): void;
}
```

### 错误码定义

| 错误码 | 名称 | 说明 |
|--------|------|------|
| -32600 | INVALID_REQUEST | 请求格式不合法 |
| -32601 | METHOD_NOT_FOUND | 指令类型不存在 |
| -32602 | INVALID_PARAMS | 参数校验失败 |
| -32000 | EXECUTION_FAILED | UE 侧执行失败 |
| -32001 | TIMEOUT | 指令执行超时 |
| -32002 | QUEUE_FULL | 队列已满 |
| -32003 | NOT_CONNECTED | UE 连接不可用 |

## 正确性属性

1. **指令顺序保证**：同优先级指令的执行顺序与入队顺序一致。
2. **超时必达**：每条指令在超时时间内必须收到成功或失败响应，不会无限等待。
3. **ID 唯一性**：同一会话内不会出现重复的 requestId。

## 测试策略

- **单元测试**：指令格式校验、队列入队出队、超时触发
- **集成测试**：WebSocket 连接建立、指令发送与响应接收
- **属性测试**：随机生成指令序列，验证队列顺序保证与超时必达
