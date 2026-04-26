# 任务清单：任务自动驾驶可解释性与遥测层

- [x] 梳理当前主仓中可用于解释层的真实事实来源，包括 mission、workflow、runtime event、replay、audit、artifact、decision、review 与 monitoring projection
- [x] 定义 `AutopilotExplanation` 基础对象结构，覆盖解释类型、来源、关联对象、证据引用、建议动作、状态与更新时间
- [x] 定义当前状态解释对象 `CurrentStateExplanation`，明确如何从 `Drive State`、Mission Runtime 与 workflow runtime 投影生成
- [x] 定义推荐原因对象 `RecommendationReason`，覆盖路线推荐、动作推荐、接管默认动作与重规划策略解释
- [x] 定义剩余步骤解释对象 `RemainingStepsExplanation`，覆盖主线步骤、并行支路、待执行步骤与重规划后的变化说明
- [x] 定义风险解释对象 `RiskExplanation`，覆盖风险类型、严重程度、触发原因、影响范围、缓解动作、接管与重规划关系
- [x] 定义置信度解释对象 `ConfidenceExplanation`，覆盖目标理解、路线可行性、执行完成、结果质量与证据充分性维度
- [x] 定义证据提示对象 `EvidenceHint`，明确 runtime event、replay timeline、audit entry、artifact、log、decision、review、lineage ref 的引用方式
- [x] 定义实时状态信号目录，包括 `drive_state.changed`、`route.recommended`、`route.selected`、`route.replanned`、`step.progressed`、`risk.changed`、`confidence.changed`、`evidence.updated`、`takeover.requested`、`takeover.resolved`、`runtime.health_changed`
- [x] 输出高层遥测信号与现有 Web-AIGC runtime events 的映射表，明确哪些来自原生事件，哪些来自 projection 或组合推断
- [x] 明确解释对象与 `Destination`、`Route`、`Drive State`、`Fleet`、`Takeover Point`、`Replan`、`Confidence`、`Risk`、Evidence 的映射关系
- [x] 设计解释来源 `ExplanationSource` 口径，区分 runtime event、mission projection、workflow projection、route planner、audit entry、replay snapshot、frontend view model 与 combined inference
- [x] 设计解释关联引用 `ExplanationRelatedRefs`，覆盖 mission、workflow、workflow instance、route、step、node、runtime event、decision、audit、replay、artifact、lineage
- [x] 评估哪些解释可以先由前端 view model 推导，哪些必须优先进入服务端 projection、replay 或 audit
- [x] 梳理高风险解释进入 audit 的规则，包括权限、预算、合规、外部副作用、风险接受、路线切换与重规划
- [x] 梳理 replay 需要复原的解释时间线内容，包括当前状态、推荐原因、风险、置信度、剩余步骤、接管提示与证据提示
- [x] 定义证据不足时的展示与记录规则，避免把推断解释伪装为确定事实
- [x] 明确可解释性与遥测层不新建独立 telemetry backend、不替代现有 observability / audit / runtime events 的兼容边界
- [x] 设计第一阶段前端接入方案，在驾驶舱或任务详情页展示当前状态解释、剩余步骤、风险、置信度与证据提示
- [x] 设计第二阶段服务端 projection 接入方案，使关键解释对象可被驾驶舱、任务详情、接管面板、replay 与 audit 复用
- [x] 设计第三阶段 runtime events 增强方案，补齐关键高层信号的事件或投影证据
- [x] 设计第四阶段 replay / audit 闭环方案，支持任务完成后追踪“为什么这么做”和“当时依据是什么”
- [x] 补充测试计划，覆盖解释对象生成、信号映射、风险与置信度变化、接管解释、重规划解释、证据提示和回放复原

## 审计备注（2026-04-24）

