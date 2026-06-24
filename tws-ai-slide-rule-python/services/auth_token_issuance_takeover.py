"""Auth token issuance takeover 104.

Python-owned decision surface for bounded token lifecycle (issue/refresh/revoke) slice.
- Returns token lifecycle decision with safe metadata only.
- For explicit ops, reports tokenIssuance=python-owned (decision path).
- productionTakeover is always false; actual token generation, signing and issuance policy retained by Node.
- Default/no-op path formally retains tokenIssuance=node-retained (as in 103).
- Does not implement real crypto, does not leak secrets, does not change prod auth flows.
- Node thin proxy consumes decision envelope only.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

CONTRACT_VERSION = "auth-token-issuance-takeover.v1"
PROVENANCE = "python-auth-token-issuance-takeover-104"

TOKEN_LIFECYCLE_OPS = ("issue", "refresh", "revoke")

SENSITIVE_KEY_PARTS = ("token", "cookie", "password", "secret", "hash", "bearer")


def _is_sensitive_key(key: str) -> bool:
    n = str(key).lower()
    if n in SENSITIVE_KEY_PARTS:
        return True
    if any(part in n for part in SENSITIVE_KEY_PARTS):
        return True
    return False


def _sanitize_metadata(meta: Any) -> Dict[str, Any]:
    """Return metadata with sensitive keys (token/secret/password etc) removed.

    Recursively cleans nested dicts; lists kept but dict items sanitized.
    Ensures Python envelope never carries sensitive fields in metadata.
    """
    if not isinstance(meta, dict):
        return {}
    safe: Dict[str, Any] = {}
    for key, val in meta.items():
        if _is_sensitive_key(key):
            continue
        if isinstance(val, dict):
            safe[key] = _sanitize_metadata(val)
        elif isinstance(val, list):
            safe[key] = [_sanitize_metadata(v) if isinstance(v, dict) else v for v in val]
        else:
            safe[key] = val
    return safe


def _error_envelope(status: str, code: str, message: str) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "token_issuance_takeover"},
    }


def _success_envelope(
    status: str,
    ownership: Dict[str, str],
    production_takeover: bool = False,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status in ("ready", "python-owned"),
        "runtime": {"owner": "python", "mode": "token_issuance_takeover"},
        "ownership": ownership,
        "productionTakeover": production_takeover,
        "metadata": metadata or {},
    }


def execute_auth_token_issuance_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return token lifecycle decision with safe metadata.

    simulate:
      - {"block": true} -> blocked
    operation:
      - "issue" | "refresh" | "revoke" -> python-owned decision for slice
    default -> node-retained (formal retention of issuance)
    """
    if payload is None or not isinstance(payload, dict):
        return _error_envelope("blocked", "invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    safe_metadata = _sanitize_metadata(metadata)
    operation = payload.get("operation")

    if simulate.get("forceFailed"):
        return _error_envelope("blocked", "forced_failure", "token issuance forced into blocked")

    if simulate.get("block") or simulate.get("blocked"):
        ownership = {
            "tokenIssuance": "blocked",
        }
        return _success_envelope("blocked", ownership, False, safe_metadata)

    if operation in TOKEN_LIFECYCLE_OPS:
        ownership: Dict[str, str] = {
            "tokenIssuance": "python-owned",
            "operation": str(operation),
        }
        # decision slice only; no production takeover of actual issuance
        return _success_envelope("python-owned", ownership, False, safe_metadata)

    # formal retain
    ownership = {"tokenIssuance": "node-retained"}
    return _success_envelope("node-retained", ownership, False, safe_metadata)


# alias
get_auth_token_issuance_takeover = execute_auth_token_issuance_takeover
