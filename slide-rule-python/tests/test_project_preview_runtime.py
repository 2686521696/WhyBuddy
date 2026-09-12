"""The actual runtime.start owner installs the relay after revision health.

Tests use durable project/session rows and real worker/save/lease code. Only the
remote E2B side is replaced; cloud sockets and browser evidence have their own
smoke. Control exceptions must propagate to the supervisor, never become a
preview 'blocked' save which conceals cancellation or lost ownership.
"""

import json
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app as app_module
from middlewares.current_user import require_user
from services.project_preview_access import PreviewAccessDenied, ProjectPreviewAccess
from services.project_preview_runtime import ProjectPreviewRuntime
from services.project_runtime_worker import ProjectRuntimeSupervisor, _Cancel, _Expired, _RuntimeTask, _Shutdown
from services.project_store import ProjectConflict
from services.workspace_provider import ProcessResult, WorkspaceProviderError

from test_project_preview_access import world
from test_project_runtime_worker import setup, submit, eventually, state
from test_workspace_provider import setup_provider


class TunnelProvider:
    def __init__(self):
        self.calls = []
        self.running = set()
        self.failure = None
        self.after_start = lambda: None
        self.before_start = lambda **_: None

    def start_preview_tunnel(self, handle, **kwargs):
        self.before_start(**kwargs)
        self.calls.append(("start", kwargs))
        if self.failure:
            raise self.failure
        pid = str(80 + len(self.calls))
        self.running.add(pid)
        self.after_start()
        return ProcessResult(pid)

    def is_process_running(self, handle, pid):
        self.calls.append(("probe", pid))
        return pid in self.running

    def stop(self, handle, pid):
        self.calls.append(("stop", pid))
        self.running.discard(pid)


@pytest.fixture
def managed(world, tmp_path):
    bundle = tmp_path / "agent.cjs"
    bundle.write_text("console.log('scoped preview');", encoding="utf-8")
    manager = ProjectPreviewRuntime(world.access, agent_bundle=bundle, clock=lambda: world.clock["now"])
    supervisor = ProjectRuntimeSupervisor(world.store, lambda: None, preview_runtime=manager)
    task = _RuntimeTask(supervisor, "u1", world.lease, world.operation)
    provider = TunnelProvider()
    task.set_provider(provider)
    return SimpleNamespace(world=world, manager=manager, task=task, provider=provider, bundle=bundle)


def test_start_records_intent_before_sending_only_runtime_scoped_configuration(managed):
    world, task, provider = managed.world, managed.task, managed.provider
    def inspect_dispatch(**kwargs):
        saved = world.store.get_operation(world.operation.operationId, owner_id="u1")
        assert saved.result["preview"]["phase"] == "dispatching"
        scope = world.access.authorize_tunnel(kwargs["token"], audience=world.audience)
        assert scope.runtime_id == task.runtime.runtimeId and scope.generation == task.lease.generation
        assert set(kwargs) == {"agent_source", "relay_origin", "token", "port", "expires_at"}
    provider.before_start = inspect_dispatch
    managed.manager.ensure(task)
    saved = world.store.get_operation(world.operation.operationId, owner_id="u1")
    assert saved.result["preview"]["phase"] == "active"
    assert world.store.get_lease(world.project.projectId, owner_id="u1").processRefs["preview"] in provider.running
    token = provider.calls[0][1]["token"]
    assert token not in saved.model_dump_json()
    assert "sandbox-private" not in str(provider.calls) and "g" * 40 not in str(provider.calls)


@pytest.mark.parametrize("control", [_Cancel, _Shutdown, _Expired, ProjectConflict])
def test_control_signals_before_dispatch_are_never_swallowed(managed, monkeypatch, control):
    def stop():
        raise control()
    monkeypatch.setattr(managed.task, "check", stop)
    with pytest.raises(control):
        managed.manager.ensure(managed.task)
    assert not managed.provider.calls
    assert not managed.world.store._q("select id from wb_project_preview_access")


def test_cancel_arriving_during_provider_dispatch_propagates_and_revokes_new_grant(managed):
    world = managed.world
    managed.provider.after_start = lambda: world.store.request_operation_cancel(world.operation.operationId, owner_id="u1")
    with pytest.raises(_Cancel):
        managed.manager.ensure(managed.task)
    saved = world.store.get_operation(world.operation.operationId, owner_id="u1")
    assert saved.result["preview"]["phase"] == "dispatching" and saved.cancelRequested
    assert all(row["revoked_at"] is not None for row in world.store._q("select * from wb_project_preview_access"))


