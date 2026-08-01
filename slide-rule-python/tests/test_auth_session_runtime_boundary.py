import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_session_persistence import (  # noqa: E402
    execute_auth_session_runtime_boundary,
    read_auth_session_record,
    refresh_auth_session_record,
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


def _session(session_id: str = "session-runtime-1"):
    return {
        "sessionId": session_id,
        "user": VALID_USER,
        "expiresAt": "2026-07-01T00:00:00.000Z",
        "lastSeenAt": "2026-06-22T00:00:00.000Z",
        "createdAt": "2026-06-22T00:00:00.000Z",
    }


def test_runtime_boundary_reads_active_and_expired_sessions_without_authenticating_expired(tmp_path):
    store_file = tmp_path / "auth-runtime.json"
    write_auth_session_record(_session("active-session"), store_file=store_file)
    write_auth_session_record(
        {
            **_session("expired-session"),
            "expiresAt": "2026-06-01T00:00:00.000Z",
        },
        store_file=store_file,
    )

    active = execute_auth_session_runtime_boundary(
        {"operation": "read", "sessionId": "active-session"},
        store_file=store_file,
        now="2026-06-22T00:00:00.000Z",
    )
    expired = execute_auth_session_runtime_boundary(
        {"operation": "read", "sessionId": "expired-session"},
        store_file=store_file,
        now="2026-06-22T00:00:00.000Z",
    )

    assert active["valid"] is True
    assert active["sessionId"] == "active-session"
    assert expired == {
        "valid": False,
        "error": "expired",
        "status": 401,
        "message": "Session expired",
    }


def test_refresh_extends_active_session_and_preserves_missing_failure_semantics(tmp_path):
    store_file = tmp_path / "auth-runtime.json"
    write_auth_session_record(_session(), store_file=store_file)

    refreshed = refresh_auth_session_record(
        "session-runtime-1",
        store_file=store_file,
        expires_at="2026-08-01T00:00:00.000Z",
        now="2026-06-22T00:05:00.000Z",
    )
    # now 必须钉住（2026-08-01 修，同 test_auth_session_refresh_logout_runtime）：
    # 上面把过期时间设成绝对时刻 2026-08-01T00:00:00Z，而 read 不传 now 时
    # _now() 回落真实墙钟，于是这条断言过了那个时刻就必然红。
    read = read_auth_session_record(
        "session-runtime-1", store_file=store_file, now="2026-06-22T00:06:00.000Z"
    )
    missing = refresh_auth_session_record("missing-session", store_file=store_file)

    assert refreshed == {
        "ok": True,
        "operation": "refresh",
        "state": "refreshed",
        "sessionId": "session-runtime-1",
    }
    assert read["valid"] is True
    assert missing == {
        "ok": False,
        "operation": "refresh",
        "error": "missing",
        "status": 401,
        "message": "Authentication required",
    }


def test_logout_revokes_session_and_does_not_map_later_reads_to_authenticated(tmp_path):
    store_file = tmp_path / "auth-runtime.json"
    write_auth_session_record(_session(), store_file=store_file)

    logged_out = execute_auth_session_runtime_boundary(
        {
            "operation": "logout",
            "sessionId": "session-runtime-1",
            "now": "2026-06-22T00:10:00.000Z",
        },
        store_file=store_file,
    )
    read_after_logout = read_auth_session_record("session-runtime-1", store_file=store_file)

    assert logged_out == {
        "ok": True,
        "operation": "logout",
        "state": "logged_out",
        "sessionId": "session-runtime-1",
    }
    assert read_after_logout == {
        "valid": False,
        "error": "invalid",
        "status": 401,
        "message": "Invalid session",
    }
