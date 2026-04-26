# 设计文档：任务自动驾驶驾驶舱信息架构

## 设计概述

本 spec 定义任务自动驾驶主界面的信息架构，不直接定义最终视觉风格、组件样式、动画语言或 3D 场景，而是先确定：

1. 用户进入任务驾驶舱后第一眼应该看到什么
2. 哪些内容属于一级信息块，哪些内容应下沉为二级展开
3. 哪些信息属于“目标与路线”，哪些属于“执行主视图”，哪些属于“接管与证据”
4. 现有 `mission / workflow / projection / session / replay / audit / lineage / HITL` 能力应如何收敛成统一入口
5. 这份信息架构如何作为后续 UI 原型、前端实现和多任务扩展的统一基线

本设计基于现有 `mission-first`、`Mission Runtime`、`mission projection`、`TaskAutopilotPanel`、`DecisionPanel` 等主仓能力，目标不是立即替换所有现有页面，而是为后续驾驶舱主界面建立一套稳定、可执行、可复用的 IA 口径。

## 设计目标

### 目标 1：从“功能块堆叠”切换为“驾驶舱分区”

驾驶舱首页不再按“聊天 / DAG / 审计 / 回放 / 操作栏”分散组织，而是固定收敛成三栏：

- 左侧：目标与路线
- 中间：执行主视图
- 右侧：接管与证据

### 目标 2：先回答任务推进问题，再回答系统内部问题

默认首屏优先回答：

1. 我要去哪
2. 系统准备怎么去
3. 现在正在做什么
4. 我是否需要接管
5. 这条路线是否可追溯、可审计、可回放

### 目标 3：把现有多种人机交互统一折叠为“接管面板”

`selection / param_collection / user_input / confirm_judge` 不再作为四种分散页面心智，而是统一映射到右侧“接管与证据栏”的 `Takeover Panel`。

### 目标 4：把 replay / audit / lineage 从“独立系统”变成“有上下文的证据入口”

驾驶舱不重复实现完整 replay / audit / lineage 页面，而是提供：

- 统一入口
- 稳定跳转参数
- 证据摘要规则
- 从当前任务上下文出发的最小可验证信息

## 核心设计

### 1. 三栏驾驶舱一级信息块

#### 1.1 左侧：目标与路线栏

左栏回答三个问题：

1. 目标是什么
2. 为什么当前路线合理
3. 当前已经走到哪一步

左栏是路线理解区，不承担执行日志和接管操作本身。

#### 1.2 中间：执行主视图

中栏回答三个问题：

1. 当前系统在做什么
2. 哪些角色/节点正在协同
3. 当前产出和状态是否健康

中栏是驾驶舱主屏，优先展示执行态、关键中间结果和当前变化。

#### 1.3 右侧：接管与证据栏

右栏回答两个问题：

1. 现在是否需要我介入
2. 这次执行是否有充分证据支持

右栏是人机协同区和可信性区，不承担大段聊天历史，也不承载完整 replay 页面本体。

### 2. 三栏驾驶舱二级信息块

#### 2.1 左侧一级/二级信息块

左栏一级信息块固定为：

1. `Destination Card`
2. `Route Card`
3. `Route Progress`
4. `Risk & Deviation Summary`

左栏二级展开信息块固定为：

1. `Destination Details`
2. `Candidate Routes`
3. `Route Diff`
4. `Route Evidence Summary`

#### 2.2 中间一级/二级信息块

中栏一级信息块固定为：

1. `Live Execution`
2. `Drive State`
3. `Fleet`
4. `Outputs`

中栏二级展开信息块固定为：

1. `Execution Timeline Summary`
2. `Intermediate Deliverables`
3. `Blocked Reasons`
4. `Recovery Actions`
5. `Parallel Branches`

#### 2.3 右侧一级/二级信息块

右栏一级信息块固定为：

1. `Takeover Queue`
2. `Takeover Panel`
3. `Evidence Summary`
4. `Trust Shortcuts`

右栏二级展开信息块固定为：

1. `Decision History`
2. `Replay Jump Card`
3. `Audit Jump Card`
4. `Lineage Jump Card`
5. `Cost / Permission Snapshot`

