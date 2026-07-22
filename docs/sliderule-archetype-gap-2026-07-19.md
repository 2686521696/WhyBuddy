# SlideRule 应用形态差距分析与实施计划(2026-07-19,含三轮审查修正)

> **修订说明**:初版把"现有能力"判断偏低(只读数据层 `app-runtime-schema.ts`,
> 没读渲染层 `AppRuntimeScreen.tsx`),并给出"4~5 种应用类型枚举"的错误方案。
> 第二轮审查进一步指出:方案缺"区块实例 + 数据绑定 + 动作协议"这一层——
> 只补首页与布局,结果只会从"同一个固定工作台"进化成"不同排列的统计卡/图表/榜单/表格",
> 仍到不了素材里的任务工作区、排期工具、专业编辑器。本版据两轮审查重写:
> **核心诊断(硬编码首页)保留**,现有能力据实更正,破法补齐"区块目录 + 动作协议"层,
> 并明确阶段边界。第三轮审查继续收紧实施定义:**行为与权限分离、数据绑定强类型化、
> Block Catalog 与前端 Renderer Registry 分工、落地页按角色诚实降级**,并冻结首批区块范围,
> 避免新协议再次变成无边界铺摊子。文末增加可直接执行的分步计划,每一步都写明
> 做什么、改哪里、怎么兼容旧应用、怎么验收。

## 一句话结论(三轮修正后)

SlideRule **已能做页面级形态多样**(3 套外壳 + 6 种页面范式),但**每个应用都被额外强制生成同一套"工作台"首页**;更深一层的缺口是**没有"区块实例 + 强类型数据绑定 + 行为动作"的可执行协议**——设计菜谱能在 prompt 里建议"好首页长什么样",但除 `appIdentity.nav` 和 `page.kind` 外,首页选择、区块组合、专业组件与交互动作**没有规范字段承接**,因此 Gate 无法校验、渲染器不知道渲染什么。千人一面最直接的元凶是**写死的首页**;要长成素材里的完整应用,还须补上区块、绑定与动作协议层。

## 对比:当前 vs 目标

- 当前效果:`docs/workbench.png`(应用中心,15+ 应用卡片,首页高度雷同)
- 目标稿:`docs/assets/Illustration.png`(多形态:桌面大盘 / 移动 App / 代码助手 / CRM / 流程画布)

## 准确的诊断(经代码核对成立)

### 1. 硬编码首页 = 最大元凶(核心结论,不变)

`client/src/pages/sliderule/live-runtime/app-runtime-schema.ts` 的 `deriveAppRuntimeSchema()` 固定生成首页四卡:前两个实体行数、进行中审批、累计流程实例;两图:各实体数据量(bar)、审批状态分布(donut)。

`AppRuntimeScreen.tsx` 的 `homeContent`(约 856 行)在此之上还固定追加"快速入口"和"审批动态"timeline。

**后果**:哪怕用户要的是学习计划、内容创作、舆情监控,首页也带着审批味道。**这是当前最该先拆的地方。**

### 2. Identity 能力偏浅(成立)

当前只能生成 `productName / theme / icon / nav(side|top)`。主题注册表(`identity-themes.ts`)虽有八套色,但主要控主色/背景/三种图表色,**没有字体、密度、阴影、圆角、深浅模式**的完整配方。"只换皮不够"成立。

### 3. 设计菜谱只有一部分能落库(关键诊断)

项目已把 37 张视觉稿蒸馏成设计菜谱(`v5_design_reference.py` + `data/design_recipes.json`),向生成 prompt 注入 `navStyle / homeArchetype / widgets / accentHint / namingStyle`。

**准确表述**:`appIdentity.nav` 和 `page.kind` 已经能落库,但设计菜谱中的**首页选择、区块组合、布局结构和部分专业组件建议,没有完整的规范字段承接**。即 Prompt 已告诉模型"好首页长什么样",Schema 却只接得住其中一部分——问题不在 LLM 没有形态意识,在承接形态的字段不全。

## 初版对现有能力的低估(据代码更正)

以下是初版说错、经 `AppRuntimeScreen.tsx` 核对后更正的判断:

| 初版说法 | 更正(代码事实) |
|---|---|
| 当前只有一种 Shell / 只渲染一种外壳 | **错**。已有三套:`desktopShell`(左侧栏)、`topShell`(`nav==="top"` 顶部导航)、`phoneShell`(手机 App 壳 + 底部 TabBar);平板是桌面的紧凑主从变体。 |
| 只覆盖后台管理系统 | **重了**。已有 6 种页面范式:`workbench` / `kanban`(真看板) / `calendar`(真月历) / `dashboard`(图表升主角) / `wizard`(Steps+页) / `monitor`(stats+主图两栏+侧边榜流)。 |
| 每个页面都是表格+表单+抽屉 | **部分错**。workbench/dashboard/wizard 仍带表格;但 kanban/calendar 已是真正不同的视图。深度不一(wizard 只是顶部加 Steps,下面仍是通用数据页)。 |
| 当前 LLM 没在选形态 | **错**。Prompt 已要求模型选 `appIdentity.nav` 和每页 `kind`,菜谱还注入 `homeArchetype`。 |
| mobile 应作为应用 archetype | **不合适**。`device`(desktop/tablet/phone)是独立于 nav / page kind 的第三根轴——移动端是设备/渠道,不是业务形态。 |
| 当前只能生成 management / code assistant | **错**。`CodeProjectionView` 只是 schema 的只读代码投影,不是生成的 IDE 应用;management 也不能与之归为一类。 |

**正确表述**:当前已能动态选择**页面级**形态,但每个应用仍被额外生成同一套**固定工作台首页**,且部分范式只是浅层变体。

## 方案哲学纠错:不要退化成"固定应用类型"

初版方案(法律助手→management、暑假计划→mobile、流程工具→canvas)是**固定类型分类**,违背北极星"V5 不是固定阶段流水线"。一个动态应用可能同时含:首页 monitor + 任务页 kanban + 日程页 calendar + 配置页 wizard + 数据页 workbench。

