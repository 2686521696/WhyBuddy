# 任务清单：任务自动驾驶恢复机制与人工接管治理

## 任务

- [x] 1. 定义恢复与接管治理契约层
  - [x] 1.1 定义 `DeviationEvent` 契约，覆盖偏航、失败、阻塞与恢复耗尽分类。
  - [x] 1.2 定义 `DeviationCategory`、触发来源和严重级别枚举。
  - [x] 1.3 定义 `RecoveryStrategy`、`RecoveryStrategyType` 与 `RecoveryImpact` 契约。
  - [x] 1.4 定义 `RecoveryAttempt` 契约，记录恢复尝试、治理判定和执行结果。
  - [x] 1.5 定义恢复场景下的 `RecoveryDecisionPoint` 与选项结构。
  - [x] 1.6 定义恢复相关事件与现有 `Drive State`、`Takeover Point` 的映射字段。

- [x] 2. 梳理偏航检测信号来源
  - [x] 2.1 梳理 runtime 侧失败、超时、重试耗尽、执行器不可用等真实信号来源。
  - [x] 2.2 梳理 `review / verify / revise` 侧可触发恢复的真实信号来源。
  - [x] 2.3 梳理 `audit / runtime governance` 侧预算、权限、风险、外部副作用命中信号。
  - [x] 2.4 梳理用户手动反馈、人工改线、目标变更等人工触发信号。
  - [x] 2.5 定义强触发、弱触发和多信号叠加升级规则。

- [x] 3. 设计偏航检测与恢复分类器
  - [x] 3.1 设计 `DeviationDetector` 的输入、输出与事件投影方式。
  - [x] 3.2 定义 `goal_deviation`、`route_deviation`、`quality_deviation` 的识别规则。
  - [x] 3.3 定义 `governance_deviation`、`dependency_failure`、`state_block` 的识别规则。
  - [x] 3.4 定义 `recovery_exhausted` 的判定条件与升级规则。
  - [x] 3.5 明确检测结果如何映射到 `blocked / takeover-required / replanning`。

- [x] 4. 设计恢复策略规划器
  - [x] 4.1 设计 `RecoveryCoordinator` 的总体流程。
  - [x] 4.2 定义从局部重试到异常升级的恢复层级顺序。
  - [x] 4.3 定义不同异常类型的首选、次选和禁止策略矩阵。
  - [x] 4.4 区分普通 `retry`、`revise`、`replan` 与正式恢复动作的边界。
  - [x] 4.5 定义恢复动作的退出条件、放弃条件与升级条件。

- [x] 5. 设计自动恢复机制
  - [x] 5.1 定义节点级重试、替代执行器切换的触发与上限。
  - [x] 5.2 定义从快照或稳定检查点恢复的最小能力。
  - [x] 5.3 定义跳过非关键步骤继续执行的准入条件。
  - [x] 5.4 定义局部自动恢复失败后进入下一层恢复的规则。
  - [x] 5.5 定义自动恢复记录如何进入 replay / audit / evidence。

- [x] 6. 设计降级执行机制
  - [x] 6.1 定义模型降级、路线降级、权限降级和范围降级的能力边界。
  - [x] 6.2 定义降级前的治理校验项。
  - [x] 6.3 定义降级对时间、成本、质量、风险和自动化程度的影响表达。
  - [x] 6.4 定义禁止静默降级的高风险场景。
  - [x] 6.5 定义降级执行与现有 cost governance、permission governance、runtime governance 的对接方式。

- [x] 7. 设计人工接手与人工确认机制
  - [x] 7.1 明确“人工确认后继续”和“人工直接接手”的语义区别。
  - [x] 7.2 定义按 `step / stage / route / mission` 的接手范围模型。
  - [x] 7.3 设计恢复场景下的接手选项，如继续、降级、改线、升级、终止。
  - [x] 7.4 定义哪些恢复动作必须要求评论或责任确认。
  - [x] 7.5 定义人工接手完成后如何回到自动链路继续。

- [x] 8. 设计与现有 HITL / decision / wait-resume 的兼容层
  - [x] 8.1 将恢复决策点映射到现有 `Takeover Point` 类型。
  - [x] 8.2 将恢复选项映射到现有 `MissionDecision` 类型与 payload。
  - [x] 8.3 复用 `submitMissionDecision()` 的幂等提交流程。
  - [x] 8.4 定义恢复后继续如何映射到 `resume()`、orchestrator 继续或 `replan`。
  - [x] 8.5 定义异常升级如何映射到 `escalate()`。

- [x] 9. 设计与 review / audit / revise / verify 的闭环兼容
  - [x] 9.1 定义 `review` 失败进入恢复或 revise 的策略。
  - [x] 9.2 定义 `verify` 失败进入恢复、接管或终止的策略。
  - [x] 9.3 定义 `revise` 成功后返回 `reviewing` 或 `executing` 的路径。
  - [x] 9.4 定义 `audit` 命中治理问题后进入接管或升级的规则。
  - [x] 9.5 统一质量失败与运行失败在时间线中的表达方式。

- [x] 10. 设计与 runtime governance 的治理对接
  - [x] 10.1 定义恢复动作需要检查的治理维度：重试预算、成本、权限、风险、外部副作用、自动化等级。
  - [x] 10.2 设计 `allowed / denied / needs_takeover / needs_escalation` 的治理判定结果。
  - [x] 10.3 定义治理命中后的默认控制面：阻断、建议接管、必须接管或升级。
  - [x] 10.4 定义恢复动作对自动驾驶等级降级的影响。
  - [x] 10.5 定义治理判断与恢复动作如何进入审计链。

- [x] 11. 设计异常升级机制
  - [x] 11.1 定义自动恢复耗尽、风险过高、权限越界、外部副作用等升级触发条件。
  - [x] 11.2 定义升级前必须保留的上下文、证据与人工评论。
  - [x] 11.3 定义升级后任务是冻结、等待更高权限接手还是终止。
  - [x] 11.4 定义异常升级与现有人工值守、治理审批或终止控制面的关系。
  - [x] 11.5 定义升级失败或无人接手时的兜底策略。

- [x] 12. 设计恢复状态机与 Drive State 映射
  - [x] 12.1 定义偏航检测、恢复执行、等待接手、重新规划和恢复完成的高层状态流。
  - [x] 12.2 明确 `blocked`、`takeover-required`、`replanning` 的边界。
  - [x] 12.3 明确恢复后继续回到 `executing`、`reviewing` 或 `delivered` 的条件。
  - [x] 12.4 设计恢复状态如何被服务端事件或投影层重建。
  - [x] 12.5 与现有 `Drive State` spec 做术语和迁移条件对齐。

- [x] 13. 设计恢复记录、回放与审计
  - [x] 13.1 定义 `RecoveryAttemptLedger` 的最小字段和保留策略。
  - [x] 13.2 设计 replay 时间线中偏航、恢复、接手、升级事件的展示语义。
  - [x] 13.3 设计 audit 中高风险恢复、降级、人工批准与终止事件的记录方式。
  - [x] 13.4 定义恢复事件与 Route、Mission、Workflow、Runtime Event 的关联键。
  - [x] 13.5 定义默认自动恢复为何被允许的证据表达。

