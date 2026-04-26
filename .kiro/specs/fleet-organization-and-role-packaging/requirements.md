# 需求文档：车队组织与角色封装

## 目标

定义任务自动驾驶中的 `Fleet` 组织方式与“角色封装层”，把当前主仓已经存在的 `agents / nodes / executors / skills / tools` 等工程能力，重新包装为用户可理解、可解释、可展示的车队角色体系。

该体系应服务于以下目标：

- 让用户理解“当前是谁在执行任务”，而不是直接面对底层节点和工具列表
- 让系统能够把路线规划结果转换为可执行的车队编组
- 让驾驶舱、实时执行主视图、接管面板和回放系统共享同一套角色语义
- 与现有 `mission-first / workflow / runtime / HITL / audit / replay` 基座兼容，而不是要求推翻底层模型

## 背景

当前主仓已经具备丰富的任务执行基础：

- mission-first 的任务发起与任务主线
- workflow / node 编排与运行时推进
- agent 体系与动态组织能力
- executor 体系，包括 browser、native、sandbox、mock 等执行能力
- skill、tool、MCP、节点适配器等能力组件
- review、audit、lineage、replay、HITL 等治理能力

这些能力足以支撑复杂任务执行，但它们在用户视角下仍然过于工程化：

- 用户很难理解一个任务为何由多个 node、agent、executor 共同推进
- skill、tool、executor 的差异更像工程拼装细节，而不是产品语义
- 前端需要展示“谁在做什么”，但底层对象粒度过细、命名分散
- route 规划结果与实际执行单元之间缺少稳定的“角色封装层”

因此需要定义一套 `Fleet Organization and Role Packaging` 模型，把底层能力组织为面向用户的角色化车队。

## 范围

本 spec 首轮覆盖：

- `Fleet` 的上层语义定义
- 车队角色的分层与最小角色集合
- 角色封装对象的定义
- `agents / nodes / executors / skills / tools` 到车队角色的映射口径
- 角色与 `Route`、`Drive State`、`Takeover` 的关系
- 与 `mission-first / workflow / runtime` 的兼容方式
- 面向前端展示与运行时投影的约束

本 spec 不覆盖：

- 动态角色系统的完整底层实现细节
- agent prompt 注入、role switch、权限控制等执行级机制重写
- 具体页面布局和视觉样式
- 所有 Web-AIGC 节点的一次性逐个归类改造
- 完整 Route Planner 或 FleetExecutionView 的实现细节

## 需求

### 需求 1：系统必须定义 Fleet 的产品层语义

系统必须明确 `Fleet` 在任务自动驾驶中的含义：
`Fleet` 不是底层 agent、node、executor 的简单列表，而是围绕当前 `Route` 被组织起来、用于完成当前任务的角色化执行编队。

`Fleet` 至少应满足以下语义：

- 面向用户回答“当前有哪些角色在推进任务”
- 面向系统回答“当前路线需要怎样的能力组合”
- 面向驾驶舱回答“当前车队是如何组织、协同和变化的”

验收要求：

- `Fleet` 必须被定义为产品层对象，而不是直接等同于某个底层 schema
- `Fleet` 必须能够承接 `Route` 规划输出并影响执行组织
- `Fleet` 必须可被投影到驾驶舱、车队主视图、回放与审计语义中

### 需求 2：系统必须定义用户可理解的车队角色集合

系统必须提供一组稳定、用户可理解的车队角色，用于包装底层能力，不直接把几十种 node、skill、tool 名称暴露给用户。

首轮角色至少应覆盖以下类型：

- `Planner`：负责路线制定、阶段拆解、策略组织
- `Clarifier`：负责目标澄清、约束补齐、缺口确认
- `Researcher`：负责搜索、检索、知识获取、信息比对
- `Operator`：负责调用外部系统、页面、工具或执行器完成实际操作
- `Generator`：负责产出文本、结构化内容、代码、文件或素材
- `Reviewer`：负责核查、校验、比对、验收和纠偏
- `Auditor`：负责风险、合规、证据、审计与回放关联
- `Coordinator`：负责多角色调度、交接、收敛与状态同步

验收要求：

- 每个角色必须有清晰职责边界
- 每个角色必须能映射到底层能力组合，而不是空壳名称
- 角色集合应允许后续扩展，但首轮必须有最小稳定集

### 需求 3：系统必须定义角色封装对象

系统必须定义一类面向产品层和投影层的“角色封装对象”，用于描述一个车队角色如何由底层能力组合承载。

该对象至少应包含：

- 角色标识与角色类型
- 角色面向用户的职责说明
- 当前角色绑定的能力来源
- 当前角色参与的路线阶段
- 当前角色的状态
- 当前角色的输入、输出与交付责任
- 当前角色对应的风险或接管特征

