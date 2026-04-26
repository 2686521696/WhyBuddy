# 任务清单：Mission 模型到任务自动驾驶模型映射

- [x] 梳理当前主仓中 `Mission` 的核心字段、状态和上下文来源，形成到 `Destination` 的字段映射表
- [x] 梳理当前主仓中 `Workflow` 的定义结构、阶段语义、分支与并行能力，形成到 `Route` 的映射表
- [x] 梳理当前运行时中的实例状态、节点状态、等待输入状态、复核状态，形成到 `Drive State` 的高层状态归并规则
- [x] 梳理当前 `Decision / HITL / approval / resume` 链路，形成统一的 `Takeover` 对象定义
- [x] 定义 `Destination` 的最小展示结构，包括目标、约束、成功标准、缺失信息、预期交付物
- [x] 定义 `Route` 的最小展示结构，包括主路线、可替代路线、阶段、风险点、接管点
- [x] 定义 `Drive State` 的最小状态集合与状态切换说明
- [x] 定义 `Takeover` 的最小类型集合，包括澄清、确认、审批、权限、预算、验收、异常接管
- [x] 明确哪些映射可以在服务端 projection 层完成，哪些更适合在前端 view model 层完成
- [x] 输出一版“兼容优先”的迁移原则说明，明确不建议立即大规模底层改名
- [x] 为 README、架构图、驾驶舱 IA 后续更新准备统一术语表
- [x] 补充一版面向 Web-AIGC 节点体系的附录，说明节点如何被重新包装为路线阶段或车队角色
- [x] 识别现有 API、测试、运行时实现中对旧命名的强依赖，形成后续改造风险清单
- [x] 评估 `Destination / Route / Drive State / Takeover` 四类投影对象的最小落地顺序
- [x] 为后续 spec 提供依赖说明，明确与驾驶舱、路线推荐、接管面板、运行时投影等 spec 的边界关系

## 审计备注（2026-04-25）

