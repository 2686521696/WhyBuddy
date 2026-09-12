"""Durable runtime commands and cursor-based observation; private preview stays gated.

HTTP owns no remote process. Dropping a response cannot cancel an operation;
the explicit cancel endpoint persists intent even while the worker is offline.
"""

from __future__ import annotations

import time
from contextlib import contextmanager

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from config.settings import settings
from middlewares.current_user import CurrentUser
from models.project_runtime import ProjectOperationSnapshot, RuntimeEventPage
from services.project_runtime_worker import approved_reference as _approved_reference
from services.project_access import project_access_enabled
from services.project_creation import create_session_project, load_authorized_session
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, get_project_store


router = APIRouter(tags=["Project runtime"])


class StartRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    port: int = Field(default=5173, ge=1024, le=65535)
    expectedRevision: str = Field(min_length=1, max_length=256)
    approvalRef: str = Field(min_length=1, max_length=512)
    idempotencyKey: str = Field(min_length=1, max_length=256, pattern=r"\S")


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approvalRef: str = Field(min_length=1, max_length=512)


def _internal_gate(viewer) -> None:
    if not project_access_enabled(viewer):
        raise HTTPException(status_code=503, detail="project_preview_not_enabled")


@contextmanager
def _store_errors():
    try:
        yield
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
    except ProjectConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ProjectStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="project_runtime_unavailable") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="project_plan_approval_required") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _runtime_response(runtime):
    if runtime is None:
        return None
    value = runtime.model_dump(mode="json") if hasattr(runtime, "model_dump") else runtime
    return {key: value.get(key) for key in (
        "runtimeId", "workspaceId", "projectId", "revision", "status", "port", "health",
        "lastHeartbeat", "expiresAt", "errorCode",
    )}


@router.post("/sessions/{session_id}/project", status_code=201)
def create_project(session_id: str, body: CreateProjectRequest, viewer: CurrentUser):
    _internal_gate(viewer)
    with _store_errors():
        project = create_session_project(get_project_store(), session_id,
            owner_id=str(viewer.id), approval_ref=body.approvalRef)
        return {"project": project.model_dump(mode="json"), "verification": "not_run"}


@router.get("/sessions/{session_id}/project")
def get_session_project(session_id: str, viewer: CurrentUser):
    _internal_gate(viewer)
    with _store_errors():
        load_authorized_session(session_id, owner_id=str(viewer.id), approval_ref=None)
        project = get_project_store().get_project_for_session(session_id, owner_id=str(viewer.id))
        return {"project": project.model_dump(mode="json") if project else None, "verification": "not_run"}


def _snapshot_response(snapshot):
    operation = snapshot["operation"]
    value = operation.model_dump(mode="json")
    runtime = _runtime_response(snapshot["runtime"])
    if (runtime is not None and operation.status not in {"completed", "failed", "cancelled"}
            and (snapshot.get("leaseExpiresAt") or 0) <= time.time()):
        runtime = {**runtime, "status": "reconciling", "health": "unknown", "errorCode": "workspace_lease_expired"}
    return {"operation": {key: value[key] for key in (
        "operationId", "projectId", "sessionId", "kind", "expectedRevision", "status",
        "cancelRequested", "lastAccessAt", "stateVersion", "createdAt", "updatedAt",
    )}, "runtime": runtime, "lastSeq": snapshot["lastSeq"]}


def _event_response(event):
    # Outbox payloads are internal records. A new provider field must not become
    # public merely because a worker starts persisting it.
    payload = {}
    if event.type == "runtime.state":
        payload = {key: event.payload.get(key) for key in (
            "operationId", "status", "cancelRequested", "stateVersion", "updatedAt",
        )}
        payload["runtime"] = _runtime_response(event.payload.get("runtime"))
    elif event.type == "runtime.log":
        payload = {key: event.payload.get(key) for key in ("text", "nextOffset", "truncated")}
    return {"schemaVersion": event.schemaVersion, "sessionId": event.sessionId,
        "projectId": event.projectId, "operationId": event.operationId,
        "seq": event.seq, "type": event.type, "timestamp": event.timestamp, "payload": payload}


