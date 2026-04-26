# 需求文档：Destination 模型与解析器

## 目标

定义一套统一的 `Destination` 任务目标对象，把用户输入从“原始文本”升级为“可规划、可澄清、可执行、可审计”的结构化目标。
该对象用于承接任务自动驾驶体系中的目标识别、路线规划、缺口澄清、成功判定和运行时映射，而不是继续把用户输入仅仅当作 mission 文本或 workflow 启动参数。

## 背景

当前主仓已经具备 `mission`、`task`、`workflow`、`runtime`、`review`、`audit` 等基础能力，但用户输入仍然主要以以下几种方式进入系统：

- mission 发起文本
- workflow 启动 payload
- UI 表单字段
- 节点运行上下文中的自由输入

这些输入方式可以驱动系统执行，但还不足以支撑“任务自动驾驶”模式。系统缺少一个显式的上位对象，用来表达：

- 用户真正想抵达的结果是什么
- 该结果的成功标准是什么
- 系统已经知道什么、不知道什么
- 哪些信息可以自动补全，哪些必须进入澄清
- 该任务属于什么类型，应走什么路线

因此需要引入 `Destination` 对象与对应解析器。

## 当前主线最小 Destination 合同边界

为避免把“目标态 `Destination` parser”与“当前主线已落地的 mission 派生摘要”混为一谈，本 spec 明确区分以下两层对象：

- 目标态 `Destination`
  - 面向输入归档、目标识别、子目标拆分、约束抽取、成功标准识别、缺失信息识别、任务类型识别、澄清生成、版本化更新与回放审计的完整领域对象。
- 当前态 `MissionAutopilotSummary.destination`
  - 面向 shared -> server -> client -> panel 的最小可消费摘要合同，由 mission 运行时事实派生，而不是独立 parser 输出。

当前主线可直接确认的最小 destination 字段为：

- `id`
- `goal`
- `request`
- `taskType`
- `auxiliaryTaskTypes`
- `constraints`
- `successCriteria`
- `deliverables`
- `missingInfo`
- `confidence`
- `missingInfoDetails`

当前这些字段的直接来源边界为：

- `goal`
  - 当前由 `mission.title` 派生，不等于完整 `normalizedGoal + subGoals` 解析结果。
- `request`
  - 当前优先来自 `mission.sourceText`，缺失时退回 `mission.summary / mission.title`。
- `constraints`
  - 当前仅由 `mission.kind`、`mission.projection.sourceApp`、`mission.securitySummary.level` 这类 mission 已有事实拼接而成。
- `successCriteria`
  - 当前仅由 `mission.summary`、`mission.artifacts`、`mission.status` 等运行时事实归纳最小成功口径。
- `missingInfo`
  - 当前仅由 `mission.waitingFor` 与 `mission.blocker.reason` 派生。
- `confidence`
  - 当前由 mission summary、artifacts、events、waiting / blocker、decision prompt、sourceText 等现有 mission 信号归纳。
- `missingInfoDetails`
  - 当前仅描述 waiting / blocked 缺口的 `item / impact / blocking`，不是完整 `missingInformation + suggestedClarifications` 模型。
- `taskType`
  - 当前已存在 mission-derived 的最小主任务类型识别，信号仍主要来自 `mission.kind`、`mission.title`、`mission.sourceText`、`mission.summary`、`mission.waitingFor`、`mission.decision?.prompt`。
- `auxiliaryTaskTypes`
  - 当前已支持最小辅助类型输出与 `mixed / unknown` 回退，但仍不等于完整 parser 级 task taxonomy。

对本轮优先能力主题，应明确保持如下边界：

- 目标/子目标解析
  - 当前只存在 `destination.goal` 这一层最小锚点，尚无 `subGoals` 合同与分解策略实现。
- 约束抽取
  - 当前只存在 mission 派生的最小约束摘要，尚无时间、预算、权限、输出格式、风格、数据范围、工具限制等完整结构化抽取。
- 成功标准识别
  - 当前只存在最小 mission-derived `successCriteria`，尚无显式 / 推断 / 模板来源分层。
- 缺失信息识别
  - 当前只存在 waiting / blocked 缺口摘要，尚无完整 `MissingInformationItem` 与 `suggestedClarifications` 输出。
- 任务类型识别
  - 当前已存在 mission-derived 的最小 `taskType / auxiliaryTaskTypes` 摘要合同，但仍缺独立 parser、来源分层与更高保真分类策略。

