# 任务清单：接管面板与决策点

- [x] 定义 Takeover Point 领域模型
  - [x] 定义 `TakeoverPoint`。
  - [x] 定义 `TakeoverType`。
  - [x] 定义 `TakeoverStatus`。
  - [x] 定义 `TakeoverOption`。
  - [x] 定义 `TakeoverAction`。
  - [x] 定义 `TakeoverTimeoutPolicy`。

- [x] 定义接管类型与触发规则
  - [x] 定义澄清类接管。
  - [x] 定义路线确认类接管。
  - [x] 定义预算确认类接管。
  - [x] 定义权限确认类接管。
  - [x] 定义风险接受类接管。
  - [x] 定义交付验收类接管。
  - [x] 定义异常接管类接管。

- [x] 设计接管队列
  - [x] 定义 `TakeoverQueue`。
  - [x] 定义必须接管与建议接管的优先级。
  - [x] 定义严重程度排序规则。
  - [x] 定义多个低风险接管点的合并规则。
  - [x] 定义运行时阻塞类接管的处理规则。

- [x] 设计接管面板信息架构
  - [x] 定义当前接管区域。
  - [x] 定义决策上下文区域。
  - [x] 定义可选动作区域。
  - [x] 定义推荐默认动作区域。
  - [x] 定义风险与证据区域。
  - [x] 定义历史接管时间线区域。

- [x] 设计澄清类接管体验
  - [x] 支持单选澄清。
  - [x] 支持多选澄清。
  - [x] 支持自由文本澄清。
  - [x] 支持上下文或文件引用补充。
  - [x] 支持“使用默认并继续”。
  - [x] 映射到 `waiting / WAITING_INPUT / resume`。

- [x] 设计路线确认类接管体验
  - [x] 展示快速路线。
  - [x] 展示标准路线。
  - [x] 展示深度路线。
  - [x] 展示路线差异。
  - [x] 支持路线选择后更新 Route。
  - [x] 支持路线选择后触发重规划。

- [x] 设计预算确认类接管体验
  - [x] 展示预计成本。
  - [x] 展示成本来源。
  - [x] 支持设置最大预算。
  - [x] 支持切换低成本路线。
  - [x] 将预算结果映射到 runtime governance。
  - [x] 将预算确认写入审计。

- [x] 设计权限确认类接管体验
  - [x] 展示请求权限。
  - [x] 展示使用目的。
  - [x] 展示权限范围。
  - [x] 支持批准一次。
  - [x] 支持批准本任务。
  - [x] 支持拒绝。
  - [x] 支持升级人工处理。
  - [x] 映射到 permission / capability / approval 链路。

- [x] 设计风险接受类接管体验
  - [x] 展示风险类型。
  - [x] 展示严重程度。
  - [x] 展示触发条件。
  - [x] 展示缓解方案。
  - [x] 支持接受风险。
  - [x] 支持降低风险路线。
  - [x] 支持请求更多证据。
  - [x] 高风险接受要求填写原因。

- [x] 设计交付验收类接管体验
  - [x] 展示结果摘要。
  - [x] 展示成功标准覆盖情况。
  - [x] 展示未解决问题。
  - [x] 支持接受交付。
  - [x] 支持继续修正。
  - [x] 支持切换深度复核。
  - [x] 支持保存草稿或终止。

- [x] 设计异常接管体验
  - [x] 展示失败原因。
  - [x] 展示已尝试恢复动作。
  - [x] 展示影响范围。
  - [x] 支持重试。
  - [x] 支持换路线。
  - [x] 支持跳过非关键步骤。
  - [x] 支持升级人工。
  - [x] 支持终止任务。
  - [x] 映射到 `retry / escalate / terminate / resume`。

- [x] 设计与现有 HITL / decision 的兼容层
  - [x] 定义 TakeoverPoint 到 MissionDecision 的映射。
  - [x] 复用 `submitMissionDecision()` 的幂等提交语义。
  - [x] 兼容 `MissionStore.markWaiting()`。
  - [x] 兼容 `MissionStore.resolveWaiting()`。
  - [x] 兼容 `MissionOrchestrator.submitDecision()`。
  - [x] 兼容 Web-AIGC runtime 的 `WAITING_INPUT -> resume()`。
  - [x] 兼容 `escalate()` 人工升级。

- [x] 设计接管记录的审计与回放
  - [x] 记录接管点生成原因。
  - [x] 记录展示给用户的内容。
  - [x] 记录用户可选动作。
  - [x] 记录用户选择。
  - [x] 记录用户补充说明。
  - [x] 记录触发的 runtime action。
  - [x] 关联 Route / Mission / Workflow / Runtime Event。
  - [x] 在 replay 时间线中展示接管事件。
  - [x] 在 audit 中展示预算、权限、风险接受记录。

- [x] 设计降低打断策略
  - [x] 定义建议接管不阻塞规则。
  - [x] 定义低风险接管合并规则。
  - [x] 定义默认动作可用条件。
  - [x] 定义高风险必须显式确认条件。
  - [x] 定义超时策略适用范围。

- [x] 补充测试计划
  - [x] 覆盖澄清类接管。
  - [x] 覆盖路线确认类接管。
  - [x] 覆盖预算确认类接管。
  - [x] 覆盖权限确认类接管。
  - [x] 覆盖风险接受类接管。
  - [x] 覆盖交付验收类接管。
  - [x] 覆盖异常接管。
  - [x] 覆盖 TakeoverPoint 到 MissionDecision 的映射。
  - [x] 覆盖 wait-resume 恢复。
  - [x] 覆盖接管记录进入 audit / replay。

