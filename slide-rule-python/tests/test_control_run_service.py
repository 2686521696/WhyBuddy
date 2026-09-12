"""The durable host owns the real model loop; closing SSE must not own it."""

import asyncio
import json
from contextlib import aclosing
from types import SimpleNamespace

import httpx
import pytest

from app import app
from conftest import TEST_USER_ID
from control_turn_support import KEY, llm_text, llm_tool, new_sid, seed_approved_session, six_fields, parse_sse
from middlewares.current_user import optional_user
from services import persistence, rehearsal_control as control
from services.control_checkpoint import ControlRunStopped
from services.control_run_service import ControlRunService, RunCheckpoint
from services.control_run_store import ControlRunConflict, ControlRunStore, TERMINAL
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import load_authorized_session
from services.project_store import ProjectStore


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.session_blob_store import SqlSessionBlobStore
    blobs = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'state.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: blobs)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    from config.settings import settings
    monkeypatch.setattr(settings, "NODE_ENV", "development")
    project = ProjectStore.from_url(f"sqlite:///{tmp_path / 'state.db'}")
    store = ControlRunStore(project._q)
    state = seed_approved_session(new_sid("durable-control"), goal={"text": "Build a small project"})
    viewer = User(id=TEST_USER_ID, is_superuser=True)
    app.dependency_overrides[optional_user] = lambda: viewer
    authorize = lambda sid, owner: load_authorized_session(sid, owner_id=owner)
    def service():
        return ControlRunService(store, project, None, authorize=authorize,
                                 poll_seconds=0.01, lease_seconds=3)
    yield SimpleNamespace(project=project, store=store, blobs=blobs, state=state, service=service,
        owner=TEST_USER_ID, viewer=viewer, ref=approved_reference(state))
    project.close()
    blobs._engine.dispose()


async def settled(service, run_id):
    for _ in range(1000):
        record = await asyncio.to_thread(service.store.get, run_id, TEST_USER_ID)
        if record["status"] in TERMINAL:
            return record
        await asyncio.sleep(0.005)
    raise AssertionError("control run did not settle")


def test_http_is_durable_idempotent_and_owner_filtered(env, monkeypatch):
    model_calls = []
    async def model(messages, **kwargs):
        model_calls.append(messages)
        return llm_text("Ready for the next step")
    monkeypatch.setattr(control, "_invoke_control_llm", model)

    async def run():
        service = env.service()
        monkeypatch.setattr(app.state, "control_run_service", service, raising=False)
        await service.start()
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                headers = {**KEY, "x-control-request-id": "stable-request"}
                body = six_fields(env.state.sessionId, "Continue")
                first = await client.post("/api/sliderule/control-turn-stream", headers=headers, json=body)
                second = await client.post("/api/sliderule/control-turn-stream", headers=headers, json=body)
                assert first.status_code == second.status_code == 200
                run_id = first.headers["x-control-run-id"]
                assert run_id == second.headers["x-control-run-id"]
                assert len(model_calls) == 1
                events = parse_sse(first.text)
                assert any(e["type"] == "complete" for e in events)
                assert [e["seq"] for e in events if "seq" in e] == [1, 2]
                discovery = (await client.get("/api/sliderule/control-runs/latest",
                    params={"sessionId": env.state.sessionId}, headers=KEY)).json()["run"]
                assert discovery["runId"] == run_id
                assert not {"payload", "checkpoint", "ownerId", "events"} & discovery.keys()
                replay = await client.get(f"/api/sliderule/control-runs/{run_id}/stream?afterSeq=1", headers=KEY)
                assert [e["seq"] for e in parse_sse(replay.text) if "seq" in e] == [2]
                changed = await client.post("/api/sliderule/control-turn-stream", headers=headers,
                    json={**body, "userText": "Different request"})
                assert changed.status_code == 409
                env.viewer["id"] = "another-user"
                for method, path in [("GET", f"/control-runs/{run_id}"),
                    ("GET", f"/control-runs/{run_id}/stream"), ("DELETE", f"/control-runs/{run_id}")]:
                    assert (await client.request(method, "/api/sliderule" + path, headers=KEY)).status_code == 404
        finally:
            await service.shutdown()
    asyncio.run(run())


