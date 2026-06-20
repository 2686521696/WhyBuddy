"""Contract tests for the Blueprint job runtime Python proxy."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.blueprint_jobs import router


app = FastAPI()
app.include_router(router, prefix="/api/blueprint/jobs")
client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"


def _job(status="running"):
    return {
        "id": "job-1",
        "request": {
            "projectId": "project-1",
            "targetText": "Build a job runtime proxy",
        },
        "status": status,
        "stage": "spec_tree",
        "version": "v1",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "updatedAt": "2026-06-20T00:01:00.000Z",
        "artifacts": [{"id": "artifact-1", "type": "spec_tree"}],
        "events": [{"id": "event-1", "type": "job.stage"}],
    }


def _post(path, payload):
    return client.post(
        path,
        json=payload,
        headers={"X-Internal-Key": INTERNAL_KEY},
    )


def test_start_returns_stable_proxy_contract_shape():
    response = _post(
        "/api/blueprint/jobs/runtime/start",
        {
            "job": _job("pending"),
            "request": {"targetText": "Build a job runtime proxy"},
            "now": "2026-06-20T00:02:00.000Z",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["action"] == "start"
    assert data["contractVersion"] == "blueprint.job-runtime.proxy.v1"
    assert data["runtime"]["owner"] == "python"
    assert data["runtime"]["persistenceOwner"] == "node"
    assert data["job"]["id"] == "job-1"
    assert data["job"]["status"] == "running"
    assert data["job"]["stage"] == "spec_tree"
    assert data["job"]["artifacts"] == []
    assert data["job"]["events"] == []


def test_status_returns_not_found_for_missing_node_owned_job():
    response = _post(
        "/api/blueprint/jobs/runtime/status",
        {"jobId": "missing-job", "job": None},
    )

    assert response.status_code == 200
    data = response.json()
    assert data == {
        "ok": False,
        "action": "status",
        "contractVersion": "blueprint.job-runtime.proxy.v1",
        "error": "not_found",
        "message": "Blueprint job missing-job was not found in the Node job store.",
        "jobId": "missing-job",
    }


def test_cancel_returns_cancelled_not_done():
    response = _post(
        "/api/blueprint/jobs/runtime/cancel",
        {
            "jobId": "job-1",
            "job": _job("running"),
            "reason": "user_cancelled",
            "now": "2026-06-20T00:03:00.000Z",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["action"] == "cancel"
    assert data["cancelRequested"] is True
    assert data["job"]["status"] == "cancelled"
    assert data["job"]["status"] != "completed"
    assert data["job"]["error"]["code"] == "cancelled"
    assert data["job"]["events"] == []


def test_read_returns_job_snapshot_without_claiming_artifact_ownership():
    response = _post(
        "/api/blueprint/jobs/runtime/read",
        {"jobId": "job-1", "job": _job("failed")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["action"] == "read"
    assert data["runtime"]["persistenceOwner"] == "node"
    assert data["job"]["id"] == "job-1"
    assert data["job"]["status"] == "failed"
    assert data["job"]["artifacts"] == []
    assert data["job"]["events"] == []


def test_runtime_error_shape_is_stable():
    response = _post(
        "/api/blueprint/jobs/runtime/start",
        {
            "job": _job("pending"),
            "simulateRuntimeError": "worker unavailable",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data == {
        "ok": False,
        "action": "start",
        "contractVersion": "blueprint.job-runtime.proxy.v1",
        "error": "runtime_error",
        "message": "worker unavailable",
        "jobId": "job-1",
        "retryable": True,
    }


def test_contract_requires_internal_key():
    response = client.post(
        "/api/blueprint/jobs/runtime/status",
        json={"jobId": "job-1", "job": _job()},
        headers={"X-Internal-Key": "wrong"},
    )

    assert response.status_code == 403
