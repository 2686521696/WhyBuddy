"""Contract tests for the /api/audit HTTP surface over the audit_* services."""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.audit import router  # noqa: E402


app = FastAPI()
app.include_router(router, prefix="/api/audit")
client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"
HEADERS = {"X-Internal-Key": INTERNAL_KEY}


def _post(path, payload):
    return client.post(path, json=payload, headers=HEADERS)


def _event(event_id="ae-http-1"):
    return {
        "eventId": event_id,
        "eventType": "AGENT_EXECUTED",
        "timestamp": 1710000000000,
        "actor": {"type": "agent", "id": "agent-1"},
        "action": "execute_task",
        "resource": {"type": "mission", "id": "mission-1"},
        "result": "success",
        "context": {"sessionId": "sess-1", "requestId": "req-1"},
        "metadata": {"capabilityId": "audit.event"},
    }


def _chain_entry(event_id="ae-http-export", timestamp=1710000000000):
    return {
        "entryId": f"entry-{event_id}",
        "sequenceNumber": 7,
        "eventId": event_id,
        "event": {
            "eventId": event_id,
            "eventType": "AUDIT_EXPORT",
            "timestamp": timestamp,
            "actor": {"type": "system", "id": "audit"},
            "action": "audit.export.json",
            "resource": {"type": "audit", "id": "audit-log"},
            "result": "success",
            "context": {"requestId": "req-1"},
            "metadata": {"capabilityId": "audit.retention-export"},
            "lineageId": "lineage-audit-1",
        },
        "previousHash": "prev-hash",
        "currentHash": "curr-hash",
        "nonce": "nonce-1",
        "timestamp": {"system": timestamp},
        "signature": "sig-1",
    }


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------


def test_requires_internal_key():
    assert client.post("/api/audit/sink", json={}).status_code == 403
    assert (
        client.post("/api/audit/sink", json={}, headers={"X-Internal-Key": "wrong"}).status_code
        == 403
    )
    assert (
        client.get("/api/audit/__internal/durable-store-retention-takeover").status_code == 403
    )


# ---------------------------------------------------------------------------
# production sink
# ---------------------------------------------------------------------------


def test_sink_write_success_contract():
    response = _post(
        "/api/audit/sink",
        {
            "sink": {"kind": "node-audit-store", "configured": True, "storeId": "local-audit"},
            "event": _event(),
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["status"] == "written"
    assert data["runtime"] == "python-audit-production-sink"
    assert data["write"] == {"attempted": True, "stored": True, "eventId": "ae-http-1"}
    assert data["provenance"]["externalAuditPlatform"] is False


def test_sink_missing_config_is_diagnostic_not_written():
    response = _post(
        "/api/audit/sink",
        {"sink": {"kind": "node-audit-store", "configured": False}, "event": _event()},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["status"] == "misconfigured"
    assert data["write"]["stored"] is False
    assert data["error"] is not None


def test_sink_invalid_payload_is_400_error_contract():
    response = _post("/api/audit/sink", {"sink": {}, "event": {}})

    assert response.status_code == 400
    data = response.json()
    assert data["ok"] is False
    assert data["status"] == "invalid_payload"
    assert data["error"]["code"] == "invalid_payload"


# ---------------------------------------------------------------------------
# retention / export runtime
# ---------------------------------------------------------------------------


def test_retention_export_export_operation_returns_manifest():
    response = _post(
        "/api/audit/retention-export",
        {
            "operation": "export",
            "export": {"format": "json", "entries": [_chain_entry()]},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["operation"] == "export"
    assert data["status"] == "exported"
    assert data["export"]["entryCount"] == 1


def test_retention_export_retention_decision_keep():
    response = _post(
        "/api/audit/retention-export",
        {
            "operation": "retention",
            "scenario": "retained",
            "entries": [_chain_entry("ae-keep")],
            "retention": {
                "policy": {
                    "severity": "INFO",
                    "retentionDays": 365,
                    "archiveAfterDays": 90,
                    "deleteAfterDays": 365,
                },
                "entry": _chain_entry("ae-keep"),
                "now": 1710000000000,
            },
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["status"] == "retained"
    assert data["retention"]["decision"] == "keep"


def test_retention_export_requires_entries_400():
    response = _post("/api/audit/retention-export", {"operation": "export"})

    assert response.status_code == 400
    data = response.json()
    assert data["ok"] is False
    assert data["error"]["code"] == "invalid_payload"


# ---------------------------------------------------------------------------
# evidence slice + durable store takeover boundary
# ---------------------------------------------------------------------------


def test_evidence_classify_export_manifest_has_no_external_emit():
    response = _post(
        "/api/audit/evidence/classify",
        {"operation": "export", "evidence": {"eventId": "ev-http-1"}},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["status"] == "exported"
    assert data["manifest"]["externalEmit"] is False
    assert data["productionTakeover"] is False


def test_evidence_classify_denied_is_not_ok():
    response = _post(
        "/api/audit/evidence/classify",
        {"operation": "classify", "simulate": {"block": True}},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["status"] == "denied"


def test_internal_durable_store_retention_takeover_get_and_post():
    get_response = client.get(
        "/api/audit/__internal/durable-store-retention-takeover", headers=HEADERS
    )
    assert get_response.status_code == 200
    data = get_response.json()
    assert data["ownership"]["auditDurableStore"] == "node-retained"
    assert data["ownership"]["auditEvidenceSlice"] == "python-owned"

    post_response = _post(
        "/api/audit/__internal/durable-store-retention-takeover",
        {"simulate": {"block": True}},
    )
    assert post_response.status_code == 200
    assert post_response.json()["status"] == "blocked"


def test_routes_are_mounted_in_main_app():
    from app import app as main_app

    main_client = TestClient(main_app)
    sink = main_client.post(
        "/api/audit/sink",
        json={
            "sink": {"kind": "node-audit-store", "configured": True, "storeId": "local-audit"},
            "event": _event("ae-mount-1"),
        },
        headers=HEADERS,
    )
    assert sink.status_code == 200
    assert sink.json()["status"] == "written"

    takeover = main_client.get(
        "/api/audit/__internal/durable-store-retention-takeover", headers=HEADERS
    )
    assert takeover.status_code == 200
    assert takeover.json()["ownership"]["auditEvidenceSlice"] == "python-owned"
