# Requirements Document

## Introduction

本规格定义流式输出贯穿全生命周期功能：将流式 token 输出从单一面板扩展到跨阶段协调展示。在 StageProgressIndicator 中反映流式进度，在 MiroFishCardStream、AgentReasoningSubTimeline 和 3D HUD 之间协调流式状态，并优雅处理流中断/恢复。

## Glossary

- **Streaming Token**: LLM 输出的单个 token 片段
- **Lifecycle Weave**: 流式输出贯穿多个阶段和组件的编织模式
- **StageProgressIndicator**: 已有的阶段进度指示器组件
- **Stream Interruption**: 流式输出因网络或服务端原因中断
- **Stream Resumption**: 中断后恢复流式输出

## Requirements

### Requirement 1: 跨阶段流式进度展示

**User Story:** As a 用户, I want 在进度指示器中看到流式输出的进度, so that 我能感知系统正在持续工作。

#### Acceptance Criteria
1. WHEN 流式输出进行中, THE 系统 SHALL 在 StageProgressIndicator 中显示流式进度动画
2. WHEN 流式 token 持续到达, THE 系统 SHALL 更新进度条的填充比例
3. WHEN 流式输出跨越阶段边界, THE 系统 SHALL 平滑过渡进度指示到下一阶段
4. WHEN 流式输出暂停超过 3 秒, THE 系统 SHALL 切换为不确定态进度动画

### Requirement 2: 多组件流式协调

**User Story:** As a 用户, I want 流式输出在多个面板中协调展示, so that 我能从不同视角观察输出。

#### Acceptance Criteria
1. WHEN 流式 token 到达, THE 系统 SHALL 同时更新 MiroFishCardStream 中的活跃卡片
2. WHEN 流式 token 到达, THE 系统 SHALL 同时更新 AgentReasoningSubTimeline 中的当前条目
3. WHEN 3D HUD 可见, THE 系统 SHALL 在对应 zone 显示流式活动指示器
4. WHEN 多个组件同时消费流, THE 系统 SHALL 保证 token 顺序一致性

### Requirement 3: 流中断与恢复

**User Story:** As a 用户, I want 流式输出中断时有明确提示并能自动恢复, so that 我不会误以为系统停止工作。

#### Acceptance Criteria
1. WHEN 流式输出中断, THE 系统 SHALL 在 500ms 后显示"连接中断"提示
2. WHEN 流式输出恢复, THE 系统 SHALL 移除中断提示并从断点继续展示
3. WHEN 中断超过 10 秒, THE 系统 SHALL 显示"重新连接中"状态并尝试恢复
4. WHEN 恢复后收到补偿数据, THE 系统 SHALL 合并到已有内容而非重复展示

### Requirement 4: 流式性能优化

**User Story:** As a 开发者, I want 高频 token 更新不导致性能问题, so that 界面保持流畅。

#### Acceptance Criteria
1. WHEN token 到达频率超过 60/s, THE 系统 SHALL 批量合并更新（requestAnimationFrame 节流）
2. WHEN 流式文本超过 1000 字符, THE 系统 SHALL 虚拟化旧内容仅渲染可见区域
3. WHEN 多个组件同时更新, THE 系统 SHALL 使用共享 ref 避免重复 re-render
