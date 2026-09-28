"""browser_restart 的替补启动，回执不许劝模型「多余、取消掉」。

⚠ 2026-09-28 隔离真机第 89 轮 sr-20260928060820-HRBKWESVYY（习惯打卡网页，追问「刷新后完成的习惯变回未完成」）：
  browser_restart 叫停在跑的 pop-fbcc…、提交新的 pop-e38e…。新那条的回执：「已经有开发服务器
  pop-fbcc… 在跑，这条启动是多余的…这条排队的用 shell_kill_process 取消掉。」模型照做，两台都没了，
  下一发 project_verify → workspace_lease_lost，再 project_start 多花 70 秒。

判据走真 _dispatch_tool（test_queued_command_names_its_blocker 的夹具）。
把 queue_blocker 里 stopping 那一项去掉，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.control_run_service import goal_released_by
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime


import pytest


@pytest.fixture(autouse=True)
def _no_foreground_wait(monkeypatch):
    """夹具里没有工人把旧那台真的停掉；分发处等替补起来的那段前台等待在这里没有意义。"""
    from services import rehearsal_control as rc
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a, **k: 0)


def test_the_restart_replacement_is_not_told_to_cancel_itself(setup):
    project = create(setup)
    holder = _hold_runtime(setup, project)
    restarted = _dispatch(setup, "browser_restart", {})
    assert restarted["ok"] is True and restarted["status"] == "queued", restarted
    assert setup.store.get_operation(holder, owner_id="alice").cancelRequested  # 旧那台确实被叫停
    hint = restarted["queueHint"]
    assert "多余" not in hint and "取消掉" not in hint
    assert "替补" in hint and "不要取消" in hint


def test_the_replacement_does_not_release_the_goal_as_if_blocked_forever(setup):
    """挡路的在停，排着的会开始：不是「永远等不到」，目标照旧等它。"""
    project = create(setup)
    _hold_runtime(setup, project)
    restarted = _dispatch(setup, "browser_restart", {})
    operation = setup.store.get_operation(restarted["operationId"], owner_id="alice")
    assert not goal_released_by(setup.store, operation, "alice")


def test_a_plain_duplicate_start_is_still_called_redundant(setup):
    """反向：没人叫停在跑的那台时，排着的另一条启动仍是多余的，照旧劝取消。"""
    from services.project_tools import explain_queue

    project = create(setup)
    _hold_runtime(setup, project)
    queued = setup.store.create_operation(
        project["projectId"], owner_id="alice", kind="runtime.start", idempotency_key="dup-start",
        expected_revision=project["revision"], approval_ref=setup.approval, input={"port": 5173})
    body = explain_queue(setup.tools, {"status": "queued", "operationId": queued.operationId})
    assert "多余" in body["queueHint"]
