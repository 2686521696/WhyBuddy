"""网页工程每条命令一台新沙盒：只装东西的命令，回执要说「装的活不过这一条」。

⚠ 2026-09-28 隔离真机第 81 轮 sr-20260928021545-B6CQ0CM50T（番茄钟 + 待办网页，追问「用 webapp-testing
  技能把添加任务、标记完成、删除这几步真的点一遍」）：
  `python3 -m pip install playwright && python3 -m playwright install chromium` 成功、Chromium
  下载完；五分钟后 `python3 -c "import playwright"` → ModuleNotFoundError，下一条日志里又一遍
  npm ci。worker 对 Vite 工程每条命令开新沙盒、跑完拆掉（办公工作区才留），模型当成「装一次
  一直在」，追问 15 分钟一下没点成。

判据走真 worker（test_project_command_worker 夹具）拿它落库的 result，再过快照和回执——
不自己拼「沙盒被回收了」。命令是第 81 轮那条原样。
把 operation_snapshot 里 sandboxReclaimed 那支删掉，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files
from services.project_tool_contracts import project_tool_definitions
from services.project_tools import _command_pointer, operation_snapshot
from test_project_command_worker import command_setup  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

ROUND81_INSTALL = "python3 -m pip install playwright && python3 -m playwright install chromium"


def _receipt(command_setup, project, script, key):
    store, _, provider, worker, _ = command_setup
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key=key, command="shell", script=script)
    done = eventually(lambda: state(store, operation, "stopped"))
    assert done.status == "completed", done.result
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    return _command_pointer(snap, "Successfully installed playwright", full_command=script)


def test_an_install_in_a_web_project_says_it_will_not_survive(command_setup):
    _, project, provider, _, _ = command_setup  # 夹具里的就是 Vite 工程（有 package-lock.json）
    receipt = _receipt(command_setup, project, ROUND81_INSTALL, "r81-install")
    assert "npm ci --ignore-scripts" in provider.commands  # 真是那条「新沙盒 + npm ci」的路
    assert "下一条命令里不在" in receipt["hint"] and "同一条命令" in receipt["hint"]


def test_install_and_use_in_one_command_gets_no_warning(command_setup):
    """反向：装 && 跑写在一起，就是对的用法，不许再唠叨。"""
    _, project, _, _, _ = command_setup
    receipt = _receipt(command_setup, project,
                       "pip install playwright && python3 tests/manual_todo_flow.py", "r81-both")
    assert "下一条命令里不在" not in receipt.get("hint", "")


def test_an_office_workspace_keeps_its_installs_so_no_warning(command_setup):
    """反向：办公工作区一台沙盒跑到底，装的东西真的还在。"""
    store = command_setup[0]
    office = store.create_project(
        "session-office-install", owner_id="alice", files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    receipt = _receipt(command_setup, office, ROUND81_INSTALL, "r81-office")
    assert "下一条命令里不在" not in receipt.get("hint", "")


def test_both_shell_descriptions_say_web_sandboxes_are_fresh_per_command():
    for item in project_tool_definitions():
        fn = item.get("function", item)
        if fn["name"] in {"shell_exec", "bash"}:
            assert "fresh sandbox" in fn["description"] and "same command" in fn["description"], fn["name"]
