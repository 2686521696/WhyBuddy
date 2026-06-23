"""Python tests for permission/audit policy-store cutover 101.

Covers Python decision envelopes for policyStore, auditStore, externalAudit.
Classifies ready / blocked / degraded / unsupported.
Node keeps durable store, external audit platform, route auth, retention/export/enforcement.
"""

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.permission_audit_policy_store_cutover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    CUTOVER_DECISIONS,
    NODE_BOUNDARIES,
    decide_permission_audit_policy_store_cutover,
)


def _base_payload(**overrides: Any) -> dict:
    base: dict[str, Any] = {
        "traceId": "perm-audit-cutover-101",
        "actor": {"id": "user-cutover", "role": "owner"},
    }
    base.update(overrides)
    return base


def test_default_is_ready_all_and_node_boundaries_preserved():
    result = decide_permission_audit_policy_store_cutover(_base_payload())
    assert result["decision"] == "ready"
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["decisions"] == {
        "policyStore": "ready",
        "auditStore": "ready",
        "externalAudit": "ready",
    }
    assert result["canParticipate"] == {
        "policyStore": True,
        "auditStore": True,
        "externalAudit": True,
    }
    assert result["ok"] is True
    assert result["runtime"]["owner"] == "python"
    assert result["runtime"]["durableStoreOwner"] == "node"
    assert result["runtime"]["externalAuditPlatformOwner"] == "node"
    assert result["runtime"]["routeAuthOwner"] == "node"
    assert result["boundaries"]["durableStoreOwner"] == "node"
    assert result["boundaries"]["externalAuditPlatformOwner"] == "node"
    assert result.get("productionTakeover") is not True


def test_simulate_unsupported_covers_all():
    result = decide_permission_audit_policy_store_cutover(
        _base_payload(simulate={"forceUnsupported": True})
    )
    assert result["decision"] == "unsupported"
    assert result["ok"] is False
    for v in result["decisions"].values():
        assert v == "unsupported"
    for v in result["canParticipate"].values():
        assert v is False


def test_simulate_blocked():
    result = decide_permission_audit_policy_store_cutover(
        _base_payload(simulate={"block": True})
    )
    assert result["decision"] == "blocked"
    assert result["ok"] is False
    assert result.get("blocked") is True
    assert all(v == "blocked" for v in result["decisions"].values())


def test_simulate_degraded():
    result = decide_permission_audit_policy_store_cutover(
        _base_payload(simulate={"degrade": True})
    )
    assert result["decision"] == "degraded"
    assert result["ok"] is True or result["ok"] is False  # degraded advisory
    assert all(v == "degraded" for v in result["decisions"].values())


def test_area_scopes():
    for area, key in [
        ("policyStore", "policyStore"),
        ("auditStore", "auditStore"),
        ("externalAudit", "externalAudit"),
    ]:
        result = decide_permission_audit_policy_store_cutover(_base_payload(area=area))
        assert result["area"] == area
        assert result["decision"] == "ready"
        assert result["decisions"][key] == "ready"
        for k, v in result["decisions"].items():
            if k != key:
                assert v == "unsupported"


def test_boundaries_never_flip_ownership():
    result = decide_permission_audit_policy_store_cutover(_base_payload())
    for k in ["durableStoreOwner", "externalAuditPlatformOwner", "enforcementOwner", "routeAuthOwner"]:
        assert result["boundaries"][k] == "node"
    assert "policyStoreOwner" in result["runtime"]
    assert result["runtime"]["policyStoreOwner"] == "node"


def test_all_classifications_exercised():
    states = set()
    for sim in [None, {"forceUnsupported": True}, {"block": True}, {"degrade": True}]:
        p = _base_payload()
        if sim:
            p["simulate"] = sim
        r = decide_permission_audit_policy_store_cutover(p)
        states.add(r["decision"])
    assert states >= {"ready", "unsupported", "blocked", "degraded"}


def test_cutover_decisions_and_boundaries_constants():
    assert "ready" in CUTOVER_DECISIONS
    assert "blocked" in CUTOVER_DECISIONS
    assert NODE_BOUNDARIES["durableStoreOwner"] == "node"
    assert NODE_BOUNDARIES["externalAuditPlatformOwner"] == "node"


def test_validation_error_non_object():
    result = decide_permission_audit_policy_store_cutover("not-dict")  # type: ignore[arg-type]
    assert result["ok"] is False
    assert result["decision"] == "unsupported"
    assert "payload" in (result.get("error", {}) or {}).get("message", "").lower() or result.get("error")
