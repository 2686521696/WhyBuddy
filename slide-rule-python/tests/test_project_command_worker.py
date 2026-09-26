"""Actual durable dispatch and recovery for fixed project commands."""

import threading
import time

import pytest
from project_actor_support import project_actor

from models.v5_state import V5SessionState
from services import persistence
from services.project_authority import approved_reference
from services.project_runtime_worker import ProjectRuntimeSupervisor, authorize_operation
from services.project_store import ProjectConflict, ProjectStore
from services.workspace_provider import ProcessLogChunk, ProcessResult, WorkspaceProviderError
from test_project_runtime_worker import Provider, eventually, setup, state


class CommandProvider(Provider):
    command_code = 0
    command_running = False
    missing_command_pid = False

    def start_process(self, handle, command, **kwargs):
        if command.startswith("npm ci"):
            return super().start_process(handle, command, **kwargs)
        self.commands.append(command)
        return ProcessResult(None if self.missing_command_pid else "44")

    def process_result(self, handle, pid):
        if pid == "44":
            return ProcessResult(pid, exit_code=self.command_code)
        return super().process_result(handle, pid)

    def is_process_running(self, handle, pid):
        if pid == "44":
            return handle.sandbox_id in self.handles and self.command_running
        return super().is_process_running(handle, pid)

    def read_process_logs(self, handle, pid, *, offset=0):
        if pid == "44":
            content = "actual command output\n".encode()
            return ProcessLogChunk(content[offset:].decode(), len(content))
        return super().read_process_logs(handle, pid, offset=offset)


@pytest.fixture
def command_setup(setup):
    store, project, _, make_worker, url = setup
    provider = CommandProvider()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    return store, project, provider, worker, url


def submit(worker, project, *, command="check", key="command-1"):
    return worker.submit_command(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key=key, command=command)


@pytest.mark.parametrize("command", ["check", "build", "test"])
def test_command_runs_fixed_script_returns_real_result_and_reclaims_workspace(command_setup, command):
    store, project, provider, worker, _ = command_setup
    operation = submit(worker, project, command=command)
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.kind == "runtime.exec" and finished.status == "completed"
    assert finished.result["command"] == command and finished.result["exitCode"] == 0
    assert finished.result["errorCode"] is None
    assert provider.commands == ["npm ci --ignore-scripts", f"npm run {command}"]
    assert not provider.handles and provider.created == 1
    assert submit(worker, project, command=command).operationId == operation.operationId
    assert any(e.type == "runtime.log" and e.payload["text"] == "actual command output\n"
        for e in store.list_events(operation.operationId, owner_id="alice"))
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").sandboxId is None)


@pytest.mark.parametrize("exit_code,error", [(9, "project_command_failed"), (None, "project_command_result_unknown")])
def test_nonzero_or_unknown_exit_never_reports_success(command_setup, exit_code, error):
    store, project, provider, worker, _ = command_setup
    provider.command_code = exit_code
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.status == "failed" and failed.result["errorCode"] == error
    assert failed.result["exitCode"] == exit_code and failed.result["command"] == "check"
    assert not provider.handles


@pytest.mark.parametrize("command", ["", "lint", "build --if-present", "check; exit 0", None, []])
def test_command_allowlist_rejects_arbitrary_dispatch(command_setup, command):
    _, project, provider, worker, _ = command_setup
    with pytest.raises(ValueError, match="invalid_project_command"):
        submit(worker, project, command=command)
    assert not provider.created and not provider.commands


def test_sandbox_script_runs_the_raw_line_not_npm_run_shell(command_setup):
    store, project, provider, worker, _ = command_setup
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="ls-1", command="shell", script="ls src")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["command"] == "ls src"
    assert provider.commands == ["npm ci --ignore-scripts", "ls src"]


