# `pageKinds` 推导脚本首轮跑批记录（2026-08-11）

`scripts/label_block_page_kinds.py --dry-run`，模型 `gpt-5.6-luna`，6 种页型 ×
358 个通电区块，耗时约 **62 分钟**。

**结论先说：第一层（硬判据）可用并已进 CI；第二层（模型初稿）这一版不可用，
不落盘。** 下面是原始输出、为什么不可用、以及照此修了脚本哪两处。

## 一、原始输出

```
目录 359 个区块（通电 358）
硬判据违反 0 处

第二层：按页型问模型（gpt-5.6-luna），6 种页 × 358 个区块
  workbench  问了 321 个（硬判据定死 37 个），模型答 yes 145，答上 321/321
  wizard     问了 355 个（硬判据定死 3 个），模型答 yes 113，答上 355/355
    重试 1/2：[Errno 104] Connection reset by peer
  kanban     问了 354 个（硬判据定死 4 个），模型答 yes 61，答上 354/354
  calendar   问了 356 个（硬判据定死 2 个），模型答 yes 46，答上 356/356
  monitor    问了 322 个（硬判据定死 36 个），模型答 yes 70，答上 322/322
  dashboard  问了 322 个（硬判据定死 36 个），模型答 yes 86，答上 322/322

差异（问全 6 种页的 327 个区块）：
  一致        39
  目录更宽    247  ← 现在推荐了推导认为干不了活的页
  目录更窄    119  ← 现在挡住了推导认为能用的页

没问全的 31 个（不下结论，重跑）：TagFilterRow, SearchBox, StatusTabs,
ActiveFilterSummary, AnalyticsDateScope, SavedViewTabs, AdvancedFilterBuilder,
FacetedFilterPanel, IssueEventFilter, TimelineFilterBar, BookingStatusTabs,
ValidatedFormTabs
```

各页型两侧对照：

| 页型 | 目录现在 | 模型初稿（含硬判据） |
|---|---|---|
| workbench | 311 | ~182 |
| wizard | 68 | ~116 |
| kanban | 55 | ~65 |
| calendar | 55 | ~48 |
| monitor | 154 | ~106 |
| dashboard | 126 | ~122 |

## 二、跑通了的部分

- **硬判据 0 违反**，与 `--check` 一致（此前它抓到过 4 处，`MetricGrid` /
  `TrendChart` 那两个已修）。
- **一条都没丢**：321/321、355/355、354/354、356/356、322/322、322/322。
  「发行号不发区块名」那条纪律有效（`label_block_generality.py` 记着的教训是
  发名字有三分之一批次会被模型"顺手规整"掉 id）。
- **退避重试用上了一次**（kanban 那轮 `Connection reset by peer`），恢复正常。
- **硬判据替模型省了该省的判断**：monitor / dashboard 各定死 36 个（32 个筛选类
  + `MetricGrid` / `TrendChart`）。这批不问模型既是省钱也是防错——2026-08-01
  实测过模型会按语义直觉认为"总览页该有个筛选条"。

## 三、为什么第二层这一版不可用

### 3.1 抽查 8 个「目录更宽」，8 个被清空

从截断的清单里取 8 个，把模型要去掉的页型跟它现有声明比：

| 区块 | 现有 | 模型要去掉 | 剩下 |
|---|---|---|---|
| `AlertGroupCommandHeader` | monitor, workbench | monitor, workbench | **空** |
| `AttachmentPanel` | dashboard, monitor, wizard, workbench | 全部 4 个 | **空** |
| `AlertGroupContextSummary` | dashboard, monitor, workbench | 全部 3 个 | **空** |
| `AlertInstanceSummary` | dashboard, monitor, workbench | 全部 3 个 | **空** |
| `AlertRuleCommandHeader` | monitor, workbench | monitor, workbench | **空** |
| `BookingContextSummary` | calendar, workbench | calendar, workbench | **空** |
| `BookingDecisionBar` | calendar, workbench | calendar, workbench | **空** |
| `BookingCommandHeader` | calendar, workbench | calendar, workbench | **空** |

