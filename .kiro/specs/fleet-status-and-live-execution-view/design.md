# 设计文档：车队状态与实时执行主视图

## 设计概述

“车队状态与实时执行主视图”是任务自动驾驶驾驶舱中的执行主屏。
它的设计目标不是替代现有 mission 详情页、runtime 面板或 replay 页面，而是在这些能力之上建立一个“用户可直接理解的实时总览层”。

这个主视图要完成两个翻译动作：

1. 把底层 `agent / node / executor / runtime / evidence` 翻译成“当前车队如何推进任务”
2. 把线性或碎片化的运行事实翻译成“当前在哪一步、谁在做、做出了什么、为什么停住、能否恢复”

因此，本设计的核心是“投影层”而不是“重写底层运行时”。

## 设计原则

- 上层抽象必须建立在现有真实运行态之上
- 一类信息只能有一个主入口，避免首页、任务页、dock、debug 多处并列竞争
- 角色层是面向用户的包装层，node / agent / executor 是底层事实层
- 并行状态必须被看见，但不能破坏主线可读性
- 中间产物必须可预览、可追踪、可关联到步骤和角色
- 阻塞和等待必须显式，而不是埋在日志里

## 视图对象模型

建议为前端主视图定义一组投影对象。

### 1. FleetExecutionView

```ts
type FleetExecutionView = {
  taskId: string;
  missionId?: string;
  workflowInstanceId?: string;
  goalSummary: {
    title: string;
    summary: string;
  };
  currentStage: StageSummary;
  currentStep: StepSummary;
  fleetRoles: FleetRoleCard[];
  parallelLanes: ParallelLaneSummary[];
  blockers: BlockerSummary[];
  intermediateOutputs: IntermediateOutputSummary[];
  evidence: EvidenceDockSummary;
  runtimeHealth: RuntimeHealthSummary;
  updatedAt: string;
};
```

2026-04-25 收口口径：

- 当前主仓里首版 `FleetExecutionView` 的真实落点，不是一个被代码直接导出的独立顶层对象，而是 `MissionAutopilotSummary` 这组组合投影：
  - `destination / driveState / route`
  - `execution / fleet / takeover / recovery`
  - `evidence / explanation / bindings`
- 因此，如果沿现有主仓继续实现，本 spec 应优先把 `FleetExecutionView` 理解为“产品语义上的组合视图 contract”，而不是要求先新增一套与 `MissionAutopilotSummary` 平行的 schema。
- 这条收口与当前代码、projection、client normalize、`TaskAutopilotPanel` 展示和相关测试保持一致，也能避免在首轮实现里过早引入重复事实源。

### 2. FleetRoleCard

```ts
type FleetRoleCard = {
  roleId: string;
  roleType:
    | "planner"
    | "clarifier"
    | "researcher"
    | "generator"
    | "reviewer"
    | "auditor"
    | "executor"
    | "custom";
  title: string;
  status: "idle" | "running" | "waiting" | "blocked" | "failed" | "done";
  responsibility: string;
  boundAgents: string[];
  boundNodeIds: string[];
  boundExecutors: string[];
  currentFocus?: string;
};
```

### 3. StepSummary

```ts
type StepSummary = {
  stepId: string;
  title: string;
  phase: string;
  status:
    | "pending"
    | "running"
    | "waiting"
    | "blocked"
    | "retrying"
    | "rollback"
    | "failed"
    | "done";
  ownerRoleIds: string[];
  startedAt?: string;
  updatedAt?: string;
  progressText?: string;
};
```

### 4. ParallelLaneSummary

```ts
type ParallelLaneSummary = {
  laneId: string;
  title: string;
  status: "running" | "waiting" | "blocked" | "failed" | "done";
  roleIds: string[];
  nodeIds: string[];
  executorIds: string[];
  outputCount: number;
};
```

### 5. BlockerSummary

```ts
type BlockerSummary = {
  blockerId: string;
  type:
    | "clarification"
    | "approval"
    | "callback"
    | "executor"
    | "permission"
    | "governance"
    | "tool_failure"
    | "unknown";
  state: "waiting" | "blocked" | "failed";
  title: string;
  reason: string;
  ownerRoleId?: string;
  relatedStepId?: string;
  recoverability: "auto" | "manual" | "takeover_required" | "unknown";
};
```

### 6. IntermediateOutputSummary

```ts
type IntermediateOutputSummary = {
  outputId: string;
  title: string;
  outputType: "text" | "file" | "image" | "link" | "code" | "summary" | "other";
  status: "draft" | "proposed" | "accepted" | "superseded";
  source: "execution" | "outputs" | "destination" | "artifact" | "manual";
  stepId?: string;
  roleId?: string;
  artifactRef?: string;
  previewText?: string;
};
```

## 分层设计

建议将该主视图拆成 4 层：

1. 事实层
2. 投影层
3. 交互层
4. 证据层

### 1. 事实层

事实层来自现有主仓：

- mission 状态
- workflow 实例状态
- node run 状态
- agent 记录
- executor 状态
- logs / artifacts / runtime callbacks
- HITL 决策与等待态

