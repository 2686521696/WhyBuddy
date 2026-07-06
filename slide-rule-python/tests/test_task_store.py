"""Durable task store tests (services/task_store.py).

Covers the persistence.py-style guarantees adapted for tasks: atomic JSON
persistence roundtrip, lifecycle transition validation, cancel idempotency,
and corrupt-record isolation (one bad entry never poisons the store).
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import task_store  # noqa: E402


def _store(tmp_path):
    return tmp_path / "tasks.json"


def _create(tmp_path, title="Build the task store", **kwargs):
    result = task_store.create_task(title=title, store_file=_store(tmp_path), **kwargs)
    assert result["ok"] is True
    return result["task"]


# ---------------------------------------------------------------------------
# create: Node MissionStore.create record-shape parity
# ---------------------------------------------------------------------------


def test_create_task_matches_node_mission_record_shape(tmp_path):
    task = _create(tmp_path, source_text="  some   raw \n text  ", topic_id="topic-1")

    assert task["id"].startswith("mission_")
    assert task["kind"] == "chat"
    assert task["title"] == "Build the task store"
    assert task["sourceText"] == "some   raw \n text"
    assert task["topicId"] == "topic-1"
    assert task["status"] == "queued"
    assert task["progress"] == 0
    assert task["operatorState"] == "active"
    assert task["operatorActions"] == []
    assert task["attempt"] == 1
    assert task["createdAt"] == task["updatedAt"]

    assert [stage["key"] for stage in task["stages"]] == [
        "receive",
        "understand",
        "plan",
        "provision",
        "execute",
        "finalize",
    ]
    assert all(stage["status"] == "pending" for stage in task["stages"])

    assert len(task["events"]) == 1
    created = task["events"][0]
    assert created["type"] == "created"
    assert created["message"] == "Mission created: Build the task store"
    assert created["source"] == "mission-core"


def test_build_task_title_ports_node_truncation():
    assert task_store.build_task_title("  Task title  ", None) == "Task title"
    long_text = "word " * 30
    built = task_store.build_task_title(None, long_text)
    assert built.endswith("...")
    assert len(built) == 51  # 48 chars + '...'
    assert task_store.build_task_title(None, "short goal") == "short goal"
    assert task_store.build_task_title("   ", "   ") is None


# ---------------------------------------------------------------------------
# persistence roundtrip
# ---------------------------------------------------------------------------


def test_persistence_roundtrip_and_disk_contract(tmp_path):
    task = _create(tmp_path)

    raw = json.loads(_store(tmp_path).read_text(encoding="utf-8"))
    assert isinstance(raw, list)
    assert raw[0][0] == task["id"]
    assert raw[0][1]["title"] == "Build the task store"

    reloaded = task_store.get_task(task["id"], store_file=_store(tmp_path))
    assert reloaded["ok"] is True
    assert reloaded["task"] == task


def test_get_task_not_found(tmp_path):
    result = task_store.get_task("mission_missing", store_file=_store(tmp_path))
    assert result == {"ok": False, "error": "not_found", "taskId": "mission_missing"}


def test_list_tasks_orders_by_updated_at_desc_and_limits(tmp_path):
    first = _create(tmp_path, title="first")
    second = _create(tmp_path, title="second")
    # Touch the first task so it becomes the most recently updated.
    bumped = task_store.append_task_event(
        first["id"], message="bump", store_file=_store(tmp_path)
    )
    assert bumped["ok"] is True

    listed = task_store.list_tasks(store_file=_store(tmp_path))
    assert listed["ok"] is True
    assert [task["title"] for task in listed["tasks"]] == ["first", "second"]

    limited = task_store.list_tasks(limit=1, store_file=_store(tmp_path))
    assert len(limited["tasks"]) == 1
    assert limited["tasks"][0]["id"] == first["id"]
    assert second["id"]  # second still on disk, just outside the limit


# ---------------------------------------------------------------------------
# lifecycle transitions
# ---------------------------------------------------------------------------


def test_status_transitions_through_running_waiting_done(tmp_path):
    task = _create(tmp_path)
    store = _store(tmp_path)

    running = task_store.update_task_status(
        task["id"], "running", stage_key="execute", progress=40, store_file=store
    )
    assert running["ok"] is True
    assert running["task"]["status"] == "running"
    assert running["task"]["currentStageKey"] == "execute"
    assert running["task"]["progress"] == 40

    waiting = task_store.update_task_status(
        task["id"], "waiting", message="Need operator decision", store_file=store
    )
    assert waiting["ok"] is True
    assert waiting["task"]["status"] == "waiting"
    assert waiting["task"]["waitingFor"] == "Need operator decision"
    assert waiting["task"]["events"][-1]["type"] == "waiting"

    done = task_store.update_task_status(
        task["id"], "done", summary="All finished", store_file=store
    )
    assert done["ok"] is True
    assert done["task"]["status"] == "done"
    assert done["task"]["progress"] == 100
    assert done["task"]["summary"] == "All finished"
    assert done["task"]["completedAt"] >= done["task"]["createdAt"]
    assert "waitingFor" not in done["task"]
    assert done["task"]["events"][-1]["type"] == "done"


def test_failed_transition_records_error_event(tmp_path):
    task = _create(tmp_path)
    failed = task_store.update_task_status(
        task["id"], "failed", message="executor exploded", store_file=_store(tmp_path)
    )
    assert failed["ok"] is True
    assert failed["task"]["status"] == "failed"
    assert failed["task"]["events"][-1] == {
        **failed["task"]["events"][-1],
        "type": "failed",
        "level": "error",
        "message": "executor exploded",
    }


def test_final_statuses_are_terminal(tmp_path):
    store = _store(tmp_path)
    task = _create(tmp_path)
    assert task_store.update_task_status(task["id"], "done", store_file=store)["ok"] is True

    result = task_store.update_task_status(task["id"], "running", store_file=store)
    assert result["ok"] is False
    assert result["error"] == "invalid_transition"
    assert result["from"] == "done"
    assert result["to"] == "running"


def test_unknown_status_is_rejected(tmp_path):
    task = _create(tmp_path)
    result = task_store.update_task_status(
        task["id"], "exploded", store_file=_store(tmp_path)
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_status"


def test_update_status_not_found(tmp_path):
    result = task_store.update_task_status(
        "mission_missing", "running", store_file=_store(tmp_path)
    )
    assert result == {"ok": False, "error": "not_found", "taskId": "mission_missing"}


# ---------------------------------------------------------------------------
# cancel idempotency
# ---------------------------------------------------------------------------


def test_cancel_marks_node_cancel_fields(tmp_path):
    task = _create(tmp_path)
    cancelled = task_store.cancel_task(
        task["id"],
        reason="user asked",
        requested_by="user-1",
        store_file=_store(tmp_path),
    )
    assert cancelled["ok"] is True
    assert cancelled["alreadyFinal"] is False
    record = cancelled["task"]
    assert record["status"] == "cancelled"
    assert record["cancelReason"] == "user asked"
    assert record["cancelledBy"] == "user-1"
    assert record["cancelledAt"] == record["completedAt"] == record["updatedAt"]
    event = record["events"][-1]
    assert event["type"] == "cancelled"
    assert event["level"] == "warn"
    assert event["source"] == "user"


def test_cancel_is_idempotent_on_final_tasks(tmp_path):
    store = _store(tmp_path)
    task = _create(tmp_path)
    first = task_store.cancel_task(task["id"], reason="stop", store_file=store)
    assert first["alreadyFinal"] is False
    events_after_first = len(first["task"]["events"])

    second = task_store.cancel_task(task["id"], reason="stop again", store_file=store)
    assert second["ok"] is True
    assert second["alreadyFinal"] is True
    assert second["task"]["cancelReason"] == "stop"  # unchanged
    assert len(second["task"]["events"]) == events_after_first  # no extra event


def test_update_status_cancelled_routes_through_cancel_path(tmp_path):
    store = _store(tmp_path)
    task = _create(tmp_path)
    assert task_store.update_task_status(task["id"], "done", store_file=store)["ok"] is True

    # Final -> cancelled is the idempotent cancel contract, not an invalid transition.
    result = task_store.update_task_status(task["id"], "cancelled", store_file=store)
    assert result["ok"] is True
    assert result["alreadyFinal"] is True
    assert result["task"]["status"] == "done"


# ---------------------------------------------------------------------------
# events
# ---------------------------------------------------------------------------


def test_append_and_list_events_newest_first(tmp_path):
    store = _store(tmp_path)
    task = _create(tmp_path)
    for index in range(3):
        result = task_store.append_task_event(
            task["id"],
            message=f"log {index}",
            level="info",
            progress=10 * (index + 1),
            store_file=store,
        )
        assert result["ok"] is True
        assert result["event"]["type"] == "log"

    events = task_store.list_task_events(task["id"], limit=2, store_file=store)
    assert events["ok"] is True
    assert len(events["events"]) == 2
    times = [event["time"] for event in events["events"]]
    assert times == sorted(times, reverse=True)

    latest = task_store.get_task(task["id"], store_file=store)["task"]
    assert latest["progress"] == 30
    assert len(latest["events"]) == 4  # created + 3 logs


def test_append_event_rejects_unknown_type(tmp_path):
    task = _create(tmp_path)
    result = task_store.append_task_event(
        task["id"], event_type="explosion", message="boom", store_file=_store(tmp_path)
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_event_type"


# ---------------------------------------------------------------------------
# corruption isolation
# ---------------------------------------------------------------------------


def test_corrupt_entry_is_isolated_without_poisoning_store(tmp_path):
    store = _store(tmp_path)
    task = _create(tmp_path)

    raw = json.loads(store.read_text(encoding="utf-8"))
    raw.append(["mission_bad", {"id": "mission_bad", "status": "exploded", "events": []}])
    raw.append(["not-a-pair"])
    store.write_text(json.dumps(raw), encoding="utf-8")

    listed = task_store.list_tasks(store_file=store)
    assert listed["ok"] is True
    assert [item["id"] for item in listed["tasks"]] == [task["id"]]
    assert listed["skipped"] == 2

    survivor = task_store.get_task(task["id"], store_file=store)
    assert survivor["ok"] is True
    missing = task_store.get_task("mission_bad", store_file=store)
    assert missing["error"] == "not_found"


def test_invalid_json_store_fails_closed_without_clobbering(tmp_path):
    store = _store(tmp_path)
    store.write_text("{not json", encoding="utf-8")

    listed = task_store.list_tasks(store_file=store)
    assert listed["ok"] is False
    assert listed["error"] == "store_corrupt"
    assert listed["reason"] == "invalid_json"

    created = task_store.create_task(title="should not clobber", store_file=store)
    assert created["ok"] is False
    assert created["error"] == "store_corrupt"
    # The corrupt file is untouched for manual recovery.
    assert store.read_text(encoding="utf-8") == "{not json"


def test_missing_store_file_reads_as_empty(tmp_path):
    listed = task_store.list_tasks(store_file=_store(tmp_path))
    assert listed == {"ok": True, "tasks": [], "skipped": 0}
