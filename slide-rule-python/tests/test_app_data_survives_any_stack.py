"""应用数据（用户在生成的应用里录的东西）不只任务模板有备份：任意栈的 SQLite 库都备份、换电脑写回去。

⚠ 2026-10-10 编排正确性第 4 条。原来 project_application_runtime 只认 templateVersion == 任务模板，
  只认工程外那一个 tasks.sqlite，还按任务清单的表结构严查。Django 的 db.sqlite3、Express 写的 data.db 没人管：
  线上 Django 借阅登记 sr-20261009072201-D28Z7A4YAG 开到新电脑上，用户登记的数据没了（no such table）。
  10-09 改成「停了留电脑、暂停」挡住一半，保留期（7 天）一过照样丢。

同一天顺带翻出来两个：
  ① 电脑复用之后任务模板每次启动照旧「恢复」——复用的电脑上源码早已在，沙盒脚本拒绝覆盖在用的库，
    有备份的任务工程第二次启动直接失败（application_data_already_mounted）。
  ② 面板「恢复到这个备份」要求租约上没有电脑号；10-09 起停了的电脑留着暂停 7 天，这颗钮整一周点不动。

沙盒脚本在本机真跑（ARTIFACT_IO_SCRIPT，临时目录当工程根），provider 方法原样经过它；库是真 SQLite（含 WAL）。
每条「备份 / 写回」配一条「不该动的没动」（§3）。变异见各条 docstring。
"""
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.project_application_data import ProjectApplicationDataStore, decode_bundle, is_bundle
from services.project_application_runtime import checkpoint_application_data, restore_application_data
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT
from services.workspace_provider import WorkspaceHandle, WorkspaceProviderError
from test_project_runtime_patch_store import runtime  # noqa: F401  （夹具）
from test_project_source_operations import setup as sources  # noqa: F401  （夹具）


def _run_script(job):
    reply = subprocess.run([sys.executable, "-c", ARTIFACT_IO_SCRIPT], input=json.dumps(job), capture_output=True,
                           text=True, timeout=60)
    if reply.returncode != 0:
        raise ValueError(reply.stderr.strip().splitlines()[-1] if reply.stderr.strip() else "script_failed")
    return json.loads(reply.stdout)


class LocalSandbox(E2BWorkspaceProvider):
    """真 provider 方法 + 真沙盒脚本，只把「在 E2B 里跑」换成本机子进程、工程根换成临时目录。"""

    def __init__(self, root: Path, marker: Path):
        super().__init__(api_key="fixture")
        self.root, self.marker, self.stopped = root, marker, []

    def _artifact_io(self, handle, action, **values):
        job = {"action": action, "root": str(self.root), "markerDir": str(self.marker), **values}
        if values.get("root") == "/home/user/.whybuddy-application":
            job["root"] = str(self.marker)
        try:
            return _run_script(job)
        except ValueError:
            raise WorkspaceProviderError("project_artifact_io_failed") from None

    def stop(self, handle, pid):
        self.stopped.append(pid)


