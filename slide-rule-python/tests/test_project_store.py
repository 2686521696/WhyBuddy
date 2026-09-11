"""Restart, collision and stale-writer checks against a real SQL database.

The second adapter uses HttpSqlGateway's actual parameter encoding and JSON
transport, backed by SQLite for deterministic contract checks. PostgreSQL wire
compatibility is separately smoke-tested when a dedicated test DB is available.
"""

import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from sqlalchemy import text

from services import project_store as module
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable
from services.sql_gateway import HttpSqlGateway


@pytest.fixture(params=["sql", "http"])
def store(request, tmp_path):
    base = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    if request.param == "sql":
        yield base
    else:
        def respond(req):
            body = json.loads(req.content)
            values = body["params"]
            parts = body["sql"].split("%s")
            sql = "".join(part + (f":p{i}" if i < len(parts) - 1 else "") for i, part in enumerate(parts))
            with base._engine.begin() as conn:
                result = conn.execute(text(sql), {f"p{i}": value for i, value in enumerate(values)})
                rows = [dict(row) for row in result.mappings()] if result.returns_rows else []
            return httpx.Response(200, json={"rows": rows, "truncated": False})
        gateway = HttpSqlGateway("https://project-db.test", "test-only-key")
        gateway._client.close()
        gateway._client = httpx.Client(transport=httpx.MockTransport(respond))
        proxy = ProjectStore(lambda sql, params: gateway.query(sql, params))
        yield proxy
        gateway._client.close()
    base.close()


def create(store, sid="s1", owner="alice"):
    return store.create_project(sid, owner_id=owner, files={"src/main.ts": "original", "package.json": "{}"},
        template_version="vite-1", plan_ref="plan-1")


def commit(store, project, value="updated", **kwargs):
    return store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        files={"src/main.ts": value, "package.json": "{}"}, template_version="vite-1", plan_ref="plan-1", **kwargs)


def operation(store, project, key="call-1"):
    return store.create_operation(project.projectId, owner_id="alice", kind="preview.start", idempotency_key=key,
        expected_revision=project.currentRevision, approval_ref="plan-1", input={"port": 5173})


def test_sources_survive_new_store_and_old_revisions_are_immutable(tmp_path):
    url = f"sqlite:///{tmp_path / 'restart.db'}"
    first = ProjectStore.from_url(url)
    project = create(first)
    revision = commit(first, project)
    first.close()
    second = ProjectStore.from_url(url)
    assert second.get_project(project.projectId, owner_id="alice").currentRevision == revision.revision
    assert second.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "updated"
    assert second.read_files(project.projectId, project.currentRevision, owner_id="alice")["src/main.ts"] == "original"
    second.close()


def test_source_cas_rejects_stale_editor_and_keeps_the_winner(store):
    project = create(store)
    winner = commit(store, project, "winner")
    with pytest.raises(ProjectConflict, match="revision_conflict"):
        commit(store, project, "loser")
    assert store.get_project(project.projectId, owner_id="alice").currentRevision == winner.revision
    assert store.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "winner"


def test_other_owner_cannot_read_write_lease_or_create_same_session(store):
    project = create(store)
    assert store.get_project_for_session("s1", owner_id="bob") is None
    with pytest.raises(ProjectNotFound):
        create(store, owner="bob")
    with pytest.raises(ProjectNotFound):
        store.get_revision(project.projectId, owner_id="bob")
    with pytest.raises(ProjectNotFound):
        store.acquire_lease(project.projectId, owner_id="bob", lease_owner="worker")
    with pytest.raises(ProjectNotFound):
        store.commit_revision(project.projectId, owner_id="bob", expected_revision=project.currentRevision,
            files={"x": "bad"}, template_version="v", plan_ref="p")


def test_create_is_idempotent_and_never_reinitializes_source(store):
    project = create(store)
    revision = commit(store, project)
    again = create(store)
    assert again.projectId == project.projectId
    assert again.currentRevision == revision.revision


def test_failed_publication_never_exposes_uncommitted_revision(store, monkeypatch):
    project = create(store)
    original = store._q
    def fail_publish(sql, params=None):
        if sql.startswith("update wb_project set"):
            return []
        return original(sql, params)
    monkeypatch.setattr(store, "_q", fail_publish)
    with pytest.raises(ProjectConflict):
        commit(store, project)
    rows = original("select id from wb_project_revision where project_id=$1", [project.projectId])
    orphan = next(row["id"] for row in rows if row["id"] != project.currentRevision)
    with pytest.raises(ProjectNotFound):
        store.get_revision(project.projectId, orphan, owner_id="alice")
    assert store.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "original"