- 第 1 项继续保守不勾选：`shared/mission/autopilot.ts` 与 `shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts` 已证明 `Destination` 最小字段级投影落地，但尚不足以证明“Mission 核心字段、状态、上下文来源”已经完成完整梳理与总表化。
- 第 2 项继续保守不勾选：当前代码与测试已覆盖 `Route` 的最小投影、候选路线、选择状态、证据和重规划，但尚未形成对 `Workflow definition / branching / parallel groups` 的完整审计表。
- 第 12 项继续保守不勾选：目前只看到 `sourceApp: web-aigc` 等链路透传证据，尚无“节点 -> 路线阶段 / 车队角色”的正式附录与直接测试。
- 第 13 项本轮补勾：`shared/mission/api.ts`、`shared/mission/index.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 及对应测试，已经能直接证明旧命名在 API、shared contracts、server projection、client store 与 UI 壳层中的强依赖。

## 审计备注（2026-04-25，lane 推进补充）

- 本轮没有新增安全勾选；原因不是文档没有推进，而是这 3 个剩余任务的措辞都明显要求“完整映射表/完整附录”，而当前主仓真实实现仍只支撑“最小映射表/首版兼容附录”。
- 第 1 项已新增一版“当前主仓最小字段映射表”：`design.md` 现在已经明确 `mission.id / title / sourceText / kind / projection.sourceApp / securitySummary.level / artifacts / workPackages / waitingFor / blocker / decision` 等事实如何进入 `destination`。但这仍未覆盖 `MissionRecord` 的完整核心字段、状态与上下文来源总表，因此继续保守不勾选。
- 第 2 项已新增一版“当前主仓最小映射表”与“Workflow / Runtime / Decision 联合映射表”：`design.md` 现在已经明确 `mission.stages / currentStageKey / projection.workflowId / decision / decisionHistory / operatorActions / blocker` 如何共同形成 `route`。但任务原文要求覆盖 `Workflow` 的定义结构、分支与并行能力；当前仓库对这些部分仍缺少完整结构审计，因此继续保守不勾选。
- 第 12 项已新增“Web-AIGC 节点兼容附录（首版）”：文档已经明确 `WEB_AIGC_HITL_NODE_TYPES`、`WebAigcHitlSubmissionMetadata`、`DecisionHistoryEntry`、`sourceApp: web-aigc` 等事实如何被当前 mapping 层吸收，并重新包装成 `Takeover / Route selection / Destination constraints`。但任务原文要求说明节点如何被重新包装为“路线阶段或车队角色”；当前直接实现与测试仍不足以支撑逐节点到路线阶段/车队角色的正式映射，因此继续保守不勾选。
- 以本轮最新结论为准：这份 spec 现在已经比上一版更接近文档收口，但剩余 3 项仍属于“已有最小版本、尚未达到任务原文要求的完整度”。

## 审计备注（2026-04-26）

- 第 1 项本轮补勾。依据是 `design.md` 已新增“Mission 核心字段、状态与上下文来源映射总表（首版，2026-04-26）”，并且这张表可以直接回指到 `shared/mission/autopilot.ts` 的 `destination` builder：
  - `buildConstraints()` 覆盖 `mission.kind / projection.sourceApp / securitySummary.level`
  - `buildSuccessCriteria()` 覆盖 `mission.summary / artifacts / status`
  - `buildDeliverables()` 覆盖 `mission.artifacts`
  - `buildMissingInfo()`、`buildMissingInfoDetails()` 覆盖 `waitingFor / operatorState / blocker / decision.type`
  - `buildDestinationConfidence()` 覆盖 `summary / sourceText / events / waitingFor / blocker / decision.prompt`
  - `buildMissionAutopilotSummary()` 直接落地 `destination.id / goal / request / constraints / successCriteria / deliverables / missingInfo / confidence / missingInfoDetails`
- 第 1 项本轮之所以可以安全勾选，是因为任务原文要求的是“核心字段、状态和上下文来源”的映射表，而不是 `MissionRecord` 全字段穷尽总表。文档现在已经明确写出哪些字段已进入、哪些字段未进入 `Destination`，满足保守口径下的“首版总表”。

- 第 2 项本轮补勾。依据是 `design.md` 已新增“Workflow 定义结构、阶段语义、分支与并行能力映射表（首版，2026-04-26）”，并且这张表能被当前仓库中的多类事实直接支撑：
  - `MissionProjectionLinks.workflowId`、`buildMissionAutopilotSummary().route.id`、`MissionProjectionView.bindings.workflowId`
  - `mission.stages[] / currentStageKey` 对 `route.stages[] / route.currentStageKey / route.currentStageLabel` 的直接投影
  - `decision.payload.candidateRoutes / routeMap / formData` 对 `candidateRoutes / selection / recommendedRouteId / selectedRouteId` 的直接投影
  - `mission.operatorActions / attempt / blocker` 对 `route.replan / route.evidence / selectionStatus = replanned` 的直接投影
  - `shared/workflow-graph.ts` 与 `server/core/workflow-graph-projection.ts` 已提供 `nodeRuns / edgeTransitions / currentStage / telemetry` 等 workflow graph 结构术语锚点
  - `server/tests/workflow-runtime-engine.test.ts` 已直接证明 `selection / confirm_judge / param_collection` 的等待、恢复、conditional edge、branchKey 与表单语义确实存在
- 第 2 项本轮之所以可以安全勾选，是因为任务原文要求的是“形成到 Route 的映射表”，而不是“完成 workflow definition 全量建模审计”。文档现在已经明确写出 identity、stage、branch、parallel、graph、decision、runtime 在 Route 叙事中的职责与边界，达到首版映射表的要求。

- 第 12 项本轮补勾。依据不是“逐节点实现已经落地”，而是这项任务原文要求的是“补充一版附录，说明节点如何被重新包装为路线阶段或车队角色”。`design.md` 现已新增：
  - Web-AIGC 节点兼容附录中的“节点家族 -> 路线阶段 / 车队角色的首版包装矩阵”
  - 对 `MissionDecisionSubmission.metadata / MissionDecisionResolved.metadata / DecisionHistoryEntry / sourceApp: web-aigc / runtime tests(selection / confirm_judge / param_collection)` 的直接锚点说明
  - 与 `.kiro/specs/fleet-organization-and-role-packaging/` 中“节点家族到角色家族初步分类表”和“路线阶段驱动角色启停矩阵”的对齐说明
- 第 12 项本轮之所以可以安全勾选，是因为：
  - 当前文档已经能够说明“节点家族”如何先被吸收到 `Mission / Decision / Route / Takeover`，再被包装到 `Route stage / Fleet role`
  - 任务原文并没有要求完成 50+ 节点逐节点正式目录
  - 文档同时明确保留了未完成边界：仍未形成逐节点、逐运行态、shared/server 稳定投影级别的正式 mapping 目录

## 审计备注（2026-04-26，Web-AIGC 节点附录收口）

- 第 12 项本轮按保守标准补勾，但勾选语义严格限定为“节点家族级首版附录完成”：
  - `requirements.md` 已把验收口径收紧为“节点家族 -> 路线阶段 / 车队角色”的粗粒度包装矩阵
  - `design.md` 已补齐这张首版矩阵，并明确当前包装路径仍然是：
    - 节点事实
    - `Mission / Decision / Route / Takeover`
    - `Route stage / Fleet role` 产品语义
  - `design.md` 同时明确写出这不是“50+ 节点逐节点产品目录”，也不是“shared/server 已稳定产出逐节点 role/stage 投影”
- 因此，这里的完成是“文档附录已达到任务原文要求”，不是“节点产品化落地已完成”。