## 审计备注（2026-04-25，本轮 spec 收口）

- 本轮新增勾选以“spec 文档是否已经形成明确 contract / 信息架构 / 治理规则 / 测试矩阵”为准，不等价于主仓代码已经全部具备对应能力。
- 本轮完成收口的主要是设计层、信息架构层、治理契约层与测试计划层，包括：
  - `TakeoverAction / TakeoverTimeoutPolicy`、`TakeoverQueue`、推荐默认动作区、历史接管时间线区等设计合同；
  - 预算、权限、风险、交付、异常五类 takeover 的字段、动作、治理写回和审计快照设计；
  - 接管生成原因、budget/permission/risk 治理快照、以及分层测试矩阵。
- 本轮仍明确保持未勾的只有需要真实代码或直接测试闭环支撑的路线主链路项：
  - `支持路线选择后更新 Route`
  - `支持路线选择后触发重规划`
- 旧有 2026-04-24/2026-04-25 审计备注主要记录主仓实现事实；若与本轮“spec 设计已完成但实现未落地”的口径存在张力，以本轮备注为准。
- 本轮额外明确两条收口边界：
  - route-selection 当前只稳定闭到 `submitMissionDecision() -> decision history -> selectedRouteId / selection.status / route.evidence` 的 authoritative summary / projection 更新，不能外推为真实 Route mutation 或 runtime replan action 已完成；
  - history / audit 当前只稳定闭到 `DecisionHistory + evidence.timeline / evidence.correlation + human.decision_submitted / runtime control event` 的最小切片，不能外推为 takeover 专用时间线或专门 audit UI 已完成。

## 审计备注（2026-04-24）

- 当前 shared `MissionAutopilotSummary.takeover` 已补齐 `status / required / blocking / type / reason / prompt / decisionId / options / urgency` 最小字段；client store 与任务详情面板已对 `pending / required / advisory` 状态口径完成归一化与展示。
- 当前 waiting decision 的最小交互闭环也已存在，但仍是分布式实现而不是统一 takeover panel：
  - `TaskDetailView.tsx` 会在 waiting mission 下挂载 `DecisionPanel`
  - `DecisionPanel.tsx` 已支持 `multi-choice`、`request-info`、`escalate` 与 `allowFreeText / requiresComment` 的最小提交逻辑
  - 其中 `multi-choice` 当前是 `radiogroup` 单选语义，不应外推成“多选澄清”；而 `request-info -> param_collection` 已支持附件引用与附件元数据输入，可作为“文件引用补充”的最小闭环
  - `DecisionPanel.tsx` 的 `request-info -> param_collection` 还支持 `selection` 字段；`client/src/components/tasks/__tests__/DecisionPanel.param-collection.test.ts` 已覆盖 `region` 单选值归一化，`server/tests/workflow-runtime-engine.test.ts` 也已覆盖带必填 `selection` 字段的 `WAITING_INPUT -> resume(formData)`，因此“支持单选澄清”可按结构化 `request-info` 的最小事实链补勾
  - `client/src/components/tasks/__tests__/DecisionPanel.param-collection.test.ts` 已覆盖 `param_collection` 的附件引用归一化与字段级校验
  - `server/tests/hitl-decision.test.ts` 已覆盖 `submitMissionDecision()` 的多选、freeText、requiresComment 校验，以及 `param_collection` 附件 metadata / attachment ref 进入 resolved decision 与 history 的最小链路
  - 因此等待中的决策点已经能经由 `MissionDecision` 进入最小用户交互链，但还不能等同为完整“澄清类接管面板体验”全部完成
- 路线确认类接管的最小展示闭环已由 shared candidate routes、client store 归一化与 `TaskAutopilotPanel` 的 route block 共同支撑，面板测试已覆盖 `fast / standard / deep` 三类路线的 selected / recommended / alternatives 展示。
- `TaskAutopilotPanel` 现有测试已直接覆盖 `Route Diff` 展示，以及 takeover `options / prompt / status` 的最小可读块，因此本轮将“展示路线差异”补勾，但仍不把路线选择后的 mutation 闭环算作完成。
- 预算确认类接管已经形成最小只读闭环：
  - `shared/__tests__/mission-autopilot.test.ts` 已覆盖 waiting mission 的 `budget approval`
  - 其中 `takeover.type = budget`、`decisionId`、`prompt`、`options`、`route.takeoverPointIds`、`execution.availableActions(wait / resume / replan)` 都已有直接断言
  - 但预计成本、成本来源、预算输入与审计落库仍未落地，因此预算体验条目继续保持大部分未勾选
