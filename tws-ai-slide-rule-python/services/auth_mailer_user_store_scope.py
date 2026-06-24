"""Auth mailer and user store scope 104.

Formal classification for emailCodeMailer and userRepository.
- Both are node-retained (intentionally not migrated).
- mailerUserStoreScopeDecision is python-owned (thin decision envelope for scope classification only).
- Provides migrationDenominator, reason and evidence for retained status.
- No production mailer takeover; no real user store or email sending.
- Stops vague blocking; feeds migration status per 103 context.

Evidence from code:
- server/auth/email-mailer.ts: nodemailer + console delivery (node)
- server/auth/email-code-service.ts: // node-owned real mailer boundary retained
- server/routes/auth.ts: passes emailCodeMailer and users repo as node deps
- No python implementation of send or user persistence for auth.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

CONTRACT_VERSION = "auth-mailer-user-store-scope.v1"
PROVENANCE = "python-auth-mailer-user-store-scope-104"

SCOPE_STATUSES: tuple[str, ...] = ("ready", "node-retained", "python-owned", "out-of-scope", "skipped-live", "blocked")

AuthMailerUserStoreScopeStatus = Literal["ready", "node-retained", "python-owned", "out-of-scope", "skipped-live", "blocked"]


def _error_envelope(status: str, code: str, message: str) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "mailer_user_store_scope"},
    }


def _success_envelope(
    status: str,
    ownership: Dict[str, str],
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status in ("ready", "python-owned"),
        "runtime": {"owner": "python", "mode": "mailer_user_store_scope"},
        "ownership": ownership,
        "metadata": metadata or {},
    }


def execute_auth_mailer_user_store_scope(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return formal scope classification for auth mailer and user store.

    Default classification:
      emailCodeMailer: node-retained
      userRepository: node-retained
      mailerUserStoreScopeDecision: python-owned (thin scope decision only)

    simulate:
      - {"block": true} -> blocked
      - {"area": "emailCodeMailer"} etc.

    Includes denominator and reason for retained surfaces.
    """
    if payload is None or not isinstance(payload, dict):
        return _error_envelope("blocked", "invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}

    if simulate.get("forceFailed"):
        return _error_envelope("blocked", "forced_failure", "scope forced into blocked")

    if simulate.get("block") or simulate.get("blocked"):
        ownership = {
            "emailCodeMailer": "blocked",
            "userRepository": "blocked",
            "mailerUserStoreScopeDecision": "blocked",
        }
        return _success_envelope("blocked", ownership, metadata)

    # Core scope decision: retained surfaces explicit; python only the decision slice
    ownership: Dict[str, str] = {
        "emailCodeMailer": "node-retained",
        "userRepository": "node-retained",
        "mailerUserStoreScopeDecision": "python-owned",
    }

    if simulate.get("area"):
        area = simulate["area"]
        if area in ownership:
            pass

    overall = "ready"
    if any(v == "blocked" for v in ownership.values()):
        overall = "blocked"
    elif "python-owned" in ownership.values():
        overall = "python-owned"

    result = _success_envelope(overall, ownership, metadata)
    result["productionTakeover"] = False

    # reason and denominator for retained status (per acceptance)
    result["reason"] = "node-retained-mailer-user-store;not-worth-migrating-real-email-and-user-persistence;see-103;denominator-handled"
    result["evidence"] = {
        "codeSources": [
            "server/auth/email-mailer.ts (nodemailer/console)",
            "server/auth/email-code-service.ts (node-owned retained comment)",
            "server/routes/auth.ts (deps: emailCodeMailer + users repo)",
        ],
        "pythonClaim": "none-for-prod-mailer-or-user-store",
    }

    base_ownership = dict(ownership)  # for denom calc, decision counts as py slice
    result["migrationDenominator"] = {
        "total": 3,
        "pythonOwned": sum(1 for v in base_ownership.values() if v == "python-owned"),
        "nodeRetained": sum(1 for v in base_ownership.values() if v == "node-retained"),
        "externalOwned": 0,
        "outOfScope": sum(1 for v in base_ownership.values() if v == "out-of-scope"),
    }

    result["boundaries"] = {
        "emailCodeMailerOwner": "node",
        "userRepositoryOwner": "node",
        "scopeDecisionOwner": "python",
    }

    return result


# alias
get_auth_mailer_user_store_scope = execute_auth_mailer_user_store_scope

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "SCOPE_STATUSES",
    "execute_auth_mailer_user_store_scope",
    "get_auth_mailer_user_store_scope",
]