- 当前 shared `MissionAutopilotExplanationSummary` 已在保留原有 `current / nextSteps / recommendationReasons / riskSummary / evidenceHints / telemetrySignals` 的同时，新增结构化 `currentState`、`recommendationDetails` 与 `remainingSteps` 字段；`shared/__tests__/mission-autopilot.test.ts` 已直接断言这些结构化对象在 queued / waiting / replanning / blocked-retry 场景下的输出。
- `server/tasks/mission-projection.ts` 会把 shared explainability summary 透传到 `autopilotSummary`，`server/tests/mission-routes.test.ts` 也已对 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals` 做 projection 级断言，因此 shared/server 契约与测试闭环已成立。
- design 文档中的“事实信号层”已按 mission、workflow、runtime event、replay、audit、artifact、decision、review、monitoring projection 梳理真实来源；并已用 mission routes、monitoring routes、runtime observability、workflow runtime review checkpoint 定向测试复核主仓现状。
- design 文档中的 runtime signal 映射表已覆盖 `node.started/completed/failed`、`node.waiting_input`、`edge.transitioned`、`instance.retry_requested`、`instance.escalated`、人工决策与 Route Planner 输出等来源；现有 Web-AIGC observability 测试已验证 runtime 事件会镜像到 replay / audit，而 mission projection 测试验证了解释层可继续通过 projection 消费这些事实。
- 当前实现继续复用 mission/workflow projection、monitoring 路由和 runtime observability bridge，没有引入新的独立 telemetry backend，因此“兼容边界”任务可保守勾选。
- `client/src/lib/tasks-store.ts` 当前归一化的 explanation 仍主要保留 `current / nextSteps / recommendationReasons / riskSummary / evidenceHints / telemetrySignals` 这组扁平摘要字段，`client/src/lib/tasks-store.autopilot.test.ts` 也主要验证这些字段的 fallback / normalize；其中 `riskSummary / evidenceHints / telemetrySignals` 仍是字符串数组摘要，并未上升为结构化 `RiskExplanation`、`EvidenceHint` 或运行时信号对象。
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 现阶段主要消费并渲染这组扁平字段；`client/src/components/tasks/TaskDetailView.tsx` 也只是把 `TaskAutopilotPanel` 接入任务详情页，没有新增一个独立的结构化 explainability consumer，因此不能据此前推“currentState / recommendationDetails / remainingSteps` 已被前端完整按结构消费”。
- `client/src/components/tasks/TaskDetailView.tsx` 已把 `TaskAutopilotPanel` 接入任务详情页，`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 既覆盖了任务详情页接线，也覆盖了 panel 对当前状态、route/live execution 剩余步骤线索、风险、置信度、证据提示与 explanation 摘要的展示；结合 `client/src/lib/tasks-store.autopilot.test.ts` 对 `autopilotSummary` normalize / fallback 的断言，本轮可以保守勾选“第一阶段前端接入方案”。
- 但这仍然只是任务详情页上的最小前端闭环，当前 UI 主要消费的是扁平 explanation 摘要字段与 route/execution blocks，不能进一步外推为“结构化 explainability UI 已完整落地”或“结构化 explainability 契约已被 client 全量消费”。
- 虽然 `shared/mission/autopilot.ts` 已定义 `MissionAutopilotExplanationSource`、`MissionAutopilotCurrentStateExplanation`、`MissionAutopilotRecommendationReason`、`MissionAutopilotRemainingStepsExplanation`，`shared/mission/api.ts` 也已把这些类型透出给 shared/server/client 契约面，但当前落地范围仍主要集中在 mission projection 与任务详情页消费；spec 中“第二阶段服务端 projection 接入方案”要求的“驾驶舱、任务详情、接管面板、replay 与 audit 复用”尚未全部形成代码化复用入口。
- `server/tests/mission-routes.test.ts` 已直接断言 projection 返回 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals`，说明 shared -> server projection 这一段已经具备明确契约；但 `client/src/lib/tasks-store.ts` 当前仍未把 `currentState / recommendationDetails / remainingSteps` 作为结构化 explainability view model 向下消费，`TaskAutopilotPanel` 也仍以 `current / nextSteps / recommendationReasons / riskSummary / evidenceHints / telemetrySignals` 为 explanation block 主入口，因此这轮还不能把“第二阶段服务端 projection 接入方案”整体勾选为完成。
- 本轮继续对 shared / server / client 现状做只读复核后，可以更明确收紧两个边界：一是 `MissionAutopilotExplanationSource` 虽已在 shared 类型中列出 `mission-runtime / workflow-runtime / route-planner / recovery-engine / takeover-state / combined-inference` 等来源，并被 shared/server 测试命中，但它仍未扩展到 spec 要求的 `audit entry / replay snapshot / frontend view model` 复用口径；二是 `evidenceHints / telemetrySignals / riskSummary` 在 client 侧仍主要作为字符串摘要消费，而不是结构化 `EvidenceHint`、`RiskExplanation` 或 `ConfidenceExplanation` 对象。
- 因此，本轮仍不新增 explainability 勾选：当前新增和加强的测试只能证明 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals` 这组 shared -> server -> task detail 的最小契约闭环更稳了，还不足以把“设计解释来源 `ExplanationSource` 口径”“定义证据提示对象 `EvidenceHint`”“定义风险解释对象 `RiskExplanation`”“设计第二阶段服务端 projection 接入方案”写成已完成。
- `RiskExplanation`、`ConfidenceExplanation`、结构化 `EvidenceHint`、`ExplanationRelatedRefs`、关键解释对象在 replay / audit 中的复用结构仍未落地；除“第一阶段前端接入方案”外，本轮不新增其他勾选。
- 本轮 checkbox 审计预案复核 `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts` 与 `client/src/components/tasks/TaskAutopilotPanel.tsx` 后，结论仍维持保守口径：结构化 explainability 契约已经在 shared/server 成型，但 client 侧消费仍以扁平摘要为主，因此暂不新增 `RiskExplanation`、`ConfidenceExplanation`、结构化 `EvidenceHint`、第二阶段 projection 复用或 replay/audit 闭环相关勾选。

## 审计备注（2026-04-24，Lane 5 explainability 复核）

- 本轮重新核对 `shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 后，结论维持 `8 / 23`，不新增勾选。
- 需要收紧但也要纠正的一点是：client 侧已经不再是“只剩扁平 explanation 摘要”。`client/src/lib/tasks-store.ts` 当前会稳定 normalize 并保留 `explanation.currentState / recommendationDetails / remainingSteps` 与 `evidence.correlation`，对应测试也已直接断言这些结构化字段的 fallback / alias / normalize 结果。
- 同时，`TaskAutopilotPanel` 已经能消费并展示结构化 `currentState`、`recommendationDetails`、`remainingSteps`，也会展示 `evidence.correlation` 的标识与计数；这说明任务详情页上的 explainability UI 已经从“只有扁平文案”推进到“结构化摘要 + 扁平风险/证据提示并存”的最小闭环。
- 本轮再向前补的一小步是：`recommendationDetails.routeSelectionStatus / correlationTimelineId` 现在也能从 store 归一化结果稳定保留到 panel，并作为 recommendation 的 explainability 元信息展示；对应 store / panel 测试已补到这一层。
- 但这仍不足以新增 checkbox：`riskSummary / evidenceHints / telemetrySignals` 仍主要是字符串摘要，尚未形成结构化 `RiskExplanation`、`ConfidenceExplanation`、`EvidenceHint`；而且当前结构化 explainability 消费仍主要停留在任务详情页，没有形成 spec 要求的驾驶舱 / 接管面板 / replay / audit 统一复用入口。
- 因此，本轮更准确的口径是：shared -> server -> store -> task detail panel 的 explainability 最小契约已经更稳、更完整，但它仍是“任务详情页级结构化预览”，还不是“完整 explainability 对象体系与跨面复用闭环”。

