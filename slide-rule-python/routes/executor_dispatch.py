"""Executor dispatch / cancel decision HTTP surface — slice 2 of the Node
executor face migration (see routes/executor_events.py for slice 1).

POST /api/executor/dispatch/plan   — pure dispatch decisions (sourceText,
    buildExecutionPlan inputs, execution mode, job payload patch,
    requestId / idempotencyKey, callback URL composition).
POST /api/executor/cancel/decision — pure cancel-forwarding decisions
    (already-final short-circuit, source normalization, forward verdict,
    cancel URL + request body, downstream outcome interpretation).

Deliberately NOT migrated (still Node-owned): buildExecutionPlan (LLM
planning), the ExecutorClient HTTP transport / retries / capability probe,
traceId generation, heartbeat monitoring, missionRuntime writes, and the
lifecycle/store/scheduler advisory calls around cancel. Node wires these
endpoints behind EXECUTOR_DISPATCH_PYTHON_DECISIONS (default OFF). See
docs/NODE_PYTHON_PARITY.md.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from config.settings import settings
from services.executor_dispatch_decisions import (
    build_executor_dispatch_plan,
    decide_executor_cancel,
)

router = APIRouter(tags=["ExecutorDispatch"])


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


@router.post("/dispatch/plan")
async def dispatch_plan(
    payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)
):
    _auth(x_internal_key)
    result = build_executor_dispatch_plan(payload)
    if not result.get("ok"):
        # Fail-closed envelope: malformed inputs never yield dispatch decisions.
        return JSONResponse(status_code=400, content=result)
    return result


@router.post("/cancel/decision")
async def cancel_decision(
    payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)
):
    _auth(x_internal_key)
    result = decide_executor_cancel(payload)
    if not result.get("ok"):
        return JSONResponse(status_code=400, content=result)
    return result
