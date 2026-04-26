# 设计文档：车队组织与角色封装

## 设计概述

本设计负责在“任务自动驾驶”叙事下，为 `Fleet` 增加一层稳定的角色封装模型。

它解决的核心问题不是“如何实现一个新的角色切换引擎”，而是“如何把已经存在的执行能力组织成用户看得懂、产品讲得通、运行时又能对得上的车队角色”。

因此本设计采用四层分离思路：

1. 产品角色层
2. 能力包层
3. 执行单元层
4. 运行事实层

其中最重要的原则是：

- 用户看到的是角色，不是节点目录
- 工程仍运行在 mission-first / workflow / runtime 之上
- 角色封装是投影层与组织层，不是对底层对象的强制改名
- 同一底层对象可随路线与阶段切换其角色归属

## 设计目标

本设计要实现以下结果：

- 让 `Fleet` 成为 `Route` 到 `Execution` 之间的稳定中间层
- 让驾驶舱可以用“角色编队”而不是“节点列表”表达执行组织
- 让 `agents / nodes / executors / skills / tools` 可以被统一包装
- 让 `Takeover`、`Risk`、`Confidence`、`Drive State` 与角色层建立清晰联系
- 让前端、回放、审计、治理系统共享同一套角色对象口径

## 核心原则

### 1. 角色优先展示，事实优先承载

用户界面优先展示车队角色，但角色背后必须有可追溯的工程事实支撑。

这意味着：

- 对外展示 `Planner / Researcher / Operator / Reviewer`
- 对内仍然由 `agent / node / executor / skill / tool` 等对象承载
- 任一角色摘要都必须可以追溯到真实运行单元

### 2. 角色不是底层对象的一对一别名

一个角色通常不是单一 agent，也不是单一 node。

更合理的表达是：

- 角色是“职责集合”
- 能力包是“完成职责所需的能力集合”
- 执行单元是“当前真正干活的实体”

因此：

- 一个 `Researcher` 可以由多个搜索节点、检索 agent、网页 executor 共同承载
- 一个 `Operator` 可以绑定 browser executor、native executor 和若干 action nodes
- 一个 `Reviewer` 可以由 review 节点、校验技能和人工确认入口共同组成

### 3. Route 决定编组，Drive State 决定表现

`Route` 决定当前任务需要哪些角色、按什么顺序或并行关系出现。
`Drive State` 决定这些角色当前是“正在编队、执行中、等待中、阻塞中、重规划中”。

因此车队组织不是一次性静态结构，而是执行中的动态投影。

### 4. 兼容优先，不做底层大改名

当前主仓已经积累了大量 `mission / workflow / runtime / node / executor` 命名与实现。

本设计不建议当前立即执行以下动作：

- 把全部 `agent` 统一改名为 `role`
- 把全部 `node` 统一改名为 `fleet action`
- 把全部 `executor` 统一改名为 `vehicle`
- 把全部 API 和测试同步重命名

正确做法是先增加角色封装层与投影层，再决定是否需要更深层重构。

## 分层模型

### 1. 产品角色层

该层是用户可理解的角色语义层，负责回答：

- 当前车队有哪些成员类型
- 每个角色正在负责什么
- 哪些角色在等待、阻塞、执行或复核

建议角色枚举如下：

- `planner`
- `clarifier`
- `researcher`
- `operator`
- `generator`
- `reviewer`
- `auditor`
- `coordinator`
- `generalist`
- `composite`
- `custom`

### 2. 能力包层

该层位于角色与执行单元之间，用于表达“这个角色靠哪些能力完成职责”。

建议能力包对象承载以下内容：

- skill bindings
- tool bindings
- MCP attachments
- policy bindings
- executor preferences
- node family tags

能力包的意义在于：

- 把 skill、tool、executor 从“用户视角角色”中抽离出来
- 又不至于让角色层失去工程承载能力
- 允许一个角色在不同任务中装配不同能力包

### 3. 执行单元层

该层是实际执行工作或推进流程的单元，至少包括：

- agents
- nodes
- executors
- workflow tasks
- runtime workers

这层负责：

- 真正运行
- 产生日志与产物
- 进入等待、失败、恢复、重试
- 为角色层提供事实来源

### 4. 运行事实层

该层是系统已存在的事实底座，包括：

- mission
- workflow definition
- workflow instance
- runtime node state
- agent records
- executor state
- logs / artifacts / replay / audit / HITL

该层不直接面向用户叙事，但负责提供全部真实信号。

## 核心对象设计

### 1. FleetComposition

`FleetComposition` 用于表达某一条路线、某一阶段或某一时刻的车队编组快照。

```ts
type FleetComposition = {
  fleetId: string;
  missionId?: string;
  routeId?: string;
  routeStageId?: string;
  driveState?: string;
  roles: FleetRolePackage[];
  formationMode: "planned" | "active" | "fallback" | "replanned";
  sourceRefs: FleetSourceRefs;
  updatedAt: string;
};
```

### 2. FleetRolePackage

`FleetRolePackage` 是本设计最核心的对象，用于描述一个用户可理解的车队角色如何由底层能力承载。

```ts
type FleetRolePackage = {
  rolePackageId: string;
  roleType:
    | "planner"
    | "clarifier"
    | "researcher"
    | "operator"
    | "generator"
    | "reviewer"
    | "auditor"
    | "coordinator"
    | "generalist"
    | "composite"
    | "custom";
  title: string;
  responsibility: string;
  status: "pending" | "forming" | "running" | "waiting" | "blocked" | "reviewing" | "done";
  routeStageIds: string[];
  inputContract: RoleInputContract[];
  outputContract: RoleOutputContract[];
  capabilityPackages: CapabilityPackageRef[];
  executionUnits: ExecutionUnitRef[];
  attachmentRefs: AttachmentRef[];
  riskProfile: RoleRiskProfile;
  takeoverProfile?: RoleTakeoverProfile;
  displaySummary?: string;
};
```

### 3. CapabilityPackage

`CapabilityPackage` 用于把角色职责与技能、工具、策略、执行器偏好等工程能力绑定起来。

```ts
type CapabilityPackageRef = {
  packageId: string;
  packageType:
    | "planning"
    | "clarification"
    | "research"
    | "generation"
    | "operation"
    | "review"
    | "governance"
    | "coordination"
    | "custom";
  skillIds: string[];
  toolIds: string[];
  mcpIds?: string[];
  executorTypes?: string[];
  policyIds?: string[];
};
```

