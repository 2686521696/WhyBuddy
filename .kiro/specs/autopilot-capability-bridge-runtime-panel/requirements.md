# Requirements Document

## Introduction

本规格定义能力 bridge 调用过程面板：展示 Docker/MCP/AIGC 节点/Skill 的实时执行状态。通过消费 `capability.*` Socket.IO 事件，在右栏 CapabilityRail 中展示调用时间线、状态徽章和错误状态，让用户实时了解各能力桥的运行情况。

## Glossary

- **Capability Bridge**: 连接 Autopilot 与外部能力（Docker、MCP、AIGC 节点、Skill）的桥接层
- **CapabilityRail**: 已有的能力调用轨道组件（`right-rail/CapabilityRail.tsx`）
- **Invocation**: 一次能力调用实例
- **Bridge Type**: 桥类型，包括 docker / mcp / aigc-node / skill

## Requirements

### Requirement 1: 能力调用实时状态展示

**User Story:** As a 用户, I want 在右栏看到每个能力 bridge 的调用状态, so that 我能了解系统正在使用哪些工具。

#### Acceptance Criteria
1. WHEN 收到 `capability.invoked` 事件, THE 系统 SHALL 在面板中新增一条调用记录并显示 pending 状态
2. WHEN 收到 `capability.running` 事件, THE 系统 SHALL 将对应调用更新为 running 并显示进度指示
3. WHEN 收到 `capability.completed` 事件, THE 系统 SHALL 将对应调用更新为 completed 并显示耗时
4. WHEN 收到 `capability.failed` 事件, THE 系统 SHALL 将对应调用更新为 failed 并显示错误摘要
5. WHEN 面板中调用记录超过 20 条, THE 系统 SHALL 自动折叠已完成的旧记录

### Requirement 2: 调用时间线可视化

**User Story:** As a 用户, I want 看到能力调用的时间线, so that 我能理解调用顺序和并行关系。

#### Acceptance Criteria
1. WHEN 多个能力同时调用, THE 系统 SHALL 在时间线中并排展示
2. WHEN 调用完成, THE 系统 SHALL 显示调用耗时标签（ms 单位）
3. WHEN 调用链存在依赖关系, THE 系统 SHALL 用连接线表示先后顺序

### Requirement 3: Bridge 类型差异化展示

**User Story:** As a 用户, I want 通过视觉区分不同类型的能力 bridge, so that 我能快速识别调用类型。

#### Acceptance Criteria
1. WHEN 调用类型为 docker, THE 系统 SHALL 显示容器图标和蓝色标记
2. WHEN 调用类型为 mcp, THE 系统 SHALL 显示工具图标和紫色标记
3. WHEN 调用类型为 aigc-node, THE 系统 SHALL 显示节点图标和绿色标记
4. WHEN 调用类型为 skill, THE 系统 SHALL 显示技能图标和琥珀色标记

### Requirement 4: 错误状态与重试展示

**User Story:** As a 用户, I want 清楚看到失败的调用及其错误信息, so that 我能了解问题所在。

#### Acceptance Criteria
1. WHEN 调用失败, THE 系统 SHALL 显示红色边框和错误摘要（最多 2 行）
2. WHEN 调用正在重试, THE 系统 SHALL 显示重试计数徽章
3. WHEN 调用超时, THE 系统 SHALL 显示超时警告图标
