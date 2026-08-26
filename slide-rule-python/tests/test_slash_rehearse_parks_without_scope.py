"""空会话 /推演：helper=0，发出 control_scope_card。

未确认 forcedTool rehearse 同样 park，不得点火。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_slash_rehearse_on_empty_session_parks(harness):
    sid = new_sid("slash-empty")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(six_fields(sid, "/推演"))
    assert harness.helper_calls == []
    assert harness.llm_calls == []
    types = event_types(events)
    assert "control_scope_card" in types
    assert "control_handoff_factory" not in types
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_scope"
    assert loaded.runtimePhase == "awaiting"


def test_unconfirmed_forced_rehearse_still_parks(harness):
    sid = new_sid("forced-unconfirmed")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(
        six_fields(sid, "做一个请假系统", forcedTool="rehearse")
    )
    assert harness.helper_calls == []
    assert "control_scope_card" in event_types(events)
    assert "control_handoff_factory" not in event_types(events)
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_scope"


def test_after_park_start_rehearse_ignites(harness):
    """停泊之后点开始推演（forced rehearse）才点火。"""
    sid = new_sid("park-then-go")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, first = harness.post(six_fields(sid, "/推演 请假系统"))
    assert harness.helper_calls == []
    assert "control_scope_card" in event_types(first)
    _, second = harness.post(
        six_fields(sid, "请假系统", forcedTool="rehearse")
    )
    assert len(harness.helper_calls) == 1
    assert "control_handoff_factory" in event_types(second)
