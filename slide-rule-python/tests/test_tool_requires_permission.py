"""Declared WRITE permissions require a persisted approval of the current plan."""
from __future__ import annotations

import asyncio

import pytest

from control_turn_support import ControlHarness, event_types, new_sid, seed_session, seed_approved_session, six_fields
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import rehearsal_control as control

WRITERS = {"rehearse", "workflow", "spec", "pages", "structure", "bind", "closure", "refine", "repair", "challenge", "restore_version", "fork_variant"}


def test_all_mutating_tools_declare_permission():
    assert {name for name in control.CLOSED_TOOLS if control.tool_requires_permission(name)} == WRITERS
    assert set(control.TOOL_PERMISSION) <= set(control.CLOSED_TOOLS)


@pytest.mark.parametrize("name", ["ask_user_question", "enter_plan_mode", "write_plan", "exit_plan_mode", "search_evidence", "inspect_model"])
def test_interview_and_plan_tools_need_no_execution_approval(name):
    state = V5SessionState(sessionId="planning", goal={"text": "inventory app"})
    assert not control.tool_requires_permission(name)
    assert control.tool_permission_granted(name, state)


@pytest.mark.parametrize("name", sorted(WRITERS))
def test_only_current_persisted_plan_grants_write(name):
    state = V5SessionState(sessionId="permission", goal={"text": "inventory app"})
    assert not control.tool_permission_granted(name, state)
    state.controlTranscript = [{"kind": "scope_confirmed"}]
    assert not control.tool_permission_granted(name, state)
    state.controlTranscript = approved_plan_rows()[:2]
    state.awaitReason = "control_plan_approval"
    assert not control.tool_permission_granted(name, state)
    state.controlTranscript = approved_plan_rows()
    state.awaitReason = None
    if name == "refine":
        state.modelVersions = [{"id": "v1", "model": {"pages": []}}]
    assert control.tool_permission_granted(name, state)
    state.controlTranscript.append({"kind": "plan_entered"})
    assert not control.tool_permission_granted(name, state)


@pytest.mark.parametrize("name", sorted(WRITERS))
def test_dispatch_rejects_write_before_started(name):
    state = V5SessionState(sessionId="denied", goal={"text": "inventory app"})
    async def run():
        return [event async for event in control._dispatch_tool(name, {}, state, "continue", [], [], "desktop", None, "inventory app")]
    events = asyncio.run(run())
    assert events == [{"type": "control_tool_result", "tool": name, "ok": False, "error": "plan_approval_required"}]


@pytest.mark.parametrize("approved", [False, True])
def test_forced_button_is_not_an_approval_receipt(monkeypatch, approved):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("forced-permission")
    (seed_approved_session if approved else seed_session)(sid, goal={"text": "inventory app", "status": "clear"})
    _, events = harness.post(six_fields(sid, "continue", forcedTool="rehearse"))
    assert len(harness.helper_calls) == int(approved)
    assert ("control_handoff_factory" in event_types(events)) is approved
    assert "control_scope_card" not in event_types(events)
