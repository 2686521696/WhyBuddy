# 设计文档：Destination 模型与解析器

## 设计概述

`Destination` 是任务自动驾驶体系中的“目标对象层”。
它的职责不是代替现有 `mission` 和 `workflow`，而是在它们之上增加一个更贴近用户意图的结构化入口，使系统能够从“接收一段文本”升级为“理解一个要送达的结果”。

设计原则如下：

- 先引入上位对象，不直接推翻现有 mission / workflow 体系
- 先做结构化解析与映射，再逐步推动 route 和 cockpit 能力
- 所有关键字段都要保留来源、置信度和是否需要澄清
- 支持“原始输入 -> Destination -> mission/workflow payload”的降级兼容链路

## 设计目标

本设计要解决以下问题：

- 用户输入往往过于自然语言化，无法直接用于稳定规划
- mission 输入和 workflow 输入当前偏执行态，缺少目标层显式建模
- runtime 常在中途才发现约束缺失、成功标准不明或任务类型不清
- review / audit 缺少上游“任务理解依据”的结构化证据

## 当前最小合同与目标态模型分层

为避免把未来完整 `Destination` parser 设计与当前主线已存在的最小摘要实现混淆，本设计明确拆分为两层：

### A. 目标态完整 Destination 模型

面向输入归档、解析、澄清、重解析、投影、版本化更新、审计回放的完整领域对象，负责表达：

- 用户原始输入与来源
- 归一化目标与子目标
- 结构化约束
- 成功标准
- 缺失信息与澄清建议
- 任务类型
- 解析证据与置信度
- mission / workflow 投影
- 版本与变更摘要

### B. 当前主线最小 destination 摘要合同

当前 shared / server / client / panel 已稳定消费的对象，实际是 `MissionAutopilotSummary.destination`，而不是完整 `Destination` 实体。其当前最小合同为：

```ts
type MissionAutopilotDestinationSummary = {
  id: string;
  goal: string;
  request: string;
  taskType: "analysis" | "research" | "generation" | "transformation" | "implementation" | "coordination" | "mixed" | "unknown";
  auxiliaryTaskTypes: Array<"analysis" | "research" | "generation" | "transformation" | "implementation" | "coordination" | "mixed" | "unknown">;
  constraints: string[];
  successCriteria: string[];
  deliverables: string[];
  missingInfo: string[];
  confidence?: {
    level: "low" | "medium" | "high";
    reason?: string | null;
    signals?: string[];
  };
  missingInfoDetails?: Array<{
    item: string;
    impact: string;
    blocking: boolean;
  }>;
};
```

这一层合同当前仅能证明：

- 已有 mission-derived 的最小目标摘要；
- 已有 mission-derived 的最小任务类型识别与 `mixed / unknown` 回退；
- 已有 shared -> server -> client -> panel 的稳定消费闭环；
- 已有 `confidence / reason / signals / missingInfoDetails` 这类解释字段锚点。

这一层合同当前不能证明：

- 已有独立 `Destination` parser；
- 已有 `subGoals`、`taskType`、`suggestedClarifications`、结构化 `constraints` / `successCriteria` / `missingInformation`；
- 已有 input archive、版本化更新或 clarification merge 机制。

## 核心对象设计

### 1. Destination 对象

建议的核心结构如下：

```ts
type Destination = {
  id: string;
  sourceInput: {
    text: string;
    attachments: DestinationAttachmentRef[];
    source: "chat" | "mission_form" | "workflow_launch" | "api";
    submittedAt: string;
  };
  normalizedGoal: GoalSummary;
  subGoals: SubGoal[];
  constraints: DestinationConstraint[];
  successCriteria: SuccessCriterion[];
  missingInformation: MissingInformationItem[];
  taskType: DestinationTaskType;
  auxiliaryTaskTypes: DestinationTaskType[];
  confidence: DestinationConfidence;
  assumptions: DestinationAssumption[];
  suggestedClarifications: ClarificationPrompt[];
  evidence: DestinationEvidence[];
  mappedMissionContext: MissionInputProjection;
  mappedWorkflowInput: WorkflowInputProjection;
  version: number;
};
```

### 2. 目标对象拆解

#### `normalizedGoal`

表示系统对用户目标的归一化理解，应至少包含：

- `title`：一句话目标标题
- `summary`：面向规划器的目标摘要
- `expectedDeliverables`：预期交付物
- `businessIntent`：业务意图或使用意图

建议补充字段：

- `goalType`
  - 标记当前目标更偏“结果交付”“分析判断”“产出生成”“执行推进”中的哪一类，用于 route planner 做主路线选择。
- `sourceRefs`
  - 记录该 goal 摘要由哪些 source text span、附件、上下文段落支撑。
- `confidence`
  - 用于表达 goal 标题与摘要是否已经稳定，若低于阈值则应优先进入澄清或 partial 状态。

#### `subGoals`

表示可进一步拆分的子目标，每个子目标建议包含：

- `id`
- `title`
- `description`
- `priority`
- `dependsOn`
- `statusHint`

建议补充字段：

- `deliverables`
  - 子目标对应的局部交付物，供 route planner 生成阶段出口条件。
- `source`
  - `explicit / inferred / template`，用于区分子目标来自用户原文、系统推断还是任务模板。
- `confidence`
  - 用于在多动作输入或复合任务中表达拆分稳定度。
- `blockingQuestions`
  - 若某个子目标尚不能直接进入执行，记录其对应缺口字段。

子目标拆分设计原则：

- 不要求所有输入都一定产生 `subGoals`；
- 当系统只能稳定识别主目标时，可保留空 `subGoals` 并通过低置信度 / missingInformation 显式说明；
- 当输入同时包含“分析 + 生成 + 审阅 + 交付”等多段动作时，应优先拆分为可被 route planner 消费的阶段性子目标，而不是简单保留原句。

#### `constraints`

每条约束建议包含：

- `type`
- `value`
- `required`
- `source`
- `confidence`
- `blockingLevel`

建议补充字段：

- `dimension`
  - 约束大类，首批建议固定为 `time / budget / permission / format / style / data-scope / tool / governance / taboo-boundary`。
