"""Auth HTTP surface for the Python takeover services (task 55 unblock).

Thin skin over the existing auth_* services. Mirrors the Node
server/routes/auth.ts contract where the Python services already model it:

- identity (register / login / email-code verify) -> auth_identity_runtime
- session runtime (write / read / refresh / logout / delete) -> auth_session_persistence
- the seven __internal closure/takeover decision surfaces consumed by Node

Node-retained (NOT routed here, still owned by server/routes/auth.ts):
- /email-code/send (real mailer is node-retained per auth_mailer_user_store_scope)
- cookie issuance and the production user repository
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse

from config.settings import settings
from services.auth_audit_production_closure import execute_auth_audit_production_closure
from services.auth_identity_runtime import (
    execute_auth_identity_runtime_boundary,
    login_identity,
    register_identity,
    verify_email_code_identity,
)
from services.auth_mailer_user_store_scope import execute_auth_mailer_user_store_scope
from services.auth_production_ownership_closure import decide_auth_production_ownership_closure
from services.auth_session_persistence import execute_auth_session_runtime_boundary
from services.auth_session_repository_takeover import execute_auth_session_repository_takeover
from services.auth_session_token_boundary import execute_auth_session_token_boundary
from services.auth_token_issuance_takeover import execute_auth_token_issuance_takeover
from services.auth_token_mailer_session_cutover import execute_auth_token_mailer_session_cutover


router = APIRouter(tags=["Auth runtime (python takeover)"])


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


def _envelope_status(result: Dict[str, Any], ok_status: int = 200) -> int:
    """Mirror the Node route status mapping using the envelope's own status field."""
    if result.get("ok") is True or result.get("valid") is True:
        return ok_status
    status = result.get("status")
    return status if isinstance(status, int) else 200


def _respond(result: Dict[str, Any], ok_status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=_envelope_status(result, ok_status), content=result)


# ---------------------------------------------------------------------------
# Identity (mirrors POST /api/auth/register, /login, /email-code/login)
# ---------------------------------------------------------------------------


@router.post("/register")
async def register(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return _respond(register_identity(payload), ok_status=201)


@router.post("/login")
async def login(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return _respond(login_identity(payload, now=payload.get("now")))


@router.post("/email-code/login")
async def email_code_login(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return _respond(verify_email_code_identity(payload, now=payload.get("now")))


@router.post("/identity/execute")
async def identity_execute(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Bridge endpoint for Node pythonIdentityRuntime.execute (operation in payload)."""
    _auth(x_internal_key)
    return execute_auth_identity_runtime_boundary(payload)


# ---------------------------------------------------------------------------
# Session runtime boundary (JSON store configured via AUTH_SESSION_STORE_FILE)
# Mirrors Node /refresh + /logout mutation contract (401/503 mapping).
# ---------------------------------------------------------------------------

_SESSION_OPERATIONS = ("write", "read", "refresh", "logout", "delete")


def _register_session_route(operation: str) -> None:
    async def endpoint(
        payload: dict[str, Any],
        x_internal_key: Optional[str] = Header(None),
    ):
        _auth(x_internal_key)
        result = execute_auth_session_runtime_boundary({**payload, "operation": operation})
        return _respond(result)

    endpoint.__name__ = f"session_{operation}"
    router.add_api_route(f"/session/{operation}", endpoint, methods=["POST"])


for _operation in _SESSION_OPERATIONS:
    _register_session_route(_operation)


# ---------------------------------------------------------------------------
# Internal closure / takeover decision surfaces consumed by Node auth.ts
# (Node wraps these as GET /api/auth/__internal/*; envelopes returned raw.)
# ---------------------------------------------------------------------------

_INTERNAL_SERVICES: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "auth-audit-closure": execute_auth_audit_production_closure,
    "auth-token-mailer-session-cutover": execute_auth_token_mailer_session_cutover,
    "auth-session-token-boundary": execute_auth_session_token_boundary,
    "auth-production-ownership-closure": decide_auth_production_ownership_closure,
    "auth-session-repository-takeover": execute_auth_session_repository_takeover,
    "auth-token-issuance-takeover": execute_auth_token_issuance_takeover,
    "auth-mailer-user-store-scope": execute_auth_mailer_user_store_scope,
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
