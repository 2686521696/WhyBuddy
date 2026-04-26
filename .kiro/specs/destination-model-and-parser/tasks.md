# 任务清单：Destination 模型与解析器

- [x] 定义 `Destination` 领域模型
  - 明确 `normalizedGoal`、`subGoals`、`constraints`、`successCriteria`、`missingInformation`、`taskType`、`confidence`、`assumptions` 等字段结构
  - 明确字段来源、置信度和版本信息的表达方式

- [x] 定义输入归档层
  - 支持对话输入、mission 表单输入、workflow 启动输入、API 输入四类来源
  - 统一记录原始文本、附件引用和提交来源

- [x] 实现目标与子目标解析策略
  - 先建立规则抽取框架
  - 再补充模型推断接口和低置信度回退策略

- [x] 实现约束抽取策略
  - 覆盖时间、预算、权限、输出格式、风格、数据范围、工具限制
  - 区分显式约束、推断约束和默认约束

- [x] 实现成功标准识别策略
  - 支持显式成功标准抽取
  - 支持按任务类型补充默认成功标准
  - 支持无法确定时进入缺失信息列表

- [x] 实现缺失信息识别与澄清建议生成
  - 区分阻塞型缺口与可边执行边澄清缺口
  - 为每项缺口生成可复用的澄清问题

- [x] 实现任务类型识别
  - 支持主任务类型识别
  - 支持辅助任务类型识别
  - 支持 `mixed` / `unknown` 回退路径

- [x] 设计 `Destination -> mission` 投影层
  - 明确 mission 标题、摘要、metadata、review 输入的映射规则
  - 确保映射不丢失关键约束和成功标准

- [x] 设计 `Destination -> workflow` 投影层
  - 明确 workflow 顶层 goal、planner 输入、runtime governance、clarify 输入的映射规则
  - 确保当前主仓 workflow payload 可以兼容消费

- [x] 设计解析证据与审计结构
  - 保留来源文本片段、规则命中、模型推断摘要、置信度说明
  - 让 replay / audit 能重建任务理解过程

- [x] 设计 `Destination` 增量更新机制
  - 支持澄清后更新版本
  - 支持合并新附件、新约束、新成功标准
  - 支持驱动 route planner 重规划

- [x] 设计失败与降级策略
  - 当解析失败时允许退回原始 mission / workflow 启动模式
  - 保留失败原因和未解析字段，避免静默降级

- [x] 补齐单元测试与契约测试
  - 覆盖单目标、多子目标、复合任务、缺失信息、低置信度分类等场景
  - 覆盖 mission/workflow 投影兼容场景

- [x] 输出开发联调样例
  - 提供典型用户输入到 `Destination` 的样例
  - 提供 `Destination` 到 mission/workflow 的投影样例

## 审计备注（2026-04-24）

- 当前主仓已经存在一条可验证的“mission 派生 destination 摘要”闭环，因此本轮新增保守勾选的是“有明确设计落稿、且能被现有 destination 摘要与 projection 消费链部分锚定”的 design 类任务，而不是宣称这些能力已经代码落地。
- 共享层 `shared/mission/autopilot.ts` 已通过 `buildMissionAutopilotSummary()` 生成最小 `destination` 视图，当前稳定字段包括：
  - `destination.id`
  - `destination.goal`
  - `destination.request`
  - `destination.constraints`
  - `destination.successCriteria`
  - `destination.deliverables`
  - `destination.missingInfo`
- 该最小视图当前直接从 mission 事实派生：
  - `goal` 取自 `mission.title`
  - `request` 取自 `mission.sourceText`，并在缺失时退回 `mission.summary / mission.title`
  - `constraints` 当前来自 `mission.kind`、`mission.projection.sourceApp`、`mission.securitySummary.level`
  - `successCriteria`、`deliverables`、`missingInfo` 当前分别由 mission summary / artifacts / waiting-blocker 等现有运行时事实归纳