### 4. ExecutionUnitRef

`ExecutionUnitRef` 用于描述角色当前实际依赖的执行单元。

```ts
type ExecutionUnitRef =
  | {
      unitKind: "agent";
      unitId: string;
      label?: string;
    }
  | {
      unitKind: "node";
      unitId: string;
      label?: string;
    }
  | {
      unitKind: "executor";
      unitId: string;
      label?: string;
    }
  | {
      unitKind: "task";
      unitId: string;
      label?: string;
    };
```

### 5. AttachmentRef

`AttachmentRef` 用于表达附着在角色上的非主执行能力。

```ts
type AttachmentRef = {
  attachmentKind: "skill" | "tool" | "mcp" | "policy" | "memory" | "evidence";
  attachmentId: string;
  label?: string;
};
```

### 6. 当前主仓已落地的最小摘要对象

当前主仓还没有完整落地上面的 `FleetComposition / FleetRolePackage / CapabilityPackage / ExecutionUnitRef / AttachmentRef` 结构族。
真正稳定流通的，是 `shared/mission/autopilot.ts` 生成、`server/tasks/mission-projection.ts` 透传、`client/src/lib/tasks-store.ts` 归一化、`client/src/components/tasks/TaskAutopilotPanel.tsx` 消费的最小摘要对象：

```ts
type CurrentMissionFleetSummary = {
  roles: Array<{
    id: string;
    roleType:
      | "planner"
      | "clarifier"
      | "researcher"
      | "generator"
      | "reviewer"
      | "auditor"
      | "operator"
      | "executor"
      | "custom";
    title: string;
    status: "idle" | "running" | "waiting" | "blocked" | "failed" | "done";
    responsibility: string;
    boundAgents: string[];
    boundExecutors: string[];
    currentFocus: string | null;
  }>;
  activeRoleCount: number;
  blockedRoleCount: number;
};
```

这条最小摘要对象为本 spec 提供了两个重要约束：

- 上层设计可以继续定义完整的 `FleetRolePackage` 目标结构，但必须承认当前主仓已实现的是“role summary”而不是“role package”
- 所有设计收口都需要兼容这条最小摘要链，不把 `tasks-store` 的 normalize 或 `TaskAutopilotPanel` 的消费层误写成新的角色生产器

## 角色定义设计

### 1. Planner

职责：

- 理解 `Destination`
- 生成或调整 `Route`
- 拆分阶段
- 决定编组需求

常见底层来源：

- planner agent
- planning node
- route recommendation logic
- strategy synthesis skills

典型输入：

- destination
- constraints
- success criteria

典型输出：

- route draft
- stage plan
- fleet requirements

### 2. Clarifier

职责：

- 发现缺失信息
- 组织澄清问题
- 触发用户补充或确认

常见底层来源：

- input collection nodes
- confirm / decision / clarification nodes
- HITL wait state

典型接管关系：

- 与 `Takeover Point` 强关联
- 与低置信度目标理解强关联

### 3. Researcher

职责：

- 检索外部信息
- 读取知识、文档、网页与上下文
- 比对多个来源

常见底层来源：

- search nodes
- QA nodes
- RAG pipeline
- browser search executor

### 4. Operator

职责：

- 实际执行外部操作
- 驱动浏览器、沙箱、本地执行器或平台动作
- 完成需要“去做”的步骤

常见底层来源：

- browser executor
- native executor
- sandbox executor
- action nodes

典型风险：

- 权限风险
- 成本风险
- 外部失败风险

### 5. Generator

职责：

- 生成正文、摘要、代码、文件、表格、图像或结构化结果

常见底层来源：

- llm nodes
- file generation nodes
- chart / document / media nodes

### 6. Reviewer

职责：

- 审阅结果
- 对照成功标准检查输出
- 提出修正或退回

常见底层来源：

- review nodes
- verify nodes
- judge / compare logic

### 7. Auditor

职责：

- 关联风险、证据、审计、合规、回放
- 确认是否满足治理要求

常见底层来源：

- audit events
- lineage
- evidence collection
- policy checks

### 8. Coordinator

职责：

- 组织多角色协作
- 汇总分支进度
- 管理交接和收敛

常见底层来源：

- orchestration logic
- workflow stage coordination
- mission runtime aggregation

### 9. Generalist / Custom

用于处理无法稳定细分的场景：

- 小任务中由单一 agent 承担多重职责
- 历史节点体系暂未完成角色化分类
- 归类置信度低或存在冲突

这类角色必须：

- 明确标记为混合角色
- 保留底层来源
- 允许后续重新分类

### 10. 角色矩阵（收口版）

为避免“角色集合已列出，但职责边界不对称”，首轮统一按下表收口角色定义。这里的矩阵是产品设计口径，不等同于当前 shared builder 已全部稳定产出。

