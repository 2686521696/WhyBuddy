import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from middlewares.auth import validate_session_contract  # noqa: E402


VALID_USER = {
    "id": "user-1",
    "email": "user@example.com",
    "role": "user",
    "status": "active",
    "emailVerified": True,
    "createdAt": "2026-04-30T00:00:00.000Z",
}


def test_validate_session_contract_accepts_valid_session_without_secrets():
    result = validate_session_contract(
        {
            "sessionId": "session-1",
            "user": VALID_USER,
        }
    )

    assert result == {
        "valid": True,
        "sessionId": "session-1",
        "user": VALID_USER,
    }
    assert "token" not in result
    assert "cookie" not in result


def test_validate_session_contract_stabilizes_missing_session_error():
    result = validate_session_contract(None)

    assert result == {
        "valid": False,
        "error": "missing",
        "status": 401,
        "message": "Authentication required",
    }


def test_validate_session_contract_stabilizes_expired_session_error():
    result = validate_session_contract({"error": "expired"})

    assert result == {
        "valid": False,
        "error": "expired",
        "status": 401,
        "message": "Session expired",
    }


def test_validate_session_contract_stabilizes_invalid_session_error_and_redacts_secrets():
    result = validate_session_contract(
        {
            "sessionId": "session-1",
            "token": "test-token",
            "cookie": "session=test-token",
            "user": {
                **VALID_USER,
                "tokenHash": "hash",
            },
        }
    )

    assert result == {
        "valid": False,
        "error": "invalid",
        "status": 401,
        "message": "Invalid session",
    }
    assert "test-token" not in str(result)
    assert "tokenHash" not in str(result)
