"""首页设计 brief 必须把 `page.blocks` 说出来（2026-08-12）。

## 这条护栏是怎么来的

用户问"怎么每次生成的首页长得都差不多"，顺着查下去逮到一处**断线**：

`_monitor_overview_design_brief` 里拼「逐行内容」清单的两个循环只读
`page.rankings` 和 `page.feeds`——那是**旧字段**。模型现在把逐行内容声明在
`page.blocks` 里，于是这份 brief 对它们一个字都不提。

代价不是"少说一句"，是**内容凭空消失**：首页有 freeformOverview 时前端
`freeformOwnsPage` 成立，`renderExperienceBlockScaffold` 直接 return null
（"设计树没安置的积木不再外挂到设计区下面"）。整条链是——

    模型声明了 → 门禁批准了 → brief 不提 → 设计模型不画 → 脚手架被抑制
    → 这两个积木在首页上哪儿都不在

两趟真实产出逐字复现：线上「采购智审」与本地「退费审批」的首页都声明了
`ApprovalQueue + ActivityFeed`，`rankings`/`feeds` 全空，成品首页 rowsRef 节点
数都是 **0**。这也是"首页看着都一样"的一个直接原因：首页唯一能带来差异的通道
（这一页自己声明了什么积木）被断开了，剩下能说的只有 stats/charts 那套固定
词汇（count / sum / 环图 / 趋势线）。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import _monitor_overview_design_brief


def _page(blocks=None, rankings=None, feeds=None, kind="monitor"):
    return {
        "id": "home",
        "name": "运营总览",
        "kind": kind,
        "stats": [{"id": "s1", "name": "待处理", "entity": "refund", "metric": "count"}],
        "charts": [
            {"id": "c1", "name": "状态分布", "type": "donut",
             "metric": "count", "dimension": "refund.status"}
        ],
        "blocks": blocks or [],
        "rankings": rankings or [],
        "feeds": feeds or [],
    }


_DATAMODEL = {
    "entities": [
        {"id": "refund", "name": "退费申请", "fields": [
            {"id": "no", "name": "单号", "type": "string"},
            {"id": "status", "name": "状态", "type": "enum",
             "options": [{"id": "待审"}, {"id": "已过"}]},
            {"id": "submitted_at", "name": "提交时间", "type": "date"},
        ]},
        {"id": "audit_log", "name": "审计日志", "fields": [
            {"id": "occurred_at", "name": "发生时间", "type": "date"},
            {"id": "action", "name": "动作", "type": "string"},
        ]},
    ]
}

_QUEUE = {
    "id": "b1", "type": "ApprovalQueue", "props": {"title": "待我处理"},
    "binding": {"entityRef": "refund", "titleFieldRef": "no", "statusFieldRef": "status"},
}
_FEED = {
    "id": "b2", "type": "ActivityFeed", "props": {"title": "最近动态"},
    "binding": {"entityRef": "audit_log", "timeFieldRef": "occurred_at",
                "levelFieldRef": "action"},
}


def test_声明在_blocks_里的逐行积木必须进_brief() -> None:
    brief = _monitor_overview_design_brief(_page(blocks=[_QUEUE, _FEED]), _DATAMODEL)
    assert "逐行内容" in brief, brief
    # 标题、类型、实体、可用字段都要给到——只给类型名模型绑不上数据
    assert "待我处理" in brief
    assert "ApprovalQueue" in brief
    assert '"refund"' in brief
    assert "最近动态" in brief
    assert '"audit_log"' in brief


def test_没有任何逐行积木时不出这段() -> None:
    """反向断言：这条护栏不能靠"brief 里总有'逐行内容'四个字"混过去。"""
    brief = _monitor_overview_design_brief(_page(), _DATAMODEL)
    assert "逐行内容" not in brief, brief


def test_不是逐行形态的积木不进逐行清单() -> None:
    """流程条/动作面没有 rowsRef 画法，塞进"逐行内容"只会让模型画出空表。

    这是 rankings/feeds 当初被限制在聚合值上的同一条理由。
    """
    chain = {"id": "b3", "type": "WorkflowTimeline", "props": {"title": "审批流程"},
             "binding": {"entityRef": "refund"}}
    brief = _monitor_overview_design_brief(_page(blocks=[chain]), _DATAMODEL)
    assert "逐行内容" not in brief, brief
    # 但出图受众那一份仍然要描述它（参照板上该画一条流程阶段条）
    image = _monitor_overview_design_brief(
        _page(blocks=[chain]), _DATAMODEL, audience="image"
    )
    assert "流程阶段条" in image, image


def test_同一份内容声明两遍只说一次() -> None:
    """page.feeds 和 page.blocks 常常声明同一份动态流（真跑逮到过）。

    指纹口径与前端 page-panel-dedupe 一致：类型 + 实体 + 关键字段。
    """
    feed_legacy = {"id": "f1", "name": "最近动态", "entity": "audit_log",
                   "timeField": "audit_log.occurred_at", "levelField": "audit_log.action"}
    brief = _monitor_overview_design_brief(
        _page(blocks=[_FEED], feeds=[feed_legacy]), _DATAMODEL
    )
    # 只数**清单行**（以 "- " 开头的那些）。底下"可选的只有这几块"会把名字再
    # 列一遍，那是取舍规则要用的，不算重复摆卡。
    listed = [l for l in brief.split("\n") if l.startswith("- ") and "最近动态" in l]
    assert len(listed) == 1, listed

    # 反向：字段书写顺序不同的两份声明也要被认成同一份（不排序就会漏掉）
    reordered = dict(_FEED)
    reordered["binding"] = {"levelFieldRef": "action", "entityRef": "audit_log",
                            "timeFieldRef": "occurred_at"}
    again = _monitor_overview_design_brief(
        _page(blocks=[reordered], feeds=[feed_legacy]), _DATAMODEL
    )
    assert len([l for l in again.split("\n") if l.startswith("- ")]) == 1, again


def test_没有参照图时不许说_图上没有就不要画() -> None:
    """措辞必须跟着"这一趟有没有参照图"分岔。

    生图未配置时（线上与本地当前都是这样）压根没有参照图，而"参照图上画了就画、
    没有就不要画"这条规则字面上等于**什么都不要画**。接回 page.blocks 之前
    row_bits 恒为空所以没人撞上；接回来之后它天天生效。
    """
    with_ref = _monitor_overview_design_brief(
        _page(blocks=[_QUEUE]), _DATAMODEL, has_reference=True
    )
    without = _monitor_overview_design_brief(
        _page(blocks=[_QUEUE]), _DATAMODEL, has_reference=False
    )
    # 有图：照旧按图取舍
    assert "参照图上没有" in with_ref
    # 没图：不许再拿"图上有没有"当判据（说"这一趟没有参照图"本身是对的、
    # 而且有用——那是在告诉模型别等一张不存在的图）
    assert "参照图上没有" not in without, without
    assert "按参照图定" not in without, without
    assert "没有参照图" in without
    assert "打开最先要做什么" in without
    # 反向：两种措辞必须真的不同，否则这条在空转
    assert with_ref != without


def test_默认值保持旧行为() -> None:
    """不传 has_reference 时等于"有参照图"——老调用方零破坏。"""
    assert _monitor_overview_design_brief(
        _page(blocks=[_QUEUE]), _DATAMODEL
    ) == _monitor_overview_design_brief(
        _page(blocks=[_QUEUE]), _DATAMODEL, has_reference=True
    )
