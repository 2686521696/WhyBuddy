import json
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


def test_refresh_success_returns_refreshed_envelope_and_updates_persistence(tmp_path):
    store_file = tmp_path / "auth-runtime.json"
    write_auth_session_record(_session(), store_file=store_file)

    refreshed = execute_auth_session_runtime_boundary(
        {
            "operation": "refresh",
            "sessionId": "session-runtime-1",
            "expiresAt": "2026-08-01T00:00:00.000Z",
            "now": "2026-06-22T00:05:00.000Z",
        },
        store_file=store_file,
    )
    # now 必须钉住（2026-08-01 修）：refresh 把过期时间设成绝对时刻
    # 2026-08-01T00:00:00Z，而 read 不传 now 时 _now() 回落 datetime.now()
    # （auth_session_persistence.py:150）。于是这条断言在 2026-08-01T00:00:00Z
    # 之前一直是绿的、之后必然红——真的在那天凌晨集体翻红。
    # 用例本意是"刚刷完，会话读回来有效"，那就把读取时点钉在刷新之后一分钟；
    # 换成相对时间（now+N天）会让"过期判定"这条断言本身失去意义。
    read = read_auth_session_record(
        "session-runtime-1", store_file=store_file, now="2026-06-22T00:06:00.000Z"
    )
    raw_store = dict(json.loads(store_file.read_text(encoding="utf-8")))

    assert refreshed == {
        "ok": True,
        "operation": "refresh",
        "state": "refreshed",
        "sessionId": "session-runtime-1",
    }
    assert read["valid"] is True
    assert raw_store["session-runtime-1"]["expiresAt"] == "2026-08-01T00:00:00.000Z"
    assert raw_store["session-runtime-1"]["lastSeenAt"] == "2026-06-22T00:05:00.000Z"


def test_logout_returns_logged_out_envelope_and_invalidates_later_reads(tmp_path):
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


def test_refresh_expired_session_returns_expired_envelope_without_authenticating(tmp_path):
    store_file = tmp_path / "auth-runtime.json"
    write_auth_session_record(
        {
            **_session("expired-session"),
            "expiresAt": "2026-06-01T00:00:00.000Z",
        },
        store_file=store_file,
    )

    expired = refresh_auth_session_record(
        "expired-session",
        store_file=store_file,
        now="2026-06-22T00:00:00.000Z",
    )

    assert expired == {
        "ok": False,
        "operation": "refresh",
        "state": "expired",
        "error": "expired",
        "status": 401,
        "message": "Session expired",
    }
    assert expired.get("valid") is not True


def test_refresh_invalidated_session_returns_invalid_envelope_without_authenticating(tmp_path):
    store_file = tmp_path / "auth-runtime.json"
    write_auth_session_record(
        {
            **_session("invalidated-session"),
            "revokedAt": "2026-06-22T00:01:00.000Z",
        },
        store_file=store_file,
    )

    invalid = refresh_auth_session_record(
        "invalidated-session",
        store_file=store_file,
        now="2026-06-22T00:05:00.000Z",
    )

    assert invalid == {
        "ok": False,
        "operation": "refresh",
        "state": "invalid",
        "error": "invalid",
        "status": 401,
        "message": "Invalid session",
    }
    assert invalid.get("valid") is not True


def test_refresh_repository_failure_returns_error_envelope_without_authenticating(tmp_path):
    store_file = tmp_path / "auth-session-store-directory"
    store_file.mkdir()

    result = refresh_auth_session_record("session-runtime-1", store_file=store_file)

    assert result["ok"] is False
    assert result["operation"] == "refresh"
    assert result["state"] == "error"
    assert result["status"] == 503
    assert result["error"]["code"] == "auth_session_store_failure"
    assert result["error"]["reason"] == "read_failed"
    assert result.get("valid") is not True
