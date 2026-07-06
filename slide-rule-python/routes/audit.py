"""Audit HTTP surface for the Python takeover services (task 55 unblock).

Thin skin over what Python already owns:

- audit production sink write envelope (synthetic, no external IO)
- retention/export runtime envelope (retention decision + export manifest)
- safe audit evidence slice classify/retain/export
- durable store + retention takeover boundary decision

Node-retained (NOT routed here, still owned by server/routes/audit.ts):
the real hash-chained audit store, query/search over real entries, chain
verification, stats, compliance reports, anomaly alerts, permission trails,
data lineage, and retention archive over the durable store.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from config.settings import settings
from services.audit_durable_store_retention_takeover import (
    classify_audit_evidence_slice,
    execute_audit_durable_store_retention_takeover,
)
from services.audit_retention_export import execute_audit_retention_export
from services.audit_sink import execute_audit_production_sink


router = APIRouter(tags=["Audit runtime (python takeover)"])


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


def _invalid_payload(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "ok": False,
            "status": "invalid_payload",
            "error": {"code": "invalid_payload", "message": message},
        },
    )


@router.post("/sink")
async def sink_write(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    try:
        return execute_audit_production_sink(payload).model_dump(mode="json")
    except (ValueError, ValidationError) as exc:
        return _invalid_payload(str(exc)[:300])


@router.post("/retention-export")
async def retention_export(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    try:
        return execute_audit_retention_export(payload).model_dump(mode="json")
    except (ValueError, ValidationError) as exc:
        return _invalid_payload(str(exc)[:300])


@router.post("/evidence/classify")
async def evidence_classify(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return classify_audit_evidence_slice(payload)


_INTERNAL_SERVICES: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "durable-store-retention-takeover": execute_audit_durable_store_retention_takeover,
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
