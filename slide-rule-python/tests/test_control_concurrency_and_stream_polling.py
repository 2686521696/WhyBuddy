"""推演并发能配、线程池跟着放大；页面推流每轮只做一发轻查询，偶发失败扛得住。

⚠ 2026-10-10 两件事一起：
  · 服务器从 4 核升到 16 核、模型网关给到 100 并发，全站照样只能 2 个人同时推演——
    `app.py` 构造 ControlRunService 时没传 max_workers，写死在默认参数 2 上。线上要配 64。
  · 线上 sr-20261010071235-QJPAENTX80：页面报「推演连接中断」，那条 run 一直在跑。推流原来每 0.25 秒
    `store.get`（整行 payload 474 KB + 全部事件 ~520 KB）+ `authorize`（整份会话 225 KB 反序列化），
    一个看着的页面每秒几 MB 走 HTTP 网关；任何一发抖一下流就断。并发调到 64 这笔开销跟着线性放大。

推流几条走真 ControlRunStore（sqlite）+ 真 ControlRunService.subscribe，生产者那侧用 store 自己的
submit / claim / append_event / finish 写事件，只把查询数和鉴权次数记下来。

变异（逐条实测过，条目按文件里的顺序数）：app.py 构造时不传 max_workers → 第 1 条红；
  线程池默认值不跟并发走 → 第 2 条红；subscribe 每轮改回 store.get → 第 3、4、5、7 条红
  （后三条换掉的 poll_events 根本没被用到）；每轮都 authorize → 第 3 条红；轮询失败不重试 → 第 4 条红；
  失败不设上限 → 第 5 条超时红；不再定期复查权限 → 第 6 条红。
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

import app as app_module
from services.control_run_service import ControlRunService
from services.control_run_store import ControlRunNotFound, ControlRunStore
from services.project_store import ProjectStore


# ── 一、并发能配 ───────────────────────────────────────────────────────────

def _bring_up_with(monkeypatch, env_value):
    if env_value is None:
        monkeypatch.delenv("SLIDERULE_CONTROL_MAX_WORKERS", raising=False)
    else:
        monkeypatch.setenv("SLIDERULE_CONTROL_MAX_WORKERS", env_value)
    built = {}

    class FakeService:
        def __init__(self, *args, **kwargs):
            built["kwargs"] = kwargs

        async def start(self):
            built["started"] = True

    monkeypatch.setattr(app_module, "_start_project_runtime_supervisor", lambda: SimpleNamespace(preview_access=None))
    monkeypatch.setattr(app_module, "get_project_store", lambda: SimpleNamespace(_q=lambda *_a: []))
    monkeypatch.setattr(app_module, "ControlRunStore", lambda _q: object())
    monkeypatch.setattr(app_module, "ControlRunService", FakeService)
    fake_app = SimpleNamespace(state=SimpleNamespace(
        project_runtime_supervisor=None, control_run_service=None, project_preview_access=None))
    asyncio.run(app_module._bring_up_project_runtime(fake_app))
    assert built.get("started")
    return built["kwargs"].get("max_workers")


def test_startup_hands_the_configured_concurrency_to_the_run_executor(monkeypatch):
    """接在启动链路上：线上配 64，推演执行器拿到的就是 64；不配仍是 2；越界夹到 1～128。"""
    assert _bring_up_with(monkeypatch, "64") == 64
    assert _bring_up_with(monkeypatch, None) == 2
    assert _bring_up_with(monkeypatch, "999") == 128
    assert _bring_up_with(monkeypatch, "abc") == 2


def test_thread_pool_grows_with_concurrency_unless_set_explicitly(monkeypatch):
    monkeypatch.delenv("SLIDERULE_EXECUTOR_THREADS", raising=False)
    monkeypatch.setenv("SLIDERULE_CONTROL_MAX_WORKERS", "64")
    assert asyncio.run(_configure()) == 64 * 3
    monkeypatch.setenv("SLIDERULE_CONTROL_MAX_WORKERS", "2")
    assert asyncio.run(_configure()) == 64                 # 反向：并发不高时还是原来的 64
    monkeypatch.setenv("SLIDERULE_CONTROL_MAX_WORKERS", "64")
    monkeypatch.setenv("SLIDERULE_EXECUTOR_THREADS", "100")
    assert asyncio.run(_configure()) == 100                # 显式配了就听显式的（只打警告）


async def _configure():
    return app_module.configure_event_loop_executor()


# ── 二、推流轮询 ───────────────────────────────────────────────────────────

OWNER = "owner-1"


@pytest.fixture
def runs(tmp_path):
    project = ProjectStore.from_url(f"sqlite:///{tmp_path / 'state.db'}")
    store = ControlRunStore(project._q)
    # 推流读整条记录走的是 store.get（生产者写事件走 _producer_update，不算在内）
    full_reads = []
    whole = store.get

    def counted_get(run_id, owner_id):
        full_reads.append(run_id)
        return whole(run_id, owner_id)

    store.get = counted_get
    auth_calls = []

    def authorize(session_id, owner_id):
        auth_calls.append(session_id)
        return None

    service = ControlRunService(store, project, None, authorize=authorize, poll_seconds=0.01, lease_seconds=30)
    record = store.submit("sr-1", OWNER, "idem-1", {"sessionId": "sr-1"})
    claimed = store.claim(record["runId"], "worker-1", 30)
    yield SimpleNamespace(store=store, service=service, run=claimed, full_reads=full_reads, auth_calls=auth_calls)
    project.close()


async def _produce(runs, count, *, delay=0.005):
    run = runs.run
    for i in range(count):
        await asyncio.sleep(delay)
        await asyncio.to_thread(runs.store.append_event, run["runId"], "worker-1", run["generation"],
                                {"type": "control_text", "text": f"第 {i + 1} 段"})
    await asyncio.to_thread(runs.store.finish, run["runId"], "worker-1", run["generation"], "completed")


async def _watch(runs):
    return [event async for event in runs.service.subscribe(runs.run["runId"], OWNER)]


def _texts(events):
    return [e["text"] for e in events if e.get("type") == "control_text"]


def test_streaming_a_long_run_reads_the_whole_row_only_at_start_and_end(runs):
    async def go():
        watcher = asyncio.create_task(_watch(runs))
        await _produce(runs, 30)
        return await watcher

    events = asyncio.run(go())
    assert _texts(events) == [f"第 {i + 1} 段" for i in range(30)]
    assert events[-1]["type"] == "control_run_settled" and events[-1]["status"] == "completed"
    # 30 段、轮询几十次：整行只在开流和收尾各读一次；权限只在开流查一次（复查间隔 10 秒）
    assert len(runs.full_reads) <= 3, runs.full_reads
    assert len(runs.auth_calls) == 1


def test_a_poll_blip_does_not_end_the_stream(runs, monkeypatch):
    real = runs.store.poll_events
    blips = {"left": 2}

    def flaky(*args):
        if blips["left"] > 0:
            blips["left"] -= 1
            raise RuntimeError("db gateway 502")
        return real(*args)

    monkeypatch.setattr(runs.store, "poll_events", flaky)

    async def go():
        watcher = asyncio.create_task(_watch(runs))
        await _produce(runs, 5)
        return await watcher

    events = asyncio.run(go())
    assert blips["left"] == 0
    assert _texts(events) == [f"第 {i + 1} 段" for i in range(5)]
    assert events[-1]["type"] == "control_run_settled"


def test_reverse_a_store_that_stays_down_still_ends_the_stream(runs, monkeypatch):
    def down(*_args):
        raise RuntimeError("db gateway down")

    monkeypatch.setattr(runs.store, "poll_events", down)
    with pytest.raises(RuntimeError, match="db gateway down"):
        asyncio.run(asyncio.wait_for(_watch(runs), 5))


def test_reverse_revoked_access_is_still_caught_while_streaming(runs):
    runs.service.SUBSCRIBE_REAUTH_SECONDS = 0.0

    def revoked(session_id, owner_id):
        runs.auth_calls.append(session_id)
        if len(runs.auth_calls) > 1:
            raise PermissionError("control_run_access_revoked")

    runs.service.authorize = revoked
    with pytest.raises(PermissionError):
        asyncio.run(asyncio.wait_for(_watch(runs), 5))


def test_reverse_a_missing_run_fails_at_once_not_after_retries(runs, monkeypatch):
    def gone(*_args):
        raise ControlRunNotFound("control_run_not_found")

    monkeypatch.setattr(runs.store, "poll_events", gone)
    with pytest.raises(ControlRunNotFound):
        asyncio.run(asyncio.wait_for(_watch(runs), 0.5))
