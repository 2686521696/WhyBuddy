"""Execute the model-facing tools against real SQL source/session authorities.

No provider runs here: submission uses the real durable supervisor entry, while
lease, source CAS, ownership, approval and output cursors use actual storage.
"""

import json
from types import SimpleNamespace

import pytest
from project_actor_support import project_actor

from models.v5_state import V5SessionState
from models.project_runtime import RuntimeInstance
from plan_approval_support import approved_plan_rows
from services import persistence, project_creation
from services.project_authority import approved_reference
from services.project_manifest import content_hash
from services.project_runtime_worker import ProjectRuntimeSupervisor
from services.project_store import ProjectNotFound, ProjectStore
from services.project_tool_contracts import PROJECT_TOOL_NAMES, PROJECT_TOOLS, PROJECT_WRITE_TOOLS
from services.project_tools import ProjectTools
from services.session_blob_store import SqlSessionBlobStore


@pytest.fixture
def setup(tmp_path, monkeypatch, project_actor):
    project_actor("alice")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *args: sessions)
    state = V5SessionState.server_load({"sessionId": "session-1", "ownerId": "alice",
        "goal": {"text": "Build a task board", "status": "clear"},
        "controlTranscript": approved_plan_rows()})
    sessions.save(state.sessionId, state.model_dump(mode="json"), expected_rev=None)
    files = {"package.json": "{}", "package-lock.json": "{}", "src/App.tsx": "First task\nSecond task\n"}
    monkeypatch.setattr(project_creation, "load_project_template", lambda: (files.copy(), "test-vite-1"))
    provider_calls = []
    def provider():
        provider_calls.append(True)
        raise AssertionError("Model tools may only queue remote execution")
    supervisor = ProjectRuntimeSupervisor(store, provider)
    supervisor._scanner = SimpleNamespace(is_alive=lambda: True)
    tools = ProjectTools(store, supervisor, "alice")
    approval = approved_reference(state)
    yield SimpleNamespace(store=store, sessions=sessions, state=state, tools=tools,
        supervisor=supervisor, approval=approval, files=files, provider_calls=provider_calls)
    store.close()
    sessions._engine.dispose()


def execute(setup, name, args=None, state=None):
    return setup.tools.execute(name, args or {}, state or setup.state)


def create(setup):
    result = execute(setup, "project_create", {"approvalRef": setup.approval})
    assert result["ok"], result
    return result


def change(setup, project, **updates):
    args = {"approvalRef": setup.approval, "expectedRevision": project["revision"],
        "changes": [{"path": "src/App.tsx", "content": "Updated task\n", "expectedSha256": content_hash(setup.files["src/App.tsx"])}]}
    args.update(updates)
    return execute(setup, "project_patch", args)


def rewrite_session(setup, **changes):
    row = setup.sessions.load(setup.state.sessionId)
    payload = {**row.payload, **changes}
    setup.sessions.save(setup.state.sessionId, payload, expected_rev=row.rev)


def test_registry_is_closed_and_mutation_contracts_exclude_identity():
    assert {tool["function"]["name"] for tool in PROJECT_TOOLS} == PROJECT_TOOL_NAMES
    assert PROJECT_WRITE_TOOLS == {"project_create", "project_patch", "project_start", "project_exec", "project_verify", "project_restore"}
    for tool in PROJECT_TOOLS:
        schema = tool["function"]["parameters"]
        assert schema["additionalProperties"] is False
        assert not {"ownerId", "projectId", "sandboxId", "sessionId"}.intersection(schema["properties"])


