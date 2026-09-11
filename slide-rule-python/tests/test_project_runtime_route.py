from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from services.identity_store import User
from services.project_store import ProjectStore
from routes import project_runtime as route


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'route.db'}")
    plan = {"planId": "plan-1", "revision": 1, "planContent": "Run fixed internal project", "reqId": "request-1"}
    state = SimpleNamespace(ownerId="u1", controlTranscript=[
        {**plan, "kind": "plan_written"}, {**plan, "kind": "plan_approval"}, {**plan, "kind": "plan_approved"}])
    approval = route._approved_reference(state)
    project = store.create_project("s1", owner_id="u1", files={"package.json": "{}", "package-lock.json": "{}"}, template_version="vite-1", plan_ref=approval)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    monkeypatch.setattr(route, "load_session", lambda sid: state)
    monkeypatch.delenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", raising=False)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(route.settings, "NODE_ENV", "development")
    viewer = User(id="u1", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[require_user] = lambda: viewer
    called = []
    def forbidden_provider():
        called.append(True)
        raise AssertionError("provider must not run before authorization and internal gate")
    monkeypatch.setattr(route, "E2BWorkspaceProvider", forbidden_provider)
    with TestClient(app) as client:
        yield SimpleNamespace(store=store, project=project, client=client, state=state,
            viewer=viewer, called=called, body={"expectedRevision": project.currentRevision, "approvalRef": approval},
            url=f"/projects/{project.projectId}/runtime/start")
    store.close()


def test_public_start_remains_closed_before_private_preview(setup):
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == 503 and response.json()["detail"] == "project_preview_not_enabled"
    assert not setup.called


@pytest.mark.parametrize("scenario,status", [("wrong-owner", 404), ("missing-session", 404),
    ("session-owner", 404), ("no-approval", 403), ("changed-plan", 403),
    ("forged-approval", 403), ("stale-revision", 409), ("unknown-command", 422)])
def test_actual_http_path_rejects_invalid_authority_before_side_effects(setup, monkeypatch, scenario, status):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    if scenario == "wrong-owner": setup.viewer["id"] = "mallory"
    if scenario == "missing-session": monkeypatch.setattr(route, "load_session", lambda _: None)
    if scenario == "session-owner": setup.state.ownerId = "mallory"
    if scenario == "no-approval": setup.state.controlTranscript.pop()
    if scenario == "changed-plan": setup.state.controlTranscript[0]["planContent"] = "Different plan"
    if scenario == "forged-approval": setup.body["approvalRef"] = "forged"
    if scenario == "stale-revision": setup.body["expectedRevision"] = "old"
    if scenario == "unknown-command": setup.body["command"] = "unapproved"
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == status
    assert not setup.called


@pytest.mark.parametrize("production,admin", [(True, True), (False, False)])
def test_internal_flag_cannot_enable_production_or_nonadmin_execution(setup, monkeypatch, production, admin):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setenv("NODE_ENV", "production" if production else "development")
    setup.viewer["is_superuser"] = admin
    assert setup.client.post(setup.url, json=setup.body).status_code == 503
    assert not setup.called


def test_internal_authorized_request_reaches_runtime_and_maps_provider_failure(setup, monkeypatch):
    from services.workspace_provider import WorkspaceProviderError
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    class FailingProvider:
        def create(self, **kwargs):
            setup.called.append(True)
            raise WorkspaceProviderError("e2b_create_failed")
    monkeypatch.setattr(route, "E2BWorkspaceProvider", FailingProvider)
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == 502 and response.json()["detail"] == "e2b_create_failed"
    assert setup.called == [True]


def test_settings_production_blocks_internal_flag_without_process_environment(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.setattr(route.settings, "NODE_ENV", "production")
    assert setup.client.post(setup.url, json=setup.body).status_code == 503
    assert not setup.called


def test_lease_response_does_not_expose_provider_metadata(setup):
    lease = setup.store.acquire_lease(setup.project.projectId, owner_id="u1", lease_owner="worker-secret")
    setup.store.renew_lease(setup.project.projectId, owner_id="u1", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="sandbox-secret", process_refs={"rt": "42"})
    response = setup.client.get(f"/projects/{setup.project.projectId}/runtime/lease")
    assert response.status_code == 200
    assert not {"sandboxId", "leaseOwner", "processRefs"}.intersection(response.json()["lease"])
    setup.viewer["id"] = "mallory"
    assert setup.client.get(f"/projects/{setup.project.projectId}/runtime/lease").status_code == 404
