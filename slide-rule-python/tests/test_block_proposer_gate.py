"""区块提议的 Gate。

## 这条链路的两次组装是不同的东西

用户 2026-08-08 定的链路：基础组件 → 区块 → 模板。于是有两个「AI 组装」：

    组装模板：从现有区块里挑，摆进页面区域   → 产物是数据，直接能渲染
    组装区块：从基础组件里挑，定义一个新区块 → 产物是契约，还要人实现渲染器

第二个不生成代码。这是查 GitHub 之后的判断，不是偷懒：`ant-design/pro-blocks`
里官方那 29 个「区块」（分析页/监控页/工作台/查询表格/基础详情/高级详情/
基础表单/高级表单/分步表单/标准列表/卡片列表/搜索列表…）**全是手写 React
源码**，`umi block add` 做的是把源码拷进你的项目，是脚手架不是运行时拼装。
区块 = schema + 逻辑 + 关联，逻辑就是代码。

## 这个文件钉的

提案得**真的有用**。最要害的一条是 no-new-coverage：现在 139 个基础组件里
118 个没被任何区块用上，提案要是全用已经接进区块的素材，那 118 还是 118，
提了等于没提。这条一红，整个功能就没有意义了。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.block_proposer import (
    MAX_PROPOSALS,
    REGION_CAPABILITIES,
    REGION_KEYS,
    existing_blocks,
    gate,
)

BASE = {"Alert", "Checkbox", "Button", "Space", "Table", "Tag", "Segmented", "Badge"}
UNLINKED = {"Alert", "Checkbox", "Segmented", "Badge"}

# 例子刻意用一个**还不存在**的区块名。2026-08-08 这里踩过一次：原来的例子叫
# BatchActionBar，等它真的建出来之后这条用例当场红——red 得对，duplicate-block
# 正是该判的，但拿现有区块当"合格样例"本身就是错的。
GOOD = {
    "proposals": [
        {
            "type": "ColumnSettingPanel",
            "label": "列设置面板",
            "capability": "action",
            "does": "让用户挑表格显示哪些列、调整列顺序，选择记在本地",
            "uses": ["Alert", "Checkbox", "Button", "Space"],
            "regions": ["main", "header"],
            "props": ["title", "actions"],
            "binding": {"required": ["entityRef"], "optional": ["fieldRefs"]},
            "why": "字段多的表格一屏放不下，现在只能靠横向滚动，用户没法只留自己关心的列",
        }
    ]
}


def codes(payload, base=BASE, unlinked=UNLINKED):
    return {f["code"] for f in gate(payload, base, unlinked)}


def test_a_well_formed_proposal_passes():
    """先钉住"对的能过"——只会说不的 Gate 等于把功能关掉。"""
    assert gate(GOOD, BASE, UNLINKED) == []


def test_a_proposal_that_releases_nothing_is_rejected():
    """**这条是整个功能的判据。**

    139 个基础组件里 118 个没接进任何区块。提议新区块的全部意义就是把那批
    素材用起来；一个只用已接入组件搭的提案，覆盖缺口一个没动，纯属换个名字
    再来一遍。
    """
    p = {
        "proposals": [
            {
                **GOOD["proposals"][0],
                "type": "AnotherToolbar",
                "uses": ["Button", "Space", "Table"],  # 全是已接入的
            }
        ]
    }
    assert "no-new-coverage" in codes(p)


def test_inventing_a_base_component_is_rejected():
    """模型很爱顺手编一个组件名。编了就等于这个区块建不出来。"""
    p = {"proposals": [{**GOOD["proposals"][0], "uses": ["Alert", "SuperMegaGrid"]}]}
    assert "unknown-base-component" in codes(p)


def test_reproposing_an_existing_block_is_rejected():
    """提一个已经有的，等于没提。"""
    existing = existing_blocks()[0]["type"]
    p = {"proposals": [{**GOOD["proposals"][0], "type": existing}]}
    assert "duplicate-block" in codes(p)


def test_a_block_with_no_binding_is_rejected():
    """不绑数据的不是区块，是装饰。

    这正是用户区分三层时说的：基础组件是纯 schema，区块要「加逻辑加关联」。
    没有 binding 的提案还停在基础组件那一层。
    """
    p = {"proposals": [{**GOOD["proposals"][0], "binding": {"optional": ["x"]}}]}
    assert "no-binding" in codes(p)


def test_a_capability_no_region_accepts_is_rejected():
    """能力面之外的区块建出来也没地方放——页面上没有任何区域会收它。"""
    p = {"proposals": [{**GOOD["proposals"][0], "capability": "vibes"}]}
    assert "unknown-capability" in codes(p)


def test_a_region_that_does_not_exist_is_rejected():
    p = {"proposals": [{**GOOD["proposals"][0], "regions": ["sidebar-left"]}]}
    assert "unknown-region" in codes(p)


def test_a_proposal_without_a_reason_is_rejected():
    """「why」要指出今天被伺候得不好的那个具体场景。

    没有它就没法判断该不该建——提案会退化成"再加个区块总是好的"。
    """
    p = {"proposals": [{**GOOD["proposals"][0], "why": "  "}]}
    assert "no-why" in codes(p)


def test_empty_and_oversized_batches_are_rejected():
    assert "no-proposals" in codes({"proposals": []})
    many = {
        "proposals": [
            {**GOOD["proposals"][0], "type": f"Block{i}"} for i in range(MAX_PROPOSALS + 2)
        ]
    }
    assert "too-many" in codes(many)


def test_the_capability_and_region_vocabularies_come_from_the_archetypes():
    """能力面与区域名不许在这里另写一份。

    页面范式那边已经定了哪些区域收哪些能力。这边要是自己维护一份清单，两边
    迟早分叉——提案过了这道 Gate，装配时却发现没有区域收它。
    """
    from services.page_archetypes import PAGE_ARCHETYPES

    caps = {c for a in PAGE_ARCHETYPES.values() for r in a["regions"] for c in r["accepts"]}
    keys = {r["key"] for a in PAGE_ARCHETYPES.values() for r in a["regions"]}
    assert REGION_CAPABILITIES == caps
    assert REGION_KEYS == keys
