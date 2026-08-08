"""页面装配的 Gate —— 把"组件示例合集"挡在外面。

## 这套东西是为了修什么

2026-08-08 用户拿一张实测截图指出来：AI「组装」出的「库存管理」页是
Menu 一张大卡、Input 一张卡、Button 一张卡、Table 一张卡、Pagination 又
单独一张卡，表格内容还是「甲/乙/12/34」，Input 里还是「基本用法/带前缀/
密码/多行文本」。

**那是 Ant Design 组件示例合集换了个标题。**

用户的诊断：根因不是模型不会排版，是装配目标错了。链路是

    意图 → 需要哪些组件 → 排出来

模型收到的任务实际上变成"从组件库选几个组件并排列"，它确实完成了。正确的
链路多两层：意图 → 页面范式 → 业务区域 → 区块 → 组件实例，**组件是最后
一步，不是第二步**。

## 为什么 Gate 用规则而不是再喂给一个聪明模型

用户原话：「这种根本不需要再让一个超级聪明的模型凭感觉判断，规则检查就可以
直接打回重生成。」他列的那批症状都有明确特征——分页脱离表格、标题是 demo
文案、页面没有主次、绑了不存在的字段——一条规则一个准，而且能给出"哪里错了"
让下一轮直接修。让模型判反而慢、贵、还不稳定。

这个文件钉的就是：**那张坏页面的每一条毛病都必须被判死**。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.page_archetypes import PAGE_ARCHETYPES, WEIGHTS
from services.page_assembler import _block_menu, gate

DM = {
    "entities": [
        {
            "id": "product",
            "name": "商品",
            "fields": [
                {"id": "name", "name": "商品名称", "type": "string"},
                {"id": "sku", "name": "SKU", "type": "string"},
                {"id": "stock", "name": "当前库存", "type": "number"},
                {"id": "status", "name": "库存状态", "type": "enum"},
            ],
        }
    ]
}

GOOD = {
    "archetype": "list",
    "name": "商品库存",
    "tasks": ["查库存", "筛选缺货商品", "新增商品", "补货"],
    "regions": {
        "header": [{"type": "QuickActionPanel", "props": {"title": "常用操作"}}],
        "filters": [{"type": "FilterBar", "props": {"title": "筛选商品"}}],
        "main": [
            {
                "type": "DataTable",
                "props": {"title": "商品库存"},
                "binding": {"entityRef": "product"},
            }
        ],
        "overlay": [
            {
                "type": "RecordFormDialog",
                "props": {"title": "新增商品"},
                "binding": {"entityRef": "product", "fieldRefs": ["name", "sku"]},
            }
        ],
    },
}


def codes(page, dm=DM):
    return {f["code"] for f in gate(page, dm)}


def test_a_well_formed_page_passes():
    """先钉住"对的能过"——只会说不的 Gate 等于把功能关掉。"""
    assert gate(GOOD, DM) == []


def test_the_screenshot_page_is_rejected_on_every_count():
    """用户那张截图页的每一条毛病都要被判出来。

    这是这套东西成不成立的判据：Gate 要是放它过去，加这一层就白加了。
    """
    bad = {
        "archetype": "list",
        "name": "库存管理",
        "tasks": [],  # 说不出用户要干什么
        "regions": {
            # 筛选区塞了个表格（能力不匹配）；标题是 demo 文案
            "filters": [
                {
                    "type": "DataTable",
                    "props": {"title": "基本用法"},
                    "binding": {"entityRef": "product"},
                }
            ],
            # 主体区空着——库存管理页没有列表
            "aside": [
                {
                    "type": "RecordDetail",
                    "props": {"title": "主按钮"},
                    "binding": {"entityRef": "warehouse"},  # 不存在的实体
                }
            ],
        },
    }
    got = codes(bad)
    for expected in (
        "missing-required-region",  # 必填区域空着
        "capability-mismatch",  # 区块落进不收它的区域
        "no-primary",  # 没有主次 → 一排等大卡片
        "demo-content",  # 标题是组件示例文案
        "dangling-entity",  # 绑了不存在的实体
        "no-tasks",  # 说不出用户在这一页干什么
    ):
        assert expected in got, f"没判出 {expected}，实际判出 {sorted(got)}"


def test_demo_words_are_rejected_even_in_an_otherwise_valid_page():
    """demo 文案单独拎出来验一次。

    这条对应用户指的「AI 在复用组件示例，不是组件能力」——Definition /
    Demo / Instance 是三样东西，模型只能引用 Definition、产出 Instance。
    标题里出现「基本用法」「主按钮」就是把 Demo 当成了业务内容。
    """
    page = {**GOOD, "regions": {**GOOD["regions"]}}
    page["regions"]["main"] = [
        {
            "type": "DataTable",
            "props": {"title": "基本用法"},
            "binding": {"entityRef": "product"},
        }
    ]
    assert "demo-content" in codes(page)


def test_a_page_without_a_primary_region_is_rejected():
    """没有主区域 = 五个组件五张差不多大的卡片。

    用户指的第 5 条：「AI 没有视觉主次的概念……否则很容易继续生成
    五个组件 = 五个差不多大的卡片」。
    """
    page = {
        "archetype": "list",
        "name": "x",
        "tasks": ["一", "二"],
        "regions": {
            "header": [{"type": "QuickActionPanel", "props": {"title": "操作"}}],
            "filters": [{"type": "FilterBar", "props": {"title": "筛选"}}],
        },
    }
    assert "no-primary" in codes(page)
    assert "missing-required-region" in codes(page)


def test_region_capacity_is_enforced():
    """区域有容量。塞满一个区域等于把主次抹平。"""
    page = {
        **GOOD,
        "regions": {
            **GOOD["regions"],
            "main": [
                {"type": "DataTable", "props": {"title": "商品库存"},
                 "binding": {"entityRef": "product"}},
                {"type": "RecordDetail", "props": {"title": "商品明细"},
                 "binding": {"entityRef": "product"}},
            ],
        },
    }
    assert "region-overflow" in codes(page)


def test_the_model_never_sees_a_base_component():
    """给模型的清单里**一个基础组件都不能有**。

    这是整套改动的关窍。此前给的是 137 个 antd/antd-mobile 组件，于是模型
    照着示例拼；现在给的是业务区块，基础组件由区块自己解析（DataTable 内部
    用 antd Table，FilterBar 内部用 QueryFilter），模型从头到尾不会命名一个
    组件。

    这条会在有人"顺手"把基础组件塞回候选集时红。
    """
    menu = _block_menu()
    names = {b["type"] for b in menu}
    # 基础组件的特征：antd 的组件名，以及移动端的 M. 前缀
    for forbidden in ("Button", "Input", "Select", "Table", "Pagination", "Menu"):
        assert forbidden not in names, f"{forbidden} 是基础组件，不该出现在装配候选里"
    assert not any(n.startswith("M.") for n in names), "移动端基础组件不该出现"
    # 每条都得说清能力与绑定要求，否则模型没法按能力选
    for b in menu:
        assert b["capability"], f"{b['type']} 没有 capability"
        assert b["does"], f"{b['type']} 没有说明"


def test_every_archetype_has_exactly_one_primary_region():
    """每种范式必须**正好一个** primary 区域。

    零个 → 模型无处安放"用户来这一页要干的那件事"。
    两个 → 主次又回到平的，Gate 的 no-primary 也就管不住了。
    """
    for key, arch in PAGE_ARCHETYPES.items():
        primaries = [r for r in arch["regions"] if r["weight"] == "primary"]
        if arch.get("pageOwnsMain"):
            # 看板/日历：主体是页面自带的视图（棋盘、月历），不是区块，
            # 所以正好**没有** primary 区域。这与运行时一致。
            assert not primaries, f"{key} 标了 pageOwnsMain 就不该再有主区域"
            continue
        assert len(primaries) == 1, f"{key} 有 {len(primaries)} 个主区域"
        for r in arch["regions"]:
            assert r["weight"] in WEIGHTS, f"{key}.{r['key']} 权重非法"
            assert r["accepts"], f"{key}.{r['key']} 没说收哪类区块"
            assert r["why"], f"{key}.{r['key']} 没说这个区域是干什么的"


def test_required_regions_are_reachable_with_the_blocks_we_actually_have():
    """每个必填区域都必须**真的有区块能填**。

    语法里写着"必填"、而候选集里没有任何区块的 capability 对得上，那就是
    一条永远过不了的规则——模型每次都被打回，日志里看着像模型不听话。
    """
    caps = {b["capability"] for b in _block_menu()}
    for key, arch in PAGE_ARCHETYPES.items():
        for r in arch["regions"]:
            if not r["required"]:
                continue
            assert caps & set(r["accepts"]), (
                f"{key}.{r['key']} 必填，但没有任何区块能填它"
                f"（收 {r['accepts']}，现有能力 {sorted(caps)}）"
            )