def test_lease_failure_after_remote_dispatch_is_rethrown_without_additional_provider_io(managed, monkeypatch):
    def lost(*_):
        raise ProjectConflict("workspace_lease_lost")
    monkeypatch.setattr(managed.task, "_register", lost)
    with pytest.raises(ProjectConflict, match="lease_lost"):
        managed.manager.ensure(managed.task)
    assert [call[0] for call in managed.provider.calls] == ["start"]
    assert all(row["revoked_at"] is not None for row in managed.world.store._q("select * from wb_project_preview_access"))
    # Persisted dispatching is retained so a replacement worker will not replay.
    assert managed.world.store.get_operation(managed.task.operation_id, owner_id="u1").result["preview"]["phase"] == "dispatching"


def test_provider_timeout_is_blocked_and_never_replayed_implicitly(managed):
    managed.provider.failure = WorkspaceProviderError("transport_lost")
    managed.manager.ensure(managed.task)
    managed.provider.failure = None
    managed.manager.ensure(managed.task)
    assert [call[0] for call in managed.provider.calls] == ["start"]
    assert managed.task.result["preview"] == {"phase": "blocked", "errorCode": "preview_dispatch_uncertain"}
    assert all(row["revoked_at"] is not None for row in managed.world.store._q("select * from wb_project_preview_access"))


def test_recovered_uncertain_dispatch_revokes_known_grant_without_starting(managed):
    grant = managed.world.access.issue_tunnel_grant(managed.task.operation_id, owner_id="u1", audience=managed.world.audience)
    managed.task.result["preview"] = {"phase": "dispatching", "grantId": grant.scope.grant_id,
        "generation": managed.task.lease.generation, "expiresAt": grant.expires_at}
    managed.task.save("ready")
    managed.manager.ensure(managed.task)
    assert not managed.provider.calls
    assert managed.task.result["preview"]["phase"] == "blocked"
    with pytest.raises(PreviewAccessDenied):
        managed.world.access.authorize_tunnel(grant.secret, audience=managed.world.audience)


def test_last_fifteen_seconds_of_runtime_do_not_create_a_rotation_storm(managed):
    managed.manager.ensure(managed.task)
    expiration = managed.task.result["preview"]["expiresAt"]
    assert expiration == managed.task.runtime.expiresAt
    managed.world.clock["now"] = expiration - 14
    for _ in range(4):
        managed.manager.ensure(managed.task)
    assert [call[0] for call in managed.provider.calls].count("start") == 1
    assert not any(call[0] == "stop" for call in managed.provider.calls)


def test_rotation_stops_old_process_then_revokes_old_grant_before_starting_new(managed, monkeypatch):
    managed.task.runtime = managed.task.runtime.model_copy(update={"expiresAt": time.time() + 3600})
    managed.task.save("ready")
    managed.manager.ensure(managed.task)
    old = dict(managed.task.result["preview"])
    managed.world.clock["now"] = old["expiresAt"] - 14
    real_revoke = managed.world.access.revoke_grant
    def revoke(grant_id, **kwargs):
        managed.provider.calls.append(("revoke", grant_id))
        real_revoke(grant_id, **kwargs)
    monkeypatch.setattr(managed.world.access, "revoke_grant", revoke)
    # The fake clock also drives access TTLs; keep the durable lease live in that
    # clock without starting a thread or actually waiting fifteen minutes.
    row = managed.world.store.get_lease(managed.world.project.projectId, owner_id="u1")
    row = row.model_copy(update={"expiresAt": time.time() + 3600})
    managed.world.store._q("update wb_project_lease set payload=$1,expires_at=$2 where project_id=$3",
        [row.model_dump_json(), row.expiresAt, row.projectId])
    managed.manager.ensure(managed.task)
    actions = [call[0] for call in managed.provider.calls]
    assert actions[-3:] == ["stop", "revoke", "start"]
    assert managed.task.result["preview"]["grantId"] != old["grantId"]


def test_failed_stop_revokes_old_access_without_dispatching_replacement(managed, monkeypatch):
    managed.manager.ensure(managed.task)
    old = managed.task.result["preview"]["grantId"]
    managed.provider.running.clear()
    def cannot_stop(*_):
        raise WorkspaceProviderError("stop_unknown")
    monkeypatch.setattr(managed.provider, "stop", cannot_stop)
    with pytest.raises(WorkspaceProviderError, match="stop_unknown"):
        managed.manager.ensure(managed.task)
    assert [call[0] for call in managed.provider.calls].count("start") == 1
    assert managed.world.store._q("select revoked_at from wb_project_preview_access where id=$1", [old])[0]["revoked_at"]


