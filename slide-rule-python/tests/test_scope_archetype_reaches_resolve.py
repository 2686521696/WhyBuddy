# -*- coding: utf-8 -*-
"""范围卡上的原型必须到达 resolve()（2026-08-30）。

选择通道写好了、有测试、点火时没人调 = 装在不通电的插座上。
确认 POST 必须把 productArchetype 写进 goal，并在信封之前 fail-closed。
五系统内核这轮不动——未接通的原型不得点火。
"""

from __future__ import annotations

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from control_turn_support import (  # noqa: E402
    ControlHarness,
    event_types,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session  # noqa: E402

pytest.importorskip("fastapi")


def _code(mod) -> str:
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_confirm_path_calls_resolve_before_envelope():
    """删掉 _stamp_scope_choice_onto_goal / resolve_archetype，这条必须红。"""
    from services import rehearsal_control as rc

    code = _code(rc)
    assert "_stamp_scope_choice_onto_goal" in code
    confirm = code[
        code.index("async def _confirm_rehearse_and_handoff") : code.index(
            "async def _handoff_factory"
        )
    ]
    assert "_stamp_scope_choice_onto_goal" in confirm
    assert "start_drive_full_factory_run" not in confirm.split("_stamp_scope_choice_onto_goal")[0]


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_park_card_carries_prototype_and_wired_choices(harness):
    sid = new_sid("scope-choices")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(six_fields(sid, "/推演 请假系统"))
    cards = [e for e in events if e.get("type") == "control_scope_card"]
    assert cards, events
    card = cards[0]
    assert card.get("productArchetype") == "business_app"
    ids = {row["id"] for row in card.get("wiredArchetypes") or []}
    assert ids == {"business_app", "content_app", "free_app"}
    assert "casual_game" not in ids
    device_ids = {row["id"] for row in card.get("wiredDevices") or []}
    assert device_ids == {"desktop", "phone", "tablet"}
    assert "watch" not in device_ids
    loaded = load_session(sid)
    rows = [r for r in (loaded.controlTranscript or []) if r.get("kind") == "scope_card"]
    assert rows[-1]["productArchetype"] == "business_app"


def test_park_card_carries_free_app_from_first_post(harness):
    """空态作曲家选自由类型，首包必须 park 进范围卡。漏传 = 卡上仍是业务后台。"""
    sid = new_sid("scope-free")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(
        six_fields(sid, "/推演 团子的一天", productArchetype="free_app")
    )
    cards = [e for e in events if e.get("type") == "control_scope_card"]
    assert cards, events
    assert cards[0].get("productArchetype") == "free_app"
    loaded = load_session(sid)
    rows = [r for r in (loaded.controlTranscript or []) if r.get("kind") == "scope_card"]
    assert rows[-1]["productArchetype"] == "free_app"


def test_confirm_stamps_free_app_then_ignites(harness):
    """自由类型是接通档，必须 stamp 并点火，不许当未接通 fail-closed。

    ⚠ 2026-09-09：这条原来是「先 /推演 停在卡上、再点确认」两步。闸拆掉之后
      第一步自己就点火了，第二步变成第二次点火，`helper_calls == 1` 变 2。
      收成一步——本条的主题是 **archetype / device 有没有落到 goal 并抵达
      工厂**，不是那支停泊舞。
    """
    sid = new_sid("scope-free-stamp")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, second = harness.post(
        six_fields(
            sid,
            "/推演 团子的一天",
            preferredDevice="desktop",
            productArchetype="free_app",
        )
    )
    assert len(harness.helper_calls) == 1
    assert "control_handoff_factory" in event_types(second)
    loaded = load_session(sid)
    goal = loaded.goal if isinstance(loaded.goal, dict) else {}
    assert goal.get("productArchetype") == "free_app"


def test_confirm_stamps_archetype_and_tablet_then_ignites(harness):
    """archetype 与设备档要落到 goal、落到 scope_confirmed、传进工厂。

    ⚠ 2026-09-09：这条原来是「先 /推演 停在卡上、再点确认」两步。闸拆掉之后
      第一步自己就点火了，第二步变成第二次点火，`helper_calls == 1` 变 2。
      收成一步——本条的主题是 **archetype / device 有没有落到 goal 并抵达
      工厂**，不是那支停泊舞。
    """
    sid = new_sid("scope-stamp")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, second = harness.post(
        six_fields(
            sid,
            "/推演 请假系统",
            preferredDevice="tablet",
            productArchetype="business_app",
        )
    )
    assert len(harness.helper_calls) == 1
    assert "control_handoff_factory" in event_types(second)
    loaded = load_session(sid)
    goal = loaded.goal if isinstance(loaded.goal, dict) else {}
    assert goal.get("productArchetype") == "business_app"
    assert goal.get("preferredDevice") == "tablet"
    assert harness.helper_calls[0]["preferred_device"] == "tablet"
    confirmed = [
        row
        for row in (loaded.controlTranscript or [])
        if row.get("kind") == "scope_confirmed"
    ]
    assert confirmed, loaded.controlTranscript
    assert confirmed[-1].get("device") == "tablet"
    assert confirmed[-1].get("productArchetype") == "business_app"


def test_park_composer_tablet_and_free_app_reach_card(harness):
    """空态选平板 / 自由类型，命题没写设备词，卡上必须带进去。"""
    sid = new_sid("park-composer-morph")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(
        six_fields(
            sid,
            "/推演 团子的一天",
            preferredDevice="tablet",
            productArchetype="free_app",
        )
    )
    cards = [e for e in events if e.get("type") == "control_scope_card"]
    assert cards, events
    assert cards[0].get("device") == "tablet"
    assert cards[0].get("productArchetype") == "free_app"
    loaded = load_session(sid)
    rows = [r for r in (loaded.controlTranscript or []) if r.get("kind") == "scope_card"]
    assert rows[-1]["device"] == "tablet"
    assert rows[-1]["productArchetype"] == "free_app"


def test_park_composer_desktop_not_overridden_by_tablet_sentence(harness):
    """空态停在 Web/PC，句子里的「平板」不得把卡改成平板。"""
    sid = new_sid("park-composer-desktop")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(six_fields(sid, "/推演 巡店点单平板"))
    cards = [e for e in events if e.get("type") == "control_scope_card"]
    assert cards, events
    assert cards[0].get("device") == "desktop"
    loaded = load_session(sid)
    rows = [r for r in (loaded.controlTranscript or []) if r.get("kind") == "scope_card"]
    assert rows[-1]["device"] == "desktop"


def test_dispatch_park_sockets_pass_payload_archetype():
    """澄清后再 park / 批准闸 park 漏传 product_archetype → 卡上变回业务后台。

    ⚠ 2026-09-08：范围卡有**两种**插座了。门禁那版只有 `_park_scope`
      （停泊等确认）；复述卡走 `_emit_scope_restatement`（不设 awaitReason）。
      重构时 3 个 `_park_scope` 点改成了后者，这条判据只数前者，于是
      `call_count >= 5` 从 8 掉到 2 变红——**不是插座少了，是判据只认一种**。
      两种都会把卡画到用户眼前，两种都得解析 archetype，所以两种都数。
      只放宽数字（改成 >= 2）会让「以后新加的复述卡插座漏传」重新静默。
    """
    from services import rehearsal_control as rc

    code = _code(rc)
    call_count = 0
    for socket in ("_park_scope(", "_emit_scope_restatement("):
        idx = 0
        while True:
            at = code.find(socket, idx)
            if at < 0:
                break
            before = code[max(0, at - 24) : at]
            if "def " in before:
                idx = at + 1
                continue
            chunk = code[at : at + 420]
            assert "product_archetype=_resolved_park_archetype" in chunk, (
                f"{socket} 漏传 archetype：{chunk[:240]}"
            )
            assert "args.get(\"device\") or preferred_device" not in chunk
            call_count += 1
            idx = at + 1
    assert call_count >= 5, f"范围卡插座只剩 {call_count} 个，是不是又漏认了一种"


def test_refine_keeps_persisted_tablet_over_composer_desktop(harness):
    """精修 POST 仍带 desktop 时，goal 上的平板授予必须压过。"""
    sid = new_sid("refine-tablet")
    seed_session(
        sid,
        goal={
            "text": "巡店点单",
            "status": "clear",
            "preferredDevice": "tablet",
            "productArchetype": "business_app",
        },
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )
    _, _events = harness.post(
        six_fields(sid, "把提交按钮改成红色", forcedTool="refine")
    )
    assert len(harness.helper_calls) == 1
    assert harness.helper_calls[0]["preferred_device"] == "tablet"


def test_unwired_archetype_does_not_handoff(harness):
    """选 casual_game 必须 fail-closed：信封次数 = 0。

    ⚠ 2026-09-09：原来是「先 /推演 停卡、再带 archetype 确认」。闸拆掉之后
      第一步就点火了（而且那一步没带 archetype，等于绕过本条要测的闸）。
      收成一步，archetype 从第一发就带上——真机上作曲家也是这么发的。
    """
    sid = new_sid("scope-unwired")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, second = harness.post(
        six_fields(
            sid,
            "/推演 做一个小游戏",
            productArchetype="casual_game",
        )
    )
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(second)
    texts = [e.get("text") or "" for e in second if e.get("type") == "control_text"]
    assert any("casual_game" in t or "生成侧还产不出" in t for t in texts)