- `status`
  - `confirmed / inferred / defaulted / missing`，用于表达该约束是否已被明确确认。
- `evidenceRefs`
  - 关联到原文片段、mission facts 或治理规则。
- `appliesTo`
  - 指明作用范围为整条 destination、某个 subGoal、某个 deliverable 或某个 runtime 阶段。

当前主线现实边界：

- shared builder 中的 `buildConstraints()` 目前只安全派生 `Mission kind`、`Source app`、`Security level` 三类最小字符串摘要；
- 因此本节字段设计应被视为目标态 parser contract，而不是当前代码已有合同。

#### `successCriteria`

每条成功标准建议包含：

- `description`
- `metricType`
- `required`
- `source`
- `confidence`

建议补充字段：

- `status`
  - `confirmed / inferred / template / unresolved`，用于表达该标准是否已被用户确认。
- `appliesTo`
  - 指向整个 destination、某个 subGoal 或某个 deliverable。
- `evidenceRefs`
  - 记录来源文本、任务模板或 mission 事实锚点。
- `verificationHint`
  - 供 review / audit / verify 阶段直接消费的校验提示。

成功标准识别设计原则：

- 用户显式交付要求优先级最高；
- 任务类型模板补充不得覆盖用户显式标准；
- 当系统只能得到极弱的 mission-derived 完成口径时，应将其视为“最低兼容成功标准”，不能冒充完整 parser 输出。

#### `missingInformation`

每条缺失信息建议包含：

- `field`
- `question`
- `reason`
- `blockingLevel`
- `canInferByDefault`

建议补充字段：

- `category`
  - `material / scope / preference / permission / budget / timing / deliverable / governance / external-access`。
- `status`
  - `open / resolved / waived / inferred-by-default`。
- `impact`
  - 缺口对 route / runtime / review 的直接影响说明。
- `suggestedOwner`
  - 指向 user / operator / policy / system-auto-fill。
- `relatedSubGoalIds`
  - 该缺口主要阻塞哪些子目标。

缺失信息设计边界：

- 当前主线中 `missingInfoDetails` 只覆盖 waiting / blocked 场景下的 `item / impact / blocking`；
- 它可以作为未来 `MissingInformationItem` 的最小锚点，但还不能等同于完整缺口识别器与澄清问题生成器。

#### `taskType`

首批枚举建议如下：

```ts
type DestinationTaskType =
  | "analysis"
  | "research"
  | "generation"
  | "transformation"
  | "implementation"
  | "coordination"
  | "mixed"
  | "unknown";
```

建议补充任务类型识别输出：

```ts
type DestinationTaskTypeSummary = {
  primary: DestinationTaskType;
  auxiliary: DestinationTaskType[];
  confidence: "low" | "medium" | "high";
  source: "explicit" | "rule" | "model" | "fallback";
  reasons: string[];
};
```

任务类型识别矩阵建议关注：

- 用户动作词
  - 如“分析”“调研”“生成”“实现”“改造”“复核”“审批”“交付”。
- 目标交付物
  - 如报告、方案、代码改动、图片、审计意见、运行结果。
- 运行方式
  - 是否需要多阶段、多角色、澄清与治理。
- 已知 mission / workflow 上下文
  - 当前是否更接近研究、执行、变更、审阅或复合流程。

当前主线现实边界：

- `MissionAutopilotSummary.destination` 现在已经暴露最小 `taskType / auxiliaryTaskTypes`；
- 但当前分类仍是 mission-derived 规则归纳，不是完整 parser 输出；
- 因此这里的 richer 类型模型与分类理由结构仍属于设计上限，而不是当前全部已落地的共享合同。

### 3. 建议补充的辅助对象

为支撑目标/子目标解析、约束抽取、成功标准识别、缺失信息识别与任务类型识别，建议在完整 parser 模型中补充以下辅助对象：

```ts
type ClarificationPrompt = {
  id: string;
  question: string;
  reason: string;
  blockingLevel: "blocking" | "non-blocking";
  relatedFields: string[];
  relatedSubGoalIds: string[];
  defaultAction?: string | null;
};

type DestinationEvidenceRef = {
  id: string;
  type: "source-text" | "attachment" | "mission-fact" | "policy" | "model-output";
  label: string;
};

type DestinationConfidence = {
  overall: "low" | "medium" | "high";
  reason: string;
  signals: string[];
};
```

这些对象当前仍无直接代码合同，但它们与现有 `destination.confidence`、`destination.missingInfoDetails` 已形成语义锚点，可作为后续 shared model 收口方向。

## 解析器设计

### 1. 总体流程

建议把解析器拆成 6 个阶段：

1. 输入归档
2. 意图抽取
3. 结构化补全
4. 类型识别
5. 缺口分析
6. mission/workflow 投影

### 2. 阶段说明

#### 阶段一：输入归档

输入来源包括：

- 对话框输入
- mission 创建页
- workflow 启动入口
- API 触发

该阶段负责：

- 收集原始文本
- 建立附件引用
- 写入来源信息
- 生成 `Destination.id`

建议把输入归档层的最小合同固定为：

| 字段 | 说明 | 设计约束 |
| --- | --- | --- |
| `sourceInput.text` | 原始文本输入 | 保留原文，不在 archive 层做语义改写 |
| `sourceInput.attachments` | 附件引用列表 | 仅保存引用，不在首轮 parser 中复制文件内容 |
| `sourceInput.source` | 提交来源 | 首轮固定为 `chat / mission_form / workflow_launch / api` 四类 |
| `sourceInput.submittedAt` | 提交时间 | 作为后续澄清、重解析、回放排序锚点 |

归档规则建议为：

1. archive 层只负责“收进来”，不负责“解释正确”；
2. 原始文本、附件引用、来源类型必须是 append-only 事实；
3. parser 只能在 archive 之上追加结构化解释，不能静默改写原始输入；
4. 当前主仓若仍以 mission/sourceText 进入，也应被视为 `sourceInput.text` 的最小兼容来源，而不是完整 archive 已落地。

#### 阶段二：意图抽取

