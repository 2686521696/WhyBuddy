"""Durable project sources, operations, event cursors and workspace fencing.

2026-09-11: a sandbox is disposable; saving only its ID would lose the project
on expiry. Immutable content is written before a CAS publishes the source head.
An interrupted CAS can leave unreferenced content but can never publish missing
files. All mutable writes use database predicates, including HTTP SQL (whose
requests cannot share a transaction). No fallback to memory or temporary files.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool, StaticPool

from config.settings import settings
from models.project_runtime import Project, ProjectOperation, ProjectRevision, RuntimeEvent, WorkspaceLease
from services.project_manifest import build_manifest, canonical_json, content_hash
from services.sql_gateway import HttpSqlGateway, _sql_engine_config, http_api_credentials

MAX_SOURCE_HISTORY_BYTES = 64 * 1024 * 1024
MAX_REVISIONS = 200
MAX_OPERATION_BYTES = 128 * 1024
MAX_EVENT_BYTES = 32 * 1024
MAX_OPERATION_EVENTS = 2000


class ProjectStoreUnavailable(RuntimeError):
    pass


class ProjectNotFound(LookupError):
    pass


class ProjectConflict(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 240:
        raise ValueError(name)
    return value


def _bounded(value: Any, limit: int) -> str:
    encoded = canonical_json(value)
    if len(encoded.encode("utf-8")) > limit:
        raise ValueError("project_record_too_large")
    return encoded


_DDL = (
    "create table if not exists wb_project (id varchar(80) primary key, session_id varchar(240) unique not null, owner_id varchar(240) not null, current_revision varchar(80) not null, rev integer not null, payload text not null)",
    "create table if not exists wb_project_revision (id varchar(80) primary key, project_id varchar(80) not null, payload text not null)",
    "create table if not exists wb_project_content (hash varchar(64) primary key, content text not null)",
    "create table if not exists wb_project_source_budget (project_id varchar(80) primary key, reserved_revisions integer not null, reserved_bytes bigint not null)",
    "create table if not exists wb_project_lease (project_id varchar(80) primary key, generation integer not null, lease_owner varchar(240) not null, expires_at double precision not null, payload text not null)",
    "create table if not exists wb_project_operation (id varchar(80) primary key, project_id varchar(80) not null, idempotency_key varchar(240) not null, rev integer not null, payload text not null, unique(project_id, idempotency_key))",
    "create table if not exists wb_project_event (operation_id varchar(80) not null, seq integer not null, event_id varchar(240) not null, payload text not null, primary key(operation_id, seq), unique(operation_id, event_id))",
    "create index if not exists wb_project_revision_project on wb_project_revision(project_id)",
    "create index if not exists wb_project_operation_project on wb_project_operation(project_id)",
)


class ProjectStore:
    """A query adapter shared by SQLAlchemy and the existing HTTPS SQL gateway."""

    def __init__(self, query: Callable[[str, list[Any]], list[dict[str, Any]]]):
        self._query = query
        self._engine = None
        for statement in _DDL:
            self._q(statement)

    @classmethod
    def from_url(cls, url: str) -> ProjectStore:
        if not url.startswith(("sqlite:", "postgresql:" , "postgresql+")):
            raise ProjectStoreUnavailable("unsupported_project_database")
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        connect_args, engine_kwargs = _sql_engine_config(url, NullPool)
        if url.startswith("sqlite:"):
            connect_args = {"check_same_thread": False, "timeout": 10}
            if ":memory:" in url or url in ("sqlite://", "sqlite:///"):
                engine_kwargs["poolclass"] = StaticPool
        engine = create_engine(url, connect_args=connect_args, **engine_kwargs)

        def query(sql: str, params: list[Any]) -> list[dict[str, Any]]:
            # Statements are authored here; user input only enters bound params.
            bound_sql = re.sub(r"\$(\d+)", lambda match: ":p" + match.group(1), sql)
            with engine.begin() as connection:
                result = connection.execute(text(bound_sql), {f"p{i + 1}": v for i, v in enumerate(params)})
                return [dict(row) for row in result.mappings()] if result.returns_rows else []

        try:
            store = cls(query)
        except Exception:
            engine.dispose()
            raise
        store._engine = engine
        return store

    def close(self) -> None:
        if self._engine is not None:
            self._engine.dispose()

    def _q(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        try:
            return self._query(sql, params or [])
        except Exception as exc:
            # Do not send DSNs, SQL arguments, source, or gateway credentials to UI.
            raise ProjectStoreUnavailable("project_store_unavailable") from exc

    def _project_row(self, project_id: str, owner_id: str) -> dict[str, Any]:
        rows = self._q("select * from wb_project where id=$1 and owner_id=$2", [project_id, owner_id])
        if not rows:
            raise ProjectNotFound("project_not_found")
        return rows[0]

    def get_project(self, project_id: str, *, owner_id: str) -> Project:
        return Project.model_validate_json(self._project_row(project_id, owner_id)["payload"])

    def get_project_for_session(self, session_id: str, *, owner_id: str) -> Project | None:
        rows = self._q("select payload from wb_project where session_id=$1 and owner_id=$2", [session_id, owner_id])
        return Project.model_validate_json(rows[0]["payload"]) if rows else None

    def _write_revision(self, project_id: str, files: dict[str, str], *, parent: str | None,
                        template_version: str, plan_ref: str, spec_revision: str | None) -> ProjectRevision:
        manifest = build_manifest(files)
        for entry in manifest.files:
            self._q("insert into wb_project_content(hash, content) values($1,$2) on conflict(hash) do nothing", [entry.sha256, files[entry.path]])
        revision = ProjectRevision(revision="prv-" + uuid.uuid4().hex, projectId=project_id,
            parentRevision=parent, treeHash=manifest.treeHash, manifest=manifest,
            templateVersion=_required(template_version, "template_version_required"),
            planRef=_required(plan_ref, "plan_ref_required"), specRevision=spec_revision, createdAt=_now())
        self._q("insert into wb_project_revision(id,project_id,payload) values($1,$2,$3)",
                [revision.revision, project_id, revision.model_dump_json()])
        return revision

    def _reserve_source(self, project_id: str, byte_count: int, *, lease_generation: int | None = None,
                        lease_owner: str | None = None) -> None:
        # Gateway requests cannot share a transaction. Reserve before uploading;
        # failed uploads/publications keep their charge until explicit GC exists.
        rows = self._q("select project_id from wb_project_source_budget where project_id=$1", [project_id])
        if not rows:
            existing = self._q("select payload from wb_project_revision where project_id=$1", [project_id])
            prior_bytes = sum(ProjectRevision.model_validate_json(row["payload"]).manifest.totalBytes for row in existing)
            self._q("insert into wb_project_source_budget(project_id,reserved_revisions,reserved_bytes) values($1,$2,$3) on conflict(project_id) do nothing",
                    [project_id, len(existing), prior_bytes])
        params: list[Any] = [byte_count, project_id, MAX_REVISIONS, MAX_SOURCE_HISTORY_BYTES]
        fence = self._fence(project_id, lease_generation, lease_owner, params)
        reserved = self._q("update wb_project_source_budget set reserved_revisions=reserved_revisions+1,reserved_bytes=reserved_bytes+$1 where project_id=$2 and reserved_revisions<$3 and reserved_bytes+$1<=$4 and " + fence + " returning project_id", params)
        if not reserved:
            checks: list[Any] = []
            condition = self._fence(project_id, lease_generation, lease_owner, checks)
            if not self._q("select 1 as valid where " + condition, checks):
                raise ProjectConflict("workspace_lease_lost")
            raise ValueError("project_history_limit")

    def create_project(self, session_id: str, *, owner_id: str, files: dict[str, str],
                       template_version: str, plan_ref: str, spec_revision: str | None = None) -> Project:
        _required(session_id, "session_id_required")
        _required(owner_id, "owner_id_required")
        existing = self.get_project_for_session(session_id, owner_id=owner_id)
        if existing is not None:
            return existing
        # One identity per session, including when two workers race to initialize.
        project_id = "prj-" + uuid.uuid5(uuid.NAMESPACE_URL, "whybuddy:project:" + session_id).hex
        conflict = self._q("select owner_id from wb_project where session_id=$1", [session_id])
        if conflict:
            raise ProjectNotFound("project_not_found")
        manifest = build_manifest(files)
        _required(template_version, "template_version_required")
        _required(plan_ref, "plan_ref_required")
        self._reserve_source(project_id, manifest.totalBytes)
        revision = self._write_revision(project_id, files, parent=None, template_version=template_version,
                                        plan_ref=plan_ref, spec_revision=spec_revision)
        now = _now()
        project = Project(projectId=project_id, sessionId=session_id, ownerId=owner_id,
            currentRevision=revision.revision, createdAt=now, updatedAt=now,
            sourceBytesStored=revision.manifest.totalBytes)
        self._q("insert into wb_project(id,session_id,owner_id,current_revision,rev,payload) values($1,$2,$3,$4,1,$5) on conflict(session_id) do nothing",
                [project_id, session_id, owner_id, revision.revision, project.model_dump_json()])
        return self.get_project(project_id, owner_id=owner_id)

    def get_revision(self, project_id: str, revision: str | None = None, *, owner_id: str) -> ProjectRevision:
        project = self.get_project(project_id, owner_id=owner_id)
        target = revision or project.currentRevision
        # Traverse the committed parent chain: a losing CAS must not publish an
        # orphan revision through a guessed ID or revision listing.
        current: str | None = project.currentRevision
        for _ in range(MAX_REVISIONS):
            if current is None:
                break
            rows = self._q("select payload from wb_project_revision where id=$1 and project_id=$2", [current, project_id])
            if not rows:
                raise ProjectStoreUnavailable("project_revision_missing")
            item = ProjectRevision.model_validate_json(rows[0]["payload"])
            if current == target:
                return item
            current = item.parentRevision
        raise ProjectNotFound("project_revision_not_found")

    def read_files(self, project_id: str, revision: str | None = None, *, owner_id: str) -> dict[str, str]:
        snapshot = self.get_revision(project_id, revision, owner_id=owner_id)
        files: dict[str, str] = {}
        for item in snapshot.manifest.files:
            rows = self._q("select content from wb_project_content where hash=$1", [item.sha256])
            if not rows or content_hash(rows[0]["content"]) != item.sha256:
                raise ProjectStoreUnavailable("project_content_missing_or_corrupt")
            files[item.path] = rows[0]["content"]
        if build_manifest(files).treeHash != snapshot.treeHash:
            raise ProjectStoreUnavailable("project_manifest_corrupt")
        return files

    def _fence(self, project_id: str, generation: int | None, lease_owner: str | None,
               params: list[Any]) -> str:
        first = len(params) + 1
        if generation is None and lease_owner is None:
            params.extend([project_id, time.time()])
            return f"not exists(select 1 from wb_project_lease where project_id=${first} and expires_at>${first + 1})"
        if generation is None or not lease_owner:
            raise ValueError("lease_fence_required")
        params.extend([project_id, generation, lease_owner, time.time()])
        return f"exists(select 1 from wb_project_lease where project_id=${first} and generation=${first + 1} and lease_owner=${first + 2} and expires_at>${first + 3})"

    def commit_revision(self, project_id: str, *, owner_id: str, expected_revision: str,
                        files: dict[str, str], template_version: str, plan_ref: str,
                        spec_revision: str | None = None, lease_generation: int | None = None,
                        lease_owner: str | None = None) -> ProjectRevision:
        row = self._project_row(project_id, owner_id)
        project = Project.model_validate_json(row["payload"])
        if project.currentRevision != expected_revision:
            raise ProjectConflict("project_revision_conflict")
        manifest = build_manifest(files)
        _required(template_version, "template_version_required")
        _required(plan_ref, "plan_ref_required")
        self._reserve_source(project_id, manifest.totalBytes, lease_generation=lease_generation, lease_owner=lease_owner)
        revision = self._write_revision(project_id, files, parent=expected_revision,
            template_version=template_version, plan_ref=plan_ref, spec_revision=spec_revision)
        updated = project.model_copy(update={"currentRevision": revision.revision, "updatedAt": _now(),
            "revisionCount": project.revisionCount + 1, "sourceBytesStored": project.sourceBytesStored + manifest.totalBytes})
        params: list[Any] = [revision.revision, updated.model_dump_json(), project_id, owner_id, row["rev"], expected_revision]
        fence = self._fence(project_id, lease_generation, lease_owner, params)
        rows = self._q("update wb_project set current_revision=$1,payload=$2,rev=rev+1 where id=$3 and owner_id=$4 and rev=$5 and current_revision=$6 and " + fence + " returning id", params)
        if not rows:
            raise ProjectConflict("project_revision_or_lease_conflict")
        return revision

    def get_lease(self, project_id: str, *, owner_id: str) -> WorkspaceLease | None:
        self.get_project(project_id, owner_id=owner_id)
        rows = self._q("select payload from wb_project_lease where project_id=$1", [project_id])
        return WorkspaceLease.model_validate_json(rows[0]["payload"]) if rows else None

    def acquire_lease(self, project_id: str, *, owner_id: str, lease_owner: str,
                      ttl_seconds: float = 120) -> WorkspaceLease:
        self.get_project(project_id, owner_id=owner_id)
        _required(lease_owner, "lease_owner_required")
        if not 1 <= ttl_seconds <= 3600:
            raise ValueError("invalid_lease_ttl")
        prior = self.get_lease(project_id, owner_id=owner_id)
        now = time.time()
        if prior is not None and prior.expiresAt > now:
            raise ProjectConflict("workspace_lease_busy")
        lease = WorkspaceLease(workspaceId="ws-" + project_id, projectId=project_id,
            generation=(prior.generation + 1 if prior else 1), leaseOwner=lease_owner,
            expiresAt=now + ttl_seconds,
            sandboxId=prior.sandboxId if prior else None,
            mountedRevision=prior.mountedRevision if prior else None,
            processRefs=prior.processRefs if prior else {})
        if prior is None:
            rows = self._q("insert into wb_project_lease(project_id,generation,lease_owner,expires_at,payload) values($1,$2,$3,$4,$5) on conflict(project_id) do nothing returning project_id",
                [project_id, lease.generation, lease_owner, lease.expiresAt, lease.model_dump_json()])
        else:
            rows = self._q("update wb_project_lease set generation=$1,lease_owner=$2,expires_at=$3,payload=$4 where project_id=$5 and generation=$6 and expires_at<=$7 returning project_id",
                [lease.generation, lease_owner, lease.expiresAt, lease.model_dump_json(), project_id, prior.generation, now])
        if not rows:
            raise ProjectConflict("workspace_lease_busy")
        return lease

    def renew_lease(self, project_id: str, *, owner_id: str, lease_owner: str, generation: int,
                    ttl_seconds: float = 120, sandbox_id: str | None = None,
                    mounted_revision: str | None = None, process_refs: dict[str, Any] | None = None) -> WorkspaceLease:
        prior = self.get_lease(project_id, owner_id=owner_id)
        if prior is None or prior.generation != generation or prior.leaseOwner != lease_owner:
            raise ProjectConflict("workspace_lease_lost")
        if not 1 <= ttl_seconds <= 3600:
            raise ValueError("invalid_lease_ttl")
        if mounted_revision is not None:
            self.get_revision(project_id, mounted_revision, owner_id=owner_id)
        updates: dict[str, Any] = {"expiresAt": time.time() + ttl_seconds}
        if sandbox_id is not None:
            updates["sandboxId"] = _required(sandbox_id, "sandbox_id_required")
        if mounted_revision is not None:
            updates["mountedRevision"] = mounted_revision
        if process_refs is not None:
            _bounded(process_refs, MAX_EVENT_BYTES)
            updates["processRefs"] = process_refs
        lease = prior.model_copy(update=updates)
        rows = self._q("update wb_project_lease set expires_at=$1,payload=$2 where project_id=$3 and generation=$4 and lease_owner=$5 and expires_at>$6 returning project_id",
            [lease.expiresAt, lease.model_dump_json(), project_id, generation, lease_owner, time.time()])
        if not rows:
            raise ProjectConflict("workspace_lease_lost")
        return lease

    def release_lease(self, project_id: str, *, owner_id: str, lease_owner: str, generation: int,
                      clear_runtime: bool = False) -> None:
        prior = self.get_lease(project_id, owner_id=owner_id)
        if prior is None or prior.generation != generation or prior.leaseOwner != lease_owner:
            raise ProjectConflict("workspace_lease_lost")
        updates: dict[str, Any] = {"expiresAt": 0.0}
        if clear_runtime:
            updates.update(sandboxId=None, mountedRevision=None, processRefs={})
        released = prior.model_copy(update=updates)
        rows = self._q("update wb_project_lease set expires_at=0,payload=$1 where project_id=$2 and generation=$3 and lease_owner=$4 returning project_id",
            [released.model_dump_json(), project_id, generation, lease_owner])
        if not rows:
            raise ProjectConflict("workspace_lease_lost")

    def create_operation(self, project_id: str, *, owner_id: str, kind: str,
                         idempotency_key: str, expected_revision: str, approval_ref: str,
                         input: dict[str, Any] | None = None) -> ProjectOperation:
        project = self.get_project(project_id, owner_id=owner_id)
        _required(kind, "operation_kind_required")
        _required(idempotency_key, "idempotency_key_required")
        _required(approval_ref, "approval_ref_required")
        request = {"kind": kind, "expectedRevision": expected_revision, "approvalRef": approval_ref, "input": input or {}}
        digest = content_hash(_bounded(request, MAX_OPERATION_BYTES))
        rows = self._q("select payload from wb_project_operation where project_id=$1 and idempotency_key=$2", [project_id, idempotency_key])
        if rows:
            existing = ProjectOperation.model_validate_json(rows[0]["payload"])
            if existing.requestHash != digest:
                raise ProjectConflict("operation_idempotency_conflict")
            return existing
        if project.currentRevision != expected_revision:
            raise ProjectConflict("project_revision_conflict")
        now = _now()
        operation = ProjectOperation(operationId="pop-" + uuid.uuid4().hex, projectId=project_id,
            sessionId=project.sessionId, kind=kind, idempotencyKey=idempotency_key, requestHash=digest,
            expectedRevision=expected_revision, approvalRef=approval_ref, input=input or {}, createdAt=now, updatedAt=now)
        self._q("insert into wb_project_operation(id,project_id,idempotency_key,rev,payload) values($1,$2,$3,1,$4) on conflict(project_id,idempotency_key) do nothing",
            [operation.operationId, project_id, idempotency_key, operation.model_dump_json()])
        rows = self._q("select payload from wb_project_operation where project_id=$1 and idempotency_key=$2", [project_id, idempotency_key])
        saved = ProjectOperation.model_validate_json(rows[0]["payload"])
        if saved.requestHash != digest:
            raise ProjectConflict("operation_idempotency_conflict")
        return saved

    def _operation_row(self, operation_id: str, owner_id: str) -> dict[str, Any]:
        rows = self._q("select o.* from wb_project_operation o join wb_project p on p.id=o.project_id where o.id=$1 and p.owner_id=$2", [operation_id, owner_id])
        if not rows:
            raise ProjectNotFound("project_operation_not_found")
        return rows[0]

    def get_operation(self, operation_id: str, *, owner_id: str) -> ProjectOperation:
        return ProjectOperation.model_validate_json(self._operation_row(operation_id, owner_id)["payload"])

    def claim_operation(self, operation_id: str, *, owner_id: str, lease_owner: str,
                        generation: int) -> ProjectOperation:
        """Fence out the previous worker, leaving uncertain effects to reconcile."""
        row = self._operation_row(operation_id, owner_id)
        operation = ProjectOperation.model_validate_json(row["payload"])
        lease = self.get_lease(operation.projectId, owner_id=owner_id)
        if (lease is None or lease.generation != generation or lease.leaseOwner != lease_owner
                or lease.expiresAt <= time.time()):
            raise ProjectConflict("workspace_lease_lost")
        if operation.status in {"completed", "failed", "cancelled"}:
            raise ProjectConflict("operation_state_conflict")
        if operation.leaseGeneration == generation and operation.leaseOwner == lease_owner:
            return operation
        if operation.leaseGeneration is not None and operation.leaseGeneration >= generation:
            raise ProjectConflict("workspace_lease_lost")
        updated = operation.model_copy(update={
            "leaseGeneration": generation, "leaseOwner": lease_owner,
            "status": "queued" if operation.status == "queued" else "interrupted", "updatedAt": _now(),
        })
        params: list[Any] = [updated.model_dump_json(), operation_id, row["rev"]]
        fence = self._fence(operation.projectId, generation, lease_owner, params)
        rows = self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and " + fence + " returning id", params)
        if not rows:
            raise ProjectConflict("operation_state_or_lease_conflict")
        return updated

    def transition_operation(self, operation_id: str, *, owner_id: str, expected_status: str,
                             status: str, result: dict[str, Any] | None = None,
                             lease_generation: int | None = None, lease_owner: str | None = None) -> ProjectOperation:
        allowed = {
            "queued": {"running", "cancelled", "failed", "interrupted"},
            "running": {"completed", "failed", "cancelling", "waiting_user", "interrupted"},
            "waiting_user": {"running", "cancelling", "cancelled", "interrupted"},
            "cancelling": {"cancelled", "failed", "interrupted"},
            "interrupted": {"running", "failed", "cancelled"},
        }
        row = self._operation_row(operation_id, owner_id)
        operation = ProjectOperation.model_validate_json(row["payload"])
        if operation.status != expected_status or status not in allowed.get(expected_status, set()):
            raise ProjectConflict("operation_state_conflict")
        if operation.leaseGeneration is not None and (lease_generation != operation.leaseGeneration or lease_owner != operation.leaseOwner):
            raise ProjectConflict("workspace_lease_lost")
        _bounded(result, MAX_OPERATION_BYTES)
        updated = ProjectOperation.model_validate({**operation.model_dump(), "status": status,
            "result": result, "updatedAt": _now(), "leaseGeneration": lease_generation, "leaseOwner": lease_owner})
        params: list[Any] = [updated.model_dump_json(), operation_id, row["rev"]]
        fence = self._fence(operation.projectId, lease_generation, lease_owner, params)
        rows = self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and " + fence + " returning id", params)
        if not rows:
            raise ProjectConflict("operation_state_or_lease_conflict")
        return updated

    def append_event(self, operation_id: str, *, owner_id: str, event_type: str,
                     payload: dict[str, Any] | None = None, event_id: str | None = None,
                     lease_generation: int | None = None, lease_owner: str | None = None) -> RuntimeEvent:
        operation = self.get_operation(operation_id, owner_id=owner_id)
        if operation.leaseGeneration is not None and (lease_generation != operation.leaseGeneration or lease_owner != operation.leaseOwner):
            raise ProjectConflict("workspace_lease_lost")
        _required(event_type, "event_type_required")
        identity = _required(event_id or uuid.uuid4().hex, "event_id_required")
        _bounded(payload or {}, MAX_EVENT_BYTES)
        for _ in range(12):
            existing = self._q("select payload from wb_project_event where operation_id=$1 and event_id=$2", [operation_id, identity])
            if existing:
                item = RuntimeEvent.model_validate_json(existing[0]["payload"])
                if item.type != event_type or item.payload != (payload or {}):
                    raise ProjectConflict("event_idempotency_conflict")
                return item
            rows = self._q("select coalesce(max(seq),0) as seq from wb_project_event where operation_id=$1", [operation_id])
            seq = int(rows[0]["seq"]) + 1
            if seq > MAX_OPERATION_EVENTS:
                raise ValueError("operation_event_limit")
            event = RuntimeEvent(eventId=identity, sessionId=operation.sessionId, projectId=operation.projectId,
                operationId=operation_id, seq=seq, type=event_type, timestamp=_now(), payload=payload or {})
            params: list[Any] = [operation_id, seq, identity, event.model_dump_json()]
            fence = self._fence(operation.projectId, lease_generation, lease_owner, params)
            saved = self._q("insert into wb_project_event(operation_id,seq,event_id,payload) select $1,$2,$3,$4 where " + fence + " on conflict do nothing returning seq", params)
            if saved:
                return event
            # A concurrent append retries at the new cursor. A stale lease fails
            # immediately, before any event can be published by an old worker.
            checks: list[Any] = []
            condition = self._fence(operation.projectId, lease_generation, lease_owner, checks)
            if not self._q("select 1 as valid where " + condition, checks):
                raise ProjectConflict("workspace_lease_lost")
        raise ProjectConflict("event_append_conflict")

    def list_events(self, operation_id: str, *, owner_id: str, after_seq: int = 0,
                    limit: int = 200) -> list[RuntimeEvent]:
        self.get_operation(operation_id, owner_id=owner_id)
        if after_seq < 0 or not 1 <= limit <= 1000:
            raise ValueError("invalid_event_cursor")
        rows = self._q("select payload from wb_project_event where operation_id=$1 and seq>$2 order by seq limit $3", [operation_id, after_seq, limit])
        return [RuntimeEvent.model_validate_json(row["payload"]) for row in rows]


_cached_store: ProjectStore | None = None
_cached_signature: str | None = None
_cache_lock = threading.Lock()


def get_project_store() -> ProjectStore:
    global _cached_store, _cached_signature
    api_url, api_key = http_api_credentials()
    database_url = (getattr(settings, "APP_STORE_DATABASE_URL", "") or "").strip()
    signature = hashlib.sha256(canonical_json([api_url, api_key, database_url]).encode()).hexdigest()
    with _cache_lock:
        if _cached_store is not None and _cached_signature == signature:
            return _cached_store
        if api_url:
            if not api_key:
                raise ProjectStoreUnavailable("project_sql_gateway_credentials_missing")
            gateway = HttpSqlGateway(api_url, api_key)
            store = ProjectStore(lambda sql, params: gateway.query(sql, params))
        elif database_url:
            if getattr(settings, "NODE_ENV", "") == "production" and database_url.startswith("sqlite:"):
                raise ProjectStoreUnavailable("project_durable_database_required")
            store = ProjectStore.from_url(database_url)
        else:
            raise ProjectStoreUnavailable("project_durable_database_required")
        if _cached_store is not None:
            _cached_store.close()
        _cached_store, _cached_signature = store, signature
        return store


def reset_project_store() -> None:
    global _cached_store, _cached_signature
    with _cache_lock:
        if _cached_store is not None:
            _cached_store.close()
        _cached_store = None
        _cached_signature = None
