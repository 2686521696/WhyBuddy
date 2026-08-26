"""`/范围` 停泊复述不得等于斜杠令牌。

反向：`_restate` 再把剥空后的 `/范围` 填回去 → 卡标题「将做成：/范围」。
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
from services.rehearsal_control import _restate
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_restate_strips_scope_verb_and_does_not_return_token():
    assert _restate("/范围") == ""
    assert _restate("/范围 考勤") == "考勤"
    assert _restate("/推演") == ""
    assert _restate("/推演 请假系统") == "请假系统"
    assert _restate("请假系统") == "请假系统"
    assert not _restate("/范围").startswith("/")


def test_forced_scope_card_uses_goal_not_slash_token(harness):
    sid = new_sid("scope-token")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    _, events = harness.post(six_fields(sid, "/范围", forcedTool="scope_card"))
    assert harness.helper_calls == []
    assert harness.llm_calls == []
    assert "control_scope_card" in event_types(events)
    cards = [e for e in events if e.get("type") == "control_scope_card"]
    assert cards
    assert cards[0]["restatement"] == "请假系统"
    assert cards[0]["restatement"] != "/范围"
    assert not str(cards[0]["restatement"]).startswith("/")
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_scope"
    assert loaded.awaitDetail == "请假系统"


def test_scope_remainder_beats_goal(harness):
    sid = new_sid("scope-remainder")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    _, events = harness.post(
        six_fields(sid, "/范围 考勤系统", forcedTool="scope_card")
    )
    cards = [e for e in events if e.get("type") == "control_scope_card"]
    assert cards
    assert cards[0]["restatement"] == "考勤系统"
    assert cards[0]["restatement"] != "/范围"


def test_bare_scope_without_forced_tool_still_parks_goal(harness):
    """客户端漏 forcedTool 时，userText `/范围` 仍必须 park 当前 goal。"""
    sid = new_sid("scope-no-forced")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    _, events = harness.post(six_fields(sid, "/范围"))
    assert harness.llm_calls == []
    cards = [e for e in events if e.get("type") == "control_scope_card"]
    assert cards
    assert cards[0]["restatement"] == "请假系统"
    assert cards[0]["restatement"] != "/范围"
