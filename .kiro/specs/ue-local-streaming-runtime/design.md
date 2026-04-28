# 设计文档：本地 UE 渲染运行时

## 概述

本地 UE 渲染运行时的核心设计目标是：在开发机上以最小配置启动 UE5 Pixel Streaming，并通过本地 WebRTC 将画面推送到浏览器。设计上采用"启动脚本 + 信令代理 + 健康检查"三层架构，确保 UE5 实例可被前端稳定消费。

关键设计决策：
- 使用 UE5 内置 Pixel Streaming 插件，不引入第三方推流中间件
- 信令服务运行在 Node.js 侧，与现有 Express 服务端共进程
- 通过子进程管理 UE5 实例生命周期，支持优雅停止与崩溃重启

## 架构

```
┌──────────────────────────────────────────────┐
│                  浏览器端                      │
│  VideoStreamPlayer ← WebRTC ← Pixel Stream   │
├──────────────────────────────────────────────┤
│              Node.js 服务端                    │
│  ┌─────────────┐  ┌──────────────────┐       │
│  │ 信令代理     │  │ UE 进程管理器     │       │
│  │ (WebSocket)  │  │ (child_process)  │       │
│  └──────┬──────┘  └───────┬──────────┘       │
│         │                  │                  │
│         ▼                  ▼                  │
│  ┌─────────────┐  ┌──────────────────┐       │
│  │ 健康检查     │  │ 配置管理          │       │
│  │ (heartbeat)  │  │ (.env / json)    │       │
│  └─────────────┘  └──────────────────┘       │
├──────────────────────────────────────────────┤
│              UE5 渲染进程                      │
│  Pixel Streaming Plugin + 场景关卡            │
└──────────────────────────────────────────────┘
```

## 组件与接口

### UEProcessManager

负责 UE5 实例的启动、停止、重启与崩溃检测。

```typescript
interface UEProcessConfig {
  ueEditorPath: string;
  projectPath: string;
  mapName: string;
  resolution: { width: number; height: number };
  pixelStreamingPort: number;
  extraArgs?: string[];
}

interface UEProcessManager {
  start(config: UEProcessConfig): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): UEProcessStatus;
  onCrash(callback: (error: Error) => void): void;
}

type UEProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed';
```

### SignalingProxy

本地信令代理，桥接浏览器 WebRTC 与 UE5 Pixel Streaming。

```typescript
interface SignalingProxy {
  listen(port: number): void;
  getConnectionCount(): number;
  onClientConnected(callback: (clientId: string) => void): void;
  onClientDisconnected(callback: (clientId: string) => void): void;
}
```

### 健康检查接口

```typescript
// GET /api/ue/health
interface UEHealthResponse {
  status: UEProcessStatus;
  fps: number;
  gpuUsage: number;
  vramUsage: number;
  connectedClients: number;
  uptime: number;
}
```

## 正确性属性

1. **启动幂等性**：多次调用 start() 不会创建多个 UE5 进程，已运行时返回当前状态。
2. **崩溃恢复一致性**：UE5 进程崩溃后，进程管理器状态必须在 5 秒内更新为 `crashed`，且不残留僵尸进程。
3. **连接隔离性**：单个客户端断开不影响其他客户端的 WebRTC 连接。

## 测试策略

- **单元测试**：UEProcessManager 的状态机转换、配置解析与参数拼接
- **集成测试**：信令代理的 WebSocket 握手与消息转发（使用 mock UE 端）
- **冒烟测试**：端到端启动脚本 → UE 进程就绪 → 浏览器连接 → 画面可见
