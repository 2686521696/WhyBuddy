"""远端沙盒已经不在了：停服务器要走到终态，不许无限重试到事件流撑满、再永久卡死在认领上。

⚠ 2026-09-29 隔离真机（第 127 轮起的栈，backend127.log 里每个扫描周期一行
  「project operation requires reconciliation: pop-ebfecf3abf9145149ce6c17456f09b48 (ValueError)」，
  每轮 1500～2800 行）：那是 2026-09-25 sr-20260925053053-T4TJXXCW0Z 的一台开发服务器。E2B 早把沙盒回收了。
  两层叠在一起：
  1. 停它时最后一次保存数据要连沙盒——SandboxNotFoundException 被包成 e2b_connect_failed，清理当成暂时故障，
     落 interrupted/reconciling 等下一次；四天约 640 次，每次两条 runtime.state 事件。
  2. 事件流到 2000 条上限，发件箱那条状态事件写不进去，认领每次抛 operation_event_limit——操作永远停不下、
     取消不掉，每个周期重认领一次（租约代数 120424）。
  修后在库的副本上原样重放那一台：一次走到 completed/expired，applicationData=sandbox_gone。

下面三组各钉一层。变异：connect 里 SandboxNotFoundException 那支删掉 → 第一组红；checkpoint 里 SANDBOX_GONE
那支删掉 → 第二组红；flush_operation_event 里 operation_event_limit 那支删掉 → 第三组红。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services import e2b_workspace_provider as e2b
from services import project_store as store_module
from services.project_application_runtime import checkpoint_application_data
from services.workspace_provider import SANDBOX_GONE, WorkspaceHandle, WorkspaceProviderError
from test_project_runtime_patch_store import parent_state, runtime  # noqa: F401  （夹具）

HANDLE = WorkspaceHandle("ws-prj-a9a9f5fa7ce25570b209bd771aefc930", "ihor8395s4bqwhd9ohyrp")


# —— 一、provider 把「不在了」和「暂时连不上」分开 ——

def _provider_whose_connect_raises(monkeypatch, exc):
    class Sandbox:
        @staticmethod
        def connect(*args, **kwargs):
            raise exc
    monkeypatch.setattr(e2b, "_sandbox_class", lambda: Sandbox)
    return e2b.E2BWorkspaceProvider(api_key="test-key")


def test_a_sandbox_e2b_no_longer_has_is_named_gone(monkeypatch):
    from e2b.exceptions import SandboxNotFoundException
    provider = _provider_whose_connect_raises(
        monkeypatch, SandboxNotFoundException("Paused sandbox ihor8395s4bqwhd9ohyrp not found"))   # 真机原话
    with pytest.raises(WorkspaceProviderError, match=SANDBOX_GONE):
        provider.connect(HANDLE)


def test_any_other_connect_failure_stays_retryable(monkeypatch):
    """反向：网络抖动之类不许说成「不在了」——那会丢掉本来还能保存的数据。"""
    provider = _provider_whose_connect_raises(monkeypatch, TimeoutError("read timed out"))
    with pytest.raises(WorkspaceProviderError, match="e2b_connect_failed"):
        provider.connect(HANDLE)


# —— 二、最后一次保存遇到「不在了」，照实记下、让停止走完 ——

def _task(error):
    class Provider:
        def stop(self, handle, pid):
            raise WorkspaceProviderError(error)

        def read_application_data(self, handle):
            raise WorkspaceProviderError(error)
    return SimpleNamespace(
        original=SimpleNamespace(kind="runtime.start", projectId="prj-1"), handle=HANDLE,
        _application_data_enabled=True, provider=Provider(), store=None, owner_id="alice", result={},
        heartbeat=SimpleNamespace(check=lambda: None, lease=SimpleNamespace(processRefs={"server": "1321"})))


def test_the_final_checkpoint_of_a_gone_sandbox_is_recorded_not_retried():
    task = _task(SANDBOX_GONE)
    checkpoint_application_data(task, final=True)          # 不抛：清理可以走完
    assert task.result["applicationData"]["status"] == "sandbox_gone"
    assert "saved" != task.result["applicationData"]["status"]   # 不编一份「已保存」


@pytest.mark.parametrize("error, final", [("e2b_connect_failed", True), (SANDBOX_GONE, False)])
def test_a_transient_failure_or_a_periodic_checkpoint_still_raises(error, final, monkeypatch):
    """反向：暂时连不上照旧重试；周期性保存不在收尾路上，不替它做主。"""
    import services.project_application_runtime as app_runtime
    monkeypatch.setattr(app_runtime, "ProjectApplicationDataStore",
                        lambda store: SimpleNamespace(load=lambda *a, **k: None))
    with pytest.raises(WorkspaceProviderError, match=error):
        checkpoint_application_data(_task(error), final=final, force=True)


# —— 三、事件流满了，操作照样能被认领、能走到终态 ——

def _fill_to_the_cap(rt, monkeypatch):
    count = int(rt.store._q("select count(*) as n from wb_project_event where operation_id=$1",
                            [rt.parent.operationId])[0]["n"])
    monkeypatch.setattr(store_module, "MAX_OPERATION_EVENTS", count)


def test_an_operation_at_the_event_cap_can_still_be_stopped(runtime, monkeypatch):
    rt = runtime
    _fill_to_the_cap(rt, monkeypatch)
    stopping = parent_state(rt, "stopping")                 # 状态事件进了发件箱，流已经满了
    assert stopping.runtime.status == "stopping" and stopping.pendingEvent is not None
    rt.store.release_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner,
                           generation=rt.lease.generation)
    lease = rt.store.acquire_lease(rt.project.projectId, owner_id="alice", lease_owner="runtime-next", ttl_seconds=120)
    claimed = rt.store.claim_operation(rt.parent.operationId, owner_id="alice",
                                       lease_owner=lease.leaseOwner, generation=lease.generation)   # 原来这里永远抛
    resumed = rt.store.update_runtime_operation(rt.parent.operationId, owner_id="alice",      # 同真 worker：先回 running
        lease_generation=lease.generation, lease_owner=lease.leaseOwner, expected_status=claimed.status,
        status="running", runtime=claimed.runtime.model_copy(update={"status": "stopping"}))
    finished = rt.store.update_runtime_operation(rt.parent.operationId, owner_id="alice",
        lease_generation=lease.generation, lease_owner=lease.leaseOwner, expected_status=resumed.status,
        status="completed", runtime=resumed.runtime.model_copy(update={"status": "stopped", "processId": None}))
    assert finished.status == "completed"
    rt.store.flush_operation_event(rt.parent.operationId, owner_id="alice",
                                   lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    assert rt.store.get_operation(rt.parent.operationId, owner_id="alice").pendingEvent is None


def test_other_append_failures_are_not_swallowed(runtime, monkeypatch):
    """反向：只放过「流满了」；别的写入错误照旧抛，不许静默丢事件。"""
    rt = runtime
    parent_state(rt, "stopping")
    def broken(*args, **kwargs):
        raise ValueError("invalid_event_payload")
    monkeypatch.setattr(rt.store, "append_event", broken)
    with pytest.raises(ValueError, match="invalid_event_payload"):
        rt.store.flush_operation_event(rt.parent.operationId, owner_id="alice",
                                       lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    assert rt.store.get_operation(rt.parent.operationId, owner_id="alice").pendingEvent is not None
