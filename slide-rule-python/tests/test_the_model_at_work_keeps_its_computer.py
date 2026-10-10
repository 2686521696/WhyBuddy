"""模型自己在干活时，工程电脑不许当它没人用；停下来的电脑也不许挡着它改源码。

⚠ 2026-10-10 线上 Django 读书打卡 sr-20261010143514-9KNB9FZ5Q9（四条编排规则上线后的验收）：
  1. 模型 14:58 改完代码，之后九分钟一直在 browser_view / browser_input / browser_console_exec 验表单，
     开发服务器 15:07 按「闲置」停了（runtime_idle_expired）——闲置判据只认人的心跳、改动和命令。
  2. 停了以后它照提示「先停掉、再改、再启动」去改 settings.py，file_str_replace 一直是
     project_runtime_reconciliation_required：1104b201 起停下的开发服务器「留电脑、暂停」，租约上还挂着
     那条已经结束的 runtime.start，放行条件却只认办公命令（runtime.exec）。模型原地转了好几轮
     （「平台的运行时占用状态尚未完成回收」）。

判据：
- 真工人：模型隔一会儿看一眼页面，过了闲置时长开发服务器还在；不看了，照旧按闲置停（反向）；
- 真控制面派发：browser_view / browser_input 记成「在用」，只看日志 / 状态不记（反向）；
- 真工人停下的两种结局（闲置到期、被取消）留下的租约 + 操作，放行写源码；还在跑的不放（反向）；
- 线上那一发的原样租约（sandboxId + releasedAt + 进程号 + 一条 cancelled 的 runtime.start）走真 file_str_replace，能落库。
变异：去掉 _note_page_use 的调用、把放行改回只认 runtime.exec——各自变红。
"""

from __future__ import annotations

import time
from types import SimpleNamespace

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import rehearsal_control as rc
from services.deliverable_kind import finished_operation_allows_source_write, operation_left_on_lease
from services.project_tools import ProjectTools
from test_idle_computer_pauses import PausingProvider, _with
from test_project_runtime_worker import eventually, setup, state, submit  # noqa: F401  （夹具）
from test_project_tools import create, execute  # noqa: F401
from test_project_tools import setup as tools_setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch
from test_the_model_can_look_at_its_page_in_production import _as_if_ready, _ready_runtime


def _page_seen(action, page):
    return {"title": "读书打卡", "url": page["url"]}


# ── 1. 模型看页面 = 有人在用 ────────────────────────────────────────────────────────────────────────

def test_the_model_looking_at_its_page_keeps_the_dev_server_past_the_idle_window(setup):  # noqa: F811
    provider = PausingProvider()
    store, project, worker = _with(setup, provider, idle_seconds=2)
    worker.browser_interactor = _page_seen                     # 线上装的是远程浏览器（_install_model_browser）
    tools = ProjectTools(store, worker, "alice")
    first = submit(worker, project)
    eventually(lambda: state(store, first, "ready"))
    deadline = time.time() + 4                                  # 两倍闲置时长
    while time.time() < deadline:
        page = tools._preview_page(project)                     # 跟 browser_view 同一个取法
        assert page is not None and page["operationId"] == first.operationId
        tools._note_page_use(page)
        time.sleep(0.4)
    assert state(store, first, "ready") is not None             # 一直在看，就一直在
    # 反向：不看了，照旧按闲置停——这不是一张永不过期的票。
    expired = eventually(lambda: state(store, first, "expired"), timeout=8)
    assert expired.runtime.errorCode == "runtime_idle_expired"


def test_browser_tools_through_the_control_dispatch_count_as_use_and_log_reads_do_not(tools_setup, monkeypatch):  # noqa: F811
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(tools_setup)
    op = _ready_runtime(tools_setup, project)
    _as_if_ready(monkeypatch, op.operationId, project_id=project["projectId"])
    tools_setup.supervisor.browser_interactor = _page_seen

    def last_access():
        return tools_setup.store.get_operation(op.operationId, owner_id="alice").lastAccessAt

    assert last_access() is None
    for name, args in (("project_status", {}), ("shell_view", {"id": op.operationId})):
        _dispatch(tools_setup, name, args)
        assert last_access() is None, name                      # 轮询日志 / 状态不算在用
    seen = _dispatch(tools_setup, "browser_view", {})
    assert seen["ok"], seen
    after_view = last_access()
    assert after_view is not None
    time.sleep(0.01)
    typed = _dispatch(tools_setup, "browser_input", {"index": 0, "text": "三体"})
    assert typed["ok"], typed
    assert last_access() > after_view


# ── 2. 停下的电脑不挡写源码 ────────────────────────────────────────────────────────────────────────

def _left_on_lease(store, project):
    lease = eventually(lambda: (lambda l: l if l.expiresAt == 0 else None)(
        store.get_lease(project.projectId, owner_id="alice")))
    return lease, operation_left_on_lease(store, lease, "alice")


