"""Boundary tests for the minimal Python task lifecycle runtime slice.

This slice is intentionally smaller than the task route. Node owns mission
storage, project/resource auth, route-level validation, executor callbacks, and
event replay. Python only projects lifecycle envelopes for Node to map.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.task_lifecycle_runtime import (  # noqa: E402
    TASK_LIFECYCLE_RUNTIME_CONTRACT_VERSION,
    project_task_lifecycle_runtime,
)


def _mission(status: str = "queued") -> dict:
    return {
        "id": "mission-python-lifecycle",
        "kind": "nl-command",
        "title": "Run task lifecycle boundary",
        "status": status,
        "progress": 0 if status == "queued" else 45,
        "currentStageKey": "receive" if status == "queued" else "execute",
        "createdAt": 1_782_000_000_000,
        "updatedAt": 1_782_000_000_000,
        "projection": {
            "projectId": "project-node-owned",
        },
        "executor": {
            "name": "lobster",
            "jobId": "job-python-lifecycle",
            "status": "running",
            "baseUrl": "http://python-runtime.test",
        },
    }


def test_start_projects_started_envelope_without_claiming_node_owned_state():
    result = project_task_lifecycle_runtime(
        {
            "action": "start",
            "task": _mission("queued"),
            "now": "2026-06-22T00:00:00.000Z",
        }
    )

    assert result["ok"] is True
    assert result["action"] == "start"
    assert result["contractVersion"] == TASK_LIFECYCLE_RUNTIME_CONTRACT_VERSION
    assert result["runtime"] == {
        "owner": "python",
        "mode": "runtime_boundary",
        "persistenceOwner": "node",
        "missionStoreOwner": "node",
        "routeOwner": "node",
        "authOwner": "node",
        "eventReplayOwner": "node",
    }
    assert result["task"] == {
        "id": "mission-python-lifecycle",
        "status": "started",
        "nodeStatus": "running",
        "progress": 4,
        "stageKey": "receive",
        "message": "Task lifecycle started.",
        "updatedAt": "2026-06-22T00:00:00.000Z",
        "executorJobId": "job-python-lifecycle",
    }
    assert "projection" not in result["task"]
    assert "events" not in result["task"]


def test_status_projects_running_and_completed_without_success_coercion():
    running = project_task_lifecycle_runtime(
        {"action": "status", "task": _mission("running")}
    )
    completed = project_task_lifecycle_runtime(
        {
            "action": "status",
            "task": {
                **_mission("done"),
                "progress": 100,
                "currentStageKey": "finalize",
                "summary": "Task finished.",
            },
        }
    )

    assert running["ok"] is True
    assert running["task"]["status"] == "running"
    assert running["task"]["nodeStatus"] == "running"
    assert running["task"]["message"] == "Task is running."

    assert completed["ok"] is True
    assert completed["task"]["status"] == "completed"
    assert completed["task"]["nodeStatus"] == "done"
    assert completed["task"]["progress"] == 100
    assert completed["task"]["summary"] == "Task finished."


def test_failed_and_cancelled_remain_terminal_errors_not_success():
    failed = project_task_lifecycle_runtime(
        {
            "action": "status",
            "task": {
                **_mission("failed"),
                "progress": 64,
                "error": {
                    "code": "EXECUTOR_FAILED",
                    "message": "Executor failed.",
                },
            },
        }
    )
    cancelled = project_task_lifecycle_runtime(
        {
            "action": "cancel",
            "task": {
                **_mission("running"),
                "progress": 48,
            },
            "reason": "operator cancelled",
            "now": "2026-06-22T00:01:00.000Z",
        }
    )

    assert failed["ok"] is True
    assert failed["task"]["status"] == "failed"
    assert failed["task"]["nodeStatus"] == "failed"
    assert failed["task"]["error"] == {
        "code": "EXECUTOR_FAILED",
        "message": "Executor failed.",
    }
    assert failed["task"]["status"] != "completed"

    assert cancelled["ok"] is True
    assert cancelled["task"]["status"] == "cancelled"
    assert cancelled["task"]["nodeStatus"] == "cancelled"
    assert cancelled["task"]["cancelRequested"] is True
    assert cancelled["task"]["message"] == "operator cancelled"
    assert cancelled["task"]["updatedAt"] == "2026-06-22T00:01:00.000Z"
    assert cancelled["task"]["status"] != "completed"


def test_error_envelope_is_not_a_successful_task():
    result = project_task_lifecycle_runtime(
        {
            "action": "error",
            "task": _mission("running"),
            "error": {
                "code": "TASK_LIFECYCLE_RUNTIME_ERROR",
                "message": "Python lifecycle runtime failed.",
            },
        }
    )

    assert result == {
        "ok": False,
        "action": "error",
        "contractVersion": TASK_LIFECYCLE_RUNTIME_CONTRACT_VERSION,
        "error": "runtime_error",
        "code": "TASK_LIFECYCLE_RUNTIME_ERROR",
        "message": "Python lifecycle runtime failed.",
        "retryable": True,
        "runtime": {
            "owner": "python",
            "mode": "runtime_boundary",
            "persistenceOwner": "node",
            "missionStoreOwner": "node",
            "routeOwner": "node",
            "authOwner": "node",
            "eventReplayOwner": "node",
        },
    }
