"""放错槽位的区块挪回首选槽位（services/v5_model_repair._repair_layout_slot_violations）。

背景：开了目录窄化之后模型真在用大量特定场景件，而这些件的槽位约束比泛用件紧，
于是首轮过闸失败里 4/6 趟都是「block X is not allowed in slot Y」。

要守住的：
  · **挪，不摘**。客户端 AppRuntimeScreen 里声明了 layout 时没进槽位的区块压根
    不渲染，摘掉 ref 等于把区块从页面上抹掉；
  · 挪到 `allowedRegions[0]`——目录 authored 的首选位置，不是我猜的顺序；
  · 认不出来的一律不动，留给门（fail-closed 不变）。
"""

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.schema_legal import EXPERIENCE_BLOCK_ALLOWED_REGIONS_BY_TYPE as ALLOWED
from services.v5_model_repair import repair_five_system_model


def _model(layout, blocks):
    return {
        # 字段/aigc 不能空：门在 Step 7（layout 校验）**之前**就会因
        # "empty skill section: aigc" 短路返回，layout 那段压根跑不到。
        # 这条端到端用例第一版就是这么假绿的——夹具太薄，门还没走到要测的地方。
        "datamodel": {
            "entities": [
                {
                    "id": "alert",
                    "name": "告警",
                    "fields": [
                        {"id": "title", "name": "标题", "type": "string"},
                        {"id": "summary", "name": "摘要", "type": "string"},
                    ],
                }
            ]
        },
        "rbac": {"roles": [{"id": "ops", "name": "运维"}], "permissions": [], "menus": []},
        "workflow": {"id": "wf", "name": "流程", "nodes": [], "transitions": [], "chains": []},
        "page": {
            "pages": [
                {
                    "id": "p1",
                    "name": "页面",
                    "kind": "workbench",
                    "blocks": blocks,
                    "layout": layout,
                }
            ]
        },
        "aigc": {
            "capabilities": [
                {
                    "id": "cap_summary",
                    "name": "生成摘要",
                    "inputFields": ["alert.title"],
                    "outputField": "alert.summary",
                    "roleRefs": ["ops"],
                }
            ]
        },
        "appbundle": {"landingPageRef": "p1"},
    }


def _layout(result):
    return result["model"]["page"]["pages"][0]["layout"]


def _slot_of(result, block_id):
    for slot, refs in _layout(result).items():
        if isinstance(refs, list) and block_id in refs:
            return slot
    return None


def test_合法槽位不动():
    m = _model({"main": ["b1"]}, [{"id": "b1", "type": "DataTable"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "main"
    assert not (r.get("layoutSlots") or {})


def test_越界的被挪到首选槽位():
    """MuteTimingSchedule 的 allowedRegions 是 (main, aside, supplement)。"""
    assert ALLOWED["MuteTimingSchedule"][0] == "main"
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "MuteTimingSchedule"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "main"
    moved = (r["layoutSlots"] or {})["moved"]
    assert moved[0]["from"] == "overlay" and moved[0]["to"] == "main"


def test_首选顺序按目录声明而不是写死_main():
    """ActivityFeed 的首选是 aside 而不是 main——顺序是 authored 的。

    这条是哨兵：要是有人把实现改成"一律挪去 main"，它会红。
    """
    assert ALLOWED["ActivityFeed"][0] == "aside"
    m = _model({"charts": ["b1"]}, [{"id": "b1", "type": "ActivityFeed"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "aside"


def test_绝不把区块摘掉():
    """最要紧的一条：声明了 layout 时没进任何槽位的区块压根不渲染。"""
    m = _model({"metrics": ["b1"]}, [{"id": "b1", "type": "WorkflowTimeline"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") is not None, "区块被挪丢了——那等于把它从页面上抹掉"


def test_目标槽位已有别的区块时是追加不是覆盖():
    m = _model(
        {"main": ["b0"], "overlay": ["b1"]},
        [{"id": "b0", "type": "DataTable"}, {"id": "b1", "type": "MuteTimingSchedule"}],
    )
    r = repair_five_system_model(m)
    assert _layout(r)["main"] == ["b0", "b1"]


def test_不产生重复():
    m = _model(
        {"main": ["b1"], "overlay": ["b1"]},
        [{"id": "b1", "type": "MuteTimingSchedule"}],
    )
    r = repair_five_system_model(m)
    assert _layout(r)["main"].count("b1") == 1
    assert "b1" not in (_layout(r).get("overlay") or [])


def test_幂等():
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "MuteTimingSchedule"}])
    once = repair_five_system_model(m)["model"]
    twice = repair_five_system_model(once)
    assert twice["model"]["page"]["pages"][0]["layout"] == once["page"]["pages"][0]["layout"]
    assert not (twice.get("layoutSlots") or {})


def test_不改入参():
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "MuteTimingSchedule"}])
    snapshot = copy.deepcopy(m)
    repair_five_system_model(m)
    assert m == snapshot


# ── 认不出来的一律不动 ──────────────────────────────────────────────────────


def test_不认识的区块类型不动():
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "TotallyMadeUpBlock"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "overlay"


def test_悬空_ref_不动():
    """layout 指了个 page.blocks 里没有的 id —— 门已有 DANGLING 判据。"""
    m = _model({"overlay": ["ghost"]}, [{"id": "b1", "type": "DataTable"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "ghost") == "overlay"


def test_槽位值不是数组时不动():
    """`layout: {slots: {...}}` 这类多包一层的形状交给门（它有专门的提示语）。"""
    m = _model({"slots": {"main": ["b1"]}}, [{"id": "b1", "type": "DataTable"}])
    r = repair_five_system_model(m)
    assert _layout(r)["slots"] == {"main": ["b1"]}


def test_没有_layout_的页不受影响():
    m = _model({}, [{"id": "b1", "type": "DataTable"}])
    m["page"]["pages"][0].pop("layout")
    r = repair_five_system_model(m)
    assert "layout" not in r["model"]["page"]["pages"][0]


# ── 与门对齐 ───────────────────────────────────────────────────────────────


def test_修完之后门不再报槽位违规():
    """端到端：修完再过门，PUBLISH_ENUM_VIOLATION 的槽位那条应当消失。"""
    from services.v5_model_gate import validate_five_system_model

    m = _model(
        {"overlay": ["b1"], "metrics": ["b2"]},
        [
            {"id": "b1", "type": "MuteTimingSchedule", "binding": {"entityRef": "alert"}},
            {"id": "b2", "type": "WorkflowTimeline"},
        ],
    )
    before = [
        f for f in (validate_five_system_model(m).get("findings") or [])
        if "is not allowed in slot" in str(f.get("message") or "")
    ]
    assert before, "夹具本身应当先触发槽位违规"
    fixed = repair_five_system_model(m)["model"]
    after = [
        f for f in (validate_five_system_model(fixed).get("findings") or [])
        if "is not allowed in slot" in str(f.get("message") or "")
    ]
    assert after == [], f"修完仍报槽位违规: {after}"
