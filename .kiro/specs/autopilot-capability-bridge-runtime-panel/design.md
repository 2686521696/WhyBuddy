# 设计文档：能力 Bridge 运行时面板

## 设计概述

在现有 `CapabilityRail` 基础上，增加实时调用状态面板。面板以紧凑时间线形式展示每次能力调用的类型、状态、耗时和错误信息。通过消费 `capability.*` Socket.IO 事件驱动状态更新，使用 framer-motion 实现条目进入/退出动画。

## 组件架构

```
CapabilityRail (已有，增强)
├── CapabilityBridgePanel              ← 新增：运行时面板容器
│   ├── BridgeInvocationTimeline       ← 新增：调用时间线
│   │   └── BridgeInvocationCard × N   ← 新增：单条调用卡片
│   ├── BridgeStatusSummary            ← 新增：状态摘要栏
│   └── BridgeErrorDetail              ← 新增：错误详情弹出
```

## 数据流

```
Socket.IO capability.* events
  → useBlueprintRealtimeStore.capabilityStatuses (已有)
    → useCapabilityBridgeState (新增 hook)
      → BridgeInvocationTimeline (时间线渲染)
      → BridgeStatusSummary (摘要统计)
```

### useCapabilityBridgeState hook

```typescript
interface BridgeInvocation {
  id: string;
  bridgeType: 'docker' | 'mcp' | 'aigc-node' | 'skill';
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  retryCount?: number;
  stageIndex: number;
}

interface UseCapabilityBridgeStateReturn {
  invocations: BridgeInvocation[];
  activeInvocations: BridgeInvocation[];
  summary: { total: number; running: number; completed: number; failed: number };
}
```

## 关键接口

```typescript
/** 调用卡片属性 */
interface BridgeInvocationCardProps {
  invocation: BridgeInvocation;
  compact?: boolean;
}

/** Bridge 类型视觉配置 */
const BRIDGE_TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  docker: { icon: '🐳', color: 'text-blue-600 bg-blue-50', label: 'Docker' },
  mcp: { icon: '🔧', color: 'text-purple-600 bg-purple-50', label: 'MCP' },
  'aigc-node': { icon: '⚡', color: 'text-emerald-600 bg-emerald-50', label: 'AIGC' },
  skill: { icon: '🎯', color: 'text-amber-600 bg-amber-50', label: 'Skill' },
};
```

## 样式方案

- 面板背景：`bg-white border border-slate-200 rounded-lg`
- 调用卡片：`px-2 py-1.5 border-b border-slate-100`
- 状态徽章：
  - pending: `bg-slate-100 text-slate-500`
  - running: `bg-blue-100 text-blue-700` + 旋转图标
  - completed: `bg-emerald-100 text-emerald-700`
  - failed: `bg-red-100 text-red-700 border border-red-200`
  - retrying: `bg-amber-100 text-amber-700`
- 字号：`text-[10px]` 标签、`text-[11px]` 名称、`text-[10px]` 耗时
- 时间线连接线：`border-l border-slate-200` 左侧 1px 竖线
- 进入动画：framer-motion `opacity: 0→1, y: -4→0, duration: 0.2`
- 退出动画：framer-motion `opacity: 1→0, height: auto→0, duration: 0.15`
