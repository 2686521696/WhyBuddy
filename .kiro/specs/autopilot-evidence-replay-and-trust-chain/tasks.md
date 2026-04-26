# 任务清单：任务自动驾驶证据回放与信任链

- [x] 梳理现有 `Route`、`Drive State`、`Takeover Point`、Mission Runtime、replay、audit、lineage 相关对象，形成证据链输入事实清单
- [x] 定义统一的 `AutopilotEvidenceChain`、`EvidenceItem`、`DriveTimelineEvent` 基础模型及字段口径
- [x] 定义 `drive_state_change`、`decision`、`route_change`、`takeover`、`tool_call`、`result` 六类核心证据对象的字段与语义边界
- [x] 定义驾驶时间线事件与现有 `Drive State`、Mission Runtime、workflow runtime 状态变化的映射规则
- [x] 定义关键决策证据与 Route 选择、风险判断、结果验收、人工决策之间的关联规则
- [x] 定义路线变化证据与 `replanning`、候选路线切换、步骤保留/失效/新增的表达方式
- [x] 定义接管证据与 `MissionDecision`、`waiting`、`approval`、`resume()`、`escalate()` 链路的映射方式
- [x] 定义工具调用证据与文件、浏览器、API、数据库、沙箱、MCP 工具等资源类型的统一摘要字段
- [x] 定义结果证据与工件、review、audit、verify、验收状态之间的支撑关系
- [x] 定义统一的 `EvidenceCorrelationIndex`，打通 `mission / workflow / route / runtime event / replay / audit / lineage` 的关联键
- [x] 定义从 replay 事件跳转到 audit 记录与 lineage 节点的上下文透传规则
- [x] 定义从 audit 记录和 lineage 节点回溯到驾驶时间线位置的定位规则
- [x] 定义 `TrustProfile`、`TrustMark` 与 `verified / partial / unverified / redacted` 可信状态口径
- [x] 定义证据脱敏、缺口标记、断链标记与可信降级规则，避免把不完整证据显示为完全可信
- [x] 设计服务端证据投影策略，明确哪些证据先由 view model 计算，哪些必须由事件层或服务端重建
- [x] 设计 replay 对统一时间线和关键证据的消费方式，明确关键时间点、偏航、接管与结果切换如何展示
- [x] 设计 audit 对关键决策、接管、权限、预算、风险与验收证据的消费方式
- [x] 设计 lineage 对工具输出、数据依赖、结果支撑和路线切换复用关系的消费方式
- [x] 补充首版验证方案，覆盖时间线重建、证据串联、路线切换解释、接管恢复、结果追溯与可信状态计算
- [x] 为后续驾驶舱、任务详情、回放页、审计页和血缘页提供统一的证据链实现基线

## 审计备注（2026-04-25，限定证据范围复核）

