"""错误上报：ERROR 日志（含 log.exception 的调用栈）成为一个事件，带会话号，出这台机器之前脱敏；没配就什么都不做。

⚠ 2026-10-08 同一天四次真机故障，真正的报错都只打在出事那台机器的控制台里（services/error_reporting 头注）。
走真的 sentry-sdk：transport 换成只在内存里收事件的，什么都不发出去。日志器名和那句话照产线原样
（control_run_service 里的 `log.exception("control producer failed")`）。
"""

from __future__ import annotations

import asyncio
import logging
import sys

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
        self.logs = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.type == "event":
                self.events.append(item.payload.json)
            elif item.type == "log":
                self.logs.extend(item.payload.json["items"])


@pytest.fixture
def inbox(monkeypatch):
    box = _Inbox()
    real_init = sentry_sdk.init
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: real_init(transport=box, **kw))
    stdout = sys.stdout
    yield box
    sys.stdout = stdout                                              # 转发器包过的 stdout 换回来
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


# ── 「执行到一半断了」也要收得到：ControlRunStopped 收场原来一行 ERROR 都没有 ─────────────────────
# ⚠ 2026-10-08 用户本机执行轮 ctr-6da33921cb525b04ae9454ba46caaede：interrupted / control_run_access_revoked，
#   只写进库（control_run_service._report_abnormal_run_end 头注）。

def test_an_interrupted_run_becomes_its_own_issue_with_the_session(inbox):
    from services.control_run_service import _report_abnormal_run_end
    init_error_reporting("python", env={"SENTRY_DSN": DSN})
    with reporting_scope(session_id="sr-20261008092556-8PW0MNC7ZW"):
        _report_abnormal_run_end("ctr-6da33921cb525b04ae9454ba46caaede", "interrupted", "control_run_access_revoked")
        _report_abnormal_run_end("ctr-x", "failed", "llm_unavailable")
    _flush()
    by_template = {e["logentry"]["message"]: e for e in inbox.events}
    revoked = by_template["control run interrupted: control_run_access_revoked (run=%s)"]     # 码在模板里 → 自成一条问题
    assert revoked["tags"]["session_id"] == "sr-20261008092556-8PW0MNC7ZW"
    assert "control run failed: llm_unavailable (run=%s)" in by_template


@pytest.mark.parametrize("status,error", [("cancelled", "control_cancelled"), ("interrupted", "control_worker_shutdown"),
                                          ("interrupted", "control_producer_failed"), ("interrupted", "control_lease_lost"),
                                          ("completed", None), ("waiting_user", None)])
def test_ordinary_ends_are_not_issues(inbox, status, error):
    """反向：用户自己停的、正常关停、已经带调用栈报过的、换 worker 接着跑的、正常结束的——都不成问题。"""
    from services.control_run_service import _report_abnormal_run_end
    init_error_reporting("python", env={"SENTRY_DSN": DSN})
    _report_abnormal_run_end("ctr-x", status, error)
    _flush()
    assert inbox.events == []


def test_both_exits_are_wired():
    """§三：控制回合的唯一出口（finally）真的调到；工程操作的平台异常那支真的打 ERROR。"""
    import inspect

    from services import control_run_service, project_runtime_worker
    src = inspect.getsource(control_run_service.ControlRunService._produce)
    finally_at = src.index("        finally:\n            current_checkpoint.reset(token)")
    assert src.index("_report_abnormal_run_end(run_id, status, error)") > finally_at
    worker = inspect.getsource(project_runtime_worker.ProjectRuntimeSupervisor)
    branch = worker[worker.index("                except Exception as exc:\n                    code = str(exc)"):]
    assert 'logger.error(f"project operation {original.kind} failed' in branch[:600]


# ── 执行过程（Sentry Logs）：推演轨迹是 print("[control] …")，不是 logging ──────────────────────────
# ⚠ 2026-10-08 方案 A：错误只说「哪儿炸了」，说不了「炸之前在干什么」（services/error_reporting 头注）。
#   下面那行照抄真机控制台（services/action_stationarity 头注里记的那一段）。

REAL_LINE = "[control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']"


def _attr(log, key):
    return (log["attributes"].get(key) or {}).get("value")