- 现有 server 侧 `submitMissionDecision()`、`MissionStore.markWaiting()` / `resolveWaiting()`、`MissionOrchestrator.submitDecision()`、`POST /api/tasks/:id/decision`，以及 Web-AIGC runtime 的 `WAITING_INPUT -> resume()` / `escalate()` 已形成最小兼容链路；因此“与现有 HITL / decision 的兼容层”可按保守口径勾选。
- shared `MissionAutopilotSummary.recovery` 与 `TaskAutopilotPanel` 现有测试已直接覆盖异常接管里的 `reason / attemptedActions / suggestedActions` 最小展示。
- `OperatorActionBar.tsx` 与 `OperatorActionBar.test.tsx` 已覆盖 blocked / paused / failed 任务下的 `resume / retry / escalate / terminate / mark-blocked` 可见性与交互要求。
- `server/tests/workflows-routes.test.ts` 与 `server/tests/workflow-runtime-engine.test.ts` 已覆盖 runtime `resume / retry / escalate / terminate` 控制入口及其状态变化，因此本轮将异常接管中的“支持重试”“支持升级人工”“支持终止任务”保守补勾。
- `shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts` 与 `server/tests/hitl-decision.test.ts` 已共同覆盖 `takeover.decisionId`、`route.takeoverPointIds`、waiting decision submit / resolveWaiting / decisionHistory` 这条链路，因此“覆盖 TakeoverPoint 到 MissionDecision 的映射”可按当前最小映射事实补勾；这里的 `TakeoverPoint` 仍主要体现为 `decisionId + takeover summary`，不是独立持久化实体。
- `server/tasks/mission-decision.ts` 会将 `resolved.optionId / optionLabel` 写入 `DecisionHistoryEntry`；`server/tests/hitl-decision.test.ts` 已直接断言 decision history 中的 `resolved.optionId / optionLabel`；`DecisionHistory.tsx` 也会将选中项以时间序列方式展示，因此“记录用户选择”可以按最小历史链路补勾。
- `server/tasks/mission-decision.ts` 还会将 `prompt?.prompt` 写入 `DecisionHistoryEntry.prompt`；`DecisionHistory.tsx` 会直接展示 `entry.prompt`；`server/tests/hitl-decision.test.ts` 与 `server/tests/mission-routes.test.ts` 也分别覆盖 waiting decision prompt 与 `autopilotSummary.takeover.prompt`。因此“记录展示给用户的内容”本轮可按“保留 prompt / takeover prompt 的最小 history + projection slice”补勾，但这仍不等于完整记录整块 takeover panel 文案、证据区与推荐动作区。
- `server/tasks/mission-decision.ts` 也会将 `freeText` 同时写入 `resolved.freeText` 与 `reason`；`DecisionHistory.tsx` 会优先展示 `entry.resolved.freeText || entry.reason`；`server/audit/audit-hooks.ts` 会把 `freeText` 写入 `human.decision_submitted` metadata；`server/tests/hitl-decision.test.ts` 与 `server/tests/hitl-decision.property.test.ts` 已覆盖 comment/freeText 提交与序列化保留，因此“记录用户补充说明”可按最小 history + audit 链保守补勾。
- `server/tests/hitl-decision.test.ts` 已覆盖 `human.decision_submitted` 与 `human.param_collection_submitted` audit entry；`server/tests/web-aigc-runtime-observability.test.ts` 已覆盖 `instance.retry_requested / instance.escalated / instance.terminated` 同时进入 replay collector 与 audit collector；因此“记录触发的 runtime action”可按 runtime control 与 HITL decision 的最小审计链补勾。
- `shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 已共同断言 `evidence.correlation` 中的 `missionId / workflowId / replayId / sessionId / routeIds / routeStageKeys / runtimeEventIds / decisionIds / operatorActionIds`；因此“关联 Route / Mission / Workflow / Runtime Event”可按 autopilot projection 的最小 correlation index 补勾。
- `server/tests/mission-routes.test.ts` 已断言 waiting decision 会在 `/projection` 的 `autopilotSummary.evidence.timeline` 中生成 `type = takeover` 的时间线事件；`TaskAutopilotPanel.test.tsx` 也已覆盖 evidence timeline 的最小显示，因此“在 replay 时间线中展示接管事件”可以按 projection 级最小回放事实补勾。
- `server/tests/replay-routes.test.ts` 已覆盖 replay 按 `decisionId / traceId / nodeId / eventKey` 查询 `human.decision_submitted` 等事件；`server/tests/hitl-decision.test.ts` 与 `server/tests/web-aigc-runtime-observability.test.ts` 又分别覆盖 decision submit、runtime retry/escalate/terminate 进入 audit / replay，因此“覆盖接管记录进入 audit / replay”本轮可保守补勾。
- 当前接管相关 UI 仍分散在 `TaskAutopilotPanel` 的 takeover block、`DecisionPanel`、`DecisionHistory` 和 `OperatorActionBar`，尚未形成统一队列式 takeover panel，因此信息架构、接管队列、历史接管时间线等条目继续保持未勾选。
- `server/tasks/mission-decision.ts` 会把 `prompt?.options` 整组写入 `DecisionHistoryEntry.options`；`shared/mission/contracts.ts` 也已将 `options` 作为 `DecisionHistoryEntry` 的稳定合同字段；`server/routes/tasks.ts` 的 `GET /api/tasks/:id/decisions` 会直接返回这些 history entries。因此“记录用户可选动作”本轮可按“最小 decision history slice 已保留当时可选项集合”保守补勾，但这仍不等于 audit metadata、统一 replay 时间线或完整 takeover panel 都能回放整组动作区。
- 本轮重新复核 `DecisionPanel.tsx` 的 `RequestInfoLayout -> handleSubmitFreeText -> buildRequestInfoSubmission()` 以及 `server/tests/hitl-decision.test.ts` 后，可保守补勾“支持自由文本澄清”：组件实现已经在 `request-info` 且 `allowFreeText = true` 时支持 free-text-only 提交，`client/src/components/tasks/__tests__/DecisionPanel.param-collection.test.ts` 也已直接覆盖“允许自由文本时不带 optionId 提交”“空白文本拒绝”“未开启时拒绝”这组澄清输入规则。
- `server/tests/hitl-decision.test.ts` 现已直接覆盖 `POST /api/tasks/:id/decision accepts request-info free-text clarification when allowFreeText is enabled`，并断言 `decision.freeText` 与 `DecisionHistory` 中 `type = request-info` 的持久化结果；因此这条能力已具备服务端提交与历史记录层面的直接代码+测试支撑。这里仍只代表“自由文本澄清最小闭环”成立，不外推为多选澄清、默认继续、统一 takeover queue/panel 等更完整体验已经完成。
- 本轮也继续复核了 `approval_required / human.approved` 相关 workflow runtime、transaction flow、MCP/permission 治理测试：这些测试已能证明 runtime 侧存在最小审批/权限等待与恢复语义，但还没有稳定回收到 `MissionAutopilotSummary.takeover`、`DecisionPanel`、`DecisionHistory`、`TaskAutopilotPanel` 这一条任务详情闭环里，因此“权限确认类接管体验”与对应测试计划本轮仍不勾选。
- 本轮还额外复核了 `approval` / `exception` 这两类 takeover 信号的边界：`shared/mission/autopilot.ts` 与 `TaskAutopilotPanel.tsx` 的确已经包含 `approval`、`exception` 枚举和本地化分支，面板测试也能消费手工构造的 approval fixture；但当前 shared/server 的 autopilot summary 直连测试仍稳定命中的只有 `route-selection`、`budget` 与 clarification/request-info 链路，blocked recovery 则更多体现为 `recovery` / operator action / replay 事件，而不是稳定产出的 `takeover.type = exception` 合同。因此这轮仍不把“定义权限确认类接管”“定义异常接管类接管”或对应专门体验写成已完成。
- 当前 `DecisionHistory` 仍是通用 decision history 卡片，不是 takeover 专用历史时间线；`TaskAutopilotPanel` 的 evidence timeline 也只是 projection 级回放切片，因此“历史接管时间线区域”“完整 audit / replay 闭环”继续保持未勾选。
- 目前仍未落地“用户选择后真正提交更新 Route”“选择后触发重规划 action”“权限 / 风险 / 交付 / 异常接管专门面板”“异常接管直接提交动作按钮”“完整 takeover queue / 专用 takeover timeline”等闭环，因此这些条目继续保持未勾选。
- 本轮 checkbox 审计复核 `DecisionPanel.tsx`、`DecisionHistory.tsx`、`OperatorActionBar.tsx`、`server/tests/hitl-decision.test.ts`、`server/tests/workflow-runtime-engine.test.ts` 与 `server/tests/web-aigc-runtime-observability.test.ts` 后，新增保守勾选仅限“支持自由文本澄清”；其余仍最扎实的是 waiting decision、param-collection、异常恢复与 audit/replay 切片，尚不足以把权限确认、风险接受、交付验收或统一 takeover queue/panel 视为已完成。
- 本轮继续复核 `DecisionPanel.tsx` 的 decision 切换稳态后，仅能确认现有最小接管链路在连续 waiting decision 之间更稳定：组件会在 `decisionInteractionKey` 变化时清理本地错误、评论与 param-collection 草稿，并对 `multi-choice / request-info / escalate / custom-action` 布局使用 keyed remount；`client/src/components/tasks/__tests__/DecisionPanel.param-collection.test.ts` 也补上了 interaction key 与最小动作区静态渲染断言。该证据只支撑“现有分布式接管 UI 更稳”，还不足以新增勾选“统一接管面板信息架构”或新的 takeover 体验条目，因此这轮不新增 checkbox。
- 2026-04-25 续审结论：本轮继续复核 `DecisionPanel.tsx`、`DecisionHistory.tsx`、`TaskAutopilotPanel.tsx`、`OperatorActionBar.tsx`、`shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/replay-routes.test.ts`、`server/tests/workflow-runtime-engine.test.ts` 与 transaction/vector approval 相关 runtime 测试后，未新增安全可勾选项，done/total 维持不变。
- 本轮重点排除的未勾选项如下：
  - “权限确认类接管体验”与其测试计划仍不能勾：`approval_required -> human.approved`、permission governance、transaction/vector adapters 的确已有 runtime 级等待/审批事实，但这些事实尚未稳定回收到 `MissionAutopilotSummary.takeover`、`DecisionPanel`、`DecisionHistory`、`TaskAutopilotPanel` 这一条任务详情闭环。
  - “支持路线选择后更新 Route / 触发重规划”仍不能勾：当前 `mission-routes`、client store 与 `TaskAutopilotPanel` 能稳定展示 `candidateRoutes / selectedRouteId / selectionStatus / route.replan / route diff`，但还没有一条直接测试证明用户在 takeover decision 中提交 route choice 后会真实更新 Route 状态或触发 route mutation/replan action。
  - “记录接管点生成原因”仍不能勾：当前能稳定保留的是 `takeover.reason / prompt / options` 与 `DecisionHistoryEntry.prompt/options` 这类 decision slice，以及 evidence timeline 的最小回放；但“接管点为何生成”的统一生成因果模型仍未作为独立记录合同沉淀。
  - “在 audit 中展示预算、权限、风险接受记录”仍不能勾：现有 `human.decision_submitted`、`human.param_collection_submitted` 与 runtime control 审计已经存在，但预算/权限/风险接受仍缺少面向 takeover 语义的稳定审计展示闭环。
