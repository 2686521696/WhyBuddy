# 设计文档：多用户会话隔离

## 概述

多用户会话隔离系统负责在多个用户同时使用时，为每个用户分配独立的 UE 实例。设计上采用"实例池 + 会话管理器 + 资源配额"三层架构。

关键设计决策：
- 每个用户独占一个 UE 实例，不共享渲染进程
- 使用实例池预热，减少用户等待时间
- 资源不足时进入排队模式，不降级到共享实例

## 架构

```
┌──────────────────────────────────────────┐
│            会话管理器                      │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 会话表    │  │ 排队队列  │  │ 超时   │ │
│  │ (userId  │  │          │  │ 回收器 │ │
│  │  → inst) │  │          │  │        │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │            │      │
│       ▼              ▼            ▼      │
│  ┌──────────────────────────────────┐    │
│  │          UE 实例池                │    │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐   │    │
│  │  │ UE │ │ UE │ │ UE │ │ UE │   │    │
│  │  │ #1 │ │ #2 │ │ #3 │ │ #4 │   │    │
│  │  └────┘ └────┘ └────┘ └────┘   │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

## 组件与接口

### 会话

```typescript
interface UESession {
  sessionId: string;
  userId: string;
  instanceId: string;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'expired';
}
```

### 实例池

```typescript
interface UEInstancePool {
  acquire(userId: string): Promise<UEInstance>;
  release(instanceId: string): void;
  getPoolStatus(): PoolStatus;
  setCapacity(min: number, max: number): void;
}

interface PoolStatus {
  total: number;
  available: number;
  inUse: number;
  warming: number;
  queueLength: number;
}
```

### 资源配额

```typescript
interface ResourceQuota {
  maxGPUPercent: number;    // 每实例最大 GPU 占用
  maxVRAM: number;          // 每实例最大显存 MB
  maxSessionDuration: number; // 最大会话时长 分钟
  idleTimeout: number;      // 空闲超时 分钟
}
```

## 正确性属性

1. **实例独占**：每个 UE 实例在同一时刻只被一个用户使用。
2. **会话不泄漏**：超时或断开的会话必须释放对应实例。
3. **排队公平**：排队用户按先到先得顺序分配实例。

## 测试策略

- **单元测试**：会话生命周期、实例池分配与回收
- **并发测试**：多用户同时请求实例的竞争条件
- **压力测试**：池满时的排队与超时行为
