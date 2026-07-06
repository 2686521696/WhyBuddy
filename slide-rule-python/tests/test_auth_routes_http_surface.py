"""Contract tests for the /api/auth HTTP surface over the auth_* takeover services."""

import json
import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.auth import router  # noqa: E402


app = FastAPI()
app.include_router(router, prefix="/api/auth")
client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"
HEADERS = {"X-Internal-Key": INTERNAL_KEY}

VALID_USER = {
    "id": "user-1",
    "email": "user@example.com",
    "role": "user",
    "status": "active",
    "emailVerified": True,
    "createdAt": "2026-04-30T00:00:00.000Z",
}


def _post(path, payload):
    return client.post(path, json=payload, headers=HEADERS)


# ---------------------------------------------------------------------------
# auth: 403 without / with wrong internal key
# ---------------------------------------------------------------------------


def test_requires_internal_key():
    assert client.post("/api/auth/login", json={}).status_code == 403
    assert (
        client.post(
            "/api/auth/login", json={}, headers={"X-Internal-Key": "wrong"}
        ).status_code
        == 403
    )
    assert client.get("/api/auth/__internal/auth-audit-closure").status_code == 403


# ---------------------------------------------------------------------------
# identity endpoints
# ---------------------------------------------------------------------------


def test_register_returns_201_with_identity_envelope():
    response = _post(
        "/api/auth/register", {"email": "new-user@example.com", "password": "password123"}
    )

    assert response.status_code == 201
    data = response.json()
    assert data["ok"] is True
    assert data["operation"] == "register"
    assert data["state"] == "registered"
    assert data["user"]["email"] == "new-user@example.com"
    assert "password" not in data["user"]
    assert "passwordHash" not in data["user"]


def test_register_rejects_short_password_with_401_envelope():
    response = _post("/api/auth/register", {"email": "new-user@example.com", "password": "short"})

    assert response.status_code == 401
    data = response.json()
    assert data["ok"] is False
    assert data["error"] == "invalid"


def test_login_success_reports_session_issued():
    response = _post(
        "/api/auth/login", {"email": "user@example.com", "password": "password123"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["operation"] == "login"
    assert data["sessionIssued"] is True
    assert data["user"]["id"] == "user-1"


def test_login_invalid_credentials_maps_to_401():
    response = _post("/api/auth/login", {"email": "user@example.com", "password": "wrong"})

    assert response.status_code == 401
    data = response.json()
    assert data["ok"] is False
    assert data["error"] == "invalid_credentials"
    assert data["message"] == "邮箱或密码错误"


def test_email_code_login_valid_and_expired_code():
    ok = _post("/api/auth/email-code/login", {"email": "user@example.com", "code": "123456"})
    assert ok.status_code == 200
    assert ok.json()["ok"] is True
    assert ok.json()["operation"] == "verify_email_code"

    expired = _post("/api/auth/email-code/login", {"email": "user@example.com", "code": "000000"})
    assert expired.status_code == 401
    assert expired.json()["error"] == "expired_code"


def test_identity_execute_bridge_returns_envelope_at_200():
    response = _post(
        "/api/auth/identity/execute",
        {"operation": "login", "email": "user@example.com", "password": "wrong"},
    )

    # bridge endpoint keeps HTTP 200; Node maps envelope.status itself
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["status"] == 401


# ---------------------------------------------------------------------------
# session runtime boundary
# ---------------------------------------------------------------------------


def test_session_runtime_write_read_refresh_logout(tmp_path, monkeypatch):
    store = tmp_path / "auth-sessions.json"
    monkeypatch.setenv("AUTH_SESSION_STORE_FILE", str(store))

    session = {
        "sessionId": "sess-http-1",
        "user": VALID_USER,
        "expiresAt": "2027-01-01T00:00:00.000Z",
    }

    write = _post("/api/auth/session/write", {"session": session})
    assert write.status_code == 200
    assert write.json() == {"ok": True, "operation": "write", "sessionId": "sess-http-1"}
    assert json.loads(store.read_text(encoding="utf-8"))  # persisted

    read = _post("/api/auth/session/read", {"sessionId": "sess-http-1"})
    assert read.status_code == 200
    assert read.json() == {"valid": True, "sessionId": "sess-http-1", "user": VALID_USER}

    refresh = _post(
        "/api/auth/session/refresh",
        {"sessionId": "sess-http-1", "expiresAt": "2027-06-01T00:00:00.000Z"},
    )
    assert refresh.status_code == 200
    assert refresh.json()["state"] == "refreshed"

    logout = _post("/api/auth/session/logout", {"sessionId": "sess-http-1"})
    assert logout.status_code == 200
    assert logout.json()["state"] == "logged_out"

    # revoked session is invalid on read (mirrors Node 401 semantics)
    read_after = _post("/api/auth/session/read", {"sessionId": "sess-http-1"})
    assert read_after.status_code == 401
    assert read_after.json()["error"] == "invalid"


def test_session_read_missing_session_is_401(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_SESSION_STORE_FILE", str(tmp_path / "s.json"))
    response = _post("/api/auth/session/read", {"sessionId": "missing"})

    assert response.status_code == 401
    data = response.json()
    assert data["valid"] is False
    assert data["error"] == "missing"


def test_session_store_missing_config_is_503(monkeypatch):
    monkeypatch.delenv("AUTH_SESSION_STORE_FILE", raising=False)
    response = _post("/api/auth/session/read", {"sessionId": "sess-http-1"})

    assert response.status_code == 503
    data = response.json()
    assert data["ok"] is False
    assert data["error"]["code"] == "auth_session_store_missing_config"


# ---------------------------------------------------------------------------
# internal closure / takeover surfaces (Node __internal consumption)
# ---------------------------------------------------------------------------


def test_internal_auth_audit_closure_post_with_metadata():
    response = _post(
        "/api/auth/__internal/auth-audit-closure", {"metadata": {"source": "node-consume"}}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["contractVersion"] == "auth-audit-production-closure.v1"
    assert "closureSummary" in data


def test_internal_surfaces_answer_get_without_payload():
    expectations = {
        "auth-token-mailer-session-cutover": "auth-token-mailer-session-cutover.v1",
        "auth-session-token-boundary": "auth-session-token-boundary.v1",
        "auth-production-ownership-closure": "auth.production-ownership-closure.v1",
        "auth-session-repository-takeover": "auth-session-repository-takeover.v1",
        "auth-token-issuance-takeover": "auth-token-issuance-takeover.v1",
        "auth-mailer-user-store-scope": "auth-mailer-user-store-scope.v1",
    }
    for name, contract_version in expectations.items():
        response = client.get(f"/api/auth/__internal/{name}", headers=HEADERS)
        assert response.status_code == 200, name
        assert response.json()["contractVersion"] == contract_version, name


def test_internal_mailer_user_store_scope_keeps_node_retained_ownership():
    response = _post("/api/auth/__internal/auth-mailer-user-store-scope", {})

    data = response.json()
    assert data["ownership"]["emailCodeMailer"] == "node-retained"
    assert data["ownership"]["userRepository"] == "node-retained"
    assert data["productionTakeover"] is False


def test_routes_are_mounted_in_main_app():
    from app import app as main_app

    main_client = TestClient(main_app)
    login = main_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "password123"},
        headers=HEADERS,
    )
    assert login.status_code == 200
    assert login.json()["ok"] is True

    closure = main_client.get("/api/auth/__internal/auth-audit-closure", headers=HEADERS)
    assert closure.status_code == 200
    assert closure.json()["contractVersion"] == "auth-audit-production-closure.v1"