- [x] 14. 设计前端展示与驾驶舱接入
  - [x] 14.1 设计任务详情中恢复状态、恢复历史与当前接手点的展示区域。
  - [x] 14.2 设计驾驶舱中偏航、恢复中、等待接手、升级中的状态提示。
  - [x] 14.3 设计恢复决策面板中的推荐动作、已尝试动作与影响说明。
  - [x] 14.4 设计降级执行的差异展示与风险提示。
  - [x] 14.5 设计“不接手会发生什么”的提示表达。

- [x] 15. 设计服务端投影与持久化
  - [x] 15.1 定义恢复事件和恢复尝试如何进入 Mission 快照或等价持久化层。
  - [x] 15.2 定义服务重启后恢复中的任务如何重新 attach 恢复上下文。
  - [x] 15.3 定义恢复记录如何与现有 `decisionHistory`、任务历史和 audit 关联。
  - [x] 15.4 定义恢复中的任务在重连、刷新、重启后的最小继续保证。
  - [x] 15.5 定义历史恢复记录的查询接口或投影接口。

- [x] 16. 补齐测试与验证策略
  - [x] 16.1 设计偏航检测、恢复层级选择与治理判定的单元测试。
  - [x] 16.2 设计自动恢复、降级执行、人工接手、异常升级的集成测试。
  - [x] 16.3 设计 `review / audit / revise / verify` 进入恢复闭环的回归测试。
  - [x] 16.4 设计 replay / audit 能重建恢复时间线的验证用例。
  - [x] 16.5 设计服务重启、页面刷新、socket 重连后的恢复继续验证。

- [x] 17. 制定灰度与落地计划
  - [x] 17.1 制定第一阶段只做语义与事件投影的落地范围。
  - [x] 17.2 制定第二阶段接入接管面板与决策桥接的落地范围。
  - [x] 17.3 制定第三阶段接入驾驶舱、replay、audit 的落地范围。
  - [x] 17.4 制定自动恢复阈值、降级阈值和升级阈值的灰度策略。
  - [x] 17.5 制定回滚方案，确保新治理逻辑不会破坏现有任务链路。

## 审计备注（2026-04-24）

- 当前 shared `MissionAutopilotRecoverySummary`、`MissionAutopilotDeviationCategory`、`inferMissionAutopilotDriveState()` 与 `buildRecoverySummary()` 已把恢复态、偏航分类和高层 `Drive State` 的最小映射固化到 autopilot 读模型中。
- `shared/__tests__/mission-autopilot.test.ts` 已覆盖 waiting budget approval、blocked retry、failed/blocked 恢复摘要与 `blocked / takeover-required / replanning / reviewing` 等高层状态边界。
- `server/tests/mission-routes.test.ts` 已验证 mission projection 在 waiting / retry-replan 场景下透出 `autopilotSummary.recovery`、解释摘要与 `orchestration.wait / replan`。
- `server/tests/mission-operator-actions.test.ts` 已验证 blocked mission 可通过 `resume` 回到 active，failed mission 可通过 `escalate` 进入 blocked human follow-up。
- `server/tests/workflow-runtime-engine.test.ts` 已验证 `WAITING_INPUT -> resume()`、人工 review checkpoint、`instance.escalated`、自动/手动 retry budget 耗尽与 auto-escalate。
- `server/tests/web-aigc-runtime-observability.test.ts` 已验证 `node.waiting_input`、`node.failed`、`instance.retry_requested`、`instance.escalated`、`instance.terminated` 会镜像进入 replay / audit。
- `server/tests/hitl-decision.test.ts`、`server/core/mission-orchestrator.ts` 与 `server/tasks/mission-runtime.ts` 已共同覆盖 `submitMissionDecision() / submitDecision()` 之后进入 `resolveWaiting`、mission resumed、下一决策链与历史记录归档的主线。

上一轮续审结论（2026-04-24，lane 1）：

- 本轮继续复核 `recovery state / escalation / replay-audit reconstruction / operator actions / mission runtime / workflow runtime / observability / HITL decision` 后，未新增安全可勾选项，done/total 维持 `11 / 103`。
- `10.3` 仍不能勾：当前只有 `allowed / denied / needs_takeover / needs_escalation` 的结果锚点，还没有统一默认控制面策略，明确把治理命中分派为“阻断 / 建议接管 / 必须接管 / 升级”。
- `11.2` 仍不能勾：`terminate()`、`escalate()`、decision audit 虽保留部分 `requestedBy / reason / governance / decisionId`，但没有统一测试去约束“升级前必须保留哪些上下文、证据与人工评论”。
- `12.3` 仍不能勾：现有 shared drive-state 推断能把状态投影到 `executing / reviewing / delivered` 一侧，但没有把“恢复后回到这些状态的条件”作为 recovery contract 单独封口。
- `13.3` 仍不能勾：runtime observability 已镜像 escalate / terminate / retry 事件，但 audit 侧尚未形成“高风险恢复 / 降级 / 人工批准 / 终止”的统一记录方式；尤其 `degrade` 仍停留在设计层。
- `15.3` 仍不能勾：`decisionHistory`、projection correlation、replay / audit metadata 已共存，但 `auditEventIds` 仍为空，尚未形成正式的“恢复记录 <-> decisionHistory / 任务历史 / audit”关联模型。

基于以上直接代码与测试，本轮保守新增勾选：

- `7.5` 人工接手完成后如何回到自动链路继续
- `8.4` 恢复后继续如何映射到 `resume()`、orchestrator 继续或 `replan`
- `12.4` 恢复状态如何被服务端事件或投影层重建
- `10.2` `allowed / denied / needs_takeover / needs_escalation` 的治理判定结果
- `10.5` 治理判断与恢复动作如何进入审计链
- `13.2` replay 时间线中偏航、恢复、接手、升级事件的展示语义
- `11.3` 升级后任务是冻结、等待更高权限接手还是终止
- `16.4` replay / audit 能重建恢复时间线的验证用例

本轮仍未勾选的大部分项，原因是当前主仓虽然已有最小恢复摘要、等待/恢复/升级事实与 replay / audit 镜像，但还没有形成统一的 `DeviationEvent / RecoveryStrategy / RecoveryAttemptLedger / RecoveryDecisionPoint` 契约层，也没有把降级执行、恢复层级矩阵、恢复持久化与驾驶舱展示完整代码化。

新增两项的保守依据如下：

