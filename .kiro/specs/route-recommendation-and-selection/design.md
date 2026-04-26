# 设计文档：路线推荐与路线选择

## 设计概述

`route-recommendation-and-selection` 的设计目标，是把当前系统中隐式存在的“规划结果”升级为用户可见、可理解、可操作的路线层。

它不是替代底层 `Workflow` 或 `Mission Runtime`，而是在现有 mission-first 体系上增加一层用户态对象，让用户能够看到：

- 系统推荐了哪几条路线
- 每条路线为什么被推荐
- 每条路线预计花多少时间和成本
- 当前选择的是哪条路线
- 什么时候还能切换路线
- 为什么执行中被重规划或降级

因此，本设计采用“Planner 输出 -> 路线投影 -> 驾驶舱交互 -> Runtime 绑定 -> Replay / Audit 证据”的五段式结构。

## 设计原则

### 1. 路线是产品对象，不是直接暴露 DAG

用户不应直接面对底层节点图或 route family 细节。
路线在产品层应被表达为：

- 一种完成目标的策略方案
- 一条可比较、可切换、可解释的执行路径
- 一组阶段与关键决策点的组合

底层 DAG、节点编排、adapter 调用结构仍然保留在内部。

### 2. 推荐路线必须来源于规划器，而不是 UI 虚构

前端可以对 Planner 输出做排版、摘要和比较，但不能自行编造路线本体。
每条路线都应可回溯到 Route Planner 的结构化输出。

### 3. 路线切换必须区分规划期与执行期

规划期切换是普通交互；执行期切换属于显式重规划，必须进入 runtime 事件、接管和审计证据链。
二者绝不能混为一谈。

### 4. 路线不是静态标签，而是带治理属性的策略包

一条路线不仅包含“怎么走”，还应包含：

- 推荐分数
- 风险等级
- 预计成本 / 时长
- 预计接管点
- 默认自动驾驶等级适配情况

## 核心对象

### 1. Candidate Route

建议引入候选路线投影对象 `CandidateRoute`，用于承接 Route Planner 输出并供驾驶舱使用。

建议字段：

- `routeId`
  - 路线唯一标识
- `routeKind`
  - 如 `fastest`、`safest`、`deepest`
- `title`
  - 面向用户展示的路线名称，如“最快”“最稳”“最深”
- `summary`
  - 一句话路线概述
- `recommendationReason`
  - 推荐理由
- `tradeoffNotes`
  - 关键取舍说明
- `estimatedDuration`
  - 时长预估
- `estimatedCost`
  - 成本预估
- `estimatedTakeovers`
  - 预计接管次数或接管强度
- `riskLevel`
  - 风险等级
- `phaseOutline`
  - 阶段摘要
- `decisionPoints`
  - 关键确认点
- `plannerScore`
  - 推荐分数
- `isDefault`
  - 是否是当前默认路线

### 2. Route Selection State

路线推荐与选择需要一个独立的状态投影层。

建议状态字段：

- `recommendedRouteId`
- `selectedRouteId`
- `selectionMode`
  - `planner_default`
  - `user_selected`
  - `runtime_replanned`
- `selectionLocked`
  - 是否已锁定
- `lockReason`
  - 锁定原因
- `selectionChangedAt`
  - 最近一次切换时间
- `selectionChangedBy`
  - `system` / `user` / `runtime`

### 3. Route Comparison Model

为支持候选路线横向比较，建议在 UI 层提供路线比较视图模型。

最小比较维度：

- 速度
- 稳定性
- 深度
- 成本
- 时长
- 接管强度
- 风险等级

这层模型可以由前端基于 `CandidateRoute` 进行投影，不必成为独立持久化对象。

审计补充（2026-04-24）：

- 当前主仓已经具备一套保守可用的最小比较模型，但范围只到 `TaskAutopilotPanel` 的投影与展示层。
- 现有 `route` 区块已稳定消费：
  - `route.selected / route.selectedRoute`
  - `route.candidateRoutes`
  - `route.recommendedRouteId / selectedRouteId`
  - `route.selection.* / route.replan.* / route.evidence.*`
- 当前已被真实代码与测试覆盖的比较维度是：
  - `mode`
  - `riskLevel`
  - `takeoverLoad`
  - `estimatedDuration`
  - `estimatedCost`
- 其中 `Route Diff` 已形成清晰的“已选路线 -> 推荐路线”差异表达，`Alternatives` 则承载候选路线列表，因此可以保守视为“任务详情里的最小路线比较模型”。
- 这个结论不应外推为：
  - 完整的 `/tasks` 路线比较工作台
  - 统一的 `最快 / 最稳 / 最深` 产品语义模型
  - planner / runtime 已消费该比较模型作为权威决策输入

## 路线生成与投影流程

### 1. 目标解析后触发规划

当用户输入目标并形成初步任务对象后：

1. `Destination Parser` 生成结构化目标
2. `Route Planner` 基于目标、约束、自动驾驶等级、任务类型生成候选路线
3. 后端返回结构化 route candidates
4. 前端将其投影为可视化路线卡片

### 2. 默认路线判定

Planner 应给出一个默认推荐路线。

默认推荐逻辑应综合考虑：

- 任务类型
- 风险等级
- 自动驾驶等级
- 预算约束
- 历史成功模式
- 是否存在必须接管的高风险动作

示例：

- 轻量内容任务，可能默认推荐“最快”
- 治理敏感任务，可能默认推荐“最稳”
- 架构分析任务，可能默认推荐“最深”

### 2.1 当前可直接确认的最小默认推荐逻辑

按当前 `shared/mission/autopilot.ts` 与 `client/src/lib/tasks-store.ts` 的 builder / fallback 行为，现阶段真正已被代码稳定实现的默认推荐逻辑只有一层“最小启发式”：

| 当前条件 | 当前推荐倾向 | 直接锚点 |
| ---- | ---- | ---- |
| 普通低风险任务 | `fast` 或 `standard` | `inferRouteMode(...)` / fallback route mode 推导 |
| 风险较高、waiting、需要更强治理时 | `deep` | deep route 的高风险 / waiting 推荐理由 |
| 有已解析的 route-selection 决策历史 | 保持 `selectedRouteId` 作为权威选中 | `readResolvedRouteSelection(...)`、projection authoritative selected route tests |
| runtime 重试或阻塞后 | `selectionStatus = replanned`，并以 runtime route 作为当前选中 | `route.replan` / `route.evidence[eventType=route.replanned]` |

当前不能写成既成事实的内容：

- 任务类型 / 预算 / 治理 / 历史成功模式的完整 planner score；
- 跨任务域的正式推荐评分模型；
- `/tasks` 入口上的完整“恢复系统推荐”交互流。

### 2.2 默认推荐规则的设计分层

为避免把“最小启发式”误写成“正式推荐规则”，本 spec 将默认推荐规则分成三层：

1. 已实现层
   - 仅承认当前 shared builder 已稳定产出的 `fast / standard / deep` 推荐倾向。
   - 仅承认 `mission.kind`、waiting / risk、retry / replanned 这些直接代码分支。
2. 设计已定义但未实现层
   - 任务类型、预算、治理要求、历史成功模式、自动驾驶等级共同参与推荐。
   - 输出 `recommendedRouteId` 之外，还输出更结构化的 recommendation policy / planner score。
3. 后续治理层
   - 将 route recommendation 与预算治理、权限边界、执行后成效回流连接起来，形成可校准推荐器。