- `analytics_monitor` / `workflow_inbox` / `management_workspace` 更适合作**页面构图方式**,不应是整个应用的唯一类型。
- `mobile`(设备)、`canvas`(交互能力)、`code_assistant`(产品工作区)**不在同一分类维度**,不能塞进一个 `archetype` 枚举。

否则只是把"千系统一面"变成"五张固定面孔"——LLM 从五套模板里选一套,仍不是动态生成。

## 缺失的一层:区块实例 + 数据绑定 + 动作(第二、三轮审查核心)

初版破法有"体验计划"和"布局组合",但缺"有什么区块"和"能做什么"两环。问题出在 `composition` 只写名字:

```json
"composition": { "primary": ["risk_trend"] }
```

`risk_trend` 在哪定义?若只是名字,**Gate 无法校验、渲染器不知渲染什么、修复器不知坏在哪**——违反项目"合法域单一真相源 + 二元闸"纪律。必须把"区块实例(有什么)"与"布局(摆哪)"拆成两件事:

```json
{
  "id": "risk_overview",
  "kind": "monitor",
  "blocks": [
    {
      "id": "risk_metrics",
      "type": "MetricGrid",
      "binding": {
        "entityRef": "risk_event",
        "measures": [
          { "id": "total", "aggregate": "count" },
          {
            "id": "high_risk",
            "aggregate": "count",
            "filter": {
              "fieldRef": "risk_event.level",
              "operator": "eq",
              "value": "high"
            }
          }
        ]
      },
      "eventBindings": { "onMetricClick": "filter_risk_list_by_metric" }
    },
    {
      "id": "risk_trend",
      "type": "MultiSeriesTrend",
      "binding": {
        "entityRef": "risk_event",
        "dimension": {
          "fieldRef": "risk_event.createdAt",
          "timeGrain": "day"
        },
        "seriesBy": "risk_event.sentiment",
        "measure": { "aggregate": "count" }
      },
      "eventBindings": { "onPointClick": "filter_risk_list_by_point" }
    },
    {
      "id": "risk_list",
      "type": "DataTable",
      "binding": { "entityRef": "risk_event" },
      "eventBindings": { "onRowClick": "open_risk_detail" }
    }
  ],
  "actions": [
    {
      "id": "filter_risk_list_by_metric",
      "type": "changeFilter",
      "permissionRef": "risk:view",
      "targetBlockRef": "risk_list",
      "payload": { "metricId": "$event.metricId" }
    },
    {
      "id": "open_risk_detail",
      "type": "openDetail",
      "permissionRef": "risk:view",
      "target": {
        "entityRef": "risk_event",
        "recordRef": "$event.recordId"
      }
    },
    {
      "id": "filter_risk_list_by_point",
      "type": "changeFilter",
      "permissionRef": "risk:view",
      "targetBlockRef": "risk_list",
      "payload": { "date": "$event.dimension", "sentiment": "$event.series" }
    }
  ],
  "layout": {
    "summary": ["risk_metrics"],
    "primary": ["risk_trend"],
    "secondary": ["risk_list"]
  }
}
```

这里必须把三个容易混淆的概念彻底拆开:

- `actionPermissions`:现有页面权限声明(如 `risk:create` / `risk:view`),决定**谁能做**;
- `actions`:有 id、type、target、payload、`permissionRef` 的行为实例,决定**具体做什么**;
- `eventBindings`:区块的哪个交互触发哪个 action id,决定**什么时候做**。

当前 `AppPageSchema.actions` 实际由 `page.actionPermissions` 派生,仍是权限字符串,不能直接改装成
`openDetail` / `drillDown` 这类行为名称。新协议要新增独立字段并保留现有 RBAC 语义。

数据绑定也不能停在 `metrics:["risk.total"]` 这种字符串列表。至少要能表达
`entityRef / fieldRef / aggregate / filter / timeGrain / seriesBy`,否则 Gate 只能验证名字存在,
不能验证图表、指标和筛选是否真的可计算。

**完整关系链(本版据此定型)**:

```text
用户指令
  → 五系统业务模型
  → 体验计划(首页、Shell、页面)
  → 区块实例(有什么)         ← 初版缺
  → 布局组合(摆在哪里)
  → 数据/权限/事件/动作(能做什么、谁能做、何时触发)  ← 初版缺
  → 渲染器
```

素材里的差距大量来自**交互而非静态布局**:没有动作协议,CRM 快捷入口、图表钻取、预警处理、日历排期都是假按钮。

## 破法(重排:先拆首页,再补区块+动作,再动态构图,不建固定类型)

### 第一刀:让模型指定落地页(`landingPageRef`)

在五系统模型 `appbundle` 增加 `landingPageRef`(不叫 `homePageRef`——语义更清楚,以后可能有角色化落地页):

```json
{ "landingPageRef": "insight_overview" }
```

运行时:有 → 直接把该页作为落地页(复用现有 monitor/dashboard/ranking/feed/stats/charts);没有 → 保持当前硬编码工作台作老模型降级。

**Gate 至少检查**:引用页面必须存在;修复失败回退旧工作台;不在菜单中重复生成一个额外"首页";被引用页删除/改名时触发失效修复。当前五系统模型没有 `defaultRoleRef`,运行时只是取 `schema.roles[0]` 作为初始角色,所以不能把"默认角色可访问"写成已有业务规则。第一阶段二选一:

1. 单一 `landingPageRef` 必须对所有角色可见;或
2. 当前角色无权访问时,运行时诚实降级到该角色第一个可见页面。

以后有明确需求再增加 `roleLandingPages:{roleRef:pageRef}`,不要把角色数组顺序冒充默认角色语义。实施时还要同步迁移 `activePageId="home"`、`isHome`、三个 Shell 的 `homeContent` 分支和 `menu-home`,不只是改 `deriveAppRuntimeSchema()`。