这层不新增产品语义，只读取真实执行态。

### 2. 投影层

投影层将事实层转换为用户可读对象：

- node / agent -> fleet role
- workflow current node -> current step
- parallel node runs -> parallel lanes
- waiting / governance block / failed callback -> blockers
- artifact / intermediate result -> intermediate outputs

### 3. 交互层

交互层负责展示与跳转：

- 主线步骤区
- 角色编队区
- 并行执行区
- 中间产物区
- 阻塞与等待区
- 证据 dock 入口

### 4. 证据层

证据层负责承接：

- Logs
- Artifacts
- Runtime
- Recent action / failure
- Callback / socket 状态

它是主视图的可展开辅助层，而不是与主视图同权竞争的另一套主页面。

## 与现有对象的兼容映射

### 1. agent 到 fleet role 的映射

现有 agent 体系不应直接原样暴露给用户，而应通过角色包装：

| 底层对象 | 上层角色映射 |
| --- | --- |
| 规划类 agent / manager | Planner |
| 参数收集 / 用户输入 / 澄清节点 | Clarifier |
| 检索、知识、搜索节点 | Researcher |
| 生成、转换、编写类节点 | Generator |
| review / verify / judge 节点 | Reviewer |
| audit / lineage / compliance 相关单元 | Auditor |
| browser / native / sandbox executor | Executor |

映射原则：

- 一个角色可以绑定多个 node / agent / executor
- 一个底层单元在不同任务中可属于不同角色
- 若无法分类，可进入 `custom` 角色

### 2. node 到 current step 的映射

`current step` 不必等于某一个单独 node，但必须能由 node run 状态稳定投影。

建议规则：

- 正在执行的关键 node 对应当前步骤
- 若多 node 并行，则保留一个主步骤，同时把并行支路投影到 `parallel lanes`
- `WAITING_INPUT`、`blocked retry`、`escalated` 等状态需直接投影到步骤状态

### 3. executor 到 runtime health 的映射

执行器不应只出现在技术面板中，也应成为主视图中的执行健康信号。

建议展示：

- 当前使用的 executor 类型
- 运行中 executor 数量
- 最近失败 executor
- callback / socket / preview 可用性

### 4. artifact 与中间结果映射

artifact 既是证据，也可能是中间结果。
建议采用双重投影：

- 在中间产物区展示用户能理解的结果片段
- 在证据区保留完整 artifact 入口

## 关键设计收口（2026-04-25）

### 1. 角色编队映射规则

本轮把“角色编队映射”明确收口为“先锚定当前主仓已稳定的首版角色，再为后续 richer role 预留产品语义”，而不是要求仓库现在就已经完整产出全部 7 类角色。

| 上层角色 | 当前首版事实锚点 | 首版投影方式 | 当事实不足时的保守策略 |
| --- | --- | --- | --- |
| Planner | `fleet.roles[*].roleType = planner`、route planning、stage planning | 直接作为主线角色卡，承接路线生成与当前 focus | 若只看到 route / stage 而无显式角色，允许保底归为 Planner |
| Clarifier | `mission.status = waiting`、`takeover.type = clarification`、`waitingFor`、澄清型 decision prompt | 作为等待用户补充信息的角色卡 | 若仅有等待态但无明确澄清语义，可降级到 Operator |
| Operator | 人工接管、决策提交、恢复/升级动作 | 用于承接接管、恢复、路由切换、人工监督 | 不与 Clarifier 同时重复造卡，按“澄清优先、监督其次”合并 |
| Executor | `mission.executor`、executor job、runtime callback、executor event | 作为真实执行器承载角色卡 | 只要存在实际 executor 事实，不应被其它角色覆盖 |
| Researcher | search / rag / document-search / retrieval 类节点或 agent 标签 | 仅在上游已给出明确检索/研究语义时投影 | 当前主仓未稳定提供时，保留为目标语义，不强行虚构 |
| Generator | text / image / code generation 类节点或 agent 标签 | 仅在上游已给出明确生成语义时投影 | 当前主仓未稳定提供时，可由 Planner/Executor 摘要承接 |
| Reviewer | review / verify / judge / delivery review 语义 | 仅在上游角色或阶段标签明确时投影 | 当前主仓若仅有复核语气文案，不单独造卡 |
| Auditor | audit / lineage / governance / compliance 语义 | 仅在上游给出治理或审计角色事实时投影 | 当前主仓若只有 evidence / recovery / takeover 信号，则留在阻塞与证据区，不强造角色 |
| Custom | 无法稳定归类的角色事实 | 作为保守兜底，保留 title 与 responsibility | 不允许为了凑齐角色种类而把未知事实强映射成 Researcher/Generator/Reviewer/Auditor |

收口规则：

- 如果 shared summary 已经给出 `fleet.roles[*]`，client 直接消费，不再用前端猜测覆盖。
- 一个 `FleetRoleCard` 可以聚合多个 agent / node / executor，但必须能回链到真实绑定对象。
- `Researcher / Generator / Reviewer / Auditor` 在本轮是“产品设计上已定义”的角色，而不是宣称当前主仓已经稳定端到端产出。
- 当只有 `takeover / recovery / evidence` 信号而缺少独立角色事实时，优先把信息留在主线、阻塞或证据区，而不是制造看似完整但缺乏事实依据的角色卡。