def test_rollout_rollback_keeps_existing_control_run_observable_without_worker(env, monkeypatch):
    """Read/cancel routes must work after rollback when the producer is absent."""
    from routes import sliderule_full

    async def run():
        service = env.service()
        record = await service.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "rollback-read")
        # Simulate a process configured with rollout disabled: no worker/service
        # was created during lifespan, but durable tables still contain the run.
        monkeypatch.setattr(sliderule_full, "get_project_store", lambda: env.project)
        monkeypatch.setattr(app.state, "control_run_service", None, raising=False)
        monkeypatch.delenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", raising=False)
        monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "disabled")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
            headers = {**KEY}
            latest = await client.get("/api/sliderule/control-runs/latest",
                params={"sessionId": env.state.sessionId}, headers=headers)
            assert latest.status_code == 200 and latest.json()["run"]["runId"] == record["runId"]
            observed = await client.get(f"/api/sliderule/control-runs/{record['runId']}", headers=headers)
            assert observed.status_code == 200
            cancelled = await client.delete(f"/api/sliderule/control-runs/{record['runId']}", headers=headers)
            assert cancelled.status_code == 200 and cancelled.json()["cancelRequested"]

    asyncio.run(run())


def test_closing_subscription_does_not_stop_or_duplicate_the_model(env, monkeypatch):
    async def run():
        started, release = asyncio.Event(), asyncio.Event()
        calls = []
        async def model(*args, **kwargs):
            calls.append(1)
            started.set()
            await release.wait()
            return llm_text("Still running after disconnect")
        monkeypatch.setattr(control, "_invoke_control_llm", model)
        service = env.service()
        await service.start()
        record = await service.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "disconnect")
        try:
            await asyncio.wait_for(started.wait(), 5)
            from routes.sliderule_full import _control_sse_response
            response = _control_sse_response(service, record["runId"], env.owner, 0)
            assert "control_run_started" in await anext(response.body_iterator)
            await response.body_iterator.aclose()
            assert env.store.get(record["runId"], env.owner)["status"] == "running"
            release.set()
            final = await settled(service, record["runId"])
            assert final["status"] == "completed"
            assert len(calls) == 1
            replay = [event async for event in service.subscribe(record["runId"], env.owner)]
            assert any(e.get("text") == "Still running after disconnect" for e in replay)
        finally:
            release.set()
            await service.shutdown()
    asyncio.run(run())


@pytest.mark.parametrize("hard_stop", [False, True], ids=["cooperative", "unconfirmed"])
def test_stop_during_factory_wait_cancels_child_before_releasing_session(env, monkeypatch, hard_stop):
    from services import run_registry, run_cancel
    monkeypatch.setattr(control, "resolve_archetype", lambda state: None)
    monkeypatch.setattr(run_registry, "_cancel_hard_grace_seconds", lambda: 0.05 if hard_stop else 5)

    async def run():
        started, release, waiting = asyncio.Event(), asyncio.Event(), asyncio.Event()
        children = []
        subscribe = run_registry.subscribe

        async def observed_subscription(child, since=0):
            async with aclosing(subscribe(child, since)) as stream:
                async for event in stream:
                    yield event
                    if event["type"] == "run_started":
                        waiting.set()

        async def factory():
            started.set()
            await release.wait()
            run_cancel.raise_if_cancelled("factory-test-drained")
            yield {"type": "complete", "state": env.state.model_dump()}

        async def start(sid, *args, **kwargs):
            child = await run_registry.start_run(sid, factory, owner_id=env.owner)
            children.append(child)
            return child

        monkeypatch.setattr(control, "start_drive_full_factory_run", start)
        monkeypatch.setattr(run_registry, "subscribe", observed_subscription)
        service = env.service()
        await service.start()
        record = await service.submit(six_fields(env.state.sessionId, "Build it", forcedTool="spec"),
                                      env.owner, "factory-stop")
        try:
            await asyncio.wait_for(started.wait(), 5)
            await asyncio.wait_for(waiting.wait(), 5)
            # No events arrive while the child waits: cancellation cannot rely
            # on the parent's next yielded event to discover its stop flag.
            await service.cancel(record["runId"], env.owner)
            for _ in range(200):
                if children[0].cancel_token.is_set():
                    break
                await asyncio.sleep(0.01)
            assert children[0].cancel_token.is_set()
            if not hard_stop:
                pending = env.store.get(record["runId"], env.owner)
                assert pending["status"] == "running" and pending["cancelRequested"]
                with pytest.raises(ControlRunConflict, match="control_run_active"):
                    await service.submit(six_fields(env.state.sessionId, "Another turn"), env.owner, "too-early")
                release.set()
            final = await settled(service, record["runId"])
            assert children[0].task.done()
            assert final["status"] == ("interrupted" if hard_stop else "cancelled")
            assert final["error"] == ("control_factory_stop_unconfirmed" if hard_stop else "control_cancelled")
            assert not any(e["type"] == "complete" for e in final["events"])
        finally:
            release.set()
            await service.shutdown()
    asyncio.run(run())


