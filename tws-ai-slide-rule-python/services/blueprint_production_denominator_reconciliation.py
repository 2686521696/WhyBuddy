"""Blueprint production denominator reconciliation 104.

Aggregates the six Blueprint 104 takeover attempts (jobStore, eventBus, ledger,
replan, promptPackage, previewState) + their proven thin python slices.

Reports which surfaces are python-owned (thin slices only), node-retained (durable/core),
or out-of-scope.

canClaimBlueprintProductionTakeover is true ONLY if no node-retained in-scope blockers remain.
Used to reconcile denominator across 104 surfaces for migration accounting.
Python provides canonical counts; Node mirrors for test agreement.

Does not claim production ownership of retained surfaces.
"""

from __future__ import annotations

from typing import Any, Dict

CONTRACT_VERSION = "blueprint.production-denominator-reconciliation.v1"
PROVENANCE = "python-blueprint-production-denominator-reconciliation-104"

# The six attempted + thin python slices proven in 104 (thin only, no durable)
BLUEPRINT_104_SURFACES: Dict[str, str] = {
    "jobStore": "node-retained",
    "eventBus": "node-retained",
    "ledger": "node-retained",
    "replan": "node-retained",
    "promptPackage": "node-retained",
    "previewState": "node-retained",
    "jobStateRuntimeSlice": "python-owned",
    "eventProjectionSlice": "python-owned",
    "ledgerEntrySlice": "python-owned",
    "previewStateRuntimeSlice": "python-owned",
    "validationSlice": "python-owned",
    "replanDecisionSlice": "python-owned",
}


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


def _compute_can_claim(ownership: Dict[str, str]) -> bool:
    for v in ownership.values():
        if v == "node-retained":
            return False
    return True


def decide_blueprint_production_denominator_reconciliation(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return reconciled denominator report for Blueprint 104 surfaces.

    Payload:
      - surface or area: key in surfaces or "all"
      - simulate: { "forceNodeRetained": bool, "productionTakeover": bool }

    Returns envelope including:
      - surfaces (or surface), ownership, productionTakeover, migrationDenominator,
        canClaimBlueprintProductionTakeover, reason, evidence, ...
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict) else {}
    requested = _clean((payload or {}).get("surface") or (payload or {}).get("area"), "all")

    base_ownership: Dict[str, str] = dict(BLUEPRINT_104_SURFACES)

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

    production_takeover = False
    if simulate.get("productionTakeover"):
        if area == "all":
            # only if no retained blockers
            production_takeover = _compute_can_claim(base_ownership)
        elif isinstance(ownership, str) and ownership == "python-owned":
            production_takeover = True

    can_claim = _compute_can_claim(base_ownership)

    if area == "all":
        node_r = sum(1 for v in base_ownership.values() if v == "node-retained")
        py_o = sum(1 for v in base_ownership.values() if v == "python-owned")
        ext_o = sum(1 for v in base_ownership.values() if v == "external-owned")
        out_o = sum(1 for v in base_ownership.values() if v == "out-of-scope")
        total = len(base_ownership)
    else:
        if isinstance(ownership, str):
            if ownership == "python-owned":
                py_o, node_r, ext_o, out_o = 1, 0, 0, 0
            elif ownership == "node-retained":
                py_o, node_r, ext_o, out_o = 0, 1, 0, 0
            elif ownership == "out-of-scope":
                py_o, node_r, ext_o, out_o = 0, 0, 0, 1
            else:
                py_o, node_r, ext_o, out_o = 0, 0, 1, 0
        else:
            py_o = node_r = ext_o = out_o = 0
        total = 1

    migration_denominator = {
        "total": total if area != "all" else len(base_ownership),
        "pythonOwned": py_o,
        "nodeRetained": node_r,
        "externalOwned": ext_o,
        "outOfScope": out_o,
    }

    if area == "all":
        migration_denominator = {
            "total": len(base_ownership),
            "pythonOwned": sum(1 for v in base_ownership.values() if v == "python-owned"),
            "nodeRetained": sum(1 for v in base_ownership.values() if v == "node-retained"),
            "externalOwned": sum(1 for v in base_ownership.values() if v == "external-owned"),
            "outOfScope": sum(1 for v in base_ownership.values() if v == "out-of-scope"),
        }

    reason = (
        "reconciled-104-six-surfaces;node-retains-durable-core;python-thin-slices-only"
        if area == "all"
        else ("node-retained-core-surface-per-104-recon" if (isinstance(ownership, str) and ownership == "node-retained") else "python-thin-slice;no-durable-takeover")
    )

    evidence = {
        "source": "104-six-takeovers + 103-scope + 102-ownership-closure",
        "six104Attempts": ["jobStore", "eventBus", "ledger", "replan", "promptPackage", "previewState"],
        "nodeRetains": [k for k, v in base_ownership.items() if v == "node-retained"],
        "pythonOnlySlices": [k for k, v in base_ownership.items() if v == "python-owned"],
        "realDurableRetained": "node",
        "thinSlicesOnly": True,
    }

    result: Dict[str, Any] = {
        "area": area,
        "ownership": ownership,
        "productionTakeover": production_takeover,
        "migrationDenominator": migration_denominator,
        "canClaimBlueprintProductionTakeover": can_claim,
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
get_blueprint_production_denominator_reconciliation = decide_blueprint_production_denominator_reconciliation

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "BLUEPRINT_104_SURFACES",
    "decide_blueprint_production_denominator_reconciliation",
    "get_blueprint_production_denominator_reconciliation",
]