### 第二刀:Experience Block Catalog + 动作协议(同一刀两面)

**命名注意**:不要叫 `Capability Catalog`——`capability` 在 SlideRule 已专指推演能力(`(capability, role)` 对、`V5CapabilityId`),复用会混淆。叫 **`Experience Block Catalog`(体验区块目录)**。

**不另建 Zod 真相源**。项目已有 JSON 合法域账本 + Python 加载器 + Gate + Repair + Prompt + 前端 parity 机制。Block Catalog 比当前平面枚举复杂,可以新建 `services/data/experience_block_catalog.json`,再由 `schema_legal.py` 加载;它仍是唯一权威来源,不要在 TS 再造一份和 Python Gate 竞争的合法域。每种区块至少描述:

```json
{
  "type": "RiskAlertStream",
  "propsSchema": {},
  "bindingSchema": {},
  "allowedSlots": ["activity", "secondary"],
  "allowedEvents": ["onItemClick", "onAcknowledge"],
  "allowedActionTypes": ["openDetail", "acknowledge"],
  "permissionSlots": [],
  "workflowSlots": [],
  "repairHints": {},
  "rendererKey": "risk-alert-stream"
}
```

Catalog 只能声明 `rendererKey`,不能生成 React 实现。前端仍需独立的 Renderer Registry,
并由 parity 测试保证 Catalog 中每个区块类型都有实现。准确说法是"派生渲染契约并校验 Registry 覆盖",
不是"从 Catalog 自动派生渲染器"。

**动作协议**与区块目录一起设计,但行为实例与权限分开。第一批不铺大,先支持:`navigate` / `openDetail` / `createRecord` / `updateRecord` / `startWorkflow` / `runAIGC` / `changeFilter` / `drillDown` / `reschedule`。其中 `runAIGC` 必须复用当前 `aiActions` 的"先建议、用户确认后写回"语义,`startWorkflow` 必须复用 `pageBindings/workflowLinked`,不能平行再造执行链。`reschedule` 还必须声明目标实体、日期字段、冲突策略和失败回滚,不能只靠一个动作名。这样 CRM 快捷入口、图表钻取、预警处理、日历排期才不是假按钮。

**首批区块范围冻结为 7 个**,优先加厚现有能力:

1. `MetricGrid`:承接现有 stats;
2. `TrendChart`:承接现有 charts,补多序列与时间粒度;
3. `RankedList`:承接现有 rankings;
4. `ActivityFeed`:承接现有 feeds;
5. `DataTable`:承接现有表格、详情和 CRUD;
6. `QuickActionPanel`:解决 CRM/任务工作台的快捷业务动作;
7. `FilterBar`:解决时间范围、枚举筛选与联动刷新。

风险预警先由 `ActivityFeed + level + actions` 组合,不急着新增 `RiskAlertStream`;目标环、词云、渠道矩阵等进入后续增量,避免 Catalog 一期变成新的大工程。

### 第三刀:页面级布局组合(`layout`,只管摆放)

`layout` 只负责:区块放哪个槽位、区块顺序、跨列与宽度、桌面/平板/手机的响应式排列。**它不定义区块本身**(区块由第二刀的 Block Catalog 实例声明)。模型仍按用户指令动态选材;`layout` 不判"这是什么系统"。

### 第四刀:应用 Shell 与设备分开(两根独立轴)

```json
{
  "experienceShell": {
    "mode": "navigation",
    "navigation": "side"
  },
  "preferredDevice": "desktop"
}
```

- `experienceShell.mode` 先只限 `navigation | focus`;`mode=navigation` 时再用 `navigation=side|top` 表达现有两种导航。**`canvas` 暂不进枚举**——没有画布协议时它只是空壳。
- **迁移**:新模型只生成 `experienceShell`;老模型把 `appIdentity.nav` 确定性编译为新 Shell;迁移完成后 `appIdentity` 只保留产品名、图标和设计配方。不能让两字段同时决定导航(双真相源)。
- 用 `preferredDevice` + `responsiveLayout` 而非 `supportedDevices`:当前运行时本就能手动切 phone 预览,"支持手机"不等于"手机设计得好"(现 `phoneShell` 主要是把同一页压成卡片)。

`responsiveLayout` 属于每个页面的 `layout` 响应式覆盖,不应和应用级 `preferredDevice` 混成同一字段;前者决定怎么排,后者只决定预览/首次打开默认看哪个视口。

### 落地顺序

1. `landingPageRef`:拆掉强制工作台
2. `Experience Block Catalog` + 强类型 Binding + 动作协议:让"有什么"和"能做什么"进合法域、过 Gate
3. 页面级 `layout`:模型动态选材构图
4. `experienceShell`(`mode` + `navigation`)+ `appIdentity.nav` 迁移
5. `preferredDevice` + `responsiveLayout`:复用现有手机壳
6. `designRecipe`(主题配方,见下节)
7. canvas / IDE:等相应业务协议成熟再做

**不要先建"4~5 种应用类型",也不要先换颜色。**

## 主题配方不能永久 backlog

先做布局与区块、不先换颜色是对的;但若目标是素材完成度,`designRecipe` 不能长期缺席。素材之间除布局外,还有明显的:页面密度、卡片层次、字体尺度、圆角阴影、图表配色、暗色工作区、侧栏与内容区对比。所以它排在动作协议与响应式之后、专业画布之前——**不是现在做,但也不能宣称前三刀做完就达到素材效果**。

## 能达到素材什么程度(阶段边界)

以下以 `docs/assets/Illustration.png` 里可见的 9 种应用卡片为基准，逐一评估 Step 0～9 + 第二阶段 A/B 的覆盖程度。**"Step 0～9"列指打开应用后的体验；"画廊缩略图"列指应用中心卡片的展示效果**——两者是独立的。