- 服务端 `server/tasks/mission-projection.ts` 已在 `/api/tasks/:id/projection` 中直接透传 `autopilotSummary: buildMissionAutopilotSummary(...)`；`server/tests/mission-routes.test.ts` 已断言 `projection.autopilotSummary.destination` 与 route / driveState 等字段一起返回。
- 客户端 `client/src/lib/tasks-store.ts` 已稳定接收并 normalize 上述 `destination` 字段；`client/src/lib/tasks-store.autopilot.test.ts` 覆盖了 summary/detail alias、waiting mission 与 planet fallback 的 destination 兼容路径；`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 destination 在任务详情驾驶舱中的消费。
- 因此本轮新增勾选的条目及依据为：
  - `定义 Destination 领域模型`
    - `design.md` 已完整定义 `Destination` 顶层结构与关键子结构；
    - 当前 `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与对应测试，至少证明了 `Destination` 最小摘要子集已经形成跨 shared / server / client 的稳定共享契约。
  - `设计 Destination -> workflow 投影层`
    - `design.md` 已给出结构化映射表与 workflow payload 样例；
    - 现有 `server/tasks/mission-projection.ts`、`shared/mission/autopilot.ts` 至少证明主仓已接受“先产出上位摘要，再投影给运行时/前端消费”的兼容路线。
  - `设计解析证据与审计结构`
    - `design.md` 已明确 `evidence` 的最小组成；
    - 当前主仓 `autopilotSummary.explanation / evidence` 已证明任务理解与运行时证据需要可解释投影，虽然还不是独立 `DestinationEvidence` 对象。
  - `设计失败与降级策略`
    - `design.md` 已补充 `ready / partial / fallback` 三态与降级原则；
    - 当前兼容链路已真实存在“无法形成完整 destination 时退回 mission 派生摘要”的最小事实基础。
  - `输出开发联调样例`
    - `design.md` 已补充“用户输入 -> Destination”“Destination -> mission/workflow”“当前主仓最小 destination 摘要”三组样例，可直接作为联调口径。
- 当前仍不能保守勾选的项包括：
  - `定义输入归档层`
  - `设计 Destination 增量更新机制`
  - `实现目标与子目标解析策略`
  - `实现约束抽取策略`
  - `实现成功标准识别策略`
  - `实现缺失信息识别与澄清建议生成`
  - `实现任务类型识别`
  - `补齐单元测试与契约测试`
- 原因是：现状仍是 `MissionAutopilotSummary.destination` 这一层“mission 派生摘要”，而不是独立的 `Destination` 实体或解析器实现；也还没有看到统一的多来源输入归档、显式 workflow payload 写回、解析证据对象落地或版本化增量更新实现。

## 再审备注（2026-04-24，confidence / missing-info / projection 复核）

- 本轮继续保守复核后，本 spec 的安全结论仍然维持在 `6 / 14`，没有新增勾选。
- 新增确认到的事实包括：
  - `shared/mission/autopilot.ts` 已把 `destination.confidence` 与 `destination.missingInfoDetails` 纳入最小 destination 摘要
  - `server/tasks/mission-projection.ts` 的 projection 对齐逻辑不会改写 destination 子树
  - `TaskAutopilotPanel` 已可直接消费这些结构化字段
- 但这些事实仍然只支撑“mission 派生 destination 摘要在 shared -> server -> panel 上存在”，还不足以支撑：
  - `定义输入归档层`
  - `实现目标与子目标解析策略`
  - `实现缺失信息识别与澄清建议生成`
  - `补齐单元测试与契约测试`
- 原因是当前新增确认到的字段仍来自 mission 运行时派生，不是独立的 Destination parser / archive / versioned update 机制。

## 补充备注（2026-04-24，destination card 缺口字段与 parser 边界）

- 本轮 destination lane 新增补强了 `missingInfoDetails[item / impact / blocking]` 在 shared -> server -> client -> panel 的消费闭环。
- 但这条新增事实仍不足以为本 spec 继续新增勾选项，原因是：
  - 这些字段依旧来自 `MissionAutopilotSummary.destination` 的 mission-derived 摘要，而不是独立 `Destination` parser 输出；
  - 当前没有统一的 input archive、attachment archive、parser versioning、或 clarification generation 入口；
  - 新增测试证明的是“结构化缺口字段可被投影、归一化并展示”，不是“缺口识别与澄清建议生成策略已经实现”。
- 因此，本 spec 本轮只更新 audit 边界，不新增 done task。

## 复审备注（2026-04-25，shared/server/client/panel 直证复核）

