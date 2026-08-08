"""页面范式 —— 装配的"户型图"。

## 为什么必须有这一层

2026-08-08 用户的判断（原话摘要）：「你现在 AI 做的其实不是装配应用页面，
而是把组件 Demo 拼到一张画布上……你已经建好了零件仓库，但是 AI 组装器目前
没有产品设计图纸。」

实测那张「库存管理」证据确凿：Menu 一张大卡、Input 一张卡、Button 一张卡、
Table 一张卡、Pagination 又单独一张卡，表格内容还是「甲/乙/12/34」。
**那是 Ant Design 组件示例合集换了个标题。**

根因不是模型不会排版，是装配目标错了。此前的链路是

    意图 → 需要哪些组件 → 排出来

模型收到的任务实际上变成了"从组件库选几个组件并排列"，它确实完成了。
正确的链路多两层：

    意图 → 页面范式 → 业务区域 → 区块 → 组件实例

**组件是最后一步，不是第二步。**

## 这个模块负责第二层

每种范式声明它的**区域**（region）：叫什么、干什么、是不是必须、视觉权重
多少、能放哪类区块。这不是写死页面——是给模型一套语法，就像写文章有
"标题/引言/正文/结尾"，不能每次从字开始随便排。

## 权重不是装饰

primary / secondary / supporting / overlay 直接决定布局引擎分多少空间。
没有它，模型会继续生成"五个组件 = 五个差不多大的卡片"——那张库存管理页
就是这么来的。

## 区域名的来历（2026-08-08 第二轮，重要）

**第一版这七个区域是我编的。** 我从常见后台页面倒推，写了 header / metrics /
filters / charts / main / aside / overlay，没有依据——404 页该有哪些区、结果页
该有哪些区、详情页的关键数字该摆哪儿，我当时并不知道。

用户指出去看 `ant-design/pro-blocks`：29 个真实页面，被无数项目抄过。扒完
之后，页面骨架的**官方答案**是 `PageContainer` 的槽（`pro-components/src/
layout/components/PageContainer`），29 页的使用统计如下：

    PageContainer / GridContent   全部 29 页
    extra          页头右上角操作     9 页
    content        页头下的描述块     6 页  ← 我们没有
    extraContent   页头右侧关键指标   4 页  ← 我们没有
    tabList        页面级页签         3 页  ← 我们没有
    FooterToolbar  底部固定操作条     2 页  ← 我们没有
    <Result>       结果/异常主体      7 页  ← 我们连范式都没有

**最要紧的一条修正**：我原来假设"关键数字 = 全宽一条指标带"（metrics 区）。
证据不支持。只有仪表盘类才用全宽带（DashboardAnalysis 的 IntroduceRow）；
列表页和详情页把那两三个最重要的数**放在页头右侧**（ProfileAdvanced 是
「状态：待审批」「订单金额：¥568.08」，DashboardWorkplace 是「项目数 56 /
团队内排名 8 / 项目访问 2223」）。这不是审美差异——页头里的数不占正文空间，
主区还是完整的一张表；做成全宽带就把主体挤下去一屏。

于是新增四个区域，每个都在下面标了它的出处。加不加一个区域，从此有依据可查。

## 还缺的：result 范式

29 页里有 7 页的主体是 `<Result>`（403 / 404 / 500 / 提交成功 / 提交失败 /
注册结果 / 分步表单的最后一步），是这个库里**最常见的一种页面形状**，我们一个
都没有。但它得先有区块才能建范式——按用户定的链路，先有基础组件（Result 已在
库里），再组装成区块（ResultPanel，尚缺），再进范式。所以这一轮先不加空范式：
`test_required_regions_are_reachable_with_the_blocks_we_actually_have` 会红，
而那条红得对——它挡的正是"语法里写着、却没有任何区块填得了"。
"""

from __future__ import annotations

from typing import Any, Dict, List

#: 区域的视觉权重。布局按它分空间，Gate 按它查"有没有主次"。
WEIGHTS = ("primary", "secondary", "supporting", "overlay")

