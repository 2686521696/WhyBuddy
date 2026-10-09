"""闲置的电脑暂停、叫醒原样恢复；保留期过了才真销毁。

⚠ 2026-10-09 线上 Django 借阅登记 sr-20261009072201-D28Z7A4YAG：闲置到期电脑被销毁，叫醒开到新电脑上，准备命令装回了
  依赖，SQLite 里用户登记的数据没了（no such table）。现在闲置 / 到期 / 应用自己的结局都是「停进程、留电脑、暂停」，
  叫醒时 connect() 恢复（真 E2B 实测见 e2b_workspace_provider.PAUSE_ON_TIMEOUT 头注）；暂停超过保留期才销毁。

判据走真 worker（test_project_runtime_worker 夹具）与真 store：
- 闲置到期：进程停了、电脑没拆、立刻暂停、租约记下释放时间；下一次启动接着用这台（没有新电脑、回执不说「新电脑」）；
- 反向：授权被撤销时，就算进程停得干净，照旧拆；
- 保留期清理：过期的销毁并清掉电脑号；没过期的不动；有人在用的跳过；销毁失败不重置起点；没有起点的只补记不销毁。
变异：把闲置到期从 _KEEP_WHEN_STOPPED 拿掉、删掉 _pause_now、清理里不判保留期——各自变红。
"""

from __future__ import annotations

import itertools
import time

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.project_runtime_worker import COMPUTER_RETENTION_SECONDS
from services.workspace_provider import ProcessResult, WorkspaceProviderError
from test_project_runtime_worker import Provider, eventually, setup, state, submit  # noqa: F401  （夹具）


class PausingProvider(Provider):
    """跟 E2B 一样：能停单个进程、能暂停（暂停的电脑还在，只是不跑）。"""

    def __init__(self):
        super().__init__()
        self.pids, self.stopped, self.paused, self.destroyed = itertools.count(100), set(), [], []
        self.destroy_error = False

    def start_process(self, handle, command, **kwargs):
        self.commands.append(command)
        return ProcessResult("42" if command.startswith("npm ci") else str(next(self.pids)))

    def stop(self, handle, process_id):
        self.stopped.add(process_id)

    def is_process_running(self, handle, pid):
        return pid not in self.stopped and super().is_process_running(handle, pid)

    def pause(self, handle):
        self.paused.append(handle.sandbox_id)

    def destroy(self, handle):
        if self.destroy_error:
            raise WorkspaceProviderError("e2b_destroy_failed")
        self.destroyed.append(handle.sandbox_id)
        super().destroy(handle)


def _with(setup, provider, **kwargs):  # noqa: F811
    store, project, _, make_worker, _ = setup
    worker = make_worker(**kwargs)
    worker.provider_factory = lambda: provider
    return store, project, worker


def test_an_idle_dev_server_leaves_a_paused_computer_that_the_next_start_resumes(setup):  # noqa: F811
    provider = PausingProvider()
    store, project, worker = _with(setup, provider, idle_seconds=1)
    first = submit(worker, project)
    expired = eventually(lambda: state(store, first, "expired"))
    assert expired.runtime.errorCode == "runtime_idle_expired"
    assert provider.handles and not provider.destroyed                       # 电脑留着
    assert provider.paused == ["sandbox-1"] and expired.result.get("computerPaused") is True
    lease = eventually(lambda: (lambda l: l if l.expiresAt == 0 else None)(store.get_lease(project.projectId, owner_id="alice")))
    assert lease.sandboxId == "sandbox-1" and lease.releasedAt is not None   # 保留期从这一刻起算
    again = submit(worker, project, key="request-2")
    ready = eventually(lambda: state(store, again, "ready"))
    assert provider.created == 1 and not ready.result.get("freshComputer")   # 接着用同一台
    assert store.get_lease(project.projectId, owner_id="alice").releasedAt is None


def test_a_revoked_plan_still_takes_the_computer_away(setup):  # noqa: F811
    provider = PausingProvider()
    store, project, worker = _with(setup, provider)
    first = submit(worker, project)
    eventually(lambda: state(store, first, "ready"))
    worker.cancel(first.operationId, owner_id="alice")
    eventually(lambda: state(store, first, "stopped"))
    assert provider.handles                                                   # 前提：取消时留下了电脑
    calls = []

    def revoke_on_execute(*args):
        calls.append(1)
        if len(calls) > 1:
            raise PermissionError("project_plan_approval_required")

    worker.authorizer = revoke_on_execute
    second = submit(worker, project, key="request-2")
    failed = eventually(lambda: state(store, second, "failed"))
    assert failed.runtime.errorCode == "project_plan_approval_required"
    assert provider.destroyed == ["sandbox-1"] and not provider.paused       # 授权没了：不留


def _parked(store, project, sandbox_id="sandbox-1", released_at=None):
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="worker", ttl_seconds=60)
    lease = store.renew_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=lease.generation,
                              ttl_seconds=60, sandbox_id=sandbox_id)
    store.release_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=lease.generation,
                        released_at=released_at)
    return store.get_lease(project.projectId, owner_id="alice")


