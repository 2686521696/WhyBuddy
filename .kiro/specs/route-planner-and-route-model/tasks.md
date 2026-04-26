# 任务清单：路线规划器与路线模型

- [x] 定义 Route Set 与 Route 的 TypeScript 领域模型
  - [x] 补充 `RouteSet`、`Route`、`RouteStage`、`RouteStep`、`RouteRisk`、`RouteTakeoverPoint` 等核心类型。
  - [x] 明确 `fast / standard / deep / custom` 路线模式。
  - [x] 明确 Route 与 Destination、Mission、Workflow 的关联字段。

- [x] 定义主路线与候选路线生成规则
  - [x] 支持至少生成一条主路线。
  - [x] 支持快速、标准、深度三类候选路线。
  - [x] 为每条路线生成推荐理由、差异摘要、预估成本与预估时长。
  - [x] 保留未选择候选路线作为规划证据。

- [x] 设计 Route Planner 的规划流程
  - [x] 定义 Destination Analyzer。
  - [x] 定义 Route Candidate Builder。
  - [x] 定义 Risk Evaluator。
  - [x] 定义 Takeover Point Generator。
  - [x] 定义 Runtime Mapping Builder。
  - [x] 定义 Recommendation Selector。

- [x] 设计并行与串行路线表达
  - [x] 支持 Route Step 依赖关系。
  - [x] 支持 parallel group。
  - [x] 支持 join / merge 汇总点。
  - [x] 支持在 runtime 不具备真实并行时降级为串行执行。
  - [x] 记录并行降级原因。

- [x] 定义风险点模型与风险生成规则
  - [x] 支持上下文不足风险。
  - [x] 支持权限不足风险。
  - [x] 支持成本超限风险。
  - [x] 支持质量不确定风险。
  - [x] 支持外部工具失败风险。
  - [x] 支持数据可信度不足风险。
  - [x] 支持长耗时风险。
  - [x] 支持策略敏感风险。

- [x] 定义接管点模型与接管生成规则
  - [x] 支持澄清问题接管点。
  - [x] 支持路线选择接管点。
  - [x] 支持权限确认接管点。
  - [x] 支持预算确认接管点。
  - [x] 支持风险接受接管点。
  - [x] 支持结果验收接管点。
  - [x] 支持人工覆盖接管点。
  - [x] 区分必须接管与建议接管。

- [x] 建立 Route 到现有 workflow / mission runtime 的映射
  - [x] 映射 Route Stage 到十阶段 workflow pipeline。
  - [x] 映射 Route Step 到 workflow node / runtime adapter / agent action。
  - [x] 映射接管点到 HITL / wait-resume / decision 链路。
  - [x] 映射失败恢复到 `retry / escalate / terminate` 控制面。
  - [x] 映射 runtime event 到 Route 状态投影。

- [x] 设计 Route 重规划机制
  - [x] 定义重规划触发条件。
  - [x] 定义 `RouteReplanRecord`。
  - [x] 保留原路线与新路线差异。
  - [x] 保留已完成步骤证据。
  - [x] 支持继续当前路线、切换候选路线、生成新路线、请求用户接管。

- [x] 设计 Route 的前端驾驶舱摘要
  - [x] 提供主路线摘要。
  - [x] 提供候选路线对比摘要。
  - [x] 提供当前阶段与当前步骤。
  - [x] 提供风险点与接管点数量。
  - [x] 提供剩余步骤、预计时间、预计成本。
  - [x] 提供路线推荐原因。

- [x] 设计 Route 的审计、回放与证据链
  - [x] 记录路线生成输入。
  - [x] 记录主路线推荐原因。
  - [x] 记录候选路线与用户选择。
  - [x] 记录接管点触发与用户决策。
  - [x] 记录重规划前后快照。
  - [x] 将 Route 与 Mission Runtime 事件流关联。

- [x] 补充测试计划
  - [x] 覆盖快速路线生成。
  - [x] 覆盖标准路线生成。
  - [x] 覆盖深度路线生成。
  - [x] 覆盖主路线推荐。
  - [x] 覆盖候选路线保留。
  - [x] 覆盖并行组降级。
  - [x] 覆盖风险点生成。
  - [x] 覆盖接管点生成。
  - [x] 覆盖 Route 到 workflow / mission runtime 的映射。
  - [x] 覆盖重规划记录。