| Illustration 卡片 | Step 0～9 打开后 | 画廊缩略图（第二阶段 A+B）| 仍排除 |
|---|---|---|---|
| 经营数据总览（深色主题、多 KPI、折线+饼+地图）| Step 3~6 区块 + Step 9 深色配方可明显接近 | 需真实截图 + 预览数据才能呈现深色卡片效果 | 地图组件、目标环 |
| 待办事项（移动 App，状态栏 + 底部 TabBar）| phoneShell 可近，底部 TabBar 已有 | 截图可显示移动形态 | 原生手势、推送通知、真移动信息架构 |
| 用户增长分析（浅色、折线趋势、横向分布图）| Step 3~6 区块组合可覆盖 | 预览数据填满后效果明显 | 同比环比复杂计算 |
| 项目管理看板（看板列 + 进度条 + 头像分配）| 现有 `kanban` 范式 + Step 5 动作协议可完善 | 截图可显示看板列 | 甘特图、时间线视图 |
| AI 代码助手（代码编辑区 + 语法高亮 + 建议面板）| **通用 Schema 拼不出** | 排除，缩略图无法呈现 | 需专门编辑器协议 |
| 客户管理系统（CRM 表格 + 真实数据行 + 状态标签）| Step 3~5 DataTable + Actions 可覆盖 | 预览数据填满后最接近效果图 | 客户专属字段卡片、角色化落地页 |
| 销售分析报告（多色多系列折线 + 手机浮层）| Step 3~7 区块 + Layout 可覆盖主体 | 预览数据 + 截图后效果明显 | 手机浮层需 focus Shell + 响应式协同 |
| 消息中心（通知流 + 未读/置顶 tabs）| `ActivityFeed` + Step 5 动作协议可覆盖 | 截图可呈现列表结构 | 实时推送、消息聚合 |
| 流程设计器（画布节点 + 属性面板 + BPMN 连线）| **通用 Schema 拼不出** | 排除，缩略图无法呈现 | 需专门画布协议 |

**边界说明**：大盘/CRM/看板/消息/销售分析在 Step 0～9 + 第二阶段 A/B 后可明显接近 Illustration；代码助手和流程设计器属专业编辑器，需单独协议立项，不能靠通用 `page.blocks` 凑合。移动 App 形态可达到响应式可用，但和 Illustration 里的原生信息架构仍有差距。

### 应用中心 UX 自身的差距（与应用形态工作独立）

Illustration 里还有几处差距不属于"应用形态多样化"，而是**应用中心画廊本身的产品功能**，本文档不负责但需要明确划清边界：

| Illustration 有 | 当前状态 | 性质 |
|---|---|---|
| 顶栏全局搜索框"搜索应用、功能或解决方案…" | 无 | App Center UX，较独立，可单独立项 |
| "AI 推荐 8"tab | 无 | 需推荐引擎，新产品功能 |
| "我创造的 15 / 官方示例 5"tab 命名 | 当前叫"我的应用/官方示例库" | 简单重命名 |
| 列表/网格视图切换 | 仅网格 | 简单 UI 功能 |
| 侧边栏"数据源""知识库"入口 | 无 | 重大产品方向扩展，需单独规划 |
| 侧边栏最近使用带彩色图标 + 相对时间 | 纯文字列表 | UI 打磨，`identity.icon` + `identity.theme` 已有字段可消费 |

**这六项都不在本文档 Step 0～9 范围内**，但如果验收目标是"和 Illustration 看起来一样"，则需要在独立的 App Center UX 迭代里逐项处理。其中"数据源/知识库"涉及产品方向，需在确认产品战略后才能立项，不能在形态多样化完成前顺带实现。

## 发布门(修正:当前不成立,需先补)

`scripts/verify-sliderule-v5.sh` 当前**没有**运行 `app-runtime-schema.test.ts`,浏览器冒烟只测推演主路径,不检查生成应用的首页/Shell/页面范式。

> 正确要求:**每刀必须先把对应单测 + 生成应用浏览器验收加入 `verify:sliderule-v5`**,再做功能(符合北极星决策清单第 4 条)。

新增协议至少锁五类门:

1. Catalog 每个 `type` 都有前端 Renderer Registry 实现;
2. 每个 action type 都有执行器、参数 Schema 和权限校验;
3. 每个 `layout` 引用的 block id 都存在,且允许进入对应 slot;
4. 浏览器验收确认 `landingPageRef` 真成首屏、无关"审批动态"不再出现、同一应用可混用多种页面形态、未授权动作不可执行、坏引用能被 Gate 拒绝或 Repair 诚实降级;
5. **多样性验收门**：固定用大盘、CRM、舆情监控、内容日历等一组典型意图生成应用，浏览器验收不仅检查"页面打开了"，还断言各应用首屏的主区块组合（`page.kind` / `blocks` 类型 / Shell）确实不同。没有这条门，模型可能合法地连续选择同一种布局，Gate 仍会放行，整体完成标准第 2 条无法机械验证。

## 实施计划(按这个顺序做)

这部分是实际开发清单。原则是:**每一步都能单独提交、单独验证、出问题能单独撤回**。
不要一次把首页、区块、动作、布局、主题全部改完。

**当前进度(2026-07-19)**:

- 第 0 步已完成首批门禁补强:`app-runtime-schema` 与角色首屏降级测试已加入 `verify:sliderule-v5`;专门的生成应用浏览器断言随第一个真实页面截图验收补入。
- 第 1 步已落地:`landingPageRef` 已贯通生成契约、Gate、Repair、运行时、角色降级与 AppBundle 留痕;旧模型继续回退原工作台。
- 第 2 步已落地目录骨架:`experience_block_catalog.json` 现为区块单一真相源,首批登记 `MetricGrid / TrendChart / RankedList / ActivityFeed / DataTable`;Gate 拒绝目录外类型,Repair 只在唯一近邻时修复,否则剔除留痕;Prompt 与前端 Registry 同读该目录,对应前后端测试已进入 `verify:sliderule-v5`。此步没有改变旧页面渲染结果。
- 第 3 步及以后尚未开始,不提前声明完成。