def django_db(path: Path, rows=("《三体》 借出",), wal=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    if wal:
        connection.execute("pragma journal_mode=wal")
    connection.execute("create table if not exists loans(id integer primary key, title text)")
    connection.executemany("insert into loans(title) values(?)", [(row,) for row in rows])
    connection.commit()
    return connection


def titles(data: bytes):
    connection = sqlite3.connect(":memory:")
    try:
        connection.deserialize(data)
        return [row[0] for row in connection.execute("select title from loans order by id")]
    finally:
        connection.close()


# —— 一、沙盒脚本：找库、拿一致快照、写回 ——

def test_the_snapshot_finds_the_app_database_and_reads_committed_wal_rows(tmp_path):
    """WAL 里还没回写主文件的已提交行也在快照里（直接读文件字节会丢）；依赖目录、public、非 SQLite 文件不收。
    变异：快照改成直接读文件字节 → 第二句红；skip 里去掉 node_modules → 第一句红。"""
    root, marker = tmp_path / "workspace", tmp_path / "app"
    live = django_db(root / "db.sqlite3", rows=("《三体》 借出", "《活着》 借出"), wal=True)   # 连接开着：WAL 没回写
    django_db(root / "node_modules" / "pkg" / "cache.db")
    (root / "notes.txt").write_text("not a database")
    files, current = LocalSandbox(root, marker).snapshot_application_files(WorkspaceHandle("ws", "sb"))
    live.close()
    assert set(files) == {"db.sqlite3"} and current is None
    assert titles(files["db.sqlite3"]) == ["《三体》 借出", "《活着》 借出"]


def test_restore_writes_into_a_new_computer_but_never_overwrites_unless_told(tmp_path):
    root, marker = tmp_path / "workspace", tmp_path / "app"
    saved = django_db(tmp_path / "saved" / "db.sqlite3", rows=("备份里的",))
    saved.close()
    data = (tmp_path / "saved" / "db.sqlite3").read_bytes()
    sandbox = LocalSandbox(root, marker)
    handle = WorkspaceHandle("ws", "sb")
    sandbox.restore_application_files(handle, {"instance/db.sqlite3": data}, overwrite=False, version=3)
    assert titles((root / "instance" / "db.sqlite3").read_bytes()) == ["备份里的"]
    assert sandbox.application_data_marker(handle) == 3
    # 反向：电脑上已有的库（更新）不许被盖掉……
    newer = django_db(root / "instance" / "db.sqlite3", rows=("电脑上新录的",))
    newer.close()
    sandbox.restore_application_files(handle, {"instance/db.sqlite3": data}, overwrite=False, version=3)
    assert "电脑上新录的" in titles((root / "instance" / "db.sqlite3").read_bytes())
    # ……除非明说覆盖（用户恢复了别的备份），而且旧的 -wal 一并清掉（留着会把旧事务回放进新库）
    (root / "instance" / "db.sqlite3-wal").write_bytes(b"stale")
    sandbox.restore_application_files(handle, {"instance/db.sqlite3": data}, overwrite=True, version=4)
    assert titles((root / "instance" / "db.sqlite3").read_bytes()) == ["备份里的"]
    assert not (root / "instance" / "db.sqlite3-wal").exists() and sandbox.application_data_marker(handle) == 4


@pytest.mark.parametrize("path", ["../escape.db", "/etc/passwd.db", "node_modules/x.db", "a/./b.db"])
def test_restore_refuses_paths_outside_the_project_data(tmp_path, path):
    root, marker = tmp_path / "workspace", tmp_path / "app"
    data = sqlite3.connect(":memory:")
    data.execute("create table loans(id integer primary key, title text)")
    payload = data.serialize()
    with pytest.raises(WorkspaceProviderError):
        LocalSandbox(root, marker).restore_application_files(WorkspaceHandle("ws", "sb"), {path: payload},
                                                             overwrite=True, version=1)
    assert not (tmp_path / "escape.db").exists()


# —— 二、运行这一层：任意栈备份、换电脑写回、复用的电脑留着自己的 ——

def _task(rt, sandbox, *, mode="files"):
    heartbeat = SimpleNamespace(check=lambda: None, lease=SimpleNamespace(processRefs={"server": "43"}))
    return SimpleNamespace(store=rt.store, owner_id="alice", original=rt.parent, operation_id=rt.parent.operationId,
        handle=WorkspaceHandle("ws", "sb"), heartbeat=heartbeat, lease=rt.lease, provider=sandbox, result={},
        _application_data_mode=mode)


def test_a_django_database_is_backed_up_and_comes_back_on_a_new_computer(runtime, tmp_path):
    """变异：_mode 照旧只认任务模板 → 第一句红（没有备份）；新电脑不写回 → 最后一句红。"""
    rt = runtime
    old_root = tmp_path / "old-computer"
    django_db(old_root / "db.sqlite3", rows=("《三体》 借出",)).close()
    task = _task(rt, LocalSandbox(old_root, tmp_path / "old-app"), mode="unset")    # 让它自己按模板判
    checkpoint_application_data(task, force=True)
    saved = ProjectApplicationDataStore(rt.store).load(rt.project.projectId, owner_id="alice")
    assert saved is not None and is_bundle(saved[1]), task.result
    assert set(decode_bundle(saved[1])) == {"db.sqlite3"}
    # 保留期过了、开到新电脑上：先写回去，应用起来就看得见
    fresh = _task(rt, LocalSandbox(tmp_path / "new-computer", tmp_path / "new-app"))
    restore_application_data(fresh, reused=False)
    assert fresh.result["applicationData"]["status"] == "restored"
    assert titles((tmp_path / "new-computer" / "db.sqlite3").read_bytes()) == ["《三体》 借出"]


def test_a_reused_computer_keeps_its_newer_data_until_the_user_restores_another_backup(runtime, tmp_path):
    """变异：复用时不看标记、一律覆盖 → 第一段红（盖掉了最后 30 秒里录的）；标记对不上也不覆盖 → 第二段红。"""
    rt = runtime
    root, marker = tmp_path / "computer", tmp_path / "app"
    sandbox = LocalSandbox(root, marker)
    django_db(root / "db.sqlite3", rows=("第一条",)).close()
    task = _task(rt, sandbox)
    checkpoint_application_data(task, force=True)                       # 备份 v1，标记 1
    first = task.result["applicationData"]["version"]
    django_db(root / "db.sqlite3", rows=("最后 30 秒里录的",)).close()     # 还没来得及存
    again = _task(rt, sandbox)
    restore_application_data(again, reused=True)
    assert again.result["applicationData"]["status"] == "kept"
    assert "最后 30 秒里录的" in titles((root / "db.sqlite3").read_bytes())
    # 备份头挪到了这台电脑没见过的一版（用户在面板上恢复了别的备份——那条路要停机，这里直接把标记拨回去等价）
    checkpoint_application_data(_task(rt, sandbox), force=True)        # v2 = 「第一条 + 最后 30 秒里录的」
    sandbox.mark_application_data(WorkspaceHandle("ws", "sb"), first)   # 这台电脑上的数据只对应 v1
    django_db(root / "db.sqlite3", rows=("不该留下的",)).close()
    later = _task(rt, sandbox)
    restore_application_data(later, reused=True)
    assert later.result["applicationData"]["status"] == "restored" and later.result["applicationData"]["version"] == 2
    assert titles((root / "db.sqlite3").read_bytes()) == ["第一条", "最后 30 秒里录的"]


def test_a_backup_failure_never_takes_the_running_app_down(runtime, tmp_path):
    """保护性的增强（§七 fail-open）：快照炸了照实记下，不抛——抛了就杀掉用户正在用的应用。
    反向：任务模板那条照旧 fail-closed（test_a_gone_sandbox_lets_the_runtime_stop 钉着）。"""
    rt = runtime
    sandbox = LocalSandbox(tmp_path / "computer", tmp_path / "app")
    def broken(handle):
        raise WorkspaceProviderError("project_artifact_io_failed")
    sandbox.snapshot_application_files = broken
    task = _task(rt, sandbox)
    checkpoint_application_data(task, force=True)
    assert task.result["applicationData"]["status"] == "checkpoint_failed"


def test_missing_live_data_does_not_replace_a_good_backup(runtime, tmp_path):
    rt = runtime
    root = tmp_path / "computer"
    django_db(root / "db.sqlite3").close()
    sandbox = LocalSandbox(root, tmp_path / "app")
    checkpoint_application_data(_task(rt, sandbox), force=True)
    (root / "db.sqlite3").unlink()                                     # 应用自己把库删了 / 迁移失败
    task = _task(rt, sandbox)
    checkpoint_application_data(task, force=True)
    assert task.result["applicationData"]["status"] == "missing"
    saved = ProjectApplicationDataStore(rt.store).load(rt.project.projectId, owner_id="alice")
    assert saved[0]["version"] == 1                                    # 好的那份还是头


# —— 三、任务模板：复用的电脑第二次启动不再失败 ——

def test_a_tasks_project_with_a_backup_starts_again_on_its_reused_computer(runtime, tmp_path):
    """⚠ 复用的电脑上照旧调 write_application_data，沙盒脚本拒绝覆盖在用的库 → 启动失败。
    变异：restore_application_data 不分 reused、照旧写 → 红（这里的替身照真脚本那样拒）。"""
    from test_project_application_data import database
    rt = runtime
    backups = ProjectApplicationDataStore(rt.store)
    saved = backups.save(rt.project.projectId, owner_id="alice", runtime_operation_id=rt.parent.operationId,
        lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner, payload=database(), expected_version=None)
    sandbox = LocalSandbox(tmp_path / "computer", tmp_path / "app")
    sandbox.mark_application_data(WorkspaceHandle("ws", "sb"), saved["version"])
    def mounted(handle, data):
        raise WorkspaceProviderError("project_artifact_io_failed")      # application_data_already_mounted
    sandbox.write_application_data = mounted
    task = _task(rt, sandbox, mode="tasks")
    restore_application_data(task, reused=True)
    assert task.result["applicationData"]["status"] == "kept"


# —— 四、面板「恢复到这个备份」：电脑留着暂停时也点得动 ——

def test_restore_is_allowed_while_only_a_paused_computer_is_kept(sources):
    """变异：路由照旧「租约上有电脑号就拒」→ 第一句红。"""
    store, project = sources.store, sources.project
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old-runtime", ttl_seconds=60)
    lease = store.renew_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, ttl_seconds=60, sandbox_id="sb-paused", process_refs={"server": "43"})
    store.release_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sb-paused"
    response = sources.client.post(sources.url + "/data/restore", json={"backupId": "pad-missing", "expectedVersion": 1})
    assert "requires_stopped_runtime" not in response.text, response.text       # 过了闸，到了「找不到这个备份」
    # 反向：真有一台在跑 / 排着队，照旧拒
    store.create_operation(project.projectId, owner_id="alice", kind="runtime.start", idempotency_key="live",
        expected_revision=project.currentRevision, approval_ref=store.get_revision(project.projectId, owner_id="alice").planRef,
        input={"port": 5173})
    response = sources.client.post(sources.url + "/data/restore", json={"backupId": "pad-missing", "expectedVersion": 1})
    assert "requires_stopped_runtime" in response.text, response.text