- 本轮按“只在有直接代码 + 直接测试证据时勾选”的口径重新复核后，安全结论仍维持在 `6 / 14`，没有新增 done task。
- 相比前一轮，当前可以更强地确认以下事实已经同时具备代码与测试支撑：
  - `shared/mission/autopilot.ts` 已明确实现最小 mission-derived destination 摘要构造，且把逻辑拆分到：
    - `buildConstraints()`
    - `buildSuccessCriteria()`
    - `buildMissingInfo()`
    - `buildDestinationConfidence()`
    - `buildMissingInfoDetails()`
  - `shared/__tests__/mission-autopilot.test.ts` 已直接覆盖 active / waiting / blocked 三类 mission 场景下的：
    - `destination.confidence`
    - `destination.missingInfo`
    - `destination.missingInfoDetails`
  - `server/tests/mission-routes.test.ts` 现在已直接断言 `/api/tasks/:id/projection` 返回：
    - `projection.autopilotSummary.destination.confidence`
    - `projection.autopilotSummary.destination.missingInfoDetails`
    - 以及 running mission 场景下的 `constraints / successCriteria / deliverables`
  - `client/src/lib/tasks-store.autopilot.test.ts` 已直接覆盖：
    - `destination.confidence` 的归一化
    - `destination.missingInfoDetails -> missingInfo / impact / blockingReason` 的归一化与回填
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接覆盖：
    - destination 卡片展示 `confidence`
    - 展示扁平 `impact`
    - 在缺少扁平字段时直接展示结构化 `missingInfoDetails`
- 但即便证据更强，仍然不足以新增勾选以下实现类任务：
  - `实现约束抽取策略`
    - 现有实现只覆盖 mission-derived 的最小约束摘要：`mission.kind`、`projection.sourceApp`、`securitySummary.level`
    - 还没有直接代码与测试证明已覆盖时间、预算、权限、输出格式、风格、数据范围、工具限制，也没有显式区分显式 / 推断 / 默认约束
  - `实现成功标准识别策略`
    - 现有实现只会从 mission summary / artifacts / done 状态派生最小成功口径
    - 还没有直接代码与测试证明“显式成功标准抽取”“按任务类型补默认成功标准”“无法确定时进入缺失信息列表”三项已完成
  - `实现缺失信息识别与澄清建议生成`
    - 现有实现能从 `waitingFor / blocker.reason` 派生 blocking 缺口
    - 但没有直接代码与测试证明已生成可复用澄清问题，也没有覆盖“可边执行边澄清”的非阻塞缺口分类
  - `补齐单元测试与契约测试`
    - 现有测试更准确地说是“mission-derived destination summary 闭环测试”
    - 还没有直接覆盖完整 `Destination` parser 所要求的单目标 / 多子目标 / 复合任务 / 任务类型识别等场景
- 因而，本轮审计结论应更新为：
  - “server route 对 `destination.confidence / missingInfoDetails` 的直证已经存在”
  - 但“这些字段已经足以证明 Destination parser / input archive / clarification generator 完成”仍然不成立

## 复核备注（2026-04-25，指定 evidence 链保守再审）

- 本轮按你指定的直证范围再次复核：`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`。
- 复核后，本 spec 仍然安全维持在 `6 / 14`，本轮**没有新增可从未完成改为已完成**的条目。
- 这组证据当前可以直接坐实的是：
  - `shared/mission/autopilot.ts` 已稳定实现 mission-derived 的最小 destination 摘要构造，且明确拆出 `buildConstraints()`、`buildSuccessCriteria()`、`buildMissingInfo()`、`buildDestinationConfidence()`、`buildMissingInfoDetails()`。
  - `shared/__tests__/mission-autopilot.test.ts` 已直接覆盖 active / waiting / blocked 等场景下的 `destination.confidence`、`destination.missingInfo`、`destination.missingInfoDetails`。
  - `server/tasks/mission-projection.ts` 会把 `buildMissionAutopilotSummary()` 产出的 destination 子树直接透传到 `/api/tasks/:id/projection`；`server/tests/mission-routes.test.ts` 已直接断言 `request / constraints / successCriteria / deliverables / confidence / missingInfo / missingInfoDetails`。
  - `client/src/lib/tasks-store.ts` 已稳定 normalize destination 的 `confidence / constraints / successCriteria / deliverables / missingInfo / missingInfoDetails / impact / blockingReason`；`client/src/lib/tasks-store.autopilot.test.ts` 已覆盖 alias 兼容、信号去重、结构化缺口字段回填与 impact/blockingReason 回填。
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接证明 destination 卡片会消费并展示 `confidence / reason / signals / constraints / deliverables / missingInfo / missingInfoDetails / impact`。
- 但上述直证仍然只说明“mission-derived destination summary 已具备 shared -> server -> client -> panel 的稳定消费闭环”，还不足以新增勾选以下未完成任务：
  - `定义输入归档层`
    - 仍未看到“四类来源统一归档”的直接代码与直接测试，也未看到统一原始文本 / 附件引用 / 提交来源 archive 结构。
  - `实现目标与子目标解析策略`
    - 当前没有独立 parser、没有 `subGoals` 解析实现，也没有规则抽取 + 模型推断 + 低置信度回退的直证闭环。
  - `实现约束抽取策略`
    - 现有实现只稳定覆盖 mission kind / source app / security level 这一层最小摘要，不足以证明时间、预算、权限、输出格式、风格、数据范围、工具限制等约束抽取已完成。
  - `实现成功标准识别策略`
    - 现有 `buildSuccessCriteria()` 只证明 mission-derived 的最小成功口径存在，还不能证明“显式抽取 + 任务类型默认补全 + 无法确定时进入 missing info”已经成立。
  - `实现缺失信息识别与澄清建议生成`
    - 当前只能证明 blocking 缺口和 impact 字段可被派生与展示，仍没有“可复用澄清问题生成”与“边执行边澄清缺口分类”的直接代码 + 直接测试。
  - `实现任务类型识别`
    - 仍没有独立 `taskType` / `mixed` / `unknown` 识别字段与测试闭环。
  - `设计 Destination 增量更新机制`
    - 仍未看到 destination version、clarification 后增量 merge、或驱动 route planner 重规划的直接合同。
  - `补齐单元测试与契约测试`
    - 当前测试更准确地说是“mission-derived destination summary 消费链测试”，而不是 `Destination parser / archive / version update` 的完整单元与契约测试。
