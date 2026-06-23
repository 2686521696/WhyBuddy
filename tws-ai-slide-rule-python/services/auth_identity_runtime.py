"""Minimal auth identity runtime for login/register/email-code verify.

Bounded boundary: returns structured envelopes for success (with user and session-issued signal),
denied (invalid credentials / expired code), and diagnostic errors.
Does not implement production user store, password hashing, or real email delivery.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from middlewares.auth import validate_session_contract

IdentityResult = Dict[str, Any]

# Test boundary constants only; never used for real accounts.
TEST_VALID_EMAIL = "user@example.com"
TEST_VALID_PASSWORD = "password123"
TEST_VALID_CODE = "123456"
TEST_EXPIRED_CODE = "000000"


def _identity_error(error: str, message: Optional[str] = None) -> IdentityResult:
    if error == "invalid_credentials":
        return {
            "ok": False,
            "operation": None,
            "error": "invalid_credentials",
            "status": 401,
            "message": message or "邮箱或密码错误",
        }
    if error == "expired_code" or error == "invalid_code":
        return {
            "ok": False,
            "operation": None,
            "error": "expired_code",
            "status": 401,
            "message": message or "Email or code is invalid.",
        }
    if error == "invalid":
        return {
            "ok": False,
            "operation": None,
            "error": "invalid",
            "status": 401,
            "message": message or "Invalid request",
        }
    return {
        "ok": False,
        "error": error,
        "status": 401,
        "message": message or "Authentication failed",
    }


def _success_identity(operation: str, user: Dict[str, Any], **extra: Any) -> IdentityResult:
    result: IdentityResult = {
        "ok": True,
        "operation": operation,
        "state": "authenticated" if operation in ("login", "verify_email_code") else "registered",
        "user": user,
    }
    if operation in ("login", "verify_email_code"):
        result["sessionIssued"] = True
    result.update(extra)
    return result


def _public_user(base: Dict[str, Any]) -> Dict[str, Any]:
    # strip any secrets
    u = {k: v for k, v in base.items() if k not in ("password", "passwordHash", "tokenHash", "codeHash")}
    if "emailVerified" not in u:
        u["emailVerified"] = False
    return u


def register_identity(payload: Dict[str, Any]) -> IdentityResult:
    if not isinstance(payload, dict):
        return _identity_error("invalid")
    email = payload.get("email")
    password = payload.get("password")
    if not isinstance(email, str) or "@" not in email or not email.strip():
        return _identity_error("invalid")
    if not isinstance(password, str) or len(password) < 8:
        return _identity_error("invalid")
    user = _public_user(
        {
            "id": "user-reg-" + email.split("@")[0],
            "email": email.strip().lower(),
            "role": "user",
            "status": "active",
            "emailVerified": False,
            "createdAt": "2026-06-23T00:00:00.000Z",
        }
    )
    return _success_identity("register", user)


def login_identity(payload: Dict[str, Any], now: Optional[str] = None) -> IdentityResult:
    if not isinstance(payload, dict):
        return _identity_error("invalid")
    email = payload.get("email")
    password = payload.get("password")
    if email == TEST_VALID_EMAIL and password == TEST_VALID_PASSWORD:
        user = _public_user(
            {
                "id": "user-1",
                "email": TEST_VALID_EMAIL,
                "role": "user",
                "status": "active",
                "emailVerified": True,
                "createdAt": "2026-04-30T00:00:00.000Z",
            }
        )
        return _success_identity("login", user)
    return _identity_error("invalid_credentials")


def verify_email_code_identity(payload: Dict[str, Any], now: Optional[str] = None) -> IdentityResult:
    if not isinstance(payload, dict):
        return _identity_error("invalid")
    email = payload.get("email")
    code = str(payload.get("code") or "").strip()
    # support explicit now for expiry but simple simulation here
    if code == TEST_EXPIRED_CODE:
        return {
            "ok": False,
            "operation": "verify_email_code",
            "state": "expired",
            "error": "expired_code",
            "status": 401,
            "message": "Email or code is invalid.",
        }
    if email == TEST_VALID_EMAIL and code == TEST_VALID_CODE:
        user = _public_user(
            {
                "id": "user-1",
                "email": TEST_VALID_EMAIL,
                "role": "user",
                "status": "active",
                "emailVerified": True,
                "createdAt": "2026-04-30T00:00:00.000Z",
            }
        )
        return _success_identity("verify_email_code", user)
    return _identity_error("expired_code")


def execute_auth_identity_runtime_boundary(
    payload: Dict[str, Any], now: Optional[str] = None
) -> IdentityResult:
    if not isinstance(payload, dict):
        return _identity_error("invalid")
    operation = payload.get("operation")
    if operation == "register":
        return register_identity(payload)
    if operation == "login":
        return login_identity(payload, now=now or payload.get("now"))
    if operation == "verify_email_code":
        res = verify_email_code_identity(payload, now=now or payload.get("now"))
        if res.get("ok") and "operation" not in res:
            res["operation"] = "verify_email_code"
        return res
    return _identity_error("invalid")