def test_expired_worker_cannot_publish_or_renew_after_takeover(store, monkeypatch):
    project = create(store)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    first = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old", ttl_seconds=10)
    with pytest.raises(ProjectConflict):
        store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    with pytest.raises(ProjectConflict):
        commit(store, project)
    clock[0] += 11
    new = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    assert new.generation == first.generation + 1
    with pytest.raises(ProjectConflict):
        commit(store, project, lease_generation=first.generation, lease_owner="old")
    with pytest.raises(ProjectConflict):
        store.renew_lease(project.projectId, owner_id="alice", generation=first.generation, lease_owner="old")
    revision = commit(store, project, lease_generation=new.generation, lease_owner="new")
    renewed = store.renew_lease(project.projectId, owner_id="alice", generation=new.generation, lease_owner="new",
        sandbox_id="sandbox-a", mounted_revision=revision.revision)
    assert renewed.mountedRevision == revision.revision
    store.release_lease(project.projectId, owner_id="alice", generation=new.generation, lease_owner="new")
    third = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="third")
    assert third.generation == new.generation + 1
    assert third.sandboxId == "sandbox-a"


def test_operations_and_events_recover_and_idempotency_detects_changed_input(store):
    project = create(store)
    op = operation(store, project)
    assert operation(store, project).operationId == op.operationId
    with pytest.raises(ProjectConflict, match="idempotency"):
        store.create_operation(project.projectId, owner_id="alice", kind="preview.stop", idempotency_key="call-1",
            expected_revision=project.currentRevision, approval_ref="plan-1")
    running = store.transition_operation(op.operationId, owner_id="alice", expected_status="queued", status="running")
    assert running.status == "running"
    one = store.append_event(op.operationId, owner_id="alice", event_type="log", event_id="chunk-1", payload={"text": "你好"})
    assert store.append_event(op.operationId, owner_id="alice", event_type="log", event_id="chunk-1", payload={"text": "你好"}) == one
    with pytest.raises(ProjectConflict, match="event_idempotency"):
        store.append_event(op.operationId, owner_id="alice", event_type="log", event_id="chunk-1", payload={"text": "different"})
    two = store.append_event(op.operationId, owner_id="alice", event_type="ready")
    assert [e.seq for e in store.list_events(op.operationId, owner_id="alice", after_seq=1)] == [2]
    assert two.seq == 2
    done = store.transition_operation(op.operationId, owner_id="alice", expected_status="running", status="completed", result={"port": 5173})
    assert done.result == {"port": 5173}
    with pytest.raises(ProjectConflict):
        store.transition_operation(op.operationId, owner_id="alice", expected_status="completed", status="running")
    with pytest.raises(ProjectNotFound):
        store.get_operation(op.operationId, owner_id="bob")
    with pytest.raises(ProjectNotFound):
        store.list_events(op.operationId, owner_id="bob")