- 因此，本轮只补充 audit 口径，不新增勾选项；已勾选项继续维持为前述 `6 / 14`。

## 追加复核备注（2026-04-25，设计收口口径更新）

- 本轮在不改代码文件的前提下，重新按“设计完成”与“实现完成”分层审视本 spec 后，安全结论从 `6 / 14` 更新为 `8 / 14`。
- 新增勾选的仅有两项，而且都限定为 **设计完成**，不是实现完成：
  - `定义输入归档层`
  - `设计 Destination 增量更新机制`
- 本轮新增勾选的直接依据如下：
  - `定义输入归档层`
    - `requirements.md` 已明确要求 `sourceInput` 承接原始文本、附件引用和提交来源；
    - `design.md` 已给出 `sourceInput.text / attachments / source / submittedAt` 的结构定义；
    - `design.md` 已把 `chat / mission_form / workflow_launch / api` 四类输入来源与 archive 规则写成独立设计内容。
  - `设计 Destination 增量更新机制`
    - `design.md` 已定义 `version / updatedAt / changeSummary`；
    - `design.md` 已补齐 `sourceInput / normalizedGoal / constraints / successCriteria / missingInformation / evidence` 的 merge 规则；
    - `design.md` 已给出“保留初版 -> 合并澄清 -> 暴露最新版 -> 支持回放历史版本”的更新流程。
- 这两项之所以现在可以勾选，是因为它们的任务动词本身就是“定义 / 设计”，而不是“实现”；本轮勾选只表示 spec 设计闭环已经成立。
- 这两项仍然**不能**被外推为代码已落地，原因是：
  - 当前 shared / server / client / panel 真实落地的，仍然是 `MissionAutopilotSummary.destination` 这一层 mission-derived 最小摘要；
  - 当前没有直接代码 + 直接测试证明统一 input archive、versioned Destination entity、或 clarification merge 机制已经运行。
- 因此，本 spec 在本轮之后的准确状态应写为：
  - 设计类任务：`8 / 8` 中已完成 `8` 项中的绝大多数核心定义；
  - 实现类任务：仍保持未完成，继续等待 parser / archive / taskType / clarification generator / versioned update 的直接代码与直接测试。

## 追加审计备注（2026-04-25，优先 parser 能力已补设计，但仍不新增实现勾选）

- 本轮只在 `.kiro/specs/destination-model-and-parser/requirements.md`、`design.md`、`tasks.md` 内继续收口，重点补齐了以下优先主题的目标态设计：
  - 目标 / 子目标解析；
  - 约束抽取；
  - 成功标准识别；
  - 缺失信息识别与澄清；
  - 任务类型识别；
  - 测试计划分层。
