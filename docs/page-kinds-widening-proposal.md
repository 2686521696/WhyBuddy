# `pageKinds` 放宽提案（A 档 + B 档 monitor 那批**已执行**）

2026-08-11。承接 `84a6fe1` 的核实结论：`pageKinds` 里有 25 对同域同能力的严格子集
矛盾，所以页型限制现在不能上门禁。本文件给出把那个数降下去的**具体改动清单**。

进度：

| 批次 | 结论 | 矛盾对数 |
|---|---|---|
| A 档（通用工作面） | 执行 8 个（`HeaderEntitySummary` 那条被否掉） | 25 → **15** |
| B 档 · monitor 那 6 个 | **4 放宽 + 2 收窄兄弟**，并把总览页禁令改成机械判据 | 15 → **9** |
| B 档 · 其余 8 个（calendar/kanban/wizard） | 待议 | — |

棘轮基线（`test_page_kind_consistency_ratchet.py`）已跟着锁到 9。改这份数据会影响
组件库的页型筛选与计数（`ComponentsLibraryPage.tsx` 3977 / 4132 行）。

## 判据：只沿「通用工作面」放宽，不伸进形状专属页型

23 个区块在机械对齐下都会被放宽，但**机械对齐是错的**。分档依据：

- **workbench / dashboard 是通用工作面**：任何"摘要 / 筛选 / 表单 / 操作页头"这类
  通用形状的区块都可能出现在上面。目录里 304/359（85%）允许 workbench，
  少数被排除的没有可辩护的理由——这正是矛盾的来源。
- **calendar / kanban / wizard 是形状专属页型**：这几种页有一个**主视图**
  （日历 / 看板 / 分步表单），区块在上面是受形状约束的。往这些页型上加区块是另一
  类主张，不能靠"兄弟允许"就推过去。
- **monitor 单独看**：它是总览页，但有自己的通道纪律（stats/charts 归 page.stats /
  page.charts，版面归 freeformOverview 现场设计）。往 monitor 加区块要单独议
  ——已议，见下面「B 档 monitor 那 6 个的定调」。答案不是一句"能"或"不能"：
  **操作类能，筛选类不能**，判据是那个事件在总览页够不够得到东西。

严格子集判据本身已经足够保守：`ReleaseCalendar(calendar,monitor)` 与
`ReleaseTrainBoard(kanban,monitor)` 都**没有**进清单——它们与兄弟互不包含，判据自动
放过了这类"窄得有道理"的声明。

## A 档：已执行（8 个区块，只加 workbench / dashboard）

矛盾对数 **25 → 15**。表里前 8 行已落到
`services/data/experience_block_catalog.json`；第 9 行 `HeaderEntitySummary`
评审时被否掉（见文末"一条没解决的"）。

| 区块 | 能力 | 当前页型 | 建议新增 | 依据（同域同能力的近亲） |
|---|---|---|---|---|
| `AlertRuleEditor` | form | dashboard,monitor | **+workbench** | `AlertSilenceForm` 已允许 workbench |
| `AlertRoutingPolicy` | entityRows | dashboard,monitor | **+workbench** | `AlertTriagePanel` 已允许 |
| `AlertMatcherFilter` | filter | monitor | **+workbench** | `AlertRuleFilterBar` 已允许 |
| `AlertRuleCommandHeader` | action | monitor | **+workbench** | `AlertGroupCommandHeader` 已允许 |
| `AlertInstanceSummary` | entityRows | monitor | **+dashboard,workbench** | 三个近亲都更宽 |
| `AlertGroupContextSummary` | entityRows | monitor,workbench | **+dashboard** | `AlertTriagePanel` 已允许 |
| `StreamSelectionSummary` | entityRows | monitor,workbench | **+dashboard** | `StreamStatusMonitor` 已允许 |
| `PermissionSummaryPanel` | entityRows | workbench | **+dashboard** | `PermissionMatrix` 已允许 |
| ~~`HeaderEntitySummary`~~ | entityRows | wizard,workbench | ~~+dashboard~~ | **评审否掉，未执行** |

**6 个来自 Alert 族**——正是最初那份线上收割里越界的那一族
（`AlertRoutingPolicy`、`MuteTimingSchedule` 被摆进 workbench 页）。也就是说这份
清单直接对准了那次事故的成因：不是模型摆错，是目录把「路由策略管理页」这种天然的
工作台排除在外了。

对组件库筛选的影响（执行后实测）：允许 workbench 的 304 → **309**，允许 dashboard 的
133 → **137**。（提案初稿把 dashboard 的基数写成 132，实际是 133。）

