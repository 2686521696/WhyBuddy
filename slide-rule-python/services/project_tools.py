"""Session-bound model tools over immutable sources and durable E2B operations.

Tool arguments cannot choose a project or owner. Even a server-side caller holding
an old approved state must re-read durable session authority before each write.
Source edits hold the same fencing lease as the worker, and never reuse a lease
whose sandbox or dispatch references still need reconciliation.
"""

from __future__ import annotations

import json
import time
import uuid

from pydantic import ValidationError

from services.persistence import PersistClosedError
from services.project_authority import approved_reference
from services.project_creation import create_session_project, load_authorized_session, sync_session_project
from services.project_manifest import apply_file_changes, content_hash, source_path
from services.project_runtime import REVISION_FILE
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable
from services.project_tool_contracts import PROJECT_ARGUMENTS, PROJECT_WRITE_TOOLS
from services.scope_authority import plan_execution_authorized

MAX_RESULT_CHARS = 3800
_TERMINAL = {"completed", "failed", "cancelled"}


def _size(value):
    return len(json.dumps(value, ensure_ascii=False))


def _bounded_text(value, key, text):
    """Account for JSON escaping so the outer control result cap never cuts a cursor."""
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if _size({**value, key: text[:middle]}) <= MAX_RESULT_CHARS:
            low = middle
        else:
            high = middle - 1
    return text[:low]


def _bounded_log_text(result, item, text):
    low, high = 0, min(len(text), 2000)
    while low < high:
        middle = (low + high + 1) // 2
        candidate = {**result, "logs": result["logs"] + [{**item, "text": text[:middle]}]}
        if _size(candidate) <= MAX_RESULT_CHARS:
            low = middle
        else:
            high = middle - 1
    return text[:low]


def operation_snapshot(snapshot):
    operation = snapshot["operation"]
    result = {"operationId": operation.operationId, "kind": operation.kind,
        "status": operation.status, "revision": operation.expectedRevision,
        "cancelRequested": operation.cancelRequested, "lastSeq": snapshot["lastSeq"]}
    runtime = snapshot.get("runtime")
    if runtime is not None:
        active = operation.status not in _TERMINAL
        expired_lease = active and (snapshot.get("leaseExpiresAt") or 0) <= time.time()
        result["runtime"] = {"status": "reconciling" if expired_lease else runtime.status,
            "revision": runtime.revision, "health": "unknown" if expired_lease else runtime.health,
            "errorCode": "workspace_lease_expired" if expired_lease else runtime.errorCode,
            "expiresAt": runtime.expiresAt}
    # Only command outcomes are model-visible. Provider handles and the worker's
    # recovery/result payload remain private even when new fields are added.
    saved = operation.result or {}
    for name in ("command", "exitCode", "errorCode"):
        if name in saved and isinstance(saved[name], (str, int, type(None))):
            result[name] = saved[name][:240] if isinstance(saved[name], str) else saved[name]
    return result


