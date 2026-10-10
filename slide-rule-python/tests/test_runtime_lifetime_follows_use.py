"""有人在用，运行就别到点就停；一次启动照旧有硬上限。

⚠ 2026-10-10 用户「预览的时候并且在使用操作页面会自动刷新」。运行的到期时刻是启动那一刻定死的（默认 15 分钟）：
  人正点着页面，运行到点停掉，前端自动唤醒一台新的——整页重载、重新装依赖。而且就算把寿命调长也没用：
  开发服务器和预览隧道给沙盒的进程时限写死 900s，E2B 第 15 分钟照样把它们杀掉。
  现在：到期时刻随「有人在用」往后挪（_RuntimeTask.slide_lifetime），挪到 max_lifetime_seconds 为止；
  那两个进程活到上限；隧道授权签到上限，挪的时候不换隧道（换 = 浏览器长连接全断 = Vite 整页重载）。

真 worker 循环 + 真 SQL（同 test_project_runtime_worker 的 setup），隧道那条用真 ProjectPreviewRuntime。
每条「续」的判据都配「到上限照样停 / 不该续的不续」（CLAUDE.md §3）。变异见各条 docstring。
"""
import ast
import re
import time
from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  (fixture)
from test_project_runtime_worker import Provider, eventually, setup, state, submit  # noqa: F401  (fixture)
from test_project_preview_access import world  # noqa: F401  (fixture)
from test_project_preview_runtime import managed, TunnelProvider  # noqa: F401  (fixture)

ROOT = Path(__file__).resolve().parents[1]


def _keep_touching(store, operation, until):
    while time.monotonic() < until:
        store.touch_operation(operation.operationId, owner_id="alice")
        time.sleep(0.1)


def test_someone_using_it_keeps_it_past_the_old_deadline_but_not_past_the_ceiling(setup):
    """变异：就绪循环里不调 slide_lifetime → 第一段红（2s 就 budget 收尾）；
    挪的目标不取 min(上限, …) → 第二段红（到 4s 上限还活着）。"""
    store, project, provider, make_worker, _ = setup
    worker = make_worker(idle_seconds=1, lifetime_seconds=2, max_lifetime_seconds=4)
    operation = submit(worker, project)
    ready = eventually(lambda: state(store, operation, "ready"))
    started, first_deadline = time.monotonic(), ready.runtime.expiresAt
    _keep_touching(store, operation, started + 3)                 # 原定 2s 到期之后又过了 1s
    alive = store.get_operation(operation.operationId, owner_id="alice")
    assert alive.runtime.status == "ready", alive.runtime
    assert alive.runtime.expiresAt > first_deadline
    ceiling = alive.result["lifetimeCeiling"]
    _keep_touching(store, operation, started + 6)
    ended = eventually(lambda: state(store, operation, "expired"))
    assert ended.runtime.errorCode == "runtime_budget_exhausted"
    assert ended.runtime.expiresAt <= ceiling + 1e-6
    assert not provider.handles


def test_nobody_using_it_still_stops_at_the_idle_clock(setup):
    """反向：上限放得再宽，没人用照旧按 idle 停，不会因为「能续」就一直开着烧钱。"""
    store, project, provider, make_worker, _ = setup
    operation = submit(make_worker(idle_seconds=1, lifetime_seconds=2, max_lifetime_seconds=60), project)
    expired = eventually(lambda: state(store, operation, "expired"))
    assert expired.runtime.errorCode == "runtime_idle_expired"


def test_without_a_ceiling_the_old_fixed_budget_holds(setup):
    """不配上限 = 老行为（上限就是寿命）：一直有人用也按原定时刻停。"""
    store, project, provider, make_worker, _ = setup
    worker = make_worker(idle_seconds=1, lifetime_seconds=2)
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, "ready"))
    _keep_touching(store, operation, time.monotonic() + 3.5)
    assert state(store, operation, "expired").runtime.errorCode == "runtime_budget_exhausted"


def test_the_dev_server_is_not_killed_by_the_sandbox_before_the_ceiling(setup, monkeypatch):
    """变异：开发服务器那几处改回 timeout_seconds=900 → 红。"""
    store, project, provider, make_worker, _ = setup
    seen = []
    original = Provider.start_process
    def recording(self, handle, command, **kwargs):
        seen.append(kwargs.get("timeout_seconds"))
        return original(self, handle, command, **kwargs)
    monkeypatch.setattr(Provider, "start_process", recording)
    worker = make_worker(lifetime_seconds=30, idle_seconds=20, max_lifetime_seconds=7200)
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, "ready"))
    assert seen and max(seen) >= 7200 - 60, seen


def test_no_long_lived_process_keeps_a_hardcoded_fifteen_minutes():
    """只改一半必然静默失效（§4）：起开发服务器的每一处都得走 server_process_seconds。剥掉注释再查。"""
    offenders = []
    for path in (ROOT / "services/project_runtime_worker.py", ROOT / "services/project_verification_build.py"):
        source = ast.unparse(ast.parse(path.read_text(encoding="utf-8")))
        offenders += [path.name for _ in re.finditer(r"development_server_command\(\),\s*timeout_seconds=900", source)]
    assert not offenders, offenders


def test_sliding_the_runtime_does_not_rotate_the_tunnel(managed):
    """隧道签到上限：运行的到期往后挪时，隧道不停、授权不换。
    变异：ensure 里隧道照旧按当前到期时刻签 → 红（挪完下一次 ensure 就 stop + revoke + start）。"""
    task, provider, now = managed.task, managed.provider, managed.world.clock["now"]
    task.result["lifetimeCeiling"] = now + 3600
    task.runtime = task.runtime.model_copy(update={"expiresAt": now + 900})
    task.save("ready")
    managed.manager.ensure(task)
    first = dict(task.result["preview"])
    assert first["expiresAt"] == now + 3600
    managed.world.clock["now"] = now + 890                      # 原定到期前 10s，有人在用 → 运行往后挪
    task.runtime = task.runtime.model_copy(update={"expiresAt": now + 1800})
    task.save("ready")
    del provider.calls[:]
    managed.manager.ensure(task)
    assert [call[0] for call in provider.calls if call[0] in ("stop", "start")] == []
    assert task.result["preview"]["grantId"] == first["grantId"]