def test_restart_uses_saved_messages_and_does_not_create_project_twice(env, monkeypatch):
    calls, results = [], []
    async def model(messages, **kwargs):
        calls.append(1)
        receipts = [m for m in messages if m["role"] == "tool"]
        if not receipts:
            return llm_tool("project_create", {"approvalRef": env.ref}, "")
        result = receipts[-1]
        assistant = next(m for m in messages if m.get("tool_calls"))
        assert result["tool_call_id"] == assistant["tool_calls"][0]["id"]
        results.append(json.loads(result["content"]))
        return llm_text("Project remains saved")
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    original_save = RunCheckpoint.save

    async def run():
        first = env.service()
        stop_reached = asyncio.Event()
        async def crash_after_receipt(port, checkpoint):
            await original_save(port, checkpoint)
            if port.service is first and checkpoint.get("phase") == "model" and checkpoint.get("round") == 1:
                first._stopping = True
                stop_reached.set()
                raise ControlRunStopped("control_worker_shutdown")
        monkeypatch.setattr(RunCheckpoint, "save", crash_after_receipt)
        await first.start()
        record = await first.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "restart")
        await asyncio.wait_for(stop_reached.wait(), 5)
        await first.shutdown()
        saved = env.store.get(record["runId"], env.owner)
        assert saved["status"] == "running" and saved["checkpoint"]["round"] == 1
        assert len(calls) == 1
        project_id = env.project.get_project_for_session(env.state.sessionId, owner_id=env.owner).projectId
        second = env.service()
        await second.start()
        try:
            final = await settled(second, record["runId"])
            assert final["status"] == "completed"
            assert len(calls) == 2 and results[0]["ok"]
            assert results[0]["projectId"] == project_id
            assert sum(e.get("tool") == "project_create" and e["type"] == "control_tool_start"
                       for e in final["events"]) == 1
        finally:
            await second.shutdown()
    asyncio.run(run())


@pytest.mark.parametrize("phase", ["entry", "dispatching", "unknown_schema"])
def test_uncertain_side_effect_is_interrupted_without_replaying_post(env, monkeypatch, phase):
    calls = []
    async def model(*args, **kwargs):
        calls.append(1)
        return llm_text("Must not be invoked")
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    record = env.store.submit(env.state.sessionId, env.owner, "uncertain",
        six_fields(env.state.sessionId, "Continue", forcedTool="project_create", toolArgs={"approvalRef": env.ref}))
    claimed = env.store.claim(record["runId"], "old-worker", 3)
    env.store.save_checkpoint(record["runId"], "old-worker", claimed["generation"], {"schemaVersion": 1, "phase": phase})
    env.store.suspend(record["runId"], "old-worker", claimed["generation"])
    async def run():
        service = env.service()
        await service.start()
        try:
            final = await settled(service, record["runId"])
            assert final["status"] == "interrupted" and final["error"] == "control_reconciliation_required"
            assert not calls
            assert env.project.get_project_for_session(env.state.sessionId, owner_id=env.owner) is None
        finally:
            await service.shutdown()
    asyncio.run(run())


