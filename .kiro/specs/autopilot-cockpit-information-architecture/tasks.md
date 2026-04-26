# 任务清单：任务自动驾驶驾驶舱信息架构

- [x] 梳理现有 `mission-first`、`office-task-cockpit`、`task-runtime-visibility`、`replay`、`audit` 页面中的信息块，形成可复用清单
- [x] 定义三栏驾驶舱的一/二级信息块，明确哪些内容默认展示、哪些内容二级下钻
- [x] 输出左侧“目标与路线栏”的内容结构，包括目的地卡片、路线卡片、阶段进度和风险提示
- [x] 输出中间“执行主视图”的内容结构，包括编队状态、执行阶段、中间产物和事件摘要
- [x] 输出右侧“接管与证据栏”的内容结构，包括 HITL 决策、待确认事项、审计摘要和回放入口
- [x] 定义 `mission / workflow / projection / session` 到驾驶舱信息块的映射关系
- [x] 定义 `Mission Runtime` 状态到驾驶舱执行态文案与标签的映射规则
- [x] 定义 `selection / param_collection / user_input / confirm_judge` 到统一接管面板的映射方式
- [x] 定义驾驶舱与 `replay / audit / lineage` 的跳转入口、上下文透传参数和证据摘要规则
- [x] 输出首版桌面端布局约束，明确三栏宽度策略、折叠策略和最小可用展示顺序
- [x] 为后续驾驶舱 UI 原型、前端实现和多任务扩展 spec 提供统一信息架构基线

## 审计备注：2026-04-24

- 当前主仓还没有完整独立的“三栏驾驶舱”页面，但已经有一条可复用的 P1 驾驶舱交互切片：`TaskDetailView` 中接入的 `TaskAutopilotPanel`。
- `TaskAutopilotPanel` 当前已经按信息优先级拆出以下稳定区块：
  - `Destination`
  - `Route`
  - `Live Execution`
  - `Drive State`
  - `Fleet`
  - `Blockers`
  - `Recovery`
  - `Outputs`
  - `Evidence`
  - `Explanation`
  - `Takeover`
- 其中左侧“目标与路线栏”的最小内容结构已经有直接代码与测试支撑，因此本轮保守勾选：
  - `Destination` 区块承载目标摘要、约束、成功标准、交付物、缺失信息
  - `Route` 区块承载已选路线、推荐路线、备选路线、当前阶段、进度、风险提示、选择状态与重规划摘要
