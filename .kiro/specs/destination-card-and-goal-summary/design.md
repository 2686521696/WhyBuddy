# 设计文档：目的地卡片与目标摘要

## 设计概述

目的地卡片是任务自动驾驶界面中的第一张核心卡片，用于回答用户最先关心的几个问题：

- 系统认为我的目标是什么
- 什么算完成
- 有哪些限制条件
- 最后会交付什么
- 现在理解得稳不稳
- 还缺什么信息

这张卡片不负责展示完整路线、完整编队或完整执行日志，而是作为整个任务的“目标锚点”和“解释入口”。

## 设计范围

本 spec 关注三个层面：

- 卡片字段定义
- 字段来源与映射
- 与现有 `mission-first / workflow / runtime` 的兼容方式

本 spec 不负责：

- 路线选择交互细节
- 驾驶状态机本身
- 接管面板本身

## 卡片结构

### 1. 目标概述区

目标概述区用于一句话总结用户真正要送达的结果。

建议字段：

- 卡片标题：目的地
- 目标一句话摘要
- 目标类型标签
- 可选的子目标简述

设计原则：

- 优先摘要“结果目标”，不要优先描述“工具动作”
- 保持短句、稳定、可复用
- 若目标发生重定义，应保留变更来源

### 2. 成功标准区

成功标准区用于表达系统认为什么情况下任务算完成。

建议字段：

- 完成判定摘要
- 质量要求
- 时间要求
- 用户确认要求

设计原则：

- 成功标准应尽量显式，不应只存在于系统内部推断
- 如标准不完整，应允许标记为“待确认”

### 3. 约束区

约束区用于表达任务执行边界。

建议字段：

- 范围限制
- 风格与格式要求
- 成本约束
- 权限与安全限制
- 合规说明

设计原则：

- 约束应单独展示，不与成功标准混排
- 高风险约束应为后续接管点提供输入

### 4. 预期交付物区

预期交付物区用于告诉用户“系统准备交付什么”。

建议字段：

- 主交付物
- 辅助交付物
- 交付格式
- 交付颗粒度

示例：

- 主交付物：产品改造方案
- 辅助交付物：架构图、任务清单、风险说明
- 交付格式：Markdown + SVG

设计原则：

- 优先使用用户可验证的交付名称
- 应能投影到 workflow 输出或最终产物集合

### 5. 置信度区

置信度区用于表达系统对当前目的地理解是否稳定。

建议表达方式：

- `高 / 中 / 低`
- 可选简化分值
- 简短原因说明

示例：

- 高：目标明确、约束完整、交付物清晰
- 中：目标明确，但成功标准仍有部分缺失
- 低：目标存在歧义，缺少关键上下文

设计原则：

- 置信度要能解释，不能只有数字
- 低置信度应推动澄清、接管或默认路线降级

### 6. 缺失信息区

缺失信息区用于显式列出还未补齐的重要上下文。

建议字段：

- 缺失项名称
- 缺失原因
- 影响范围
- 是否阻塞执行

设计原则：

- 缺失信息应为后续 `Takeover Point` 做准备
- 非阻塞缺失项可允许边执行边补充
- 阻塞项应突出显示

## 数据来源与映射

### 产品层来源

目的地卡片由 `Destination` 对象投影而来，优先读取：

- 目标描述
- 成功标准
- 约束
- 预期交付物
- 缺失信息
- 当前置信度

### 工程层映射

| 卡片字段 | 产品层对象 | 现有工程来源 | 说明 |
| ---- | ---- | ---- | ---- |
| 目标概述 | `Destination.goal` | `mission.title` / `mission.summary` / 初始输入摘要 | 统一成高层任务目标 |
| 成功标准 | `Destination.successCriteria` | `mission metadata` / runtime context | 用于说明完成判定 |
| 约束 | `Destination.constraints` | mission config / workflow config / policy context | 包括预算、格式、权限、合规 |
| 预期交付物 | `Destination.deliverables` | workflow outputs / artifact plan | 对齐最终交付内容 |
| 当前置信度 | `Confidence` | parser result / runtime evaluator | 反映目标理解稳定度 |
| 缺失信息 | `Destination.missingInfo` | clarification queue / input request | 与后续澄清和接管联动 |

## 与 mission-first / workflow / runtime 的兼容策略

### 与 mission-first 的关系

- 目的地卡片是 `mission-first` 的上层解释卡片
- 它不是新的任务类型，而是 mission 的高层用户态摘要
- 一个 mission 可以直接生成一张目的地卡片

### 与 workflow 的关系

- 目的地卡片不展示完整 `workflow`
- 但其内容应作为后续路线推荐和 workflow 规划的输入
- 预期交付物与约束应影响 workflow 阶段和输出配置

### 与 runtime 的关系

- runtime 可持续更新置信度、缺失信息和已确认约束
- 当用户补全信息后，卡片应支持增量刷新
- 卡片刷新不等同于路线重绘，但可触发后续 `Replan`

## 展示与刷新原则

### 展示原则

