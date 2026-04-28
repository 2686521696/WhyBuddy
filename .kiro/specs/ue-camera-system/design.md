# 设计文档：镜头系统

## 概述

镜头系统是 UE5 场景中的"摄影师"，负责根据导演指令和场景状态自动选择最佳视角。设计上采用"预设库 + 过渡控制器 + 自动构图引擎"三层架构，在 UE5 蓝图中实现核心逻辑，通过指令协议接收外部调度。

关键设计决策：
- 使用 UE5 Camera Actor + Spring Arm 实现镜头控制
- 过渡动画使用 Timeline + Curve 实现，不依赖 Sequencer
- 自动构图基于角色 Bounding Box 的屏幕投影计算

## 架构

```
┌──────────────────────────────────────────┐
│            CameraDirector                 │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 预设库    │  │ 过渡     │  │ 自动   │ │
│  │ (5 种    │  │ 控制器   │  │ 构图   │ │
│  │  机位)   │  │ (blend)  │  │ 引擎   │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │            │      │
│       ▼              ▼            ▼      │
│  ┌──────────────────────────────────┐    │
│  │      Camera Actor + Spring Arm    │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

## 组件与接口

### 镜头指令

```typescript
interface CameraPresetCommand {
  method: 'camera.setPreset';
  params: {
    preset: 'overview' | 'closeup' | 'follow' | 'topdown' | 'meeting';
    targetCharacterId?: string;
  };
}

interface CameraTransitionCommand {
  method: 'camera.transition';
  params: {
    position: { x: number; y: number; z: number };
    rotation: { pitch: number; yaw: number; roll: number };
    fov?: number;
    duration?: number;
    easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
    transitionType?: 'dolly' | 'fade' | 'orbit' | 'cut';
  };
}
```

### 预设参数

| 预设 | 位置偏移 | FOV | 说明 |
|------|---------|-----|------|
| overview | (0, 500, 400) | 75° | 全景俯视 |
| closeup | 角色前方 150cm | 35° | 角色特写 |
| follow | 角色后方 300cm | 55° | 跟随视角 |
| topdown | (0, 0, 800) | 60° | 正俯瞰 |
| meeting | 会议桌侧方 | 50° | 会议室视角 |

### 自动构图规则

```typescript
interface AutoFramingConfig {
  ruleOfThirds: boolean;
  minScreenCoverage: number;  // 角色最小占屏比 0.1
  maxScreenCoverage: number;  // 角色最大占屏比 0.8
  headroom: number;           // 头顶留白比例 0.15
  lookAheadBias: number;      // 角色朝向偏移 0.1
}
```

## 正确性属性

1. **无穿墙**：镜头在任何过渡和跟随过程中不穿过墙壁或家具。
2. **角色可见**：自动构图模式下，所有活跃角色至少 80% 身体在画面内。
3. **过渡完整**：每次镜头过渡必须在指定时间内完成，不会卡在中间状态。

## 测试策略

- **单元测试**：预设参数加载、自动构图 FOV 计算
- **视觉测试**：在 UE5 编辑器中逐一验证每种预设和过渡效果
- **集成测试**：通过指令协议触发镜头切换，验证过渡时间和最终位置
