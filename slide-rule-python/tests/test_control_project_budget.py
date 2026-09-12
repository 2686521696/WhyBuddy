"""Project execution gets a pinned budget without weakening cheap control turns.

The live model experiment spent 3015 + 3336 + 4154 provider tokens to choose
status/read/patch; the legacy 8000-token pre-ignition policy rejected the patch.
Replay those measured usage values through the real HTTP dispatcher and source
store. Recovery tests stop a real durable producer at its saved checkpoint;
changing workers must not manufacture more tokens, rounds, or wall-clock time.
"""

import asyncio
import copy
import json
import time

import pytest

from conftest import TEST_USER_ID
from control_turn_support import ControlHarness, llm_text, llm_tool, six_fields
from services import rehearsal_control as control
from services.control_checkpoint import ControlRunStopped
from services.control_run_service import RunCheckpoint
from services.project_creation import create_session_project
from services.project_tools import ProjectTools
from services.slide_rule_session import load_session, save_session
from test_control_project_tools import post, setup
from test_control_run_service import env, settled


PROJECT_POLICY = {"profile": "project-v1", "maxRounds": 16,
                  "maxTokens": 64000, "maxWallSeconds": 180.0}


def stops(events):
    return [event for event in events if event.get("type") == "control_text" and event.get("stopReason")]


@pytest.mark.parametrize("precreated", [True, False], ids=["existing-project", "create-then-edit"])
def test_measured_status_read_patch_usage_reaches_real_source_write(setup, monkeypatch, precreated):
    if precreated:
        create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)
    snapshots = []
    original = RunCheckpoint.save

    async def observe(port, checkpoint):
        await original(port, checkpoint)
        if checkpoint.get("phase") in {"sampling", "model", "tools", "dispatching"}:
            snapshots.append(copy.deepcopy(checkpoint))

    monkeypatch.setattr(RunCheckpoint, "save", observe)

    def model(messages, **kwargs):
        results = [json.loads(message["content"]) for message in messages if message["role"] == "tool"]
        if not results:
            return llm_tool("project_status" if precreated else "project_create",
                {} if precreated else {"approvalRef": setup.ref}, usage={"total_tokens": 3015})
        previous = results[-1]
        assert previous["ok"], previous
        if len(results) == 1:
            return llm_tool("project_read", {"path": "src/main.tsx"}, "read", usage={"total_tokens": 3336})
        if len(results) == 2:
            return llm_tool("project_patch", {"approvalRef": setup.ref, "expectedRevision": previous["revision"],
                "changes": [{"path": "budget-proof.txt", "content": "Measured usage reached the real patch.\n",
                             "expectedSha256": None}]}, "patch", usage={"total_tokens": 4154})
        return llm_text("Source saved; browser verification has not run.")

    harness.llm_impl = model
    events = post(setup.state)
    assert not stops(events), stops(events)
    assert len(harness.llm_calls) == 4
    saved = load_session(setup.state.sessionId)
    assert setup.store.read_files(saved.projectId, owner_id=TEST_USER_ID)["budget-proof.txt"].startswith("Measured usage")
    assert any(event.get("tool") == "project_patch" and event.get("ok") for event in events)
    assert snapshots and snapshots[-1]["budgetPolicy"] == PROJECT_POLICY
    assert snapshots[-1]["cheapTokens"] == 3015 + 3336 + 4154
    assert snapshots[-1]["round"] == 3
    assert all(abs(cp["startedAt"] - snapshots[0]["startedAt"]) < 0.5 for cp in snapshots)
    if not precreated:
        assert snapshots[0]["budgetPolicy"]["maxTokens"] == 8000
        assert any(cp["budgetPolicy"] == PROJECT_POLICY and cp["cheapTokens"] == 3015 for cp in snapshots)
    assert not harness.helper_calls