目标是把原始输入提炼为：

- 核心目标
- 交付物
- 用户要求
- 可能的子目标

该阶段可以结合规则与模型推断，但输出必须归一化到同一结构中。

建议在该阶段拆出两层结果：

- `goalCandidate`
  - 面向 `normalizedGoal` 的标题、摘要、交付物候选。
- `subGoalCandidates`
  - 面向多动作、多交付物、多阶段任务的拆分候选。

建议的目标/子目标抽取流程：

1. 先识别单句中的动作词、交付物词和范围词；
2. 再识别并列结构、顺序结构、阶段结构与条件结构；
3. 对“先分析、再生成、最后审阅”这类复合输入生成多条 subGoal candidate；
4. 若候选冲突或过度模糊，则回退为主目标 + 低置信度说明，而不是伪造稳定子目标。

#### 阶段三：结构化补全

在这一阶段系统补齐：

- 约束
- 成功标准
- 默认假设
- 任务上下文缺口

此处需要明确区分：

- 明确输入
- 推断结果
- 默认模板

建议把结构化补全内部再拆成三段：

1. 约束抽取
   - 识别时间、预算、权限、格式、风格、工具、数据范围、治理边界。
2. 成功标准识别
   - 识别显式交付要求、任务类型模板、运行时最低兼容标准。
3. 假设与缺口分流
   - 把可以安全默认的字段进入 `assumptions`，把必须澄清的字段进入 `missingInformation`。

当前主线现实边界：

- `buildConstraints()` 当前只生成 mission-derived 最小字符串约束；
- `buildSuccessCriteria()` 当前只生成 mission-derived 最小字符串成功口径；
- 因此这一阶段的细化逻辑仍属于目标态 parser 设计，不应被误读为 shared builder 已覆盖。

#### 阶段四：类型识别

根据目标表达、交付物、动作词、上下文场景对任务进行分类。
如果是复合任务，应选择一个主类型并补充辅助类型。

建议把类型识别判断拆成三层信号：

- 文本信号
  - 动作词、交付物词、阶段词。
- 上下文信号
  - mission kind、source app、security level、existing route hints。
- 结构信号
  - 是否有多个 subGoals、是否存在治理约束、是否存在必须审批的 takeover 点。

当三层信号冲突时：

- 允许输出 `mixed`；
- 同时保留 reasons，供 route planner 与 cockpit 解释“为什么判成复合型任务”。

#### 阶段五：缺口分析

分析哪些信息缺失会阻塞执行，哪些可在执行中补齐。

输出包括：

- `missingInformation`
- `suggestedClarifications`
- 是否建议进入接管点

建议把缺口分析结果固定分成两类：

- `blocking`
  - 缺失后无法继续 route selection、route execution、external action、final delivery。
- `non-blocking`
  - 允许先继续部分执行，但应在 route / takeover 中挂出提醒并尽快回补。

建议的澄清生成原则：

- 只为高影响缺口生成用户可回答的问题；
- 能由系统默认补全的字段优先进入 `assumptions`；
- 能由现有 mission facts 或已挂载附件验证的字段不重复追问。

当前主线现实边界：

- `buildMissingInfo()` 与 `buildMissingInfoDetails()` 当前仅覆盖 waiting / blocked 缺口归纳；
- 尚未存在 `suggestedClarifications` 合同。

#### 阶段六：mission/workflow 投影

将 `Destination` 降级映射回当前主仓已存在的输入体系，保证兼容性。

当前主线的最小可验证投影路径应明确为：

- shared builder
  - 产出 mission-derived destination 摘要；
- server projection
  - 透传 `autopilotSummary.destination`；
- client store
  - 归一化 `confidence / missingInfoDetails / impact / blockingReason` 等结构化补充字段；
- panel
  - 展示 destination summary，而不是完整 parser 对象。

## 与现有 mission 输入的映射设计

### 映射目标

不破坏现有 mission 体系前提下，为 mission 增加一层来源更清晰的目标结构。

### 映射建议

| Destination 字段 | mission 侧建议映射 |
| --- | --- |
| `normalizedGoal.title` | mission 标题 |
| `normalizedGoal.summary` | mission 目标说明 |
| `subGoals` | mission 阶段目标、分解建议或步骤草案 |
| `constraints` | mission metadata / governance / limits |
| `successCriteria` | review / verify / completion hints |
| `missingInformation` | mission 启动后的待澄清事项 |
| `taskType` | mission category / strategy hint |
| `assumptions` | mission startup notes |

### 映射原则

- mission 仍是运行中的业务对象
- `Destination` 是 mission 之前的目标解释层
- 若 mission 侧当前无强类型字段，可先放入 metadata 投影
- 映射必须可逆追踪，至少能知道 mission 内容来自哪个 `Destination`

当前主线最小现实：

- 当前真实存在的是 `mission -> destination summary` 的派生链，而不是完整 `Destination -> mission` 的先解析后回写实现；
- 因此本表仍然代表目标态映射设计，但它已经拥有可被现有 summary / projection / panel 消费链锚定的方向性基础。

## 与现有 workflow 输入的映射设计

### 映射目标

让当前 workflow runtime、节点变量与启动 payload 可以直接消费 `Destination` 投影结果。

### 映射建议

| Destination 字段 | workflow 侧建议映射 |
| --- | --- |
| `normalizedGoal` | 顶层 goal / brief 变量 |
| `subGoals` | planner 节点、分段节点、阶段种子变量 |
| `constraints` | runtime governance、tool policy、output control |
| `successCriteria` | review / audit / verify 节点输入 |
| `missingInformation` | wait / clarify / HITL 节点输入 |
| `taskType` | 默认路线模板选择信号 |
| `confidence` | 是否自动执行、是否先澄清的判断依据 |

### 映射原则

- 不要求重写现有 workflow schema
- 先通过投影层组装兼容 payload
- 保留字段来源，避免 runtime 误把推断信息当成用户硬约束

当前主线最小现实：

- 当前最接近 `workflow` 投影锚点的，是 shared / server 侧已经接受“先产出上位摘要，再提供给后续消费层”的兼容路线；
- 但仍未看到完整 `Destination -> workflow payload` 写回合同。

