# 设计文档：录制与回放导出

## 概述

录制与回放导出系统负责将 UE5 实时演出录制为视频 clip，并与现有 replay 系统对接。设计上采用"指令录制 + 视频捕获 + 导出编码"三层架构。

关键设计决策：
- 指令录制在 Node.js 侧完成，记录时间线和指令序列
- 视频捕获使用 UE5 Movie Render Queue 或 Pixel Streaming 录制
- 导出使用 FFmpeg 编码，支持 MP4 / GIF / PNG 序列

## 组件与接口

### 录制会话

```typescript
interface RecordingSession {
  sessionId: string;
  startTime: number;
  commands: Array<{ time: number; command: SceneCommand }>;
  events: Array<{ time: number; event: UEEvent }>;
  videoPath?: string;
}
```

### 导出配置

```typescript
interface ExportConfig {
  format: 'mp4' | 'gif' | 'png-sequence' | 'screenshot';
  resolution: { width: number; height: number };
  fps?: number;
  quality?: 'high' | 'medium' | 'low';
  startTime?: number;
  endTime?: number;
}
```

## 正确性属性

1. **时间线一致**：回放时指令执行的时间间隔与录制时一致（误差 ≤ 50ms）。
2. **导出完整**：导出的视频时长等于录制时长。

## 测试策略

- **单元测试**：指令录制与回放的时间线精度
- **集成测试**：录制 → 回放 → 导出的完整流程
- **视觉测试**：导出视频与实时画面的一致性对比