当前本 spec 只将第 1 层视为既有实现，把第 2 层与第 3 层视为后续主线设计目标。

### 2.3 默认推荐结果的消费者契约

围绕默认推荐结果，当前设计应明确区分“谁生产、谁投影、谁只能消费摘要”：

1. shared builder / planner 兼容层
   - 负责产出 `candidateRoutes`、`recommendedRouteId`、`selectedRouteId`、`selectionStatus`。
   - 当前真实已落地的是 `fast / standard / deep` 及其 `summary / reason / description / estimatedDuration / estimatedCost`。
2. projection / store 归一化层
   - 负责把上述路线事实对齐到 `mission projection`、`evidence.correlation` 与 client store fallback。
   - 这一层可以补齐字段对齐、别名兼容与消费一致性，但不应自己重新判定推荐路线。
3. panel / cockpit 展示层
   - 负责展示 `Selected / Recommended / Alternatives / Route Diff / Selection / Replan / Route Evidence`。
   - 这一层可以组织叙事，但不应把展示时的字符串组合冒充为新的推荐策略。

因此，当前“默认推荐规则”的安全设计口径应是：

- 已实现的是推荐结果的共享摘要 contract 与投影消费链；
- 未实现的是跨任务域统一的 recommendation policy、planner score 与预算/治理/历史成功模式参与的正式判定器。

### 2.4 默认推荐规则的设计态判定矩阵

为避免“默认推荐”继续停留在抽象原则，本 spec 在设计层给出一套可直接约束 planner policy 的判定顺序。该顺序用于定义“应该如何推荐”，不是声称当前代码已经完整实现。

#### 判定优先级

1. 不可越过的治理前置条件
   - 命中外部副作用、权限升级、预算审批、人工验收前置条件时，不允许把 `fast` 作为默认推荐。
   - 这类任务至少应落在 `standard` 或 `deep`，并在 recommendation reason 中显式说明接管原因。
2. 自动驾驶等级边界
   - `L1`：默认偏“建议优先”，允许 `fast / standard` 进入候选，但必须保留人工确认。
   - `L2`：默认偏“低风险可自动推进”，低风险短链任务优先 `fast / standard`，治理敏感任务优先 `standard / deep`。
   - `L3`：默认偏“标准任务自动闭环”，标准化任务优先 `standard`，对验证与恢复余量要求更高时优先 `deep`。
   - `L4`：仅在白名单任务域中允许把 `standard / deep` 作为无人值守主推荐；`fast` 只适用于低副作用快速交付支线。
   - `L5`：当前不形成生产承诺，不参与真实推荐加权。
3. 任务类型与交付目标
   - `chat / quick-draft / sketch` 倾向 `fast`
   - `analysis / planning / structured delivery` 倾向 `standard`
   - `research / architecture / multi-source synthesis` 倾向 `deep`
4. 风险与治理强度
   - 风险越高、waiting 越多、审计要求越强，越应把推荐从 `fast` 拉向 `standard / deep`。
5. 预算与时长约束
   - 预算紧、时效优先时，可在同风险等级候选中优先 `fast / standard`；
   - 但预算约束不能压过治理前置条件。
6. 历史成功模式
   - 在上述条件都不冲突时，才允许用历史成功模式、模板复用率、任务域经验作为最终 tie-breaker。

#### 默认推荐输出合同

设计态的推荐器至少应输出：

- `recommendedRouteId`
- `recommendationReasons[]`
- `disqualifiedRouteIds[]`
- `policyInputs`
  - `taskKind`
  - `riskLevel`
  - `autopilotLevel`
  - `budgetPreference`
  - `governanceSignals`
  - `historyHints`
- `requiresConfirmation`
- `policyVersion`

当前实现边界仍保持不变：

- 当前真正稳定落地的是 `recommendedRouteId + candidateRoutes + recommendationReasons` 的最小摘要链；
- 上述 `policyInputs / disqualifiedRouteIds / policyVersion` 仍属于设计态字段。

### 3. UI 投影

前端应将候选路线投影为 3 层信息：

1. 顶层选择层
   - 最快 / 最稳 / 最深
2. 比较层
   - 时长、成本、接管、风险差异
3. 解释层
   - 为什么推荐、适合什么任务、为什么不是其他路线

## 交互流程设计

### 1. 规划期路线推荐

任务刚进入规划阶段时，显示：

- 默认推荐路线
- 其他候选路线
- 推荐理由
- 预估时长与成本
- 关键取舍说明

此阶段允许：

- 查看路线详情
- 在候选路线间切换
- 恢复为系统推荐
- 确认路线并启动任务

### 1.1 当前已存在的最小规划期选择语义

在当前主仓里，规划期路线选择已经具备“决策历史 -> summary / projection / panel”的最小闭环，但还不是完整交互流。

当前已稳定存在的最小语义包括：

- route-selection 等待态会投影为：
  - `takeover.type = route-selection`
  - `route.selectionStatus = alternatives-available`
  - `route.selectionLocked = true`
  - `route.selection.canSwitch = true`
  - `route.selection.switchRequiresConfirmation = true`
- route-selection 决策提交后会保留：
  - `selectedRouteOptionId`
  - `selectedRouteLabel`
  - `selectedRouteId`
  - `changedReason`
- resolved decision history 会被提升为权威：
  - `route.selectedRouteId`
  - `route.selection.changedReason`
  - `route.selection.mode = user_selected`
  - `route.evidence[eventType=route.selected]`

因此，本 spec 当前可以保守确认：

- “查看候选路线”和“保留用户选择结果”的后端摘要链已成立；
- 但“恢复系统推荐”和“确认后直接启动执行”的完整 UI mutation 流仍未闭环。

### 1.2 规划期路线切换的最小设计边界

即使当前还不能勾选“规划期路线切换流程”，设计上也应先把边界写清：

1. 查看候选路线
   - 已落地为 `candidateRoutes` + `Selected / Recommended / Alternatives / Route Diff` 展示。
2. 提交 route-selection
   - 已落地为 `DecisionPanel -> decisionHistory -> route summary / projection / panel`。
3. 恢复系统推荐
   - 当前未落地。
   - 后续应表现为一次显式 mutation，而不是仅靠前端本地切回 `recommendedRouteId`。
4. 确认执行
   - 当前未落地为独立路线确认动作。
   - 后续应与路线锁定、任务启动、evidence `route.locked` 事件联动。

因此当前可保守视为已存在的是“规划期选择摘要链”，而不是“完整规划期切换流”。

### 1.3 规划期改线的读写边界

当前设计还应补清“哪些字段可作为规划期改线输入线索，哪些字段只是展示快照”：

- 可作为上游输入线索的字段：
  - `selectedRouteOptionId`
  - `selectedRouteLabel`
  - `selectedRouteId`
  - `changedReason`
- 可作为权威摘要消费的字段：
  - `route.selectedRouteId`
  - `route.recommendedRouteId`
  - `route.selection.status`
  - `route.selection.mode`
  - `route.selection.changedReason`
  - `route.evidence.events`

当前安全边界是：

- `decision metadata / history` 可以作为 route summary 的上游输入；
- 但 panel、store、projection 当前都应以 route summary 为主消费面；
- 不应让 client 直接依赖原始 decision metadata 形成新的平行路线状态机。

### 1.4 规划期路线切换的完整设计流程

规划期路线切换在 design 层应被定义为四步，而不是只剩“查看候选路线”：

1. 进入候选路线比较态
   - 输入：`candidateRoutes`、`recommendedRouteId`、`route diff`、`recommendationReasons`
   - 输出：当前推荐路线高亮、备选路线可比对
