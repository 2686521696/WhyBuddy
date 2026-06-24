"""Final provider and A2A scope reconciliation 104.

Reconciles Web AIGC real provider live contract (103) + A2A session/stream/transport ownership (102/103)
into a single final denominator report for migration boundary.

- Aggregates provider counts (live-ready/skipped/synthetic/external-owned)
- Aggregates A2A scope (python-slice vs node-retained vs external-agent-required)
- Explicitly: skipped-live, synthetic, external-owned, external-agent-required NEVER count as numerator / completion.
- Real live-ready Python-owned takeover ONLY with explicit evidence (never faked from external or synthetic).
- Python canonical; Node mirror must return identical summary shape and counts.
- No production takeover claimed for retained surfaces.
"""

from __future__ import annotations

from typing import Any, Dict, List

from services.web_aigc_real_provider_live_contract import (  # noqa: E402
    get_web_aigc_real_provider_live_contract,
)
from services.a2a_production_transport_ownership_closure import (  # noqa: E402
    decide_a2a_production_transport_ownership_closure,
)

CONTRACT_VERSION = "final.provider_a2a.scope_reconciliation.v1"
PROVENANCE = "python-final-provider-a2a-scope-reconciliation-104"

# A2A scope surfaces for final recon (retained or external or slice)
A2A_SCOPE_SURFACES: Dict[str, str] = {
    "registry": "node-retained",
    "sessionStreamSliceDecision": "python-owned",
    "realStreamTransport": "node-retained",
    "externalAgentInvoke": "external-agent-required",
    "chatReporting": "node-retained",
}

A2A_BLOCKERS: List[str] = ["registry", "realStreamTransport", "externalAgentInvoke", "chatReporting"]


def _error_envelope(code: str, message: str) -> Dict[str, Any]:
    return {
        "ok": False,
        "error": code,
        "message": message,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
    }