### 2. 当前步骤投影规则

本轮把“当前步骤”定义为“业务主线当前正在处理的阶段步骤”，并把“步骤状态”定义为“这一步当前处于何种推进/等待/恢复状态”。两者允许分离展示。

步骤身份投影优先级：

1. `execution.currentStepKey / execution.currentStepLabel`
2. `route.currentStageKey / route.currentStageLabel`
3. `driveState.currentStageKey / driveState.currentStageLabel`
4. mission status 与最近 stage 事实推导出的兜底步骤

步骤状态投影优先级：

| 事实组合 | `StepSummary.status` | 说明 |
| --- | --- | --- |
| `mission.status = done` | `done` | 当前主线已交付完成 |
| `mission.status = failed` 且无恢复动作 | `failed` | 任务在当前步骤或当前阶段失败 |
| `takeover.required = true` 或 `mission.status = waiting` | `waiting` | 步骤本身未必失败，但等待人工澄清/审批/确认 |
| `driveState.blocked = true`、`operatorState = blocked`、存在 blocking takeover 或 blocker | `blocked` | 当前步骤被外部条件卡住 |
| `recovery.state = recovering` 且目标仍是同一步骤 | `retrying` | 仍在同一步骤内重试，不切换业务步骤名 |
| `driveState.state = replanning`、`route.selection.status = replanned` | `running` + 重规划覆盖态 | 步骤身份保留当前业务步骤，状态以“运行中”显示，并通过 badge/detail 表达重规划 |
| 明确回退到上一个稳定步骤 | `rollback` | 仅作为设计态定义；当前主仓尚未端到端落地 |
| 其余进行中态 | `running` | 当前步骤持续执行 |
| 尚未进入的未来步骤 | `pending` | 只在步骤条或 remaining steps 中出现 |

设计原则：

- “当前步骤”优先保留业务含义，不因底层恢复/重规划信号频繁变名。
- “步骤状态”负责表达等待、阻塞、失败、重试、回退等运行语义。
- 当前主仓已经稳定落地的是 `pending / running / waiting / blocked / done / failed` 相关摘要字段；`retrying / rollback` 在本轮只完成设计定义，不宣称实现已上线。

### 3. 并行执行投影规则

本轮把并行执行收口为“两层表达”：

- 第一层是当前主仓已稳定存在的摘要事实：`execution.parallelBranchCount` 与 `explanation.remainingSteps.parallelBranchCount`
- 第二层是后续 richer cockpit 可使用的结构化 `ParallelLaneSummary[]`

并行 lane 生成原则：

- 只有在以下事实之一成立时，才生成独立并行 lane：
  - 同时存在多个活跃角色
  - 同时存在多个 executor 工作单元
  - 同时存在多条待汇合的子任务/阶段
  - 中间产物明确分属于不同分支
- 若当前只有“并行数量”而没有足够上下文，前端只展示 count badge，不虚构 lane 详情。

lane 状态归并优先级：

1. 任一关键单元失败 -> `failed`
2. 任一关键单元被 blocker / takeover 卡住 -> `blocked`
3. 分支明确等待人工或外部回调 -> `waiting`
4. 至少有一个关键单元仍在工作 -> `running`
5. 所有关键单元完成且已汇合 -> `done`

lane 与主线的关系：

- 主视图始终保留唯一“当前主步骤”。
- 并行 lane 只作为主步骤下的横向展开，不抢占主线定位。
- 当并行分支收敛后，lane 不再长期驻留；其结果应回流到主线步骤、中间产物或证据区。

### 4. 中间产物模型收口

本轮把 `IntermediateOutputSummary` 的设计来源统一为四类：

1. `execution.intermediateDeliverables`
2. `outputs.items`
3. `destination.deliverables`
4. artifact / file / preview 事实

来源与默认语义：

| 来源 | 默认 `source` | 默认 `status` | 说明 |
| --- | --- | --- | --- |
| `execution.intermediateDeliverables[*]` | `execution` | `draft` | 代表当前步骤或当前运行阶段刚产出的摘要性结果 |
| `outputs.items[*]` | `outputs` | `proposed` | 代表当前面板已能展示的结构化输出项 |
| `destination.deliverables[*]` | `destination` | `proposed` | 代表目的地定义中的目标交付件；若任务已完成可提升为 `accepted` |
| artifact / file / preview | `artifact` | `accepted` 或 `proposed` | 代表已有文件或证据产物，可同时挂到 evidence |

补充规则：

- 去重优先级按 `artifactRef > title > previewText` 处理，避免同一产物在 outputs/evidence 重复堆叠。
- `outputType` 通过显式类型、文件扩展名、title/preview 语义推断；推不出时使用 `other`。
- 若缺少 `stepId / roleId`，允许回落到 `execution.currentStepKey` 与当前主角色，但必须在设计说明中标记为“推导关联”，而不是原生事实。
- 当前主仓仍主要提供摘要聚合，本轮只是把中间产物 contract 明确定义出来，不等同于已经有强类型输出对象落地。

