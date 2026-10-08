"""错误上报：ERROR 日志（含 log.exception 的调用栈）成为一个事件，带会话号，出这台机器之前脱敏；没配就什么都不做。

⚠ 2026-10-08 同一天四次真机故障，真正的报错都只打在出事那台机器的控制台里（services/error_reporting 头注）。
走真的 sentry-sdk：transport 换成只在内存里收事件的，什么都不发出去。日志器名和那句话照产线原样
（control_run_service 里的 `log.exception("control producer failed")`）。
"""

from __future__ import annotations

import asyncio
import logging

import pytest
import sentry_sdk
from sentry_sdk.transport import Transport

from services import error_reporting
from services.error_reporting import FILTERED, init_error_reporting, reporting_scope, scrub_event

DSN = "https://publickey@o0.ingest.sentry.io/0"
PRODUCER = logging.getLogger("services.control_run_service")       # 产线那句 log.exception 用的就是它


class _Inbox(Transport):
    def __init__(self, options=None):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.type == "event":
                self.events.append(item.payload.json)


@pytest.fixture
def inbox(monkeypatch):
    box = _Inbox()
    real_init = sentry_sdk.init
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: real_init(transport=box, **kw))
    yield box
    sentry_sdk.get_client().close()
    sentry_sdk.init()                                                # 恢复成没有 DSN 的空客户端
    monkeypatch.setattr(error_reporting, "_active", False)


def _flush():
    sentry_sdk.flush(timeout=2)


def test_without_a_dsn_nothing_is_turned_on(inbox):
    assert init_error_reporting("python", env={}) is False
    assert not error_reporting.is_active()
    with reporting_scope(session_id="sr-x"):                         # 没接上也能照常用，空操作
        PRODUCER.error("boom")
    assert inbox.events == []


def test_the_producer_failure_arrives_with_its_traceback_session_and_machine(inbox):
    assert init_error_reporting("python", env={"SENTRY_DSN": DSN, "SLIDERULE_WORKER_POOL": "dev-DESKTOP-57LOSN8-8374d0ee"})
    with reporting_scope(run_id="ctr-a45b784630d3574395f11e68319a9055", session_id="sr-20261008092556-8PW0MNC7ZW"):
        try:
            raise LookupError("No time zone found with key Asia/Shanghai")
        except LookupError:
            PRODUCER.exception("control producer failed")
    _flush()
    [event] = inbox.events
    assert event["tags"]["session_id"] == "sr-20261008092556-8PW0MNC7ZW"
    assert event["tags"]["worker_pool"] == "dev-DESKTOP-57LOSN8-8374d0ee"
    assert event["tags"]["service"] == "python"
    assert event["environment"] == "development" and event["server_name"]
    [exc] = event["exception"]["values"]
    assert exc["type"] == "LookupError" and exc["stacktrace"]["frames"]      # 调用栈在
    assert event["logentry"]["message"] == "control producer failed"


def test_warnings_are_context_not_events(inbox):
    """反向：WARNING 不成事件（只进面包屑），否则「keeping run」这种自愈日志会把收件箱淹掉。"""
    init_error_reporting("python", env={"SENTRY_DSN": DSN})
    PRODUCER.warning("control authority lookup unavailable (3s so far), keeping run")
    _flush()
    assert inbox.events == []


def test_secrets_never_leave_the_machine(inbox):
    init_error_reporting("python", env={"SENTRY_DSN": DSN})
    try:
        raise RuntimeError("connect postgresql://neondb_owner:p4ss@ep-x.neon.tech/neondb failed; "
                           "Authorization: Bearer sk-abcdefghijklmnopqrstuvwx; password=hunter2")
    except RuntimeError:
        PRODUCER.exception("identity lookup failed for %s", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.c2lnbmF0dXJlMTIz")
    _flush()
    text = repr(inbox.events)
    for secret in ("p4ss", "neondb_owner", "sk-abcdefghijklmnop", "hunter2", "eyJhbGciOiJIUzI1NiJ9"):
        assert secret not in text, secret
    assert FILTERED in text


def test_request_headers_cookies_and_body_are_stripped():
    event = {"request": {"headers": {"Authorization": "Bearer x", "X-Internal-Key": "dev-slide-rule-internal",
                                     "Cookie": "sr_session=abc", "User-Agent": "Mozilla"},
                         "cookies": {"sr_session": "abc"}, "data": {"userText": "我们公司的报价"}}}
    out = scrub_event(event)
    headers = out["request"]["headers"]
    assert headers["Authorization"] == headers["X-Internal-Key"] == headers["Cookie"] == FILTERED
    assert headers["User-Agent"] == "Mozilla"                               # 反向：不相干的不剥
    assert "cookies" not in out["request"] and "data" not in out["request"]


def test_a_scrubber_that_breaks_drops_the_event_rather_than_sending_it_raw():
    class Weird(dict):
        def get(self, *a, **k):
            raise RuntimeError("boom")
    assert scrub_event(Weird()) is None


def test_two_runs_at_once_keep_their_own_session(inbox):
    """控制回合是同一个进程里并发跑的：标签不许串。"""
    init_error_reporting("python", env={"SENTRY_DSN": DSN})

    async def run(sid, delay):
        with reporting_scope(session_id=sid):
            await asyncio.sleep(delay)
            PRODUCER.error("control producer failed")

    async def both():
        await asyncio.gather(asyncio.create_task(run("sr-A", 0.02)), asyncio.create_task(run("sr-B", 0.0)))
    asyncio.run(both())
    _flush()
    assert sorted(e["tags"]["session_id"] for e in inbox.events) == ["sr-A", "sr-B"]


def test_the_live_paths_are_wrapped():
    """§三：函数写对了 ≠ 接上了。控制回合、工程操作、进程启动三处真的调到。"""
    import inspect

    from services import control_run_service, project_runtime_worker
    src = inspect.getsource(control_run_service.ControlRunService)
    assert "asyncio.create_task(self._produce_reported(claimed))" in src
    worker = inspect.getsource(project_runtime_worker)
    assert "with reporting_scope(operation_id=original.operationId" in worker
    from pathlib import Path
    app = (Path(__file__).resolve().parents[1] / "app.py").read_text("utf-8")
    assert app.index('init_error_reporting("python")') < app.index("app = FastAPI(")


# ── §四 成对：跟 TS 那份（shared/observability/error-scrub.ts）读同一份样本 ─────────────────────────
import json as _json
from pathlib import Path as _Path

_SAMPLES = _json.loads((_Path(__file__).resolve().parents[2] / "shared" / "observability" / "scrub-samples.json")
                       .read_text("utf-8"))


@pytest.mark.parametrize("sample", _SAMPLES["texts"], ids=lambda s: s["text"][:30])
def test_the_shared_samples_are_scrubbed_the_same_way(sample):
    from services.error_reporting import _scrub_text
    out = _scrub_text(sample["text"])
    for secret in sample["secret"]:
        assert secret not in out, secret
    for keep in sample["keep"]:
        assert keep in out, keep


def test_the_shared_header_samples():
    headers = {k: f"value-of-{k}" for k in _SAMPLES["headers"]}
    out = scrub_event({"request": {"headers": headers}})["request"]["headers"]
    for key, kind in _SAMPLES["headers"].items():
        assert (out[key] == FILTERED) is (kind == "secret"), key