| 角色 | 职责边界 | 典型输入 | 典型输出 | 典型风险 | 典型接管点 |
| --- | --- | --- | --- | --- | --- |
| `Planner` | 把 `Destination` 收口为 `Route`、阶段和编组需求，不直接负责外部副作用 | 目标、约束、成功标准、已有 route history | 路线草案、阶段计划、编组需求、重规划建议 | 过度规划、路线漂移、把不确定性过早定死 | 需要用户确认路线偏好、成本/时长权衡、重规划方向 |
| `Clarifier` | 负责发现缺口、发起澄清、承接 HITL 决策，不直接交付最终结果 | 缺失信息、冲突约束、待确认问题、决策提示 | 澄清问题、补齐后的约束、确认记录、接管上下文 | 频繁打断、澄清噪音、长期等待造成阻塞 | 缺信息、审批、路线选择、预算或权限确认 |
| `Researcher` | 负责搜索、检索、比对、取证，不直接执行外部写操作 | 检索主题、搜索范围、知识库、证据要求 | 事实集合、候选资料、引用、证据包 | 来源不可信、信息过期、证据不足 | 外部检索授权、来源可信度争议、证据不足复核 |
| `Operator` | 负责执行外部操作、驱动 executor / tool / 页面动作，不负责高层策略判断 | 操作目标、权限上下文、执行步骤、工具目标 | 外部副作用、操作结果、执行产物、运行日志 | 权限风险、预算风险、工具限制、外部失败 | 权限批准、预算确认、异常接管、人工恢复 |
| `Generator` | 负责把上下文转成文档、代码、文件、素材或结构化产出 | brief、上下文包、模板、格式约束、输入素材 | 文档、代码、结构化结果、素材文件 | 幻觉、格式漂移、产物不满足验收口径 | 风格确认、结果接受、人工补写或重生成 |
| `Reviewer` | 负责核查、校验、对照成功标准验收结果，不负责原始执行 | 成功标准、候选产物、差异、验收规则 | 通过/退回结论、修订意见、风险提醒 | 漏检、误判、过晚退回造成返工 | 结果验收、差异确认、是否继续交付 |
| `Auditor` | 负责治理、风险、证据、lineage、audit/replay 关联，不直接改写业务产物 | 治理规则、证据链、审计事件、lineage、策略约束 | 风险标签、治理结论、证据索引、审计链接 | 证据链缺口、策略冲突、治理解释不一致 | 风险接受、策略豁免、审计补录、证据复核 |
| `Coordinator` | 负责多角色交接、并行分支收敛、阶段同步，不取代具体执行角色 | route stage、分支状态、handoff、汇总上下文 | 编组状态、分支收敛结果、交接摘要 | 分支失配、交接丢失、重复派发 | 人工编组调整、分支合并确认、重规划切换 |
| `Generalist` | 单一实体在小任务里承担多重职责，但仍保持统一摘要视图 | 小任务目标、少量上下文、单线执行意图 | 混合结果、单角色摘要、保守说明 | 角色语义过粗、难以拆分追责 | 需要人工决定是否拆分成更细角色 |
| `Composite / Custom` | 已知多角色同时出现但无法安全拆开时，用于保守封装或兼容未知类型 | 混合来源、未知 incoming roleType、冲突归类结果 | 复合角色摘要、保留的底层来源、临时命名 | 命名不稳、不同模块解释冲突 | 人工重命名、人工重分类、后续归档修订 |

### 11. 保守回退策略（收口版）

当角色归类不稳定时，不应强行把底层对象抬成“看起来更高级”的角色名。首轮统一采用三档保守回退：

- `generalist`：同一执行实体在小任务里自然承担多重职责，但没有明显角色冲突
- `composite`：已知至少两类角色都在工作，但当前时刻无法安全拆分为多个稳定 role package
- `custom`：外部输入或历史投影提供了未知 `roleType`，只能保留原题头与底层引用

保守回退的统一规则：

- 优先保证解释一致，而不是优先保证名字好看
- 必须保留 `title / roleType / boundAgents / boundExecutors / currentFocus` 一类可展示字段
- 必须保留可回溯到底层执行对象的 source refs
- 允许后续在 replay / audit / spec 归档阶段再做精细重分类

与当前主仓的最小对齐：

- `tasks-store` 已经支持把未知 incoming `roleType` 归一为 `custom`
- 当完整 autopilot projection 缺失时，`tasks-store` 会退化成单个 `Mission Core` `operator` 角色，服务于“有一个最小摘要可展示”的降级目标
- 这两条现状只代表“兼容与降级已稳定”，不代表完整 `generalist / composite / custom` taxonomy 已全部实现

## 映射设计

### 1. agents -> role carriers

`agent` 最适合作为角色承载者之一，但不应被直接等同为角色本身。

映射原则：

- 一个 agent 可承载一个或多个角色包
- 同一 agent 在不同阶段可切换承载的角色类型
- 动态角色系统属于这一层的底层实现候选，而不是产品语义本身

### 2. nodes -> role actions

`node` 更适合表示“角色在做的动作”，而不是角色本身。

例如：

- search node 更像 `Researcher` 的动作
- confirm_judge node 更像 `Clarifier` 或 `Reviewer` 的动作
- file_generation node 更像 `Generator` 的动作
- open_page / open_dashboard 更像 `Operator` 的动作

因此节点应优先映射为：

- role action
- stage action
- execution evidence

而非用户主视图中的一级对象。

### 3. executors -> role actuators

`executor` 负责“让角色真的能做事”，但不宜直接作为用户主视图的一等角色。

建议表达为：

- `Operator` 绑定 browser/native/sandbox executor
- `Researcher` 可能借助 browser executor 获取信息
- `Generator` 可能借助 sandbox executor 生成文件

也就是说，executor 更像角色的执行装置，而不是角色本身。

收口口径应进一步明确为：

- `executor` 在产品层默认不直接回答“谁在推进任务”，而是回答“该角色靠什么执行”
- 当 `executor` 作为独立一等角色出现在当前 shared summary 中时，应被视为现状兼容态，而不是目标语义
- 目标方向是把 `executor` 下沉到 `FleetRolePackage.executionUnits` 与 `CapabilityPackage.executorTypes` 两层：
  - `executionUnits`
    - 表达当前时刻真实绑定了哪些 browser / native / sandbox / mock 执行单元
  - `executorTypes`
    - 表达某个角色能力包偏好或允许使用哪些执行装置类型

因此 `executor -> role actuator` 的统一映射规则建议为：

| 底层 executor 事实 | 优先映射到的产品语义 | 说明 |
| --- | --- | --- |
| browser executor 正在抓取网页、打开页面、执行点击/表单动作 | `Operator` 的 actuator；必要时也可作为 `Researcher` 的 actuator | 是否归入 `Operator` 或 `Researcher` 取决于当前职责是“执行外部动作”还是“获取信息证据” |
| native executor 正在调用本地系统、脚本或平台命令 | `Operator` 的 actuator | 优先理解为执行装置，而不是单独角色 |
| sandbox executor 正在生成文件、运行代码、转换素材 | `Generator` 或 `Operator` 的 actuator | 生成导向优先归 `Generator`，流程性动作优先归 `Operator` |
| mock / synthetic executor 仅用于回放、测试或降级兼容 | 对应角色的 fallback actuator | 默认不升级为单独用户可见角色 |

这一节必须同时保留当前主仓边界：

- 当前 shared builder 依旧把 `executor` 暴露成一级 fleet role，因此这条设计的完成含义只能是“目标映射口径已写清”
- 不能把本节外推为 shared/server/client 已经完成 `executor` 下沉改造

### 4. skills / tools / MCP -> role attachments

这些对象最适合被放入“能力包”或“附着能力”层。

建议映射为：

- skill -> role capability
- tool -> role attachment
- MCP -> role extension

产品上不应直接对用户说：

- “当前是 `web_search` skill 在工作”
- “当前是 `mcp-foo` 在推进任务”

而应说：

- “研究员正在搜索并比对资料”
- “执行员正在调用外部系统完成操作”