- 本轮只审阅以下直接代码与直接测试：`shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/mission/index.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`。
- 在这组限定证据里，可以稳定确认的完成项只有 5 条：
  - “证据链输入事实清单”：`buildMissionAutopilotSummary()` 直接消费 `mission.events`、`mission.decision`、`mission.decisionHistory`、`mission.operatorActions`、Route candidate/selection/replan 与 projection 上的 `workflowId / replayId / sessionId`，且 shared/server 测试直接覆盖这些输入的投影结果。
  - “接管证据映射”：waiting mission 会投影出 `takeover` 摘要、`route.takeoverPointIds`、`evidence.timeline` 中的接管相关事件、`evidence.correlation.decisionIds`，`server/tests/mission-routes.test.ts` 也直接覆盖 decision submit 后恢复执行。
  - “统一关联索引”：`MissionAutopilotEvidenceCorrelationIndex` 已在 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/mission/index.ts` 中定义和导出，shared/server/client 都直接消费 `missionId / workflowId / replayId / sessionId / timelineId / routeIds / routeStageKeys / runtimeEventIds / decisionIds / operatorActionIds / auditEventIds / lineageIds`。
  - “可信状态口径”：当前已落地最小 `trustLevel` 合同，shared builder 能稳定推导 `verified / partial / unverified / redacted` 枚举口径，测试直接覆盖 `verified / partial / unverified` 与 `gaps`。
  - “服务端证据投影策略”：`server/tasks/mission-projection.ts` 会把 shared builder 产出的 `evidence.trustLevel / gaps / timeline / correlation` 与 `route.evidence` 一并透传，`client/src/lib/tasks-store.ts` 也已 normalize 这些字段。
- 基于你本轮限定的证据范围，以下两项不能继续保留勾选，已回退为未完成：
  - “从 replay 事件跳转到 audit 记录与 lineage 节点的上下文透传规则”：当前限定文件里只能看到 `replayId / auditEventIds / lineageIds` 作为 correlation 字段被定义与透传，但 `auditEventIds`、`lineageIds` 在 builder 中仍固定为空数组，且没有 direct test 证明 replay 事件与 audit / lineage 对象存在正式 links 透传规则。
  - “设计 replay 对统一时间线和关键证据的消费方式”：当前限定文件里只能确认 mission projection 会携带 `replayId` 与 `evidence.timeline` 预览，不能直接证明 replay 路由如何消费统一时间线、如何展示偏航、接管与结果切换。
- 其余未勾选项保持不变，主要缺口如下：
  - 缺少统一 `AutopilotEvidenceChain / EvidenceItem / DriveTimelineEvent` 共享对象，现状仍是 `autopilotSummary.evidence.timeline`、`route.evidence.events`、`evidence.correlation` 并行存在。
  - 缺少路线变化影响范围合同，尚未看到 `preserved / invalidated / added step` 的直接代码与直接测试。
  - 缺少工具调用证据与结果证据合同；限定文件中没有 file/browser/api/database/sandbox/mcp 统一摘要模型，也没有 `ResultEvidence` 式结果追溯结构。
  - 缺少 `audit / lineage -> timeline` 的正式回溯定位规则；当前只能说相关键位被预留或透传，不能说有命中规则。
  - 缺少脱敏、断链和可信降级到 `redacted` 的端到端实现；虽然枚举和 client normalize 支持 `redacted`，但没有 direct test 证明实际产出和消费闭环。
  - 缺少首版验证方案要求的“结果追溯”部分；当前测试主要覆盖 trust、timeline、correlation、takeover，不足以覆盖 result trace。
- 因此，这条 lane 在本轮限定证据下应收口为 `5 / 20`，更准确地表达为“最小任务投影视图层 evidence 合同已存在”，而不是完整 replay / audit / lineage trust chain 已落地。

## 审计备注（2026-04-25，扩围至 replay / observability / client consumer 后复核）

- 本轮在上一轮 `5 / 20` 的严格基线之上，额外审阅以下直接代码与直接测试：`server/routes/replay.ts`、`server/tests/replay-routes.test.ts`、`server/core/web-aigc-runtime-observability.ts`、`server/tests/web-aigc-runtime-observability.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`。
- 在这组扩围证据下，可以安全恢复勾选 1 条：
  - “从 replay 事件跳转到 audit 记录与 lineage 节点的上下文透传规则”：`server/core/web-aigc-runtime-observability.ts` 已把 `workflowId / missionId / instanceId / sessionId / replayId / traceId / requestId / lineageId / artifactId / nodeId / edgeId / decisionId` 统一收敛到 relation links，并同时写入 replay event 的 `eventData.metadata.links` 与 audit record 的 `metadata.links`；`server/tests/web-aigc-runtime-observability.test.ts` 直接断言 replay / audit 两端的 links 对齐，且覆盖 `lineageId / decisionId / replayId`。同时 `server/routes/replay.ts` 与 `server/tests/replay-routes.test.ts` 已证明 replay 路由会暴露 relation index，并支持按 `decisionId / nodeId / stage / eventKey` 查询事件，因此“从 replay 事件出发携带可跳转上下文键”这件事已经成立。
- `client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 进一步证明任务详情消费者已经能 normalize 并展示 `replayId / routeIds / decisionIds / operatorActionIds / auditEventIds / lineageIds / timelineId`。但这组前端证据只说明消费面已具备，不足以单独证明服务端一定会稳定产出全部 `auditEventIds / lineageIds`。
- 因此，这条 lane 在本轮扩围复核后可提升为 `6 / 20`。新增恢复的只有上述 1 条，其余未勾选项仍保持保守口径。
- 仍不能勾选的主因如下：
  - “从 audit 记录和 lineage 节点回溯到驾驶时间线位置的定位规则”仍未成立：当前只有 shared relation links 与 replay filter/index，缺少一条直接代码 + 直接测试去证明 audit / lineage consumer 能反查并命中统一 timeline position。
  - “设计 replay 对统一时间线和关键证据的消费方式”仍未成立：`server/routes/replay.ts` 当前消费的是 replay store 的 execution timeline 与 relation index，不是 `autopilotSummary.evidence.timeline` / `route.evidence` 这套统一自动驾驶证据时间线，也没有直接测试命中“偏航 / 接管 / 结果切换”的展示合同。
  - “设计 audit 对关键决策、接管、权限、预算、风险与验收证据的消费方式”仍未成立：当前直接证据只覆盖 snapshot audit 与 runtime observability mirror，不是 autopilot evidence chain 对 audit 的统一消费面。
  - “设计 lineage 对工具输出、数据依赖、结果支撑和路线切换复用关系的消费方式”仍未成立：当前只有 `lineageId` 级 links 透传，没有 lineage node/object 的直接消费或回放测试。
  - “定义证据脱敏、缺口标记、断链标记与可信降级规则”仍未成立：虽然类型、normalize 与 UI 本身允许 `redacted`，但仍无 direct code + direct test 证明真实 redaction 产出与 trust 降级闭环。
  - “定义工具调用证据”“定义结果证据”“统一 EvidenceChain / DriveTimelineEvent 基础模型”等项仍缺共享对象与端到端测试，不应因为 replay / UI 消费增强而提前勾选。

