"""Blueprint event bus runtime takeover 104.

Creates a bounded Python-owned event projection/append/replay slice for Blueprint events.
- Classifies append/project/replay ownership
- Runs one deterministic event projection (sorted replay slice)
- eventBus and durable append remain node-retained (no production takeover)
- Python projection/replay slice is thin accounting/runtime envelope only.

Does not replace Node event bus transport or durable append.
Envelope separates python-owned / node-retained / out-of-scope.
"""

from __future__ import annotations

from typing import Any, Dict, List

CONTRACT_VERSION = "blueprint.event-bus-runtime-takeover.v1"
PROVENANCE = "python-blueprint-event-bus-runtime-takeover-104"

OPS = ("eventBus", "append", "project", "replay", "eventProjectionSlice")


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


def decide_blueprint_event_bus_runtime_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return event bus runtime takeover decision envelope.

    Payload:
      - op or area: one of OPS or "all"
      - simulate: { "forceNodeRetained": true }

    Ownership:
      - eventBus, append: node-retained (real transport/durable)
      - project, replay, eventProjectionSlice: python-owned (thin slice)
    productionTakeover always false for this boundary.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict) else {}
    requested = _clean((payload or {}).get("op") or (payload or {}).get("area") or (payload or {}).get("surface"), "all")

    base_ownership: Dict[str, str] = {
        "eventBus": "node-retained",
        "append": "node-retained",
        "project": "python-owned",
        "replay": "python-owned",
        "eventProjectionSlice": "python-owned",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(base_ownership.keys()):
            base_ownership[k] = "node-retained"

    python_slices = ("project", "replay", "eventProjectionSlice")
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
    if simulate.get("productionTakeover") and (area in python_slices or (area == "all" and False)):
        production_takeover = True

    if area in python_slices:
        reason = "python-thin-event-projection-replay-slice;event-bus-transport-retained-in-node"
        fallback = "node"
    elif ownership == "out-of-scope":
        reason = "out-of-scope-op-for-event-bus-runtime;only-known-ops-classified"
        fallback = "node"
    else:
        reason = "node-retained-event-bus-per-103;no-production-event-transport-takeover"
        fallback = "node"

    evidence = {
        "source": "103-scope + job-event-stream + 104-event-bus-slice",
        "nodeRetains": ["eventBus", "append"],
        "pythonOnlySlice": ["project", "replay", "eventProjectionSlice"],
        "realEventBus": "node",
        "realAppendOwner": "node",
    }

    out_of_scope_count = 1 if (isinstance(ownership, str) and ownership == "out-of-scope") else 0
    migration_denominator = {
        "total": len(base_ownership) + out_of_scope_count,
        "pythonOwned": sum(1 for v in base_ownership.values() if v == "python-owned"),
        "nodeRetained": sum(1 for v in base_ownership.values() if v == "node-retained"),
        "externalOwned": 0,
        "outOfScope": out_of_scope_count,
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
    }
    if area == "all":
        result["areas"] = base_ownership
    return result


def project_blueprint_event_bus(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Run one deterministic event projection (bounded slice).

    Deterministic: stable sort by occurredAt then id.
    Never claims durable append ownership; returns projection envelope only.
    Used to demonstrate python-owned projection capability without takeover of bus.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    events_in: List[Any] = []
    raw = (payload or {}).get("events")
    if isinstance(raw, list):
        events_in = [e for e in raw if _is_record(e)]

    action = _clean((payload or {}).get("action"), "project")

    def _key(e: dict) -> tuple:
        return (_clean(e.get("occurredAt")), _clean(e.get("id")))

    # deterministic projection
    projected: List[Dict[str, Any]] = sorted(
        [_copy_event(e) for e in events_in],
        key=_key,
    )

    return {
        "ok": True,
        "action": action,
        "contractVersion": CONTRACT_VERSION,
        "runtime": {
            "owner": "python",
            "eventBusOwner": "node",
            "mode": "projection_slice",
        },
        "projection": {
            "count": len(projected),
            "events": projected,
        },
        "ownership": "python-owned",
        "productionTakeover": False,
    }


def _copy_event(e: dict) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k in ("id", "jobId", "type", "family", "stage", "stageId", "status", "message", "occurredAt", "projectId"):
        if k in e:
            out[k] = e[k]
    if "actor" in e and _is_record(e["actor"]):
        out["actor"] = dict(e["actor"])
    if "causation" in e and _is_record(e["causation"]):
        out["causation"] = dict(e["causation"])
    if "error" in e and _is_record(e["error"]):
        out["error"] = dict(e["error"])
    return out


get_blueprint_event_bus_runtime_takeover = decide_blueprint_event_bus_runtime_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "OPS",
    "decide_blueprint_event_bus_runtime_takeover",
    "get_blueprint_event_bus_runtime_takeover",
    "project_blueprint_event_bus",
]
