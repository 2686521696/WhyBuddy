"""The system instruction received by the model must match running-source IO.

The live 2026-09-13 smoke offered a tool that can synchronize source, but the
system prompt still ordered cancellation first. The model cancelled the real
runtime before any edit. Exercise HTTP assembly and durable recovery so fixing
only a tool description or a disconnected prompt helper cannot pass these tests.
"""
import asyncio
import json

import pytest
from project_actor_support import project_actor

from conftest import TEST_USER_ID
from control_turn_support import ControlHarness, llm_text, llm_tool
from services import rehearsal_control as control
from services.project_creation import create_session_project
from test_control_project_budget import parked_checkpoint
from test_control_project_tools import post, setup
from test_control_run_service import env, settled


def assert_live_guidance(messages, offered, *, has_project=True):
    prompt = messages[0]["content"]
    assert messages[0]["role"] == "system"
    assert "保持当前应用运行，不需要先取消" in prompt
    assert all(path in prompt for path in ("src/", "public/", "tests/", "index.html"))
    assert "completed 且 synchronized=true" in prompt
    assert "依赖或启动配置变更需先停止并确认清理" in prompt
    assert "修改前先取消活跃运行" not in prompt
    assert "私有预览和独立浏览器验收尚未接入" not in prompt
    if has_project:
        patch = next(item["function"] for item in offered if item["function"]["name"] == "project_patch")
        assert "existing worker" in patch["description"] and "synchronized=true" in patch["description"]
    else:
        names = {item["function"]["name"] for item in offered}
        assert "project_create" in names and "project_patch" not in names


@pytest.mark.parametrize("precreated", [False, True], ids=["new-project", "existing-project"])
def test_live_http_model_assembly_uses_source_sync_guidance_before_and_after_tool_result(setup, monkeypatch, precreated):
    if precreated:
        create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)
    observed = []
    def model(messages, **kwargs):
        results = [json.loads(message["content"]) for message in messages if message["role"] == "tool"]
        assert_live_guidance(messages, kwargs["tools"], has_project=precreated or bool(results))
        observed.append(messages[0]["content"])
        if not results:
            return llm_tool("project_read" if precreated else "project_create",
                {"path": "src/main.tsx"} if precreated else {"approvalRef": setup.ref})
        assert results[-1]["ok"], results[-1]
        return llm_text("The saved project can synchronize source while its runtime stays active.")
    harness.llm_impl = model
    events = post(setup.state)
    assert len(observed) == 2 and events[-1]["type"] == "complete"
    assert not any(event.get("tool") == "project_cancel" for event in events)


def test_durable_control_recovery_replaces_old_saved_stop_before_patch_instruction(env, monkeypatch):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)
    async def run():
        owned, initial_calls = await parked_checkpoint(env, monkeypatch)
        checkpoint = owned["checkpoint"]
        checkpoint["messages"][0] = {"role": "system", "content": "STALE: 修改前先取消活跃运行，等停止并清理完成后再 patch"}
        env.store.save_checkpoint(owned["runId"], "checkpoint-fixture", owned["generation"], checkpoint)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        received = []
        async def model(messages, **kwargs):
            assert_live_guidance(messages, kwargs["tools"])
            assert "STALE:" not in messages[0]["content"]
            received.append(messages)
            return llm_text("Recovered the current source synchronization contract.")
        monkeypatch.setattr(control, "_invoke_control_llm", model)
        second = env.service()
        await second.start()
        try:
            final = await settled(second, owned["runId"])
            assert final["status"] == "completed" and len(received) == 1 and len(initial_calls) == 1
        finally:
            await second.shutdown()
    asyncio.run(run())