### 3. 一级信息块默认展示顺序

#### 3.1 左栏默认顺序

1. `Destination Card`
2. `Route Card`
3. `Route Progress`
4. `Risk & Deviation Summary`

默认只展示“当前任务完成所必需的最小信息”。

以下内容必须作为二级展开，而不是首屏默认全部展开：

- 全量候选路线说明
- 全量路线差异对比
- 全量路线证据事件
- 历史路线切换记录

#### 3.2 中栏默认顺序

1. `Live Execution`
2. `Drive State`
3. `Fleet`
4. `Outputs`

以下内容应默认折叠或作为二级标签页：

- 全量事件流
- 细粒度节点列表
- 完整并行分支展开
- 完整恢复动作历史

#### 3.3 右栏默认顺序

1. `Takeover Queue`
2. `Takeover Panel`
3. `Evidence Summary`
4. `Trust Shortcuts`

以下内容必须下沉为二级展开或外跳：

- 完整决策历史列表
- 完整 replay 时间轴
- 完整 audit 事件表
- 完整 lineage 图谱

## 左侧“目标与路线栏”定义

### 1. Destination Card

`Destination Card` 统一承载：

- 任务一句话目标
- 目标摘要
- 成功标准
- 约束条件
- 交付物
- 缺失信息
- 目标置信度

推荐绑定现有共享字段：

- `autopilotSummary.destination.goal`
- `autopilotSummary.destination.request`
- `autopilotSummary.destination.successCriteria`
- `autopilotSummary.destination.constraints`
- `autopilotSummary.destination.deliverables`
- `autopilotSummary.destination.missingInfo`
- `autopilotSummary.destination.confidence`
- `autopilotSummary.destination.missingInfoDetails`

### 2. Route Card

`Route Card` 统一承载：

- 当前已选路线
- 推荐路线
- 路线模式
- 当前阶段
- 路线选择状态
- 路线切换原因
- 是否锁定

推荐绑定现有共享字段：

- `autopilotSummary.route.selected`
- `autopilotSummary.route.selectedRoute`
- `autopilotSummary.route.selectedRouteId`
- `autopilotSummary.route.recommendedRouteId`
- `autopilotSummary.route.selectionStatus`
- `autopilotSummary.route.selection`
- `autopilotSummary.route.changeReason`
- `autopilotSummary.route.replan`

### 3. Route Progress

`Route Progress` 承载：

- 当前阶段
- 阶段总数
- 已完成阶段
- 待完成阶段
- 当前阶段标签

推荐绑定：

- `autopilotSummary.route.progress`
- `autopilotSummary.route.currentStageKey`
- `autopilotSummary.route.currentStageLabel`
- `autopilotSummary.route.stages`
- `autopilotSummary.explanation.remainingSteps`

### 4. Risk & Deviation Summary

`Risk & Deviation Summary` 承载：

- 当前风险点
- 偏航或阻塞摘要
- 是否等待接管
- 是否处于恢复态

推荐绑定：

- `autopilotSummary.route.riskPoints`
- `autopilotSummary.recovery`
- `autopilotSummary.takeover`
- `autopilotSummary.driveState`

## 中间“执行主视图”定义

### 1. Live Execution

`Live Execution` 是中栏主卡，统一承载：

- 当前步骤
- 当前步骤状态
- 并行分支数
- 阻塞原因
- 中间交付物
- 可执行动作摘要

推荐绑定：

- `autopilotSummary.execution.currentStepKey`
- `autopilotSummary.execution.currentStepLabel`
- `autopilotSummary.execution.currentStepStatus`
- `autopilotSummary.execution.parallelBranchCount`
- `autopilotSummary.execution.blockedReasons`
- `autopilotSummary.execution.intermediateDeliverables`
- `autopilotSummary.execution.availableActions`

### 2. Drive State

`Drive State` 统一承载：

- 当前驾驶状态
- 当前状态解释
- 是否阻塞
- 是否等待用户
- 风险等级
- 置信度

推荐绑定：

- `autopilotSummary.driveState`
- `autopilotSummary.explanation.currentState`

### 3. Fleet