### 5. 阻塞点与等待点模型

本轮把 blocker / waiting model 定义为三层来源归一：

1. `takeover`：显式人工门控
2. `recovery`：偏航、恢复、升级上下文
3. `execution.blockedReasons`：当前执行层面的简短阻塞原因

映射规则：

| 来源 | `BlockerSummary.type` | `state` | `recoverability` | 说明 |
| --- | --- | --- | --- | --- |
| `takeover.type = clarification` | `clarification` | `waiting` | `takeover_required` | 等待用户澄清 |
| `takeover.type = approval / delivery-review / route-selection / budget / permission / risk-acceptance` | 对应 type | `waiting` 或 `blocked` | `takeover_required` | 等待人工确认或授权 |
| `recovery.deviationCategory = dependency-failure` | `executor` 或 `tool_failure` | `blocked` | `auto` / `manual` | 视 `canAutoRecover` 决定恢复语义 |
| `recovery.deviationCategory = governance-deviation` | `governance` | `blocked` | `manual` | 治理或合规限制阻塞 |
| `execution.blockedReasons[*]` 且无法归类 | `unknown` | `blocked` | `unknown` | 作为兜底 blocker 摘要 |

owner / step 归位规则：

- `ownerRoleId` 优先取显式 fleet role，其次按 takeover/recovery 类型映射到 Planner / Clarifier / Operator / Executor / Auditor。
- `relatedStepId` 优先取 `execution.currentStepKey`，缺失时回退到 `route.currentStageKey`。
- 当前主仓如果只有摘要文案而无强类型 blocker 对象，前端应按“takeover 优先、recovery 其次、blockedReasons 最后”的顺序归并展示。

### 6. 用户交互行为

本轮把交互行为收口为“只读摘要优先、上下文跳转其次、原位接管最后”。

交互分层：

- 摘要态：默认展示 `Live Execution / Fleet / Blockers / Outputs / Evidence / Explanation / Takeover`
- 展开态：点击卡片后在原区域展开更多上下文，而不是立刻切页
- 跳转态：仅当存在明确目标页时，再跳转到 replay / evidence / task detail / decision panel

首版交互约束：

- 角色卡展开后展示 `currentFocus / boundAgents / boundExecutors`，但若这些字段缺失则保持只读摘要。
- 步骤卡展开后展示当前步骤、主线 remaining steps、并行数量与最近 blocker/output 摘要。
- 阻塞卡若对应 takeover，应优先把焦点导向决策面板或任务详情中的接管区，而不是新建独立弹窗协议。
- 中间产物卡若存在 `artifactRef` 或 preview，应跳转到 artifact / output 预览；若没有，则停留在摘要态。
- Evidence 卡若存在 correlation / timeline id，应跳转到对应 replay/debug/evidence 入口；若无，则只展示预览摘要。

边界说明：

- 以上交互行为是 cockpit 设计 contract，本轮不宣称当前 `TaskAutopilotPanel` 已完整实现这些点击、展开、跳转。
- 当前主仓已落地的是“只读摘要块 + 现有页面结构内的稳定摆位”，后续工程应沿这套 contract 增量兑现交互。

### 7. 联调样例

以下样例只定义“输入契约片段 -> 主视图预期”，用于后续 shared/server/client 联调，不等同于当前仓库已经存在独立样例资产。

#### 样例 A：单线执行

- 输入契约片段：
  - `fleet.roles = [planner, executor]`
  - `execution.currentStepLabel = "Run execution"`
  - `execution.parallelBranchCount = 0`
  - `execution.intermediateDeliverables = ["draft.md"]`
  - `takeover.required = false`
- 主视图预期：
  - 主线显示单一当前步骤
  - 不生成并行 lane，只显示“无并行分支”或不显示 count
  - 输出区显示 `draft.md`
  - Blockers/Takeover 区为空或降级为健康态

#### 样例 B：等待澄清

- 输入契约片段：
  - `mission.status = waiting`
  - `takeover.type = clarification`
  - `takeover.required = true`
  - `takeover.reason = "Need budget ceiling"`
  - `execution.currentStepLabel = "Clarify route constraints"`
- 主视图预期：
  - 当前步骤保持在澄清或规划语义步骤
  - `StepSummary.status = waiting`
  - Fleet 中优先出现 Clarifier 或 Operator
  - Blocker 卡显示澄清原因与接管入口

#### 样例 C：并行执行

- 输入契约片段：
  - `execution.parallelBranchCount = 2`
  - `fleet.roles` 同时存在 `planner / executor / reviewer`
  - `outputs.items` 包含两个不同产物
  - `explanation.remainingSteps.parallelBranchCount = 2`
- 主视图预期：
  - 主线仍只有一个当前步骤
  - 并行区显示两个 lane 或 count + 两个子摘要
  - 每个 lane 绑定对应角色与最近产物
  - 分支收敛后，这些产物应回流到主线输出区

