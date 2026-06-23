"""Task lifecycle production closure (Python-owned bounded slice for final lifecycle 100).

Provides auditable lifecycle decision/projection summary for create/append/replay/project/cancel/error/auth-denied.

Python produces the closure summary; Node owns mission store, route, persistence, project/resource auth.
Never rewrites full scheduler. Preserves missionId/projectId/resourceId/actor/event sequence/projection metadata.
cancel/error/replay/auth-denied must not drop events or coerce denied->completed.
"""

from __future__ import annotations

from typing import Any

from services.task_lifecycle_runtime import (
    TASK_LIFECYCLE_RUNTIME_CONTRACT_VERSION as RUNTIME_CONTRACT,
    project_task_lifecycle_runtime,
)
from services.mission_event_replay import (
    MISSION_EVENT_REPLAY_RUNTIME_CONTRACT_VERSION as REPLAY_CONTRACT,
    project_mission_event_replay_runtime,
)

CONTRACT_VERSION = "task-lifecycle.production-closure.v1"
PROVENANCE = "python-task-lifecycle-production-closure"

VALID_ACTIONS = {"create", "append", "replay", "project", "cancel", "error", "auth-denied"}
TERMINAL = {"done", "failed", "cancelled"}


def execute_task_lifecycle_production_closure(payload: dict[str, Any]) -> dict[str, Any]:
    """Execute production closure and return consumable summary for Node."""
    if not isinstance(payload, dict):
        return _error_closure("validation_error", "payload_not_object", "Task lifecycle production closure payload must be an object.")

    action = _clean(payload.get("action"), "status")
    if action not in VALID_ACTIONS:
        return _error_closure("validation_error", "unsupported_action", f"Unsupported closure action: {action}")

    mission_id = _extract_mission_id(payload)
    project_id = _extract_project_id(payload)
    resource_id = _extract_resource_id(payload)
    actor = payload.get("actor") if isinstance(payload.get("actor"), dict) else None
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    event_count = len(events)

    # Auth denied case: must return denied, never completed
    if action == "auth-denied" or payload.get("authDenied") is True:
        return {
            "ok": False,
            "status": "denied",
            "action": "auth-denied",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "missionId": mission_id,
            "projectId": project_id,
            "resourceId": resource_id,
            "error": "auth_denied",
            "code": "TASK_LIFECYCLE_AUTH_DENIED",
            "message": _clean(payload.get("reason"), "Project or resource authorization denied."),
            "runtime": _runtime_meta(),
            "events": events,
            "closureSummary": {
                "missionId": mission_id,
                "projectId": project_id,
                "resourceId": resource_id,
                "actor": actor,
                "decision": "denied",
                "projection": {
                    "projectId": project_id,
                    "resourceId": resource_id,
                    "eventCount": event_count,
                },
                "eventCount": event_count,
            },
        }

    # Error path must not become success
    if action == "error" or payload.get("error"):
        err = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        return {
            "ok": False,
            "status": "failed",
            "action": "error",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "missionId": mission_id,
            "projectId": project_id,
            "resourceId": resource_id,
            "error": "runtime_error",
            "code": _clean(err.get("code"), "TASK_LIFECYCLE_PRODUCTION_ERROR"),
            "message": _clean(err.get("message"), "Task lifecycle production closure failed."),
            "runtime": _runtime_meta(),
            "events": events,
            "closureSummary": {
                "missionId": mission_id,
                "projectId": project_id,
                "resourceId": resource_id,
                "actor": actor,
                "decision": "error",
                "projection": {
                    "projectId": project_id,
                    "resourceId": resource_id,
                    "eventCount": event_count,
                },
                "eventCount": event_count,
            },
        }

    # Delegate to existing bounded runtimes for create/append/replay/project/cancel
    runtime_payload = {
        "action": action if action != "project" else "replay",
        "task": payload.get("task") or {"id": mission_id, "status": "running"},
        "metadata": payload.get("metadata") or {
            "project": {"projectId": project_id} if project_id else {},
            "resource": {"resourceId": resource_id} if resource_id else {},
            "auth": {"owner": "node", "checked": True},
        },
        "events": payload.get("events") or [],
        "limit": payload.get("limit"),
        "reason": payload.get("reason"),
        "now": payload.get("now"),
    }

    if action in {"create", "status"}:
        delegated = project_task_lifecycle_runtime(runtime_payload)
    else:
        delegated = project_mission_event_replay_runtime(runtime_payload)

    # Build closure summary preserving all required fields
    closure_summary: dict[str, Any] = {
        "missionId": mission_id,
        "projectId": project_id,
        "resourceId": resource_id,
        "actor": actor,
        "decision": "applied",
        "events": events,
        "eventCount": event_count,
        "projection": {
            "projectId": project_id,
            "resourceId": resource_id,
            "eventCount": event_count,
        },
    }

    if delegated.get("replay"):
        closure_summary["replay"] = delegated.get("replay")
    if delegated.get("cancel"):
        closure_summary["cancel"] = delegated.get("cancel")
    if delegated.get("task"):
        closure_summary["taskProjection"] = delegated.get("task")

    result: dict[str, Any] = {
        "ok": bool(delegated.get("ok", True)),
        "status": "closed",
        "action": action,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "missionId": mission_id,
        "projectId": project_id,
        "resourceId": resource_id,
        "runtime": _runtime_meta(),
        "events": events,
        "closureSummary": closure_summary,
        "delegated": {
            "contractVersion": delegated.get("contractVersion"),
            "action": delegated.get("action"),
        },
    }
    if delegated.get("metadata"):
        result["metadata"] = delegated.get("metadata")
    return result


def _extract_mission_id(payload: dict[str, Any]) -> str:
    task = payload.get("task") or {}
    return _clean(
        payload.get("missionId") or payload.get("id") or task.get("id"),
        "mission-production-closure",
    )


def _extract_project_id(payload: dict[str, Any]) -> str:
    meta = payload.get("metadata") or {}
    proj = meta.get("project") or {}
    task = payload.get("task") or {}
    proj_task = task.get("projection") or {}
    return _clean(
        payload.get("projectId") or proj.get("projectId") or proj_task.get("projectId"),
        "project-node-owned",
    )


def _extract_resource_id(payload: dict[str, Any]) -> str:
    meta = payload.get("metadata") or {}
    res = meta.get("resource") or {}
    task = payload.get("task") or {}
    return _clean(
        payload.get("resourceId") or res.get("resourceId") or task.get("id"),
        "mission-production-closure",
    )


def _runtime_meta() -> dict[str, Any]:
    return {
        "owner": "python",
        "mode": "production_closure",
        "persistenceOwner": "node",
        "missionStoreOwner": "node",
        "routeOwner": "node",
        "authOwner": "node",
        "eventStoreOwner": "node",
    }


def _error_closure(error: str, reason: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "failed",
        "error": error,
        "reason": reason,
        "message": message,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "runtime": {"owner": "python", "mode": "production_closure"},
    }


def _clean(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        v = value.strip()
        return v or fallback
    return str(value) or fallback


__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "execute_task_lifecycle_production_closure",
]