2. 选择候选路线
   - 输入：`selectedRouteOptionId / selectedRouteId / changedReason`
   - 输出：`selection.mode = user_selected`、`selectedRouteId` 更新为候选路线
3. 恢复系统推荐
   - 输入：显式 `restore-recommended-route` 动作
   - 输出：`selectedRouteId = recommendedRouteId`、`changedReason` 记录为 `restore_recommended`
   - 约束：不得仅靠前端本地状态回退，必须有显式 mutation 或等价任务级写回
4. 确认执行并锁定
   - 输入：`confirm-route-and-start`
   - 输出：`selectionLocked = true`、`selection.status = locked`、写入 `route.locked` 事件
   - 约束：确认执行后再切换路线必须转入执行期改线规则

#### 规划期状态机

| 规划期状态 | 允许动作 | 产出 | 下一状态 |
| ---- | ---- | ---- | ---- |
| `recommended` | 查看对比、选路 | 展示推荐与备选 | `comparing` |
| `comparing` | 选择候选、恢复推荐 | `selectedRouteId / changedReason` | `selected` |
| `selected` | 再次切换、恢复推荐、确认执行 | route-selection mutation | `selected` 或 `confirmed` |
| `confirmed` | 不再自由切换 | `selectionLocked = true` | 执行期 |

#### 当前实现边界

当前真实已落地的是：

- `recommended -> comparing -> selected` 这条摘要投影链；
- `restore recommended` 与 `confirm-route-and-start` 仍属于设计态交互，不得冒充已实现。

### 2. 执行前锁定

一旦用户确认启动执行：

- 当前所选路线进入锁定状态
- `selectionLocked = true`
- runtime 记录当前路线

此时再切换路线，不应被视作普通 UI 操作，而应进入：

- 重规划
- 接管确认
- 或阻止切换

### 3. 执行期改线

执行期可能出现三类改线：

1. 用户主动请求改线
2. 系统因高风险或预算触发降级改线
3. 系统因质量不达标或阻塞触发重规划

执行期改线必须：

- 有明确触发原因
- 有接管要求
- 有 runtime 事件记录
- 有 replay / audit 证据

### 3.1 当前已存在的最小执行期改线语义

当前主仓已被直接代码与直接测试稳定证明的执行期改线，只有一条“runtime 重规划摘要链”：

| 字段 | 当前稳定口径 |
| ---- | ---- |
| `route.selectionStatus` | `replanned` |
| `route.selection.mode` | `runtime_replanned` |
| `route.changeReason` | 改线原因摘要 |
| `route.replan.active` | `true` |
| `route.replan.fromRouteId / toRouteId / triggeredBy` | 前后路线与触发方 |
| `route.evidence.lastEventType` | `route.replanned` |
| `route.evidence.events[]` | 包含 `route.replanned` 事件 |

因此当前可保守成立的是：

- “执行期系统重规划摘要语义”已存在；
- 但“用户主动改线”“system downgraded 专门路径”“Mission Runtime 正式按 route mutation 重写执行策略”仍未形成完整闭环。

### 3.2 执行期改线设计的三层边界

为避免把 `runtime_replanned` 一条摘要链外推成完整执行期改线系统，本 spec 将执行期改线设计明确拆成三层：

1. 已实现摘要层
   - `selectionStatus = replanned`
   - `selection.mode = runtime_replanned`
   - `route.replan.*`
   - `route.evidence[eventType=route.replanned]`
2. 设计待实现的治理层
   - 用户主动改线
   - 系统因预算 / 权限 / 风险触发降级改线
   - 改线前后接管规则与确认策略
3. 设计待实现的执行层
   - `Mission Runtime` 正式按 route mutation 改写后续执行策略
   - replay 页面按路线时间线回放这些变化

当前只能把第 1 层当作已被代码与测试锚定的能力。

### 3.3 执行期改线的最小消费者契约

当前执行期改线虽然还没有完整治理闭环，但已经形成一个最小消费者契约：

1. shared summary
   - 输出 `selection.status = replanned`
   - 输出 `selection.mode = runtime_replanned`
   - 输出 `route.changeReason`
   - 输出 `route.replan.*`
   - 输出 `route.evidence[eventType=route.replanned]`
2. mission projection
   - 对齐 `route.replan`、`route.selection`、`evidence.correlation.selectedRouteId`
   - 把 execution / explanation / orchestration 中的重规划摘要连成同一条投影链
3. client store / panel
   - 消费 `replanned` 状态、前后路线、改线原因、证据与 explanation

当前不能越界写成既成事实的内容：

- `Mission Runtime` 已经基于 `selectedRouteId / selectionLocked / changedReason` 正式改写执行策略；
- 用户主动改线与系统降级改线已经拥有稳定的执行期 mutation 语义；
- replay 页面已经能按路线时间线回放执行期改线。

### 3.4 执行期改线三类路径矩阵

为满足 route lane 对“用户主动改线 / 系统降级改线 / 系统重规划”三类路径的定义要求，本 spec 在设计层给出统一矩阵：

| 路径 | 触发方 | 典型触发条件 | 是否必须接管 | runtime 目标动作 | 最小证据要求 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| 用户主动改线 | `user` | 用户在执行中要求从当前路线切到另一候选路线 | 是 | `route override -> takeover -> rebind plan` | `route.selected` 或 `route.replanned`、`decisionId`、`changedReason=user_override` |
| 系统降级改线 | `runtime / governance` | 预算越界、权限不足、外部副作用受限、高风险动作命中 | 是 | `downgrade route -> restrict actions -> waiting/approval` | `route.replanned`、`actor=runtime`、`reasonType=governance_downgrade` |
| 系统重规划 | `runtime` | 工具失败、质量不达标、依赖不可用、结构性阻塞 | 视风险而定 | `replan route -> preserve valid steps -> continue` | `route.replanned`、`fromRouteId / toRouteId`、`triggeredBy`、`preserved context` |

这张矩阵的作用是：

- 明确三类路径都属于“执行期改线”，但触发方、接管门槛和治理要求不同；
- 防止把所有改线都写成同一种 `runtime_replanned` 文案。

### 3.5 路线切换与高风险动作的接管矩阵

高风险动作不应只由 takeover spec 承担，route lane 自身也必须给出路线上下文里的门控规则：

| 风险条件 | 规划期是否可自由切换 | 执行期是否可静默改线 | 必须进入的接管类型 | 允许的路线倾向 |
| ---- | ---- | ---- | ---- | ---- |
| 预算越界或预算审批 | 否 | 否 | `budget / route-selection` | `standard / deep` |
| 权限升级或审批门 | 否 | 否 | `approval / permission` | `standard / deep` |
| 外部写操作或副作用动作 | 否 | 否 | `risk / approval / route-selection` | 不得默认 `fast` |
| 高风险工具链或不可逆动作 | 否 | 否 | `risk_acceptance / operator takeover` | `standard / deep` |
| 结果质量不足但无副作用 | 是 | 否，需按规则重规划 | `route-selection` 或 `review-driven replan` | `standard / deep` |

保守边界：

- 规划期只有在未进入执行前，且未命中上述高风险条件时，才允许“自由切换”；
- 命中高风险条件后，route lane 必须把“是否切换路线”提升为接管决策，而不是普通 UI 切换。

### 4. 交付期路线回看

在任务完成后，用户应能回看：