## 审计备注（2026-04-24）

- 当前主仓落地的是 `MissionAutopilotSummary.route` 这一层的最小 Route projection，而不是完整独立的 `RouteSet / RouteStep / RouteRisk / RouteTakeoverPoint` 持久化领域模型；因此本轮只勾选已被现有字段和测试直接支撑的子项。
- 本轮新增勾选的“定义主路线与候选路线生成规则”，对应的是 shared builder / server projection / client fallback / panel route diff 之间已经稳定收口的候选路线摘要规则：当前仓内已能稳定生成主路线、`fast / standard / deep` 三类候选路线、推荐理由、差异摘要、成本/时长与保留未选路线证据；但这仍不等于存在独立 `Route Planner` 组件、独立 `RouteSet` 持久化或完整 planner pipeline。
- `shared/mission/autopilot.ts` 已提供 `MISSION_AUTOPILOT_ROUTE_MODES`、`candidateRoutes`、`recommendedRouteId`、`selectedRouteId`、`selectionStatus`、`selection`、`evidence`、`replan`、`takeoverPointIds`、`riskPoints`、`changeReason` 等字段；`buildCandidateRoutes()` 目前稳定生成 `fast / standard / deep` 三类候选路线，并保留未选路线用于对比和证据。
- 候选路线元数据已经形成闭环：shared builder 为每条 candidate route 生成 `summary`、`reason`、`description`、`estimatedCost`、`estimatedDuration`、`riskLevel`、`takeoverLoad`；`TaskAutopilotPanel` 会消费这些字段输出 route diff；shared / server / client / panel 测试已共同覆盖 fast / standard / deep 三类路线的生成与对比。
- 当前 route 阶段同样是 summary 级映射：`route.stages` 与 `currentStageKey/currentStageLabel` 已经足以支撑“主路线摘要 + 当前阶段/当前步骤”展示，但它们来源于 mission stage 投影，还不是独立 `RouteStage / RouteStep` 图结构或 planner 输出。
- `server/tasks/mission-projection.ts` 已将 shared route projection 透传到 `autopilotSummary`，并附带 workflow runtime / mission decision / operator action 上下文；`server/tests/mission-routes.test.ts` 覆盖了等待决策、workflow 绑定、replan-aware projection 与 route-level control/recovery 映射。
- `shared/__tests__/mission-autopilot.test.ts` 覆盖了默认推荐、预算接管、blocked retry 重规划三类 route 语义；`client/src/lib/tasks-store.autopilot.test.ts` 覆盖了 client fallback 的候选路线保留、`alternatives-available`、`replanned` 语义对齐；`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 覆盖了主路线摘要、候选路线对比、重规划证据与 route-selection 可切换提示。
- 本轮新增勾选的“映射 runtime event 到 Route 状态投影”，依据是 shared builder 已稳定输出 `route.evidence.events` 中的 `route.recommended / route.selected / route.locked / route.replanned` 状态事件，并通过 `selectionStatus`、`changeReason`、`replan` 摘要把 mission runtime 变化投影回 route 选择与重规划状态；shared / server / client / panel 测试都已覆盖这些状态事件和 UI 呈现。
- 本轮新增勾选的“将 Route 与 Mission Runtime 事件流关联”，依据是 `evidence.correlation` 已稳定输出 `missionId / workflowId / routeIds / routeStageKeys / runtimeEventIds / decisionIds / operatorActionIds`，`shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 对这些关联字段有直接断言，client store 会保留 route evidence，panel 也会展示 route evidence / route events；但这仍是 correlation/index 层闭环，不等于 replay / audit 中已有独立 Route 快照。
- 本轮还可以保守补勾“映射 Route Stage 到十阶段 workflow pipeline”：
  - `shared/mission/autopilot.ts` 当前直接把 `mission.stages` 投影为 `route.stages`，并同步输出 `currentStageKey / currentStageLabel` 与 `evidence.correlation.routeStageKeys`
  - `shared/__tests__/mission-autopilot.test.ts` 已直接断言 `route.stages` 长度、`currentStageKey/currentStageLabel` 与 `routeStageKeys`
  - `server/tests/mission-routes.test.ts` 进一步验证 projection 返回的 `currentStageKey/currentStageLabel`、`routeStageKeys` 与 waiting / replanning 场景中的 stage 语义
  - `client/src/lib/tasks-store.autopilot.test.ts` 会保留 `route.stages`，`client/src/components/tasks/TaskAutopilotPanel.tsx` 则消费 `route.stages` / `currentStageLabel` 输出当前阶段摘要
