"""Durable project-operation workers, independent of HTTP subscription lifetime.

This is an execution supervisor, not an agent loop. A runtime.start operation
owns the managed runtime until cancellation, idle/total budget expiry, or failure.
A runtime.exec operation owns one fixed check/build/test command and its sandbox.
Every side effect has a saved phase; uncertain dispatches are never replayed.
"""

from __future__ import annotations

import json
import logging
import shlex
import threading
import time
import uuid
from typing import Callable
from urllib.parse import urlsplit

from models.project_runtime import ProjectOperation, RuntimeInstance
from services.project_authority import approved_reference
from services.project_creation import load_authorized_session
from services.project_preview_config import origin_for_runtime
from services.project_runtime import REVISION_FILE, _LeaseHeartbeat, _timestamp
from services.project_source_sync import authorize_source_recovery, finish_pending_source_patches, sync_next_source_patch
from services.project_store import ProjectConflict, ProjectStore, ProjectStoreUnavailable
from services.workspace_provider import WorkspaceHandle, WorkspaceProvider, WorkspaceProviderError

logger = logging.getLogger(__name__)
TERMINAL = {"completed", "cancelled", "failed"}
PROJECT_COMMANDS = {"check", "build", "test"}


class ProjectExecutionRejected(ProjectConflict):
    """The request is stale; unlike a lost lease, it can be failed by its owner."""


def authorize_operation(store: ProjectStore, operation: ProjectOperation, owner_id: str) -> None:
    project = store.get_project(operation.projectId, owner_id=owner_id)
    state = load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=operation.approvalRef)
    if state.runtimeKind != "project" or state.projectId != project.projectId:
        raise ProjectExecutionRejected("project_session_binding_required")
    revision = store.get_revision(project.projectId, owner_id=owner_id)
    expected = operation.runtime.revision if operation.kind == "runtime.start" and operation.runtime else operation.expectedRevision
    if revision.revision != expected:
        raise ProjectExecutionRejected("project_revision_conflict")
    if revision.planRef != operation.approvalRef:
        raise PermissionError("project_plan_approval_required")


class _Shutdown(Exception):
    pass


class _Cancel(Exception):
    pass


class _Expired(Exception):
    pass