- 初始推荐路线
- 最终采用路线
- 中途是否发生改线
- 改线原因
- 改线后结果质量变化

## 路线类型设计

### 最快

产品语义：

- 以最短路径快速到达可用结果

规划特征：

- 优先较短阶段链路
- 降低 review / 深度分析比例
- 更偏向草案与原型输出

运行时特征：

- 更少阶段
- 更少接管点
- 更高速度倾向

当前兼容锚点（2026-04-25）：

- 当前 shared contract 中的对应模式是 `mode = fast`
- `shared/mission/autopilot.ts` 与 `client/src/lib/tasks-store.ts` 都稳定把它作为一条候选路线输出
- `TaskAutopilotPanel` 已稳定消费其 `summary / reason / description / estimatedDuration / estimatedCost / takeoverLoad / riskLevel`

过渡边界：

- 当前 `fast` 还不是跨页面统一命名的 `fastest`
- 但在 route lane 内，已经足以作为“最快路线”的最小兼容层

### 最稳

产品语义：

- 以可信、可控、可审计为优先目标

规划特征：

- 增加 review / verify / approval
- 保留更多证据与中间确认
- 风险动作前强制接管

运行时特征：

- 更明确的治理策略
- 更高可回放性
- 更强交付可信度

当前兼容锚点（2026-04-25）：

- 当前 shared contract 中的对应模式是 `mode = standard`
- 当前 builder 对它的稳定摘要是 `Balance execution depth, governance, and delivery confidence.`
- 当前 panel 的 `Selected / Recommended / Alternatives / Route Diff` 已稳定把它作为与 `fast / deep` 可横向比较的中间路线

过渡边界：

- 当前 `standard` 只能保守视为“最稳”的过渡兼容语义，不是已经完成命名统一的 `safest`
- 现有证据能证明它是“平衡治理与交付信心”的默认稳态路线，但还不能外推成跨任务域统一词典

### 最深

产品语义：

- 以研究深度、方案完整度和多轮迭代为优先目标

规划特征：

- 增加检索、对比、综合、修订
- 更长的分析阶段
- 更高工具 / 节点调用密度

运行时特征：

- 时长更长
- 成本更高
- 结果通常更完整

当前兼容锚点（2026-04-25）：

- 当前 shared contract 中的对应模式是 `mode = deep`
- 当前 builder 的稳定摘要是 `Favor verification, recovery headroom, and auditability.`
- 在 waiting / high-risk 场景中，deep route 会被赋予更明确的治理型推荐理由

过渡边界：

- 当前 `deep` 兼具“更深”与“更稳的治理余量”两层含义
- 因此它足以作为“最深路线”的兼容锚点，但还不能替代未来更精细的 `deepest` / `safest` 分裂语义

### 路线模式统一语义矩阵

当前仓库还没有单独的 `routeKind = fastest / safest / deepest` 合同，因此本 spec 采用“产品语义 -> 现有 mode”的兼容矩阵：

| 产品语义 | 当前兼容 mode | 当前稳定摘要 | 典型展示差异 | 当前边界 |
| ---- | ---- | ---- | ---- | ---- |
| `最快` | `fast` | `Favor shorter execution chains and minimal confirmations.` | 时长更短、成本更低、阶段更少 | 仍需避免高风险默认执行 |
| `最稳` | `standard` | `Balance execution depth, governance, and delivery confidence.` | 速度/成本/治理更平衡 | 只是过渡兼容层，不是完整 `safest` 词典 |
| `最深` | `deep` | `Favor verification, recovery headroom, and auditability.` | 治理/验证更强、成本更高、时长更长 | 兼具深度和治理语义，尚未拆成更细 route kind |

这张矩阵的作用是：

- 让当前 `fast / standard / deep` 不再只是内部字符串；
- 同时避免误写成“已经完成跨页面统一命名”。

## 与 mission-first 系统的映射

### 1. 与 Mission 的映射

路线推荐是任务级对象，因此建议挂载在任务上下文中。

建议概念映射：

- `mission.routeCandidates`
- `mission.recommendedRouteId`
- `mission.selectedRouteId`
- `mission.routeSelectionMode`

说明：

- 当前 spec 不要求立刻改数据库结构
- 但后续实现时应保证这些对象至少能在任务上下文或 runtime context 中被读取

### 1.1 当前最小数据结构与过渡挂载

当前无需新增数据库字段，已经有一套可被 summary / projection / panel 持续消费的最小 route 数据结构：

| 当前结构 | 已稳定字段 |
| ---- | ---- |
| `MissionAutopilotSummary.route` | `candidateRoutes / recommendedRouteId / selectedRouteId / selectionStatus / selectionLocked / selection.* / evidence.* / replan.*` |
| `decisionHistory[].resolved.metadata.formData` | `selectedRouteOptionId / selectedRouteLabel / selectedRouteId / changedReason` |
| `evidence.correlation` | `recommendedRouteId / selectedRouteId / decisionIds / routeIds / routeStageKeys` |

这意味着：

- 当前已经足以完成“路线选择结果写入任务上下文或 runtime context 的最小数据结构”设计任务；
- 但还不能直接宣称 `Mission Runtime` 已把这些字段作为正式执行输入消费。

### 2. 与 Workflow 的映射

底层 `Workflow` 仍负责具体阶段与节点推进。
路线选择不直接替代 workflow，而是影响 workflow 的：

- 阶段组合
- review 深度
- 并行 / 串行安排
- 决策点数量
- 风险动作接管策略

也就是说：

- 路线是 workflow 的高层策略投影
- workflow 是路线的具体执行展开

### 3. 与 Mission Runtime 的映射

Mission Runtime 至少需要知道：

- 当前任务选中了哪条路线
- 当前路线是否已锁定
- 当前运行是否发生重规划
- 当前重规划是否为用户触发或系统触发

建议的 runtime 行为：

1. 读取 `selectedRouteId`
2. 将其作为当前执行主策略
3. 若命中风险 / 阻塞 / 质量问题，则触发：
   - takeover
   - downgrade
   - replanning
4. 记录路线变化事件

### 3.1 当前与 Mission Runtime 的最小已实现边界

当前可以直接确认的不是“Mission Runtime 已正式消费路线”，而是：

- shared builder 已把 `selectedRouteId / selectionLocked / selection.changedReason / route.replan.*` 结构化到 `MissionAutopilotSummary.route`。
- `server/tasks/mission-projection.ts` 会把这些 route summary 字段继续对齐到 projection / links / evidence correlation。
- client store 与 `TaskAutopilotPanel` 会把这些字段稳定消费成任务详情中的 route / evidence / explanation 展示。

因此当前闭环的是：

- `decision submit -> route summary -> mission projection -> client normalize -> panel`

当前未闭环的是：

- `Mission Runtime` 主执行逻辑直接读取 `selectedRouteId / selectionLocked / changedReason` 并据此分叉执行。

### 3.2 runtime 对接的设计态分层

为了让后续实现不会把 projection 层误当成 runtime 执行层，本 spec 将 runtime 对接拆成三层：

1. 已实现的数据面对接
   - route summary 进入 `MissionAutopilotSummary`
   - projection 对齐 links、correlation、explanation、orchestration.replan
   - client 可稳定消费 selected/recommended/replanned 相关字段
2. 待实现的执行面对接
   - `Mission Runtime` 在 stage dispatch、review 深度、风险动作前确认等执行逻辑中正式读取 `selectedRouteId / selectionLocked / changedReason`
   - route-selection / route-replan 成为执行规则输入，而不只是摘要输出
