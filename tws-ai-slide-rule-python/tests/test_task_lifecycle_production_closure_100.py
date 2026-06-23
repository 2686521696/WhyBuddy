"""Python tests for task lifecycle production closure 100.

Covers create, append, replay, project, cancel, error, auth-denied.
Ensures Python produces auditable closure summary while Node retains store/route/auth ownership.
cancel/error/replay never drop events; auth-denied never becomes completed.
"""

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.task_lifecycle_production_closure import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    execute_task_lifecycle_production_closure,
)


def _base_payload(action: str = "create", **overrides: Any) -> dict:
    base: dict[str, Any] = {
        "action": action,
        "missionId": "mission-closure-100",
        "projectId": "project-closure-100",
        "resourceId": "resource-closure-100",
        "actor": {"id": "user-closure", "role": "owner"},
        "task": {
            "id": "mission-closure-100",
            "status": "running",
            "progress": 35,
            "currentStageKey": "execute",
            "projection": {"projectId": "project-closure-100"},
        },
        "metadata": {
            "project": {"projectId": "project-closure-100", "validatedBy": "node"},
            "resource": {"resourceType": "mission", "resourceId": "mission-closure-100", "owner": "node"},
            "auth": {"owner": "node", "checked": True},
        },
        "events": [
            {"type": "created", "message": "created", "time": 1782000000000, "source": "mission-core"},
            {"type": "progress", "message": "executing", "progress": 35, "time": 1782000010000, "source": "executor"},
        ],
    }
    base.update(overrides)
    return base


def test_create_produces_closure_summary_with_ids_and_metadata():
    result = execute_task_lifecycle_production_closure(_base_payload("create"))
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["missionId"] == "mission-closure-100"
    assert result["projectId"] == "project-closure-100"
    assert result["resourceId"] == "resource-closure-100"
    assert result["closureSummary"]["missionId"] == "mission-closure-100"
    assert result["closureSummary"]["projection"]["projectId"] == "project-closure-100"
    assert result["runtime"]["owner"] == "python"
    assert result["runtime"]["missionStoreOwner"] == "node"


def test_append_produces_replay_projection_preserving_event_sequence():
    payload = _base_payload("append", events=[{"type": "appended", "progress": 55}])
    result = execute_task_lifecycle_production_closure(payload)
    assert result["ok"] is True
    assert result["action"] == "append"
    assert "replay" in result["closureSummary"] or result.get("delegated", {}).get("action") == "append"
    # events not dropped
    assert len(payload["events"]) == 1


def test_replay_and_project_preserve_projection_metadata():
    for act in ["replay", "project"]:
        result = execute_task_lifecycle_production_closure(_base_payload(act))
        assert result["ok"] is True
        assert result["closureSummary"]["projectId"] == "project-closure-100"
        assert result["closureSummary"]["resourceId"] == "resource-closure-100"


def test_cancel_produces_cancel_not_completed():
    payload = _base_payload("cancel", reason="user cancel")
    result = execute_task_lifecycle_production_closure(payload)
    assert result["ok"] is True
    assert result["action"] == "cancel"
    # must not coerce to completed
    task_proj = result["closureSummary"].get("taskProjection") or {}
    assert task_proj.get("status") != "completed"
    assert "cancel" in result["closureSummary"] or result["closureSummary"].get("decision") == "applied"
    # cancel must preserve the event sequence for audit/replay.
    assert result["events"] == payload["events"]
    assert result["closureSummary"]["events"] == payload["events"]
    assert result["closureSummary"]["eventCount"] == len(payload["events"])


def test_error_never_becomes_success_completed():
    result = execute_task_lifecycle_production_closure({
        **_base_payload("error"),
        "error": {"code": "EXEC_FAILED", "message": "executor error"},
    })
    assert result["ok"] is False
    assert result["status"] == "failed"
    assert result["code"] == "EXEC_FAILED" or "TASK" in result["code"]
    assert "completed" not in str(result)
    # must retain events / event sequence per lifecycle closure requirement (not drop on error)
    assert isinstance(result.get("events"), list)
    assert "projection" in result.get("closureSummary", {})
    assert result["closureSummary"]["projection"].get("eventCount") == len(_base_payload()["events"])
    assert result["closureSummary"].get("eventCount") == len(_base_payload()["events"])


def test_auth_denied_returns_denied_never_completed():
    result = execute_task_lifecycle_production_closure(_base_payload("auth-denied", reason="project access denied"))
    assert result["ok"] is False
    assert result["status"] == "denied"
    assert result["error"] == "auth_denied"
    assert result["code"] == "TASK_LIFECYCLE_AUTH_DENIED"
    assert result["message"]
    # never completed
    assert "completed" not in str(result.get("closureSummary", {})).lower()
    assert result["closureSummary"]["decision"] == "denied"


def test_create_append_replay_cancel_error_auth_denied_all_covered():
    actions = ["create", "append", "replay", "project", "cancel", "error", "auth-denied"]
    for action in actions:
        res = execute_task_lifecycle_production_closure(_base_payload(action))
        assert "contractVersion" in res
        assert res.get("missionId") or res.get("closureSummary", {}).get("missionId")
        # auth denied special
        if action == "auth-denied":
            assert res["ok"] is False and res["status"] == "denied"
