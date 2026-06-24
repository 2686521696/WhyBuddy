"""Test for Auth token issuance takeover 104.

Covers:
- Python returns token lifecycle decision with safe metadata only.
- Default formally retains tokenIssuance=node-retained.
- For issue/refresh/revoke: python-owned decision for bounded lifecycle slice.
- productionTakeover never true (actual issuance retained in Node).
- Blocked and error paths deterministic.
- Security-sensitive behavior (no secret leak) stays in contract; compatible with 103.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_token_issuance_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    TOKEN_LIFECYCLE_OPS,
    execute_auth_token_issuance_takeover,
)


def _payload(**overrides):
    p = {"metadata": {"traceId": "token-issuance-104", "actor": "test"}}
    p.update(overrides)
    return p


def test_service_shape_and_contract():
    result = execute_auth_token_issuance_takeover(_payload())
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["runtime"]["mode"] == "token_issuance_takeover"
    assert "ownership" in result
    assert "productionTakeover" in result
    assert "tokenIssuance" in result["ownership"]


def test_default_reports_node_retained_and_no_takeover():
    result = execute_auth_token_issuance_takeover(_payload())
    assert result["status"] == "node-retained"
    assert result["ownership"]["tokenIssuance"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["ok"] is False


def test_lifecycle_ops_report_python_owned_decision_only():
    for op in TOKEN_LIFECYCLE_OPS:
        result = execute_auth_token_issuance_takeover(_payload(operation=op))
        assert result["status"] == "python-owned"
        assert result["ownership"]["tokenIssuance"] == "python-owned"
        assert result["ownership"].get("operation") == op
        assert result["productionTakeover"] is False
        assert result["ok"] is True
        assert result.get("metadata", {}).get("traceId") == "token-issuance-104"


def test_blocked_state():
    result = execute_auth_token_issuance_takeover(_payload(simulate={"block": True}))
    assert result["status"] == "blocked"
    assert result["ok"] is False
    assert result["ownership"]["tokenIssuance"] == "blocked"
    assert result["productionTakeover"] is False


def test_force_failed_blocked():
    result = execute_auth_token_issuance_takeover(_payload(simulate={"forceFailed": True}))
    assert result["status"] == "blocked"
    assert result["ok"] is False


def test_invalid_payload_reports_blocked():
    bad = execute_auth_token_issuance_takeover(None)  # type: ignore[arg-type]
    assert "error" in bad or bad["status"] in ("blocked", "failed")


def test_never_claims_production_takeover_for_token_issuance():
    # default
    d1 = execute_auth_token_issuance_takeover(_payload())
    assert d1.get("productionTakeover") is not True
    # ops
    for op in TOKEN_LIFECYCLE_OPS:
        d2 = execute_auth_token_issuance_takeover(_payload(operation=op))
        assert d2.get("productionTakeover") is not True
        assert d2["ownership"]["tokenIssuance"] == "python-owned"
    # explicit block
    db = execute_auth_token_issuance_takeover(_payload(simulate={"block": True}))
    assert db.get("productionTakeover") is not True


def test_metadata_filters_sensitive_fields_and_returns_safe_only():
    """Covers negative case: sensitive keys (token/secret/password/cookie/hash/bearer and substr)
    must not appear in returned metadata; safe fields preserved. Deterministic.
    """
    bad_meta = {
        "traceId": "token-issuance-104",
        "actor": "test",
        "token": "eyJhbGciOi-fake",
        "secret": "supersecret1234567890",
        "password": "p@ssw0rd",
        "cookie": "sid=abc",
        "hash": "deadbeef" * 4,
        "bearer": "Bearer xyz",
        "nested": {
            "safeNote": "keep",
            "myToken": "should-strip",
            "deep": {"password": "inner", "trace": "t2"},
        },
        "longHashLike": "h" * 25,
    }
    result = execute_auth_token_issuance_takeover(_payload(metadata=bad_meta))
    m = result.get("metadata", {})

    # safe fields kept at top level
    assert m.get("traceId") == "token-issuance-104"
    assert m.get("actor") == "test"

    # top level sensitive absent
    for bad_key in ("token", "secret", "password", "cookie", "hash", "bearer", "myToken", "longHashLike"):
        assert bad_key not in m

    # nested sanitized
    nested = m.get("nested", {})
    assert nested.get("safeNote") == "keep"
    assert "myToken" not in nested
    assert "password" not in nested
    assert nested.get("deep", {}).get("trace") == "t2"
    assert "password" not in nested.get("deep", {})

    # also for python-owned path (with operation)
    for op in TOKEN_LIFECYCLE_OPS:
        r2 = execute_auth_token_issuance_takeover({"operation": op, "metadata": {"source": "test", "secret": "x", "ok": True}})
        mm = r2.get("metadata", {})
        assert "secret" not in mm
        assert mm.get("source") == "test"
        assert mm.get("ok") is True

    # retained path also safe
    r3 = execute_auth_token_issuance_takeover(_payload(metadata={"token": "no", "trace": "r"}))
    assert "token" not in r3.get("metadata", {})
    assert r3.get("metadata", {}).get("trace") == "r"

    # blocked path
    rb = execute_auth_token_issuance_takeover(_payload(simulate={"block": True}, metadata={"password": "p", "note": "b"}))
    assert "password" not in rb.get("metadata", {})
    assert rb.get("metadata", {}).get("note") == "b"