- 但这个勾选的边界也需要收紧：
  - 当前落地的是“mission 固定阶段 -> route stage 摘要投影”的映射，不是独立 planner 生成的 `RouteStage[]` 拓扑
  - 也还不是 `Route Step -> workflow node / adapter` 级别的精细映射
- 本轮也可以保守补勾“保留原路线与新路线差异”：
  - `shared/mission/autopilot.ts` 已稳定输出 `route.selection.changedReason`、`route.replan.fromRouteId / toRouteId / triggeredBy / reason` 以及 `route.evidence.events[eventType=route.replanned]`
  - `shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 已共同断言 replanned 场景中的 `selectionStatus`、`replan`、`fromRouteId / toRouteId` 与 `replanChangeSummary`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 会把 selected vs recommended 的 mode / risk / load / ETA / cost 输出为 `Route Diff`，并展示 `Replan active`、`From / To`、`Selection Reason` 与 `Route Events`
- 但这条同样只代表“最小差异摘要闭环”：
  - 当前并没有独立 `RouteReplanRecord`
  - 也没有 replay / audit 里的前后路线快照持久化，因此不能把它写成完整重规划记录模型已完成
- 并行/串行当前只有摘要级闭环：`shared/mission/autopilot.ts` 输出的是 `execution.parallelBranchCount`，前端面板能展示“并行分支数”，但尚未落成 `RouteStep.dependencies`、`parallelGroups`、`join / merge` 或“降级原因”的结构化 route model。
- 风险/接管当前也以摘要级字段为主：`route.riskPoints` 仍是字符串列表，`route.takeoverPointIds` 与顶层 `takeover.required/type/prompt/options` 已可驱动 route-selection、budget、clarification 等接管闭环，但还不能视为完整 `RouteRisk` / `RouteTakeoverPoint` 对象模型。
- `route.replan` 与 `route.evidence.events` 已支撑“重规划摘要 + 前后路线 + 触发方”的最小闭环，但还不是独立 `RouteReplanRecord`；因此“覆盖重规划记录”本轮回退为未完成，避免把摘要级语义写成完整记录模型已落地。
- 本轮可保守补勾“提供风险点与接管点数量”：
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 route block 已直接基于 `riskPoints.length` 与 `takeoverPointIds.length` 输出数量摘要，而不只是展示原始列表。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接断言 `1 个风险点`、`2 个接管点`、`3 个接管点` 等 route block 文案，覆盖多个 selected / recommended route 场景。
- 本轮也可保守补勾“提供剩余步骤、预计时间、预计成本”：
  - `TaskAutopilotPanel.tsx` 的 route block 已通过 `summarizeRouteMetric(...)` 汇总 candidate route 的 ETA / Cost，并通过 `routeRemainingStepsSummary(...)` 输出 `剩余 N 步 / 剩余步骤 / 并行分支 / replanChangeSummary`。
  - `TaskAutopilotPanel.test.tsx` 已直接断言 `时长汇总`、`成本汇总`、`剩余 2 步`、`剩余步骤: ...`、`还有 2 个并行分支` 等 route block 级展示，不再只是 explanation block 的旁路摘要。
- 这两条勾选的边界也要保持保守：
  - 当前完成的是 route 摘要块的最小聚合展示闭环，不是独立 `RouteSummaryViewModel` 契约。
  - 也不等于 ETA / Cost / Remaining Steps 已在 replay / audit / standalone cockpit 中形成统一消费模型。
- 本轮额外复核了 `permission / risk-acceptance / delivery-review` 这些接管类型：shared `inferTakeoverType()` 与 panel 本地化分支已包含这些枚举，但主仓缺少 shared/server/client 联动的直接断言，尚不能把“支持权限确认接管点”“支持风险接受接管点”“支持结果验收接管点”保守勾选。
- 本轮也继续复核了 `manual override / operator` 与 `required / pending / advisory + required / blocking` 这组接管语义：shared `inferTakeoverStatus()` 与 `takeover.required / blocking`、client store fallback、panel badge/文案分支都已存在，但现有 shared/server/client 联动测试主要覆盖的是 `route-selection`、`budget`、`approval` 与 blocked recovery；尚不足以把“支持人工覆盖接管点”或“区分必须接管与建议接管”写成 route takeover model 已完成。
- 本轮继续复核 `server/tests/mission-routes.test.ts` 后，可以更明确地确认：projection 层现在已经直接断言了 `autopilotSummary.route.evidence.lastEventType / lastEventAt / events`、显式 `links.replayId` 透传，以及 waiting / retry / replan 场景中的 `remainingSteps.replanChangeSummary` 与 `explanation.evidenceHints`。这些证据进一步加固了已勾选的“记录主路线推荐原因”“记录候选路线与用户选择”“记录接管点触发与用户决策”“将 Route 与 Mission Runtime 事件流关联”等条目，但仍然只是 route summary / evidence correlation / replan 摘要层闭环。
- 因此本轮对 route spec 的结论更新为：新增测试已经足以把“提供风险点与接管点数量”“提供剩余步骤、预计时间、预计成本”这两条 route block 摘要能力保守写成已完成；但仍不足以把“定义重规划触发条件”“定义 `RouteReplanRecord`”“记录重规划前后快照”写成已完成，因为当前 shared/server/client 仍未形成对应的结构化 route model、独立 replan record 或持久化快照口径。
- 由于“设计 Route 的前端驾驶舱摘要”下面的 6 个子项现在都已有直接代码与测试支撑，本轮一并将该父任务收口为已完成；这里的完成口径仍严格限定在 `TaskAutopilotPanel` 当前 route block 的最小摘要能力，不外推为独立 cockpit 页面或统一 `RouteSummaryViewModel` 已落地。
- 本轮继续复核“保留已完成步骤证据”后，结论仍保持未勾选：`shared/mission/autopilot.ts` 当前构造的 `explanation.remainingSteps.mainlineSteps` 会保留整条主线阶段列表，但 `pendingSteps` 明确只筛选 `pending / running`，而现有 server/client/panel 测试也主要消费“剩余步骤”而非“已完成步骤证据”；因此还不能把它写成 completed-step evidence 已形成可复用闭环。
- 尚未保守勾选的部分包括：完整 `RouteSet` 领域模型、独立 `Route Planner` 组件流程、`RouteStep / parallelGroups` 表达、结构化 `RouteRisk` / `RouteTakeoverPoint` 对象、`RouteReplanRecord`、以及 Route 在 replay / audit 中的独立快照持久化。
- 本轮 checkbox 审计预案再次只读复核 `shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 后，结论更新为：现有证据稳定支撑 `route summary + candidate comparison + replan summary + route diff + 风险/接管数量摘要 + remainingSteps / ETA / 成本聚合摘要`；但仍不足以新增勾选到 `RouteReplanRecord` 或更细粒度的权限/风险/结果验收/人工覆盖接管模型。

