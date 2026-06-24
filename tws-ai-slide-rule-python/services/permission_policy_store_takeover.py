"""Permission policy store takeover 104 (bounded Python decision/read slice).

Python provides narrow policy ownership classification + one deterministic
policy decision/read slice.

- policyStore and durable responsibilities remain node-retained (per 103).
- policyDecisionSlice / policyReadSlice: python-owned (thin advisory decision only).
- One deterministic policy decision is computed from caller-supplied policy
  data (never from durable store; never a hardcoded mock).
- Retained policy store responsibilities are explicitly named.
- productionTakeover remains false; no durable store is taken over.
- Does not loosen permissions or remove fallbacks.
"""

from __future__ import annotations

from typing import Any, Dict, List

CONTRACT_VERSION = "permission-policy-store-takeover.v1"
PROVENANCE = "python-permission-policy-store-takeover-104"

TAKEOVER_STATUSES = ("ready", "python-owned", "node-retained", "external-owned", "out-of-scope", "blocked", "skipped-live")

PermissionPolicyStoreTakeoverStatus = str  # Literal would require import


def _is_record(v: Any) -> bool:
    return isinstance(v, dict)


def _clean_str(v: Any, default: str = "") -> str:
    if v is None:
        return default
    s = str(v).strip()
    return s or default


def _error_envelope(status: str, code: str, message: str) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "policy_store_takeover_slice"},
        "ownership": {
            "policyStore": "node-retained",
            "policyDecisionSlice": "blocked",
            "durablePolicyRead": "node-retained",
        },
        "productionTakeover": False,
    }


