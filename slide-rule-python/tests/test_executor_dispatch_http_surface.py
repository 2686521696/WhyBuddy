"""HTTP surface tests for /api/executor/dispatch/plan and
/api/executor/cancel/decision (routes/executor_dispatch.py).

Style follows tests/test_executor_events_http_surface.py: mount the router on
a bare FastAPI app, authenticate with X-Internal-Key, assert the decision
envelope contract consumed by the Node seam
(server/routes/executor-dispatch-python-decisions.ts).
"""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.executor_dispatch import router  # noqa: E402


app = FastAPI()
app.include_router(router, prefix="/api/executor")
client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"
HEADERS = {"X-Internal-Key": INTERNAL_KEY}


PLAN_PAYLOAD = {
    "mission": {
        "missionId": "m-http-1",
        "title": "Build a report",
        "sourceText": "Build the Q3 report",
        "attempt": 1,
    },
    "executionModeEnv": "real",
    "hasFirstJob": True,
    "firstJobPayload": {"env": {"KEEP": "1"}},
    "callbackUrl": "http://127.0.0.1:3000/api/executor/events",
}


def test_dispatch_plan_requires_internal_key():
    assert client.post("/api/executor/dispatch/plan", json=PLAN_PAYLOAD).status_code == 403
    assert (
        client.post(
            "/api/executor/dispatch/plan",
            json=PLAN_PAYLOAD,
            headers={"X-Internal-Key": "wrong"},
        ).status_code
        == 403
    )


def test_dispatch_plan_happy_path_envelope():
    response = client.post("/api/executor/dispatch/plan", json=PLAN_PAYLOAD, headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["source"] == "python"
    assert body["provenance"] == "python-executor-dispatch-decisions"
    assert body["missionId"] == "m-http-1"
    assert body["sourceText"] == "Build the Q3 report"
    assert body["executionMode"] == "real"
    assert body["dispatch"] == {
        "requestId": "mission_m-http-1_attempt_1",
        "idempotencyKey": "mission:m-http-1:attempt:1",
    }
    assert body["callbackUrl"] == "http://127.0.0.1:3000/api/executor/events"
    assert body["jobPayload"]["aiEnabled"] is True
    assert body["jobPayload"]["env"]["MISSION_ID"] == "m-http-1"
    assert body["jobPayload"]["env"]["TASK_CONTENT"] == "Build the Q3 report"
    assert body["planInputs"] == {
        "missionId": "m-http-1",
        "title": "Build a report",
        "sourceText": "Build the Q3 report",
        "requestedBy": "brain",
    }


def test_dispatch_plan_composes_callback_url_from_forwarded_headers():
    payload = dict(PLAN_PAYLOAD)
    payload.pop("callbackUrl")
    payload["server"] = {
        "forwardedProto": "https",
        "forwardedHost": "edge.example.com",
        "protocol": "http",
        "host": "127.0.0.1:3000",
    }
    body = client.post("/api/executor/dispatch/plan", json=payload, headers=HEADERS).json()
    assert body["callbackUrl"] == "https://edge.example.com/api/executor/events"


def test_dispatch_plan_fails_closed_400_on_malformed_mission():
    response = client.post("/api/executor/dispatch/plan", json={}, headers=HEADERS)
    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["source"] == "python"
    assert body["provenance"] == "python-executor-dispatch-decisions"

    response = client.post(
        "/api/executor/dispatch/plan",
        json={"mission": {"missionId": "   "}},
        headers=HEADERS,
    )
    assert response.status_code == 400


def test_cancel_decision_requires_internal_key():
    payload = {"task": {"id": "m-1", "status": "running"}, "body": {}}
    assert client.post("/api/executor/cancel/decision", json=payload).status_code == 403


def test_cancel_decision_forward_phase():
    payload = {
        "task": {
            "id": "m-http-2",
            "status": "running",
            "executor": {"jobId": "job-9", "baseUrl": "http://exec.local"},
        },
        "body": {"reason": "stop now", "requestedBy": "ops", "source": "brain"},
        "defaultExecutorBaseUrl": "http://127.0.0.1:3031",
    }
    response = client.post("/api/executor/cancel/decision", json=payload, headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["alreadyFinal"] is False
    assert body["forward"] is True
    assert body["cancelUrl"] == "http://exec.local/api/executor/jobs/job-9/cancel"
    assert body["requestBody"] == {
        "source": "brain",
        "reason": "stop now",
        "requestedBy": "ops",
    }


def test_cancel_decision_already_final_phase():
    payload = {
        "task": {"id": "m-http-3", "status": "done", "executor": {"jobId": "job-9"}},
        "body": {},
    }
    body = client.post("/api/executor/cancel/decision", json=payload, headers=HEADERS).json()
    assert body["alreadyFinal"] is True
    assert body["forward"] is False


def test_cancel_decision_downstream_outcome_phase():
    payload = {
        "task": {"id": "m-http-4", "status": "running", "executor": {"jobId": "j"}},
        "body": {},
        "downstream": {"ok": False, "status": 404, "body": None},
    }
    body = client.post("/api/executor/cancel/decision", json=payload, headers=HEADERS).json()
    assert body["outcome"] == {"executorForwarded": False, "tolerated404": True}

    payload["downstream"] = {"ok": False, "status": 500, "body": {"error": "boom"}}
    body = client.post("/api/executor/cancel/decision", json=payload, headers=HEADERS).json()
    assert body["outcome"]["error"] == {"status": 502, "message": "boom"}


def test_cancel_decision_fails_closed_400():
    response = client.post("/api/executor/cancel/decision", json={}, headers=HEADERS)
    assert response.status_code == 400
    assert response.json()["ok"] is False
