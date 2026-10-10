"""Owned source editing, revision recovery and private project forks.

HTTP edits and restore requests reuse the runtime owner's durable patch queue.
A stopped project publishes under the same fenced source lease. Restoring copies
an old tree into a NEW revision; history and old verification cannot rewind.
Forks copy immutable source into a new session with no inherited execution grant,
workspace, application database or verification result.
"""

from __future__ import annotations

import time
import uuid

from models.v5_state import V5SessionState
from services import persistence
from services.control_checkpoint import guard_control_run
from services.project_authority import approved_reference
from services.project_creation import load_authorized_session, sync_session_project
from services.deliverable_kind import (
    WEB_APP, finished_operation_allows_source_write, operation_left_on_lease, plan_deliverable_kind,
)
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.revision_turns import label_revisions
from services.scope_authority import latest_control_plan
from services.project_manifest import CUSTOM_SERVER_RELOAD_NOTE, canonical_json, content_hash, is_custom_server_runtime, prepare_source_patch, source_path
from services.project_store import MAX_REVISIONS, ProjectConflict, ProjectNotFound, ProjectStoreUnavailable


def _claim_fork_session(owner_id, session_id, fork, *, source_project_id, source_revision, goal_text, kind,
                        office_files=()):
    """复刻出来的那条会话。Claim is server-only and insert-only: it neither copies the prior plan
    approval nor lets a retry overwrite a newer conversation in the fork."""
    candidate = V5SessionState(sessionId=session_id, ownerId=owner_id,
        # 标题前加「复刻：」：源会话和复刻会话同名，侧栏里两条一模一样分不清（2026-09-30 第 144 轮复刻）
        goal={"text": "复刻：" + goal_text},
        runtimeKind="project", projectId=fork.projectId, projectRevision=fork.currentRevision,
        controlTranscript=[{"kind": "project_forked", "sourceProjectId": source_project_id,
            "sourceRevision": source_revision, "deliverableKind": kind,
            "officeFiles": sorted(office_files)}], lastTurnId="fork-1")
    claimed = persistence.claim_session_record(candidate)
    if not claimed.get("ok") or not isinstance(claimed.get("state"), V5SessionState):
        raise ProjectStoreUnavailable("project_fork_session_unavailable")
    actual = claimed["state"]
    if actual.ownerId != owner_id or actual.projectId != fork.projectId:
        raise ProjectConflict("project_fork_session_conflict")


def fork_published_project(store, *, source_owner_id, project_id, revision, owner_id, goal_text, idempotency_key):
    """从应用市场复刻别人发布的网页工程：只拷**发布时钉住的那一版源码**，归到复刻的人名下。

    ⚠ 2026-10-01 发布通道（ProjectDeliveryService.publication 头注）：市场里点「复刻」原来只认老 HTML 推演的
      model_json；网页工程的源码在作者的工程库里，按 owner 隔离，别人读不到。这里由宿主用**作者身份**读、
      只读应用记录里钉住的那一个 revision（调用方先过 app_access 的 fork 判定：公开、已登录）——复刻的人
      选不了版本，拿不到作者之后改的、没发布的东西。
      **不拷应用数据**（作者自己录进去的记录在 wb_project_app_data_*，是作者的私有数据），也不拷计划批准：
      复刻出来的工程要复刻的人自己批计划才能再改。
    """
    saved = store.get_revision(project_id, revision, owner_id=source_owner_id)
    if saved.revision != revision:
        raise ProjectNotFound("project_revision_not_found")
    files = store.read_files(project_id, saved.revision, owner_id=source_owner_id)
    identity = canonical_json([owner_id, "published", project_id, saved.revision, idempotency_key])
    session_id = "project-fork-" + content_hash(identity)[:32]
    fork = store.create_project(session_id, owner_id=owner_id, files=files,
        template_version=saved.templateVersion, plan_ref="fork:requires-new-approval",
        spec_revision=saved.specRevision, source_project_id=project_id, source_revision=saved.revision)
    if fork.sourceProjectId != project_id or fork.sourceRevision != saved.revision:
        raise ProjectConflict("project_idempotency_conflict")
    _claim_fork_session(owner_id, session_id, fork, source_project_id=project_id,
        source_revision=saved.revision, goal_text=goal_text or "网页应用", kind=WEB_APP)
    return {"projectId": fork.projectId, "sessionId": fork.sessionId, "revision": fork.currentRevision}