## 解析策略设计

### 1. 规则优先 + 模型补足

首轮建议采用“规则优先、模型补足”的混合策略：

- 对明显结构化信息使用规则抽取
- 对模糊任务类型、隐含成功标准、隐式子目标使用模型推断
- 所有推断结果必须带置信度

这样做的原因：

- 可以更快接入现有主仓
- 容易解释和回放
- 降低完全依赖模型输出带来的不稳定性

### 2. 低置信度处理

当解析结果低于阈值时，解析器不应强行确定：

- 不确定的子目标可以延后到 route planner 再细分
- 不确定的成功标准应进入待澄清
- 不确定的任务类型应标记为 `mixed` 或 `unknown`

### 3. 默认假设策略

对于不阻塞执行、且平台有稳妥默认值的字段，可以进入 `assumptions`：

- 默认输出为 markdown
- 默认先出提纲再出正文
- 默认使用标准路线而不是深度路线

但需要满足：

- 假设必须显式记录
- 假设不能覆盖用户明确输入
- 高风险字段不得自动假设

## 目标/子目标解析设计

### 1. GoalSummary 设计建议

```ts
type GoalSummary = {
  title: string;
  summary: string;
  expectedDeliverables: string[];
  businessIntent?: string | null;
  goalType?: "result" | "analysis" | "generation" | "execution" | "mixed";
  sourceRefs?: string[];
  confidence?: "low" | "medium" | "high";
};
```

设计原则：

- `title` 面向 panel / route summary；
- `summary` 面向 planner / runtime；
- `expectedDeliverables` 面向 review / audit / completion；
- `businessIntent` 用于区分“表面产出”和“真正目的地”。

### 2. SubGoal 设计建议

```ts
type SubGoal = {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  dependsOn: string[];
  statusHint: "ready" | "clarify" | "blocked";
  deliverables?: string[];
  source?: "explicit" | "inferred" | "template";
  confidence?: "low" | "medium" | "high";
};
```

拆分规则建议：

- 并列交付物可拆成并列 subGoals；
- 顺序动作应拆成带 `dependsOn` 的 subGoals；
- 含明显阶段词时优先按阶段拆分；
- 输入过短或语义过于模糊时允许只保留主目标，不强造子目标。

## 约束抽取设计

### 1. DestinationConstraint 设计建议

```ts
type DestinationConstraint = {
  id: string;
  dimension:
    | "time"
    | "budget"
    | "permission"
    | "format"
    | "style"
    | "data-scope"
    | "tool"
    | "governance"
    | "taboo-boundary";
  value: string;
  required: boolean;
  source: "explicit" | "inferred" | "default" | "policy";
  confidence: "low" | "medium" | "high";
  blockingLevel: "blocking" | "non-blocking";
  appliesTo?: string[];
  evidenceRefs?: string[];
};
```

### 2. 抽取顺序建议

1. 先抽显式约束；
2. 再结合 mission / policy / context 补 infer / policy 约束；
3. 最后对可安全默认的字段记录 default 约束；
4. 对缺失且高风险的约束，不默认补齐，直接进入 `missingInformation`。

## 成功标准识别设计

### 1. SuccessCriterion 设计建议

```ts
type SuccessCriterion = {
  id: string;
  description: string;
  metricType: "deliverable" | "quality" | "approval" | "state-change" | "evidence";
  required: boolean;
  source: "explicit" | "inferred" | "template" | "runtime-minimum";
  confidence: "low" | "medium" | "high";
  status: "confirmed" | "candidate" | "unresolved";
  appliesTo?: string[];
  verificationHint?: string | null;
};
```

### 2. 识别顺序建议

1. 用户显式要求；
2. deliverable 驱动的隐式成功标准；
3. taskType 模板标准；
4. mission runtime 最低兼容标准。

其中第 4 层只应作为当前主线的最低兼容锚点，不能等同于完整 parser 识别结果。

## 缺失信息与澄清设计

### 1. MissingInformationItem 设计建议

```ts
type MissingInformationItem = {
  id: string;
  category:
    | "material"
    | "scope"
    | "preference"
    | "permission"
    | "budget"
    | "timing"
    | "deliverable"
    | "governance"
    | "external-access";
  field: string;
  question: string;
  reason: string;
  impact: string;
  blockingLevel: "blocking" | "non-blocking";
  canInferByDefault: boolean;
  relatedSubGoalIds?: string[];
  evidenceRefs?: string[];
};
```

### 2. ClarificationPrompt 设计建议

```ts
type ClarificationPrompt = {
  id: string;
  question: string;
  reason: string;
  blockingLevel: "blocking" | "non-blocking";
  relatedFields: string[];
  relatedSubGoalIds: string[];
  defaultAction?: string | null;
};
```

当前主线最小现实：

- `destination.missingInfo` 与 `destination.missingInfoDetails` 可视为 `MissingInformationItem` 的最小过渡锚点；
- 当前尚无 `ClarificationPrompt` 消费合同。

## 任务类型识别设计

### 1. 任务类型判断信号

- 动作词信号
  - 如分析、整理、生成、实现、改造、审阅、审批。
- 交付物信号
  - 如报告、方案、代码、图像、审计结论、上线计划。
- 结构信号
  - 是否多阶段、是否多子目标、是否存在显著治理 / takeover 约束。
- 上下文信号
  - mission kind、source app、security level、history / route hints。

### 2. 任务类型判断输出

```ts
type DestinationTaskTypeDecision = {
  primary: DestinationTaskType;
  auxiliary: DestinationTaskType[];
  confidence: "low" | "medium" | "high";
  reasons: string[];
};
```

设计边界：

- 允许 `mixed` 与 `unknown`；
- 不允许在低置信度下伪装成稳定单一类型；
- 当前主线尚无这一层 shared contract 与测试闭环。

## 版本与更新设计

`Destination` 需要支持增量更新，原因包括：

- 用户追加说明
- 澄清结果返回
- 附件补充完成
- 审批限制变更

建议增加：

- `version`
- `updatedAt`
- `changeSummary`