def test_stale_worker_cannot_complete_operation_or_emit_evidence(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old", ttl_seconds=10)
    store.transition_operation(op.operationId, owner_id="alice", expected_status="queued", status="running",
        lease_generation=lease.generation, lease_owner="old")
    clock[0] += 11
    store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    with pytest.raises(ProjectConflict):
        store.transition_operation(op.operationId, owner_id="alice", expected_status="running", status="completed",
            lease_generation=lease.generation, lease_owner="old")
    with pytest.raises(ProjectConflict):
        store.append_event(op.operationId, owner_id="alice", event_type="passed", lease_generation=lease.generation, lease_owner="old")
    assert store.list_events(op.operationId, owner_id="alice") == []
    assert store.get_operation(op.operationId, owner_id="alice").status == "running"


def test_concurrent_writers_share_cas_and_event_cursor(tmp_path):
    url = f"sqlite:///{tmp_path / 'concurrent.db'}"
    a, b = ProjectStore.from_url(url), ProjectStore.from_url(url)
    project = create(a)
    op = operation(a, project)
    def write_event(index):
        return (a if index % 2 else b).append_event(op.operationId, owner_id="alice", event_type="log", payload={"i": index})
    with ThreadPoolExecutor(max_workers=4) as pool:
        events = list(pool.map(write_event, range(12)))
    assert sorted(e.seq for e in events) == list(range(1, 13))
    assert len({e.payload["i"] for e in b.list_events(op.operationId, owner_id="alice")}) == 12
    a.close()
    b.close()


def test_corrupt_blob_never_restores_as_valid_source(store):
    project = create(store)
    revision = store.get_revision(project.projectId, owner_id="alice")
    store._q("update wb_project_content set content=$1 where hash=$2", ["corrupted", revision.manifest.files[0].sha256])
    with pytest.raises(ProjectStoreUnavailable, match="corrupt"):
        store.read_files(project.projectId, owner_id="alice")


def test_store_failure_never_falls_back_to_memory_or_files(monkeypatch):
    module.reset_project_store()
    monkeypatch.setattr(module, "http_api_credentials", lambda: ("https://broken.test", "test-key"))
    monkeypatch.setattr(module.settings, "APP_STORE_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(HttpSqlGateway, "query", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("offline")))
    with pytest.raises(ProjectStoreUnavailable):
        module.get_project_store()
    assert module._cached_store is None
    monkeypatch.setattr(module, "http_api_credentials", lambda: ("", ""))
    monkeypatch.setattr(module.settings, "APP_STORE_DATABASE_URL", None)
    with pytest.raises(ProjectStoreUnavailable, match="durable_database_required"):
        module.get_project_store()


def test_production_requires_remote_durable_database(monkeypatch):
    module.reset_project_store()
    monkeypatch.setattr(module, "http_api_credentials", lambda: ("", ""))
    monkeypatch.setattr(module.settings, "NODE_ENV", "production")
    monkeypatch.setattr(module.settings, "APP_STORE_DATABASE_URL", "sqlite:///:memory:")
    with pytest.raises(ProjectStoreUnavailable, match="durable_database_required"):
        module.get_project_store()


def test_new_worker_claims_interrupted_operation_before_reconciling(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    first = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old", ttl_seconds=10)
    claimed = store.claim_operation(op.operationId, owner_id="alice", lease_owner="old", generation=first.generation)
    assert claimed.status == "queued"
    store.transition_operation(op.operationId, owner_id="alice", expected_status="queued", status="running",
        result={"remoteProcessId": "42"}, lease_generation=first.generation, lease_owner="old")
    clock[0] += 11
    new = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    recovered = store.claim_operation(op.operationId, owner_id="alice", lease_owner="new", generation=new.generation)
    assert recovered.status == "interrupted"
    assert recovered.result == {"remoteProcessId": "42"}
    assert recovered.requestHash == op.requestHash and recovered.input == op.input
    assert store.claim_operation(op.operationId, owner_id="alice", lease_owner="new", generation=new.generation) == recovered
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="old", generation=first.generation)
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.transition_operation(op.operationId, owner_id="alice", expected_status="interrupted", status="running",
            lease_generation=first.generation, lease_owner="old")
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.append_event(op.operationId, owner_id="alice", event_type="done", lease_generation=first.generation, lease_owner="old")
    event = store.append_event(op.operationId, owner_id="alice", event_type="reconciled", payload={"stopped": True},
        lease_generation=new.generation, lease_owner="new")
    assert event.type == "reconciled"
    cancelled = store.transition_operation(op.operationId, owner_id="alice", expected_status="interrupted", status="cancelled",
        lease_generation=new.generation, lease_owner="new")
    assert cancelled.status == "cancelled"
    with pytest.raises(ProjectConflict, match="state_conflict"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="new", generation=new.generation)
    with pytest.raises(ProjectNotFound):
        store.claim_operation(op.operationId, owner_id="bob", lease_owner="new", generation=new.generation)


def test_claim_checks_current_lease_again_at_cas(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="worker", ttl_seconds=10)
    original = store._q
    def expire_before_write(sql, params=None):
        if sql.startswith("update wb_project_operation set"):
            original("update wb_project_lease set expires_at=0 where project_id=$1", [project.projectId])
        return original(sql, params)
    monkeypatch.setattr(store, "_q", expire_before_write)
    with pytest.raises(ProjectConflict, match="state_or_lease_conflict"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="worker", generation=lease.generation)
    assert store.get_operation(op.operationId, owner_id="alice").leaseGeneration is None


def test_claim_does_not_overwrite_concurrent_operation_progress(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="worker")
    original = store._q
    def race_before_write(sql, params=None):
        if sql.startswith("update wb_project_operation set"):
            original("update wb_project_operation set rev=rev+1 where id=$1", [op.operationId])
        return original(sql, params)
    monkeypatch.setattr(store, "_q", race_before_write)
    with pytest.raises(ProjectConflict, match="state_or_lease_conflict"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="worker", generation=lease.generation)
    assert store.get_operation(op.operationId, owner_id="alice").leaseGeneration is None


def test_release_clears_only_confirmed_runtime_for_the_current_generation(store):
    project = create(store)
    first = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="worker")
    store.renew_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=first.generation,
        sandbox_id="sandbox-old", mounted_revision=project.currentRevision, process_refs={"runtime": "42"})
    store.release_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=first.generation, clear_runtime=True)
    cleared = store.get_lease(project.projectId, owner_id="alice")
    assert cleared.sandboxId is None and cleared.mountedRevision is None and cleared.processRefs == {}
    second = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    store.renew_lease(project.projectId, owner_id="alice", lease_owner="new", generation=second.generation, sandbox_id="sandbox-new")
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.release_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=first.generation, clear_runtime=True)
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sandbox-new"


