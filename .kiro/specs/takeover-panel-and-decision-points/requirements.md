# 需求文档：接管面板与决策点

## 目标

本 spec 定义任务自动驾驶中的接管面板与决策点体系，使系统在自动规划、自动执行、自动复核过程中，能够在关键路口向用户请求澄清、确认、授权、预算许可、风险接受、结果验收或异常接管。

接管面板不是新的孤立审批系统，而是对现有 `HITL / decision / approval / wait-resume` 能力的产品层统一封装：

- 对用户来说，它是“方向盘交还给我”的统一入口。
- 对 Route 来说，它是路线中的 Takeover Point。
- 对 Mission Runtime 来说，它是 `waiting / decision / resume / escalate` 的可视化与治理投影。
- 对审计来说，它是关键人工判断的证据链入口。

## 背景

当前仓库已经存在以下相关基础：

- Mission 的 `waiting / decision` 状态；
- `MissionDecision` 与决策选项；
- `submitMissionDecision()` 幂等提交；
- `MissionStore.markWaiting()` / `resolveWaiting()` 状态切换；
- `MissionOrchestrator.submitDecision()` 决策处理；
- `POST /api/tasks/:id/decision` REST 端点；
- Feishu waiting 消息与决策按钮；
- Socket `mission.record.waiting` 事件；
- Web-AIGC runtime 的 `WAITING_INPUT -> resume()` 与 `escalate()` 链路。

但这些能力目前更偏底层状态与审批动作，还没有统一成任务自动驾驶产品语义下的“接管点”。本 spec 要补齐的就是这一层。

## 当前实现边界（2026-04-25）

本 spec 本轮收口到“当前主仓已经稳定落地的最小接管闭环”，不再把未来形态和现状混写：

- 当前主仓的接管体验是任务详情里的复合式 surface，而不是单一独立组件：
  - `DecisionPanel` 负责当前待处理决策输入；
  - `TaskAutopilotPanel` 负责 takeover / route / recovery / evidence 摘要；
  - `DecisionHistory` 负责历史 decision slice；
  - `TaskDetailView` 负责把这些 surface 组合进同一任务详情语境。
- 当前 `TakeoverPoint` 采用最小读模型，而不是独立持久化实体：
  - `MissionAutopilotSummary.takeover` 提供 `status / required / blocking / type / reason / prompt / decisionId / options / urgency`；
  - `route.takeoverPointIds` 提供 Route 侧锚点；
  - `DecisionHistoryEntry.prompt / options / resolved` 提供历史回看 slice。
- 当前路线确认闭环收口到“authoritative route summary / projection 更新”：
  - `submitMissionDecision()` 会保留 `selectedRouteOptionId / selectedRouteLabel / selectedRouteId / changedReason`；
  - shared / server 会把这些事实提升为 `selectedRouteId / selection.status / route.evidence[eventType=route.selected]`；
  - 真正的 route mutation / replan action 仍属后续阶段。
- 2026-04-26 补充边界：若 `tasks.md` 勾选“支持路线选择后更新 Route”，仅表示上述 authoritative summary / projection 更新闭环已被直接代码与直接测试锚定，不表示 planner 内部 Route 图、runtime 执行链或重规划动作已被同一条交互真实改写。
- 当前 history / audit / replay 闭环收口到“decision history + evidence timeline + 最小 audit slice”：
  - `DecisionHistoryEntry` 负责保留 `prompt / options / resolved / submittedBy / submittedAt / reason`；
  - `MissionAutopilotSummary.evidence.timeline / evidence.correlation` 负责最小回放与锚点透出；
  - `human.decision_submitted / human.param_collection_submitted` 与 runtime control event 负责最小审计事实；
  - 专门的 takeover timeline / takeover audit UI 仍属后续阶段。
- `TakeoverQueue`、推荐默认动作、timeout policy、专用 takeover timeline、权限/风险/交付的专门面板体验仍属于后续范围，本轮不外推为已落地。

## 本轮文档收口口径（2026-04-25）

本轮对 `tasks.md` 的勾选口径进一步区分为“规格定义完成”和“代码实现完成”两类：

- 对 `定义 / 设计 / 补充测试计划` 类任务，只要 requirements 与 design 已形成明确的数据合同、信息架构、治理规则或测试矩阵，即可按 spec 收口勾选。
- 对涉及真实运行时行为的任务，仍必须按直接代码 + 直接测试判断，不能因为 design 已写出目标形态就外推为主仓已完成。
- 本轮仍明确不按实现完成外推的事项包括：真实 `Route mutation / replan action`、预算治理真实写回、任务详情中的权限/风险/交付专门闭环，以及面向 takeover 语义的完整 audit UI。
- 本轮对路线确认剩余项、历史/审计表达采用更严格边界：只有 `decision -> history -> authoritative summary / projection` 的闭环可以视为当前稳定事实；真实 Route 变更、runtime replan action 与专用 takeover 审计面板不计入已完成。