每次更新建议遵守以下合并规则：

| 更新对象 | 建议策略 | 设计边界 |
| --- | --- | --- |
| `sourceInput` | 原始输入 append-only，新增补充项而不是覆盖历史 | 不允许静默抹掉首版输入 |
| `normalizedGoal` | 以最新澄清或重新解析结果为准 | 必须保留 `changeSummary` 说明为什么变更 |
| `constraints` | 以“用户显式输入 > 已批准治理规则 > 推断默认值”为优先级合并 | 推断值不能覆盖用户明确输入 |
| `successCriteria` | 合并新增标准并保留来源 | 已确认标准不能因重解析被无痕删除 |
| `missingInformation` | 已解决项标记关闭，未解决项继续保留 | 不允许把阻塞缺口静默移除 |
| `evidence` | 追加新的解析证据与澄清证据 | 解释链应保持可回放 |

更新方式建议为：

1. 保留初版解析结果
2. 基于澄清输入合并修订
3. 对 route planner 和 runtime 暴露最新版
4. 审计与回放可查看历史版本

## 失败与降级策略设计

`Destination` 解析失败不应表现为“静默忽略”，而应进入可解释的降级链路。

建议把解析结果分为三类：

- `ready`
  - 已得到足够稳定的 `Destination`，可以继续进入 mission / workflow 投影
- `partial`
  - 已得到目标摘要与部分约束，但仍有关键字段缺失，需要先补充 `missingInformation`、`assumptions` 与 `suggestedClarifications`
- `fallback`
  - 当前无法形成可信 `Destination`，需退回原始 mission / workflow 启动模式

当进入 `fallback` 时，至少应保留：

- 原始输入文本与附件引用
- 无法解析的字段列表
- 失败原因摘要
- 已识别出的最小安全字段，例如 `goal` 或 `request`
- 是否允许稍后重新解析的标记

降级原则如下：

- 不得把低置信度推断字段伪装成确定事实
- 不得在失败时丢掉原始输入、失败原因或未解析字段
- mission / workflow 可以继续以兼容 payload 启动，但必须知道自己消费的是 fallback 输入，而不是完整 `Destination`
- 一旦用户补充澄清、附件或约束，解析器应允许从 `fallback / partial` 重新进入 `ready`

## 测试计划

本 spec 的测试计划需要明确区分“当前最小 summary 链路测试”与“未来完整 parser 测试”。

### 1. 当前已存在的最小链路测试锚点

- shared builder 测试
  - 验证 `destination.goal / deliverables / confidence / missingInfo / missingInfoDetails` 的 mission-derived 构造。
- server projection 测试
  - 验证 `/projection` 返回 `destination.request / constraints / successCriteria / deliverables / confidence / missingInfo / missingInfoDetails`。
- client store 测试
  - 验证 `destination.confidence`、`missingInfoDetails -> impact / blockingReason` 的归一化与 fallback。
- panel 测试
  - 验证 destination 卡片对 `constraints / deliverables / confidence / missingInfo / missingInfoDetails / impact` 的展示。

### 2. 未来完整 parser 单元测试建议

- 目标/子目标解析
  - 单目标、并列目标、顺序目标、多阶段交付、复合任务。
- 约束抽取
  - 时间、预算、权限、格式、风格、工具、数据范围、治理边界。
- 成功标准识别
  - 显式标准、推断标准、模板标准、无法确定转缺口。
- 缺失信息与澄清
  - blocking / non-blocking 分类、问题生成、默认补全分流。
- 任务类型识别
  - analysis / research / generation / implementation / coordination / mixed / unknown。

### 3. 未来完整 parser 契约测试建议

- `sourceInput -> Destination`
  - 原始文本、附件、来源、submittedAt 是否稳定进入 archive / parser。
- `Destination -> mission`
  - 是否保留 goal、constraints、successCriteria、missingInformation 的最小兼容投影。
- `Destination -> workflow`
  - planner / governance / review / clarify 输入是否稳定。
- 澄清后的增量更新
  - `version / updatedAt / changeSummary` 是否保留，重解析是否可回放。

### 4. 当前测试边界说明

- 当前仓库中的现有测试只能证明“mission-derived destination summary 消费链”已经存在；
- 它们不能被解释为完整 `Destination` parser / archive / version-update 测试已经完成。

## 审计与可解释性设计

为支持 replay / audit / lineage，解析器输出需要保留证据。

建议 `evidence` 至少记录：

- 来源文本片段
- 附件引用
- 规则命中项
- 模型推断摘要
- 置信度说明

这样可以回答三个关键问题：

- 系统为什么把任务理解成这个目标
- 系统为什么认为某个信息缺失
- 系统为什么建议这类路线或接管点

## 兼容性与迁移策略

### 兼容性

- 老入口仍可继续提交 mission / workflow payload
- 新入口优先生成 `Destination`
- 若 `Destination` 解析失败，可降级回原有输入模式，但必须带错误原因

### 迁移策略

分三步推进：

1. 在新入口引入 `Destination` 解析，不动旧 runtime
2. 增加 mission/workflow 投影层
3. 再让 route planner、cockpit、takeover 消费 `Destination`

## 开发联调样例

### 样例 1：用户输入到 Destination

典型输入：

```json
{
  "text": "帮我整理 Feishu 和 Cube 两边的发布风险，给出本周 rollout 建议，并输出一份可审阅的 markdown 方案。",
  "source": "mission_form",
  "attachments": ["release-notes.pdf", "rollback-checklist.md"]
}
```

目标 `Destination` 样例：