### 6. 节点家族到角色家族的初步分类表

首轮不做逐节点逐个命名，而是先沉淀 node family -> role family 的粗粒度分类表：

| 节点家族 | 典型对象 | 优先归属角色 | 备注 |
| --- | --- | --- | --- |
| 目标解析 / 规划节点 | route plan、strategy synthesis、task breakdown | `Planner` | 与 route recommendation、replan strongly aligned |
| 用户输入 / 决策 / 确认节点 | user_input、confirm、decision、clarification | `Clarifier` | 与 HITL / takeover 直接相关 |
| 搜索 / 检索 / 文档问答节点 | search、document_search、RAG、QA | `Researcher` | 优先表达为证据获取，不直接暴露具体 tool 名 |
| 生成 / 格式化 / 文件输出节点 | text generation、chart/doc/file output | `Generator` | 包括文档、代码、结构化文件 |
| 外部动作 / 页面控制节点 | open page、dashboard action、browser/native command | `Operator` | 与 executor / tool / permission 强关联 |
| 审核 / 判断 / 比对节点 | review、judge、compare、verification | `Reviewer` | 输出通过/退回/修正意见 |
| 审计 / 治理 / 证据节点 | audit、lineage、policy、evidence | `Auditor` | 与 replay / governance 关联 |
| 编排 / 分支同步节点 | orchestration、stage sync、mission aggregation | `Coordinator` | 更多属于 runtime / orchestration 摘要层 |

### 7. 角色能力包目录（收口版）

首轮先沉淀角色能力包目录，而不是直接把 skill / tool / executor 平铺给用户：

| 能力包 | packageType | 典型组成 | 主要服务角色 |
| --- | --- | --- | --- |
| `plan-pack` | `planning` | planning skill、strategy tool、route evaluator | `Planner` |
| `clarify-pack` | `clarification` | decision prompt、confirm node、HITL wait hook | `Clarifier` |
| `research-pack` | `research` | search skill、browser search executor、knowledge source refs | `Researcher` |
| `generate-pack` | `generation` | llm generation、file output、formatting template | `Generator` |
| `operate-pack` | `operation` | browser/native/sandbox executor、tool binding、permission policy | `Operator` |
| `review-pack` | `review` | compare/judge logic、quality rubric、acceptance rules | `Reviewer` |
| `govern-pack` | `governance` | audit hooks、lineage refs、policy checks、evidence links | `Auditor` |
| `coord-pack` | `coordination` | orchestration metadata、branch sync state、handoff refs | `Coordinator` |
| `fallback-pack` | `custom` | mixed refs、legacy bindings、unknown role carrier | `Generalist / Composite / Custom` |

### 5. workflow / runtime -> role projection source

`workflow` 和 `runtime` 是角色投影的事实来源，不是角色对象本身。

它们负责告诉系统：

- 当前哪个阶段在运行
- 哪些 node 激活中
- 哪些 executor 正在执行
- 哪些 agent 正在占用
- 哪些阻塞、失败、等待正在发生

角色层则把这些事实重新组织成“谁在干什么”的表达。

## 多视图复用口径

角色摘要对象要想真正成为统一上层口径，不能只服务 `TaskAutopilotPanel`，而要能够被驾驶舱、车队状态视图、接管面板和回放视图按同一原则复用。

### 1. 统一复用对象

首轮统一约定由同一份“角色摘要对象”对外复用，而不是每个视图各自重造字段：

- 主对象
  - `CurrentMissionFleetSummary.roles[*]`
- 最小复用字段
  - `id`
  - `roleType`
  - `title`
  - `status`
  - `responsibility`
  - `currentFocus`
  - `boundAgents`
  - `boundExecutors`
- 派生计数
  - `activeRoleCount`
  - `blockedRoleCount`

### 2. 各视图的复用边界

| 视图 | 主消费字段 | 可补充字段 | 不应自行发明的内容 |
| --- | --- | --- | --- |
| 驾驶舱 | `title / status / currentFocus / activeRoleCount / blockedRoleCount` | route stage、drive state 标签 | 不能自行给底层 node 重新命名为新角色 |
| 车队状态视图 | `title / responsibility / status / boundAgents / boundExecutors` | 展开后的执行单元明细 | 不能绕过 projection 直接平铺全部 tools/executors |
| 接管面板 | `title / status / responsibility` | `RoleTakeoverProfile`、waiting reason、risk tags | 不能脱离角色语义单独把接管点说成“某个 executor 在等待” |
| 回放视图 | `title / status` 的时间切片 | evidence refs、timeline step、role status transitions | 不能重新定义与主视图冲突的 roleType |

### 3. 统一补充原则

- 允许各视图在角色摘要对象之上叠加本视图专属上下文
  - 例如驾驶舱叠加 stage 标签
  - 接管面板叠加 `RoleTakeoverProfile`
  - 回放视图叠加 timeline/evidence 入口
- 不允许各视图自行更改角色主语义
  - 例如同一份 `operator` 不能在另一个视图里被随意改称为 `executor`
- 不允许各视图绕过共享 summary 直接凭底层对象推导新角色

因此，多视图复用的收口口径应是：

- 共享同一份角色摘要主对象
- 允许按视图附加上下文
- 不允许按视图发明不同角色解释

## Route 与 Fleet 的关系

### 1. Route 生成角色需求

在 `Route` 生成后，系统应推导出该路线需要的角色组合。

例如：

- 研究型路线通常至少需要 `Planner + Researcher + Reviewer`
- 外部操作型路线通常至少需要 `Planner + Operator + Reviewer`
- 高风险任务可能额外需要 `Auditor`

### 2. 路线阶段驱动角色启停

角色不是整个任务期间都同等活跃。

例如：

- `planning` 阶段，`Planner` 与 `Clarifier` 活跃
- `fleet-forming` 阶段，`Coordinator` 活跃
- `executing` 阶段，`Researcher / Operator / Generator` 活跃
- `reviewing` 阶段，`Reviewer / Auditor` 活跃

### 3. Replan 触发车队重组

当路线变化时，车队应支持以下变化：

- 新增角色
- 移除角色
- 替换能力包
- 调整角色优先级
- 将并行子编组重新收敛

这也是为什么 `Fleet` 不能被视为静态数组。

### 4. Route 模板与阶段投影矩阵

为了让 `Route -> Fleet` 不停留在文案层，首轮统一按“路线模板 + 阶段”来描述角色启停：