因此，本 spec 中被勾选的设计类任务可以表示“规格已经定义清楚”，但不等价于“主仓代码已经具备同名能力”；实现态仍以下方审计备注和仓库中的直接代码/直接测试为准。

## 核心术语

### 接管点

Route、Drive State 或 Runtime 在自动推进过程中需要用户介入的位置。接管点可以是必须接管，也可以是建议接管。

### 接管面板

驾驶舱右侧或任务详情页中的统一 UI 区域，用于展示当前待处理接管点、历史接管记录、推荐默认动作、风险说明与提交入口。

### 决策点

可提交的结构化人工决策对象，是接管点在现有 HITL / decision 系统中的执行载体。

### 默认动作

系统在用户不介入或超时后可采用的安全默认选择。高风险接管点可以没有默认动作，必须等待用户。

### 异常接管

当系统偏航、失败、权限不足、结果质量过低、预算超限或运行时治理阻断时，请求用户决定下一步的接管类型。

## 接管类型

系统至少应支持以下接管类型：

- 澄清：补充目标、约束、上下文或成功标准。
- 路线确认：确认快速 / 标准 / 深度路线，或选择候选路线。
- 预算确认：确认 token、时间、外部工具、浏览器或执行器成本。
- 权限确认：确认是否允许访问文件、调用工具、使用外部 API、执行高权限动作。
- 风险接受：确认是否接受数据可信度、质量不确定、策略敏感或失败概率。
- 交付验收：确认结果是否可交付、是否需要继续修正。
- 异常接管：当执行失败、偏航、重试耗尽、治理阻断时由用户选择恢复策略。

## 需求

### 需求 1：系统必须定义统一的 Takeover Point 模型

系统应把澄清、确认、审批、异常接管等用户介入统一抽象为 Takeover Point。

验收标准：

- 当前阶段的 Takeover Point 最小合同必须至少包含 `status / required / blocking / type / reason / prompt / decisionId / options / urgency`。
- 当前阶段的 Takeover Point 必须能通过 `route.takeoverPointIds`、`decisionId` 与 `DecisionHistoryEntry` 锚定到 Route / Mission / Runtime 相关事实。
- 当前阶段的 Takeover Point 必须能表达必须接管、待处理接管与 advisory/只读提示的最小差异。
- 独立 `title / defaultAction / timeoutPolicy / 单独持久化实体` 为后续增强，不作为当前主仓收口前提。

### 需求 2：接管面板必须统一展示待处理决策

系统应提供统一接管面板，用于承接所有待用户处理的接管点。

验收标准：

- 当前阶段必须能在任务详情语境中同时展示：
  - 当前待处理决策输入；
  - takeover / route / recovery / evidence 摘要；
  - 最小 decision history slice。
- 当前阶段必须区分“当前需要处理的接管输入”和“只读型接管摘要 / 证据摘要”。
- 当前阶段必须能在任务详情页与 cockpit 详情 workspace 中复用同一组 surface。
- 多个接管点排队展示与独立 `TakeoverQueue` 仍属后续增强，不作为当前主仓验收前提。
- takeover 专用历史时间线仍属后续增强；当前只要求 `DecisionHistory + evidence timeline` 提供最小历史切片。

### 需求 3：澄清类接管必须支持轻量补充上下文

系统应在目标、约束、交付物或上下文不足时发起澄清类接管。

验收标准：

- 澄清问题必须说明为什么需要补充。
- 澄清问题必须支持单选、多选、自由文本和文件/上下文引用。
- 系统应尽量提供默认推断选项，避免用户从零输入。
- 澄清完成后必须恢复 Route 或 Mission Runtime 的执行。

### 需求 4：路线确认必须支持主路线与候选路线选择

系统应允许用户确认推荐路线，或在候选路线之间切换。

验收标准：