- `10.2`：`server/tests/workflow-runtime-engine.test.ts` 已分别覆盖 `allowed`、`denied`、`needs_escalation` 三类最小治理结果锚点：权限检查与审批 `not_required` 路径可继续执行，manual retry budget exhausted 会写出 `allowed: false` 与 `blockedReason`，automatic retry exhausted 会触发 `runtime.auto_escalate` 与 `instance.escalated`；`shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 则已把 waiting budget approval / route selection 这类人工门控场景投影成 `takeover-required` 与 `governance-deviation`，构成 `needs_takeover` 的最小结果面。
- `10.5`：`server/tests/web-aigc-runtime-observability.test.ts` 已验证 `instance.retry_requested`、`instance.escalated`、`instance.terminated` 会写入 replay / audit，且 retry / escalate 会保留 runtime governance metadata；这已经构成“治理判断 + 恢复动作进入审计链”的最小闭环。
- `13.2`：`shared/__tests__/mission-autopilot.test.ts` 已验证 recovery evidence timeline 与当前恢复态摘要，`server/tests/mission-routes.test.ts` 已验证 waiting / retry-replan 投影，`server/tests/web-aigc-runtime-observability.test.ts` 已验证 waiting / failed / retry / escalated / terminated 事件镜像，因此 replay 时间线对“偏航 -> 恢复 -> 接手 -> 升级”的最小展示语义已有真实锚点。
- `11.3`：`server/tests/mission-operator-actions.test.ts` 已验证 failed mission `escalate` 后进入 blocked human follow-up；`server/tests/workflow-runtime-engine.test.ts` 已验证 runtime `escalate()` 后进入 `WAITING_INPUT` human review checkpoint，同时 `terminate()` 会进入 `FORCE_TERMINATED` 并写出 `instance.terminated`；这已经足以支撑“升级后的冻结 / 等待接手 / 终止”最小结果面。
- `16.4`：`shared/__tests__/mission-autopilot.test.ts` 已验证 evidence timeline、correlation、decisionIds 与 telemetry signals，`server/tests/mission-routes.test.ts` 已验证这些恢复线索能通过 projection 透出，`server/tests/web-aigc-runtime-observability.test.ts` 已验证 runtime control events 会镜像进 replay / audit；当前仓库已经有一组最小但真实的 recovery timeline 重建验证用例。

再续审结论（2026-04-24，lane 1）：

- 在 `11 / 103` 基础上，本轮保守新增 `13.4`，done/total 更新为 `12 / 103`。
- 直接依据是 shared 已存在 `MissionAutopilotEvidenceCorrelationIndex`，正式定义了 `missionId / workflowId / replayId / sessionId / timelineId / routeIds / routeStageKeys / runtimeEventIds` 等最小关联键；`shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 也已直接断言这些键会在 shared summary 与 mission projection 中透出。
- 这条勾选的边界仍需保持保守：当前成立的是“恢复事件最小关联键索引已存在并被测试锚定”，不是统一 `RecoveryAttemptLedger`、完整 audit 关联、历史查询接口或跨重启 attach 语义都已实现。

补位续审结论（2026-04-24，lane 1）：

- 在 `12 / 103` 基础上，本轮保守新增 `5.4`，done/total 更新为 `13 / 103`。
- 直接依据是 `server/tests/workflow-runtime-engine.test.ts` 已同时验证两条连续链路：`automatically retries a retryable node when retry budget is configured` 证明节点级 automatic retry 已作为当前主仓的局部自动恢复入口存在；`automatically escalates when retry budget is exhausted and escalation is enabled` 则证明 automatic retry budget exhausted 后，会写出 `automatic_retry_budget_exhausted`、`runtime.auto_escalate` 与 `instance.escalated`，并把实例送入 `WAITING_INPUT` 的 `human escalation review`。
- `shared/__tests__/mission-autopilot.test.ts` 也已把 blocked retry 场景投影成 `attemptedActions: ["retry", "escalate"]`、`takeover-required` 与 evidence timeline，说明 shared recovery 摘要能够表达这条“局部自动恢复失败 -> 进入更高一层恢复/人工处理”的最小结果面。
- 因此，本轮只保守确认一条窄语义规则：当前仓库已经存在“节点级自动重试耗尽后，升级到人工评审/异常升级路径”的最小闭环。
- 这条勾选的边界也必须保持严格：当前并不能外推为 `restore_snapshot / skip_non_critical / degrade_execution / replan_stage` 等所有局部恢复动作都已有统一的下一层升级规则，也不能外推为完整的恢复层级矩阵、恢复协调器或恢复账本已经实现，因此 `4.2 / 4.3 / 5.1 / 5.2 / 5.3 / 5.5` 仍不能勾。

本轮 recovery lane 续审结论（2026-04-24，lane 6）：

- 在 `13 / 103` 基础上，本轮保守新增 `8.3`，done/total 更新为 `14 / 103`。
- 直接依据是 `server/tasks/mission-decision.ts` 已提供 `idempotentIfNotWaiting` 分支：当任务不再处于 `waiting` 且启用该选项时，会返回 `ok: true`、`alreadyResolved: true` 与 `describeMissionDecisionAlreadyProcessed(...)`，而不是把重复提交视为错误。
- `server/routes/tasks.ts` 的 `POST /api/tasks/:id/decision` 已固定使用 `{ idempotentIfNotWaiting: true }`，并把 `alreadyResolved` 透传到响应体，同时避免对已处理决策重复触发 `emitDecisionSubmitted(...)`。
- `server/tests/hitl-decision.test.ts` 现已同时锁住两层最小闭环：一条单元测试验证 `submitMissionDecision()` 在 mission resumed 后重复提交会返回 `alreadyResolved` 且不追加第二条历史；一条 API 测试验证路由层重复提交同样返回 `alreadyResolved`、任务保持 `running`、`decisionHistory` 长度维持为 `1`。
- 这条勾选的边界需要保持严格：当前证明的是“现有 wait-resume / decision 提交流程支持恢复后的幂等重复提交”，不是完整的恢复决策点映射、恢复选项建模、统一恢复账本或完整 replay/audit 重放都已完成，因此 `8.1 / 8.2 / 15.3 / 15.4 / 15.5` 仍不能因此外推勾选。

本轮 recovery lane 再续审结论（2026-04-24，lane 6）：

- 在 `14 / 103` 基础上，本轮保守新增 `8.1`，done/total 更新为 `15 / 103`。
- 直接依据是 `shared/mission/autopilot.ts` 已把 waiting / recovery 场景中的人工决策点稳定投影为 takeover 语义：`takeover.type`、`takeover.reason`、`takeover.prompt`、`takeover.decisionId`、`takeover.options`，以及 `route.takeoverPointIds` 会复用当前 `MissionDecision.decisionId` 作为最小接管点标识。
- `server/tests/mission-routes.test.ts` 已直接断言 waiting route selection 场景下：
  - `driveState.state = takeover-required`
  - `recovery.state = takeover-required`
  - `takeover.type = route-selection`
  - `takeover.decisionId = decision-route-choice`
  - `route.takeoverPointIds = ['decision-route-choice']`
  - `evidence.timeline` 中会生成 `type = takeover` 的时间线项
- `server/tests/hitl-decision.test.ts` 则继续锁住这个接管点在提交后的最小闭环：当前 `MissionDecision` 经 `submitMissionDecision()` / `POST /api/tasks/:id/decision` 提交后，会进入 `decisionHistory`，并可在已恢复后通过 `alreadyResolved` 维持幂等重复提交语义。
- 因此当前仓库已能保守支撑“恢复决策点会被映射成现有 takeover 类型与 decisionId 锚点”的最小事实链；但这里的 `Takeover Point` 仍主要体现为 autopilot projection 中的 `takeover summary + decisionId + takeoverPointIds`，不是独立持久化的 takeover queue / entity。
- 这条勾选的边界也必须保持严格：`8.2` 仍不能勾，因为当前虽然已有 `MissionDecision` options 与部分 payload / metadata 闭环，但尚未形成一套专门面向 recovery option 的统一 payload 契约；`15.3 / 15.4 / 15.5` 也仍不能勾，因为 `auditEventIds` 仍为空，服务重连/重启后的恢复继续保证和历史查询接口都未形成正式合同。

本轮续审结论（2026-04-25，lane 3）：