## B 档 monitor 那 6 个的定调（**已执行**，矛盾 15 → 9）

评审时把这 6 个放在一起议了。结论是**不能一起放宽**——查完证据它们劈成了两半，
而且顺带照出一个比这 6 个都大的洞。

### 判据：`filterChange` 在总览页够不到任何东西（实测链路）

`AppRuntimeScreen.tsx` 里只有一份行被筛过：

| 位置 | 取数 | 吃筛选吗 |
|---|---|---|
| `:812` `rows = applyPageFilter(allRows, activePageFilter, …)` | 本页表/看板/日历 | **吃** |
| `:1922` `pageStatDisplay` → `state.entities[stat.entityId]` | 总览页 KPI | 不吃 |
| `:2913` `phoneChartNode` → `state.entities[chart.entityId]` | 页面图表 | 不吃 |
| `:1691` `sharedBlockRendererProps.entityRows = state.entities` | 所有积木 + 设计树 | 不吃（注释自己写着"未收窄"） |

总览页没有表/看板/日历，所以**任何发 `filterChange` 的区块摆上总览页都是死控件**。
这条 2026-08-01 就写在 `schema_legal.py` 里了，只是当时只按名字禁了 `FilterBar`。

### 4 个 action 的：放宽（+monitor）

| 区块 | 槽位 | 事件 | 已允许 monitor 的同形近亲 |
|---|---|---|---|
| `WorkflowCommandHeader` | header | actionTrigger,submitRequest | `IssueCommandHeader`、`ConnectionControlHeader`、`AlertGroupCommandHeader` |
| `ConnectionSchemaHeader` | header | actionTrigger,editRequest | **`ConnectionControlHeader`（同域）** |
| `SchemaRefreshBar` | footerBar | actionTrigger,editRequest | `RunningJobControlBar`、`DashboardSaveBar` |
| `WorkflowControlBar` | footerBar | itemSelect,submitRequest | 同上 |

三条证据：72 个 action 区块已有 **16 个**允许 monitor，槽位与事件形态一致；
运行时真渲染（`AppRuntimeScreen.tsx:3403` 总览页分支里 `blockScaffold` 与
`monitorFreeformOverview` **并列**，区域表含 `header`/`footerBar`；
`WorkflowControlBar` 取行用 `focus ?? rows[0]`，不依赖表格选中）；
提示词自己的立场就是"总览页要能动手"（*an overview whose ONLY content is numbers
is a report, not a workbench — the user opens it to act*）。

### 2 个 filter 的：不放宽，反而**收窄它们更宽的兄弟**

`UserDirectoryFilter` 只发 `filterChange`（摆上总览页全死）；`SavedSearchPanel`
的"运行"发 `filterChange`、"删除"发 `submitRequest`（**主动词死了**）。所以这两对
矛盾靠收窄消：`SavedViewTabs` 和 `UserEventFilter` 撤掉 `monitor`。

两条路矛盾数都落到 9，差别在一条往总览页塞死控件、另一条把死控件撤下来。

### 顺带修的洞：`pageKinds` 对 monitor 页原本一点约束力都没有

`monitor_ok` 是 `enabled` 减掉 4 个硬编码名字算出来的，**完全不读 `pageKinds`**：

    通电区块里不允许 monitor 的：188 个
    其中仍被 monitor_ok 那句列为总览页可选项的：187 个

同一份提示词里，条目说 `WorkflowCommandHeader: pages=workbench`，下面那句又把它
列进"总览页可以声明这些"。所以放宽这 6 个对**模型说的话零影响**，只动三处：
棘轮计数、组件库筛选、修复器的越界记录。

修法取"机械判据"而不是"让 `monitor_ok` 读 `pageKinds`"：后者会把总览页可选清单从
355 收到约 171，是真的行为变更，得上度量台跑一轮再定。前者只撤死控件，风险低，
理由是已实测的机制——`capability == "filter"` 一律禁（原来只禁 `FilterBar` 一个
名字，而目录里 32 个 filter 区块有 31 个只发 `filterChange`）。
禁令的**理由句跟着名单走**：窄化开着时名单常常只剩筛选类，此时不再照抄
"MetricGrid and TrendChart would…" 去解释一个没出现的名字。

### 这个修法照出来的两个废区块（已用棘轮记着，不假装能用）

`AnalyticsDateScope`（dashboard,monitor）和 `DashboardParameterBar`（dashboard,monitor）
的 `pageKinds` **只**写了总览页，禁令一上就"只允许总览页 + 总览页不许用"——哪儿都
摆不了。不是判据错了：这两个照样筛不动东西。真正的修法是**让总览页的 KPI/图表吃
`filterState`**，那是个功能不是改一行数据。在那之前由
`test_没有更多区块被总览页禁令堵死` 守着这个数只准变少。

