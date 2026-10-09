"""一个工程一台电脑：命令装的东西下一条命令还在；电脑真被回收了，回执照实说。

⚠ 2026-10-09 线上 Django 读书打卡 sr-20261009025847-AW1KHE4BSY：工人按「像不像 Vite 工程」（有没有 package.json、
  是不是办公模板）决定一条命令要不要换新电脑、先 npm ci、跑完拆掉。Django 工程留着模板的 package.json，被当成 Vite：
  pip 装的 Django 下一条命令就没了。这一个猜测先后打过五次补丁（KWETH78PZ0、13ME64TF8Z、Z8NPKNM14C、MB5NJX8X2D、
  XSGAMK9PYZ），第 81 轮（装的 Playwright 活不过下一条）、第 135 轮（npm ci 拒装 chart.js）也是它长出来的。
  现在平台不猜语言、不替模型装依赖：命令一律接着用这个工程那台电脑。

本文件原是 test_web_sandbox_does_not_keep_installs（第 81 轮）：那时只能在回执里提醒「装的活不过这一条」。

判据走真 worker（test_project_command_worker 夹具）拿它落库的 result，再过真快照和真回执，命令是线上那几条原样。
- 网页工程（夹具有 package.json + package-lock.json）里装的东西，下一条命令同一台电脑、没有 npm ci；
- 留着模板 package.json 的 Django 工程，同上（线上那一趟本身）；
- 电脑被回收后的下一条命令：新电脑，回执说「新电脑、之前装的不在了」；反向：第一条命令、接着用的命令都不说。
变异：把 worker 的 keep 改回只留办公工程 → 前两条红；删掉 freshComputer 那支 → 第三条红。
"""

from __future__ import annotations

import time

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.project_tool_contracts import project_tool_definitions
from services.project_tools import _command_pointer, operation_snapshot
from test_project_command_worker import command_setup  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

ROUND81_INSTALL = "python3 -m pip install playwright && python3 -m playwright install chromium"
DJANGO_INSTALL = "pip install django"
TEMPLATE_PACKAGE = '{"name": "whybuddy-app", "scripts": {"dev": "vite"}}\n'


def _run(command_setup, project, script, key):
    store, _, _, worker, _ = command_setup
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key=key, command="shell", script=script)
    done = eventually(lambda: state(store, operation, "stopped"))
    assert done.status == "completed", done.result
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    return snap, _command_pointer(snap, "ok", full_command=script)


def test_an_install_in_a_web_project_is_still_there_for_the_next_command(command_setup):
    _, project, provider, _, _ = command_setup          # 夹具里的就是网页工程（有 package-lock.json）
    _, receipt = _run(command_setup, project, ROUND81_INSTALL, "r81-install")
    _run(command_setup, project, 'python3 -c "import playwright"', "r81-use")
    assert provider.created == 1 and list(provider.handles) == ["sandbox-1"]
    assert provider.commands == [ROUND81_INSTALL, 'python3 -c "import playwright"']   # 没有替它跑的 npm ci
    assert "新电脑" not in receipt.get("hint", "") and "下一条命令里不在" not in receipt.get("hint", "")


def test_a_django_project_with_the_templates_package_json_keeps_its_computer(command_setup):
    store, _, provider, _, _ = command_setup
    project = store.create_project(
        "session-django", owner_id="alice",
        files={"package.json": TEMPLATE_PACKAGE, "manage.py": "import sys\n"},
        template_version="whybuddy-react-vite-1", plan_ref="plan-1")
    _run(command_setup, project, DJANGO_INSTALL, "dj-install")
    _run(command_setup, project, "python manage.py migrate", "dj-migrate")
    assert provider.created == 1
    assert provider.commands == [DJANGO_INSTALL, "python manage.py migrate"]