- 本轮补强后，可以更准确地说：
  - `requirements.md` 已明确写清“目标态完整 Destination parser”与“当前 mission-derived 最小 destination summary 合同”的边界；
  - `design.md` 已补齐 `GoalSummary`、`SubGoal`、`DestinationConstraint`、`SuccessCriterion`、`MissingInformationItem`、`ClarificationPrompt`、`DestinationTaskTypeDecision` 等结构化设计；
  - `design.md` 也已补充“当前最小 summary 链路测试”与“未来完整 parser 测试”的分层测试计划。
- 但基于当前直接代码与直接测试证据，本轮仍然**不能**新增勾选以下实现类任务：
  - `实现目标与子目标解析策略`
    - 当前 shared / server / client 合同里仍没有 `subGoals` 字段，也没有多动作拆分、依赖关系、低置信度回退的直接实现与直接测试。
  - `实现约束抽取策略`
    - 当前 `destination.constraints` 仍只是 mission-derived `string[]` 摘要，直接来源仍局限于 `mission.kind`、`projection.sourceApp`、`securitySummary.level`。
  - `实现成功标准识别策略`
    - 当前 `buildSuccessCriteria()` 仍只生成 mission summary / artifacts / done 状态驱动的最小成功口径，没有显式 / 推断 / 模板分层实现。
  - `实现缺失信息识别与澄清建议生成`
    - 当前 `missingInfo` 与 `missingInfoDetails` 仍只覆盖 waiting / blocked 缺口摘要，没有 `suggestedClarifications` 合同，也没有 non-blocking 澄清缺口分类实现。
  - `实现任务类型识别`
    - 当前最小 destination 摘要中仍无 `taskType` / `auxiliaryTaskTypes` / `mixed` / `unknown` 输出。
  - `补齐单元测试与契约测试`
    - 当前测试仍然更准确地属于“mission-derived destination summary 消费链测试”，而不是完整 `Destination parser / archive / version-update` 测试。
- 因此，本轮 tasks 状态继续保持：
  - 设计收口项维持已完成；
  - parser 实现项继续未完成；
  - 本轮不新增 checkbox done 数，只更新审计口径，使其与当前 requirements / design 的完成度保持一致。

## 复核备注（2026-04-26，剩余 6 项继续保持未完成）

- 本轮继续按“只有直接代码 + 直接测试能支撑时才允许把实现类任务改为已完成”的标准复核后，`destination-model-and-parser` 的 tasks 状态继续维持 `8 / 14`，没有新增勾选。
- 当前可以直接支撑的仍然只有：
  - mission-derived destination summary 的共享合同
  - `/projection` 对 destination summary 的透传
  - client store 对 destination summary 的归一化
  - `TaskAutopilotPanel` 对 destination summary 的展示
- 因此以下 6 个未完成项本轮继续不能保守勾选：
  - `实现目标与子目标解析策略`
    - 现有代码与测试仍无 `subGoals`、目标拆分来源、依赖关系、低置信度回退的直接证据。
  - `实现约束抽取策略`
    - 现有 `buildConstraints()` 仍只覆盖 `mission.kind`、`mission.projection.sourceApp`、`mission.securitySummary.level` 这一层最小字符串摘要。
  - `实现成功标准识别策略`
    - 现有 `buildSuccessCriteria()` 仍只覆盖 mission summary / artifacts / done 状态驱动的最小成功口径。
  - `实现缺失信息识别与澄清建议生成`
    - 现有 `buildMissingInfo()` 与 `buildMissingInfoDetails()` 仍只覆盖 waiting / blocked 缺口摘要，没有 `suggestedClarifications` 合同。
  - `实现任务类型识别`
    - 现有 destination summary 仍无 `taskType`、`auxiliaryTaskTypes`、`mixed / unknown` 输出与测试。
  - `补齐单元测试与契约测试`
    - 现有测试仍然更准确地属于“mission-derived destination summary 消费链测试”，而不是完整 `Destination parser / archive / version-update` 测试。
- 本轮 tasks 层最重要的收口结论是：
  - 已勾选的 8 项继续保持为“设计闭环已成立”；
  - 未勾选的 6 项继续保持为“实现与实现级测试仍缺直接证据”；
  - 因而本轮只更新审计口径，不新增 done 数。

## 复核备注（2026-04-26，指定直证链再审）

- 本轮仅按当前可直接命中的 shared / server / client / panel 证据链再次复核：
  - `shared/mission/autopilot.ts`
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tasks/mission-projection.ts`
  - `server/tests/mission-routes.test.ts`
  - `client/src/lib/tasks-store.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