| 场景 / 阶段 | 主角色 | 次角色 | 说明 |
| --- | --- | --- | --- |
| `understanding / planning` | `Planner` | `Clarifier` | 收口目标、识别缺口、生成路线草案 |
| `fleet-forming` | `Coordinator` | `Planner` | 把路线需要的能力映射成编组摘要 |
| `executing: research-heavy` | `Researcher` | `Generator` / `Reviewer` | 先取证，再生成，再复核 |
| `executing: operator-heavy` | `Operator` | `Reviewer` / `Auditor` | 带外部副作用时治理关注更高 |
| `reviewing / delivery` | `Reviewer` | `Auditor` | 结果验收、治理校验、证据收口 |
| `takeover-required` | `Clarifier` / `Operator` / `Reviewer` | `Auditor` | 取决于接管属于澄清、权限还是验收 |
| `replanning` | `Planner` | `Coordinator` | 调整路线、增删角色、重排优先级 |

### 5. 四类示例编组

#### 示例 A：单角色单线任务

- 任务特征：快速总结、小范围改写、无外部副作用
- 建议编组：`Generalist`
- 说明：允许一个角色承担规划 + 生成的混合职责，但要保留保守命名与底层来源

#### 示例 B：多角色并行任务

- 任务特征：需要检索、生成、复核并行推进
- 建议编组：`Planner + Researcher + Generator + Reviewer`
- 说明：`Researcher` 与 `Generator` 可并行，`Reviewer` 在收敛阶段接入

#### 示例 C：接管任务

- 任务特征：等待审批、预算、权限或人工确认
- 建议编组：`Planner + Clarifier + Operator + Reviewer`
- 说明：`Clarifier` 负责发起接管，`Operator` 承接权限/预算，`Reviewer` 负责结果是否可继续

#### 示例 D：重规划任务

- 任务特征：原路线失败、风险升高、分支需要重收敛
- 建议编组：`Planner + Coordinator + Operator + Auditor`
- 说明：`Planner` 重写路线，`Coordinator` 重排分支，`Operator` 执行新动作，`Auditor` 重新校验治理链

## Drive State 与 Fleet 的关系

建议把角色状态与高层 `Drive State` 对齐，但不要求一一对应。

示例关系如下：

| 高层 Drive State | 车队角色表现 |
| --- | --- |
| `understanding` | `Planner / Clarifier` 正在理解目标 |
| `clarifying` | `Clarifier` 等待补充或确认 |
| `planning` | `Planner` 组织路线与编组 |
| `fleet-forming` | `Coordinator` 绑定能力包与执行单元 |
| `executing` | `Researcher / Operator / Generator` 推进执行 |
| `reviewing` | `Reviewer / Auditor` 进行核查 |
| `blocked` | 相关角色进入 `blocked` 或 `waiting` |
| `takeover-required` | 相关角色暴露接管原因 |
| `replanning` | `Planner / Coordinator` 重组车队 |
| `delivered` | 主要角色进入 `done` |

## Takeover 与治理设计

角色封装层必须能够承接治理与接管语义。

建议每个角色具备两个附属投影：

- `RoleRiskProfile`
- `RoleTakeoverProfile`

示例：

```ts
type RoleRiskProfile = {
  riskTags: string[];
  primaryRiskLevel?: "low" | "medium" | "high";
  notes?: string[];
};

type RoleTakeoverProfile = {
  takeoverKinds: Array<"clarification" | "approval" | "permission" | "budget" | "result_acceptance" | "exception">;
  waitingForUser?: boolean;
  reason?: string;
};
```

这样可以把不同角色天然携带的治理职责表达清楚：

- `Clarifier` 更关心信息缺口
- `Operator` 更关心权限、预算、外部执行异常
- `Reviewer` 更关心结果接受与退回
- `Auditor` 更关心策略、证据、合规

## mission-first / runtime 兼容策略

### 1. 分层共存

建议明确如下分层：

- 产品层：`Destination / Route / Fleet / Drive State / Takeover`
- 工程层：`mission / workflow / task / runtime / node / executor / audit`

两层共存，不要求立即合并命名。

### 2. 投影优先

建议优先实现以下投影能力：

- mission + route -> fleet composition
- workflow stage + runtime node state -> role status
- agent records + executor state -> role carriers
- artifacts + logs + audit -> role evidence

### 3. 不让前端凭空造角色

前端可以做展示层 view model，但不能在缺少底层依据时凭空声明：

- “这是 Reviewer”
- “这是 Operator”

角色判断至少应来自：

- route planner 提供的角色需求
- role packaging projection 的统一规则
- runtime 归类映射表

### 4. 渐进落地顺序

为了兼容当前主仓的 `fleet summary` 闭环，首轮推荐按以下顺序推进：

1. 先定稿角色词汇表、角色矩阵和回退策略，不急着改 runtime 命名
2. 再收口 node family 分类表、能力包目录和 `Route -> Fleet` 设计矩阵
3. 然后扩展 shared builder / server projection，让 `planner / clarifier / operator / executor` 之外的角色逐步从“可展示”变成“可稳定合成”
4. 再把 `tasks-store` 的 normalize/fallback 规则与 panel 视图保持对齐，避免前端凭空造角色
5. 最后再接入相邻 spec 所属的 fleet status、takeover、replay、多视图复用与 runtime 集成测试

## Web-AIGC 节点体系的渐进封装

当前大量 Web-AIGC 节点不应直接对用户暴露为主语义。

建议采用两步法：

### 第一步：节点家族归类

先按节点用途归入角色家族，例如：

- 搜索、文档检索、网页问答 -> `Researcher`
- 用户输入、确认、参数收集 -> `Clarifier`
- 文件生成、格式输出、图表生成 -> `Generator`
- 浏览器打开、系统调用、控制台动作 -> `Operator`
- 审核、判断、确认 -> `Reviewer`

### 第二步：角色能力包沉淀

在归类稳定后，再逐步形成：

- 研究能力包
- 生成能力包
- 执行能力包
- 复核能力包

这样可以避免一次性重写节点系统。

## 前端展示约束

为确保角色封装层真正可用，前端展示建议遵守以下约束：

- 默认展示角色卡，而不是节点列表
- 默认展示角色职责、状态、焦点和结果摘要
- 需要时才展开到底层 agent / node / executor 明细
- skill、tool、MCP 默认作为附着能力，不作为主入口
- 角色卡应与步骤、阻塞点、中间结果、证据入口联动

