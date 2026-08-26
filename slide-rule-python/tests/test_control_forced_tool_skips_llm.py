"""开始推演 = forcedTool rehearse，跳过控制面 LLM。

控制模型夹具只想 ask_user：点开始推演仍 helper 恰好一次，
零 control_ask_user，零第二轮 tool-calling。
helper.active_connectors 带上本轮 slash 连接器 id。
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

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_start_rehearse_skips_ask_user_fixture_and_forwards_slash_connector(harness):
    sid = new_sid("skip-llm")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user", {"question": "你想做什么应用？"}
    )
    connector_id = "slash-leave-policy"
    _, events = harness.post(
        six_fields(
            sid,
            "将做成：请假系统",
            forcedTool="rehearse",
            activeConnectors=[connector_id],
            installedSkills=[{"id": "skill-a"}],
            preferredDevice="phone",
            designSystemId="ds-1",
        )
    )
    assert harness.llm_calls == [], "forcedTool rehearse 不得再问控制面模型"
    assert len(harness.helper_calls) == 1
    call = harness.helper_calls[0]
    assert connector_id in (call["active_connectors"] or [])
    assert call["installed_skills"] == [{"id": "skill-a"}]
    assert call["preferred_device"] == "phone"
    assert call["design_system_id"] == "ds-1"
    types = event_types(events)
    assert "control_ask_user" not in types
    assert "control_handoff_factory" in types
    assert types.count("control_ask_user") == 0


def test_mode_repair_skips_llm_and_hits_helper_repair_true(harness):
    """活路径：mode=repair → helper(..., repair=True)，零控制面 LLM。"""
    sid = new_sid("repair-live")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user", {"question": "不该问"}
    )
    _, events = harness.post(six_fields(sid, "补齐证据缺口", mode="repair"))
    assert harness.llm_calls == []
    assert len(harness.helper_calls) == 1
    assert harness.helper_calls[0].get("repair") is True
    assert "control_handoff_factory" in event_types(events)