## 审计备注补充（2026-04-25）

- 本轮保守新增勾选“明确 Route 与 Destination、Mission、Workflow 的关联字段”：`shared/mission/autopilot.ts` 当前已把 `destination.id`、`route.id`、`bindings.missionId / workflowId / instanceId` 与 `evidence.correlation.missionId / workflowId / routeIds / selectedRouteId / recommendedRouteId` 收口为稳定的关联字段集合；`shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts` 与 `client/src/lib/tasks-store.autopilot.test.ts` 都对这些字段做了直接断言。
- 这条勾选的完成口径仍需严格限定在 projection / bindings / correlation 层：当前能证明的是 Route 摘要与 Destination、Mission、Workflow 之间的关联字段已经可读、可透传、可测试，不等于独立 `Route` 领域模型已经持有并持久化 `destinationId / missionId / workflowId` 全量关联。
- “记录路线生成输入”继续保持未勾选：虽然 `destination.request / constraints / successCriteria / deliverables / missingInfo` 已在 shared / server / client 三层输出并被测试覆盖，但它们更接近当前 route summary 的输入摘要，而不是 replay / audit 可回放的 planner 输入快照。
- “支持上下文不足风险”等风险子项本轮仍保持未勾选：`buildRiskPoints()` 确实会把 `waitingFor`、`blocker`、`failed` 等信号收口为 `route.riskPoints` 字符串摘要，并有 shared / server / client / panel 证据，但仓内还没有带 `type / severity / mitigation` 的结构化 `RouteRisk` 对象，也缺少直接按风险类型命名的联动断言；为避免把字符串摘要写成完整风险模型，本轮只保留 audit note。
- `permission / risk-acceptance / delivery-review / advisory / manual override` 仍只保留审计备注：shared builder 和 panel 枚举分支虽已覆盖这些字面值，但指定证据文件中仍缺少 shared / server / client 联动断言，不能把它们保守勾成已完成。
- lane 2 本轮继续复核 `shared/mission/api.ts` 后，可以更明确地把当前已勾选能力收口为“稳定 API / projection contract”，而不是 planner 领域模型：`MissionAutopilotCandidateRoute`、`MissionAutopilotRouteSummary`、`MissionAutopilotRouteEvidenceSummary`、`MissionAutopilotRouteReplanSummary`、`MissionAutopilotTakeoverSummary`、`MissionAutopilotEvidenceCorrelationIndex`、`MissionAutopilotRemainingStepsExplanation` 等类型都已通过 API / barrel 导出；`shared/__tests__/mission-autopilot.test.ts` 也直接对 `Api*` 与 barrel 类型做了等型断言。这进一步加固了当前 checklist 里已勾选的，是 shared/server/client/panel 共用的摘要契约，而不是独立 `RouteSet / RouteRisk / RouteTakeoverPoint / RouteReplanRecord` 模型。
- lane 2 本轮继续复核 `server/tasks/mission-projection.ts` 后，确认 server 侧当前做的是 `buildMissionAutopilotSummary(...)` 结果透传，以及 `links -> bindings / evidence.correlation` 的对齐收口；这足以支撑已经勾选的“关联字段”“runtime 事件关联”“候选路线/重规划摘要”条目，但仍不足以把“记录路线生成输入”“记录重规划前后快照”“定义 `RouteReplanRecord`”推进为已完成。
- lane 2 本轮继续复核 `client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/TaskAutopilotPanel.tsx` 后，可以更明确地区分“已勾选的面板聚合能力”和“未勾选的模型能力”：fallback/store/panel 现在确实会把 `remainingSteps`、candidate route 的 `estimatedDuration / estimatedCost`、`route.riskPoints.length`、`route.takeoverPointIds.length`、`route.evidence` 与 `route.replan` 收口到 route block 与 evidence block，相关测试也有直接断言；但这仍只是 UI / normalize 层的最小闭环，不应外推成独立 `RouteSummaryViewModel` 或 replay / audit 统一消费模型。
- lane 2 本轮额外复核了 `client/src/lib/tasks-store.autopilot.test.ts` 中 mission/planet fallback 的澄清场景：当前已经有 `type: "clarification"`、`missingInfo: ["Clarify the target audience."]`、`takeover.required = true`、`takeoverPointIds = ["planet-only:takeover"]` 的直接测试证据。这说明“支持澄清问题接管点”这条既有勾选是稳的；但它同样只代表 summary contract 已闭环，不足以新增勾选到结构化 `RouteTakeoverPoint` 模型。
- lane 2 本轮也重新核对了 `required: false / blocking: false` 的无接管场景与 `required: true / blocking: true` 的阻塞场景：server projection、client fallback 与 panel 都能透传这些布尔语义，但重点证据文件里仍然没有 `advisory` 状态的跨层直接断言。因此“区分必须接管与建议接管”继续保持未勾选，只补审计备注，避免把 `required/blocking` 布尔字段误写成 route takeover policy 已完整落地。
- 在除“重规划触发条件”之外的其余未勾选项上，本轮没有再发现比现有状态更稳的新勾选项：当前 checklist 里的已勾选条目已经基本覆盖所有具备“直接代码 + 直接测试证据”的 route summary / candidate comparison / stage projection / takeover summary / evidence correlation 能力；其余未勾选项继续维持保守口径，仅补证据边界说明。