def _provider_with(sandbox_id="sandbox-1"):
    provider = PausingProvider()
    provider.create(workspace_id="ws")                                          # sandbox-1 在 E2B 那边（暂停着）
    return provider


def test_the_sweep_destroys_computers_unused_past_the_retention_and_only_those(setup):  # noqa: F811
    store, project, _, make_worker, _ = setup
    provider = _provider_with()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    _parked(store, project)
    assert worker._sweep_idle_computers(now=time.time() + COMPUTER_RETENTION_SECONDS - 3600) == 0   # 还没到期
    assert not provider.destroyed and store.get_lease(project.projectId, owner_id="alice").sandboxId == "sandbox-1"
    assert worker._sweep_idle_computers(now=time.time() + COMPUTER_RETENTION_SECONDS + 3600) == 1
    assert provider.destroyed == ["sandbox-1"]
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId is None          # 下一件事开新电脑


def test_the_sweep_skips_a_computer_in_use(setup):  # noqa: F811
    store, project, _, make_worker, _ = setup
    provider = _provider_with()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    _parked(store, project, released_at=time.time() - COMPUTER_RETENTION_SECONDS - 3600)
    store.acquire_lease(project.projectId, owner_id="alice", lease_owner="someone", ttl_seconds=60)   # 正在用
    assert worker._sweep_idle_computers() == 0 and not provider.destroyed


def test_a_failed_destroy_keeps_the_original_start_of_the_retention(setup):  # noqa: F811
    store, project, _, make_worker, _ = setup
    provider = _provider_with()
    provider.destroy_error = True
    worker = make_worker()
    worker.provider_factory = lambda: provider
    old = time.time() - COMPUTER_RETENTION_SECONDS - 3600
    _parked(store, project, released_at=old)
    assert worker._sweep_idle_computers() == 0
    lease = store.get_lease(project.projectId, owner_id="alice")
    assert lease.sandboxId == "sandbox-1" and lease.releasedAt == old                        # 一小时后再试，不重新等一周


def test_a_lease_released_before_this_field_existed_is_stamped_not_destroyed(setup):  # noqa: F811
    store, project, _, make_worker, _ = setup
    provider = _provider_with()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    lease = _parked(store, project)
    store._q("update wb_project_lease set payload=$1 where project_id=$2",
             [lease.model_copy(update={"releasedAt": None}).model_dump_json(), project.projectId])
    assert worker._sweep_idle_computers() == 0 and not provider.destroyed
    assert store.get_lease(project.projectId, owner_id="alice").releasedAt is not None        # 从现在起算


# —— E2B 那一侧：开机就设「超时暂停」，暂停调的是真 SDK 的类方法 ——

def _fake_e2b(monkeypatch, calls):
    from services import e2b_workspace_provider as e2b

    class Sandbox:
        sandbox_id = "sbx-1"

        @classmethod
        def create(cls, **kwargs):
            calls.append(("create", kwargs))
            return cls()

        @staticmethod
        def pause(sandbox_id, **kwargs):
            calls.append(("pause", sandbox_id, kwargs))
            return True

    monkeypatch.setattr(e2b, "_sandbox_class", lambda: Sandbox)
    return e2b


def test_an_e2b_computer_pauses_on_timeout_instead_of_dying(monkeypatch):
    calls = []
    e2b = _fake_e2b(monkeypatch, calls)
    e2b.E2BWorkspaceProvider(api_key="k").create(workspace_id="ws")
    assert calls[0][1]["lifecycle"] == {"on_timeout": {"action": "pause", "keep_memory": False}}


def test_an_e2b_pause_keeps_the_disk_not_the_memory(monkeypatch):
    from e2b import Sandbox as RealSandbox
    calls = []
    e2b = _fake_e2b(monkeypatch, calls)
    provider = e2b.E2BWorkspaceProvider(api_key="k")
    provider.pause(provider.create(workspace_id="ws"))
    assert calls[1] == ("pause", "sbx-1", {"keep_memory": False, "api_key": "k"})
    assert "keep_memory" in __import__("inspect").signature(RealSandbox.pause).parameters   # 真 SDK 认这个参数


def test_the_sweep_leaves_a_computer_someone_used_after_it_was_listed(setup):  # noqa: F811
    store, project, _, make_worker, _ = setup
    provider = _provider_with()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    _parked(store, project, released_at=time.time() - COMPUTER_RETENTION_SECONDS - 3600)
    stale = store.list_idle_computers(released_before=time.time())                   # 清理列出来的那一刻
    _parked(store, project, released_at=time.time() - COMPUTER_RETENTION_SECONDS - 3600)   # 随后有人用过、又放下
    store.list_idle_computers = lambda **_: stale
    assert worker._sweep_idle_computers() == 0 and not provider.destroyed
