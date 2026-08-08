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
                "key": "metrics",
                "label": "指标区",
                "why": "几个关键数字，进来第一眼看的",
                "weight": "primary",
                "required": True,
                "accepts": ["aggregate"],
                "maxBlocks": 2,
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
    return "\n".join(lines)