def decide_final_provider_a2a_scope_reconciliation(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return reconciled final provider + A2A scope denominator.

    payload:
      - area: "providers" | "a2a" | "all"
      - simulate: { "liveReadyPython": bool, "blockA2a": bool, ... } for test control (no real keys)
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    payload = payload or {}
    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    area = str(payload.get("area") or payload.get("surface") or "all").strip() or "all"

    # Get provider contract (103)
    prov = get_web_aigc_real_provider_live_contract()
    prov_counts = prov.get("counts", {})
    prov_providers = prov.get("providers", {})

    live_ready = int(prov_counts.get("liveReady", 0))
    skipped_live = int(prov_counts.get("skippedLive", 0))
    synthetic = int(prov_counts.get("synthetic", 0))
    external_owned = int(prov_counts.get("externalOwned", 0))
    real_python_takeover = int(prov.get("realPythonTakeover", 0))

    # respect simulate live only for python-owned real internal (none here)
    if simulate.get("liveReadyPython"):
        # only if some python internal live, but per guard no external fakes count
        # in base contract there are 0 python-owned live-ready
        real_python_takeover = 0
        live_ready = 0

    if simulate.get("forceProviderCounts"):
        fc = simulate["forceProviderCounts"]
        live_ready = int(fc.get("liveReady", live_ready))
        skipped_live = int(fc.get("skippedLive", skipped_live))
        synthetic = int(fc.get("synthetic", synthetic))
        external_owned = int(fc.get("externalOwned", external_owned))
        real_python_takeover = 0  # simulate never grants takeover

    provider_summary = {
        "total": live_ready + skipped_live + synthetic + external_owned,
        "liveReady": live_ready,
        "skippedLive": skipped_live,
        "synthetic": synthetic,
        "externalOwned": external_owned,
        "realPythonTakeover": real_python_takeover,
    }

    # Get A2A ownership (102)
    a2a = decide_a2a_production_transport_ownership_closure({"area": "all"})
    a2a_ownership = a2a.get("ownership", {}) or {}
    # merge static surfaces for final scope
    base_a2a = dict(A2A_SCOPE_SURFACES)
    if simulate.get("blockA2a") or simulate.get("block"):
        for k in A2A_BLOCKERS:
            if k in base_a2a:
                base_a2a[k] = "blocked"
    # override from live a2a decision where relevant
    for k, v in a2a_ownership.items():
        if k in base_a2a:
            base_a2a[k] = v

    a2a_py = sum(1 for v in base_a2a.values() if v == "python-owned")
    a2a_node = sum(1 for v in base_a2a.values() if v == "node-retained")
    a2a_ext = sum(1 for v in base_a2a.values() if v == "external-agent-required")
    a2a_block = sum(1 for v in base_a2a.values() if v == "blocked")

    a2a_summary = {
        "total": len(base_a2a),
        "pythonOwned": a2a_py,
        "nodeRetained": a2a_node,
        "externalAgentRequired": a2a_ext,
        "blocked": a2a_block,
        "productionTakeover": False,
    }

    # final combined
    if area == "all":
        total_surfaces = provider_summary["total"] + a2a_summary["total"]
        py_owned = provider_summary["realPythonTakeover"] + a2a_py
        node_r = a2a_node + provider_summary["externalOwned"]  # external-owned treated retained for scope
        excluded = provider_summary["skippedLive"] + provider_summary["synthetic"] + a2a_ext + a2a_block
        denom = {
            "totalSurfaces": total_surfaces,
            "pythonOwned": py_owned,
            "nodeRetained": node_r,
            "externalOwnedOrSkipped": provider_summary["skippedLive"] + provider_summary["synthetic"],
            "externalAgentOrBlocked": a2a_ext + a2a_block,
            "canClaimCompletion": False,  # per guardrails
        }
    elif area in ("providers", "provider"):
        area = "providers"
        denom = {
            "totalSurfaces": provider_summary["total"],
            "pythonOwned": provider_summary["realPythonTakeover"],
            "nodeRetained": provider_summary["externalOwned"],
            "externalOwnedOrSkipped": provider_summary["skippedLive"] + provider_summary["synthetic"],
            "canClaimCompletion": False,
        }
    elif area in ("a2a", "a2aScope"):
        area = "a2a"
        denom = {
            "totalSurfaces": a2a_summary["total"],
            "pythonOwned": a2a_py,
            "nodeRetained": a2a_node,
            "externalAgentOrBlocked": a2a_ext + a2a_block,
            "canClaimCompletion": False,
        }
    else:
        area = "unknown"
        denom = {"totalSurfaces": 0, "pythonOwned": 0, "canClaimCompletion": False}

    excluded_list: List[str] = [
        "skipped-live",
        "synthetic",
        "external-owned",
        "external-agent-required",
        "node-retained",
    ]

    note = (
        "skipped-live, synthetic, external-owned, and external-agent-required stay excluded from completion math. "
        "Real live-ready claim possible only with explicit live-ready ownership and takeover evidence (python-owned only)."
    )

    result: Dict[str, Any] = {
        "area": area,
        "ok": True,
        "productionTakeover": False,
        "providerSummary": provider_summary,
        "a2aSummary": a2a_summary,
        "migrationDenominator": denom,
        "excludedFromNumerator": excluded_list,
        "blockers": [k for k, v in base_a2a.items() if v in ("node-retained", "external-agent-required", "blocked")],
        "reason": "final-104-recon;providers-from-103;a2a-from-102-103;no-fake-takeover",
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "note": note,
    }
    if area == "all":
        result["surfaces"] = {
            "providers": prov_providers,
            "a2aScope": base_a2a,
        }
    return result


# aliases
get_final_provider_a2a_scope_reconciliation = decide_final_provider_a2a_scope_reconciliation

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "A2A_SCOPE_SURFACES",
    "A2A_BLOCKERS",
    "decide_final_provider_a2a_scope_reconciliation",
    "get_final_provider_a2a_scope_reconciliation",
]
