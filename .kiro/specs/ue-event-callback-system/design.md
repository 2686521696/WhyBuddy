# 设计文档：事件回调系统

## 概述

事件回调系统是 UE5 场景向前端通知关键时刻的通道。设计上采用"发布-订阅 + ACK 确认 + 超时重发"模式，确保事件可靠投递。前端通过 Promise 风格的 API 等待特定事件，实现 UI 与场景动画的时序对齐。

关键设计决策：
- 事件通过现有 WebSocket 通道推送，不新建连接
- 使用 ACK 机制保证关键事件不丢失
- 前端提供 waitForEvent() 异步 API，支持超时

## 架构

```
UE5 蓝图                Node.js 服务端              前端
  │                         │                        │
  │──(事件触发)──→          │                        │
  │                  ┌──────▼──────┐                 │
  │                  │ 事件路由器   │                 │
  │                  │ + 日志记录   │                 │
  │                  └──────┬──────┘                 │
  │                         │──(WebSocket 推送)──→   │
  │                         │                  ┌─────▼─────┐
  │                         │                  │ 事件分发器  │
  │                         │                  │ + ACK 回复  │
  │                         │←──(ACK)──────────│            │
  │                         │                  └────────────┘
```

## 组件与接口

### 事件格式

```typescript
interface UEEvent {
  eventId: string;
  type: UEEventType;
  timestamp: number;
  entityId?: string;
  data: Record<string, unknown>;
  requiresAck: boolean;
}

type UEEventType =
  | 'animation.completed'
  | 'camera.arrived'
  | 'character.reached'
  | 'scene.loaded'
  | 'effect.finished'
  | 'scene.stateChanged';
```

### 前端事件 API

```typescript
interface UEEventClient {
  on(type: UEEventType, handler: (event: UEEvent) => void): () => void;
  waitForEvent(type: UEEventType, filter?: Partial<UEEvent>, timeout?: number): Promise<UEEvent>;
  getRecentEvents(limit?: number): UEEvent[];
}
```

## 正确性属性

1. **事件不丢失**：requiresAck 为 true 的事件在 ACK 超时后必须重发。
2. **事件不重复**：前端通过 eventId 去重，同一事件不会触发两次回调。
3. **超时必触发**：waitForEvent 在超时后必须 reject，不会无限等待。

## 测试策略

- **单元测试**：事件去重、ACK 超时重发、waitForEvent 超时
- **集成测试**：UE 触发事件 → 前端接收 → ACK 回复的完整链路
- **属性测试**：随机事件序列下的去重与顺序保证
