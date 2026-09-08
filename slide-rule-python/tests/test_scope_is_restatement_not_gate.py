# -*- coding: utf-8 -*-
"""范围卡是复述，不是点火门禁。

## 事故（2026-09-07）

新话题必须先点「开始推演」才干活；设备类型由卡授予。
点「精修（refine）」被当成新话，控制面重猜。

产品决定：人话进环。设备/类型由模型从这句话认。卡留下当
「我认成了桌面收银台，不对再说」。
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_scope_card_tool_ignites_without_waiting():
    pytest.importorskip("fastapi")
    from control_turn_support import (
        ControlHarness,
        event_types,
        llm_tool,
        new_sid,
        seed_session,
        six_fields,
    )
    import _pytest.monkeypatch as _mp

    mp = _mp.MonkeyPatch()
    try:
        harness = ControlHarness(mp)
        sid = new_sid("restatement")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda messages, **kw: llm_tool(
            "scope_card",
            {"restatement": "街边早餐摊的桌面收银台"},
        )
        body, events = harness.post(
            six_fields(sid, "街边早餐摊的收银台：点餐、改数量、结账")
        )
        types = event_types(events)
        assert "control_scope_card" in types
        card = next(e for e in events if e.get("type") == "control_scope_card")
        assert card.get("gate") is False
        assert harness.helper_calls, f"复述卡必须接着点火，事件：{types}"
        assert "control_handoff_factory" in types
        from services.slide_rule_session import load_session

        st = load_session(sid)
        assert st is not None
        assert getattr(st, "awaitReason", None) != "control_scope"
        goal = st.goal if isinstance(st.goal, dict) else {}
        # spec 是工具：复述后调 spec，不许展开 first_pass 课表再取 [0]。
        assert goal.get("tools") == ["spec"], goal.get("tools")
    finally:
        mp.undo()


def test_control_prompt_does_not_require_confirm_before_rehearse():
    from services.rehearsal_control import _system_prompt
    from models.v5_state import V5SessionState

    text = _system_prompt(V5SessionState(sessionId="p", goal={"text": "收银台"}))
    assert "未确认不得 rehearse" not in text
    assert "把这件事做完" in text
    assert "收银台" in text


def test_restatement_continues_as_spec_tool_not_rehearse_bundle():
    """变异：把 name='spec' 改回 name='rehearse' → 本条红。"""
    from pathlib import Path
    import ast

    src = (
        Path(__file__).resolve().parents[1]
        / "services"
        / "rehearsal_control.py"
    ).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        and n.name == "_dispatch_tool"
    )
    assigns = [
        n
        for n in ast.walk(fn)
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "name" for t in n.targets)
        and isinstance(n.value, ast.Constant)
    ]
    values = [n.value.value for n in assigns]
    assert "spec" in values
    assert "rehearse" not in values


def test_can_auto_grant_needs_a_real_topic():
    from services.rehearsal_control import _can_auto_grant_scope

    assert _can_auto_grant_scope("街边早餐摊收银台", "") is False
    assert _can_auto_grant_scope("你好", "") is False
    assert _can_auto_grant_scope("hello", "") is False
    assert _can_auto_grant_scope("", "") is False
    assert _can_auto_grant_scope("你能做啥", "") is False
    assert _can_auto_grant_scope("你能做啥", "继续") is False
    assert _can_auto_grant_scope("继续", "") is False
    assert _can_auto_grant_scope("hello", "街边早餐摊收银台") is True