- 结合当前主仓最新工作树再次复核 recovery / takeover governance 相关实现与测试后，未新增安全可勾选项，done/total 维持 `15 / 103`。
- 这轮重点回看了 recovery summary、mission projection、wait-resume / decision idempotency、workflow retry-governance / auto-escalate、operator actions、runtime replay / audit mirroring 等现有闭环；它们依然足以支撑已勾选的 `3.5 / 5.4 / 7.5 / 8.1 / 8.3 / 8.4 / 8.5 / 10.2 / 10.5 / 11.3 / 12.2 / 12.4 / 13.2 / 13.4 / 16.4`，但还不足以再外推新的恢复治理条目。
- 本轮复核时直接依赖的实现与测试路径包括：
  - `shared/mission/autopilot.ts`
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tasks/mission-runtime.ts`
  - `server/core/mission-orchestrator.ts`
  - `server/tasks/mission-decision.ts`
  - `server/routes/tasks.ts`
  - `server/tests/hitl-decision.test.ts`
  - `server/tests/mission-routes.test.ts`
  - `server/tests/mission-operator-actions.test.ts`
  - `server/core/workflow-runtime-engine.ts`
  - `server/tests/workflow-runtime-engine.test.ts`
  - `server/core/web-aigc-runtime-observability.ts`
  - `server/tests/web-aigc-runtime-observability.test.ts`
- 目前最接近、但仍不能新增勾选的条目如下：
  - `8.2`：虽然 `submitMissionDecision()`、route selection waiting 与 `takeover.decisionId` 已形成最小兼容层，但还没有一套专门面向 recovery option 的 `MissionDecision` payload 契约与针对该契约的直接测试。
  - `10.3`：`allowed / denied / needs_takeover / needs_escalation` 已有结果锚点，但没有统一默认控制面策略，去明确治理命中后何时阻断、何时建议接管、何时必须接管、何时升级。
  - `11.2`：`requestedBy / reason / governance / decisionId` 等字段虽能在局部链路中保留，但没有统一测试约束“升级前必须保留哪些上下文、证据与人工评论”。
  - `12.3`：当前 shared drive-state 能把 waiting / blocked / replanning / delivered 等结果态投影出来，但没有把“恢复后回到 `executing / reviewing / delivered` 的条件”定义成单独 recovery contract 并锁进测试。
  - `13.3`：runtime observability 已镜像 `instance.retry_requested / instance.escalated / instance.terminated`，但 audit 侧还没有“高风险恢复 / 降级 / 人工批准 / 终止”的统一记录方式；尤其 `degrade` 仍停留在设计层。
  - `14.1 - 14.5`：当前仓库虽存在若干 takeover / autopilot surface，但没有 recovery-specific 前端展示契约与稳定测试闭环足以证明“恢复状态 / 恢复历史 / 当前接手点 / 推荐动作 / 风险提示”已按本 spec 收口。
  - `15.3`：`decisionHistory`、projection correlation 与 replay / audit metadata 已共存，但 `auditEventIds` 在 shared / server 现有测试里仍为空数组，尚未形成正式的“恢复记录 <-> decisionHistory / 任务历史 / audit”关联模型。
- 因此，本轮只补审计说明，不新增勾选；后续若要继续推进，更适合等待 recovery option payload、audit record model、recovery return-condition contract 或 recovery-specific UI/test 闭环进一步落地后再审。

本轮续审结论（2026-04-25，lane 2）：

- 围绕 `server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 复核 task-detail 侧 recovery / takeover 展示后，本轮保守新增 `14.1 / 14.3`，done/total 更新为 `17 / 103`。
- `14.1` 现在可以保守勾选：`TaskAutopilotPanel` 已在任务详情 `TaskDetailView` 中稳定接入 recovery / evidence / takeover 三个展示区块；测试已直接断言 `task-autopilot-recovery`、`task-autopilot-evidence`、`task-autopilot-takeover` 与 `task-autopilot-panel` 会在任务详情中渲染，同时显示恢复状态、时间线摘要、接管原因 / prompt / options。`server/tests/mission-routes.test.ts` 也已验证服务端 projection 会透出 `autopilotSummary.recovery`、`takeover` 与 `evidence.timeline`，形成任务详情可消费的直接数据面。
- `14.3` 现在可以保守勾选：`TaskAutopilotPanel` 的 `parseRecovery()` 已直接展示 `attemptedActions` 与 `suggestedActions`，`parseTakeover()` 已展示接管选项及说明，`parseRoute()` / `parseDestination()` / `parseExplanation()` 已补充路线差异、ETA / cost / risk、missing-info impact、remaining steps 与 recommendation reasons；对应测试已直接断言 `Attempted: Retry`、`Suggested: Replan; Escalate`、route diff / 时长成本汇总、风险点、以及 `Options: Approve: Continue the route.; Reject: Stop the route.` 等恢复决策面板所需的最小说明面。
- 这两条新增勾选的边界都需要保持严格：
  - `14.1` 当前成立的是“任务详情页已存在 recovery state / evidence timeline / 当前 takeover signal 的展示区域”，不是独立的 recovery history 页、takeover queue 或完整驾驶舱态势面板都已实现。
  - `14.3` 当前成立的是“只读型恢复决策摘要面板内容已落地并有测试锚定”，不是交互式 recovery action 提交面板、统一 recovery option write-path 或恢复决策执行流都已前端化。
- 本轮仍不能新增勾选的前端项如下：
  - `14.2` 仍不能勾：当前证据落在任务详情 `TaskAutopilotPanel`，不是独立驾驶舱 / cockpit 中“偏航、恢复中、等待接手、升级中”的全局状态提示体系。
  - `14.4` 仍不能勾：虽然 route block 已能展示路线差异、ETA / cost / risk 变化，但 `degrade_execution` 语义、降级前后能力边界与专门测试并未形成稳定闭环。
  - `14.5` 仍不能勾：当前 destination impact / blocking copy 能表达“缺失信息会继续阻塞”这类后果，但还没有围绕“不接手会发生什么”形成 takeover-specific 的统一字段契约与直测文案锚点。

本轮续审结论（2026-04-25，lane 6）：

- 围绕 `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 继续复核 recovery / takeover-required / recommended actions / attempted actions 周边实现后，本轮保守新增 `14.5`，done/total 更新为 `18 / 103`。
- `14.5` 现在可以保守勾选：当前主仓已经形成一条从 shared consequence 文案、到 server projection、到 client store 归一化、再到任务详情面板展示与直测锚定的最小闭环，能够稳定表达“如果当前不接手 / 不补输入，会继续发生什么”。
- 直接依据如下：
  - `shared/mission/autopilot.ts` 的 `buildMissingInfoDetails()` 已在 waiting / blocked 场景下直接生成后果文案：`Route selection cannot continue until this input is resolved.`、`Goal understanding remains incomplete until this input is resolved.`、`Mission progress remains paused until this input is resolved.`、`Runtime recovery and execution handoff remain blocked.`。
  - `server/tests/mission-routes.test.ts` 已直接断言 waiting route-selection projection 会透出 `destination.missingInfoDetails = [{ item: 'route selection', impact: 'Route selection cannot continue until this input is resolved.', blocking: true }]`，说明服务端 recovery/takeover 投影已经把“不处理会继续阻塞”的后果表达输出给任务详情视图。
  - `client/src/lib/tasks-store.ts` 已把 `destination.missingInfoDetails` 归一化为 `destination.impact / blockingReason`；`client/src/lib/tasks-store.autopilot.test.ts` 已直接断言结构化 missing-info 细节会提升为 `impact` 与 `blockingReason`，并保留 waiting / blocked 场景下的 impact 文案。
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 `parseDestination()` 已优先渲染 `destination.blockingReason / destination.impact / destination.missingInfoDetails[*].impact`；`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接断言会显示 `Route selection will stay blocked until the release owner confirms the handoff.`、`Execution remains blocked until the workspace is confirmed.` 等 consequences copy。
- 这条新增勾选的边界也必须保持严格：
  - 当前成立的是“任务详情中已经存在稳定的 consequences / blocking impact 提示表达”，不是独立的 takeover-specific narrative contract、驾驶舱级全局提醒、交互式‘不接手会发生什么’模拟器或统一 write-path 都已落地。
  - 因此，本轮只保守补勾 `14.5`；`14.2 / 14.4` 仍不能勾，`7.3 / 8.2` 也不能因为已有 suggested actions、decision options 或 impact copy 就被外推出已完成。

