"""排在常驻开发服务器后面的构建检查，宿主当场撤回，不留在队里、不用模型再杀一次。

⚠ 2026-09-28 隔离真机第 92 轮 sr-20260928071407-JS538JZTFK（时间记录网页，四轮追问）：三轮追问都是
  `shell_exec npm run build` → queued → 照提示 shell_kill_process → project_verify，一次确认三发，
  同一轮里犯两遍。全库 37 次这种排队，26 次 npm run build；只有 18 次被取消，其余烂在队里。

判据走真 `_dispatch_tool`，租约形状照真机（见 test_queued_command_names_its_blocker）。把
rehearsal_control 里 withdraw_unrunnable_build 那一行删掉，前两条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import rehearsal_control as rc
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime


def test_the_round92_build_behind_the_dev_server_is_withdrawn_for_real(setup):
    project = create(setup)
    holder = _hold_runtime(setup, project)
    result = _dispatch(setup, "shell_exec", {"command": "npm run build"})
    assert result["withdrawn"] is True and result["status"] == "cancelled", result
    assert setup.store.get_operation(result["operationId"], owner_id="alice").status == "cancelled"
    assert "project_verify" in result["hint"] and "buildExitCode" in result["hint"]
    assert "queueHint" not in result                    # 不再说「用 shell_kill_process 取消掉」
    assert setup.store.get_operation(holder, owner_id="alice").status == "running"  # 服务器不动


def test_the_paired_bash_tool_is_withdrawn_too(setup):
    """§四：bash 与 shell_exec 同一个工人、同一份契约。"""
    project = create(setup)
    _hold_runtime(setup, project)
    result = _dispatch(setup, "bash", {"command": "npm run check"})
    assert result.get("withdrawn") is True and result["status"] == "cancelled", result


def test_a_non_build_command_is_only_explained_not_withdrawn(setup):
    """反向：验收替不了它（种数据、跑脚本），照旧排队 + 解释，不替模型做主。"""
    project = create(setup)
    _hold_runtime(setup, project)
    result = _dispatch(setup, "shell_exec", {"command": "python3 scripts/seed_demo_data.py"})
    assert result["status"] == "queued" and "withdrawn" not in result
    assert setup.store.get_operation(result["operationId"], owner_id="alice").status == "queued"
    assert "queueHint" in result


def test_a_build_behind_a_finishing_command_is_left_to_run(setup, monkeypatch):
    """反向：挡路的是会结束的命令，构建轮得到，不许撤。"""
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    _hold_runtime(setup, project, kind="runtime.exec")
    queued = setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.exec",
        idempotency_key="later-build", expected_revision=project["revision"], approval_ref=setup.approval,
        input={"command": "build"}).operationId
    result = _dispatch(setup, "project_status", {"operationId": queued})
    assert result["status"] == "queued" and "withdrawn" not in result
    assert setup.store.get_operation(queued, owner_id="alice").status == "queued"