@pytest.mark.parametrize("quota", ["revisions", "bytes"])
def test_failed_publications_reserve_quota_before_writing_any_source(store, monkeypatch, quota):
    project = create(store)
    if quota == "revisions":
        monkeypatch.setattr(module, "MAX_REVISIONS", 2)
    else:
        monkeypatch.setattr(module, "MAX_SOURCE_HISTORY_BYTES", 10 + 12)
    original = store._q
    def reject_publish(sql, params=None):
        if sql.startswith("update wb_project set"):
            return []
        return original(sql, params)
    monkeypatch.setattr(store, "_q", reject_publish)
    with pytest.raises(ProjectConflict):
        commit(store, project, "0123456789")
    before = original("select hash from wb_project_content")
    with pytest.raises(ValueError, match="project_history_limit"):
        commit(store, project, "abcdefghij")
    assert original("select hash from wb_project_content") == before
    budget = original("select * from wb_project_source_budget where project_id=$1", [project.projectId])[0]
    assert budget["reserved_revisions"] == 2 and budget["reserved_bytes"] == 22
    assert store.get_project(project.projectId, owner_id="alice").currentRevision == project.currentRevision


def test_failed_source_upload_keeps_reservation_after_store_restart(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'failed-upload.db'}"
    store = ProjectStore.from_url(url)
    project = create(store)
    monkeypatch.setattr(module, "MAX_REVISIONS", 2)
    original = store._q
    def fail_upload(sql, params=None):
        if sql.startswith("insert into wb_project_content"):
            raise ProjectStoreUnavailable("upload_interrupted")
        return original(sql, params)
    monkeypatch.setattr(store, "_q", fail_upload)
    with pytest.raises(ProjectStoreUnavailable, match="upload_interrupted"):
        commit(store, project)
    store.close()
    restored = ProjectStore.from_url(url)
    with pytest.raises(ValueError, match="project_history_limit"):
        commit(restored, project)
    assert restored.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "original"
    restored.close()


def test_history_reservation_is_atomic_across_concurrent_failed_writes(store, monkeypatch):
    project = create(store)
    monkeypatch.setattr(module, "MAX_REVISIONS", 3)
    original = store._q
    def reject_publish(sql, params=None):
        if sql.startswith("update wb_project set"):
            return []
        return original(sql, params)
    monkeypatch.setattr(store, "_q", reject_publish)
    def attempt(index):
        try:
            commit(store, project, f"attempt-{index}")
        except (ProjectConflict, ValueError) as exc:
            return str(exc)
    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(attempt, range(10)))
    assert outcomes.count("project_revision_or_lease_conflict") == 2
    assert outcomes.count("project_history_limit") == 8
    assert len(original("select id from wb_project_revision where project_id=$1", [project.projectId])) == 3


def test_existing_orphan_revisions_count_when_budget_is_initialized(store, monkeypatch):
    project = create(store)
    store._write_revision(project.projectId, {"orphan.ts": "unpublished"}, parent=project.currentRevision,
        template_version="v", plan_ref="p", spec_revision=None)
    store._q("delete from wb_project_source_budget where project_id=$1", [project.projectId])
    monkeypatch.setattr(module, "MAX_REVISIONS", 2)
    with pytest.raises(ValueError, match="project_history_limit"):
        commit(store, project)
    assert store.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "original"


def test_failed_initial_upload_cannot_repeatedly_reinitialize_its_budget(store, monkeypatch):
    monkeypatch.setattr(module, "MAX_REVISIONS", 1)
    original = store._q
    def fail_upload(sql, params=None):
        if sql.startswith("insert into wb_project_content"):
            raise ProjectStoreUnavailable("upload_interrupted")
        return original(sql, params)
    monkeypatch.setattr(store, "_q", fail_upload)
    with pytest.raises(ProjectStoreUnavailable, match="upload_interrupted"):
        create(store)
    monkeypatch.setattr(store, "_q", original)
    with pytest.raises(ValueError, match="project_history_limit"):
        create(store)
    assert store.get_project_for_session("s1", owner_id="alice") is None
    assert store._q("select hash from wb_project_content") == []


def test_invalid_or_unleased_write_does_not_consume_history_budget(store):
    project = create(store)
    store.acquire_lease(project.projectId, owner_id="alice", lease_owner="active")
    with pytest.raises(ProjectConflict, match="lease_lost"):
        commit(store, project)
    with pytest.raises(ValueError, match="invalid_project_path"):
        store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            files={"../escape": "bad"}, template_version="v", plan_ref="p")
    budget = store._q("select * from wb_project_source_budget where project_id=$1", [project.projectId])[0]
    assert budget["reserved_revisions"] == 1 and budget["reserved_bytes"] == 10
