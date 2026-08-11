# `pageKinds` 放宽提案（待评审，**尚未执行**）

2026-08-11。承接 `84a6fe1` 的核实结论：`pageKinds` 里有 25 对同域同能力的严格子集
矛盾，所以页型限制现在不能上门禁。本文件给出把那个数降下去的**具体改动清单**。

**这份清单没有被应用。** 改这份数据会影响组件库的页型筛选与计数
（`ComponentsLibraryPage.tsx` 3977 / 4132 行），是产品判断，所以只列不改。

## 判据：只沿「通用工作面」放宽，不伸进形状专属页型

23 个区块在机械对齐下都会被放宽，但**机械对齐是错的**。分档依据：

- **workbench / dashboard 是通用工作面**：任何"摘要 / 筛选 / 表单 / 操作页头"这类
  通用形状的区块都可能出现在上面。目录里 304/358（85%）允许 workbench，
  少数被排除的没有可辩护的理由——这正是矛盾的来源。
- **calendar / kanban / wizard 是形状专属页型**：这几种页有一个**主视图**
  （日历 / 看板 / 分步表单），区块在上面是受形状约束的。往这些页型上加区块是另一
  类主张，不能靠"兄弟允许"就推过去。
- **monitor 单独看**：它是总览页，但有自己的通道纪律（stats/charts 归 page.stats /
  page.charts，版面归 freeformOverview 现场设计）。往 monitor 加区块要单独议。

严格子集判据本身已经足够保守：`ReleaseCalendar(calendar,monitor)` 与
`ReleaseTrainBoard(kanban,monitor)` 都**没有**进清单——它们与兄弟互不包含，判据自动
放过了这类"窄得有道理"的声明。

## A 档：建议执行（9 个区块，只加 workbench / dashboard）

执行后矛盾对数 **25 → 15**。

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
| `HeaderEntitySummary` | entityRows | wizard,workbench | **+dashboard** | `HeaderProgressSummary` 已允许 |

**6 个来自 Alert 族**——正是最初那份线上收割里越界的那一族
（`AlertRoutingPolicy`、`MuteTimingSchedule` 被摆进 workbench 页）。也就是说这份
清单直接对准了那次事故的成因：不是模型摆错，是目录把「路由策略管理页」这种天然的
工作台排除在外了。

对组件库筛选的影响：允许 workbench 的 304 → 309，允许 dashboard 的 132 → 137。

## B 档：需要单独决定（14 个区块，涉及 calendar / kanban / wizard / monitor）

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
| `SavedSearchPanel` | +monitor | monitor 有自己的通道纪律，要单独议 |
| `UserDirectoryFilter` | +monitor | 同上 |
| `WorkflowCommandHeader` | +monitor | 同上（不过"总览页要能让人动手"这条支持它） |
| `WorkflowControlBar` | +monitor | 同上 |
| `ConnectionSchemaHeader` | +monitor | 同上 |
| `SchemaRefreshBar` | +monitor | 同上 |

## 执行方式建议

1. **先只做 A 档**，改 `services/data/experience_block_catalog.json` 里那 9 个区块的
   `pageKinds`，并把 `tests/test_page_kind_consistency_ratchet.py` 的
   `_CONTRADICTION_BASELINE` 从 25 改成 15（棘轮要求变好之后必须锁住）。
2. B 档里的 monitor 那 6 个可以作为第二批一起议——它们共享同一个问题
   （"总览页能不能放操作类区块"），适合一次定调。
3. **矛盾降到 0 之后**才谈让结构闸硬拒页型越界。届时要改的是
   `test_门禁仍然不拦页型越界` 那条路标，而不是悄悄让修复器开始删区块。

## 一条没解决的

判据里"名字首词 = 领域族"是个近似。它对 `Alert*` / `Booking*` / `Release*` 这种
命名规整的族有效，但目录里也有 `HeaderEntitySummary` 这类不带领域前缀的（被归到
`Header` 族）。这类分组可能把不相关的区块凑一起，也可能漏掉真矛盾。清单里
`HeaderEntitySummary` 那条建议因此比其它八条弱——评审时可以单独否掉它。