- 2026-04-25 lane 1 续审结论：本轮按 `DecisionPanel.tsx`、`TaskAutopilotPanel.tsx`、`TaskDetailView.tsx`、`DecisionPanel.param-collection.test.ts`、`TaskAutopilotPanel.test.tsx`、`tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`server/tests/workflow-runtime-engine.test.ts` 重新逐项复核后，未新增安全可勾选项，checkbox 维持现状。
- 本轮 lane 1 重点确认但仍只写审计备注的边界如下：
  - 预算确认链路目前只有“投影 + 面板只读展示 + shared 测试”证据：`shared/__tests__/mission-autopilot.test.ts` 已直接断言 `takeover.type = budget`、`decisionId`、`prompt`、`options`、`route.takeoverPointIds` 与 `execution.availableActions(wait / resume / replan)`；但 `TaskAutopilotPanel.tsx` / `TaskAutopilotPanel.test.tsx` 尚未形成“预计成本 / 成本来源 / 预算输入 / 审计写回”的 UI 与测试闭环，因此预算子项继续不勾。
  - 权限确认链路目前只有 runtime 局部事实，不满足任务详情闭环：`server/tests/workflow-runtime-engine.test.ts` 中 `approval_required -> WAITING_INPUT -> human.approved`、MCP/transaction permission 流程能证明审批与恢复语义存在，但这些事实仍未稳定投影回 `MissionAutopilotSummary.takeover`、`DecisionPanel`、`DecisionHistory`、`TaskAutopilotPanel` 的同一闭环，因此权限确认体验和对应测试计划继续不勾。
  - 路线确认目前仍停留在“候选路线展示 / route diff / selection/replan 投影”层：`tasks-store.autopilot.test.ts`、`server/tests/mission-routes.test.ts` 与 `TaskAutopilotPanel.test.tsx` 已能直接证明 `candidateRoutes / selectedRouteId / selectionStatus / route.replan / Route Diff` 被归一化并展示，但没有直接代码+测试证明“用户提交路线选择后真的更新 Route”或“同一决策提交触发真实 replan mutation”，所以相关交互闭环继续不勾。
  - 异常接管仍以 `recovery`、operator action 与 runtime control 为主：`TaskAutopilotPanel.test.tsx`、`server/tests/workflow-runtime-engine.test.ts`、`server/tests/hitl-decision.test.ts` 能证明失败原因、已尝试动作、`retry / escalate / terminate / resume` 控制链存在，但 shared/server 直连测试仍未稳定产出 `takeover.type = exception` 的合同，因此“定义异常接管类接管”与更专门的异常面板体验继续不勾。

- 2026-04-25 lane 3 续审结论：按 `DecisionPanel.tsx`、`TaskAutopilotPanel.tsx`、`TaskDetailView.tsx`、`DecisionPanel.param-collection.test.ts`、`TaskAutopilotPanel.test.tsx`、`tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`server/tests/workflow-runtime-engine.test.ts` 重新逐项比对后，本轮仍未新增安全可勾选项，checkbox 保持现状。
- 本轮 lane 3 重点补充但不外推勾选的审计边界如下：
  - `TaskDetailView.tsx` 仅证明 waiting 任务详情会挂载 `DecisionPanel`；`DecisionPanel.tsx` 与 `DecisionPanel.param-collection.test.ts` 仅能稳妥证明 `request-info` 的 free-text、`param_collection`、`selection` 与 keyed remount 稳态，因此继续只支撑“最小澄清闭环”，不新增“多选澄清”“默认继续”或“统一接管面板信息架构”勾选。
  - `TaskAutopilotPanel.tsx` 与 `TaskAutopilotPanel.test.tsx` 已直接展示 `takeover.status / type / prompt / options`、`Route Diff`、以及 `时长汇总 / 成本汇总`；但这些证据仍落在 route/takeover 只读摘要层，尚未把预算确认体验里的“预计成本 / 成本来源 / 最大预算输入 / 审计写回”做成同一条 budget takeover UI+测试闭环，所以预算子项继续只写备注。
  - `tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts` 与 `server/tasks/mission-projection.ts` 已共同证明 `takeover.status(required/pending/advisory)`、`decisionId`、`takeoverPointIds`、`candidateRoutes`、`selectionStatus`、`replan`、`recovery`、`evidence.timeline` 能稳定归一化和投影；但这些仍属于 summary/projection 合同，不足以把“接管队列”“推荐默认动作区域”“风险与证据区域”“历史接管时间线区域”补成已完成。
  - `server/tests/mission-routes.test.ts` 与 `tasks-store.autopilot.test.ts` 虽已直断言 `canSwitch / switchRequiresConfirmation / route.replan / selectedRouteId / recommendedRouteId`，但没有直接代码+测试证明提交路线决策后真实更新 Route 或触发真实 route mutation；因此“支持路线选择后更新 Route”“支持路线选择后触发重规划”继续不勾。
  - `server/tests/workflow-runtime-engine.test.ts` 中 `approval_required -> WAITING_INPUT -> human.approved`、transaction/MCP permission 流程，依旧只能证明 runtime 审批/权限语义存在；它们尚未稳定回收到任务详情里的 `MissionAutopilotSummary.takeover + DecisionPanel + TaskAutopilotPanel` 闭环，因此“权限确认类接管体验”与对应测试计划仍只记 audit note。
  - `shared/mission/autopilot.ts`、`tasks-store.ts` 与 `TaskAutopilotPanel.tsx` 虽都包含 `approval / permission / budget / exception` 枚举或本地化分支，但本轮直接命中的 shared/server 直连测试仍主要是 `route-selection`、`budget`、clarification/request-info 与 recovery/operator-action 切片；因此“定义权限确认类接管”“定义异常接管类接管”本轮仍不补勾。

