import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_session_persistence import (  # noqa: E402
    AUTH_SESSION_STORE_FILE_ENV,
    delete_auth_session_record,
    read_auth_session_record,
    write_auth_session_record,
)


VALID_USER = {
    "id": "user-1",
    "email": "user@example.com",
    "role": "user",
    "status": "active",
    "emailVerified": True,
    "createdAt": "2026-04-30T00:00:00.000Z",
}


# Frozen clock injected into reads so the test never depends on wall time;
# the fixture expiry below is in this clock's future.
FROZEN_NOW = "2026-06-22T12:00:00.000Z"


def _session(session_id: str = "session-1"):
    return {
        "sessionId": session_id,
        "tokenHash": "sha256-secret-token-hash",
        "user": VALID_USER,
        "expiresAt": "2026-07-01T00:00:00.000Z",
        "lastSeenAt": "2026-06-22T00:00:00.000Z",
        "createdAt": "2026-06-22T00:00:00.000Z",
    }


def test_write_read_and_delete_session_record_use_configured_store_without_leaking_secrets(tmp_path):
    store_file = tmp_path / "auth-sessions.json"

    written = write_auth_session_record(_session(), store_file=store_file)
    read = read_auth_session_record("session-1", store_file=store_file, now=FROZEN_NOW)
    deleted = delete_auth_session_record("session-1", store_file=store_file)
    missing_after_delete = read_auth_session_record("session-1", store_file=store_file, now=FROZEN_NOW)

    assert written == {"ok": True, "operation": "write", "sessionId": "session-1"}
    assert read == {
        "valid": True,
        "sessionId": "session-1",
        "user": VALID_USER,
    }
    assert "tokenHash" not in str(read)
    assert deleted == {"ok": True, "operation": "delete", "sessionId": "session-1"}
    assert missing_after_delete == {
        "valid": False,
        "error": "missing",
        "status": 401,
        "message": "Authentication required",
    }

    raw_store = json.loads(store_file.read_text(encoding="utf-8"))
    assert raw_store == []


def test_missing_store_configuration_is_diagnostic_and_not_authenticated(monkeypatch):
    monkeypatch.delenv(AUTH_SESSION_STORE_FILE_ENV, raising=False)

    result = read_auth_session_record("session-1")

    assert result["ok"] is False
    assert result["status"] == 503
    assert result["error"] == {
        "code": "auth_session_store_missing_config",
        "message": "Auth session persistence store is not configured.",
        "retryable": False,
    }
    assert result["message"] == "Auth session persistence is not configured."
    assert result.get("valid") is not True


def test_store_failure_is_diagnostic_and_not_authenticated(tmp_path):
    store_file = tmp_path / "auth-session-store-directory"
    store_file.mkdir()

    result = read_auth_session_record("session-1", store_file=store_file)

    assert result["ok"] is False
    assert result["status"] == 503
    assert result["error"]["code"] == "auth_session_store_failure"
    assert result["error"]["reason"] == "read_failed"
    assert result["error"]["retryable"] is True
    assert result["message"] == "Auth session persistence failed."
    assert result.get("valid") is not True
