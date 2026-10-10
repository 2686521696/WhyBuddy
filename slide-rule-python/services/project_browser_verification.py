"""Verification is work for the existing runtime owner, with an isolated browser.

The first suite checks the fixed template's page/counter behavior only. It does
not unlock business delivery. Source synchronization and verification run in
the same owner thread: a browser never examines a half-applied source patch.
An interrupted browser may already have clicked; recovery cleans it up and
records missing evidence instead of replaying those potentially stateful steps.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from models.project_runtime import VerificationBuildEvidence
from services.project_manifest import is_custom_server_runtime
from services.project_preview_config import origin_for_project
from services.project_runtime import REVISION_FILE
from services.project_store import ProjectConflict, ProjectStoreUnavailable
from services.project_verification_build import build_and_start, restore_development_runtime
from services.workspace_provider import WorkspaceProviderError

TERMINAL = {"completed", "failed", "cancelled"}


class _VerificationCancelled(Exception):
    pass


def _scope(task):
    return dict(owner_id=task.owner_id, lease_generation=task.lease.generation,
                lease_owner=task.lease.leaseOwner)


def _provider(task):
    factory = task.supervisor.browser_provider_factory
    if factory is None:
        return None
    return factory()


def _cleanup(task, child, *, restore_runtime=False):
    provider = _provider(task)
    if provider is None:
        raise WorkspaceProviderError("project_browser_cleanup_pending")
    # Revoked accounts must not prevent destruction. The lease still fences the
    # resource owner; normal browser execution uses the full authority callback.
    task.heartbeat.check()
    if provider.cleanup(child.operationId, check_callback=task.heartbeat.check) is False:
        raise WorkspaceProviderError("project_browser_cleanup_pending")
    restore_development_runtime(task, child, restore=restore_runtime)


def _terminalize(task, child, *, cancelled, error):
    records = task.supervisor.verification_store
    saved = records.for_operation(child.operationId, owner_id=task.owner_id)
    claimed = task.store.claim_operation(child.operationId, owner_id=task.owner_id,
        lease_owner=task.lease.leaseOwner, generation=task.lease.generation)
    if saved is not None:
        if saved.verification.status in {"passed", "failed", "blocked", "cancelled"}:
            records.reconcile_operation(saved.verification.verificationId, **_scope(task))
        else:
            records.finish(saved.verification.verificationId, **_scope(task), status="cancelled" if cancelled else "blocked",
                assertions=[], artifacts={}, error_code=error, cleanup=True,
                build=getattr(task, "_verification_build_receipts", {}).pop(child.operationId, None))
    elif claimed.status not in TERMINAL:
        task.store.transition_operation(child.operationId, **_scope(task), expected_status=claimed.status,
            status="cancelled" if cancelled else "failed", result={"errorCode": error, "verification": "blocked"})


def recover_project_verifications(task):
    """Called before any recovered runtime writes or newly queued source edits."""
    for child in task.store.list_runtime_verifications(task.operation_id, owner_id=task.owner_id):
        if child.status in {"running", "interrupted"}:
            _cleanup(task, child, restore_runtime=True)
            _terminalize(task, child, cancelled=child.cancelRequested,
                         error="project_browser_verification_interrupted")


def finish_pending_verifications(task, *, cancelled, error):
    for child in task.store.list_runtime_verifications(task.operation_id, owner_id=task.owner_id):
        if child.status in {"running", "interrupted"}:
            _cleanup(task, child)
        _terminalize(task, child, cancelled=cancelled or child.cancelRequested, error=error)


def _check(task, child):
    task.check()
    parent = task.operation()
    task.supervisor.authorizer(task.store, parent, task.owner_id)
    current = task.store.get_operation(child.operationId, owner_id=task.owner_id)
    if current.cancelRequested:
        raise _VerificationCancelled()
    lease = task.store.get_lease(parent.projectId, owner_id=task.owner_id)
    project = task.store.get_project(parent.projectId, owner_id=task.owner_id)
    building = (parent.result or {}).get("verificationBuild", {}).get("operationId") == child.operationId
    if (current.status != "running" or lease is None
            or lease.generation != task.lease.generation or lease.leaseOwner != task.lease.leaseOwner
            or lease.sandboxId != task.handle.sandbox_id or lease.mountedRevision != child.expectedRevision
            or parent.runtime is None or parent.runtime.status not in ({"ready", "installing", "executing", "starting"} if building else {"ready"})
            or parent.runtime.revision != child.expectedRevision or project.currentRevision != child.expectedRevision
            or parent.runtime.processId != lease.processRefs.get("server")
            or lease.processRefs.get("operationId") != task.operation_id):
        raise ProjectConflict("project_verification_runtime_changed")


def _iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _running_server_evidence(task, record):
    """自己用命令起的服务器：不构建，就验它现在跑着的样子（VerificationBuildEvidence 头注）。

    ⚠ 2026-10-10 编排正确性第 3 条：这条路原来一律拒（project_verification_custom_server_unsupported）——
      验收整套围着「构建模板产物 + 页面上的版本标记」转，Django / Go 这类工程永远拿不到交付。
      证据：命令的指纹、那个进程还活着、端口回得出 HTTP。起不来就是 blocked（缺证据），不是 failed。
    """
    started = _iso_now()
    pid = task.runtime.processId
    alive = bool(pid) and task.provider.is_process_running(task.handle, pid) and task.provider.probe_http(
        task.handle, task.runtime.port)
    command = task._custom_command
    return VerificationBuildEvidence(revision=record.revision, treeHash=record.treeHash, lockfileHash=None,
        status="passed" if alive else "blocked", serverKind="custom-command",
        commandHash=hashlib.sha256(command.encode("utf-8")).hexdigest(), startedAt=started, completedAt=_iso_now())


def run_next_project_verification(task):
    records = task.supervisor.verification_store
    pending = task.store.list_runtime_verifications(task.operation_id, owner_id=task.owner_id)
    if not pending:
        return False
    child = pending[0]
    if child.status in {"running", "interrupted"}:
        # This also handles a result saved before its child terminal status.
        _cleanup(task, child, restore_runtime=True)
        _terminalize(task, child, cancelled=child.cancelRequested,
                     error="project_browser_verification_interrupted")
        return True
    if child.cancelRequested:
        _terminalize(task, child, cancelled=True, error="user_cancelled")
        return True
    if child.expectedRevision != task.runtime.revision:
        _terminalize(task, child, cancelled=False, error="project_verification_revision_changed")
        return True
    claimed = task.store.claim_operation(child.operationId, owner_id=task.owner_id,
        lease_owner=task.lease.leaseOwner, generation=task.lease.generation)
    child = task.store.transition_operation(child.operationId, **_scope(task),
        expected_status=claimed.status, status="running")
    record = records.begin(child.operationId, **_scope(task))
    grant = None
    build = None
    result = None
    access = getattr(task.supervisor, "preview_access", None)
    try:
        _check(task, child)
        provider = _provider(task)
        unavailable = "project_browser_not_configured" if provider is None else provider.availability_error()
        if unavailable:
            records.finish(record.verificationId, **_scope(task), status="blocked", assertions=[],
                artifacts={}, error_code=unavailable)
            return True
        if task.supervisor.preview_runtime is None or access is None:
            records.finish(record.verificationId, **_scope(task), status="blocked", assertions=[],
                artifacts={}, error_code="project_browser_preview_unavailable")
            return True
        files = task.store.read_files(child.projectId, child.expectedRevision, owner_id=task.owner_id)
        expected = {**files, REVISION_FILE: json.dumps({"revision": child.expectedRevision})}
        # The equal-tree path is the existing read-only source verification
        # helper. It neither rewrites files nor trusts a generated page's marker.
        task.provider.sync_files(task.handle, expected_files=expected, files=expected)
        _check(task, child)
        custom = is_custom_server_runtime(task.original)
        build = (_running_server_evidence(task, record) if custom
                 else build_and_start(task, child, record, expected_files=expected, check=lambda: _check(task, child)))
        if build.status == "failed":
            result = {"status": "failed", "errorCode": "project_build_failed", "assertions": [], "artifacts": {}}
        elif build.status == "blocked":
            # 只有自己起的服务器走到这里：进程没了或端口不回话。没起来的服务器没东西可看，不是「没通过」。
            result = {"status": "blocked", "errorCode": "project_server_not_responding", "assertions": [], "artifacts": {}}
        else:
            task.supervisor.preview_runtime.ensure(task)
            origin = origin_for_project(task.runtime.projectId)
            if not access.has_active_tunnel(task.operation_id, owner_id=task.owner_id, audience=origin):
                raise WorkspaceProviderError("project_browser_preview_unavailable")
            grant = access.issue_browser_ticket(task.operation_id, owner_id=task.owner_id, audience=origin)
            result = provider.run(entry_url=origin + "/_whybuddy/authorize?ticket=" + grant.secret,
                revision=child.expectedRevision, suite_version=child.input["suiteVersion"],
                verification_id=child.operationId, scope={"origin": origin, "projectId": child.projectId,
                    "runtimeId": task.runtime.runtimeId}, check_callback=lambda: _check(task, child))
            if result.get("cleanupConfirmed") is not True:
                raise WorkspaceProviderError("project_browser_cleanup_pending")
            if result.get("runnerVersion") != "whybuddy-browser-v1:pw1.61.1":
                raise WorkspaceProviderError("project_browser_runner_version_mismatch")
            _check(task, child)
            # 源码树还是这一版（只读比对，不改写）：看的过程中没被换掉。
            task.provider.sync_files(task.handle, expected_files=expected, files=expected)
            if custom:
                # 没有产物指纹、页面也不出版本标记：同一个进程（_check 钉着租约上的 server 进程号）还活着、还回话。
                if not (task.provider.is_process_running(task.handle, task.runtime.processId)
                        and task.provider.probe_http(task.handle, task.runtime.port)):
                    raise WorkspaceProviderError("project_browser_revision_probe_failed")
            else:
                after = task.provider.inspect_build_output(task.handle, revision=child.expectedRevision)
                if (after.output_hash != build.outputHash or after.file_count != build.outputFileCount
                        or after.size_bytes != build.outputBytes):
                    raise WorkspaceProviderError("project_build_output_changed")
                if not task.provider.probe(task.handle, task.runtime.port, expected_revision=child.expectedRevision):
                    raise WorkspaceProviderError("project_browser_revision_probe_failed")
            _check(task, child)
    except _VerificationCancelled:
        result = {"status": "cancelled", "errorCode": "user_cancelled", "assertions": [], "artifacts": {}}
    except (ProjectConflict, ProjectStoreUnavailable):
        raise
    except (ValueError, WorkspaceProviderError) as exc:
        if str(exc) == "project_browser_cleanup_pending":
            raise
        # Infrastructure/source failures are absence of a trusted verdict.
        # Preserve ordinary runtime operation; a missing browser is not a pass.
        result = {"status": "blocked", "errorCode": "project_browser_evidence_unavailable", "assertions": [], "artifacts": {}}
    finally:
        if grant is not None:
            access.revoke_grant(grant.scope.grant_id, owner_id=task.owner_id)
        restore_development_runtime(task, child)
    if result is not None:
        if build is None:
            build = getattr(task, "_verification_build_receipts", {}).get(child.operationId)
        records.finish(record.verificationId, **_scope(task), status=result["status"],
            assertions=result.get("assertions", []), artifacts=result.get("artifacts", {}),
            error_code=result.get("errorCode"), build=build)
        getattr(task, "_verification_build_receipts", {}).pop(child.operationId, None)
    return True
