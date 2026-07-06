"""Executor callback event projection HTTP surface — first Python slice of
the Node POST /api/executor/events executor face.

POST /api/executor/events/project accepts the executor callback delivery
envelope plus minimal mission context and returns the projected mission
action envelope (routing verdict, pure mapper action, inline apply plan).

Deliberately NOT migrated in this slice (still Node-owned): HMAC signature
verification, heartbeatMonitor reset/clear side effects, missionRuntime
persistence writes, artifact/instance/security/preview normalization, and
Socket.IO streaming passthrough (job.log / job.log_stream / job.screenshot
never take an HTTP hop). See docs/NODE_PYTHON_PARITY.md.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from config.settings import settings
from services.executor_event_projection import project_executor_event

router = APIRouter(tags=["ExecutorEvents"])


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


@router.post("/project")
async def project_event(
    payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)
):
    _auth(x_internal_key)
    body = payload if isinstance(payload, dict) else {}
    event = body.get("event")
    mission = body.get("mission") if isinstance(body.get("mission"), dict) else None

    result = project_executor_event(event, mission)
    if not result.get("ok"):
        # Fail-closed envelope: malformed deliveries never yield an action.
        return JSONResponse(status_code=400, content=result)
    return result