- 默认优先展示稳定摘要，不展示底层原始 JSON
- 信息顺序建议为：
  - 目标概述
  - 成功标准
  - 约束
  - 预期交付物
  - 当前置信度
  - 缺失信息

### 刷新原则

- 目标概述：仅在目标重解析或用户明确修改时变化
- 成功标准与约束：允许在澄清后补齐
- 预期交付物：允许随路线收敛而细化
- 置信度：允许随理解与执行进展动态更新
- 缺失信息：允许在补充输入后减少或关闭

### 字段层级与来源优先级

本 spec 将目的地卡片字段划分为四类，后续所有 refresh、replan、takeover 与 cockpit consumer 都必须按同一层级理解：

- 稳定锚点字段：
  - `goal`
  - `request`
- 稳定补齐字段：
  - `successCriteria`
  - `constraints`
- 路线联动细化字段：
  - `deliverables`
- 动态评估字段：
  - `confidence`
  - `missingInfo`
  - `missingInfoDetails`

统一来源优先级如下：

1. 用户明确确认或修改
2. 治理 / 权限 / 合规强约束
3. 已批准的接管决策、目标改写或 replan 结果
4. parser / runtime 的结构化推断
5. raw mission / workflow / artifact fallback

同一刷新周期内，优先级高的来源覆盖优先级低的来源；consumer 不允许把低优先级 fallback 与高优先级字段静默混排成一个新的“中间态摘要”。

| 字段 | 字段层级 | 首选来源 | 回退来源 | 允许刷新触发 | 默认冻结 / 重算边界 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `goal` | 稳定锚点字段 | 用户确认后的目标定义 / 已批准的目标改写 | parser 归纳出的任务目标 / `mission.title` | `MissionInitialized`、`DestinationRedefined` | 普通 route 选择、执行进度与置信度波动都不能直接改写；一旦变化，必须视为“目的地重定义”并触发整卡重算 |
| `request` | 稳定锚点字段 | 用户原始请求快照 / 用户明确替换后的请求快照 | `mission.sourceText` / `mission.summary` | `MissionInitialized`、`SourceRequestEdited` | 默认冻结为输入快照；普通澄清、route 选择与 replan 只能补上下文，不能把 request 改写成新的目标摘要 |
| `successCriteria` | 稳定补齐字段 | 用户确认的完成条件 / 审批确认的验收条件 | parser / runtime 提炼出的完成判定 | `MissionInitialized`、`ClarificationAnswered`、`GovernanceChanged`、`DestinationRedefined` | 允许补齐与细化；不允许被普通 route 选择静默弱化或删除；若完成定义根本变化，应升级为目标改写 |
| `constraints` | 稳定补齐字段 | 用户确认约束 / 政策与权限强约束 | mission config / workflow config / policy extract | `MissionInitialized`、`ClarificationAnswered`、`GovernanceChanged`、`DestinationRedefined` | 允许补齐与收紧；放宽或移除高风险约束必须来自显式批准，不能由 runtime 或 route 推荐自行回写 |
| `deliverables` | 路线联动细化字段 | 用户确认的交付物定义 / 已批准的输出合同 | workflow outputs / artifact plan / route 产物规划 | `MissionInitialized`、`ClarificationAnswered`、`RouteSelectionCommitted`、`ReplanCommitted`、`DestinationRedefined` | 允许细化格式、颗粒度与配套物；若主交付物类别变化，应附带 changed reason，并升级为目标改写或显式 replan 说明 |
| `confidence` | 动态评估字段 | runtime 当前评估结果 | parser 初始估计 | 任意 summary refresh，包括 `ClarificationAnswered`、`RouteSelectionCommitted`、`ReplanCommitted`、`ExecutionCheckpointUpdated` | 永不冻结；只能解释当前理解稳定度，不能单独作为改写稳定字段的依据 |
| `missingInfo` | 动态评估字段 | 当前仍未关闭的缺口摘要 | parser 缺口清单 / 由 `missingInfoDetails` 回填 | `MissionInitialized`、`ClarificationAnswered`、`RouteSelectionCommitted`、`ReplanCommitted`、`ExecutionCheckpointUpdated` | 允许增减与关闭；已关闭项应从当前卡片移除，但历史记录应交由其他链路保留 |
| `missingInfoDetails` | 动态评估字段 | 当前打开的 clarification / takeover 缺口明细 | parser 推断缺口 / `missingInfo` 派生兼容数据 | `MissionInitialized`、`ClarificationAnswered`、`RouteSelectionCommitted`、`ReplanCommitted`、`ExecutionCheckpointUpdated` | 允许逐项开闭；consumer 不允许仅凭本地 UI 状态把缺口标记为已解决 |

### 刷新触发矩阵

目的地卡片 refresh 不是“整卡任意改写”，而是按事件类型做受控刷新。建议最小事件口径如下：

