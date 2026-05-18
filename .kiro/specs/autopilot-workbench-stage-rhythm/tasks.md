# 实现计划：阶段节奏感

## 概述

将 Autopilot 工作台从"6 阶段平铺 timeline"改造为"当前阶段独占视口 + framer-motion 切场动画"的节奏模式。核心改动集中在 `AutopilotRightRail.tsx` 与新增的 `StageViewport` 容器组件。

## 任务

- [x] 1. 创建 StageViewport 容器与 StageHeader 组件
  - [x] 1.1 创建 `right-rail/stage-viewport/StageViewport.tsx`，实现三段式布局（header + content + cta）
    - 使用 `flex flex-col h-full` 布局
    - StageContent 区域使用 `flex-1 overflow-y-auto`
    - _需求: 1.1, 1.2_
  - [x] 1.2 创建 `right-rail/stage-viewport/StageHeader.tsx`，实现固定顶部标题区
    - 展示 "STEP 0N · ENGLISH_LABEL" 英文步骤标识（font-mono text-[10px] opacity-60）
    - 展示中文大标题（text-sm font-semibold）
    - 使用 `sticky top-0 z-10 bg-black/20 backdrop-blur-sm` 定位
    - _需求: 3.1, 3.2, 3.3, 3.4_
  - [x] 1.3 定义 `STAGE_CONFIG` 常量，包含 6 阶段的 englishLabel、chineseTitle、ctaLabel、autoAdvance 配置
    - _需求: 5.1_

- [x] 2. 创建 StageCTA 底部固定行动栏
  - [x] 2.1 创建 `right-rail/stage-viewport/StageCTA.tsx`
    - 使用 `sticky bottom-0 z-10 bg-black/30 backdrop-blur-md border-t border-white/5` 定位
    - 主按钮使用 `w-full rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold py-2.5`
    - 支持 loading 态（animate-pulse + 进度文案）
    - 支持 readOnly 态（只读提示文案，不可点击）
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 3. 实现 framer-motion 阶段切场动画
  - [x] 3.1 创建 `right-rail/stage-viewport/StageTransitionWrapper.tsx`
    - 使用 `AnimatePresence mode="wait"` 包裹 StageViewport
    - 正向推进使用 x: 30% → 0 → -30% 方向（右→左滑入）
    - 回看使用 x: -30% → 0 → 30% 方向（左→右滑入）
    - transition 使用 tween easeInOut duration 0.35s
    - _需求: 2.1, 2.2, 2.3_
  - [x] 3.2 实现过渡期间交互禁用
    - 使用 `isTransitioning` state 在动画期间禁用 StageCTA 按钮
    - 通过 `onExitComplete` 回调重置状态
    - _需求: 2.4_

- [x] 4. 改造 AutopilotRightRail 集成 StageViewport
  - [x] 4.1 改造 `AutopilotRightRail.tsx`，移除平铺 timeline 渲染逻辑
    - 使用 `resolveRailSubStage` 计算 activeStageIndex
    - 将 6 个阶段内容组件作为 StageViewport children 传入
    - _需求: 1.1, 5.1_
  - [x] 4.2 实现已完成阶段数据快照缓存
    - 使用 `useRef` 或 `useMemo` 在 AutopilotRightRail 层级缓存已完成阶段数据
    - 回看时从缓存读取而非重新请求
    - _需求: 1.4_
  - [x] 4.3 实现阶段推进逻辑
    - StageCTA onAction 触发 activeStageIndex + 1
    - 禁止跳过中间阶段
    - 回看时允许查看但不允许修改
    - _需求: 1.3, 5.2, 5.3_

- [ ] 5. 检查点 — 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [ ]* 5.1 编写 StageViewport SSR 渲染测试
  - 使用 `react-dom/server` 的 `renderToString` 验证 StageViewport 服务端渲染无报错
  - _需求: 1.1_

- [ ]* 5.2 编写阶段切换与 CTA 禁用测试
  - 验证 stageKey 变化时 AnimatePresence 正确触发
  - 验证过渡动画期间按钮 disabled 状态
  - _需求: 2.4, 4.2_

- [ ]* 5.3 编写阶段顺序不可变属性测试
  - **Property 2: 阶段顺序不可变**
  - **验证: 需求 5.2**

- [ ]* 5.4 编写 CTA 与阶段状态同步属性测试
  - **Property 4: CTA 与阶段状态同步**
  - **验证: 需求 4.2, 4.5**

## 注意事项

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- framer-motion 仅用于阶段切场动画，卡片微动画使用 CSS
- 不改后端协议，不改 socket 事件格式
- 不改 6 阶段流程顺序
- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4"] }
  ]
}
```