def test_explicit_cancel_stops_sampling_but_does_not_submit_another_tool(env, monkeypatch):
    async def run():
        started, model_closed = asyncio.Event(), asyncio.Event()
        async def model(*args, **kwargs):
            started.set()
            try:
                await asyncio.Future()
            finally:
                model_closed.set()
        monkeypatch.setattr(control, "_invoke_control_llm", model)
        service = env.service()
        await service.start()
        try:
            record = await service.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "cancel")
            await asyncio.wait_for(started.wait(), 5)
            requested = await service.cancel(record["runId"], env.owner)
            assert requested["cancelRequested"] and requested["status"] == "running"
            final = await settled(service, record["runId"])
            assert final["status"] == "cancelled" and model_closed.is_set()
            assert not any(e["type"] == "complete" for e in final["events"])
            assert env.project.get_project_for_session(env.state.sessionId, owner_id=env.owner) is None
        finally:
            await service.shutdown()
    asyncio.run(run())


def test_cancel_during_source_write_waits_for_the_write_to_finish(env, monkeypatch):
    import threading
    from services.project_tools import ProjectTools
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    original = ProjectTools.execute
    def slow_write(adapter, name, args, state):
        entered.set()
        release.wait(5)
        try:
            return original(adapter, name, args, state)
        finally:
            finished.set()
    monkeypatch.setattr(ProjectTools, "execute", slow_write)
    async def run():
        service = env.service()
        await service.start()
        try:
            record = await service.submit(six_fields(env.state.sessionId, "Continue",
                forcedTool="project_create", toolArgs={"approvalRef": env.ref}), env.owner, "source-cancel")
            assert await asyncio.to_thread(entered.wait, 5)
            await service.cancel(record["runId"], env.owner)
            await asyncio.sleep(0.03)
            assert env.store.get(record["runId"], env.owner)["status"] == "running"
            assert not finished.is_set()
            release.set()
            final = await settled(service, record["runId"])
            assert final["status"] == "cancelled" and finished.is_set()
        finally:
            release.set()
            await service.shutdown()
    asyncio.run(run())


@pytest.mark.parametrize("receipt_saved", [True, False])
def test_crash_after_project_submission_reconciles_receipt_or_interrupts(env, monkeypatch, receipt_saved):
    first = env.service()
    real_append = env.store.append_event
    async def model(messages, **kwargs):
        if not any(m["role"] == "tool" for m in messages):
            return llm_tool("project_create", {"approvalRef": env.ref}, "create-call")
        assert env.state.sessionId in messages[0]["content"] or "project" in messages[0]["content"].lower()
        return llm_text("Recovered the submitted project")
    monkeypatch.setattr(control, "_invoke_control_llm", model)

    def append(run_id, worker, generation, event):
        if worker == first.worker_id and event.get("type") == "control_tool_result":
            if receipt_saved:
                real_append(run_id, worker, generation, event)
            first._stopping = True
            raise ControlRunStopped("control_worker_shutdown")
        return real_append(run_id, worker, generation, event)
    monkeypatch.setattr(env.store, "append_event", append)

    async def run():
        await first.start()
        record = await first.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "receipt-gap")
        for _ in range(1000):
            saved = env.store.get(record["runId"], env.owner)
            if saved["leaseExpiresAt"] == 0 and saved["checkpoint"]:
                break
            await asyncio.sleep(0.005)
        else:
            raise AssertionError("crash boundary not reached")
        await first.shutdown()
        assert saved["checkpoint"]["phase"] == "dispatching"
        project = env.project.get_project_for_session(env.state.sessionId, owner_id=env.owner)
        assert project is not None
        second = env.service()
        await second.start()
        try:
            final = await settled(second, record["runId"])
            assert final["status"] == ("completed" if receipt_saved else "interrupted")
            assert sum(e["type"] == "control_tool_start" for e in final["events"]) == 1
            assert env.project.get_project_for_session(env.state.sessionId, owner_id=env.owner).projectId == project.projectId
        finally:
            await second.shutdown()
    asyncio.run(run())