| 触发事件 | 应刷新字段 | 默认保持不变 | 说明 |
| ---- | ---- | ---- | ---- |
| `MissionInitialized` | 全量字段 | 无 | 初次建卡，允许从 mission / workflow / parser / policy 汇总完整 destination contract |
| `ClarificationAnswered` | `successCriteria`、`constraints`、`deliverables`、`confidence`、`missingInfo`、`missingInfoDetails` | `goal`、`request` | 只有当用户明确改写任务目标时，才允许升级为 `DestinationRedefined` |
| `GovernanceChanged` | `constraints`、必要时的 `successCriteria`、`confidence`、`missingInfo`、`missingInfoDetails` | `goal`、`request` | 政策收紧可立即生效；政策放宽不能绕过显式批准链路 |
| `RouteSelectionCommitted` | `deliverables`、`confidence`、`missingInfo`、`missingInfoDetails` | `goal`、`request`、`successCriteria`、`constraints` | 选择路线后允许交付物细化与缺口重评估；“选了哪条路”不等于“目的地变了” |
| `ReplanCommitted` | `deliverables`、`confidence`、`missingInfo`、`missingInfoDetails`，必要时重算 `successCriteria / constraints` 的补充摘要 | `goal`、`request` | 仅当 replan 附带显式 destination change proposal 被批准时，才可升级为整卡重算 |
| `ExecutionCheckpointUpdated` | `confidence`、`missingInfo`、`missingInfoDetails` | `goal`、`request`、`successCriteria`、`constraints`、`deliverables` | 纯执行进度变化不应把 destination card 退化成进度面板 |
| `SourceRequestEdited` | `request`，并触发整卡重算 | 无 | 原始请求文本被用户替换时，应重新生成 goal / success / constraints / deliverables 的候选摘要 |
| `DestinationRedefined` | 全量字段 | 无 | 明确的目标改写事件；是唯一允许同时重写稳定锚点字段与稳定补齐字段的入口 |

### 字段冻结与重算边界

- `goal` 是整张卡片的稳定锚点。
  - route recommendation、route selection、execution checkpoint 与局部澄清都不应静默重写 `goal`
  - 若下游判断“当前路线意味着用户其实想去另一个目的地”，必须输出 `destination change proposal`，而不是直接覆盖字段
- `request` 是输入快照，不是实时摘要槽。
  - 后续澄清只是在 request 周围补上下文
  - 只有用户明确替换原始请求文本时才允许刷新
- `successCriteria` 与 `constraints` 采用“补齐优先、弱化受限”的边界。
  - 可以在澄清、治理或审批后补充
  - 不允许被普通 route 选择、普通 replan 或纯执行进展静默删除、降级或弱化
- `deliverables` 采用“主类别稳定、细节可重算”的边界。
  - 允许在 route 收敛后细化格式、颗粒度、配套交付物
  - 若主交付物发生类别切换，应附带 changed reason，并进入 replan / takeover 说明链路
- `confidence`、`missingInfo`、`missingInfoDetails` 属于动态评估槽。
  - 允许每次 summary refresh 重算
  - 但它们只能解释“现在稳不稳、还缺什么”，不能单独推翻稳定锚点字段
- local UI state 不得成为 destination contract 的事实来源。
  - 任一 consumer 的本地编辑都只能形成 proposal / answer / decision
  - canonical destination 必须通过 projection / summary refresh 回流

### 局部刷新与整卡重算

- 以下情况应触发局部刷新，而不是整卡重算：
  - 澄清回答补齐了成功标准、约束或缺口
  - 路线选择导致交付物颗粒度细化
  - runtime checkpoint 改变了 confidence 或缺口状态
- 以下情况应触发整卡重算：
  - 用户明确改写目标
  - 原始请求文本被替换
  - 主交付物类别、核心验收定义或高风险约束发生根本改写
- 局部刷新不能越权改写稳定锚点字段；整卡重算也不等于 UI 自由重排，仍需保留同一字段合同与展示顺序

## 设计约束

- 不要求一次性解决所有目标歧义
- 不将卡片设计成聊天消息列表
- 不在本 spec 中定义路线切换 UI
- 后续驾驶舱、接管与路线相关 specs 必须复用本卡片字段口径

## 下游输入约束与 Consumer 合同

### 统一输入口径

- 后续路线推荐、接管面板与驾驶舱主界面都应把 `autopilotSummary.destination` 视为目的地卡片的 canonical input。
- 下游 consumer 的允许读取优先级必须保持一致：
  1. normalize 后的 `autopilotSummary.destination`
  2. projection 中的 `autopilotSummary.destination`
  3. shared builder 产出的 destination snapshot
  4. raw mission / workflow / artifact 字段，仅用于兼容冷启动
- 一旦结构化 `destination` 已存在，consumer 不得绕回 `mission.title / summary / artifact list` 自己再拼一张冲突的“目的地摘要卡片”。
- 下游 consumer 若只拿到部分字段，可以补空值，但不能本地发明与 canonical input 冲突的新语义。

### Route Recommendation 合同

路线推荐模块至少应消费以下输入：

- 稳定锚点：
  - `goal`
  - `request`
- 规划约束：
  - `successCriteria`
  - `constraints`
  - `deliverables`
- 风险与澄清信号：
  - `confidence`
  - `missingInfoDetails`

路线推荐模块必须遵守：

