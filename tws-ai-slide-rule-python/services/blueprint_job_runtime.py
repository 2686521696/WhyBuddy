"""Blueprint job runtime proxy contract helpers.

This module is intentionally stateless. Node owns job persistence, artifacts,
events, permissions, audit, and cancellation policy. Python only normalizes the
runtime response shape for the proxy boundary.
"""
from __future__ import annotations

from typing import Any, Literal


CONTRACT_VERSION = "blueprint.job-runtime.proxy.v1"
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
VALID_ACTIONS = {"start", "status", "cancel", "read"}

Action = Literal["start", "status", "cancel", "read"]


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _clean_string(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _job_id(payload: dict[str, Any]) -> str:
    job = payload.get("job")
    if _is_record(job):
        return _clean_string(job.get("id"))
    return _clean_string(payload.get("jobId"))


def _not_found(action: Action, job_id: str) -> dict[str, Any]:
    return {
        "ok": False,
        "action": action,
        "contractVersion": CONTRACT_VERSION,
        "error": "not_found",
        "message": f"Blueprint job {job_id} was not found in the Node job store.",
        "jobId": job_id,
    }


def _runtime_error(action: Action, message: str, job_id: str) -> dict[str, Any]:
    return {
        "ok": False,
        "action": action,
        "contractVersion": CONTRACT_VERSION,
        "error": "runtime_error",
        "message": message,
        "jobId": job_id,
        "retryable": True,
    }


def _runtime_meta() -> dict[str, str]:
    return {
        "owner": "python",
        "persistenceOwner": "node",
        "mode": "proxy_contract",
    }


def _normalize_job(
    job: dict[str, Any],
    *,
    status: str | None = None,
    now: str | None = None,
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_status = status or _clean_string(job.get("status"), "running")
    timestamp = now or _clean_string(job.get("updatedAt"), "1970-01-01T00:00:00.000Z")
    normalized = {
        "id": _clean_string(job.get("id")),
        "request": job.get("request") if _is_record(job.get("request")) else {},
        "status": normalized_status,
        "stage": _clean_string(job.get("stage"), "input"),
        "projectId": job.get("projectId"),
        "sourceId": job.get("sourceId"),
        "version": _clean_string(job.get("version"), "v1"),
        "createdAt": _clean_string(job.get("createdAt"), timestamp),
        "updatedAt": timestamp,
        "artifacts": [],
        "events": [],
    }
    if normalized_status in TERMINAL_STATUSES:
        normalized["completedAt"] = _clean_string(job.get("completedAt"), timestamp)
    if error is not None:
        normalized["error"] = error
    elif _is_record(job.get("error")):
        normalized["error"] = job["error"]
    return {key: value for key, value in normalized.items() if value is not None}


def _success(
    action: Action,
    job: dict[str, Any],
    *,
    cancel_requested: bool | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "ok": True,
        "action": action,
        "contractVersion": CONTRACT_VERSION,
        "runtime": _runtime_meta(),
        "job": job,
    }
    if cancel_requested is not None:
        response["cancelRequested"] = cancel_requested
    return response


def run_blueprint_job_runtime_action(
    action: Action,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if action not in VALID_ACTIONS:
        return _runtime_error("read", f"Unsupported runtime action: {action}", _job_id(payload))

    job_id = _job_id(payload)
    simulated_error = payload.get("simulateRuntimeError")
    if simulated_error:
        return _runtime_error(action, _clean_string(simulated_error, "runtime error"), job_id)

    raw_job = payload.get("job")
    if not _is_record(raw_job):
        return _not_found(action, job_id)

    now = _clean_string(payload.get("now"), _clean_string(raw_job.get("updatedAt"), "1970-01-01T00:00:00.000Z"))

    if action == "start":
        return _success(action, _normalize_job(raw_job, status="running", now=now))

    if action == "cancel":
        status = _clean_string(raw_job.get("status"), "running")
        already_final = status in TERMINAL_STATUSES
        cancelled_job = _normalize_job(
            raw_job,
            status="cancelled",
            now=now,
            error={
                "code": "cancelled",
                "message": _clean_string(payload.get("reason"), "Blueprint job cancelled."),
                "stage": _clean_string(raw_job.get("stage"), "input"),
            },
        )
        return _success(action, cancelled_job, cancel_requested=not already_final)

    return _success(action, _normalize_job(raw_job, now=now))
