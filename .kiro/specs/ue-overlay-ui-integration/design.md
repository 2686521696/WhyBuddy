# 设计文档：UI 浮层叠加集成

## 概述

UI 浮层叠加集成的核心挑战是在视频流上实现 React UI 与 UE 场景的共存。设计上采用"视频底层 + UI 浮层 + HUD 跟踪层"三层渲染架构，通过 CSS pointer-events 控制事件穿透，通过 UE 坐标投影实现 HUD 定位。

关键设计决策：
- UI 浮层完全在 React 侧渲染，不使用 UE 的 UMG 系统
- HUD 定位依赖 UE 侧推送的角色屏幕坐标，前端只做渲染
- 事件穿透策略使用 CSS pointer-events，不使用 JavaScript 事件转发

## 架构

```
┌─────────────────────────────────────────┐
│  z-index: 30  │  HUD 跟踪层             │
│               │  角色标签 / 状态图标     │
├───────────────┼─────────────────────────┤
│  z-index: 20  │  UI 浮层                │
│               │  侧边栏 / 任务面板      │
│               │  pointer-events: none   │
│               │  (子元素 auto)          │
├───────────────┼─────────────────────────┤
│  z-index: 10  │  视频流层               │
│               │  <video> / Three.js     │
├───────────────┼─────────────────────────┤
│  z-index: 0   │  背景层                 │
└─────────────────────────────────────────┘
```

## 组件与接口

### OverlayContainer

```typescript
interface OverlayContainerProps {
  videoElement: React.RefObject<HTMLVideoElement>;
  children: React.ReactNode;
  hudElements?: HUDElement[];
  pointerPassthrough?: boolean;
}

interface HUDElement {
  id: string;
  type: 'nameTag' | 'statusIcon' | 'progressBar';
  characterId: string;
  screenPosition: { x: number; y: number };
  visible: boolean;
  data: Record<string, unknown>;
}
```

### HUD 坐标同步

```typescript
// UE → 前端的 HUD 坐标推送（通过 WebSocket）
interface HUDPositionUpdate {
  type: 'hud.positionUpdate';
  characters: Array<{
    characterId: string;
    screenX: number;  // 0.0 - 1.0 归一化坐标
    screenY: number;
    visible: boolean;
    distance: number; // 与镜头的距离，用于缩放
  }>;
}
```

### 事件穿透配置

```typescript
interface PointerConfig {
  passthroughZones: Array<{
    id: string;
    bounds: { top: number; left: number; width: number; height: number };
    passthrough: boolean;
  }>;
  defaultPassthrough: boolean;
}
```

## 正确性属性

1. **事件不丢失**：UI 元素上的点击事件不会穿透到视频流，视频流区域的点击不会被 UI 浮层拦截。
2. **HUD 同步性**：HUD 元素位置与视频流中角色位置的偏差不超过 2 像素（在 1080p 分辨率下）。
3. **渲染独立性**：UI 浮层的重渲染不触发视频流的重绘。

## 测试策略

- **单元测试**：OverlayContainer 的 z-index 分层、pointer-events 配置
- **集成测试**：HUD 元素跟随角色移动的坐标同步
- **交互测试**：验证 UI 区域点击拦截与空白区域穿透的正确性
