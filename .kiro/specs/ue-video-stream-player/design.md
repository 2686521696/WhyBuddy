# 设计文档：前端视频流播放器

## 概述

视频流播放器是前端消费 UE5 渲染画面的核心组件。设计上采用"WebRTC 连接管理 + 视频渲染 + 降级状态机"三层架构。播放器作为 React 组件嵌入现有页面布局，替换 Three.js Canvas 的位置，同时保留 Three.js 作为降级渲染后端。

关键设计决策：
- 使用原生 `RTCPeerConnection` API，不引入第三方 WebRTC 库
- 降级策略由播放器内部状态机驱动，对外暴露统一的渲染模式枚举
- 视频流与 UI 浮层分层渲染，视频在底层、UI 在上层

## 架构

```
┌─────────────────────────────────────────┐
│            VideoStreamPlayer             │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ WebRTC      │  │ 降级状态机       │  │
│  │ Connection  │  │ ue → threejs →  │  │
│  │ Manager     │  │ prerender       │  │
│  └──────┬──────┘  └───────┬─────────┘  │
│         │                  │            │
│         ▼                  ▼            │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ <video>     │  │ Three.js Canvas │  │
│  │ 元素渲染    │  │ (降级后备)      │  │
│  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────┘
```

## 组件与接口

### VideoStreamPlayer Props

```typescript
interface VideoStreamPlayerProps {
  signalingUrl: string;
  autoConnect?: boolean;
  quality?: 'high' | 'medium' | 'low' | 'auto';
  fallbackMode?: 'threejs' | 'prerender' | 'none';
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: StreamError) => void;
  onModeChange?: (mode: RenderMode) => void;
  className?: string;
}

type RenderMode = 'ue-stream' | 'threejs' | 'prerender' | 'connecting' | 'error';

interface StreamError {
  code: 'CONNECTION_FAILED' | 'STREAM_LOST' | 'SIGNALING_ERROR' | 'TIMEOUT';
  message: string;
  retryable: boolean;
}
```

### WebRTCConnectionManager

```typescript
interface WebRTCConnectionManager {
  connect(signalingUrl: string): Promise<MediaStream>;
  disconnect(): void;
  reconnect(): Promise<MediaStream>;
  getStats(): Promise<RTCStatsReport>;
  setQuality(quality: QualityLevel): void;
}
```

### 降级状态机

```
ue-stream ──(连接断开)──→ connecting
connecting ──(重连成功)──→ ue-stream
connecting ──(重连失败)──→ threejs
threejs ──(UE 恢复可用)──→ ue-stream
threejs ──(Three.js 也失败)──→ prerender
```

## 正确性属性

1. **渲染模式唯一性**：任意时刻只有一种渲染模式处于激活状态，不会同时显示视频流和 Three.js Canvas。
2. **资源释放完整性**：组件卸载后，所有 RTCPeerConnection、MediaStream 和 video 元素引用必须被释放。
3. **降级不可逆保护**：从 prerender 模式不会自动升级回 ue-stream，需用户手动触发重连。

## 测试策略

- **单元测试**：降级状态机的状态转换、WebRTC mock 连接与断开
- **集成测试**：VideoStreamPlayer 组件挂载、连接、降级的 React Testing Library 测试
- **视觉回归**：截图对比 ue-stream 模式与 threejs 降级模式的布局一致性