- 以 `goal` 作为路线规划的首要目标，不得用 route label 反向改写 destination
- 以 `constraints` 与 `successCriteria` 作为候选路线筛选门槛，而不是仅作展示文案
- 以 `missingInfoDetails` 与 `confidence` 决定“是否可自动推荐 / 是否需要先澄清 / 是否只给保守路线”

路线推荐模块禁止：

- 跳过 destination contract，直接用 raw mission 文案生成与卡片冲突的路线意图
- 因为推荐出更优路线，就静默重写 `goal / constraints / deliverables`
- 仅凭 route selection 结果把缺口标记为已解决

若路线推荐判断“当前目的地定义本身需要变化”，输出应是：

- `destination change proposal`
- 对应 changed reason
- 需要 takeover / replan 的标记

而不是本地直接改写目的地卡片。

### Takeover Panel 合同

接管面板至少应消费以下输入：

- `goal`
- `successCriteria`
- `constraints`
- `deliverables`
- `confidence`
- `missingInfoDetails`

接管面板的职责是围绕现有 destination contract 发起确认，而不是绕开它另建一套字段体系：

- 缺口澄清问题优先来自 `missingInfoDetails`
- 风险型确认优先来自 `constraints` 与低 `confidence`
- 交付确认优先来自 `deliverables` 与 `successCriteria`

接管面板禁止：

- 在本地 state 中直接把用户回答写成新的 canonical destination
- 用 route-selection decision 直接改写 `goal / request`
- 因为用户批准某条路线，就默认高风险约束已经解除

接管面板的合法输出应回流为以下几类事件之一：

- `ClarificationAnswered`
- `GovernanceChanged`
- `RouteSelectionCommitted`
- `DestinationRedefined`

### Cockpit Main View 合同

驾驶舱主界面应把目的地卡片作为主视图中的固定目标锚点，而不是可选附属信息：

- 左侧或顶部必须存在一块稳定的 destination summary 区域
- route、drive state、evidence、takeover 等模块都围绕同一份 destination contract 展开
- cockpit 中出现的任何目标摘要文案，都应能映射回 `goal / request / successCriteria / constraints / deliverables / confidence / missingInfoDetails`

驾驶舱主界面禁止：

- 在 route pane、decision pane、evidence pane 中各自维护互相冲突的“任务目标摘要”
- 把 execution progress 文案误当成新的 destination summary
- 绕过 refresh 合同，在本地直接覆盖稳定锚点字段

若 cockpit 允许用户在主界面上编辑目的地信息，其写回路径也必须服从本 spec 的刷新事件：

- 改写目标：走 `DestinationRedefined`
- 补齐成功标准 / 约束 / 交付物：走 `ClarificationAnswered` 或 `GovernanceChanged`
- 提交路线选择：走 `RouteSelectionCommitted`
- 批准重规划：走 `ReplanCommitted`

### 下游回写边界

为避免后续 specs 各自定义一套不兼容的更新语义，本 spec 明确要求：

- consumer 可以读取、解释、引用 destination contract
- consumer 可以发起 proposal / decision / answer
- consumer 不可以直接成为 destination contract 的事实写入者
- 任何会影响稳定字段的动作，都必须回流到同一套 refresh / replan / redefine 事件中，再由 summary 重算生成新卡片

## 审计补注（2026-04-24）

本轮基于当前真实代码与测试，对 destination card 的最小落地范围做一次保守审计：

- 当前已经落地的是 `autopilotSummary.destination` 驱动的“目的地摘要卡片”，而不是完整独立的 `Destination` UI 模块族。
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 中的 `parseDestination()` 已把这张卡片的最小展示口径固定为：
  - 主值：优先 `goal`，缺失时才回退到 `request`
  - 详情分段：`constraints`、`successCriteria`、`deliverables`、`missingInfo`
- 这意味着当前最稳妥的已落地结论是：
  - 目标概述、成功标准、约束、交付物、缺失信息已经具备稳定展示顺序；
  - 目标概述已经形成“结果目标优先、执行请求次之”的最小摘要原则；
  - 成功标准与约束已经在 UI 层明确分区，不会混排成一段模糊说明；
  - 但 `confidence` 仍未成为 destination 卡片本身的稳定字段。

当前可确认的事实链路如下：

- 共享层：
  - `shared/mission/autopilot.ts` 生成 `destination.goal / request / constraints / successCriteria / deliverables / missingInfo`
  - 其中 `goal` 优先来自 `mission.title`，`request` 优先来自 `mission.sourceText / mission.summary`，已经在 shared builder 里分离结果目标与执行请求
- 服务端：
  - `server/tasks/mission-projection.ts` 将 `autopilotSummary.destination` 直接返回给任务 projection
  - `server/tests/mission-routes.test.ts` 已验证 projection 中存在 destination 字段
- 客户端：
  - `client/src/lib/tasks-store.ts` 已 normalize 上述 destination 字段
  - `client/src/lib/tasks-store.autopilot.test.ts` 已覆盖 waiting mission、projection alias 与 fallback 链路中的 destination 字段兼容
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 destination 区块对 `goal / request / constraints / successCriteria / deliverables / missingInfo` 的直接展示

