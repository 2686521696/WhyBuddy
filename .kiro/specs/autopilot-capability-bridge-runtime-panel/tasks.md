# 实现计划：能力 Bridge 运行时面板

## 概述

在现有 `CapabilityRail` 基础上增加实时调用状态面板，以紧凑时间线形式展示 Docker/MCP/AIGC 节点/Skill 的调用过程、状态和错误信息。

## 任务

- [x] 1. 创建 useCapabilityBridgeState hook
  - [x] 1.1 创建 `client/src/components/right-rail/capability-panel/useCapabilityBridgeState.ts`
    - 消费 `useBlueprintRealtimeStore.capabilityStatuses`
    - 维护 `BridgeInvocation[]` 调用列表
    - 根据 `capability.invoked / running / completed / failed` 事件更新状态
    - 计算 `durationMs`、派生 `activeInvocations` 和 `summary`
    - 超过 20 条时自动标记旧记录为 collapsed
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 1.2 创建 `client/src/components/right-rail/capability-panel/types.ts`
    - 定义 `BridgeInvocation`、`BridgeTypeConfig`、`UseCapabilityBridgeStateReturn` 接口
    - 定义 `BRIDGE_TYPE_CONFIG` 常量映射
    - _需求: 3.1, 3.2, 3.3, 3.4_

- [x] 2. 创建 BridgeInvocationCard 调用卡片组件
  - [x] 2.1 创建 `client/src/components/right-rail/capability-panel/BridgeInvocationCard.tsx`
    - 单行紧凑布局：类型图标(12×12) + 名称 + 状态徽章 + 耗时
    - 根据 bridgeType 显示差异化图标和颜色
    - running 态图标使用 `animate-spin`
    - failed 态显示红色边框 + 错误摘要（最多 2 行 line-clamp-2）
    - retrying 态显示重试计数徽章
    - py-1.5 紧凑内边距，text-[11px]
    - _需求: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3_

- [x] 3. 创建 BridgeInvocationTimeline 时间线组件
  - [x] 3.1 创建 `client/src/components/right-rail/capability-panel/BridgeInvocationTimeline.tsx`
    - 垂直时间线，左侧 1px 连接线（border-slate-200）
    - 使用 framer-motion `AnimatePresence` 管理条目进入/退出
    - 并行调用并排展示（flex-row gap-1）
    - 已完成旧记录折叠为摘要行
    - _需求: 1.5, 2.1, 2.2, 2.3_
  - [x] 3.2 创建 `client/src/components/right-rail/capability-panel/BridgeStatusSummary.tsx`
    - 顶部摘要栏：total / running / completed / failed 计数
    - 使用 4 个紧凑徽章横向排列
    - text-[10px] font-mono
    - _需求: 1.1_

- [x] 4. 创建 CapabilityBridgePanel 主容器
  - [x] 4.1 创建 `client/src/components/right-rail/capability-panel/CapabilityBridgePanel.tsx`
    - 组合 BridgeStatusSummary + BridgeInvocationTimeline
    - 容器样式：`bg-white border border-slate-200 rounded-lg p-2`
    - 最大高度 240px，overflow-y-auto
    - _需求: 1.1, 2.1_

- [x] 5. 集成到 CapabilityRail
  - [x] 5.1 增强 `client/src/components/right-rail/CapabilityRail.tsx`
    - 在现有内容下方插入 CapabilityBridgePanel
    - 无调用数据时不渲染面板
    - _需求: 1.1_

- [x] 6. 添加动画与降级
  - [x] 6.1 实现 framer-motion 进入/退出动画
    - 进入：`opacity: 0→1, y: -4→0, duration: 0.2`
    - 退出：`opacity: 1→0, height: auto→0, duration: 0.15`
    - _需求: 1.1_
  - [x] 6.2 添加 `prefers-reduced-motion` 降级
    - framer-motion 动画 duration 设为 0
    - _需求: 无障碍隐含要求_

- [ ] 7. 编写测试
  - [~] 7.1 编写 CapabilityBridgePanel SSR 渲染测试
    - 使用 `react-dom/server` 的 `renderToString` 验证无报错
    - 验证 4 种 bridge 类型的 className 正确
    - _需求: 3.1, 3.2, 3.3, 3.4_
  - [~] 7.2 编写 useCapabilityBridgeState 状态更新测试
    - 验证事件消费后调用列表正确更新
    - 验证超过 20 条时折叠逻辑
    - _需求: 1.1, 1.5_

## 注意事项

- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR
- 动画使用 framer-motion v12
- 不改后端协议，仅消费现有 `capability.*` 事件
- 右栏白底 light theme，文字使用 slate 色系
- 字号 10-12px 紧凑风格

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2"] },
    { "id": 2, "tasks": ["4.1", "6.1", "6.2"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["7.1", "7.2"] }
  ]
}
```