3. 待实现的治理面对接
   - route mutation 与预算、权限、副作用、风险动作治理联动
   - 形成路线上下文驱动的 takeover / audit / replay 规则

本 spec 当前只能把第 1 层视为现实闭环，第 2 层和第 3 层保持设计态。

### 3.3 Route Selection 到 Mission Runtime 的设计态对接流程

route lane 在设计层需要给出一条明确的 runtime handoff 顺序，避免“route summary 已存在”与“runtime 已消费路线”之间继续模糊：

1. 规划期产出路线选择事实
   - `recommendedRouteId`
   - `selectedRouteId`
   - `selection.mode`
   - `selectionLocked`
   - `changedReason`
2. 任务启动前写入执行输入
   - runtime 读取 route selection snapshot
   - 以 `selectedRouteId` 作为本次 mission 的执行主策略键
3. 任务执行中读取路由策略
   - `plan / provision` 阶段决定阶段深度、review 强度、候选工具范围
   - `execute` 阶段决定是否允许 shortcut、是否保留 recovery headroom
   - `finalize` 阶段决定 review / verify / delivery gate 的深浅
4. 改线时回写 runtime mutation
   - 用户改线：生成接管决策并等待确认
   - 系统降级：生成治理型改线事件
   - 系统重规划：生成 execution-driven replan 事件
5. 将结果重新投影回 route summary / evidence / replay anchors

#### runtime 侧最小消费者合同

| runtime 消费点 | 必读字段 | 作用 |
| ---- | ---- | ---- |
| `plan` | `recommendedRouteId / selectedRouteId / selection.mode` | 决定默认路线与是否进入手动确认 |
| `provision` | `selectionLocked / changedReason` | 决定是否允许继续改动路线与是否需要额外治理资源 |
| `execute` | `selectedRouteId / replan.* / selection.mode` | 决定执行深度、失败恢复与是否触发重规划 |
| `finalize` | `selectedRouteId / changeReason / evidence.events` | 决定 review/verify/acceptance 强度与回放锚点 |

当前仍需保守声明：

- 这是一条设计态 runtime handoff；
- 当前已实现的只是“这些字段可被 summary / projection / client 消费”，不是 runtime 已正式读用。

### 4. 与 HITL 的映射

路线选择是接管体系中的一类核心事件。

建议四类路线相关接管：

- 启动前路线确认
- 风险动作前路线确认
- 执行期改线确认
- 结果交付前路线复核

这意味着路线选择面板应与现有 `DecisionPanel` / review 链路兼容，而不是另起一套审批系统。

### 5. 与 Replay / Audit 的映射

路线是用户能理解的核心叙事对象，因此必须进入回放与审计。

建议最小事件：

- `route.recommended`
- `route.selected`
- `route.locked`
- `route.replanned`
- `route.selection_rejected`
- `route.selection_confirmed`

每个事件至少应包含：

- 任务标识
- 路线标识
- 触发方
- 触发原因
- 等级与风险上下文

### 5.1 当前最小事件与证据字段口径

当前 route lane 已经有一套最小事件口径，并且 shared / projection / store / panel 都能稳定消费：

| 事件 | 当前字段锚点 |
| ---- | ---- |
| `route.recommended` | `route.evidence.events[].eventType = route.recommended` |
| `route.selected` | `route.evidence.events[].eventType = route.selected` |
| `route.locked` | `route.evidence.events[].eventType = route.locked` |
| `route.replanned` | `route.evidence.events[].eventType = route.replanned` |

| 最小证据字段 | 当前锚点 |
| ---- | ---- |
| `eventType` | `route.evidence.events[].eventType` |
| `at` | `route.evidence.events[].at` |
| `actor` | `route.evidence.events[].actor` |
| `reason` | `route.evidence.events[].reason` |
| `fromRouteId` | `route.evidence.events[].fromRouteId` |
| `toRouteId` | `route.evidence.events[].toRouteId` |
| `decisionId` 锚点 | `takeover.decisionId`、`route.takeoverPointIds[0]`、`evidence.correlation.decisionIds` |
| `selectedRouteId / recommendedRouteId` 关联 | `route.selectedRouteId / recommendedRouteId`、`evidence.correlation.selectedRouteId / recommendedRouteId` |

当前仍未完成的字段：

- 自动驾驶等级上下文；
- 最终结果映射；
- 专门的 replay 页面路线时间线 UI；
- `Mission Runtime` 正式消费这些事件作为执行规则输入的链路。

因此，本 spec 当前可以把“最小路线事件与证据字段”设计任务收口，但不能把更强的 runtime / replay 能力写成已实现。

### 5.1.1 路线事件的设计态扩展字段合同

在最小字段之外，route lane 还需要定义未来统一事件 envelope，确保后续 audit / replay / runtime 可以共用一份路线证据结构：

| 字段 | 含义 | 当前锚点 | 当前状态 |
| ---- | ---- | ---- | ---- |
| `eventType` | 路线事件类型 | `route.evidence.events[].eventType` | 已有最小实现 |
| `at` | 发生时间 | `route.evidence.events[].at` | 已有最小实现 |
| `actor` | 触发方 | `route.evidence.events[].actor` | 已有最小实现 |
| `reason` | 触发原因 | `route.evidence.events[].reason` | 已有最小实现 |
| `fromRouteId / toRouteId` | 前后路线 | `route.evidence.events[].fromRouteId / toRouteId` | 已有最小实现 |
| `decisionId` | route-selection 锚点 | `takeover.decisionId / evidence.correlation.decisionIds` | 已有近似实现 |
| `selectedRouteId / recommendedRouteId` | 当前路由关联键 | `route.* / evidence.correlation.*` | 已有最小实现 |
| `autopilotLevelContext` | 当前等级语义 | 设计态新增 | 设计已定义，未实现 |
| `riskContext` | 风险与治理上下文 | 设计态新增 | 设计已定义，未实现 |
| `resultMapping` | 最终交付采用路线或结果版本 | 设计态新增 | 设计已定义，未实现 |
| `sourceLayer` | `planner / decision / runtime / governance` | 设计态新增 | 设计已定义，未实现 |

#### 设计态事件命名约束

- 规划期选择以 `route.selected / route.selection_rejected / route.selection_confirmed` 表达；
- 执行期切换以 `route.replanned` 表达，不得把执行期改线伪装成普通 `route.selected`；
- 路线锁定必须保留 `route.locked`，避免“已确认执行”只剩 UI 状态没有事件锚点。

### 5.2 当前工作台与回放交互的最小落点

当前与路线相关的产品落点可以分成三类：

1. 任务详情驾驶舱切片
   - 已落地。
   - 由 `TaskAutopilotPanel` 承载 `Destination / Route / Evidence / Explanation / Takeover` 等最小路线叙事。
2. `/tasks` 工作台级路线对比与确认
   - 未落地。
   - 当前还没有独立的多路线工作台交互容器，也没有“恢复推荐 / 确认执行”的 mutation 流。
3. replay 页面路线时间线
   - 未落地。
   - 当前只有 `route.evidence.events` 与 `evidence.correlation` 的最小字段，尚未形成专门路线时间线 UI。

因此当前最适合的产品表述是：

- “任务详情中已有最小路线驾驶舱切片”

而不是：

- “工作台与回放已经形成完整路线交互”。

### 5.3 工作台与回放的设计态输入约束

后续如果要补 `/tasks` 工作台与 replay 页面，当前 route lane 至少已经给出以下输入约束：