本轮续审结论（2026-04-25，指定证据集复核）：

- 本轮严格限制在以下指定证据内复核：`client/src/components/tasks/DecisionPanel.tsx`、`client/src/components/tasks/TaskDetailView.tsx`、`client/src/lib/tasks-store.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`server/tasks/mission-projection.ts`、`shared/mission/api.ts`、`shared/mission/index.ts`、`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`。
- 在这组证据边界内，未新增安全可勾选项，done/total 维持 `18 / 103`。
- 这轮重点确认了三条已经存在、但不应继续外推的最小闭环：
  - `DecisionPanel.tsx` 与 `server/tests/hitl-decision.test.ts` 已形成通用 `MissionDecision` 提交、`requiresComment` 校验、`request-info`/`param_collection` metadata 保留与重复提交 `alreadyResolved` 的闭环。
  - `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts` 已形成 waiting / blocked / retry-replan 场景下的 recovery / takeover / impact / timeline 投影闭环。
  - `TaskDetailView.tsx` 只证明结构化 `DecisionPanel` 与 `TaskAutopilotPanel` 已被稳定挂到任务详情与 cockpit 视图，不额外证明 recovery-specific 写路径、治理控制面或恢复持久化模型已完成。
- 本轮继续不能新增勾选的近邻条目如下：
  - `7.3` 仍不能勾：当前 `DecisionPanel.tsx` 展示的是通用 decision 选项与 comment / param collection 交互，缺少 recovery 语义下“继续 / 降级 / 改线 / 升级 / 终止”这一套专门接手选项合同及对应 recovery 测试锚点。
  - `8.2` 仍不能勾：虽然 `MissionDecision` 已支持 `decisionId`、`options`、`metadata`、`alreadyResolved`，但 recovery option 到 `MissionDecision` payload 的专门映射合同没有独立类型和直接测试；现有证据更多是在复用通用 HITL 决策层。
  - `10.3` 仍不能勾：`shared/mission/autopilot.ts` 与 projection/store 只暴露了 `takeover-required`、`blocked`、`replanning` 等结果态，没有统一的治理控制面去把 `allowed / denied / needs_takeover / needs_escalation` 进一步分派为“阻断 / 建议接管 / 必须接管 / 升级”。
  - `11.2` 仍不能勾：`hitl-decision` 审计测试证明了普通人类决策提交会写入 audit metadata，但没有 recovery / escalation 专用测试去约束“升级前必须保留哪些上下文、证据与人工评论”。
  - `12.3` 仍不能勾：`shared/mission/autopilot.ts` 的 `buildControlActionReason()` 和 `buildRecoverySummary()` 能表达 `resume / retry / replan / escalate` 建议，但没有把“恢复完成后何时回到 executing / reviewing / delivered”定义成独立 recovery return-condition contract 并被测试锁定。
  - `13.3` 仍不能勾：指定证据里只看到了普通 `human.decision_submitted` / `human.param_collection_submitted` 审计项，以及 recovery timeline / correlation 的只读投影，没有 recovery / degrade / manual approval / terminate 的统一审计记录模型。
  - `15.3` 仍不能勾：`tasks-store.ts` 和 `mission-routes.test.ts` 继续表明 `decisionHistory`、timeline correlation 与 `auditEventIds: []` 并存，但没有恢复记录与 `decisionHistory / 任务历史 / audit` 的正式关联合同。
- 因此，这轮只补审计说明，不新增勾选；后续若要继续推进，更适合等待 recovery-specific option payload、escalation evidence contract、return-condition contract 或 recovery audit record model 落地后再审。

本轮续审结论（2026-04-25，runtime / observability 证据补充复核）：

- 本轮在既有指定证据集之外，补充复核了 `server/tests/workflow-runtime-engine.test.ts`、`server/tests/web-aigc-runtime-observability.test.ts`，并与 `shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`server/tests/hitl-decision.test.ts`、`client/src/components/tasks/DecisionPanel.tsx`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/lib/tasks-store.ts` 一起交叉核对。
- 在这组补充证据下，仍未新增安全可勾选项，done/total 维持 `18 / 103`。
- 这轮新确认、但仍不足以外推出 recovery governance 条目已完成的事实链如下：
  - `server/tests/workflow-runtime-engine.test.ts` 已锁定 `resume()`、`escalate()`、`terminate()`、retry exhausted auto-escalate 的最小运行时结果面，并保留 `requestedBy / reason`，以及部分 approval 场景下的 `comment / ticketId / governance.approval` 局部字段。
  - `server/tests/web-aigc-runtime-observability.test.ts` 已锁定 `instance.retry_requested / instance.escalated / instance.terminated` 会镜像到 replay / audit，且 governance metadata 会随 retry / escalate 一并带出。
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/lib/tasks-store.ts` 已把 `recovery.attemptedActions / suggestedActions`、`destination.impact / blockingReason`、`evidence.correlation` 稳定投影为任务详情只读展示。
- 但以下近邻项在这轮补充证据下依然不能勾：
  - `7.3` 仍不能勾：`DecisionPanel.tsx` 仍是通用 `approve / reject / request-info / multi-choice / escalate / custom-action` 布局，没有 recovery 语义下“继续 / 降级 / 改线 / 升级 / 终止”的专门接手选项合同与直测。
  - `8.2` 仍不能勾：虽然 `MissionDecision` 已支持 `decisionId / options / metadata / alreadyResolved`，但 recovery option 到 `MissionDecision` payload 的专门映射类型与专用测试依然缺失。
  - `10.3` 仍不能勾：当前证据证明了 `allowed / denied / needs_takeover / needs_escalation` 的局部结果锚点，但没有统一控制面把它们正式分派成“阻断 / 建议接管 / 必须接管 / 升级”。
  - `11.2` 仍不能勾：虽然 runtime escalation / terminate 与部分 approval resume 场景会保留 `requestedBy / reason / comment / ticketId`，但没有统一 recovery / escalation contract 去约束“升级前必须保留哪些上下文、证据与人工评论”。
  - `12.3` 仍不能勾：现有测试证明 waiting / blocked runtime 可以经 `resume()` 回到执行、approval node 可以 resume 到 executed，但没有 recovery return-condition contract 去统一定义何时回到 `executing / reviewing / delivered`。
  - `13.3` 仍不能勾：当前 audit 面主要是普通人类决策审计与 runtime control event mirroring，尚未形成“高风险恢复 / 降级 / 人工批准 / 终止”的统一 audit 记录模型。
  - `15.3` 仍不能勾：`decisionHistory`、timeline correlation 与 replay / audit metadata 虽已并存，但 `auditEventIds` 在 shared / projection 现有测试里仍为空数组，没有形成恢复记录与 `decisionHistory / 任务历史 / audit` 的正式关联合同。