因此，需求 2 到需求 6 在本 spec 中继续保持“目标态要求”，用于约束后续 parser、archive、projection、update 与测试设计；它们不应被视为 shared / server / client 已经具备的现有实现声明。

## 需求

### 需求 1：系统必须把原始输入升级为 Destination 对象

系统应在任务启动阶段，把用户输入解析为统一的 `Destination` 结构，而不是仅保留原始文本。

`Destination` 至少应包含以下字段：

- `id`：目标对象唯一标识
- `sourceInput`：原始用户输入
- `normalizedGoal`：归一化后的核心目标
- `subGoals`：系统识别出的子目标列表
- `constraints`：时间、预算、范围、风格、权限、输出格式等约束
- `successCriteria`：任务完成判定标准
- `missingInformation`：当前仍缺失的信息
- `taskType`：任务类型识别结果
- `confidence`：解析置信度
- `assumptions`：系统在未澄清前采用的默认假设
- `suggestedClarifications`：建议向用户发起的澄清问题
- `mappedMissionContext`：映射到 mission 侧后的结构
- `mappedWorkflowInput`：映射到 workflow 启动输入后的结构

验收要求：

- 用户输入进入系统后，必须能获得一个可序列化的 `Destination`
- `Destination` 不能只有目标一句话，必须同时包含目标结构和解析证据
- 后续路线规划、澄清、执行、回放必须可以消费该对象

### 需求 2：系统必须识别目标与子目标

系统应能从用户输入中提炼“主要目标”与“子目标”，避免后续 runtime 只能依据自由文本执行。

识别范围至少包括：

- 单目标任务
- 一个主目标下包含多个子任务
- 多阶段交付型任务
- 研究、设计、生成、实现、分析、整理等复合型任务

验收要求：

- 若用户输入包含多个动作或交付物，系统应拆分为 `subGoals`
- 若只能识别主目标、无法稳定识别子目标，系统应明确给出低置信度并进入待澄清状态
- 子目标应支持后续转换为 route planning 的阶段输入

当前最小锚点（2026-04-25）：

- 当前主线只稳定暴露 `destination.goal`，未暴露 `subGoals`、分解来源或目标拆分置信度。
- 因此本 requirement 当前用于约束目标态 parser 设计与测试范围，不代表已存在子目标解析实现。

### 需求 3：系统必须抽取约束信息

系统应从输入、上下文和默认策略中抽取任务约束，并显式写入 `Destination.constraints`。

约束至少包括：

- 时间约束
- 预算约束
- 权限约束
- 输出格式约束
- 风格约束
- 数据范围约束
- 工具/环境约束
- 不可触碰边界

验收要求：

- 约束必须区分“用户明确提出”和“系统推断得到”
- 约束缺失时不能默认当作无限制，应记录为空缺或默认策略
- 高风险任务中的权限、预算、外部调用约束必须进入显式结构

当前最小锚点（2026-04-25）：

- 当前主线的 `destination.constraints` 仍是 `string[]` 摘要，直接来源仅锚定 `mission.kind`、`mission.projection.sourceApp`、`mission.securitySummary.level`。
- 这还不足以证明时间、预算、权限、输出格式、风格、数据范围、工具限制等结构化约束抽取已经实现。

### 需求 4：系统必须识别成功标准

系统应把“做完”升级为“达到什么结果才算完成”。

`successCriteria` 至少应支持以下来源：

- 用户显式给出的成功标准
- 从任务语义中推断出的默认成功标准
- 平台预设模板
- 任务类型对应的标准交付要求

验收要求：

- 若用户给出明确交付要求，应直接进入 `successCriteria`
- 若系统仅能推断成功标准，必须记录为推断来源
- 若成功标准无法确定，系统应把该问题纳入 `missingInformation` 或 `suggestedClarifications`

当前最小锚点（2026-04-25）：

- 当前主线的 `destination.successCriteria` 仍是 mission summary、artifacts 与 mission 状态驱动的最小字符串摘要。
- 这还不足以证明“显式成功标准抽取”“按任务类型补默认成功标准”“无法确定时进入缺失信息 / 澄清”的完整识别策略已经存在。

### 需求 5：系统必须识别缺失信息并支持澄清

系统应显式识别执行前缺失的关键信息，而不是等到节点失败后才发现。

`missingInformation` 至少应覆盖：

