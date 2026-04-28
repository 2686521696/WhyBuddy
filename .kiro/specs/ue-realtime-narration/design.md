# 设计文档：实时旁白与对话

## 概述

实时旁白与对话系统负责将 Agent 的文本输出转换为场景中的语音和口型动画。设计上采用"TTS 引擎 + 音素分析 + Morph Target 驱动"的流水线，同时维护发言队列实现多角色轮流对话。

关键设计决策：
- TTS 在 Node.js 侧完成，音频流推送到 UE 播放
- 口型同步使用音素到 Morph Target 的映射表
- 字幕作为独立层在前端渲染，不依赖 UE

## 架构

```
文本输入 → TTS 引擎 → 音频流 + 音素序列
                          │           │
                          ▼           ▼
                    UE 音频播放   口型驱动器
                                      │
                                      ▼
                              Morph Target 动画
```

## 组件与接口

### 发言请求

```typescript
interface SpeechRequest {
  characterId: string;
  text: string;
  emotion?: string;
  speed?: number;
  priority?: 'normal' | 'high' | 'interrupt';
}
```

### 发言队列

```typescript
interface SpeechQueue {
  enqueue(request: SpeechRequest): void;
  interrupt(request: SpeechRequest): void;
  getCurrentSpeaker(): string | null;
  skip(): void;
}
```

## 正确性属性

1. **发言不重叠**：同一时刻只有一个角色在发言。
2. **口型同步**：音频播放与口型动画的时间偏差不超过 100ms。
3. **降级完整**：TTS 不可用时，所有文本都以字幕形式展示。

## 测试策略

- **单元测试**：发言队列调度、音素到 Morph Target 映射
- **集成测试**：文本输入 → TTS → 音频播放 → 口型同步
- **降级测试**：TTS 服务不可用时的字幕回退
