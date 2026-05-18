# 设计文档：阶段节奏感

## 设计概述

本设计将 Autopilot 工作台从"6 阶段平铺 timeline"改造为"当前阶段独占视口 + 切场动画"的节奏模式。核心改动集中在 `AutopilotRightRail.tsx` 与新增的 `StageViewport` 容器组件，利用 framer-motion `AnimatePresence` 实现阶段间的方向性滑动过渡，同时在顶部固定 `StageHeader`、底部固定 `StageCTA`，形成"标题 → 内容 → 行动"的三段式阶段节奏。

## 组件架构

```
AutopilotRightRail (改造)
├── StageProgressIndicator (来自 autopilot-stage-progress-indicator)
├── StageViewport (新增)
│   ├── StageHeader (新增)
│   │   ├── StepLabel (STEP 0N · ENGLISH_LABEL)
│   │   └── ChineseTitle (中文大标题)
│   ├── StageContent (新增，flex-1 overflow-y-auto)
│   │   └── [当前阶段的具体内容组件]
│   └── StageCTA (新增，sticky bottom)
│       └── PrimaryButton / LoadingState / ReadOnlyHint
└── AnimatePresence (framer-motion，包裹 StageViewport)
```

### 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| `StageViewport` | 阶段独占容器，管理三段式布局 | `right-rail/stage-viewport/StageViewport.tsx` |
| `StageHeader` | 固定顶部标题区，展示步骤编号与中文标题 | `right-rail/stage-viewport/StageHeader.tsx` |
| `StageCTA` | 固定底部行动栏，承载主操作按钮 | `right-rail/stage-viewport/StageCTA.tsx` |
| `StageTransitionWrapper` | AnimatePresence + motion.div 包裹层 | `right-rail/stage-viewport/StageTransitionWrapper.tsx` |

## 数据流

```
socket agentReasoning entries
  ↓
useBlueprintRealtimeStore (现有)
  ↓
AutopilotRightRail (props: currentStage / currentSubStage)
  ↓ resolveRailSubStage → activeStageIndex
  ↓
StageTransitionWrapper (key={activeStageIndex}, direction=forward|backward)
  ↓ AnimatePresence mode="wait"
  ↓
StageViewport
  ├── StageHeader (stageIndex, stageLabel)
  ├── StageContent (children = 当前阶段内容)
  └── StageCTA (action, loading, onAdvance)
```

### 阶段数据快照

已完成阶段的数据通过 `useRef` 或 `useMemo` 缓存在 `AutopilotRightRail` 层级，当用户通过进度指示器回看时，从缓存中读取而非重新请求。

## 关键接口

```typescript
// StageViewport props
interface StageViewportProps {
  stageIndex: number;          // 0-5
  stageKey: WorkbenchStage;    // 'input' | 'clarification' | ...
  children: ReactNode;         // 当前阶段内容
}

// StageHeader props
interface StageHeaderProps {
  stageIndex: number;
  englishLabel: string;        // 'INPUT' | 'CLARIFICATION' | ...
  chineseTitle: string;        // '需求输入' | '智能澄清' | ...
  isActive: boolean;
}

// StageCTA props
interface StageCTAProps {
  label: string;               // '开始澄清' | '生成路线' | ...
  loading: boolean;
  disabled: boolean;
  readOnly?: boolean;          // 自动流式生成中，展示只读提示
  readOnlyHint?: string;
  onAction: () => void;
}

// StageTransitionWrapper props
interface StageTransitionWrapperProps {
  stageKey: string;            // AnimatePresence key
  direction: 'forward' | 'backward';
  children: ReactNode;
}

// 阶段配置常量
const STAGE_CONFIG: Record<WorkbenchStage, {
  englishLabel: string;
  chineseTitle: string;
  ctaLabel: string;
  autoAdvance: boolean;        // 是否自动推进（无需用户点击 CTA）
}>;
```

## 样式方案

| 元素 | 样式 |
|------|------|
| StageViewport 容器 | `flex flex-col h-full` |
| StageHeader | `sticky top-0 z-10 bg-black/20 backdrop-blur-sm px-4 py-3` |
| StageHeader 英文标识 | `font-mono text-[10px] text-white/60 uppercase tracking-wider` |
| StageHeader 中文标题 | `text-sm font-semibold text-white` |
| StageContent | `flex-1 overflow-y-auto px-4 py-3` |
| StageCTA 容器 | `sticky bottom-0 z-10 bg-black/30 backdrop-blur-md border-t border-white/5 px-4 py-3` |
| StageCTA 主按钮 | `w-full rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold py-2.5 transition` |
| StageCTA loading 态 | `animate-pulse opacity-70` + 进度文案 |

## 动画方案

### 阶段切场（framer-motion AnimatePresence）

```typescript
// StageTransitionWrapper 内部
const variants = {
  enter: (direction: 'forward' | 'backward') => ({
    x: direction === 'forward' ? '30%' : '-30%',
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: 'forward' | 'backward') => ({
    x: direction === 'forward' ? '-30%' : '30%',
    opacity: 0,
  }),
};

const transition = {
  type: 'tween',
  ease: 'easeInOut',
  duration: 0.35,  // 350ms，在 300-500ms 范围内
};

// 使用
<AnimatePresence mode="wait" custom={direction}>
  <motion.div
    key={stageKey}
    custom={direction}
    variants={variants}
    initial="enter"
    animate="center"
    exit="exit"
    transition={transition}
  >
    <StageViewport ... />
  </motion.div>
</AnimatePresence>
```

### 过渡期间禁用交互

```typescript
const [isTransitioning, setIsTransitioning] = useState(false);

// AnimatePresence onExitComplete
<AnimatePresence
  mode="wait"
  onExitComplete={() => setIsTransitioning(false)}
>
  ...
</AnimatePresence>

// StageCTA 按钮
<button disabled={isTransitioning || loading} ... />
```

## 测试策略

- **SSR 渲染测试**：使用 `react-dom/server` 的 `renderToString` 验证 StageViewport 在服务端渲染时不报错
- **阶段切换测试**：vitest + @testing-library/react 验证 stageKey 变化时 AnimatePresence 正确触发进入/退出
- **CTA 禁用测试**：验证过渡动画期间按钮 disabled 状态
- **数据快照测试**：验证回看已完成阶段时内容正确恢复

## Correctness Properties

### Property 1: 阶段独占性

*For any* 给定的 activeStageIndex，StageViewport 渲染的内容 SHALL 仅包含该阶段对应的组件，其余 5 个阶段的内容不出现在 DOM 中。

**Validates: Requirements 1.1**

### Property 2: 阶段顺序不可变

*For any* 阶段推进操作，目标阶段的 index SHALL 严格等于当前阶段 index + 1，不允许跳跃。

**Validates: Requirements 5.2**

### Property 3: 切场方向一致性

*For any* 阶段切换，若目标 index > 当前 index 则 direction 为 'forward'（右→左滑入），若目标 index < 当前 index 则 direction 为 'backward'（左→右滑入）。

**Validates: Requirements 2.2, 2.3**

### Property 4: CTA 与阶段状态同步

*For any* 阶段配置，若 `autoAdvance` 为 true 则 StageCTA 渲染为只读提示；若为 false 则渲染为可点击按钮。

**Validates: Requirements 4.2, 4.5**
