---
inclusion: manual
---

# Task Autopilot 前端体验落地 specs 路线图（2026-04-26）

## 背景

任务自动驾驶第一阶段 `18` 份 specs 已完成产品对象、路线、驾驶舱、runtime、治理与证据链的上层建模。当前前端已经具备首条可见化纵切，但仍存在一个核心落差：

> 文档与后端投影已经开始像“任务自动驾驶”，但用户进入前端时仍容易感知成“任务工作台 + 智能发起 + 详情面板”。

因此本轮新增 `12` 份前端体验落地 specs。它们不是替代原有 `18` 份 task-autopilot specs，而是把原有概念转成可执行、可验收、可测试的前端体验层。

## 本轮目标

- 把“输入目的地 -> 规划路线 -> 选择路线 -> 进入驾驶舱 -> 车队执行 -> 接管 -> 证据回放”变成前端主体验。
- 避免前端重新发明 Destination、Route、Fleet、Drive State、Takeover、Evidence 等概念。
- 在每份前端 spec 中明确引用原有 `18` 份 specs 的概念来源。
- 在实现任务中加入对原 `18` 份 specs 已落地代码缺陷的回补项，避免只写新 UI 不修旧链路。

## 12 份前端体验 specs

| 序号 | 新增 spec | 前端落地重点 | 主要引用的既有 specs |
| ---- | -------- | ------------ | -------------------- |
| 1 | `autopilot-launch-destination-input` | 目的地输入、输入示例、缺失路标、附件影响 | `destination-model-and-parser`、`mission-model-to-autopilot-model-mapping` |
| 2 | `autopilot-route-planning-overlay` | 输入后弹出路线规划、路线比较、确认执行 | `route-planner-and-route-model`、`route-recommendation-and-selection` |
| 3 | `autopilot-destination-card-and-goal-lock` | 目的地卡片、目标锁定、目标变更影响 | `destination-card-and-goal-summary`、`drive-state-and-replan-state-machine` |
| 4 | `autopilot-cockpit-three-column-layout` | 左目的地路线、中执行、右接管证据三栏主界面 | `autopilot-cockpit-information-architecture` |
| 5 | `autopilot-fleet-live-visualization` | Planner / Clarifier / Executor / Reviewer 等车队角色实时态 | `fleet-organization-and-role-packaging`、`fleet-status-and-live-execution-view` |
| 6 | `autopilot-drive-state-timeline-and-replan` | 驾驶状态时间线、偏航、重规划、下一步 | `drive-state-and-replan-state-machine`、`autopilot-recovery-and-human-takeover-governance` |
| 7 | `autopilot-takeover-control-panel` | 澄清、路线选择、审批、权限、预算、风险统一接管面板 | `takeover-panel-and-decision-points`、`human-in-the-loop` 相关底座 |
| 8 | `autopilot-evidence-driving-recorder` | 证据记录仪、路线事件、接管事件、replay/audit/artifacts 链接 | `autopilot-evidence-replay-and-trust-chain` |
| 9 | `autopilot-mobile-and-responsive-cockpit` | 桌面三栏、平板双栏、移动分段驾驶舱 | `autopilot-cockpit-information-architecture` |
| 10 | `autopilot-visual-language-and-motion-system` | 自动驾驶视觉 token、路线动效、状态动效、证据动效 | `task-autopilot-core-concepts`、`autopilot-explainability-and-telemetry` |
| 11 | `autopilot-empty-state-and-onboarding` | 示例目的地、首次引导、触发规则说明 | `task-autopilot-platform-positioning`、`task-autopilot-levels-l1-to-l5` |
| 12 | `autopilot-frontend-state-model-and-store` | draft / planning / projection 三层前端状态模型 | `mission-model-to-autopilot-model-mapping`、`route-planner-and-route-model` |

## 与原 18 份 specs 的关系

### 不重复定义的内容

以下概念以原 `18` 份 specs 为准，本轮前端 specs 只做落地与补缺：

- Destination
- Route
- Candidate Route
- Drive State
- Fleet
- Takeover Point
- Evidence / Replay / Trust Chain
- L1-L5 自动驾驶分级
- Mission / Workflow / Runtime 的兼容映射

### 本轮新增的内容

本轮新增的是前端体验层、状态层和视觉层：

- 目的地输入器
- 路线规划浮层
- 目标锁定卡片
- 三栏驾驶舱布局
- 车队实时可视化
- 驾驶状态时间线
- 接管控制面板
- 证据记录仪
- 响应式驾驶舱
- 视觉语言与动效系统
- 空状态与 onboarding
- 前端状态模型与 store 分层

## 实现时的缺陷回补原则

本轮每个 `tasks.md` 都必须包含回补既有 `18` 份 task-autopilot specs 代码缺陷的任务。执行时遵循以下原则：

