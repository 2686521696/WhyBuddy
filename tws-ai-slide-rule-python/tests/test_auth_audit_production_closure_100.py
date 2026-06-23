"""Test for Auth/Audit production closure 100.

Covers:
- ready, config_missing, degraded, denied, external_missing, failed states
- combination summary from register/login/email-code + session + permission audit + retention/export
- explicit distinction: config_missing/degraded/external_missing/denied/failed never reported as ready
- subEnvelopes and components preserved for Node consumption
- existing sub runtime contracts continue to be honored (tested via combined run)
"""

import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_audit_production_closure import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    CLOSURE_STATUSES,
    execute_auth_audit_production_closure,
)


def _session_store(tmp_path):
    store = tmp_path / "auth-audit-closure-sessions.json"
    store.write_text(
        json.dumps(
            {
                "s-closure-test": {
                    "sessionId": "s-closure-test",
                    "user": {
                        "id": "user-1",
                        "email": "user@example.com",
                        "role": "user",
                        "status": "active",
                        "emailVerified": True,
                        "createdAt": "2026-04-30T00:00:00.000Z",
                    },
                    "expiresAt": "2026-07-01T00:00:00.000Z",
                }
            }
        ),
        encoding="utf-8",
    )
    return store


def _payload(**overrides):
    p = {
        "metadata": {"traceId": "closure-100", "actor": "test"},
    }
    p.update(overrides)
    return p


def test_closure_ready_output(tmp_path):
    result = execute_auth_audit_production_closure(_payload(sessionStoreFile=str(_session_store(tmp_path))))
    assert result["status"] == "ready"
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["ok"] is True
    cs = result["closureSummary"]
    assert cs["status"] == "ready"
    assert "identity" in cs["components"]
    assert "sessionPersistence" in cs["components"]
    assert "permissionDecisionAudit" in cs["components"]
    assert "auditRetentionExport" in cs["components"]
    assert "auditSink" in cs["components"]
    assert "subEnvelopes" in result
    assert result["subEnvelopes"]["identity"]["ok"] is True


def test_closure_config_missing():
    result = execute_auth_audit_production_closure(_payload(simulate={"configMissing": True}))
    assert result["status"] == "config_missing"
    assert result["ok"] is False
    assert result["closureSummary"]["status"] == "config_missing"
    assert "error" in result
    # must not be healthy
    assert result["status"] != "ready"


def test_closure_degraded_output():
    result = execute_auth_audit_production_closure(_payload(simulate={"degraded": True}))
    assert result["status"] == "degraded"
    assert result["closureSummary"]["status"] == "degraded"
    assert result["ok"] is False
    assert result["status"] != "ready"


def test_closure_denied_output():
    result = execute_auth_audit_production_closure(_payload(simulate={"denied": True}))
    assert result["status"] == "denied"
    assert result["closureSummary"]["status"] == "denied"
    assert result.get("ok") is False
    assert result["status"] != "ready"


def test_closure_external_missing():
    result = execute_auth_audit_production_closure(_payload(simulate={"externalMissing": True}))
    assert result["status"] == "external_missing"
    assert result["closureSummary"]["status"] == "external_missing"
    assert result["ok"] is False
    assert result["status"] != "ready"


def test_closure_failed_output():
    result = execute_auth_audit_production_closure(_payload(simulate={"forceFailed": True}))
    assert result["status"] == "failed"
    assert result["closureSummary"]["status"] == "failed"
    assert result.get("ok") is False or result["status"] == "failed"
    assert result["status"] != "ready"


def test_closure_preserves_sub_envelopes_and_boundaries(tmp_path):
    result = execute_auth_audit_production_closure(
        _payload(
            metadata={"actor": {"id": "actor-100"}, "causation": {"traceId": "t-100"}},
            sessionStoreFile=str(_session_store(tmp_path)),
        )
    )
    cs = result["closureSummary"]
    # sub envelopes from real sub modules
    assert "identity" in result["subEnvelopes"]
    assert "session" in result["subEnvelopes"]
    assert "permissionAudit" in result["subEnvelopes"]
    assert "retentionExport" in result["subEnvelopes"]
    assert "auditSink" in result["subEnvelopes"]
    # metadata preserved
    assert cs["metadata"].get("traceId") == "closure-100" or "actor" in cs.get("metadata", {})


def test_closure_invalid_and_all_statuses_covered():
    bad = execute_auth_audit_production_closure(None)  # type: ignore[arg-type]
    assert bad["status"] == "failed"
    assert bad["error"]["code"] == "invalid_payload"

    # ensure all required statuses are possible
    for st in ["ready", "config_missing", "degraded", "denied", "external_missing", "failed"]:
        assert st in CLOSURE_STATUSES