def test_pty_stdin_reaches_the_running_command(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.command_running = True
    provider.stdin = []

    def write_console(handle, pid, data, *, press_enter=True):
        provider.stdin.append((pid, data, press_enter))

    provider.write_console = write_console
    operation = submit(worker, project)
    eventually(lambda: provider.commands[-1:] == ["npm run check"])
    worker.enqueue_stdin(operation.operationId, owner_id="alice", text="yes", press_enter=True)
    eventually(lambda: provider.stdin == [("44", "yes", True)])
    provider.command_running = False
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed"


def test_reusing_idempotency_key_for_a_different_command_conflicts(command_setup):
    _, project, provider, worker, _ = command_setup
    provider.command_running = True
    submit(worker, project)
    with pytest.raises(ProjectConflict, match="idempotency"):
        submit(worker, project, command="build")


@pytest.mark.parametrize("phase", ["installing", "executing"])
def test_command_restart_reconnects_saved_pid_without_dispatching_twice(command_setup, phase):
    store, project, provider, first, url = command_setup
    provider.install_running = phase == "installing"
    provider.command_running = True
    operation = submit(first, project)
    eventually(lambda: state(store, operation, phase))
    first.shutdown()
    previous = list(provider.commands)
    assert store.get_operation(operation.operationId, owner_id="alice").result["phase"] == phase
    reopened = ProjectStore.from_url(url)
    second = ProjectRuntimeSupervisor(reopened, lambda: provider, authorizer=lambda *args: None,
        poll_interval=0.02, lease_ttl=1, lifetime_seconds=30, idle_seconds=20)
    try:
        second.start()
        eventually(lambda: state(reopened, operation, phase))
        assert provider.commands == previous and provider.created == 1
        provider.install_running = False
        eventually(lambda: state(reopened, operation, "executing"))
        provider.command_running = False
        finished = eventually(lambda: state(reopened, operation, "stopped"))
        assert finished.status == "completed" and finished.result["exitCode"] == 0
        assert provider.commands == ["npm ci --ignore-scripts", "npm run check"]
        assert not provider.handles
    finally:
        second.shutdown()
        reopened.close()


@pytest.mark.parametrize("phase", ["installing", "executing"])
def test_command_cancellation_stops_remote_work_without_fabricating_an_exit(command_setup, phase):
    store, project, provider, worker, _ = command_setup
    provider.install_running = phase == "installing"
    provider.command_running = True
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, phase))
    worker.cancel(operation.operationId, owner_id="alice")
    cancelled = eventually(lambda: state(store, operation, "stopped"))
    assert cancelled.status == "cancelled" and cancelled.result["exitCode"] is None
    assert cancelled.result["errorCode"] == "user_cancelled" and not provider.handles


