"""blockRef——把现成积木摆进 freeform 设计树。

freeform 的 dataRef 只能取聚合值，画不了逐行记录（排行榜/动态流）。以前的
做法是禁止它画、把这类内容赶到设计之外单独渲染；后来改成让它**挑一个现成
积木摆进自己的版式里**，渲染仍走那个积木经过测试的真渲染器。

**2026-08-03 起这条路是关着的**（用户裁决：首页只 LLM 生成，先不要固定
组件）——目录里 freeformEmbeddable 全 False，名单空，任何 blockRef 都被拒。
机制代码没删，所以这里的用例分两类：不带 fixture 的钉"关闭状态"，带
`embedding_on` 的把名单临时开回来、继续守着机制本身。

名单语义抄 Puck 的 DropZone allow（packages/core/lib/data/
is-component-allowed.ts）：allow 设了就只放行名单内的。
binding 深校验吃目录里那份 bindingSchema，与 Gate 校验 page.blocks 同源。
"""

import pytest

from services.freeform_block import _blockref_prompt_fragment, build_freeform_models
from services.schema_legal import (
    EXPERIENCE_BLOCKS,
    FREEFORM_EMBEDDABLE_BLOCK_TYPES,
)

DATAMODEL = {
    "entities": [
        {
            "id": "membership",
            "name": "会籍",
            "fields": [
                {"id": "paid_amount", "name": "实付金额", "type": "number"},
                {"id": "expiry_date", "name": "到期日", "type": "date"},
            ],
        },
        {
            "id": "attendance",
            "name": "出勤",
            "fields": [
                {"id": "check_in", "name": "签到时间", "type": "date"},
                {
                    "id": "status",
                    "name": "状态",
                    "type": "enum",
                    "options": [{"id": "ok", "label": "已出勤"}],
                },
            ],
        },
    ]
}


def _validate(block_ref):
    model = build_freeform_models(DATAMODEL)
    return model.model_validate(
        {"root": {"tag": "div", "children": [{"tag": "div", "blockRef": block_ref}]}}
    )


# ── 名单当前是空的（2026-08-03 用户裁决）────────────────────────────
#
# 「首页只 LLM 生成，先不要固定组件」——目录里四条 freeformEmbeddable 全部
# 置 False，blockRef 这条路整体关闭。**机制本身没有删**（"先"不要），所以
# 下面那些校验/prompt 用例仍然逐条跑，只是要先把名单临时开回来；这样将来
# 翻回 true 时是有测试护着的，而不是把一大片代码留在无人看管的状态。

PREVIOUSLY_EMBEDDABLE = ("RankedList", "ActivityFeed", "QuickActionPanel", "WorkflowTimeline")


@pytest.fixture
def embedding_on(monkeypatch):
    """把可嵌名单临时开回关闭前的那四个，用来测 blockRef 机制本身。

    两个模块各持一份引用（freeform_block 在 import 时取了值），两处都要打，
    只打一处会得到"prompt 里有清单、校验却全拒"的假象。
    """
    from services import freeform_block, schema_legal

    monkeypatch.setattr(schema_legal, "FREEFORM_EMBEDDABLE_BLOCK_TYPES", PREVIOUSLY_EMBEDDABLE)
    monkeypatch.setattr(freeform_block, "FREEFORM_EMBEDDABLE_BLOCK_TYPES", PREVIOUSLY_EMBEDDABLE)
    return PREVIOUSLY_EMBEDDABLE


def test_allowlist_is_derived_from_catalog():
    """名单不是手抄的常量，是目录里 freeformEmbeddable 的派生。

    当前目录里一条都没开 → 名单为空 → blockRef 整体关闭。这条同时钉住
    "派生关系"和"当前取值"：改目录会让它红，提醒把这次裁决的影响面走一遍。
    """
    expected = tuple(
        str(b["type"]) for b in EXPERIENCE_BLOCKS if b.get("freeformEmbeddable")
    )
    assert FREEFORM_EMBEDDABLE_BLOCK_TYPES == expected
    assert FREEFORM_EMBEDDABLE_BLOCK_TYPES == ()


def test_every_block_type_is_rejected_while_the_allowlist_is_empty():
    """名单空 = 谁都嵌不进来，包括从前放行的那四个。

    断言要咬住报错内容，不能只 pytest.raises(Exception)——这个文件里的
    _validate 拿错名字也会抛 NameError，那样测试变成永远绿的摆设。
    """
    for block_type in PREVIOUSLY_EMBEDDABLE:
        with pytest.raises(Exception) as exc:
            _validate({"type": block_type})
        assert "can not be embedded" in str(exc.value), block_type


def test_prompt_swaps_in_the_aggregate_only_wording_when_the_allowlist_is_empty():
    """名单空掉时不是"什么都不说"——那段话原本还负责告诉模型"逐行记录你画
    不出来"。只删不换，模型就会去硬画，得到表头加一片空白（这正是当初引入
    blockRef 的起因）。所以必须留下那半句，并把结论换成"改用聚合表达"。"""
    frag = _blockref_prompt_fragment()
    assert "画不出来" in frag
    assert "blockRef" not in frag
    assert "聚合" in frag


@pytest.mark.parametrize("blocked", ["MetricGrid", "TrendChart", "DataTable", "FilterBar", "FreeformInsight"])
def test_types_outside_the_allowlist_are_rejected(blocked, embedding_on):
    """名单之外一律拒——这几个各有各的理由：
    MetricGrid/TrendChart 跟 freeform 自画的 KPI/图表撞车（方案 C 已隔离）、
    DataTable 会把总览区撑爆、FilterBar 在总览页筛不动东西、
    FreeformInsight 自己嵌自己是无限递归。"""
    with pytest.raises(Exception) as exc:
        _validate({"type": blocked, "binding": {"entityRef": "membership"}})
    assert "can not be embedded" in str(exc.value)