### 开工前先定死三件事

1. **旧字段暂时不删**:现有 `stats/charts/rankings/feeds` 继续可用,运行时先把它们转换成新区块。等新格式稳定后再考虑移除,避免以前生成的应用打不开。
2. **落地页按当前角色降级**:当前角色看不了 `landingPageRef` 时,自动打开该角色第一个可见页面;如果一个都没有,再回退旧工作台。暂不增加角色专属首页配置。
3. **动作放在页面里统一定义**:区块只写“点击后触发哪个动作”,动作本身统一放在页面的 `actions` 中;权限继续引用现有 RBAC 权限,不重新发明一套权限。

### 第 0 步:先把测试入口补齐

**做什么**:

- 把 `app-runtime-schema.test.ts` 加入 `verify:sliderule-v5`;
- 增加一个生成应用的浏览器检查入口;
- 先记录当前旧首页、菜单、角色切换和三套外壳的正常行为。

**主要修改**:

- `scripts/verify-sliderule-v5.sh`
- `client/src/pages/sliderule/__tests__/app-runtime-schema.test.ts`
- `scripts/sliderule-browser-smoke.mjs` 或单独的生成应用冒烟脚本

**完成标准**:

- 不改功能时发布门保持通过;
- 后续首页、区块或权限改坏时,测试能够真正报错。

### 第 1 步:允许模型指定打开应用后的第一个页面

**做什么**:

- 在 `appbundle` 增加 `landingPageRef`;
- 模型生成时选择一个已有页面作为落地页;
- Gate 检查引用页面存在;
- Repair 对拼错的页面 id 做近邻修复,修不了就清掉;
- 运行时打开应用时进入该页面,不再额外插入统一工作台;
- 当前角色无权访问时,降级到第一个可见页面。

**主要修改**:

- `five-system-model.ts`
- `v5_llm_generate.py`
- `v5_model_gate.py`
- `v5_model_repair.py`
- `app-runtime-schema.ts`
- `AppRuntimeScreen.tsx`
- `rbac-preview.ts`

**兼容旧应用**:

- 没有 `landingPageRef` 的旧模型继续显示原工作台;
- 不删除 `AppHomeSchema`,先把它保留为兼容回退。

**完成标准**:

- 舆情应用可以打开就是监控页;
- 日程应用可以打开就是日历页;
- 学习计划不再强行出现“审批动态”;
- 手机、顶部导航、侧边导航打开的是同一个正确落地页;
- 坏引用被 Gate 拒绝或 Repair 清除;
- 旧模型显示效果不变。

> **第一个效果检查点**:做到这里先重新生成一批应用,用真实浏览器打开各应用确认首屏确实不同。注意：应用中心卡片的缩略图（`MiniAppThumb`）是固定结构渲染——深色侧栏 + 2 张实体指标卡 + 灰色骨架线，只读取 `pageNames` 和 `entityNames`，不读取 `landingPageRef`、`page.kind`、`blocks`、`layout`、主题和设备，所有指标值硬编码为 `"0"`，`identity.theme` 提取后未被消费。因此"打开应用后：首屏已经不一样；应用中心里：十二张卡仍基本雷同"是预期现象，不是 `landingPageRef` 的 bug。要让应用中心缩略图真正不同，需要第二阶段的真实缩略图流水线（见文末"第二阶段待补项"）。如果首屏雷同问题已经下降，继续进入第 2 步；如果首屏仍然统一，先查模型选页逻辑，不要急着继续扩组件。

### 第 2 步:建立体验区块目录的空架子

**做什么**:

- 新建唯一的区块目录 JSON;
- 定义区块名称、可用数据、可放位置、可触发事件和渲染器键;
- Python 负责读取并给 Gate、Repair、Prompt 使用;
- 前端建立区块渲染表;
- 测试保证目录里每个区块在前端都有实现。

**主要修改/新增**:

- `services/data/experience_block_catalog.json`
- `schema_legal.py`
- `v5_model_gate.py`
- `v5_model_repair.py`
- `v5_llm_generate.py`
- `client/src/pages/sliderule/live-runtime/block-registry.tsx`
- Catalog 与前端渲染表一致性测试

**兼容旧应用**:

- 本步只搭骨架,还不改变现有页面渲染结果。

**完成标准**:

- 在目录增加一个不存在的区块时测试会报错;
- 模型不能生成目录外的区块;
- 运行时遇到未知区块时显示明确的不支持提示,不能白屏或伪装成功。

> **当前骨架状态说明（已实现）**:`block-registry.tsx` 中五个 renderer 全部指向 `ExistingContentAdapter`——有 `children` 时透传现有内容，无 `children` 时显示"区块已登记，内容将在下一阶段接入"占位块。`schema_legal.py` 的 Prompt 说明明确写着"Do not emit page.blocks yet"（新生成不产 `blocks` 字段；精修已有 `blocks` 的模型时强制执行目录合法域）。视觉结果零变化是预期——第 3 步才开始真正接入。

### 第 3 步:先把现有五种内容搬进区块协议

**做什么**:

- 把现有 stats、charts、rankings、feeds、table 分别转换为 `MetricGrid`、`TrendChart`、`RankedList`、`ActivityFeed`、`DataTable`;
- 新模型可以直接生成 `blocks`;
- 旧模型仍由转换器生成完全相同的区块;
- 暂不增加新视觉能力,先证明新旧两条路结果一致。

**主要修改**:

- `five-system-model.ts`
- `app-runtime-schema.ts`
- `AppRuntimeScreen.tsx`
- `block-registry.tsx`
- 五种区块的 Gate、Repair、Prompt 和单测

**完成标准**:

- 同一个旧模型迁移前后页面内容一致;
- 新模型能直接生成五种区块;
- 空数据继续显示诚实占位,不编造数字;
- 现有 kanban、calendar、wizard、monitor 不退化。

### 第 4 步:补强数据绑定

