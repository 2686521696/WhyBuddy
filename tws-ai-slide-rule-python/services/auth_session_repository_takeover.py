"""Auth session repository takeover 104.

Python service handles a bounded/deterministic session repository operation (create/read/revoke/refresh)
via the persistence boundary for a proven slice.

- Provides runtime evidence for session repository slice.
- sessionRepository reports "python-owned" and productionTakeover=true ONLY for the proven bounded op slice.
- Explicit "node-retained" for repository responsibility if outside the slice or no op.
- Does not weaken prod auth; delegates to existing persistence boundary for deterministic behavior.
- No secrets or real tokens in outputs.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from services.auth_session_persistence import (
    write_auth_session_record,
    read_auth_session_record,
    refresh_auth_session_record,
    logout_auth_session_record,
)

CONTRACT_VERSION = "auth-session-repository-takeover.v1"
PROVENANCE = "python-auth-session-repository-takeover-104"

REPO_OPS = ("create", "read", "revoke", "refresh")


def _error_envelope(status: str, code: str, message: str) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "session_repository_takeover"},
    }


def _success_envelope(
    status: str,
    ownership: Dict[str, str],
    production_takeover: bool = False,
    metadata: Optional[Dict[str, Any]] = None,
    operation_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    env: Dict[str, Any] = {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status in ("ready", "python-owned"),
        "runtime": {"owner": "python", "mode": "session_repository_takeover"},
        "ownership": ownership,
        "productionTakeover": production_takeover,
        "metadata": metadata or {},
    }
    if operation_result is not None:
        env["operationResult"] = operation_result
    return env


def execute_auth_session_repository_takeover(
    payload: Dict[str, Any] | None = None,
    store_file: Any = None,
) -> Dict[str, Any]:
    """Deterministic session repository decision or operation for takeover slice.

    payload may contain:
      - operation: "create" | "read" | "revoke" | "refresh"
      - session: for create (with sessionId, user, expiresAt ...)
      - sessionId, now, expiresAt for other ops
      - simulate, metadata

    For proven slice ops, returns python-owned + productionTakeover true.
    Otherwise retains explicit node-retained.
    """
    if payload is None or not isinstance(payload, dict):
        return _error_envelope("blocked", "invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    operation = payload.get("operation")

    if simulate.get("forceFailed") or simulate.get("block") or simulate.get("blocked"):
        ownership = {"sessionRepository": "blocked"}
        return _success_envelope("blocked", ownership, False, metadata)

    if operation in REPO_OPS:
        try:
            if operation == "create":
                session = payload.get("session")
                if not isinstance(session, dict) or not session.get("sessionId"):
                    op_res: Dict[str, Any] = {"ok": False, "operation": "create", "error": "invalid"}
                else:
                    op_res = write_auth_session_record(session, store_file=store_file)
            elif operation == "read":
                sid = payload.get("sessionId")
                if not isinstance(sid, str) or not sid:
                    op_res = {"valid": False, "error": "missing"}
                else:
                    op_res = read_auth_session_record(sid, store_file=store_file, now=payload.get("now"))
            elif operation == "refresh":
                sid = payload.get("sessionId")
                op_res = refresh_auth_session_record(
                    sid or "",
                    store_file=store_file,
                    expires_at=payload.get("expiresAt"),
                    now=payload.get("now"),
                )
            elif operation == "revoke":
                sid = payload.get("sessionId")
                op_res = logout_auth_session_record(
                    sid or "",
                    store_file=store_file,
                    now=payload.get("now"),
                )
            else:
                op_res = {"ok": False, "error": "invalid"}

            ownership: Dict[str, str] = {
                "sessionRepository": "python-owned",
                "operation": str(operation),
            }
            # takeover flag true only for the proven slice
            return _success_envelope("python-owned", ownership, True, metadata, op_res)
        except Exception as ex:  # pragma: no cover - defensive
            return _error_envelope("blocked", "operation_failed", str(ex)[:200])

    # outside proven slice: explicit retained
    ownership = {"sessionRepository": "node-retained"}
    return _success_envelope("node-retained", ownership, False, metadata)


# alias
get_auth_session_repository_takeover = execute_auth_session_repository_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "REPO_OPS",
    "execute_auth_session_repository_takeover",
    "get_auth_session_repository_takeover",
]