- 因此，这轮补充复核后的保守结论不变：当前主仓已稳定覆盖 recovery/takeover 的“读模型 + 通用决策复用 + 任务详情只读展示 + runtime replay/audit mirroring”，但 recovery-specific option payload、escalation evidence preservation、return-condition contract、recovery audit record model 仍然没有收口，不应继续新增勾选。

本轮续审结论（2026-04-25，指定 recovery / takeover 证据链复核）：

- 本轮严格限制在以下指定证据链内复核：`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-runtime.ts`、`server/tasks/mission-decision.ts`、`server/tasks/mission-projection.ts`、`server/core/mission-orchestrator.ts`、`server/core/workflow-runtime-engine.ts`、`server/core/web-aigc-runtime-observability.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`server/tests/workflow-runtime-engine.test.ts`、`server/tests/web-aigc-runtime-observability.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`。
- 在这组直接实现与直接测试边界内，未新增安全可勾选项，done/total 维持 `18 / 103`。
- 这轮复核重新确认了已勾选项仍然成立的最小事实链：
  - `shared/mission/autopilot.ts` 中 `inferDeviationCategory()` 与 `buildRecoverySummary()` 仍稳定提供 `governance-deviation / route-deviation / state-block` 到 `takeover-required / escalated / watching / recovering` 的最小恢复态读模型。
  - `shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 继续直接锁定 waiting budget approval、route selection、blocked retry、retry-replan 等 recovery / takeover 投影结果。
  - `server/tasks/mission-decision.ts`、`server/tasks/mission-runtime.ts`、`server/core/mission-orchestrator.ts` 与 `server/tests/hitl-decision.test.ts` 继续证明通用 `MissionDecision` 提交、`decisionHistory` 归档、`alreadyResolved` 幂等、route selection `changedReason`/`selectedRouteId` 保留这些兼容层语义成立。
  - `server/core/workflow-runtime-engine.ts` 与 `server/tests/workflow-runtime-engine.test.ts` 继续证明 `resume()`、manual retry governance blocked、retry exhausted auto-escalate、`instance.escalated`/`instance.retry_requested` 等最小运行时恢复链路成立。
  - `server/core/web-aigc-runtime-observability.ts` 与 `server/tests/web-aigc-runtime-observability.test.ts` 继续证明 `instance.retry_requested / instance.escalated / instance.terminated` 会镜像进入 replay / audit，并保留 governance metadata。
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 继续证明 recovery / evidence / takeover 只读展示、recommended / attempted actions、route diff、consequences copy 已稳定落在任务详情面板。
- 但以下近邻条目在这轮指定证据下仍不能保守勾选：
  - `3.2` 仍不能勾：虽然 `autopilot.ts` 已写出 `goal-deviation / route-deviation / quality-deviation` 分支，但当前直接测试只稳固锚定了 `route-deviation`，`goal-deviation` 与 `quality-deviation` 还缺少同等级的 shared/server 直测闭环，不能把实现分支直接外推为“识别规则已收口”。
  - `3.3` 仍不能勾：`governance-deviation` 与 `state-block` 已有直测锚点，但 `dependency-failure` 在本轮指定证据内仍缺少直接断言，不能把整条任务一并勾上。
  - `3.4` 仍不能勾：`recovery-exhausted` 在 `buildRecoverySummary()` 中已有判断，但当前未见直接测试明确断言该分类值本身及其升级规则，因此仍不应勾选。
  - `7.3` 与 `8.2` 仍不能勾：当前代码证明的是复用通用 `MissionDecision` / `Takeover` 提交与展示链路，不是 recovery 语义下“继续 / 降级 / 改线 / 升级 / 终止”的专门选项合同，也不是 recovery option 到 `MissionDecision` payload 的专门映射合同。
  - `10.3` 仍不能勾：当前证据可以锁定 `allowed / denied / needs_takeover / needs_escalation` 的局部结果面，但没有统一默认控制面去正式分派为“阻断 / 建议接管 / 必须接管 / 升级”。
  - `11.2` 仍不能勾：虽然 escalation / terminate / decision history / audit metadata 会保留 `requestedBy / reason / decisionId / governance` 的局部字段，但没有统一 recovery / escalation contract 去约束“升级前必须保留哪些上下文、证据与人工评论”。
  - `12.3` 仍不能勾：当前 `resume()`、projection 与 drive-state 推断能表现恢复后继续执行的结果态，但没有把“何时回到 `executing / reviewing / delivered`”定义成独立的 recovery return-condition contract 并被测试锁住。
  - `13.3` 与 `15.3` 仍不能勾：当前已有 replay / audit 镜像、timeline correlation 与 `decisionHistory` 并存，但还没有 recovery-specific 的统一 audit record model，且现有投影测试里的 `auditEventIds` 仍未形成正式的恢复记录关联合同。
- 因此，这轮只补审计说明，不新增勾选；后续若要继续推进，更适合等待 `dependency-failure / recovery-exhausted` 直测、recovery option payload、return-condition contract、recovery audit record model 这些缺口补齐后再审。

本轮收口结论（2026-04-25，lane 6）：

- 基于当前 design 正文已经直接覆盖的设计内容，本轮保守新增勾选 `4.2 / 4.3 / 7.1 / 7.2 / 10.1 / 11.1 / 12.1 / 17.1 / 17.2 / 17.3`，done/total 更新为 `28 / 103`。
- 这些新增勾选都属于“设计已收口”，不等于代码、接口、持久化、前端交互或治理合同已经完整落地。
- 直接依据如下：
  - `4.2 / 4.3`：`恢复层级` 与 `策略矩阵` 两节已经把恢复顺序和异常类型对应策略写成明确列表与表格。
  - `7.1 / 7.2`：`人工确认后继续 vs 人工直接接手` 与 `接手范围` 两节已经把语义边界和 `step / stage / route / mission` 范围模型写清楚。
  - `10.1`：`与 runtime governance 的兼容` 已明确列出 `retry_budget / cost_budget / permission_scope / risk_level / external_side_effect / automation_level` 六类治理检查维度。
  - `11.1`：`异常升级设计` 下的 `触发条件` 已列出自动恢复耗尽、权限越界、外部副作用、`critical` 风险、审计/合规升级等条件。
  - `12.1`：`恢复后继续设计` 与 `与 Drive State 的映射` 已共同形成偏航检测、自动恢复、等待接手、改线恢复、恢复后复核与恢复成功继续的高层状态流。
  - `17.1 / 17.2 / 17.3`：`分阶段落地建议` 已分别定义语义与事件层、恢复控制与接管桥接、可视化与治理集成三个阶段范围。
- 本轮收口后，仍不能勾的重点近邻项保持不变：
  - `7.3 / 8.2`：仍缺 recovery 语义下的专门选项合同，以及 recovery option 到 `MissionDecision` payload 的专门映射合同。
  - `10.3`：仍缺统一治理控制面，把四类治理结果正式分派为“阻断 / 建议接管 / 必须接管 / 升级”。
  - `11.2`：仍缺升级前证据保留与人工评论的统一合同。
  - `12.3`：仍缺恢复完成后回到 `executing / reviewing / delivered` 的独立 return-condition contract。
  - `13.3 / 15.3`：仍缺 recovery-specific audit record model，以及恢复记录与 `decisionHistory / 任务历史 / audit` 的正式关联合同。
  - `14.2 / 14.4`：仍缺独立驾驶舱状态提示与 `degrade_execution` 专门差异展示合同。

