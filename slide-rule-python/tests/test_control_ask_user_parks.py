"""ask_user 发出 control_ask_user 后本请求结束。

persist awaitReason=control_ask；reload 仍能看到问题；不是 G_READY ready。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_ask_user_parks_and_ends_this_request(harness):
    sid = new_sid("ask")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    question = "你想做什么应用？"
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user", {"question": question, "options": ["请假", "报销"]}
    )
    _, events = harness.post(six_fields(sid, "你好"))
    assert harness.helper_calls == []
    types = event_types(events)
    assert "control_ask_user" in types
    assert "complete" in types
    # 本请求在提问之后结束，不得再转一轮等用户。
    ask_at = types.index("control_ask_user")
    assert "control_ask_user" not in types[ask_at + 1 :]
    assert types[ask_at:].count("complete") == 1
    assert harness.llm_calls == [harness.llm_calls[0]], "不得空转等用户再调一轮模型"
    ask_events = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask_events[0]["question"] == question

    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_ask"
    assert loaded.awaitReason != "ready"
    assert loaded.runtimePhase == "awaiting"
    assert question in str(loaded.awaitDetail or "")
    transcript = loaded.controlTranscript or []
    texts = [row.get("text") for row in transcript if isinstance(row, dict)]
    assert question in texts

    reloaded = load_session(sid)
    assert reloaded is not None
    assert reloaded.awaitReason == "control_ask"
    assert question in str(reloaded.awaitDetail or "")
