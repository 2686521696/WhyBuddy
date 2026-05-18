# Requirements Document

## Introduction

本规格定义 LLM ReAct 循环内联展示功能：将 LLM 的思考→选工具→执行→观察→下一步循环以内联方式展示在卡片流中。通过消费 `agentReasoning.entries` 数据，在 `MiroFishCardStream` 和 `AgentReasoningSubTimeline` 中展示各阶段的视觉差异化和流式文本。

## Glossary

- **ReAct Loop**: LLM 的 Reasoning + Acting 循环模式
- **Phase**: ReAct 循环中的一个阶段（thinking / tool-selecting / executing / observing / next-step）
- **MiroFishCardStream**: 已有的卡片流组件（6 种卡片类型）
- **AgentReasoningSubTimeline**: 已有的推理子时间线组件
- **Streaming Cursor**: 流式输出时的闪烁光标

## Requirements

### Requirement 1: ReAct 阶段视觉差异化

**User Story:** As a 用户, I want 通过视觉区分 ReAct 循环的不同阶段, so that 我能理解 LLM 当前在做什么。

#### Acceptance Criteria
1. WHEN 进入 thinking 阶段, THE 系统 SHALL 显示蓝紫色左侧竖条和思考图标
2. WHEN 进入 tool-selecting 阶段, THE 系统 SHALL 显示琥珀色左侧竖条和工具选择图标
3. WHEN 进入 executing 阶段, THE 系统 SHALL 显示橙色左侧竖条和执行旋转图标
4. WHEN 进入 observing 阶段, THE 系统 SHALL 显示青绿色左侧竖条和观察图标
5. WHEN 进入 next-step 阶段, THE 系统 SHALL 显示灰色左侧竖条和箭头图标

### Requirement 2: 流式文本展示

**User Story:** As a 用户, I want 看到 LLM 输出的流式文本效果, so that 我能感知系统正在实时思考。

#### Acceptance Criteria
1. WHEN 收到流式 token, THE 系统 SHALL 逐字追加显示并保持光标闪烁
2. WHEN 流式输出进行中, THE 系统 SHALL 在文本末尾显示闪烁光标（CSS blink 动画）
3. WHEN 流式输出完成, THE 系统 SHALL 移除光标并固定最终文本
4. WHEN 文本超过 4 行, THE 系统 SHALL 折叠并显示"展开"按钮

### Requirement 3: 循环迭代展示

**User Story:** As a 用户, I want 看到完整的 ReAct 循环迭代, so that 我能追踪 LLM 的推理链路。

#### Acceptance Criteria
1. WHEN 一个完整循环结束, THE 系统 SHALL 在时间线中用分隔线标记循环边界
2. WHEN 循环次数超过 3 次, THE 系统 SHALL 折叠中间循环仅展示首尾
3. WHEN 循环中选择了工具, THE 系统 SHALL 在 tool-selecting 阶段显示工具名称标签

### Requirement 4: 与现有组件集成

**User Story:** As a 开发者, I want 新功能与 MiroFishCardStream 和 AgentReasoningSubTimeline 无缝集成, so that 不破坏现有卡片流。

#### Acceptance Criteria
1. WHEN ReAct 条目出现, THE 系统 SHALL 在 MiroFishCardStream 中以 reasoning-card 形式展示
2. WHEN 用户展开推理详情, THE 系统 SHALL 在 AgentReasoningSubTimeline 中展示完整循环
3. WHEN 卡片流滚动时, THE 系统 SHALL 自动滚动到最新的 ReAct 条目