```json
{
  "id": "dest_release_rollout_review",
  "sourceInput": {
    "text": "帮我整理 Feishu 和 Cube 两边的发布风险，给出本周 rollout 建议，并输出一份可审阅的 markdown 方案。",
    "attachments": ["release-notes.pdf", "rollback-checklist.md"],
    "source": "mission_form",
    "submittedAt": "2026-04-24T09:00:00.000Z"
  },
  "normalizedGoal": {
    "title": "整理双端发布风险并输出 rollout 审阅方案",
    "summary": "分析 Feishu 与 Cube 的发布风险，给出本周 rollout 建议，并形成可审阅 markdown 交付物。",
    "expectedDeliverables": ["rollout-plan.md"],
    "businessIntent": "支持本周发布决策"
  },
  "subGoals": [
    {
      "id": "collect_risks",
      "title": "收集双端发布风险",
      "description": "梳理 Feishu 和 Cube 当前风险点与阻塞项",
      "priority": "high",
      "dependsOn": [],
      "statusHint": "ready"
    },
    {
      "id": "draft_plan",
      "title": "生成 rollout 建议",
      "description": "基于风险与现状输出本周 rollout 建议和审阅稿",
      "priority": "high",
      "dependsOn": ["collect_risks"],
      "statusHint": "ready"
    }
  ],
  "constraints": [
    {
      "type": "output-format",
      "value": "markdown",
      "required": true,
      "source": "user-input",
      "confidence": "high",
      "blockingLevel": "non-blocking"
    }
  ],
  "successCriteria": [
    {
      "description": "输出一份可审阅的 markdown rollout 方案",
      "metricType": "deliverable",
      "required": true,
      "source": "user-input",
      "confidence": "high"
    }
  ],
  "missingInformation": [],
  "taskType": "analysis",
  "auxiliaryTaskTypes": ["generation"],
  "confidence": {
    "overall": "medium"
  },
  "assumptions": [
    {
      "field": "time-range",
      "value": "current week rollout window"
    }
  ],
  "suggestedClarifications": [],
  "mappedMissionContext": {
    "title": "整理双端发布风险并输出 rollout 审阅方案"
  },
  "mappedWorkflowInput": {
    "goal": "分析发布风险并输出 rollout 建议"
  },
  "version": 1
}
```

### 样例 2：Destination 到 mission / workflow 的投影

`Destination -> mission` 投影样例：

```json
{
  "title": "整理双端发布风险并输出 rollout 审阅方案",
  "summary": "分析 Feishu 与 Cube 的发布风险，给出本周 rollout 建议，并形成可审阅 markdown 交付物。",
  "metadata": {
    "taskType": "analysis",
    "constraints": ["output-format:markdown"],
    "successCriteria": ["输出一份可审阅的 markdown rollout 方案"],
    "assumptions": ["time-range=current week rollout window"]
  },
  "waitingContext": []
}
```

`Destination -> workflow` 投影样例：

```json
{
  "goal": "分析发布风险并输出 rollout 建议",
  "plannerInput": {
    "subGoals": ["collect_risks", "draft_plan"],
    "taskType": "analysis",
    "auxiliaryTaskTypes": ["generation"]
  },
  "governance": {
    "constraints": ["output-format:markdown"]
  },
  "review": {
    "successCriteria": ["输出一份可审阅的 markdown rollout 方案"]
  },
  "clarify": {
    "missingInformation": []
  }
}
```

### 样例 3：当前主仓已落地的最小 destination 摘要

当前代码已经真实生成的，不是完整 `Destination`，而是 `MissionAutopilotSummary.destination` 最小视图：

```json
{
  "id": "mission_123",
  "goal": "Projection detail route",
  "request": "Project workflow into mission route",
  "constraints": ["Kind: chat", "Source app: web-aigc"],
  "successCriteria": ["Deliver the requested mission outcome"],
  "deliverables": ["Mission result package"],
  "missingInfo": []
}
```

这组联调样例刻意同时保留“目标态设计”与“当前主仓最小已落地形态”，用于避免把未来 `Destination` 领域模型与现有 `autopilotSummary.destination` 摘要视图混为一谈。

## 风险与边界

### 风险 1：把推断当成事实

需要通过来源标签和置信度约束避免系统误读用户目标。

### 风险 2：映射字段丢失

若 mission/workflow 侧没有对应强类型字段，必须通过 metadata 保留，不能直接丢弃。

### 风险 3：过早大重构

本 spec 重点是增加目标解释层，不是一次性重写所有 runtime。

## 开放问题

- `Destination` 是否需要成为数据库一级实体，还是先作为 mission/workflow 附属结构
- `taskType` 首批枚举是否需要继续细化到行业或场景层
- `successCriteria` 是否要区分业务成功和系统成功两个维度
- 哪些 `missingInformation` 可以由 RAG / 检索自动补全，哪些必须进入用户接管

## 审计补注（2026-04-24）

本轮基于当前真实代码与测试，对 Destination lane 的最小落地范围做一次保守审计：

- 当前已经真实存在的，不是完整 `Destination` 领域对象，而是一层 `MissionAutopilotSummary.destination` 最小投影。
- 这层最小投影由 `shared/mission/autopilot.ts` 中的 `buildMissionAutopilotSummary()` 统一生成，当前稳定字段为：
  - `id`
  - `goal`
  - `request`
  - `constraints`
  - `successCriteria`
  - `deliverables`
  - `missingInfo`
- 当前字段来源也已经相对稳定：
  - `goal` 来自 `mission.title`
  - `request` 优先来自 `mission.sourceText`，缺失时退回 `mission.summary` 或 `mission.title`
  - `constraints` 当前由 mission 已有事实拼接而成，包括 `mission.kind`、`mission.projection.sourceApp`、`mission.securitySummary.level`
  - `successCriteria` 当前按 mission summary、artifacts 是否存在、mission 是否完成等运行时事实生成最小成功口径
  - `deliverables` 当前主要来自 `mission.artifacts[*].name`，缺失时退回 `"Mission result package"`
  - `missingInfo` 当前来自等待态 `mission.waitingFor` 与阻塞态 `mission.blocker.reason`

这意味着当前最接近已落地的设计项，是“`Destination -> mission` 投影层”，但它的真实含义应限定为：

- 系统已经能把 mission 现有事实整理成一份稳定的 destination 摘要视图；
- 这份视图已经可通过服务端 projection 暴露，并被客户端 store 与任务详情面板消费；
- 它还不能等同于“系统已经先解析出独立 Destination，再回写 mission/workflow”。

当前可确认的链路如下：

