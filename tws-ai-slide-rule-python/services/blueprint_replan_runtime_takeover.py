"""Blueprint replan runtime takeover 104.

Provides bounded Python-owned replan decision slice for branch validation / conflict classification.
- replan: node-retained (core replan/branching ownership retained in Node per 103)
- replanDecisionSlice: python-owned thin runtime slice for deterministic branch/replan classification

Python returns deterministic classification for realistic replan inputs (fromStage, mode, optional job snapshot).
productionTakeover remains false for the main replan; slice only for decision envelope.
Node bridge consumes decision for bounded slice; existing Node replan route, 409 conflict, handlers remain untouched.

This proves a python decision slice if feasible without owning full replan runtime.
"""
from __future__ import annotations

from typing import Any, Dict, List

CONTRACT_VERSION = "blueprint.replan-runtime-takeover.v1"
PROVENANCE = "python-blueprint-replan-runtime-takeover-104"

SURFACES = ("replan", "replanDecisionSlice")


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


def decide_blueprint_replan_runtime_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return replan runtime takeover decision envelope.

    Payload may contain:
      - surface: "replan" | "replanDecisionSlice" | "all"
      - simulate: { "forceNodeRetained": true, "productionTakeover": true (only for slice) }

    replan always node-retained with productionTakeover=false, fallback=node
    replanDecisionSlice: python-owned for branch validation / classification slice.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict) else {}
    requested_surface = _clean((payload or {}).get("surface"), "all")

    base_ownership: Dict[str, str] = {
        "replan": "node-retained",
        "replanDecisionSlice": "python-owned",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(base_ownership.keys()):
            base_ownership[k] = "node-retained"

    surface = requested_surface if requested_surface in base_ownership else "all"

    if surface == "all":
        ownership: Any = dict(base_ownership)
    else:
        ownership = base_ownership.get(surface, "node-retained")

    python_slice = "replanDecisionSlice"
    production_takeover = False
    if simulate.get("productionTakeover"):
        if surface == python_slice or surface == "all":
            production_takeover = surface == python_slice

    if surface == python_slice:
        reason = "python-replan-decision-slice;branch-validation-and-conflict-classification;core-replan-node-retained"
        fallback = "node"
    elif surface == "replan" or surface == "all":
        reason = "node-retained-replan-per-103;no-production-replan-takeover"
        fallback = "node"
    else:
        reason = "out-of-scope-replan-surface"
        fallback = "node"

    evidence: Dict[str, Any] = {
        "source": "103-replan-node-retained + 104-replan-decision-slice",
        "nodeRetains": ["replan"],
        "pythonOnlySlice": ["replanDecisionSlice"],
        "branchValidation": "python-decision-slice",
        "downstreamInvalidation": "node-owns-409-conflict",
        "realReplanOwner": "node",
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


def classify_blueprint_replan_decision(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return deterministic branch/replan classification for a realistic input.

    Accepts replanRequest-like input: { fromStage, mode, reason?, job? } or wrapped.
    This exercises the bounded python-owned replan decision slice:
    - branch vs in_place classification
    - simple conflict hint (but actual 409 remains in Node)
    - downstream invalidation notes kept empty (node owns enforcement)
    Deterministic, no side effects.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    req = (payload or {}).get("replanRequest") or payload or {}
    if not _is_record(req):
        req = {}

    from_stage = _clean(req.get("fromStage") or (payload or {}).get("fromStage"), "input")
    mode = _clean(req.get("mode") or (payload or {}).get("mode"), "branch")
    reason = req.get("reason") or (payload or {}).get("reason")

    # Deterministic classification logic for the slice (branch validation path)
    classification = "branch" if mode == "branch" else "in_place"
    valid = True
    conflict_reason = None
    downstream_invalidated: List[str] = []

    # Example deterministic rule for slice (not authoritative; Node guards own real conflicts)
    if from_stage in ("final_artifact", "publish", "final"):
        valid = mode != "branch"  # example: late stages discourage branch in this decision slice
        if not valid:
            conflict_reason = "downstream_final_stage"
            downstream_invalidated = [from_stage]

    # job snapshot if provided can influence (simple)
    job = (payload or {}).get("job") or req.get("job") or {}
    if _is_record(job) and job.get("status") == "running" and mode == "in_place":
        # in place on running can be allowed in slice decision
        pass

    classification_result: Dict[str, Any] = {
        "fromStage": from_stage,
        "mode": mode,
        "classification": classification,
        "valid": valid,
        "conflictReason": conflict_reason,
        "downstreamInvalidated": downstream_invalidated,
        "reason": "python-decision-slice" if valid else "python-slice-hint",
    }
    if reason:
        classification_result["inputReason"] = reason

    return {
        "ok": True,
        "action": _clean((payload or {}).get("action"), "classify"),
        "contractVersion": CONTRACT_VERSION,
        "runtime": {
            "owner": "python",
            "replanOwner": "node",
            "mode": "replan-decision-slice",
        },
        "classification": classification_result,
        "ownership": "python-owned",
        "productionTakeover": False,
        "provenance": PROVENANCE,
    }


# Backwards alias
get_blueprint_replan_runtime_takeover = decide_blueprint_replan_runtime_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "SURFACES",
    "decide_blueprint_replan_runtime_takeover",
    "get_blueprint_replan_runtime_takeover",
    "classify_blueprint_replan_decision",
]