## 审计备注（2026-04-25，Lane 4 explainability 复核）

- 本轮新增保守勾选仅限“定义证据不足时的展示与记录规则，避免把推断解释伪装为确定事实”，完成数由 `8 / 23` 推进到 `9 / 23`。
- 直接代码与测试证据已经覆盖 shared -> server -> client 的最小闭环：
  - `shared/mission/autopilot.ts` 通过 `inferEvidenceTrustLevel()` 与 `buildEvidenceGaps()` 生成 `evidence.trustLevel`、`evidence.gaps`，并把同一组缺口同步写入 `explanation.evidenceHints`
  - `shared/__tests__/mission-autopilot.test.ts` 已直接断言 `partial / unverified` 场景下的 `trustLevel`、`gaps` 与 `evidenceHints`
  - `server/tests/mission-routes.test.ts` 已断言 mission projection 会把这些 gap / hint 继续透传到 `autopilotSummary.evidence` 与 `autopilotSummary.explanation`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 会把 `evidence.trustLevel`、`evidence.gaps` 与 `explanation.evidenceHints` 作为显式 UI 文案展示；`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 也已直接覆盖 `Trust: Unverified` 与 `No runtime events captured yet.`
- 这次勾选的边界必须收紧为“证据不足时显式显示未验证/缺口/提示，不把它包装成确定事实”的最小规则；它仍不代表以下事项已完成：
  - 结构化 `EvidenceHint` 对象与引用模型；
  - `AutopilotExplanation` / `ExplanationRelatedRefs` 全量对象体系；
  - explainability 在 replay / audit 中的统一复用或时间线复原。

## 审计备注（2026-04-25，Lane 5 explainability 复核补充）

- 本轮在保守口径下新增 1 项勾选：`明确解释对象与 Destination / Route / Drive State / Fleet / Takeover Point / Replan / Confidence / Risk / Evidence 的映射关系`，完成数由 `9 / 23` 推进到 `10 / 23`。
- 直接代码证据已经把这组对象映射固化到同一条 shared -> server -> client 链路：
  - `shared/mission/autopilot.ts` 的 `MissionAutopilotSummary` 同时产出 `destination / route / driveState / fleet / takeover / evidence / explanation`；其中 `buildExplanationSummary()` 会把 `currentState` 绑定 `driveState/currentStage/workflowStatus`，把 `recommendationDetails` 绑定 `routeId/actionType/takeoverType/decisionId/routeSelectionStatus`，把 `remainingSteps` 绑定 `selectedRouteId/currentStep/pendingSteps/replanChangeSummary`，并分别复用 `buildDestinationConfidence()`、`buildRiskPoints()`、`buildEvidenceCorrelationIndex()` 生成 `destination.confidence`、`riskSummary` 与 `evidence.correlation`。
  - `shared/mission/api.ts` 已把 `MissionAutopilotSummary` 相关 explainability 类型继续透出给 shared/server/client 契约面；`shared/__tests__/mission-autopilot.test.ts` 也直接复核了 api/index barrel 的类型出口没有脱节。
- 直接测试证据已经覆盖这组映射在 builder、projection、store 与 panel 上的最小闭环：
  - `shared/__tests__/mission-autopilot.test.ts` 已在 planning / waiting / blocked-retry / recovery-contract 场景断言 `destination.confidence`、`route.selection/replan/evidence`、`driveState.state`、`fleet.roles.currentFocus`、`takeover.decisionId`、`explanation.currentState / recommendationDetails / remainingSteps`、`riskSummary` 与 `evidence.correlation` 之间的对应关系。
  - `server/tests/mission-routes.test.ts` 已断言 mission projection 会继续透传上述对象映射，尤其覆盖 waiting、replanning 与 resolved projection links 场景下的 `destination / route / driveState / takeover / evidence / explanation` 一致性。
  - `client/src/lib/tasks-store.autopilot.test.ts` 已断言 client normalize 后仍保留 `destination.confidence`、`fleet.roles`、`route.selection/replan`、`explanation.currentState / recommendationDetails / remainingSteps` 与 `evidence.correlation`。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖任务详情页对 `destination confidence / missing-info`、`fleet`、`structured explanation details` 与 `evidence correlation` 的展示，因此这组映射已经进入现有 task detail consumer。
- 本轮勾选的边界也必须写清楚：这里确认的是“现有 `MissionAutopilotSummary` / mission projection / task detail panel` 上，这些对象之间的映射关系已经有直接代码与测试锚点”，并不代表以下条目已经完成：
  - 结构化 `RiskExplanation`、`ConfidenceExplanation`、`EvidenceHint` 对象体系；
  - `ExplanationSource` 扩展到 `audit entry / replay snapshot / frontend view model` 的完整口径；
  - 驾驶舱、接管面板、replay、audit 对同一 explainability 对象的统一复用闭环。

