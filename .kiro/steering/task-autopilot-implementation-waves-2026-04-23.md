---
inclusion: manual
---

# 任务自动驾驶实现波次（2026-04-23）

## 2026-04-26 增补：Wave 1 已完成，进入 runtime 深化

截至 2026-04-26，Task Autopilot 第一阶段已经从“规格拆分”推进到“可验证基线闭环”：

- `18 / 18` 份 task-autopilot specs 已闭合，`54 / 54` 份 markdown、`345 / 345` 顶层核心任务项、`602 / 602` raw checklist 项均已完成。
- `Wave 1` 的语义契约与投影基线已落地：`shared/mission/autopilot.ts`、`parseMissionDestination()`、服务端 `Mission -> Destination / Route / Drive State / Takeover` projection、客户端 `tasks-store` normalize 已形成兼容优先的纵切。
- `Wave 3` 已有最小驾驶舱消费切片：`TaskAutopilotPanel` 能在任务详情侧消费 destination、route、drive state、takeover、fleet 与 evidence 摘要。
- 当前闭环不等于开放域 L5，也不表示 runtime 已经具备完全无人值守自动编队；它表示第一阶段读模型、投影链路、任务面展示和测试直证已经对齐。
- 下一阶段应继续推进 `Wave 2 / Wave 4`：runtime orchestration、takeover bridge、replan record、fleet snapshot、evidence / replay / metrics 闭环，而不是继续新增大批 specs。

进度总览以 `docs/task-autopilot-18-spec-progress-overview-2026-04-24.svg` 为准；闭环说明见 `.kiro/steering/task-autopilot-phase-1-closure-2026-04-26.md`。

## 目的

这份文档不是重复 18 份 `task-autopilot` specs 的摘要，而是把它们收敛成当前主仓可执行的代码落地顺序。

目标是回答四个实现问题：

- 先把哪些对象和投影落到代码里，才能避免后续 UI 和 runtime 各写各的。
- 哪些能力应当复用现有 `mission / workflow / replay / audit / lineage` 基座，而不是新起一套“autopilot 后台”。
- 哪些代码区域最适合承接 `Destination / Route / Drive State / Fleet / Takeover`。
- 每一波做到什么程度，就可以被认为已经从 spec 进入了“可验证实现”。

## 实施原则

- 兼容优先，不建议第一波就大规模把 `mission / workflow / runtime` 重命名成 `destination / route / drive-state`。
- 先做共享契约与投影，再做 runtime 控制语义，再做驾驶舱 UI，最后做证据链、回放与指标闭环。
- 优先复用现有任务域与主线观测能力：`server/tasks/*`、`server/core/workflow-runtime-engine.ts`、`server/routes/tasks.ts`、`server/routes/replay.ts`、`server/routes/audit.ts`、`server/routes/lineage.ts`、`client/src/components/tasks/*`。
- 每一波都要形成端到端最小闭环，至少包含：共享字段定义、服务端投影、前端消费或测试验证三者中的两项，不能只停留在类型声明。
- 所有“解释”“风险”“置信度”“证据”都必须能回指真实事实来源；若只是前端推断，必须明确标注为推断，不得伪装成 runtime 已确认事实。

## 当前实现锚点

18 份 specs 的落地并不是从零开始，当前主仓已经有可复用的承载面：

- 共享契约与投影：`shared/mission/autopilot.ts`、`shared/mission/contracts.ts`、`shared/mission/projection.ts`、`shared/mission/api.ts`、`shared/mission/socket.ts`、`shared/workflow-domain.ts`、`shared/workflow-runtime.ts`
- 任务运行时与编排：`server/tasks/mission-runtime.ts`、`server/core/mission-orchestrator.ts`、`server/tasks/mission-operator-service.ts`、`server/tasks/mission-decision.ts`
- projection 与 API：`server/tasks/mission-projection.ts`、`server/routes/tasks.ts`、`server/routes/workflows.ts`
- runtime 与可观测桥接：`server/core/workflow-runtime-engine.ts`、`server/core/web-aigc-runtime-observability.ts`
- 回放、审计、血缘：`server/routes/replay.ts`、`server/replay/*`、`server/audit/*`、`server/lineage/*`
- 前端任务承载面：`client/src/lib/mission-client.ts`、`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx`、`client/src/components/tasks/*`、`client/src/pages/tasks/*`
- 前端 replay / telemetry 承载面：`client/src/lib/replay/*`、`client/src/lib/browser-telemetry-store.ts`、`client/src/components/replay/*`、`client/src/components/permissions/AuditTimeline.tsx`、`client/src/components/lineage/*`