- 缺少素材或输入文件
- 缺少目标对象或分析范围
- 缺少预算/时间/格式要求
- 缺少审批/权限/外部系统访问许可
- 缺少关键决策偏好

验收要求：

- 缺失信息必须带优先级，至少区分“阻塞执行”和“可边执行边澄清”
- 系统应给出对应的 `suggestedClarifications`
- 缺失信息不能只是一段文字描述，应尽量结构化

当前最小锚点（2026-04-25）：

- 当前主线仅稳定暴露 `destination.missingInfo` 与 `destination.missingInfoDetails`，来源仍是 `mission.waitingFor` 与 `mission.blocker.reason`。
- 当前 `missingInfoDetails` 只能证明阻塞型缺口及其 impact 已可被结构化展示，还不能外推为完整缺失信息识别与澄清建议生成能力。

### 需求 6：系统必须完成任务类型识别

系统应为每个 `Destination` 识别任务类型，以支持后续路线推荐、编队组织、默认成功标准和执行模板选择。

首批应支持至少以下任务类型：

- 分析型
- 研究型
- 生成型
- 改造型
- 实现型
- 协作审批型
- 多阶段复合型

验收要求：

- 每个 `Destination` 必须产生一个主任务类型
- 支持识别一个或多个辅助类型
- 无法稳定分类时，应输出 `unknown` 或 `mixed` 并降低置信度

当前最小锚点（2026-04-25）：

- 当前 mission-derived destination 摘要中已经存在最小 `taskType`、`auxiliaryTaskTypes` 输出，并具备 shared -> server -> client -> panel 的直证链。
- 但当前仍缺独立 parser 来源、分类置信度与更完整 taxonomy，因此本 requirement 仍保留目标态上限要求。

### 需求 7：系统必须与现有 mission 输入映射

`Destination` 不能成为与现有 `mission` 体系割裂的新对象，必须能够稳定映射到现有 mission 模型。

最小映射要求：

- `normalizedGoal` 映射为 mission 标题或目标摘要
- `subGoals` 映射为 mission 分阶段目标或 step seed
- `constraints` 映射为 mission metadata / governance 输入
- `successCriteria` 映射为 review / verify / completion policy 的输入
- `missingInformation` 映射为 mission 启动后的待澄清上下文

验收要求：

- 不要求一次性替换 mission 模型
- 必须支持 “先生成 Destination，再降级映射回 mission 输入”
- 映射后不得丢失关键约束、成功标准和缺失信息

### 需求 8：系统必须与现有 workflow 输入映射

`Destination` 必须能够被映射为 workflow 启动输入，使其与现有 `workflow runtime`、节点变量和编排输入兼容。

最小映射要求：

- `normalizedGoal` 进入 workflow 顶层目标变量
- `subGoals` 进入规划或分阶段节点输入
- `constraints` 进入运行时治理、工具许可、预算、输出控制
- `successCriteria` 进入 review / audit / verify 阶段输入
- `missingInformation` 进入等待澄清或人工接管上下文

验收要求：

- 不要求立即重写现有 workflow 定义格式
- 必须能把 `Destination` 映射成当前主仓可消费的 workflow payload
- 映射过程中必须保留字段来源与解析证据

### 需求 9：系统必须保留解析置信度与来源证据

系统应让后续模块知道某个字段是“明确输入”还是“系统推断”，以及当前可信程度如何。

至少应支持以下来源标签：

- 用户显式输入
- 上下文继承
- 平台默认模板
- 规则推断
- 模型推断

验收要求：

- 目标、约束、成功标准、缺失信息至少应有来源说明
- 低置信度字段应能触发澄清或人工确认
- 回放与审计时可重建 “为什么系统这样理解任务”

### 需求 10：系统必须支持增量更新 Destination

`Destination` 不应是一次性快照，而应允许在澄清、补充素材、审批确认后更新。

验收要求：

- 澄清完成后，系统应能合并更新 `Destination`
- 更新前后应保留版本或差异信息
- route planner 和 runtime 可以基于新版 `Destination` 触发重规划

## 非目标

以下内容不属于本 spec 的首轮交付范围：

- 完整实现 Route Planner
- 完整实现 Fleet Organizer
- 完整实现 L1-L5 自动驾驶分级
- 对所有历史 mission / workflow 数据做一次性回填迁移
- 替换全部现有 UI 输入入口

## 依赖关系

本 spec 依赖或影响以下方向：