def test_a_recycled_computer_is_said_plainly_and_only_then(command_setup):
    store, project, provider, _, _ = command_setup
    first, first_receipt = _run(command_setup, project, DJANGO_INSTALL, "before")
    assert "freshComputer" not in first and "新电脑" not in first_receipt.get("hint", "")   # 第一台不算「换了」
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").expiresAt <= time.time())
    provider.handles.clear()                            # 闲置太久，E2B 那边回收了
    again, receipt = _run(command_setup, project, "python manage.py migrate", "after")
    assert provider.created == 2
    assert again.get("freshComputer") is True
    assert "新电脑" in receipt["hint"] and "要用就重装" in receipt["hint"]
    _, steady = _run(command_setup, project, "python manage.py check", "steady")
    assert provider.created == 2 and "新电脑" not in steady.get("hint", "")    # 接着用的那条不说


def test_both_shell_descriptions_say_one_computer_and_no_implicit_installs():
    for item in project_tool_definitions():
        fn = item.get("function", item)
        if fn["name"] in {"shell_exec", "bash"}:
            text = fn["description"]
            assert "one computer" in text and "installs nothing for you" in text, fn["name"]
            assert "fresh sandbox" not in text, fn["name"]


# ── 开发服务器重启：停的是服务器，不是电脑 ──────────────────────────────────────────────────────────
# ⚠ 2026-10-09 线上 React 记账 sr-20261009053036-7SEDNJN15H：第一版只留命令的电脑。模型 browser_restart
#   （= 取消再起）之后新电脑上没有 node_modules，`sh: 1: vite: not found`，回执也没说换了电脑。
#   走真工具 browser_restart（ProjectTools → supervisor.cancel + submit），不自己拼「取消」。

import itertools  # noqa: E402

import pytest  # noqa: E402

from services.project_tools import FRESH_COMPUTER_NOTE  # noqa: E402
from services.workspace_provider import ProcessResult  # noqa: E402
from test_custom_dev_server_through_the_tools import START, DjangoProvider, _started  # noqa: E402
from test_custom_dev_server_through_the_tools import django as _django_world  # noqa: E402,F401


class StoppableProvider(DjangoProvider):
    """跟 E2B 一样会停单个进程（stop 停整棵进程树）；stop_works=False 时停不掉——那就得拆电脑。"""

    stop_works = True

    def __init__(self):
        super().__init__()
        self.pids, self.stopped = itertools.count(100), set()

    def start_process(self, handle, command, **kwargs):
        self.commands.append(command)
        return ProcessResult(str(next(self.pids)))

    def stop(self, handle, process_id):
        if self.stop_works:
            self.stopped.add(process_id)

    def is_process_running(self, handle, pid):
        return pid not in self.stopped and super().is_process_running(handle, pid)


@pytest.fixture
def restartable(monkeypatch):
    provider = StoppableProvider()
    monkeypatch.setattr("test_custom_dev_server_through_the_tools.DjangoProvider", lambda: provider)
    return provider


def _restart(world):
    restarted = world.tools.execute("browser_restart", {}, world.state)
    assert restarted["ok"], restarted
    op = lambda: world.store.get_operation(restarted["operationId"], owner_id="alice")  # noqa: E731
    eventually(lambda: op().runtime and op().runtime.status == "ready")
    return op(), operation_snapshot(world.store.snapshot_operation(restarted["operationId"], owner_id="alice"))


def test_browser_restart_keeps_the_computer_and_says_nothing(restartable, _django_world):
    first = _started(_django_world)
    again, snap = _restart(_django_world)
    assert first().status == "cancelled" and again.operationId != first().operationId
    assert restartable.created == 1 and len(restartable.handles) == 1            # 同一台：装过的都在
    assert "freshComputer" not in snap and "freshComputerNote" not in snap


def test_a_server_that_will_not_stop_costs_the_computer_and_the_receipt_says_so(restartable, _django_world):
    restartable.stop_works = False                                               # 停不干净：说不清，就拆
    _started(_django_world)
    _, snap = _restart(_django_world)
    assert restartable.created == 2
    assert snap.get("freshComputer") is True and snap.get("freshComputerNote") == FRESH_COMPUTER_NOTE
    assert START in restartable.commands[-1]                                     # 照上次的命令再起