**做什么**:

- 让区块能明确声明数据表、字段、统计方式、筛选条件、时间粒度和分组字段;
- 第一批只支持 `count/sum/avg`、等于筛选、时间范围和按枚举分组;
- 暂不支持任意公式和任意 ECharts 配置。

**主要修改**:

- Block Catalog 中的 `bindingSchema`
- `five-system-model.ts` 的 Binding 类型
- Gate 的字段/类型检查
- Repair 的近邻字段修复
- 图表和指标计算代码

**完成标准**:

- 能生成按天统计、多序列趋势、金额合计和条件计数;
- 数字字段、日期字段、枚举字段绑错时 Gate 会报明白;
- 修不了的数据绑定被丢弃并留下记录,不显示假图表。

> **数据绑定正确性 ≠ 有数据**：本步让运行时知道"应该查哪张表、哪个字段、用什么聚合"，但如果运行时数据为空，指标仍显示 `0`，图表仍显示"暂无数据"，表格仍为空。要在应用中心缩略图和初次打开时呈现效果图那样的数据密度，需要第二阶段的**预览数据协议**（见文末"第二阶段待补项"）。本步不引入任何示例数据，坚持"不编假数据"原则。

### 第 5 步:把权限、动作、点击触发分开

**做什么**:

- 保留现有 `actionPermissions` 管权限;
- 页面新增动作实例;
- 区块新增点击、选择、提交等触发关系;
- 第一批实现 `navigate/openDetail/createRecord/updateRecord/changeFilter/drillDown`;
- `startWorkflow/runAIGC` 接回现有工作流和 AI 建议链路,不重写;
- `reschedule` 等日历写操作后置到本步稳定之后。

**主要修改**:

- `five-system-model.ts`
- `app-runtime-schema.ts`
- `AppRuntimeScreen.tsx`
- 新的动作执行器
- `rbac-preview.ts`
- Gate、Repair、Prompt 和动作测试

**完成标准**:

- 没权限的动作不显示或不可执行;
- 图表点击可以筛选表格或打开详情;
- 快捷入口真的能新建、跳转或启动现有流程;
- AI 动作仍然先生成建议,用户确认后才写回;
- 动作失败有明确提示,不能假装成功。

### 第 6 步:增加两个真正拉开首页差异的新区块

**做什么**:

- 增加 `QuickActionPanel` 和 `FilterBar`;
- 前者用于 CRM/任务工作台的快捷业务操作;
- 后者用于经营大盘、舆情监控的时间和条件筛选;
- 风险流先复用 `ActivityFeed`,不急着新建专用区块。

**完成标准**:

- CRM 首页能形成“今日任务 + 快捷操作 + 客户表格 + 最近动态”;
- 大盘首页能形成“筛选 + 指标 + 趋势 + 排行榜”;
- 两类首页不依赖固定应用类型,仍由模型根据用户指令选择区块。

> **第二个效果检查点**:用收入大盘、CRM、舆情监控、内容日历四类指令重新生成并截图。四者应在首页结构上明显不同,但同一个应用仍能混用日历、看板、表格和监控页。

### 第 7 步:让模型决定区块怎么摆

**做什么**:

- 页面增加 `layout`;
- 支持区块顺序、宽度、主次区域和手机布局覆盖;
- 先做固定网格和有限槽位,不允许模型自由写 CSS;
- 没有 layout 的旧页面继续使用现有 `page.kind` 排版。

**完成标准**:

- 目录外槽位、重复 block id、悬空 block id 会被 Gate 拦住;
- 桌面和平板不溢出;
- 手机端可以单独调整顺序,不是简单把桌面内容压窄;
- 老页面布局不变。

### 第 8 步:整理外壳和设备

**做什么**:

- 增加 `experienceShell.mode=navigation|focus`;
- navigation 模式继续支持 side/top;
- 老模型的 `appIdentity.nav` 自动转换,新模型不再生成它;
- `preferredDevice` 只控制首次预览设备;
- 手机的具体排版由页面 `responsiveLayout` 决定。

**完成标准**:

- `appIdentity.nav` 和 `experienceShell` 不会同时控制导航;
- side、top、focus 三种外观切换正常;
- 旧应用不受影响;
- `canvas` 仍不进入通用外壳枚举。

### 第 9 步:最后补视觉配方

**做什么**:

- 增加 `designRecipeRef`;
- 一份配方统一控制颜色、字体、圆角、阴影、页面密度、图表色板和深浅模式;
- 模型只选择经过人工调好的配方,不自由生成颜色和 CSS。

**完成标准**:

- 同一套区块换配方后气质明显不同;
- 字体、背景、卡片、侧栏和图表颜色保持一套系统;
- 对比度和深色模式可用;
- 主题变化不影响权限、数据和动作。

### 暂不进入本轮实施

- 低代码表单设计器;
- 流程画布;
- IDE/代码助手工作区;
- 任意拖拽页面设计器;
- 任意 CSS、任意图表配置和任意代码生成。

这些需要单独的画布和编辑协议。当前先把大盘、CRM、舆情、任务和日历这条通用应用链做深。

### 整体完成标准

满足以下条件,这轮实施才算结束:

1. 新应用不再统一打开“审批工作台”;
2. 大盘、CRM、舆情和日历四类指令能生成明显不同的首页;
3. 差异来自动态选择区块和布局,不是四套写死模板;
4. 区块数据能算、按钮能点、权限生效、失败会报错;
5. 旧模型和已有应用继续能打开;
6. Gate、Repair、Prompt、前端渲染和测试使用同一本合法目录;
7. `verify:sliderule-v5` 全部通过，包括多样性验收门（第 5 条）;
8. 浏览器截图经人工检查：打开各应用后首屏确实不同；但应用中心卡片缩略图仍是 `MiniAppThumb` 固定渲染（深色侧栏 + 空指标 + 骨架线），不代表视觉生态已完整；要达到效果图的完整度，还需要第二阶段的缩略图流水线、预览数据协议和专业生态协议（见"第二阶段待补项"）。

