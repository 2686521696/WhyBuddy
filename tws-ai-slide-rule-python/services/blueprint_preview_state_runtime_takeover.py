"""Blueprint preview state runtime takeover 104.

Python-owned preview-state projection/validation for a bounded Blueprint slice.
- previewState classified node-retained (durable surfaces per 103)
- previewStateRuntimeSlice: python-owned thin runtime projection slice only
- Provides decide + project function that returns decision/projection for realistic input
- productionTakeover always false for this slice; distinguishes projection from durable production
- Node bridge can consume decision; explicit node fallback preserved
- Updates migration denominator in evidence for accounting (thin slice only)

Does not migrate durable preview state, does not rewrite effect preview systems.
"""

from __future__ import annotations

from typing import Any, Dict, List

CONTRACT_VERSION = "blueprint.preview-state-runtime-takeover.v1"
PROVENANCE = "python-blueprint-preview-state-runtime-takeover-104"

SURFACES = (
    "previewState",
    "previewStateRuntimeSlice",
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


def decide_blueprint_preview_state_runtime_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return preview state runtime takeover decision envelope.

    Payload may contain:
      - surface: one of SURFACES or "all"
      - simulate: { "forceNodeRetained": true, "productionTakeover": true (neg) }

    Returns envelope distinguishing projection slice from durable takeover.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict) else {}
    requested_surface = _clean((payload or {}).get("surface"), "all")

    base_ownership: Dict[str, str] = {
        "previewState": "node-retained",
        "previewStateRuntimeSlice": "python-owned",
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

    if surface == "previewStateRuntimeSlice":
        reason = "python-thin-preview-state-projection-slice;preview-state-durable-retained-in-node"
        fallback = "node"
    else:
        reason = "node-retained-preview-state-per-103;no-production-runtime-takeover"
        fallback = "node"

    evidence = {
        "source": "103-scope + 104-preview-state-projection-boundary",
        "nodeRetains": ["previewState"],
        "pythonOnlySlice": ["previewStateRuntimeSlice"],
        "realPreviewStateDurable": "node",
        "projectionOnly": True,
        "migrationDenominatorUpdated": True,
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


def project_blueprint_preview_state(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return a preview-state decision/projection for a realistic input.

    Accepts bounded slice e.g. {"blueprintId": "...", "nodes": [{"id":.., "state":..}, ...]}
    Returns python runtime projection envelope.
    Explicitly productionTakeover=false, fallback=node to distinguish from durable.
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    nodes_in: List[Dict[str, Any]] = []
    raw_nodes = (payload or {}).get("nodes")
    if isinstance(raw_nodes, list):
        nodes_in = [n for n in raw_nodes if isinstance(n, dict)]

    bp_id = _clean((payload or {}).get("blueprintId") or (payload or {}).get("id"), "bp-unknown")

    # narrow runtime projection: validate + project count/state slice only
    projected_nodes = []
    for n in nodes_in[:5]:  # bounded
        nid = _clean(n.get("id") or n.get("nodeId"), "node")
        projected_nodes.append({
            "id": nid,
            "previewStatus": _clean(n.get("previewStatus") or n.get("status"), "ready"),
            "projected": True,
        })

    projection = {
        "blueprintId": bp_id,
        "nodeCount": len(projected_nodes),
        "nodes": projected_nodes,
        "stateVersion": 1,
        "validated": True,
        "source": "python-projection",
    }

    return {
        "ok": True,
        "action": "project",
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "runtime": {
            "owner": "python",
            "previewStateOwner": "node",
            "mode": "projection_slice",
        },
        "projection": projection,
        "ownership": "python-owned",
        "productionTakeover": False,
        "fallback": "node",
    }


# alias
get_blueprint_preview_state_runtime_takeover = decide_blueprint_preview_state_runtime_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "SURFACES",
    "decide_blueprint_preview_state_runtime_takeover",
    "get_blueprint_preview_state_runtime_takeover",
    "project_blueprint_preview_state",
]