def test_missing_command_pid_is_failed_and_workspace_is_destroyed(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.missing_command_pid = True
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.runtime.errorCode == "project_process_identity_missing"
    assert failed.result["exitCode"] is None and not provider.handles


def test_unknown_command_dispatch_is_never_replayed(command_setup, monkeypatch):
    store, project, provider, worker, _ = command_setup
    original = store.renew_lease
    interrupted = threading.Event()

    def lose_command_identity(*args, **kwargs):
        if kwargs.get("process_refs", {}).get("command") and not interrupted.is_set():
            interrupted.set()
            raise ProjectConflict("crash_after_command_dispatch")
        return original(*args, **kwargs)

    monkeypatch.setattr(store, "renew_lease", lose_command_identity)
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.runtime.errorCode == "runtime_dispatch_uncertain"
    assert failed.result["exitCode"] is None
    assert provider.commands == ["npm ci --ignore-scripts", "npm run check"] and not provider.handles


def test_successful_command_waits_for_cleanup_before_reporting_completion(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.cleanup_error = True
    operation = submit(worker, project)
    pending = eventually(lambda: state(store, operation, "reconciling"))
    assert pending.status == "interrupted" and pending.result["exitCode"] == 0
    assert pending.result["errorCode"] == "project_cleanup_pending" and provider.handles
    provider.cleanup_error = False
    completed = eventually(lambda: state(store, operation, "stopped"))
    assert completed.status == "completed" and completed.result["errorCode"] is None
    assert provider.commands == ["npm ci --ignore-scripts", "npm run check"] and not provider.handles


def test_command_budget_expiry_is_a_failure_not_a_completed_build(command_setup):
    store, project, provider, worker, _ = command_setup
    worker.lifetime_seconds = 1
    provider.command_running = True
    operation = submit(worker, project)
    expired = eventually(lambda: state(store, operation, "expired"))
    assert expired.status == "failed" and expired.result["exitCode"] is None
    assert expired.result["errorCode"] == "runtime_budget_exhausted" and not provider.handles


def test_provider_missing_completion_record_is_failure_with_no_invented_exit(command_setup, monkeypatch):
    store, project, provider, worker, _ = command_setup
    original = provider.process_result

    def missing_result(handle, pid):
        if pid == "44":
            raise WorkspaceProviderError("e2b_process_result_unavailable")
        return original(handle, pid)

    monkeypatch.setattr(provider, "process_result", missing_result)
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["exitCode"] is None
    assert failed.result["errorCode"] == "e2b_process_result_unavailable" and not provider.handles


def test_install_failure_is_reported_separately_from_command_result(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.install_code = 13
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["installExitCode"] == 13 and failed.result["exitCode"] is None
    assert failed.result["command"] == "check" and failed.result["errorCode"] == "project_dependency_install_failed"
    assert provider.commands == ["npm ci --ignore-scripts"] and not provider.handles


def test_plan_revocation_during_install_prevents_command_dispatch(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.install_running = True
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, "installing"))
    def revoked(*args):
        raise PermissionError("project_plan_approval_required")
    worker.authorizer = revoked
    provider.install_running = False
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["errorCode"] == "project_plan_approval_required"
    assert provider.commands == ["npm ci --ignore-scripts"] and not provider.handles


@pytest.mark.parametrize("approved", [True, False])
def test_default_command_authority_reads_real_persisted_session(command_setup, tmp_path, monkeypatch, approved):
    store, _, provider, worker, _ = command_setup
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: None)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "durable-session.json"))
    plan = {"planId": "command-plan", "revision": 1, "planContent": "Run project checks", "reqId": "req-1"}
    kinds = ("plan_written", "plan_approval", "plan_approved") if approved else ("plan_written", "plan_approval")
    session = V5SessionState(sessionId="durable-command", ownerId="alice", goal={"text": "Check project"},
        controlTranscript=[{**plan, "kind": kind} for kind in kinds])
    assert persistence.save_session_record(session, server_write=True)["ok"]
    ref = approved_reference(session)
    project = store.create_project(session.sessionId, owner_id="alice", files={"package.json": "{}", "package-lock.json": "{}"},
        template_version="fixed-1", plan_ref=ref)
    worker.authorizer = authorize_operation
    args = dict(owner_id="alice", expected_revision=project.currentRevision, approval_ref=ref, idempotency_key="durable")
    if approved:
        from services.project_creation import sync_session_project
        sync_session_project(store, session.sessionId, owner_id="alice", approval_ref=ref)
        operation = worker.submit_command(project.projectId, **args)
        assert eventually(lambda: state(store, operation, "stopped")).status == "completed"
    else:
        with pytest.raises(PermissionError, match="project_plan_approval_required"):
            worker.submit_command(project.projectId, **args)
        assert not provider.created


def test_queued_stale_revision_fails_and_releases_lease_instead_of_retrying_forever(command_setup, tmp_path, monkeypatch):
    from services.project_creation import create_session_project
    store, _, provider, worker, _ = command_setup
    worker.shutdown()
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: None)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "stale-session.json"))
    plan = {"planId": "p", "revision": 1, "planContent": "Check source", "reqId": "req"}
    session = V5SessionState(sessionId="stale-command", ownerId="alice", goal={"text": "Check source"},
        controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
    persistence.save_session_record(session, server_write=True)
    ref = approved_reference(session)
    project = create_session_project(store, session.sessionId, owner_id="alice", approval_ref=ref)
    old = store.create_operation(project.projectId, owner_id="alice", kind="runtime.exec", idempotency_key="stale",
        expected_revision=project.currentRevision, approval_ref=ref, input={"command": "check"})
    files = store.read_files(project.projectId, owner_id="alice")
    files["src/main.tsx"] += "\n// next revision\n"
    latest = store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        files=files, template_version="fixed-1", plan_ref=ref)
    worker.authorizer = authorize_operation
    worker.start()
    failed = eventually(lambda: state(store, old, "failed"))
    assert failed.status == "failed" and failed.result["errorCode"] == "project_revision_conflict"
    assert not provider.created
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").expiresAt <= time.time())
    next_operation = worker.submit_command(project.projectId, owner_id="alice", expected_revision=latest.revision,
        approval_ref=ref, idempotency_key="current")
    assert eventually(lambda: state(store, next_operation, "stopped")).status == "completed"


