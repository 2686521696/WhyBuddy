"""Task (mission) store HTTP surface — first Python slice of Node routes/tasks.ts.

Implements the CRUD + events + cancel core of the Node /api/tasks contract on
top of the durable Python task store (services/task_store.py), with lifecycle
envelopes projected by the existing task_lifecycle_runtime decision slice.

Deliberately NOT migrated in this slice (still Node-owned): executor dispatch
(auto-dispatch + executor cancel forwarding, so executorForwarded is always
False here), project owner validation, projection/session views, decisions,
operator-actions, and artifact download/preview. See
docs/NODE_PYTHON_PARITY.md section 五.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from config.settings import settings
from services import task_store
from services.task_lifecycle_runtime import project_task_lifecycle_runtime

router = APIRouter(tags=["Tasks"])

DEFAULT_LIMIT = 20
DEFAULT_EVENT_LIMIT = 20
MAX_LIMIT = 200


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


def _parse_limit(raw: Any, default: int = DEFAULT_LIMIT) -> int:
    """Port of Node parseLimit (routes/tasks.ts): clamp to [1, MAX_LIMIT]."""
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        return default
    return max(1, min(MAX_LIMIT, value))


def _optional_string(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _projection_project_id(body: dict[str, Any]) -> Optional[str]:
    projection = body.get("projection")
    if not isinstance(projection, dict):
        return None
    return _optional_string(projection.get("projectId"))


def _lifecycle(action: str, task: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return project_task_lifecycle_runtime({"action": action, "task": task, **extra})


def _format_lifecycle_error(envelope: dict[str, Any]) -> str:
    code = envelope.get("code") or "TASK_LIFECYCLE_RUNTIME_ERROR"
    message = envelope.get("message") or "Task lifecycle runtime failed."
    return f"{code}: {message}"


def _store_failure(result: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=500, content=result)


def _not_found() -> JSONResponse:
    # Node contract: 404 {"error": "Task not found"}
    return JSONResponse(status_code=404, content={"error": "Task not found"})


@router.post("")
async def create_task(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    body = payload if isinstance(payload, dict) else {}

    body_project_id = _optional_string(body.get("projectId"))
    projection_project_id = _projection_project_id(body)
    if body_project_id and projection_project_id and body_project_id != projection_project_id:
        return JSONResponse(
            status_code=400,
            content={"error": "projectId mismatch between request body and projection"},
        )
    if body_project_id or projection_project_id:
        # Node returns this exact error when project owner validation is not
        # wired; the Python slice has no project store yet, so mirror it.
        return JSONResponse(
            status_code=500,
            content={"error": "Project owner validation is not configured"},
        )

    title = task_store.build_task_title(body.get("title"), body.get("sourceText"))
    if not title:
        return JSONResponse(
            status_code=400,
            content={"error": "title or sourceText is required"},
        )

    projection = body.get("projection") if isinstance(body.get("projection"), dict) else None
    created = task_store.create_task(
        kind=_optional_string(body.get("kind")) or "chat",
        title=title,
        source_text=_optional_string(body.get("sourceText")),
        topic_id=_optional_string(body.get("topicId")),
        projection=projection,
    )
    if not created.get("ok"):
        return _store_failure(created)

    task = created["task"]
    lifecycle = _lifecycle("create", task)
    lifecycle_error: Optional[str] = None
    if lifecycle.get("ok"):
        # Node applies the lifecycle envelope when the runtime is configured:
        # create -> started -> nodeStatus running (progress 4, stage receive).
        projected = lifecycle.get("task") or {}
        applied = task_store.update_task_status(
            task["id"],
            projected.get("nodeStatus") or "running",
            message=projected.get("message"),
            progress=projected.get("progress"),
            stage_key=projected.get("stageKey"),
            source="mission-core",
        )
        if applied.get("ok"):
            task = applied["task"]
    else:
        lifecycle_error = _format_lifecycle_error(lifecycle)
        failed = task_store.update_task_status(
            task["id"], "failed", message=lifecycle_error, source="mission-core"
        )
        if failed.get("ok"):
            task = failed["task"]

    return JSONResponse(
        status_code=201,
        content={
            "ok": True,
            "task": task,
            **({"lifecycle": lifecycle} if lifecycle.get("ok") else {}),
            **({"lifecycleError": lifecycle_error} if lifecycle_error else {}),
        },
    )


@router.get("")
async def list_tasks(limit: Optional[str] = None, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    result = task_store.list_tasks(_parse_limit(limit))
    if not result.get("ok"):
        return _store_failure(result)
    return {"ok": True, "tasks": result["tasks"]}


@router.get("/{task_id}")
async def get_task(task_id: str, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    result = task_store.get_task(task_id)
    if result.get("error") == "not_found":
        return _not_found()
    if not result.get("ok"):
        return _store_failure(result)

    task = result["task"]
    lifecycle = _lifecycle("status", task)
    return {
        "ok": True,
        "task": task,
        **({"lifecycle": lifecycle} if lifecycle.get("ok") else {}),
        **(
            {"lifecycleError": _format_lifecycle_error(lifecycle)}
            if lifecycle.get("ok") is False
            else {}
        ),
    }


@router.get("/{task_id}/events")
async def list_task_events(
    task_id: str, limit: Optional[str] = None, x_internal_key: Optional[str] = Header(None)
):
    _auth(x_internal_key)
    parsed_limit = _parse_limit(limit, DEFAULT_EVENT_LIMIT)
    result = task_store.list_task_events(task_id, parsed_limit)
    if result.get("error") == "not_found":
        return _not_found()
    if not result.get("ok"):
        return _store_failure(result)

    events = result["events"]
    task = task_store.get_task(task_id).get("task") or {"id": task_id}
    lifecycle = _lifecycle("replay", task, events=events, limit=parsed_limit)
    return {
        "ok": True,
        "missionId": task_id,
        "events": events,
        **({"lifecycle": lifecycle} if lifecycle.get("ok") else {}),
        **(
            {"lifecycleError": _format_lifecycle_error(lifecycle)}
            if lifecycle.get("ok") is False
            else {}
        ),
    }


@router.post("/{task_id}/events")
async def append_task_event(
    task_id: str, payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)
):
    _auth(x_internal_key)
    body = payload if isinstance(payload, dict) else {}
    message = _optional_string(body.get("message"))
    if not message:
        return JSONResponse(status_code=400, content={"error": "message is required"})

    result = task_store.append_task_event(
        task_id,
        event_type=_optional_string(body.get("type")) or "log",
        message=message,
        level=_optional_string(body.get("level")),
        progress=body.get("progress") if isinstance(body.get("progress"), (int, float)) else None,
        stage_key=_optional_string(body.get("stageKey")),
        source=_optional_string(body.get("source")) or "mission-core",
    )
    if result.get("error") == "not_found":
        return _not_found()
    if result.get("error") == "invalid_event_type":
        return JSONResponse(status_code=400, content={"error": result.get("message")})
    if not result.get("ok"):
        return _store_failure(result)
    return {"ok": True, "missionId": task_id, "event": result["event"], "task": result["task"]}


@router.post("/{task_id}/status")
async def update_task_status(
    task_id: str, payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)
):
    _auth(x_internal_key)
    body = payload if isinstance(payload, dict) else {}
    status = _optional_string(body.get("status"))
    if not status:
        return JSONResponse(status_code=400, content={"error": "status is required"})

    result = task_store.update_task_status(
        task_id,
        status,
        message=_optional_string(body.get("message")) or _optional_string(body.get("detail")),
        summary=_optional_string(body.get("summary")),
        progress=body.get("progress") if isinstance(body.get("progress"), (int, float)) else None,
        stage_key=_optional_string(body.get("stageKey")),
        source=_optional_string(body.get("source")) or "mission-core",
    )
    if result.get("error") == "not_found":
        return _not_found()
    if result.get("error") == "invalid_status":
        return JSONResponse(status_code=400, content={"error": result.get("message")})
    if result.get("error") == "invalid_transition":
        return JSONResponse(
            status_code=409,
            content={
                "error": result.get("message"),
                "from": result.get("from"),
                "to": result.get("to"),
            },
        )
    if not result.get("ok"):
        return _store_failure(result)
    return {"ok": True, "task": result["task"]}


@router.post("/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    payload: Optional[dict[str, Any]] = None,
    x_internal_key: Optional[str] = Header(None),
):
    _auth(x_internal_key)
    body = payload if isinstance(payload, dict) else {}

    current = task_store.get_task(task_id)
    if current.get("error") == "not_found":
        return _not_found()
    if not current.get("ok"):
        return _store_failure(current)

    task = current["task"]
    if task.get("status") in task_store.FINAL_TASK_STATUSES:
        # Node contract: cancelling a final task is an idempotent no-op.
        return {"ok": True, "alreadyFinal": True, "executorForwarded": False, "task": task}

    reason = _optional_string(body.get("reason"))
    lifecycle = _lifecycle("cancel", task, reason=reason)
    if lifecycle.get("ok") is False:
        # Node contract: lifecycle runtime rejection surfaces as 502.
        return JSONResponse(
            status_code=502, content={"error": _format_lifecycle_error(lifecycle)}
        )

    cancelled = task_store.cancel_task(
        task_id,
        reason=reason,
        requested_by=_optional_string(body.get("requestedBy")),
        source=_optional_string(body.get("source")) or "user",
    )
    if not cancelled.get("ok"):
        return _store_failure(cancelled)

    return {
        "ok": True,
        "alreadyFinal": bool(cancelled.get("alreadyFinal")),
        # No executor client in the Python slice; dispatch/cancel forwarding stays Node-owned.
        "executorForwarded": False,
        "task": cancelled["task"],
        **({"lifecycle": lifecycle} if lifecycle.get("ok") else {}),
    }