顺带留一条不一致：`FilterBar` 等 20 个 filter 区块的 `pageKinds` 仍写着允许
monitor，而提示词已经硬禁。干净的收口是把 filter 区块的 `pageKinds` 里的
`monitor`/`dashboard` 一并剥掉，但那会把上面那两个彻底剥空，所以留到"KPI/图表吃
筛选"那件事定了之后一起做。

## B 档剩下的（8 个区块，涉及 calendar / kanban / wizard）

这些的"兄弟"往往**不是真近亲**，或者要跨进形状专属页型，机械放宽有风险：

| 区块 | 机械对齐会加 | 为什么先别加 |
|---|---|---|
| `ActivityContextDrawer` | +calendar,monitor | 它是 `overlay` 抽屉，兄弟 `ActivityFeed` 是动态流——同 capability 但形状不同 |
| `FilterPresetDrawer` | +calendar,monitor | 同上：抽屉 vs `FilterBar` |
| `BookingContextSummary` | +wizard | 摘要进向导页是更大的语义跳跃 |
| `ConnectionRouteSummary` | +wizard | 同上 |
| `ConnectionTimeline` | +wizard | 同上 |
| `DocumentContextSummary` | +wizard | 同上 |
| `RecordComparePanel` | +monitor,wizard | 对比面板进向导页，兄弟 `RecordPicker` 不是真近亲 |
| `EventTypePublishBar` | +calendar | 兄弟 `EventRsvpPanel` 天然是日历件（RSVP 基于事件），发布栏不是 |

（原表里 monitor 那 6 个已挪到上一节，`SavedSearchPanel` / `UserDirectoryFilter`
两条的结论是**不放宽**，`ActivityContextDrawer` / `FilterPresetDrawer` /
`RecordComparePanel` 里的 `+monitor` 那半也随之作废——同一条判据。）

## 执行方式

1. ~~先只做 A 档~~ **已完成**：改了 `services/data/experience_block_catalog.json`
   里那 8 个区块的 `pageKinds`，`tests/test_page_kind_consistency_ratchet.py` 的
   `_CONTRADICTION_BASELINE` 从 25 锁到 15（棘轮要求变好之后必须锁住）。
   顺带修了一处**会静默失效的路标**：`test_门禁仍然不拦页型越界` 原来用
   `AlertRoutingPolicy` 摆进 workbench 页当越界样例，A 档放宽后那个摆放变合法了，
   断言会永远成立。已换成同族同能力、仍然不允许 workbench 的
   `MuteTimingSchedule`，并加了一条前置断言先证明样例真的越界。
2. ~~B 档里的 monitor 那 6 个作为第二批一起议~~ **已完成**，见上面「B 档 monitor
   那 6 个的定调」：4 放宽 + 2 收窄兄弟，基线 15 → 9；并把总览页禁令从"4 个硬编码
   名字"改成机械判据（`capability == "filter"` 一律禁）。
3. **矛盾降到 0 之后**才谈让结构闸硬拒页型越界。届时要改的是
   `test_门禁仍然不拦页型越界` 那条路标，而不是悄悄让修复器开始删区块。
4. 剩下的 9 对全在 calendar / kanban / wizard 这三种形状专属页型上——那是第三批，
   要回答的是"摘要/抽屉/对比面板能不能进有主视图的页"，跟前两批不是同一个问题。

## 一条没解决的

判据里"名字首词 = 领域族"是个近似。它对 `Alert*` / `Booking*` / `Release*` 这种
命名规整的族有效，但目录里也有 `HeaderEntitySummary` 这类不带领域前缀的（被归到
`Header` 族）。这类分组可能把不相关的区块凑一起，也可能漏掉真矛盾。清单里
`HeaderEntitySummary` 那条建议因此比其它八条弱——**评审已单独否掉它**。

否掉之后补一条更正：这条对矛盾对数**本来就没有影响**，提案初稿把它算进
"25 → 15" 是记错了。给它加 dashboard 之后是 `{dashboard,wizard,workbench}`，
仍然是 `HeaderProgressSummary` 的 `{dashboard,monitor,wizard,workbench}` 的严格子集
（缺 monitor），那一对不会消掉。所以做 8 个和做 9 个都是 15 对，否掉它零代价——
真要消掉这一对，得先回答"实体摘要能不能上 monitor 页"，那是 B 档那批问题。
