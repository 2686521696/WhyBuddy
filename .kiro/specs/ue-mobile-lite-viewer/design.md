# 设计文档：移动端轻量查看器

## 概述

移动端轻量查看器为手机和平板提供只读的场景查看体验。设计上采用"设备检测 → 模式选择 → 适配渲染"的流程，根据设备能力自动选择预渲染视频或低分辨率流。

关键设计决策：
- 移动端不启动完整 WebRTC 推流，降低功耗
- 预渲染视频使用 HLS 格式，支持自适应码率
- 触摸手势使用 Hammer.js 或原生 Touch API

## 架构

```
设备检测
    │
    ├──(手机)──→ 预渲染视频播放器
    │
    └──(平板)──→ 低分辨率流播放器
                      │
                      ▼
              触摸手势适配层
```

## 组件与接口

### 设备检测

```typescript
interface DeviceProfile {
  type: 'phone' | 'tablet' | 'desktop';
  screenSize: { width: number; height: number };
  pixelRatio: number;
  hasGPU: boolean;
  networkType: string;
}
```

### MobileLiteViewer Props

```typescript
interface MobileLiteViewerProps {
  missionId: string;
  mode?: 'auto' | 'prerender' | 'low-stream';
  onCharacterTap?: (characterId: string) => void;
}
```

## 正确性属性

1. **模式自动选择**：手机设备必须选择预渲染模式，不尝试 WebRTC。
2. **手势不冲突**：触摸手势不与页面滚动冲突。

## 测试策略

- **设备测试**：在 iOS Safari 和 Android Chrome 上验证视频播放
- **手势测试**：验证旋转、缩放、点击手势的响应
- **性能测试**：验证移动端内存和电量消耗
