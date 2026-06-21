"""Minimal task lifecycle runtime boundary projection.

This module does not implement the `/api/tasks` route, mission store,
project/resource authorization, executor callback ingress, or event replay.
Node passes a task snapshot across the boundary and Python returns a normalized
runtime envelope that Node can map without treating failures as success.
"""

from __future__ import annotations

from typing import Any, Literal


TASK_LIFECYCLE_RUNTIME_CONTRACT_VERSION = "task-lifecycle.runtime-boundary.v1"

TaskLifecycleAction = Literal["start", "status", "cancel", "error"]

VALID_ACTIONS = {"start", "status", "cancel", "error"}
TERMINAL_NODE_STATUSES = {"done", "failed", "cancelled"}


def project_task_lifecycle_runtime(payload: dict[str, Any]) -> dict[str, Any]:
    """Project a Node-owned mission snapshot into a lifecycle runtime envelope."""

    if not _is_record(payload):
        return _error_response(
            "status",
            "TASK_LIFECYCLE_VALIDATION_ERROR",
            "Task lifecycle runtime payload must be an object.",
            retryable=False,
            error="validation_error",
        )

    action = _clean_string(payload.get("action"), "status")
    if action not in VALID_ACTIONS:
        return _error_response(
            "status",
            "TASK_LIFECYCLE_VALIDATION_ERROR",
            f"Unsupported task lifecycle runtime action: {action}",
            retryable=False,
            error="validation_error",
        )

    raw_error = payload.get("error")
    if raw_error is not None or action == "error":
        error_record = raw_error if _is_record(raw_error) else {}
        return _error_response(
            action,
            _clean_string(error_record.get("code"), "TASK_LIFECYCLE_RUNTIME_ERROR"),
            _clean_string(
                error_record.get("message"),
                "Task lifecycle runtime failed.",
            ),
        )

    task = payload.get("task")
    if not _is_record(task):
        return _error_response(
            action,
            "TASK_LIFECYCLE_VALIDATION_ERROR",
            "Task lifecycle runtime requires a Node-owned task snapshot.",
            retryable=False,
            error="validation_error",
        )

    return {
        "ok": True,
        "action": action,
        "contractVersion": TASK_LIFECYCLE_RUNTIME_CONTRACT_VERSION,
        "runtime": _runtime_meta(),
        "task": _project_task(task, action=action, payload=payload),
    }


def _project_task(
    task: dict[str, Any],
    *,
    action: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    node_status = _node_status(task)
    status = _runtime_status(node_status, action)
    progress = _progress(task, status, action)
    now = _clean_string(payload.get("now"), _timestamp(task))
    message = _message(task, status, action, payload)
    projected: dict[str, Any] = {
        "id": _clean_string(task.get("id"), "task-python-lifecycle"),
        "status": status,
        "nodeStatus": _node_status_for_runtime(status, node_status),
        "progress": progress,
        "stageKey": _clean_string(task.get("currentStageKey"), "receive"),
        "message": message,
        "updatedAt": now,
    }

    executor_job_id = _executor_job_id(task)
    if executor_job_id:
        projected["executorJobId"] = executor_job_id

    summary = _clean_string(task.get("summary"))
    if status == "completed" and summary:
        projected["summary"] = summary

    if status == "failed":
        projected["error"] = _task_error(task)

    if status == "cancelled":
        projected["cancelRequested"] = action == "cancel" and node_status not in TERMINAL_NODE_STATUSES

    return projected


def _runtime_status(node_status: str, action: str) -> str:
    if action == "start":
        return "started"
    if action == "cancel":
        if node_status in {"done", "failed"}:
            return _map_node_status(node_status)
        return "cancelled"
    return _map_node_status(node_status)


def _map_node_status(node_status: str) -> str:
    return {
        "queued": "running",
        "running": "running",
        "waiting": "running",
        "done": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
    }.get(node_status, "running")


def _node_status_for_runtime(runtime_status: str, original_node_status: str) -> str:
    if runtime_status == "started":
        return "running"
    if runtime_status == "completed":
        return "done"
    return runtime_status if runtime_status in {"running", "failed", "cancelled"} else original_node_status


def _progress(task: dict[str, Any], status: str, action: str) -> int | float:
    if action == "start":
        return 4
    value = task.get("progress")
    if isinstance(value, (int, float)):
        return value
    return 100 if status in {"completed", "failed", "cancelled"} else 0


def _message(
    task: dict[str, Any],
    status: str,
    action: str,
    payload: dict[str, Any],
) -> str:
    if action == "cancel":
        return _clean_string(payload.get("reason"), "Task lifecycle cancelled.")

    task_message = _clean_string(task.get("message"))
    if task_message:
        return task_message

    return {
        "started": "Task lifecycle started.",
        "running": "Task is running.",
        "completed": "Task completed.",
        "failed": "Task failed.",
        "cancelled": "Task cancelled.",
    }.get(status, "Task is running.")


def _task_error(task: dict[str, Any]) -> dict[str, str]:
    error = task.get("error")
    if _is_record(error):
        return {
            "code": _clean_string(error.get("code"), "TASK_FAILED"),
            "message": _clean_string(error.get("message"), "Task failed."),
        }

    return {
        "code": _clean_string(task.get("errorCode"), "TASK_FAILED"),
        "message": _clean_string(task.get("errorMessage"), "Task failed."),
    }


def _executor_job_id(task: dict[str, Any]) -> str:
    executor = task.get("executor")
    if not _is_record(executor):
        return ""
    return _clean_string(executor.get("jobId"))


def _node_status(task: dict[str, Any]) -> str:
    value = _clean_string(task.get("status"), "running")
    if value in {"queued", "running", "waiting", "done", "failed", "cancelled"}:
        return value
    return "running"


def _timestamp(task: dict[str, Any]) -> str:
    value = task.get("updatedAt")
    if isinstance(value, str):
        return _clean_string(value, "1970-01-01T00:00:00.000Z")
    if isinstance(value, (int, float)):
        return _millis_to_iso(value)
    return "1970-01-01T00:00:00.000Z"


def _millis_to_iso(value: int | float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00",
        "Z",
    )


def _error_response(
    action: str,
    code: str,
    message: str,
    *,
    retryable: bool = True,
    error: str = "runtime_error",
) -> dict[str, Any]:
    return {
        "ok": False,
        "action": action,
        "contractVersion": TASK_LIFECYCLE_RUNTIME_CONTRACT_VERSION,
        "error": error,
        "code": code,
        "message": message,
        "retryable": retryable,
        "runtime": _runtime_meta(),
    }


def _runtime_meta() -> dict[str, str]:
    return {
        "owner": "python",
        "mode": "runtime_boundary",
        "persistenceOwner": "node",
        "missionStoreOwner": "node",
        "routeOwner": "node",
        "authOwner": "node",
        "eventReplayOwner": "node",
    }


def _clean_string(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)
