"""Auth token/mailer/session cutover readiness 101.

Python provides narrow cutover readiness classification for:
- tokenIssuance (synthetic decision envelope only)
- emailCodeMailer (never claims production mailer; defaults to skipped-live)
- sessionRepository (decision boundary only; real store + invalidation stays in Node)

Statuses: ready | blocked | degraded | skipped-live

Never promotes mock mailer, in-mem session or synthetic token to production.
Node bridge retains real session store, email sending, password policy boundaries.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

CONTRACT_VERSION = "auth-token-mailer-session-cutover.v1"
PROVENANCE = "python-auth-token-mailer-session-cutover"

CUTOVER_STATUSES: tuple[str, ...] = ("ready", "blocked", "degraded", "skipped-live")

AuthTokenMailerSessionCutoverStatus = Literal["ready", "blocked", "degraded", "skipped-live"]


def _error_envelope(
    status: AuthTokenMailerSessionCutoverStatus,
    code: str,
    message: str,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "cutover_readiness"},
    }


def _success_envelope(
    status: AuthTokenMailerSessionCutoverStatus,
    components: Dict[str, str],
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status == "ready",
        "runtime": {"owner": "python", "mode": "cutover_readiness"},
        "cutoverSummary": {
            "status": status,
            "components": components,
            "metadata": metadata or {},
        },
    }


def execute_auth_token_mailer_session_cutover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return token/mailer/session cutover readiness.

    simulate supports:
      - {"block": true} -> blocked
      - {"degrade": true} -> degraded
      - {"skipLive": true} -> force skipped-live (for mailer)
      - {"forceFailed": true} -> failed (treated as blocked for this cutover)
    default: token=ready, mailer=skipped-live, session=ready -> overall ready
    """
    if payload is None or not isinstance(payload, dict):
        return _error_envelope("blocked", "invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}

    if simulate.get("forceFailed"):
        return _error_envelope("blocked", "forced_failure", "cutover forced into blocked state")

    if simulate.get("block") or simulate.get("blocked"):
        components: Dict[str, str] = {
            "tokenIssuance": "blocked",
            "emailCodeMailer": "blocked",
            "sessionRepository": "blocked",
        }
        return _success_envelope("blocked", components, metadata)

    if simulate.get("degrade") or simulate.get("degraded"):
        components = {
            "tokenIssuance": "degraded",
            "emailCodeMailer": "degraded",
            "sessionRepository": "degraded",
        }
        return _success_envelope("degraded", components, metadata)

    # default and skipped-live case
    token_dec = "ready"
    mailer_dec = "skipped-live"
    session_dec = "ready"

    if simulate.get("skipLive") or simulate.get("skippedLive"):
        mailer_dec = "skipped-live"
        # token and session stay ready unless area specified
    if simulate.get("area") == "mailer":
        token_dec = "skipped-live"
        session_dec = "skipped-live"
        mailer_dec = "skipped-live"

    components = {
        "tokenIssuance": token_dec,
        "emailCodeMailer": mailer_dec,
        "sessionRepository": session_dec,
    }

    # overall status: if any blocked use blocked, elif any degraded, elif mailer skipped but others ready -> ready (advisory)
    has_blocked = any(v == "blocked" for v in components.values())
    has_degraded = any(v == "degraded" for v in components.values())
    if has_blocked:
        overall: AuthTokenMailerSessionCutoverStatus = "blocked"
    elif has_degraded:
        overall = "degraded"
    else:
        overall = "ready"

    return _success_envelope(overall, components, metadata)


# alias for bridge
get_auth_token_mailer_session_cutover = execute_auth_token_mailer_session_cutover
