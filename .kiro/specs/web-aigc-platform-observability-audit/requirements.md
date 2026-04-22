# 需求文档：Web-AIGC 平台可观测与审计

## 目标

确保迁移到 Cube 主仓后的 Web-AIGC 节点编排具备最小可用的可观测、可回放、可审计能力，并能在 `workflow / mission / instance / session / replay / audit` 之间建立稳定关联。

## 当前主仓边界（2026-04-22）

以下能力已经有代码与测试依据支撑：

- 节点、边、人工决策、实例控制等事件目录
- replay / audit 关联索引模型
- runtime 事件到 replay / audit 的最小桥接
- replay 快照、完整性校验与审计补记
- monitoring 兼容接口读取 mission/workflow/graph/session 投影

以下能力仍不应写成“已完整完成”：

- runtime 事件统一直写 lineage
- 单一总线端到端承接所有节点观测事件
- 独立的 runtime telemetry backend

## 需求

### 需求 1：节点级事件与载荷

系统应定义节点级运行事件目录，并为关键事件声明最小必需字段，例如：

- `workflowId`
- `instanceId`
- `nodeId`
- `status`
- `startedAt / completedAt`
- `error / waitingFor`

### 需求 2：路径回放能力

系统应支持对以下执行轨迹进行回放或轨迹查询：

- 边跳转
- 条件分支
- 等待输入
- 人工恢复

当前验收口径：

- `edge.transitioned` 已有定义与运行时证据。
- `edge.loop_iterated` 当前更偏领域与目录预留，不应单独视为“运行时闭环已成立”。

### 需求 3：审计闭环

系统应记录以下关键治理动作：

- 人工决策
- 终止
- 重试
- 升级
- 高风险外部动作

当前主仓最明确闭环的是：

- replay
- audit

高风险外部动作中，当前证据最充分的是：

- `external.vector_insert`

### 需求 4：跨对象关联

系统应能在以下对象之间建立稳定关联：

- workflow
- mission
- instance
- session
- replay
- audit
- artifact

当前验收口径：

- replay / audit / lineage 的 relation index 模型已经存在。
- 但“有 lineageId 索引”不等于“runtime 事件已直写 lineage store”。