## 审计备注（2026-04-25，shared correlation 增强后复核）

- 本轮新增审阅的直接代码与直接测试是：`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`，并结合现有 `server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 一起复核。
- 本轮没有新增安全勾选项，这条 lane 继续维持 `6 / 20`。
- 新增事实可以保守确认的是：`shared/mission/autopilot.ts` 里的 `buildEvidenceCorrelationIndex()` 已不再把 `auditEventIds / lineageIds` 固定写死为空数组，而是会从已经存在的 `mission.decision.payload` 与 `mission.decisionHistory[].payload` 中读取 `auditEventIds / auditEntryIds / auditEntryId / auditId / lineageIds / lineageId` 以及 `links / metadata / context / runtime / observability / approval / audit` 壳层里的同名键；`shared/__tests__/mission-autopilot.test.ts` 也新增了直接断言，证明这些已有 mission facts 会被去重后收敛进 `evidence.correlation.auditEventIds / lineageIds`。
- 这组新事实只能进一步加固已勾选的“统一 `EvidenceCorrelationIndex`”完成度，还不足以支撑新的未勾选任务转正，原因如下：
  - 它解决的是 shared builder 对已有 mission/payload 事实的收集问题，不是新的对象模型落地，所以不能推进“统一 `AutopilotEvidenceChain / EvidenceItem / DriveTimelineEvent` 基础模型”。
  - 它补的是 `correlation` 的键收集，不是 replay 路由或 replay 页面对统一时间线的消费，因此不能推进“设计 replay 对统一时间线和关键证据的消费方式”。
  - 它让 `auditEventIds / lineageIds` 在 mission summary 中有机会非空，但仍没有直接代码 + 直接测试证明 audit 页面或 lineage consumer 能从这些键反向定位到统一 `timelineId + timeline item`，因此不能推进“从 audit 记录和 lineage 节点回溯到驾驶时间线位置的定位规则”。
  - `server/tasks/mission-projection.ts` 当前只是把 `summary.evidence.correlation` 继续透传，`client/src/lib/tasks-store.ts`、`TaskAutopilotPanel.tsx` 及其测试也只是把这些键 normalize 并展示为引用/计数；这说明 consumer 面接受增强后的 correlation，但仍不等于 audit / lineage / replay 三个正式消费面已经形成闭环。
  - 新增 shared 测试只覆盖 mission builder 层从 decision payload/history payload 抽取 audit/lineage 键，未覆盖真实 runtime observability 产物如何进入 `MissionRecord`、如何经 mission projection 稳定出现在服务端接口响应中，因此这轮不宜把“服务端 evidence trust chain 已完整打通”外推得更宽。

## 审计备注（2026-04-25，按 design.md 设计闭环口径收口）

- 本轮任务勾选口径切换为“`design.md` 是否已经把对象模型、映射规则、消费方式、可信降级、验证方案与统一实现基线明确写清”，不再以当前代码实现覆盖度作为勾选前提。
- 基于当前 `design.md`，以下设计任务已形成闭环并可安全勾选：统一 `AutopilotEvidenceChain / EvidenceItem / DriveTimelineEvent`、六类核心证据对象、驾驶时间线映射、关键决策与路线变化关联、工具/结果证据、`TimelineLocator`、脱敏/缺口/断链/可信降级、Replay/Audit/Lineage 消费方式、首版验证方案、统一实现基线。
- 因此，本 spec 在 design 维度现可收口为 `20 / 20`。
- 上述多轮 `5 / 20`、`6 / 20` 审计备注继续保留，代表的是**实现证据口径**下的保守判断，不应再用来覆盖本轮 design 收口结论。