1. 工作台级路线对比必须复用而不是重建的字段
   - `candidateRoutes`
   - `recommendedRouteId`
   - `selectedRouteId`
   - `selection.status / mode / changedReason`
   - `estimatedDuration / estimatedCost / takeoverLoad / riskLevel`
2. 回放页路线时间线必须复用而不是重建的字段
   - `route.evidence.lastEventType / lastEventAt / events`
   - `evidence.correlation.routeIds / selectedRouteId / recommendedRouteId / decisionIds`
   - `route.replan.*`
3. 当前仍不得假设已存在的能力
   - 工作台级“恢复推荐 / 确认执行” mutation
   - 独立路线时间线 UI
   - 以路线为中心的交互回放控制器

### 5.4 `/tasks` 工作台的路线对比与确认交互设计

`/tasks` 工作台在设计层应以“三栏但单焦点”的路线工作面呈现，而不是把 route block 直接从任务详情搬过去：

1. 左侧：路线列表与推荐说明
   - 展示 `recommendedRouteId`、候选路线标签、默认推荐理由
2. 中部：路线差异面
   - 展示 `estimatedDuration / estimatedCost / takeoverLoad / riskLevel / phaseOutline`
3. 右侧：确认与恢复动作
   - `select route`
   - `restore recommended`
   - `confirm route and start`
   - 风险命中时展示 takeover prompt

#### 工作台最小交互合同

| 交互动作 | 必需输入 | 必需输出 |
| ---- | ---- | ---- |
| 比较路线 | `candidateRoutes` | 当前比较态 |
| 选择候选路线 | `selectedRouteId / changedReason` | route-selection mutation |
| 恢复推荐路线 | `recommendedRouteId` | `selectedRouteId = recommendedRouteId` |
| 确认执行 | `selectedRouteId / selectionLocked` | `route.locked` 事件与任务启动 |

当前边界保持：

- 这是 `/tasks` 工作台的设计态交互，不是当前已存在页面；
- 当前代码中仍只有任务详情里的最小 route summary 面板。

### 5.5 replay 页面的路线时间线设计

replay 页面在设计层应把路线叙事做成一条单独时间线，而不是只依赖 execution timeline：

#### 必须展示的路线节点

- `route.recommended`
- `route.selected`
- `route.locked`
- `route.replanned`
- `final route used for delivery`

#### 每个路线节点的最小信息

- `occurredAt`
- `eventType`
- `fromRouteId / toRouteId`
- `actor`
- `reason`
- `decisionId`
- `selectedRouteId / recommendedRouteId`
- 关联 `stageKey / routeStep / result version`（设计态）

#### replay 交互能力

1. 查看推荐路线与最终采用路线的差异
2. 看到中途是否发生改线，以及为何发生
3. 跳转到对应 decision、evidence、takeover 或 result
4. 按 route / decision / stage 过滤

当前边界保持：

- 这是 replay 路线时间线的设计态合同；
- 当前已实现的仍是 `route.evidence.events + evidence.correlation` 的最小字段与跳转锚点。

## 预估模型设计

### 1. 时长预估

当前不要求精确预测真实秒数，但应支持相对可比表达。

建议表达方式：

- 区间，如 `5-10 分钟`
- 档位，如 `低 / 中 / 高`
- 或组合表达，如 `中等时长（约 8-15 分钟）`

### 2. 成本预估

当前不要求精确 token 计费，但应支持用户感知上的比较。

建议表达方式：

- 成本档位：`低 / 中 / 高`
- 成本区间：如 `约 1x / 1.5x / 2.5x`
- 或预算提示：`可能触发更高模型与更多检索`

### 3. 接管预估

接管是路线选择的关键差异维度。
建议至少提供：

- 少量接管
- 中等接管
- 较多接管

或给出更明确说明：

- 启动前确认
- 中途风险确认
- 最终结果确认

## 驾驶舱信息架构设计

路线推荐与选择建议位于驾驶舱左侧“目的地与路线”区域。

建议布局：

- 顶部：当前目标卡片
- 中部：默认推荐路线与候选路线标签
- 下部：路线差异对比与推荐原因
- 底部：确认启动 / 切换路线 / 恢复推荐路线

在执行中：

- 左侧持续显示当前路线
- 中部显示当前阶段和路线进度
- 右侧显示接管、证据、风险提示

### 当前任务详情落点（2026-04-25）

当前主仓已经有一个可直接锚定的最小落点：

- `TaskAutopilotPanel` 在任务详情中把 `Destination` 与 `Route` 放在最靠前位置。
- route 区块已稳定承载：
  - `Selected`
  - `Recommended`
  - `Alternatives`
  - `Route Diff`
  - `Selection`
  - `Replan`
  - `Route Evidence`
- evidence / explanation 区块也已经能对路线选择、重规划原因与 correlation 做最小消费。

因此本 spec 当前可以把“驾驶舱中的路线推荐区域”收口到任务详情级，而不应误写成已经存在完整左栏工作台。

## 首批试点任务计划（设计态）

当前虽然还不能把“首批试点任务清单”勾成已完成，但设计上可以先给出保守试点顺序：

### P0：最适合先接入路线推荐的任务

- `analysis`
  - 当前 shared builder 对分析类任务更容易推导 `standard / deep` 倾向。
- `research`
  - 当前 deep route 的治理型推荐理由在研究场景最容易成立。
- `chat`
  - 当前 fast route 的低风险、低副作用路径最容易被验证。

### P1：可在现有摘要链基础上扩展的任务

- 带 route-selection 等待态的治理任务
  - 已有 `takeover.type = route-selection` 与 `decisionHistory` 回投链。
- 带 retry / replanned 摘要链的任务
  - 已有 `runtime_replanned` 摘要与 evidence 事件。

### P2：不建议现在就作为路线推荐主试点的任务

- `nl-command`
  - 外部副作用、权限边界和执行级 route mutation 还未闭环。
- 更高风险的外部写入与权限升级任务
  - 当前还缺少路线级预算 / 权限 / 外部副作用接管规则。

### 试点接入守则（2026-04-25）

为避免把“设计态试点计划”误写成“已实施上线范围”，当前应额外遵守以下守则：

- 只有已经被 shared / projection / store / panel 直接锚定的 route summary 字段，才能作为首批试点任务的展示输入。
- 首批试点只能承诺“看得见默认推荐、候选路线、选择结果、重规划摘要与证据关联”，不能承诺“工作台级改线闭环”。
- 试点优先顺序应服务于验证推荐与解释链路，而不是提前验证高风险 route mutation 治理链路。
- 因此 `analysis / research / chat` 仍适合作为设计态 P0，`nl-command` 与更高风险副作用任务仍应留在后续治理阶段。

### 试点任务清单的准入与退出条件

为了让“试点任务清单”不只是一组名字，本 spec 额外定义 route lane 的准入/退出条件：

#### 准入条件

- 已有稳定 `candidateRoutes + recommendedRouteId + selectedRouteId` 摘要链
- 能展示至少一条推荐理由与一组 route diff
- 能把 route-selection 或 replan 事件写入 evidence / correlation
- 不依赖高风险外部副作用作为默认路径

#### 退出条件

- 试点任务在任务详情中无法稳定展示 `Selected / Recommended / Alternatives / Route Diff`
- route-selection 或 replan 事件无法进入 evidence / correlation
- 任务需要工作台级改线闭环才能可用

#### 暂不纳入试点的排除项