#### 样例 D：executor 异常后重规划

- 输入契约片段：
  - `recovery.state = recovering`
  - `recovery.deviationCategory = dependency-failure`
  - `route.selection.status = replanned`
  - `route.replan.active = true`
  - `execution.currentStepLabel = "Retry external write"`
- 主视图预期：
  - 当前步骤名称保持业务语义，不改成抽象的“系统处理中”
  - 主视图显式展示重规划/恢复覆盖态
  - Blocker/Recovery 区展示“executor 异常 -> 自动恢复/重规划”的路径
  - Evidence 区可回链到相关 runtime event / route change / operator action

#### 样例 E：治理阻塞

- 输入契约片段：
  - `takeover.type = approval`
  - `recovery.deviationCategory = governance-deviation`
  - `execution.blockedReasons = ["External write is human-gated"]`
  - `evidence.gaps = ["Missing approval attachment"]`
- 主视图预期：
  - Blocker 模型优先以治理阻塞展示，而不是只显示一句泛化错误文案
  - related step 与 owner role 能回落到当前步骤和 Auditor/Operator/Planner 的责任语义
  - Evidence 区突出治理缺口，Takeover 区突出审批动作
  - 输出区仍保留已产出的中间结果，不因阻塞而全部隐藏

## 布局设计

建议主视图在驾驶舱中占据中间主区域，布局分为 5 块：

1. 顶部执行摘要
2. 主线步骤条
3. 角色编队区
4. 并行执行与中间产物区
5. 阻塞与证据区

### 1. 顶部执行摘要

包含：

- 当前目标摘要
- 当前阶段
- 当前步骤
- 当前总体状态

### 2. 主线步骤条

以阶段流或步骤流方式展示：

- 已完成
- 进行中
- 等待中
- 阻塞
- 失败

### 3. 角色编队区

展示当前活跃角色卡片，重点看：

- 谁在工作
- 谁在等待
- 谁被阻塞
- 谁已经完成

### 4. 并行执行与中间产物区

并行分支应在视觉上并列，但要受主线约束。
每个分支应展示：

- 分支标题
- 当前状态
- 绑定角色
- 最新产物

### 5. 阻塞与证据区

阻塞点应优先级更高，避免被埋没。
证据区则负责承接深层内容：

- logs
- artifacts
- runtime details

## 实时更新机制

主视图应消费现有稳定更新源：

- socket 事件
- callback 状态
- runtime poll
- mission / workflow 状态刷新

建议机制：

- 关键状态走增量刷新
- 大型证据列表延迟加载
- 中间结果采用“最近更新优先”

## 阻塞与恢复设计

阻塞是自动驾驶主视图的关键对象，建议统一归一为：

- 信息不足
- 审批未决
- 外部回调未完成
- 执行器失败
- 治理阻塞
- 工具调用失败

每个阻塞点需带：

- 标题
- 原因
- 所属步骤
- 所属角色
- 可恢复性
- 建议动作

## 与现有 runtime 证据体系的关系

该主视图不替代 replay / debug / audit，而是负责把证据“拉近到执行上下文”。

关系定义如下：

- 主视图：实时执行主屏
- runtime dock：实时证据主出口
- replay：任务完成后的回放与复盘
- debug：低频调试与系统级诊断

## 风险与边界

### 风险 1：角色层成为空壳包装

如果角色无法稳定映射到真实运行态，视图会失真。
因此必须以映射层而非硬编码角色文案实现。

### 风险 2：并行状态把主线冲散

如果所有分支都被平权展示，用户会失去“当前任务主线”感。
因此需要保留一个主步骤和一个主阶段。

### 风险 3：证据重复入口继续扩散

如果 logs / artifacts / runtime 同时在多个板块做同级主入口，视图会继续失控。
因此必须有统一证据出口。

### 风险 4：过早重写底层 schema

该 spec 的目标是视图投影，不是重写 mission / runtime 模型。
首轮应优先通过映射层完成。

## 审计说明（2026-04-24）

基于当前主仓 `autopilotSummary`、client store、`TaskAutopilotPanel` 与现有测试，现状已经稳定支撑以下最小事实：

- `autopilotSummary.execution` 已形成端到端字段契约：
  - `currentStepKey`
  - `currentStepLabel`
  - `currentStepStatus`
  - `parallelBranchCount`
  - `blockedReasons`
  - `intermediateDeliverables`
  - `availableActions`
- `autopilotSummary.fleet` 已形成端到端字段契约：
  - `roles`
  - `activeRoleCount`
  - `blockedRoleCount`
- panel 已能把 `execution`、`fleet`、`blockers`、`outputs` 投影成现有驾驶舱摘要块，相关客户端测试已覆盖：
  - shared/client 规范 shape
  - alias-style shape
  - client store 规范化后的 `execution` / `fleet` 字段
- panel 也已把 `evidence` 作为独立摘要块消费，并稳定展示：
  - `eventCount / artifactCount`
  - `lastSignal / latestEventType / updatedAt`
  - `trustLevel / gaps`
  - `timeline` 预览
  - `sources`

