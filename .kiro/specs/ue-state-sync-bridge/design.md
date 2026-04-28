# 设计文档：状态同步桥

## 概述

状态同步桥是 UE5 与前端之间的双向数据通道。设计上采用"快照推送 + 增量更新 + 版本校验"模式，UE 侧定时推送场景快照，前端侧通过指令协议反向驱动场景变更。

关键设计决策：
- UE → 前端使用 WebSocket 推送，频率 10fps
- 前端 → UE 复用指令协议通道，不新建连接
- 使用版本号（monotonic counter）保证状态一致性

## 边界声明（与 ue-event-callback-system 的分工）

**本 spec 负责**：持续状态同步。以固定频率（10fps）推送场景快照，包含角色位置、当前镜头、动作状态、任务阶段等连续变化的数据。

**不负责**：瞬时事件通知。"动画播完了"、"镜头到位了"、"角色到达了"这类一次性事件由 `ue-event-callback-system` 处理。

**区分原则**：如果数据是"当前值是什么"→ 走 state-sync。如果数据是"刚刚发生了什么"→ 走 event-callback。不要用 callback 做状态轮询，也不要用 state-sync 做事件确认。

## 架构

```
┌──────────┐  场景快照(10fps)  ┌──────────┐
│  UE5     │ ───────────────→  │  前端     │
│  场景    │                   │  Store    │
│  状态    │ ←───────────────  │  (Zustand)│
└──────────┘  任务状态映射      └──────────┘
     │                              │
     ▼                              ▼
┌──────────┐                 ┌──────────┐
│ 快照生成  │                 │ 映射引擎  │
│ (增量diff)│                 │ (规则表) │
└──────────┘                 └──────────┘
```

## 组件与接口

### 场景快照

```typescript
interface SceneSnapshot {
  version: number;
  timestamp: number;
  characters: Array<{
    id: string;
    position: { x: number; y: number; z: number };
    rotation: number;
    state: CharacterState;
    expression: string;
  }>;
  camera: {
    preset: string;
    position: { x: number; y: number; z: number };
    rotation: { pitch: number; yaw: number; roll: number };
    fov: number;
  };
  scene: {
    lighting: string;
    activeEffects: string[];
  };
}
```

### 任务状态映射规则

```typescript
interface TaskToSceneMapping {
  taskEvent: string;
  sceneCommands: SceneCommand[];
  condition?: (context: MappingContext) => boolean;
}
```

## 正确性属性

1. **版本单调递增**：快照版本号严格递增，前端不接受版本号小于当前的快照。
2. **映射幂等性**：同一任务事件多次触发不会导致场景状态叠加异常。
3. **断线恢复**：重连后自动进行全量同步，不依赖增量历史。

## 测试策略

- **单元测试**：增量 diff 算法、版本号校验、映射规则匹配
- **集成测试**：WebSocket 推送与 store 更新的端到端验证
- **属性测试**：随机生成快照序列，验证版本单调性与增量正确性