本轮继续收口结论（2026-04-25，lane 6，二次推进）：

- 基于本轮新增 design 正文，保守新增勾选 `2.1 / 2.2 / 2.3 / 2.4 / 2.5 / 4.4 / 7.4 / 9.1 / 9.2 / 9.3 / 9.4 / 10.3 / 11.4`，done/total 更新为 `41 / 103`。
- 本轮新增勾选仍然遵守“设计已直接收口 + 现有主仓已有最小实现或测试锚点”的边界，不外推 recovery-specific payload、统一 audit contract 或恢复持久化已落地。
- 直接依据如下：
  - `2.1 / 2.2 / 2.3 / 2.4 / 2.5`：`设计.md` 新增 `信号来源与现有实现锚点`，并与既有 `信号来源`、`触发强度` 两节一起，把 runtime / quality / governance / human 信号来源及强弱触发规则写成可审计口径。
  - `4.4`：`设计.md` 新增 `普通控制动作与正式恢复动作的边界`，明确区分普通 `retry / revise / replan` 与 recovery 语义下的正式恢复动作。
  - `7.4`：`设计.md` 新增 `requiresComment 与责任确认边界`，直接定义哪些恢复动作必须要求评论或责任确认，哪些只保留最小决策痕迹即可。
  - `9.1 / 9.2 / 9.3 / 9.4`：`设计.md` 在 `与 review / audit / revise / verify 的兼容` 基础上，新增 `这一闭环与现有实现的最小对齐`，把 review / verify / revise / audit 进入 recovery 闭环的策略与边界写清。
  - `10.3`：`设计.md` 新增 `治理命中后的默认控制面`，把 `allowed / denied / needs_takeover / needs_escalation` 继续分派为自动继续、人工接手、升级或阻断。
  - `11.4`：`设计.md` 新增 `与现有人工值守、治理审批和终止控制面的关系`，明确异常升级与现有 escalation review、审批与 terminate 控制面的兼容关系。
- 需要以本条最新结论为准：
  - 本文件前面若仍保留“`2.x / 4.4 / 7.4 / 9.x / 10.3 / 11.4` 还不能勾”的历史续审备注，应视为旧审计快照，而不是当前最新状态。
- 本轮收口后，仍不能勾的重点项如下：
  - `7.3 / 8.2`：仍缺 recovery 语义下的专门接手选项合同，以及 recovery option 到 `MissionDecision` payload 的专门映射合同。
  - `10.4`：仍缺恢复动作对自动驾驶等级降级影响的专门设计与锚点。
  - `11.2`：仍缺升级前证据保留与人工评论的统一合同。
  - `11.5`：仍缺升级失败或无人接手时的兜底策略闭环。
  - `12.3`：仍缺恢复完成后回到 `executing / reviewing / delivered` 的独立 return-condition contract。
- `13.3 / 15.3`：仍缺 recovery-specific audit record model，以及恢复记录与 `decisionHistory / 任务历史 / audit` 的正式关联合同。
- `14.2 / 14.4`：仍缺独立驾驶舱状态提示与 `degrade_execution` 专门差异展示合同。

本轮续审结论（2026-04-25，lane 6，三次推进）：

- 基于本轮新增 design 正文，保守新增勾选 `3.1 / 4.1 / 16.1`，done/total 更新为 `44 / 103`。
- 本轮新增勾选仍遵守“设计已直接收口 + 当前主仓存在最小直接代码与直接测试锚点”的边界，不外推独立 recovery 服务、恢复账本、统一 audit model 或灰度配置中心已经落地。
- 直接依据如下：
  - `3.1`：`设计.md` 新增 `DeviationDetector 的最小闭环输入、输出与事件投影`，已经把 runtime / mission / decision / projection 四类输入、shared summary 输出、mission projection / tasks-store / TaskAutopilotPanel 投影链写清；同时仓库里已有 `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts` 及对应测试作为最小现实锚点。
  - `4.1`：`设计.md` 新增 `RecoveryCoordinator 的最小编排流`，已经把检测、治理判定、动作选择、HITL 桥接、结果投影串成七步总流程；现有 `workflow runtime`、`mission runtime / orchestrator`、`mission decision`、`mission projection`、`runtime observability` 已分别提供最小结果面与测试锚点。
  - `16.1`：`设计.md` 新增 `测试与验证策略 -> 单元测试设计`，已经把 shared 读模型、decision 兼容、runtime 治理三类单元测试目标写清，并明确了当前只覆盖已有直接锚点的分类与治理结果；仓库里已有 `shared/__tests__/mission-autopilot.test.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/workflow-runtime-engine.test.ts` 的最小测试事实链。
- 本轮仍不能勾选的近邻项如下：
  - `4.5`：虽然总体流程已写清，但恢复动作的退出条件、放弃条件与升级条件还没有被独立收敛成统一 contract。
  - `5.5`：replay / audit / evidence 的镜像面已存在，但“自动恢复记录如何进入 replay / audit / evidence”还没有形成 recovery-specific 记录模型。
  - `16.3`：`review / audit / revise / verify` 进入 recovery 的回归测试策略虽然已补边界说明，但还没有收敛成可直接落地的完整回归矩阵。
  - `17.4 / 17.5`：本轮已补灰度与回滚原则，但当前仍缺独立阈值配置、feature flag 或统一回滚控制面的实现证据，因此只保守留在设计层，不新增勾选。

本轮续审结论（2026-04-25，lane 6，四次推进）：

- 基于本轮新增 design 正文，保守新增勾选 `1.1 / 1.2 / 1.3 / 1.4 / 1.5 / 1.6 / 4.5 / 5.1 / 5.2 / 5.3 / 5.5 / 6.1 / 6.2 / 6.3 / 6.4 / 6.5 / 9.5 / 10.4 / 11.2 / 11.5 / 12.3 / 13.1 / 13.3 / 13.5 / 16.2 / 16.3 / 16.5 / 17.4 / 17.5`，并同步把其下全部子项已完成的父任务一并勾选，当前 `done / total` 与任务清单对齐为 `84 / 103`。
- 这批新增勾选全部属于“设计/治理契约/测试计划/灰度计划已直接收口”，不等于对应代码实现、持久化、接口、独立 UI 或 recovery-specific audit model 已全部落地。
- 直接依据如下：
  - `1.1 / 1.2 / 1.3 / 1.4 / 1.5`
    - `模型设计` 已明确定义 `DeviationEvent`、`DeviationCategory`、`RecoveryStrategy`、`RecoveryStrategyType`、`RecoveryImpact`、`RecoveryAttempt`、`RecoveryDecisionPoint` 的结构与语义。
  - `1.6`
    - `恢复契约与 Drive State / Takeover Point 的映射字段` 已把 recovery 契约如何投影到 `Drive State`、`Takeover Point`、`MissionDecision`、`waiting / WAITING_INPUT` 写成统一字段合同。
  - `4.5`
    - `恢复动作的退出条件、放弃条件与升级条件` 已把 recovery 动作收敛为统一判断规则与策略族判断表。
  - `5.1 / 5.2 / 5.3 / 5.5`
    - `自动恢复设计` 已把节点级重试、替代执行器、快照/检查点恢复、跳过非关键步骤的准入条件与自动恢复记录如何进入 replay / audit / evidence 写成明确规则。
  - `6.1 / 6.2 / 6.3 / 6.4 / 6.5`
    - `降级执行设计` 已把降级维度、准入、影响表达、禁止静默降级场景以及与 cost / permission / runtime governance 的对接方式写清。
  - `10.4`
    - `恢复动作对自动驾驶等级的影响` 已明确不同恢复动作对自动化等级的影响表达。
  - `11.2 / 11.5`
    - `升级前证据保留清单` 与 `升级失败或无人接手时的兜底策略` 已形成明确治理合同。
  - `12.3`
    - `恢复返回条件 Contract` 已把回到 `executing / reviewing / delivered` 与继续停留在 `blocked / takeover-required / replanning` 的条件写清。
  - `13.1 / 13.3 / 13.5`
    - `RecoveryAttemptLedger 最小字段与保留策略`、`audit 表达`、`默认自动恢复为何被允许的证据表达` 已把恢复记录、审计口径和 allow-rationale 明文化。
  - `9.5`
    - `质量失败与运行失败的时间线表达` 已明确区分 runtime failure、quality failure 与 governance failure 在 replay 中的展示语义与统一命名规则。
  - `16.2 / 16.3 / 16.5`
    - `测试与验证策略` 已补齐集成验证矩阵、回归矩阵与连续性验证计划。
  - `17.4 / 17.5`
    - `灰度与回滚策略` 已补齐阈值灰度分层、回滚触发条件与分级回滚顺序。