本轮保守审计后，以下条目仍不建议勾选：

- `定义 FleetExecutionView 投影模型`
  - 当前仓库落地的是 `MissionAutopilotSummary` 下的 `execution / fleet / recovery / evidence / bindings` 组合，而不是一个单独命名且被代码直接消费的 `FleetExecutionView` 对象。
  - 现有代码已具备主视图所需的大部分字段，但 spec 中独立对象与关联字段仍属于设计层总结，不宜按“已完成定义”处理。
- `定义角色编队映射规则`
  - 当前共享实现稳定产出 `planner`、`clarifier/operator`、`executor` 等角色，并有 `custom` 类型枚举。
  - 但仓库中尚未形成覆盖 `Researcher / Generator / Reviewer / Auditor` 的 agent / node / executor 归并规则，也没有对应端到端测试。
- `定义当前步骤投影规则`
  - 当前代码已经实现“从 mission 当前阶段 / 运行中阶段 / 失败阶段 / 已完成阶段推导当前步骤”，并把步骤状态稳定映射到 `pending / running / waiting / blocked / done / failed`。
  - 但 spec 明确要求覆盖“重试、回退”时的步骤状态表达；当前仓库并没有独立的 `retrying` / `rollback` 步骤状态端到端落地，因此仍不足以勾选。
- `定义并行执行投影规则`
  - 当前仅稳定产出 `parallelBranchCount`，panel 也仅展示数量或别名列表。
  - 尚未形成结构化的并行 lane 对象与分支收敛规则。
- `定义中间产物模型`
  - 当前 `outputs` 与 `execution.intermediateDeliverables` 主要是字符串级结果聚合，来源包括 `destination.deliverables`、`outputs.items`、artifact 名称、work package deliverable。
  - 尚未形成带 `outputType / status / stepId / roleId / artifactRef` 的统一中间产物对象模型。
- `定义阻塞点与等待点模型`
  - 当前 panel 能展示 `blockers.items`、`takeover` 原因与恢复提示，`execution.blockedReasons` 也已端到端可见。
  - 但仓库里还没有统一的 blocker 类型枚举、责任单元字段与 recoverability 模型。

因此，本轮审计可新增保守勾选一项；当前已勾选项为：

- 执行证据归位策略
- 与现有 runtime 的兼容层
- 驾驶舱主视图信息架构
- 测试计划
- 渐进迁移路径

补充审计结论（2026-04-24）：

- “设计实时更新机制”现已具备最小实现依据，可按保守口径补勾。
- 直接依据来自 `client/src/lib/tasks-store.ts` 中已经存在的协同链路：
  - `ensureMissionSocket()` 建立 mission socket
  - `MISSION_SOCKET_EVENT` 统一接收 mission snapshot / decision / executor event
- `applyExecutorEventToRuntimeChannels()` 把 callback 增量写回 detail runtime channel
- `patchMissionRecordInStore()` 对单 mission 做细粒度 patch
- `queueTasksRefresh()` 用延迟队列合并刷新请求
- `refresh()` / `hydrateTaskData()` 作为 mission 刷新的兜底路径
- 这说明 spec 中要求的“socket、poll、callback、mission 刷新之间的协同方式”以及“增量刷新与延迟加载策略”已经不只是设计设想，而是有直接代码承接。

- “执行证据归位策略”现也具备最小实现依据，可按保守口径补勾。
- 直接依据来自当前最小 live execution view 的证据归位方式：
  - shared builder 已把 logs / runtime events / operator actions / decision history 归并为 `evidence.timeline`
  - artifacts 与最近信号会归并到 `artifactCount / lastSignal / latestEventType / trustLevel / gaps`
  - `TaskAutopilotPanel` 已把 evidence 放在 live execution view 的独立摘要块中，而不是散落在 execution / blockers / outputs 内
  - design 中“主视图不替代 replay / debug / audit”的边界，与当前实现一致
- 因此，这一项当前应理解为“最小证据预览与边界策略已形成”，而不是“runtime dock / replay / debug 的统一入口和跳转已全部实现”。

本轮仍保持未勾选的部分：

- 并行 lane 的结构化对象
- blocker / intermediate output 的统一强类型模型
- 用户交互行为与联调样例
- runtime dock / replay / debug 边界的统一产品出口

补充审计说明（2026-04-24，Lane 3 收口）：

- 当前已经存在一条“实时执行主视图”的最小事实闭环，但它的真实落点是：
  - shared builder 输出 `execution / fleet / recovery / evidence`
  - server projection 直接透传这些字段
  - client store normalize 并回填到 summary/detail
  - `TaskAutopilotPanel` 以 `Live Execution / Fleet / Blockers / Outputs / Evidence` 的摘要块形式消费
- 因此，当前可以确认“执行主视图信息块”和“实时更新机制”有最小实现依据，但仍不能把它表述成：
  - 独立命名的 `FleetExecutionView` 类型已正式落地
  - 并行 lane、blocker、intermediate output 已形成完整强类型对象模型
  - 用户可展开操作的 execution cockpit 已实现
