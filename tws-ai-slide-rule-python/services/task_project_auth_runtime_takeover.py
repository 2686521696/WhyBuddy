"""Task project auth runtime takeover 104.

Python returns allow/deny/degraded classification for project-resource authorization decision.

This provides a testable authorization decision envelope for task lifecycle.

Node retains ownership of actual project access enforcement (findByIdForOwner, auth middleware, 401/404, project resource linking).
Python classification is advisory only; does not replace or loosen Node project rules.
Explicit fallback to node-retained behavior.

Do not claim production auth takeover.
"""

from __future__ import annotations

from typing import Any

CONTRACT_VERSION = "task-project-auth-runtime-takeover.v1"
PROVENANCE = "python-task-project-auth-runtime-takeover-104"


def decide_task_project_auth_runtime_takeover(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return allow/deny/degraded classification for project resource auth.

    Supports simulate for test paths: block/deny, degrade, unsupported.
    Always provides explicit ownership and fallback note.
    """
    if not isinstance(payload, dict):
        return {
            "ok": False,
            "decision": "unsupported",
            "classification": "degraded",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "error": "payload_not_object",
            "runtime": {"owner": "python", "mode": "project_auth_runtime_takeover"},
            "ownership": {"projectResourceAuth": "node-retained"},
            "fallback": "node",
        }

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    mission_id = _extract_id(payload, "missionId", ["task", "id"]) or "unknown-mission"
    project_id = _extract_id(payload, "projectId", ["task", "projection", "projectId"])
    resource_id = _extract_id(payload, "resourceId", ["task", "id"]) or project_id

    if simulate.get("forceUnsupported") or simulate.get("unsupported"):
        decision = "unsupported"
        classification = "degraded"
        reason = "unsupported-by-simulation"
        ownership = "node-retained"
    elif simulate.get("block") or simulate.get("blocked") or simulate.get("deny"):
        decision = "deny"
        classification = "deny"
        reason = "deny-by-simulation"
        ownership = "node-retained"
    elif simulate.get("degrade") or simulate.get("degraded") or simulate.get("error"):
        decision = "degraded"
        classification = "degraded"
        reason = "degraded-slice-fallback-to-node"
        ownership = "node-retained"
    else:
        decision = "allow"
        classification = "allow"
        reason = "python-project-auth-decision-envelope"
        ownership = "node-retained"

    ok = decision == "allow"
    if decision == "degraded":
        ok = True  # degraded still participates via node fallback

    result: dict[str, Any] = {
        "ok": ok,
        "decision": decision,
        "classification": classification,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "missionId": mission_id,
        "projectId": project_id,
        "resourceId": resource_id,
        "ownership": {
            "projectResourceAuth": ownership,
        },
        "runtime": {
            "owner": "node",
            "mode": "project_auth_runtime_takeover",
            "authEnforcementOwner": "node",
            "classificationProvider": "python",
        },
        "diagnostics": {
            "reason": reason,
            "simulation": simulate or None,
        },
        "fallback": "node",
    }

    if decision == "deny":
        result["denied"] = True
    if decision == "degraded":
        result["degraded"] = True
    if decision == "unsupported":
        result["ok"] = False

    return result


def _extract_id(payload: dict[str, Any], direct: str, nested: list[str]) -> str | None:
    if direct in payload and payload[direct]:
        return _clean(payload[direct])
    cur: Any = payload
    for k in nested:
        if isinstance(cur, dict):
            cur = cur.get(k)
        else:
            return None
    return _clean(cur) if cur is not None else None


def _clean(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s or None
    return str(v)


__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "decide_task_project_auth_runtime_takeover",
]
