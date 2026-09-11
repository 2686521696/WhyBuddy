"""Create a fixed source project from a durably approved product session.

Source creation and the conversation store cannot share one transaction. The
session-unique project identity repairs a crash between them, while binding
rechecks approval inside session persistence CAS. Source revisions remain the
authority; the session pointer is a repairable projection.
"""

from __future__ import annotations

from pathlib import Path

from models.project_runtime import Project
from models.v5_state import V5SessionState
from services import persistence
from services.control_checkpoint import current_checkpoint
from services.project_authority import approved_reference, assert_session_authorized, has_generated_application
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable

TEMPLATE_VERSION = "whybuddy-react-vite-1"
TEMPLATE_ROOT = Path(__file__).resolve().parents[2] / "project-templates" / "react-vite"
TEMPLATE_FILES = (
    "package.json", "package-lock.json", "tsconfig.json", "index.html",
    "src/main.tsx", "src/counter.mjs", "src/style.css", "tests/counter.test.mjs",
)


def load_project_template() -> tuple[dict[str, str], str]:
    try:
        files = {name: (TEMPLATE_ROOT / name).read_text(encoding="utf-8") for name in TEMPLATE_FILES}
    except (OSError, UnicodeError) as exc:
        raise ProjectStoreUnavailable("project_template_unavailable") from exc
    return files, TEMPLATE_VERSION


def load_authorized_session(session_id: str, *, owner_id: str,
                            approval_ref: str | None = None) -> V5SessionState:
    result = persistence.load_session_record(session_id)
    if not result.get("ok"):
        if result.get("reason") == "not_found" or result.get("error") == "not_found":
            raise ProjectNotFound("project_session_not_found")
        raise ProjectStoreUnavailable("project_session_store_unavailable")
    state = result.get("session")
    if not owner_id or not isinstance(state, V5SessionState) or state.ownerId != owner_id:
        raise ProjectNotFound("project_session_not_found")
    if approval_ref is not None:
        assert_session_authorized(state, owner_id=owner_id, approval_ref=approval_ref)
    return state


def _save_reference(state: V5SessionState, project: Project, approval_ref: str) -> V5SessionState:
    port = current_checkpoint.get()
    if port is not None:
        port.guard()
    candidate = state.model_copy(update={"runtimeKind": "project", "projectId": project.projectId,
                                         "projectRevision": project.currentRevision})
    result = persistence.save_session_record(candidate, server_write=True,
        project_binding_approval=approval_ref,
        expected_project_revision=state.projectRevision if state.projectId else None,
        expected_control_run=port.fence() if port is not None else None)
    if not result.get("ok") or not isinstance(result.get("state"), V5SessionState):
        raise ProjectStoreUnavailable("project_session_binding_failed")
    authoritative = result["state"]
    sink = persistence.get_cache_sink()
    if sink is not None:
        sink(authoritative.sessionId, authoritative)
    return authoritative


def sync_session_project(store: ProjectStore, session_id: str, *, owner_id: str,
                         approval_ref: str) -> V5SessionState:
    for _ in range(6):
        state = load_authorized_session(session_id, owner_id=owner_id, approval_ref=approval_ref)
        project = store.get_project_for_session(session_id, owner_id=owner_id)
        if project is None:
            raise ProjectNotFound("project_not_found")
        if state.projectId and state.projectId != project.projectId:
            raise ProjectConflict("project_identity_changed")
        revision = store.get_revision(project.projectId, owner_id=owner_id)
        if not state.projectId and revision.planRef != approval_ref:
            raise ProjectConflict("project_initial_plan_changed")
        try:
            saved = _save_reference(state, project, approval_ref)
        except persistence.PersistClosedError as exc:
            if exc.reason == "project_revision_conflict":
                continue
            if exc.reason == "project_plan_approval_required":
                raise PermissionError(exc.reason) from exc
            if exc.reason in {"project_conversion_required", "project_identity_changed", "session_owner_changed"}:
                raise ProjectConflict(exc.reason) from exc
            raise ProjectStoreUnavailable("project_session_binding_failed") from exc
        current = store.get_project(project.projectId, owner_id=owner_id)
        if saved.projectRevision == current.currentRevision:
            return saved
    raise ProjectConflict("project_reference_sync_conflict")


def create_session_project(store: ProjectStore, session_id: str, *, owner_id: str,
                           approval_ref: str) -> Project:
    state = load_authorized_session(session_id, owner_id=owner_id, approval_ref=approval_ref)
    if not state.projectId and has_generated_application(state):
        raise ProjectConflict("project_conversion_required")
    existing = store.get_project_for_session(session_id, owner_id=owner_id)
    if state.projectId and (existing is None or state.projectId != existing.projectId):
        raise ProjectConflict("project_identity_changed")
    if existing is None:
        files, version = load_project_template()
        existing = store.create_project(session_id, owner_id=owner_id, files=files,
            template_version=version, plan_ref=approval_ref)
    sync_session_project(store, session_id, owner_id=owner_id, approval_ref=approval_ref)
    return store.get_project(existing.projectId, owner_id=owner_id)