- 共享层：
  - `shared/mission/autopilot.ts` 定义并生成 `MissionAutopilotSummary.destination`
  - `shared/__tests__/mission-autopilot.test.ts` 已验证 active mission 场景下 `destination.id / goal / deliverables`
- 服务端：
  - `server/tasks/mission-projection.ts` 在 `/api/tasks/:id/projection` 中直接返回 `autopilotSummary: buildMissionAutopilotSummary(...)`
  - `server/tests/mission-routes.test.ts` 已验证 `projection.autopilotSummary.destination` 与其它 autopilot 字段一起返回
- 客户端：
  - `client/src/lib/tasks-store.ts` 已 normalize `destination.goal / request / constraints / successCriteria / deliverables / missingInfo`
  - `client/src/lib/tasks-store.autopilot.test.ts` 已覆盖 waiting mission、projection alias、planet/detail fallback 的 destination 兼容行为
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 destination 在任务详情 cockpit 中的直接展示

因此，本轮可以保守认定：

- “定义 `Destination` 领域模型”已在本 spec 内形成明确设计闭环：`Destination` 顶层结构、`normalizedGoal / subGoals / constraints / successCriteria / missingInformation / taskType / confidence / assumptions / evidence / mappedMissionContext / mappedWorkflowInput / version` 都已有明确字段设计；
- “`Destination -> mission` 投影层”已有最小事实基础与测试闭环；
- “定义 Destination 领域模型”“定义输入归档层”“设计 `Destination -> workflow` 投影层”“设计解析证据与审计结构”“设计 `Destination` 增量更新机制”“设计失败与降级策略”在本 spec 内已经形成自洽设计稿，并且至少有 `MissionAutopilotSummary.destination` 这条真实最小投影链作为字段与消费锚点；
- “输出开发联调样例”现在已有面向未来 `Destination` 目标态与面向当前主仓最小摘要态的双轨样例，可供设计、服务端 projection 与前端消费联调时对齐口径；
- 但“完整 Destination 模型”“输入归档层”“Destination -> workflow 投影层”“解析证据与审计结构”“增量更新机制”“失败与降级策略”仍缺少直接代码与测试证据，不应外推为已落地。

同时需要保持边界：

- 这里的“领域模型已完成”仅表示 design 层已经收口，并不表示主仓已经存在独立 `Destination` 实体、持久化结构或解析器实现。
- 当前 shared mission autopilot summary、mission projection、tasks-store 与 `TaskAutopilotPanel` 能证明的，是 `Destination` 最小摘要子集已经形成共享契约与消费闭环；它们还不足以证明完整 `Destination` 全字段对象已经投入运行。

## 追加审计补注（2026-04-24，destination confidence / missing-info detail 复核）

本轮继续沿着 destination confidence、missing-info detail 与 projection 链路做复核后，可以把当前设计闭环与实现缺口说得更具体：

- 当前 shared 实现已经把两类 destination 扩展字段纳入 `MissionAutopilotSummary.destination`：
  - `confidence`
  - `missingInfoDetails`
- 但它们的来源仍然是 mission 运行时事实派生，而不是独立 `Destination` 解析器：
  - `confidence` 来自 mission summary、artifacts、events、waiting/blocker、decision prompt、sourceText 等现有 mission 事实
  - `missingInfoDetails` 来自 waiting / blocked 场景下的 mission 状态归纳
- 因此，这两组字段更接近：
  - “mission-derived destination explanation”
  - 而不是“input-archive + parser + versioned Destination entity” 的直接产物

这对本 spec 的影响是：

- 它进一步证明“最小 destination 投影”这条设计路线成立：
  - shared builder 生成 destination 摘要
  - server projection 透传 destination 摘要
  - panel 可以直接消费 destination 摘要中的结构化补充字段
- 但它也进一步限制了可以保守勾选的范围：
  - 不能把这组运行时派生字段外推为 `输入归档层` 已存在
  - 不能把它外推为 `目标与子目标解析策略` 已实现
  - 不能把它外推为 `缺失信息识别与澄清建议生成` 已以 Destination parser 形态落地
  - 也不能把它外推为“输入归档最小兼容”已经建立，因为当前仍缺少统一的 source archive / attachment archive / submission lineage 入口

额外需要保守说明的一点是：

- 从代码上可以推断 `/projection` 会保留 `destination.confidence` 与 `destination.missingInfoDetails`，因为 `server/tasks/mission-projection.ts` 对 autopilot summary 的对齐只改写 links / bindings / evidence correlation；
- 但当前并没有专门的 server route 测试直接断言这两个 destination 字段；
- 因而这里更准确的表述应是“projection preservation is supported by source inspection and shared tests”，而不是“服务器投影测试已完整覆盖这两个字段”。

### 补充审计说明（2026-04-24，structured missing-info detail does not imply parser completion）

本轮新增的 destination 缺口字段闭环，主要发生在 destination card 消费面，而不是 parser 面：

- 现在已经有更强的事实证据证明：
  - `destination.missingInfoDetails[*].item / impact / blocking` 可由 shared builder 产出；
  - 可由 server `/projection` 直接透传；
  - 可在 client store 中保持结构并回填 `missingInfo`；
  - 可由 panel 在缺少扁平 fallback 字段时直接展示。
- 但这些事实仍然只能支持“mission-derived destination summary 已拥有结构化缺口字段”这一结论。

因此需要继续保持设计边界：

- 这不等于已经实现独立 `Destination` parser；
- 也不等于已经实现 `missingInformation` 的上游识别策略、澄清问题生成、输入归档或版本化更新；
- 它更适合作为未来 parser/ingestion 落地时可复用的最小消费字段锚点，而不是 parser 已完工的证明。

## 复审补注（2026-04-25，server route 直证已补齐，但 parser 边界不变）

本轮沿着 shared -> server -> client -> panel 四段链路做复审后，需要把一条旧审计判断更新得更准确：

- 先前“`/projection` 对 `destination.confidence / destination.missingInfoDetails` 只有源码保留、没有 server route 直测”的表述，已经被当前测试状态追上了。
- 现在可以直接从 `server/tests/mission-routes.test.ts` 确认：
  - waiting / route-selection 场景下，`projection.autopilotSummary.destination.confidence` 有直接断言；
  - 同一场景下，`projection.autopilotSummary.destination.missingInfoDetails` 也有直接断言；
  - running destination summary 场景下，`constraints / successCriteria / deliverables` 仍有直接断言。

