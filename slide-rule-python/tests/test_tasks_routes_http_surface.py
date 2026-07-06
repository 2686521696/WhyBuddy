"""Contract tests for the /api/tasks HTTP surface (routes/tasks.py).

Mirrors the Node routes/tasks.ts core contract: create / list / get /
events / cancel field names, plus the Python-slice status-update endpoint.
Style follows tests/test_blueprint_job_runtime_proxy.py and
tests/test_auth_routes_http_surface.py.
"""

import json
import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.tasks import router  # noqa: E402


app = FastAPI()
app.include_router(router, prefix="/api/tasks")
client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"
HEADERS = {"X-Internal-Key": INTERNAL_KEY}


@pytest.fixture(autouse=True)
def task_store_file(tmp_path, monkeypatch):
    path = tmp_path / "tasks.json"
    monkeypatch.setenv("TASK_STORE_FILE", str(path))
    yield path


def _post(path, payload):
    return client.post(path, json=payload, headers=HEADERS)


def _create_task(**overrides):
    payload = {"title": "Ship the task store", **overrides}
    response = _post("/api/tasks", payload)
    assert response.status_code == 201
    return response.json()


# ---------------------------------------------------------------------------
# auth: 403 without / with wrong internal key
# ---------------------------------------------------------------------------


def test_requires_internal_key():
    assert client.post("/api/tasks", json={"title": "x"}).status_code == 403
    assert client.get("/api/tasks").status_code == 403
    assert (
        client.post(
            "/api/tasks", json={"title": "x"}, headers={"X-Internal-Key": "wrong"}
        ).status_code
        == 403
    )
    assert client.get("/api/tasks/task-1", headers={"X-Internal-Key": "wrong"}).status_code == 403
    assert client.post("/api/tasks/task-1/cancel", json={}).status_code == 403
    assert client.get("/api/tasks/task-1/events").status_code == 403


# ---------------------------------------------------------------------------
# create (POST /api/tasks) — Node contract field names
# ---------------------------------------------------------------------------


def test_create_returns_201_with_task_and_applied_lifecycle():
    data = _create_task(sourceText="build it", topicId="topic-9", kind="chat")

    assert data["ok"] is True
    task = data["task"]
    assert task["id"].startswith("mission_")
    assert task["title"] == "Ship the task store"
    assert task["sourceText"] == "build it"
    assert task["topicId"] == "topic-9"
    # Lifecycle runtime is in-process, so the create envelope is applied the
    # way Node does when TASK_LIFECYCLE_RUNTIME_BASE_URL is configured:
    # create -> started -> nodeStatus running, progress 4, stage receive.
    assert task["status"] == "running"
    assert task["progress"] == 4
    assert task["currentStageKey"] == "receive"

    lifecycle = data["lifecycle"]
    assert lifecycle["ok"] is True
    assert lifecycle["action"] == "create"
    assert lifecycle["contractVersion"] == "task-lifecycle.runtime-boundary.v1"
    assert lifecycle["task"]["status"] == "started"
    assert "lifecycleError" not in data


def test_create_builds_title_from_source_text():
    long_text = "deliver " * 20
    data = _create_task(title="   ", sourceText=long_text)
    assert data["task"]["title"].endswith("...")
    assert len(data["task"]["title"]) == 51


def test_create_requires_title_or_source_text():
    response = _post("/api/tasks", {})
    assert response.status_code == 400
    assert response.json() == {"error": "title or sourceText is required"}


def test_create_rejects_project_id_mismatch():
    response = _post(
        "/api/tasks",
        {
            "title": "x",
            "projectId": "project-a",
            "projection": {"projectId": "project-b"},
        },
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": "projectId mismatch between request body and projection"
    }


def test_create_with_project_id_mirrors_node_unconfigured_project_validation():
    response = _post("/api/tasks", {"title": "x", "projectId": "project-a"})
    assert response.status_code == 500
    assert response.json() == {"error": "Project owner validation is not configured"}


# ---------------------------------------------------------------------------
# get / list
# ---------------------------------------------------------------------------


