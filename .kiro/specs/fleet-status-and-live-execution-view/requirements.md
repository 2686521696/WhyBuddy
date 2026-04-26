# 需求文档：车队状态与实时执行主视图

## 目标

定义任务自动驾驶中的“车队状态与实时执行主视图”，让用户在单一主视图中稳定看到系统当前如何组队、如何执行、执行到哪里、哪些步骤并行推进、哪里被阻塞、产生了哪些中间结果、有哪些执行证据可以追溯。

该主视图不应成为一套脱离现有 `agent / node / executor / runtime / mission / workflow` 体系的新真相，而应建立在现有运行时、节点编排、执行器状态、日志、产物、审计和回放能力之上，形成统一、可读、可解释的“驾驶舱中台视图”。

## 背景

当前主仓已经具备以下运行时能力基础：

- mission / workflow 执行链路
- agent 与 node 级别的任务推进
- executor / browser / native / mock 等执行器状态
- logs / artifacts / runtime evidence
- replay / audit / lineage 等追溯能力
- human-in-the-loop 决策等待与恢复

但对用户而言，相关信息仍然容易分散在多个入口中：

- 节点状态和 mission 状态分散
- executor 运行信息与任务主线脱节
- 日志、产物、中间结果与当前步骤缺少统一归位
- 并行执行和阻塞点缺少清晰的主视图表达
- 角色编队和节点执行之间缺少中间抽象

因此需要定义一套上层主视图，把系统内部“节点编排与执行事实”升级为“车队状态与实时任务进度”。

## 范围

本 spec 首轮覆盖：

- 角色编队展示
- 当前步骤与阶段位置展示
- 并行执行状态展示
- 中间产物与阶段性结果展示
- 阻塞点、等待点、失败点展示
- 执行证据入口与归位
- 与现有 agent / nodes / executors / runtime 的兼容映射

本 spec 不覆盖：

- 完整 replay 页重构
- 完整 debug / lineage 页重构
- 3D 场景视觉表现细节
- 新的底层 runtime 协议重写

## 需求

### 需求 1：系统必须提供统一的车队主视图

系统应提供一个统一的实时执行主视图，用来表达“当前这次任务是如何被一支临时车队执行的”，而不是让用户自己去理解内部节点图。

主视图至少应包含：

- 当前任务目标摘要
- 当前步骤 / 当前阶段
- 当前编队角色
- 当前活跃执行单元
- 并行中的分支或子任务
- 当前中间结果
- 当前阻塞点或等待点
- 执行证据入口

验收要求：

- 用户不需要打开多个页面就能理解任务主线执行态
- 主视图必须围绕“当前任务如何被完成”组织，而不是围绕技术模块目录组织
- 同一类信息不能在多个主入口重复并列展示

### 需求 2：系统必须展示角色编队

系统应将内部 agent / node / sub-task / runtime worker 抽象为用户可理解的车队角色。

首批角色可包括但不限于：

- Planner
- Clarifier
- Researcher
- Generator
- Reviewer
- Auditor
- Executor

验收要求：

- 视图中应显示当前编队中有哪些角色
- 每个角色至少应显示状态、当前职责、关联执行单元数量
- 角色视图必须能够映射回现有 agent / node / executor / runtime，不可成为脱离底层的空壳概念

### 需求 3：系统必须展示当前步骤与阶段位置

系统应明确展示任务当前处于哪一个步骤、哪一个阶段，以及前后相邻步骤是什么。

至少应支持展示：

- 当前阶段名称
- 当前步骤名称
- 当前步骤状态
- 已完成步骤
- 进行中步骤
- 待执行步骤

验收要求：

- 当前步骤必须高亮
- 等待人工、阻塞、失败、重试中的步骤必须显式可见
- 若系统处于重规划、回退或重试中，主视图必须表达“当前步骤”与“步骤状态”的差异

### 需求 4：系统必须表达并行执行状态

系统应能把多个并行执行中的角色、节点、分支或执行器稳定展示出来，而不是只展示一个线性的“当前步骤”。