## 第二阶段待补项（Step 0～9 完成后仍缺失的四组工作）

完整 Step 0～9 可以让 SlideRule 从"很多应用共用一张脸"升级成"能够动态生成多种通用业务应用"，但不能形成包含真实应用画廊、饱满预览数据、IDE/流程画布和原生移动应用的完整多生态。以下四组工作不进入本轮，但需在进入下一轮之前明确定义，**不可宣称Step 0～9 做完就达到效果图完整效果**。

### 第二阶段 A：真实应用缩略图流水线

**问题**：`MiniAppThumb` 对所有已闭环应用固定渲染深色侧栏 + 2 张空指标卡 + 灰色骨架线，只读取 `pageNames` 和 `entityNames`，不读取 `landingPageRef`、`page.kind`、`blocks`、`layout`、主题和设备。`identity.theme` 虽被 `deriveAppCardDetail` 提取，但未传入缩略图渲染。因此即使 Step 1～9 全部做完，"打开应用后首屏已不同"，但"应用中心里十二张卡仍基本雷同"。

**需要做什么**：

- 闭环后按 `landingPageRef + 默认角色 + 设备 + identity.theme + modelHash` 启动真实运行时，截取首屏快照；
- `modelHash`（或等价的内容指纹）变化时自动失效并重拍；`landingPageRef`、`page.kind`、`identity.theme` 任一变化也触发失效；
- 截图失败时显示诚实占位（当前骨架线），不崩溃不伪装；
- 应用中心 `MiniAppThumb` 替换为读取快照资产，降级到骨架线的条件明确声明。

**关键约束**：截图流水线必须与测试证据（`tmp/generated-app-browser-smoke/`）严格分离——Playwright 冒烟截图是测试证据，不自动变成画廊素材；两者用不同目录和触发时机。

### 第二阶段 B：预览数据协议

**问题**：Step 4 让运行时知道"应该查哪张表、哪个字段、用什么聚合"（绑定正确性），但不解决"表里没数据"。新应用生成后指标为 `0`，图表显示"暂无数据"，表格为空，排行榜为空。效果图里的经营大盘、CRM、趋势图、消息中心之所以有数据密度，是因为有预填数据——当前没有这个机制。

**需要做什么**：

- 根据实体字段类型（数字、日期、枚举、文本）确定性生成一小批"仅预览"记录；
- 明确标记来源（`previewSeed: true`），与正式运行数据物理或逻辑隔离，不写入可导出/可查询的正式数据仓；
- Gate 检查预览数据符合实体 schema（不用来验证，但防止格式错乱导致渲染异常）；
- 让指标、趋势图、排行榜、日历和表格在首次打开时能成形，不全部为零或空。

**关键约束**：预览数据绝不能偷偷写入正式运行时（违反"不编假数据"原则），必须在隔离上下文里运行，且浏览器 UI 明确标注"示例数据"。

### 第二阶段 C：多样性浏览器验收门（补入 `verify:sliderule-v5`）

**问题**：当前发布门检查"页面能打开、Gate 不拦合法模型、角色降级正确"，但不检查"用大盘指令和用CRM指令生成的两个应用首屏结构是否确实不同"。模型可能合法地连续选择同一种 `landingPageRef`（例如总选第一页、总选 `workbench` 类型），Gate 不拦，整体完成标准第 2 条无法机械验证。

**需要做什么**：

- 固定一组（至少 4 个）典型意图：经营大盘、CRM 工作台、舆情监控、内容日历；
- 对每个意图生成应用后，浏览器断言首屏的 `page.kind`、主区块类型组合或 Shell 至少在某个可量化维度上不同；
- 如果两个应用首屏结构相同，测试失败并报告具体的雷同维度——不能靠人眼检查；
- 此门作为 `verify:sliderule-v5` 的一部分，与单测并列，不单独维护。

### 第二阶段 D：专业生态协议（保持已有明确排除，但需定义入口条件）

流程设计器（节点/边/拖拽/选中态/属性面板/撤销重做/持久化）和代码助手（文件树/编辑器/对话/补丁/终端/执行预览）已在本轮明确排除，原因是通用 `page.blocks` 无法承接。**但进入第二阶段前应定义"什么条件触发专业协议立项"**：例如"有超过 N 个用户指令要求流程画布且通用方案明显不足"。否则这两类需求会以"用通用区块凑合"的方式被低质量满足，而不是在正确时机被正确立项。

### 第二阶段 E：应用中心 UX（独立于应用形态，按优先级分级）

应用中心画廊自身的 UX 功能不在 Step 0～9 范围内，但从 workbench.png 到 Illustration.png 有明显的外观差距，需要明确分级处理：

**低成本可搭便车（Step 0～9 做完后顺手做）**：

- "我的应用"tab 重命名为"我创造的"；
- 侧边栏最近使用条目消费已有的 `identity.icon`（已提取进 `AppCardDetail`）和 `identity.theme` 展示彩色图标角标，搭配相对时间戳；
- 画廊视图切换（网格/列表）。

**独立立项（时机成熟再做，不阻塞形态工作）**：

- **全局搜索框**（"搜索应用、功能或解决方案…"）：需要索引会话 goal + 页面名 + 实体名，并决定是本地过滤还是后端全文搜索，单独立项更干净；
- **"AI 推荐"tab**：需要推荐引擎（基于 goal 语义 / 使用频率 / 角色），是新产品功能，不能作为"应用形态多样化"的附属。

**需产品战略确认后才能立项**：

- **侧边栏"数据源""知识库"入口**：意味着 SlideRule 要扩展到"管理数据源连接"和"管理知识库"，这是重大产品方向变化，不是 UI 条目，在明确产品优先级前不应随手加进去。

---

## 开源参照(三刀分别抄谁)

