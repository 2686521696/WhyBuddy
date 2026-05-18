# Requirements Document

## Introduction

本规格定义 Agent Crew 角色在每个阶段的激活/讨论/决策过程可视化功能。通过消费 `role.*` Socket.IO 事件，在右栏展示角色状态转换动画，让用户实时感知哪些角色正在参与当前阶段的工作。

## Glossary

- **Role**: FSD 车队中的一个角色实例（如 Planner、Clarifier、Researcher 等）
- **Stage**: 6 阶段流程中的某一阶段
- **Activation**: 角色从 sleeping 进入 active 的过程
- **RoleStatusStrip**: 已有的角色状态条组件（`right-rail/RoleStatusStrip.tsx`）
- **FleetActivationLog**: 已有的激活日志组件（`right-rail/FleetActivationLog.tsx`）

## Requirements

### Requirement 1: 角色状态实时展示

**User Story:** As a 用户, I want 在右栏看到每个角色的当前状态, so that 我能了解谁在参与当前阶段工作。

#### Acceptance Criteria
1. WHEN 收到 `role.activated` 事件, THE 系统 SHALL 将对应角色状态更新为 active 并播放激活动画
2. WHEN 收到 `role.watching` 事件, THE 系统 SHALL 将对应角色状态更新为 watching 并显示观察图标
3. WHEN 收到 `role.reviewing` 事件, THE 系统 SHALL 将对应角色状态更新为 reviewing 并显示审阅标记
4. WHEN 收到 `role.sleeping` 事件, THE 系统 SHALL 将对应角色状态更新为 sleeping 并降低视觉权重
5. WHEN 阶段切换时, THE 系统 SHALL 批量更新角色状态并播放过渡动画

### Requirement 2: 角色状态转换动画

**User Story:** As a 用户, I want 看到角色状态变化时的平滑动画, so that 我能直观感知状态流转。

#### Acceptance Criteria
1. WHEN 角色从 sleeping 变为 active, THE 系统 SHALL 播放 scale(0.8→1) + opacity(0.4→1) 的进入动画（duration 250ms）
2. WHEN 角色从 active 变为 sleeping, THE 系统 SHALL 播放 opacity(1→0.4) 的退出动画（duration 200ms）
3. WHEN 角色处于 active 状态, THE 系统 SHALL 显示呼吸脉冲指示器
4. WHEN 用户启用 prefers-reduced-motion, THE 系统 SHALL 禁用所有动画仅保留状态色变化

### Requirement 3: 讨论/决策过程可视化

**User Story:** As a 用户, I want 看到角色之间的讨论和决策过程, so that 我能理解 AI 团队的协作方式。

#### Acceptance Criteria
1. WHEN 多个角色同时处于 active 状态, THE 系统 SHALL 在 FleetActivationLog 中展示讨论时间线
2. WHEN 角色产出决策结果, THE 系统 SHALL 在日志中高亮显示决策条目
3. WHEN 阶段完成, THE 系统 SHALL 折叠该阶段的讨论记录并显示摘要

### Requirement 4: 与现有组件集成

**User Story:** As a 开发者, I want 新功能与 RoleStatusStrip 和 FleetActivationLog 无缝集成, so that 不破坏现有布局。

#### Acceptance Criteria
1. WHEN 组件渲染时, THE 系统 SHALL 在 RoleStatusStrip 内展示角色状态圆点序列
2. WHEN 角色状态变化时, THE 系统 SHALL 同步更新 FleetActivationLog 的条目
3. WHEN 右栏宽度 < 280px, THE 系统 SHALL 隐藏角色名称仅保留状态圆点
