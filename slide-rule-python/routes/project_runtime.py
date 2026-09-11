"""Internal runtime smoke edge; private browser preview is not yet enabled."""

from __future__ import annotations

import hashlib
import os
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from config.settings import settings
from middlewares.current_user import CurrentUser
from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.project_runtime import ProjectRuntimeService
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, get_project_store
from services.scope_authority import latest_control_plan, plan_execution_authorized
from services.slide_rule_session import load_session
from services.workspace_provider import WorkspaceProviderError


router = APIRouter(tags=["Project runtime"])


class StartRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    port: int = Field(default=5173, ge=1024, le=65535)
    expectedRevision: str
    approvalRef: str


def _approved_reference(state) -> str:
    plan = latest_control_plan(state)
    digest = hashlib.sha256(str(plan.get("planContent", "")).encode("utf-8")).hexdigest()
    return f"{plan.get('planId')}:{plan.get('revision')}:{digest}"


@router.post("/projects/{project_id}/runtime/start")
def start_project_runtime(project_id: str, body: StartRuntimeRequest, viewer: CurrentUser):
    owner_id = str(viewer.id)
    try:
        store = get_project_store()
        project = store.get_project(project_id, owner_id=owner_id)
        state = load_session(project.sessionId)
        if state is None or str(state.ownerId or "") != owner_id:
            raise ProjectNotFound("project_not_found")
        revision = store.get_revision(project_id, owner_id=owner_id)
        if revision.revision != body.expectedRevision:
            raise ProjectConflict("project_revision_conflict")
        if (not plan_execution_authorized(state)
                or body.approvalRef != _approved_reference(state)
                or revision.planRef != body.approvalRef):
            raise HTTPException(status_code=403, detail="project_plan_approval_required")
        # Until durable dispatch and private HTTP/WS transport exist, this route
        # is only for deliberate local administrator smoke runs. Never activate
        # it for production or hand raw provider URLs to browser clients.
        if (settings.NODE_ENV == "production" or os.getenv("NODE_ENV") == "production"
                or os.getenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED") != "1"
                or not viewer.get("is_superuser", False)):
            raise HTTPException(status_code=503, detail="project_preview_not_enabled")
        service = ProjectRuntimeService(store, E2BWorkspaceProvider())
        runtime, preview = service.start(project_id, owner_id=owner_id,
            lease_owner="http-" + uuid.uuid4().hex, port=body.port,
            expected_revision=body.expectedRevision, approval_ref=body.approvalRef)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
    except ProjectConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ProjectStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="project_runtime_unavailable") from exc
    except WorkspaceProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"runtime": runtime.model_dump(mode="json"), "preview": preview.model_dump(mode="json")}


@router.get("/projects/{project_id}/runtime/lease")
def get_project_runtime_lease(project_id: str, viewer: CurrentUser):
    try:
        lease = get_project_store().get_lease(project_id, owner_id=str(viewer.id))
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
    except ProjectStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="project_runtime_unavailable") from exc
    return {"lease": ({"workspaceId": lease.workspaceId, "projectId": lease.projectId,
        "generation": lease.generation, "expiresAt": lease.expiresAt,
        "mountedRevision": lease.mountedRevision} if lease else None)}