并行展示至少应覆盖：

- 多角色同时工作
- 多节点并行执行
- 多 executor 并行运行
- 子任务分支并行推进

验收要求：

- 用户可以看出有哪些单元在并行执行
- 并行状态应有统一状态语义，例如运行中、等待中、阻塞中、完成、失败
- 并行分支收敛后，主视图应能回到统一主线，而不是形成长期分散状态

### 需求 5：系统必须展示中间产物与阶段性结果

系统应允许用户在主视图中看到当前阶段已经产出的中间结果，而不是只能看到最终交付物。

中间结果至少包括：

- 文本草稿
- 结构化摘要
- 研究结论
- 代码片段
- 文件产物
- 图像、截图、链接或预览

验收要求：

- 中间结果必须与对应步骤或角色相关联
- 中间结果应区分“草稿 / 待确认 / 最终采用”
- 用户应能从主视图进入更细的 artifact 或 output 预览

### 需求 6：系统必须显式展示阻塞点与等待点

系统应让用户知道任务为什么停住、卡在何处、是否需要接管，而不是仅仅显示“未完成”。

阻塞类型至少包括：

- 等待用户澄清
- 等待审批或确认
- 等待外部回调
- 等待 executor 完成
- 权限不足
- 工具调用失败
- 预算或治理限制阻塞

验收要求：

- 阻塞点必须显示原因
- 阻塞点必须标明所属角色、所属步骤或所属执行单元
- 若阻塞点可恢复，主视图应给出恢复方式或恢复入口提示

### 需求 7：系统必须展示执行证据

系统应把 logs、runtime 状态、artifacts、callbacks、recent actions、失败原因等执行证据统一归位到主视图可达范围内。

验收要求：

- 主视图必须能进入 logs / artifacts / runtime evidence
- 执行证据不能和主线叙事完全脱离
- 证据入口应与当前步骤、当前角色、当前 executor 状态建立关联

### 需求 8：系统必须与现有 agent / nodes / executors / runtime 兼容

该主视图不能要求一次性替换现有运行时模型，而应通过映射层承接已有事实。

至少应兼容以下底层对象：

- mission
- workflow instance
- runtime node state
- agent records
- executor state
- logs / artifacts
- HITL 决策态

验收要求：

- 主视图字段应能从现有主仓运行态推导或投影出来
- 不要求立即引入全新底层 schema
- 不允许通过前端硬编码虚构状态来替代真实运行态

### 需求 9：系统必须支持实时更新

主视图应随任务推进而实时刷新，让用户看到执行进展，而不是只在任务结束后回看。

实时更新至少覆盖：

- 当前步骤变化
- 角色状态变化
- executor 状态变化
- 新日志与新产物
- 阻塞与恢复
- 人工接管状态变化

验收要求：

- 任务执行过程中用户能连续看到状态变化
- 更新应尽量增量化，不应每次整体重绘为新页面
- 在 socket / callback / poll 共存时，应以现有主仓稳定机制为准

### 需求 10：系统必须可用于任务自动驾驶主驾驶舱

该主视图应成为未来任务自动驾驶驾驶舱的中间主视图核心部分，而不是只服务于技术调试。

验收要求：

- 主视图语言应偏“目标、步骤、车队、阻塞、结果、证据”，而不是仅偏“节点、事件、线程、容器”
- 主视图既要能面向用户，也要能面向高级操作者
- 后续可平滑接入 Destination、Route、Drive State、Takeover 等上层对象

## 非目标

以下不属于本 spec 首轮目标：

- 重新设计所有 agent 的内部协议
- 完整替换 replay / debug / lineage 页面
- 引入全新的任务图编辑器
- 把所有 node 名称直接暴露为前台产品概念

## 需求审计备注（2026-04-25，Lane 4 收口）

本轮基于当前 `shared -> server -> client -> panel -> tests` 的直接证据，对这份 spec 的现实边界补一层保守收口：