因此，本轮可以保守认定：

- “目标概述的摘要原则，区分结果目标与执行手段”已经有直接实现与测试依据：
  - shared builder 先分离 `goal` 与 `request`
  - client normalize 继续保留这两个字段
  - `TaskAutopilotPanel` 以 `goal` 为主值，仅在 `request !== goal` 时把 request 作为 detail 展示
- “成功标准与约束的展示边界”已经有直接实现与测试依据；
- “预期交付物的展示口径，并与 workflow 输出和任务产物建立映射”也已有最小闭环：
  - shared builder 已从 mission artifacts 构建 `destination.deliverables`；
  - client normalize 已稳定承接该字段；
  - `TaskAutopilotPanel` 会将 `destination.deliverables` 作为 destination card 的固定段落展示，并与 outputs 区块做最小复用；
  - 因此当前可以确认“交付物摘要展示 + 与现有任务产物链路的最小映射”已经落地。
- 但完整字段结构仍不能勾选，因为 `confidence`、影响范围、阻塞性和刷新语义尚未进入 destination 卡片的稳定契约。
- 同时，“后续路线推荐、接管面板和驾驶舱主界面的输入约束”也仍不能勾选，因为目前能直接核实的消费面主要还是 task detail 内的 autopilot panel，还没有更广泛界面复用与测试闭环。

这个结论仍需保守限定：

- 现状仅证明“摘要级 deliverables 映射”已存在，不等于完整 workflow output contract 已定义；
- 现状也还没有把交付物类型、格式、验收规则、版本关系等治理语义纳入 destination card。

### 续审结论（2026-04-24，destination/card conservative 复核）

在本轮继续复核当前工作树，并重新验证 shared / server / client 的 destination 相关测试后，destination card 的保守边界可以进一步收紧为：

- 当前真正稳定的 destination card 合同，仍是 `autopilotSummary.destination` 这一组摘要字段：
  - `goal`
  - `request`
  - `constraints`
  - `successCriteria`
  - `deliverables`
  - `missingInfo`
- 其中已经具备直接代码与测试锚点的，只是以下四条最小闭环：
  - 目标概述的摘要原则
  - 成功标准与约束的展示边界
  - 预期交付物的最小展示与任务产物映射
  - 与现有 `mission-first / workflow / runtime` 的兼容映射

本轮没有新增勾选，原因归纳如下：

- `confidence` 仍不属于 destination card 自身的稳定输出。
  - 当前主仓里更稳定的置信度落点仍是 `driveState.confidence` 与相关执行态解释，而不是 `destination.confidence`。
  - 因此不能把“完整字段结构”外推为已完成。
- `missingInfo` 仍停留在摘要字符串层。
  - 当前可以显示“缺什么”，但还不能稳定表达“影响范围”“阻塞性”“是否需要立即接管”。
  - 因此不能把缺失信息结构化展示规则写成已完成。
- 刷新语义仍停留在 design 原则，而不是代码化合同。
  - 现有测试覆盖的是 projection、normalize 与 panel 展示；
  - 还没有字段级 refresh 语义、目标重解析、澄清后增量刷新或 refresh -> replan 的直接回归锚点。
- 下游复用面仍然偏窄。
  - 当前能直接验证的 consumer 主要还是 `TaskAutopilotPanel` 这一条任务详情 destination block；
  - 还不足以把 route recommendation、takeover panel 和完整 cockpit 主骨架都认定为已把这份 card contract 当作稳定输入。

因此，本 spec 当前最稳妥的收口方式仍然是：

- 承认 destination card 已完成“摘要级任务目标卡片”的最小闭环；
- 不把它夸大成完整 `Destination` 对象契约、完整刷新模型或跨多界面的统一输入基线。

### 追加审计补注（2026-04-24，destination confidence / missing-info / projection 复核）

本轮继续围绕 `destination confidence / missing-info detail / projection` 做保守复核，结论是：

- shared 层已经存在结构化字段，而不是只有字符串：
  - `shared/mission/autopilot.ts` 当前已定义 `MissionAutopilotDestinationConfidenceSummary`
  - 同文件也已定义 `MissionAutopilotMissingInfoDetail`
  - `buildMissionAutopilotSummary()` 已直接产出 `destination.confidence` 与 `destination.missingInfoDetails`
- `TaskAutopilotPanel` 已具备直接消费这些结构化字段的最小 UI 能力：
  - `parseDestination()` 会优先读取 `destination.confidence.level`
  - 也会消费 `destination.missingInfoDetails[*].item / impact / blocking`
- 服务端 projection 侧没有发现 destination 子树被二次改写：
  - 代码检查显示 `server/tasks/mission-projection.ts` 中的 `alignAutopilotSummaryWithLinks()` 只补齐 `bindings` 与 `evidence.correlation`
  - 因此可以保守推断 `destination.confidence` 与 `destination.missingInfoDetails` 会随 shared summary 一起透传到 `/projection`

但这轮仍不能把本 spec 再向前补勾，核心原因也更明确了：

