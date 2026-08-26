"""M1 硬帽：8 轮 / 8k cheap tokens / 45s → 停在控制面，helper=0。

反向：删掉 in-loop / post-loop 的 over-cap return，这三条必须红。
Header grep 不算。
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
from services.rehearsal_control import OVER_CAP_TEXT

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _confirmed(sid: str) -> None:
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )


def _over_cap_texts(events) -> list:
    return [e.get("text") for e in events if e.get("type") == "control_text"]


def test_eight_tool_rounds_then_rehearse_stays_capped(harness):
    sid = new_sid("cap-rounds")
    _confirmed(sid)

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        if n <= 8:
            return llm_tool(
                "search_evidence", {"query": f"q{n}"}, call_id=f"c{n}"
            )
        return llm_tool("rehearse", {}, call_id="rehearse")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "帮我搜一下再推演"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    assert OVER_CAP_TEXT in _over_cap_texts(events)
    assert len(harness.llm_calls) == 8


def test_token_cap_stops_before_rehearse_dispatch(harness):
    sid = new_sid("cap-tok")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "rehearse", {}, usage={"total_tokens": 8001}
    )
    _, events = harness.post(six_fields(sid, "开始"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    assert OVER_CAP_TEXT in _over_cap_texts(events)


def test_wall_clock_cap_stops_before_dispatch(harness, monkeypatch):
    import services.rehearsal_control as rc

    sid = new_sid("cap-wall")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: llm_tool("rehearse", {})
    ticks = {"n": 0}

    def fake_mono():
        # 每次 +46s：HTTP 中间件若先调 monotonic，started 仍会与下一次
        # _maybe_over_cap 相差超过 45s。删掉 over-cap return → helper=1。
        ticks["n"] += 1
        return 1000.0 + ticks["n"] * 46.0

    monkeypatch.setattr(rc.time, "monotonic", fake_mono)
    _, events = harness.post(six_fields(sid, "现在有哪些角色？"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    assert OVER_CAP_TEXT in _over_cap_texts(events)
    assert harness.llm_calls == []
