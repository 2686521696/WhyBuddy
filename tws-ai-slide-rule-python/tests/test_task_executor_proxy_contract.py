"""Task executor proxy contract fixtures.

This test locks the Python-side payload shapes that the Node executor client can
consume while the real executor remains Node-owned. It intentionally does not
start, schedule, or persist any real task.
"""

from copy import deepcopy


CONTRACT_VERSION = "2026-03-28"
STATUSES = {"queued", "running", "waiting", "completed", "failed", "cancelled"}
EVENT_TYPES = {
    "job.accepted",
    "job.started",
    "job.progress",
    "job.waiting",
    "job.completed",
    "job.failed",
    "job.cancelled",
    "job.log",
    "job.heartbeat",
    "job.log_stream",
    "job.screenshot",
}


def _start_response():
    return {
        "ok": True,
        "accepted": True,
        "requestId": "request-python-proxy",
        "missionId": "mission-python-proxy",
        "jobId": "job-python-proxy",
        "receivedAt": "2026-06-20T00:00:00.000Z",
    }


def _status_response(status="running"):
    event_type = {
        "queued": "job.accepted",
        "running": "job.progress",
        "waiting": "job.waiting",
        "completed": "job.completed",
        "failed": "job.failed",
        "cancelled": "job.cancelled",
    }[status]
    message = {
        "queued": "Job accepted",
        "running": "Job is running",
        "waiting": "Job is waiting for input",
        "completed": "Job completed",
        "failed": "Job failed",
        "cancelled": "Job cancelled",
    }[status]
    return {
        "ok": True,
        "job": {
            "requestId": "request-python-proxy",
            "missionId": "mission-python-proxy",
            "jobId": "job-python-proxy",
            "jobKey": "task.execute",
            "jobLabel": "Execute task",
            "kind": "execute",
            "status": status,
            "progress": 100 if status in {"completed", "failed", "cancelled"} else 45,
            "message": message,
            "receivedAt": "2026-06-20T00:00:00.000Z",
            "finishedAt": (
                "2026-06-20T00:00:05.000Z"
                if status in {"completed", "failed", "cancelled"}
                else None
            ),
            "errorCode": "TASK_EXECUTOR_FAILED" if status == "failed" else None,
            "errorMessage": "Task executor failed" if status == "failed" else None,
            "callbackMode": "pending",
            "artifactCount": 0,
            "artifacts": [],
            "events": [
                {
                    "version": CONTRACT_VERSION,
                    "eventId": f"event-{status}",
                    "missionId": "mission-python-proxy",
                    "jobId": "job-python-proxy",
                    "executor": "lobster",
                    "type": event_type,
                    "status": status,
                    "occurredAt": "2026-06-20T00:00:01.000Z",
                    "message": message,
                    "errorCode": "TASK_EXECUTOR_FAILED" if status == "failed" else None,
                }
            ],
            "dataDirectory": "executor-data/jobs/mission-python-proxy/job-python-proxy",
            "logFile": "executor-data/jobs/mission-python-proxy/job-python-proxy/executor.log",
        },
    }


def _cancel_response(status="cancelled"):
    return {
        "ok": True,
        "accepted": True,
        "cancelRequested": status != "cancelled",
        "alreadyFinal": status == "cancelled",
        "missionId": "mission-python-proxy",
        "jobId": "job-python-proxy",
        "status": status,
        "message": (
            "Job was already cancelled"
            if status == "cancelled"
            else "Cancellation requested"
        ),
    }


def _error_response(code="TASK_EXECUTOR_TIMEOUT"):
    return {
        "ok": False,
        "error": "Task executor request timed out",
        "code": code,
        "hint": "Treat this as unavailable/rejected; do not mark the task completed.",
    }


def _assert_timestamp(value):
    assert isinstance(value, str)
    assert value.endswith("Z")
    assert "T" in value


def _assert_job_detail_shape(job):
    assert isinstance(job["requestId"], str)
    assert isinstance(job["missionId"], str)
    assert isinstance(job["jobId"], str)
    assert isinstance(job["jobKey"], str)
    assert isinstance(job["jobLabel"], str)
    assert job["kind"] in {"scan", "analyze", "plan", "codegen", "execute", "report", "custom"}
    assert job["status"] in STATUSES
    assert isinstance(job["progress"], (int, float))
    assert isinstance(job["message"], str)
    _assert_timestamp(job["receivedAt"])
    if job.get("finishedAt") is not None:
        _assert_timestamp(job["finishedAt"])
    assert job["callbackMode"] == "pending"
    assert isinstance(job["artifactCount"], int)
    assert isinstance(job["artifacts"], list)
    assert isinstance(job["events"], list)
    assert isinstance(job["dataDirectory"], str)
    assert isinstance(job["logFile"], str)


def _assert_event_shape(event, expected_status):
    assert event["version"] == CONTRACT_VERSION
    assert isinstance(event["eventId"], str)
    assert isinstance(event["missionId"], str)
    assert isinstance(event["jobId"], str)
    assert event["executor"] == "lobster"
    assert event["type"] in EVENT_TYPES
    assert event["status"] == expected_status
    _assert_timestamp(event["occurredAt"])
    assert isinstance(event["message"], str)


def test_start_contract_is_acceptance_only_and_has_no_runtime_side_effect_fields():
    payload = _start_response()

    assert payload == {
        "ok": True,
        "accepted": True,
        "requestId": "request-python-proxy",
        "missionId": "mission-python-proxy",
        "jobId": "job-python-proxy",
        "receivedAt": "2026-06-20T00:00:00.000Z",
    }
    assert "containerId" not in payload
    assert "pid" not in payload
    assert "artifacts" not in payload
    _assert_timestamp(payload["receivedAt"])


def test_status_contract_covers_running_completed_failed_and_cancelled_shapes():
    for status in ["running", "completed", "failed", "cancelled"]:
        payload = _status_response(status)

        assert payload["ok"] is True
        _assert_job_detail_shape(payload["job"])
        assert payload["job"]["status"] == status
        assert payload["job"]["status"] != "completed" or status == "completed"
        assert payload["job"]["events"], "status responses must include event history"
        _assert_event_shape(payload["job"]["events"][-1], status)


def test_cancel_contract_is_control_acknowledgement_not_completed_success():
    payload = _cancel_response("cancelled")

    assert payload["ok"] is True
    assert payload["accepted"] is True
    assert payload["alreadyFinal"] is True
    assert payload["cancelRequested"] is False
    assert payload["status"] == "cancelled"
    assert payload["status"] != "completed"
    assert isinstance(payload["message"], str)


def test_timeout_and_executor_error_contracts_are_not_success_payloads():
    timeout_payload = _error_response("TASK_EXECUTOR_TIMEOUT")
    executor_error_payload = _error_response("TASK_EXECUTOR_ERROR")

    for payload in [timeout_payload, executor_error_payload]:
        assert payload["ok"] is False
        assert "accepted" not in payload
        assert "job" not in payload
        assert payload["code"] in {"TASK_EXECUTOR_TIMEOUT", "TASK_EXECUTOR_ERROR"}
        assert isinstance(payload["error"], str)
        assert "completed" not in payload["error"].lower()


def test_contract_fixtures_are_plain_data_and_do_not_mutate_between_checks():
    first = _status_response("failed")
    second = deepcopy(first)

    first["job"]["events"].append({"eventId": "local-test-only"})

    assert second["job"]["status"] == "failed"
    assert len(second["job"]["events"]) == 1
