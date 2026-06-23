"""Task store / project-resource auth / scheduler cutover decision (Python advisory slice).

Python expresses bounded decisions (ready / blocked / degraded / unsupported)
for missionStore, projectResourceAuth, scheduler participation.
Node retains full ownership of durable mission store, project/resource auth middleware,
real scheduler, cancel/replay/error semantics, and routes.
This never replaces storage or takes over scheduling.
"""

from __future__ import annotations

from typing import Any

CONTRACT_VERSION = "task-store-auth-scheduler-cutover.v1"
PROVENANCE = "python-task-store-auth-scheduler-cutover"

CUTOVER_DECISIONS = ("ready", "blocked", "degraded", "unsupported")
NODE_BOUNDARIES = {
    "missionStoreOwner": "node",
    "authOwner": "node",
    "schedulerOwner": "node",
    "cancelSemanticsOwner": "node",
    "replayOwner": "node",
    "errorPathOwner": "node",
    "routeOwner": "node",
    "durableStoreOwner": "node",
}


def decide_task_store_auth_scheduler_cutover(payload: dict[str, Any]) -> dict[str, Any]:
    """Return narrow cutover decision for mission store/auth/scheduler slices.

    Supports classification ready/blocked/degraded/unsupported per area.
    Preserves missionId/projectId/resourceId/actor/causation.
    Never claims production scheduler takeover or store replacement.
    """
    if not isinstance(payload, dict):
        return _error_envelope(
            "validation_error",
            "payload_not_object",
            "Task store/auth/scheduler cutover payload must be an object.",
            400,
        )

    mission_id = _extract_id(payload, "missionId", ["task", "id"]) or "unknown"
    project_id = _extract_id(payload, "projectId", ["task", "projection", "projectId"])
    resource_id = _extract_id(payload, "resourceId", ["task", "projection", "resourceId"]) or _extract_id(payload, "resourceId", ["task", "id"])

    actor = payload.get("actor") if isinstance(payload.get("actor"), dict) else None

    causation = payload.get("causation") or payload.get("trace") or payload.get("causedBy")
    if not isinstance(causation, dict):
        causation = None

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    diagnostics = payload.get("diagnostics") if isinstance(payload.get("diagnostics"), dict) else {}

    area = _clean(payload.get("area")) or "all"
    if area not in {"missionStore", "auth", "scheduler"}:
        area = "all"

    diagnostic_only = bool(payload.get("diagnosticOnly") or simulate.get("diagnosticOnly"))

    # Simulate takes precedence for testing classifications
    if simulate.get("forceUnsupported") or simulate.get("unsupported"):
        store_dec = "unsupported"
        auth_dec = "unsupported"
        sched_dec = "unsupported"
        reason = "unsupported-by-simulation"
    elif simulate.get("block") or simulate.get("blocked"):
        store_dec = "blocked"
        auth_dec = "blocked"
        sched_dec = "blocked"
        reason = "blocked-by-simulation-or-boundary"
    elif simulate.get("degrade") or simulate.get("degraded"):
        store_dec = "degraded"
        auth_dec = "degraded"
        sched_dec = "degraded"
        reason = "degraded-by-simulation-or-boundary"
    else:
        if area == "missionStore":
            store_dec = "ready"
            auth_dec = "unsupported"
            sched_dec = "unsupported"
            reason = "mission-store-decision-only"
        elif area == "auth":
            store_dec = "unsupported"
            auth_dec = "ready"
            sched_dec = "unsupported"
            reason = "auth-decision-only"
        elif area == "scheduler":
            store_dec = "unsupported"
            auth_dec = "unsupported"
            sched_dec = "ready"
            reason = "scheduler-decision-only"
        elif diagnostic_only:
            store_dec = "unsupported"
            auth_dec = "unsupported"
            sched_dec = "unsupported"
            reason = "diagnostic-only"
        else:
            store_dec = "ready"
            auth_dec = "ready"
            sched_dec = "ready"
            reason = "python-decision-envelope-available"

    decisions = {
        "missionStore": store_dec,
        "projectResourceAuth": auth_dec,
        "scheduler": sched_dec,
    }

    can_participate = {
        "missionStore": store_dec == "ready",
        "projectResourceAuth": auth_dec == "ready",
        "scheduler": sched_dec in ("ready", "degraded"),
    }

    if simulate.get("forceUnsupported") or simulate.get("unsupported"):
        decision = "unsupported"
    elif simulate.get("block") or simulate.get("blocked"):
        decision = "blocked"
    elif simulate.get("degrade") or simulate.get("degraded"):
        decision = "degraded"
    elif diagnostic_only:
        decision = "diagnostic-only"
    else:
        decision = "ready"

    result: dict[str, Any] = {
        "decision": decision,
        "decisions": decisions,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "missionId": mission_id,
        "projectId": project_id,
        "resourceId": resource_id,
        "actor": actor,
        "causation": causation,
        "area": area,
        "canParticipate": can_participate,
        "boundaries": dict(NODE_BOUNDARIES),
        "diagnostics": {
            "reason": reason,
            "nodeOwned": [
                "durableStore",
                "authMiddleware",
                "fullScheduler",
                "cancel",
                "replayAppend",
                "errorHandling",
                "route",
            ],
            "pythonDecisionOnly": [
                "storeDecision",
                "authDecision",
                "schedulerClassification",
            ],
            "simulation": simulate or None,
            "inputDiagnostics": diagnostics or None,
        },
        "runtime": {
            "owner": "python",
            "mode": "cutover_decision",
            **{k: "node" for k in [
                "missionStoreOwner",
                "authOwner",
                "schedulerOwner",
                "cancelSemanticsOwner",
                "replayOwner",
                "errorPathOwner",
                "routeOwner",
                "durableStoreOwner",
            ]},
        },
    }

    if decision in ("blocked", "unsupported"):
        result["ok"] = False
        if decision == "blocked":
            result["blocked"] = True

    if diagnostic_only:
        result["diagnosticOnly"] = True
        result["productionTakeover"] = False

    # schedulerClassification: advisory only, never full ownership
    if sched_dec == "ready":
        sched_class = {
            "cancel": "python-decision-advisory",
            "error": "node",
            "replay": "python-decision-advisory",
            "state": "ready",
        }
    elif sched_dec == "degraded":
        sched_class = {
            "cancel": "node",
            "error": "node",
            "replay": "python-decision-advisory",
            "state": "degraded",
        }
    else:
        sched_class = {
            "cancel": "node",
            "error": "node",
            "replay": "node",
            "state": sched_dec,
        }
    result["schedulerClassification"] = sched_class

    return result


def _extract_id(payload: dict[str, Any], direct_key: str, nested_path: list[str]) -> str | None:
    val = payload.get(direct_key)
    if val is not None:
        return _clean(val)
    cur: Any = payload.get(nested_path[0]) if nested_path else None
    for key in nested_path[1:]:
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return None
    return _clean(cur) if cur is not None else None


def _error_envelope(code: str, error: str, message: str, status: int | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "decision": "unsupported",
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "error": error,
        "code": code,
        "message": message,
        "runtime": {"owner": "python", "mode": "cutover_decision"},
    }
    if status is not None:
        result["status"] = status
    return result


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v or None
    return str(value)


__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "CUTOVER_DECISIONS",
    "NODE_BOUNDARIES",
    "decide_task_store_auth_scheduler_cutover",
]
