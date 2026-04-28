# 设计文档：性能分档与画质分级

## 概述

性能分档系统负责在 UE5 启动前检测硬件能力，并自动选择最佳画质配置。设计上采用"硬件探测 → 评分计算 → 档位匹配 → 参数应用"四步流程。

关键设计决策：
- 硬件检测在 Node.js 侧完成（使用 systeminformation 库）
- 画质参数通过 UE5 Console Variable 动态应用
- 支持运行时切换，不需要重启 UE

## 组件与接口

### 硬件信息

```typescript
interface HardwareProfile {
  gpu: { model: string; vram: number; driver: string };
  cpu: { model: string; cores: number; frequency: number };
  memory: { total: number; available: number };
  os: string;
}
```

### 画质档位

```typescript
interface QualityTier {
  name: 'high' | 'medium' | 'low';
  resolution: number;       // 缩放比例 0.5 - 1.0
  shadows: 'high' | 'medium' | 'low' | 'off';
  gi: 'lumen' | 'ssgi' | 'off';
  effects: 'full' | 'basic' | 'minimal';
  maxCharacters: number;
  antiAliasing: 'taa' | 'fxaa' | 'off';
  textureQuality: 'high' | 'medium' | 'low';
}
```

### 评分算法

```
GPU 评分 = VRAM(GB) × GPU_TIER_WEIGHT
CPU 评分 = 核心数 × 主频(GHz) × CPU_WEIGHT
总评分 = GPU 评分 × 0.7 + CPU 评分 × 0.3

总评分 ≥ 80 → High
总评分 ≥ 40 → Medium
总评分 < 40 → Low
```

## 正确性属性

1. **帧率保证**：每个档位在对应硬件上的帧率不低于 30fps。
2. **切换无中断**：画质切换过程中不出现黑屏或画面冻结。

## 测试策略

- **单元测试**：评分算法、档位匹配逻辑
- **性能测试**：在不同 GPU 上验证各档位帧率
- **切换测试**：运行时切换画质的稳定性
