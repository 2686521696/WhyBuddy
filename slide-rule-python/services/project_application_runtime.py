"""Lease-owned application database checkpoints, separate from source versions.

The task template writes a real SQLite image atomically in its own data directory.
Every 30 seconds the runtime owner checkpoints changed bytes into durable SQL;
normal stop first stops the application, then saves the final image. Abrupt remote
loss recovers the last saved checkpoint, not an invented lossless database backup.
Verification uses another directory and never checkpoints its fixture accounts.
"""

import hashlib
import time

from services.project_application_data import ProjectApplicationDataStore
from services.workspace_provider import SANDBOX_GONE, WorkspaceProviderError


def _enabled(task):
    if task.original.kind != "runtime.start":
        return False
    known = getattr(task, "_application_data_enabled", None)
    if known is None:
        revision = task.store.get_revision(task.original.projectId, owner_id=task.owner_id)
        known = revision.templateVersion == "whybuddy-react-vite-tasks-1"
        task._application_data_enabled = known
    return known


def restore_application_data(task):
    if not _enabled(task):
        return
    task.heartbeat.check()
    records = ProjectApplicationDataStore(task.store)
    saved = records.load(task.original.projectId, owner_id=task.owner_id)
    if saved is not None:
        metadata, data = saved
        task.heartbeat.check()
        task.provider.write_application_data(task.handle, data)
        task.result["applicationData"] = {"status": "restored", **metadata}
    else:
        task.result["applicationData"] = {"status": "not_initialized", "version": 0}


def checkpoint_application_data(task, *, final=False, force=False):
    if not _enabled(task) or task.handle is None:
        return
    if not final and not force and time.monotonic() < getattr(task, "_application_checkpoint_after", 0):
        return
    task.heartbeat.check()
    try:
        if final:
            pid = task.heartbeat.lease.processRefs.get("server")
            if pid:
                task.provider.stop(task.handle, pid)
                task.heartbeat.check()
                if task.provider.is_process_running(task.handle, pid):
                    raise WorkspaceProviderError("project_application_stop_unconfirmed")
        records = ProjectApplicationDataStore(task.store)
        latest = records.load(task.original.projectId, owner_id=task.owner_id)
        task.heartbeat.check()
        data = task.provider.read_application_data(task.handle)
    except WorkspaceProviderError as exc:
        # ⚠ 2026-09-29 隔离真机（第 127 轮起的栈里发现）：09-25 的开发服务器沙盒早被回收，最后一次保存去停
        #   进程、连不上，清理判「待重试」——四天约 640 次，事件流撑满后永久卡死。沙盒不在了，里面的数据也
        #   不在了：重试只会一直失败。头注那句「远端突然没了，恢复的是最后一次保存的检查点」就是这时候的答案。
        #   照实记下来（不编一份「已保存」），让停止走完。暂时连不上（e2b_connect_failed）照旧重试。
        if not final or str(exc) != SANDBOX_GONE:
            raise
        task.result["applicationData"] = {"status": "sandbox_gone",
            "note": "sandbox no longer exists; the last saved checkpoint stands"}
        return
    if data is None:
        if latest is not None:
            # Missing live data after restoring it is data loss, not permission
            # to replace a good checkpoint with an empty new application.
            raise WorkspaceProviderError("project_application_data_missing")
        task._application_checkpoint_after = time.monotonic() + 30
        return
    digest = hashlib.sha256(data).hexdigest()
    if latest is not None and latest[0]["sha256"] == digest:
        metadata = latest[0]
    else:
        task.heartbeat.check()
        metadata = records.save(task.original.projectId, owner_id=task.owner_id,
            runtime_operation_id=task.operation_id, lease_generation=task.lease.generation,
            lease_owner=task.lease.leaseOwner, payload=data,
            expected_version=latest[0]["version"] if latest else None)
    task.result["applicationData"] = {"status": "saved", **metadata}
    task._application_checkpoint_after = time.monotonic() + 30
