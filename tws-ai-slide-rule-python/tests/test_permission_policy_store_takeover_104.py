"""Tests for Permission policy store takeover 104.

Covers:
- Python service returns policy ownership classification.
- One deterministic policy decision (computed from input policy data, deny-first).
- policyStore reported as node-retained; decision slice as python-owned.
- productionTakeover never true.
- Retained responsibilities are named explicitly.
- Blocked and fallback paths.
- Does not count allow/deny as durable store takeover (decision is slice only).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.permission_policy_store_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    TAKEOVER_STATUSES,
    decide_permission_policy_store_takeover,
    compute_deterministic_policy_decision,
)


def _payload(**overrides):
    p = {"metadata": {"traceId": "perm-policy-store-104", "actor": "test"}}
    p.update(overrides)
    return p


def test_takeover_default_reports_node_retained_policy_store_and_python_slice():
    result = decide_permission_policy_store_takeover(_payload())
    assert result["status"] in ("ready", "python-owned")
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["ok"] is True
    assert result.get("productionTakeover") is False

    own = result["ownership"]
    assert own["policyStore"] == "node-retained"
    assert own["policyDecisionSlice"] == "python-owned"
    assert own["durablePolicyRead"] == "node-retained"

    assert result["boundaries"]["policyStoreOwner"] == "node"
    assert result["boundaries"]["policyDecisionSliceOwner"] == "python"
    assert "retainedResponsibilities" in result
    assert any("policyStore" in r or "CRUD" in r or "durable" in r for r in result["retainedResponsibilities"])
    assert "node-retained" in TAKEOVER_STATUSES or "python-owned" in TAKEOVER_STATUSES


def test_takeover_blocked_state():
    result = decide_permission_policy_store_takeover(_payload(simulate={"block": True}))
    assert result["status"] == "blocked"
    assert result["ok"] is False
    assert result.get("productionTakeover") is False
    for v in result["ownership"].values():
        assert v == "blocked"


def test_deterministic_policy_decision_allow_path():
    policy = {
        "customPermissions": [
            {"resourceType": "filesystem", "action": "read", "effect": "allow", "constraints": {}}
        ],
        "deniedPermissions": [],
    }
    req = {"resourceType": "filesystem", "action": "read"}
    res = compute_deterministic_policy_decision({"policy": policy, "request": req})
    assert res["ok"] is True
    assert res["allowed"] is True
    assert res["decision"] == "allow"
    assert res["contractVersion"] == CONTRACT_VERSION
    assert res.get("productionTakeover") is False
    assert res["policyStoreOwner"] == "node"
    assert res["ownership"] == "python-owned"
    # not a mock; depends on input custom allow
    assert "custom" in res.get("reason", "").lower() or "allow" in res.get("reason", "").lower()


def test_deterministic_policy_decision_deny_explicit_and_no_allow_fallback():
    policy = {
        "customPermissions": [],
        "deniedPermissions": [
            {"resourceType": "api", "action": "write", "effect": "deny", "constraints": {}}
        ],
    }
    # explicit deny
    res_deny = compute_deterministic_policy_decision({
        "policy": policy,
        "request": {"resourceType": "api", "action": "write"}
    })
    assert res_deny["allowed"] is False
    assert res_deny["decision"] == "deny"
    assert "explicit deny" in res_deny.get("reason", "").lower()

    # no allow => fallback deny
    res_fallback = compute_deterministic_policy_decision({
        "policy": {"customPermissions": [], "deniedPermissions": []},
        "request": {"resourceType": "filesystem", "action": "delete"}
    })
    assert res_fallback["allowed"] is False
    assert res_fallback["decision"] == "deny"
    assert res_fallback.get("productionTakeover") is False


def test_takeover_never_reports_production_takeover_for_policy_store():
    result = decide_permission_policy_store_takeover(_payload())
    assert result.get("productionTakeover") is not True
    assert result["ownership"]["policyStore"] == "node-retained"
    assert result["ownership"]["policyDecisionSlice"] != "node-retained" or result["ownership"]["policyDecisionSlice"] == "python-owned"


def test_deterministic_decision_distinguishes_and_does_not_fake_durable():
    # decision reports policyStoreOwner node, slice python; never claims store ownership
    res = compute_deterministic_policy_decision({
        "policy": {"customPermissions": [{"resourceType": "mcp_tool", "action": "call", "effect": "allow", "constraints": {}}], "deniedPermissions": []},
        "request": {"resourceType": "mcp_tool", "action": "call"}
    })
    assert res["allowed"] is True
    assert res["policyStoreOwner"] == "node"
    assert res.get("ownership") == "python-owned"
    # decision slice only
    assert res.get("productionTakeover") is False


def test_takeover_area_scoped_and_all_statuses():
    for st in ["policyStore", "policyDecisionSlice"]:
        res = decide_permission_policy_store_takeover(_payload(area=st))
        assert res.get("productionTakeover") is False
        if st == "policyStore":
            assert res["ownership"].get(st) == "node-retained"
        else:
            assert res["ownership"].get(st) == "python-owned"

    bad = decide_permission_policy_store_takeover(None)  # type: ignore[arg-type]
    assert bad["status"] in ("blocked", "failed") or "error" in bad or bad.get("ok") is False

    for s in TAKEOVER_STATUSES:
        assert isinstance(s, str)


def test_retained_responsibilities_are_named():
    result = decide_permission_policy_store_takeover(_payload())
    retained = result.get("retainedResponsibilities") or []
    # must name retained policy store items
    joined = " ".join(retained).lower()
    assert "policyStore" in joined or "crud" in joined or "version" in joined or "durable" in joined
