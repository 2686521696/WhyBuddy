"""Authenticated HTTP edge for starting a persisted project preview."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from middlewares.current_user import CurrentUser
from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.project_runtime import ProjectRuntimeService
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, get_project_store


router = APIRouter(tags=["Project runtime"])


class StartRuntimeRequest(BaseModel):
    port: int = Field(default=5173, ge=1024, le=65535)


@router.post("/projects/{project_id}/runtime/start")
def start_project_runtime(project_id: str, body: StartRuntimeRequest, viewer: CurrentUser):
    owner_id = str(viewer.id)
    try:
        service = ProjectRuntimeService(get_project_store(), E2BWorkspaceProvider())
        runtime, preview = service.start(project_id, owner_id=owner_id,
            lease_owner="http-" + uuid.uuid4().hex, port=body.port)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
    except ProjectConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ProjectStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="project_runtime_unavailable") from exc
    return {"runtime": runtime.model_dump(mode="json"), "preview": preview.model_dump(mode="json")}


@router.get("/projects/{project_id}/runtime/lease")
def get_project_runtime_lease(project_id: str, viewer: CurrentUser):
    try:
        lease = get_project_store().get_lease(project_id, owner_id=str(viewer.id))
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
    except ProjectStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="project_runtime_unavailable") from exc
    return {"lease": lease.model_dump(mode="json") if lease else None}