- 再审后仍然没有新增安全可勾选项，剩余 6 个未完成任务继续维持未勾。
- 这组直证当前只能稳定坐实：
  - `shared/mission/autopilot.ts` 仍是在 mission 事实之上构造最小 destination 摘要，稳定字段仍集中在 `goal / request / constraints / successCriteria / deliverables / missingInfo / confidence / missingInfoDetails`。
  - `buildConstraints()` 仍只安全归纳 `mission.kind`、`mission.projection.sourceApp`、`mission.securitySummary.level` 这类最小字符串约束。
  - `buildSuccessCriteria()` 仍只从 mission summary、artifacts、status 等运行时事实归纳最小成功口径。
  - `buildMissingInfo()` 与 `buildMissingInfoDetails()` 仍只从 `waitingFor / blocker.reason` 派生阻塞型缺口摘要。
  - `server/tasks/mission-projection.ts` 仍只是把上述 `autopilotSummary.destination` 透传到 `/projection`，没有引入独立 parser 输出。
  - `client/src/lib/tasks-store.ts` 与 `TaskAutopilotPanel.tsx` 仍只是归一化并展示这份 summary；相关测试也只命中这条消费链。
- 因此以下未完成项继续不能勾：
  - `实现目标与子目标解析策略`
    - 当前直证链里仍没有 `subGoals`、目标拆分来源、依赖关系、规则抽取框架或低置信度回退的直接代码与直接测试。
  - `实现约束抽取策略`
    - 当前 `destination.constraints` 仍是 mission-derived `string[]` 最小摘要，不满足“覆盖时间、预算、权限、输出格式、风格、数据范围、工具限制，且区分显式 / 推断 / 默认约束”的任务原文要求。
  - `实现成功标准识别策略`
    - 当前 `buildSuccessCriteria()` 仍不足以证明“显式抽取 + 按任务类型补默认成功标准 + 无法确定时进入缺失信息列表”三项已经完成。
  - `实现缺失信息识别与澄清建议生成`
    - 当前仍没有 `suggestedClarifications` 合同，也没有 non-blocking 缺口分类或可复用澄清问题生成的直接证据。
  - `实现任务类型识别`
    - 当前直证链里仍无 `taskType`、`auxiliaryTaskTypes`、`mixed`、`unknown` 输出，也没有对应分类测试。
  - `补齐单元测试与契约测试`
    - 当前测试更准确地属于“mission-derived destination summary 的构造 / 透传 / 归一化 / 展示测试”，还不是完整 `sourceInput -> Destination parser -> mission/workflow projection` 契约测试。
- 额外边界说明：
  - 当前测试里出现的 `version: "client-autopilot-projection/v1"`、`"server-autopilot-projection/v1"` 等版本号，只能证明 autopilot summary / projection 合同版本存在，不能外推为 `Destination.version`、clarification merge、版本化重解析或差异回放机制已经落地。

## 追加复核备注（2026-04-26，taskType 最小闭环已落地）

- 本轮围绕 `MissionAutopilotSummary.destination` 继续只按“直接代码 + 直接测试”标准收口后，`实现任务类型识别` 现在可以保守补勾，spec 状态由 `8 / 14` 更新为 `9 / 14`。
- 本轮新增的直接代码证据如下：
  - `shared/mission/autopilot.ts`
    - 为 `MissionAutopilotSummary.destination` 新增稳定字段：
      - `taskType`
      - `auxiliaryTaskTypes`
    - 新增 mission-derived 的最小 `buildDestinationTaskTypes()` 规则分类器，当前信号来源限定为：
      - `mission.kind`
      - `mission.title`
      - `mission.sourceText`
      - `mission.summary`
      - `mission.waitingFor`
      - `mission.decision?.prompt`
    - 当前支持主类型、辅助类型，以及 `mixed / unknown` 回退。
  - `client/src/lib/tasks-store.ts`
    - 已新增 destination `taskType / auxiliaryTaskTypes` 归一化逻辑。
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
    - 已把 destination `任务类型 / 辅助类型` 接入 cockpit 目的地区块展示。
- 本轮新增的直接测试证据如下：
  - `shared/__tests__/mission-autopilot.test.ts`
    - 已直接覆盖：
      - active mission 的 `analysis`
      - waiting governance mission 的 `coordination`
      - blocked / retry mission 的主类型与辅助类型
      - `mixed` 回退
      - `unknown` 回退
  - `server/tests/mission-routes.test.ts`
    - 已直接断言 `/api/tasks/:id/projection` 返回的 `destination.taskType`
  - `client/src/lib/tasks-store.autopilot.test.ts`
    - 已直接断言 store 归一化后的 `destination.taskType / auxiliaryTaskTypes`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
    - 已直接断言 destination 卡片展示 `Task Type / Aux Types`
