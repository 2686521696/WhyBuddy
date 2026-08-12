"""props/binding 放错口袋的确定性修复（2026-08-12）。

## 现场

用户圈了线上产物「团长管理」那张表：显示的是姓名/手机号/加入日期，而模型
明明点名要「成团率 / 退款率 / 团长绩效分」。翻模型才看见声明长这样：

    {"type": "DataTable",
     "props":   {"title": "团长列表", "fieldRefs": [...]},   ← 写错口袋
     "binding": {"entityRef": "community_leader"}}

契约里 fieldRefs 属于 **binding**（DataTable.bindingSchema.optional），
propsSchema 是 additionalProperties:false 且没有这个键。渲染端读 binding，
读不到就退回"从真实行的键里取前 8 个"——模型说的话一个字没生效，全程零报错。

## 全量核过，不是孤例

线上 12 个已存应用 144 个区块逐键对目录核了一遍：

    props 里出现目录未声明的键   29 处，一半的应用中招
    其中 fieldRefs               17 处（DataTable 7 / RecordDetail 5 /
                                        RecordFormDialog 4 / StepsForm 1）
    17 处里 binding 已有该键的     0 处   ← 全是搬错家，没有一次是两边都写

剩下 12 处是模型自己编的键（FilterBar.filterFields、QuickActionPanel.actions、
ApprovalQueue.pendingStatus、BookingConflictDrawer.title），逐个查过渲染器
源码：**一个都没被读到**。

## 两种处方，判据是"目录里有没有它的位置"

    键在 bindingSchema 里 → 搬回 binding（位置错了，意图是清楚的）
    键两边都没有         → 剔除（看着像声明过、其实没有任何效果）

修完再过门禁：字段名真不真实、类型对不对，仍由 binding 深校验查，修复不替它背书。
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.v5_model_repair import repair_five_system_model  # noqa: E402
from services.v5_model_gate import validate_five_system_model  # noqa: E402


def _model(blocks, entity_fields=("name", "completion_rate", "refund_rate")):
    """一份**完整**的五系统模型。

    六段都得填齐：任何一段空着，门禁会先报 EMPTY_SKILL_SECTION 然后短路，
    根本走不到 page.blocks 那一层——第一版就是拿骨架模型测的，两条用例
    因此空绿了半分钟，直到把门禁的返回值打印出来才看见。
    """
    return {
        "datamodel": {
            "entities": [{
                "id": "leader",
                "name": "团长",
                "fields": [{"id": f, "name": f, "type": "string"} for f in entity_fields],
            }]
        },
        "rbac": {
            "roles": ["运营"],
            "permissions": ["leader:read"],
            "menus": [{
                "id": "m1", "label": "团长",
                "roleRefs": ["运营"], "permissionRefs": ["leader:read"],
            }],
        },
        "workflow": {"nodes": [{"id": "n1", "name": "开始", "phase": "start"}], "transitions": []},
        "aigc": {"capabilities": []},
        "page": {"pages": [{"id": "p1", "name": "团长管理", "kind": "workbench", "blocks": blocks}]},
        "appbundle": {"roleRefs": ["运营"], "dataModelRefs": ["leader"], "landingPageRef": "p1"},
    }


def _blocks_of(result):
    return result["model"]["page"]["pages"][0]["blocks"]


def test_fieldrefs_moves_from_props_to_binding():
    """核心那一条：位置错了就搬，值一个不改。"""
    out = repair_five_system_model(_model([{
        "id": "t1", "type": "DataTable",
        "props": {"title": "团长列表", "fieldRefs": ["name", "completion_rate"]},
        "binding": {"entityRef": "leader"},
    }]))
    block = _blocks_of(out)[0]
    assert block["binding"]["fieldRefs"] == ["name", "completion_rate"]
    assert "fieldRefs" not in block["props"], "props 里那份没清掉，等于两个真相源"
    assert block["props"]["title"] == "团长列表", "合法的 props 被误伤了"
    assert {n["action"] for n in out["blockPropsPlacement"]} == {"moved-to-binding"}


def test_binding_wins_when_both_sides_declare_it():
    """两边都写时以 binding 为准 —— 它在对的位置上。"""
    out = repair_five_system_model(_model([{
        "id": "t1", "type": "DataTable",
        "props": {"fieldRefs": ["name"]},
        "binding": {"entityRef": "leader", "fieldRefs": ["completion_rate"]},
    }]))
    block = _blocks_of(out)[0]
    assert block["binding"]["fieldRefs"] == ["completion_rate"]
    assert "fieldRefs" not in block["props"]
    assert out["blockPropsPlacement"][0]["action"] == "dropped-duplicate"


def test_unknown_prop_is_dropped_not_smuggled_into_binding():
    """目录两边都没有的键：剔除，**不许**顺手塞进 binding 蒙混过关。"""
    out = repair_five_system_model(_model([{
        "id": "q1", "type": "QuickActionPanel",
        "props": {"title": "快捷操作", "actions": ["新建", "导出"]},
    }]))
    block = _blocks_of(out)[0]
    assert "actions" not in block["props"]
    assert "actions" not in block.get("binding", {}), "编出来的键被塞进 binding 了"
    assert block["props"]["title"] == "快捷操作"
    assert out["blockPropsPlacement"][0]["action"] == "dropped-unknown"


def test_legal_model_is_untouched():
    """本来就写对的模型一个字都不该动 —— 修复器不许有副作用。"""
    blocks = [{
        "id": "t1", "type": "DataTable",
        "props": {"title": "团长列表"},
        "binding": {"entityRef": "leader", "fieldRefs": ["name"]},
    }]
    before = json.dumps(_model(blocks), sort_keys=True)
    out = repair_five_system_model(_model(blocks))
    assert out["blockPropsPlacement"] == []
    assert json.dumps(out["model"], sort_keys=True) == before


def test_repair_does_not_vouch_for_the_field_names():
    """搬完照样过门禁：搬进去的是不存在的字段，门禁必须照报不误。

    这条守的是边界——修复只负责"把话放对口袋"，不负责"这话是不是真的"。
    两件事混在一起的话，修复就成了绕过门禁的后门。
    """
    out = repair_five_system_model(_model([{
        "id": "t1", "type": "DataTable",
        "props": {"fieldRefs": ["no_such_field"]},
        "binding": {"entityRef": "leader"},
    }]))
    assert _blocks_of(out)[0]["binding"]["fieldRefs"] == ["no_such_field"]
    result = validate_five_system_model(out["model"])
    findings = result.get("findings", []) if isinstance(result, dict) else result
    assert any(
        "no_such_field" in f.get("message", "") or "no_such_field" == f.get("ref")
        for f in findings
    ), "搬进 binding 的假字段没人查了 —— 修复变成了门禁的后门"


def test_gate_reports_stray_props_when_repair_is_skipped():
    """门禁那一层的兜底：没跑修复时，多余的 props 键要如实报。

    正常链路上修复排在门禁之前，所以门禁看到的应该永远是 0（线上 12 个模型
    实测正是如此）。这条测的是"绕过修复"的那条路——判据别只挂在修复上。
    """
    result = validate_five_system_model(_model([{
        "id": "q1", "type": "QuickActionPanel",
        "props": {"actions": ["新建"]},
    }]))
    findings = result.get("findings", []) if isinstance(result, dict) else result
    assert any(f.get("path", "").endswith(".props.actions") for f in findings), \
        "props 层还是没人查"


@pytest.mark.parametrize("btype", ["DataTable", "RecordDetail", "RecordFormDialog", "StepsForm"])
def test_all_four_observed_types(btype):
    """线上实际中招的四个类型逐个复核 —— 别只修 DataTable 那一个。"""
    out = repair_five_system_model(_model([{
        "id": "b1", "type": btype,
        "props": {"fieldRefs": ["name"]},
        "binding": {"entityRef": "leader"},
    }]))
    assert _blocks_of(out)[0]["binding"].get("fieldRefs") == ["name"], btype