def test_questionnaire_keeps_the_original_request_on_resubscription(env, monkeypatch):
    calls = []
    async def model(*args, **kwargs):
        calls.append(1)
        return llm_tool("ask_user_question", {"questions": [{"question": "Which device?", "options": [{"label": "Desktop"}]}]})
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    async def run():
        service = env.service()
        await service.start()
        try:
            record = await service.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "question")
            final = await settled(service, record["runId"])
            assert final["status"] == "waiting_user"
            first = next(e for e in final["events"] if e["type"] == "control_ask_user")
            replay = [e async for e in service.subscribe(record["runId"], env.owner)]
            second = next(e for e in replay if e["type"] == "control_ask_user")
            assert first["reqId"] == second["reqId"] and first["questions"] == second["questions"]
            assert len(calls) == 1
        finally:
            await service.shutdown()
    asyncio.run(run())


def test_completion_can_carry_an_existing_html_session_larger_than_log_limit(env, monkeypatch):
    from services.slide_rule_session import save_session
    env.state.specFirstPages = {"pages": {"home": "<main>" + "x" * 90000 + "</main>"}}
    save_session(env.state, server_write=True, require_durable=True)
    async def model(*args, **kwargs):
        return llm_text("Existing pages are still available")
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    async def run():
        service = env.service()
        await service.start()
        try:
            record = await service.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "large-state")
            final = await settled(service, record["runId"])
            assert final["status"] == "completed"
            complete = next(e for e in final["events"] if e["type"] == "complete")
            assert complete["state"]["specFirstPages"]["pages"]["home"] == env.state.specFirstPages["pages"]["home"]
        finally:
            await service.shutdown()
    asyncio.run(run())


def test_legacy_post_cannot_bypass_a_queued_durable_turn(env, monkeypatch):
    calls = []
    async def model(*args, **kwargs):
        calls.append(1)
        return llm_text("Must not execute")
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    async def run():
        service = env.service()
        monkeypatch.setattr(app.state, "control_run_service", service, raising=False)
        await service.submit(six_fields(env.state.sessionId, "First"), env.owner, "queued")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
            response = await client.post("/api/sliderule/control-turn-stream", headers=KEY,
                json=six_fields(env.state.sessionId, "Second"))
            assert response.status_code == 409 and not calls
            monkeypatch.setattr(app.state, "control_run_service", None)
            unavailable = await client.post("/api/sliderule/control-turn-stream", headers=KEY,
                json=six_fields(env.state.sessionId, "Second"))
            assert unavailable.status_code == 503 and not calls
    asyncio.run(run())


@pytest.mark.parametrize("commit", [control._commit_plan_state, control._commit_question_state])
def test_lost_generation_cannot_commit_question_or_plan_receipts(env, commit):
    from services.control_checkpoint import current_checkpoint
    service = env.service()
    record = env.store.submit(env.state.sessionId, env.owner, "old-writer", six_fields(env.state.sessionId, "Continue"))
    first = env.store.claim(record["runId"], service.worker_id, 3)
    old = RunCheckpoint(service, first)
    env.store.suspend(record["runId"], service.worker_id, first["generation"])
    env.store.claim(record["runId"], "new-worker", 3)
    candidate = env.state.model_copy(deep=True)
    candidate.awaitDetail = "must never commit"
    async def run():
        token = current_checkpoint.set(old)
        try:
            with pytest.raises(ControlRunStopped, match="control_lease_lost"):
                await commit(env.state, candidate)
        finally:
            current_checkpoint.reset(token)
    asyncio.run(run())
    assert load_authorized_session(env.state.sessionId, owner_id=env.owner).awaitDetail != "must never commit"


