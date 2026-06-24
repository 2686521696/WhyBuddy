"""Blueprint job store runtime takeover 104.

Classifies Blueprint job store runtime surfaces for 104:
- jobStore and durable surfaces: node-retained (explicitly)
- jobStateRuntimeSlice: thin python-owned runtime decision slice (no durable store)

productionTakeover remains false; no claim on real job store persistence.
fallback indicates the runtime owner to fall back to ("node").
Durable store stays retained and is excluded from python migration numerator.

Python decision consumed by Node bridge for accounting/tests only.
Real durable job store / events remain in Node per service.ts .
"""
from __future__ import annotations

from typing import Any, Dict

CONTRACT_VERSION = "blueprint.job-store-runtime-takeover.v1"
PROVENANCE = "python-blueprint-job-store-runtime-takeover-104"

SURFACES = (
    "jobStore",
    "eventBus",
    "ledger",
    "replan",
    "promptPackage",
    "previewState",
    "jobStateRuntimeSlice",
)


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


def decide_blueprint_job_store_runtime_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return runtime takeover decision envelope.

    Payload may contain:
      - surface: one of SURFACES or "all"
      - simulate: { "forceNodeRetained": true, ... }

    Returns stable envelope with surface, ownership, productionTakeover,
    migrationDenominator, evidence, and fallback.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict) else {}
    requested_surface = _clean((payload or {}).get("surface"), "all")

    base_ownership: Dict[str, str] = {
        "jobStore": "node-retained",
        "eventBus": "node-retained",
        "ledger": "node-retained",
        "replan": "node-retained",
        "promptPackage": "node-retained",
        "previewState": "node-retained",
        "jobStateRuntimeSlice": "python-owned",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(base_ownership.keys()):
            base_ownership[k] = "node-retained"

    surface = requested_surface if requested_surface in base_ownership else "all"

    if surface == "all":
        ownership: Any = dict(base_ownership)
    else:
        ownership = base_ownership[surface]

    production_takeover = False
    if simulate.get("productionTakeover"):
        production_takeover = True  # negative test only

    if surface == "jobStateRuntimeSlice":
        reason = "python-thin-job-state-runtime-slice; durable-job-store-retained-in-node"
        fallback = "node"
    else:
        reason = "node-retained-durable-job-store-per-103;no-production-runtime-takeover"
        fallback = "node"

    evidence = {
        "source": "103-scope + job-runtime-proxy-boundary + 104-runtime-decision",
        "nodeRetains": ["jobStore", "eventBus", "ledger", "replan", "promptPackage", "previewState"],
        "pythonOnlySlice": ["jobStateRuntimeSlice"],
        "durableStore": "node",
        "realPersistenceOwner": "node",
    }

    migration_denominator = {
        "total": len(base_ownership),
        "pythonOwned": sum(1 for v in base_ownership.values() if v == "python-owned"),
        "nodeRetained": sum(1 for v in base_ownership.values() if v == "node-retained"),
        "externalOwned": 0,
        "outOfScope": sum(1 for v in base_ownership.values() if v == "out-of-scope"),
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


# Backwards alias
get_blueprint_job_store_runtime_takeover = decide_blueprint_job_store_runtime_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "SURFACES",
    "decide_blueprint_job_store_runtime_takeover",
    "get_blueprint_job_store_runtime_takeover",
]
