"""一个工程同一时刻只有一台开发服务器。

⚠ 2026-09-25 隔离真机 sr-20260925043119-K1N7JX1FPS（记账网页）：
  project_start → browser_navigate → browser_view → project_start …… 每一发
  都新提交一个 runtime.start，排在正在跑的那台后面；回执劝「先停掉挡路的」，
  模型停掉在跑的，排队的旧启动顶上来，它再发一个。一轮 6 起 4 停，收工时
  还有 3 个启动烂在队列里。

判据走真的 `_dispatch_tool`，租约照真机：processRefs.operationId 指着在跑的
那台。把 `_runtime_for_view` 改回直接 `supervisor.submit`，前两条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime


def _starts(setup, project):
    return [op for op in setup.store.list_project_operations(project["projectId"], owner_id="alice", limit=100)
            if op.kind == "runtime.start"]


def test_looking_at_the_page_reuses_the_running_dev_server(setup, monkeypatch):
    monkeypatch.setattr("services.rehearsal_control._project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    holder = _hold_runtime(setup, project)
    for name, args in [("browser_navigate", {"url": "/"}), ("deploy_expose_port", {}),
                       ("project_start", {"approvalRef": setup.approval,
                                          "expectedRevision": project["revision"],
                                          "idempotencyKey": "start-again", "port": 5173})]:
        result = _dispatch(setup, name, args)
        assert result["ok"] is True, (name, result)
        assert result["operationId"] == holder, (name, result)
        assert result.get("runtimeReused") is True
        assert "blockedBy" not in result
    assert [op.operationId for op in _starts(setup, project)] == [holder]


def test_a_queued_start_is_reused_too_not_stacked(setup, monkeypatch):
    """反向起点：没有开发服务器时照常起一台；第二发看页面不再叠一台。"""
    monkeypatch.setattr("services.rehearsal_control._project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    first = _dispatch(setup, "browser_navigate", {"url": "/"})
    assert first["ok"] and first.get("runtimeReused") is None
    assert len(_starts(setup, project)) == 1
    second = _dispatch(setup, "browser_navigate", {"url": "/"})
    assert second["operationId"] == first["operationId"] and second["runtimeReused"] is True
    assert len(_starts(setup, project)) == 1


def test_an_explicit_restart_stops_the_running_one(setup, monkeypatch):
    """反向：明确要求重启时才停——停的是在跑的那台，不是随便哪条。"""
    monkeypatch.setattr("services.rehearsal_control._project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    holder = _hold_runtime(setup, project)
    result = _dispatch(setup, "browser_restart", {})
    assert result["ok"] is True and result["operationId"] != holder
    assert setup.store.get_operation(holder, owner_id="alice").cancelRequested is True


def test_latest_operation_is_the_most_recently_created(setup):
    """operationId 是随机 uuid：按 id 排的「最后一个」原来是随机一个。

    12 条里随机撞对的概率 1/12，改回 `[-1]` 基本必红。
    """
    project = create(setup)
    made = [setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.exec",
        idempotency_key=f"exec-{i}", expected_revision=project["revision"], approval_ref=setup.approval,
        input={"command": "build"}) for i in range(12)]
    latest = setup.tools._latest_operation(setup.store.get_project(project["projectId"], owner_id="alice"))
    assert latest.operationId == made[-1].operationId
