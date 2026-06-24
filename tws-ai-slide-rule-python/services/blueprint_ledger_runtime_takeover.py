"""Blueprint ledger runtime takeover 104.

Provides smallest Python-owned ledger/accounting/audit-trail slice for Blueprint jobs.
- ledger surface: node-retained (durable audit/accounting responsibility retained)
- ledgerEntrySlice: python-owned thin runtime slice for compute/validate of ledger entry
- Computes or validates a ledger entry from real job/event inputs (provides retained evidence)

productionTakeover is true ONLY for the proven python slice (via simulate).
Node bridge consumes the decision envelope; fallback explicit "node".
Migration denominator records retained ledger responsibility (nodeRetained includes ledger).

Does not own full ledger, does not replace durable store or full audit trail.
"""
from __future__ import annotations

from typing import Any, Dict, List

CONTRACT_VERSION = "blueprint.ledger-runtime-takeover.v1"
PROVENANCE = "python-blueprint-ledger-runtime-takeover-104"

SURFACES = ("ledger", "ledgerEntrySlice")


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


def decide_blueprint_ledger_runtime_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return ledger runtime takeover decision envelope.

    Payload may contain:
      - surface: "ledger" | "ledgerEntrySlice" | "all"
      - simulate: { "forceNodeRetained": true, "productionTakeover": true (only for slice) }

    For "ledger": ownership node-retained, productionTakeover=false, fallback=node
    For "ledgerEntrySlice": ownership python-owned (thin compute), productionTakeover only if simulate slice
    Records migrationDenominator with retained ledger.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict) else {}
    requested_surface = _clean((payload or {}).get("surface"), "all")

    base_ownership: Dict[str, str] = {
        "ledger": "node-retained",
        "ledgerEntrySlice": "python-owned",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(base_ownership.keys()):
            base_ownership[k] = "node-retained"

    surface = requested_surface if requested_surface in base_ownership else "all"

    if surface == "all":
        ownership: Any = dict(base_ownership)
    else:
        ownership = base_ownership.get(surface, "node-retained")

    python_slice = "ledgerEntrySlice"
    production_takeover = False
    if simulate.get("productionTakeover"):
        if surface == python_slice or (surface == "all" and False):  # never all
            production_takeover = True

    if surface == python_slice:
        reason = "python-thin-ledger-entry-compute-slice;ledger-durable-retained-in-node"
        fallback = "node"
    elif surface == "ledger" or (surface == "all"):
        reason = "node-retained-ledger-per-103;no-production-ledger-takeover"
        fallback = "node"
    else:
        reason = "out-of-scope-ledger-surface"
        fallback = "node"

    evidence: Dict[str, Any] = {
        "source": "103-scope + blueprint-ledger-entry-compute + 104-runtime-takeover",
        "nodeRetains": ["ledger"],
        "pythonOnlySlice": ["ledgerEntrySlice"],
        "durableLedger": "node",
        "realPersistenceOwner": "node",
        "hasComputeFromRealInputs": True,
    }

    migration_denominator = {
        "total": len(base_ownership),
        "pythonOwned": sum(1 for v in base_ownership.values() if v == "python-owned"),
        "nodeRetained": sum(1 for v in base_ownership.values() if v == "node-retained"),
        "externalOwned": 0,
        "outOfScope": 0,
    }

    result: Dict[str, Any] = {
        "surface": surface,
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
    if surface == "all":
        result["surfaces"] = base_ownership
    return result


def compute_blueprint_ledger_entry(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Compute or validate a ledger entry from real job/event inputs.

    Accepts job and events (or eventStream) from Blueprint job state.
    Produces a minimal persisted-or-replayable audit-trail style entry.
    This provides the runtime proof for the python-owned ledger slice.
    Does not persist; returns evidence envelope.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    job = (payload or {}).get("job") or {}
    if not _is_record(job):
        job = {}

    events_in: List[Any] = []
    raw_events = (payload or {}).get("events") or (payload or {}).get("eventStream") or []
    if isinstance(raw_events, list):
        events_in = [e for e in raw_events if _is_record(e)]

    job_id = _clean(job.get("id") or (payload or {}).get("jobId"), "unknown")
    status = _clean(job.get("status") or (payload or {}).get("status"), "pending")
    stage = _clean(job.get("stage") or (payload or {}).get("stage"), "input")
    project_id = job.get("projectId") or (payload or {}).get("projectId")

    # Compute deterministic ledger entry (replayable from inputs)
    entry_count = len(events_in)
    ledger_entry: Dict[str, Any] = {
        "id": f"led-{job_id}",
        "jobId": job_id,
        "entryType": "job-audit-trail",
        "status": status,
        "stage": stage,
        "projectId": project_id,
        "eventCount": entry_count,
        "transitions": [e.get("status") or e.get("type") for e in events_in if _is_record(e)][:5],
        "computedFrom": "real-job+events",
        "recordedAt": _clean((payload or {}).get("now") or job.get("updatedAt"), "2026-06-24T00:00:00.000Z"),
    }

    return {
        "ok": True,
        "action": _clean((payload or {}).get("action"), "compute"),
        "contractVersion": CONTRACT_VERSION,
        "runtime": {
            "owner": "python",
            "ledgerOwner": "node",
            "mode": "ledger-entry-slice",
        },
        "ledgerEntry": ledger_entry,
        "ownership": "python-owned",
        "productionTakeover": False,
        "provenance": PROVENANCE,
    }


# aliases for consumption
get_blueprint_ledger_runtime_takeover = decide_blueprint_ledger_runtime_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "SURFACES",
    "decide_blueprint_ledger_runtime_takeover",
    "get_blueprint_ledger_runtime_takeover",
    "compute_blueprint_ledger_entry",
]