def _success_envelope(
    status: str,
    ownership: Dict[str, str],
    extra: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    res: Dict[str, Any] = {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status in ("ready", "python-owned"),
        "runtime": {"owner": "python", "mode": "policy_store_takeover_slice"},
        "ownership": ownership,
        "productionTakeover": False,
    }
    if extra:
        res.update(extra)
    return res


def decide_permission_policy_store_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return policy store takeover ownership classification.

    Default:
      - policyStore: "node-retained" (durable CRUD, versioning, retention)
      - policyDecisionSlice: "python-owned" (thin read/decision slice)
      - durablePolicyRead: "node-retained"

    simulate supports:
      - {"block": true} -> blocked
      - {"area": "policyStore" | "policyDecisionSlice" }
      - force retained
    """
    if payload is None or not _is_record(payload):
        return _error_envelope("blocked", "invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if _is_record(payload) and _is_record(payload.get("simulate")) else {}
    area = _clean_str((payload or {}).get("area") or (payload or {}).get("op") or "all")

    ownership: Dict[str, str] = {
        "policyStore": "node-retained",
        "policyDecisionSlice": "python-owned",
        "durablePolicyRead": "node-retained",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(ownership.keys()):
            ownership[k] = "node-retained"
    if simulate.get("block") or simulate.get("blocked"):
        for k in list(ownership.keys()):
            ownership[k] = "blocked"
        return _success_envelope("blocked", ownership)

    if area == "policyStore" or area == "durablePolicyRead":
        # keep as node-retained
        pass
    elif area == "policyDecisionSlice":
        ownership["policyDecisionSlice"] = "python-owned"
    elif area not in ("all", ""):
        ownership = "out-of-scope"  # type: ignore[assignment]

    overall = "python-owned" if any(v == "python-owned" for v in (ownership.values() if isinstance(ownership, dict) else [])) else "ready"
    if isinstance(ownership, dict) and any(v == "blocked" for v in ownership.values()):
        overall = "blocked"

    extra: Dict[str, Any] = {
        "boundaries": {
            "policyStoreOwner": "node",
            "policyDecisionSliceOwner": "python",
            "durablePolicyReadOwner": "node",
        },
        "retainedResponsibilities": [
            "policyStore CRUD and versioning",
            "durable policy persistence and history",
            "effective permission resolution for enforcement",
            "role association and organization scoping",
        ],
    }
    if isinstance(ownership, dict) and area == "all":
        extra["areas"] = dict(ownership)

    result = _success_envelope(overall, ownership if isinstance(ownership, dict) else {"policyStore": "node-retained"}, extra)
    result["area"] = area if area else "all"
    result["reason"] = "node-retained policyStore; python thin decision slice only"
    result["fallback"] = "node"
    return result


def compute_deterministic_policy_decision(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Execute one deterministic policy decision/read slice.

    Input payload shape (example):
      {
        "policy": {
          "customPermissions": [...],
          "deniedPermissions": [...],
          "assignedRoles": [...]
        },
        "request": { "resourceType": "...", "action": "..." }
      }

    Logic: deny-first on explicit denies, then custom allow, simple deterministic.
    Returns contract-shaped decision. Never hardcodes allow/deny independent of input.
    Does not own or read from durable policyStore.
    """
    if payload is not None and not _is_record(payload):
        return {
            "ok": False,
            "error": "invalid_payload",
            "allowed": False,
            "decision": "deny",
            "reason": "invalid payload",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "ownership": "node-retained",
            "productionTakeover": False,
        }

    policy = (payload or {}).get("policy") or {}
    req = (payload or {}).get("request") or {}
    resource_type = _clean_str(req.get("resourceType") or (payload or {}).get("resourceType"))
    action = _clean_str(req.get("action") or (payload or {}).get("action"))

    # Extract denied keys
    denied_perms: List[Dict[str, Any]] = policy.get("deniedPermissions") or []
    denied_keys: set[str] = set()
    for p in denied_perms:
        if _is_record(p):
            rt = _clean_str(p.get("resourceType"))
            ac = _clean_str(p.get("action"))
            if rt and ac:
                denied_keys.add(f"{rt}:{ac}")

    # Check explicit deny first (deterministic)
    if resource_type and action:
        if f"{resource_type}:{action}" in denied_keys:
            return {
                "ok": True,
                "allowed": False,
                "decision": "deny",
                "reason": f"Denied by explicit deny rule for {resource_type}:{action}",
                "matchedRule": {"resourceType": resource_type, "action": action, "effect": "deny"},
                "contractVersion": CONTRACT_VERSION,
                "provenance": PROVENANCE,
                "source": "python_runtime",
                "policyStoreOwner": "node",
                "ownership": "python-owned",
                "productionTakeover": False,
            }

    # Then custom permissions allow
    custom: List[Dict[str, Any]] = policy.get("customPermissions") or []
    for p in custom:
        if _is_record(p) and p.get("effect") == "allow":
            rt = _clean_str(p.get("resourceType"))
            ac = _clean_str(p.get("action"))
            if rt == resource_type and ac == action:
                return {
                    "ok": True,
                    "allowed": True,
                    "decision": "allow",
                    "reason": f"Allowed by custom permission for {resource_type}:{action}",
                    "matchedRule": {"resourceType": resource_type, "action": action, "effect": "allow"},
                    "contractVersion": CONTRACT_VERSION,
                    "provenance": PROVENANCE,
                    "source": "python_runtime",
                    "policyStoreOwner": "node",
                    "ownership": "python-owned",
                    "productionTakeover": False,
                }

    # Fallback deny (no matching allow in slice)
    return {
        "ok": True,
        "allowed": False,
        "decision": "deny",
        "reason": f"No allow rule found for {resource_type}:{action}" if resource_type and action else "missing context for decision",
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "source": "python_runtime",
        "policyStoreOwner": "node",
        "ownership": "python-owned",
        "productionTakeover": False,
    }


# aliases
get_permission_policy_store_takeover = decide_permission_policy_store_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "TAKEOVER_STATUSES",
    "decide_permission_policy_store_takeover",
    "get_permission_policy_store_takeover",
    "compute_deterministic_policy_decision",
]
