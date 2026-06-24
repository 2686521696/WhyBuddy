"""Task production denominator reconciliation 104.

Reconciles durable store, project auth, scheduler, and event persistence
into one Task lifecycle denominator report.

Aggregates 104 evidence from:
- task_durable_mission_store_takeover (durableWriteSlice etc)
- task_project_auth_runtime_takeover
- task_scheduler_runtime_takeover
- task_event_persistence_takeover
- prior 103 slice + 102 ownership closure

Core durable/project/scheduler/event append are node-retained.
Python owns only thin slices (write/replay/state projections).
Never raises full Task lifecycle complete.

Reports counts for pythonOwned, nodeRetained, blocked, outOfScope.
Remaining blockers listed machine-readably.
Python canonical; Node mirrors for agreement.
"""

from __future__ import annotations

from typing import Any, Dict, List

CONTRACT_VERSION = "task.production-denominator-reconciliation.v1"
PROVENANCE = "python-task-production-denominator-reconciliation-104"

TASK_104_SURFACES: Dict[str, str] = {
    "durableStore": "node-retained",
    "projectResourceAuth": "node-retained",
    "scheduler": "node-retained",
    "eventAppendPersistence": "node-retained",
    "runtimeStateSlice": "python-owned",
    "cancelStateDecision": "python-owned",
    "replayProjectionSlice": "python-owned",
    "durableWriteSlice": "python-owned",
    "cancelWriteSlice": "python-owned",
    "eventReplaySlice": "python-owned",
    "appendReplayEvidence": "python-owned",
}

BLOCKERS: List[str] = ["durableStore", "projectResourceAuth", "scheduler", "eventAppendPersistence"]


def _clean(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    text = str(value or "").strip()
    return text or fallback


def _error_envelope(code: str, message: str) -> Dict[str, Any]:
    return {
        "ok": False,
        "error": code,
        "message": message,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
    }


def decide_task_production_denominator_reconciliation(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return reconciled denominator report for Task 104 surfaces.

    Payload:
      - surface or area: key in surfaces or "all"
      - simulate: { "forceNodeRetained": bool, "block": bool, "productionTakeover": bool }

    Returns envelope with:
      - area, ownership, productionTakeover, migrationDenominator (incl blocked),
        blockers list, reason, evidence, ...
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = (
        payload.get("simulate")
        if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict)
        else {}
    )
    requested = _clean((payload or {}).get("surface") or (payload or {}).get("area"), "all")

    base_ownership: Dict[str, str] = dict(TASK_104_SURFACES)

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(base_ownership.keys()):
            base_ownership[k] = "node-retained"

    if simulate.get("block") or simulate.get("blocked"):
        for k in BLOCKERS:
            if k in base_ownership:
                base_ownership[k] = "blocked"

    if requested == "all":
        area = "all"
        ownership: Any = dict(base_ownership)
    elif requested in base_ownership:
        area = requested
        ownership = base_ownership[area]
    else:
        area = requested
        ownership = "out-of-scope"

    production_takeover = False
    if simulate.get("productionTakeover"):
        if area == "all":
            production_takeover = False  # blocked by retained surfaces
        elif isinstance(ownership, str) and ownership == "python-owned":
            production_takeover = True

    if area == "all":
        py_o = sum(1 for v in base_ownership.values() if v == "python-owned")
        node_r = sum(1 for v in base_ownership.values() if v == "node-retained")
        blk = sum(1 for v in base_ownership.values() if v == "blocked")
        out_o = sum(1 for v in base_ownership.values() if v == "out-of-scope")
        total = len(base_ownership)
    else:
        if isinstance(ownership, str):
            if ownership == "python-owned":
                py_o, node_r, blk, out_o = 1, 0, 0, 0
            elif ownership == "node-retained":
                py_o, node_r, blk, out_o = 0, 1, 0, 0
            elif ownership == "blocked":
                py_o, node_r, blk, out_o = 0, 0, 1, 0
            elif ownership == "out-of-scope":
                py_o, node_r, blk, out_o = 0, 0, 0, 1
            else:
                py_o, node_r, blk, out_o = 0, 0, 0, 0
        else:
            py_o = node_r = blk = out_o = 0
        total = 1

    migration_denominator = {
        "total": total if area != "all" else len(base_ownership),
        "pythonOwned": py_o,
        "nodeRetained": node_r,
        "blocked": blk,
        "outOfScope": out_o,
    }

    if area == "all":
        migration_denominator = {
            "total": len(base_ownership),
            "pythonOwned": sum(1 for v in base_ownership.values() if v == "python-owned"),
            "nodeRetained": sum(1 for v in base_ownership.values() if v == "node-retained"),
            "blocked": sum(1 for v in base_ownership.values() if v == "blocked"),
            "outOfScope": sum(1 for v in base_ownership.values() if v == "out-of-scope"),
        }

    blockers_list: List[str] = [k for k, v in base_ownership.items() if v in ("node-retained", "blocked")]

    reason = (
        "reconciled-104-durable-auth-scheduler-event;node-retains-core;python-thin-slices-only"
        if area == "all"
        else (
            "node-retained-core-surface-per-104-recon"
            if (isinstance(ownership, str) and ownership in ("node-retained", "blocked"))
            else "python-thin-slice;no-durable-takeover"
        )
    )

    evidence: Dict[str, Any] = {
        "source": "104-task-durable-mission + project-auth + scheduler + event-persistence + 103-slice + 102-ownership",
        "coreRetained": list(BLOCKERS),
        "nodeRetains": [k for k, v in base_ownership.items() if v == "node-retained"],
        "pythonOnlySlices": [k for k, v in base_ownership.items() if v == "python-owned"],
        "blockedSurfaces": [k for k, v in base_ownership.items() if v == "blocked"],
        "realDurableRetained": "node",
        "thinSlicesOnly": True,
        "blockers": blockers_list,
    }

    result: Dict[str, Any] = {
        "area": area,
        "ownership": ownership,
        "productionTakeover": production_takeover,
        "migrationDenominator": migration_denominator,
        "blockers": blockers_list,
        "reason": reason,
        "evidence": evidence,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": True,
    }
    if area == "all":
        result["surfaces"] = base_ownership
    return result


# alias
get_task_production_denominator_reconciliation = decide_task_production_denominator_reconciliation

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "TASK_104_SURFACES",
    "BLOCKERS",
    "decide_task_production_denominator_reconciliation",
    "get_task_production_denominator_reconciliation",
]