## 审计备注（2026-04-25，Lane 5 explainability 二次复核）

- 本轮围绕 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 做只读复核后，完成数维持 `10 / 23`，本轮不新增勾选。
- `explanation / recommendation / remaining steps` 这组三个方向的结构化实现与测试证据已经充分，而且已被前述勾选覆盖：`shared/mission/autopilot.ts` 直接构建 `explanation.currentState / recommendationDetails / remainingSteps`，`shared/__tests__/mission-autopilot.test.ts` 直接断言 builder 输出，`server/tests/mission-routes.test.ts` 断言 projection 透传，`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 再断言 normalize 与展示。
- `confidence` 当前有直接实现，但实现形态仍是“摘要”而不是 spec 中的结构化 `ConfidenceExplanation`：`shared/mission/autopilot.ts` 直接产出 `destination.confidence` 与 `driveState.confidence`，`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 也已直接覆盖归一化与展示；但代码里仍没有多维度 `goalUnderstanding / routeFeasibility / executionCompletion / resultQuality / evidenceSufficiency`、`changedReason` 与 `thresholdAction` 这组对象字段，因此不能据此勾选“定义 `ConfidenceExplanation`”。
- `risk` 当前也有直接实现，但仍停留在 `route.riskPoints`、`explanation.riskSummary`、`recovery` / `takeover` 摘要这一层：`shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 都已经命中这些字段；但现状仍缺少结构化 `RiskExplanation` 所要求的 `riskType / severity / trigger / impact / mitigation / mayTriggerTakeover / mayTriggerReplan`，所以不能把“定义 `RiskExplanation`”写成完成。
- `evidence hints` 当前已经形成“提示字符串 + 证据索引”的最小闭环，但还不是结构化 `EvidenceHint`：`shared/mission/autopilot.ts` 会同时产出 `explanation.evidenceHints` 与 `evidence.trustLevel / gaps / timeline / correlation`，server/client/panel 测试都已直接命中 `trustLevel`、`gaps`、时间线与关联索引；但代码中仍没有 `evidenceType / evidenceTitle / evidenceRef / freshness` 这类结构化 `EvidenceHint` 对象，因此本轮也不能新增该项勾选。
- `MissionAutopilotExplanationSource` 目前只覆盖 `mission-runtime / workflow-runtime / route-planner / recovery-engine / takeover-state / combined-inference`，而且测试也只直接命中这些来源；它还没有扩展到 spec 要求的 `audit entry / replay snapshot / frontend view model` 全口径，因此“设计 `ExplanationSource` 口径”仍应保持未勾选。
- 这一轮最需要收紧的边界是：现有实现已经足以支撑“任务详情页上的结构化 explainability 摘要消费”，但还不足以外推为“完整 explainability 对象体系”或“risk / confidence / evidence hints 已经全部结构化”。因此，本轮只补充中文审计备注，不新增 checkbox。

## 审计备注（2026-04-25，指定文件范围 explainability 复核）

- 本轮按指定范围复核 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/mission/index.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskDetailView.tsx` 与 `client/src/components/tasks/DecisionPanel.tsx` 后，完成数维持 `10 / 23`，不新增勾选。
- `shared/mission/autopilot.ts` 联合 `shared/__tests__/mission-autopilot.test.ts` 已经能直接证明三类结构化 explainability 合同成立并有测试锚点：`CurrentStateExplanation`、`RecommendationReason`、`RemainingStepsExplanation`；`shared/mission/api.ts` 与 `shared/mission/index.ts` 也把这些类型稳定透出到 barrel/export 层。
- `server/tasks/mission-projection.ts` 联合 `server/tests/mission-routes.test.ts` 已经能直接证明 mission projection 会复用并透传 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals`，同时校准 `bindings` 与 `evidence.correlation`；这足以支撑 shared -> server projection 契约已成型，但还不足以支撑“驾驶舱 / 接管面板 / replay / audit 统一复用入口已完成”。
- `client/src/lib/tasks-store.ts` 当前确实会归一化并保留 `explanation.currentState`、`recommendationDetails`、`remainingSteps` 与 `evidence.correlation`，说明 client 侧不再只是扁平字符串兜底；但同一个 normalize 结果里，`riskSummary / evidenceHints / telemetrySignals` 仍主要以字符串数组继续向下游流动，并没有升格为结构化 `RiskExplanation`、`ConfidenceExplanation`、`EvidenceHint` 或 `RuntimeSignalSummary` view model。
- `client/src/components/tasks/TaskDetailView.tsx` 在本轮指定范围内只能证明“任务详情页把 `TaskAutopilotPanel` 接线到 overview / cockpit 视图”，它自身并不直接读取或组装 explainability contract；因此不能把它当成第二个独立 explainability consumer，更不能据此外推为驾驶舱、接管面板、replay、audit 已共享同一套 explainability 复用模型。
- `client/src/components/tasks/DecisionPanel.tsx` 的职责仍是 `MissionDecision` / HITL param collection 的提交入口：它围绕 `decision.options`、`decision.payload`、`submitMissionDecision()` 组织人工决策表单，但并不读取 `autopilotSummary.explanation`、`riskSummary`、`evidenceHints`、`telemetrySignals` 或 `evidence.correlation`；因此它不能作为本 spec 中的 explainability / telemetry consumer，也不足以支撑“第二阶段服务端 projection 接入方案”或“接管面板 explainability 复用”勾选。
- 基于这组指定文件，本轮仍不能新增以下任务勾选：`RiskExplanation`、`ConfidenceExplanation`、`EvidenceHint`、实时状态信号目录、`ExplanationSource` 全口径、`ExplanationRelatedRefs`、第二阶段服务端 projection 复用、第三阶段 runtime events 增强、第四阶段 replay / audit 闭环与补充测试计划。原因一致：当前直接代码 + 直接测试证据仍集中在 summary/projection/task-detail 这条最小链路，尚未扩展到结构化风险/置信/证据对象与跨面复用闭环。

## 审计备注（2026-04-25，指定文件范围 explainability 三次复核）

- 本轮按最新指定范围重新核对 `shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 与 `client/src/components/tasks/TaskDetailView.tsx` 后，完成数继续维持 `10 / 23`，本轮不新增勾选。
- 这轮能再次直接坐实的仍是同一条最小 explainability 链路：`shared/mission/autopilot.ts` 负责生成 `currentState / recommendationDetails / remainingSteps / riskSummary / evidenceHints / telemetrySignals`，`server/tasks/mission-projection.ts` 负责把它们放进 `autopilotSummary` 并对齐 `bindings / evidence.correlation`，`client/src/lib/tasks-store.ts` 负责 normalize，`TaskAutopilotPanel.tsx` 负责在任务详情页展示，且上述每一段都有对应测试命中。
- 但是，`实时状态信号目录` 这一项仍不能补勾：当前主仓里被直接代码和直接测试稳定命中的，主要是 `route.recommended / route.selected / route.replanned` 这组路线证据事件，以及 `telemetrySignals` 中的摘要字符串如 `mission.status:* / drive.state:* / recovery.state:*`；还没有独立的结构化高层信号合同去覆盖 spec 里要求的 `takeover.requested / takeover.resolved / risk.changed / confidence.changed / evidence.updated / runtime.health_changed` 全目录。
- `ExplanationSource` 这一项也仍不能补勾：`MissionAutopilotExplanationSource` 当前只稳定落地并被测试命中的来源是 `mission-runtime / workflow-runtime / route-planner / recovery-engine / takeover-state / combined-inference`；它还没有扩展到任务要求中的 `audit entry / replay snapshot / frontend view model` 全口径，因此不能把现状写成“来源口径设计已完成”。
- `ExplanationRelatedRefs` 这一项同样还差关键结构：当前直接可证实的是 `evidence.correlation` 已包含 `workflowId / replayId / sessionId / routeIds / runtimeEventIds / decisionIds / operatorActionIds / auditEventIds / lineageIds`，并被 store / panel 测试直接消费；但仍没有一份独立的 `ExplanationRelatedRefs` 对象合同去统一覆盖 spec 要求的 `workflow instance / step / node / artifact` 等引用维度，因此不能新增该项勾选。
- `第二阶段服务端 projection 接入方案` 仍不能补勾：这轮指定文件中，`server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 只能证明 mission projection 已把 explainability summary 稳定送到任务详情链路；`TaskDetailView.tsx` 也只能证明 `TaskAutopilotPanel` 被接到了 overview / cockpit 视图。它们还不能证明接管面板、replay、audit 已经消费同一套 explainability projection，更不能证明跨面复用入口已经成立。
- `RiskExplanation / ConfidenceExplanation / EvidenceHint` 三项仍继续保持未勾选：当前实现和测试能直接命中的仍是 `route.riskPoints + explanation.riskSummary`、`destination.confidence / driveState.confidence`、`explanation.evidenceHints + evidence.trustLevel / gaps / timeline / correlation` 这类摘要或索引级字段；代码里依然没有 spec 所要求的结构化 `riskType / severity / trigger / impact / mitigation`、多维度 `ConfidenceExplanation.dimensions`、以及 `EvidenceHint.evidenceType / evidenceTitle / evidenceRef / freshness` 对象合同。

## 审计备注（2026-04-25，Lane 3 结构化 explainability 设计收口）

- 本轮仅在 `design.md` 与 `tasks.md` 中推进 explainability 设计收口，不触碰代码文件；在这种前提下，可以安全新增勾选的范围限定为“纯设计口径已直接结构化收口”的任务，完成数由 `10 / 23` 推进到 `21 / 23`。
- 本轮新增可勾选的直接依据如下：
  - `AutopilotExplanation`：已补齐基础骨架，并显式定义 `ConfidenceSummary / RiskSummary / SuggestedAction`，同时写明与当前 `MissionAutopilotExplanationSummary` 的兼容扩展策略；
  - `RiskExplanation / ConfidenceExplanation / EvidenceHint`：已补齐结构化字段、与当前 shared `riskSummary / destination.confidence / driveState.confidence / evidence.trustLevel / gaps / correlation` 的兼容映射，以及第二阶段 projection 如何上卷这些摘要字段；
  - `实时状态信号目录`：已把 spec 要求的 11 类高层信号整理为“当前事实来源 + 当前稳定承载字段 + 第二/三阶段增强方向”的结构化目录，并明确哪些应直接复用现有 `route.recommended / route.selected / route.replanned` 证据；
  - `ExplanationSource / ExplanationRelatedRefs`：已补齐目标字段，并直接写出与当前 `MissionAutopilotExplanationSource`、`evidence.correlation` 的映射与收口原则；
  - `第二阶段服务端 projection 接入方案`：已明确保持 `MissionAutopilotSummary.explanation` 为唯一入口、继续兼容旧摘要字段、通过可选扩展槽位增加 `risks / confidence / evidenceDetails / relatedRefs / signals`，并给出 consumer 复用顺序与边界；
  - `第三阶段 runtime events 增强方案`：已拆成 `projection-diff path` 与 `bridge-derived path` 两条增强路径，并明确哪些高层信号应复用现有 route evidence，哪些应由 projection/bridge 补齐；
  - `第四阶段 replay / audit 闭环方案`：已写清 replay 与 audit 各自的最小落点、失效规则与 refs 要求；
  - `测试计划`：已按 shared builder / server projection / client normalize / consumer / replay & audit 五层补出覆盖矩阵。
- 本轮仍明确不能勾选的 2 项如下：
  - `梳理高风险解释进入 audit 的规则`
    - design 中虽然已给出第四阶段 audit 闭环方案，但这条任务要求的是“规则梳理”本身要足够细到权限、预算、合规、外部副作用、风险接受、路线切换与重规划的逐项落库准则；当前文档仍停留在分层方案与最小落点，没有展开成可逐项核对的治理规则表。
  - `梳理 replay 需要复原的解释时间线内容`
    - 当前 design 已写 replay 闭环目标与最小落点，但还没有把“当前状态、推荐原因、风险、置信度、剩余步骤、接管提示、证据提示”逐项拆成完整时间线槽位、排序规则、superseded/resolved 版本关系与最小必备字段矩阵。
- 以下 2 项此前已完成，本轮保持不变，不计入“新增勾选”数量：
  - `设计第一阶段前端接入方案`
  - `评估哪些解释可以先由前端 view model 推导，哪些必须优先进入服务端 projection、replay 或 audit`
- 本轮新增勾选必须继续收紧边界：这些勾选仅代表“设计文档已把对象、字段、兼容映射、阶段方案和测试矩阵收口完整”，不代表主仓代码已经实现了结构化 `RiskExplanation / ConfidenceExplanation / EvidenceHint / RuntimeSignalSummary`，也不代表 replay / audit / takeover consumer 已完成复用。

## 审计备注（2026-04-25，指定证据链代码审计）

- 本轮按指定证据链重新核对 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 后，未新增 checkbox，当前剩余未勾项继续保持 `2 / 23` 中的这两项未完成状态。
- 第一条未勾项 `梳理高风险解释进入 audit 的规则，包括权限、预算、合规、外部副作用、风险接受、路线切换与重规划` 仍不能保守补勾：
  - `shared/mission/autopilot.ts` 与 `shared/__tests__/mission-autopilot.test.ts` 只能直接证明 `evidence.correlation.auditEventIds`、`lineageIds` 会从 decision payload/history 中提取并进入 summary；
  - `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 只能直接证明这些 audit correlation ids 会继续透传到 mission projection；
  - `client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`TaskAutopilotPanel.tsx` 与其测试也只消费了 `evidence.correlation`、`trustLevel / gaps / timeline` 这一层索引和提示。
  - 但当前直接代码与直接测试都没有形成一张“高风险解释进入 audit 的规则表”或等价实现矩阵，尚未逐项覆盖权限、预算、合规、外部副作用、风险接受、路线切换与重规划这几类治理条件的落库规则、触发条件与必备字段，因此本项继续不勾。
- 第二条未勾项 `梳理 replay 需要复原的解释时间线内容，包括当前状态、推荐原因、风险、置信度、剩余步骤、接管提示与证据提示` 也仍不能保守补勾：
  - `shared/mission/autopilot.ts` 已直接构建 `evidence.timeline`、`explanation.currentState`、`recommendationDetails`、`remainingSteps`，`shared/__tests__/mission-autopilot.test.ts` 已断言这些 builder 输出；
  - `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 已证明 mission projection 会把 `timeline / currentState / recommendationDetails / remainingSteps / evidenceHints` 一并透传；
  - `client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `TaskAutopilotPanel.tsx` 也已证明任务详情页能归一化并展示这组 explainability 摘要。
  - 但现有直接证据仍只说明“已有时间线片段和 explainability 摘要可被展示”，并没有一份 replay 专用的解释时间线复原矩阵去逐项定义当前状态、推荐原因、风险、置信度、剩余步骤、接管提示、证据提示的排序规则、版本关系、缺失处理和最小必备字段，因此本项继续不勾。
- 本轮能继续直接确认的安全边界是：当前主仓已经具备 shared -> server projection -> client normalize -> task detail panel 的 explainability 最小闭环，并且 `auditEventIds / lineageIds` 与 `timeline / correlationTimelineId` 这类 replay/audit 锚点已经存在；但这些锚点仍不足以等同于“audit 规则已经梳理完成”或“replay 解释时间线内容已经梳理完成”。

## 审计备注（2026-04-26，Lane 5 explainability 规则收口）

- 本轮仅在 `requirements.md / design.md / tasks.md` 中继续推进纯设计收口，不改代码文件；在这种前提下，剩余 `2` 项任务可以按“设计规则已达到可逐项核对颗粒度”保守勾选，完成数由 `21 / 23` 推进到 `23 / 23`。
- 第一项 `梳理高风险解释进入 audit 的规则` 本轮已具备直接设计依据：
  - `requirements.md` 已新增验收要求，明确高风险解释进入 audit 的规则至少覆盖 `权限 / 预算 / 合规 / 外部副作用 / 风险接受 / 路线切换 / 重规划` 七类触发器，并要求给出最小字段集合；
  - `design.md` 已新增“高风险解释进入 audit 的规则矩阵”，逐项定义 `典型触发器 / audit 落点 / 最小必备字段 / 备注`，同时区分 `direct_audit_record` 与 `audit_link_required` 两种规则路径；
  - 该矩阵也已把当前主仓真实边界写清楚：现有直接代码证据更偏向 `audit_link_required` 所需锚点，例如 `evidence.correlation.auditEventIds`、`human.decision_submitted`、runtime control event mirrored into audit，与 mission projection 对这些 refs 的透传。
- 第二项 `梳理 replay 需要复原的解释时间线内容` 本轮也已具备直接设计依据：
  - `requirements.md` 已新增验收要求，明确 replay 解释复原规则必须定义 `current_state / recommendation / remaining_steps / risk / confidence / takeover / evidence_update / replan_change` 这 8 类时间线槽位，并补齐排序、版本失效与缺失回退口径；
  - `design.md` 已新增“replay 解释时间线复原矩阵”，逐项定义 `复原内容 / 最小来源 / 最小字段 / 排序锚点 / 缺失回退`；
  - 同时写清了 `active / superseded / resolved` 的版本规则，以及当前主仓只具备 `evidence.timeline`、`explanation.currentState / recommendationDetails / remainingSteps`、`evidence.correlation.timelineId / auditEventIds` 与 runtime observability bridge 这些最小锚点。
- 本轮勾选边界必须继续收紧：
  - 这两项完成仅代表“规则与矩阵已在 spec 中收口完整，可逐项核对”，不代表主仓代码已经实现了高风险 explainability 审计写入器或 replay explainability 时间线 consumer；
  - 当前代码事实仍然主要停留在 `shared builder -> mission projection -> tasks-store -> TaskAutopilotPanel` 的最小闭环，以及 `evidence.timeline / correlation / auditEventIds` 这类 replay/audit 锚点；
  - 因此这里是“设计闭环完成”，不是“实现闭环完成”。