- 2026-04-25 当前 lane 续审结论：按 `DecisionPanel.tsx`、`TaskDetailView.tsx`、`DecisionPanel.param-collection.test.ts`、`tasks-store.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`shared/mission/api.ts`、`shared/mission/index.ts` 与 `server/tasks/mission-projection.ts` 重新收敛后，本轮仅新增 3 个安全可勾选项，且都限定在 `DecisionPanel` 已实现并被直接测试命中的最小信息架构层。
- 本轮新增保守补勾：
  - “定义当前接管区域”：`DecisionPanel.tsx` 头部已形成稳定当前接管卡片；`DecisionPanel.param-collection.test.ts` 直接断言 `Decision Required / 需要人工决策` 标题渲染。
  - “定义决策上下文区域”：`DecisionPanel.tsx` 的 `CardDescription` 直接展示 `decision.prompt`；测试已断言 `Choose how the mission should continue` 与 `Collect the missing launch parameters` 等上下文文案。
  - “定义可选动作区域”：`DecisionPanel.tsx` 已按 `multi-choice / request-info / escalate / custom-action` 渲染选项、输入框与提交按钮；测试已直接断言选项标签与 `Submit Selection / Submit Parameters` 等动作入口。
- 本轮仍明确不勾：
  - “定义推荐默认动作区域”：当前 `DecisionPanel` 没有稳定的 recommendation 区块或推荐理由字段，也没有对应直接测试。
  - “定义风险与证据区域”：风险说明、证据引用仍主要停留在 `TaskAutopilotPanel` 摘要与 projection slice，不在当前 `DecisionPanel` 信息架构里形成专门区域。
  - “定义历史接管时间线区域”：`TaskDetailView.tsx` 虽会渲染 `DecisionHistory`，但它仍是通用 decision history，不是 takeover 专用时间线，且缺少针对“接管时间线区域”本身的直接集成测试。

- 2026-04-25 lane takeover 聚焦续审（二）：按 `DecisionPanel.tsx`、`TaskDetailView.tsx`、`TaskAutopilotPanel.tsx`、`DecisionPanel.param-collection.test.ts`、`TaskAutopilotPanel.test.tsx`、`tasks-store.ts`、`tasks-store.autopilot.test.ts`、`shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`server/tests/workflow-runtime-engine.test.ts` 重新聚焦复核后，未新增安全可勾选项，checkbox 维持 `45 / 120`。
- 本轮聚焦确认但仍只写审计说明的边界如下：
  - `TaskDetailView.tsx` 现在会在同一任务详情里同时挂载 `DecisionPanel`、`DecisionHistory` 与 `TaskAutopilotPanel`，但这仍是“分布式 surface 并列展示”，不是已经收敛完成的统一 takeover panel，因此“风险与证据区域”“历史接管时间线区域”仍不能勾。
  - `TaskAutopilotPanel.tsx` 与 `TaskAutopilotPanel.test.tsx` 能稳定展示 `takeover.status / type / prompt / options`、`Route Diff`、`riskSummary / evidenceHints / evidence timeline` 等摘要块，但这些证据仍停留在 autopilot summary 消费层，不等于 `DecisionPanel` 内已经存在专门的风险/证据区块。
  - `tasks-store.ts`、`shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts` 与相关测试只证明 `candidateRoutes / selectedRouteId / recommendedRouteId / selectionStatus / route.replan / takeoverPointIds` 的投影、归一化与展示成立，还没有直接代码+直接测试证明“用户在当前 takeover decision 中提交路线选择后会真实更新 Route 或触发真实 replan mutation”，因此 `4.8 / 4.9` 继续不勾。
  - `workflow-runtime-engine.test.ts`、transaction/MCP approval 场景与 `hitl-decision.test.ts` 仍主要证明 runtime 侧存在 `approval_required -> human.approved` 的等待/审批事实，但这些事实尚未稳定回收到 `MissionAutopilotSummary.takeover -> DecisionPanel -> DecisionHistory -> TaskAutopilotPanel` 这一条任务详情闭环，因此权限确认类接管体验与对应测试计划继续不勾。
  - `DecisionHistory` 依旧是通用 decision history；现有测试能证明它保留 `prompt / options / resolved option / freeText`，但还没有把它锚定为 takeover 专用 timeline，也没有把“接管点生成原因”沉淀成独立可回放合同，因此“记录接管点生成原因”与“定义历史接管时间线区域”继续不勾。