#: 每种范式的区域语法。
#:
#: required=True 的区域**必须有区块落进去**，否则这一页不成立——一个列表管理页
#: 没有列表，它就不是列表管理页。Gate 直接打回，不给模型"少写一个也行"的空间。
#:
#: accepts 是这个区域收哪类区块（按 dataKinds / 能力，不是按具体类型名）——
#: 写死类型名会让每加一个区块都要回来改这张表。
#:
#: 每个区域后面的「出处」是它在 ant-design/pro-blocks 里的依据。没有出处的
#: 区域就是我编的，加区域之前先去那 29 页里找一个真实用例。
PAGE_ARCHETYPES: Dict[str, Dict[str, Any]] = {
    "list": {
        "label": "列表管理页",
        "when": "用户要在一批同类记录里查找、筛选、增删改。最常见的一档。",
        "regions": [
            {
                "key": "header",
                "label": "标题操作区",
                "why": "页面在干什么，以及这一页最主要的那个动作",
                "weight": "supporting",
                "required": True,
                "accepts": ["action", "aggregate"],
                "maxBlocks": 2,
            },
            {
                # 出处：ListBasicList / ListCardList / ProfileAdvanced /
                # DashboardWorkplace 的 PageContainer extraContent。
                # 这是对"关键数字 = 全宽指标带"那个错误假设的修正：列表页把
                # 那两三个最重要的数放在**页头右侧**，不占正文空间，主区还是
                # 完整一张表。ListBasicList 放的是「我的待办 8个任务 / 本周
                # 任务平均处理时间 32分钟 / 本周完成任务数 24个任务」。
                "key": "headerExtra",
                "label": "页头指标",
                "why": "两三个最要紧的数，放在标题右边，不挤占正文",
                "weight": "supporting",
                "required": False,
                "accepts": ["aggregate"],
                "maxBlocks": 1,
            },
            {
                # 出处：ListSearch / ListCardList 的 PageContainer content。
                # 页头下面那段说明这一页是什么、怎么用的文字块。
                "key": "headerContent",
                "label": "页头说明",
                "why": "这一页是什么、该怎么用——写在标题下面",
                "weight": "supporting",
                "required": False,
                "accepts": ["entityRows"],
                "maxBlocks": 1,
            },
            {
                # 出处：ListSearch / AccountCenter / ProfileAdvanced 的 tabList。
                # 注意这**不是**表格里的状态筛选页签，是页面级的：切的是整块
                # 主体内容（文章/项目/应用）。
                "key": "tabs",
                "label": "页面页签",
                "why": "同一页要装几组不同的东西时，用页签切整块主体",
                "weight": "secondary",
                "required": False,
                "accepts": ["filter"],
                "maxBlocks": 1,
            },
            {
                "key": "filters",
                "label": "筛选区",
                "why": "记录多到一屏装不下时，先收窄",
                "weight": "secondary",
                "required": False,
                "accepts": ["filter"],
                "maxBlocks": 1,
            },
            {
                "key": "main",
                "label": "数据主体区",
                "why": "这一页真正要看的东西",
                "weight": "primary",
                "required": True,
                "accepts": ["entityRows", "rankedRows"],
                "maxBlocks": 1,
            },
            {
                # 出处：ListTableList 的 FooterToolbar —— 选中若干行之后，
                # 「已选择 N 项 / 批量删除 / 批量审批」固定在视口底部，
                # 不随表格滚走。列表长的时候这是唯一能用的位置。
                "key": "footerBar",
                "label": "底部操作条",
                "why": "选中多行后的批量操作，固定在视口底部不随内容滚走",
                "weight": "overlay",
                "required": False,
                "accepts": ["action"],
                "maxBlocks": 1,
            },
            {
                "key": "aside",
                "label": "辅助区",
                "why": "选中一条之后看它的明细，或者一条动态流",
                "weight": "supporting",
                "required": False,
                "accepts": ["entityRows", "timelineRows"],
                "maxBlocks": 2,
            },
            {
                "key": "overlay",
                "label": "浮层区",
                "why": "新增/编辑表单——它不占页面空间，点了才出来",
                "weight": "overlay",
                "required": False,
                "accepts": ["form"],
                "maxBlocks": 2,
            },
        ],
    },
    "dashboard": {
        "label": "仪表盘",
        "when": "用户要一眼看清当下的数，然后决定做什么。",
        "regions": [
            {
                # 出处：DashboardAnalysis 的 IntroduceRow —— 四张 ChartCard
                # 撑满整行（总销售额/访问量/支付笔数/运营活动效果），每张带
                # 迷你图和环比。**只有仪表盘类才用全宽指标带**：它就是这一页
                # 的主角。列表页和详情页要的是 headerExtra，不是这个。
                "key": "metrics",
                "label": "指标区",
                "why": "几个关键数字撑满整行——仪表盘的主角就是这些数",
                "weight": "primary",
                "required": True,
                "accepts": ["aggregate"],
                "maxBlocks": 2,
            },
            {
                # 出处：DashboardWorkplace 的 content —— 头像 + 「早安，
                # 曲丽丽，祝你开心每一天」+ 职位。工作台是有"人"的页面。
                "key": "headerContent",
                "label": "页头说明",
                "why": "这是谁的工作台、他今天该关心什么",
                "weight": "supporting",
                "required": False,
                "accepts": ["entityRows"],
                "maxBlocks": 1,
            },
            {
                "key": "charts",
                "label": "图表区",
                "why": "趋势与分布，回答「怎么变的」",
                "weight": "secondary",
                "required": False,
                "accepts": ["series", "rankedRows"],
                "maxBlocks": 2,
            },
            {
                "key": "aside",
                "label": "辅助区",
                "why": "刚发生了什么，或者接下来该做什么",
                "weight": "supporting",
                "required": False,
                "accepts": ["timelineRows", "action"],
                "maxBlocks": 2,
            },
        ],
    },
    "detail": {
        "label": "详情页",
        "when": "用户已经选定一条记录，要看全它的字段并对它做操作。",
        "regions": [
            {
                "key": "header",
                "label": "标题操作区",
                "why": "这是哪一条，以及能对它做什么",
                "weight": "supporting",
                "required": True,
                "accepts": ["action"],
                "maxBlocks": 1,
            },
            {
                # 出处：ProfileAdvanced 的 extraContent —— 「状态：待审批」
                # 「订单金额：¥568.08」两个 Statistic 摆在标题右边。详情页
                # 最要紧的那两个数就该在这儿，而不是另起一条指标带。
                "key": "headerExtra",
                "label": "页头指标",
                "why": "这条记录最要紧的那一两个数（状态、金额），摆在标题右边",
                "weight": "supporting",
                "required": False,
                "accepts": ["aggregate"],
                "maxBlocks": 1,
            },
            {
                # 出处：ProfileAdvanced 的 content —— 一组 Descriptions
                # （创建人/订购产品/创建时间/关联单据/生效日期/备注）直接
                # 摆在页头里，不用等用户往下滚。
                "key": "headerContent",
                "label": "页头字段",
                "why": "几个一进来就要看的字段，摆在标题下面，不用往下滚",
                "weight": "supporting",
                "required": False,
                "accepts": ["entityRows"],
                "maxBlocks": 1,
            },
            {
                # 出处：ProfileAdvanced 的 tabList —— 详情 / 规则 / 日志。
                "key": "tabs",
                "label": "页面页签",
                "why": "同一条记录的几个面（详情/规则/日志）用页签切",
                "weight": "secondary",
                "required": False,
                "accepts": ["filter"],
                "maxBlocks": 1,
            },
            {
                "key": "main",
                "label": "字段主体区",
                "why": "这条记录的全部字段",
                "weight": "primary",
                "required": True,
                "accepts": ["entityRows"],
                "maxBlocks": 1,
            },
            {
                "key": "aside",
                "label": "辅助区",
                "why": "它的流转过程或相关记录",
                "weight": "supporting",
                "required": False,
                "accepts": ["timelineRows", "chain"],
                "maxBlocks": 2,
            },
            {
                "key": "overlay",
                "label": "浮层区",
                "why": "编辑表单",
                "weight": "overlay",
                "required": False,
                "accepts": ["form"],
                "maxBlocks": 1,
            },
        ],
    },
    "form": {
        "label": "录入页",
        "when": "用户来这里就是为了填一份东西。",
        "regions": [
            {
                # 出处：FormAdvancedForm / UserRegister 的 content ——
                # 「高级表单常见于一次性输入和提交大批量数据的场景。」
                # 长表单尤其需要这句：不说清楚，用户不知道自己要花多久。
                "key": "headerContent",
                "label": "页头说明",
                "why": "这份表单是干什么的、要填多少——写在标题下面",
                "weight": "supporting",
                "required": False,
                "accepts": ["entityRows"],
                "maxBlocks": 1,
            },
            {
                "key": "main",
                "label": "表单主体区",
                "why": "要填的字段",
                "weight": "primary",
                "required": True,
                "accepts": ["form"],
                "maxBlocks": 1,
            },
            {
                "key": "aside",
                "label": "辅助区",
                "why": "填到哪一步了，或者填写须知",
                "weight": "supporting",
                "required": False,
                "accepts": ["chain"],
                "maxBlocks": 1,
            },
            {
                # 出处：FormAdvancedForm 的 FooterToolbar —— 提交按钮和
                # 校验错误汇总固定在视口底部。长表单里这是**唯一**合理的
                # 位置：把提交按钮放在表单末尾，用户得滚到底才看得见它，
                # 也看不见自己错在哪。
                "key": "footerBar",
                "label": "底部操作条",
                "why": "提交按钮与校验错误固定在视口底部——长表单滚到底才见提交是灾难",
                "weight": "overlay",
                "required": False,
                "accepts": ["action"],
                "maxBlocks": 1,
            },
        ],
    },
    "kanban": {
        "label": "看板",
        "when": "记录有明确的状态流转，用户要靠拖动推进它们。",
        # 主体由**页面自带的视图**提供（那块按状态分列的棋盘），不是任何区块。
        # 这与运行时一致：AppRuntimeScreen 为 kanban/calendar 页渲染自己的视图，
        # 区块是围着它摆的。所以这类范式没有 primary 区域，Gate 的 no-primary
        # 检查要跳过它们——不加这个标记，规则就会要求一个不存在的东西。
        "pageOwnsMain": True,
        "regions": [
            {
                "key": "header",
                "label": "标题操作区",
                "why": "新增一张卡",
                "weight": "supporting",
                "required": True,
                "accepts": ["action", "form"],
                "maxBlocks": 2,
            },
            {
                "key": "filters",
                "label": "筛选区",
                "why": "卡片多到要按条件收窄",
                "weight": "secondary",
                "required": False,
                "accepts": ["filter"],
                "maxBlocks": 1,
            },
            {
                "key": "aside",
                "label": "辅助区",
                "why": "选中那张卡的明细，或流转记录",
                "weight": "supporting",
                "required": False,
                "accepts": ["entityRows", "timelineRows"],
                "maxBlocks": 2,
            },
        ],
    },
    "calendar": {
        "label": "日历页",
        "when": "记录挂在日期上，用户要按天/周/月看它们的分布并排新的。",
        "pageOwnsMain": True,
        "regions": [
            {
                "key": "header",
                "label": "标题操作区",
                "why": "排一件新的",
                "weight": "supporting",
                "required": True,
                "accepts": ["action", "form"],
                "maxBlocks": 2,
            },
            {
                "key": "filters",
                "label": "筛选区",
                "why": "只看某一类",
                "weight": "secondary",
                "required": False,
                "accepts": ["filter"],
                "maxBlocks": 1,
            },
            {
                "key": "aside",
                "label": "辅助区",
                "why": "选中那一天/那一件的明细",
                "weight": "supporting",
                "required": False,
                "accepts": ["entityRows", "timelineRows"],
                "maxBlocks": 2,
            },
        ],
    },
    "monitor": {
        "label": "总览页",
        "when": "首页。用户进来要知道「现在怎么样」并能立刻动手。",
        "regions": [
            {
                "key": "main",
                "label": "主体区",
                "why": "这摊业务当下的主线——流程走到哪、有什么在动",
                "weight": "primary",
                "required": True,
                "accepts": ["chain", "timelineRows"],
                "maxBlocks": 2,
            },
            {
                "key": "aside",
                "label": "辅助区",
                "why": "这个角色一天里最常做的那几件事",
                "weight": "supporting",
                "required": False,
                "accepts": ["action", "rankedRows"],
                "maxBlocks": 2,
            },
        ],
    },
}