- 默认即触发权限升级、预算审批或外部写操作的任务
- 需要 runtime 正式消费 route mutation 才成立的任务
- 需要 replay 独立路线时间线才能解释清楚的任务

## 风险与限制

### 1. 过度简化风险

如果只给“最快 / 最稳 / 最深”三种名字，却没有阶段差异、成本差异、接管差异，用户会把它视为装饰性 UI。
因此必须保证每条路线有真实差异。

### 2. 与 runtime 断层风险

如果前端允许切换路线，但 runtime 不知道当前路线是谁，系统将产生严重语义断层。
因此路线选择必须写入任务或运行时上下文。

### 3. 过度自动化风险

如果允许执行期静默切换路线，用户会失去控制感。
因此执行期改线必须被视为显式重规划事件。

### 4. 预估失真风险

当前成本与时长预估只能做经验化表达，不能过度承诺数值精度。
因此建议先做“可比较”，再逐步演进到“更精确”。

## 设计结论

路线推荐与路线选择是任务自动驾驶平台中最关键的用户态能力之一。
它把“系统准备怎么把我送到结果”从黑盒内部状态，变成用户可见、可比较、可接管的驾驶决策层。

在当前阶段，设计上应优先完成：

- 候选路线对象模型
- 默认推荐与三路线对比
- 规划期选择与执行期锁定
- 路线相关 HITL / replay / audit 事件
- 与 Route Planner、Mission Runtime 的最小映射

这样才能让 mission-first 的执行底座真正升级成“任务自动驾驶”的可感知产品体验。

## Design Audit Note（2026-04-24）

本轮基于当前真实代码与测试，对 route lane 的最小落地状态做一次保守审计：

- 本轮重新按“直接代码 + 直接测试”收口后，没有新增勾选，并撤回了 tasks 里的 `11`：
  - 任务原文要求同时明确“用户主动改线 / 系统降级改线 / 系统重规划”三类执行期改线路径。
  - 现有直接证据只稳定证明了 `runtime_replanned` 这一条最小摘要链已经落在共享 contract、服务端 projection、client normalize 和 panel 展示里。
  - `shared/mission/autopilot.ts` 虽声明了 `user_selected` 与 `system_downgraded` 等枚举，但当前给出的真实 builder 行为只有：
    - `selectedRoute && !selectedRoute.recommended -> user_selected`
    - `(mission.attempt ?? 1) > 1 -> runtime_replanned`
  - 在你限定的证据范围里，没有直接代码 + 直接测试去证明：
    - 用户真的可以在规划期或执行期主动改到另一条非推荐路线，并形成稳定的 route mutation / event / replay 语义；
    - 系统真的存在“因预算 / 风险 / 治理要求而触发的 system downgraded”专门路径；
    - `Mission Runtime` 已消费这三类差异并形成不同治理规则。
  - 因此这一项不能继续按“完整的执行期改线与重规划规则”保留为已完成，只能保守承认当前已经具备“运行时重规划摘要语义”。

- 已有稳定的共享字段闭环：
  - `shared/mission/autopilot.ts` 中的 `MissionAutopilotSummary.route` 已稳定承载 `recommendedRouteId`、`selectedRouteId`、`candidateRoutes`、`selectionStatus`、`selectionLocked`、`selection.{status, mode, locked, canSwitch, switchRequiresConfirmation, changedAt, changedBy, changedReason}`、`evidence.{lastEventType, lastEventAt, events}`、`replan.{active, reason, fromRouteId, toRouteId, triggeredBy}`。
- 已有稳定的构建与归一化闭环：
  - `shared/__tests__/mission-autopilot.test.ts` 覆盖了推荐态、等待 route-selection / waiting 态，以及 runtime replanned 态。
  - `client/src/lib/tasks-store.autopilot.test.ts` 覆盖了 store 对 route selection、route evidence、route replan 的 fallback / normalize，其中包括 `alternatives-available` 与 `replanned` 两类关键状态。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 覆盖了 cockpit route block 对 candidate routes、selection、replan、evidence 与 “可切换且需确认” 提示的消费。
- 已有稳定的锁定语义闭环：
  - `shared/mission/autopilot.ts` 已同时投影 `selectionLocked`、`selection.locked`、`selection.canSwitch`、`selection.switchRequiresConfirmation` 与 `route.evidence[eventType=route.locked]`。
  - shared/store/panel 测试已覆盖两类最关键口径：`alternatives-available + locked + canSwitch + switchRequiresConfirmation` 的等待确认态，以及 `replanned + runtime_replanned` 的运行时改线态。
- 已有稳定的最小时长 / 成本展示闭环：
  - shared candidate routes 已稳定输出 `estimatedDuration`、`estimatedCost`，`TaskAutopilotPanel` 会在候选路线详情与 `Route Diff` 中直接消费这两个字段。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接断言 `ETA / Cost` 在 selected、recommended、alternatives 和 route diff 中的展示，因此可以保守认定“路线卡片的最小时长/成本表达”已经存在。