清空等于**废掉一个已经写好渲染器、已经放开生成的区块**。脚本的落盘前置检查
（"推导出来一个页型都不允许就拒绝落盘"）会挡住它，所以没有写坏数据——但这说明
这一版初稿整体不能用。

**根因是我自己的设计缺口**：按页型分组问是对的（混着问会全答 yes），但**分组问
之后没有任何一处在看"这个区块还剩几种页"**。每一轮单独看，模型答得都有道理；
六轮一路答否，区块就没了。

### 3.2 至少两条理由的前提是错的

- `ApprovalStageBoard 多 workbench`，理由「主区应为表格，非看板布局」。
  **不成立**：2026-08-08 那次「翻转默认」之后，workbench 页只要声明了积木就
  **不渲染内置表格**，版面由积木自己画（`AppRuntimeScreen.tsx` 的
  `blocksOwnPage`）。我在 `PAGE_KIND_FACTS` 里写了这句，模型仍然按"工作台=表格页"
  的旧直觉答。
- `AlertRuleCommandHeader 多 workbench`，理由「告警规则管理属于配置页」。
  **"配置页"不是这 6 种页型里的任何一种**；告警规则管理页本身就是个工作台。这条
  跟 A 档放宽它的依据正好相反，而 A 档那次是有同族先例支撑的
  （`AlertGroupCommandHeader` 当时已允许 workbench）。

这正是脚本文档里那句「这张表要是跟运行时漂了，模型拿到的就是假前提，而那种错误
最难查」——只是这次假前提不是表写错了，是模型没采信表。

### 3.3 「没问全的 31 个」是记账 bug，不是网关抖动

那 31 个**全是筛选类**，这不是巧合。硬判据③（"筛选类至少要有一种带逐行视图的页"）
返回的 `require_any_row` 是个记账位，不是"这一格定死了"；但首轮的主循环把它当成
"有硬判据"处理——于是筛选类区块的 `workbench` 那一格**既不问模型、又不记进
`asked`**，永远凑不满 6 种页，被差异表整批跳过。

32 个筛选类里恰好漏 31 个：`FilterBar` 例外，因为它有预设 `require`
（`filter-list-create` / `board-filter-feed`）顶着那一格。

已修（见第四节第 3 条）。

### 3.4 值得单独跟进的一条

`BatchActionBar 多 kanban`，理由「看板未提供多行勾选」——这条**可能是对的**，
`KanbanBoard` 只有 `onOpenRow`，没有多选。留作待查项，不在本轮处理。

## 四、照此修了脚本三处

1. **兜底强制选择**（`force_pick`）：逐页型问完之后，凡是被判成"哪种页都不放"的
   区块，回头再问一次，**问法从"能不能"换成"最合适的是哪 1~2 种"**。判断题一路
   答否会清空，选择题答不出"都不选"。
2. **原始初稿落盘**（`--draft-out`，默认 `scripts/data/page_kinds_draft.json`）：
   首轮跑完才发现屏幕上的差异表两边各截 30 行，而**逐格判断一个字没留**，要复核
   就得再花一小时重跑全部 API 调用。一小时的产出必须落地成文件。
3. **`require_any_row` 不再当"有硬判据"**：那一格照旧交给模型问，并记进 `asked`。
   这是 3.3 那 31 个的根因。

## 五、结论与下一步

- **第一层照旧有效**：硬判据 4 条 + `--check` + `tests/test_page_kind_derivation.py`
  已经进 CI，那是"能重算的依据"这件事真正落地的部分。
- **第二层重跑一次再看**（带上兜底与落盘）。这一版不落盘，目录数据不动。
- 结论没变：这个字段**不该上结构闸**。理由不是"初稿不好"，而是运行时对
  workbench / wizard / kanban / calendar 四种页型无差别对待，见
  `tests/test_page_kind_consistency_ratchet.py` 的「上闸还差什么」。
- 遗留：3.4 那条 `BatchActionBar` / 看板多不多选，待查。