验收要求：

- 前端、驾驶舱与回放系统必须可以消费该对象
- 该对象必须同时保留“用户可读字段”和“可回溯到底层对象的关联字段”
- 该对象不能只包含文案说明，必须具有稳定结构

### 需求 4：系统必须明确底层对象到角色的封装映射

系统必须明确说明如何把现有工程对象重新包装为车队角色。

映射范围至少包括：

- `agent -> role carrier`
- `node -> role action / role step`
- `executor -> role actuator`
- `skill -> role capability`
- `tool / MCP -> role attachment`

映射原则至少包括：

- 一个角色可以绑定多个底层对象
- 同一底层对象在不同路线或不同阶段可被归入不同角色
- 一个角色不要求对应单一 agent，也不要求对应单一 node
- 用户默认看到角色，不直接看到全部底层对象明细

验收要求：

- 必须给出从底层对象到角色封装对象的统一口径
- 必须支持“从角色追溯到底层”和“从底层聚合到角色”两个方向
- 必须允许无法稳定归类时进入保守回退分类

### 需求 5：系统必须定义角色分层，而不是把所有能力混成同一层

系统必须把角色封装中不同类型的底层能力区分开来，避免把 agent、tool、executor、node 视为同层对象。

至少应支持以下分层：

- `Role`：用户可理解的角色语义层
- `Capability Package`：角色持有的能力包层
- `Execution Unit`：实际执行单元层，例如 agent、node、executor
- `Attachment`：附着在角色上的 skill、tool、MCP、policy 等扩展能力

验收要求：

- 设计必须清楚区分“谁负责”与“靠什么完成”
- skill、tool、executor 不应直接成为用户主视图中的同层角色
- 分层设计必须支撑前端摘要展示和工程回溯

### 需求 6：系统必须支持 Route 驱动的车队编组

系统必须明确 `Route` 如何决定 `Fleet` 的组织方式，而不是把车队视为任务启动时一次性固定的静态列表。

至少应支持以下关系：

- 不同 `Route` 模板可生成不同的角色组合
- 同一路线在不同阶段可启用不同角色
- `Replan` 后可触发车队重组或角色替换
- 并行路线可派生多个并行角色子编组

验收要求：

- 车队编组必须可被 `Route` 阶段、分支和重规划影响
- 角色状态变化必须能与 `Drive State` 联动
- 路线与车队之间必须有稳定的投影关系，而不是临时文案拼接

### 需求 7：系统必须支持 mission-first / runtime 兼容

系统必须保证车队角色封装层建立在现有 `mission-first / workflow / runtime` 基座之上，不要求底层立即重命名或重写。

兼容要求至少包括：

- `Fleet` 作为产品层对象存在
- `mission / workflow / task / runtime` 继续作为工程层事实对象存在
- 角色封装可由现有 mission、workflow instance、node state、agent records、executor state 投影生成
- 不要求先替换所有现有 API、测试和运行时命名

验收要求：

- 必须明确“产品层角色对象”和“工程层执行对象”的分层关系
- 必须支持渐进引入，不要求一次性重构所有 runtime
- 不允许通过纯前端硬编码虚构角色代替真实运行态映射

### 需求 8：系统必须支持用户可理解的展示摘要

系统必须保证车队角色可以被前端稳定展示为用户能理解的摘要信息。

每个角色摘要至少应可展示：

- 角色名称
- 当前职责
- 当前状态
- 当前阶段或焦点
- 主要输入与主要输出
- 关键风险或等待状态

验收要求：

- 用户在不展开底层细节时，也能理解当前车队如何协作
- 角色摘要必须支持显示“进行中、等待中、阻塞中、已完成”等统一状态
- 角色摘要必须能与步骤、阻塞点、中间结果和证据入口关联

### 需求 9：系统必须支持接管与治理语义

系统必须明确哪些车队角色天然更接近 `Takeover`、审核、审批、风险控制和人工决策。

至少应支持：

- `Clarifier` 与缺失信息补齐、澄清提问关联
- `Reviewer` 与结果确认、验收、纠偏关联
- `Auditor` 与风险、证据、审计、策略校验关联
- `Operator` 与外部执行、权限、预算、工具限制关联

验收要求：

- 角色定义必须能够承接接管点和治理风险说明
- 接管面板、风险面板和回放系统必须可以复用这套角色口径
- 不同角色的治理关注点必须有边界，而不是全部堆给同一个“执行者”

### 需求 10：系统必须支持 Web-AIGC 节点体系的渐进封装