def test_fresh_model_context_can_discover_and_cancel_saved_work(setup):
    project = create(setup)
    ids = set()
    for index in range(11):
        result = execute(setup, "project_exec", {"approvalRef": setup.approval, "expectedRevision": project["revision"],
            "idempotencyKey": f"check-{index}", "command": "check"})
        assert result["ok"]
        ids.add(result["operationId"])
    first = execute(setup, "project_status")
    assert first["ok"] and len(first["operations"]) == 8 and first["hasMoreOperations"]
    second = execute(setup, "project_status", {"operationCursor": first["nextOperationCursor"]})
    assert len(second["operations"]) == 3 and not second["hasMoreOperations"]
    assert {op["operationId"] for op in first["operations"] + second["operations"]} == ids
    result = execute(setup, "project_cancel", {"operationId": first["operations"][0]["operationId"]})
    assert result["ok"] and result["cancelRequested"]
    assert len(json.dumps(first, ensure_ascii=False)) < 4000
    with pytest.raises(ProjectNotFound, match="project_not_found"):
        setup.store.list_project_operations(project["projectId"], owner_id="outsider")


def test_create_read_patch_and_session_pointer_use_real_persistence(setup):
    project = create(setup)
    assert create(setup)["projectId"] == project["projectId"]
    listed = execute(setup, "project_list")
    assert listed["revision"] == project["revision"]
    assert {f["path"] for f in listed["files"]} == set(setup.files)
    read = execute(setup, "project_read", {"path": "src/App.tsx"})
    assert read["content"] == setup.files["src/App.tsx"]
    assert read["sha256"] == content_hash(read["content"])
    changed = change(setup, project)
    assert changed["ok"] and changed["revision"] != project["revision"]
    assert changed["verification"] == "not_run"
    saved = setup.sessions.load(setup.state.sessionId).payload
    assert saved["runtimeKind"] == "project" and saved["projectRevision"] == changed["revision"]
    assert execute(setup, "project_read", {"path": "src/App.tsx"})["content"] == "Updated task\n"
    assert execute(setup, "project_read", {"path": "src/App.tsx", "revision": project["revision"]})["content"] == read["content"]
    assert not setup.provider_calls


@pytest.mark.parametrize("tool,args", [
    ("project_create", {"ownerId": "alice"}),
    ("project_list", {"projectId": "other"}),
    ("project_read", {"path": "src/App.tsx", "sandboxId": "other"}),
    ("project_search", {"query": "task", "limit": 999}),
    ("project_exec", {"command": "echo unsafe"}),
    ("project_start", {"port": True}),
    ("project_unknown", {}),
])
def test_unknown_identity_and_unbounded_or_arbitrary_inputs_rejected(setup, tool, args):
    create(setup)
    result = execute(setup, tool, args)
    assert not result["ok"]
    assert not setup.provider_calls


@pytest.mark.parametrize("tool", ["project_create", "project_list", "project_read", "project_search", "project_patch", "project_start", "project_exec", "project_status", "project_logs", "project_cancel"])
def test_cached_caller_cannot_bypass_durable_session_owner(setup, tool):
    project = create(setup)
    operation = setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.start",
        idempotency_key="op", expected_revision=project["revision"], approval_ref=setup.approval)
    args = {
        "project_create": {"approvalRef": setup.approval},
        "project_read": {"path": "src/App.tsx"}, "project_search": {"query": "task"},
        "project_patch": {"approvalRef": setup.approval, "expectedRevision": project["revision"],
            "changes": [{"path": "x", "content": "x", "expectedSha256": None}]},
        "project_start": {"approvalRef": setup.approval, "expectedRevision": project["revision"], "idempotencyKey": "new"},
        "project_exec": {"approvalRef": setup.approval, "expectedRevision": project["revision"], "idempotencyKey": "new", "command": "build"},
        "project_logs": {"operationId": operation.operationId}, "project_cancel": {"operationId": operation.operationId},
    }.get(tool, {})
    rewrite_session(setup, ownerId="mallory")
    assert not execute(setup, tool, args)["ok"]
    assert not setup.store.get_operation(operation.operationId, owner_id="alice").cancelRequested
    assert not setup.provider_calls


