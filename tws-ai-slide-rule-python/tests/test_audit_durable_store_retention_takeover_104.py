"""Tests for Audit durable store and retention takeover 104.

Covers:
- Python service classifies ownership for audit durable/retention.
- auditDurableStore and retention reported as node-retained.
- externalAuditPlatform external-owned.
- auditEvidenceSlice is the python-owned thin slice for classify/retain/export.
- productionTakeover never true.
- Can classify/store/export one safe audit evidence slice (synthetic only).
- Blocked/fallback paths covered.
- Node retains full durable and export safeguards.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.audit_durable_store_retention_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    TAKEOVER_STATUSES,
    execute_audit_durable_store_retention_takeover,
    classify_audit_evidence_slice,
)


def _payload(**overrides):
    p = {"metadata": {"traceId": "audit-durable-retention-104", "actor": "test"}}
    p.update(overrides)
    return p


def test_takeover_default_reports_node_retained_audit_durable_and_retention():
    result = execute_audit_durable_store_retention_takeover(_payload())
    assert result["status"] in ("ready", "python-owned")
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["ok"] is True
    assert result.get("productionTakeover") is False

    own = result["ownership"]
    assert own["auditDurableStore"] == "node-retained"
    assert own["retention"] == "node-retained"
    assert own["externalAuditPlatform"] == "external-owned"
    assert own["auditEvidenceSlice"] == "python-owned"

    assert result["boundaries"]["auditDurableStoreOwner"] == "node"
    assert result["boundaries"]["retentionOwner"] == "node"
    assert result["boundaries"]["externalAuditPlatformOwner"] == "external"
    assert result["boundaries"]["auditEvidenceSliceOwner"] == "python"
    assert "retainedResponsibilities" in result
    assert any("audit durable" in r or "retention" in r for r in result["retainedResponsibilities"])
    assert "node-retained" in TAKEOVER_STATUSES or "python-owned" in TAKEOVER_STATUSES


def test_takeover_blocked_state():
    result = execute_audit_durable_store_retention_takeover(_payload(simulate={"block": True}))
    assert result["status"] == "blocked"
    assert result["ok"] is False
    assert result.get("productionTakeover") is False
    for v in result["ownership"].values():
        assert v == "blocked"


def test_takeover_never_claims_durable_or_external_for_python():
    result = execute_audit_durable_store_retention_takeover(_payload())
    assert result.get("productionTakeover") is not True
    assert result["ownership"]["auditDurableStore"] == "node-retained"
    assert result["ownership"]["retention"] == "node-retained"
    assert result["ownership"]["externalAuditPlatform"] == "external-owned"
    assert result["ownership"]["auditEvidenceSlice"] == "python-owned"


def test_takeover_area_scoped_audit_durable_and_retention():
    for area in ["auditDurableStore", "retention"]:
        res = execute_audit_durable_store_retention_takeover(_payload(simulate={"area": area}))
        assert res["ownership"][area] == "node-retained"
        assert res["ownership"]["auditEvidenceSlice"] == "python-owned"
        assert res.get("productionTakeover") is False


def test_classify_safe_audit_evidence_slice_retains():
    res = classify_audit_evidence_slice(
        {
            "operation": "retain",
            "evidence": {"eventId": "slice-ev-1", "eventType": "AUDIT_QUERY"},
        }
    )
    assert res["ok"] is True
    assert res["retained"] is True
    assert res.get("productionTakeover") is False
    assert res["evidence"]["eventId"] == "slice-ev-1"
    assert "retention" in res


def test_classify_safe_audit_evidence_slice_exports():
    res = classify_audit_evidence_slice(
        {
            "operation": "export",
            "evidence": {"eventId": "slice-ev-2"},
        }
    )
    assert res["ok"] is True
    assert res["exported"] is True
    assert res.get("productionTakeover") is False
    assert res["manifest"]["externalEmit"] is False
    assert "slice-ev-2" in res["manifest"]["eventIds"]


def test_classify_safe_audit_evidence_slice_denied_fallback():
    res = classify_audit_evidence_slice(
        {"simulate": {"denied": True}, "evidence": {"eventId": "slice-ev-3"}}
    )
    assert res["ok"] is False
    assert res["status"] == "denied"
    assert res.get("productionTakeover") is False


def test_classify_and_takeover_contract_and_fallback():
    for st in TAKEOVER_STATUSES:
        assert st in TAKEOVER_STATUSES

    bad = execute_audit_durable_store_retention_takeover(None)  # type: ignore[arg-type]
    assert bad["status"] in ("blocked", "failed") or "error" in bad
    assert bad["ok"] is False
    assert bad.get("productionTakeover") is False

    # slice also degrades without claiming takeover
    bad_slice = classify_audit_evidence_slice({"simulate": {"error": True}})
    assert bad_slice["ok"] is False
    assert bad_slice.get("productionTakeover") is False