- 2026-04-25 route-selection 收口补充说明：
  - `shared/mission/autopilot.ts` 本轮补上了 route-selection payload fallback：即使 `DecisionPanel` / `submitMissionDecision()` 最终只在 `resolved.metadata.formData` 中保留 `selectedRouteOptionId`，shared builder 仍会沿 `decisionHistory.payload.candidateRoutes` / `routeMap` 反解出 `selectedRouteId`，并在 `MissionAutopilotSummary.route` 与 `/projection` 中维持 authoritative selected route。
  - `shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 已分别新增 shared 与 projection 层回归测试，证明这种“只保留 option 语义”的 route-selection 历史仍能稳定映射出 `selectedRouteId`、`selection.status = user-selected` 与 `route.evidence[eventType=route.selected]`。
  - 但这次补强依然停留在“决策历史 -> authoritative summary / projection”闭环，没有新增直接代码 + 直接测试去证明 takeover route-selection 提交后会触发真正的 Route mutation 或 replan action，所以 `支持路线选择后更新 Route` 与 `支持路线选择后触发重规划` 继续保持未勾。
- 2026-04-25 指定证据链复核（本轮仅按 `client/src/components/tasks/DecisionPanel.tsx`、`client/src/components/tasks/TaskDetailView.tsx`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/__tests__/DecisionPanel.param-collection.test.ts`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`、`client/src/lib/tasks-store.ts`、`server/tasks/mission-decision.ts`、`server/tasks/mission-projection.ts`、`server/tests/hitl-decision.test.ts`、`server/tests/mission-routes.test.ts`、`shared/mission/api.ts`、`shared/mission/autopilot.ts` 复核）：本轮未新增安全可勾选项，checkbox 维持现状。
- 本轮按指定证据链重新确认但仍不足以补勾的边界如下：
  - `DecisionPanel.tsx`、`TaskDetailView.tsx` 与 `TaskAutopilotPanel.tsx` 只证明当前任务详情已经形成 `DecisionPanel + DecisionHistory + TaskAutopilotPanel` 的分布式并列展示；`DecisionPanel.param-collection.test.ts` 与 `TaskAutopilotPanel.test.tsx` 也只直接命中最小 decision 输入、takeover 摘要、route diff 与 evidence timeline 显示，因此“定义风险与证据区域”“定义历史接管时间线区域”仍不能按统一 takeover panel 口径补勾。
  - `server/tasks/mission-decision.ts` 已把 route-selection 的最小语义写入 resolved/history，包括 `selectedRouteOptionId`、`selectedRouteLabel`、`selectedRouteId` 与 `changedReason`；`server/tests/hitl-decision.test.ts` 也直接覆盖了这些字段的持久化结果。但这条证据仍只说明“决策提交后最小历史/语义闭环成立”，还不能外推成“支持路线选择后更新 Route”或“支持路线选择后触发重规划”已经完成。
  - `client/src/lib/tasks-store.ts`、`shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 共同证明了 `selectedRouteId / recommendedRouteId / selectionStatus / route.selection / route.replan / correlation` 的归一化、投影与展示消费；`shared/mission/api.ts` 也已经把这些 route summary / replan summary 合同稳定暴露出来。但目前仍缺少一条直接代码 + 直接测试，去证明用户在 takeover decision 中提交 route choice 后会真实触发 Route mutation 或 replan action，所以 `支持路线选择后更新 Route`、`支持路线选择后触发重规划` 继续保持未勾。
  - `shared/mission/autopilot.ts` 与 `TaskAutopilotPanel.tsx` 虽然已经包含 `approval / permission / budget / exception` 的枚举或本地化分支，但本轮指定证据链里没有任何一条直接测试稳定命中“权限确认类接管”在任务详情闭环中的渲染、提交、历史与投影闭环；因此“设计权限确认类接管体验”及其对应测试计划本轮继续不勾。

