# 实现计划：进度节奏可视化

## 概述

将 Autopilot 工作台的进度展示从纯文字 chip 升级为"步骤指示器 + 阶段内进度条"的组合形态。`StageProgressIndicator` 组件固定在 `StageHeader` 内部，通过 6 个 StepDot 圆点序列展示阶段完成状态，通过 2px 线性 ProgressBar 展示当前阶段内的细粒度进度。进度计算基于 entries 计数，支持确定态与不确定态（对数增长）两种模式。

## 任务

- [x] 1. 创建 useStageProgress 进度计算 hook
  - [x] 1.1 创建 `right-rail/stage-progress/useStageProgress.ts`
    - 消费 `useBlueprintRealtimeStore.agentReasoning.entries`
    - 根据 entry.stage 变化计算 completedStages / activeStage
    - 实现 `computeStageProgress` 函数：
      - 确定态：`entriesInStage / estimatedTotal × 100`
      - 不确定态：对数增长曲线 `60 * (1 - 1/(1 + ln(1 + entries)))`，上限 95
    - 定义 `STAGE_ESTIMATED_ENTRIES` 配置（input:1, clarification:null, route:8, spec_tree:12, spec_documents:null, effect_preview:5）
    - _需求: 4.1, 4.2, 4.3, 4.4_

- [x] 2. 创建 StepIndicator 步骤圆点序列
  - [x] 2.1 创建 `right-rail/stage-progress/StepIndicator.tsx`
    - 水平排列 6 个 StepDot
    - 5 条 ConnectorLine 连接相邻圆点
    - 每个 StepDot 下方展示阶段简称标签（text-[9px] font-mono text-white/40）
    - _需求: 1.1, 1.5_
  - [x] 2.2 创建 `right-rail/stage-progress/StepDot.tsx`
    - 三种视觉状态：completed（实心 + ✓）、active（实心 + 脉冲环）、pending（空心）
    - pending → active 时使用 CSS scale(0→1) + opacity(0→1) 填充动画 300ms
    - active 态脉冲环使用 @keyframes mirofish-pulse（scale 1→1.4→1, 2s infinite）
    - _需求: 1.2, 1.4, 5.2, 5.5_
  - [x] 2.3 实现 ConnectorLine 连接线
    - completed 段使用主题色实线（bg-indigo-400）
    - pending 段使用 border-dashed border-white/10 虚线
    - _需求: 1.3_

- [x] 3. 创建 ProgressBar 线性进度条
  - [x] 3.1 创建 `right-rail/stage-progress/ProgressBar.tsx`
    - 2px 高度线性进度条
    - 背景轨道 bg-white/5，填充条 bg-gradient-to-r from-indigo-500 to-purple-500
    - 填充端发光效果 shadow-[0_0_6px_rgba(99,102,241,0.4)]
    - transition-all duration-300 平滑过渡
    - _需求: 2.1, 2.2, 2.4_
  - [x] 3.2 实现不确定态动画
    - 使用 @keyframes mirofish-indeterminate（translateX -100% → 300%, 1.5s infinite）
    - 渐变条 w-1/3 从左到右循环滑动
    - _需求: 2.6_
  - [x] 3.3 实现完成闪光效果
    - 阶段完成时 200ms 内填充至 100%
    - 触发 @keyframes mirofish-progress-complete（box-shadow 闪光 600ms）
    - _需求: 2.5_

- [x] 4. 创建 StageProgressIndicator 主容器
  - [x] 4.1 创建 `right-rail/stage-progress/StageProgressIndicator.tsx`
    - 组合 StepIndicator + ProgressBar
    - 总高度不超过 40px
    - 使用 bg-black/20 backdrop-blur-sm 深色半透明背景
    - 水平居中，左右 16px 边距
    - _需求: 3.1, 3.2, 3.3, 5.1_
  - [x] 4.2 实现响应式行为
    - ≥640px 展示完整 StepDot + StepLabel + ProgressBar
    - <640px 隐藏 StepLabel，仅保留 StepDot + ProgressBar
    - _需求: 3.4_

- [x] 5. 添加 CSS 动画与 prefers-reduced-motion 降级
  - [x] 5.1 在全局 CSS 或 Tailwind 配置中添加自定义 @keyframes
    - `mirofish-pulse`（2s ease-in-out infinite）
    - `mirofish-dot-fill`（300ms ease-out）
    - `mirofish-indeterminate`（1.5s ease-in-out infinite）
    - `mirofish-progress-complete`（600ms ease-out）
    - _需求: 1.4, 2.4, 2.5, 2.6, 5.5_
  - [x] 5.2 添加 `prefers-reduced-motion` 媒体查询降级
    - 所有自定义动画在 reduced-motion 下设为 `animation: none`
    - _需求: 5.5（隐含无障碍要求）_

- [x] 6. 集成到 StageHeader
  - [x] 6.1 将 StageProgressIndicator 集成到 `StageHeader` 内部
    - 固定在 StageHeader 中，不随内容滚动
    - 与 StageHeader 的步骤标识和中文标题协调布局
    - _需求: 3.1_

- [ ] 7. 检查点 — 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [ ]* 7.1 编写 StageProgressIndicator SSR 渲染测试
  - 使用 `react-dom/server` 的 `renderToString` 验证服务端渲染无报错
  - _需求: 3.1_

- [ ]* 7.2 编写 computeStageProgress 进度计算测试
  - **Property 1: 进度值范围约束**
  - 验证任意输入下 progress 在 [0, 100] 闭区间内
  - **验证: 需求 2.3, 4.2**

- [ ]* 7.3 编写阶段状态互斥性测试
  - **Property 2: 阶段状态互斥性**
  - 验证恰好 1 个 active，0-5 个 completed，其余 pending，且 completed index < active index
  - **验证: 需求 1.2**

- [ ]* 7.4 编写对数增长单调递增测试
  - **Property 3: 对数增长单调递增**
  - 验证不确定态下 entries 增加时 progress 严格递增
  - **验证: 需求 4.3**

- [ ]* 7.5 编写阶段完成触发 100% 测试
  - **Property 4: 阶段完成触发 100%**
  - 验证阶段从 active 变为 completed 时 progress 达到 100
  - **验证: 需求 2.5**

## 注意事项

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 进度计算基于 entries 计数，不改后端协议
- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR
- 不改 6 阶段流程顺序
- CSS 动画用于进度指示器，framer-motion 不在此 spec 使用

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "5.2"] },
    { "id": 2, "tasks": ["4.1", "4.2"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] }
  ]
}
```
