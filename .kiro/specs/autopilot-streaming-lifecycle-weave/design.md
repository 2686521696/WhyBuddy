# 设计文档：流式输出贯穿全生命周期

## 设计概述

建立统一的流式输出协调层，将 Socket.IO 推送的 streaming token 分发到 StageProgressIndicator、MiroFishCardStream、AgentReasoningSubTimeline 和 3D HUD 四个消费端。通过共享的 `useStreamingWeave` hook 管理流状态、中断检测和恢复逻辑。使用 requestAnimationFrame 批量合并高频更新。

## 组件架构

```
useStreamingWeave (新增：流式协调层)
├── StreamTokenBuffer              ← 新增：token 缓冲与批量分发
├── StreamInterruptionDetector     ← 新增：中断检测器
└── StreamResumeHandler            ← 新增：恢复处理器

消费端:
├── StageProgressIndicator (已有，增强)
│   └── StreamingProgressOverlay   ← 新增：流式进度叠加层
├── MiroFishCardStream (已有，增强)
│   └── StreamingCardContent       ← 新增：流式卡片内容
├── AgentReasoningSubTimeline (已有，增强)
│   └── StreamingTimelineEntry     ← 新增：流式时间线条目
└── SceneStageFlow (已有，增强)
    └── StreamingZoneIndicator     ← 新增：zone 流式活动指示
```

## 数据流

```
Socket.IO streaming tokens
  → useStreamingWeave (协调层)
    → StreamTokenBuffer (批量合并，RAF 节流)
      → 分发到 4 个消费端:
        1. StageProgressIndicator → 进度更新
        2. MiroFishCardStream → 卡片内容追加
        3. AgentReasoningSubTimeline → 时间线条目更新
        4. SceneStageFlow → zone 活动指示

中断检测:
  StreamInterruptionDetector
    → 500ms 无 token → 显示中断提示
    → 10s 无 token → 显示重连状态
    → token 恢复 → 清除提示，合并补偿数据
```

### useStreamingWeave hook

```typescript
interface StreamingWeaveState {
  isStreaming: boolean;
  isInterrupted: boolean;
  isReconnecting: boolean;
  currentStageIndex: number;
  tokenCount: number;
  lastTokenAt: number;
  bufferSize: number;
}

interface UseStreamingWeaveReturn {
  state: StreamingWeaveState;
  subscribe: (consumerId: string, callback: (tokens: string[]) => void) => () => void;
  getProgress: () => number;  // 0-100
  getInterruptionDuration: () => number;  // ms
}
```

## 关键接口

```typescript
/** Token 缓冲配置 */
interface StreamTokenBufferConfig {
  maxBatchSize: number;       // 默认 10
  flushIntervalMs: number;    // 默认 16 (1 frame)
  maxBufferSize: number;      // 默认 100
}

/** 中断检测配置 */
interface InterruptionConfig {
  warningThresholdMs: number;   // 默认 500
  reconnectThresholdMs: number; // 默认 10000
  maxRetries: number;           // 默认 3
}

/** 流式进度叠加层属性 */
interface StreamingProgressOverlayProps {
  isStreaming: boolean;
  isInterrupted: boolean;
  progress: number;
}
```

## 样式方案

- 流式进度叠加：
  - 正常流式：`bg-gradient-to-r from-blue-500/20 to-transparent` 脉冲动画
  - 中断态：`bg-amber-500/10` + 警告图标
  - 重连态：`bg-red-500/10` + 旋转图标
- 中断提示：
  - `text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded`
- 流式活动指示（3D zone）：
  - 微弱脉冲发光 `emissive pulse, 0.5s`
- 性能优化：
  - requestAnimationFrame 批量更新
  - React.memo + useRef 避免不必要 re-render
  - 超过 1000 字符时使用 CSS `content-visibility: auto`