- `client/src/lib/tasks-store.ts` 当前仍把 `destination.confidence` 归一化为扁平文本级别，而不是稳定保留 shared 的对象结构；
- 同一处 store normalize 也还在把 `missingInfoDetails` 折叠成遗留兼容字段 `impact / blockingReason`；
- 因此当前能安全认定的是：
  - shared builder 已有结构化 destination 置信度与缺失信息明细；
  - server projection 会保留这组字段；
  - panel parser 能直接消费这组字段；
  - 但“经由 client store 归一化后仍保持同构”的完整 destination card 契约还没有完全闭环。

这意味着本 spec 依然不能保守补勾：

- `定义置信度的展示方式与解释规则，避免只有分值没有语义`
- `定义缺失信息的展示结构，包括缺失内容、影响范围与阻塞性`
- `定义目的地卡片的统一字段结构，包括目标概述、成功标准、约束、预期交付物、置信度、缺失信息`

原因不是 shared/server/panel 完全没有实现，而是这条链路在 client store 归一化层仍存在结构损耗，尚不足以把“最小可消费字段”上升为“稳定统一卡片合同”。

### 再补注（2026-04-24，structured missing-info detail audit）

在本轮补齐 destination missing-info 的 store / panel / route 测试后，可以把“缺失信息展示结构”的设计与事实边界再明确一步：

- 当前已被真实代码消费的最小缺失信息结构是：
  - `item`
  - `impact`
  - `blocking`
- 这组字段的真实链路现已具备 shared -> server -> client store -> panel 的闭环：
  - shared builder 生成 `destination.missingInfoDetails`
  - server projection 透传 destination 子树
  - client store 在 normalize 时保留 `missingInfoDetails`，并将 `item` 回填到 `missingInfo`
  - panel 在缺少扁平兼容字段时，仍可直接展示 `impact` 与 `blocking`
- 因此，当前可以把本 spec 中“定义缺失信息的展示结构，包括缺失内容、影响范围与阻塞性”保守视为已完成的最小任务。

这条结论仍需限定在“目的地卡片消费层”：

- 它证明的是 destination card 已经有可消费的结构化缺口字段；
- 不证明更上游已存在完整 `Destination parser`、缺口归档、澄清问题生成、或 runtime 级别的系统化缺口治理。

### 再续审补注（2026-04-25，destination card unified field contract）

在本轮结合 shared / server / client / panel 代码与定向测试再次复核后，可以把 destination card 当前已落地的统一字段合同说得更明确：

- 当前主仓中，`autopilotSummary.destination` 已不再只是若干松散摘要文案，而是具备稳定字段边界的结构化 contract：
  - `goal`
  - `request`
  - `constraints`
  - `successCriteria`
  - `deliverables`
  - `missingInfo`
  - `confidence`
  - `missingInfoDetails`
- 这组字段的统一性现在已经有直接代码与测试共同支撑：
  - shared 层定义类型并统一构建
  - server projection 透传且有断言
  - client store normalize 后仍保留 `confidence` 与 `missingInfoDetails` 的结构
  - panel 可直接消费这组字段，而不是依赖额外 ad-hoc 拼接

因此，从“目的地卡片消费 contract”的角度，可以把“定义目的地卡片的统一字段结构”保守视为已完成。

但边界仍需继续保持：

- 这不意味着字段语义已经在所有下游界面中被统一复用；
- 也不意味着 `confidence` 的解释规则、字段刷新规则、或跨 route recommendation / takeover / cockpit 的输入约束已经全部落地。

### 续审补注（2026-04-25，confidence explanation / refresh / cockpit input 复核）

在本轮针对 autopilot 现有实现与定向测试再次复核后，design 侧需要把三个仍未完成点的真实边界说得更具体：

- `confidence` 已经是 destination contract 的结构化字段，但“解释规则”仍未完整落地：
  - shared builder 已稳定产出 `destination.confidence.level / reason / signals`
  - server projection 与 client store normalize 也都保留了这组字段
  - 但 destination card 当前稳定展示到 UI 的，仍主要是 `confidence.level`
  - `reason / signals` 目前更多停留在数据合同与测试断言层，而不是已经被 destination 区块统一消费的解释口径
- 因此，当前更准确的设计边界是：
  - “confidence 字段已进入统一字段结构”成立；
  - “confidence 的展示方式与解释规则已经定型”仍未成立

- 刷新相关实现，当前更接近 route/recovery 级联动，而不是 destination 字段级合同：
  - 现有 shared / server / client / panel 已对 `route.replan`、`selectionStatus`、`recommendationDetails`、`remainingSteps.replanChangeSummary` 形成可验证闭环
  - 这些能力证明 runtime 变化会反馈到 autopilot summary
  - 但还没有直接代码与测试把 destination 内部字段拆成“稳定字段 / 动态字段”的强语义合同
  - 例如：
    - `goal` 何时允许变化
    - `successCriteria / constraints` 如何补齐
    - `deliverables` 如何随路线收敛细化
    - `missingInfo` 如何在澄清后关闭