@pytest.mark.parametrize("forged", [False, True], ids=["legacy", "client-forged-policy"])
def test_legacy_8001_tokens_still_prevent_project_creation(setup, monkeypatch, forged):
    harness = ControlHarness(monkeypatch)
    harness.llm_impl = lambda *a, **kw: llm_tool("project_create", {"approvalRef": setup.ref},
                                                usage={"total_tokens": 8001})
    extra = {"budgetPolicy": PROJECT_POLICY, "runtimeKind": "project", "projectId": "forged",
             "maxTokens": 99999999} if forged else {}
    events = post(setup.state, **extra)
    [stop] = stops(events)
    assert stop["stopReason"] == "token_budget" and stop["limit"] == 8000 and stop["used"] == 8001
    assert setup.store.get_project_for_session(setup.state.sessionId, owner_id=TEST_USER_ID) is None
    assert not any(event.get("tool") == "project_create" and event.get("ok") for event in events)


def test_project_token_exhaustion_rejects_patch_before_dispatch(setup, monkeypatch):
    project = create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)
    harness.llm_impl = lambda *a, **kw: llm_tool("project_patch", {"approvalRef": setup.ref,
        "expectedRevision": project.currentRevision, "changes": [{"path": "denied.txt", "content": "forbidden", "expectedSha256": None}]},
        usage={"total_tokens": PROJECT_POLICY["maxTokens"] + 1})
    events = post(setup.state)
    [stop] = stops(events)
    assert stop["stopReason"] == "token_budget" and stop["limit"] == PROJECT_POLICY["maxTokens"]
    assert "工程任务" in stop["text"] and "已用完" in stop["text"]
    assert "没点火" not in stop["text"] and "开始推演" not in stop["text"]
    saved = setup.store.get_project(project.projectId, owner_id=TEST_USER_ID)
    assert saved.currentRevision == project.currentRevision
    assert "denied.txt" not in setup.store.read_files(project.projectId, owner_id=TEST_USER_ID)
    assert not any(event.get("tool") == "project_patch" for event in events)


def test_project_round_limit_is_bounded_and_does_not_revert_to_eight(setup, monkeypatch):
    create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)

    def model(*args, **kwargs):
        index = len(harness.llm_calls)
        return llm_tool("project_read", {"path": "src/main.tsx", "offset": index, "limit": 1},
                        f"read-{index}", usage={"total_tokens": 1})

    harness.llm_impl = model
    events = post(setup.state)
    [stop] = stops(events)
    assert stop["stopReason"] == "tool_rounds" and stop["limit"] == PROJECT_POLICY["maxRounds"]
    assert len(harness.llm_calls) == PROJECT_POLICY["maxRounds"]
    assert len([event for event in events if event.get("tool") == "project_read" and event.get("ok")]) == PROJECT_POLICY["maxRounds"]


@pytest.mark.parametrize("mode", ["no-adapter", "approval-revoked"])
def test_project_marker_alone_cannot_choose_execution_policy(env, monkeypatch, mode):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)
    if mode == "approval-revoked":
        state = load_session(env.state.sessionId)
        state.controlTranscript = []
        save_session(state)
    adapter = None if mode == "no-adapter" else ProjectTools(env.project, None, env.owner)
    calls = []

    async def model(*a, **kw):
        calls.append(1)
        return llm_tool("project_read", {"path": "src/main.tsx"}, usage={"total_tokens": 8001})

    monkeypatch.setattr(control, "_invoke_control_llm", model)

    async def run():
        return [event async for event in control.run_control_turn(six_fields(env.state.sessionId, "Continue"),
            authorized_owner_id=env.owner, project_tools=adapter)]

    events = asyncio.run(run())
    [stop] = stops(events)
    assert calls == [1]
    assert stop["stopReason"] == "token_budget" and stop["limit"] == 8000


async def parked_checkpoint(env, monkeypatch):
    first = env.service()
    calls = []
    original = RunCheckpoint.save

    async def model(*a, **kw):
        calls.append(1)
        return llm_tool("project_read", {"path": "src/main.tsx"}, usage={"total_tokens": 3015})

    async def save(port, checkpoint):
        await original(port, checkpoint)
        if port.service is first and checkpoint.get("phase") == "model" and checkpoint.get("round") == 1:
            first._stopping = True
            raise ControlRunStopped("control_worker_shutdown")

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    monkeypatch.setattr(RunCheckpoint, "save", save)
    await first.start()
    record = await first.submit(six_fields(env.state.sessionId, "Continue approved work"), env.owner, "pin-budget")
    try:
        for _ in range(1000):
            if first._stopping and not first._tasks:
                break
            await asyncio.sleep(0.005)
        else:
            raise AssertionError("producer never reached its persisted recovery checkpoint")
    finally:
        await first.shutdown()
    owned = env.store.claim(record["runId"], "checkpoint-fixture", 3)
    assert owned is not None
    assert owned["checkpoint"]["budgetPolicy"] == PROJECT_POLICY
    assert owned["checkpoint"]["cheapTokens"] == 3015
    return owned, calls