这组约束也适用于多视图复用：

- 驾驶舱不应退化成节点瀑布图
- 接管面板不应退化成 executor/permission 原始字段堆叠
- 回放视图不应因为时间线细节而放弃角色主语义

## runtime 兼容集成测试计划

当前主仓已经形成 summary / projection / view-model 级单元测试矩阵，但为了让 fleet lane 后续真正落地，需要补一版“与 runtime 兼容”的集成测试计划，用于验证底层事实如何被稳定投影到角色层。

### 1. 集成测试目标

这组测试的目标不是验证页面样式，而是验证以下跨层链路：

- mission / workflow / runtime / executor 事实变动
  -> shared builder
  -> server projection
  -> client normalize
  -> role summary 消费

### 2. 建议覆盖的关键场景

| 场景 | 需要验证的事实 | 目标角色层断言 |
| --- | --- | --- |
| planning 场景 | mission 进入 planning / route draft 形成 | `planner` 角色稳定出现，状态与 `Drive State` 对齐 |
| waiting / clarification 场景 | workflow/runtime 进入 `WAITING_INPUT`，存在 decision / route selection / request-info | 角色层体现 `clarifier`，并能挂接 waiting / takeover 语义 |
| operator 场景 | browser/native executor 绑定到正在执行的动作节点 | 角色层优先体现 `operator`，并保留 `boundExecutors` 追溯 |
| executor 下沉场景 | 同一 executor 在 research / operation / generation 三类场景下被复用 | 角色层不把 executor 误当稳定一级角色，而是作为对应角色的 actuator 引用 |
| blocked / recovery 场景 | runtime blocked、retry、replan、resume | 角色状态、`blockedRoleCount`、focus 与 recovery/takeover 摘要保持一致 |
| projection fallback 场景 | fleet projection 缺失、roleType 未知 | client 侧稳定退化到 `custom` 或 `Mission Core` `operator`，不发明新角色 |

### 3. 测试分层建议

- shared 集成断言
  - 聚焦 mission/runtime 输入如何形成 fleet summary
- server 集成断言
  - 聚焦 `MissionProjectionView` 是否透传并保持角色字段稳定
- client 集成断言
  - 聚焦 projection alias、fallback、view-model 兼容
- consumer 集成断言
  - 聚焦角色摘要是否能被面板/相邻视图稳定消费

### 4. 本计划与当前主仓边界

本节的完成含义仍然只是“集成测试计划已设计收口”，不是“runtime 集成测试已经在仓库里补齐”。

当前已存在的直接测试锚点仍主要是：

- `shared/__tests__/mission-autopilot.test.ts`
- `server/tests/mission-routes.test.ts`
- `client/src/lib/tasks-store.autopilot.test.ts`
- `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`

而仍待补齐的是：

- 真正覆盖 agent / node / executor 跨层投影的更强集成场景
- `executor -> role actuator` 收口后的新断言
- 多视图 consumer 复用同一份角色摘要对象的断言矩阵

## 风险与边界

### 风险 1：与 dynamic-role-system 定义冲突

`dynamic-role-system` 更偏工程实现层，关注 role template、agent load/unload、切换约束。
本 spec 更偏产品建模层，关注用户可理解的车队角色封装。

因此需要明确：

- 动态角色系统是底层机制候选
- 车队角色封装是上层产品语义

### 风险 2：角色名称好看，但映射不稳

如果角色没有稳定映射规则，前端会出现同一底层对象在不同页面被说成不同角色的问题。

因此必须优先统一归类规则，再做大规模展示接入。

### 风险 3：把 skill / tool / executor 直接抬成角色

这会让用户重新面对工程细节，破坏角色层的意义。

因此必须坚持：

- skill / tool / MCP 是附着能力
- executor 是执行装置
- agent / node 是执行单元
- role 才是用户主语义

### 风险 4：过早要求底层全量改造

如果要求先改完 runtime 才能建立角色层，会导致 spec 长期无法落地。

因此首轮应以：

- 投影层
- 分类表
- 能力包目录
- 角色摘要对象

作为最小落地单位。

## 设计结论

本 spec 的最终设计结论如下：

1. `Fleet` 应被定义为面向当前 `Route` 的角色化能力编队
2. 用户主语义应落在 `FleetRolePackage`，而不是底层 node / tool / executor
3. 角色封装必须区分“角色层、能力包层、执行单元层、运行事实层”
4. `agents / nodes / executors / skills / tools` 必须被统一包装，但不应被强行合并为同一层对象
5. 角色组织应受 `Route`、`Drive State`、`Replan` 和 `Takeover` 共同影响
6. 与 `mission-first / workflow / runtime` 的关系应是“投影与兼容”，而不是“替换与重写”

## 当前主仓审计备注（2026-04-24）

以下内容是对当前主仓已落地实现的保守审计，用于说明哪些设计点已经有代码与测试支撑，哪些仍停留在目标模型层。

### 已有最小闭环

0. `Fleet` 的现行产品层语义与跨 spec 边界已经形成最小闭环。

- 当前主仓里真正稳定流通的是 `autopilotSummary.fleet` 这条 summary 分支，而不是完整 `FleetComposition` 领域对象；但它已经与同一 summary 内的 `route`、`driveState`、`takeover` 并列存在，足以承载“Fleet 是 Route 到 Execution 之间的角色组织摘要层”这一现行产品口径。
- 这也意味着本 spec 当前负责的是角色组织语义、字段边界与展示口径，而不是底层 dynamic role engine、执行主视图渲染，或整条 mission-to-autopilot mapping pipeline 的全部实现。

1. `Drive State -> role status` 已经有共享投影实现。

- `shared/mission/autopilot.ts` 中存在 `inferFleetRoleStatus(...)`，并由 `buildMissionAutopilotSummary(...)` 生成 `autopilotSummary.fleet.roles`。
- 当前投影会稳定输出 `planner` 角色，并根据 waiting / blocked 等状态把“操作侧”角色投影为 `clarifier` 或 `operator`。
- 当 mission 存在 executor 上下文时，共享 summary 还会追加 `executor` 角色，并直接计算 `activeRoleCount` / `blockedRoleCount`。
- 虽然 `MISSION_AUTOPILOT_FLEET_ROLE_TYPES` 枚举里已经出现 `researcher`、`generator`、`reviewer`、`auditor`、`custom` 等类型，但当前这条 shared builder 闭环还不能保守证明这些角色会被稳定合成出来；本轮可直接声明闭环的仍是 `planner`、`clarifier / operator` 与可选 `executor`。

