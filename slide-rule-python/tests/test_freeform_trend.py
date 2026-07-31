"""dataRef 的环比 / 迷你走势线声明（trendFieldRef + trendGrain）。

参考图上每张 KPI 卡都是「大数字 + 较昨日↑12% + 卡底一条迷你走势线」三层，
schema 此前只表达得了第一层。形状对标 ant-design/pro-components 的
StatisticCard（Statistic 的 trend/description + StatisticCard 的 chart 槽位）。

校验的重点跟 aggregate 一样是**引用必须落到真实字段上**：走势线是拿真实行
数据现算的，指到一个不存在的字段或一个 number 字段上，渲染端算不出来，
卡片就会退化成一个光秃秃的数字——生成时拦下来比运行时静默降级好。
"""

import pytest
from pydantic import ValidationError

from services.freeform_block import build_freeform_models

DATAMODEL = {
    "entities": [
        {
            "id": "invoice",
            "name": "账单",
            "fields": [
                {"id": "amount", "name": "金额", "type": "number"},
                {"id": "paid_at", "name": "收款日", "type": "date"},
                {"id": "title", "name": "标题", "type": "string"},
            ],
        },
        {
            "id": "member",
            "name": "会员",
            "fields": [{"id": "joined_at", "name": "入会日", "type": "date"}],
        },
    ]
}


def _validate(data_ref):
    model = build_freeform_models(DATAMODEL)
    return model.model_validate(
        {"root": {"tag": "div", "children": [{"tag": "div", "text": "12", "dataRef": data_ref}]}}
    )


# ── 合法声明 ──────────────────────────────────────────────────────────


def test_trend_field_on_date_field_passes():
    tree = _validate(
        {"entityRef": "invoice", "aggregate": "sum:amount", "trendFieldRef": "paid_at"}
    )
    ref = tree.root.children[0].dataRef
    assert ref.trendFieldRef == "paid_at"
    # 不填粒度是合法的——渲染端默认按天，不强迫模型每次都写一遍
    assert ref.trendGrain is None


@pytest.mark.parametrize("grain", ["day", "week", "month"])
def test_all_three_grains_pass(grain):
    tree = _validate(
        {"entityRef": "invoice", "aggregate": "count", "trendFieldRef": "paid_at", "trendGrain": grain}
    )
    assert tree.root.children[0].dataRef.trendGrain == grain


def test_trend_without_aggregate_passes():
    """aggregate 可省（纯引用实体），此时走势线按条数算——不是错误声明。

    text 得换成非数值文案：「数值必须挂 dataRef 聚合」那条终检是另一条独立
    规则，会先把带数字的文本拦下来，测不到这里要测的东西。
    """
    model = build_freeform_models(DATAMODEL)
    tree = model.model_validate(
        {
            "root": {
                "tag": "div",
                "children": [
                    {
                        "tag": "div",
                        "text": "收款走势",
                        "dataRef": {"entityRef": "invoice", "trendFieldRef": "paid_at"},
                    }
                ],
            }
        }
    )
    assert tree.root.children[0].dataRef.aggregate is None
    assert tree.root.children[0].dataRef.trendFieldRef == "paid_at"


def test_no_trend_declared_stays_none():
    """绝大多数数字没有时间维度，两个键都不填必须仍然合法。"""
    tree = _validate({"entityRef": "invoice", "aggregate": "count"})
    ref = tree.root.children[0].dataRef
    assert ref.trendFieldRef is None and ref.trendGrain is None


# ── 非法声明 ──────────────────────────────────────────────────────────


def test_trend_field_must_exist():
    with pytest.raises(ValidationError) as e:
        _validate({"entityRef": "invoice", "aggregate": "count", "trendFieldRef": "created_at"})
    assert "trendFieldRef" in str(e.value) and "does not exist" in str(e.value)


def test_trend_field_must_be_date_not_number():
    with pytest.raises(ValidationError) as e:
        _validate({"entityRef": "invoice", "aggregate": "count", "trendFieldRef": "amount"})
    assert "date" in str(e.value)


def test_trend_field_must_be_date_not_string():
    with pytest.raises(ValidationError):
        _validate({"entityRef": "invoice", "aggregate": "count", "trendFieldRef": "title"})


def test_trend_field_must_be_on_the_same_entity():
    """member.joined_at 是真 date 字段，但不在 invoice 上——跨实体取不到行。"""
    with pytest.raises(ValidationError) as e:
        _validate({"entityRef": "invoice", "aggregate": "count", "trendFieldRef": "joined_at"})
    assert "does not exist on entity 'invoice'" in str(e.value)


def test_bad_grain_rejected():
    with pytest.raises(ValidationError) as e:
        _validate(
            {
                "entityRef": "invoice",
                "aggregate": "count",
                "trendFieldRef": "paid_at",
                "trendGrain": "quarter",
            }
        )
    assert "day, week, month" in str(e.value)


def test_grain_without_field_rejected():
    """只给粒度不给字段是半句话——静默忽略等于模型以为自己声明了走势线。"""
    with pytest.raises(ValidationError) as e:
        _validate({"entityRef": "invoice", "aggregate": "count", "trendGrain": "week"})
    assert "trendFieldRef" in str(e.value)


# ── prompt 得说得清 ───────────────────────────────────────────────────


def test_prompt_documents_trend_keys():
    from services.freeform_block import build_freeform_prompt

    prompt = build_freeform_prompt("设计说明", DATAMODEL)
    assert "trendFieldRef" in prompt
    assert "trendGrain" in prompt
    # 关键约束都得在 prompt 里，否则只能靠 reask 试错
    assert "date" in prompt
    for grain in ('"day"', '"week"', '"month"'):
        assert grain in prompt
    # 渲染端会自己算这两层，模型不该再写死一个百分比文字
    assert "不要自己再写一个写死的百分比" in prompt
