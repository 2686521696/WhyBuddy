"""Lease-owned application database checkpoints, separate from source versions.

The task template writes a real SQLite image atomically in its own data directory.
Every 30 seconds the runtime owner checkpoints changed bytes into durable SQL;
normal stop first stops the application, then saves the final image. Abrupt remote
loss recovers the last saved checkpoint, not an invented lossless database backup.
Verification uses another directory and never checkpoints its fixture accounts.

⚠ 2026-10-10 编排正确性第 4 条：原来只有任务模板有这一套（templateVersion == tasks），别的工程的数据没人管。
  线上 Django 借阅登记 sr-20261009072201-D28Z7A4YAG 开到新电脑上，用户登记的数据没了（no such table）；10-09 改成
  「停了留电脑、暂停」挡住了一半，保留期（7 天）一过照样丢。现在任意栈的网页工程（mode=files）：工程树里的 SQLite 库
  按同一个 30 秒节奏做一致快照、打包备份（project_application_data.encode_bundle），开到新电脑上先写回去。
  它是保护性的增强（§七 fail-open）：备份自己出了问题记下状态，不许把用户正在用的应用拖垮；任务模板照旧 fail-closed。

⚠ 同日：电脑复用（10-09「一个工程一台电脑」）之后，任务模板每次启动照旧去「恢复」——复用的电脑上源码早已在，
  恢复脚本拒绝覆盖在用的库（application_data_already_mounted），有备份的任务工程第二次启动直接失败。现在复用的电脑
  看它上次记下的数据版本（标记文件）：跟备份一样就留着它自己的（更新）；备份被用户恢复成别的版本了才覆盖。
"""

import hashlib
import logging
import time

from services.project_application_data import ProjectApplicationDataStore, decode_bundle, encode_bundle, is_bundle
from services.workspace_provider import SANDBOX_GONE, WorkspaceProviderError

logger = logging.getLogger(__name__)
TASKS_TEMPLATE_VERSION = "whybuddy-react-vite-tasks-1"


def _mode(task):
    """tasks：任务模板那一份库（严格）；files：任意栈的网页工程，工程树里的 SQLite 库（fail-open）；None：不管。"""
    if task.original.kind != "runtime.start":
        return None
    if getattr(task, "_application_data_enabled", None) is True:     # 老写法（测试替身直接钉「任务模板」）
        return "tasks"
    known = getattr(task, "_application_data_mode", "unset")
    if known == "unset":
        revision = task.store.get_revision(task.original.projectId, owner_id=task.owner_id)
        known = "tasks" if revision.templateVersion == TASKS_TEMPLATE_VERSION else "files"
        task._application_data_mode = known
    return known


def _enabled(task):
    return _mode(task) is not None


def _supports_files(provider):
    return all(callable(getattr(provider, name, None))
               for name in ("snapshot_application_files", "restore_application_files", "mark_application_data",
                            "application_data_marker"))


def restore_application_data(task, *, reused=False):
    mode = _mode(task)
    if mode is None:
        return
    if mode == "files":
        try:
            _restore_files(task, reused=reused)
        except (WorkspaceProviderError, ValueError) as exc:
            logger.warning("application data restore skipped project=%s code=%s", task.original.projectId, exc)
            task.result["applicationData"] = {"status": "restore_failed", "errorCode": str(exc)[:120]}
        return
    task.heartbeat.check()
    records = ProjectApplicationDataStore(task.store)
    saved = records.load(task.original.projectId, owner_id=task.owner_id)
    if saved is None:
        task.result["applicationData"] = {"status": "not_initialized", "version": 0}
        return
    metadata, data = saved
    if reused:
        # 复用的电脑：库还在、比备份新，留着它。只有备份被用户恢复成别的版本（标记对不上）才覆盖。
        if _supports_files(task.provider) and task.provider.application_data_marker(task.handle) != metadata["version"]:
            task.heartbeat.check()
            task.provider.restore_application_files(task.handle, {"tasks.sqlite": data}, overwrite=True,
                                                    version=metadata["version"], base="application")
            task.result["applicationData"] = {"status": "restored", **metadata}
            return
        task.result["applicationData"] = {"status": "kept", **metadata}
        return
    task.heartbeat.check()
    task.provider.write_application_data(task.handle, data)
    if _supports_files(task.provider):
        task.provider.mark_application_data(task.handle, metadata["version"])
    task.result["applicationData"] = {"status": "restored", **metadata}


