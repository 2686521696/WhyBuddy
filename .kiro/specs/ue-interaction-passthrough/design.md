# 设计文档：交互事件透传

## 概述

交互事件透传系统负责将浏览器端的用户输入传递到 UE5 场景。设计上采用"事件捕获 → 坐标转换 → 通道路由 → UE 处理"四步流水线。通过 Pixel Streaming 的 DataChannel 传输输入事件，避免额外的网络开销。

关键设计决策：
- 使用 Pixel Streaming 内置的 DataChannel 传输输入，不新建连接
- 坐标转换在前端完成，UE 侧直接使用归一化坐标
- 输入通道路由在前端 OverlayContainer 层完成

## 架构

```
浏览器事件
    │
    ▼
┌──────────────┐
│ 事件捕获层    │ ← pointer-events 策略
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 坐标转换器    │ ← 视频元素 → 归一化坐标
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 通道路由器    │ ← 模式配置
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ DataChannel   │ → UE5 InputHandler
└──────────────┘
```

## 组件与接口

### 输入事件格式

```typescript
interface UEInputEvent {
  type: 'mouseDown' | 'mouseUp' | 'mouseMove' | 'wheel' | 'touchStart' | 'touchMove' | 'touchEnd';
  x: number;  // 0.0 - 1.0 归一化
  y: number;
  button?: number;
  delta?: number;
  touchId?: number;
}
```

### 输入通道配置

```typescript
interface InputChannelConfig {
  mode: 'passthrough' | 'intercept' | 'smart';
  locked: boolean;
  dragThreshold: number;  // 像素，区分点击和拖拽
  scrollSensitivity: number;
}
```

### Hit Test 回调

```typescript
// UE → 前端的点击命中结果
interface HitTestResult {
  type: 'character' | 'furniture' | 'ground' | 'none';
  entityId?: string;
  worldPosition: { x: number; y: number; z: number };
}
```

## 正确性属性

1. **坐标精度**：归一化坐标与视频流中实际位置的偏差不超过 1%。
2. **事件不泄漏**：UI 拦截模式下，事件不会透传到 UE。
3. **拖拽判定**：移动距离小于阈值的操作判定为点击，大于阈值判定为拖拽。

## 测试策略

- **单元测试**：坐标转换精度、通道路由逻辑、拖拽判定
- **集成测试**：点击角色 → Hit Test → 详情面板的完整链路
- **交互测试**：拖拽旋转视角的流畅性与边界限制