def test_lost_active_process_identity_is_not_blindly_replaced(managed):
    managed.manager.ensure(managed.task)
    lease = managed.task.heartbeat.lease
    managed.task.heartbeat.lease = lease.model_copy(update={"processRefs": {
        key: value for key, value in lease.processRefs.items() if key != "preview"}})
    managed.manager.ensure(managed.task)
    assert managed.task.result["preview"] == {"phase": "blocked", "errorCode": "preview_process_identity_missing"}
    assert [call[0] for call in managed.provider.calls].count("start") == 1


@pytest.fixture
def scanner(setup, tmp_path, monkeypatch):
    store, project, provider, make_worker, _ = setup
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.example.com")
    bundle = tmp_path / "agent.cjs"
    bundle.write_text("console.log('agent')", encoding="utf-8")
    access = ProjectPreviewAccess(store, authorizer=lambda *_: None)
    manager = ProjectPreviewRuntime(access, agent_bundle=bundle)
    sent, stopped = [], []
    def start(handle, **kwargs):
        sent.append(kwargs)
        return ProcessResult(str(84 + len(sent)))
    monkeypatch.setattr(provider, "start_preview_tunnel", start, raising=False)
    monkeypatch.setattr(provider, "stop", lambda _, pid: stopped.append(pid), raising=False)
    return SimpleNamespace(store=store, project=project, provider=provider, make_worker=make_worker,
        manager=manager, access=access, sent=sent, stopped=stopped)


def test_real_scanner_reaches_preview_after_ready_and_revoke_precedes_destroy(scanner, monkeypatch):
    worker = scanner.make_worker(preview_runtime=scanner.manager, lease_ttl=2, lifetime_seconds=60)
    operation = submit(worker, scanner.project)
    eventually(lambda: scanner.sent)
    saved = scanner.store.get_operation(operation.operationId, owner_id="alice")
    eventually(lambda: scanner.store.get_operation(operation.operationId, owner_id="alice").result["preview"]["phase"] == "active")
    assert saved.runtime.status == "ready" and saved.runtime.health == "revision_verified"
    original_destroy = scanner.provider.destroy
    def destroy(handle):
        assert all(row["revoked_at"] is not None for row in scanner.store._q("select * from wb_project_preview_access"))
        return original_destroy(handle)
    monkeypatch.setattr(scanner.provider, "destroy", destroy)
    worker.cancel(operation.operationId, owner_id="alice")
    stopped = eventually(lambda: state(scanner.store, operation, "stopped"))
    assert stopped.status == "cancelled" and not scanner.provider.handles


def test_worker_without_preview_manager_never_calls_tunnel_provider(scanner):
    worker = scanner.make_worker()
    operation = submit(worker, scanner.project)
    eventually(lambda: state(scanner.store, operation, "ready"))
    assert not scanner.sent
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_runtime_exec_does_not_install_preview_agent(scanner):
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = worker.submit_command(scanner.project.projectId, owner_id="alice",
        expected_revision=scanner.project.currentRevision, approval_ref="plan-1", idempotency_key="check", command="check")
    eventually(lambda: state(scanner.store, operation, "executing"))
    assert not scanner.sent
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_actual_scanner_reconciles_lost_registration_without_replaying_tunnel(scanner, monkeypatch):
    real = scanner.store.renew_lease
    failed = []
    def lose_registration(*args, **kwargs):
        if kwargs.get("process_refs", {}).get("preview") and not failed:
            failed.append(True)
            raise ProjectConflict("crash_after_tunnel_dispatch")
        return real(*args, **kwargs)
    monkeypatch.setattr(scanner.store, "renew_lease", lose_registration)
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = submit(worker, scanner.project)
    eventually(lambda: (op if (op := scanner.store.get_operation(operation.operationId, owner_id="alice")).result
        and op.result.get("preview", {}).get("phase") == "blocked" else None))
    assert failed and len(scanner.sent) == 1
    assert all(row["revoked_at"] is not None for row in scanner.store._q("select * from wb_project_preview_access"))
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_restart_rotates_old_generation_without_reinstalling_business_project(scanner):
    first = scanner.make_worker(preview_runtime=scanner.manager)
    operation = submit(first, scanner.project)
    eventually(lambda: scanner.sent)
    eventually(lambda: scanner.store.get_operation(operation.operationId, owner_id="alice").result["preview"]["phase"] == "active")
    old = scanner.store.get_operation(operation.operationId, owner_id="alice").result["preview"]
    first.shutdown()
    second = scanner.make_worker(preview_runtime=scanner.manager)
    eventually(lambda: len(scanner.sent) == 2)
    fresh = eventually(lambda: (op if (op := scanner.store.get_operation(operation.operationId, owner_id="alice")).result["preview"]["phase"] == "active" else None))
    assert fresh.result["preview"]["generation"] > old["generation"]
    assert len(scanner.provider.commands) == 2 and scanner.provider.created == 1
    assert scanner.stopped
    second.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_e2b_tunnel_install_uses_stdin_private_files_and_managed_process(setup_provider):
    provider, handle, fake, _ = setup_provider
    token = "a" * 43
    expires = time.time() + 120
    result = provider.start_preview_tunnel(handle, agent_source="console.log('agent')",
        relay_origin="https://rt-one.preview.example.com", token=token, port=5173, expires_at=expires)
    root, files = json.loads(fake.process.input)
    assert root.startswith("/home/user/.whybuddy-preview/")
    assert set(files) == {"agent.cjs", "config.json"}
    assert json.loads(files["config.json"]) == {"relayOrigin": "https://rt-one.preview.example.com",
        "token": token, "localPort": 5173, "expiresAt": expires * 1000}
    assert result.process_id == "4242"
    assert token not in str(fake.calls) and "provider-test-key" not in str(fake.calls)
    assert root + "/agent.cjs" in fake.calls[-1][0]