- `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖：
  - 目标与路线的基础展示
  - 共享/客户端 `autopilotSummary` 结构的直接消费
  - 路线推荐、备选路线、阶段进度、风险提示、重规划与 route evidence 的展示
  - `TaskDetailView` 中的接入
- 当前仍不能保守勾选的项包括：
  - 右侧“接管与证据栏”的完整内容结构，尤其是 replay / audit / lineage 入口与右栏稳定编排
  - 完整三栏主骨架与宽度/折叠策略
  - 统一接管面板对 `selection / param_collection / user_input / confirm_judge` 的完整映射
  - replay / audit / lineage 跳转入口与上下文透传
- 原因是：现状仍是任务详情中的最小驾驶舱摘要面板，而不是完整独立的 cockpit 页面；接管、证据和外链入口也还没有形成完整交互闭环。
- 本轮还可以保守补勾“梳理现有 `mission-first`、`office-task-cockpit`、`task-runtime-visibility`、`replay`、`audit` 页面中的信息块，形成可复用清单”：
  - `TaskDetailView` 已在 `default` 与 `cockpit` 两种 detail 变体中稳定编排 `TaskAutopilotPanel`、`DecisionPanel`、`DecisionHistory`、`TaskPlanetInterior`、`sourceDirectivePanel`、`securitySummaryPanel`、`workPackagesPanel`
  - `TaskOperationsHero` 与 `OperatorActionBar` 已补齐默认详情首屏的操作上下文、推荐动作、阻塞摘要与下一步动作区块
  - `TaskAutopilotPanel` 已将驾驶舱切片稳定拆成 `Destination`、`Route`、`Live Execution`、`Drive State`、`Fleet`、`Blockers`、`Recovery`、`Outputs`、`Evidence`、`Explanation`、`Takeover`
  - `server/tasks/mission-projection.ts` 与 `client/src/lib/tasks-store.ts` 已把 `autopilotSummary`、`decisionHistory`、`operatorActions`、`securitySummary` 等块级数据稳定投影并回填到 task detail
- 但这个勾选的边界也需严格限定：
  - 当前完成的是“任务详情级驾驶舱切片”的可复用信息块清单，不是完整 page-by-page 的 cockpit / replay / audit IA 统一收敛
  - `replay` / `audit` / `lineage` 仍缺少直接的 task-detail 入口与稳定右栏卡片，因此不能外推成完整右侧栏已完成
- 本轮还可以保守补勾“中间执行主视图”的内容结构：
  - `TaskAutopilotPanel` 已在同一摘要面板中稳定拆出 `Live Execution`、`Drive State`、`Fleet`、`Blockers`、`Recovery`、`Outputs`、`Evidence`
  - 这些区块已共同覆盖当前执行阶段、执行状态、在线角色、并行分支数量、阻塞原因、中间产物、可执行动作与证据摘要
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接断言 execution / fleet / blockers / outputs / evidence 区块展示，`client/src/lib/tasks-store.autopilot.test.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts` 已共同覆盖其 shared -> server -> store -> panel 链路
- 本轮也可以保守补勾“定义 `mission / workflow / projection / session` 到驾驶舱信息块的映射关系”：
  - `server/tasks/mission-projection.ts` 已将 `mission`、`workflowRuntime`、projection links 与 `autopilotSummary` 统一投影到 `/api/tasks/:id/projection`
  - `client/src/lib/tasks-store.ts` 已兼容 `autopilotSummary / autopilotProjection / autopilot.summary / projection.autopilotSummary` 等入口，并将其回填到 summary/detail
  - `TaskAutopilotPanel` 直接按块消费 `detail.autopilotSummary`，而 `TaskDetailView` 在 `default` 与 `cockpit` 两种 detail 变体里都稳定接入该面板
  - `server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已共同覆盖 projection 返回、store 归一化与 detail 侧消费链路
- 但这个勾选的边界仍需严格限定：
  - 当前确认的是“任务详情驾驶舱切片”所需映射关系，而不是完整独立 cockpit 页面中所有页面块、外链入口和跨页上下文协议都已完成
  - `session` 当前主要体现为 projection links / evidence correlation / decision metadata 等输入事实，还不是完整的 cockpit 级 session 编排模型

## 审计备注：2026-04-25

- 本轮补的是“设计定义层”的闭环，而不是 UI 已落地的闭环；因此新增勾选仅基于 `design.md` 已明确覆盖的任务项，不外推为前端页面已完成。
- 现在可以保守新增勾选的原因是：
  - `design.md` 已完整定义三栏驾驶舱的一/二级信息块、默认展示顺序与二级下钻边界
  - `design.md` 已明确右侧“接管与证据栏”的一级/二级结构，包括 `Takeover Queue / Takeover Panel / Evidence Summary / Trust Shortcuts`
  - `design.md` 已将 `selection / param_collection / user_input / confirm_judge` 收敛为统一 `Takeover Panel` 映射规则，并定义了通用骨架与结果语义
  - `design.md` 已定义 `replay / audit / lineage` 的入口结构、透传参数与证据摘要规则
  - `design.md` 已定义桌面端三栏宽度策略、最小可用宽度、块级折叠策略和最小保留顺序
  - `design.md` 已把这份 IA 明确为后续 cockpit UI、前端实现、多任务扩展和证据入口接线 spec 的统一基线
- 但边界仍需严格限定：
  - 当前勾选代表“信息架构设计已经定义完成”，不代表 `TaskDetailView` 已是完整独立驾驶舱页面
  - 当前勾选不代表 replay / audit / lineage 的真实按钮、跳转联调和页面实现已经完成
  - 当前勾选也不代表统一接管面板组件代码已经全部落地，只能说明后续实现不应再重新发明分区与映射口径
