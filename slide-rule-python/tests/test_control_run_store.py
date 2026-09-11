"""Real SQL/HTTP-adapter CAS tests for control producer and subscriber state."""

import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from sqlalchemy import text

from services import control_run_store as module
from services.control_run_store import ControlRunConflict, ControlRunNotFound, ControlRunStore, ControlRunUnavailable
from services.project_store import ProjectStore
from services.sql_gateway import HttpSqlGateway


@pytest.fixture(params=["sql", "http"])
def store(request, tmp_path):
    base = ProjectStore.from_url(f"sqlite:///{tmp_path / 'control.db'}")
    if request.param == "sql":
        yield ControlRunStore(base._q)
    else:
        def respond(req):
            body = json.loads(req.content)
            parts = body["sql"].split("%s")
            sql = "".join(part + (f":p{i}" if i < len(parts) - 1 else "") for i, part in enumerate(parts))
            with base._engine.begin() as conn:
                result = conn.execute(text(sql), {f"p{i}": value for i, value in enumerate(body["params"])})
                rows = [dict(row) for row in result.mappings()] if result.returns_rows else []
            return httpx.Response(200, json={"rows": rows, "truncated": False})

        gateway = HttpSqlGateway("https://control-db.test", "test-only-key")
        gateway._client.close()
        gateway._client = httpx.Client(transport=httpx.MockTransport(respond))
        yield ControlRunStore(gateway.query)
        gateway._client.close()
    base.close()


def submit(store, *, key="request-1", session="session-1", payload=None):
    return store.submit(session, "alice", key, payload or {"message": "Create an app"})


def claim(store, *, worker="worker-1", lease=30):
    run = submit(store)
    return store.claim(run["runId"], worker, lease)


def test_submission_is_idempotent_and_data_is_detached(store):
    request = {"message": "Hello", "nested": {"value": 1}}
    first = submit(store, payload=request)
    request["nested"]["value"] = 2
    repeated = submit(store, payload={"nested": {"value": 1}, "message": "Hello"})
    assert repeated["runId"] == first["runId"] and repeated["payload"]["nested"]["value"] == 1
    assert first["status"] == "queued" and first["generation"] == 0 and first["lastSeq"] == 0
    assert first["events"] == [] and first["checkpoint"] is None
    with pytest.raises(ControlRunConflict, match="idempotency"):
        submit(store, payload={"message": "Changed"})
    assert store.latest("session-1", "alice")["runId"] == first["runId"]
    assert store.latest("unknown", "alice") is None


def test_other_owner_cannot_read_submit_latest_or_cancel(store):
    run = submit(store)
    for call in (lambda: store.get(run["runId"], "bob"), lambda: store.latest("session-1", "bob"),
            lambda: store.cancel(run["runId"], "bob"), lambda: store.submit("session-1", "bob", "other", {})):
        with pytest.raises(ControlRunNotFound):
            call()
    assert not store.get(run["runId"], "alice")["cancelRequested"]


def test_one_active_turn_per_session_even_after_lease_expiry(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    first = claim(store, lease=10)
    with pytest.raises(ControlRunConflict, match="control_run_active"):
        submit(store, key="second")
    clock[0] += 11
    with pytest.raises(ControlRunConflict, match="control_run_active"):
        submit(store, key="second")
    assert store.list_runnable()[0]["runId"] == first["runId"]
    second = store.claim(first["runId"], "worker-2", 10)
    assert second["generation"] == 2
    store.finish(second["runId"], "worker-2", 2, "interrupted", error="missing_checkpoint")
    next_run = submit(store, key="second")
    assert next_run["runId"] != first["runId"]


@pytest.mark.parametrize("status", sorted(module.TERMINAL))
def test_terminal_releases_session_but_cannot_be_reclaimed(store, status):
    run = claim(store)
    finished = store.finish(run["runId"], "worker-1", 1, status)
    assert finished["status"] == status and finished["leaseExpiresAt"] == 0
    assert store.claim(run["runId"], "worker-2", 30) is None
    assert store.cancel(run["runId"], "alice") == finished
    assert store.list_runnable() == []
    following = submit(store, key="second")
    assert store.latest("session-1", "alice")["runId"] == following["runId"]
    assert submit(store)["runId"] == run["runId"]
    assert store.get(run["runId"], "alice")["status"] == status


def test_claim_conflict_and_generation_fence_every_producer_write(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    run = claim(store, lease=10)
    assert store.claim(run["runId"], "worker-1", 10)["generation"] == 1
    assert store.claim(run["runId"], "worker-2", 10) is None
    writes = [lambda: store.heartbeat(run["runId"], "worker-1", 1, 10),
        lambda: store.save_checkpoint(run["runId"], "worker-1", 1, {"phase": "ready"}),
        lambda: store.append_event(run["runId"], "worker-1", 1, {"type": "done"}),
        lambda: store.finish(run["runId"], "worker-1", 1, "completed")]
    clock[0] = 1010.0
    for write in writes:
        with pytest.raises(ControlRunConflict, match="lease_lost"):
            write()
    replacement = store.claim(run["runId"], "worker-2", 10)
    assert replacement["generation"] == 2
    for write in writes:
        with pytest.raises(ControlRunConflict, match="lease_lost"):
            write()
    saved = store.get(run["runId"], "alice")
    assert saved["events"] == [] and saved["checkpoint"] is None and saved["status"] == "running"


def test_event_sequence_and_checkpoint_survive_reopen(tmp_path):
    url = f"sqlite:///{tmp_path / 'restart.db'}"
    first = ProjectStore.from_url(url)
    store = ControlRunStore(first._q)
    run = claim(store)
    store.save_checkpoint(run["runId"], "worker-1", 1, {"messages": [{"role": "assistant", "text": "partial"}], "phase": "model"})
    saved = store.append_event(run["runId"], "worker-1", 1, {"type": "text", "seq": 900, "controlRunId": "forged", "text": "hello"})
    assert saved["seq"] == 1 and saved["controlRunId"] == run["runId"]
    first.close()
    second = ProjectStore.from_url(url)
    reopened = ControlRunStore(second._q)
    record = reopened.get(run["runId"], "alice")
    assert record["checkpoint"]["phase"] == "model" and record["events"] == [saved] and record["lastSeq"] == 1
    appended = reopened.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "world"})
    assert appended["seq"] == 2
    second.close()