def test_office_workspace_bash_skips_npm_ci(command_setup):
    """真机 sr-20260921102816-KWETH78PZ0：办公工作区 bash 被锁文件闸打死。

    必须跑 worker，不许重抄 skip 条件。npm ci 出现 = 又接到 Vite 开箱上。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files

    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-office-bash", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="py-ver", command="shell",
        script="python3 --version")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    assert finished.result["command"] == "python3 --version"
    assert provider.commands == ["python3 --version"]
    assert provider.created == 1


def test_office_readme_tree_skips_npm_even_if_revision_says_vite(command_setup):
    """⚠ 2026-09-21 13ME64TF8Z：树是 README，revision 不是 workspace-1，
    echo hello 仍 project_lockfile_or_reserved_path_invalid。
    """
    from services.deliverable_kind import WORKSPACE_README

    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-office-vite-rev", owner_id="alice",
        files={"README.md": WORKSPACE_README,
               "scripts/generate_kickoff_pptx.py": "print(1)\n"},
        template_version="whybuddy-react-vite-1", plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="hello", command="shell",
        script="echo hello")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    assert provider.commands == ["echo hello"]
    assert "npm ci --ignore-scripts" not in provider.commands


def test_readme_only_bash_skips_npm_when_skip_helper_returns_false(command_setup, monkeypatch):
    """⚠ 2026-09-22 Z8NPKNM14C：助手若返回 False，只有 README 的 bash 仍不许 lockfile。

    把 worker 里 `bare → skip_install = True` 删掉，本条变红。
    """
    import services.project_runtime_worker as worker_mod
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files

    monkeypatch.setattr(worker_mod, "skip_vite_dependency_install", lambda **_k: False)
    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-office-skip-false", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="skip-false", command="shell",
        script="echo hello")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    assert provider.commands == ["echo hello"]
    assert "npm ci --ignore-scripts" not in provider.commands


def test_vite_exec_without_lockfile_still_fails(command_setup):
    """反向：网页工程缺锁文件仍 fail-closed。把 skip 写成「没有 lockfile 就跳过」必须红。"""
    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-vite-nolock", owner_id="alice",
        files={"package.json": "{}"}, template_version="whybuddy-react-vite-1",
        plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="no-lock", command="shell",
        script="python3 --version")
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["errorCode"] == "project_lockfile_or_reserved_path_invalid"
    assert provider.created == 0 and provider.commands == []


def test_office_bash_reuses_one_sandbox_and_names_the_pptx(command_setup):
    """⚠ 2026-09-22 BABCJGGB44：每条 bash 拆沙盒，装上的库和 pptx 下一条就没了，
    模型只好把文件 base64 塞进日志。

    第二条办公命令不得再 create。删掉 reused / keepSandbox，created 变成 2，本条变红。
    Vite 工程仍拆掉，见 test_command_runs_fixed_script_returns_real_result_and_reclaims_workspace。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files
    from services.project_tools import _command_pointer, operation_snapshot

    store, _, provider, worker, _ = command_setup
    pptx = b"PK\x03\x04" + b"kickoff"
    provider.collect_office_files = lambda _handle: [{"path": "kickoff.pptx", "data": pptx}]
    project = store.create_project(
        "session-office-reuse", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")

    def office_bash(key, script):
        return worker.submit_command(
            project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            approval_ref="plan-1", idempotency_key=key, command="shell", script=script)

    first = office_bash("build-deck", "python3 build_deck.py")
    built = eventually(lambda: state(store, first, "stopped"))
    assert built.status == "completed" and built.result["exitCode"] == 0
    assert provider.created == 1 and "sandbox-1" in provider.handles
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sandbox-1"
    assert built.result["officeFiles"] == ["kickoff.pptx"]
    snap = operation_snapshot(store.snapshot_operation(first.operationId, owner_id="alice"))
    assert snap["officeFiles"] == ["kickoff.pptx"]
    receipt = _command_pointer(snap, "saved kickoff.pptx")
    assert "kickoff.pptx" in receipt["hint"] and "base64" in receipt["hint"]
    assert "npm ci --ignore-scripts" not in provider.commands
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").expiresAt <= time.time())

    second = office_bash("import-pptx", "python3 -c \"import pptx\"")
    again = eventually(lambda: state(store, second, "stopped"))
    assert again.status == "completed" and again.result["exitCode"] == 0
    assert provider.created == 1 and "sandbox-1" in provider.handles
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sandbox-1"
    assert provider.commands == ["python3 build_deck.py", 'python3 -c "import pptx"']


def test_office_template_keeps_sandbox_after_package_json_appears(command_setup):
    """⚠ 2026-09-24 MB5NJX8X2D：办公区补了 package.json 之后每条命令拆沙盒。

    模板是 whybuddy-workspace-1 就留下沙盒，不许 npm ci。
    把 skip 改回「看见 package.json 就 False」，created 变成 2，本条变红。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION

    store, _, provider, worker, _ = command_setup
    provider.collect_office_files = lambda _handle: []
    project = store.create_project(
        "session-office-pkg", owner_id="alice",
        files={"README.md": "office\n", "package.json": "{}\n", "package-lock.json": "{}\n"},
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    first = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="one", command="shell", script="python3 build.py")
    built = eventually(lambda: state(store, first, "stopped"))
    assert built.status == "completed", built.result
    assert built.result.get("keepSandbox") is True
    assert built.result.get("officeScan") == "empty"
    assert "npm ci" not in " ".join(provider.commands)
    assert "template=whybuddy-workspace-1" in str(built.result.get("gate") or "")
    from services.project_tools import _command_pointer, operation_snapshot
    snap = operation_snapshot(store.snapshot_operation(first.operationId, owner_id="alice"))
    receipt = _command_pointer(snap, "")
    # skip=True 留在操作记录。抄回快照，模型把它读成「命令没跑」。
    assert "gate" not in snap and "gate" not in receipt
    assert "skip=" not in str(receipt)
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").expiresAt <= time.time())
    second = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="two", command="shell", script="python3 build.py")
    again = eventually(lambda: state(store, second, "stopped"))
    assert again.status == "completed"
    assert provider.created == 1


def test_empty_office_scan_is_a_fact_and_failed_stderr_is_the_excerpt(command_setup):
    """退出码 0 但没有合格 pptx：回执写扫描结果，不写禁令。
    失败命令的 stderr 要进 excerpt，不能只剩错误码。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION
    from services.project_tools import _command_log_excerpt, _command_pointer, operation_snapshot
    from services.workspace_provider import ProcessResult

    store, _, provider, worker, _ = command_setup
    provider.collect_office_files = lambda _handle: []
    provider.command_code = 1

    def process_result(handle, pid):
        if pid == "44":
            return ProcessResult(pid, stdout="", stderr="No module named pptx\n", exit_code=1)
        return CommandProvider.process_result(provider, handle, pid)

    provider.process_result = process_result
    project = store.create_project(
        "session-office-scan", owner_id="alice",
        files={"README.md": "office\n"},
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="fail", command="shell",
        script="python3 generate_pptx.py")
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.status == "failed"
    assert failed.result.get("officeScan") == "empty"
    excerpt = _command_log_excerpt(store, operation.operationId, "alice")
    assert "No module named pptx" in excerpt
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    receipt = _command_pointer(snap, excerpt)
    # ⚠ 2026-09-26 sr-20260926043506-7B49NNSE1M：这里原来要求失败命令也挂
    #   「没有合格的办公文件」。失败本身才是消息，这句只是噪声；它留给
    #   「成功跑完却没收回文件」那一种（test_scan_sentence_only_when_it_is_news）。
    assert "没有合格的办公文件" not in receipt["hint"]
    assert "officeScan" not in receipt
    assert "base64" not in receipt["hint"]
    assert receipt["excerpt"] != receipt.get("errorCode")


def test_empty_office_scan_still_names_a_file_already_collected(command_setup):
    """这次没扫到新文件，不等于交付没了。

    ⚠ 2026-09-24 sr-20260924190011：上一间沙盒已经收回 pptx，下一条扫空，
    回执写成「没有合格的办公文件」。模型往源码树写 pending 和 base64 占位。

    删掉扫空时交回产物库路径，本条变红，并出现「没有合格的办公文件」。
    库里一份都没有时仍说扫空，见 test_empty_office_scan_is_a_fact。

    ⚠ 2026-09-24 review：反过来也不许说成这次交付。上一版把旧路径写进
    officeFiles，回执是「办公文件已收回：X。这就是交付」——脚本重新生成
    失败、一个字节没写，模型读到的仍是交付成功。把旧路径写回
    officeFiles，本条后半段变红。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION
    from services.project_office_artifacts import ProjectOfficeArtifactStore
    from services.project_tools import _command_pointer, operation_snapshot

    store, _, provider, worker, _ = command_setup
    provider.collect_office_files = lambda _handle: []
    project = store.create_project(
        "session-office-held", owner_id="alice",
        files={"README.md": "office\n"},
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="为什么要盖楼.pptx",
        data=b"PK\x03\x04" + b"held")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="held", command="shell", script="python3 qa.py")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed", finished.result
    assert finished.result.get("officeScan") is None
    assert finished.result.get("officeFilesHeld") == ["为什么要盖楼.pptx"]
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    receipt = _command_pointer(snap, "")
    assert "为什么要盖楼.pptx" in receipt["hint"]
    assert "没有合格的办公文件" not in receipt["hint"]
    assert "base64" in receipt["hint"]
    # 旧文件不是这条命令的产出：不许出现在 officeFiles，回执不许说成交付。
    assert finished.result.get("officeFiles") is None
    assert "officeFiles" not in receipt
    assert "已收回" not in receipt["hint"] and "这就是交付" not in receipt["hint"]
    assert "没有产出新的办公文件" in receipt["hint"]


def test_web_exec_empty_office_scan_is_not_told_to_the_model(command_setup):
    """网页 npm run build 也会扫。扫空不是「没有合格的办公文件」。

    真机 E2B 的 collect_office_files 一直在，空树返回 []。这套 Provider
    默认没有这个方法，只给办公模板装收集器的用例删掉模板判断也仍是绿的。

    见空就写 officeScan=empty，本条变红。
    办公模板扫空仍要说，见 test_empty_office_scan_is_a_fact。
    真收回的文件不能跟着瞒掉，见下一条。
    """
    from services.project_tools import _command_pointer, operation_snapshot

    store, project, provider, worker, _ = command_setup
    provider.collect_office_files = lambda _handle: []
    operation = submit(worker, project, command="build", key="web-empty-scan")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed", finished.result
    assert finished.result.get("officeScan") is None
    assert finished.result.get("officeFiles") is None
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    receipt = _command_pointer(snap, "vite build done")
    assert "officeScan" not in snap and "officeScan" not in receipt
    assert "没有合格的办公文件" not in receipt["hint"]
    assert "没能扫办公文件" not in receipt["hint"]


def test_web_exec_still_names_a_real_office_file(command_setup):
    """不把空扫写进网页回执，不许因此连真收回的 pptx 一起不说。"""
    from services.project_tools import _command_pointer, operation_snapshot

    store, project, provider, worker, _ = command_setup
    pptx = b"PK\x03\x04" + b"deck"
    provider.collect_office_files = lambda _handle: [{"path": "deck.pptx", "data": pptx}]
    operation = submit(worker, project, command="build", key="web-kept-pptx")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed", finished.result
    assert finished.result.get("officeFiles") == ["deck.pptx"]
    assert finished.result.get("officeScan") is None
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    receipt = _command_pointer(snap, "")
    assert "deck.pptx" in receipt["hint"]
    assert "已收回" in receipt["hint"]
    assert "没有产出新的办公文件" not in receipt["hint"]
    assert "没有合格的办公文件" not in receipt["hint"]


def test_submit_command_only_queues_it_does_not_start_a_worker(command_setup, monkeypatch):
    """入队不是执行。submit_command 回来时不许已经有工人线程在跑。

    ⚠ 2026-09-22 KM48CMNDPE 的修法是在 submit 里 acquire_lease + 起线程
      （`_start_held`）。三处塌了：模型工具当场摸 provider、绕过
      _scan_loop 的 max_workers、一条命令在跑时新命令由排队变成
      workspace_lease_busy。2026-09-23 revert。

    扫描线程是**唯一**的执行入口，这里把它的候选名单掐成空：submit 自己
    还起了工人，就说明入队和执行又合成了一件事。把 `self._wake.set()`
    换回 `self._start_held(operation, owner_id, lease)`，本条变红。
    """
    store, project, provider, worker, _url = command_setup
    monkeypatch.setattr(store, "list_runnable_operations", lambda **_kwargs: [])
    queued = submit(worker, project)
    assert queued.status == "queued"
    time.sleep(0.1)  # 扫描线程转几圈，正常路径这一发也不该被领走
    with worker._lock:
        assert worker._workers == {}, worker._workers
    assert provider.handles == {}, "入队不许建沙盒"
    assert store.get_operation(queued.operationId, owner_id="alice").status == "queued"
    # 租约留给工人。入队顺手占掉，等于第二条新命令直接 workspace_lease_busy。
    lease = store.acquire_lease(project.projectId, owner_id="alice",
        lease_owner="other-worker", ttl_seconds=30)
    store.release_lease(project.projectId, owner_id="alice",
        lease_owner=lease.leaseOwner, generation=lease.generation)


def test_second_command_while_one_is_queued_still_queues(command_setup, monkeypatch):
    """一条命令还在队里，另一把钥匙的新命令仍然是排队，不是租约忙。"""
    store, project, _provider, worker, _url = command_setup
    monkeypatch.setattr(store, "list_runnable_operations", lambda **_kwargs: [])
    first = submit(worker, project, command="check", key="command-1")
    second = submit(worker, project, command="build", key="command-2")
    assert first.operationId != second.operationId
    assert (first.status, second.status) == ("queued", "queued")


def test_office_sandbox_uses_the_office_image_and_vite_does_not(command_setup, monkeypatch):
    """办公工作区才传 WHYBUDDY_OFFICE_E2B_TEMPLATE。网页工程传了就会起错镜像。

    删掉 create(..., template=image)，或对所有工程都传这张镜像，本条变红。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files

    monkeypatch.setenv("WHYBUDDY_OFFICE_E2B_TEMPLATE", "whybuddy-office")
    store, project, provider, worker, _ = command_setup
    office = store.create_project(
        "session-office-image", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        office.projectId, owner_id="alice", expected_revision=office.currentRevision,
        approval_ref="plan-1", idempotency_key="office-image", command="shell",
        script="python3 --version")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed"
    assert provider.templates == ["whybuddy-office"]
    vite = submit(worker, project, command="check", key="vite-image")
    vite_done = eventually(lambda: state(store, vite, "stopped"))
    assert vite_done.status == "completed"
    assert provider.templates == ["whybuddy-office", None]


def test_office_sandbox_without_template_env_stays_on_the_default_image(command_setup, monkeypatch):
    """没配镜像不许拒绝开箱，也不许写死一个模板名。"""
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files

    monkeypatch.delenv("WHYBUDDY_OFFICE_E2B_TEMPLATE", raising=False)
    store, _, provider, worker, _ = command_setup
    office = store.create_project(
        "session-office-default-image", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        office.projectId, owner_id="alice", expected_revision=office.currentRevision,
        approval_ref="plan-1", idempotency_key="office-default-image", command="shell",
        script="python3 --version")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed"
    assert provider.templates == [None]



def test_upload_that_cannot_be_mounted_is_named_in_the_receipt_not_fatal(command_setup, tmp_path, monkeypatch):
    """活路径：真监督器、真执行器、真回执。

    ⚠ 2026-09-23 review：上一版 provider 没有 write_bytes 时直接抛
      `session_upload_mount_unavailable`，这个会话里**所有**命令都起不来。
      现在命令照跑，放不进去的原件在模型看得见的回执里点名。
    这里的假 provider 故意没有 write_bytes——正是那个会让整条命令崩掉的条件。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files
    from services.project_tools import operation_snapshot

    monkeypatch.setenv("SESSION_UPLOAD_ROOT", str(tmp_path / "blobs"))
    store, _, provider, worker, _ = command_setup
    assert not hasattr(provider, "write_bytes")
    project = store.create_project(
        "session-upload-mount", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    store.put_session_upload("session-upload-mount", owner_id="alice",
                             name="报价表.xlsx", data=b"PK\x03\x04sheet")
    op = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="ls-1", command="shell", script="ls")
    done = eventually(lambda: state(store, op, "stopped"))
    assert done.status == "completed", (done.status, done.result)
    snap = operation_snapshot(store.snapshot_operation(op.operationId, owner_id="alice"))
    assert snap["uploadsSkipped"] == ["报价表.xlsx"], snap


@pytest.mark.parametrize("script,failed", [
    # 看日志：命令本身成功，日志里的 Traceback 是被查看的内容。
    ("cat error.log", False),
    ("grep -rn Traceback .", False),
    # 真起了 Python、被管道吞掉退出码：Traceback 是它自己的。
    ("python3 gen.py | tail -20", True),
])
def test_traceback_in_the_tail_fails_only_a_command_that_ran_python(command_setup, script, failed):
    """退出码 0 + 日志尾 Traceback：看日志的命令不是失败。

    ⚠ 2026-09-24 review：上一版见 Traceback 就判「这次命令没有成功」并置
    commandOk=false，`cat error.log` 也算。命令文本走真工人写进回执的那份
    （result["command"] = 模型原样的 script），不自己拼。
    删掉 _hidden_command_failure 里的命令判断，前两组变红；
    把它写成「永远不判」，第三组变红。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION
    from services.project_tools import _command_log_excerpt, _command_pointer, operation_snapshot
    from services.workspace_provider import ProcessResult

    store, _, provider, worker, _ = command_setup
    provider.collect_office_files = lambda _handle: []
    tail = (
        "Traceback (most recent call last):\n"
        '  File "gen.py", line 3, in <module>\n'
        "ModuleNotFoundError: No module named 'pptx'\n"
    )

    def process_result(handle, pid):
        if pid == "44":
            return ProcessResult(pid, stdout=tail, stderr="", exit_code=0)
        return CommandProvider.process_result(provider, handle, pid)

    provider.process_result = process_result
    project = store.create_project(
        "session-traceback-tail", owner_id="alice",
        files={"README.md": "office\n"},
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="tb", command="shell", script=script)
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed", finished.result
    excerpt = _command_log_excerpt(store, operation.operationId, "alice")
    assert "ModuleNotFoundError" in excerpt
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    assert snap["command"] == script
    receipt = _command_pointer(snap, excerpt)
    if failed:
        assert receipt["commandOk"] is False
        assert "没有成功" in receipt["hint"]
    else:
        assert "commandOk" not in receipt
        assert "没有成功" not in receipt["hint"]


def test_unchanged_office_file_is_not_collected_again_and_links_are_real(command_setup):
    """同一份字节再扫到，不是这次的产出；回执给的是用户点得开的下载地址。

    ⚠ 2026-09-25 luna 隔离真机 sr-20260925003931-HP3KEB33FR：办公沙盒整轮复用，
      每条命令都把没改过的 pptx 再扫一遍，回执次次「办公文件已收回……这就是交付」，
      连失败的只读校验也这么说；模型交给用户的链接是 sandbox:/home/user/… 。
    把收集器里的 unchanged 判断删掉，第二条命令的断言变红；
    把 _download_sentence 从提示语里拿掉，下载地址那几条变红。
    """
    from app import app
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION
    from services.project_tools import _command_pointer, operation_snapshot

    store, _, provider, worker, _ = command_setup
    deck = {"bytes": b"PK\x03\x04" + b"deck-v1"}
    provider.collect_office_files = lambda _handle: [{"path": "deck.pptx", "data": deck["bytes"]}]
    project = store.create_project(
        "session-office-unchanged", owner_id="alice",
        files={"README.md": "office\n"},
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")

    def run(key, script):
        operation = worker.submit_command(
            project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            approval_ref="plan-1", idempotency_key=key, command="shell", script=script)
        finished = eventually(lambda: state(store, operation, "stopped"))
        assert finished.status == "completed", finished.result
        snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
        return finished, _command_pointer(snap, "")

    first, receipt1 = run("gen", "python3 build_deck.py")
    assert first.result.get("officeFiles") == ["deck.pptx"]
    assert "已收回" in receipt1["hint"]

    # 下载地址：回执里有，提示语里有，而且对得上应用真实注册的 GET 路由。
    url = receipt1["officeDownloads"]["deck.pptx"]
    assert f"({url})" in receipt1["hint"]
    assert "sandbox:" in receipt1["hint"]  # 明说不要写沙盒路径
    # 从真实应用反查下载路由（这个 FastAPI 延迟挂载子路由，app.routes 不展开，
    # 别再按 route.path 去扫——2026-09-25 第一版就这么扫空了）。
    artifact_id = url.rsplit("/", 1)[-1]
    assert artifact_id.startswith("art-"), url
    assert url == app.url_path_for(
        "download_office_artifact", project_id=project.projectId, artifact_id=artifact_id)

    # 第二条只读命令：沙盒里还是同一份字节——不是这次的产出。
    second, receipt2 = run("check", "python3 -c 'print(1)'")
    assert second.result.get("officeFiles") is None
    assert second.result.get("officeFilesHeld") == ["deck.pptx"]
    assert "已收回" not in receipt2["hint"] and "这就是交付" not in receipt2["hint"]
    assert "没有产出新的办公文件" in receipt2["hint"]
    assert f"({url})" in receipt2["hint"]  # 旧文件的链接照样给

    # 第三条真的改了字节：又是这次的产出。
    deck["bytes"] = b"PK\x03\x04" + b"deck-v2"
    third, receipt3 = run("regen", "python3 build_deck.py")
    assert third.result.get("officeFiles") == ["deck.pptx"]
    assert "已收回" in receipt3["hint"]