@pytest.mark.parametrize("entry", ["persist", "plan", "question"])
@pytest.mark.parametrize("changed", [True, False], ids=["changed-state", "unchanged-state"])
def test_session_sql_rejects_takeover_after_control_guard_passes(env, monkeypatch, entry, changed):
    """A passing Python guard cannot authorize a write after SQL lease takeover.

    The ordinary save and both receipt commits must carry the same fence through
    persistence, including its unchanged-payload shortcut and CAS retries.
    """
    from services.control_checkpoint import current_checkpoint

    first_service, second_service = env.service(), env.service()
    record = env.store.submit(env.state.sessionId, env.owner, "inflight-writer",
        six_fields(env.state.sessionId, "Continue"))
    first = env.store.claim(record["runId"], first_service.worker_id, 60)
    old = RunCheckpoint(first_service, first)
    before = env.blobs.load(env.state.sessionId)
    candidate = env.state.model_copy(deep=True)
    if changed:
        candidate.awaitDetail = "old worker must not commit"
    actual_save = env.blobs.save
    takeover = []
    old_sql_results = []

    def save_after_takeover(session_id, payload, *, expected_rev, expected_control_run=None):
        if not takeover:
            assert expected_control_run == old.fence()
            old.guard()
            env.store.suspend(record["runId"], first_service.worker_id, first["generation"])
            second = env.store.claim(record["runId"], second_service.worker_id, 60)
            assert second["generation"] == first["generation"] + 1
            takeover.append(RunCheckpoint(second_service, second))
        result = actual_save(session_id, payload, expected_rev=expected_rev,
            expected_control_run=expected_control_run)
        if expected_control_run == old.fence():
            old_sql_results.append(result)
        return result

    monkeypatch.setattr(env.blobs, "save", save_after_takeover)

    async def commit(port, state):
        token = current_checkpoint.set(port)
        try:
            if entry == "persist":
                return await asyncio.to_thread(control._persist, state)
            method = control._commit_plan_state if entry == "plan" else control._commit_question_state
            return await method(env.state, state)
        finally:
            current_checkpoint.reset(token)

    async def run():
        with pytest.raises(ControlRunStopped, match="control_session_persist_failed"):
            await commit(old, candidate)
        assert len(takeover) == 1
        assert old_sql_results and not any(old_sql_results)
        after = env.blobs.load(env.state.sessionId)
        assert after.rev == before.rev and after.payload == before.payload
        assert control.load_session(env.state.sessionId).awaitDetail == before.payload["awaitDetail"]
        assert env.state.awaitDetail == before.payload["awaitDetail"]

        current = load_authorized_session(env.state.sessionId, owner_id=env.owner).model_copy(deep=True)
        current.awaitDetail = "current worker committed"
        await commit(takeover[0], current)
        saved = env.blobs.load(env.state.sessionId)
        assert saved.rev == before.rev + 1
        assert saved.payload["awaitDetail"] == "current worker committed"
        assert control.load_session(env.state.sessionId).awaitDetail == "current worker committed"

    asyncio.run(run())


