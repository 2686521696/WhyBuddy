import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_identity_runtime import (  # noqa: E402
    TEST_EXPIRED_CODE,
    TEST_VALID_CODE,
    TEST_VALID_EMAIL,
    TEST_VALID_PASSWORD,
    execute_auth_identity_runtime_boundary,
    login_identity,
    register_identity,
    verify_email_code_identity,
)


VALID_USER = {
    "id": "user-1",
    "email": "user@example.com",
    "role": "user",
    "status": "active",
    "emailVerified": True,
    "createdAt": "2026-04-30T00:00:00.000Z",
}


def test_register_success_returns_registered_envelope():
    result = execute_auth_identity_runtime_boundary(
        {"operation": "register", "email": "new@example.com", "password": "abcdefgh"}
    )
    assert result["ok"] is True
    assert result["operation"] == "register"
    assert result["state"] == "registered"
    assert "user" in result
    assert result["user"]["email"] == "new@example.com"
    assert result.get("sessionIssued") is not True  # register does not auto issue in this boundary


def test_login_success_returns_authenticated_and_session_issued():
    result = execute_auth_identity_runtime_boundary(
        {"operation": "login", "email": TEST_VALID_EMAIL, "password": TEST_VALID_PASSWORD}
    )
    assert result == {
        "ok": True,
        "operation": "login",
        "state": "authenticated",
        "user": VALID_USER,
        "sessionIssued": True,
    }
    assert result.get("valid") is not False


def test_login_invalid_credentials_returns_denied_without_auth():
    result = login_identity({"email": TEST_VALID_EMAIL, "password": "wrongpass"})
    assert result["ok"] is False
    assert result["error"] == "invalid_credentials"
    assert result["status"] == 401
    assert result.get("valid") is not True
    assert "sessionIssued" not in result or result.get("sessionIssued") is not True


def test_email_code_verify_success_issues_session():
    result = execute_auth_identity_runtime_boundary(
        {"operation": "verify_email_code", "email": TEST_VALID_EMAIL, "code": TEST_VALID_CODE}
    )
    assert result["ok"] is True
    assert result["operation"] == "verify_email_code"
    assert result["state"] == "authenticated"
    assert result["sessionIssued"] is True
    assert result["user"]["email"] == TEST_VALID_EMAIL


def test_email_code_expired_returns_expired_envelope_without_auth():
    result = verify_email_code_identity({"email": TEST_VALID_EMAIL, "code": TEST_EXPIRED_CODE})
    assert result["ok"] is False
    assert result["state"] == "expired"
    assert result["error"] == "expired_code"
    assert result["status"] == 401
    assert result.get("valid") is not True
    assert result.get("sessionIssued") is not True


def test_email_code_invalid_returns_denied_without_auth():
    result = execute_auth_identity_runtime_boundary(
        {"operation": "verify_email_code", "email": TEST_VALID_EMAIL, "code": "999999"}
    )
    assert result["ok"] is False
    assert result["error"] in ("expired_code", "invalid")
    assert result.get("valid") is not True


def test_invalid_operation_and_bad_payload_yield_error_envelope():
    bad = execute_auth_identity_runtime_boundary({"operation": "foo"})
    assert bad["ok"] is False
    assert bad.get("error") == "invalid"

    none_payload = execute_auth_identity_runtime_boundary(None)  # type: ignore[arg-type]
    assert none_payload["ok"] is False