- 所以 design 中关于刷新原则的段落，当前仍应视作目标性规则，而不是已经被代码锁定的现状描述

- cockpit 复用方面，这轮确认到的事实也应保守表述：
  - `TaskAutopilotPanel` 已接入 `TaskDetailView`
  - `TaskDetailView` 同时被默认详情页与 `variant="cockpit"` 形态复用
  - 对应测试也已覆盖 autopilot panel 在 detail view 中的接线
  - 这说明 destination/autopilot summary 已经进入 task detail 与 cockpit detail 的共享展示链
  - 但这仍然不是“route recommendation / takeover panel / cockpit 各子模块共同以本 spec 为输入约束”的证据
- 因此，本 spec 在产品设计上仍应保持如下收口：
  - 已经有一个被复用的 autopilot destination/card 展示面
  - 还没有证据证明更广泛的下游模块都以这份 destination card 字段合同作为直接输入

### 续审补注（2026-04-25，destination summary / success signal / constraint summary 边界收紧）

在本轮只读复核 `TaskAutopilotPanel / TaskDetailView / tasks-store / mission-projection` 及其定向测试后，design 侧还需要把三个容易被“字段已存在”误判成“产品语义已完成”的点再收紧一层：

- `destination summary` 已经具备最小可消费 contract，但还不是完整的卡片规范封板：
  - `server/tasks/mission-projection.ts` 已通过 `buildMissionAutopilotSummary()` 产出结构化 destination 摘要
  - `client/src/lib/tasks-store.ts` normalize 后也会继续保留 `goal / request / constraints / successCriteria / deliverables / confidence / missingInfo / missingInfoDetails`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 `parseDestination()` 现状已形成“goal 优先、request 作为 detail、其余字段按摘要段落拼接”的最小消费方式
  - 但当前仍缺少一条更直接的 UI 回归，去锁定 `request !== goal` 时 request 的稳定展示语义
  - 因此 design 上更准确的说法应是：已经有“结果目标优先”的最小 destination summary 合同，而不是完整的 destination summary 组件协议已经全部定型

- `success signal` 当前主要停留在“字段与最小展示实现存在”，还没有形成完整的产品语义闭环：
  - projection 与 normalize 已能稳定保留 `destination.successCriteria`
  - panel 也已把它作为独立 `Success` 段消费，而不是并入约束或其他杂项说明
  - 但现有 UI 测试还没有直接锁定 `Success` 段本身的最终展示文案与位置
  - 所以 design 中关于“成功标准区”的描述，当前可视为目标方向与最小实现已对齐，但还不能宣称 success signal 的展示口径已经完全收敛

- `constraint summary` 已具备最小展示闭环，但仍是摘要层能力：
  - 当前 shared / server / client / panel 已证明 constraint summary 可以从 projection 进入 destination 卡片
  - UI 测试也已经直接覆盖了 `Constraints: ...` 的 destination 段展示
  - 但这些 constraint 仍主要是平铺字符串列表，尚未进一步结构化成预算、权限、风格、合规、外部写入等稳定分类
  - 更重要的是，route recommendation、takeover panel、cockpit 其他模块还没有直接以这份 constraint summary contract 为输入并形成跨模块测试闭环
  - 因此 design 中关于“约束区为后续治理与接管提供输入”的表述，当前更适合视作架构目标，而不是已经被所有下游模块共同消费的既成事实

- 对应到本 spec 的完成边界，当前仍应保持如下判断：
  - “统一字段结构”“成功标准与约束的展示边界”“与 mission-first / workflow / runtime 的兼容映射”这几条，可以继续保守视为已完成的最小闭环
  - “置信度解释规则”“字段刷新规则”“作为路线推荐 / 接管 / 驾驶舱统一输入约束”这三条，仍然没有足够直接的代码 + UI 测试证据，不应外推为已完成

### 续审补注（2026-04-25，destination lane 定向复跑确认）

在本轮只针对 destination card 相关实现与测试做定向复跑后，design 侧还需要把三条未完成项的产品边界再收紧一层：

