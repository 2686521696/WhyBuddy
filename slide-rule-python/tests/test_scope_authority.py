# -*- coding: utf-8 -*-
"""范围授权：park / confirm / 本轮生成 三套优先级必须能被变异咬住。

对照 grok PermissionState——默认档不是授予。把 confirm 的 payload 优先
改成跟 park 一样「句子压过点击」，这条必须红。
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.scope_authority import (  # noqa: E402
    preferred_device_for_run,
    resolve_confirm_device,
    resolve_park_device,
    stamp_scope_onto_goal,
)


def _code(mod) -> str:
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_park_sentence_beats_composer_default():
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["/推演 巡店点单平板"],
            payload_device="desktop",
        )
        == "tablet"
    )


def test_park_persisted_grant_used_when_sentence_has_no_device():
    assert (
        resolve_park_device(
            last_card={"device": "tablet"},
            goal={"preferredDevice": "phone"},
            texts=["请假系统"],
            payload_device="desktop",
        )
        == "tablet"
    )


def test_park_without_grant_or_sentence_keeps_payload_or_sentinel():
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["请假系统"],
            payload_device="desktop",
        )
        == "desktop"
    )
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["请假系统"],
            payload_device=None,
        )
        == "unspecified"
    )


def test_confirm_click_beats_sentence():
    """卡上点 desktop 是授予，句子里的平板压不过。"""
    assert (
        resolve_confirm_device(
            payload_device="desktop",
            last_card={"device": "phone"},
            goal={"preferredDevice": "phone"},
            texts=["巡店点单平板"],
        )
        == "desktop"
    )


def test_confirm_falls_back_to_card_then_goal_then_text():
    assert (
        resolve_confirm_device(
            payload_device="watch",
            last_card={"device": "tablet"},
            goal={},
            texts=[],
        )
        == "tablet"
    )
    assert (
        resolve_confirm_device(
            payload_device=None,
            last_card={"device": "unspecified"},
            goal={"preferredDevice": "phone"},
            texts=["巡店点单平板"],
        )
        == "phone"
    )
    assert (
        resolve_confirm_device(
            payload_device=None,
            last_card={},
            goal={},
            texts=["巡店点单平板"],
        )
        == "tablet"
    )


def test_run_device_persisted_grant_beats_composer_default():
    assert (
        preferred_device_for_run(
            goal={"preferredDevice": "tablet"},
            payload_device="desktop",
            texts=["把提交按钮改红"],
        )
        == "tablet"
    )


def test_run_device_this_turn_sentence_beats_persisted():
    assert (
        preferred_device_for_run(
            goal={"preferredDevice": "tablet"},
            payload_device="desktop",
            texts=["改成手机版"],
        )
        == "phone"
    )


def test_stamp_writes_both_grants():
    goal = stamp_scope_onto_goal(
        {},
        product_archetype="business_app",
        preferred_device="tablet",
        tools=["spec", "pages", "closure"],
    )
    assert goal["productArchetype"] == "business_app"
    assert goal["preferredDevice"] == "tablet"
    assert goal["tools"] == ["spec", "pages", "closure"]


def test_stamp_empty_tools_pops_the_key():
    """空清单不许写成什么都不跑。缺省 = 五件套，由规划器归一。"""
    goal = stamp_scope_onto_goal(
        {"tools": ["spec"]},
        tools=[],
    )
    assert "tools" not in goal


def test_stamp_ignores_unwired_device():
    goal = stamp_scope_onto_goal(
        {"preferredDevice": "desktop"},
        product_archetype="business_app",
        preferred_device="watch",
    )
    assert goal["preferredDevice"] == "desktop"


def test_live_sockets_call_the_resolvers():
    """删掉控制面 / 工厂的调用点，这条必须红。单独测函数会绿。"""
    from services import drive_full_factory as factory
    from services import rehearsal_control as rc

    control = _code(rc)
    helper = _code(factory)
    assert "resolve_park_device" in control
    assert "resolve_confirm_device" in control
    assert "stamp_scope_onto_goal" in control
    assert "preferred_device_for_run" in control
    assert "preferred_device_for_run" in helper
    stamp = control[
        control.index("def _stamp_scope_choice_onto_goal") : control.index(
            "def _copy_scope_opt_in_into_goal"
        )
    ]
    assert "stamp_scope_onto_goal" in stamp
    assert "preferred_device" in stamp
    assert "tools=" in stamp
    assert 'body.get("tools")' in stamp
    handoff = control[control.index("async def _handoff_factory") :]
    handoff = handoff[: handoff.index("\ndef ", 1)]
    assert "preferred_device_for_run" in handoff
    confirm = control[
        control.index("async def _confirm_rehearse_and_handoff") : control.index(
            "async def _handoff_factory"
        )
    ]
    assert "device" in confirm[confirm.index("scope_confirmed") :]
    assert "productArchetype" in confirm[confirm.index("scope_confirmed") :]
    assert "tools" in confirm[confirm.index("scope_confirmed") :]
