"""错误上报（Sentry）：报错带完整调用栈、哪台机器、哪个版本、哪个会话，集中到一处看。

⚠ 2026-10-08 为什么要它：同一天四次真机故障——Windows 本机缺时区库每一回合 control_producer_failed、
  身份库抖动被当成吊销掐掉预览、存检查点一次失败就中断、采样期间权限确认把查不到当吊销——
  每一次真正的报错都只打在出事那台机器的控制台里（`log.exception("control producer failed")`），
  排查只能从数据库里的运行记录倒推，有两次得先在另一台机器上复现。接上之后 ERROR 级日志（含 log.exception
  的调用栈）自动成为一个事件，按 environment / server_name / worker_pool / session_id 能筛。

执行过程（Sentry Logs，照官方写法 enable_logs + LoggingIntegration(sentry_logs_level) + before_send_log）：
  报错只说「哪儿炸了」，说不了「炸之前在干什么」。推演的执行轨迹几乎全是 `print("[control] …")`
  （54 个文件用 print、16 个用 logging，而且没人配过 logging，INFO 级的 logging 记录在 WARNING 那道门就丢了）。
  所以两路：WARNING 起的 logging 记录走官方集成；行首带 `[标签]` 的 print 行由 _StdoutForwarder 照抄一份进
  Sentry Logs（控制台照旧先写，一个字不少）。两路都带 reporting_scope 里的 run_id / session_id，按会话能捞出一整段。
  SENTRY_LOGS_LEVEL：info（默认，两路都开）/ warning（只有 logging 那一路）/ off。

增强类（CLAUDE.md §七 fail-open）：没配 SENTRY_DSN 就什么都不做；sentry-sdk 没装、初始化抛错，都只记一行、照常启动。
上报前脱敏（scrub_event）：cookie、鉴权头、内部 key、数据库连接串、API key 形状的串一律换成 [Filtered]。
宁可多剥：上报的东西出了这台机器就收不回来。

叶子：只 import 标准库和 sentry_sdk（函数体里），不依赖 services 里任何模块。
"""

from __future__ import annotations

import contextlib
import logging
import os
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Iterator, Mapping, Optional

log = logging.getLogger(__name__)

FILTERED = "[Filtered]"

#: 头、cookie、表单字段名里出现这些就整值剥掉（小写比较）。
_SENSITIVE_KEYS = ("authorization", "cookie", "x-internal-key", "internal-key", "api-key", "apikey", "x-api-key",
                   "token", "secret", "password", "passwd", "dsn", "credential", "private")
#: ⚠ 不放 "session"：session_id 是按会话搜报错的标签，不是秘密；会话凭据在 cookie 里，cookie 整个剥掉了。

#: 任何字符串里出现这些形状就换掉那一段（异常信息、日志正文、面包屑都过一遍）。
_SECRET_PATTERNS = (
    re.compile(r"\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s'\"]+", re.IGNORECASE),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE),
    re.compile(r"\b(?:sk|pk|rk|xai|gsk|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{16,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),            # JWT
    re.compile(r"(?i)\b(password|passwd|secret|api[_-]?key|token)\s*[=:]\s*[^\s,;&'\"]+"),
)

_MAX_DEPTH = 12


def _scrub_text(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(FILTERED, text)
    return text


def _sensitive_key(key: Any) -> bool:
    lowered = str(key).lower()
    return any(word in lowered for word in _SENSITIVE_KEYS)


def _scrub(value: Any, depth: int = 0) -> Any:
    if depth > _MAX_DEPTH:
        return value
    if isinstance(value, str):
        return _scrub_text(value)
    if isinstance(value, Mapping):
        return {k: (FILTERED if _sensitive_key(k) and v not in (None, "", [], {}) else _scrub(v, depth + 1))
                for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v, depth + 1) for v in value]
    if isinstance(value, tuple):
        return tuple(_scrub(v, depth + 1) for v in value)
    return value