`Fleet` 统一承载：

- 当前角色编队
- 活跃角色数
- 阻塞角色数
- 角色职责与关注点

推荐绑定：

- `autopilotSummary.fleet.roles`
- `autopilotSummary.fleet.activeRoleCount`
- `autopilotSummary.fleet.blockedRoleCount`

### 4. Outputs

`Outputs` 统一承载：

- 中间产物摘要
- 最近输出
- 当前交付物线索

推荐绑定：

- `autopilotSummary.execution.intermediateDeliverables`
- `autopilotSummary.destination.deliverables`
- `autopilotSummary.evidence.timeline`

## 右侧“接管与证据栏”定义

### 1. Takeover Queue

`Takeover Queue` 是右栏顶部的待处理事项队列，统一承载：

- 是否有待处理接管
- 当前接管类型
- 接管是否阻塞主线
- 当前优先级
- 当前 decisionId
- 接管摘要

最小字段口径：

- `status`
- `required`
- `blocking`
- `type`
- `reason`
- `prompt`
- `decisionId`
- `urgency`

推荐绑定：

- `autopilotSummary.takeover.status`
- `autopilotSummary.takeover.required`
- `autopilotSummary.takeover.blocking`
- `autopilotSummary.takeover.type`
- `autopilotSummary.takeover.reason`
- `autopilotSummary.takeover.prompt`
- `autopilotSummary.takeover.decisionId`
- `autopilotSummary.takeover.urgency`

### 2. Takeover Panel

`Takeover Panel` 是右栏核心交互块，用于统一承载不同类型的人工介入表单。

它必须固定由三部分组成：

1. `Decision Context`
2. `Decision Form`
3. `Decision Consequence Summary`

#### 2.1 Decision Context

统一展示：

- 当前接管类型
- 当前阶段
- 为什么需要接管
- 若不接管会阻塞什么
- 建议默认动作

#### 2.2 Decision Form

根据映射类型渲染不同输入结构，但交互骨架保持一致：

- 主操作项
- 补充说明
- 上下文引用
- 提交按钮

#### 2.3 Decision Consequence Summary

统一展示：

- 提交后会更新什么
- 是否会恢复执行
- 是否会锁定路线
- 是否会产生审计/回放证据

### 3. Evidence Summary

`Evidence Summary` 统一承载：

- 证据事件数
- 产物数
- 最后信号
- 最新事件类型
- 更新时间
- 信任等级
- 缺口摘要

推荐绑定：

- `autopilotSummary.evidence.eventCount`
- `autopilotSummary.evidence.artifactCount`
- `autopilotSummary.evidence.lastSignal`
- `autopilotSummary.evidence.latestEventType`
- `autopilotSummary.evidence.updatedAt`
- `autopilotSummary.evidence.trustLevel`
- `autopilotSummary.evidence.gaps`

### 4. Trust Shortcuts

`Trust Shortcuts` 是右栏底部的统一外跳入口组，固定包含：

1. `Replay`
2. `Audit`
3. `Lineage`

每个入口都必须同时显示：

- 名称
- 当前可用性
- 证据摘要
- 跳转参数预览

## 统一接管面板映射规则

### 1. 映射目标

`selection / param_collection / user_input / confirm_judge` 必须统一映射到同一个 `Takeover Panel` 骨架，不再各自形成独立页面心智。

### 2. 映射总表

#### 2.1 `selection`

触发条件：

- `decision.type === "multi-choice"`
- 且主输入为候选项选择

统一接管类型：

- `takeover.kind = "selection"`

表单结构：

- 候选项列表
- 推荐项标记
- 可选补充说明

结果语义：

- 更新已选路线、分支或策略
- 可能恢复执行
- 可能锁定路线或保留为可切换状态

#### 2.2 `param_collection`

触发条件：

- `decision.type === "request-info"`
- 且 `nodeType === "param_collection"`

统一接管类型：

- `takeover.kind = "param_collection"`

表单结构：

- 结构化字段列表
- 必填约束
- 附件/引用输入

结果语义：

- 补齐结构化参数
- 解除信息缺口
- 为后续执行或路线判断提供明确输入

#### 2.3 `user_input`

