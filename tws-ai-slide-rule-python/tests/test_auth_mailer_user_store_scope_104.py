"""Test for Auth mailer and user store scope 104.

Covers:
- Python classifies emailCodeMailer and userRepository as node-retained (no migration).
- mailerUserStoreScopeDecision is python-owned (thin scope decision slice only).
- productionTakeover never true.
- Includes reason and migrationDenominator with retained counts.
- Agrees with Node tests on ownership classification.
- Code-level evidence for retained; no real email or user data touched.
- Compatible with 103 boundary/ownership.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_mailer_user_store_scope import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    SCOPE_STATUSES,
    execute_auth_mailer_user_store_scope,
)
from services.auth_production_ownership_closure import decide_auth_production_ownership_closure


def _payload(**overrides):
    p = {"metadata": {"traceId": "mailer-user-store-104", "actor": "test"}}
    p.update(overrides)
    return p


def test_scope_default_reports_node_retained_and_python_decision():
    result = execute_auth_mailer_user_store_scope(_payload())
    assert result["status"] in ("ready", "python-owned")
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["ok"] is True
    assert result.get("productionTakeover") is False

    own = result["ownership"]
    assert own["emailCodeMailer"] == "node-retained"
    assert own["userRepository"] == "node-retained"
    assert own["mailerUserStoreScopeDecision"] == "python-owned"

    assert result["reason"]  # retained reason present
    denom = result["migrationDenominator"]
    assert denom["total"] == 3
    assert denom["nodeRetained"] == 2
    assert denom["pythonOwned"] == 1
    assert denom["externalOwned"] == 0

    assert result["boundaries"]["emailCodeMailerOwner"] == "node"
    assert result["boundaries"]["userRepositoryOwner"] == "node"
    assert "python-owned" in SCOPE_STATUSES


def test_scope_blocked_state():
    result = execute_auth_mailer_user_store_scope(_payload(simulate={"block": True}))
    assert result["status"] == "blocked"
    assert result["ok"] is False
    for v in result["ownership"].values():
        assert v == "blocked"


def test_scope_production_ownership_closure_reports_retained():
    res = decide_auth_production_ownership_closure(_payload())
    assert res.get("productionTakeover") is False
    assert res["ok"] is True
    own = res["ownership"]
    assert own["emailCodeMailer"] == "node-retained"
    assert own["userRepository"] == "node-retained"


def test_scope_never_takeover_and_preserves_retained():
    result = execute_auth_mailer_user_store_scope(_payload())
    assert result.get("productionTakeover") is not True
    assert result["ownership"]["emailCodeMailer"] != "python-owned"
    assert result["ownership"]["userRepository"] != "python-owned"
    assert result["ownership"]["mailerUserStoreScopeDecision"] == "python-owned"


def test_scope_reason_and_denominator_for_retained():
    result = execute_auth_mailer_user_store_scope(_payload())
    assert "node-retained" in result.get("reason", "")
    assert "not-worth-migrating" in result.get("reason", "") or "retained" in result.get("reason", "").lower()
    denom = result["migrationDenominator"]
    assert denom["nodeRetained"] >= 2
    assert "evidence" in result
    assert "codeSources" in result["evidence"]


def test_scope_all_statuses_and_contract():
    for st in ["ready", "node-retained", "python-owned", "out-of-scope", "skipped-live", "blocked"]:
        assert st in SCOPE_STATUSES

    bad = execute_auth_mailer_user_store_scope(None)  # type: ignore[arg-type]
    assert bad["status"] in ("blocked", "failed") or "error" in bad
