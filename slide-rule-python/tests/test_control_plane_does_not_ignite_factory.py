"""Cheap turns must not ignite the factory.

Reverse: if greeting/inspect/failure fall through to _handoff_factory,
helper_calls > 0 and this file goes red.
"""

from __future__ import annotations

import json

import pytest

from control_turn_support import (
    PY_ROOT,
    ControlHarness,
    event_types,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from services.rehearsal_control import CANNED_FAILURE
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _seed(prefix: str, **kwargs):
    sid = new_sid(prefix)
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        conversation=[{"role": "user", "text": "already-here"}],
        **kwargs,
    )
    return sid


def test_greeting_does_not_call_helper(harness):
    sid = _seed("greet")
    harness.llm_impl = lambda messages, **kw: llm_text("你好，说一个要做的应用。")
    _, events = harness.post(six_fields(sid, "你好"))
    assert harness.helper_calls == []
    assert harness.generator_calls == []
    assert "control_handoff_factory" not in event_types(events)
    assert "control_text" in event_types(events)
    loaded = load_session(sid)
    assert loaded is not None
    assert len(loaded.conversation or []) == 1
    assert (loaded.conversation or [])[0]["text"] == "already-here"
    transcript = loaded.controlTranscript or []
    assert len(transcript) >= 2
    kinds = [
        row.get("kind") for row in transcript if isinstance(row, dict)
    ]
    assert "control_text" in kinds
    reloaded = load_session(sid)
    assert reloaded is not None
    assert len(reloaded.controlTranscript or []) >= 2


def test_inspect_tool_message_contains_digest(harness):
    """第二轮 call_control_llm 的 tool 消息必须带 digest。剥掉 → 红。"""
    sid = new_sid("inspect-digest")
    needle = "DIGEST-NEEDLE-请假审批"
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[
            {"id": "v1", "model": {"appName": needle, "pages": []}}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("inspect_model", {}, call_id="insp-1")
        return llm_text("已看到模型摘要。")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "现在有哪些角色？"))
    assert harness.helper_calls == []
    assert len(harness.llm_calls) == 2
    second = harness.llm_calls[1]["messages"]
    blob = json.dumps(second, ensure_ascii=False)
    assert needle in blob, "删掉 tool 消息里的 digest，这条必须红。"


def test_inspect_does_not_call_helper(harness):
    sid = _seed("inspect")
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("inspect_model", {})
        return llm_text("当前还没有五系统模型可查看。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "现在有哪些角色？"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    assert "control_tool_start" in event_types(events)
    loaded = load_session(sid)
    assert loaded is not None
    assert len(loaded.conversation or []) == 1


def test_control_plane_failure_canned_no_helper(harness):
    sid = _seed("fail")

    def boom(messages, **kw):
        raise RuntimeError("control llm exploded")

    harness.llm_impl = boom
    _, events = harness.post(six_fields(sid, "随便聊聊"))
    assert harness.helper_calls == []
    texts = [e.get("text") for e in events if e.get("type") == "control_text"]
    assert CANNED_FAILURE in texts
    assert "control_handoff_factory" not in event_types(events)


def test_comment_stripped_control_plane_has_no_drive_reasoning_session():
    stripped = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "driveReasoningSession" not in stripped
    assert "drive_reasoning_session" not in stripped