def test_a_traced_line_reaches_logs_with_its_session_and_still_hits_the_console(inbox, capsys):
    init_error_reporting("python", env={"SENTRY_DSN": DSN, "SLIDERULE_WORKER_POOL": "dev-DESKTOP-57LOSN8-8374d0ee"})
    with reporting_scope(run_id="ctr-a45b", session_id="sr-20261008092556-8PW0MNC7ZW"):
        print(REAL_LINE, flush=True)
    _flush()
    [log] = [entry for entry in inbox.logs if entry["body"] == REAL_LINE]
    assert _attr(log, "session_id") == "sr-20261008092556-8PW0MNC7ZW" and _attr(log, "run_id") == "ctr-a45b"
    assert _attr(log, "log.tag") == "control" and _attr(log, "service") == "python"
    assert _attr(log, "worker_pool") == "dev-DESKTOP-57LOSN8-8374d0ee"
    assert REAL_LINE in capsys.readouterr().out                                  # 控制台那份一个字不少
    assert inbox.events == []                                                    # 日志不是问题


def test_untagged_prints_stay_on_the_console(inbox):
    """反向：没有 [标签] 的 print（调试残留、第三方库）不抄。"""
    init_error_reporting("python", env={"SENTRY_DSN": DSN})
    print("Uvicorn running on http://0.0.0.0:9700", flush=True)
    _flush()
    assert inbox.logs == []


def test_a_secret_in_a_traced_line_is_scrubbed(inbox):
    init_error_reporting("python", env={"SENTRY_DSN": DSN})
    print("[identity] lookup via postgresql://neondb_owner:p4ss@ep-x.neon.tech/neondb token=abc123secret", flush=True)
    _flush()
    text = repr(inbox.logs)
    assert inbox.logs and "p4ss" not in text and "abc123secret" not in text and FILTERED in text


def test_a_warning_is_a_log_line_not_an_issue(inbox):
    """WARNING 起的 logging 记录走官方集成进 Logs（「keeping run」这种自愈记录正是执行过程）。"""
    init_error_reporting("python", env={"SENTRY_DSN": DSN})
    with reporting_scope(session_id="sr-x"):
        PRODUCER.warning("control authority lookup unavailable (3s so far), keeping run")
    _flush()
    [log] = inbox.logs
    assert log["level"] == "warn" and _attr(log, "session_id") == "sr-x"
    assert inbox.events == []


def test_two_runs_at_once_keep_their_own_session_in_logs(inbox):
    init_error_reporting("python", env={"SENTRY_DSN": DSN})

    async def run(sid, delay):
        with reporting_scope(session_id=sid):
            await asyncio.sleep(delay)
            print(f"[control] round=1 run={sid}", flush=True)

    async def both():
        await asyncio.gather(run("sr-A", 0.02), run("sr-B", 0.0))
    asyncio.run(both())
    _flush()
    assert sorted((_attr(e, "session_id"), e["body"].endswith(_attr(e, "session_id"))) for e in inbox.logs) \
        == [("sr-A", True), ("sr-B", True)]


@pytest.mark.parametrize("level,prints,warnings", [("off", 0, 0), ("warning", 0, 1), ("info", 1, 1)])
def test_the_logs_level_switch(inbox, level, prints, warnings):
    init_error_reporting("python", env={"SENTRY_DSN": DSN, "SENTRY_LOGS_LEVEL": level})
    print(REAL_LINE, flush=True)
    PRODUCER.warning("keeping run")
    _flush()
    assert sum(e["body"] == REAL_LINE for e in inbox.logs) == prints
    assert sum(e["body"] == "keeping run" for e in inbox.logs) == warnings
    assert isinstance(sys.stdout, error_reporting._StdoutForwarder) is (level == "info")


def test_a_broken_forwarder_never_eats_the_console(capsys):
    """增强类：转发炸了，控制台照旧。"""
    def boom(line, tag):
        raise RuntimeError("sentry down")
    out = error_reporting._StdoutForwarder(sys.stdout, boom)
    print(REAL_LINE, file=out, flush=True)
    assert REAL_LINE in capsys.readouterr().out


def test_without_a_dsn_stdout_is_untouched(inbox):
    before = sys.stdout
    init_error_reporting("python", env={})
    assert sys.stdout is before