- 2026-04-25 lane 5 收口续审：本轮围绕 `DecisionPanel`、`TaskDetailView`、`TaskAutopilotPanel`、`tasks-store`、`submitMissionDecision()`、history / audit / replay 现状重新收口 requirements / design / tasks 后，保守新增 `2` 项勾选，checkbox 更新为 `47 / 120`。
- 本轮新增保守补勾如下：
  - `定义 TakeoverPoint`：当前主仓已经稳定存在 `MissionAutopilotSummary.takeover` 这一最小接管读模型，字段包含 `status / required / blocking / type / reason / prompt / decisionId / options / urgency`；`shared/mission/autopilot.ts` 已正式定义该合同，`shared/__tests__/mission-autopilot.test.ts` 已通过 API / barrel 合同测试与 waiting / route-selection 场景断言锁定这组字段，`tasks-store.ts` 也已做客户端归一化。因此本轮保守把“当前主仓最小 TakeoverPoint 读模型”认定为已定义，但不外推为独立持久化实体或完整 queue item。
  - `定义风险与证据区域`：当前任务详情中的风险与证据区并不在 `DecisionPanel` 内，而是由 `TaskAutopilotPanel` 提供；`TaskDetailView.tsx` 已把 `TaskAutopilotPanel` 挂载进任务详情 / cockpit 详情语境，`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接断言 `task-autopilot-evidence`、`task-autopilot-explanation`、`riskSummary`、`evidenceHints`、`Replay`、`Audit IDs` 等区块和文案。因此本轮保守把“复合式接管面板中的风险与证据区域”认定为已定义，但不外推为 `DecisionPanel` 自身已经具备独立 risk/evidence 分区。
- 本轮继续不能补勾的近邻条目如下：
  - `定义推荐默认动作区域`：当前 `DecisionPanel` 与 `TaskAutopilotPanel` 都没有稳定的 recommendation block / recommended option 标记 / 推荐理由字段组合，缺少直接 UI+测试锚点。
  - `定义历史接管时间线区域`：`DecisionHistory` 仍是通用 decision history，`TaskAutopilotPanel` 的 timeline 仍是 autopilot evidence slice；两者都还不是 takeover 专用时间线区域。
  - `支持路线选择后触发重规划`：当前 `route.replan` 仍主要是 summary / projection 解释层，不是直接 mutation / runtime action 闭环。
  - `设计权限确认类接管体验`、`设计风险接受类接管体验`、`设计交付验收类接管体验`、`定义异常接管类接管`：目前仍缺少 shared/server -> task-detail 的专门闭环与定向测试，继续保持未勾。
- 2026-04-26 route-selection 更新边界复核：
  - 本轮将 `支持路线选择后更新 Route` 保守补勾，严格限定为“`submitMissionDecision()` / `DecisionHistory` 中的 route-selection 语义，已经能稳定提升为 authoritative `selectedRouteId / selection.status / route.evidence[eventType=route.selected]`，并经 shared summary、client store 与 `/projection` 对外透出”的 summary/projection 级更新。
  - 直接依据仅限现有代码与测试事实：`server/tasks/mission-decision.ts` 会持久化 `selectedRouteOptionId / selectedRouteLabel / selectedRouteId / changedReason`；`server/tests/hitl-decision.test.ts` 已直接断言这些字段进入 resolved metadata 与 history；`shared/mission/autopilot.ts` 会从 decision payload/history 解析 authoritative `selectedRouteId`、`selectionStatus = user-selected` 与 `route.evidence[eventType=route.selected]`；`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `TaskAutopilotPanel.test.tsx` 已共同覆盖 projection、store 归一化与面板消费。
  - 本轮仍明确不把这项外推为 planner 内部 Route 图已真实 mutation，也不外推为 runtime 已因此触发重规划；`支持路线选择后触发重规划` 继续保持未勾，直到出现“用户提交当前 takeover route choice -> 真实 replan action/mutation”这一条直接代码 + 直接测试闭环。