- 现有最值得复用的字段口径是：
  - `execution.currentStepKey / currentStepLabel / currentStepStatus`
  - `execution.parallelBranchCount / blockedReasons / intermediateDeliverables / availableActions`
  - `fleet.roles / activeRoleCount / blockedRoleCount`
  - `evidence.eventCount / artifactCount / latestEventType / trustLevel / timeline`
- 如果后续主线程继续推进本 spec，建议优先沿上述字段口径收敛，而不是重新发明一套平行 execution view schema。

## Audit Note（2026-04-24，Lane 3 复核）

本轮基于当前 autopilot summary 的 `fleet / execution / takeover / evidence` 字段、`TaskAutopilotPanel` 展示和相关测试，再做一次保守复核：

- 当前已经存在一个真实可用的“最小 live execution view”：
  - `Live Execution` 负责当前步骤、并行分支、阻塞原因、中间产物、可执行动作
  - `Fleet` 负责角色编队、在线角色、阻塞角色与绑定实体摘要
  - `Blockers / Takeover / Recovery` 负责等待态、阻塞态和恢复建议
  - `Evidence` 负责事件数、工件数、最近信号、可信度、缺口与时间线预览
- 因而当前可以保守认定：
  - 这个 spec 已经有一套“主视图内的最小 execution + evidence 归位方式”
  - 但它仍然是任务详情页里的 summary blocks，不是独立 execution cockpit
  - takeover 也只是作为 live execution view 的阻塞/等待上下文进入展示，并没有形成完整交互模型

当前仍然不能外推为已落地的部分包括：

- 独立 `FleetExecutionView` 类型与完整强类型对象族
- 覆盖 `Researcher / Generator / Reviewer / Auditor` 的稳定角色映射规则
- 结构化并行 lane、blocker、intermediate output 模型
- 角色卡/步骤卡/证据入口的展开跳转交互
- runtime dock / replay / debug 的统一入口与产品级导航闭环

所以本轮 audit 结论应收口为：

- 可以把“执行证据归位策略”按最小实现勾选；
- 但其它未勾条目仍应保持不动，避免把当前最小 live execution view 误记为完整主视图产品。

## 开放问题

- 角色卡是否需要允许用户展开看到绑定的 node / executor 明细
- 并行分支是否需要支持折叠和优先级排序
- 中间产物是否需要支持“被哪个步骤采用”的血缘关系
- 主视图是否应直接承接部分 takeover 操作，还是只展示状态后跳转

## 审计说明（2026-04-25，Lane 3 二次复核）

- 本轮沿 `shared builder -> server projection -> client store -> TaskAutopilotPanel -> tests` 的完整链路做了保守复核，结论是：当前实现已经形成“最小 live execution / fleet summary 闭环”，但没有新增足够证据把其它未勾项转为已勾。
- 当前真实落地的对象边界是 `MissionAutopilotSummary` 及其子块：
  - `execution` 负责当前步骤、并行分支数量、阻塞原因、中间产物摘要、可执行动作
  - `fleet` 负责角色摘要、活跃角色数、阻塞角色数
  - `takeover / recovery` 负责等待接管、阻塞和恢复建议上下文
  - `evidence` 负责事件数、工件数、最近信号、可信度、缺口、时间线与 correlation 索引
  - `explanation / bindings` 负责解释文案与 mission / workflow / replay / session 关联
- 直接代码证据来自：
  - `shared/mission/autopilot.ts`：构建 autopilot summary 的字段契约与推导逻辑
  - `server/tasks/mission-projection.ts`：把 shared summary 对齐 resolved projection links 并下发给 projection API
  - `client/src/lib/tasks-store.ts`：消费 server/shared shape，做 fallback + normalize，并同步到 summary/detail
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`：把这些字段投影为任务详情页中的摘要信息块
- 直接测试证据来自：
  - `shared/__tests__/mission-autopilot.test.ts`：active / waiting / blocked / queued 等投影场景，以及 evidence / explanation / bindings 契约
  - `server/tests/mission-routes.test.ts`：projection route 返回的 autopilot summary、takeover、replan、evidence correlation、resolved links 对齐
  - `client/src/lib/tasks-store.autopilot.test.ts`：client fallback projection、alias 输入格式规范化、summary/detail 对齐
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`：`Live Execution / Fleet / Blockers / Outputs / Evidence / Explanation / Takeover` 摘要块展示、route selection 文案、evidence correlation 明细
- 因此应把当前实现理解为：
  - 任务详情页内已经存在一组可复用的 execution / fleet summary blocks
  - shared / server / client / panel 之间已经形成稳定字段契约
  - 但它仍不是一个独立命名的 `FleetExecutionView` 产品对象，也不是具备展开、跳转、接管操作的完整 execution cockpit
- 本轮仍不能外推为“已落地”的部分包括：
  - 覆盖 `Researcher / Generator / Reviewer / Auditor` 的稳定角色映射规则
  - 结构化 `parallel lanes`、`blocker`、`intermediate output` 强类型对象族
  - `retrying / rollback` 等步骤状态的端到端投影
  - 角色卡 / 步骤卡 / 证据入口的展开跳转交互
  - runtime dock / replay / debug 的统一产品级入口
