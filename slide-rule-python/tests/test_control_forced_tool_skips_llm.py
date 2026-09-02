"""开始推演 = forcedTool rehearse，点火前跳过控制面 LLM。

控制模型夹具只想 ask_user：点开始推演仍 helper 恰好一次，
点火前零 control_ask_user。工厂收尾交回 host 循环。
helper.active_connectors 带上本轮 slash 连接器 id。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_text,
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
    def impl(messages, **kw):
        assert harness.helper_calls, "点火前不得问控制面模型"
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
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
    assert len(harness.helper_calls) == 1
    assert harness.llm_calls, "工厂之后没有 LLM——自由编排没介入"
    call = harness.helper_calls[0]
    assert connector_id in (call["active_connectors"] or [])
    assert call["installed_skills"] == [{"id": "skill-a"}]
    assert call["preferred_device"] == "phone"
    assert call["design_system_id"] == "ds-1"
    types = event_types(events)
    assert "control_ask_user" not in types
    assert "control_handoff_factory" in types
    assert "factory_complete" in types
    assert types.count("control_ask_user") == 0


def test_mode_repair_skips_llm_before_factory_then_rejoins(harness):
    """活路径：mode=repair → helper(..., repair=True)，点火前零 LLM，收尾交回。"""
    sid = new_sid("repair-live")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "repair 点火前不得问控制面模型"
        return llm_text("缺口已经补过一轮，还要继续说一声。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "补齐证据缺口", mode="repair"))
    assert len(harness.helper_calls) == 1
    assert harness.helper_calls[0].get("repair") is True
    assert harness.llm_calls, "repair 工厂之后没有 LLM"
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "factory_complete" in types
    assert "control_ask_user" not in types