- 本轮补勾的边界需保持保守：
  - 这次落地的是 **mission-derived 最小任务类型识别闭环**，不是完整 `Destination parser` 分类器；
  - 当前仍不能把它外推为：
    - 子目标驱动的类型识别；
    - 基于输入归档 / clarifications / deliverable schema 的高保真分类；
    - 行业或场景级 task taxonomy。
- 同时，本轮继续明确 `实现缺失信息识别与澄清建议生成` 仍不能补勾：
  - 虽然当前代码与测试已经能直接证明 `suggestedClarifications` 在 blocking 缺口上的最小透传与展示；
  - 但仍缺：
    - non-blocking 缺口分类；
    - 完整 `MissingInformationItem`；
    - 每项缺口级别的独立澄清生成策略与测试矩阵。

## 追加复核备注（2026-04-26，显式标签抽取与澄清透传边界）

- 本轮继续只按“直接代码 + 直接测试”标准复核后，`destination-model-and-parser` 仍维持 `9 / 14`，没有新增可安全补勾项。
- 新增可确认的直接事实包括：
  - `shared/mission/autopilot.ts` 的 `buildSuccessCriteria()` 已通过 `extractTaggedDestinationItems(...)` 从 mission-derived 文本里补充显式 `Success criteria / Definition of done` 类条目。
  - `shared/mission/autopilot.ts` 的 `buildConstraints()` 已通过同一类标签抽取从 mission-derived 文本里补充显式 `Constraints / Requirements` 类条目。
  - `buildMissingInfoDetails()` 已能把 waiting / blocked 场景下的 `mission.decision?.prompt` 作为 blocking 缺口的 `clarification`，并由 `buildSuggestedClarifications()` 汇总到 `destination.suggestedClarifications`。
  - `shared/__tests__/mission-autopilot.test.ts` 已新增/覆盖显式成功标准与显式约束抽取场景，以及 waiting / blocked 缺口下的澄清透传场景。
  - `server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已继续证明 `suggestedClarifications`、`missingInfoDetails.clarification`、`taskType / auxiliaryTaskTypes` 可被 projection、store normalize 与 panel 展示链路消费。
- 但这些新增事实仍不足以补勾以下剩余实现类任务：
  - `实现目标与子目标解析策略`
    - 当前直接证据链里仍没有 `subGoals` 输出、子目标拆分来源、依赖关系、规则抽取框架、模型推断接口或低置信度回退策略。
  - `实现约束抽取策略`
    - 当前只能证明“显式标签约束 + mission kind/source/security 最小摘要”已经存在，尚未覆盖时间、预算、权限、输出格式、风格、数据范围、工具限制的完整矩阵，也没有结构化区分显式 / 推断 / 默认约束。
  - `实现成功标准识别策略`
    - 当前只能证明显式标签成功标准和 mission-derived 默认口径存在，尚未证明按任务类型补默认成功标准，也未证明无法确定时会进入缺失信息列表。
  - `实现缺失信息识别与澄清建议生成`
    - 当前只能证明 blocking 缺口能透传一条 decision prompt 作为澄清建议，尚未证明 non-blocking 缺口分类、完整 `MissingInformationItem`、或每项缺口级别的可复用澄清问题生成策略。
  - `补齐单元测试与契约测试`
    - 当前测试仍主要覆盖 `MissionAutopilotSummary.destination` 的 mission-derived 构造 / 透传 / 归一化 / 展示链路，尚未覆盖完整 `sourceInput -> Destination parser -> mission/workflow projection` 的 parser 契约矩阵。
- 因此，本轮 SVG 与 tasks 状态只应刷新审计口径，不应提升 done 数；当前准确数字继续为：
  - `destination-model-and-parser`: `9 / 14`
  - raw tasks 总计：`597 / 602`
  - P0 分组：`136 / 141`
  - P1 分组：`189 / 189`
  - P2 分组：`272 / 272`

## 收口备注（2026-04-26，Destination parser 最小合同已闭合）

- 本轮在 6 条并发 lane 汇合后，新增了可直接测试的 `parseMissionDestination()` parser 出口，并将之前仅停留在 `MissionAutopilotSummary.destination` 的 mission-derived 摘要提升为可序列化、可投影、可审计的最小 `Destination` 合同。
- 本轮新增的直接代码证据如下：
  - `shared/mission/autopilot.ts`
    - 新增 `MissionAutopilotParsedDestination` 及其子结构类型，包括 `sourceInput`、`normalizedGoal`、`subGoals`、结构化 `constraints`、结构化 `successCriteria`、`missingInformation`、`suggestedClarifications`、`evidence`、`mappedMissionContext`、`mappedWorkflowInput`、`version / updatedAt`。
    - 新增 `parseMissionDestination(mission)`，直接复用 mission 事实与标签抽取结果，输出 `sourceInput -> Destination -> mission/workflow projection` 的最小闭环。
    - `buildSubGoals()` 已支持显式 `Steps / Sub-goals / Plan` 标签、work package 派生、mission stage fallback，并保留来源、状态、依赖、优先级与置信度。
    - `buildConstraints()` 与 parser 结构化映射已覆盖时间、预算、权限、输出格式、风格、数据范围、工具限制与治理约束，并区分 `explicit / inferred / default` 来源以及 `confirmed / inferred / defaulted` 状态。
    - `buildSuccessCriteria()` 与 parser 结构化映射已覆盖显式成功标准、definition of done、任务类型默认成功标准与验证提示。
    - `buildMissingInfo()`、`buildMissingInfoDetails()`、`buildSuggestedClarifications()` 与 parser 结构化映射已覆盖 blocking 与 non-blocking 缺失信息，并为每项缺口生成可复用澄清问题。
  - `shared/mission/api.ts`
    - 已导出 parser 相关类型，确保 API 类型桶与 shared barrel 能消费同一套合同。
  - `server/tests/mission-routes.test.ts`
    - 已把 projection 契约从“subGoals 不输出”修正为正向断言 `destination.subGoals` 的 stage fallback 输出，避免 server 与 shared 新合同互相冲突。
  - `client/src/lib/tasks-store.ts`
    - 已支持 `subGoals / constraints / successCriteria / missingInfo / missingInfoDetails / suggestedClarifications` 多种 alias 与 fallback 归一化。
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
    - 已在 cockpit destination 区展示 sub-goals、constraints、success criteria、missing-info details 与 clarifications。
- 本轮新增的直接测试证据如下：
  - `shared/__tests__/mission-autopilot.test.ts`
    - 新增 parser 合同测试，覆盖 `sourceInput -> Destination parser -> mappedMissionContext / mappedWorkflowInput` 的完整最小链路。
    - 测试覆盖多子目标、时间/预算/权限/格式/风格/数据范围/工具约束、显式成功标准、non-blocking missing info、clarification prompt、evidence 与 API/barrel 类型出口。
  - `server/tests/mission-routes.test.ts`
    - 已通过 `/api/tasks/:id/projection` 断言 destination 子目标、约束、成功标准、missing-info 合同。
  - `client/src/lib/tasks-store.autopilot.test.ts`
    - 已覆盖 destination alias/fallback 归一化以及 structured sub-goal / missing-info detail 输出。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
    - 已覆盖 parser 字段在驾驶舱目的地区块的可读展示。
- 本轮验证命令已通过：
  - `.\node_modules\.bin\vitest.cmd run --config vitest.config.server.ts shared/__tests__/mission-autopilot.test.ts`
  - `.\node_modules\.bin\vitest.cmd run --config vitest.config.server.ts server/tests/mission-routes.test.ts`
  - `.\node_modules\.bin\vitest.cmd run client/src/lib/tasks-store.autopilot.test.ts client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
- 因此本轮可正式补勾剩余 5 项：
  - `实现目标与子目标解析策略`
  - `实现约束抽取策略`
  - `实现成功标准识别策略`
  - `实现缺失信息识别与澄清建议生成`
  - `补齐单元测试与契约测试`
- 当前准确数字更新为：
  - `destination-model-and-parser`: `14 / 14`
  - raw tasks 总计：`602 / 602`
  - P0 分组：`141 / 141`
  - P1 分组：`189 / 189`
  - P2 分组：`272 / 272`
- 边界说明：
  - 这次闭合的是 mission-derived 的最小 parser 合同，不是最终 L5 开放域模型推断 parser；
  - 低置信度回退目前主要通过 stage fallback、confidence 与 assumptions 表达，后续仍可继续增强为独立模型推断接口与版本化 clarification merge。