@router.post("/projects/{project_id}/runtime/start", status_code=202, response_model=ProjectOperationSnapshot)
def start_project_runtime(project_id: str, body: StartRuntimeRequest, request: Request, viewer: CurrentUser):
    owner_id = str(viewer.id)
    with _store_errors():
        store = get_project_store()
        project = store.get_project(project_id, owner_id=owner_id)
        state = load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=body.approvalRef)
        if state.runtimeKind != "project" or state.projectId != project.projectId:
            raise ProjectConflict("project_session_binding_required")
        revision = store.get_revision(project_id, owner_id=owner_id)
        # The supervisor/store distinguish an identical historical start request
        # from a new stale request. The runtime may already serve a child revision.
        if revision.planRef != body.approvalRef:
            raise PermissionError("project_plan_approval_required")
        _internal_gate(viewer)
        supervisor = getattr(request.app.state, "project_runtime_supervisor", None)
        if supervisor is None or not supervisor.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        operation = supervisor.submit(project_id, owner_id=owner_id,
            expected_revision=body.expectedRevision, approval_ref=body.approvalRef,
            idempotency_key=body.idempotencyKey, port=body.port)
        return _snapshot_response(store.snapshot_operation(operation.operationId, owner_id=owner_id))


@router.get("/project-operations/{operation_id}", response_model=ProjectOperationSnapshot)
def get_project_operation(operation_id: str, viewer: CurrentUser):
    with _store_errors():
        snapshot = get_project_store().snapshot_operation(operation_id, owner_id=str(viewer.id))
        _internal_gate(viewer)
        return _snapshot_response(snapshot)


@router.post("/project-operations/{operation_id}/cancel", status_code=202, response_model=ProjectOperationSnapshot)
def cancel_project_operation(operation_id: str, request: Request, viewer: CurrentUser):
    owner_id = str(viewer.id)
    with _store_errors():
        store = get_project_store()
        store.get_operation(operation_id, owner_id=owner_id)
        _internal_gate(viewer)
        supervisor = getattr(request.app.state, "project_runtime_supervisor", None)
        if supervisor is not None and supervisor.running:
            supervisor.cancel(operation_id, owner_id=owner_id)
        else:
            store.request_operation_cancel(operation_id, owner_id=owner_id)
        return _snapshot_response(store.snapshot_operation(operation_id, owner_id=owner_id))


@router.get("/project-operations/{operation_id}/events", response_model=RuntimeEventPage)
def list_project_operation_events(operation_id: str, viewer: CurrentUser,
        afterSeq: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=200)):
    with _store_errors():
        store = get_project_store()
        store.get_operation(operation_id, owner_id=str(viewer.id))
        _internal_gate(viewer)
        events = store.list_events(operation_id, owner_id=str(viewer.id), after_seq=afterSeq, limit=limit + 1)
        selected = events[:limit]
        return {"events": [_event_response(event) for event in selected],
            "nextSeq": selected[-1].seq if selected else afterSeq, "hasMore": len(events) > limit}


@router.post("/project-operations/{operation_id}/touch", response_model=ProjectOperationSnapshot)
def touch_project_operation(operation_id: str, viewer: CurrentUser):
    owner_id = str(viewer.id)
    with _store_errors():
        store = get_project_store()
        store.get_operation(operation_id, owner_id=owner_id)
        _internal_gate(viewer)
        store.touch_operation(operation_id, owner_id=owner_id)
        return _snapshot_response(store.snapshot_operation(operation_id, owner_id=owner_id))


@router.get("/projects/{project_id}/runtime/lease")
def get_project_runtime_lease(project_id: str, viewer: CurrentUser):
    with _store_errors():
        lease = get_project_store().get_lease(project_id, owner_id=str(viewer.id))
        return {"lease": ({"workspaceId": lease.workspaceId, "projectId": lease.projectId,
            "generation": lease.generation, "expiresAt": lease.expiresAt,
            "mountedRevision": lease.mountedRevision} if lease else None)}