上面的代码面决定了实现顺序应当是“在现有基座上补 autopilot 语义和投影”，而不是另造一层平行产品壳。

## 推荐拆分：4 个实现波次

| 波次 | 主题 | 主要承接 specs | 完成后应具备的能力 |
| ---- | ---- | --------------- | ------------------ |
| Wave 1 | 语义契约与投影基线 | `task-autopilot-core-concepts`、`task-autopilot-levels-l1-to-l5`、`destination-model-and-parser`、`route-planner-and-route-model`、`mission-model-to-autopilot-model-mapping` | 后端与前端能围绕同一套 autopilot 读模型工作 |
| Wave 2 | Runtime 编排与接管桥 | `drive-state-and-replan-state-machine`、`fleet-organization-and-role-packaging`、`autopilot-runtime-orchestration`、`autopilot-recovery-and-human-takeover-governance` | 运行时能表达 Drive State、Takeover、Fleet、Replan 的最小控制语义 |
| Wave 3 | 驾驶舱 UI 与任务页收口 | `autopilot-cockpit-information-architecture`、`destination-card-and-goal-summary`、`route-recommendation-and-selection`、`fleet-status-and-live-execution-view`、`takeover-panel-and-decision-points` | 用户能在现有任务页和驾驶舱里“看见并操作”自动驾驶 |
| Wave 4 | 解释、证据、回放与指标闭环 | `autopilot-explainability-and-telemetry`、`autopilot-evidence-replay-and-trust-chain`、`task-autopilot-success-metrics` | 自动驾驶不是只有前台文案，而是有可追溯证据和度量闭环 |

---

## Wave 1：语义契约与投影基线

### 目标

- 把 `Destination / Route / Drive State / Takeover` 先落成最小共享读模型。
- 明确哪些字段由服务端 projection 产出，哪些只是前端 view model 的短期拼装。
- 在不破坏现有 `MissionRecord`、`Workflow`、`MissionProjectionLinks` 的前提下，把 autopilot 语义挂到已有 API 与 store 上。

### 依赖

- 依赖当前 `mission`、`workflow`、`projection` 基座已经稳定。
- 不依赖完整驾驶舱 UI，也不依赖 replay / audit 深度改造。

### 建议涉及的代码区域

- `shared/mission/contracts.ts`
- `shared/mission/projection.ts`
- `shared/mission/api.ts`
- `shared/mission/socket.ts`
- `shared/workflow-domain.ts`
- `shared/workflow-runtime.ts`
- `server/tasks/mission-projection.ts`
- `server/tasks/mission-runtime.ts`
- `server/routes/tasks.ts`
- `client/src/lib/mission-client.ts`
- `client/src/lib/tasks-store.ts`

### 本波次应优先做的实现

1. 在共享契约层定义 autopilot 最小读模型，而不是先定义完整平台大对象。
2. 在 `server/tasks/mission-projection.ts` 中建立 `Mission -> Destination`、`Workflow -> Route`、`waiting/decision -> Takeover`、`mission status + stage -> Drive State` 的最小投影规则。
3. 在 `server/routes/tasks.ts` 与 `shared/mission/api.ts` 中把这些投影作为现有任务接口的增强字段暴露出去。
4. 在 `client/src/lib/tasks-store.ts` 中消费新投影，先形成稳定数据层，再决定 UI 怎么展示。
5. 保留旧字段，避免前端现有任务页、任务详情页和 office 入口因为命名切换同时重构。

### 可验证产物

- 现有任务接口返回稳定的 autopilot 投影块，而不是由多个页面各自临时推导。
- 至少一个任务详情入口能够拿到：
  - `destination` 摘要
  - `selectedRoute` 或主路线占位结构
  - `driveState`
  - `takeover` 摘要
- `client/src/lib/tasks-store.ts` 在读取老任务和新任务时都不报错，兼容“无 autopilot 投影”的历史数据。
- 建议补的验证面：
  - `server/tests/mission-routes.test.ts`
  - `server/tests/mission-record-extension.property.test.ts`
  - `client/src/lib/mission-client.test.ts`

### 主要风险

- 只在前端拼 `Destination / Route / Drive State`，导致后续 cockpit、replay、audit 使用的定义不一致。
- 过早把 `Route` 设计成完整规划引擎对象，结果第一轮落地只需要展示模型却被复杂度拖住。
- 试图在这一波做底层命名改造，造成接口、测试、Socket 事件、任务页同时抖动。