- 路线确认必须展示快速 / 标准 / 深度路线的差异。
- 差异至少包括时间、成本、质量、风险、接管次数和自动化程度。
- 用户选择路线后，系统必须记录 `selectedRouteOptionId / selectedRouteLabel / selectedRouteId / changedReason` 或等价 fallback 事实。
- 当前阶段的路线切换至少必须更新 authoritative `selectedRouteId / selection.status / route.evidence[eventType=route.selected]`，并经 shared summary / `/projection` 对外透出。
- 真正的 route mutation 与自动 replan action 为后续增强，不作为当前主仓收口前提。
- 上述“更新”在当前阶段仅指 authoritative summary / projection 层更新，不等同于 planner 内部 Route 图或 runtime 执行链已完成真实 mutation。

### 需求 5：预算确认必须防止成本黑盒

系统应在预算不明确、成本可能超限或需要高成本工具时发起预算确认。

验收标准：

- 预算确认必须展示预估成本、成本来源、可能浮动范围与默认上限。
- 用户可以批准、拒绝、调低预算、要求低成本路线或手动接管。
- 预算确认结果必须影响 runtime governance。
- 超预算风险必须进入审计与回放。

### 需求 6：权限确认必须兼容能力与审批体系

系统应在需要文件访问、外部 API、浏览器执行、沙箱执行、网络访问或高权限工具时发起权限确认。

验收标准：

- 权限确认必须展示请求的能力、用途、作用范围和风险。
- 用户可以批准一次、批准本任务、拒绝或升级人工处理。
- 权限结果必须映射到现有 permission / capability / approval 链路。
- 高风险权限不得静默默认通过。

### 需求 7：风险接受必须保留明确证据

系统应在高风险、不确定或策略敏感情形下请求用户接受风险。

验收标准：

- 风险接受必须展示风险类型、严重程度、触发条件、缓解方案。
- 用户必须明确选择接受、降低风险路线、请求更多证据或终止任务。
- 高风险接受必须要求用户填写原因或确认文本。
- 风险接受记录必须进入 audit / replay / evidence。

### 需求 8：交付验收必须支持继续修正

系统应在结果交付前或关键阶段结束时请求用户验收。

验收标准：

- 交付验收必须展示结果摘要、成功标准覆盖情况、未解决问题与建议下一步。
- 用户可以接受交付、要求修正、要求深度路线、保存为草稿或终止。
- 要求修正时，系统必须能进入 revise / retry / replan。
- 验收结果必须影响 Mission 的完成状态。

### 需求 9：异常接管必须支持恢复策略选择

系统应在执行失败、偏航、阻塞、重试耗尽或运行时治理阻断时发起异常接管。

验收标准：

- 异常接管必须展示失败原因、已尝试动作、影响范围和推荐恢复策略。
- 用户可以选择重试、换路线、降级执行、跳过非关键步骤、升级人工、终止任务。
- 异常接管必须兼容现有 `retry / escalate / terminate / resume` 控制面。
- 异常接管后必须保留恢复记录。

### 需求 10：接管点必须兼容现有 HITL / decision / approval / wait-resume 链路

本 spec 不应创建一套与现有系统割裂的审批机制。

验收标准：

- Takeover Point 必须能映射到 `MissionDecision` 或兼容的 decision payload。
- 决策提交必须复用或兼容 `submitMissionDecision()` 的幂等语义。
- 需要等待用户时，系统必须能进入 `waiting` 或 `WAITING_INPUT`。
- 用户提交后，系统必须能通过 `resume()` 或 orchestrator 决策链路继续执行。
- 需要人工升级时，系统必须能映射到 `escalate()`。

### 需求 11：接管记录必须可审计、可回放、可解释

所有接管行为都应成为任务证据链的一部分。

验收标准：

- 当前阶段的最小接管记录必须保留 `prompt / options / resolved option / freeText / submittedBy / submittedAt / decisionId`。
- 当前阶段的接管记录必须能关联 Route、Mission、Workflow、Runtime Event，至少通过 `decisionId / route.takeoverPointIds / evidence.correlation` 透出。
- replay / projection 中应能看到任务在哪些位置交还给用户；当前阶段以 `DecisionHistory + evidence.timeline / evidence.correlation` 的最小表达为准，不要求专门 takeover 时间线 UI。
- 预算 / 权限 / 风险接受的 takeover 专用 audit 展示仍属后续增强；当前只要求 decision submit 与 runtime control event 的最小 audit slice 存在。

### 需求 12：接管体验必须避免过度打断

系统应在保证安全与可控的前提下减少不必要的打断。

验收标准：

- 低风险接管应优先使用建议接管或默认动作。
- 能自动推断的信息不应强制用户重复输入。
- 多个低风险确认可以合并展示。
- 高风险、高成本、高权限动作必须保留显式接管。
- 接管面板应说明“不接管会发生什么”。
