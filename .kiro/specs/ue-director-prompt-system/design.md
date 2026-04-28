# 设计文档：LLM 导演 Prompt 系统

## 概述

LLM 导演 Prompt 系统是连接任务逻辑与场景演出的桥梁。设计上采用"Prompt 模板 + LLM 生成 + 指令转换"三步流水线，将任务阶段信息转换为可执行的场景指令序列。

关键设计决策：
- Prompt 模板使用 Handlebars 语法，支持变量注入
- LLM 输出使用 JSON 结构化格式，便于解析
- 生成结果缓存，避免相同场景重复调用 LLM

## 架构

```
Mission Runtime 事件
        │
        ▼
┌──────────────┐    Prompt    ┌──────────┐
│ DirectorSvc  │ ──────────→  │  LLM     │
│ (模板注入)   │ ←──────────  │  (生成)  │
└──────┬───────┘  结构化JSON  └──────────┘
       │
       ▼
┌──────────────┐
│ 指令转换器    │
│ (分镜→指令)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 指令协议     │
│ (发送到 UE)  │
└──────────────┘
```

## 组件与接口

### 分镜脚本格式

```typescript
interface ShotScript {
  shots: Shot[];
  totalDuration: number;
}

interface Shot {
  id: string;
  camera: { preset: string; transition?: string; duration?: number };
  characters: Array<{
    characterId: string;
    action: string;
    position?: { x: number; y: number; z: number };
    expression?: string;
    dialogue?: string;
  }>;
  duration: number;
  effects?: string[];
}
```

### DirectorService

```typescript
interface DirectorService {
  generateScript(context: DirectorContext): Promise<ShotScript>;
  convertToCommands(script: ShotScript): SceneCommand[];
  executeScript(script: ShotScript): Promise<void>;
}

interface DirectorContext {
  missionId: string;
  stage: string;
  agents: Array<{ id: string; role: string; status: string }>;
  previousShots?: Shot[];
}
```

## 正确性属性

1. **输出格式合法**：LLM 生成的分镜脚本必须通过 JSON Schema 校验。
2. **角色引用有效**：分镜中引用的 characterId 必须在当前场景中存在。
3. **时间连续性**：分镜序列的总时长等于各 shot 时长之和。

## 测试策略

- **单元测试**：Prompt 模板渲染、分镜到指令转换、缓存命中
- **集成测试**：Mission 事件触发 → 分镜生成 → 指令发送的完整链路
- **Mock 测试**：使用固定 LLM 输出验证解析与转换逻辑