### 建议顺序

1. 先出共享字段与映射表。
2. 再落服务端 projection。
3. 再扩任务 API。
4. 最后接 `tasks-store` 与最小前端消费。

---

## Wave 2：Runtime 编排与接管桥

### 目标

- 把 `Route / Fleet / Takeover / Replan` 接入现有 `Mission Runtime` 与 `workflow runtime`。
- 统一 `run / wait / resume / retry / escalate / terminate / replan` 的控制语义。
- 让现有 `MissionDecision`、`waiting`、operator action 不再只是任务域动作，而能够被解释成 autopilot 的接管与恢复链路。

### 依赖

- 强依赖 Wave 1 的字段口径已经稳定，尤其是 `Drive State`、`Takeover`、`selectedRoute` 的最小结构。
- 复用当前 `Mission Runtime`、`workflow-runtime-engine`、HITL 与 operator action 机制，不建议另起独立 autopilot runtime。

### 建议涉及的代码区域

- `server/tasks/mission-runtime.ts`
- `server/core/mission-orchestrator.ts`
- `server/tasks/mission-operator-service.ts`
- `server/tasks/mission-decision.ts`
- `server/core/workflow-runtime-engine.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `server/core/task-allocator.ts`
- `server/core/taskforce-manager.ts`
- `server/routes/tasks.ts`
- `server/routes/workflows.ts`
- `shared/runtime-agent.ts`
- `shared/mission/socket.ts`

### 本波次应优先做的实现

1. 在 runtime 层补一层最小编排记录，例如 `RuntimeOrchestrationRecord` 或等效对象，用来串联 mission、workflow、route、takeover 与 fleet 快照。
2. 把 `wait / resume / retry / escalate / terminate` 统一映射到高层 Drive State 和 Takeover 状态，而不是让 UI 直接理解底层动作细节。
3. 让 `mission-operator-service` 与 `mission-decision` 产出的结果能回写为统一接管记录。
4. 把 `Fleet` 先落成“角色封装层”，重点是角色摘要和阶段归属，不要第一轮就做复杂组织引擎替换。
5. 为 `replan` 留出真实记录位，哪怕第一轮只做到“记录重规划发生了、为何发生、切到哪条路线”。

### 可验证产物

- 一个任务可以在投影层经历：
  - `understanding`
  - `planning`
  - `executing`
  - `takeover-required`
  - `replanning`
  - `delivered`
  的最小状态迁移。
- 用户提交决策、运营动作、等待恢复后，能在同一条投影链路上看到接管开始与接管完成。
- 至少形成一版 `Fleet` 快照，让前端能够展示当前参与角色与角色状态，而不是只展示原始 agent 或节点散点。
- 建议补的验证面：
  - `server/tests/mission-operator-actions.test.ts`
  - `server/tests/mission-orchestrator.test.ts`
  - `server/tests/workflow-runtime-engine.test.ts`
  - `client/src/lib/tasks-store.runtime-channels.test.ts`

### 主要风险

- 运行时事件、operator action 和 decision 回写顺序不一致，导致前端看到的 `Takeover` 状态抖动。
- 把 `Drive State` 直接硬绑到当前 Mission 六阶段，最后既表达不出重规划，也表达不清接管。
- `Fleet` 角色封装过早绑定具体节点实现，后续 Web-AIGC 节点归类会变成大面积回改。

### 建议顺序

1. 先统一控制动作语义。
2. 再建立 Takeover 桥。
3. 再补 Fleet 快照与 Route Stage 映射。
4. 最后加 replan 记录与测试。

---

## Wave 3：驾驶舱 UI 与任务页收口

### 目标

- 把 autopilot 能力收敛进现有任务主界面，而不是新开一套平行壳。
- 在现有 `TaskDetailView / TasksCockpitDetail / DecisionPanel / OperatorActionBar` 之上增加驾驶舱表达。
- 先实现“可见、可理解、可接管”，再追求完整视觉重构。

### 依赖

- 依赖 Wave 1 已经给出稳定投影。
- 依赖 Wave 2 已经提供最小控制语义和接管回写，否则 UI 只能展示静态卡片。

### 建议涉及的代码区域

- `client/src/lib/tasks-store.ts`
- `client/src/lib/mission-client.ts`
- `client/src/components/tasks/TaskDetailView.tsx`
- `client/src/components/tasks/TasksCockpitDetail.tsx`
- `client/src/components/tasks/DecisionPanel.tsx`
- `client/src/components/tasks/OperatorActionBar.tsx`
- `client/src/components/tasks/MissionDetailOverlay.tsx`
- `client/src/components/tasks/TaskOperationsHero.tsx`
- `client/src/components/tasks/task-helpers.ts`
- `client/src/components/office/office-task-cockpit-utils.ts`
- `client/src/pages/tasks/TasksPage.tsx`
- `client/src/pages/tasks/TaskDetailPage.tsx`

### 本波次应优先做的实现

1. 在现有任务详情结构中先落只读块：
   - 目的地卡片
   - 当前 Drive State
   - 主路线 / 候选路线摘要
   - 当前 Fleet 快照
2. 将现有 `DecisionPanel`、`OperatorActionBar` 升级为统一接管面板，而不是再做一套与 mission decision 平行的 autopilot 操作栏。
3. 把 `route recommendation` 做成基于服务端投影的 UI，而不是由前端临时生成“最快 / 最稳 / 最深”的虚拟数据。
4. 让 cockpit 与 detail 页面共享同一套投影字段和 helper，避免两套视图各自维护不同的解释文案。
5. 对历史任务、无 route 数据任务、无 fleet 数据任务提供降级显示，不阻断原任务页可用性。

### 可验证产物

- 至少一个主任务入口可以同时看到：
  - 目标摘要
  - 路线摘要或候选路线
  - 当前驾驶状态
  - 当前车队 / 角色状态
  - 接管动作入口
- 现有接管动作仍走原有 API，但在 UI 语义上表现为 autopilot 接管，而不是散落的“暂停 / 重试 / 提交意见”按钮。
- 路线切换或接管确认后，`tasks-store` 能刷新并反映新的投影状态。
- 建议补的验证面：
  - `client/src/components/tasks/__tests__/TaskDetailView.runtime-evidence.test.tsx`
  - `client/src/components/tasks/__tests__/TasksCockpitDetail.runtime-defer.test.tsx`
  - `client/src/components/tasks/__tests__/TaskOperationsHero.test.tsx`
  - `client/src/components/tasks/__tests__/OperatorActionBar.test.tsx`
  - `client/src/components/tasks/__tests__/mission-detail-overlay.test.ts`

### 主要风险

- 旧任务页与新驾驶舱同时展示进度、状态、接管，造成重复信息面板。
- `tasks-store` 中 UI 拼装逻辑过多，反向挤压服务端 projection，导致 replay 与 audit 无法复用。
- 为了追求“驾驶舱感”提前大改页面结构，反而把现有任务详情、office cockpit、runtime evidence 归口打散。

### 建议顺序

1. 先接 store 与 API 类型。
2. 再加只读驾驶舱卡片。
3. 再把现有 decision/operator 行为统一成接管面板。
4. 最后再做路线切换、fleet live view 和布局优化。

---

## Wave 4：解释、证据、回放与指标闭环

### 目标

- 让 autopilot 的“为什么这么做”与“当时依据是什么”能够被 replay、audit、lineage 共用。
- 给驾驶舱与任务详情提供真实的解释、风险、置信度、证据提示来源。
- 形成第一版成功指标，不再只依靠 UI 主观感受判断自动驾驶是否成立。

### 依赖

- 强依赖 Wave 2 已稳定高层事件键和控制语义。
- 依赖 Wave 3 已有实际 UI 消费场景，否则解释与证据会继续停留在底层日志。

### 建议涉及的代码区域

- `shared/replay/contracts.ts`
- `shared/audit/contracts.ts`
- `shared/lineage/contracts.ts`
- `shared/telemetry/contracts.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `server/routes/replay.ts`
- `server/routes/audit.ts`
- `server/routes/lineage.ts`
- `server/routes/telemetry.ts`
- `server/replay/*`
- `server/audit/*`
- `server/lineage/*`
- `client/src/lib/replay/*`
- `client/src/lib/browser-telemetry-store.ts`
- `client/src/lib/telemetry-store.ts`
- `client/src/components/replay/*`
- `client/src/components/permissions/AuditTimeline.tsx`
- `client/src/components/lineage/*`