class ProjectSourceOperations:
    def __init__(self, store, supervisor, owner_id):
        self.store, self.supervisor, self.owner_id = store, supervisor, owner_id

    def authority(self, project_id, *, write=False):
        project = self.store.get_project(project_id, owner_id=self.owner_id)
        state = load_authorized_session(project.sessionId, owner_id=self.owner_id)
        if state.projectId != project.projectId or state.runtimeKind != "project":
            raise ProjectConflict("project_session_binding_required")
        if write:
            state = load_authorized_session(project.sessionId, owner_id=self.owner_id,
                approval_ref=approved_reference(state))
        return project, state

    def source(self, project_id, revision=None):
        project, _ = self.authority(project_id)
        saved = self.store.get_revision(project_id, revision, owner_id=self.owner_id)
        return {"projectId": project_id, "revision": saved.revision,
            "currentRevision": project.currentRevision,
            "files": [item.model_dump() for item in saved.manifest.files]}

    def file(self, project_id, path, revision=None):
        self.authority(project_id)
        path = source_path(path)
        saved = self.store.get_revision(project_id, revision, owner_id=self.owner_id)
        files = self.store.read_files(project_id, saved.revision, owner_id=self.owner_id)
        if path not in files:
            raise ProjectNotFound("project_file_not_found")
        return {"projectId": project_id, "revision": saved.revision, "path": path,
            "sha256": content_hash(files[path]), "content": files[path]}

    def revisions(self, project_id, cursor=None, limit=50):
        project, state = self.authority(project_id)
        current = cursor or project.currentRevision
        entries = []
        for _ in range(min(limit, MAX_REVISIONS)):
            if current is None:
                break
            saved = self.store.get_revision(project_id, current, owner_id=self.owner_id)
            entries.append({key: getattr(saved, key) for key in (
                "revision", "parentRevision", "treeHash", "templateVersion", "createdAt")})
            current = saved.parentRevision
        # 每一版标上第几轮、那一轮的原话（revision_turns 模块头：第 140 轮 13 行裸编号）
        entries = label_revisions(entries, getattr(state, "controlTranscript", None))
        return {"projectId": project_id, "currentRevision": project.currentRevision,
            "revisions": entries, "nextCursor": current}

    def patch(self, project_id, *, expected_revision, idempotency_key, changes, approval_ref=None):
        project, state = self.authority(project_id, write=True)
        approval = approved_reference(state)
        if approval_ref is not None and approval != approval_ref:
            raise PermissionError("project_plan_approval_required")
        before = self.store.read_files(project_id, expected_revision, owner_id=self.owner_id)
        files, changed = prepare_source_patch(before, changes)
        publication_id = "source-" + content_hash(idempotency_key)
        # A lost HTTP reply can be retried after stop/start. Recover the original
        # outcome BEFORE choosing an execution mode, never enqueue another edit.
        previous = self.store.operation_by_key(project_id, publication_id, owner_id=self.owner_id)
        if previous is not None:
            if (previous.kind != "runtime.patch" or previous.expectedRevision != expected_revision
                    or previous.approvalRef != approval or previous.input.get("changes") != changes):
                raise ProjectConflict("project_idempotency_conflict")
            return {"projectId": project_id, "revision": (previous.result or {}).get("revision"),
                "operationId": previous.operationId, "status": previous.status}
        target_id = self.store.publication_revision_id(project_id, publication_id)
        try:
            prior = self.store.get_revision(project_id, target_id, owner_id=self.owner_id)
        except ProjectNotFound:
            prior = None
        if prior is not None:
            if (prior.parentRevision != expected_revision or prior.planRef != approval
                    or self.store.read_files(project_id, target_id, owner_id=self.owner_id) != files):
                raise ProjectConflict("project_idempotency_conflict")
            sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=approval)
            return {"projectId": project_id, "revision": prior.revision, "operationId": None, "status": "completed"}
        lease = self.store.get_lease(project_id, owner_id=self.owner_id)
        active = lease is not None and lease.expiresAt > time.time() and lease.processRefs.get("operationId")
        custom = bool(active) and is_custom_server_runtime(self.store.get_operation(active, owner_id=self.owner_id))
        prepare_source_patch(before, changes, live=bool(active), custom_server=custom)
        guard_control_run()
        if not changes:
            if project.currentRevision != expected_revision:
                raise ProjectConflict("project_revision_conflict")
            return {"projectId": project_id, "revision": expected_revision,
                "operationId": None, "status": "completed"}
        if active:
            if self.supervisor is None or not self.supervisor.running:
                raise ProjectStoreUnavailable("project_worker_unavailable")
            if len(changes) > 64:
                raise ValueError("project_live_patch_requires_restart")
            operation = self.supervisor.submit_patch(lease.processRefs["operationId"],
                owner_id=self.owner_id, expected_revision=expected_revision,
                approval_ref=approval, idempotency_key=publication_id,
                changes=changes)
            result = operation.result or {}
            return {"projectId": project_id, "revision": result.get("revision"),
                "operationId": operation.operationId, "status": operation.status,
                **({"hint": CUSTOM_SERVER_RELOAD_NOTE} if custom else {})}
        lease = self.store.acquire_lease(project_id, owner_id=self.owner_id,
            lease_owner="source-" + uuid.uuid4().hex, ttl_seconds=120)
        try:
            prior = operation_left_on_lease(self.store, lease, self.owner_id)
            if (lease.sandboxId or lease.processRefs) and not finished_operation_allows_source_write(lease, prior):
                raise ProjectConflict("project_runtime_reconciliation_required")
            self.authority(project_id, write=True)
            base = self.store.get_revision(project_id, expected_revision, owner_id=self.owner_id)
            publication_id = "source-" + content_hash(idempotency_key)
            target_id = self.store.publication_revision_id(project_id, publication_id)
            try:
                saved = self.store.get_revision(project_id, target_id, owner_id=self.owner_id)
            except ProjectNotFound:
                saved = None
            if saved is not None:
                if (saved.parentRevision != expected_revision or saved.planRef != approval
                        or self.store.read_files(project_id, target_id, owner_id=self.owner_id) != files):
                    raise ProjectConflict("project_idempotency_conflict")
            else:
                guard_control_run()
                load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=approval)
                saved = self.store.commit_revision(project_id, owner_id=self.owner_id,
                    expected_revision=expected_revision, files=files, template_version=base.templateVersion,
                    plan_ref=approval, spec_revision=base.specRevision,
                    lease_generation=lease.generation, lease_owner=lease.leaseOwner,
                    publication_id=publication_id)
            sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=approval)
            return {"projectId": project_id, "revision": saved.revision,
                "operationId": None, "status": "completed"}
        finally:
            self.store.release_lease(project_id, owner_id=self.owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)

    def restore(self, project_id, *, expected_revision, target_revision, idempotency_key, approval_ref=None):
        _project, state = self.authority(project_id, write=True)
        approval = approval_ref or approved_reference(state)
        if approval != approved_reference(state):
            raise PermissionError("project_plan_approval_required")
        before = self.store.read_files(project_id, expected_revision, owner_id=self.owner_id)
        target = self.store.read_files(project_id, target_revision, owner_id=self.owner_id)
        changes = [{"path": path, "expectedSha256": content_hash(before[path]) if path in before else None,
            "content": target.get(path)} for path in sorted(before.keys() | target.keys())
            if before.get(path) != target.get(path)]
        # A changed tree publishes a new revision; an identical tree is an
        # explicit no-op. Never assign currentRevision to a historical snapshot.
        return self.patch(project_id, expected_revision=expected_revision,
            idempotency_key="restore:" + idempotency_key, changes=changes, approval_ref=approval)

    def _next_revision_created_at(self, project_id, current, target):
        """target 之后的那一版源码是什么时候生成的；target 就是当前版则 None。"""
        cursor, child = current, None
        for _ in range(MAX_REVISIONS):
            if cursor is None or cursor == target:
                break
            saved = self.store.get_revision(project_id, cursor, owner_id=self.owner_id)
            child, cursor = saved, saved.parentRevision
        return child.createdAt if child is not None and cursor == target else None

    def fork(self, project_id, *, revision, idempotency_key):
        source, state = self.authority(project_id)
        saved = self.store.get_revision(project_id, revision, owner_id=self.owner_id)
        files = self.store.read_files(project_id, saved.revision, owner_id=self.owner_id)
        identity = canonical_json([self.owner_id, project_id, idempotency_key])
        session_id = "project-fork-" + content_hash(identity)[:32]
        fork = self.store.create_project(session_id, owner_id=self.owner_id, files=files,
            template_version=saved.templateVersion, plan_ref="fork:requires-new-approval",
            spec_revision=saved.specRevision, source_project_id=project_id, source_revision=saved.revision)
        if fork.sourceProjectId != project_id or fork.sourceRevision != saved.revision:
            raise ProjectConflict("project_idempotency_conflict")
        # ⚠ 2026-09-30 用户点名「Fork 这种逻辑」：复刻只拷源码树。办公交付的成品（.pptx/.docx/.xlsx）
        #   不在源码树里（产物库，ProjectOfficeArtifactStore 模块头），复刻出来的会话只有生成脚本、
        #   没有文件，右栏按网页工程画。成品按「那一版源码之后、下一版源码之前」最后收回的那份一起拷；
        #   交付类别跟着 project_forked 那一行走（前端 latestPlanDeliverableKind 认它）。
        kind = plan_deliverable_kind(latest_control_plan(state))
        copied: list[str] = []
        try:
            office = ProjectOfficeArtifactStore(self.store)
            before = self._next_revision_created_at(project_id, source.currentRevision, saved.revision)
            for path, data in office.files_as_of(project_id, owner_id=self.owner_id, before=before).items():
                office.put(fork.projectId, owner_id=self.owner_id, path=path, data=data)
                copied.append(path)
        except Exception:  # noqa: BLE001 — 成品拷不过去不拖垮复刻：脚本在，重跑能再出（§七 增强类）
            copied = []
        _claim_fork_session(self.owner_id, session_id, fork, source_project_id=source.projectId,
            source_revision=saved.revision, goal_text=str(state.goal.get("text") or "Project fork"),
            kind=kind, office_files=copied)
        return {"projectId": fork.projectId, "sessionId": fork.sessionId,
            "revision": fork.currentRevision}