def test_revoked_plan_blocks_write_but_preserves_owned_reads_and_stop(setup):
    project = create(setup)
    started = execute(setup, "project_start", {"expectedRevision": project["revision"],
        "approvalRef": setup.approval, "idempotencyKey": "start-1"})
    assert started["ok"] and started["status"] == "queued", started
    rewrite_session(setup, controlTranscript=approved_plan_rows()[:-1])
    assert change(setup, project)["error"] == "project_plan_approval_required"
    assert execute(setup, "project_create", {"approvalRef": setup.approval})["error"] == "project_plan_approval_required"
    assert execute(setup, "project_read", {"path": "src/App.tsx"})["ok"]
    assert "approvalRef" not in execute(setup, "project_status")
    cancelled = execute(setup, "project_cancel", {"operationId": started["operationId"]})
    assert cancelled["ok"] and cancelled["cancelRequested"]
    assert not setup.provider_calls


@pytest.mark.parametrize("case,error", [
    ("revision", "project_revision_conflict"), ("hash", "project_file_hash_conflict"),
    ("missing-hash", "project_file_hash_conflict"), ("escape", "invalid_project_path"),
    ("secret", "project_secret_file_forbidden"), ("reserved", "project_reserved_revision_file"),
    ("duplicate", "project_duplicate_change_path"),
])
def test_patch_preconditions_prevent_source_publication(setup, case, error):
    project = create(setup)
    updates = {}
    if case == "revision": updates["expectedRevision"] = "stale"
    if case in {"hash", "missing-hash"}:
        updates["changes"] = [{"path": "src/App.tsx", "content": "Lost update", "expectedSha256": "0" * 64 if case == "hash" else None}]
    if case in {"escape", "secret", "reserved"}:
        path = {"escape": "../escape", "secret": ".env", "reserved": "public/__whybuddy_revision.json"}[case]
        updates["changes"] = [{"path": path, "content": "forbidden", "expectedSha256": None}]
    if case == "duplicate":
        updates["changes"] = [{"path": "new", "content": value, "expectedSha256": None} for value in ("first", "second")]
    result = change(setup, project, **updates)
    assert not result["ok"] and result["error"] == error
    assert setup.store.get_project(project["projectId"], owner_id="alice").currentRevision == project["revision"]
    assert setup.store.read_files(project["projectId"], owner_id="alice") == setup.files


