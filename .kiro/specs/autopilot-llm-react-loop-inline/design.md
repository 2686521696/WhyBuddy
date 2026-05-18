# 设计文档：LLM ReAct 循环内联展示

## 设计概述

在 `MiroFishCardStream` 的 reasoning-card 和 `AgentReasoningSubTimeline` 中，增加 ReAct 循环阶段的视觉差异化展示。每个阶段通过左侧彩色竖条、阶段图标和流式文本光标区分。消费 `useBlueprintRealtimeStore.agentReasoning.entries` 驱动渲染。

## 组件架构

```
MiroFishCardStream (已有)
├── reasoning-card (已有，增强)
│   └── ReActPhaseBlock × N         ← 新增：ReAct 阶段块
│       ├── PhaseIndicator          ← 新增：阶段指示器（竖条+图标）
│       ├── StreamingText           ← 新增：流式文本展示
│       └── ToolSelectionBadge      ← 新增：工具选择标签

AgentReasoningSubTimeline (已有，增强)
├── ReActLoopIterator               ← 新增：循环迭代器
│   ├── ReActPhaseBlock × N
│   └── LoopSeparator              ← 新增：循环分隔线
```

## 数据流

```
useBlueprintRealtimeStore.agentReasoning.entries
  → useReActLoopState (新增 hook)
    → ReActPhaseBlock (阶段块渲染)
    → StreamingText (流式文本)
    → ReActLoopIterator (循环迭代)
```

### useReActLoopState hook

```typescript
interface ReActPhase {
  id: string;
  type: 'thinking' | 'tool-selecting' | 'executing' | 'observing' | 'next-step';
  content: string;
  isStreaming: boolean;
  toolName?: string;
  loopIndex: number;
  timestamp: number;
}

interface ReActLoop {
  index: number;
  phases: ReActPhase[];
  isComplete: boolean;
}

interface UseReActLoopStateReturn {
  loops: ReActLoop[];
  currentPhase: ReActPhase | null;
  isStreaming: boolean;
  totalLoops: number;
}
```

## 关键接口

```typescript
/** 阶段视觉配置 */
const PHASE_CONFIG: Record<string, { borderColor: string; icon: string; label: string }> = {
  thinking: { borderColor: 'border-l-violet-500', icon: '💭', label: '思考' },
  'tool-selecting': { borderColor: 'border-l-amber-500', icon: '🔍', label: '选工具' },
  executing: { borderColor: 'border-l-orange-500', icon: '⚙️', label: '执行' },
  observing: { borderColor: 'border-l-teal-500', icon: '👁', label: '观察' },
  'next-step': { borderColor: 'border-l-slate-400', icon: '→', label: '下一步' },
};

/** 流式文本属性 */
interface StreamingTextProps {
  content: string;
  isStreaming: boolean;
  maxLines?: number;  // 默认 4
}
```

## 样式方案

- 阶段块：`border-l-2 pl-2 py-1` + 对应阶段色
- 流式光标：CSS `@keyframes react-cursor-blink`（opacity 0→1, 0.8s step-end infinite）
- 文本：`text-[11px] font-mono text-slate-700 leading-relaxed`
- 工具标签：`inline-flex px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600`
- 循环分隔线：`border-t border-dashed border-slate-200 my-2`
- 折叠按钮：`text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer`
- 进入动画：framer-motion `opacity: 0→1, x: -4→0, duration: 0.2`
- prefers-reduced-motion：动画 duration 设为 0，光标改为静态 `|` 字符
