# 设计文档：Agent Crew 阶段激活可视化

## 设计概述

在现有 `RoleStatusStrip` 和 `FleetActivationLog` 基础上，增强角色状态的实时可视化能力。通过消费 `useBlueprintRealtimeStore` 中的 `role.*` 事件数据，驱动角色状态圆点动画和讨论时间线展示。所有动画使用 framer-motion v12，样式遵循 light theme（白底 + slate 色系）。

## 组件架构

```
RoleStatusStrip (已有，增强)
├── RoleCrewDots                    ← 新增：角色状态圆点序列
│   └── RoleCrewDot × N            ← 新增：单个角色状态圆点
├── RoleCrewStageLabel              ← 新增：当前阶段标签
└── RoleCrewTransitionOverlay       ← 新增：阶段切换过渡层

FleetActivationLog (已有，增强)
├── ActivationLogEntry (已有)
├── DiscussionTimelineEntry         ← 新增：讨论时间线条目
└── DecisionHighlightEntry          ← 新增：决策高亮条目
```

## 数据流

```
Socket.IO role.* events
  → useBlueprintRealtimeStore (已有)
    → useRoleCrewState (新增 hook)
      → RoleCrewDots (状态圆点渲染)
      → FleetActivationLog (日志条目追加)
```

### useRoleCrewState hook

```typescript
interface RoleCrewEntry {
  roleId: string;
  roleName: string;
  status: 'active' | 'watching' | 'reviewing' | 'sleeping';
  stageIndex: number;
  updatedAt: number;
}

interface UseRoleCrewStateReturn {
  roles: RoleCrewEntry[];
  activeRoles: RoleCrewEntry[];
  currentStageIndex: number;
  discussions: DiscussionEntry[];
}
```

## 关键接口

```typescript
/** 角色状态圆点属性 */
interface RoleCrewDotProps {
  role: RoleCrewEntry;
  size?: 'sm' | 'md';  // sm: 6px, md: 8px
}

/** 讨论时间线条目 */
interface DiscussionEntry {
  id: string;
  roleId: string;
  roleName: string;
  content: string;
  type: 'discussion' | 'decision' | 'handoff';
  timestamp: number;
  stageIndex: number;
}

/** 阶段切换事件 */
interface StageTransitionEvent {
  fromStage: number;
  toStage: number;
  activatedRoles: string[];
  deactivatedRoles: string[];
}
```

## 样式方案

- 背景：`bg-white`（右栏白底）
- 角色圆点颜色映射：
  - active: `bg-emerald-500`
  - watching: `bg-amber-400`
  - reviewing: `bg-blue-500`
  - sleeping: `bg-slate-300`
- 文字：`text-slate-700`（主文字）、`text-slate-500`（次要文字）
- 字号：`text-[10px]` 角色名、`text-[11px]` 日志内容
- 边框：`border-slate-200`
- 动画：framer-motion `animate` + `AnimatePresence`
- 脉冲：CSS `@keyframes crew-pulse`（scale 1→1.3→1, 1.5s infinite）
- prefers-reduced-motion：所有 framer-motion 动画 duration 设为 0
