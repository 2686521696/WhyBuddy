# 实现计划：Agent Crew 阶段激活可视化

## 概述

在现有 `RoleStatusStrip` 和 `FleetActivationLog` 基础上，增加角色状态圆点序列、状态转换动画和讨论时间线，消费 `role.*` Socket.IO 事件实现实时可视化。

## 任务

- [ ] 1. 创建 useRoleCrewState hook
  - [ ] 1.1 创建 `client/src/components/right-rail/crew-activation/useRoleCrewState.ts`
    - 消费 `useBlueprintRealtimeStore` 中的 role 相关数据
    - 维护 `RoleCrewEntry[]` 状态数组
    - 根据 `role.activated / role.watching / role.reviewing / role.sleeping` 事件更新状态
    - 派生 `activeRoles`、`currentStageIndex`、`discussions`
    - _需求: 1.1, 1.2, 1.3, 1.4_
  - [ ] 1.2 创建 `client/src/components/right-rail/crew-activation/types.ts`
    - 定义 `RoleCrewEntry`、`DiscussionEntry`、`StageTransitionEvent` 接口
    - _需求: 1.1_

- [ ] 2. 创建 RoleCrewDots 角色状态圆点组件
  - [ ] 2.1 创建 `client/src/components/right-rail/crew-activation/RoleCrewDots.tsx`
    - 水平排列角色状态圆点（6px/8px）
    - 每个圆点下方显示角色简称（text-[10px] text-slate-500）
    - 使用 framer-motion `layoutId` 实现位置动画
    - _需求: 1.1, 4.1_
  - [ ] 2.2 创建 `client/src/components/right-rail/crew-activation/RoleCrewDot.tsx`
    - 四种状态色：active(emerald-500) / watching(amber-400) / reviewing(blue-500) / sleeping(slate-300)
    - active 态使用 CSS `@keyframes crew-pulse` 脉冲动画
    - sleeping→active 使用 framer-motion scale(0.8→1) + opacity(0.4→1) duration 250ms
    - active→sleeping 使用 framer-motion opacity(1→0.4) duration 200ms
    - _需求: 2.1, 2.2, 2.3, 2.4_

- [ ] 3. 创建讨论时间线组件
  - [ ] 3.1 创建 `client/src/components/right-rail/crew-activation/DiscussionTimeline.tsx`
    - 垂直时间线布局，左侧角色圆点 + 连接线
    - 每条记录显示角色名、内容摘要、时间戳
    - decision 类型条目使用 `bg-emerald-50 border-l-2 border-emerald-400` 高亮
    - text-[11px] font-normal text-slate-700
    - _需求: 3.1, 3.2_
  - [ ] 3.2 实现阶段折叠逻辑
    - 阶段完成时自动折叠讨论记录
    - 折叠态显示摘要行："N 条讨论 · M 个决策"
    - 支持点击展开查看详情
    - _需求: 3.3_

- [ ] 4. 集成到现有组件
  - [ ] 4.1 增强 `client/src/components/right-rail/RoleStatusStrip.tsx`
    - 在现有内容上方插入 RoleCrewDots
    - 添加当前阶段标签（text-[10px] font-mono text-slate-400）
    - 保持总高度不超过 48px
    - _需求: 4.1_
  - [ ] 4.2 增强 `client/src/components/right-rail/FleetActivationLog.tsx`
    - 在激活日志列表中混入 DiscussionTimeline 条目
    - 按时间戳排序合并显示
    - _需求: 4.2_

- [ ] 5. 添加动画与 prefers-reduced-motion 降级
  - [ ] 5.1 在全局 CSS 中添加 `@keyframes crew-pulse`
    - scale 1→1.3→1, 1.5s ease-in-out infinite
    - _需求: 2.3_
  - [ ] 5.2 添加 `prefers-reduced-motion` 降级
    - framer-motion 动画 duration 设为 0
    - CSS 动画设为 `animation: none`
    - _需求: 2.4_

- [ ] 6. 响应式适配
  - [ ] 6.1 实现窄宽度降级
    - 右栏 < 280px 时隐藏角色名称仅保留圆点
    - 使用 `@container` 查询或 ResizeObserver
    - _需求: 4.3_

- [ ] 7. 编写测试
  - [ ] 7.1 编写 RoleCrewDots SSR 渲染测试
    - 使用 `react-dom/server` 的 `renderToString` 验证无报错
    - 验证 4 种状态的 className 正确
    - _需求: 1.1, 2.1_
  - [ ] 7.2 编写 useRoleCrewState 状态更新测试
    - 验证事件消费后状态正确更新
    - 验证 activeRoles 派生逻辑
    - _需求: 1.1, 1.2, 1.3, 1.4_

## 注意事项

- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR
- 动画使用 framer-motion v12，脉冲使用 CSS @keyframes
- 不改后端协议，仅消费现有 `role.*` 事件
- 右栏白底 light theme，文字使用 slate 色系
- 字号 10-12px 紧凑风格

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "5.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2", "5.2"] },
    { "id": 2, "tasks": ["4.1", "4.2", "6.1"] },
    { "id": 3, "tasks": ["7.1", "7.2"] }
  ]
}
```
