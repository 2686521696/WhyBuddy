# 任务清单：车队状态与实时执行主视图

- [x] 定义 `FleetExecutionView` 投影模型
  - 明确主视图摘要、当前步骤、角色编队、并行分支、阻塞点、中间产物、证据摘要的数据结构
  - 明确与 mission / workflow / runtime 的关联字段

- [x] 定义角色编队映射规则
  - 建立 agent / node / executor 到 `Planner / Clarifier / Researcher / Generator / Reviewer / Auditor / Executor` 的初版映射
  - 设计无法稳定归类时的 `custom` 回退策略

- [x] 定义当前步骤投影规则
  - 明确当前步骤如何从 node run / workflow current state 中推导
  - 明确等待、阻塞、失败、重试、回退时的步骤状态表达

- [x] 定义并行执行投影规则
  - 明确多角色、多节点、多 executor、多子任务的并行展示结构
  - 明确并行分支收敛后的状态归并逻辑

- [x] 定义中间产物模型
  - 明确文本草稿、结构化摘要、文件、图像、链接、代码片段的统一表示
  - 明确中间产物与步骤、角色、artifact 的关联方式

- [x] 定义阻塞点与等待点模型
  - 覆盖澄清、审批、回调、权限、治理、工具失败、executor 异常等阻塞类型
  - 明确阻塞原因、恢复方式和所属责任单元

- [x] 定义执行证据归位策略
  - 明确 logs / artifacts / runtime / callbacks / recent failures 的统一入口
  - 明确主视图与 runtime dock / replay / debug 的边界

- [x] 设计实时更新机制
  - 明确 socket、poll、callback、mission 刷新之间的协同方式
  - 明确增量刷新与延迟加载策略

- [x] 设计与现有 runtime 的兼容层
  - 明确从 mission、workflow instance、node state、agent records、executor state 生成主视图投影的流程
  - 避免要求底层一次性重写 schema

- [x] 设计驾驶舱主视图信息架构
  - 明确顶部摘要、主线步骤条、角色编队区、并行区、中间产物区、阻塞与证据区的布局分工
  - 明确哪些信息属于主线，哪些信息属于辅助区

- [x] 设计用户交互行为
  - 明确角色卡、步骤卡、阻塞卡、中间产物卡、证据入口的展开与跳转方式
  - 明确等待用户接管时的提示行为

- [x] 输出联调样例
  - 提供单线任务样例
  - 提供并行任务样例
  - 提供等待澄清样例
  - 提供 executor 异常与治理阻塞样例

- [x] 补齐测试计划
  - 设计视图投影层单元测试
  - 设计 mission / workflow / runtime 兼容映射测试
  - 设计并行分支、阻塞、恢复、中间产物更新等关键场景测试

- [x] 评估渐进迁移路径
  - 明确如何在不破坏现有任务详情页和 runtime 面板的前提下接入主视图
  - 明确旧入口的降级、收口或复用策略

## 补充审计备注（2026-04-24，Lane 3）

- 当前 client/store/panel 已稳定支撑一条“最小实时执行主视图”链路，但它仍然以 `autopilotSummary.execution / fleet / blockers / outputs / evidence` 的组合字段存在。
- 已有直接代码与测试支撑的真实范围包括：
  - 当前步骤与状态：`currentStepKey / currentStepLabel / currentStepStatus`
  - 并行执行摘要：`parallelBranchCount`
  - 阻塞原因：`blockedReasons`
  - 中间产物摘要：`intermediateDeliverables` 与 `outputs.items`
  - 可执行动作：`availableActions`
  - 车队摘要：`roles / activeRoleCount / blockedRoleCount`
  - 证据摘要：`eventCount / artifactCount / latestEventType / trustLevel / timeline`
- 本轮基于现有 `evidence` 区块、shared/server/client 字段契约和面板测试，可以保守补勾“定义执行证据归位策略”：
  - `TaskAutopilotPanel` 已把 `Evidence` 作为与 `Live Execution / Fleet / Blockers / Outputs` 并列的独立摘要块，承担主视图里的统一证据预览入口
  - 当前 evidence block 已能稳定承载 `eventCount / artifactCount / lastSignal / latestEventType / trustLevel / gaps / timeline / sources`
  - design 中也已明确“主视图不替代 replay / debug / audit”，因此最小边界已经形成：主视图负责把证据拉近到执行上下文，深层证据仍属于后续 runtime dock / replay / debug
- 但其余未勾项仍应保持保守，因为当前实现仍是“最小 live execution view”，而不是完整独立对象/交互模型。

## 补充审计备注（2026-04-25，Lane 3 二次复核）