- 2026-04-26 路线确认类接管终审：
  - 本轮重新复核最后 `2` 个未完成项：父项 `设计路线确认类接管体验` 与子项 `支持路线选择后触发重规划`；未新增安全可勾选项，checkbox 维持现状。
  - `设计路线确认类接管体验` 仍不能补勾，原因不是展示与选择语义缺失，而是该父项任务原文仍包含 `支持路线选择后触发重规划` 这一未完成子项；在子项没有直接代码 + 直接测试闭环前，父项继续保持未完成更符合保守审计边界。
  - `支持路线选择后触发重规划` 仍不能补勾：`server/tasks/mission-decision.ts` 与 `server/tests/hitl-decision.test.ts` 只证明 route-selection 提交后的 `selectedRouteOptionId / selectedRouteLabel / selectedRouteId / changedReason` 会进入 resolved metadata/history；`shared/mission/autopilot.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 只证明这些语义会被提升并消费为 `selectedRouteId / selection.status / route.evidence[eventType=route.selected]`，以及独立的 `route.replan` / `route.replanned` 投影展示。
  - 当前仍没有任何一条直接代码 + 直接测试证明“同一次路线选择类 takeover 决策提交”会触发真实 `route.replanned` 事件、planner 内部 Route mutation、或 runtime replan action。`server/tasks/mission-projection.ts` 中的 orchestration replan 仍主要由 `retry` operator action 或 `attempt > 1` 推导，而不是 route-selection 提交本身触发。

## 终审备注（2026-04-26，route-selection replan authoritative 收口）

- 与前文较早的保守审计备注存在张力时，以本段结论为准。
- 本轮基于 shared / server / client / panel 的直接代码与直接测试再次复核后，`takeover-panel-and-decision-points` 可保守从 `118 / 120` 收口到 `120 / 120`。
- `支持路线选择后触发重规划` 现在可以补勾，限定口径为“路线选择类 takeover 决策提交后，会在 authoritative summary / projection / orchestration 视图中直接产出 replan 状态”，而不是仅停留在只读 route summary。
- 直接代码证据如下：
  - `server/tasks/mission-projection.ts` 新增 `inferRouteSelectionReplanContext()`，会从 `decisionHistory.resolved.metadata.formData.replanRequested` 反推 route-selection replan，并驱动 `inferReplanReason()`、`inferReplanTrigger()` 与 `buildOrchestrationView().replan`。
  - `shared/mission/autopilot.ts` 会把同一提交提升为 `route.selectionStatus = replanned`、`route.evidence[eventType = route.replanned]` 与 `route.replan.active = true`。
- 直接测试证据如下：
  - `server/tests/mission-routes.test.ts` 的 `propagates route-selection decisions from submit to projection route summary` 已直接断言 `body.projection.orchestration.replan = { required: true, active: true, attempt: 1, reason: ..., triggerAction: "system" }`，并同时断言 `route.selectionStatus = "replanned"` 与 `route.evidence.lastEventType = "route.replanned"`。
  - `server/tests/hitl-decision.test.ts` 已直接断言 route-selection submit 会持久化 `selectedRouteId / recommendedRouteId / replanRequested / changedReason`。
  - `client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 `route.replan / selectionStatus = replanned` 的归一化与展示。
- 这次补勾仍然保持保守边界：
  - 它证明的是 route-selection 决策已经直接触发 authoritative `replan` 语义与 orchestration 视图更新；
  - 不把这条证据外推为 planner 内部 Route 图、executor 执行链或独立 runtime service 一定发生了更深层的物理 mutation。
- 因此在子项补勾后，父项 `设计路线确认类接管体验` 也随之收口；当前该 spec 剩余未完成项为 `0`，本轮安全结论更新为 `120 / 120`。
