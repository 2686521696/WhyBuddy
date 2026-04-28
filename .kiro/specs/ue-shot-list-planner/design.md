# 设计文档：分镜规划器

## 概述

分镜规划器是导演系统的执行层，负责将高层分镜脚本转换为可执行的指令时间线。设计上采用"模板匹配 + 时间线编排 + 指令序列化"三步流程。

关键设计决策：
- 使用预定义的 shot 模板库，覆盖常见场景
- 时间线使用绝对时间戳，支持并行与串行指令
- 指令序列可序列化为 JSON，支持保存与回放

## 架构

```
Shot List
    │
    ▼
┌──────────────┐
│ 模板匹配器    │ ← Shot 模板库
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 时间线编排器  │
│ (并行/串行)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 指令序列化器  │ → JSON / 指令协议
└──────────────┘
```

## 组件与接口

### Shot 模板

```typescript
interface ShotTemplate {
  id: string;
  name: string;
  cameraPreset: string;
  defaultDuration: number;
  characterSlots: number;
  transitions: { in: string; out: string };
}
```

### 时间线

```typescript
interface Timeline {
  totalDuration: number;
  tracks: TimelineTrack[];
}

interface TimelineTrack {
  type: 'camera' | 'character' | 'effect';
  entityId: string;
  keyframes: Array<{
    time: number;
    command: SceneCommand;
    waitFor?: string; // eventId
  }>;
}
```

## 正确性属性

1. **时间线无重叠**：同一实体的指令在时间线上不重叠。
2. **总时长一致**：时间线总时长等于所有 shot 时长加过渡时间之和。
3. **依赖满足**：waitFor 引用的事件必须在时间线中有对应的触发点。

## 测试策略

- **单元测试**：shot 到时间线的转换、时间线冲突检测
- **集成测试**：完整 shot list 到指令序列的端到端转换
- **回放测试**：序列化后的指令 JSON 重新加载并执行
