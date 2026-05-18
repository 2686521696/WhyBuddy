# 设计文档：进度节奏可视化

## 设计概述

本设计将 Autopilot 工作台的进度展示从纯文字 chip 升级为"步骤指示器 + 阶段内进度条"的组合形态。`StageProgressIndicator` 组件固定在 `StageHeader` 内部，通过 6 个 `StepDot` 圆点序列展示阶段完成状态，通过 2px 线性 `ProgressBar` 展示当前阶段内的细粒度进度。数据由 socket `agentReasoning` entries 驱动，进度计算支持确定态（已知总步骤数）和不确定态（对数增长模拟）两种模式。

## 组件架构

```
StageHeader (来自 autopilot-workbench-stage-rhythm)
└── StageProgressIndicator (新增)
    ├── StepIndicator (水平圆点序列)
    │   ├── StepDot × 6 (completed / active / pending)
    │   ├── ConnectorLine × 5 (相邻圆点间连接线)
    │   └── StepLabel × 6 (阶段简称，响应式隐藏)
    └── ProgressBar (线性进度条)
        ├── ProgressTrack (背景轨道)
        ├── ProgressFill (填充条 + 发光效果)
        └── IndeterminateBar (不确定态动画条)
```

### 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| `StageProgressIndicator` | 进度指示器主容器，组合 StepIndicator 与 ProgressBar | `right-rail/stage-progress/StageProgressIndicator.tsx` |
| `StepIndicator` | 6 圆点水平序列 + 连接线 + 标签 | `right-rail/stage-progress/StepIndicator.tsx` |
| `StepDot` | 单个圆点，三态视觉 | `right-rail/stage-progress/StepDot.tsx` |
| `ProgressBar` | 线性进度条，支持确定态与不确定态 | `right-rail/stage-progress/ProgressBar.tsx` |
| `useStageProgress` | 进度计算 hook，消费 store entries | `right-rail/stage-progress/useStageProgress.ts` |

## 数据流

```
socket agentReasoning entries
  ↓
useBlueprintRealtimeStore.agentReasoning.entries
  ↓
useStageProgress(entries, currentStage)
  ├── completedStages: Set<WorkbenchStage>
  ├── activeStage: WorkbenchStage
  ├── stageProgress: number (0-100)
  └── isIndeterminate: boolean
  ↓
StageProgressIndicator
  ├── StepIndicator (completedStages, activeStage)
  │   ├── StepDot × 6 (status derived from completedStages + activeStage)
  │   └── ConnectorLine × 5 (completed if left dot is completed)
  └── ProgressBar (stageProgress, isIndeterminate)
```

### 进度计算逻辑

```typescript
interface StageProgressState {
  completedStages: Set<WorkbenchStage>;
  activeStage: WorkbenchStage;
  stageProgress: number;       // 0-100
  isIndeterminate: boolean;
}

// 阶段预估 entry 总数（可配置）
const STAGE_ESTIMATED_ENTRIES: Record<WorkbenchStage, number | null> = {
  input: 1,
  clarification: null,         // 不确定，使用对数增长
  route: 8,
  spec_tree: 12,
  spec_documents: null,        // 不确定，使用对数增长
  effect_preview: 5,
};

function computeStageProgress(
  entriesInStage: number,
  estimatedTotal: number | null
): { progress: number; isIndeterminate: boolean } {
  if (estimatedTotal === null) {
    // 对数增长曲线：快速到 60%，然后逐渐放缓
    // progress = 60 * (1 - 1/(1 + ln(1 + entries)))
    const progress = Math.min(
      95,
      60 * (1 - 1 / (1 + Math.log(1 + entriesInStage)))
    );
    return { progress, isIndeterminate: true };
  }
  const progress = Math.min(100, (entriesInStage / estimatedTotal) * 100);
  return { progress, isIndeterminate: false };
}
```

## 关键接口

```typescript
// StageProgressIndicator props
interface StageProgressIndicatorProps {
  completedStages: Set<WorkbenchStage>;
  activeStage: WorkbenchStage;
  stageProgress: number;       // 0-100
  isIndeterminate: boolean;
  locale: AppLocale;
}

// StepDot props
type StepDotStatus = 'completed' | 'active' | 'pending';

interface StepDotProps {
  status: StepDotStatus;
  index: number;
}

// ProgressBar props
interface ProgressBarProps {
  progress: number;            // 0-100
  isIndeterminate: boolean;
  isComplete: boolean;         // 触发完成闪光
}

// useStageProgress hook
function useStageProgress(
  entries: AgentReasoningEntry[],
  currentStage: WorkbenchStage
): StageProgressState;

// 阶段简称配置
const STAGE_SHORT_LABELS: Record<WorkbenchStage, { zh: string; en: string }> = {
  input: { zh: '输入', en: 'Input' },
  clarification: { zh: '澄清', en: 'Clarify' },
  route: { zh: '路线', en: 'Route' },
  spec_tree: { zh: '树', en: 'Tree' },
  spec_documents: { zh: '文档', en: 'Docs' },
  effect_preview: { zh: '预览', en: 'Preview' },
};
```