- 额外收口说明：
  - `client/src/lib/tasks-store.ts` 中虽然已经有 `ensureMissionSocket()`、`patchMissionRecordInStore()`、`queueTasksRefresh()`、`applyExecutorEventToRuntimeChannels()` 等实时更新实现，但当前列出的测试文件没有专门覆盖 socket patch 与延迟刷新协同，因此本轮不把它扩展解读为更多设计条目已完成
  - 如果后续要继续新增勾选，建议优先补齐针对 `retrying / rollback`、完整角色映射、并行 lane 结构、typed blocker / output 模型、交互跳转行为的专项测试，再回写 spec

## 审计说明（2026-04-25，Lane 4 收口）

本轮继续沿 `execution / fleet / takeover / recovery / evidence / explanation` 这条 shared -> server -> client -> panel 链路做保守复核，结论是：可以把“定义 `FleetExecutionView` 投影模型”按首版组合 contract 口径补勾，其余未勾项继续保持不变。

- 这次补勾的前提不是把 `FleetExecutionView` 误记为“独立 runtime schema 已落地”，而是明确它在当前仓库中的首版实现边界：
  - shared 层已有稳定的 `MissionAutopilotSummary` 契约，直接覆盖 destination、drive state、route、execution、fleet、takeover、recovery、evidence、explanation、bindings
  - server projection 直接透传并补齐 resolved links
  - client store 会把这些子块做 normalize 后回填到 summary / detail
  - `TaskAutopilotPanel` 会把这组字段投影成任务详情页里的实时执行主视图摘要块
- 直接代码锚点来自：
  - `shared/mission/autopilot.ts` 中对 `MissionAutopilotExecutionView`、`MissionAutopilotFleetSummary`、`MissionAutopilotTakeoverSummary`、`MissionAutopilotRecoverySummary`、`MissionAutopilotEvidenceSummary`、`MissionAutopilotExplanationSummary`、`MissionAutopilotBindingsSummary` 与总的 `MissionAutopilotSummary` 的声明与构建
  - `server/tasks/mission-projection.ts` 对 autopilot summary 的对齐与下发
  - `client/src/lib/tasks-store.ts` 的 normalize / fallback / summary-detail 双写回填
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 对上述子块的稳定消费
- 直接测试锚点来自：
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tests/mission-routes.test.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
- 因此，`FleetExecutionView` 在本 spec 中应被收口为：
  - 一个面向产品视角的组合投影模型
  - 其首版实现形态是 `MissionAutopilotSummary` 及其子块，而不是另起一套顶层对象
  - 其当前交付形态是任务详情里的 summary blocks，而不是完整独立 execution cockpit

本轮仍不能继续补勾的设计项包括：

- `定义角色编队映射规则`
  - 仍缺 `Researcher / Generator / Reviewer / Auditor` 的稳定端到端映射与测试。
- `定义当前步骤投影规则`
  - 当前虽已覆盖 `pending / running / waiting / blocked / done / failed`，但仍缺 `retrying / rollback` 的端到端状态落地。
- `定义并行执行投影规则`
  - 当前只有 `parallelBranchCount` 摘要，没有结构化 `parallel lane` 对象与收敛规则。
- `定义中间产物模型`
  - 当前仍以摘要聚合为主，没有统一强类型中间产物对象。
- `定义阻塞点与等待点模型`
  - 当前仍由 `takeover + recovery + blockedReasons` 组合表达，没有统一 blocker 模型。
- `设计用户交互行为` 与 `输出联调样例`
  - 当前仍是只读摘要展示，不是可展开跳转的 execution cockpit，也没有独立联调样例资产。

## 审计说明（2026-04-25，Lane 5 设计收口）

- 本轮补齐的是设计口径，不是实现口径。新增收口内容包括：
  - 角色编队映射矩阵与保守回退规则
  - 当前步骤身份/状态双层投影规则
  - 并行执行的 count-only 首版策略与结构化 lane 目标 contract
  - 中间产物来源归一与默认 status/source 口径
  - blocker / waiting 的统一映射与 owner/step/recoverability 规则
  - 只读摘要优先的交互行为 contract
  - 5 类联调样例
- 因此，`定义角色编队映射规则 / 定义当前步骤投影规则 / 定义并行执行投影规则 / 定义中间产物模型 / 定义阻塞点与等待点模型 / 设计用户交互行为 / 输出联调样例` 这些条目可以按“设计已定义”收口勾选。
- 同时再次强调：
  - 这不等于当前 shared / server / client 已完整落地结构化 `parallel lanes`、typed `blocker / output`、全部角色类型映射或可点击展开跳转的 cockpit 行为。
  - 当前真实工程落点仍是 `MissionAutopilotSummary` + `TaskAutopilotPanel` 的摘要块体系。
  - 后续若要宣称“实现闭环完成”，仍需补齐对应代码、投影、交互与直接测试证据。
