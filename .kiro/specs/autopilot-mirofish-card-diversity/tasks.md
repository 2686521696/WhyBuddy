# 实现计划：卡片形态多样性

## 概述

为 MiroFishCardStream 中 6 类卡片定义独立视觉形态，通过差异化布局、图标、色彩标记和 CSS 微动画让信息流从"同质化列表"升级为"可扫视的多形态卡片流"。所有微动画使用 CSS transition / @keyframes，不依赖 framer-motion。

## 任务

- [x] 1. 扩展 MiroFishCardShell variant 系统
  - [x] 1.1 改造 `cards/card-shell.tsx`，新增 `variant` prop
    - 支持 `default / compact / minimal / glow` 四种外壳变体
    - default: 标准圆角边框内边距
    - compact: 更小垂直内边距（py-1.5）
    - minimal: 无边框无背景
    - glow: 带微弱发光 box-shadow
    - _需求: 1.1, 2.5, 3.1, 5.3, 6.2_

- [x] 2. 实现 6 类独立卡片组件
  - [x] 2.1 创建 `cards/reasoning-card.tsx`
    - 左侧 2px 渐变竖条（thinking 蓝紫、observing 青绿、acting 橙黄）
    - font-mono text-[11px] 文本
    - 流式光标闪烁（CSS @keyframes mirofish-blink）
    - 进入动画 opacity 0→1 + translateY(4px→0) duration 200ms
    - _需求: 1.1, 1.2, 1.3, 1.4_
  - [x] 2.2 创建 `cards/capability-card.tsx`
    - 横向紧凑布局：图标(16×16) + 能力名称 + 状态徽章
    - 差异化图标映射（Docker/MCP/AIGC/角色）
    - invoking 态图标 animate-spin
    - failed 态红色边框
    - py-1.5 紧凑内边距
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 2.3 创建 `cards/route-decision-card.tsx`
    - 发光边框 box-shadow: 0 0 8px rgba(主题色, 0.15)
    - 顶部决策标签 text-[10px] uppercase tracking-wider
    - 路线名称 text-xs font-medium
    - 进入动画 scale(0.95→1) + opacity(0→1) duration 250ms
    - _需求: 3.1, 3.2, 3.3, 3.4_
  - [x] 2.4 创建 `cards/artifact-card.tsx`
    - 文件图标 + 文件名 + 类型标签横向布局
    - 类型色调映射（code 蓝、document 绿、image 紫、data 琥珀）
    - 进入动画 translateX(-8px→0) duration 200ms
    - 支持点击展开预览摘要
    - _需求: 4.1, 4.2, 4.3, 4.4_
  - [x] 2.5 创建 `cards/node-completed-card.tsx`
    - 最小化单行：✓ + 节点名称 + 耗时标签
    - text-white/50 降低对比度
    - 无独立卡片边框，仅水平分隔线
    - _需求: 5.1, 5.2, 5.3_
  - [x] 2.6 创建 `cards/system-note-card.tsx`
    - 居中对齐 text-[10px] text-white/40 italic
    - 无边框无背景
    - 阶段切换时两侧水平虚线装饰
    - 最小垂直间距 my-1
    - _需求: 6.1, 6.2, 6.3, 6.4_

- [x] 3. 实现连续 NodeCompleted 折叠逻辑
  - [x] 3.1 在 MiroFishCardStream 中实现 `groupConsecutiveNodeCompleted` 逻辑
    - 连续 ≥3 个 node_completed 折叠为 CollapsedNodeGroup 摘要行
    - 摘要行展示 "N 个节点已完成"
    - 支持展开查看详情
    - _需求: 5.4_

- [x] 4. 添加 CSS 微动画与 prefers-reduced-motion 降级
  - [x] 4.1 在全局 CSS 或 Tailwind 配置中添加自定义 @keyframes
    - `mirofish-fade-in`（200ms）
    - `mirofish-scale-in`（250ms）
    - `mirofish-slide-in`（200ms）
    - `mirofish-blink`（1s step-end infinite）
    - _需求: 7.1, 7.2, 7.3_
  - [x] 4.2 添加 `prefers-reduced-motion` 媒体查询降级
    - 所有自定义动画在 reduced-motion 下设为 `animation: none; opacity: 1; transform: none;`
    - _需求: 7.4_

- [x] 5. 改造 MiroFishCard 分发组件
  - [x] 5.1 重写 `cards/index.tsx` 分发逻辑
    - 根据 entry.kind switch 到对应独立卡片组件
    - 移除统一 primaryRow/secondaryRow 渲染路径
    - 为每类卡片设置不同 `data-testid` 前缀
    - _需求: 1-6 全部_

- [ ] 6. 检查点 — 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [ ]* 6.1 编写 6 类卡片 SSR 渲染测试
  - 使用 `react-dom/server` 的 `renderToString` 验证 6 类卡片服务端渲染无报错
  - 验证每类卡片的 `data-testid` 和关键 className 存在
  - _需求: 1-6_

- [ ]* 6.2 编写连续折叠逻辑测试
  - **Property 3: 连续 NodeCompleted 折叠**
  - 验证 ≥3 个连续 node_completed 被折叠为摘要行
  - **验证: 需求 5.4**

- [ ]* 6.3 编写卡片类型映射属性测试
  - **Property 1: 卡片类型与视觉形态一一对应**
  - 验证不同 kind 的 entry 渲染不同 data-testid 前缀的组件
  - **验证: 需求 1.1, 2.1, 3.1, 4.1, 5.1, 6.1**

- [ ]* 6.4 编写微动画时长约束测试
  - **Property 2: 微动画时长约束**
  - 验证 CSS 动画 duration 在 150ms-300ms 范围内
  - **验证: 需求 7.3**

## 注意事项

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 卡片微动画仅使用 CSS transition / @keyframes，不依赖 framer-motion
- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR
- 不改后端协议，不改 socket 事件格式

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "4.2"] },
    { "id": 2, "tasks": ["3.1", "5.1"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3", "6.4"] }
  ]
}
```