class ProjectRuntimeSupervisor:
    def __init__(self, store: ProjectStore, provider_factory: Callable[[], WorkspaceProvider], *,
                 authorizer: Callable[[ProjectStore, ProjectOperation, str], None] = authorize_operation,
                 max_workers: int = 2, poll_interval: float = 2, lease_ttl: float = 120,
                 lifetime_seconds: float = 900, idle_seconds: float = 300,
                 install_timeout: float = 600, ready_timeout: float = 60, preview_runtime=None):
        if not 1 <= max_workers <= 8 or not 0 < poll_interval <= 30 or not 1 <= lease_ttl <= 3600:
            raise ValueError("invalid_runtime_worker_config")
        if not 1 <= lifetime_seconds <= 3600 or not 1 <= idle_seconds <= lifetime_seconds:
            raise ValueError("invalid_runtime_budget")
        if not 1 <= install_timeout <= 600 or not 1 <= ready_timeout <= 300:
            raise ValueError("invalid_runtime_timeout")
        self.store, self.provider_factory, self.authorizer = store, provider_factory, authorizer
        self.max_workers, self.poll_interval, self.lease_ttl = max_workers, poll_interval, lease_ttl
        self.lifetime_seconds, self.idle_seconds = lifetime_seconds, idle_seconds
        self.install_timeout, self.ready_timeout = install_timeout, ready_timeout
        self.preview_runtime = preview_runtime
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._workers: dict[str, threading.Thread] = {}
        self._scanner: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._scanner is not None and self._scanner.is_alive() and not self._stop.is_set()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._scanner = threading.Thread(target=self._scan_loop, name="project-runtime-supervisor", daemon=True)
        self._scanner.start()

    def shutdown(self, timeout: float = 30) -> None:
        self._stop.set()
        self._wake.set()
        deadline = time.monotonic() + timeout
        if self._scanner is not None:
            self._scanner.join(max(0, deadline - time.monotonic()))
        with self._lock:
            workers = list(self._workers.values())
        for worker in workers:
            worker.join(max(0, deadline - time.monotonic()))
        if any(worker.is_alive() for worker in workers):
            raise RuntimeError("runtime_workers_still_stopping")

    def submit(self, project_id: str, *, owner_id: str, expected_revision: str,
               approval_ref: str, idempotency_key: str, port: int = 5173) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        if isinstance(port, bool) or not 1024 <= port <= 65535:
            raise ValueError("invalid_preview_port")
        # Authorization is checked before persistence and again by the worker.
        project = self.store.get_project(project_id, owner_id=owner_id)
        candidate = ProjectOperation(operationId="pending", projectId=project_id, sessionId=project.sessionId,
            kind="runtime.start", idempotencyKey=idempotency_key, requestHash="", expectedRevision=project.currentRevision,
            approvalRef=approval_ref, createdAt=_timestamp(), updatedAt=_timestamp())
        self.authorizer(self.store, candidate, owner_id)
        operation = self.store.create_operation(project_id, owner_id=owner_id, kind="runtime.start",
            idempotency_key=idempotency_key, expected_revision=expected_revision, approval_ref=approval_ref,
            input={"port": port})
        self._wake.set()
        return operation

    def submit_command(self, project_id: str, *, owner_id: str, expected_revision: str,
                       approval_ref: str, idempotency_key: str, command: str = "check") -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        if not isinstance(command, str) or command not in PROJECT_COMMANDS:
            raise ValueError("invalid_project_command")
        project = self.store.get_project(project_id, owner_id=owner_id)
        candidate = ProjectOperation(operationId="pending", projectId=project_id, sessionId=project.sessionId,
            kind="runtime.exec", idempotencyKey=idempotency_key, requestHash="", expectedRevision=expected_revision,
            approvalRef=approval_ref, createdAt=_timestamp(), updatedAt=_timestamp())
        self.authorizer(self.store, candidate, owner_id)
        operation = self.store.create_operation(project_id, owner_id=owner_id, kind="runtime.exec",
            idempotency_key=idempotency_key, expected_revision=expected_revision, approval_ref=approval_ref,
            input={"command": command})
        self._wake.set()
        return operation

    def cancel(self, operation_id: str, *, owner_id: str) -> ProjectOperation:
        operation = self.store.request_operation_cancel(operation_id, owner_id=owner_id)
        self._wake.set()
        return operation

    def submit_patch(self, runtime_operation_id: str, *, owner_id: str, expected_revision: str,
                     approval_ref: str, idempotency_key: str, changes: list[dict]) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        parent = self.store.get_operation(runtime_operation_id, owner_id=owner_id)
        # Recheck the live plan using the current source. The enqueue CAS checks
        # the requested base, and may return an already completed identical call.
        project = self.store.get_project(parent.projectId, owner_id=owner_id)
        candidate = parent.model_copy(update={"runtime": None, "expectedRevision": project.currentRevision,
                                               "approvalRef": approval_ref})
        self.authorizer(self.store, candidate, owner_id)
        operation = self.store.enqueue_runtime_patch(runtime_operation_id, owner_id=owner_id,
            expected_revision=expected_revision, approval_ref=approval_ref,
            idempotency_key=idempotency_key, changes=changes)
        self._wake.set()
        return operation

    def _scan_loop(self) -> None:
        while not self._stop.is_set():
            try:
                with self._lock:
                    self._workers = {key: value for key, value in self._workers.items() if value.is_alive()}
                    available = self.max_workers - len(self._workers)
                if available:
                    for operation, owner_id in self.store.list_runnable_operations(limit=self.max_workers * 4):
                        with self._lock:
                            if self._stop.is_set() or len(self._workers) >= self.max_workers:
                                break
                            if operation.operationId in self._workers:
                                continue
                            worker = threading.Thread(target=self._execute,
                                args=(operation, owner_id), name="project-operation", daemon=True)
                            self._workers[operation.operationId] = worker
                            worker.start()
            except Exception as exc:
                logger.warning("project runtime scan unavailable: %s", type(exc).__name__)
            self._wake.wait(self.poll_interval)
            self._wake.clear()

    def _execute(self, candidate: ProjectOperation, owner_id: str) -> None:
        context, lease = None, None
        try:
            lease = self.store.acquire_lease(candidate.projectId, owner_id=owner_id,
                lease_owner="runtime-" + uuid.uuid4().hex, ttl_seconds=self.lease_ttl)
            prior_id = lease.processRefs.get("operationId")
            if prior_id and prior_id != candidate.operationId:
                prior = self.store.get_operation(prior_id, owner_id=owner_id)
                if prior.status not in TERMINAL or prior.pendingEvent is not None:
                    # Queued commands cannot replace a recovering runtime.
                    return
            original = self.store.get_operation(candidate.operationId, owner_id=owner_id)
            claimed = self.store.claim_operation(candidate.operationId, owner_id=owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)
            if claimed.status in TERMINAL:
                self.store.flush_operation_event(claimed.operationId, owner_id=owner_id,
                    lease_generation=lease.generation, lease_owner=lease.leaseOwner)
                self.store.release_lease(candidate.projectId, owner_id=owner_id,
                    lease_owner=lease.leaseOwner, generation=lease.generation)
                return
            context = _RuntimeTask(self, owner_id, lease, original)
            with context.heartbeat:
                try:
                    if original.runtime is None and not lease.sandboxId and context.operation().cancelRequested:
                        raise _Cancel()
                    context.set_provider(self.provider_factory())
                    context.run()
                except _Cancel:
                    context.finish("cancelled", "stopped", "user_cancelled")
                except _Expired:
                    context.finish("failed" if original.kind == "runtime.exec" else "completed",
                        "expired", "runtime_budget_exhausted")
                except _Shutdown:
                    context.suspend("worker_shutdown")
                except ProjectExecutionRejected as exc:
                    context.finish("failed", "failed", str(exc))
                except (ProjectConflict, ProjectStoreUnavailable):
                    # Ownership or durable-state uncertainty forbids further IO.
                    raise
                except Exception as exc:
                    code = str(exc) if isinstance(exc, (WorkspaceProviderError, PermissionError, ValueError)) else type(exc).__name__
                    context.finish("failed", "failed", code)
        except ProjectConflict:
            pass  # Another valid generation now owns all state and side effects.
        except Exception as exc:
            logger.warning("project operation requires reconciliation: %s (%s)", candidate.operationId, type(exc).__name__)
        finally:
            if context is not None:
                context.heartbeat.close()
            elif lease is not None:
                try:
                    self.store.release_lease(candidate.projectId, owner_id=owner_id,
                        lease_owner=lease.leaseOwner, generation=lease.generation)
                except (ProjectConflict, ProjectStoreUnavailable):
                    pass
            self._wake.set()


