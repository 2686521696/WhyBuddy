# 设计文档：本地资源与会话治理

## 概述

本地资源与会话治理系统负责监控 GPU 资源、管理 UE 会话生命周期、在资源紧张时主动降级。设计上采用"采集 → 评估 → 动作"的反馈控制环路。

关键设计决策：
- GPU 监控使用 nvidia-smi 或 systeminformation 库
- 空闲检测基于前端用户活动事件
- 成本面板复用现有 CostDashboard 组件

## 组件与接口

### 资源监控

```typescript
interface GPUMetrics {
  utilization: number;    // 0-100%
  vramUsed: number;       // MB
  vramTotal: number;      // MB
  temperature: number;    // °C
  powerDraw: number;      // W
}

interface ResourceMonitor {
  getMetrics(): Promise<GPUMetrics>;
  onThreshold(level: 'warning' | 'critical' | 'emergency', callback: () => void): void;
  startPolling(intervalMs: number): void;
  stopPolling(): void;
}
```

### 会话治理

```typescript
interface SessionGovernor {
  pauseRendering(): Promise<void>;
  resumeRendering(): Promise<void>;
  isPaused(): boolean;
  setIdleTimeout(minutes: number): void;
  onIdlePause(callback: () => void): void;
  onResume(callback: () => void): void;
}
```

### 联合成本

```typescript
interface CostSummary {
  llm: { tokens: number; estimatedCost: number };
  rendering: { durationMinutes: number; estimatedPowerCost: number };
  total: number;
  currency: string;
}
```

## 正确性属性

1. **告警不遗漏**：显存超过阈值后必须在 2 秒内触发告警。
2. **暂停可恢复**：暂停后的恢复不丢失场景状态。
3. **成本不负数**：成本面板中所有数值不为负。

## 测试策略

- **单元测试**：阈值判定、空闲检测、成本计算
- **集成测试**：显存告警 → 自动降级的完整链路
- **模拟测试**：使用 mock GPU 数据验证各阈值行为
