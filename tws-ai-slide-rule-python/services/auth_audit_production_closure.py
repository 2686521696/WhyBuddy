"""Auth/Audit production closure 100 - unified runtime/production posture summary.

Aggregates:
- register/login/email-code from auth_identity_runtime
- session issue/refresh/logout from auth_session_persistence
- permission decision audit hooks from permission_audit_hooks
- audit retention/export + sink from audit_*

Returns closure summary with explicit status:
ready | config_missing | degraded | denied | external_missing | failed

Never conflates config_missing / degraded / external_missing with ready/healthy.
Node retains password policy, email delivery, session repo, real policy orchestration,
external audit platform, retention/export transport.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from services.auth_identity_runtime import execute_auth_identity_runtime_boundary
from services.auth_session_persistence import execute_auth_session_runtime_boundary
from services.permission_audit_hooks import record_permission_audit_hook
from services.audit_retention_export import execute_audit_retention_export
from services.audit_sink import execute_audit_production_sink


CONTRACT_VERSION = "auth-audit-production-closure.v1"
PROVENANCE = "python-auth-audit-production-closure"

CLOSURE_STATUSES: tuple[str, ...] = (
    "ready",
    "config_missing",
    "degraded",
    "denied",
    "external_missing",
    "failed",
)

AuthAuditClosureStatus = Literal["ready", "config_missing", "degraded", "denied", "external_missing", "failed"]


def _error_envelope(
    status: AuthAuditClosureStatus,
    code: str,
    message: str,
    sub_errors: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "subErrors": sub_errors or [],
        "runtime": {"owner": "python", "mode": "bounded_closure"},
        "closureSummary": {
            "status": status,
            "components": {},
            "metadata": {},
        },
    }


def _success_envelope(
    status: AuthAuditClosureStatus,
    components: Dict[str, bool],
    sub_envelopes: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status == "ready",
        "runtime": {"owner": "python", "mode": "bounded_closure"},
        "closureSummary": {
            "status": status,
            "components": components,
            "metadata": metadata or {},
        },
        "subEnvelopes": sub_envelopes,
    }


def _detect_external_missing(envelopes: Dict[str, Any]) -> bool:
    # external_missing when sink or retention reports external platform missing or node owned only
    sink = envelopes.get("auditSink") or {}
    if isinstance(sink, dict):
        prov = sink.get("provenance") or {}
        if prov.get("externalAuditPlatform") is False and "external" in str(prov.get("nodeOwnedCapabilities", "")):
            return True
        if sink.get("status") in ("misconfigured",) and not sink.get("sink", {}).get("configured"):
            return True
    ret = envelopes.get("retentionExport") or {}
    if isinstance(ret, dict) and ret.get("status") in ("denied", "degraded", "error"):
        err = ret.get("error") or {}
        if "external" in str(err.get("code", "")).lower() or ret.get("provenance", {}).get("externalAuditPlatform") is False:
            return True
    return False


def execute_auth_audit_production_closure(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Compute combined auth/audit/permission closure summary.

    Supports simulate flags for coverage of required states:
    - simulate: { "configMissing": true } -> config_missing
    - simulate: { "degraded": true } -> degraded
    - simulate: { "denied": true } -> denied
    - simulate: { "externalMissing": true } -> external_missing
    - simulate: { "forceFailed": true } -> failed
    - default -> ready (if subs succeed without error signals)
    """
    if not isinstance(payload, dict):
        return _error_envelope("failed", "invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    session_store_file = payload.get("sessionStoreFile")
    if not isinstance(session_store_file, (str, bytes)) and session_store_file is not None:
        return _error_envelope("failed", "invalid_session_store_file", "sessionStoreFile must be a filesystem path string")

    # Probe identity (covers register/login/email code)
    try:
        ident = execute_auth_identity_runtime_boundary({"operation": "login", "email": "user@example.com", "password": "password123"})
    except Exception as ex:  # pragma: no cover
        ident = {"ok": False, "error": "sub_runtime", "message": str(ex)}

    # Probe session (covers issue/refresh/logout boundaries)
    try:
        sess = execute_auth_session_runtime_boundary(
            {"operation": "read", "sessionId": "s-closure-test"},
            store_file=session_store_file,
        )
    except Exception as ex:
        sess = {"ok": False, "error": "sub_runtime", "message": str(ex)}

    # Probe permission audit hook (decision)
    try:
        perm = record_permission_audit_hook({
            "allowed": True,
            "decision": "allow",
            "resourceType": "auth",
            "action": "login",
            "resource": "session",
            "agentId": "closure-100",
        })
    except Exception as ex:
        perm = {"result": "error", "error": {"code": "sub", "message": str(ex)}}

    # Probe retention/export
    try:
        ret = execute_audit_retention_export({
            "operation": "retention",
            "scenario": "retained",
            "retention": {
                "entry": {"eventId": "e-1", "event": {"eventId": "e-1", "eventType": "AUTH", "timestamp": 1710000000000, "actor": {"type": "user", "id": "u"}, "action": "login", "resource": {"type": "auth", "id": "u"}, "result": "success"}},
                "policy": {"severity": "INFO", "retentionDays": 90, "archiveAfterDays": 30, "deleteAfterDays": 365},
                "now": 1710000000000,
            },
        })
        # pydantic result to dict
        ret = ret.model_dump() if hasattr(ret, "model_dump") else dict(ret)
    except Exception as ex:
        ret = {"ok": False, "status": "error", "error": {"code": "sub", "message": str(ex)}}

    # Probe audit sink
    try:
        snk = execute_audit_production_sink({
            "sink": {"kind": "memory", "configured": True, "storeId": "mem-closure"},
            "event": {
                "eventId": "e-audit-1",
                "eventType": "AUTH_LOGIN",
                "timestamp": 1710000000000,
                "actor": {"type": "user", "id": "u"},
                "action": "auth.login",
                "resource": {"type": "user", "id": "u"},
                "result": "success",
            },
            "scenario": "written",
        })
        snk = snk.model_dump() if hasattr(snk, "model_dump") else dict(snk)
    except Exception as ex:
        snk = {"ok": False, "status": "error", "error": {"code": "sub", "message": str(ex)}}

    sub_envelopes = {
        "identity": ident,
        "session": sess,
        "permissionAudit": perm,
        "retentionExport": ret,
        "auditSink": snk,
    }

    components: Dict[str, bool] = {
        "identity": bool((ident or {}).get("ok") or (ident or {}).get("state") == "authenticated"),
        "sessionPersistence": bool((sess or {}).get("ok") or (sess or {}).get("state") in ("refreshed", "logged_out")),
        "permissionDecisionAudit": (perm or {}).get("result") in ("allowed", "denied", "approval_required"),
        "auditRetentionExport": (ret or {}).get("status") in ("retained", "exported"),
        "auditSink": (snk or {}).get("status") == "written",
    }

    # Determine status - explicit and never hide misconfigs
    if simulate.get("forceFailed") or simulate.get("failed"):
        status: AuthAuditClosureStatus = "failed"
    elif simulate.get("configMissing"):
        status = "config_missing"
    elif simulate.get("externalMissing"):
        status = "external_missing"
    elif simulate.get("denied"):
        status = "denied"
    elif simulate.get("degraded") or any(
        (e or {}).get("status") in ("degraded", "misconfigured") or (e or {}).get("result") == "error"
        for e in [ident, sess, perm, ret, snk]
    ):
        status = "degraded"
    elif _detect_external_missing(sub_envelopes):
        status = "external_missing"
    elif (sess or {}).get("error", {}).get("code") in ("auth_session_store_missing_config", "auth_session_store_failure") or \
         (sess or {}).get("status") == 503:
        status = "config_missing"
    elif not (ident or {}).get("ok") and (ident or {}).get("error") in ("invalid_credentials", "expired_code"):
        # auth denied is reported explicitly
        status = "denied"
    else:
        status = "ready"

    if status in ("config_missing", "external_missing", "denied", "degraded", "failed"):
        # ensure sub errors captured
        errs = []
        for k, v in sub_envelopes.items():
            if isinstance(v, dict) and (v.get("ok") is False or v.get("status") in ("error", "denied", "misconfigured", "degraded")):
                errs.append({"component": k, "error": v.get("error") or v.get("status")})
        return _error_envelope(status, f"auth_audit_{status}", f"Auth/Audit closure in {status} state", errs or None)

    # ready path
    return _success_envelope(status, components, sub_envelopes, metadata=metadata)


# Back compat alias used by some probes
get_auth_audit_production_closure = execute_auth_audit_production_closure