- 已有稳定的推荐理由展示闭环：
  - `shared/mission/autopilot.ts` 在 candidate routes 上稳定输出 `summary / reason / description`，其中 deep route 还能在高风险或 waiting 场景下生成更明确的治理型推荐理由。
  - `shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 已覆盖默认推荐理由、等待确认态推荐理由和 replanned 之后 explanation reasons 的投影。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 route block 中的 `Selected / Recommended / Alternatives` 文案消费，以及 explanation block 中的 `Why` 展示，因此可以保守认定“路线卡片的最小推荐理由模板”已经存在。
- 已有稳定的执行期改线 / 重规划摘要闭环：
  - `shared/mission/autopilot.ts` 已同时承载 `selection.status = replanned`、`selection.mode = runtime_replanned`、`route.evidence[eventType=route.replanned]` 与 `route.replan.{active, reason, fromRouteId, toRouteId, triggeredBy}`。
  - shared/store/panel 测试已覆盖 runtime 改线后的“选择状态、改线原因、前后路线、重规划证据、route locked / canSwitch / confirmation 提示”的最小语义链。
- 因此可以保守认定：当前已经有一套“可被任务上下文 / runtime context 消费的最小路线选择结构”，虽然它还没有完整写回 Mission Runtime 的服务端链路，但结构本身、字段口径与前端消费方都已经稳定。

本轮仍不建议进一步勾选以下项：

- `设计规划期路线切换流程`
  - 现状只有候选路线、选择状态与展示；没有真正的切换交互流、恢复推荐流与确认执行流。
- `设计执行期改线与重规划规则`
  - 当前最多只能保守视为“执行期改线 / 重规划摘要语义”已经成立；如果要把它提升成完整规则，还缺少用户主动改线、系统降级改线、系统重规划三类路径在产品交互、接管要求、route mutation 事件与 runtime 执行上的完整定义。
- `设计路线选择与 Mission Runtime 的对接流程`
  - 现状已明确最小结构，但还没有充分证据证明 Mission Runtime 已读取并驱动 `selectedRouteId / selectionLocked / changedReason`。
- `设计路线相关事件的证据字段`
  - 现状事件只覆盖最小字段：`eventType / at / actor / reason / fromRouteId / toRouteId`，还不足以宣称已覆盖自动驾驶等级、风险上下文和最终结果映射。

补充说明：

- 当前 route lane 还可以保守认定“驾驶舱中的路线推荐区域”已有最小落点：
  - `TaskAutopilotPanel` 在任务详情中将 `Destination` 与 `Route` 作为最先展示的区块；
  - `Route` 区块已承载当前路线、推荐路线、备选路线、路线差异、选择状态、确认要求、重规划摘要与路线证据；
  - 因而它已经形成了左侧“目的地与路线”区域的最小组件边界，虽然还不是完整独立的 cockpit 左栏。
- 当前 route lane 也可以保守认定“候选路线卡片上的最小时长 / 成本表达”已经有展示口径：
  - 现有面板和测试都把 `estimatedDuration / estimatedCost` 当作候选路线元数据的一部分来消费；
  - 但这仍只是字符串/标签级展示，不应被误读为统一预算模型、精确时长估算或跨任务域的估算标准已经完成。
- 当前 route lane 还可以保守认定“候选路线卡片上的最小推荐理由模板”已经有展示口径：
  - shared builder 已稳定输出 `summary / reason / description`，panel 会在 route block 与 explanation block 中消费它们；
  - 但这仍是字符串级模板，不等于统一的 `fastest / safest / deepest` 语义字典、结构化 tradeoff notes 或 planner score 驱动的话术系统已经完成。
- 这个结论仍需限定边界：
  - 当前只是 task detail 中的 P1 驾驶舱切片，不等于完整路线对比工作台；
  - 也还没有形成用户可操作的规划期切换流、恢复推荐流或确认执行流。
  - `Route Planner 输出 -> Mission Runtime 消费 -> replay / audit 页面回放` 这条真正端到端链路也还没有闭环。

## Design Audit Note（2026-04-25）

本轮按最新工作树中的 route-selection 增强再做一次保守复核，结论仍是：不新增勾选，只补强 “decision -> summary -> projection -> panel” 这条已被证明的链路说明。

- 新增直接代码与测试事实：
  - `server/tasks/mission-decision.ts` 会在可识别的 route-selection 决策提交成功后，把 `selectedRouteOptionId`、`selectedRouteLabel`、`selectedRouteId` 与 `changedReason` 写入 `resolved.metadata.formData`。
  - `server/tests/hitl-decision.test.ts` 已直接断言这组字段会进入 `decision` 与 `decisionHistory`。
  - `shared/mission/autopilot.ts` 与 `shared/__tests__/mission-autopilot.test.ts` 已直接证明：resolved route-selection decision history 可以提升为权威 `route.selectedRouteId` 与 `route.selection.changedReason`；当 `formData.selectedRouteId` 缺失时，还会从 decision payload 的 `candidateRoutes` 解析选中路线。
  - `server/tests/mission-routes.test.ts` 进一步证明：上述 route summary 能稳定进入 mission projection，并把 `recommendedRouteId`、`selectedRouteId`、`selectionStatus`、`route.selection.mode`、`route.evidence` 与 `evidence.correlation.selectedRouteId` 继续投影到任务详情消费层。
- 因而当前可以保守认定：route-selection 决策历史已经不是孤立日志，而是现有 route summary / projection chain 的事实上游输入之一。
- 但这个增强仍不足以新增 design 勾选，原因是：
  - `server/tasks/mission-projection.ts` 消费的是 shared builder 产出的 route summary，而不是让 `Mission Runtime` 基于 route-selection metadata 直接改写执行策略；因此“路线选择与 Mission Runtime 的正式对接流程”仍未闭环。
  - `client/src/lib/tasks-store.ts` 与 `TaskAutopilotPanel.tsx` 消费的仍是 route summary 投影，而不是原始 decision metadata；这说明当前已经形成的是“展示与审计投影闭环”，不是“完整交互与执行闭环”。
  - `selectedRouteLabel` 与 `changedReason` 目前仍分别只是标签快照和用户理由，尚不足以替代统一 `CandidateRoute` 身份模型、结构化改线原因 contract 或治理级 route mutation contract。

因此，本轮增强依然不足以新增完成以下设计项：

- `设计规划期路线切换流程`
- `设计执行期改线与重规划规则`
- `设计路线选择与 Mission Runtime 的对接流程`
- `设计路线相关事件的证据字段`

换句话说，这轮新增事实证明了“route-selection 决策可以被稳定写入并回投到 route summary / projection / panel”，但还没有证明“路线已经被 `Mission Runtime` 作为正式执行策略消费，并在 `/tasks` 与 replay 页面完成统一交互闭环”。

## Design Audit Note（2026-04-25，Lane 3 二次收口）

本轮在不新增代码的前提下，把当前已经被 shared / projection / store / panel 直接锚定的 route lane 设计进一步结构化，新增可直接收口的点如下：

- `最快 / 最稳 / 最深` 的最小统一产品语义
  - 已通过“路线模式统一语义矩阵”把当前 `fast / standard / deep` 与产品层语义对齐
  - 同时明确这只是兼容层，不是已经完成跨页面统一命名
- 路线推荐与自动驾驶等级的最小映射
  - 已在 route mode 语义、默认推荐最小逻辑与 `task-autopilot-levels-l1-to-l5` 的边界上给出最小一致口径
  - 当前仍不冒充“正式评分器或 planner policy 已落码”
- 路线事件的最小证据字段
  - 已把 `route.evidence.events`、`selection.*`、`decisionHistory`、`evidence.correlation` 收敛为统一字段表
  - 当前可以稳定承认 `route.recommended / selected / locked / replanned` 四类事件已经有最小 contract

本轮仍保持保守未收口的点包括：

- 完整的默认推荐判定规则；
- 完整的规划期切换、恢复推荐和确认执行交互；
- Mission Runtime 对 `selectedRouteId / selectionLocked / changedReason` 的正式执行级消费；
- `/tasks` 工作台与 replay 页面上的独立路线交互与时间线。

## Design Audit Note（2026-04-26，按 design 闭环复核）

本轮不再按“代码已实现多少”来判断 route lane 任务是否可勾，而是只按“本 spec 是否已经把对应设计合同定义完整、且边界足够保守”来复核。因此，本轮新增勾选只代表 design 完成，不代表 shared / server / client 已完成实现。

本轮补齐并可按 design 闭环认定完成的内容包括：

- `最快 / 最稳 / 最深` 的统一语义
  - 现已由“路线模式统一语义矩阵”与命名边界约束完成 route lane 内部统一定义。
- 与 `L1-L5` 的映射表
  - 现已由“默认推荐判定优先级”与“路线模式 × 自动驾驶等级边界”完成 route lane 侧定义。
- 默认推荐规则
  - 现已给出判定优先级、输入因子、推荐输出合同与实现边界。
- 规划期切换流程
  - 现已定义完整四步流程、状态机与 `restore recommended / confirm-route-and-start` 的 mutation 契约。
- 执行期改线与高风险接管
  - 现已给出三类执行期改线路径矩阵与高风险动作接管矩阵。
- runtime 对接
  - 现已给出 route selection 到 Mission Runtime 的设计态 handoff 顺序与分阶段消费者合同。
- 事件证据字段
  - 现已把最小字段与设计态扩展字段拆开定义，明确哪些已实现、哪些仍属目标字段。
- `/tasks` 工作台与 replay 时间线
  - 现已分别定义 route workbench 的信息架构、动作合同与 replay 路线时间线节点模型。
- 试点任务清单
  - 现已补齐 P0/P1/P2 顺序、守则以及准入/退出/排除条件。

本轮仍然刻意保留的实现边界：

- `Mission Runtime` 尚未被这里写成“已经正式消费路线选择”；
- `/tasks` 工作台与 replay 时间线仍是设计态页面，不是现有 UI；
- 默认推荐规则的完整 planner policy 仍未被写成当前代码已落地。
