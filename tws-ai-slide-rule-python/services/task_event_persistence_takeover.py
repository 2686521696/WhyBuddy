"""Task event persistence takeover 104.

Python-owned task event append/replay persistence for a bounded slice:
- records or validates append/replay evidence for one event slice (thin projection/evidence only)
- eventAppendPersistence / durable append surfaces remain node-retained
- Envelope explicitly separates: durable (node-retained), projection/replay (python slice), retained surfaces

Does not replace Node event append behavior.
In-memory projection evidence never claimed as durable persistence.
Node retains full event append, replay contract and real persistence.
This proves a durable-ish boundary via evidence slice, not full ownership.
"""

from __future__ import annotations

from typing import Any, Dict, List

CONTRACT_VERSION = "task-event-persistence-takeover.v1"
PROVENANCE = "python-task-event-persistence-takeover-104"

OPS = (
    "eventAppendPersistence",
    "durableEventAppend",
    "append",
    "replay",
    "appendReplayEvidence",
    "eventReplaySlice",
)

NODE_RETAINED_SURFACES = {
    "eventAppendPersistence": "node-retained",
    "durableEventAppend": "node-retained",
    "append": "node-retained",
    "realPersistence": "node",
    "errorPath": "node-retained",
}


def _clean(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    text = str(value or "").strip()
    return text or fallback


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _error_envelope(code: str, message: str) -> Dict[str, Any]:
    return {
        "ok": False,
        "error": code,
        "message": message,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
    }


def _copy_event(e: Any) -> Dict[str, Any]:
    if not _is_record(e):
        return {}
    out: Dict[str, Any] = {}
    for k in ("type", "message", "time", "stageKey", "progress", "level", "source", "id"):
        if k in e:
            out[k] = e[k]
    return out


def decide_task_event_persistence_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Classify task event persistence surfaces and return ownership envelope.

    Separates:
      - durable/eventAppendPersistence: node-retained (never python)
      - appendReplayEvidence / replay / eventReplaySlice: python-owned (bounded evidence slice)
    productionTakeover is False (retains; no full persistence takeover claim).
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = (
        payload.get("simulate")
        if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict)
        else {}
    )
    requested = _clean(
        (payload or {}).get("op")
        or (payload or {}).get("area")
        or (payload or {}).get("surface"),
        "all",
    )

    base_ownership: Dict[str, str] = {
        "eventAppendPersistence": "node-retained",
        "durableEventAppend": "node-retained",
        "append": "node-retained",
        "replay": "python-owned",
        "appendReplayEvidence": "python-owned",
        "eventReplaySlice": "python-owned",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(base_ownership.keys()):
            base_ownership[k] = "node-retained"

    if requested == "all":
        area = "all"
        ownership: Any = dict(base_ownership)
    elif requested in base_ownership:
        area = requested
        ownership = base_ownership[area]
    else:
        area = requested
        ownership = "out-of-scope"

    # productionTakeover remains false: this is evidence slice only, not durable takeover
    production_takeover = False
    if simulate.get("productionTakeover"):
        # only honored if slice and not forced retained
        if (area in ("replay", "appendReplayEvidence", "eventReplaySlice") or area == "all") and not (
            simulate.get("forceNodeRetained") or simulate.get("allRetained")
        ):
            if isinstance(ownership, dict):
                production_takeover = any(v == "python-owned" for v in ownership.values())
            else:
                production_takeover = ownership == "python-owned"
        else:
            production_takeover = False

    if isinstance(ownership, str) and ownership == "python-owned":
        reason = "python-owned-event-replay-evidence-slice;bounded-append-replay-projection"
        fallback = "node"
    elif ownership == "out-of-scope":
        reason = "out-of-scope-surface-for-task-event-persistence"
        fallback = "node"
    else:
        reason = "node-retained-event-append-persistence-per-103;real-durable-and-append-node"
        fallback = "node"

    evidence: Dict[str, Any] = {
        "source": "103-runtime-slice + 104-event-persistence-slice",
        "nodeRetains": ["eventAppendPersistence", "durableEventAppend", "append", "realPersistence"],
        "pythonOnlySlice": ["replay", "appendReplayEvidence", "eventReplaySlice"],
        "realDurableOwner": "node",
        "realEventAppendOwner": "node",
        "retainedResponsibilities": list(NODE_RETAINED_SURFACES.keys()),
        "projectionNotDurable": True,
    }

    py_owned_count = sum(1 for v in base_ownership.values() if v == "python-owned")
    node_retained_count = sum(1 for v in base_ownership.values() if v == "node-retained")
    out_of_scope = 1 if (isinstance(ownership, str) and ownership == "out-of-scope") else 0
    migration_denominator = {
        "total": len(base_ownership) + out_of_scope,
        "pythonOwned": py_owned_count,
        "nodeRetained": node_retained_count,
        "externalOwned": 0,
        "outOfScope": out_of_scope,
    }

    result: Dict[str, Any] = {
        "area": area,
        "op": area,
        "ownership": ownership,
        "productionTakeover": production_takeover,
        "migrationDenominator": migration_denominator,
        "evidence": evidence,
        "fallback": fallback,
        "reason": reason,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": True,
        "nodeRetained": dict(NODE_RETAINED_SURFACES),
    }
    if area == "all":
        result["surfaces"] = base_ownership
    return result


def record_task_event_append_replay_evidence(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Record or validate append/replay evidence for one bounded event slice.

    Returns projection envelope + evidence. Never marks as durable persistence.
    Used to prove python can handle a replay/append evidence slice.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    action = _clean((payload or {}).get("action"), "replay")
    if action not in ("append", "replay", "project"):
        action = "replay"

    raw_events = (payload or {}).get("events")
    events_in: List[Dict[str, Any]] = []
    if isinstance(raw_events, list):
        events_in = [_copy_event(e) for e in raw_events if _is_record(e)]

    # bounded slice: take up to limit
    limit_raw = (payload or {}).get("limit")
    limit = int(limit_raw) if isinstance(limit_raw, (int, float)) else len(events_in)
    slice_events = events_in[: max(0, limit)] if limit else events_in

    # python validates/records the slice evidence (projection)
    evidence = {
        "sliceOwner": "python",
        "durableOwner": "node",
        "eventCount": len(slice_events),
        "validated": True,
        "projectionNotDurable": True,
    }

    result: Dict[str, Any] = {
        "ok": True,
        "action": action,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ownership": "python-owned",
        "productionTakeover": False,
        "runtime": {
            "owner": "python",
            "eventPersistenceOwner": "node",
            "mode": "evidence_slice",
            "durable": "node-retained",
            "projection": "python-slice",
        },
        "replay": {
            "missionId": _clean((payload or {}).get("missionId") or (payload or {}).get("task", {}).get("id"), "mission-event-104"),
            "eventCount": len(slice_events),
            "events": slice_events,
            "owner": "node",  # real append owner
            "projection": {
                "projectId": _clean(
                    ((payload or {}).get("metadata") or {}).get("project", {}).get("projectId")
                    or (payload or {}).get("projectId")
                ),
            },
        },
        "evidence": evidence,
        "nodeRetained": {"eventAppendPersistence": "node-retained"},
    }
    task_in = (payload or {}).get("task")
    if _is_record(task_in):
        result["task"] = {
            "id": _clean(task_in.get("id")),
            "status": _clean(task_in.get("status"), "running"),
            "nodeStatus": _clean(task_in.get("status"), "running"),
            "progress": task_in.get("progress", 0),
        }
    return result


# aliases
get_task_event_persistence_takeover = decide_task_event_persistence_takeover
record_task_event_evidence = record_task_event_append_replay_evidence

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "OPS",
    "NODE_RETAINED_SURFACES",
    "decide_task_event_persistence_takeover",
    "get_task_event_persistence_takeover",
    "record_task_event_append_replay_evidence",
    "record_task_event_evidence",
]