2. 服务端 projection 与前端 view model 的职责边界已经形成。

- 当前共享层负责产出角色数组、角色状态、计数和基础展示字段，如 `title`、`responsibility`、`currentFocus`、`boundAgents`、`boundExecutors`。
- `client/src/lib/tasks-store.ts` 没有重新发明角色类型，而是对共享 / 服务端输入做归一化，补齐缺失计数，并在 projection 缺失时生成一个保守 fallback：单个 `Mission Core` `operator` 角色。
- `client/src/lib/tasks-store.autopilot.test.ts` 也已经覆盖了这层边界：它验证 shared/server 投影别名会被归一到同一份 `autopilotSummary.fleet`，并验证 fallback 只会补一个保守的 `Mission Core` `operator`，而不会把 `reviewer / auditor / researcher` 等展示名反向提升为前端自造的稳定角色投影。
- 这意味着“角色归类规则优先在 projection 层收口，前端只做兼容和展示补全”的边界在当前实现中已经成立。

3. `mission + workflow + runtime -> fleet summary` 的最小流程说明已经存在。

- `shared/mission/autopilot.ts` 读取 `mission` 的阶段、状态、等待/阻塞上下文、执行器上下文，生成 `fleet.roles / activeRoleCount / blockedRoleCount`。
- `server/tasks/mission-projection.ts` 在构建 `MissionProjectionView` 时复用同一份 shared builder，把 workflow runtime 状态一并注入 `autopilotSummary`。
- 前端不再单独定义 fleet 编组规则，而是优先消费服务端透传的 `autopilotSummary.fleet`。
- 这意味着虽然完整 `FleetComposition` 对象尚未落地，但“从 mission + workflow + runtime 投影出最小 fleet summary”的流程在当前主仓已经具备 shared / server 一致性。
- 但这条一致性目前仍是“shared builder 负责角色生成，server 负责挂载和透传”的一致性，而不是“server 层已经拥有独立的角色封装 / package 化逻辑”；因此它不能再外推为更多结构型任务已完成。

4. 前端主视图已经形成“角色优先、底层对象后置”的展示边界。

- `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 fleet 区块优先显示角色标题、活跃/阻塞计数以及运行中的 `currentFocus`。
- `boundAgents` 与 `boundExecutors` 会被保留并展示，但只作为次级细节而不是主视图主语。
- 现有测试已经覆盖 `Planner / Auditor / Reviewer`、`Planner / Operator / Executor`、活跃/阻塞计数，以及 `currentFocus`、`boundAgents`、`boundExecutors` 的展示。
- 但这里同样需要区分“面板可消费并展示某种角色卡”与“shared/server projection 已原生生成该角色”：前者已被 UI 测试证明，后者目前仍只对 `planner`、`clarifier / operator` 和可选 `executor` 有直接代码事实链。
- `shared/__tests__/mission-autopilot.test.ts` 与 panel 测试结合后，当前可以保守声明的闭环是：“shared builder 生成最小 fleet role 摘要，server 透传，store 归一化，panel 展示”；不能进一步外推为“完整角色封装对象模型”或“首轮角色全集都已有稳定产出”。
- 这也意味着 `tasks-store` 的 fallback 与 panel 的展示测试，新增证明的是“读链稳定”和“缺失时的保守降级稳定”，而不是“角色映射表”“能力包目录”“多视图复用口径”等上游建模任务已经补齐。

5. 角色封装层的最小单元测试矩阵已经形成。

- `shared/__tests__/mission-autopilot.test.ts` 负责锚定 shared builder 的最小角色生成与状态切换事实，包括 planning / waiting / blocked / queued 等 mission 场景下的 `fleet.roles`、`activeRoleCount`、`blockedRoleCount`、takeover / recovery / evidence 联动。
- `client/src/lib/tasks-store.autopilot.test.ts` 负责锚定 store 侧的 summary 归一化计划：覆盖 projection 别名接入、缺失 projection 时的 `Mission Core` fallback、route selection / replan 语义对齐，以及 summary/detail 两条读链保持一致。
- `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 负责锚定展示摘要稳定性：覆盖共享 shape、别名 shape、client 归一化 shape 下的 fleet 标题、活跃/阻塞计数、`currentFocus`、`boundAgents`、`boundExecutors`、以及相邻 execution / recovery / evidence 区块对角色摘要的消费。
- 以本 spec 的保守口径来看，这已经足以构成一版“角色封装层单元测试计划”的真实落地形态，因为测试矩阵已经按 shared builder、store normalizer、panel consumer 三层拆开，并且对应了归类、回退、追溯、阶段切换、展示稳定性这些最小维度。
- 但这里依然只应视为 summary / projection / view-model 级测试计划，不应外推为 runtime 兼容集成测试已经完成；真实 agent / node / executor 的跨层联调、运行时投影与更深的 carrier/attachment/repackage 语义，仍属于未完成范围。

### 本轮审计补充边界说明

- 与“保守角色回退策略”的边界：
  当前实现里确实存在两条最小回退链：`client/src/lib/tasks-store.ts` 会把未知 incoming `roleType` 归一成 `custom`，并在整段 autopilot projection 缺失时回退为单个 `Mission Core` `operator` 角色；相关断言也已经出现在 `client/src/lib/tasks-store.autopilot.test.ts`。但这两条能力只说明“未知类型兼容”与“缺失时单角色降级”已经稳定，不足以外推为已定义 `Generalist / Composite / Custom` 这类保守角色分类策略，更不能说明存在独立的 fallback taxonomy 或重分类规则，因此该任务本轮继续保留未勾选。
- 与“角色封装层单元测试计划”的边界：
  本轮新增勾选的是“最小测试矩阵已形成”，而不是“全部角色建模任务都已有对应测试”。当前测试重点仍围绕 `autopilotSummary.fleet` 的生成、归一化与展示消费展开，尚未覆盖 `FleetRolePackage`、`CapabilityPackage`、`ExecutionUnitRef`、`AttachmentRef` 等目标对象，也尚未进入真实 runtime 集成联调层。
- 与 `dynamic-role-system` 的边界：
  当前代码闭环仍停留在 projection / summary 层，负责把 mission、workflow、runtime、executor 等现有工程事实组织成用户可理解的 `fleet.roles`。role template、agent load/unload、底层切换约束仍应视为更底层机制范围，不因本 spec 勾选而视作已实现。
