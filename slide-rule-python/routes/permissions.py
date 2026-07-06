"""Permission HTTP surface for the Python takeover services (task 55 unblock).

Thin skin over what Python already owns:

- permission check runtime boundary (deny-first policy evaluator)
- permission audit hook envelope after a check decision
- rate-limit decision runtime (sliding window mirror)
- deterministic policy decision slice (read/decision only)
- route-management boundary + the __internal cutover/closure decision surfaces

Node-retained (NOT routed here, still owned by server/routes/permissions.ts):
role/policy/token CRUD stores, dynamic grant/revoke/escalate, conflict/risk
detection, audit trail queries, templates, and the web-aigc matrices.
`POST /management/evaluate` returns that boundary explicitly (node_owned).
"""
from __future__ import annotations

import time
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse

from config.settings import settings
from middlewares.auth import evaluate_permission_check_runtime_boundary
from services.permission_audit_durable_store_boundary import (
    execute_permission_audit_durable_store_boundary,
)
from services.permission_audit_hooks import record_permission_audit_hook
from services.permission_audit_policy_store_cutover import (
    decide_permission_audit_policy_store_cutover,
)
from services.permission_audit_production_ownership_closure import (
    decide_permission_audit_production_ownership_closure,
)
from services.permission_management import evaluate_permission_management_boundary
from services.permission_policy_store_takeover import (
    compute_deterministic_policy_decision,
    decide_permission_policy_store_takeover,
)
from services.permission_rate_limit import PermissionRateLimitRuntime


router = APIRouter(tags=["Permission runtime (python takeover)"])

_rate_limit_runtime = PermissionRateLimitRuntime()


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


def _bad_request(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"ok": False, "error": {"code": "invalid_payload", "message": message}},
    )


def _now_ms(payload: Dict[str, Any]) -> int:
    value = payload.get("nowMs")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Check runtime + audit hook
# ---------------------------------------------------------------------------


@router.post("/check")
async def check_permission(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return evaluate_permission_check_runtime_boundary(payload)


@router.post("/audit-hook")
async def audit_hook(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    check_result = payload.get("checkResult")
    context = payload.get("context") if isinstance(payload.get("context"), dict) else None
    return record_permission_audit_hook(
        check_result if isinstance(check_result, dict) else None,
        context,
    )


# ---------------------------------------------------------------------------
# Rate limit runtime (1:1 with PermissionRateLimitRuntime methods)
# ---------------------------------------------------------------------------


@router.post("/rate-limit/check")
async def rate_limit_check(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    key = payload.get("key")
    if not isinstance(key, str) or not key:
        return _bad_request("key is required")
    _rate_limit_runtime.now_ms = _now_ms(payload)
    return _rate_limit_runtime.check(key, payload.get("maxPerMinute", 0))


@router.post("/rate-limit/record")
async def rate_limit_record(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    key = payload.get("key")
    if not isinstance(key, str) or not key:
        return _bad_request("key is required")
    _rate_limit_runtime.now_ms = _now_ms(payload)
    _rate_limit_runtime.record(key)
    return {"ok": True, "key": key, "recordedAtMs": _rate_limit_runtime.now_ms}


@router.post("/rate-limit/reset")
async def rate_limit_reset(
    payload: Optional[dict[str, Any]] = Body(None),
    x_internal_key: Optional[str] = Header(None),
):
    _auth(x_internal_key)
    key = (payload or {}).get("key")
    _rate_limit_runtime.reset(key if isinstance(key, str) and key else None)
    return {"ok": True, "key": key if isinstance(key, str) and key else None}


# ---------------------------------------------------------------------------
# Policy decision slice + explicit route-management boundary
# ---------------------------------------------------------------------------


@router.post("/policy/decision")
async def policy_decision(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return compute_deterministic_policy_decision(payload)


@router.post("/management/evaluate")
async def management_evaluate(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Explicit boundary: role/policy/token management stays Node-owned."""
    _auth(x_internal_key)
    return evaluate_permission_management_boundary(payload)


# ---------------------------------------------------------------------------
# Internal cutover / closure decision surfaces consumed by Node
# ---------------------------------------------------------------------------

_INTERNAL_SERVICES: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "policy-store-cutover": decide_permission_audit_policy_store_cutover,
    "production-ownership-closure": decide_permission_audit_production_ownership_closure,
    "durable-store-boundary": execute_permission_audit_durable_store_boundary,
    "policy-store-takeover": decide_permission_policy_store_takeover,
}


def _register_internal_route(name: str, service: Callable[[Dict[str, Any]], Dict[str, Any]]) -> None:
    async def endpoint(
        payload: Optional[dict[str, Any]] = Body(None),
        x_internal_key: Optional[str] = Header(None),
    ):
        _auth(x_internal_key)
        return service(payload if isinstance(payload, dict) else {})

    endpoint.__name__ = f"internal_{name.replace('-', '_')}"
    router.add_api_route(f"/__internal/{name}", endpoint, methods=["GET", "POST"])


for _name, _service in _INTERNAL_SERVICES.items():
    _register_internal_route(_name, _service)