def test_get_returns_node_not_found_shape():
    response = client.get("/api/tasks/mission_missing", headers=HEADERS)
    assert response.status_code == 404
    assert response.json() == {"error": "Task not found"}


def test_get_returns_task_with_status_lifecycle():
    task_id = _create_task()["task"]["id"]

    response = client.get(f"/api/tasks/{task_id}", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["task"]["id"] == task_id
    assert data["lifecycle"]["ok"] is True
    assert data["lifecycle"]["action"] == "status"


def test_list_returns_tasks_most_recent_first_with_limit():
    first = _create_task(title="first")["task"]["id"]
    second = _create_task(title="second")["task"]["id"]
    # Touch the first task so it is the most recently updated.
    assert (
        _post(f"/api/tasks/{first}/events", {"message": "bump"}).status_code == 200
    )

    response = client.get("/api/tasks", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert [task["id"] for task in data["tasks"]] == [first, second]

    limited = client.get("/api/tasks", params={"limit": 1}, headers=HEADERS)
    assert [task["id"] for task in limited.json()["tasks"]] == [first]


# ---------------------------------------------------------------------------
# status updates (Python-slice endpoint over Node runtime mark* semantics)
# ---------------------------------------------------------------------------


def test_update_status_walks_legal_lifecycle():
    task_id = _create_task()["task"]["id"]

    waiting = _post(
        f"/api/tasks/{task_id}/status",
        {"status": "waiting", "message": "Need operator decision"},
    )
    assert waiting.status_code == 200
    assert waiting.json()["task"]["status"] == "waiting"
    assert waiting.json()["task"]["waitingFor"] == "Need operator decision"

    done = _post(
        f"/api/tasks/{task_id}/status",
        {"status": "done", "summary": "Shipped"},
    )
    assert done.status_code == 200
    task = done.json()["task"]
    assert task["status"] == "done"
    assert task["progress"] == 100
    assert task["summary"] == "Shipped"


def test_update_status_rejects_illegal_transition_with_409():
    task_id = _create_task()["task"]["id"]
    assert _post(f"/api/tasks/{task_id}/status", {"status": "failed"}).status_code == 200

    response = _post(f"/api/tasks/{task_id}/status", {"status": "running"})
    assert response.status_code == 409
    data = response.json()
    assert data["from"] == "failed"
    assert data["to"] == "running"
    assert "Illegal task status transition" in data["error"]


def test_update_status_rejects_unknown_status_and_missing_task():
    task_id = _create_task()["task"]["id"]
    assert (
        _post(f"/api/tasks/{task_id}/status", {"status": "exploded"}).status_code == 400
    )
    assert _post(f"/api/tasks/{task_id}/status", {}).status_code == 400
    assert (
        _post("/api/tasks/mission_missing/status", {"status": "running"}).status_code
        == 404
    )


# ---------------------------------------------------------------------------
# cancel — Node contract: idempotent alreadyFinal, executorForwarded flag
# ---------------------------------------------------------------------------


def test_cancel_running_task_matches_node_response_shape():
    task_id = _create_task()["task"]["id"]

    response = _post(
        f"/api/tasks/{task_id}/cancel",
        {"reason": "user asked", "requestedBy": "user-1", "source": "user"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["alreadyFinal"] is False
    assert data["executorForwarded"] is False
    assert data["task"]["status"] == "cancelled"
    assert data["task"]["cancelReason"] == "user asked"
    assert data["task"]["cancelledBy"] == "user-1"
    assert data["lifecycle"]["ok"] is True
    assert data["lifecycle"]["action"] == "cancel"


def test_cancel_is_idempotent_on_final_task():
    task_id = _create_task()["task"]["id"]
    assert _post(f"/api/tasks/{task_id}/cancel", {"reason": "stop"}).status_code == 200

    second = _post(f"/api/tasks/{task_id}/cancel", {"reason": "stop again"})
    assert second.status_code == 200
    data = second.json()
    assert data["ok"] is True
    assert data["alreadyFinal"] is True
    assert data["executorForwarded"] is False
    assert data["task"]["cancelReason"] == "stop"  # unchanged by second cancel


def test_cancel_missing_task_returns_404():
    response = _post("/api/tasks/mission_missing/cancel", {})
    assert response.status_code == 404
    assert response.json() == {"error": "Task not found"}


# ---------------------------------------------------------------------------
# events — append + list (Node GET /:id/events contract)
# ---------------------------------------------------------------------------


def test_append_and_list_events():
    task_id = _create_task()["task"]["id"]

    appended = _post(
        f"/api/tasks/{task_id}/events",
        {"type": "log", "message": "checkpoint", "level": "info", "progress": 42},
    )
    assert appended.status_code == 200
    data = appended.json()
    assert data["ok"] is True
    assert data["missionId"] == task_id
    assert data["event"]["type"] == "log"
    assert data["event"]["message"] == "checkpoint"
    assert data["task"]["progress"] == 42

    listed = client.get(f"/api/tasks/{task_id}/events", headers=HEADERS)
    assert listed.status_code == 200
    events = listed.json()
    assert events["ok"] is True
    assert events["missionId"] == task_id
    types = [event["type"] for event in events["events"]]
    assert "created" in types
    assert "log" in types
    times = [event["time"] for event in events["events"]]
    assert times == sorted(times, reverse=True)
    assert events["lifecycle"]["action"] == "replay"
    assert events["lifecycle"]["replay"]["owner"] == "node"

    limited = client.get(
        f"/api/tasks/{task_id}/events", params={"limit": 1}, headers=HEADERS
    )
    assert len(limited.json()["events"]) == 1


def test_append_event_validation_and_missing_task():
    task_id = _create_task()["task"]["id"]
    assert _post(f"/api/tasks/{task_id}/events", {}).status_code == 400
    assert (
        _post(
            f"/api/tasks/{task_id}/events", {"type": "explosion", "message": "boom"}
        ).status_code
        == 400
    )
    assert (
        _post("/api/tasks/mission_missing/events", {"message": "boom"}).status_code
        == 404
    )
    listed_missing = client.get("/api/tasks/mission_missing/events", headers=HEADERS)
    assert listed_missing.status_code == 404
    assert listed_missing.json() == {"error": "Task not found"}


# ---------------------------------------------------------------------------
# store corruption isolation over the HTTP surface
# ---------------------------------------------------------------------------


def test_corrupt_entry_is_isolated_from_http_surface(task_store_file):
    survivor = _create_task(title="survivor")["task"]["id"]

    raw = json.loads(task_store_file.read_text(encoding="utf-8"))
    raw.append(["mission_bad", {"id": "mission_bad", "status": "exploded", "events": []}])
    task_store_file.write_text(json.dumps(raw), encoding="utf-8")

    listed = client.get("/api/tasks", headers=HEADERS)
    assert listed.status_code == 200
    assert [task["id"] for task in listed.json()["tasks"]] == [survivor]

    corrupt = client.get("/api/tasks/mission_bad", headers=HEADERS)
    assert corrupt.status_code == 404


def test_invalid_json_store_surfaces_store_corrupt_500(task_store_file):
    task_store_file.write_text("{not json", encoding="utf-8")

    response = client.get("/api/tasks", headers=HEADERS)
    assert response.status_code == 500
    data = response.json()
    assert data["ok"] is False
    assert data["error"] == "store_corrupt"
    assert data["reason"] == "invalid_json"

    # Creation must fail closed instead of clobbering the corrupt file.
    created = _post("/api/tasks", {"title": "should fail"})
    assert created.status_code == 500
    assert created.json()["error"] == "store_corrupt"
    assert task_store_file.read_text(encoding="utf-8") == "{not json"


def test_persistence_roundtrip_across_http_calls(task_store_file):
    task_id = _create_task(title="durable")["task"]["id"]

    on_disk = dict(json.loads(task_store_file.read_text(encoding="utf-8")))
    assert task_id in on_disk

    fetched = client.get(f"/api/tasks/{task_id}", headers=HEADERS)
    assert fetched.status_code == 200
    assert fetched.json()["task"]["title"] == "durable"
    assert fetched.json()["task"] == on_disk[task_id]