def _restore_files(task, *, reused):
    if not _supports_files(task.provider):
        return
    task.heartbeat.check()
    saved = ProjectApplicationDataStore(task.store).load(task.original.projectId, owner_id=task.owner_id)
    if saved is None or not is_bundle(saved[1]):
        task.result["applicationData"] = {"status": "not_initialized", "version": 0}
        return
    metadata, payload = saved
    files = decode_bundle(payload)
    if reused and task.provider.application_data_marker(task.handle) == metadata["version"]:
        task.result["applicationData"] = {"status": "kept", **metadata}
        return
    task.heartbeat.check()
    # 新电脑：已有的不动（不会有）。复用的电脑上版本对不上（用户恢复了别的备份）：覆盖。应用这时还没起。
    task.provider.restore_application_files(task.handle, files, overwrite=reused, version=metadata["version"])
    task.result["applicationData"] = {"status": "restored", **metadata}


def _checkpoint_files(task, *, final):
    if not _supports_files(task.provider):
        return
    if final:
        pid = task.heartbeat.lease.processRefs.get("server")
        if pid:
            task.provider.stop(task.handle, pid)
            task.heartbeat.check()
    records = ProjectApplicationDataStore(task.store)
    latest = records.load(task.original.projectId, owner_id=task.owner_id)
    task.heartbeat.check()
    files, _marker = task.provider.snapshot_application_files(task.handle)
    # 纯前端（数据在浏览器里，工程树里没有库）每 30 秒扫一遍是白跑一条沙盒命令：还没见过库就隔 2 分钟再看。
    task._application_checkpoint_after = time.monotonic() + (30 if files or latest is not None else 120)
    if not files:
        if latest is not None:
            # 恢复过却找不到库：不拿「空」盖掉一份好的备份，照实记下来。
            task.result["applicationData"] = {"status": "missing", **latest[0]}
        return
    payload = encode_bundle(files)
    digest = hashlib.sha256(payload).hexdigest()
    if latest is not None and latest[0]["sha256"] == digest:
        task.result["applicationData"] = {"status": "saved", **latest[0]}
        return
    task.heartbeat.check()
    metadata = records.save(task.original.projectId, owner_id=task.owner_id,
        runtime_operation_id=task.operation_id, lease_generation=task.lease.generation,
        lease_owner=task.lease.leaseOwner, payload=payload,
        expected_version=latest[0]["version"] if latest else None)
    task.provider.mark_application_data(task.handle, metadata["version"])
    task.result["applicationData"] = {"status": "saved", "files": sorted(files), **metadata}


def checkpoint_application_data(task, *, final=False, force=False):
    mode = _mode(task)
    if mode is None or task.handle is None:
        return
    if mode == "files":
        if not final and not force and time.monotonic() < getattr(task, "_application_checkpoint_after", 0):
            return
        try:
            task.heartbeat.check()
            _checkpoint_files(task, final=final)
        except (WorkspaceProviderError, ValueError) as exc:
            # 保护性的增强：备份没存成照实记下，不拖垮在用的应用；30 秒后再试（额度满了就一直是这个状态）。
            task._application_checkpoint_after = time.monotonic() + 30
            if str(exc) == SANDBOX_GONE and final:
                task.result["applicationData"] = {"status": "sandbox_gone",
                    "note": "sandbox no longer exists; the last saved checkpoint stands"}
                return
            logger.warning("application data checkpoint skipped project=%s code=%s", task.original.projectId, exc)
            task.result["applicationData"] = {"status": "checkpoint_failed", "errorCode": str(exc)[:120]}
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
    # 记下这台电脑上的库对应哪一版备份：下次复用时据此判断留着它还是被用户恢复的那版覆盖（restore_application_data）。
    if _supports_files(task.provider) and getattr(task, "_application_marked", None) != metadata["version"]:
        task.provider.mark_application_data(task.handle, metadata["version"])
        task._application_marked = metadata["version"]
    task.result["applicationData"] = {"status": "saved", **metadata}
    task._application_checkpoint_after = time.monotonic() + 30