@pytest.mark.parametrize("lease_state", ["active", "expired-sandbox", "expired-dispatch"])
def test_patch_never_writes_into_active_or_unreconciled_workspace(setup, lease_state):
    project = create(setup)
    lease = setup.store.acquire_lease(project["projectId"], owner_id="alice", lease_owner="remote-worker")
    if lease_state != "active":
        setup.store.renew_lease(project["projectId"], owner_id="alice", lease_owner=lease.leaseOwner,
            generation=lease.generation, sandbox_id="remote-sandbox" if lease_state == "expired-sandbox" else None,
            process_refs={"operationId": "unknown-dispatch"} if lease_state == "expired-dispatch" else {})
        setup.store.release_lease(project["projectId"], owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    result = change(setup, project)
    assert not result["ok"]
    assert result["error"] in {"workspace_lease_busy", "project_runtime_reconciliation_required"}
    assert setup.store.read_files(project["projectId"], owner_id="alice") == setup.files
    remaining = setup.store.get_lease(project["projectId"], owner_id="alice")
    if lease_state == "expired-sandbox": assert remaining.sandboxId == "remote-sandbox"
    if lease_state == "expired-dispatch": assert remaining.processRefs == {"operationId": "unknown-dispatch"}


def test_patch_detects_authority_changed_during_source_read(setup, monkeypatch):
    project = create(setup)
    read = setup.store.read_files
    def revoke(*args, **kwargs):
        files = read(*args, **kwargs)
        rewrite_session(setup, controlTranscript=approved_plan_rows()[:-1])
        return files
    monkeypatch.setattr(setup.store, "read_files", revoke)
    assert change(setup, project)["error"] == "project_plan_approval_required"
    assert setup.store.get_project(project["projectId"], owner_id="alice").currentRevision == project["revision"]


def test_literal_search_and_read_cursors_keep_exact_content_under_result_cap(setup):
    setup.files["src/App.tsx"] = ('quoted "task"\t\\\n' * 900) + "the final task"
    project = create(setup)
    offset, text = 0, ""
    while True:
        result = execute(setup, "project_read", {"path": "src/App.tsx", "revision": project["revision"], "offset": offset})
        assert result["ok"] and len(json.dumps(result, ensure_ascii=False)) < 4000
        text += result["content"]
        if not result["truncated"]: break
        assert result["nextOffset"] > offset
        offset = result["nextOffset"]
    assert text == setup.files["src/App.tsx"]
    found = execute(setup, "project_search", {"query": "TASK", "limit": 3})
    assert len(found["matches"]) == 3 and found["truncated"] and found["nextCursor"] == 3
    following = execute(setup, "project_search", {"query": "task", "limit": 3, "cursor": found["nextCursor"], "revision": found["revision"]})
    assert [item["line"] for item in following["matches"]] == [4, 5, 6]
    assert execute(setup, "project_search", {"query": ".*"})["matches"] == []


def test_list_long_paths_has_lossless_cursor_and_stays_below_model_limit(setup):
    setup.files.update({("d" * 180) + f"/{number:03}.ts": "x" for number in range(45)})
    create(setup)
    cursor, paths = 0, []
    while True:
        result = execute(setup, "project_list", {"cursor": cursor})
        assert result["ok"] and len(json.dumps(result, ensure_ascii=False)) < 4000
        paths.extend(item["path"] for item in result["files"])
        if not result["truncated"]: break
        assert result["nextCursor"] > cursor
        cursor = result["nextCursor"]
    assert paths == sorted(setup.files)


@pytest.mark.parametrize("tool", ["project_status", "project_logs", "project_cancel"])
def test_same_owner_cannot_cross_session_operation_boundary(setup, tool):
    project = create(setup)
    other = setup.store.create_project("other-session", owner_id="alice", files={"a": "a"}, template_version="v", plan_ref=setup.approval)
    operation = setup.store.create_operation(other.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key="other", expected_revision=other.currentRevision, approval_ref=setup.approval)
    result = execute(setup, tool, {"operationId": operation.operationId})
    assert result == {"ok": False, "error": "project_operation_not_found"}
    assert not setup.store.get_operation(operation.operationId, owner_id="alice").cancelRequested


def test_durable_logs_continue_inside_large_event_without_leaking_process_identity(setup):
    project = create(setup)
    operation = setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.start",
        idempotency_key="logs", expected_revision=project["revision"], approval_ref=setup.approval)
    lease = setup.store.acquire_lease(project["projectId"], owner_id="alice", lease_owner="worker-secret")
    setup.store.claim_operation(operation.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    expected = []
    for number in range(3):
        text = (f'{number} escaped "line"\n\\' * 370)
        expected.append(text)
        setup.store.append_event(operation.operationId, owner_id="alice", event_type="runtime.log", event_id=f"private-process-{number}",
            payload={"text": text, "processId": "process-secret", "nextOffset": len(text), "truncated": False},
            lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    seq, offset, received = 0, 0, ""
    for _ in range(50):
        result = execute(setup, "project_logs", {"operationId": operation.operationId, "afterSeq": seq, "offset": offset})
        assert result["ok"], result
        encoded = json.dumps(result, ensure_ascii=False)
        assert len(encoded) < 4000 and "process-secret" not in encoded and "worker-secret" not in encoded
        received += "".join(item["text"] for item in result["logs"])
        if not result["hasMore"]: break
        assert (result["nextSeq"], result["nextOffset"]) != (seq, offset)
        seq, offset = result["nextSeq"], result["nextOffset"]
    assert received == "".join(expected)


def test_start_is_durable_idempotent_and_never_executes_provider_inline(setup):
    project = create(setup)
    args = {"expectedRevision": project["revision"], "approvalRef": setup.approval, "idempotencyKey": "start-1"}
    first = execute(setup, "project_start", args)
    second = execute(setup, "project_start", args)
    assert first["ok"] and first == second
    assert first["status"] == "queued" and setup.supervisor._wake.is_set()
    assert execute(setup, "project_start", {**args, "port": 5174})["error"] == "operation_idempotency_conflict"
    assert not setup.provider_calls


@pytest.mark.parametrize("command", ["check", "build", "test"])
def test_fixed_commands_use_real_durable_submit_and_reject_input_changes(setup, command):
    project = create(setup)
    args = {"expectedRevision": project["revision"], "approvalRef": setup.approval,
        "idempotencyKey": "command-1", "command": command}
    queued = execute(setup, "project_exec", args)
    assert queued["ok"] and queued["status"] == "queued" and queued["kind"] == "runtime.exec", queued
    assert execute(setup, "project_exec", args)["operationId"] == queued["operationId"]
    saved = setup.store.get_operation(queued["operationId"], owner_id="alice")
    assert saved.input == {"command": command} and saved.approvalRef == setup.approval
    assert not setup.provider_calls
    assert execute(setup, "project_exec", {**args, "command": "build" if command != "build" else "check"})["error"] == "operation_idempotency_conflict"


def test_status_filters_internal_payload_and_marks_expired_ready_snapshot_unknown(setup):
    project = create(setup)
    operation = setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.exec",
        idempotency_key="status", expected_revision=project["revision"], approval_ref=setup.approval)
    lease = setup.store.acquire_lease(project["projectId"], owner_id="alice", lease_owner="worker-secret")
    setup.store.claim_operation(operation.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    runtime = RuntimeInstance(runtimeId="runtime-1", workspaceId=lease.workspaceId, projectId=project["projectId"],
        revision=project["revision"], status="ready", port=5173, health="ready", lastHeartbeat="now",
        processId="process-secret", previewUrl="https://provider-secret.example")
    setup.store.update_runtime_operation(operation.operationId, owner_id="alice", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=runtime,
        result={"command": "build", "exitCode": 7, "providerToken": "provider-secret", "cleanup": {"handle": "hidden"}})
    result = execute(setup, "project_status", {"operationId": operation.operationId})
    assert result["ok"] and result["runtime"]["status"] == "ready"
    assert result["command"] == "build" and result["exitCode"] == 7
    encoded = json.dumps(result)
    assert "secret" not in encoded and "hidden" not in encoded and "pendingEvent" not in encoded
    setup.store.release_lease(project["projectId"], owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    restored = execute(setup, "project_status", {"operationId": operation.operationId})
    assert restored["runtime"]["status"] == "reconciling" and restored["runtime"]["health"] == "unknown"


def test_unchanged_source_can_bind_new_approved_plan_without_reusing_old_revision(setup):
    project = create(setup)
    rows = approved_plan_rows("Run the existing app and check the build")
    rewrite_session(setup, controlTranscript=rows)
    authority = persistence.load_session_record(setup.state.sessionId)["session"]
    approval = approved_reference(authority)
    result = change(setup, project, approvalRef=approval,
        changes=[{"path": "src/App.tsx", "content": setup.files["src/App.tsx"], "expectedSha256": content_hash(setup.files["src/App.tsx"])}])
    assert result["ok"] and result["revision"] != project["revision"], result
    revision = setup.store.get_revision(project["projectId"], owner_id="alice")
    assert revision.planRef == approval
    assert result["changedFileCount"] == 0 and result["changedFiles"] == []
    assert setup.store.read_files(project["projectId"], owner_id="alice") == setup.files


def test_unbound_creation_record_requires_binding_recovery_before_other_tools(setup):
    project = setup.store.create_project(setup.state.sessionId, owner_id="alice", files=setup.files,
        template_version="test-vite-1", plan_ref=setup.approval)
    assert execute(setup, "project_list") == {"ok": False, "error": "session_project_not_found"}
    start = {"expectedRevision": project.currentRevision, "approvalRef": setup.approval, "idempotencyKey": "unbound"}
    assert execute(setup, "project_start", start) == {"ok": False, "error": "session_project_not_found"}
    repaired = create(setup)
    assert repaired["projectId"] == project.projectId and repaired["revision"] == project.currentRevision
    assert execute(setup, "project_list")["ok"]
    assert not setup.provider_calls