- lane 2 本轮保守新增勾选“定义重规划触发条件”：`shared/mission/autopilot.ts` 当前已经把重试驱动的 `selectionStatus = replanned`、`selection.mode = runtime_replanned`、waiting / blocker 场景下的 `replan` action 原因、`route.replan.reason / fromRouteId / toRouteId / triggeredBy`、`route.evidence.events[eventType=route.replanned]` 与 `explanation.remainingSteps.replanChangeSummary` 收口为稳定的重规划摘要契约；`shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 均有直接断言。
- 这条新勾选仍必须按最小口径理解：当前已完成的是“重规划触发条件的设计收口 + summary/projection/panel 契约闭环”，不是独立 `RouteReplanRecord`、前后快照持久化、completed-step evidence 保留，或完整 planner 级重规划图模型。

## 审计备注补充（2026-04-25，本轮设计收口）

- 本轮基于 `requirements.md` 与 `design.md` 的结构化补强，新增勾选的均属于“设计已完整定义”的任务，而不是“代码已完整实现”的任务。换句话说，本轮收口的是 spec 设计层，不是 runtime / persistence / replay 存储层。
- 本轮新增勾选的设计项包括：
  - `定义 Route Set 与 Route 的 TypeScript 领域模型`
  - `设计 Route Planner 的规划流程`
  - `设计并行与串行路线表达`
  - `定义风险点模型与风险生成规则`
  - `定义接管点模型与接管生成规则`
  - `建立 Route 到现有 workflow / mission runtime 的映射` 中的 `Route Step -> workflow node / runtime adapter / agent action` 设计映射
  - `设计 Route 重规划机制` 中的 `RouteReplanRecord`、重规划结果类型、保留已完成步骤证据等目标设计
  - `设计 Route 的审计、回放与证据链` 中的路线生成输入快照、重规划前后快照设计
  - `补充测试计划` 中的并行降级与重规划记录测试计划
- 这些勾选之所以现在安全，是因为文档已经明确给出了：
  - 目标模型：`RouteSet / Route / RouteStage / RouteStep / RouteParallelGroup / RouteRisk / RouteTakeoverPoint / RouteRuntimeMapping / RouteReplanRecord`
  - 规划流程：`Destination Analyzer / Route Candidate Builder / Risk Evaluator / Takeover Point Generator / Runtime Mapping Builder / Recommendation Selector`
  - 运行时映射：`RouteStageRuntimeMapping / RouteStepRuntimeMapping`
  - 审计回放：`RoutePlannerInputSnapshot / RouteExecutionSnapshot / RouteReplaySnapshot`
  - 测试矩阵：路线模式、并行降级、风险生成、接管生成、runtime 映射、重规划记录
- 本轮同时继续保守保留以下事实边界，不把 design 勾选误写成 implementation 勾选：
  - 当前主仓真正稳定落地的仍然是 `MissionAutopilotSummary.route` 周边的最小 route projection contract；
  - 当前仍未形成独立持久化的 `RouteSet / RouteRisk / RouteTakeoverPoint / RouteReplanRecord`；
  - 当前 `RouteStep`、`parallelGroups`、`fallbackReason` 仍未被 runtime 直接消费；
  - 当前 replay / audit 侧也还没有独立 Route snapshot 存储。
- 因此，本 spec 现在的状态应理解为：
  - 设计层：本轮已完成收口；
  - 代码层：仍以 `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts`、`TaskAutopilotPanel` 这条最小 projection 链为主；
  - 后续实现层：需要按文档定义逐步把目标 Route 模型接入 shared contract、server projection、runtime 消费与 replay / audit 存储。