这意味着当前真实证据链已经提升为：

- shared builder 产出最小 destination 摘要及结构化扩展字段；
- server `/projection` 直返这些字段，且已有 route 测试覆盖；
- client store 归一化这些字段并把结构化缺口回填为面板可消费形态；
- panel 直显 `confidence / impact / missingInfoDetails`，且已有专门展示测试。

但这一增强后的证据链仍然只支撑如下结论：

- 当前主仓已经存在一个带有 `confidence / missingInfoDetails` 的 mission-derived destination summary；
- 它已经形成 shared / server / client / panel 的稳定消费闭环；
- 它可以作为未来 `Destination` parser / ingestion 落地时的字段锚点与兼容底座。

它仍然不能外推为以下能力已完成：

- 独立 `Destination` parser
- 输入归档层与附件归档层
- 基于 parser 的目标/子目标解析
- 基于 parser 的成功标准识别
- 基于 parser 的缺失信息识别与澄清问题生成
- 版本化增量更新与重新解析机制

原因仍然是：

- 这些字段的上游来源依旧是 mission runtime facts，而不是独立解析入口；
- `buildConstraints()` / `buildSuccessCriteria()` / `buildMissingInfo()` / `buildDestinationConfidence()` / `buildMissingInfoDetails()` 仍然是在 mission 事实之上做最小安全归纳；
- 当前看到的是“mission-derived destination summary 已经稳定”，而不是“Destination ingestion + parser + versioned entity 已经存在”。

## 复核补注（2026-04-25，设计完成项与实现完成项分层）

本轮进一步把 `Destination` lane 中的“设计完成”与“实现完成”边界收紧如下：

- 可以按设计完成看待、并允许在 tasks 中保守勾选的条目：
  - `定义输入归档层`
  - `设计 Destination 增量更新机制`
- 原因不是这些能力已经代码落地，而是：
  - `design.md` 已分别给出 `sourceInput` 结构、四类输入来源、archive 规则、`version / updatedAt / changeSummary` 字段、以及逐字段 merge 规则；
  - `requirements.md` 已把 archive、增量更新、来源保留、版本化修订明确写成目标要求；
  - 当前 shared / server / client / panel 的 mission-derived destination summary 已经提供一个稳定消费锚点，使这些设计不是脱离主仓事实的空定义。

同时仍需保留以下实现边界：

- 当前代码和测试能证明的是：
  - `sourceText -> destination.request`
  - `mission.title -> destination.goal`
  - `confidence / missingInfoDetails / constraints / successCriteria / deliverables` 的最小摘要与展示闭环
- 当前代码和测试仍不能证明的是：
  - 统一 input archive 已存在；
  - clarification 合并后的 `Destination.version` / `updatedAt` / `changeSummary` 已存在；
  - 独立 parser 会基于 archive 做版本化重解析。

因此，本轮收口后的准确表述应是：

- “输入归档层”和“增量更新机制”已经在 spec 内完成设计定义；
- 但它们仍然是后续实现 backlog，不应被写成 shared/server/client 已经运行中的 parser 能力。

## 复核补注（2026-04-26，设计闭环与实现边界再次对齐）

本轮继续只沿着当前仓库里可直接验证的 destination summary 主链复核后，design 层需要再强调一次“设计闭环”与“实现闭环”的分层：

- 当前可以被直接代码与直接测试共同锚定的，是 `MissionAutopilotSummary.destination` 的最小消费模型，而不是完整 `Destination` parser 实体。
- 这意味着本设计稿中以下对象已经形成稳定的目标态定义，但仍未被现有代码完整承接：
  - `GoalSummary`
    - 当前代码只暴露 `destination.goal`，还没有 `normalizedGoal.summary / expectedDeliverables / businessIntent` 的共享合同。
  - `SubGoal`
    - 当前代码与测试都没有 `subGoals`、`dependsOn`、`priority`、`source`、`confidence` 的直证链。
  - `DestinationConstraint`
    - 当前代码只提供 `string[]` 级别约束摘要，没有 `dimension / status / evidenceRefs / appliesTo` 这类结构化字段。
  - `SuccessCriterion`
    - 当前代码只提供最小字符串成功口径，没有 `status / appliesTo / evidenceRefs / verificationHint`。
  - `MissingInformationItem`
    - 当前代码只提供 `missingInfo` 与 `missingInfoDetails` 的阻塞型摘要，没有 `category / status / suggestedOwner / relatedSubGoalIds`。
  - `ClarificationPrompt`
    - 当前代码与测试尚未暴露可复用澄清问题合同。
  - `DestinationTaskTypeDecision`
    - 当前代码与测试已经暴露最小 `taskType / auxiliaryTaskTypes / mixed / unknown`；
    - 但仍未暴露 `reasons / source / confidence` 这一层 richer 分类解释合同。

基于现有直证链，本设计稿当前更准确的落点应是：

- 已有现实锚点支撑的设计段落
  - `Destination -> mission` 最小投影方向
  - `Destination -> workflow` 兼容映射方向
  - `confidence / missingInfoDetails` 这类解释字段的最小消费锚点
  - “当前最小 summary 链路测试”这一层测试规划
- 仍属于目标态设计、不能写成已实现的段落
  - 目标 / 子目标解析算法
  - 结构化约束抽取器
  - 成功标准分层识别器
  - 非阻塞缺口识别与澄清生成
  - 任务类型分类器
  - archive 驱动的版本化重解析

这也意味着本 design 的测试计划仍应按两层理解：

- 当前已存在测试
  - 只证明 mission-derived destination summary 在 shared -> server -> client -> panel 闭环中可被构造、透传、归一化与展示。
- 后续目标态测试
  - 仍需要单独覆盖 `sourceInput -> Destination`、`Destination -> mission/workflow`、clarification merge、taskType 分类、subGoals 拆分与版本化更新。