- 本轮按“直接代码 + 直接测试”标准，复核了以下 8 个 live execution / fleet view 相关文件：
  - `shared/mission/autopilot.ts`
  - `server/tasks/mission-projection.ts`
  - `client/src/lib/tasks-store.ts`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tests/mission-routes.test.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
- 复核结论：本轮未新增勾选任务。
- 当前有直接代码 + 测试闭环支撑的最小事实链路是：
  - `shared/mission/autopilot.ts` 统一产出 `execution / fleet / takeover / recovery / evidence / explanation / bindings`
  - `server/tasks/mission-projection.ts` 把 `buildMissionAutopilotSummary()` 直接接入 `/api/tasks/:id/projection`
  - `client/src/lib/tasks-store.ts` 负责 fallback projection、alias normalization，以及 summary / detail 双写回填
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 把 `Live Execution / Fleet / Blockers / Outputs / Evidence / Explanation / Takeover` 渲染为稳定摘要块
- 直接测试已覆盖的证据口径包括：
  - `shared/__tests__/mission-autopilot.test.ts`：当前步骤、等待接管、失败重试后的 recovery / evidence / explanation / bindings 契约
  - `server/tests/mission-routes.test.ts`：`/projection` 返回的 autopilot summary、takeover、evidence correlation、resolved links 对齐
  - `client/src/lib/tasks-store.autopilot.test.ts`：client fallback projection、alias-style summary 规范化、summary/detail 对齐
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`：`Live Execution / Fleet / Blockers / Outputs / Evidence / Explanation / Takeover` 摘要块展示与 evidence correlation 细节
- 这意味着当前可以稳定确认的字段范围主要是：
  - `execution.currentStepKey / currentStepLabel / currentStepStatus`
  - `execution.parallelBranchCount / blockedReasons / intermediateDeliverables / availableActions`
  - `fleet.roles / activeRoleCount / blockedRoleCount`
  - `takeover.status / required / blocking / type / reason / prompt / options / urgency`
  - `recovery.state / deviationCategory / attemptedActions / suggestedActions / needsHuman / canAutoRecover`
  - `evidence.eventCount / artifactCount / lastSignal / latestEventType / trustLevel / gaps / timeline / correlation`
- 仍不足以把未勾项转为已勾的原因是：
  - `定义 FleetExecutionView 投影模型`：当前落地的是 `MissionAutopilotSummary` 及其子块，不是被代码直接声明和消费的独立 `FleetExecutionView`
  - `定义角色编队映射规则`：稳定产出的仍主要是 `planner / clarifier-or-operator / executor`，没有覆盖 `Researcher / Generator / Reviewer / Auditor` 的端到端映射与测试
  - `定义当前步骤投影规则`：当前已覆盖 `pending / running / waiting / blocked / done / failed`，但未见 `retrying / rollback` 的独立端到端状态落地
  - `定义并行执行投影规则`：当前只有 `parallelBranchCount` 摘要，没有结构化 `parallel lane` 对象与收敛规则
  - `定义中间产物模型`：当前仍是 `intermediateDeliverables` 与 `outputs.items` 级别的摘要聚合，没有统一强类型 output 模型
  - `定义阻塞点与等待点模型`：当前能展示 blocker / takeover / recovery 摘要，但没有统一 blocker type / owner / recoverability 模型
  - `设计用户交互行为`、`输出联调样例`：当前是只读摘要块展示，不是可展开跳转的 execution cockpit，也没有单独维护的联调样例资产
- 补充说明：`client/src/lib/tasks-store.ts` 中确实已经存在 `ensureMissionSocket()`、`applyExecutorEventToRuntimeChannels()`、`patchMissionRecordInStore()`、`queueTasksRefresh()` 等实时更新代码路径；但本轮核对的测试文件没有专门断言 socket patch / delayed refresh 的行为，因此本轮不据此新增任何未勾选任务。

## 补充审计备注（2026-04-25，fleet status 专项复核）

- 本次按用户限定证据链再次核对了以下 8 个文件，且只接受“直接代码 + 直接测试”闭环，不接受推断性补勾：
  - `shared/mission/autopilot.ts`
  - `server/tasks/mission-projection.ts`
  - `client/src/lib/tasks-store.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tests/mission-routes.test.ts`
- 本次专项复核结论仍然是：未新增任何勾选项。
- 当前可以直接确认的最小闭环，仅限于 `shared builder -> server projection -> client normalize/store -> TaskAutopilotPanel -> direct tests` 已稳定覆盖以下 live execution / fleet 摘要字段：
  - `execution.currentStepKey / currentStepLabel / currentStepStatus`
  - `execution.parallelBranchCount / blockedReasons / intermediateDeliverables / availableActions`
  - `fleet.roles / activeRoleCount / blockedRoleCount`
  - `fleet.roles[*].roleType / boundAgents / boundExecutors / currentFocus`
- 之所以仍不安全补勾，是因为当前证据证明的是“已有稳定摘要投影与展示”，还不足以证明以下更强语义已经完整收口：
  - 独立 `FleetExecutionView` 对象及其与 mission / workflow / runtime 的正式投影模型
  - 覆盖 `Planner / Clarifier / Researcher / Generator / Reviewer / Auditor / Executor` 的完整角色映射规则
  - 带 `retry / rollback` 语义的当前步骤投影规则
  - 结构化并行 lane 与分支收敛规则
  - 统一强类型的中间产物模型与 blocker / waiting 模型
  - 可展开跳转的用户交互行为与独立联调样例资产
- 因此本次保持所有未勾选项原样，避免把“字段已存在”误记为“spec 已完整定义”。

## 补充审计备注（2026-04-25，Lane 4 收口）

- 本轮继续按“直接代码 + 直接测试”标准复核后，新增保守勾选：`定义 FleetExecutionView 投影模型`。
- 新增勾选理由：
  - 当前主仓已经有一组稳定、被 shared/server/client/panel 共同消费的组合投影契约：`MissionAutopilotSummary`
  - 这组契约直接覆盖了本任务首版所需的主视图骨架：`destination / driveState / route / execution / fleet / takeover / recovery / evidence / explanation / bindings`
  - `shared/mission/autopilot.ts` 已直接声明这些子块与总的 summary 结构，`buildMissionAutopilotSummary()` 已稳定构建它们
  - `server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts`、`TaskAutopilotPanel.tsx` 与对应测试已形成完整投影闭环
- 这次补勾的限定边界是：
  - 此处的 `FleetExecutionView` 应理解为“首版产品视图组合 contract”，而不是独立导出的全新 runtime schema
  - 它在当前代码中的真实落点是 `MissionAutopilotSummary` 及其子块
  - 它在当前产品中的真实落点是任务详情页里的 summary blocks，而不是完整独立 execution cockpit
- 当前已勾选集合更新为：
  - `1 / 7 / 8 / 9 / 10 / 13 / 14`
- 当前仍不能保守勾选的条目与原因：
  - `定义角色编队映射规则`
    - 仍缺 `Researcher / Generator / Reviewer / Auditor` 的稳定映射与端到端测试。
  - `定义当前步骤投影规则`
    - 仍缺 `retrying / rollback` 的端到端步骤状态落地。
  - `定义并行执行投影规则`
    - 当前只有 `parallelBranchCount`，没有结构化 lane 对象与分支收敛规则。
  - `定义中间产物模型`
    - 当前仍以 `intermediateDeliverables` 与 `outputs.items` 摘要聚合为主，没有统一强类型对象。
  - `定义阻塞点与等待点模型`
    - 当前仍由 `takeover + recovery + blockedReasons` 组合表达，没有统一 blocker type / owner / recoverability 模型。
  - `设计用户交互行为`
    - 当前仍是只读摘要块展示，不是可展开跳转的 execution cockpit。
  - `输出联调样例`
    - 当前没有独立维护的联调样例资产或样例文档。

## 补充审计备注（2026-04-25，Lane 5 设计收口）

- 本轮按“设计收口”而不是“实现收口”推进，新增保守勾选如下：
  - `定义角色编队映射规则`
  - `定义当前步骤投影规则`
  - `定义并行执行投影规则`
  - `定义中间产物模型`
  - `定义阻塞点与等待点模型`
  - `设计用户交互行为`
  - `输出联调样例`
- 本轮补勾依据不是新增代码，而是 `design.md` 已经把以下口径明确写实：
  - 角色编队映射矩阵与 `custom` 回退策略
  - 当前步骤身份/状态双层投影规则，以及 `retrying / rollback` 的设计边界
  - `parallelBranchCount` 到未来 `ParallelLaneSummary[]` 的收敛路径
  - `execution / outputs / destination / artifact` 四类中间产物来源归一
  - `takeover + recovery + blockedReasons` 的 blocker 归并规则
  - 只读摘要优先的交互 contract
  - 单线、并行、等待澄清、executor 异常重规划、治理阻塞 5 类联调样例
- 这批勾选只表示“spec 设计定义已经收口”，不表示“当前主仓工程已经完整落地”。当前工程事实仍然是：
  - `MissionAutopilotSummary` 提供首版组合摘要 contract
  - `TaskAutopilotPanel` 负责只读摘要展示
  - 结构化 `parallel lanes`、typed `blocker / output`、完整角色扩展映射、卡片展开跳转仍属于后续实现工作
- 因此，本任务清单当前可按“文档设计层面已收口”视为全量完成，但后续实现推进仍需继续沿 shared / server / client / tests 补直接证据。