- 新前端组件不得长期保留与 shared contract 平行的重复模型。
- 如果发现 `LaunchRouteCandidate`、`CandidateRoute`、`MissionAutopilotSummary.route.candidateRoutes` 字段割裂，应优先补映射或收敛计划。
- 如果发现 `TaskAutopilotPanel` 承担过多展示和解析逻辑，应拆出可复用子组件。
- 如果发现 `tasks-store` normalize 过度吞错，应补测试并收敛 fallback。
- 如果发现 README / steering / UI 文案和 18 份 specs 概念漂移，应同步修正。
- 如果发现路线选择、目标锁定、接管、证据事件未写入 runtime/evidence 链路，应至少补 TODO、字段预留或最小测试保护。

## 推荐优先级

### P0：先让用户一眼看见自动驾驶

1. `autopilot-launch-destination-input`
2. `autopilot-route-planning-overlay`
3. `autopilot-cockpit-three-column-layout`
4. `autopilot-empty-state-and-onboarding`

### P1：补齐驾驶舱主对象

5. `autopilot-destination-card-and-goal-lock`
6. `autopilot-drive-state-timeline-and-replan`
7. `autopilot-fleet-live-visualization`
8. `autopilot-takeover-control-panel`

### P2：补可信、状态和体验系统

9. `autopilot-evidence-driving-recorder`
10. `autopilot-frontend-state-model-and-store`
11. `autopilot-mobile-and-responsive-cockpit`
12. `autopilot-visual-language-and-motion-system`

## 当前产物

本轮新增：

- `12` 个 spec 目录
- `36` 份 markdown
- 每份均包含：
  - `requirements.md`
  - `design.md`
  - `tasks.md`

这些 specs 应作为 Task Autopilot Phase 2 前端体验落地基线，而不是 Phase 1 原 `18` 份 specs 的替代品。

## 2026-04-26 Lane F 文档回补

### 触发示例与六类 chips

前端发起区的最小触发输入应继续围绕“目的地”而不是“创建任务”表达。README / README.zh-CN 已补齐六类 chips 的最小输入示例：

| Chip | 示例意图 |
| ---- | -------- |
| `analysis` | 分析客服问题、给出根因、约束和成功标准 |
| `generation` | 生成双语发布简报、rollout checklist 和审批标准 |
| `implementation` | 实现受保护改动、明确回滚路径和测试 |
| `research` | 调研方案、汇总证据、风险和推荐 |
| `attachment` | 基于附件生成排期、风险清单和验收标准 |
| `advanced-execution` | 打开沙箱或浏览器验证流程、收集日志并给出回滚建议 |

这些示例的定位是用户态目的地表达，而不是后端能力承诺。它们用于帮助用户把“我要完成什么”说清楚，并让系统选择 quick / standard / deep / missing-waypoints / advanced-execution 等前端路线预览。

### Destination 字段差异口径

`destination-model-and-parser` / parser projection 是更丰富的审计与运行时输入层，包含 `sourceInput`、`normalizedGoal`、结构化 `constraints`、结构化 `successCriteria`、`missingInformation`、`suggestedClarifications`、`evidence`、mission/workflow 映射和版本元数据。

`autopilot-launch-destination-input` 的 preview 是轻量 frontend view model，已落地展示 `goal`、`deliverable`、`constraints`、`timeline`、`successCriteria`、`missingFields`、`confidence`、`attachmentInfluence` 和 `route`。

`autopilot-destination-card-and-goal-lock` 的 goal card / summary 已落地 `goal`、`request`、`subGoals`、`constraints`、`successCriteria`、`deliverables`、`fieldSources`、`lockState` 和 `routeImpact`。仍未宣称完成的是 shared/store 级目标锁定持久化、planner 自动 replan 触发，以及所有 parser 审计字段在卡片中的完整展示。

### Cockpit IA 与移动端边界

三栏驾驶舱主结构的当前口径是：桌面端左栏承载 Destination / Route，中栏承载 Drive / Fleet / Outputs，右栏在数据可用时承载 Takeover / Evidence / Cost / Risk。当前已具备三栏布局、断点、移动分段导航、bottom sheet、压缩目的地卡片和基础组件测试；右栏 Cost/Risk 的完整数据闭环、`TaskAutopilotPanel` 大规模子组件拆分，以及 OfficeTaskCockpit 窄屏 chip 溢出修复仍应保持未完成。

移动端策略不是“桌面能力缺失”，而是同一组核心对象的响应式访问方式：tablet 使用双栏，mobile 使用分段导航、压缩卡片和 bottom sheet。移动端暂不承诺同时展示所有桌面高密度面板；GitHub Pages 预览仍是 browser-only，不包含 Node server / executor。

### 视觉方向口径

自动驾驶视觉方向按 Destination / Route / Fleet / Drive State / Takeover / Evidence 六类对象组织，状态色覆盖 running / waiting / blocked / done / replanning / verified。路线 reveal、路线选择 glow、Drive State rail advance、接管提示和证据 timeline append 应用于解释当前进度、风险和证据来源；`prefers-reduced-motion` 下应降级为静态层级、状态文案和时间线顺序，不把动效作为唯一信息来源。
