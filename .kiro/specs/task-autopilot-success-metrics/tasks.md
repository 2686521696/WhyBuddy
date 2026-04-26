# 任务清单：任务自动驾驶成功度量体系

## 指标定义与共享模型

- [x] 定义成功度量体系的术语表与统一中文口径
- [x] 定义 `AutopilotMetricEvent` 归一化事件模型
- [x] 定义 `AutopilotMissionMetrics` 任务级样本模型
- [x] 定义 `AutopilotMetricsAggregate` 聚合结果模型
- [x] 定义样本纳入规则与排除原因枚举
- [x] 定义 `complete / partial / missing / conflicted` 数据完整性状态

## 核心指标口径

- [x] 定义任务送达率的分子、分母、时间锚点与终态枚举
- [x] 定义接管率的必需接管与建议接管边界
- [x] 定义用户确认次数的动作范围与排除规则
- [x] 定义重规划率的判定标准与 `retry / replan` 区分规则
- [x] 定义偏航率的判定标准与“计划内分支”排除规则
- [x] 定义完成时长的主口径与阶段拆分口径
- [x] 定义结果复核通过率的最终通过与首轮通过规则

## 事实源映射

- [x] 定义 `mission -> metric event` 的映射规则
- [x] 定义 `runtime -> metric event` 的映射规则
- [x] 定义 `audit -> confirmation evidence` 的映射规则
- [x] 定义 `replay -> drill-down evidence` 的映射规则
- [x] 定义多源冲突优先级与降级策略
- [x] 定义主事实缺失时的 `partial` 样本处理规则

## 事件归一化与派生计算

- [x] 设计归一化事件生成器的输入输出契约
- [x] 设计任务级样本构建流程
- [x] 设计接管次数、确认次数、重规划次数、偏航次数的派生逻辑
- [x] 设计阶段耗时拆分逻辑
- [x] 设计复核最终结论与首轮结论的派生逻辑
- [x] 设计偏航事件与重规划、接管后续动作的关联规则

## 聚合与查询

- [x] 设计时间窗口聚合能力
- [x] 设计按自动驾驶等级的切片聚合
- [x] 设计按任务类型、路线家族、工作区、环境的切片聚合
- [x] 设计任务样本列表查询能力
- [x] 设计聚合指标钻取到任务样本的查询能力
- [x] 设计聚合结果中的 `avg / p50 / p90` 时长统计能力

## 回放与审计集成

- [x] 设计任务样本到 replay 深链的关联字段
- [x] 设计任务样本到 audit 深链的关联字段
- [x] 设计 dashboard 指标与 replay 时间线的一致性校验规则
- [x] 设计 dashboard 指标与 audit 确认事件的一致性校验规则
- [x] 设计关键治理事件的证据引用展示结构

## 数据质量与回补

- [x] 设计测试样本、演示样本、回灌样本的排除策略
- [x] 设计历史样本回补证据的流程
- [x] 设计 `partial` 样本升级为 `complete` 的规则
- [x] 设计 `conflicted` 样本的标记、告警与人工核查流程
- [x] 设计指标口径变更时的版本化策略

## 接口与消费层

- [x] 设计成功度量聚合接口的返回结构
- [x] 设计任务级成功样本详情接口的返回结构
- [x] 设计 cockpit / telemetry dashboard 的消费契约
- [x] 设计 replay 侧栏消费成功度量样本的契约
- [x] 设计 audit 侧消费确认次数与治理证据的契约

## 验证与测试计划

- [x] 补充任务送达率口径验证用例
- [x] 补充接管率与用户确认次数口径验证用例
- [x] 补充重规划率与偏航率口径验证用例
- [x] 补充完成时长阶段拆分验证用例
- [x] 补充结果复核通过率验证用例
- [x] 补充多源冲突与降级处理验证用例
- [x] 补充 replay / audit / dashboard 三方对账验证用例
- [x] 补充历史数据回补后的口径稳定性验证用例

## 文档与治理

- [x] 将成功度量体系作为后续 autopilot cockpit / replay / audit specs 的依赖前置
- [x] 在相关 spec 中引用统一指标口径，避免重复定义
- [x] 补充面向产品、运营、治理的指标解释文案
- [x] 补充口径变更记录与版本说明模板

## 审计备注（2026-04-24）

- 本轮按“设计收口”口径保守勾选，不声称 shared / server / client 已经落地成功度量代码、聚合接口或 dashboard。
- 已勾选项的依据来自本 spec `design.md` 中已经明确成文的结构化定义，包括：
  - `AutopilotMetricEvent`、`AutopilotMissionMetrics`、`AutopilotMetricsAggregate`
  - 七个核心指标的分子 / 分母 / 锚点 / 边界
  - `mission / runtime / audit / replay` 四类事实源分工与冲突优先级
  - 样本纳入、排除、`partial / conflicted`、回补与聚合钻取约束
- 本轮新增完成项还对应以下新增设计锚点：
  - `归一化事件生成器契约`
    - 已在 `design.md` 中补齐 `BuildAutopilotMetricEventsInput / Output`
    - 明确 `events / evidenceState / droppedFacts / conflicts` 四类输出
  - `任务级样本构建流程`
    - 已在 `design.md` 中补齐从事实收集、事件归一化、生命周期锚点、派生字段到纳入/排除和质量状态写回的七步流程
  - `replay / audit 一致性校验规则`
    - 已在 `design.md` 中分别补齐 dashboard 与 replay、dashboard 与 audit 的最小一致性约束
  - `关键治理事件证据引用结构`
    - 已在 `design.md` 中补齐 `GovernanceEvidenceReference`
  - ``conflicted` 样本处理流程` 与 `指标口径版本化策略`
    - 已在 `design.md` 中补齐标记、告警、人工核查、处置闭环，以及 `definitionVersion` 版本字段与 breaking / non-breaking 变更策略
- 本轮仍未勾选的内容，主要是因为设计文档里还没有把它们收口成足够明确的接口契约、验证计划或运营模板，包括：
  - 无

## 审计备注（2026-04-25）

- 本轮继续只按“design.md 是否已经直接覆盖并形成稳定契约”来勾选，不把实现层、接口落地、UI 接入或自动化测试误写成完成。
- 本轮新增勾选的依据如下：
  - `设计 cockpit / telemetry dashboard 的消费契约`
    - `design.md` 已新增 `CockpitSuccessMetricsPanelPayload` 与 `TelemetryDashboardMetricsPayload`
  - `设计 replay 侧栏消费成功度量样本的契约`
    - `design.md` 已新增 `ReplaySuccessMetricsSidebarPayload`
  - `设计 audit 侧消费确认次数与治理证据的契约`
    - `design.md` 已新增 `AuditSuccessMetricsPanelPayload`
  - `补充面向产品、运营、治理的指标解释文案`
    - `design.md` 已为七个核心指标补齐三类受众解释口径与使用提醒
  - `补充口径变更记录与版本说明模板`
    - `design.md` 已新增 `AutopilotMetricsDefinitionChangeRecord`、Markdown 模板与报表头部文案模板
  - `验证与测试计划` 整组条目
    - `design.md` 已新增覆盖核心指标、冲突降级、三方对账与历史回补稳定性的验证矩阵
- 本轮没有新增未勾项。当前这个 spec 在“纯设计收口”范围内可以视为已完成。
- 仍需明确边界：
  - 这些勾选仅表示设计契约、验证矩阵与文档模板已经收口
  - 不表示服务端聚合接口、dashboard、replay 侧栏、audit 面板或自动化测试已经在主仓实现