@pytest.mark.parametrize("exhausted", ["tokens", "rounds", "wall"])
def test_recovery_keeps_spent_project_budget_and_stops_before_sampling(env, monkeypatch, exhausted):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)

    async def run():
        owned, calls = await parked_checkpoint(env, monkeypatch)
        cp = owned["checkpoint"]
        if exhausted == "tokens":
            cp["cheapTokens"] = PROJECT_POLICY["maxTokens"] + 1
        elif exhausted == "rounds":
            cp["round"] = PROJECT_POLICY["maxRounds"]
        else:
            cp["startedAt"] = time.time() - PROJECT_POLICY["maxWallSeconds"] - 10
        env.store.save_checkpoint(owned["runId"], "checkpoint-fixture", owned["generation"], cp)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        second = env.service()
        await second.start()
        try:
            final = await settled(second, owned["runId"])
            assert calls == [1], "recovery sampled again despite exhausted persisted budget"
            [stop] = stops(final["events"])
            assert stop["stopReason"] == {"tokens": "token_budget", "rounds": "tool_rounds", "wall": "wall_clock"}[exhausted]
            assert stop["limit"] == PROJECT_POLICY[{"tokens": "maxTokens", "rounds": "maxRounds", "wall": "maxWallSeconds"}[exhausted]]
        finally:
            await second.shutdown()

    asyncio.run(run())


@pytest.mark.parametrize("alteration", ["missing", "escalated", "unknown", "malformed"])
def test_recovery_cannot_upgrade_absent_or_invalid_policy(env, monkeypatch, alteration):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)

    async def run():
        owned, calls = await parked_checkpoint(env, monkeypatch)
        cp = owned["checkpoint"]
        if alteration == "missing":
            cp.pop("budgetPolicy")
            cp["cheapTokens"] = 8001
        elif alteration == "escalated":
            cp["budgetPolicy"]["maxTokens"] = 999999999
        elif alteration == "unknown":
            cp["budgetPolicy"]["profile"] = "client-unlimited"
        else:
            cp["budgetPolicy"] = "project-v1"
        env.store.save_checkpoint(owned["runId"], "checkpoint-fixture", owned["generation"], cp)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        second = env.service()
        await second.start()
        try:
            final = await settled(second, owned["runId"])
            assert calls == [1]
            if alteration == "missing":
                [stop] = stops(final["events"])
                assert stop["stopReason"] == "token_budget" and stop["limit"] == 8000
            else:
                assert final["status"] == "interrupted"
                assert final["error"] == "control_reconciliation_required"
        finally:
            await second.shutdown()

    asyncio.run(run())


def test_resumed_sample_adds_to_previous_tokens_before_any_patch(env, monkeypatch):
    project = create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)

    async def run():
        owned, calls = await parked_checkpoint(env, monkeypatch)
        # The next response alone fits; combining it with the already incurred
        # 3015 tokens must stop before its real project_patch can be dispatched.
        async def model(*a, **kw):
            calls.append(1)
            return llm_tool("project_patch", {"approvalRef": env.ref,
                "expectedRevision": project.currentRevision, "changes": [{"path": "over-budget.txt",
                    "content": "must not be saved", "expectedSha256": None}]},
                usage={"total_tokens": PROJECT_POLICY["maxTokens"] - 3015 + 1})

        monkeypatch.setattr(control, "_invoke_control_llm", model)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        second = env.service()
        await second.start()
        try:
            final = await settled(second, owned["runId"])
            assert calls == [1, 1]
            [stop] = stops(final["events"])
            assert stop["stopReason"] == "token_budget"
            assert stop["used"] == PROJECT_POLICY["maxTokens"] + 1
            assert "over-budget.txt" not in env.project.read_files(project.projectId, owner_id=env.owner)
            assert not any(event.get("tool") == "project_patch" for event in final["events"])
        finally:
            await second.shutdown()

    asyncio.run(run())