系统必须允许当前大量 Web-AIGC 节点继续作为内部执行单元存在，并逐步被重新包装为车队角色语义，而不是要求一次性把所有节点改造成角色模型。

验收要求：

- 节点仍可作为内部编排事实存在
- 对外优先表达为角色、阶段和职责，而不是节点名列表
- 必须允许后续补充“节点到角色分类表”或“角色能力包目录”

### 需求 11：系统必须定义保守回退策略

当底层对象无法被稳定归类、角色归类置信度不足或不同模块给出冲突解释时，系统必须有保守回退策略。

至少应支持：

- 进入 `Generalist`、`Composite` 或 `Custom` 一类保守角色
- 明确标记该角色为临时封装或混合角色
- 保留底层来源，便于后续修正映射

验收要求：

- 系统不应在归类不稳定时强行精细命名
- 回退角色必须仍可用于前端展示和回放
- 回退策略必须优先保证解释一致性，而不是命名“好看”

## 非目标

以下内容不属于本 spec 首轮目标：

- 立即改造所有 agent prompt、skill binding、tool binding 实现
- 替换 `dynamic-role-system` 中已有的工程角色模板系统
- 重写 workflow runtime engine 或 executor 协议
- 为每个 node 单独设计用户可见角色
- 直接把底层 50+ 节点、工具、执行器平铺到产品主界面

## 当前主仓对齐备注（2026-04-25）

- 当前主仓已经稳定落地的是 `autopilotSummary.fleet` 这条摘要分支，而不是完整 `FleetComposition` 领域对象；本 spec 继续负责把这条摘要分支向上收口为清晰的产品语义、设计结构和后续落地边界。
- 当前 shared / server / client 的直接闭环，已经能够稳定承载 `role summary / role status / projection / store normalize / panel consume` 这一最小读链；因此 requirements 需要兼容“现有主仓已是最小摘要闭环”这一事实，而不是假设所有角色封装对象都已落地。
- 当前 shared builder 直接稳定合成的角色仍主要是 `planner`、waiting 场景下的 `clarifier` / 常规场景下的 `operator`，以及带 executor 上下文时追加的 `executor`；`researcher / generator / reviewer / auditor / coordinator / generalist / composite / custom` 仍应视为本 spec 的目标角色词汇与设计口径，而不是当前主仓已全面稳定产出的运行时事实。
- 当前 `tasks-store` 已实现两条保守兼容链：未知 `roleType` 归一为 `custom`，以及 projection 缺失时退化为单个 `Mission Core` `operator` 角色；这足以支撑 requirements 对“保守回退”的最小要求，但不应被误解为完整 fallback taxonomy 已全部实现。
- 当前 `TaskAutopilotPanel` 已经证明角色摘要视图可以稳定消费 `title / status / responsibility / currentFocus / boundAgents / boundExecutors / activeRoleCount / blockedRoleCount` 等字段；但驾驶舱、接管面板、回放视图和更完整的 fleet status 视图仍由相邻 spec 继续细化，因此本 spec 的验收重点仍是统一角色语义与字段边界，而不是声明所有视图都已完成接线。
- 当前主仓仍把 `executor` 暴露为一级 fleet summary 角色，因此 requirements 中关于 `executor -> role actuator` 的目标口径应被理解为“下一阶段要收口的角色封装方向”，而不是“现状已经完成的投影方式”。

## 补充收口说明（2026-04-25，lane 6）

本轮继续按“requirements/design 文档收口”和“当前主仓最小事实链”分层处理：

- 当前已经可以保守收口到 spec 层的部分
  - `executor -> role actuator` 的目标口径
  - 角色摘要对象在驾驶舱、车队状态视图、接管面板和回放视图中的统一复用口径
  - 与 runtime 兼容的集成测试计划
- 当前仍不能外推为实现已完成的部分
  - shared builder 已经不再把 `executor` 暴露成一级角色
  - 多视图 consumer 已全部接入同一份角色摘要对象
  - runtime 级 agent / node / executor 跨层投影集成测试已经在仓库中补齐

因此，本 spec 当前可以被理解为：

- 在文档层，车队角色封装的目标语义、对象分层、映射口径、复用边界与测试计划已经接近完整
- 在实现层，当前主仓依旧主要稳定在 `autopilotSummary.fleet` 的最小摘要闭环，需要后续按相邻 spec 与代码演进逐步兑现

## 依赖关系

本 spec 与以下方向存在强依赖或强协同：

- task-autopilot-core-concepts
- mission-model-to-autopilot-model-mapping
- route-planner-and-route-model
- drive-state-and-replan-state-machine
- fleet-status-and-live-execution-view
- takeover-panel-and-decision-points
- dynamic-role-system