class ProjectTools:
    def __init__(self, store, supervisor, owner_id):
        self.store, self.supervisor, self.owner_id = store, supervisor, owner_id

    def execute(self, name, args, state) -> dict:
        try:
            if name not in PROJECT_ARGUMENTS:
                raise ValueError("unknown_project_tool")
            if not isinstance(args, dict):
                raise ValueError("project_tool_arguments_invalid")
            parsed = PROJECT_ARGUMENTS[name].model_validate(args)
            session_id = str(getattr(state, "sessionId", "") or "")
            authority = load_authorized_session(session_id, owner_id=self.owner_id,
                approval_ref=parsed.approvalRef if name in PROJECT_WRITE_TOOLS else None)
            if name == "project_create":
                project = create_session_project(self.store, session_id,
                    owner_id=self.owner_id, approval_ref=parsed.approvalRef)
                return {"ok": True, **self._project_result(project)}
            project = self.store.get_project_for_session(session_id, owner_id=self.owner_id)
            if (project is None or project.sessionId != authority.sessionId
                    or authority.projectId != project.projectId or authority.runtimeKind != "project"):
                raise ProjectNotFound("session_project_not_found")
            # Runtime tools derive identity from the project index. Session fields
            # are a presentation projection and can lag a successful revision CAS.
            if name == "project_status" and parsed.operationId is None:
                result = self._project_result(project)
                if plan_execution_authorized(authority):
                    result["approvalRef"] = approved_reference(authority)
                operations = self.store.list_project_operations(project.projectId, owner_id=self.owner_id,
                    after_id=parsed.operationCursor, limit=9)
                result["operations"] = [{"operationId": op.operationId, "kind": op.kind,
                    "status": op.status, "revision": op.expectedRevision} for op in operations[:8]]
                result["hasMoreOperations"] = len(operations) > 8
                result["nextOperationCursor"] = operations[7].operationId if len(operations) > 8 else None
                lease = self.store.get_lease(project.projectId, owner_id=self.owner_id)
                result["activeOperationId"] = lease.processRefs.get("operationId") if lease else None
                return {"ok": True, **result}
            if name == "project_patch":
                return {"ok": True, **self._patch(project, parsed)}
            if name in {"project_start", "project_exec"}:
                if self.supervisor is None:
                    raise ProjectStoreUnavailable("project_worker_unavailable")
                if project.currentRevision != parsed.expectedRevision:
                    raise ProjectConflict("project_revision_conflict")
                params = dict(owner_id=self.owner_id, expected_revision=parsed.expectedRevision,
                    approval_ref=parsed.approvalRef, idempotency_key=parsed.idempotencyKey)
                if name == "project_start":
                    operation = self.supervisor.submit(project.projectId, **params, port=parsed.port)
                else:
                    operation = self.supervisor.submit_command(project.projectId, **params, command=parsed.command)
                return {"ok": True, **self._snapshot(operation.operationId)}
            if name in {"project_status", "project_logs", "project_cancel"}:
                operation = self.store.get_operation(parsed.operationId, owner_id=self.owner_id)
                if operation.projectId != project.projectId or operation.sessionId != session_id:
                    raise ProjectNotFound("project_operation_not_found")
                if name == "project_status" and parsed.waitSeconds:
                    deadline = time.monotonic() + parsed.waitSeconds
                    while operation.status not in _TERMINAL and time.monotonic() < deadline:
                        if operation.runtime is not None and operation.runtime.status == "ready":
                            break
                        time.sleep(min(0.1, max(0, deadline - time.monotonic())))
                        operation = self.store.get_operation(operation.operationId, owner_id=self.owner_id)
                if name == "project_logs":
                    return {"ok": True, **self._logs(operation, parsed)}
                if name == "project_cancel":
                    if self.supervisor is None:
                        self.store.request_operation_cancel(operation.operationId, owner_id=self.owner_id)
                    else:
                        self.supervisor.cancel(operation.operationId, owner_id=self.owner_id)
                return {"ok": True, **self._snapshot(operation.operationId)}
            revision = self.store.get_revision(project.projectId, parsed.revision, owner_id=self.owner_id)
            if name == "project_list":
                return {"ok": True, **self._list(revision, parsed)}
            files = self.store.read_files(project.projectId, revision.revision, owner_id=self.owner_id)
            if name == "project_read":
                return {"ok": True, **self._read(files, revision, parsed)}
            return {"ok": True, **self._search(files, revision, parsed)}
        except ValidationError:
            return {"ok": False, "error": "project_tool_arguments_invalid"}
        except PersistClosedError as exc:
            return {"ok": False, "error": str(exc.reason)[:240]}
        except (ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, PermissionError, ValueError) as exc:
            return {"ok": False, "error": str(exc)[:240]}

    def _project_result(self, project):
        revision = self.store.get_revision(project.projectId, owner_id=self.owner_id)
        return {"projectId": project.projectId, "revision": revision.revision,
            "templateVersion": revision.templateVersion, "fileCount": len(revision.manifest.files),
            "sourceBytes": revision.manifest.totalBytes, "runtimeKind": "project"}

    def _snapshot(self, operation_id):
        return operation_snapshot(self.store.snapshot_operation(operation_id, owner_id=self.owner_id))

    def _patch(self, project, args):
        lease = self.store.acquire_lease(project.projectId, owner_id=self.owner_id,
            lease_owner="patch-" + uuid.uuid4().hex, ttl_seconds=120)
        try:
            if lease.sandboxId or lease.processRefs:
                raise ProjectConflict("project_runtime_reconciliation_required")
            load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            current = self.store.get_revision(project.projectId, owner_id=self.owner_id)
            if current.revision != args.expectedRevision:
                raise ProjectConflict("project_revision_conflict")
            files = self.store.read_files(project.projectId, current.revision, owner_id=self.owner_id)
            changes = {}
            for change in args.changes:
                path = source_path(change.path)
                if path == REVISION_FILE:
                    raise ValueError("project_reserved_revision_file")
                if path in changes:
                    raise ValueError("project_duplicate_change_path")
                actual = content_hash(files[path]) if path in files else None
                if change.expectedSha256 != actual:
                    raise ProjectConflict("project_file_hash_conflict")
                changes[path] = change.content
            updated = apply_file_changes(files, changes)
            changed_paths = [path for path, content in changes.items() if files.get(path) != content]
            if updated == files and current.planRef == args.approvalRef:
                sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
                return {"projectId": project.projectId, "revision": current.revision, "changedFiles": []}
            # Check again after bounded source reads; no cached approval can be
            # carried through an arbitrarily slow storage call into publication.
            load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            revision = self.store.commit_revision(project.projectId, owner_id=self.owner_id,
                expected_revision=current.revision, files=updated, template_version=current.templateVersion,
                plan_ref=args.approvalRef, spec_revision=current.specRevision,
                lease_generation=lease.generation, lease_owner=lease.leaseOwner)
            sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            result = {"projectId": project.projectId, "revision": revision.revision,
                "parentRevision": current.revision, "changedFileCount": len(changed_paths),
                "changedFiles": [], "truncated": False, "verification": "not_run"}
            for path in changed_paths:
                if _size({**result, "changedFiles": result["changedFiles"] + [path]}) > MAX_RESULT_CHARS:
                    result["truncated"] = True
                    break
                result["changedFiles"].append(path)
            return result
        finally:
            self.store.release_lease(project.projectId, owner_id=self.owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)

    def _list(self, revision, args):
        entries = revision.manifest.files
        if args.cursor > len(entries):
            raise ValueError("invalid_project_cursor")
        result = {"revision": revision.revision, "files": [], "nextCursor": args.cursor, "truncated": True}
        for entry in entries[args.cursor:args.cursor + args.limit]:
            item = entry.model_dump()
            if _size({**result, "files": result["files"] + [item]}) > MAX_RESULT_CHARS:
                break
            result["files"].append(item)
            result["nextCursor"] += 1
        result["truncated"] = result["nextCursor"] < len(entries)
        return result

    def _read(self, files, revision, args):
        path = source_path(args.path)
        if path not in files:
            raise ProjectNotFound("project_file_not_found")
        text = files[path]
        if args.offset > len(text):
            raise ValueError("invalid_project_offset")
        result = {"revision": revision.revision, "path": path, "sha256": content_hash(text),
            "offset": args.offset, "nextOffset": args.offset + args.limit, "truncated": True, "totalChars": len(text)}
        result["content"] = _bounded_text(result, "content", text[args.offset:args.offset + args.limit])
        result["nextOffset"] = args.offset + len(result["content"])
        result["truncated"] = result["nextOffset"] < len(text)
        return result

    def _search(self, files, revision, args):
        query = args.query if args.caseSensitive else args.query.casefold()
        result = {"revision": revision.revision, "matches": [], "nextCursor": args.cursor, "truncated": False}
        index = 0
        for path, content in sorted(files.items()):
            sha = content_hash(content)
            for line, text in enumerate(content.splitlines(), 1):
                haystack = text if args.caseSensitive else text.casefold()
                if query not in haystack:
                    continue
                index += 1
                if index <= args.cursor:
                    continue
                item = {"path": path, "line": line, "sha256": sha, "text": text[:240], "excerptTruncated": len(text) > 240}
                if len(result["matches"]) >= args.limit or _size({**result, "matches": result["matches"] + [item]}) > MAX_RESULT_CHARS:
                    result["truncated"] = True
                    return result
                result["matches"].append(item)
                result["nextCursor"] = index
        if args.cursor > index:
            raise ValueError("invalid_project_cursor")
        return result

    def _logs(self, operation, args):
        events = self.store.list_events(operation.operationId, owner_id=self.owner_id,
            after_seq=args.afterSeq, limit=100)
        if args.offset and not events:
            raise ValueError("invalid_project_log_offset")
        result = {"operationId": operation.operationId, "logs": [], "nextSeq": args.afterSeq,
            "nextOffset": args.offset, "hasMore": False}
        for event in events:
            if event.type == "runtime.log":
                text = str(event.payload.get("text") or "")
                offset = result["nextOffset"]
                if offset > len(text):
                    raise ValueError("invalid_project_log_offset")
                item = {"seq": event.seq, "offset": offset,
                    "providerTruncated": bool(event.payload.get("truncated"))}
                segment = _bounded_log_text(result, item, text[offset:])
                if text[offset:] and not segment:
                    result["hasMore"] = True
                    return result
                result["logs"].append({**item, "text": segment})
                if offset + len(segment) < len(text):
                    result["nextOffset"] = offset + len(segment)
                    result["hasMore"] = True
                    return result
            elif result["nextOffset"]:
                raise ValueError("invalid_project_log_offset")
            result["nextSeq"] = event.seq
            result["nextOffset"] = 0
        result["hasMore"] = len(events) == 100
        return result