- 需要以本条最新结论为准：
  - 本文件前面若仍保留“`1.x / 4.5 / 5.x / 6.x / 10.4 / 11.2 / 11.5 / 12.3 / 13.1 / 13.3 / 13.5 / 16.2 / 16.3 / 16.5 / 17.4 / 17.5` 还不能勾”的历史续审表述，应视为旧审计快照，而不是当前最新状态。
- 本轮收口后，仍不能勾选的重点项如下：
  - `3.2 / 3.3 / 3.4`
    - 当前仓库仍缺 `goal_deviation / quality_deviation / dependency_failure / recovery_exhausted` 的同等级直接测试闭环，不能把实现分支外推为安全收口。
  - `7.3 / 8.2`
    - 仍缺 recovery 语义下“继续 / 降级 / 改线 / 升级 / 终止”的专门选项合同，以及 recovery option 到 `MissionDecision` payload 的专门映射合同。
  - `12.5`
    - 仍缺与现有 `Drive State` 独立 spec 的术语迁移、命名对齐和跨文档变更条件说明。
  - `14.2 / 14.4`
    - 仍缺独立驾驶舱全局状态提示合同，以及 `degrade_execution` 的专门差异展示合同。
  - `15.1 / 15.2 / 15.3 / 15.4 / 15.5`
    - 当前仍没有持久化层、查询接口、跨重启 attach 或 recovery-specific audit 关联的直接实现证据，因此服务端持久化与查询相关条目继续不能勾。

本轮续审结论（2026-04-26，lane 1）：

- 基于本轮新增 design 正文，保守新增勾选 `7.3 / 8.2 / 12.5 / 14.2 / 14.4 / 15.1 / 15.2 / 15.3 / 15.4 / 15.5`，并同步将父任务 `7 / 8 / 12 / 14 / 15` 收口，当前 `done / total` 更新为 `99 / 103`。
- 这批新增勾选全部属于“设计合同已直接写清”的收口，不代表 recovery-specific payload builder、独立驾驶舱组件、持久化写入层、跨重启 attach 服务或历史查询 API 已经实现。
- 直接设计依据如下：
  - `7.3`
    - `人工接手设计 -> 恢复场景下的接手选项合同` 已把 `continue / degrade / reroute / escalate / terminate` 的语义、适用场景、评论要求与展示规则写成明确表格。
  - `8.2`
    - `人工接手设计 -> 恢复选项到 MissionDecision 的映射合同` 已把五类恢复选项与现有 `MissionDecision.type`、payload、resolved metadata/formData、以及 `resume / replan / escalate / terminate` 去向逐项对齐。
  - `12.5`
    - `与 Drive State 的映射 -> 与现有 Drive State spec 的术语与迁移条件对齐` 已明确 recovery category / recovery state 与既有十态 `Drive State` 的并行关系、禁新增高层状态名、以及迁移前提。
  - `14.2`
    - `任务详情与驾驶舱最小接入 -> 驾驶舱全局状态提示` 已把 `偏航已检测 / 恢复执行中 / 等待接手 / 升级处理中` 的触发条件、必带信息与语气定义清楚。
  - `14.4`
    - `任务详情与驾驶舱最小接入 -> 降级执行差异与风险提示` 已把 `degrade_execution` 的 before/after 差异字段组、风险提示规则、与 route diff 的边界写清。
  - `15.1 / 15.2 / 15.3 / 15.4 / 15.5`
    - `任务详情与驾驶舱最小接入` 下新增五节，已分别把恢复快照进入 Mission 快照、服务重启后的 re-attach 顺序、与 `decisionHistory / operator actions / audit` 的关联合同、重连/刷新/重启后的最小继续保证、以及历史恢复记录查询维度与结果面写成明确设计合同。
- 仍不能继续新增勾选的项只剩 `3.2 / 3.3 / 3.4`：
  - 这些条目虽然在 design 中已有目标态识别规则与分类语义，但当前指定证据链里，`goal_deviation / quality_deviation / dependency_failure / recovery_exhausted` 仍缺同等级直接测试闭环，因此本轮继续保持未勾选。

本轮续审结论（2026-04-26，lane 1，classifier 设计收口补审）：

- 基于本轮新增 design 正文，保守新增勾选 `3.2 / 3.3 / 3.4`，并同步收口父任务 `3`，当前 `done / total` 更新为 `103 / 103`。
- 这次新增勾选的性质仍然是“设计合同已直接写清”，不是“分类实现与分类测试已经全部闭环”。换句话说：
  - `goal_deviation / quality_deviation / dependency_failure / recovery_exhausted` 的同等级直接代码+直接测试缺口仍然存在；
  - 但这几个 task 的任务文案本身要求的是“定义识别规则 / 判定条件 / 升级规则”，而非实现落地，因此在 design 已写成显式合同后，可以按设计收口保守补勾。
- 直接设计依据如下：
  - `3.2`
    - `design.md` 新增 `goal_deviation、route_deviation、quality_deviation 的识别规则` 小节，已把三类分类的必须条件、强触发、辅助证据、排除条件与默认投影写成表格，并补了逐类判别规则。
  - `3.3`
    - `design.md` 新增 `governance_deviation、dependency_failure、state_block 的识别规则` 小节，已把治理命中、依赖失效、等待阻塞三类情况的主条件、排除条件与默认投影写成显式合同。
  - `3.4`
    - `design.md` 新增 `recovery_exhausted 的判定条件与升级规则` 小节，已把最小成立条件、耗尽条件、停止静默自动恢复、升级到 takeover / blocked / escalate / terminate 的顺序写清。
  - `3`
    - `design.md` 新增 `分类优先级与冲突消解` 小节，把多分类同时命中时的主分类选择顺序写成统一口径，避免各模块自行漂移。
- 需要以本条最新结论为准：
  - 本文件前面若仍保留“`3.2 / 3.3 / 3.4` 仍不能勾”的历史续审表述，应视为旧审计快照，而不是当前最新状态。
