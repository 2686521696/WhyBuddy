# 设计文档：宠物角色系统

## 概述

宠物角色系统是 UE5 场景中的核心交互元素。设计上采用"统一骨骼 + 动画蓝图状态机 + 表情 Morph Target"的标准 UE5 角色架构。每个角色实例由 CharacterManager 统一管理，通过指令协议接收导演系统的调度。

关键设计决策：
- 所有宠物共享同一套骨骼结构，通过 Skeletal Mesh 切换外观
- 动作状态机使用 UE5 Animation Blueprint 实现
- 表情使用 Morph Target，支持多表情叠加

## 架构

```
┌──────────────────────────────────────────┐
│            CharacterManager               │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 角色池    │  │ Agent    │  │ 指令   │ │
│  │ (spawn/  │  │ 映射表   │  │ 接收器 │ │
│  │  despawn) │  │          │  │        │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │            │      │
│       ▼              ▼            ▼      │
│  ┌──────────────────────────────────┐    │
│  │        PetCharacter Actor         │    │
│  │  ┌──────────┐  ┌──────────────┐  │    │
│  │  │ Skeletal  │  │ Animation    │  │    │
│  │  │ Mesh      │  │ Blueprint    │  │    │
│  │  │ Component │  │ (状态机)     │  │    │
│  │  └──────────┘  └──────────────┘  │    │
│  │  ┌──────────┐  ┌──────────────┐  │    │
│  │  │ Morph    │  │ Navigation   │  │    │
│  │  │ Target   │  │ Component    │  │    │
│  │  │ (表情)   │  │ (寻路)       │  │    │
│  │  └──────────┘  └──────────────┘  │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

## 组件与接口

### 角色指令

```typescript
interface CharacterMoveCommand {
  method: 'character.moveTo';
  params: {
    characterId: string;
    target: { x: number; y: number; z: number };
    speed?: 'walk' | 'run';
  };
}

interface CharacterAnimCommand {
  method: 'character.playAnimation';
  params: {
    characterId: string;
    state: 'idle' | 'walk' | 'work' | 'celebrate' | 'talk' | 'blocked';
    expression?: 'neutral' | 'happy' | 'sad' | 'thinking' | 'surprised' | 'angry';
  };
}
```

### Agent 映射配置

```typescript
interface AgentCharacterMapping {
  agentId: string;
  characterId: string;
  meshVariant: string;
  defaultPosition: { x: number; y: number; z: number };
  stateMapping: Record<AgentState, CharacterState>;
}
```

### 动作状态机

```
idle ──(moveTo)──→ walk ──(到达)──→ idle
idle ──(startWork)──→ work ──(完成)──→ celebrate ──(超时)──→ idle
idle ──(startTalk)──→ talk ──(结束)──→ idle
任意状态 ──(blocked)──→ blocked ──(解除)──→ idle
```

## 正确性属性

1. **状态唯一性**：每个角色在任意时刻只处于一种动作状态。
2. **映射完整性**：每个在线 Agent 都有且仅有一个对应的角色实例。
3. **动画连续性**：状态切换时不出现 T-Pose 或动画跳帧。

## 测试策略

- **单元测试**：Agent-Character 映射的增删查、状态机转换逻辑
- **动画测试**：在 UE5 编辑器中逐一验证每种状态的动画播放与过渡
- **集成测试**：通过指令协议触发角色移动和状态切换，验证响应时间