### 本波次应优先做的实现

1. 先统一 `mission / workflow / route / runtime event / replay / audit / lineage` 的关联键，形成 autopilot 证据相关索引。
2. 在 `web-aigc-runtime-observability` 与 replay / audit / lineage 之间增加 autopilot 高层事件映射，例如：
   - `drive_state.changed`
   - `route.selected`
   - `route.replanned`
   - `takeover.requested`
   - `takeover.resolved`
   - `risk.changed`
   - `confidence.changed`
3. 给 replay 加上“驾驶时间线”所需的最小事件视角，而不是重写整个 replay 系统。
4. 让 audit、lineage、replay 围绕同一批证据对象消费，不要分别各造一份 autopilot 日志。
5. 最后再补 success metrics 聚合，至少覆盖送达率、接管率、重规划率、完成时长拆分。

### 可验证产物

- replay 中能看到高层自动驾驶时间线，而不仅是底层节点运行事件。
- audit 记录与 replay、lineage 能通过关联键互跳，至少能解释一次接管、一次重规划或一次关键结果验收。
- 任务详情或驾驶舱能够展示：
  - 当前状态解释
  - 风险提示
  - 置信度
  - 证据提示
  且这些字段能说明来源是服务端事实、组合投影还是前端推断。
- 至少形成一版成功指标采集与展示口径。
- 建议补的验证面：
  - `server/tests/replay-routes.test.ts`
  - `server/tests/replay-audit.test.ts`
  - `server/tests/web-aigc-runtime-observability.test.ts`
  - `server/tests/lineage-routes.test.ts`
  - `client/src/lib/replay/__tests__/replay-engine.test.ts`
  - `client/src/lib/browser-telemetry-store.test.ts`