def archetype_prompt_block() -> str:
    """把范式语法压成给模型看的说明。

    措辞照 schema_legal 里那条反复验证过的纪律：**祈使 + 说清不照做的代价**。
    07-28 记过，写成许可式时七个通电区块一个都没被用。
    """
    lines = [
        "PAGE ARCHETYPES — pick ONE, then fill its regions. You are laying out a page, "
        "not choosing components. Components come later and are resolved by the blocks "
        "themselves; you never name one.",
        "",
        "A region marked required MUST get at least one block. A list page with no list "
        "is not a list page — it will be rejected and you will have wasted the turn.",
        "",
    ]
    for key, arch in PAGE_ARCHETYPES.items():
        lines.append(f"{key} — {arch['label']}: {arch['when']}")
        for r in arch["regions"]:
            req = "required" if r["required"] else "optional"
            lines.append(
                f"    {r['key']} ({r['label']}, {r['weight']}, {req}, "
                f"max {r['maxBlocks']}): {r['why']}"
            )
        lines.append("")
    lines.append(
        "WEIGHT decides how much room a region gets: primary is the thing the user came "
        "for and takes the main area; secondary supports it; supporting sits in the narrow "
        "column; overlay costs no page space at all because it only appears on click. "
        "Give every page exactly one clear primary — a page where everything is the same "
        "size is a pile of cards, not a page."
    )
    # 下面这三条是从 ant-design/pro-blocks 那 29 个真实页面里读出来的习惯，
    # 不写进提示词的话模型不会主动用新区域——它们都是 optional，而 optional
    # 在模型眼里约等于"可以不管"。第一次实测正是这样：detail 页只用了
    # header/main/aside，把「状态」「金额」这类数丢在了主区里。
    lines.append("")
    lines.append(
        "WHERE THE KEY NUMBERS GO — this is the rule people get wrong most often:\n"
        "  On a dashboard, the key numbers ARE the page: use the full-width metrics "
        "region.\n"
        "  On a list or detail page they are NOT the page — the list or the record is. "
        "Put the two or three most important numbers in headerExtra, beside the title, "
        "where they cost no vertical space. A detail page of an order shows 状态 and "
        "订单金额 up there; a task list shows 我的待办 / 平均处理时间 / 本周完成. "
        "Never open a list or detail page with a full-width band of metric cards — it "
        "pushes the thing the user actually came for below the fold."
    )
    lines.append(
        "headerContent holds the few fields that must be visible on arrival (who created "
        "it, when, related documents) or one sentence saying what this page is for. Use "
        "it on detail pages and on long forms — not on every page."
    )
    lines.append(
        "footerBar pins actions to the bottom of the viewport. Use it when the action "
        "belongs to something the user scrolls through: submitting a long form, or acting "
        "on rows selected in a long table. Putting a submit button at the end of a long "
        "form means the user must scroll to the bottom to find it."
    )
    return "\n".join(lines)
