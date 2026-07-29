"""ActivityFeed 宽行档：variant + detailFieldRefs 的账本、校验与文案。

起因是拿参考图跟真实渲染对照：参考图把动态流画成一条满宽的信息行
（状态 | 单号 | 描述 | 关联单据 | 时间），真实渲染是一条窄时间轴，右边三分之二
全空。宽度不是 bug——积木拿到的就是满宽，是时间轴这个形态撑不满。

`detailFieldRefs` 是**数组型字段引用**，目录里第一个用上 entityFieldRefLists
的绑定键。校验口径必须跟单值的 entityFieldRefs 一样严：引用不存在的字段会让
渲染端画出一列空白，而空白列跟"这条记录这个字段没填"在界面上长得一模一样。
"""

import pytest
from pydantic import ValidationError

from services.freeform_block import _blockref_prompt_fragment, build_freeform_models
from services.schema_legal import EXPERIENCE_BLOCK_BINDING_SCHEMAS, EXPERIENCE_BLOCKS
from services.v5_model_gate import validate_five_system_model

DATAMODEL = {
    "entities": [
        {
            "id": "batch",
            "name": "批次",
            "fields": [
                {"id": "code", "name": "批次号", "type": "string"},
                {"id": "roasted_at", "name": "烘焙日期", "type": "date"},
                {"id": "weight", "name": "出豆重量", "type": "number"},
                {
                    "id": "status",
                    "name": "状态",
                    "type": "enum",
                    "options": [{"id": "done", "label": "已完成"}],
                },
            ],
        },
        {
            "id": "bean",
            "name": "生豆",
            "fields": [{"id": "origin", "name": "产地", "type": "string"}],
        },
    ]
}


def _validate_ref(block_ref):
    model = build_freeform_models(DATAMODEL)
    return model.model_validate(
        {"root": {"tag": "div", "children": [{"tag": "div", "blockRef": block_ref}]}}
    )


def _feed(**binding):
    return {
        "type": "ActivityFeed",
        "binding": {"entityRef": "batch", "timeFieldRef": "roasted_at", **binding},
    }


# ── 账本本身 ──────────────────────────────────────────────────────────


def test_catalog_declares_variant_and_detail_refs():
    entry = next(b for b in EXPERIENCE_BLOCKS if b["type"] == "ActivityFeed")
    variant = entry["propsSchema"]["properties"]["variant"]
    # 第一个取值是默认档——prompt 里明说"不写按第一个算"，顺序是契约不是巧合
    assert variant["enum"] == ["timeline", "row"]
    schema = EXPERIENCE_BLOCK_BINDING_SCHEMAS["ActivityFeed"]
    assert "detailFieldRefs" in schema["optional"]
    assert schema["entityFieldRefLists"]["detailFieldRefs"]["maxItems"] == 3


# ── blockRef 深校验（freeform 内嵌路径）────────────────────────────────


def test_detail_field_refs_accepted():
    tree = _validate_ref(_feed(detailFieldRefs=["code", "weight"]))
    assert tree.root.children[0].blockRef.binding["detailFieldRefs"] == ["code", "weight"]


def test_omitting_detail_field_refs_still_valid():
    """窄侧栏里用时间轴档，本来就不需要明细列。"""
    tree = _validate_ref(_feed())
    assert "detailFieldRefs" not in tree.root.children[0].blockRef.binding


def test_detail_field_must_exist_on_the_entity():
    with pytest.raises(ValidationError) as e:
        _validate_ref(_feed(detailFieldRefs=["code", "no_such_field"]))
    assert "no_such_field" in str(e.value)


def test_detail_field_from_another_entity_rejected():
    """bean.origin 是真字段，但不在 batch 上——取不到这一列的值。"""
    with pytest.raises(ValidationError) as e:
        _validate_ref(_feed(detailFieldRefs=["origin"]))
    assert "does not exist on entity 'batch'" in str(e.value)


def test_detail_field_refs_must_be_an_array():
    with pytest.raises(ValidationError) as e:
        _validate_ref(_feed(detailFieldRefs="code"))
    assert "array of field ids" in str(e.value)


def test_detail_field_refs_capped_at_three():
    with pytest.raises(ValidationError) as e:
        _validate_ref(_feed(detailFieldRefs=["code", "weight", "status", "roasted_at"]))
    assert "at most 3" in str(e.value)


def test_any_field_type_allowed_as_a_detail_column():
    """明细列不限类型——数字/日期/枚举都是合法的一列。"""
    tree = _validate_ref(_feed(detailFieldRefs=["weight", "status"]))
    assert tree.root.children[0].blockRef.binding["detailFieldRefs"] == ["weight", "status"]


# ── Gate 校验（page.blocks 路径）───────────────────────────────────────


# 复用 gate 测试那份完整模型：Gate 在缺技能段时会先短路报 missing section，
# 手搓半份模型根本走不到 binding 深校验（第一版就这么写的，四个 case 全空）。
from test_v5_llm_generate_gate import _valid_library_model  # noqa: E402


def _feed_findings(binding):
    model = _valid_library_model()
    model["page"]["pages"][0]["blocks"] = [
        {"id": "feed1", "type": "ActivityFeed", "binding": binding}
    ]
    gate = validate_five_system_model(model)
    return [f for f in gate["findings"] if "detailFieldRefs" in str(f.get("path", ""))]


def _lib_binding(**extra):
    # loan.due_date 是 date、loan.status 是 enum、loan.book_id 是 ref
    return {"entityRef": "loan", "timeFieldRef": "due_date", **extra}


def test_gate_accepts_good_detail_refs():
    assert _feed_findings(_lib_binding(detailFieldRefs=["status", "book_id"])) == []


def test_gate_flags_dangling_detail_ref():
    findings = _feed_findings(_lib_binding(detailFieldRefs=["ghost"]))
    assert findings and "ghost" in findings[0]["message"]


def test_gate_flags_non_array_detail_refs():
    findings = _feed_findings(_lib_binding(detailFieldRefs="status"))
    assert findings and "array of field ids" in findings[0]["message"]


def test_gate_flags_too_many_detail_refs():
    findings = _feed_findings(
        _lib_binding(detailFieldRefs=["status", "book_id", "id", "due_date"])
    )
    assert findings and "at most 3" in findings[0]["message"]


# ── prompt 得说得清 ───────────────────────────────────────────────────


def test_prompt_documents_variant_and_detail_refs():
    frag = _blockref_prompt_fragment()
    assert "detailFieldRefs" in frag
    assert "数组" in frag
    assert "最多 3 个" in frag
    assert "timeline/row" in frag
    # 只加档位不加字段的话宽行只是"更空"，这条提醒必须在
    assert "右边三分之二全是空的" in frag