- 与 `fleet-status-and-live-execution-view` 的边界：
  当前 fleet 分支只承载角色标题、职责、状态、计数、`currentFocus`、`boundAgents`、`boundExecutors` 等角色摘要；执行步骤、route 细节、takeover 细节、recovery / evidence 仍留在相邻投影分支和主面板其它区块。这说明“角色组织模型”和“执行主视图投影”在现状中已经具备最小分层。
- 与 `mission-model-to-autopilot-model-mapping` 的边界：
  当前 `shared/mission/autopilot.ts` 统一负责 mission -> autopilot summary 的共享 builder，`server/tasks/mission-projection.ts` 只负责把 workflow runtime 上下文注入并透传。就 fleet 这一支而言，本 spec 可以保守认定已具备映射收口点，但不能把整条 mapping spec 的其它分支一并视为完成。

### 仍未完成的部分

- 当前实现还不能支撑本设计里完整的 `FleetComposition`、`FleetRolePackage`、`CapabilityPackage`、`ExecutionUnitRef`、`AttachmentRef` 对象体系；本轮确认的是最小 fleet summary 流程，而不是完整对象模型。
- 当前角色集合与设计稿中的首轮目标集合仍未完全对齐：代码中已有 `executor` 一级角色，但尚未形成 `Coordinator`、`Generalist` 等更稳定的上层产品语义。
- 当前尚未落成可单独勾选的“保守角色回退策略”定义：虽然 shared/store 类型层已包含 `custom`，store 也能在未知类型输入时回退到 `custom`，但缺失 projection 时的前端降级仍是单个 `Mission Core` `operator`，而不是带 `Generalist / Composite / Custom` 分层语义的稳定回退模型。
- `TaskAutopilotPanel` 对 `Auditor / Reviewer` 等角色标题的展示覆盖只能证明前端展示口径兼容这些角色摘要，不能反推 shared/server 已稳定提供相应角色投影或 role package 闭环。
- `executor -> role actuator` 关系仍不能保守勾选：现有 shared 投影仍把 `executor` 直接暴露成一等 fleet role，而不是稳定下沉为 `Operator` / `Researcher` / `Generator` 等角色的执行装置引用。
- 因此，本轮可以保守认定的是“最小 fleet role 投影、归一化和展示边界已经落地”，而不是“完整角色封装架构已经实现”。

### Lane 4 复核补充（2026-04-25）

- 本轮把 `fleet / role packaging / role status / role summary` 四个焦点再按“直接代码 + 直接测试”标准复核了一遍，结论是没有新的安全勾选；当前可成立的仍是最小 summary 闭环，而不是更完整的 role packaging 体系。
- `shared/mission/autopilot.ts` 当前真正实现的是 `MissionAutopilotFleetRole` 摘要模型：`id`、`roleType`、`title`、`status`、`responsibility`、`boundAgents`、`boundExecutors`、`currentFocus`。这足以支撑角色摘要、状态、绑定和 focus 展示，但还不足以等价为设计稿中的 `FleetRolePackage` / `CapabilityPackage` / `ExecutionUnitRef` / `AttachmentRef`。
- `shared/__tests__/mission-autopilot.test.ts` 直接证明的稳定角色仍主要是 `planner`、waiting 场景下的 `clarifier` / 常规场景下的 `operator`，以及 mission 带执行器上下文时追加的 `executor`；虽然类型枚举中已出现 `researcher / generator / reviewer / auditor / custom`，但测试没有证明这些角色会被 shared builder 稳定合成。
- `server/tasks/mission-projection.ts` 通过复用 shared builder 把 `autopilotSummary` 挂到 `MissionProjectionView`，但 `server/tests/mission-routes.test.ts` 当前更多在验证 route selection、replan、takeover、evidence correlation、bindings 与 link alignment；对 `fleet.roles` 的服务端直断言仍然偏弱，因此不宜把 server 层外推为已经具备独立角色打包逻辑。
- `client/src/lib/tasks-store.ts` 与 `client/src/lib/tasks-store.autopilot.test.ts` 证明了前端归一化边界是稳的：可以透传 shared/server summary，未知 `roleType` 会回退为 `custom`，projection 缺失时会退化成单个 `Mission Core` `operator`。但这依然只说明兼容与降级稳定，不足以构成完整的 fallback taxonomy。
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 证明的是消费能力而不是生成能力：面板可以稳定展示 `Planner / Auditor / Reviewer`、`Planner / Operator / Executor` 等组合，也会消费 `activeRoleCount`、`blockedRoleCount`、`currentFocus`、`boundAgents`、`boundExecutors`；但这些 UI fixture 不能反推 shared/server 已经稳定产出同等范围的角色家族。
- 因此，`Route -> Fleet` 完整投影规则、`Takeover -> role` 细化关系、`executor -> role actuator`、首轮稳定角色全集、以及全部 package/ref 结构，本轮继续保持为目标模型层而非已落地实现层。

### Lane 5 设计收口补充（2026-04-25）

- 本轮新增收口的重点，不是额外扩大“当前主仓已实现”的范围，而是把 fleet lane 中仍停留在散点描述的设计任务统一写成成体系的文档：补齐了角色矩阵、保守回退策略、节点家族分类表、能力包目录、路线投影矩阵、四类示例编组和渐进落地顺序。
- 因此本轮可以安全新增勾选的一批任务，语义上都属于“spec / design 文档已收口”，而不是“shared/server/client 已经按该模型全量实现”。尤其是 `FleetComposition / FleetRolePackage / CapabilityPackage / ExecutionUnitRef / AttachmentRef`，当前仍是目标结构，不应被误读为主仓已有等价 TypeScript 运行对象。
- 本轮特意保留未勾选的条目包括：`executor -> role actuator`、多视图复用口径、runtime 集成测试计划。原因是当前 shared builder 依旧把 `executor` 暴露为一级 fleet role；直接有代码和测试支撑的多视图 consumer 仍主要是 `TaskAutopilotPanel`；而真实 agent / node / executor 状态跨层投影到角色层的集成测试矩阵还没有在当前仓库形成。
- 同时新增的“当前主仓已落地的最小摘要对象”小节，目的是防止把 `MissionAutopilotFleetRole` 摘要模型与设计稿中的完整 `FleetRolePackage` 混写：前者是当前主仓事实，后者是本 spec 继续约束的目标结构。