- 当前已经存在一条稳定的“首版实时执行主视图”链路：
  - `shared/mission/autopilot.ts` 统一产出 `destination / driveState / route / execution / fleet / takeover / recovery / evidence / explanation / bindings`
  - `server/tasks/mission-projection.ts` 透传并对齐 projection links
  - `client/src/lib/tasks-store.ts` 做 fallback + normalize，并同步到 summary / detail
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 以 `Live Execution / Fleet / Blockers / Outputs / Evidence / Explanation / Takeover` 摘要块消费
- 因此，本 spec 中“统一主视图”“执行证据归位”“与现有 runtime 兼容”“实时更新”“驾驶舱中间主视图”这些需求，已经有最小实现锚点，但当前落点仍是任务详情页中的 summary blocks，而不是独立 execution cockpit。
- 当前可以被直接代码与测试稳定证明的字段口径主要包括：
  - `execution.currentStepKey / currentStepLabel / currentStepStatus`
  - `execution.parallelBranchCount / blockedReasons / intermediateDeliverables / availableActions`
  - `fleet.roles / activeRoleCount / blockedRoleCount`
  - `takeover.status / required / blocking / type / reason / prompt / options / urgency`
  - `recovery.state / deviationCategory / attemptedActions / suggestedActions / needsHuman / canAutoRecover`
  - `evidence.eventCount / artifactCount / lastSignal / latestEventType / trustLevel / gaps / timeline / correlation`
  - `explanation.currentState / recommendationDetails / remainingSteps`
  - `bindings.missionId / workflowId / executorJobId / instanceId`

本轮同时明确，以下需求边界仍未被直接代码 + 直接测试完全闭环：

- 结构化 `parallel lanes` 与分支收敛规则仍未形成独立对象模型。
- 中间产物仍主要以 `intermediateDeliverables` 与 `outputs.items` 摘要承载，尚未统一为强类型 output 模型。
- 阻塞点与等待点仍由 `takeover + recovery + blockedReasons` 组合表达，尚未形成统一 blocker type / owner / recoverability 模型。
- 角色编队的完整产品语义仍未覆盖 `Researcher / Generator / Reviewer / Auditor` 的稳定映射。
- 角色卡、步骤卡、证据入口的展开跳转与接管交互仍未形成完整 execution cockpit 行为。

## 需求对齐补充（2026-04-25，Lane 5 设计收口）

- 本轮继续推进的是“需求口径与设计 contract 收口”，不是把 `fleet status / live execution view` 直接外推为已经完整上线的独立前后端功能。
- 对于需求 2 到需求 6，以及与之相连的交互行为、联调样例，本轮统一采用以下解释边界：
  - 当前主仓的真实事实源仍是 `MissionAutopilotSummary` 及其 `route / execution / fleet / takeover / recovery / evidence / explanation` 子块。
  - `TaskAutopilotPanel` 当前承担的是任务详情页中的首版只读摘要视图，而不是完整的 execution cockpit。
  - 本轮允许把“角色编队映射、当前步骤投影、并行执行投影、中间产物模型、阻塞与等待点模型、交互行为、联调样例”按设计定义完成来收口，但不把它们误记为“已形成完整实现证据”。
- 因此，本 spec 的验收要求在本轮应分成两层理解：
  - 第一层是当前主仓已具备的最小摘要闭环，用于约束设计必须锚定真实 `MissionAutopilotSummary` 字段。
  - 第二层是后续工程实现仍需继续兑现的 richer contract，例如结构化 `parallel lanes`、typed `blocker / output`、可展开跳转的卡片交互与独立联调资产。
- 若后续工程推进要声明“实现闭环完成”，仍需补齐对应 shared / server / client / tests 的直接证据，而不能仅凭本轮文档收口。

## 依赖关系

本 spec 与以下方向存在强依赖或强协同：

- autopilot-cockpit-information-architecture
- route-planner-and-route-model
- takeover-panel-and-decision-points
- task-runtime-visibility-v1
- replay-and-debug-surface-v1
- mission-runtime
