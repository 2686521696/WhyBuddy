"""HTTP surface tests for /api/executor/events (routes/executor_events.py).

Style follows tests/test_tasks_routes_http_surface.py: mount the router on a
bare FastAPI app, authenticate with X-Internal-Key, assert the projection
envelope contract consumed by the Node delegation seam
(server/routes/executor-events-python-projection.ts).
"""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.executor_events import router  # noqa: E402


app = FastAPI()
app.include_router(router, prefix="/api/executor/events")
client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"
HEADERS = {"X-Internal-Key": INTERNAL_KEY}


def _project(payload):
    return client.post("/api/executor/events/project", json=payload, headers=HEADERS)


BASE_EVENT = {
    "version": "2026-03-28",
    "eventId": "evt-http-1",
    "missionId": "mission-http-1",
    "jobId": "job-http-1",
    "executor": "lobster-executor",
    "type": "job.progress",
    "status": "running",
    "occurredAt": "2026-07-06T10:00:00.000Z",
    "progress": 64,
    "message": "working",
}

MISSION = {"currentProgress": 12, "stageLabel": "执行"}


def test_requires_internal_key():
    assert (
        client.post("/api/executor/events/project", json={"event": BASE_EVENT}).status_code
        == 403
    )
    assert (
        client.post(
            "/api/executor/events/project",
            json={"event": BASE_EVENT},
            headers={"X-Internal-Key": "wrong"},
        ).status_code
        == 403
    )


def test_project_progress_event_returns_python_marked_envelope():
    response = _project({"event": BASE_EVENT, "mission": MISSION})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["source"] == "python"
    assert body["provenance"] == "python-executor-event-projection"
    assert body["missionId"] == "mission-http-1"
    assert body["jobId"] == "job-http-1"
    assert body["eventId"] == "evt-http-1"
    assert body["stateChanging"] is True
    assert body["action"] == {"action": "progress", "progress": 64}
    assert body["routing"] == {
        "route": "mission",
        "missionId": "mission-http-1",
        "jobId": "job-http-1",
        "eventId": "evt-http-1",
        "callbackSource": "node",
        "terminal": False,
        "ignoredTerminal": False,
    }
    assert body["apply"]["kind"] == "running"
    assert body["apply"]["progress"] == 64
    assert body["apply"]["detail"] == "working"
    assert body["apply"]["resetHeartbeat"] is True
    assert body["apply"]["clearHeartbeat"] is False


def test_project_terminal_event_clears_heartbeat_and_marks_terminal():
    event = {
        **BASE_EVENT,
        "eventId": "evt-http-done",
        "type": "job.completed",
        "status": "completed",
        "summary": "All work finished.",
    }
    body = _project({"event": event, "mission": MISSION}).json()
    assert body["action"] == {"action": "done", "summary": "All work finished."}
    assert body["routing"]["terminal"] is True
    assert body["apply"]["kind"] == "done"
    assert body["apply"]["message"] == "All work finished."
    assert body["apply"]["clearHeartbeat"] is True


def test_project_without_mission_context_uses_fallbacks():
    event = {**BASE_EVENT, "eventId": "evt-http-nofallback"}
    del event["progress"]
    del event["message"]
    body = _project({"event": event}).json()
    assert body["ok"] is True
    assert body["apply"]["progress"] == 0
    assert body["apply"]["detail"] == "Executor event at execute"


def test_project_duplicate_terminal_delivery_returns_dedup_verdict():
    event = {
        **BASE_EVENT,
        "eventId": "evt-http-dup",
        "type": "job.completed",
        "status": "completed",
        "delivery": {"sequence": 8, "attempt": 2, "duplicate": True, "outOfOrder": False},
    }
    body = _project({"event": event, "mission": MISSION}).json()
    assert body["action"] == {"action": "duplicate", "reason": "duplicate"}
    assert body["dedup"] == {"duplicate": True, "reason": "duplicate"}
    assert body["routing"]["ignoredTerminal"] is True
    # The apply plan mirrors the inline route, which never dedups.
    assert body["apply"]["kind"] == "done"


def test_project_normalizes_artifacts_and_blocks_traversal_paths():
    event = {
        **BASE_EVENT,
        "eventId": "evt-http-artifacts",
        "type": "job.completed",
        "status": "completed",
        "artifacts": [
            {"kind": "file", "name": " report.json ", "path": " out/report.json "},
            {"kind": "file", "name": "evil", "path": "../../etc/passwd"},
            {"kind": "bogus", "name": "dropped"},
        ],
    }
    body = _project({"event": event, "mission": MISSION}).json()
    assert body["artifacts"] == [
        {"kind": "file", "name": "report.json", "path": "out/report.json"}
    ]

    no_artifacts = _project({"event": BASE_EVENT, "mission": MISSION}).json()
    assert "artifacts" not in no_artifacts


def test_project_blueprint_mission_routes_to_blueprint():
    event = {**BASE_EVENT, "missionId": "blueprint-job-abc", "eventId": "evt-http-bp"}
    body = _project({"event": event, "mission": MISSION}).json()
    assert body["routing"]["route"] == "blueprint"


def test_project_streaming_event_is_flagged_not_state_changing():
    event = {
        **BASE_EVENT,
        "eventId": "evt-http-log",
        "type": "job.log",
        "log": {"level": "info", "message": "line"},
    }
    body = _project({"event": event, "mission": MISSION}).json()
    assert body["stateChanging"] is False
    assert body["apply"]["kind"] == "log"


def test_project_malformed_event_fails_closed_with_400():
    for missing in ("missionId", "jobId", "eventId", "type"):
        event = dict(BASE_EVENT)
        del event[missing]
        response = _project({"event": event, "mission": MISSION})
        assert response.status_code == 400
        body = response.json()
        assert body["ok"] is False
        assert body["source"] == "python"
        assert body["provenance"] == "python-executor-event-projection"
        assert missing in body["error"]

    response = _project({"mission": MISSION})
    assert response.status_code == 400
    assert response.json()["ok"] is False

    response = _project({"event": "not-an-object"})
    assert response.status_code == 400
    assert response.json()["error"] == "event must be an object"