def test_a_dev_server_stopped_by_idle_or_by_cancel_leaves_a_computer_that_allows_edits(setup):  # noqa: F811
    provider = PausingProvider()
    store, project, worker = _with(setup, provider, idle_seconds=1)
    first = submit(worker, project)
    running = eventually(lambda: state(store, first, "ready"))
    lease = store.get_lease(project.projectId, owner_id="alice")
    assert not finished_operation_allows_source_write(lease, running)       # 反向：还在跑的不放
    eventually(lambda: state(store, first, "expired"))
    lease, prior = _left_on_lease(store, project)
    assert lease.sandboxId and prior.operationId == first.operationId and prior.kind == "runtime.start"
    assert finished_operation_allows_source_write(lease, prior)

    again = submit(worker, project, key="request-2")
    eventually(lambda: state(store, again, "ready"))
    worker.cancel(again.operationId, owner_id="alice")
    eventually(lambda: (lambda o: o if o.status == "cancelled" else None)(
        store.get_operation(again.operationId, owner_id="alice")))
    lease, prior = _left_on_lease(store, project)
    assert lease.sandboxId and prior.operationId == again.operationId and prior.status == "cancelled"
    assert prior.result["cleanup"]["code"] == "user_cancelled"
    assert finished_operation_allows_source_write(lease, prior)


def _the_live_lease(tools_setup, project):
    """线上 15:10 那份租约原样：sandboxId、releasedAt、进程号都还在，挂着一条 cancelled 的 runtime.start。"""
    from models.project_runtime import RuntimeInstance

    store = tools_setup.store
    operation = store.create_operation(project["projectId"], owner_id="alice", kind="runtime.start",
        idempotency_key="dev-server", expected_revision=project["revision"],
        approval_ref=tools_setup.approval, input={"port": 8000, "command": "python3 manage.py runserver 0.0.0.0:8000"})
    lease = store.acquire_lease(project["projectId"], owner_id="alice", lease_owner="runtime-worker")
    store.claim_operation(operation.operationId, owner_id="alice",
        lease_owner=lease.leaseOwner, generation=lease.generation)
    runtime = RuntimeInstance(runtimeId="rt-" + operation.operationId, workspaceId=lease.workspaceId,
        projectId=project["projectId"], revision=project["revision"], status="ready", port=8000,
        health="revision_verified", lastHeartbeat="now")
    store.update_runtime_operation(operation.operationId, owner_id="alice", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=runtime, result={})
    store.flush_operation_event(operation.operationId, owner_id="alice",
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    stopped = runtime.model_copy(update={"status": "stopped", "processId": None})
    cleanup = {"cleanup": {"status": "cancelled", "phase": "stopped", "code": "user_cancelled"}}
    for before, after in (("running", "cancelling"), ("cancelling", "cancelled")):   # 跟工人 finish() 同一条路
        store.update_runtime_operation(operation.operationId, owner_id="alice", lease_generation=lease.generation,
            lease_owner=lease.leaseOwner, expected_status=before, status=after, runtime=stopped, result=cleanup)
        store.flush_operation_event(operation.operationId, owner_id="alice",
            lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    store.renew_lease(project["projectId"], owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="irnhdo3sx273b9r3pia2l",
        process_refs={"operationId": operation.operationId, "server": "639", "preview": "719"})
    store.release_lease(project["projectId"], owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, clear_runtime=False)
    return operation


def test_the_live_stopped_dev_server_lease_lets_the_settings_edit_land(tools_setup):  # noqa: F811
    project = create(tools_setup)
    operation = _the_live_lease(tools_setup, project)
    kept = tools_setup.store.get_lease(project["projectId"], owner_id="alice")
    assert kept.sandboxId == "irnhdo3sx273b9r3pia2l" and kept.processRefs["operationId"] == operation.operationId
    assert tools_setup.store.get_operation(operation.operationId, owner_id="alice").status == "cancelled"
    edited = execute(tools_setup, "file_str_replace",
                     {"file": "src/App.tsx", "old_str": "First task", "new_str": "第一本书"})
    assert edited["ok"], edited
    assert "第一本书" in tools_setup.store.read_files(project["projectId"], owner_id="alice")["src/App.tsx"]
    assert tools_setup.store.get_lease(project["projectId"], owner_id="alice").sandboxId == "irnhdo3sx273b9r3pia2l"
    assert not tools_setup.provider_calls                       # 没碰电脑，下次启动整份写进去


def test_a_kept_computer_whose_dev_server_has_not_finished_still_refuses_edits(tools_setup):  # noqa: F811
    """反向：租约放了、电脑留着，可那条 runtime.start 还没走到终态（停的半路）——照旧拒。"""
    project = create(tools_setup)
    operation = _the_live_lease(tools_setup, project)
    lease = tools_setup.store.get_lease(project["projectId"], owner_id="alice")
    halfway = tools_setup.store.get_operation(operation.operationId, owner_id="alice").model_copy(
        update={"status": "running"})
    assert not finished_operation_allows_source_write(lease, halfway)
    pending = halfway.model_copy(update={"status": "cancelled", "pendingEvent": {"type": "stopped"}})
    assert not finished_operation_allows_source_write(lease, pending)
    assert not finished_operation_allows_source_write(lease, None)          # 操作号查不到（派发不确定）
    assert not finished_operation_allows_source_write(SimpleNamespace(sandboxId=None), halfway)