- 本轮实际复跑通过的测试包括：
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tests/mission-routes.test.ts`
- 这说明当前主仓已经具备一条稳定的 destination data contract：
  - shared builder 负责生成 `goal / request / constraints / successCriteria / deliverables / confidence / missingInfo / missingInfoDetails`
  - server projection 保持 destination 子树透传
  - client store normalize 保留 `confidence.reason / signals` 与 `missingInfoDetails`
  - `TaskAutopilotPanel` 负责把这组字段消费成 destination block
- 但 design 上仍不能把这条 contract 等同于“destination card 的完整产品语义已经封板”，原因如下：

- `confidence` 现在是结构化字段已落地，但“解释规则”仍未落地：
  - shared / server / client store 已证明 `destination.confidence.reason / signals` 存在并可透传
  - 但 destination card 当前稳定展示到 UI 的仍只有 `confidence.level`
  - 这意味着现在成立的是“confidence 已进入统一字段结构”，而不是“confidence 的解释方式与展示规则已经完成产品闭环”

- `refresh` 现在更接近 summary 级重算，而不是字段级刷新合同：
  - `refresh()`、projection 与 normalize 的实现证明 summary 可以随着 mission/runtime 变化重新归一化
  - 但还没有直接代码与测试把 destination 内部字段拆成明确的稳定字段 / 动态字段层级
  - 也还没有把下列规则锁成回归约束：
    - `goal` 何时允许变化
    - `constraints / successCriteria` 如何在澄清后补齐
    - `deliverables` 如何随路线收敛而细化
    - `missingInfo` 如何在输入补齐后关闭

- cockpit 复用现在成立的是“同一块 panel 被复用”，不是“destination card 成为多模块共同输入”：
  - `TaskDetailView` 默认视图与 cockpit 视图都接入了 `TaskAutopilotPanel`
  - 这足以证明 destination card 已进入 task detail / cockpit detail 的展示链
  - 但这仍不等于 route recommendation、独立 takeover panel、或 cockpit 其他子模块都在直接消费同一份 destination card contract
  - 因此 design 中“后续模块必须复用本卡片字段口径”目前仍应保留为架构目标，而不是既成事实

- `goal / request` 的设计边界这轮也需要继续保守描述：
  - 现有实现已经体现“结果目标优先、执行请求作为 detail”的策略
  - 现有测试也已覆盖 goal/request 共存场景下的最小渲染链路
  - 但当前还缺少一条更直接的 UI 断言，专门锁定 `request !== goal` 时 request detail 的稳定展示语义
  - 所以 design 上更准确的表述仍应是：“destination summary 的最小 contract 已存在”，而不是“完整目标摘要组件规范已经完全定型”

### 续审补注（2026-04-25，confidence explanation 闭环已落地）

- 以下结论覆盖上文同日更早、基于旧 UI 状态给出的“confidence explanation 仍未落地”判断。
在本轮只针对 destination lane 的 UI 落地与定向测试复核后，`confidence` 这条未完成项已经可以从“结构化字段已存在”进一步收口到“展示解释规则已落地”的状态：

- 当前已有直接代码证明 destination card 不再只展示一个置信度等级：
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 `parseDestination()` 已新增读取：
    - `destination.confidence.reason`
    - `destination.confidence.signals`
  - 并把它们作为 destination 区块的稳定 detail 输出：
    - `Reason: ...`
    - `Signals: ...`
- 当前也已有直接 UI 测试证明这不是偶然文案，而是稳定展示合同：
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 现已用结构化 `destination.confidence` 输入，并直接断言：
    - `Confidence: Medium`
    - `Reason: Waiting for the release owner confirmation before the route can unlock.`
    - `Signals: owner-confirmation:pending; external-write:human-gated`

因此，从 destination card 的最小产品语义来看，当前已经满足：

- 置信度不是只有一个 `low / medium / high` 分值；
- destination 区块已经同时向用户解释：
  - 为什么是这个 level；
  - 当前有哪些关键信号在支撑这个判断。

这次收口的边界仍需保持保守：

- 当前完成的是 destination card 自己的 confidence 展示与解释规则；
- 不是更广义的 explainability system 全部落地；
- 也不代表 `confidence` 已经被 route recommendation / takeover panel / cockpit 其他模块统一复用；
- 更不代表 refresh、重解释、或 runtime 驱动的 confidence 演化规则已经被单独建模。

### 续审补注（2026-04-25，refresh contract / downstream consumer contract 设计收口）

- 以下结论覆盖上文同日较早、基于旧 design 状态给出的“字段刷新规则与下游输入约束仍未收口”判断。
- 本轮收口的目标不是宣称主仓代码已经把所有 refresh / consumer 语义全部实现完，而是把本 spec 自身必须提供的设计合同补齐到可以被后续 specs 直接复用的状态。

- `明确卡片字段的刷新规则，区分稳定字段与动态字段` 现在可以视为已被 design 明确覆盖：
  - 本文新增了 `字段层级与来源优先级`
  - 新增了 `刷新触发矩阵`
  - 新增了 `字段冻结与重算边界`
  - 新增了 `局部刷新与整卡重算`
- 这意味着后续 specs 不需要再各自定义：
  - 哪些字段是稳定锚点
  - 哪些字段只能补齐不能静默弱化
  - route selection / replan / checkpoint 分别允许改什么
  - 哪些动作必须升级为 `DestinationRedefined`

- `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束` 现在也可以视为已被 design 明确覆盖：
  - 本文新增了 `统一输入口径`
  - 明确了 route recommendation / takeover panel / cockpit main view 三类 consumer 的必需输入
  - 明确了 consumer 的禁止行为与合法回写路径
- 这意味着后续相关 specs 应默认复用：
  - 同一份 canonical destination input
  - 同一套 fallback 顺序
  - 同一组 stable / dynamic 字段语义
  - 同一条 proposal -> refresh / replan -> summary 回流边界

- 本轮收口仍需保守限定：
  - 这次完成的是 spec 设计合同，而不是所有下游实现与测试已经闭环
  - route recommendation、takeover panel、cockpit 的各自实现完成度，仍需在对应 specs 与实现审计中单独确认