def test_embeddable_implies_generation_enabled():
    """不变式：能被嵌 ⊆ 能被生成。放开嵌入却没放开生成，等于从侧门绕过灰度。"""
    for b in EXPERIENCE_BLOCKS:
        if b.get("freeformEmbeddable"):
            assert b.get("generationEnabled") is True, b["type"]
            assert b.get("rendererStatus") == "real", b["type"]


# ── 绑定深校验（与 Gate 同一本账）────────────────────────────────────

def test_valid_bindings_pass(embedding_on):
    _validate({"type": "RankedList", "binding": {"entityRef": "membership", "sortByRef": "paid_amount"}})
    _validate({
        "type": "ActivityFeed",
        "binding": {"entityRef": "attendance", "timeFieldRef": "check_in", "levelFieldRef": "status"},
    })


def test_field_type_must_match(embedding_on):
    """sortByRef 要 number，塞个 date 字段进去必须拒——不然排行榜排不出名次。"""
    with pytest.raises(Exception) as exc:
        _validate({"type": "RankedList", "binding": {"entityRef": "membership", "sortByRef": "expiry_date"}})
    assert "requires a number field" in str(exc.value)


def test_entity_and_field_must_exist(embedding_on):
    with pytest.raises(Exception):
        _validate({"type": "RankedList", "binding": {"entityRef": "ghost", "sortByRef": "x"}})
    with pytest.raises(Exception):
        _validate({"type": "RankedList", "binding": {"entityRef": "membership", "sortByRef": "no_such"}})


def test_required_keys_enforced(embedding_on):
    with pytest.raises(Exception) as exc:
        _validate({"type": "RankedList", "binding": {"entityRef": "membership"}})
    assert "missing required keys" in str(exc.value)


def test_unknown_binding_keys_rejected(embedding_on):
    """多写的键要拒——静默忽略会让模型以为它生效了，下次继续写。"""
    with pytest.raises(Exception) as exc:
        _validate({
            "type": "RankedList",
            "binding": {"entityRef": "membership", "sortByRef": "paid_amount", "nope": 1},
        })
    assert "unknown keys" in str(exc.value)


def test_enum_and_range_constraints(embedding_on):
    with pytest.raises(Exception):
        _validate({
            "type": "RankedList",
            "binding": {"entityRef": "membership", "sortByRef": "paid_amount", "sortOrder": "sideways"},
        })
    with pytest.raises(Exception):
        _validate({
            "type": "RankedList",
            "binding": {"entityRef": "membership", "sortByRef": "paid_amount", "limit": 99},
        })
    # 边界内的照过
    _validate({
        "type": "RankedList",
        "binding": {"entityRef": "membership", "sortByRef": "paid_amount", "sortOrder": "asc", "limit": 3},
    })


def test_binding_free_blocks_take_no_binding(embedding_on):
    """QuickActionPanel/WorkflowTimeline 不吃 binding，给了要拒——省得模型
    以为自己绑上了什么。"""
    _validate({"type": "QuickActionPanel"})
    _validate({"type": "WorkflowTimeline"})
    with pytest.raises(Exception) as exc:
        _validate({"type": "QuickActionPanel", "binding": {"entityRef": "membership"}})
    assert "does not take a binding" in str(exc.value)


# ── prompt ───────────────────────────────────────────────────────────

def test_prompt_lists_every_embeddable_type_and_nothing_else(embedding_on):
    """清单跟着**当前生效的名单**走。

    这里读 fixture 给的名单而不是模块级那份 import：目录已经全部关闭，
    模块级那份是空元组，照它断言这条会退化成"什么都不检查"。
    """
    frag = _blockref_prompt_fragment()
    for t in embedding_on:
        assert f"- {t}：" in frag
    for b in EXPERIENCE_BLOCKS:
        if b["type"] not in embedding_on:
            assert f"- {b['type']}：" not in frag


def test_prompt_states_the_two_easy_mistakes(embedding_on):
    """两条实测踩过的坑要写进 prompt：别自己套卡片（会套娃）、可选不必凑数。"""
    frag = _blockref_prompt_fragment()
    assert "不要再给这个节点套一层" in frag
    assert "可选" in frag


def test_freeform_insight_stays_out_of_generation_until_greylight_flips():
    """FreeformInsight 关着生成 → enrich_freeform_blocks 在生产路径上空转。

    这条不是重复 test_allowlist_*，它锁的是**另一件事**：那个函数的注释里
    写着"当前不处理任何区块"，而这个结论依赖三个可独立变动的事实。任何一个
    变了而注释没跟上，下一个读代码的人就会照着一份不成立的说明去理解系统
    （2026-08-01 审查里，正是这类"描述与代码不符"造成了最大的误判）。

    所以把三个事实一起钉住；灰度放开时这条会红，提醒同步更新注释，并按
    docs/enrich-pipeline-parallelization-audit-2026-07-31.md「四、2」先处理
    预算计数器的并发问题。
    """
    import json
    from pathlib import Path

    from services import schema_legal

    ff = next(b for b in schema_legal.EXPERIENCE_BLOCKS if b["type"] == "FreeformInsight")
    # ① 目录里关着生成
    assert ff.get("generationEnabled") is False
    # ② 生成契约把它列进 schema-only 并明令不许产出
    prompt = schema_legal.experience_block_prompt_block()
    assert "never emit them" in prompt
    assert "FreeformInsight" in prompt.split("never emit them")[1][:200]
    # ③ 演示域冻结夹具里一个都没有
    fixtures = Path(schema_legal.__file__).resolve().parent / "data" / "builtin_domain_models.json"
    assert "FreeformInsight" not in fixtures.read_text(encoding="utf-8")