- task-autopilot-core-concepts
- route-planner-and-route-model
- drive-state-and-replan-state-machine
- takeover-panel-and-decision-points
- mission-model-to-autopilot-model-mapping

## 审计补注（2026-04-25）

本轮结合当前 shared / server / client 已落地的 destination summary、projection、store、panel 与测试，再次对 requirements 层做保守校准：

- 当前主仓已经真实承接的，是 `MissionAutopilotSummary.destination` 这一层最小 destination 摘要，而不是独立 `Destination` parser / archive / versioned entity。
- 这条最小摘要链已经能直接支撑以下 requirement 家族的“最小消费闭环”：
  - 需求 1：已有可序列化的 destination 摘要最小子集，可被 shared / server / client / panel 消费；
  - 需求 7：已有 `Destination -> mission` 的最小投影事实基础；
  - 需求 8：已有投影兼容链路与 workflow / panel 消费方向的最小锚点；
  - 需求 9：已有 `confidence / reason / signals / missingInfoDetails` 这类解释字段的最小事实基础。
- 但以下 requirement 仍然保持目标态，不应被外推为已实现：
  - 需求 2：目标与子目标识别；
  - 需求 3：完整约束抽取；
  - 需求 4：完整成功标准识别；
  - 需求 5：缺失信息识别与澄清建议生成；
  - 需求 6：高保真任务类型识别；
  - 需求 10：真正的版本化增量更新与重解析。

因此，本轮 requirements 的收口原则是：

- 保持完整 `Destination` 目标态要求不降级；
- 同时明确当前代码事实只覆盖 mission-derived destination summary 的最小闭环；
- 后续 tasks 的勾选若涉及“定义 / 设计”类条目，可以依据文档直接覆盖与现有最小摘要链锚点保守推进；
- 若涉及“实现”类条目，仍必须坚持直接代码 + 直接测试标准。

## 复核补注（2026-04-26，剩余 parser requirement 仍属目标态）

本轮继续按当前仓库中可直接追溯的 shared / server / client / panel 代码与测试复核后，requirements 层的安全结论没有变化：

- 当前主仓真正稳定运行的，仍然是 `MissionAutopilotSummary.destination` 这一层 mission-derived destination summary。
- 这条 summary 链当前可以被直接坐实的字段边界是：
  - `goal`
    - 当前由 `mission.title` 派生，不等于完整 `normalizedGoal + subGoals` 解析结果。
  - `constraints`
    - 当前只由 `mission.kind`、`mission.projection.sourceApp`、`mission.securitySummary.level` 归纳为最小字符串摘要。
  - `successCriteria`
    - 当前只由 `mission.summary`、`mission.artifacts`、`mission.status` 等运行时事实归纳出最小成功口径。
  - `missingInfo`
    - 当前只由 `mission.waitingFor` 与 `mission.blocker.reason` 派生。
  - `confidence`
    - 当前只由 mission summary、artifacts、events、waiting / blocker、decision prompt、sourceText 等现有 mission 信号归纳。
  - `missingInfoDetails`
    - 当前只覆盖 waiting / blocked 缺口的 `item / impact / blocking`。
- 因此，以下 requirement 继续只能被视为“目标态约束”，而不是现有实现声明：
  - 需求 2：目标与子目标识别
    - 现有合同仍无 `subGoals`、目标拆分来源与拆分置信度。
  - 需求 3：完整约束抽取
    - 现有合同仍无时间、预算、权限、输出格式、风格、数据范围、工具限制等结构化约束提取。
  - 需求 4：完整成功标准识别
    - 现有合同仍无显式 / 推断 / 模板来源分层，也无“无法确认则进入缺失信息”的完整策略输出。
  - 需求 5：缺失信息识别与澄清建议生成
    - 现有合同仍无 `suggestedClarifications`，也无 non-blocking 缺口分类。
  - 需求 6：高保真任务类型识别
    - 当前虽已有最小 `taskType`、`auxiliaryTaskTypes` 与 `mixed / unknown` 回退输出，但仍缺来源分层、分类置信度与 parser 级输入归档支撑。
  - 需求 10：版本化增量更新与重解析
    - 现有代码与测试仍未直接证明 `Destination.version`、clarification merge、re-parse 与差异回放链路已落地。

同时，本轮还需要保持一个测试边界判断：

- 当前测试可以直接证明的是“mission-derived destination summary 消费链”已经存在；
- 当前测试还不能被解释为“完整 Destination parser / archive / version-update 契约测试已经完成”。