def test_concurrent_submissions_have_one_winner_and_idempotency_is_shared(store):
    def attempt(key):
        try:
            return submit(store, key=key)["runId"]
        except ControlRunConflict:
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        winners = [run for run in pool.map(attempt, [f"key-{i}" for i in range(6)]) if run]
    assert len(winners) == 1
    assert [run["runId"] for run in store.list_runnable()] == winners
    with ThreadPoolExecutor(max_workers=6) as pool:
        shared = list(pool.map(lambda _: submit(store, session="other-session")["runId"], range(6)))
    assert len(set(shared)) == 1


def test_concurrent_event_append_and_cancel_keep_every_event_and_sticky_cancel(store):
    run = claim(store)
    with ThreadPoolExecutor(max_workers=6) as pool:
        events = list(pool.map(lambda n: store.append_event(run["runId"], "worker-1", 1, {"type": "value", "n": n}), range(12)))
    assert sorted(event["seq"] for event in events) == list(range(1, 13))
    record = store.cancel(run["runId"], "alice")
    assert record["cancelRequested"] and record["status"] == "running" and record["lastSeq"] == 12
    store.save_checkpoint(run["runId"], "worker-1", 1, {"phase": "cancel"})
    assert store.get(run["runId"], "alice")["cancelRequested"]


def test_cancel_race_during_checkpoint_cas_does_not_lose_intent(store, monkeypatch):
    run = claim(store)
    original = store._q
    raced = [False]

    def cancel_before_save(sql, params=None):
        if sql.startswith("update wb_control_run set status=") and not raced[0]:
            raced[0] = True
            store.cancel(run["runId"], "alice")
        return original(sql, params)

    monkeypatch.setattr(store, "_q", cancel_before_save)
    record = store.save_checkpoint(run["runId"], "worker-1", 1, {"phase": "tool"})
    assert record["cancelRequested"] and record["checkpoint"] == {"phase": "tool"}


def test_expiry_between_read_and_sql_cas_rejects_the_write(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    run = claim(store, lease=10)
    original = module._json

    def expire_after_read(value, limit):
        if isinstance(value, dict) and "generation" in value:
            clock[0] = 1011
        return original(value, limit)

    monkeypatch.setattr(module, "_json", expire_after_read)
    with pytest.raises(ControlRunConflict, match="lease_lost"):
        store.append_event(run["runId"], "worker-1", 1, {"type": "text"})
    assert store.get(run["runId"], "alice")["lastSeq"] == 0


def test_event_and_total_size_limits_preserve_room_for_terminal_state(store):
    store.max_events = 1
    store.max_run_bytes = 8192
    run = claim(store)
    store.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "a" * 100})
    with pytest.raises(ValueError, match="event_count_limit"):
        store.append_event(run["runId"], "worker-1", 1, {"type": "text"})
    with pytest.raises(ValueError, match="size_limit"):
        store.save_checkpoint(run["runId"], "worker-1", 1, {"messages": "x" * 8000})
    assert store.get(run["runId"], "alice")["lastSeq"] == 1
    assert store.finish(run["runId"], "worker-1", 1, "failed", error="bounded log capacity reached")["status"] == "failed"


def test_failed_session_publication_leaves_inert_recoverable_run(store, monkeypatch):
    original = store._q

    def fail_publication(sql, params=None):
        if sql.startswith("update wb_control_session set active_run_id="):
            raise ControlRunUnavailable("injected_database_failure")
        return original(sql, params)

    monkeypatch.setattr(store, "_q", fail_publication)
    with pytest.raises(ControlRunUnavailable):
        submit(store)
    assert store.list_runnable() == [] and store.latest("session-1", "alice") is None
    raw = original("select id from wb_control_run")[0]["id"]
    with pytest.raises(ControlRunNotFound):
        store.get(raw, "alice")
    monkeypatch.setattr(store, "_q", original)
    assert submit(store)["runId"] == raw
    assert store.list_runnable()[0]["runId"] == raw