### 主要风险

- 解释层脱离真实事实来源，生成“看起来合理但不可追责”的 autopilot 文案。
- replay、audit、lineage 各自产生一份 autopilot 记录，最终出现事实冲突。
- 证据与风险事件进入回放后没有脱敏规则，扩大敏感信息暴露面。
- 指标太早上屏，结果底层字段还未稳定，后续大量回补历史数据。

### 建议顺序

1. 先冻结关联键和事件目录。
2. 再做服务端证据投影。
3. 再接 replay / audit / lineage 消费面。
4. 最后补驾驶舱证据提示与 success metrics 展示。

---

## 总体建议顺序

推荐顺序不是按 18 份 specs 的文档分组直接逐份实现，而是按下面的代码落地节奏推进：

1. `Wave 1` 必须先完成。
2. `Wave 2` 紧接 `Wave 1`，先把 runtime 语义立住。
3. `Wave 3` 在 `Wave 2` 的最小控制语义稳定后开始，前半段可以与 `Wave 2` 后半段并行。
4. `Wave 4` 可以在 `Wave 2` 后期开启事件建模，但必须等 `Wave 3` 出现真实消费面后，再做完整的解释与证据 UI 闭环。

如果资源有限，最不建议砍掉的是 `Wave 1` 和 `Wave 2`。因为没有共享投影与控制语义，后面的驾驶舱、回放、指标都会退化成 UI 包装。

## 建议的停靠检查点

每一波结束时，建议至少检查以下问题：

- 这一波新增的是“共享定义与投影”，还是只是某个页面里的局部 view model。
- 前端看到的新 autopilot 信息，能否在服务端 projection、runtime 事件或 replay / audit 中找到来源。
- 这一波是否复用了现有任务域与回放审计基座，而不是偷偷造出平行体系。
- 历史任务、旧接口、旧页面是否还能跑，是否存在必须立刻全仓改名才能继续的实现死结。

## 明确不建议在第一轮做的事

- 不建议第一轮就重命名数据库字段、API 路由和所有前端文案为 `Destination / Route / Drive State`。
- 不建议新建独立 autopilot service 或独立 replay backend。
- 不建议跳过 Wave 1，直接做驾驶舱 UI。
- 不建议为了“最稳 / 最快 / 最深”路线卡片，先造一套前端虚拟规划器。
- 不建议让 replay、audit、lineage 三套系统分别维护自己的 autopilot 事实源。

## 结论

基于当前 18 份 task-autopilot specs 和主仓已有实现面，最稳妥的实现路径不是“再拆更多 spec”，而是按 4 个波次把语义、编排、界面、证据闭环依次落进现有代码：

- 先统一投影对象
- 再打通 runtime 与接管语义
- 再把任务页升级为驾驶舱
- 最后把解释、证据、回放和指标收成同一条主链

这样推进，既能保住 compatibility-first，也能让 `task-autopilot` 从文档概念真正进入可运行、可验证、可复盘的代码实现阶段。