触发条件：

- `decision.type === "request-info"`
- 且输入主要为 free-text 或 comment-bound clarification

统一接管类型：

- `takeover.kind = "user_input"`

表单结构：

- 文本输入
- 可选补充说明
- 上下文引用说明

结果语义：

- 补齐非结构化上下文
- 更新目标理解或执行条件
- 不直接等同于批准/拒绝

#### 2.4 `confirm_judge`

触发条件：

- `decision.type === "approve"`
- 或 `decision.type === "reject"`
- 或语义上属于批准 / 驳回 / 通过 / 退回

统一接管类型：

- `takeover.kind = "confirm_judge"`

表单结构：

- 主结论选择
- 驳回原因或补充说明
- 后续动作摘要

结果语义：

- 明确给出批准、驳回、继续、终止等判定
- 直接影响流程是否继续推进

### 3. 映射字段规则

统一接管面板必须至少读取以下通用字段：

- `takeover.type`
- `takeover.reason`
- `takeover.prompt`
- `takeover.decisionId`
- `takeover.options`
- `route.takeoverPointIds`
- `evidence.correlation.decisionIds`

若某类接管缺少专属字段，也不得脱离统一面板骨架另起页面。

### 4. 统一交互约束

所有接管类型都必须支持以下四段式信息结构：

1. `Why`
2. `What you need to do`
3. `What will change after submit`
4. `Where to verify the result`

这四段必须优先于具体输入控件本身。

## Replay / Audit / Lineage 跳转入口与证据规则

### 1. 跳转入口目标

驾驶舱右栏只负责“上下文化入口”，不负责重做目标系统。

### 2. 统一入口结构

每个入口卡固定包含：

1. 标题
2. 一句话用途说明
3. 当前任务可用的上下文锚点
4. 一条证据摘要
5. 跳转按钮

### 3. 跳转透传参数

#### 3.1 Replay

必须优先透传：

- `missionId`
- `workflowId`
- `replayId`
- `timelineId`
- `selectedRouteId`
- `decisionIds`
- `currentStepKey`

若缺少 `replayId`，仍可使用 `missionId + workflowId + timelineId` 作为降级参数集合。

#### 3.2 Audit

必须优先透传：

- `missionId`
- `workflowId`
- `decisionIds`
- `auditEventIds`
- `selectedRouteId`
- `currentStepKey`

#### 3.3 Lineage

必须优先透传：

- `missionId`
- `workflowId`
- `lineageIds`
- `decisionIds`
- `selectedRouteId`

### 4. 证据摘要规则

#### 4.1 Replay 摘要

优先显示：

- 时间线 ID
- 最近关键事件类型
- 路线切换事件数

#### 4.2 Audit 摘要

优先显示：

- 决策数
- 审计事件数
- 当前信任等级

#### 4.3 Lineage 摘要

优先显示：

- Lineage 节点数或 ID 数
- 当前路线相关产物线索
- 是否存在可追溯输入来源

### 5. 右栏入口展示优先级

右栏默认优先展示：

1. 与当前接管直接相关的入口
2. 与当前路线直接相关的入口
3. 与当前阻塞/恢复直接相关的入口

不能把 replay / audit / lineage 全量导航直接搬进右栏。

## 桌面端布局约束

### 1. 适用范围

本节只定义首版桌面端布局约束，移动端与窄屏适配后续另开 spec。

### 2. 三栏宽度策略

桌面端三栏采用固定信息优先级，不采用对称分栏。

推荐宽度策略：

- 左栏：20% - 24%
- 中栏：46% - 56%
- 右栏：24% - 30%

硬性原则：

- 中栏始终为最大列
- 左栏不得宽于右栏
- 右栏必须能完整容纳接管表单与证据入口卡

### 3. 最小可用宽度

首版桌面端最小设计宽度定义为：

- 推荐基线：1440px
- 最小可用：1280px

在最小可用宽度下必须保留：

- 三栏同时可见
- 左栏至少完整显示 `Destination Card + Route Card`
- 中栏至少完整显示 `Live Execution`
- 右栏至少完整显示 `Takeover Queue + Evidence Summary`