def scrub_event(event: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """Sentry before_send / before_send_transaction：整份事件过一遍脱敏。脱敏自己炸了就**不发**（宁缺）。"""
    try:
        request = event.get("request")
        if isinstance(request, dict):
            request.pop("cookies", None)
            request.pop("data", None)                       # 请求体：用户原话、上传内容，不出这台机器
        return _scrub(event)
    except Exception:  # noqa: BLE001
        return None


def _scrub_breadcrumb(crumb: dict, hint: Optional[dict] = None) -> Optional[dict]:
    try:
        return _scrub(crumb)
    except Exception:  # noqa: BLE001
        return None


def scrub_log(log: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """Sentry before_send_log：正文和属性同一套脱敏。脱敏自己炸了就**不发**。"""
    try:
        return _scrub(log)
    except Exception:  # noqa: BLE001
        return None


def _logs_level(env: Mapping[str, str]) -> str:
    level = (env.get("SENTRY_LOGS_LEVEL") or "info").strip().lower()
    return level if level in ("info", "warning", "off") else "info"


#: 行首的 `[标签]`：`[control] goal=…`、`[skills] …`、`[project] …`。没有标签的 print（调试残留、第三方）不收。
_TAGGED_LINE = re.compile(r"^\[([A-Za-z0-9_.:-]{1,40})\]\s?")
_MAX_LOG_LINE = 2000


class _StdoutForwarder:
    """包住 sys.stdout：先原样写给控制台，再把带标签的整行抄进 Sentry Logs。

    增强类：转发出任何错都吞掉，控制台那一份已经写完了。print 是先写正文再写换行，两次 write 之间
    没有 await，所以按线程攒半行就不会串；转发途中再 print（SDK 自己的输出）直接放过，不递归。
    """

    def __init__(self, inner, emit):
        self._inner = inner
        self._emit = emit
        self._local = threading.local()

    def write(self, text):
        written = self._inner.write(text)
        try:
            self._forward(text)
        except Exception:  # noqa: BLE001
            pass
        return written

    def _forward(self, text):
        local = self._local
        if getattr(local, "busy", False) or not isinstance(text, str):
            return
        pending = getattr(local, "pending", "") + text
        *lines, rest = pending.split("\n")
        local.pending = rest[-_MAX_LOG_LINE:]
        local.busy = True
        try:
            for line in lines:
                match = _TAGGED_LINE.match(line)
                if match:
                    self._emit(line[:_MAX_LOG_LINE], match.group(1))
        finally:
            local.busy = False

    def __getattr__(self, name):                      # flush / fileno / isatty / encoding … 原样转给里面那个
        return getattr(self._inner, name)


class OutageLog:
    """后台轮询循环（每一两秒扫一次）的失败：按「出事 / 持续 / 恢复」三个时刻各记一次，不按每一跳记。

    ⚠ 2026-10-08 接上 Sentry 后头一条真问题：用户本机（DESKTOP-57LOSN8）连共享库的网关 TLS 断了 36 秒
      （SSL: UNEXPECTED_EOF），控制回合的扫描循环每 1.5 秒 log.exception 一次——25 个事件，自己好了。
      断 30 分钟就是一千多个，一次事故吃掉免费额度（每月 5000）的四分之一。成对的另一处（工程运行时的扫描循环）
      正好相反：每一跳一行 WARNING、不带调用栈，断一整天 Sentry 里也不会有一条问题。两处同一个病：没区分「抖一下」
      和「真断了」。
    现在：头一次失败记 WARNING（进日志和面包屑，不成问题）；连着失败超过 escalate_after 秒（跟控制回合
    「身份库抖一下不算吊销」同一个 60 秒）才记**一次** ERROR，带调用栈，成一条问题；恢复时记一行用了多久。
    不是线程安全的：一个循环一个实例，只在那个循环里调。
    """

    def __init__(self, logger, what: str, *, escalate_after: float = 60.0, clock=None):
        self._log, self._what, self._after = logger, what, escalate_after
        self._clock = clock or (lambda: time.monotonic())             # 调用时才取：判据能拨钟
        self.since: Optional[float] = None
        self.failures = 0
        self.escalated = False

    def failed(self, exc: BaseException) -> None:
        now = self._clock()
        if self.since is None:
            self.since, self.failures, self.escalated = now, 0, False
            self._log.warning("%s unavailable: %s: %s", self._what, type(exc).__name__, str(exc)[:200])
        self.failures += 1
        if not self.escalated and now - self.since >= self._after:
            self.escalated = True
            self._log.error("%s unavailable for over %ds", self._what, int(self._after), exc_info=exc)

    def ok(self) -> None:
        if self.since is None:
            return
        level = logging.WARNING if self.escalated else logging.INFO
        self._log.log(level, "%s recovered after %.0fs (%d failed scans)", self._what,
                      self._clock() - self.since, self.failures)
        self.since, self.failures, self.escalated = None, 0, False


def _emit_tagged_line(line: str, tag: str) -> None:
    import sentry_sdk
    sentry_sdk.logger.info(line, attributes={"log.tag": tag})


def _install_stdout_forwarder() -> None:
    if not isinstance(sys.stdout, _StdoutForwarder):
        sys.stdout = _StdoutForwarder(sys.stdout, _emit_tagged_line)


def _environment(env: Mapping[str, str]) -> str:
    explicit = (env.get("SENTRY_ENVIRONMENT") or "").strip()
    if explicit:
        return explicit
    mode = (env.get("NODE_ENV") or env.get("APP_ENV") or "").strip().lower()
    return "production" if mode in ("production", "prod") else "development"


def _release(env: Mapping[str, str]) -> Optional[str]:
    for name in ("SENTRY_RELEASE", "GIT_SHA", "SOURCE_COMMIT"):
        value = (env.get(name) or "").strip()
        if value:
            return value
    try:  # 本机开发：仓库在手边就取当前提交，报错对得上是哪一版代码
        out = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], cwd=Path(__file__).resolve().parents[2],
                             capture_output=True, text=True, timeout=3)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except Exception:  # noqa: BLE001
        return None


