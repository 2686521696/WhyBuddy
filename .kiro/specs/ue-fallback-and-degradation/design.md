# 设计文档：降级与兜底策略

## 概述

降级系统是 UE 集成的安全网，确保在任何异常情况下用户都能获得可用的体验。设计上采用多级降级状态机，从高到低依次为：UE 全画质 → UE 低画质 → Three.js → 预渲染视频。

关键设计决策：
- 降级决策在前端完成，基于连接状态和性能指标
- Three.js 场景作为常驻后备，始终预加载
- 预渲染视频按任务类型预制

## 边界声明（与 ue-video-stream-player 的分工）

**本 spec 负责**：降级切换策略和决策逻辑。什么条件触发降级（连接断开 > 3s、帧率 < 10fps、显存 > 90%）、降级到哪一级、什么条件恢复、降级时的 UI 提示。

**不负责**：播放器能力本身。WebRTC 连接管理、视频渲染、画质自适应由 `ue-video-stream-player` 处理。

**接口约定**：本 spec 订阅 `ue-video-stream-player` 暴露的 `connectionState` 和 `streamQuality`，加上本地 GPU 监控数据（来自 `ue-local-resource-and-session-governance`），综合决策当前应该使用哪个渲染后端。决策结果通过 `renderMode: 'ue-full' | 'ue-low' | 'threejs' | 'prerender'` 通知播放器和 UI 层。

## 架构

```
┌─────────────────────────────────────────┐
│            降级状态机                     │
│                                         │
│  ue-full ──→ ue-low ──→ threejs ──→ prerender │
│    ↑           ↑          ↑                    │
│    └───────────┴──────────┘ (恢复检测)         │
└─────────────────────────────────────────┘
```

## 组件与接口

### 降级状态

```typescript
type RenderTier = 'ue-full' | 'ue-low' | 'threejs' | 'prerender';

interface DegradationState {
  currentTier: RenderTier;
  reason: string;
  since: number;
  canUpgrade: boolean;
}
```

### 降级触发条件

| 触发条件 | 目标层级 |
|---------|---------|
| UE 连接失败 | threejs |
| 帧率 < 20fps 持续 10s | ue-low |
| 带宽 < 2Mbps | ue-low |
| 移动端设备 | prerender |
| Three.js 也失败 | prerender |

## 正确性属性

1. **降级单调性**：自动降级只能向下，不会在无人干预下自动升级到更高层级。
2. **功能保持**：降级后所有任务操作功能仍可用，只影响视觉表现。
3. **状态连续**：降级切换过程中不丢失任务状态和角色位置。

## 测试策略

- **属性测试**：降级状态机的状态转换合法性
- **集成测试**：模拟 UE 断开 → Three.js 回退 → UE 恢复的完整链路
- **设备测试**：在移动端验证预渲染视频模式