class _RuntimeTask:
    def __init__(self, supervisor, owner_id, lease, original):
        self.supervisor, self.store, self.provider = supervisor, supervisor.store, None
        self.owner_id, self.lease, self.original = owner_id, lease, original
        self.operation_id = original.operationId
        self.runtime = original.runtime or RuntimeInstance(runtimeId="rt-" + original.operationId,
            workspaceId=lease.workspaceId, projectId=original.projectId, revision=original.expectedRevision,
            status="provisioning", port=int(original.input.get("port", 5173)), lastHeartbeat=_timestamp(),
            expiresAt=time.time() + supervisor.lifetime_seconds)
        self.handle = WorkspaceHandle(lease.workspaceId, lease.sandboxId) if lease.sandboxId else None
        self.heartbeat = _LeaseHeartbeat(self.store, None, original.projectId, owner_id, lease, supervisor.lease_ttl)
        self.log_offsets: dict[str, int] = {}
        self.result = dict(original.result or {})
        self.result.setdefault("idleSeconds", supervisor.idle_seconds)
        if original.kind == "runtime.exec":
            self.result.setdefault("command", original.input.get("command"))
            self.result.setdefault("exitCode", None)

    def set_provider(self, provider):
        self.provider = provider
        self.heartbeat.provider = provider

    def operation(self):
        return self.store.get_operation(self.operation_id, owner_id=self.owner_id)

    def save(self, phase, *, status="running", error=None):
        self.heartbeat.check()
        self.runtime = self.runtime.model_copy(update={"status": phase, "errorCode": error,
            "health": "revision_verified" if phase == "ready" else "unknown", "lastHeartbeat": _timestamp()})
        self.result["phase"] = phase
        if self.original.kind == "runtime.exec":
            self.result["errorCode"] = error
        current = self.operation()
        self.store.update_runtime_operation(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner,
            expected_status=current.status, status=status, runtime=self.runtime, result=self.result)
        self.store.flush_operation_event(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)

    def check(self):
        self.heartbeat.check()
        if self.operation().cancelRequested:
            raise _Cancel()
        if self.supervisor._stop.is_set():
            raise _Shutdown()
        if self.runtime.expiresAt is not None and time.time() >= self.runtime.expiresAt:
            raise _Expired()

    def sleep(self):
        self.supervisor._stop.wait(self.supervisor.poll_interval)

    def logs(self, pid):
        if pid not in self.log_offsets:
            offset, seq = 0, 0
            while True:
                events = self.store.list_events(self.operation_id, owner_id=self.owner_id, after_seq=seq, limit=1000)
                for event in events:
                    if event.type == "runtime.log" and event.payload.get("processId") == pid:
                        offset = max(offset, int(event.payload["nextOffset"]))
                if len(events) < 1000:
                    break
                seq = events[-1].seq
            self.log_offsets[pid] = offset
        chunk = self.provider.read_process_logs(self.handle, pid, offset=self.log_offsets[pid])
        if chunk.next_offset > self.log_offsets[pid]:
            self.store.append_event(self.operation_id, owner_id=self.owner_id, event_type="runtime.log",
                event_id=f"{pid}:log:{self.log_offsets[pid]}:{chunk.next_offset}",
                payload={"processId": pid, "text": chunk.text, "nextOffset": chunk.next_offset, "truncated": chunk.truncated},
                lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
            self.log_offsets[pid] = chunk.next_offset
        return chunk.next_offset

    def run(self):
        if self.result.get("cleanup"):
            self.finish(**self.result["cleanup"])
            return
        self.check()
        if self.result.get("sourceSync"):
            authorize_source_recovery(self)
        else:
            self.supervisor.authorizer(self.store, self.operation(), self.owner_id)
        command = self.original.input.get("command") if self.original.kind == "runtime.exec" else None
        if self.original.kind == "runtime.exec" and (not isinstance(command, str) or command not in PROJECT_COMMANDS):
            raise ValueError("invalid_project_command")
        server_command = f"npm run dev -- --host 0.0.0.0 --port {self.runtime.port} --strictPort"
        if self.original.kind == "runtime.start" and self.supervisor.preview_runtime is not None:
            # The relay preserves Host (including HMR), so Vite must explicitly
            # accept this runtime's dedicated origin. The cloud smoke supplied
            # this env var but the real worker did not: local health passed while
            # every authorized preview returned Vite's blocked-host response.
            # Reuse the tunnel manager's server-owned validator before remote IO;
            # never take allowed hosts from tool input or disable Vite's check.
            preview_host = urlsplit(origin_for_runtime(self.runtime.runtimeId)).hostname
            if not preview_host:
                raise ValueError("project_preview_origin_invalid")
            server_command = f"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS={shlex.quote(preview_host)} {server_command}"
        if self.original.runtime is None:
            self.save("provisioning")
            files = self.store.read_files(self.original.projectId, self.original.expectedRevision, owner_id=self.owner_id)
            if "package-lock.json" not in files or REVISION_FILE in files:
                raise ValueError("project_lockfile_or_reserved_path_invalid")
            if self.handle is not None:
                self.provider.destroy(self.handle)
                self.handle = None
            self.check()
            # Record intent before create. Discovery by workspace metadata repairs
            # a crash between provider creation and storing its returned identity.
            self.heartbeat.renew(sandbox_id=None, process_refs={"operationId": self.operation_id})
            for orphan in self.provider.find_workspaces(workspace_id=self.lease.workspaceId):
                self.heartbeat.check()
                self.provider.destroy(orphan)
            self.handle = self.provider.create(workspace_id=self.lease.workspaceId)
            self.heartbeat.renew(sandbox_id=self.handle.sandbox_id, process_refs={"operationId": self.operation_id})
            self.heartbeat.handle = self.handle
            self.save("syncing")
            self.provider.write_files(self.handle, {**files, REVISION_FILE: json.dumps({"revision": self.runtime.revision})})
            self.heartbeat.renew(mounted_revision=self.runtime.revision)
            self.check()
            self.result["phaseDeadline"] = time.time() + self.supervisor.install_timeout
            self.save("installing")
            installed = self.provider.start_process(self.handle, "npm ci --ignore-scripts", timeout_seconds=600)
            self._register("install", installed.process_id)
            phase = "installing"
        else:
            if self.handle is None:
                raise WorkspaceProviderError("runtime_dispatch_uncertain")
            self.provider.connect(self.handle)
            self.heartbeat.handle = self.handle
            if self.result.get("sourceSync"):
                self.save("syncing")
                sync_next_source_patch(self, recovering=True)
            phase = self.result.get("phase") or self.original.runtime.status
            phases = {"installing", "executing"} if self.original.kind == "runtime.exec" else {"installing", "starting", "ready"}
            if phase not in phases:
                raise WorkspaceProviderError("runtime_dispatch_uncertain")
            self.save(phase)
        if phase == "installing":
            pid = self._process("install")
            while True:
                self.check()
                self.logs(pid)
                if not self.provider.is_process_running(self.handle, pid):
                    break
                if time.time() >= self.result["phaseDeadline"]:
                    raise WorkspaceProviderError("project_install_timeout")
                self.sleep()
            installed = self.provider.process_result(self.handle, pid)
            while True:
                previous = self.log_offsets.get(pid, 0)
                if self.logs(pid) == previous:
                    break
            if installed.exit_code != 0:
                if self.original.kind == "runtime.exec":
                    self.result["installExitCode"] = installed.exit_code
                raise WorkspaceProviderError("project_dependency_install_failed", result=installed)
            self.check()
            self.supervisor.authorizer(self.store, self.original, self.owner_id)
            if self.original.kind == "runtime.exec":
                self.save("executing")
                executed = self.provider.start_process(self.handle, f"npm run {command}", timeout_seconds=900)
                self._register("command", executed.process_id)
                phase = "executing"
            else:
                self.result["phaseDeadline"] = time.time() + self.supervisor.ready_timeout
                self.save("starting")
                started = self.provider.start_process(self.handle,
                    server_command, timeout_seconds=900)
                self._register("server", started.process_id)
                phase = "starting"
        if self.original.kind == "runtime.exec":
            self.run_command()
            return
        pid = self._process("server")
        self.runtime = self.runtime.model_copy(update={"processId": pid})
        if phase == "starting":
            while True:
                self.check()
                self.logs(pid)
                if not self.provider.is_process_running(self.handle, pid):
                    raise WorkspaceProviderError("project_process_exited")
                if self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision):
                    break
                if time.time() >= self.result["phaseDeadline"]:
                    raise WorkspaceProviderError("project_readiness_timeout")
                self.sleep()
            self.result["readyAt"] = time.time()
        elif not self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision):
            raise WorkspaceProviderError("project_recovery_health_failed")
        self.save("ready")
        next_health = 0
        while True:
            self.check()
            if sync_next_source_patch(self):
                next_health = 0
            last_access = max(self.result["readyAt"], self.operation().lastAccessAt or 0)
            if time.time() - last_access >= min(float(self.result["idleSeconds"]), self.supervisor.idle_seconds):
                self.finish("completed", "expired", "runtime_idle_expired")
                return
            self.logs(pid)
            if time.time() >= next_health:
                if (not self.provider.is_process_running(self.handle, pid)
                        or not self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision)):
                    raise WorkspaceProviderError("project_runtime_health_failed")
                self.save("ready")
                next_health = time.time() + min(30, self.supervisor.lease_ttl / 3)
            if self.supervisor.preview_runtime is not None:
                self.supervisor.preview_runtime.ensure(self)
            self.sleep()

    def run_command(self):
        pid = self._process("command")
        self.runtime = self.runtime.model_copy(update={"processId": pid})
        self.save("executing")
        while True:
            self.check()
            self.logs(pid)
            if not self.provider.is_process_running(self.handle, pid):
                break
            self.sleep()
        executed = self.provider.process_result(self.handle, pid)
        self.result["exitCode"] = executed.exit_code
        while True:
            previous = self.log_offsets.get(pid, 0)
            if self.logs(pid) == previous:
                break
        if executed.exit_code is None:
            raise WorkspaceProviderError("project_command_result_unknown", result=executed)
        if executed.exit_code != 0:
            raise WorkspaceProviderError("project_command_failed", result=executed)
        self.check()
        self.finish("completed", "stopped", None)

    def _register(self, key, pid):
        if not pid:
            raise WorkspaceProviderError("project_process_identity_missing")
        refs = dict(self.heartbeat.lease.processRefs)
        refs[key] = pid
        self.heartbeat.renew(process_refs=refs)

    def _process(self, key):
        pid = self.heartbeat.lease.processRefs.get(key)
        if not isinstance(pid, str) or not pid.isdecimal():
            raise WorkspaceProviderError("runtime_dispatch_uncertain")
        return pid

    def finish(self, status, phase, code):
        if self.operation().status in TERMINAL:
            return
        self.result["cleanup"] = {"status": status, "phase": phase, "code": code}
        self.heartbeat.handle = None
        if status == "cancelled":
            self.save("stopping", status="cancelling", error=code)
        else:
            current = self.operation().status
            self.save("stopping", status="cancelling" if current == "cancelling" else "running", error=code)
        try:
            self.heartbeat.check()
            if self.original.kind == "runtime.start":
                finish_pending_source_patches(self, cancelled=status == "cancelled", error=code or "project_runtime_stopped")
            if self.supervisor.preview_runtime is not None:
                self.supervisor.preview_runtime.revoke(self)
            if self.handle is not None:
                self.provider.destroy(self.handle)
            if self.provider is None:
                if self.original.runtime is not None or self.handle is not None:
                    raise WorkspaceProviderError("project_provider_unavailable")
            else:
                for orphan in self.provider.find_workspaces(workspace_id=self.lease.workspaceId):
                    self.heartbeat.check()
                    self.provider.destroy(orphan)
        except ProjectConflict:
            raise
        except Exception:
            self.save("reconciling", status="interrupted", error="project_cleanup_pending")
            # Keep the lease until expiry to bound cleanup retries after outages.
            self.heartbeat.close()
            return
        self.runtime = self.runtime.model_copy(update={"processId": None})
        self.save(phase, status=status, error=code)
        self.heartbeat.close()
        self.store.release_lease(self.original.projectId, owner_id=self.owner_id,
            lease_owner=self.lease.leaseOwner, generation=self.lease.generation, clear_runtime=True)

    def suspend(self, reason):
        phase = self.result.get("phase", self.runtime.status)
        self.save("reconciling", status="interrupted", error=reason)
        if self.supervisor.preview_runtime is not None:
            self.supervisor.preview_runtime.revoke(self)
        # Preserve the last dispatched phase across intentional service shutdown.
        self.result["phase"] = phase
        current = self.operation()
        self.store.update_runtime_operation(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner,
            expected_status=current.status, status=current.status, runtime=self.runtime, result=self.result)
        self.store.flush_operation_event(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
        self.heartbeat.close()
        self.store.release_lease(self.original.projectId, owner_id=self.owner_id,
            lease_owner=self.lease.leaseOwner, generation=self.lease.generation)
