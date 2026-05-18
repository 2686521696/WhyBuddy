# 实现计划：LLM ReAct 循环内联展示

## 概述

在 MiroFishCardStream 的 reasoning-card 和 AgentReasoningSubTimeline 中，增加 ReAct 循环（思考→选工具→执行→观察→下一步）的阶段差异化展示和流式文本光标动画。

## 任务

- [ ] 1. 创建 useReActLoopState hook
  - [ ] 1.1 创建 `client/src/components/right-rail/react-loop/useReActLoopState.ts`
    - 消费 `useBlueprintRealtimeStore.agentReasoning.entries`
    - 解析 entry 为 `ReActPhase` 对象，识别 thinking/tool-selecting/executing/observing/next-step
    - 按 loopIndex 分组为 `ReActLoop[]`
    - 追踪当前流式阶段 `currentPhase` 和 `isStreaming` 状态
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1_
  - [ ] 1.2 创建 `client/src/components/right-rail/react-loop/types.ts`
    - 定义 `ReActPhase`、`ReActLoop`、`UseReActLoopStateReturn` 接口
    - 定义 `PHASE_CONFIG` 阶段视觉配置常量
    - _需求: 1.1_

- [ ] 2. 创建 ReActPhaseBlock 阶段块组件
  - [ ] 2.1 创建 `client/src/components/right-rail/react-loop/ReActPhaseBlock.tsx`
    - 左侧 2px 彩色竖条（border-l-2）+ 阶段图标 + 阶段标签
    - 内容区域使用 StreamingText 组件
    - tool-selecting 阶段额外显示 ToolSelectionBadge
    - 进入动画：framer-motion opacity: 0→1, x: -4→0, duration: 0.2
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 3.3_
  - [ ] 2.2 创建 `client/src/components/right-rail/react-loop/PhaseIndicator.tsx`
    - 显示阶段图标 + 中文标签
    - text-[10px] font-medium
    - 根据 PHASE_CONFIG 映射颜色
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 3. 创建 StreamingText 流式文本组件
  - [ ] 3.1 创建 `client/src/components/right-rail/react-loop/StreamingText.tsx`
    - 逐字显示文本内容
    - isStreaming 时末尾显示闪烁光标（CSS @keyframes react-cursor-blink）
    - 超过 maxLines(默认 4) 行时折叠，显示"展开"按钮
    - text-[11px] font-mono text-slate-700 leading-relaxed
    - _需求: 2.1, 2.2, 2.3, 2.4_
  - [ ] 3.2 添加 CSS `@keyframes react-cursor-blink` 到全局样式
    - opacity 0→1, 0.8s step-end infinite
    - prefers-reduced-motion 下改为静态 `|` 字符
    - _需求: 2.2, 2.4_

- [ ] 4. 创建 ReActLoopIterator 循环迭代器
  - [ ] 4.1 创建 `client/src/components/right-rail/react-loop/ReActLoopIterator.tsx`
    - 渲染多个 ReActLoop，每个 loop 包含多个 ReActPhaseBlock
    - 循环之间用虚线分隔（border-t border-dashed border-slate-200）
    - 超过 3 次循环时折叠中间循环，显示"展开 N 个循环"
    - _需求: 3.1, 3.2_

- [ ] 5. 集成到现有组件
  - [ ] 5.1 增强 `client/src/components/right-rail/cards/reasoning-card.tsx`
    - 在 reasoning-card 内部使用 ReActPhaseBlock 替代纯文本展示
    - 保持与现有 reasoning-card 的 variant 和 data-testid 兼容
    - _需求: 4.1_
  - [ ] 5.2 增强 `client/src/components/right-rail/AgentReasoningSubTimeline.tsx`（如存在）
    - 在展开详情时使用 ReActLoopIterator 展示完整循环
    - _需求: 4.2_
  - [ ] 5.3 实现自动滚动到最新条目
    - 使用 `scrollIntoView({ behavior: 'smooth', block: 'end' })` 
    - 仅在用户未手动滚动时触发
    - _需求: 4.3_

- [ ] 6. 编写测试
  - [ ] 6.1 编写 ReActPhaseBlock SSR 渲染测试
    - 使用 `react-dom/server` 的 `renderToString` 验证 5 种阶段渲染无报错
    - 验证各阶段的 border-l 颜色 className 正确
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ] 6.2 编写 StreamingText 折叠逻辑测试
    - 验证超过 maxLines 时显示折叠按钮
    - 验证 isStreaming 时光标元素存在
    - _需求: 2.2, 2.4_

## 注意事项

- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR
- 动画使用 framer-motion v12，光标使用 CSS @keyframes
- 不改后端协议，仅消费现有 `agentReasoning.entries`
- 右栏白底 light theme，文字使用 slate 色系
- 字号 10-12px 紧凑风格，代码字体 font-mono

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 4, "tasks": ["6.1", "6.2"] }
  ]
}
```