### 4. 折叠策略

桌面端不允许整栏消失，只允许块级折叠。

推荐折叠优先级：

1. 先折叠二级块
2. 再折叠长列表
3. 不折叠一级标题和关键摘要

禁止首版出现以下情况：

- 默认只显示中栏，左右栏通过抽屉打开
- 接管栏被收进二级页导致用户看不到待处理事项
- 证据入口完全下沉到底部不可见

### 5. 最小可用展示顺序

当桌面端空间受压缩时，信息保留顺序必须为：

1. `Destination Card`
2. `Route Card`
3. `Live Execution`
4. `Takeover Queue`
5. `Takeover Panel`
6. `Evidence Summary`

以下内容可后置：

- 决策历史
- 完整证据时间线
- 全量路线对比
- 完整 Fleet 明细

## 统一 IA 基线

### 1. 对后续 UI 原型的约束

后续任何驾驶舱 UI 原型都必须沿用以下一级块命名和分区心智：

- 左：`Destination / Route / Route Progress / Risk & Deviation`
- 中：`Live Execution / Drive State / Fleet / Outputs`
- 右：`Takeover Queue / Takeover Panel / Evidence Summary / Trust Shortcuts`

### 2. 对前端实现的约束

后续前端实现即使阶段性仍嵌在 `TaskDetailView` 内，也应优先沿本 spec 的块级分区组织，而不是继续按页面来源拆模块。

### 3. 对多任务扩展的约束

未来扩展多任务视图时：

- 多任务列表不是三栏之一
- 多任务切换应发生在驾驶舱外层
- 三栏 IA 只服务“当前激活任务”

### 4. 对新 spec 的约束

后续若新增：

- cockpit UI 原型 spec
- cockpit 前端实现 spec
- 多任务调度 / 任务队列 spec
- replay / audit / lineage 入口接线 spec
- HITL 接管统一交互 spec

都必须默认继承这份 IA 作为顶层结构基线，而不是重新命名三栏和一级块。

## 页面组织原则

- 驾驶舱首页默认聚焦单一任务
- 多任务切换通过外层任务列表、顶部切换器或任务枢纽完成
- 聊天记录、细粒度 DAG、完整审计表、完整回放时间轴都属于二级内容
- 首屏永远优先服务任务推进，其次才是系统解释

## 设计约束

- 本 spec 不定义最终视觉风格与组件库样式
- 本 spec 不要求用户直接操作底层 50+ 节点
- 本 spec 不直接替代已有 replay / audit / lineage 页面
- 本 spec 不定义 L1-L5 自动驾驶等级
- 本 spec 首版只覆盖桌面端 IA 基线

## 审计补注：2026-04-25

本轮补充的是“信息架构定义层”的闭环，不等同于完整 UI 已落地。

本轮可以保守确认的新增结论如下：

- 这份 spec 现在已经完整定义三栏驾驶舱的一/二级信息块，并明确默认展示与二级下钻边界。
- 右侧“接管与证据栏”现在已经形成稳定结构：`Takeover Queue / Takeover Panel / Evidence Summary / Trust Shortcuts`。
- `selection / param_collection / user_input / confirm_judge` 已被定义为统一映射到同一个 `Takeover Panel` 骨架，而不是四套平行页面。
- `replay / audit / lineage` 的右栏入口、透传参数与证据摘要规则已形成统一口径，可作为后续跳转接线与 UI 实现的设计基线。
- 首版桌面端三栏宽度策略、最小可用宽度、块级折叠规则与最小保留顺序现在都有明确口径。
- 这份 spec 已可作为后续 cockpit UI、前端实现、多任务扩展和证据入口接线 spec 的统一 IA 基线。

但边界仍需严格限定：

- 当前确认的是“设计定义已完成”，不是“右栏 UI、跳转入口、统一接管面板代码已经全部落地”。
- 当前不能据此外推 `TaskDetailView` 已经是完整独立驾驶舱页面，只能说后续实现应以本 IA 为准绳收敛。
- 当前也不能据此反推 replay / audit / lineage 的真实跳转按钮与页面联调已经完成；本轮只完成了结构、参数和摘要规则的定义。