**关键结论**:在本次审查的项目中,未发现直接覆盖"业务模型 → 体验规划 → 可执行应用"完整链路的现成实现(SDUI/低代码多默认单一后台形态)。各刀抄成熟机制,"动态选材构图 + 选材可信"这层是 SlideRule 差异化。

| 刀 | 抄什么 | 项目 | 许可/活跃 |
|---|---|---|---|
| 第二刀 Experience Block Catalog 派生方式 | `defineCatalog` 单一真相源 + enum 派生(prompt/validate/schema 同源);**但应由现有 `schema_legal.py` 加载新 JSON 账本,勿在 TS 另造** | `vercel-labs/json-render` | MIT · 活跃 ★★★★★ |
| 第二刀 选材约束 gate | 结构化输出约束到枚举 + devtools 的 Pick/Catalog/Stream 面板 | `vercel-labs/json-render` | MIT · 活跃 ★★★★★ |
| 第三刀 分渲染器(区块级) | 按 type 的渲染器注册思路 + 诚实降级 | **Grafana** panel plugin(仅参考"区块注册",非应用 Shell 类比) | AGPL(只读思路)★★★☆☆ |
| 第三刀 跨端(以后) | 一份 spec → 多渲染器、增量更新、给 agent 而非给人 | `a2ui-project/a2ui`(原 `google/A2UI`,> DivKit) | Apache-2.0 · v0.9.1 稳定线、v1.0 RC,只抄思想 ★★★★☆ |
| 第四刀 换皮(backlog) | designRecipeRef:token/圆角/阴影/字体配方引用 + registry 分发 | tweakcn / shadcn GitHub Registries | tweakcn Apache-2.0 · 现在别碰 ★★★☆☆ |

**许可证订正(2026-07-19 复核)**:A2UI 是 **Apache-2.0**(非早期误记);tweakcn 是 **Apache-2.0**(不是项目注释里写的 MIT)。json-render 仍为 MIT。

**能力边界提醒**:json-render 能保证"只输出合法枚举",但**不能判断模型是否为用户选对了形态**——第二刀的"正确选材"仍需 SlideRule 自己的 prompt、证据、评测和决策留痕。

### 第二阶段开源代码核对记录(不是只看 README)

- **json-render**:实际的 `schema.ts` 证明同一个 Catalog 会派生 `prompt()`、`validate()`、`zodSchema()` 与 `jsonSchema()`;Dashboard 示例再用同一 Catalog 建 Renderer Registry。采用其“目录驱动多方”的做法。但其 `propsOf` 面对多个组件时会退成较宽的 `Record<string, unknown>`,所以 WhyBuddy 没有照搬这层校验,仍由 Python Gate 做硬门。[核心实现](https://github.com/vercel-labs/json-render/blob/9d3dfc8917c1c6aa5568acbe0969523f3307376c/packages/core/src/schema.ts) · [Dashboard Catalog](https://github.com/vercel-labs/json-render/blob/9d3dfc8917c1c6aa5568acbe0969523f3307376c/examples/dashboard/lib/render/catalog.ts) · [Registry](https://github.com/vercel-labs/json-render/blob/9d3dfc8917c1c6aa5568acbe0969523f3307376c/examples/dashboard/lib/render/registry.tsx)
- **A2UI**:仓库已迁到 `a2ui-project/a2ui`;当前 v0.9 Catalog 把组件 API、组件实现、函数 API 与函数执行分开,函数执行前再次用 Zod 校验参数。采用这种边界思想,但本阶段不引入 A2UI 依赖、不照搬其传输协议。[Catalog 类型与执行校验](https://github.com/a2ui-project/a2ui/blob/3708c069670c1fce4cdbeedaab59053dd96c9bbc/renderers/web_core/src/v0_9/catalog/types.ts) · [v0.9 基础 Catalog](https://github.com/a2ui-project/a2ui/blob/3708c069670c1fce4cdbeedaab59053dd96c9bbc/renderers/angular/src/v0_9/catalog/basic/basic-catalog.ts)
- **NocoBase**:实际区块 Schema 会同时携带 `dataSource / collection / action / x-acl-action`,证明“区块不是孤立 UI,而是数据和权限的投影”。这部分留到第 4、5 步吸收;本阶段不复制其 Formily 结构或 AGPL 代码。[Comment Block Schema](https://github.com/nocobase/nocobase/blob/61ea97261a52ef9b7e5c3e42e76f610d2d2ecb46/packages/plugins/%40nocobase/plugin-comments/src/client/schema-initializer/createCommentBlockUISchema.ts)

## 相关文档

- 北极星:`docs/NORTH_STAR.md`(黄金路径、决策清单)
- 能力池:`docs/SlideRuleV5CapabilityPool.md`(注意:`capability` 已专指推演能力,区块目录勿复用此词)

## 关键代码位置(引用函数/类型名,行号会随改动失效)

- 数据层写死首页:`app-runtime-schema.ts` → `deriveAppRuntimeSchema()`(`home` 段)、`AppHomeSchema` 类型
- 渲染层写死首页 + 三套 Shell + 六种范式:`AppRuntimeScreen.tsx` → `homeContent` / `desktopShell` / `topShell` / `phoneShell` / `defaultPageContent`(内按 `page.view.kind` 分支)
- 五系统模型 Schema(需加 `landingPageRef` / `blocks` / `layout` / `experienceShell` 字段):`system-screens/five-system-model.ts`
- 当前权限语义(不得与行为 action 混用):`app-runtime-schema.ts` → `AppPageSchema.actions`;`rbac-preview.ts` → `pageAccessForRole()`
- 合法域账本与加载器:`services/data/five_system_legal.json` / `schema_legal.py`(Block Catalog 可另建 JSON 账本并由同一入口加载)
- 设计菜谱注入(部分内容无字段承接):`v5_design_reference.py` → `design_reference_block()`
- 发布门(需加生成应用验收):`scripts/verify-sliderule-v5.sh`
- 若代码注释仍写 "tweakcn MIT",应一并改为 Apache-2.0