@pytest.mark.parametrize("entry", ["create", "sync"])
def test_project_reference_save_rejects_takeover_and_new_owner_repairs_it(env, monkeypatch, entry):
    """Source may commit before takeover; the old worker cannot publish its pointer."""
    from services import project_creation as creation
    from services.control_checkpoint import current_checkpoint
    from services.project_store import ProjectStoreUnavailable

    if entry == "sync":
        project = creation.create_session_project(env.project, env.state.sessionId,
            owner_id=env.owner, approval_ref=env.ref)
        files = env.project.read_files(project.projectId, owner_id=env.owner)
        files["src/main.tsx"] += "\n// Persisted source awaiting session reference sync\n"
        revision = env.project.commit_revision(project.projectId, owner_id=env.owner,
            expected_revision=project.currentRevision, files=files,
            template_version=creation.TEMPLATE_VERSION, plan_ref=env.ref)
        assert revision.revision != project.currentRevision

    before = env.blobs.load(env.state.sessionId)
    first_service, second_service = env.service(), env.service()
    record = env.store.submit(env.state.sessionId, env.owner, "reference-writer",
        six_fields(env.state.sessionId, "Continue"))
    first = env.store.claim(record["runId"], first_service.worker_id, 60)
    old = RunCheckpoint(first_service, first)
    actual_save = env.blobs.save
    takeover, writes = [], []

    def save_after_takeover(session_id, payload, *, expected_rev, expected_control_run=None):
        if not takeover:
            old.guard()
            assert payload["projectId"]
            assert payload["projectRevision"] != before.payload["projectRevision"]
            env.store.suspend(record["runId"], first_service.worker_id, first["generation"])
            second = env.store.claim(record["runId"], second_service.worker_id, 60)
            assert second["generation"] == first["generation"] + 1
            takeover.append(RunCheckpoint(second_service, second))
        result = actual_save(session_id, payload, expected_rev=expected_rev,
            expected_control_run=expected_control_run)
        writes.append((expected_control_run, result))
        return result

    monkeypatch.setattr(env.blobs, "save", save_after_takeover)
    operation = creation.create_session_project if entry == "create" else creation.sync_session_project

    def execute(port):
        token = current_checkpoint.set(port)
        try:
            return operation(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)
        finally:
            current_checkpoint.reset(token)

    with pytest.raises(ProjectStoreUnavailable, match="project_session_binding_failed"):
        execute(old)
    assert len(takeover) == 1
    assert writes and all(fence == old.fence() and not saved for fence, saved in writes)
    after = env.blobs.load(env.state.sessionId)
    assert after.rev == before.rev and after.payload == before.payload
    cached = control.load_session(env.state.sessionId)
    assert (cached.runtimeKind, cached.projectId, cached.projectRevision) == (
        before.payload["runtimeKind"], before.payload["projectId"], before.payload["projectRevision"])

    retained = env.project.get_project_for_session(env.state.sessionId, owner_id=env.owner)
    assert retained is not None
    retained_files = env.project.read_files(retained.projectId, owner_id=env.owner)
    if entry == "create":
        assert retained_files == creation.load_project_template()[0]
    else:
        assert retained.projectId == project.projectId
        assert retained.currentRevision == revision.revision and retained_files == files

    execute(takeover[0])
    recovered = env.project.get_project_for_session(env.state.sessionId, owner_id=env.owner)
    assert recovered.projectId == retained.projectId
    assert recovered.currentRevision == retained.currentRevision
    assert env.project.read_files(recovered.projectId, owner_id=env.owner) == retained_files
    saved = env.blobs.load(env.state.sessionId)
    assert saved.rev == before.rev + 1
    assert saved.payload["runtimeKind"] == "project"
    assert saved.payload["projectId"] == retained.projectId
    assert saved.payload["projectRevision"] == retained.currentRevision
    cached = control.load_session(env.state.sessionId)
    assert cached.projectId == retained.projectId and cached.projectRevision == retained.currentRevision


@pytest.mark.parametrize("budget,reason", [("cheapTokens", "token_budget"), ("round", "tool_rounds"), ("startedAt", "wall_clock")])
def test_restart_does_not_reset_exhausted_budgets(env, monkeypatch, budget, reason):
    first = env.service()
    original_save = RunCheckpoint.save
    model_calls = []
    async def model(messages, **kwargs):
        model_calls.append(1)
        return llm_tool("project_create", {"approvalRef": env.ref})
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    async def save(port, checkpoint):
        await original_save(port, checkpoint)
        if port.service is first and checkpoint.get("phase") == "model" and checkpoint.get("round") == 1:
            first._stopping = True
            raise ControlRunStopped("control_worker_shutdown")
    monkeypatch.setattr(RunCheckpoint, "save", save)
    async def run():
        await first.start()
        record = await first.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "budget")
        for _ in range(1000):
            saved = env.store.get(record["runId"], env.owner)
            if first._stopping and not first._tasks:
                break
            await asyncio.sleep(0.005)
        await first.shutdown()
        owned = env.store.claim(record["runId"], "budget-fixture", 3)
        checkpoint = owned["checkpoint"]
        # project_create has selected and persisted the project policy. Exhaust
        # that run's actual limits; the old cheap limits no longer apply here.
        policy = checkpoint["budgetPolicy"]
        checkpoint[budget] = {"cheapTokens": policy["maxTokens"] + 1,
                              "round": policy["maxRounds"], "startedAt": 0}[budget]
        env.store.save_checkpoint(record["runId"], "budget-fixture", owned["generation"], checkpoint)
        env.store.suspend(record["runId"], "budget-fixture", owned["generation"])
        second = env.service()
        await second.start()
        try:
            final = await settled(second, record["runId"])
            assert len(model_calls) == 1
            assert any(e.get("stopReason") == reason for e in final["events"]), final["events"]
        finally:
            await second.shutdown()
    asyncio.run(run())
