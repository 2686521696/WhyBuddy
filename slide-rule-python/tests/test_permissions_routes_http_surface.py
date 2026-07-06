"""Contract tests for the /api/permissions HTTP surface over the permission_* services."""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.permissions import router  # noqa: E402


app = FastAPI()
app.include_router(router, prefix="/api/permissions")
client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"
HEADERS = {"X-Internal-Key": INTERNAL_KEY}


def _post(path, payload):
    return client.post(path, json=payload, headers=HEADERS)


def _check_request(effect="allow"):
    return {
        "agentId": "agent-1",
        "context": {"agentId": "agent-1"},
        "resourceType": "api",
        "action": "read",
        "policy": {
            "permissionMatrix": [
                {
                    "resourceType": "api",
                    "actions": ["read"],
                    "effect": effect,
                    "constraints": {},
                }
            ]
        },
    }


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------


def test_requires_internal_key():
    assert client.post("/api/permissions/check", json=_check_request()).status_code == 403
    assert (
        client.post(
            "/api/permissions/check",
            json=_check_request(),
            headers={"X-Internal-Key": "wrong"},
        ).status_code
        == 403
    )
    assert client.get("/api/permissions/__internal/policy-store-takeover").status_code == 403


# ---------------------------------------------------------------------------
# check runtime boundary
# ---------------------------------------------------------------------------


def test_check_allow_uses_python_runtime_source():
    response = _post("/api/permissions/check", _check_request("allow"))

    assert response.status_code == 200
    data = response.json()
    assert data["allowed"] is True
    assert data["decision"] == "allow"
    assert data["source"] == "python_runtime"
    assert data["contractVersion"] == "permission-check.v1"


def test_check_explicit_deny_is_never_allowed():
    response = _post("/api/permissions/check", _check_request("deny"))

    assert response.status_code == 200
    data = response.json()
    assert data["allowed"] is False
    assert data["decision"] == "deny"
    assert data["error"]["code"] == "explicit_deny"


def test_check_missing_context_returns_deny_envelope():
    response = _post("/api/permissions/check", {"agentId": "agent-1"})

    assert response.status_code == 200
    data = response.json()
    assert data["allowed"] is False
    assert data["error"]["code"] == "missing_context"


# ---------------------------------------------------------------------------
# audit hook
# ---------------------------------------------------------------------------


def test_audit_hook_records_allowed_decision():
    response = _post(
        "/api/permissions/audit-hook",
        {
            "checkResult": {
                "allowed": True,
                "decision": "allow",
                "resourceType": "api",
                "action": "read",
                "agentId": "agent-1",
            }
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["result"] == "allowed"
    assert data["actor"] == "agent-1"
    assert data["contractVersion"] == "permission-audit-hook.v1"


def test_audit_hook_invalid_check_result_is_error_envelope():
    response = _post("/api/permissions/audit-hook", {"checkResult": "nonsense"})

    assert response.status_code == 200
    data = response.json()
    assert data["result"] == "error"
    assert data["error"]["code"] == "invalid_check_result"


# ---------------------------------------------------------------------------
# rate limit runtime
# ---------------------------------------------------------------------------


def test_rate_limit_check_record_and_reset_flow():
    key = "agent-rl-http"
    _post("/api/permissions/rate-limit/reset", {"key": key})

    first = _post(
        "/api/permissions/rate-limit/check", {"key": key, "maxPerMinute": 1, "nowMs": 60_000}
    )
    assert first.status_code == 200
    assert first.json()["allowed"] is True

    record = _post("/api/permissions/rate-limit/record", {"key": key, "nowMs": 60_000})
    assert record.status_code == 200
    assert record.json()["ok"] is True

    second = _post(
        "/api/permissions/rate-limit/check", {"key": key, "maxPerMinute": 1, "nowMs": 60_001}
    )
    assert second.status_code == 200
    data = second.json()
    assert data["allowed"] is False
    assert data["reason"] == "rate_limit_exceeded"
    assert data["retryAfterMs"] > 0

    reset = _post("/api/permissions/rate-limit/reset", {"key": key})
    assert reset.status_code == 200
    third = _post(
        "/api/permissions/rate-limit/check", {"key": key, "maxPerMinute": 1, "nowMs": 60_002}
    )
    assert third.json()["allowed"] is True


def test_rate_limit_check_requires_key():
    response = _post("/api/permissions/rate-limit/check", {"maxPerMinute": 5})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_payload"


def test_rate_limit_invalid_limit_denies():
    response = _post(
        "/api/permissions/rate-limit/check", {"key": "k-bad", "maxPerMinute": 0, "nowMs": 1}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["allowed"] is False
    assert data["reason"] == "invalid_limit"


# ---------------------------------------------------------------------------
# policy decision slice + explicit management boundary
# ---------------------------------------------------------------------------


def test_policy_decision_denies_explicit_deny_first():
    response = _post(
        "/api/permissions/policy/decision",
        {
            "policy": {
                "deniedPermissions": [{"resourceType": "api", "action": "read"}],
                "customPermissions": [],
            },
            "request": {"resourceType": "api", "action": "read"},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["allowed"] is False
    assert data["decision"] == "deny"
    assert data["policyStoreOwner"] == "node"


def test_management_evaluate_is_explicit_node_owned_boundary():
    response = _post("/api/permissions/management/evaluate", {"operation": "role.create"})

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["status"] == "unsupported"
    assert data["error"]["code"] == "node_owned"
    assert data["domain"] == "role"


# ---------------------------------------------------------------------------
# internal decision surfaces
# ---------------------------------------------------------------------------


def test_internal_surfaces_answer_get_without_payload():
    for name in (
        "policy-store-cutover",
        "production-ownership-closure",
        "durable-store-boundary",
        "policy-store-takeover",
    ):
        response = client.get(f"/api/permissions/__internal/{name}", headers=HEADERS)
        assert response.status_code == 200, name
        assert "contractVersion" in response.json(), name


def test_internal_policy_store_takeover_keeps_node_retained_store():
    response = _post("/api/permissions/__internal/policy-store-takeover", {})

    data = response.json()
    assert data["ownership"]["policyStore"] == "node-retained"
    assert data["ownership"]["policyDecisionSlice"] == "python-owned"


def test_internal_durable_store_boundary_marks_external_platform():
    response = _post("/api/permissions/__internal/durable-store-boundary", {})

    data = response.json()
    assert data["ownership"]["externalAuditPlatform"] == "external-owned"
    assert data["ownership"]["durableDecision"] == "python-owned"


def test_routes_are_mounted_in_main_app():
    from app import app as main_app

    main_client = TestClient(main_app)
    check = main_client.post(
        "/api/permissions/check", json=_check_request("allow"), headers=HEADERS
    )
    assert check.status_code == 200
    assert check.json()["allowed"] is True

    boundary = main_client.get(
        "/api/permissions/__internal/durable-store-boundary", headers=HEADERS
    )
    assert boundary.status_code == 200
    assert boundary.json()["ownership"]["durableDecision"] == "python-owned"
