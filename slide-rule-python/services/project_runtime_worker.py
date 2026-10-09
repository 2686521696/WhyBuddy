"""Durable project-operation workers, independent of HTTP subscription lifetime.

This is an execution supervisor, not an agent loop. A runtime.start operation
owns the managed runtime until cancellation, idle/total budget expiry, or failure.
A runtime.exec operation owns one command and its sandbox: managed
check/build/test (`npm run …`) or one grok-build bash line in `input.script`.
Every side effect has a saved phase; uncertain dispatches are never replayed.

2026-09-15: install / exec prefer `start_console` (a real bash PTY) when the
provider has one. Vite stays on `start_process`. The pane reads
`runtime.console` bytes; do not reconstruct a prompt in the worker.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import shlex
import threading
import time
import uuid
from typing import Callable
from urllib.parse import urlsplit

from models.project_runtime import ProjectOperation, RuntimeInstance
from services.error_reporting import OutageLog, reporting_scope
from services.project_actor_access import authorize_project_actor
from services.project_application_runtime import checkpoint_application_data, restore_application_data
from services.project_browser_verification import (
    finish_pending_verifications, recover_project_verifications, run_next_project_verification,
)
from services.project_authority import approved_reference
from services.project_creation import load_authorized_session, sync_session_project
from services.project_preview_config import (
    origin_for_runtime,
    preview_configuration_enabled,
    published_preview_url,
)
from services.vite_preview_hosts import injected_preview_dev_command
from services.project_manifest import content_hash
from services.project_runtime import REVISION_FILE, _LeaseHeartbeat, _timestamp
from services.project_source_sync import authorize_source_recovery, finish_pending_source_patches, sync_next_source_patch
from services.deliverable_kind import (
    MAX_DELIVERED_FILES,
    WORKSPACE_TEMPLATE_VERSION,
    is_auto_collected_output,
    is_deliverable_bytes,
    is_office_artifact_path,
    is_office_zip_bytes,
    office_facts,
    office_e2b_template,
    workspace_e2b_template,
    orch_trace,
    skip_vite_dependency_install,
)
from services.project_office_artifacts import ProjectOfficeArtifactStore, office_artifact_download_url
from services.project_store import ProjectConflict, ProjectStore, ProjectStoreUnavailable
from services.project_verification_store import ProjectVerificationStore
from services.project_acceptance import normalize_acceptance_requirements, suite_for_template
from services.project_tool_contracts import sandbox_shell_script
from services.workspace_provider import WorkspaceHandle, WorkspaceProvider, WorkspaceProviderError
from services.skill_hydrate import hydrate_owner_into

logger = logging.getLogger(__name__)
#: 身份库连续查不到多久才停掉正在跑的运行时（_RuntimeTask._authorize_actor 头注）。
_ACTOR_UNAVAILABLE_GRACE_SECONDS = 60
TERMINAL = {"completed", "cancelled", "failed"}
PROJECT_COMMANDS = {"check", "build", "test"}


def _numbered_sibling(store, project_id, owner_id, path):
    """库里已有、只差一个编号后缀的同名办公文件（方案.docx ↔ 方案_1.docx / 方案 (2).docx）。"""
    folder, _, name = str(path).rpartition("/")
    stem, dot, ext = name.rpartition(".")
    if not dot:
        return None
    base = re.sub(r"(?:[_ -]\d{1,3}|\s?\(\d{1,3}\))$", "", stem)
    if base == stem:
        return None
    try:
        rows = store.list(project_id, owner_id=owner_id)
    except Exception:
        return None
    wanted = (folder + "/" if folder else "") + base + "." + ext
    return next((row for row in rows if isinstance(row, dict) and row.get("path") == wanted), None)


#: 对哈希时只认普通的相对路径（不含空白、不以 - 或 / 开头），shell 里不用猜转义。
_PLAIN_SOURCE_PATH = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_./-]{0,239}")


# 准入 CAS 撞上在跑的运行时自己落盘（父操作的 payload 变了）只会得到「零行」，可以安全重来；
# 但三次紧挨着重试会在同一段写入窗口里接连撞上。
# ⚠ 2026-09-29 全量 -n 4 负载下 test_project_browser_verification 约 1/8 回
#   project_runtime_patch_changed。临时探针把每次零行拆开看：全是父操作 rev/payload 变了
#   （运行时的 update_runtime_operation / flush_operation_event，1.5 秒 5 次），租约一次没变、
#   也没过期——不是心跳，是自己的日志落盘。负载把「读上下文→插入」的窗口拉长，三发全落在写入里。
#   隔离真机 115 轮一次没见过；但开发服务器一直在吐日志、远端 SQL 每次往返几十毫秒时，
#   窗口同样会被拉长。所以退避带抖动、多给两次，最坏多等不到一秒。只有「确认零行」会走到这里
#   （见调用处），不会重放不明结果的写。
_ADMISSION_ATTEMPTS = 5


def _admission_backoff(attempt: int) -> None:
    time.sleep(random.uniform(0, 0.05 * 2 ** attempt))


class ProjectExecutionRejected(ProjectConflict):
    """The request is stale; unlike a lost lease, it can be failed by its owner."""


def authorize_operation(store: ProjectStore, operation: ProjectOperation, owner_id: str) -> None:
    authorize_project_actor(owner_id)
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


#: 生成的工程自己的结局，不是平台出错——这几个码不成错误上报的问题。
#: ⚠ 2026-10-08 线上头两个真任务（读书打卡网页 sr-20261008130208-70FWGJY9F7、入职指南 Word sr-20261008130604-GY0MS37SRN）：
#:   Sentry 里冒出 3 个 `WorkspaceProviderError: project_command_failed`——全是模型自己的 check / build / 校验脚本
#:   退出码 2，下一步就改好了。上一版注释写着「模型自己的命令退出码非 0 不走这条」，是错的：退出码非 0 正是
#:   在这条分支里抛 project_command_failed。照这样，每个正常任务都往问题列表里塞几条，真出事的那条被淹掉。
APP_OUTCOME_CODES = frozenset({"project_command_failed", "project_dependency_install_failed", "project_process_exited"})


def _initial_port(original) -> int:
    """运行记录里的端口。自定义命令没说端口时先记 0（还不知道），起来之后按真在听的那个填上。"""
    given = original.input if isinstance(original.input, dict) else {}
    if isinstance(given.get("command"), str):
        port = given.get("port")
        return int(port) if isinstance(port, int) and not isinstance(port, bool) else 0
    return int(given.get("port", 5173))


class ProjectRuntimeSupervisor:
    def __init__(self, store: ProjectStore, provider_factory: Callable[[], WorkspaceProvider], *,
                 authorizer: Callable[[ProjectStore, ProjectOperation, str], None] = authorize_operation,
                 max_workers: int = 2, poll_interval: float = 2, lease_ttl: float = 120,
                 lifetime_seconds: float = 900, idle_seconds: float = 300,
                 install_timeout: float = 600, ready_timeout: float = 60, preview_runtime=None,
                 browser_provider_factory=None):
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
        self.browser_provider_factory = browser_provider_factory
        self.verification_store = ProjectVerificationStore(store)
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._lock = threading.Lock()
        #: 每个工程一把：submit 的「查有没有在跑的那台 → 没有才建」得是一步（submit 里的头注）。
        self._start_locks: dict[str, threading.Lock] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._stdin: dict[str, list[dict]] = {}
        #: sandbox_id → {上传文件名: sha256}。同一台沙盒里已经放好的原件不再重推。
        #: 进程重启后丢了也没关系：写入是幂等的，最多多推一次。
        self._mounted_uploads: dict[str, dict[str, str]] = {}
        self._scanner: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._scanner is not None and self._scanner.is_alive() and not self._stop.is_set()

    @staticmethod
    def preview_configuration_enabled() -> bool:
        """Expose the canonical local preview check to planning callers.

        This is configuration only; it never contacts E2B or redeems a grant.
        Keeping the check on the runtime owner avoids a control-tools import
        edge into the runtime layer.
        """
        return preview_configuration_enabled()

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
               approval_ref: str, idempotency_key: str, port: int | None = None,
               command: str | None = None) -> ProjectOperation:
        """起这个工程的开发服务器（一个工程一台）。

        command 是模型给的启动命令（任意语言：python manage.py runserver、go run .、npm run dev …），
        port 可不填——起来之后哪个端口在听就预览哪个（_RuntimeTask._generic_ready）。都不给：这个工程上一次
        用自定义命令起过，就照原样再起（预览面板「叫醒」、browser_navigate 不知道该用什么命令）；否则是模板的
        Vite（npm ci + npm run dev，5173）。

        ⚠ 2026-10-09：之前只有 Vite 这一条——Go / Django / Spring Boot 的工程没有 package-lock，开箱就被锁文件闸
          打回；端口写死 5173，预览只认这一个门。
        """
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        if command is None and port is None:
            command, port = self._last_start_profile(project_id, owner_id)
        if command is not None:
            command = sandbox_shell_script(command)
        elif port is None:
            port = 5173
        if port is not None and (isinstance(port, bool) or not isinstance(port, int) or not 1024 <= port <= 65535):
            raise ValueError("invalid_preview_port")
        # Authorization is checked before persistence and again by the worker.
        project = self.store.get_project(project_id, owner_id=owner_id)
        candidate = ProjectOperation(operationId="pending", projectId=project_id, sessionId=project.sessionId,
            kind="runtime.start", idempotencyKey=idempotency_key, requestHash="", expectedRevision=project.currentRevision,
            approvalRef=approval_ref, createdAt=_timestamp(), updatedAt=_timestamp())
        self.authorizer(self.store, candidate, owner_id)
        # 一个工程一台开发服务器（见 ProjectStore.active_runtime_start）。同一把
        # 幂等键交过的照旧走幂等：重放拿回原样，换参数报冲突。
        # ⚠ 版本号对不上的不复用，交给 create_operation 报 project_revision_conflict
        #   ——第一版复用排在校验前面，过期请求拿到了在跑的那台（全量
        #   test_http_start_retry_after_live_patch_returns_original_request 逮到）。
        #
        # ⚠ 2026-10-06 真机 r46 sr-20261006161250-XF6BNT597B（@frontend-design 春节倒计时）：模型起预览
        #   （幂等键 uuid）和预览面板 POST /preview/wake（preview-wake:*）隔 0.19 秒同时到，两边都先查
        #   active_runtime_start、都看见「没有」、各建一台——上面那条复用是「先查后建」，并发时两个查都在两个建之前。
        #   两台抢一份工作区租约，租约换了 7 代（gen 7→13），浏览器验收撞上 workspace_lease_lost。
        #   两条请求都在同一个 Python 进程里，按工程一把锁把「查 → 建」合成一步。
        with self._lock:
            start_lock = self._start_locks.setdefault(project_id, threading.Lock())
        with start_lock:
            if (expected_revision == project.currentRevision
                    and self.store.operation_by_key(project_id, idempotency_key, owner_id=owner_id) is None):
                active = self.store.active_runtime_start(project_id, owner_id=owner_id)
                if active is not None:
                    return active
            operation = self.store.create_operation(project_id, owner_id=owner_id, kind="runtime.start",
                idempotency_key=idempotency_key, expected_revision=expected_revision, approval_ref=approval_ref,
                input={"port": port} if command is None else {"port": port, "command": command})
        self._wake.set()
        return operation

    def _last_start_profile(self, project_id: str, owner_id: str) -> tuple[str | None, int | None]:
        """这个工程最近一次用自定义命令起服务器的 (命令, 端口)；从没用过返回 (None, None)。"""
        # 列表按操作号排（随机串，不是时间）：翻完，按创建时间挑最近那条。
        latest, cursor = None, ""
        try:
            for _ in range(50):
                page = self.store.list_project_operations(project_id, owner_id=owner_id, after_id=cursor, limit=100)
                for operation in page:
                    given = operation.input if operation.kind == "runtime.start" and isinstance(operation.input, dict) else {}
                    if (isinstance(given.get("command"), str) and given["command"].strip()
                            and (latest is None or operation.createdAt > latest.createdAt)):
                        latest = operation
                if len(page) < 100:
                    break
                cursor = page[-1].operationId
        except Exception:
            logger.warning("last start profile lookup failed", exc_info=True)
            return None, None
        if latest is None:
            return None, None
        port = latest.input.get("port")
        return latest.input["command"], port if isinstance(port, int) and not isinstance(port, bool) else None

    def submit_command(self, project_id: str, *, owner_id: str, expected_revision: str,
                       approval_ref: str, idempotency_key: str, command: str = "check",
                       script: str | None = None) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        if script is not None:
            payload = {"command": "shell", "script": sandbox_shell_script(script)}
        elif isinstance(command, str) and command in PROJECT_COMMANDS:
            payload = {"command": command}
        else:
            raise ValueError("invalid_project_command")
        project = self.store.get_project(project_id, owner_id=owner_id)
        candidate = ProjectOperation(operationId="pending", projectId=project_id, sessionId=project.sessionId,
            kind="runtime.exec", idempotencyKey=idempotency_key, requestHash="", expectedRevision=expected_revision,
            approvalRef=approval_ref, createdAt=_timestamp(), updatedAt=_timestamp())
        self.authorizer(self.store, candidate, owner_id)
        # ⚠ 2026-09-23 review：上一版在这里 acquire_lease + 起线程直接跑
        #   （KM48CMNDPE「别的监督器用旧代码领走」）。那把入队和执行合成了
        #   一件事，三处塌了：
        #     · 模型工具调用当场摸 provider —— 夹具里那条
        #       `Model tools may only queue remote execution` 就是这个契约；
        #     · 绕过 _scan_loop 的 max_workers，几发并发就是几个沙盒；
        #     · 先占租约 → 一条命令在跑时来的**新**命令由「排队」变成
        #       workspace_lease_busy。
        #   跨版本抢单是部署顺序的事，不是把队列拆了换来的。这里只入队。
        operation = self.store.create_operation(project_id, owner_id=owner_id, kind="runtime.exec",
            idempotency_key=idempotency_key, expected_revision=expected_revision, approval_ref=approval_ref,
            input=payload)
        self._wake.set()
        return operation

    def enqueue_stdin(self, operation_id: str, *, owner_id: str, text: str,
                      press_enter: bool = True) -> None:
        """Queue PTY stdin for a live exec. Worker flushes on the next poll.

        抄 grok / E2B pty.send_stdin。落在监督器内存里：租约线程才碰 PTY，
        控制面不许自己 send。进程已经终态就拒，不许假装写进去了。
        """
        if not isinstance(text, str) or text == "" or len(text.encode("utf-8")) > 8 * 1024:
            raise ValueError("project_shell_stdin_invalid")
        if any(char in text for char in ("\x00",)):
            raise ValueError("project_shell_stdin_invalid")
        operation = self.store.get_operation(operation_id, owner_id=owner_id)
        if operation.kind != "runtime.exec" or operation.status in TERMINAL:
            raise ValueError("project_shell_stdin_not_available")
        with self._lock:
            self._stdin.setdefault(operation_id, []).append(
                {"text": text, "pressEnter": bool(press_enter)})
        self._wake.set()

    def peek_stdin(self, operation_id: str) -> list[dict]:
        with self._lock:
            return list(self._stdin.get(operation_id) or [])

    def take_stdin(self, operation_id: str) -> list[dict]:
        with self._lock:
            return self._stdin.pop(operation_id, [])

    def cancel(self, operation_id: str, *, owner_id: str) -> ProjectOperation:
        operation = self.store.request_operation_cancel(operation_id, owner_id=owner_id)
        self._wake.set()
        return operation

    def submit_patch(self, runtime_operation_id: str, *, owner_id: str, expected_revision: str,
                     approval_ref: str, idempotency_key: str, changes: list[dict]) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        for attempt in range(_ADMISSION_ATTEMPTS):
            parent = self.store.get_operation(runtime_operation_id, owner_id=owner_id)
            # Recheck the live plan using the current source. The enqueue CAS
            # checks the requested base and may return an identical saved call.
            project = self.store.get_project(parent.projectId, owner_id=owner_id)
            candidate = parent.model_copy(update={"runtime": None, "expectedRevision": project.currentRevision,
                                                   "approvalRef": approval_ref})
            self.authorizer(self.store, candidate, owner_id)
            try:
                operation = self.store.enqueue_runtime_patch(runtime_operation_id, owner_id=owner_id,
                    expected_revision=expected_revision, approval_ref=approval_ref,
                    idempotency_key=idempotency_key, changes=changes)
            except ProjectConflict as exc:
                # The lease heartbeat can invalidate a healthy admission CAS.
                # Only confirmed zero-row writes may retry; an unknown SQL
                # reply may already own a child and must reach the caller.
                if str(exc) != "project_runtime_patch_changed" or attempt == _ADMISSION_ATTEMPTS - 1:
                    raise
                _admission_backoff(attempt)
                continue
            self._wake.set()
            return operation

    def submit_verification(self, runtime_operation_id: str, *, owner_id: str, expected_revision: str,
                            approval_ref: str, idempotency_key: str,
                            acceptance_requirements: list[str] | None = None) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        for attempt in range(_ADMISSION_ATTEMPTS):
            parent = self.store.get_operation(runtime_operation_id, owner_id=owner_id)
            candidate = parent.model_copy(update={"approvalRef": approval_ref})
            self.authorizer(self.store, candidate, owner_id)
            revision = self.store.get_revision(parent.projectId, expected_revision, owner_id=owner_id)
            suite_version = suite_for_template(revision.templateVersion)
            try:
                operation = self.store.enqueue_runtime_verification(runtime_operation_id,
                    owner_id=owner_id, expected_revision=expected_revision, approval_ref=approval_ref,
                    idempotency_key=idempotency_key, suite_version=suite_version,
                    acceptance_requirements=normalize_acceptance_requirements(acceptance_requirements))
            except ProjectConflict as exc:
                # A confirmed zero-row admission may race the healthy heartbeat.
                # Read and authorize everything again, never replay unknown IO.
                if str(exc) != "project_runtime_patch_changed" or attempt == _ADMISSION_ATTEMPTS - 1:
                    raise
                _admission_backoff(attempt)
                continue
            self._wake.set()
            return operation

    def _scan_loop(self) -> None:
        # 原来每一跳一行 WARNING、不带调用栈：断一整天 Sentry 里也没有一条问题（OutageLog 头注，跟控制回合那条循环成对）。
        outage = OutageLog(logger, "project runtime scan")
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
                outage.ok()
            except Exception as exc:
                outage.failed(exc)
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
            # 这条工程操作里的报错带上操作号 / 工程 / 会话（services.error_reporting.reporting_scope）。
            with reporting_scope(operation_id=original.operationId, project_id=original.projectId,
                                 operation_kind=original.kind, owner_id=owner_id), context.heartbeat:
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
                    if code in APP_OUTCOME_CODES:
                        # 生成的工程自己的结局（命令退出码非 0、依赖装不上、开发服务器自己崩了）：模型下一步会去改，
                        # 不是平台出错。记 WARNING（进日志、带操作标签），不成 Sentry 问题。
                        logger.warning(f"project operation {original.kind} ended: {code} (operation=%s)", original.operationId)
                    else:
                        # 平台这一侧（沙盒提供方、身份库、存储……）：ERROR 带调用栈，错误上报才收得到
                        # （control_run_service._report_abnormal_run_end 头注，同一个缺口）。
                        logger.error(f"project operation {original.kind} failed: {code[:120]} (operation=%s)",
                                     original.operationId, exc_info=exc)
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


#: 办公技能约定的中间产物目录：里面的 xlsx/docx/pptx 是工作底稿，不是给用户的交付（第 175 轮，见收集处）。
_OFFICE_WORKING_DIRS = frozenset({"bridge"})


class _RuntimeTask:
    def __init__(self, supervisor, owner_id, lease, original):
        self.supervisor, self.store, self.provider = supervisor, supervisor.store, None
        self.owner_id, self.lease, self.original = owner_id, lease, original
        self.operation_id = original.operationId
        self.runtime = original.runtime or RuntimeInstance(runtimeId="rt-" + original.operationId,
            workspaceId=lease.workspaceId, projectId=original.projectId, revision=original.expectedRevision,
            status="provisioning", port=_initial_port(original), lastHeartbeat=_timestamp(),
            expiresAt=time.time() + supervisor.lifetime_seconds)
        self.handle = WorkspaceHandle(lease.workspaceId, lease.sandboxId) if lease.sandboxId else None
        self.heartbeat = _LeaseHeartbeat(self.store, None, original.projectId, owner_id, lease, supervisor.lease_ttl)
        self.log_offsets: dict[str, int] = {}
        self.result = dict(original.result or {})
        self.result.setdefault("idleSeconds", supervisor.idle_seconds)
        if original.kind == "runtime.exec":
            script = original.input.get("script")
            self.result.setdefault("command", script if isinstance(script, str) else original.input.get("command"))
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
        self._authorize_actor()

    def _authorize_actor(self):
        """每一轮都确认账号还有权限。查不到（身份库抖动）给一个宽限窗口，吊销照旧当场停。

        ⚠ 2026-10-08 用户本机打开 sr-20261007224601-HQHS3XKPBX（@interaction-design 播客收藏按钮）的预览：自动唤醒的
          runtime.start pop-5e230d6f…、点「重新打开」的 pop-1c16d922…，两次都 failed / project_actor_unavailable——后一次
          Vite 已经 ready、预览授权也发了，三分多钟后被掐。右栏「预览页面没有回应」。同一晚这台网关反复回 db-api http 500。
          check() 每轮（最快 0.12s）查一次身份库，09-16 只修了「查到空」（复查一次），「查库抛错」这条一次就杀。
          连续不可用不到 _ACTOR_UNAVAILABLE_GRACE_SECONDS 只记日志、这一轮放过；超过还是停（fail-closed 不变）。
          浏览器每次进预览，网关那一侧另有独立的 authorize（routes/project_preview），不受这里影响。
        """
        try:
            authorize_project_actor(self.owner_id)
        except PermissionError as exc:
            if str(exc) != "project_actor_unavailable":
                raise
            now = time.time()
            since = getattr(self, "_actor_unavailable_since", None) or now
            self._actor_unavailable_since = since
            if now - since >= _ACTOR_UNAVAILABLE_GRACE_SECONDS:
                logger.warning("project actor lookup unavailable for %.0fs, stopping runtime owner=%s",
                               now - since, self.owner_id)
                raise
            logger.warning("project actor lookup unavailable (%.0fs so far), keeping runtime owner=%s",
                           now - since, self.owner_id)
            return
        self._actor_unavailable_since = None

    def sleep(self, *, tight=False):
        # Console typing is ~50 cps. A 2s poll turns that into a jump. 120ms
        # keeps the pane looking like a machine being typed on.
        self.supervisor._stop.wait(0.12 if tight else self.supervisor.poll_interval)

    def _is_console_pid(self, pid):
        refs = self.heartbeat.lease.processRefs
        return any(refs.get(key) == pid and refs.get(f"{key}Console") == "1"
                   for key in ("install", "command"))

    def _attach_console(self, pid):
        if not self._is_console_pid(pid):
            return
        attach = getattr(self.provider, "attach_console", None)
        if callable(attach):
            attach(self.handle, pid)

    def _start_visible(self, key, command, *, timeout_seconds):
        """Install / exec go through a PTY when the provider has one.

        2026-09-15: reconstructing `$ cmd` + `runtime.log` is a log viewer.
        Manus types into bash. Vite stays on start_process — same command in
        both places would run twice.
        """
        start_console = getattr(self.provider, "start_console", None)
        if callable(start_console):
            result = start_console(self.handle, command, timeout_seconds=timeout_seconds)
            self._register(key, result.process_id, console=True)
            return result
        result = self.provider.start_process(self.handle, command, timeout_seconds=timeout_seconds)
        self._register(key, result.process_id)
        return result

    def logs(self, pid):
        if pid not in self.log_offsets:
            offset, seq = 0, 0
            while True:
                events = self.store.list_events(self.operation_id, owner_id=self.owner_id, after_seq=seq, limit=1000)
                for event in events:
                    if event.type in {"runtime.log", "runtime.console"} and event.payload.get("processId") == pid:
                        offset = max(offset, int(event.payload["nextOffset"]))
                if len(events) < 1000:
                    break
                seq = events[-1].seq
            self.log_offsets[pid] = offset
        self._attach_console(pid)
        if self._is_console_pid(pid):
            read_console = getattr(self.provider, "read_console", None)
            if not callable(read_console):
                raise WorkspaceProviderError("project_console_reader_missing")
            chunk = read_console(self.handle, pid, offset=self.log_offsets[pid])
            if chunk.next_offset > self.log_offsets[pid]:
                self.store.append_event(self.operation_id, owner_id=self.owner_id, event_type="runtime.console",
                    event_id=f"{pid}:console:{self.log_offsets[pid]}:{chunk.next_offset}",
                    payload={"processId": pid, "data": chunk.text, "nextOffset": chunk.next_offset,
                             "truncated": chunk.truncated},
                    lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
                self.log_offsets[pid] = chunk.next_offset
            return chunk.next_offset
        chunk = self.provider.read_process_logs(self.handle, pid, offset=self.log_offsets[pid])
        if chunk.next_offset > self.log_offsets[pid]:
            self.store.append_event(self.operation_id, owner_id=self.owner_id, event_type="runtime.log",
                event_id=f"{pid}:log:{self.log_offsets[pid]}:{chunk.next_offset}",
                payload={"processId": pid, "text": chunk.text, "nextOffset": chunk.next_offset, "truncated": chunk.truncated},
                lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
            self.log_offsets[pid] = chunk.next_offset
        return chunk.next_offset

    def _persist_process_output(self, pid, executed):
        """把 process_result 里的 stdout/stderr 补进操作日志。

        ⚠ 2026-09-22 FFR6：PTY 缓冲是空的时，read_console 不写事件，
          但 process_result 仍可能带着同一段输出。只写日志里还没有的部分，
          避免和已经落库的 runtime.console 再贴一遍。
        """
        parts = [str(getattr(executed, "stdout", "") or ""), str(getattr(executed, "stderr", "") or "")]
        text = "".join(part for part in parts if part)
        if not text.strip():
            return
        have = []
        events = self.store.list_events(self.operation_id, owner_id=self.owner_id, after_seq=0, limit=1000)
        for event in events:
            if event.type not in {"runtime.log", "runtime.console"}:
                continue
            payload = event.payload if isinstance(event.payload, dict) else {}
            if payload.get("processId") != pid:
                continue
            have.append(str(payload.get("text") or payload.get("data") or ""))
        if text in "".join(have):
            return
        encoded = text.encode("utf-8", errors="replace")
        offset = self.log_offsets.get(pid, 0)
        next_offset = offset + len(encoded)
        self.store.append_event(self.operation_id, owner_id=self.owner_id, event_type="runtime.console",
            event_id=f"{pid}:captured:{offset}:{next_offset}",
            payload={"processId": pid, "data": text, "nextOffset": next_offset, "truncated": False},
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
        self.log_offsets[pid] = next_offset

    @property
    def _custom_command(self) -> str | None:
        """模型给的启动命令（runtime.start 的 input.command）。没有 = 模板的 Vite。"""
        given = self.original.input if self.original.kind == "runtime.start" and isinstance(self.original.input, dict) else {}
        command = given.get("command")
        return command if isinstance(command, str) and command.strip() else None

    def _serving(self, pid, revision: str | None = None) -> bool:
        """开发服务器在不在给这一版提供服务。开箱就绪、健康巡检、源码同步之后，三处同一个判断（§4）。

        Vite：页面 200 且 public/ 下的修订标记就是这一版（provider.probe）。自定义命令：服务器不会替我们发修订标记，
        改成「这个进程（含子进程）在监听、那个端口回得出 HTTP」——哪个端口在听就认哪个（_custom_ready）。
        """
        if not self._custom_command:
            return self.provider.probe(self.handle, self.runtime.port, expected_revision=revision or self.runtime.revision)
        return self._custom_ready(pid)

    def _custom_ready(self, pid) -> bool:
        lister = getattr(self.provider, "listening_ports", None)
        prober = getattr(self.provider, "probe_http", None)
        if not callable(lister) or not callable(prober):
            return False
        try:
            ports = [port for port in lister(self.handle, pid) if isinstance(port, int) and 1024 <= port <= 65535]
        except Exception:
            logger.warning("listening port scan failed", exc_info=True)
            return False
        self.result["listeningPorts"] = sorted(ports)[:8]
        wanted = self.original.input.get("port")
        order = ([wanted] if wanted in ports else []) + [port for port in sorted(ports) if port != wanted]
        for port in order:
            try:
                answered = prober(self.handle, port)
            except Exception:
                answered = False
            if answered:
                if port != self.runtime.port:
                    self.runtime = self.runtime.model_copy(update={"port": port})
                if isinstance(wanted, int) and wanted != port:
                    self.result["requestedPort"] = wanted       # 说了 3000、实际开在 8000：认实际的，回执里照实说
                else:
                    self.result.pop("requestedPort", None)
                return True
        return False

    def development_server_command(self):
        custom = self._custom_command
        if custom:
            # 监听所有网卡（预览从隧道进来，不是 localhost）；说了端口就递给 PORT（Express、Next、Puma 认它）。
            wanted = self.original.input.get("port")
            exported = "export HOST=0.0.0.0" + (f" PORT={int(wanted)}" if isinstance(wanted, int) else "")
            return f"{exported}; {custom}"
        server_command = f"npm run dev -- --host 0.0.0.0 --port {self.runtime.port} --strictPort"
        hosts = self._vite_allowed_hosts()
        # Env alone is the Vite CLI merge. Agent `createViteServer` skips it
        # (2026-09-18 真机 server.mjs). NODE --import wraps createServer for
        # every project; do not patch durable source per revision.
        if hosts:
            logger.info("project_vite_preview_hosts relay=%s all=%s", hosts[0], hosts)
            # ⚠ 2026-09-18：logger.info 进不了 uvicorn access 日志，重启后
            #   仍拦时终端里完全看不到注入有没有跑。print flush 才能对上真机。
            print(f"[project] vite preview hosts relay={hosts[0]} all={hosts}", flush=True)
            return injected_preview_dev_command(server_command, hosts)
        return server_command

    def _published_preview_url(self):
        getter = getattr(self.provider, "preview_url", None)
        if getter is None or self.handle is None:
            return None
        try:
            return published_preview_url(getter(self.handle, self.runtime.port))
        except Exception:
            return None

    def _remember_published_preview(self):
        url = self._published_preview_url()
        if url and self.runtime.previewUrl != url:
            self.runtime = self.runtime.model_copy(update={"previewUrl": url})

    def _require_relay_origin(self):
        # Validate the private relay template before any remote IO. A bad
        # template must still fail before create / npm ci (2026-09-16).
        # ⚠ 2026-09-18：iframe Host 来自 origin template，不是来自隧道进程。
        #   本地缺 dist/project-preview/agent.cjs 时 preview_runtime 是 None，
        #   上一版这里直接 return None，中继 Host 永远不进 Vite 名单——
        #   启动日志 `[startup] project preview agent bundle unavailable`，
        #   预览照样兑票，Vite 照样拦 sslip.io。
        if self.original.kind != "runtime.start":
            return None
        try:
            preview_host = urlsplit(origin_for_runtime(self.runtime.runtimeId)).hostname
        except ValueError:
            if self.supervisor.preview_runtime is not None:
                raise
            return None
        if not preview_host:
            raise ValueError("project_preview_origin_invalid")
        return preview_host

    def _vite_allowed_hosts(self):
        # ⚠ 2026-09-18 真机（allowlist + 156 sslip 中继）：上一版
        #   `_vite_allowed_host` 让 E2B `get_host` 赢，启动命令只放行
        #   `5173-*.e2b.app`。iframe 的 Host 是
        #   `{runtimeId}.preview.156.239.47.108.sslip.io`，Vite 7 回
        #   「Blocked request. This host is not allowed」——票已经兑上了，
        #   应用自己把预览拦了。allowlist 出票走中继，internal 无隧道才走
        #   发布域；两个 Host 都要进名单，不许互斥。Never take hosts from
        #   tool input or set allowedHosts=true.
        hosts = []
        relay = self._require_relay_origin()
        if relay:
            hosts.append(relay)
        published = self._published_preview_url()
        if published:
            name = urlsplit(published).hostname
            if name and name not in hosts:
                hosts.append(name)
        return hosts

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
        script = self.original.input.get("script") if self.original.kind == "runtime.exec" else None
        if self.original.kind == "runtime.exec":
            if isinstance(script, str):
                script = sandbox_shell_script(script)
            elif not isinstance(command, str) or command not in PROJECT_COMMANDS:
                raise ValueError("invalid_project_command")
        self._require_relay_origin()
        if self.original.runtime is None:
            self.save("provisioning")
            files = self.store.read_files(self.original.projectId, self.original.expectedRevision, owner_id=self.owner_id)
            if REVISION_FILE in files:
                orch_trace("lockfile", reason="revision_file", files=sorted(str(n) for n in files))
                self.result["gate"] = "revision_file:" + ",".join(sorted(str(n) for n in files))[:300]
                raise ValueError("project_lockfile_or_reserved_path_invalid")
            revision = self.store.get_revision(
                self.original.projectId, self.original.expectedRevision, owner_id=self.owner_id)
            skip_install = skip_vite_dependency_install(
                operation_kind=self.original.kind,
                template_version=revision.templateVersion,
                files=files,
            )
            # ⚠ 2026-09-22 Z8NPKNM14C：树只有 README.md，skip 助手按源码应返回
            #   True，真机仍 lockfile。没有 package.json 就不是 Vite 开箱，
            #   不把这一发交给「助手返回了 False」。
            bare = "package.json" not in files and "package-lock.json" not in files
            if bare and self.original.kind == "runtime.exec":
                skip_install = True
            # ⚠ 2026-09-24 MB5NJX8X2D：办公模板上后来有了 package.json，
            #   助手若仍返回 False，就会 npm ci 并拆掉沙盒。模板说了算。
            if (
                str(revision.templateVersion) == WORKSPACE_TEMPLATE_VERSION
                and self.original.kind == "runtime.exec"
            ):
                skip_install = True
            self.result["gate"] = (
                f"template={revision.templateVersion} "
                f"files={sorted(str(n) for n in files)} skip={bool(skip_install)}"
            )[:300]
            orch_trace(
                "exec-gate",
                kind=self.original.kind,
                template=revision.templateVersion,
                files=sorted(str(n) for n in files),
                skip=bool(skip_install),
                bare=bare,
            )
            if "package-lock.json" not in files and not skip_install and not self._custom_command:
                # ⚠ 2026-09-21 XSGAMK9PYZ：源码只有 README.md / workspace-1，
                #   bash 仍 lockfile。打印当时那一发，别再对着测试里的 dict 猜。
                self.result["gate"] = (
                    f"template={revision.templateVersion} "
                    f"files={sorted(str(n) for n in files)} skip={skip_install}"
                )[:300]
                print(
                    f"[project] lockfile gate kind={self.original.kind} "
                    f"template={revision.templateVersion!r} "
                    f"files={sorted(str(n) for n in files)} skip={skip_install}",
                    flush=True,
                )
                raise ValueError("project_lockfile_or_reserved_path_invalid")
            # ⚠ 2026-09-22 BABCJGGB44：办公 bash 每条命令都拆沙盒再建。
            #   pip 和刚写出的 pptx 下一条就没了，模型只好把文件 base64
            #   塞进日志。没有 package.json 的工作区留下同一个沙盒。
            reused = False
            # 自定义命令起服务：复用这个工程开着的那台（模型先用命令装好的依赖在里面）。
            if (skip_install or self._custom_command) and self.handle is not None:
                try:
                    self.provider.connect(self.handle)
                    reused = True
                except Exception:
                    self.handle = None
            if not reused:
                if self.handle is not None:
                    self.provider.destroy(self.handle)
                    self.handle = None
                self.check()
                self.heartbeat.renew(sandbox_id=None, process_refs={"operationId": self.operation_id})
                for orphan in self.provider.find_workspaces(workspace_id=self.lease.workspaceId):
                    self.heartbeat.check()
                    self.provider.destroy(orphan)
                # ⚠ 2026-09-22 办公文件生在 E2B，预览却在主机上找 soffice。
                #   只有 whybuddy-workspace-1 使用办公镜像。没配模板仍用默认
                #   code-interpreter，不许因此拒绝开箱。网页工程不传这张镜像。
                # ⚠ 2026-10-09：网页 / 后端工程用全家桶镜像（workspace_e2b_template 头注），没配仍是默认。
                image = (
                    office_e2b_template()
                    if str(revision.templateVersion) == WORKSPACE_TEMPLATE_VERSION
                    else workspace_e2b_template()
                )
                self.handle = self.provider.create(
                    workspace_id=self.lease.workspaceId, template=image)
            orch_trace(
                "sandbox",
                reused=reused,
                sandbox=None if self.handle is None else self.handle.sandbox_id,
            )
            self.heartbeat.renew(sandbox_id=self.handle.sandbox_id, process_refs={"operationId": self.operation_id})
            self.heartbeat.handle = self.handle
            if skip_install:
                self.result["keepSandbox"] = True
            restore_application_data(self)
            self.save("syncing")
            self.provider.write_files(self.handle, {**files, REVISION_FILE: json.dumps({"revision": self.runtime.revision})})
            # 留住这台沙盒的工作区才谈得上「命令在沙盒里改了源码」：记下刚写进去的样子，命令跑完对一遍。
            self._synced_hashes = ({name: content_hash(text) for name, text in files.items() if isinstance(text, str)}
                                   if skip_install else None)
            # 命令结束时把沙盒里改动的源码收回成新版本（_write_back_sources）：要知道写进去的是哪一版、哪些字节。
            self._synced_texts = {name: text for name, text in files.items() if isinstance(text, str)}
            self._mount_session_uploads()
            self._mount_delivered_files()
            if not reused:
                # ⚠ 2026-09-28 隔离真机第 78 轮 sr-20260928004742-PZZS967DE4（@office-skills 做新品发布会 PPT，追问
                #   「用 office-skills 自带的校验脚本再检查一遍」）：技能工具描述写着「技能目录在
                #   工程沙盒 .sliderule/skills/<name>/，脚本用 shell_exec 跑」，模型照着
                #   `find .sliderule/skills/office-skills …` → 五个技能全是 No such file or
                #   directory；接着 `find / -path '*/office-skills/*'`、`find /home/user …`，
                #   最后说「环境中没有单独安装名为 validate.py 的脚本」，自己另写一个。追问 10 分
                #   39 秒，一半在找技能文件。
                #   开箱注水（hydrate_owner_into）只接在 ProjectRuntimeService.start 上——
                #   模块头自己写着「retained for the explicit primitive smoke command」，产线
                #   一个调用者都没有（本仓 §一：装在不通电的插座上）。沙盒真正在这里建。
                #   只在新建的沙盒写：复用的那台开箱时已经写过；之后才装的技能由安装接口
                #   try_hydrate_running_project 直接写进在跑的沙盒。增强类，fail-open（§七）。
                self.result["skillFiles"] = hydrate_owner_into(
                    self.provider.write_files, self.handle, self.owner_id)
            self.heartbeat.renew(mounted_revision=self.runtime.revision)
            self.check()
            if skip_install:
                self.save("executing")
                visible = script if isinstance(script, str) else f"npm run {command}"
                self._start_visible("command", visible, timeout_seconds=900)
                phase = "executing"
            elif self._custom_command:
                # 模型自己的启动命令：不 npm ci（装依赖是命令自己的事：npm install && npm run dev、pip install …），
                # 起来之后认端口。第一次编译慢（Spring Boot、.NET），给到安装那档的时限。
                self.result["phaseDeadline"] = time.time() + max(self.supervisor.ready_timeout,
                                                                 self.supervisor.install_timeout)
                self.save("starting")
                started = self.provider.start_process(self.handle, self.development_server_command(),
                                                      timeout_seconds=900)
                self._register("server", started.process_id)
                phase = "starting"
            else:
                self.result["phaseDeadline"] = time.time() + self.supervisor.install_timeout
                self.save("installing")
                self._start_visible("install", "npm ci --ignore-scripts", timeout_seconds=600)
                phase = "installing"
        else:
            if self.handle is None:
                raise WorkspaceProviderError("runtime_dispatch_uncertain")
            self.provider.connect(self.handle)
            self.heartbeat.handle = self.handle
            if self.original.kind == "runtime.start":
                recover_project_verifications(self)
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
                self.sleep(tight=self._is_console_pid(pid))
            installed = self.provider.process_result(self.handle, pid)
            while True:
                previous = self.log_offsets.get(pid, 0)
                if self.logs(pid) == previous:
                    break
            self._persist_process_output(pid, installed)
            if installed.exit_code != 0:
                if self.original.kind == "runtime.exec":
                    self.result["installExitCode"] = installed.exit_code
                raise WorkspaceProviderError("project_dependency_install_failed", result=installed)
            self.check()
            self.supervisor.authorizer(self.store, self.original, self.owner_id)
            if self.original.kind == "runtime.exec":
                self.save("executing")
                visible = script if isinstance(script, str) else f"npm run {command}"
                self._start_visible("command", visible, timeout_seconds=900)
                phase = "executing"
            else:
                self.result["phaseDeadline"] = time.time() + self.supervisor.ready_timeout
                self.save("starting")
                started = self.provider.start_process(self.handle,
                    self.development_server_command(), timeout_seconds=900)
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
                if self._serving(pid):
                    break
                if time.time() >= self.result["phaseDeadline"]:
                    raise WorkspaceProviderError("project_readiness_timeout")
                self.sleep()
            self.result["readyAt"] = time.time()
        elif not self._serving(pid):
            raise WorkspaceProviderError("project_recovery_health_failed")
        previous = published_preview_url(self.runtime.previewUrl)
        self._remember_published_preview()
        now = published_preview_url(self.runtime.previewUrl)
        if phase != "starting" and now and previous != now and not self._custom_command:
            # 2026-09-16 TicketStream：刚拿到发布地址时停掉旧进程再起一次，
            # 让 __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS 带上 E2B 发布域。
            # 2026-09-18：中继 Host 必须一直在名单里，不能被这次重启换掉。
            # 后续 lease 续上 previous==now，不再重启。
            stopper = getattr(self.provider, "stop", None)
            if callable(stopper):
                stopper(self.handle, pid)
            started = self.provider.start_process(
                self.handle, self.development_server_command(), timeout_seconds=900)
            self._register("server", started.process_id)
            pid = started.process_id
            self.runtime = self.runtime.model_copy(update={"processId": pid})
            if not self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision):
                raise WorkspaceProviderError("project_runtime_health_failed")
        self.save("ready")
        next_health = 0
        while True:
            self.check()
            # A formal verification temporarily serves built assets, then starts
            # a fresh dev process. Never retain its predecessor's PID in this loop.
            pid = self._process("server")
            checkpoint_application_data(self)
            if sync_next_source_patch(self):
                next_health = 0
            operation_count = self.store.project_operation_count(self.original.projectId, owner_id=self.owner_id)
            observed = self.operation()
            last_access = max(self.result["readyAt"], observed.lastAccessAt or 0,
                self.store.runtime_patch_activity_at(self.operation_id, owner_id=self.owner_id))
            if time.time() - last_access >= min(float(self.result["idleSeconds"]), self.supervisor.idle_seconds):
                if self.try_finish_idle(operation_count, observed.lastAccessAt):
                    return
                continue
            self.logs(pid)
            if time.time() >= next_health:
                if not self.provider.is_process_running(self.handle, pid) or not self._serving(pid):
                    raise WorkspaceProviderError("project_runtime_health_failed")
                self._remember_published_preview()
                self.save("ready")
                next_health = time.time() + min(30, self.supervisor.lease_ttl / 3)
            if self.supervisor.preview_runtime is not None:
                try:
                    self.supervisor.preview_runtime.ensure(self)
                except PermissionError:
                    # ⚠ 2026-09-25：取消落在上面 check() 与这里之间时，预览授权先
                    #   看见 cancelRequested、抛 project_preview_unavailable，用户的
                    #   取消被记成 failed。先复查一次：是取消就按取消收尾。
                    #   （test_published_e2b_host_does_not_drop_the_relay_host 约
                    #   1/10 卡死在等 stopped，就是这个窗口。）
                    self.check()
                    raise
            checkpoint_application_data(self)
            if run_next_project_verification(self):
                next_health = 0
            checkpoint_application_data(self)
            self.sleep()

    def run_command(self):
        pid = self._process("command")
        self.runtime = self.runtime.model_copy(update={"processId": pid})
        self.save("executing")
        while True:
            self.check()
            self.logs(pid)
            self._flush_stdin()
            if not self.provider.is_process_running(self.handle, pid):
                break
            self.sleep(tight=self._is_console_pid(pid))
        executed = self.provider.process_result(self.handle, pid)
        self.result["exitCode"] = executed.exit_code
        while True:
            previous = self.log_offsets.get(pid, 0)
            if self.logs(pid) == previous:
                break
        self._persist_process_output(pid, executed)
        # 命令结束后都扫。失败也可能已经写出 .pptx；收集 fail-open。
        self._collect_office_artifacts()
        # 命令改的源码收回成新版本；收不回来（冲突、超限、扫不了）才退回老办法：点名「只改在沙盒里」。
        if not self._write_back_sources():
            self._note_sandbox_only_edits()
        if executed.exit_code is None:
            raise WorkspaceProviderError("project_command_result_unknown", result=executed)
        if executed.exit_code != 0:
            raise WorkspaceProviderError("project_command_failed", result=executed)
        self.check()
        self.finish("completed", "stopped", None)

    def _mount_session_uploads(self) -> None:
        """Copy session uploads onto the workspace root before the command runs.

        OpenHands copy_to's the live runtime. This sandbox is created here.

        ⚠ 2026-09-23 review：上一版任何一步失败都直接抛——provider 没有
          write_bytes、库读一份上传失败、某一行 sha256 对不上——结果是这个会话
          里**所有**命令都起不来，连 `ls` 也不行，跟那份文件有没有关系无关。
          而且每条命令都把全部上传（最多 8 × 15MB）从库里读一遍、推一遍。

          现在按文件 fail-open：放不进去的记进 `uploadsSkipped`，随回执交给
          模型——**不是**静默吞掉（§7：可以不挡路，不许装作放好了）。同一台
          沙盒里 sha256 没变的原件不再重推。
        """
        try:
            rows = self.store.list_session_uploads(self.original.sessionId, owner_id=self.owner_id)
        except Exception:
            logger.warning("session upload listing failed", exc_info=True)
            self.result["uploadsSkipped"] = ["(上传清单读不到)"]
            return
        if not rows:
            return
        writer = getattr(self.provider, "write_bytes", None)
        if writer is None:
            self.result["uploadsSkipped"] = [str(row["name"]) for row in rows][:8]
            return
        sandbox_id = str(getattr(self.handle, "sandbox_id", "") or "")
        with self.supervisor._lock:
            mounted = dict(self.supervisor._mounted_uploads.get(sandbox_id, {}))
        skipped: list[str] = []
        for row in rows:
            name = str(row["name"])
            if sandbox_id and mounted.get(name) == row["sha256"]:
                continue
            try:
                data = self.store.read_session_upload(
                    self.original.sessionId, name, owner_id=self.owner_id)
                writer(self.handle, name, data)
            except Exception:
                logger.warning("session upload mount failed name=%s", name, exc_info=True)
                skipped.append(name)
                continue
            mounted[name] = row["sha256"]
        if sandbox_id:
            with self.supervisor._lock:
                # 只留最近这些台沙盒的账：它们用完就销毁，账不必永远记着。
                if len(self.supervisor._mounted_uploads) >= 64 and sandbox_id not in self.supervisor._mounted_uploads:
                    self.supervisor._mounted_uploads.pop(next(iter(self.supervisor._mounted_uploads)))
                self.supervisor._mounted_uploads[sandbox_id] = mounted
        if skipped:
            self.result["uploadsSkipped"] = skipped[:8]

    def _mount_delivered_files(self) -> None:
        """本工程已经交付过的文件（产物库里的），按原路径放回沙盒——追问要在原文件上改。

        ⚠ 2026-10-07 真机 r53 sr-20261007065206-968KDGMNFE（「新员工入职须知」Word 追问：第一周改成五天、去掉一个冒号、
          其他不要动）：上一轮是 heredoc 里直接 python 生成的 docx，源码里没有脚本，文件只在产物库。沙盒回收后新起的这台只有
          源码——模型 find、python-docx 打开、make_manus_page 轮番找不到原件，最后「按原文档结构重新生成」，整份重写：
          欢迎语、报到流程四条、材料清单都变了，收尾还说「其他内容保持不变」。r35 的 PPT 追问能定点改，是因为生成脚本
          在源码里。原件在不在沙盒里，不该取决于上一轮恰好怎么生成的。

        同 _mount_session_uploads：按文件 fail-open，放不进去的记进 deliveredSkipped 随回执交给模型（不静默）；
        同一台沙盒里 sha256 没变的不再重推（不会拿产物库的旧版盖掉沙盒里刚改、还没收回的那份——收回之后 sha 才变）。
        """
        try:
            rows = ProjectOfficeArtifactStore(self.store).list(self.original.projectId, owner_id=self.owner_id)
        except Exception:
            logger.warning("delivered file listing failed", exc_info=True)
            return
        if not rows:
            return
        writer = getattr(self.provider, "write_file_bytes", None)
        if writer is None:
            return
        sandbox_id = str(getattr(self.handle, "sandbox_id", "") or "")
        with self.supervisor._lock:
            mounted = dict(self.supervisor._mounted_uploads.get(sandbox_id, {}))
        skipped: list[str] = []
        store = ProjectOfficeArtifactStore(self.store)
        for row in rows:
            path, sha = str(row.get("path") or ""), str(row.get("sha256") or "")
            key = "delivered:" + path
            if not path or (sandbox_id and mounted.get(key) == sha):
                continue
            try:
                _meta, data = store.get_bytes(self.original.projectId, str(row["artifactId"]), owner_id=self.owner_id)
                writer(self.handle, path, data)
            except Exception:
                logger.warning("delivered file mount failed path=%s", path, exc_info=True)
                skipped.append(path)
                continue
            mounted[key] = sha
        if sandbox_id:
            with self.supervisor._lock:
                if len(self.supervisor._mounted_uploads) >= 64 and sandbox_id not in self.supervisor._mounted_uploads:
                    self.supervisor._mounted_uploads.pop(next(iter(self.supervisor._mounted_uploads)))
                self.supervisor._mounted_uploads[sandbox_id] = mounted
        if skipped:
            self.result["deliveredSkipped"] = skipped[:8]

    def _office_scan_is_a_command_fact(self) -> bool:
        # 用类上的函数调用：收集测试把 SimpleNamespace 当 self 传进来，
        # self.方法 会找不到这个函数。
        try:
            original = self.original
            revision_id = getattr(original, "expectedRevision", None)
            if not revision_id:
                project = self.store.get_project(original.projectId, owner_id=self.owner_id)
                revision_id = project.currentRevision
            revision = self.store.get_revision(
                original.projectId, revision_id, owner_id=self.owner_id)
        except Exception:
            return False
        return str(revision.templateVersion) == WORKSPACE_TEMPLATE_VERSION

    def _remember_held_office_files(self, report_miss: bool, *, failed: bool = False) -> None:
        """扫空时把产物库里已有的路径写回回执。

        ⚠ 2026-09-24 sr-20260924190011：上一间沙盒已经收回 pptx，下一条命令
          扫空，回执写成「没有合格的办公文件」。模型往源码树写 pending、
          base64 占位和 1×1 预览图。库里有的路径仍是交付，不许改口说没有。
        ⚠ 2026-09-24 review：上一版把库里的旧路径写进 officeFiles，回执于是说
          「办公文件已收回：X。这就是交付」。模型让命令重新生成、脚本静默
          没写出文件，看到的仍是「已收回」——一次失败的重生成被说成交付。
          旧路径单放 officeFilesHeld，回执另有一句「这次没有产出新文件」。
        """
        if not report_miss or self.result.get("officeFiles"):
            return
        try:
            rows = ProjectOfficeArtifactStore(self.store).list(
                self.original.projectId, owner_id=self.owner_id)
        except Exception:
            rows = []
        paths: list[str] = []
        for item in rows:
            path = item.get("path") if isinstance(item, dict) else None
            if isinstance(path, str) and path not in paths:
                paths.append(path)
                _RuntimeTask._remember_download(self, path, item.get("artifactId"))
        if paths:
            self.result["officeFilesHeld"] = paths[:MAX_DELIVERED_FILES]
            return
        self.result["officeScan"] = "failed" if failed else "empty"

    def _remember_download(self, path, artifact_id) -> None:
        """回执里给这份文件的真实下载地址（office_artifact_download_url 头注）。"""
        if not isinstance(path, str) or not isinstance(artifact_id, str) or not artifact_id:
            return
        downloads = dict(self.result.get("officeDownloads") or {})
        if path not in downloads and len(downloads) < MAX_DELIVERED_FILES:
            downloads[path] = office_artifact_download_url(self.original.projectId, artifact_id)
        self.result["officeDownloads"] = downloads

    def _write_back_sources(self) -> bool:
        """命令在沙盒里生成、改动、删掉的源码文件，收回成工程的新版本（services.project_source_scan 头注）。

        ⚠ 2026-10-09：源码权威在库里，每条命令开跑前按库里那版重写沙盒——官方脚手架（npm create vue、
          django-admin startproject、cargo new、dotnet new）、`npm install 某包` 改的 package.json，下一条命令全被
          还原，通用 Agent 只能一个文件一个文件 file_write。退出码不看：脚手架成功、后面的 npm install 失败，
          脚手架生成的文件照样在，还原掉才是丢东西。

        增强类，fail-open（§七）：扫不了、写不进（版本被别的写入抢先、超出源码库上限）就返回 False，照旧点名；
        二进制 / 超大的文件不收，在回执里点名，不假装收了。返回 True = 沙盒和源码已经一致（收了或本来就没变）。
        """
        synced = getattr(self, "_synced_texts", None)
        collector = getattr(self.provider, "collect_source_changes", None)
        if synced is None or not callable(collector) or self.handle is None:
            return False
        skip = set(_RuntimeTask._uploaded_originals(self))
        try:
            skip |= {str(row.get("path") or "") for row in
                     ProjectOfficeArtifactStore(self.store).list(self.original.projectId, owner_id=self.owner_id)}
        except Exception:
            logger.warning("delivered file listing failed before source write-back", exc_info=True)
        try:
            report = collector(self.handle, {name: content_hash(text) for name, text in synced.items()},
                               skip_paths=sorted(p for p in skip if p))
        except Exception:
            logger.warning("source write-back scan failed", exc_info=True)
            self.result["sourceWriteBack"] = {"error": "project_source_scan_failed"}
            return False
        changed = {path: text for path, text in (report.get("changed") or {}).items()
                   if isinstance(path, str) and isinstance(text, str)}
        deleted = [path for path in report.get("deleted") or [] if isinstance(path, str) and path in synced]
        skipped = [item for item in report.get("skipped") or []
                   if isinstance(item, dict) and not is_office_artifact_path(str(item.get("path") or ""))][:8]
        receipt = {"changed": sorted(changed)[:20], "changedCount": len(changed), "deleted": deleted[:20]}
        if skipped:
            receipt["skipped"] = skipped
        if report.get("truncated"):
            receipt["truncated"] = True
        if not changed and not deleted:
            if skipped:
                self.result["sourceWriteBack"] = receipt
            return True
        files = {**synced, **changed}
        for path in deleted:
            files.pop(path, None)
        try:
            base = self.store.get_revision(self.original.projectId, self.original.expectedRevision, owner_id=self.owner_id)
            saved = self.store.commit_revision(self.original.projectId, owner_id=self.owner_id,
                expected_revision=self.original.expectedRevision, files=files, template_version=base.templateVersion,
                plan_ref=self.original.approvalRef, spec_revision=base.specRevision,
                lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
        except (ProjectConflict, ValueError) as exc:
            # 命令跑着的时候别的写入先落了库（版本对不上），或收回来的超出源码库上限：不覆盖，照实说没收。
            receipt["error"] = str(exc)[:120] or type(exc).__name__
            self.result["sourceWriteBack"] = receipt
            return False
        except Exception:
            logger.warning("source write-back commit failed", exc_info=True)
            receipt["error"] = "project_source_write_back_failed"
            self.result["sourceWriteBack"] = receipt
            return False
        try:
            # 会话上的版本指针是可修复的投影（project_creation 头注）：版本已经落库，指针没跟上不算没收回。
            sync_session_project(self.store, self.original.sessionId, owner_id=self.owner_id,
                                 approval_ref=self.original.approvalRef)
        except Exception:
            logger.warning("session pointer not synced after source write-back", exc_info=True)
        self._synced_texts = files
        receipt["revision"] = saved.revision
        self.result["sourceWriteBack"] = receipt
        logger.info("project %s command wrote back %d files, deleted %d", self.original.projectId,
                    len(changed), len(deleted))
        return True

    def _note_sandbox_only_edits(self):
        """命令在沙盒里改了工程源码文件：记下来，回执照实说「只在沙盒里、下一条命令会被还原」。

        ⚠ 2026-09-29 隔离真机第 107 轮 sr-20260929070420-W29Y3BK1EP（设计工作室员工手册 Word）：
          追问「把考勤与休假那一章改成表格」，模型用 python heredoc 在沙盒里改了
          scripts/create_handbook.py 并重新生成（文档 10 张表）。工程源码里的脚本没变。下一个追问
          「加页眉页脚」读的是源码那版、file_str_replace 在源码上改；每条命令开跑前 worker 按源码把
          文件重写进沙盒——考勤表格那段被还原，重新生成后 7 张表。用户要的改动悄悄没了，没有一句报错。
          源码是权威，这条不改；只在命令结束时对一遍哈希，把「只改在沙盒里」的文件点名。
          增强类，对不上、跑不了都当没有（fail-open，§七）。
        ⚠ 2026-10-09 起这是后备：命令改的源码先由 _write_back_sources 收回成新版本，收不回来（版本冲突、超出源码库
          上限、扫不了）才走到这里点名。
        """
        synced = getattr(self, "_synced_hashes", None)
        runner = getattr(self.provider, "run", None)
        if not synced or not callable(runner) or self.handle is None:
            return
        paths = sorted(name for name in synced if _PLAIN_SOURCE_PATH.fullmatch(name))[:200]
        if not paths:
            return
        try:
            probe = runner(self.handle, "sha256sum -- " + " ".join(shlex.quote(p) for p in paths)
                           + " 2>/dev/null; true", timeout_seconds=30)
        except Exception:
            logger.warning("sandbox source drift probe failed", exc_info=True)
            return
        changed = []
        for line in str(getattr(probe, "stdout", "") or "").splitlines():
            digest, _sep, name = line.partition("  ")
            name = name.strip()
            if name in synced and re.fullmatch(r"[0-9a-f]{64}", digest) and digest != synced[name]:
                changed.append(name)
        if changed:
            self.result["sandboxOnlyEdits"] = changed[:8]

    def _uploaded_originals(self) -> dict[str, str]:
        """这个会话上传、挂在工作区根上的文件：{相对路径: sha256}。读不到就当没有（增强类，§七）——
        那时退回老样子把它收进来，不会因此少收模型的产出。"""
        session_id = getattr(getattr(self, "original", None), "sessionId", None)
        if not session_id:
            return {}
        try:
            rows = self.store.list_session_uploads(session_id, owner_id=self.owner_id)
        except Exception:
            return {}
        return {str(row["name"]): str(row["sha256"]) for row in rows if isinstance(row, dict)}

    def _collect_office_artifacts(self):
        """命令结束后把沙箱里的办公文件提进主机产物库。

        ⚠ 2026-09-20 真机：python generate_deck.py 即使当时写出了 .pptx，
          主机 file_read 也是 project_file_not_found。收集 I/O 失败不许
          改写这次命令的成败（fail-open）；完工闸另看产物（fail-closed）。
        ⚠ 2026-09-24：E2B 的 collect 每次 runtime.exec 都在，空树就是
          {"files": []}。网页 npm run build 因此被写成「没有合格的办公文件」，
          模型把它当成下一步。这句话只属于 whybuddy-workspace-1。
          扫到真文件仍收回，不看模板。
        """
        collector = getattr(self.provider, "collect_office_files", None)
        if not callable(collector) or self.handle is None:
            return
        report_miss = _RuntimeTask._office_scan_is_a_command_fact(self)
        try:
            items = collector(self.handle)
        except Exception:
            logger.warning("office artifact collect failed", exc_info=True)
            _RuntimeTask._remember_held_office_files(self, report_miss, failed=True)
            return
        if not isinstance(items, list) or not items:
            _RuntimeTask._remember_held_office_files(self, report_miss)
            return
        try:
            store = ProjectOfficeArtifactStore(self.store)
        except Exception:
            logger.warning("office artifact persist failed", exc_info=True)
            return
        originals = _RuntimeTask._uploaded_originals(self)
        for item in items:
            if not isinstance(item, dict):
                continue
            data = item.get("data")
            path = str(item.get("path") or "")
            if not isinstance(data, (bytes, bytearray)):
                continue
            payload = bytes(data)
            # 办公文件哪儿都收；文本交付物只在办公工作区里收 output/ 下的（deliverable_kind.is_auto_collected_output 头注）。
            # ⚠ 网页工程不收文本：画廊（ProjectStore 会话索引）见到任何一份产物就把工程标成「文件」，
            #   网页工程往 output/ 写个 notes.md 就会被改判成一张文件卡。
            if not ((is_office_artifact_path(path) and is_office_zip_bytes(payload))
                    or (report_miss and is_auto_collected_output(path) and is_deliverable_bytes(path, payload))):
                continue
            # ⚠ 2026-10-01 隔离真机第 174 轮 sr-20261001034539-SHFWQM6FET（上传「销售团队季度业绩.xlsx」，要一份 Word 报告）：
            #   第一条命令只是 load_workbook 读了一眼上传的表，回执就说「办公文件已收回：销售团队季度业绩.xlsx。这就是交付」，
            #   产物库里多了一份跟上传 sha256 一模一样的 xlsx，右栏和交付文件并排一个标签。更要紧的是办公目标的完工闸
            #   （control_run_service 里 has_any）只问库里有没有办公文件——光读一眼用户自己的表，这道 fail-closed 的闸就算有交付了。
            #   上传是挂到工作区根上的（_mount_session_uploads），跟原件一字不差的就是用户的输入，不收；
            #   模型在原件上改过（sha256 变了），那才是它的产出，照收。
            if originals.get(path) == hashlib.sha256(payload).hexdigest():
                continue
            # ⚠ 2026-10-01 隔离真机第 175 轮 sr-20261001041148-WXKFWTYK33（同一张上传表，要一份管理层 PPT）：模型照 office-skills
            #   的约定先写了 bridge/01-cleaned-data.xlsx、bridge/03-chart-sources.xlsx（清洗后的数据、图表数据源），
            #   宿主把它们当交付收进产物库，回执说「办公文件已收回：bridge/…。这就是交付」，右栏多出两个标签，
            #   而那时 PPT 还一页没写——办公目标的完工闸（has_any）已经能亮了。那份技能自己写着
            #   「bridge/: cleaned data, summaries, chart sources…」「output/: final user-facing artifacts only」。
            if path.split("/", 1)[0] in _OFFICE_WORKING_DIRS:
                continue
            # ⚠ 2026-09-23 预览不再在沙盒里转 PDF。右侧用浏览器里的
            #   @silurus/ooxml 画这份字节。soffice 的 PDF 曾被 Chrome 沙箱框屏蔽。
            # ⚠ 2026-09-25 luna 隔离真机：办公沙盒整轮复用，每条命令都把同一份
            #   没改过的 pptx 再扫一遍，回执次次说「办公文件已收回……这就是交付」，
            #   连一条只读、还失败了的校验命令也这么说。字节没变不是这次的产出：
            #   归进 officeFilesHeld，回执照实说「这次没有产出新文件」。
            try:
                before = store.find_by_path(
                    self.original.projectId, path, owner_id=self.owner_id)
            except Exception:
                before = None
            # ⚠ 2026-09-29 隔离真机第 112 轮 sr-20260929090856-0GZ9EPV769（家庭年度收支 Excel，追问「加一张按月份的
            #   收支趋势折线图」）：看板里本来就有那张 LineChart。模型只把小标题「月度趋势」改成
            #   「按月份的收支趋势折线图」，收尾说「已加入按月份的收支趋势折线图」。回执里写着
            #   原生图表 2 个——跟上一版一样，但没人告诉它「跟上一版一样」。覆盖之前先量一下旧版。
            previous_facts = None
            sibling = None
            if before is None:
                # ⚠ 2026-09-29 隔离真机第 114 轮 sr-20260929095131-9A7P8RP51X（小区垃圾分类方案 Word，追问「加一个按季度的进度表格」）：
                #   脚本自带「已存在就换名」（while os.path.exists(out): …_{idx}.docx），新版写成
                #   方案_1.docx，旧的方案.docx 还在库里——用户看到两份，比较也比不上。加了编号的同名
                #   文件当成那一份的新版来比，并在回执里点出来。
                sibling = _numbered_sibling(store, self.original.projectId, self.owner_id, path)
                if sibling is not None:
                    before = sibling
            if isinstance(before, dict) and before.get("artifactId"):
                try:
                    _old_meta, old_bytes = store.get_bytes(
                        self.original.projectId, before["artifactId"], owner_id=self.owner_id)
                    previous_facts = office_facts(old_bytes, path)
                except Exception:
                    previous_facts = None
            try:
                meta = store.put(
                    self.original.projectId,
                    owner_id=self.owner_id,
                    path=path,
                    data=payload,
                )
            except Exception:
                logger.warning("office artifact persist failed", exc_info=True)
                continue
            stored = meta.get("path", path) if isinstance(meta, dict) else path
            _RuntimeTask._remember_download(
                self, stored, meta.get("artifactId") if isinstance(meta, dict) else None)
            if sibling is not None:
                siblings = dict(self.result.get("officeSiblings") or {})
                siblings[meta.get("path", path) if isinstance(meta, dict) else path] = str(sibling.get("path"))
                self.result["officeSiblings"] = siblings
            unchanged = (
                sibling is None and isinstance(before, dict) and isinstance(meta, dict)
                and before.get("sha256") == meta.get("sha256")
            )
            bucket = "officeFilesHeld" if unchanged else "officeFiles"
            kept = list(self.result.get(bucket) or [])
            if stored not in kept:
                kept.append(stored)
            self.result[bucket] = kept[:MAX_DELIVERED_FILES]
            # 这次新产出的文件，量一下里面到底有什么（office_facts 头注）。
            # 没变的旧文件不量：那不是这条命令的产出，上一次收回时已经量过。
            facts = None if unchanged else office_facts(payload, stored)
            if facts and stored in self.result[bucket]:
                measured = dict(self.result.get("officeFacts") or {})
                measured[stored] = facts
                self.result["officeFacts"] = measured
                if previous_facts:
                    prior = dict(self.result.get("officeFactsBefore") or {})
                    prior[stored] = previous_facts
                    self.result["officeFactsBefore"] = prior
        _RuntimeTask._remember_held_office_files(self, report_miss)

    def _flush_stdin(self):
        pending = self.supervisor.peek_stdin(self.operation_id)
        if not pending:
            return
        writer = getattr(self.provider, "write_console", None)
        if not callable(writer):
            return
        try:
            pid = self._process("command")
        except WorkspaceProviderError:
            return
        for chunk in self.supervisor.take_stdin(self.operation_id):
            try:
                writer(self.handle, pid, chunk["text"], press_enter=chunk.get("pressEnter", True))
            except Exception:
                logger.warning("project stdin not delivered: %s", self.operation_id)

    def _register(self, key, pid, *, console=False):
        if not pid:
            raise WorkspaceProviderError("project_process_identity_missing")
        refs = dict(self.heartbeat.lease.processRefs)
        refs[key] = pid
        if console:
            refs[f"{key}Console"] = "1"
        self.heartbeat.renew(process_refs=refs)

    def _process(self, key):
        pid = self.heartbeat.lease.processRefs.get(key)
        if not isinstance(pid, str) or not pid.isdecimal():
            raise WorkspaceProviderError("runtime_dispatch_uncertain")
        return pid

    def try_finish_idle(self, operation_count, last_access_at):
        """An accepted edit must invalidate a concurrently prepared idle stop.

        2026-09-13: SQLite child admission leaves parent rev unchanged. Counting
        before activity fences that gap; PostgreSQL also locks the parent during
        admission. A CAS miss is normal new
        activity, not provider failure; keep local state and the heartbeat alive
        until the fresh idle-loop read. Total lifetime/cancel cleanup is separate.
        """
        self.heartbeat.check()
        code = "runtime_idle_expired"
        result = {**self.result, "phase": "stopping",
            "cleanup": {"status": "completed", "phase": "expired", "code": code}}
        runtime = self.runtime.model_copy(update={"status": "stopping", "errorCode": code,
            "health": "unknown", "lastHeartbeat": _timestamp()})
        stopped = self.store.update_runtime_operation(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner,
            expected_status="running", status="running", runtime=runtime, result=result,
            idle_operation_count=operation_count, idle_last_access_at=last_access_at)
        if stopped is None:
            return False
        self.runtime, self.result = stopped.runtime, dict(stopped.result)
        self.store.flush_operation_event(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
        self.finish("completed", "expired", code)
        return True

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
                finish_pending_verifications(self, cancelled=status == "cancelled", error=code or "project_runtime_stopped")
            if self.supervisor.preview_runtime is not None:
                self.supervisor.preview_runtime.revoke(self)
            checkpoint_application_data(self, final=True)
            # 办公命令成功或脚本失败都留下沙盒。Vite 工程仍拆掉。
            keep = (
                bool(self.result.get("keepSandbox"))
                and self.handle is not None
                and self.original.kind == "runtime.exec"
                and status in {"completed", "failed"}
            )
            if self.handle is not None and not keep:
                self.provider.destroy(self.handle)
            if self.provider is None:
                if self.original.runtime is not None or self.handle is not None:
                    raise WorkspaceProviderError("project_provider_unavailable")
            elif not keep:
                for orphan in self.provider.find_workspaces(workspace_id=self.lease.workspaceId):
                    self.heartbeat.check()
                    self.provider.destroy(orphan)
        except ProjectConflict:
            raise
        except Exception as exc:
            # 清理为什么没走完要留在日志里：第 127 轮起那一台四天重试约 640 次，一行原因都没有。
            logger.warning("project runtime cleanup pending: %s (%s)", self.operation_id,
                str(exc) if isinstance(exc, (WorkspaceProviderError, ValueError)) else type(exc).__name__)
            self.save("reconciling", status="interrupted", error="project_cleanup_pending")
            # Keep the lease until expiry to bound cleanup retries after outages.
            self.heartbeat.close()
            return
        self.runtime = self.runtime.model_copy(update={"processId": None})
        self.save(phase, status=status, error=code)
        self.heartbeat.close()
        self.store.release_lease(self.original.projectId, owner_id=self.owner_id,
            lease_owner=self.lease.leaseOwner, generation=self.lease.generation,
            clear_runtime=not bool(self.result.get("keepSandbox")))

    def suspend(self, reason):
        checkpoint_application_data(self, force=True)
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