def _sample_rate(env: Mapping[str, str]) -> float:
    try:
        return min(1.0, max(0.0, float(env.get("SENTRY_TRACES_SAMPLE_RATE") or 0)))
    except ValueError:
        return 0.0


_active = False


def is_active() -> bool:
    return _active


def init_error_reporting(service: str, env: Optional[Mapping[str, str]] = None) -> bool:
    """进程启动时调一次。返回是否真的接上了。没配 DSN / 没装包 / 初始化失败都返回 False，不抛。"""
    global _active
    env = os.environ if env is None else env
    dsn = (env.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration
    except Exception:  # noqa: BLE001
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed; error reporting stays off")
        return False
    logs = _logs_level(env)
    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=_environment(env),
            release=_release(env),
            server_name=socket.gethostname(),
            send_default_pii=False,
            traces_sample_rate=_sample_rate(env),
            # WARNING 起进面包屑（事故前后发生了什么），ERROR 起成事件——log.exception 就是 ERROR，带调用栈。
            # WARNING 起同时进 Sentry Logs（执行过程那一路，见头注）。
            integrations=[LoggingIntegration(level=logging.WARNING, event_level=logging.ERROR,
                                             sentry_logs_level=None if logs == "off" else logging.WARNING)],
            enable_logs=logs != "off",
            before_send_log=scrub_log,
            before_send=scrub_event,
            before_send_transaction=scrub_event,
            before_breadcrumb=_scrub_breadcrumb,
            max_request_body_size="never",
        )
        sentry_sdk.set_tag("service", service)
        pool = (env.get("SLIDERULE_WORKER_POOL") or "").strip()
        if pool:
            sentry_sdk.set_tag("worker_pool", pool)
        # 日志不吃 tag，吃 attribute：同样两项挂成全局属性，Logs 里也能按服务 / 机器筛。
        sentry_sdk.get_global_scope().set_attribute("service", service)
        if pool:
            sentry_sdk.get_global_scope().set_attribute("worker_pool", pool)
        if logs == "info":
            _install_stdout_forwarder()
    except Exception:  # noqa: BLE001
        log.warning("error reporting init failed; continuing without it", exc_info=True)
        return False
    _active = True
    return True


@contextlib.contextmanager
def reporting_scope(**tags: Any) -> Iterator[None]:
    """这一段里的报错都带上这些标签（run_id、session_id、operation_id……）。没接上就是空操作。

    用的是 isolation_scope：并发跑的几条控制回合各带各的会话号，不会串。
    """
    if not _active:
        yield
        return
    try:
        import sentry_sdk
        scope_cm = sentry_sdk.isolation_scope()
    except Exception:  # noqa: BLE001
        yield
        return
    with scope_cm as scope:
        for key, value in tags.items():
            if value not in (None, ""):
                scope.set_tag(key, str(value)[:200])
                scope.set_attribute(key, str(value)[:200])       # 同一个会话号也挂到这一段的每一行日志上
        yield
