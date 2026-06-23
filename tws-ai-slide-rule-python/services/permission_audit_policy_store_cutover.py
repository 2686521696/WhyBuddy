"""Permission/Audit policy-store cutover decision 101 (Python advisory slice).

Python expresses narrow cutover readiness decisions for:
- policyStore (policy management/enforcement decision boundary only)
- auditStore (durable audit write decision only)
- externalAudit (external platform decision only; always node owned)

Statuses: ready | blocked | degraded | unsupported

Node retains ALL durable stores, external audit platform, route auth, rate limit, full enforcement.
Python decision envelope never replaces storage or audit platform.
Never treats memory as durable.
"""

from __future__ import annotations

from typing import Any, Dict

CONTRACT_VERSION = "permission-audit-policy-store-cutover.v1"
PROVENANCE = "python-permission-audit-policy-store-cutover"

CUTOVER_DECISIONS = ("ready", "blocked", "degraded", "unsupported")

NODE_BOUNDARIES = {
    "policyStoreOwner": "node",
    "auditStoreOwner": "node",
    "externalAuditPlatformOwner": "node",
    "durableStoreOwner": "node",
    "enforcementOwner": "node",
    "routeAuthOwner": "node",
    "retentionOwner": "node",
    "exportOwner": "node",
}


def decide_permission_audit_policy_store_cutover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return policy-store / audit durable boundary cutover decision.

    Supports simulate:
      - {"forceUnsupported": true} -> unsupported
      - {"block": true} -> blocked
      - {"degrade": true} -> degraded
      - {"area": "policyStore" | "auditStore" | "externalAudit"}
    Default: all advisory ready, but boundaries explicit node-owned.
    Never claims production durable store or external platform takeover.
    """
    if not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    area = _clean(payload.get("area")) or "all"
    if area not in {"policyStore", "auditStore", "externalAudit"}:
        area = "all"

    if simulate.get("forceUnsupported") or simulate.get("unsupported"):
        ps = "unsupported"
        aus = "unsupported"
        ext = "unsupported"
        reason = "unsupported-by-simulation"
        decision = "unsupported"
    elif simulate.get("block") or simulate.get("blocked"):
        ps = "blocked"
        aus = "blocked"
        ext = "blocked"
        reason = "blocked-by-simulation-or-boundary"
        decision = "blocked"
    elif simulate.get("degrade") or simulate.get("degraded"):
        ps = "degraded"
        aus = "degraded"
        ext = "degraded"
        reason = "degraded-by-simulation-or-boundary"
        decision = "degraded"
    else:
        if area == "policyStore":
            ps = "ready"
            aus = "unsupported"
            ext = "unsupported"
            reason = "policy-store-decision-only"
            decision = "ready"
        elif area == "auditStore":
            ps = "unsupported"
            aus = "ready"
            ext = "unsupported"
            reason = "audit-store-decision-only"
            decision = "ready"
        elif area == "externalAudit":
            ps = "unsupported"
            aus = "unsupported"
            ext = "ready"
            reason = "external-audit-decision-only"
            decision = "ready"
        else:
            ps = "ready"
            aus = "ready"
            ext = "ready"
            reason = "python-decision-envelope-available"
            decision = "ready"

    decisions = {
        "policyStore": ps,
        "auditStore": aus,
        "externalAudit": ext,
    }

    can_participate = {
        "policyStore": ps == "ready",
        "auditStore": aus == "ready",
        "externalAudit": ext == "ready",
    }

    result: Dict[str, Any] = {
        "decision": decision,
        "decisions": decisions,
        "canParticipate": can_participate,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "area": area,
        "boundaries": dict(NODE_BOUNDARIES),
        "runtime": {
            "owner": "python",
            "mode": "cutover_decision",
            "policyStoreOwner": "node",
            "auditStoreOwner": "node",
            "externalAuditPlatformOwner": "node",
            "durableStoreOwner": "node",
            "enforcementOwner": "node",
            "routeAuthOwner": "node",
        },
        "diagnostics": {
            "reason": reason,
            "nodeOwned": [
                "durableAuditStore",
                "externalAuditPlatform",
                "realPolicyStore",
                "enforcement",
                "routeAuth",
                "retention",
                "export",
            ],
            "pythonDecisionOnly": ["policyDecision", "auditStoreDecision", "externalAuditDecision"],
            "simulation": simulate or None,
        },
    }

    if decision in ("blocked", "unsupported"):
        result["ok"] = False
        if decision == "blocked":
            result["blocked"] = True
    else:
        result["ok"] = True

    if decision != "ready":
        result["productionTakeover"] = False

    return result


def _error_envelope(code: str, message: str) -> Dict[str, Any]:
    return {
        "decision": "unsupported",
        "ok": False,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "cutover_decision"},
        "decisions": {"policyStore": "unsupported", "auditStore": "unsupported", "externalAudit": "unsupported"},
        "canParticipate": {"policyStore": False, "auditStore": False, "externalAudit": False},
    }


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v or None
    return None