@pytest.mark.parametrize("change", [{"token": "management-key"}, {"port": True}, {"port": 22},
    {"expires_at": float("nan")}, {"expires_at": time.time() - 1}, {"agent_source": "x" * (512 * 1024 + 1)},
    {"relay_origin": "http://rt.example.com"}, {"relay_origin": "https://x..example.com"},
    {"relay_origin": "https://user@x.example.com"}, {"relay_origin": "https://x.example.com:99999"},
    {"relay_origin": "https://x.example.com/path"}, {"relay_origin": None}])
def test_tunnel_invalid_configuration_never_reaches_sdk(setup_provider, change):
    provider, handle, fake, _ = setup_provider
    values = {"agent_source": "console.log('agent')", "relay_origin": "https://rt.preview.example.com",
        "token": "a" * 43, "port": 5173, "expires_at": time.time() + 60, **change}
    with pytest.raises(WorkspaceProviderError, match="config_invalid"):
        provider.start_preview_tunnel(handle, **values)
    assert not fake.calls


def test_tunnel_sdk_errors_cannot_export_scoped_token_or_sdk_credentials(setup_provider):
    provider, handle, fake, _ = setup_provider
    fake.process.result = RuntimeError("api_key=provider-test-key token=" + "a" * 43)
    with pytest.raises(WorkspaceProviderError) as caught:
        provider.start_preview_tunnel(handle, agent_source="console.log('agent')",
            relay_origin="https://rt.preview.example.com", token="a" * 43, port=5173, expires_at=time.time() + 60)
    assert str(caught.value) == "e2b_preview_tunnel_start_failed"
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


@pytest.mark.parametrize("configuration", ["complete", "missing", "missing-bundle"])
def test_application_factory_composes_access_and_only_configured_tunnel_manager(world, managed, monkeypatch, configuration):
    monkeypatch.setattr(app_module, "get_project_store", lambda: world.store)
    monkeypatch.setattr(ProjectRuntimeSupervisor, "start", lambda _: None)
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_AGENT_BUNDLE", str(managed.bundle))
    if configuration == "missing": monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    if configuration == "missing-bundle": monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_AGENT_BUNDLE", str(managed.bundle) + ".absent")
    actual = app_module._start_project_runtime_supervisor()
    assert isinstance(actual.preview_access, ProjectPreviewAccess)
    assert (actual.preview_runtime is not None) == (configuration == "complete")


def test_real_application_mounts_preview_owner_and_gateway_routes(world, monkeypatch):
    monkeypatch.setattr(app_module.app.state, "project_preview_access", world.access, raising=False)
    monkeypatch.setitem(app_module.app.dependency_overrides, require_user, lambda: world.viewer)
    # A non-context client does not enter lifespan. Factory composition is
    # exercised above; this request reaches the actual application's mount.
    client = TestClient(app_module.app)
    try:
        snapshot = client.get(f"/api/sliderule/projects/{world.project.projectId}/preview")
        assert snapshot.status_code == 200 and snapshot.json()["operationId"] == world.operation.operationId
        assert snapshot.json()["available"] is False
        response = client.post("/api/sliderule/internal/project-preview/authorize",
            json={"role": "tunnel", "token": "a" * 43, "audience": world.audience})
        assert response.status_code == 401
    finally:
        client.close()