def test_crash_after_session_cas_is_observable_and_idempotent(store, monkeypatch):
    original = store._q

    def fail_ack(sql, params=None):
        if sql.startswith("update wb_control_run set accepted=1"):
            raise ControlRunUnavailable("injected_after_session_publication")
        return original(sql, params)

    monkeypatch.setattr(store, "_q", fail_ack)
    with pytest.raises(ControlRunUnavailable):
        submit(store)
    observed = store.latest("session-1", "alice")
    assert observed["status"] == "queued"
    assert submit(store)["runId"] == observed["runId"]
    monkeypatch.setattr(store, "_q", original)
    claimed = store.claim(observed["runId"], "worker", 30)
    store.finish(claimed["runId"], "worker", 1, "completed")
    submit(store, key="next")
    assert store.get(observed["runId"], "alice")["status"] == "completed"


def test_query_failure_message_does_not_expose_database_credentials():
    def unavailable(sql, params):
        raise RuntimeError("postgres://user:secret@database.invalid")

    with pytest.raises(ControlRunUnavailable) as failure:
        ControlRunStore(unavailable)
    assert str(failure.value) == "control_run_store_unavailable"


@pytest.mark.parametrize("owner", [None, "", "   "])
def test_empty_owner_never_turns_public_reads_or_cancel_into_trusted_access(store, owner):
    run = submit(store)
    for call in (lambda: store.get(run["runId"], owner), lambda: store.latest("session-1", owner),
            lambda: store.cancel(run["runId"], owner)):
        with pytest.raises(ValueError, match="owner_required"):
            call()


def test_expired_claim_preserves_checkpoint_and_events_for_recovery(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    run = claim(store, lease=10)
    checkpoint = {"phase": "tool_result", "toolCallId": "call-1", "messages": [{"role": "tool", "content": "done"}]}
    store.save_checkpoint(run["runId"], "worker-1", 1, checkpoint)
    event = store.append_event(run["runId"], "worker-1", 1, {"type": "tool_result", "text": "done"})
    clock[0] = 1011
    runnable = store.list_runnable()[0]
    assert runnable["checkpoint"] == checkpoint and runnable["events"] == [event]
    recovered = store.claim(run["runId"], "worker-2", 30)
    assert recovered["checkpoint"] == checkpoint and recovered["lastSeq"] == 1
    assert recovered["generation"] == 2 and recovered["leaseOwner"] == "worker-2"


def test_cancel_cas_does_not_overwrite_concurrent_events(store, monkeypatch):
    run = claim(store)
    original = store._q
    raced = [False]

    def append_before_cancel(sql, params=None):
        if sql.startswith("update wb_control_run set rev=rev+1,payload=") and not raced[0]:
            raced[0] = True
            store.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "concurrent"})
        return original(sql, params)

    monkeypatch.setattr(store, "_q", append_before_cancel)
    cancelled = store.cancel(run["runId"], "alice")
    assert cancelled["lastSeq"] == 1 and cancelled["events"][0]["text"] == "concurrent"
    assert cancelled["cancelRequested"]


@pytest.mark.parametrize("lease", [True, 0, -1, 3601, float("nan"), "30"])
def test_invalid_leases_cannot_claim(store, lease):
    run = submit(store)
    with pytest.raises(ValueError, match="lease_seconds"):
        store.claim(run["runId"], "worker", lease)
    assert store.get(run["runId"], "alice")["generation"] == 0


@pytest.mark.parametrize("event_type,field", [("spec_page", "html"), ("skill_result", "modelSection"), ("factory_complete", "state")])
def test_artifact_events_keep_real_payloads_larger_than_a_log_chunk(store, event_type, field):
    run = claim(store)
    event = {"type": event_type, field: {"content": "x" * 90000}}
    saved = store.append_event(run["runId"], "worker-1", 1, event)
    assert saved[field] == event[field]
    with pytest.raises(ValueError, match="control_run_size_limit"):
        store.append_event(run["runId"], "worker-1", 1, {"type": "log", "text": "x" * 90000})


def test_completion_publishes_state_and_releases_the_slot_together(store):
    run = claim(store)
    final = store.complete(run["runId"], "worker-1", 1, "completed", {"type": "complete", "state": {"sessionId": "session-1"}})
    assert final["status"] == "completed" and final["events"][-1]["type"] == "complete"
    assert submit(store, key="next")["runId"] != run["runId"]


def test_cancel_wins_over_late_completion_publication(store):
    run = claim(store)
    store.cancel(run["runId"], "alice")
    final = store.complete(run["runId"], "worker-1", 1, "completed", {"type": "complete", "state": {}})
    assert final["status"] == "cancelled" and not final["events"]


@pytest.mark.parametrize("submitted", [True, False])
def test_request_stop_survives_arriving_before_run_publication(store, submitted):
    if submitted:
        submit(store)
    store.cancel_request("session-1", "alice", "request-1")
    run = submit(store)
    assert store.get(run["runId"], "alice")["cancelRequested"]
    claimed = store.claim(run["runId"], "worker", 30)
    assert claimed["cancelRequested"]
