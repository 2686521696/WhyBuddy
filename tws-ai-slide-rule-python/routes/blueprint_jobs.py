"""Blueprint job runtime proxy endpoints."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException

from config.settings import settings
from services.blueprint_job_runtime import run_blueprint_job_runtime_action


router = APIRouter(tags=["Blueprint job runtime proxy"])


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


@router.post("/runtime/start")
async def start_runtime(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return run_blueprint_job_runtime_action("start", payload)


@router.post("/runtime/status")
async def status_runtime(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return run_blueprint_job_runtime_action("status", payload)


@router.post("/runtime/cancel")
async def cancel_runtime(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return run_blueprint_job_runtime_action("cancel", payload)


@router.post("/runtime/read")
async def read_runtime(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return run_blueprint_job_runtime_action("read", payload)