## 样式方案

### StageProgressIndicator 容器

| 元素 | 样式 |
|------|------|
| 外层 | `bg-black/20 backdrop-blur-sm rounded-md px-4 py-2 max-h-[40px]` |
| 内层 | `flex flex-col items-center gap-1.5` |

### StepIndicator

| 元素 | 样式 |
|------|------|
| 容器 | `flex items-center justify-center gap-0 w-full` |
| StepDot (pending) | `w-1.5 h-1.5 rounded-full border border-white/20 bg-transparent` |
| StepDot (active) | `w-1.5 h-1.5 rounded-full bg-indigo-400 relative` |
| StepDot (active) 脉冲环 | `absolute inset-[-2px] rounded-full border border-indigo-400/50 animate-mirofish-pulse` |
| StepDot (completed) | `w-1.5 h-1.5 rounded-full bg-indigo-400` + 内部 ✓ 图标 |
| ConnectorLine (completed) | `flex-1 h-px bg-indigo-400 mx-1` |
| ConnectorLine (pending) | `flex-1 h-px border-t border-dashed border-white/10 mx-1` |
| StepLabel | `text-[9px] font-mono text-white/40 mt-0.5` |

### ProgressBar

| 元素 | 样式 |
|------|------|
| 轨道 | `w-full h-[2px] rounded-full bg-white/5 overflow-hidden` |
| 填充条 | `h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300` |
| 填充端发光 | `shadow-[0_0_6px_rgba(99,102,241,0.4)]` |
| 不确定态条 | `h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-indigo-400 to-transparent animate-indeterminate` |

### 响应式

| 断点 | 行为 |
|------|------|
| `≥ 640px` | 完整展示 StepDot + StepLabel + ProgressBar |
| `< 640px` | 隐藏 StepLabel，仅保留 StepDot 序列 + ProgressBar |

## 动画方案

### StepDot 脉冲（active 状态）

```css
@keyframes mirofish-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
}
.animate-mirofish-pulse {
  animation: mirofish-pulse 2s ease-in-out infinite;
}
```

### StepDot 填充过渡（pending → active）

```css
@keyframes mirofish-dot-fill {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.animate-mirofish-dot-fill {
  animation: mirofish-dot-fill 300ms ease-out both;
}
```

### ProgressBar 不确定态

```css
@keyframes mirofish-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.animate-indeterminate {
  animation: mirofish-indeterminate 1.5s ease-in-out infinite;
}
```

### ProgressBar 完成闪光

```css
@keyframes mirofish-progress-complete {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
  50% { box-shadow: 0 0 8px 2px rgba(99, 102, 241, 0.3); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}
.animate-progress-complete {
  animation: mirofish-progress-complete 600ms ease-out;
}
```

### prefers-reduced-motion 降级

```css
@media (prefers-reduced-motion: reduce) {
  .animate-mirofish-pulse,
  .animate-mirofish-dot-fill,
  .animate-indeterminate,
  .animate-progress-complete {
    animation: none;
  }
}
```

## 测试策略

- **SSR 渲染测试**：`renderToString` 验证 StageProgressIndicator 在服务端渲染无报错
- **进度计算测试**：vitest 验证 `computeStageProgress` 在确定态和不确定态下的输出范围
- **阶段状态测试**：验证 completedStages 变化时 StepDot 状态正确切换
- **响应式测试**：验证 `< 640px` 时 StepLabel 不渲染

## Correctness Properties

### Property 1: 进度值范围约束

*For any* `computeStageProgress` 的输入（entriesInStage ≥ 0, estimatedTotal ≥ 1 或 null），输出的 progress SHALL 在 [0, 100] 闭区间内。

**Validates: Requirements 2.3, 4.2**

### Property 2: 阶段状态互斥性

*For any* 给定的 activeStage，6 个 StepDot 中 SHALL 恰好有 1 个处于 `active` 状态，0 到 5 个处于 `completed` 状态，其余处于 `pending` 状态，且 completed 的 index 均小于 active 的 index。

**Validates: Requirements 1.2**

### Property 3: 对数增长单调递增

*For any* 不确定态进度计算，当 entriesInStage 从 n 增加到 n+1 时，输出的 progress SHALL 严格大于 n 时的值（单调递增）。

**Validates: Requirements 4.3**

### Property 4: 阶段完成触发 100%

*For any* 阶段从 active 变为 completed 的时刻，ProgressBar 的 progress SHALL 在 200ms 内达到 100。

**Validates: Requirements 2.5**
