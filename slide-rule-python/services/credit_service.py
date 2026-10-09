"""积分的装配：账本接到工程存储那个库上，计量器绑到「当前是谁在花钱」，以及开回合 / 开电脑之前的拦截。

⚠ 2026-10-09 积分制（services.credit_ledger 头注）。三处登记「谁在花钱」，缺一处那条路就是免费的：
  1. 每个 HTTP 请求：app 里的 CreditMeterMiddleware 挂 RequestMeter，登录用户由 optional_user 写进 request.state
     （依赖在线程池里跑，设 ContextVar 传不回端点，所以走请求状态、用到时再读——懒计量器）。
  2. 持久控制回合：调度器在后台执行，不在请求里——control_run_service 执行时显式 metered_for(owner)。
  3. 工程操作：工作器线程执行——project_runtime_worker 显式 metered_for(owner)，电脑时长在操作结束时 charge_computer。

失败处理分两边（CLAUDE.md 七）：
- 记账（record_*、charge_computer）是事后的账：账本挂了不许把一次已经成功的调用 / 操作变成失败 → fail-open，记日志。
- 拦截（gate、spend_block_reason）只在**确知**余额 ≤ 0 时拦；读不到余额（账本挂了）放行——额度是防超支的，
  不能因为账本坏了把所有人都关在门外。
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator, Mapping, Optional

from services.credit_ledger import CreditStore, CreditUnavailable
from services.credit_ledger import computer_quota, llm_quota, quota_to_points, usage_tokens
from sliderule_llm import usage_meter

logger = logging.getLogger(__name__)

#: request.state 上放登录用户的键（middlewares.current_user.optional_user 写）。
REQUEST_USER_KEY = "credit_user"
CREDIT_EXHAUSTED = "credit_exhausted"

_stores: dict[int, tuple[Any, CreditStore]] = {}
_store_lock = threading.Lock()

# 库和身份由入口注入（app.py 启动时 configure）。⚠ 2026-10-10：第一版直接 import project_store / identity_store，
#   本模块就只能进 flow 层，而 flow 只许变短（test_architecture 钉着）。注入以后这里只依赖叶子 credit_ledger，进 core。
#   没注入（脚本、单测）：拿不到全局库 → 账本读不到 → 记账跳过、拦截放行（模块头的 fail-open）；查不到身份 → 当普通账号。
_project_store_provider: Optional[Callable[[], Any]] = None
_superuser_lookup: Optional[Callable[[str], bool]] = None


def configure(*, project_store_provider: Callable[[], Any], superuser_lookup: Callable[[str], bool]) -> None:
    global _project_store_provider, _superuser_lookup
    _project_store_provider, _superuser_lookup = project_store_provider, superuser_lookup


def configured() -> bool:
    return _project_store_provider is not None and _superuser_lookup is not None


def get_credit_store(project_store: Any = None) -> CreditStore:
    """跟工程存储同一个库（控制回合表也是这么接的）。调用方手里有工程存储（工作器、控制回合服务）就用它那一个，
    账和工程数据永远在同一个库；没有就用全局的那个。"""
    if project_store is None:
        if _project_store_provider is None:
            raise CreditUnavailable("credit_store_not_configured")
        project_store = _project_store_provider()
    with _store_lock:
        cached = _stores.get(id(project_store))
        if cached is not None and cached[0] is project_store:
            return cached[1]
        store = CreditStore(project_store._q, dialect=getattr(project_store, "_dialect", "sqlite"))
        if len(_stores) > 16:
            _stores.clear()
        _stores[id(project_store)] = (project_store, store)
        return store


def reset_credit_store() -> None:
    with _store_lock:
        _stores.clear()


def exhausted_text(quota: int, *, stopping: bool) -> str:
    points = quota_to_points(quota)
    shown = f"{points:g}" if points != int(points) else str(int(points))   # 0.0 → 0（本地真跑截图里是「0.0 积分」）
    head = f"额度已用完（当前余额 {shown} 积分）"
    tail = "，本轮已停止，已保存现有结果。" if stopping else "，这一轮没有开始。"
    return head + tail + "请在左下角账号菜单的「额度」里输入兑换码充值，或联系管理员加额度。"


def _is_superuser(user: Any) -> bool:
    if isinstance(user, Mapping):
        return bool(user.get("is_superuser"))
    return bool(getattr(user, "is_superuser", False))


def _user_id(user: Any) -> str:
    value = user.get("id") if isinstance(user, Mapping) else getattr(user, "id", None)
    return str(value or "").strip()


_superuser_cache: dict[str, tuple[float, bool]] = {}


def _owner_is_superuser(owner_id: str) -> bool:
    """后台执行只有 owner_id：查身份库，缓存 60 秒。查不到当普通账号。"""
    cached = _superuser_cache.get(owner_id)
    if cached and time.monotonic() - cached[0] < 60:
        return cached[1]
    try:
        flag = bool(_superuser_lookup(owner_id)) if _superuser_lookup is not None else False
    except Exception:  # noqa: BLE001 — 身份库查不动当普通账号（照样计费、照样拦）
        flag = False
    _superuser_cache[owner_id] = (time.monotonic(), flag)
    return flag


def spend_block_reason(owner_id: str, *, superuser: bool = False, stopping: bool = False,
                       project_store: Any = None) -> Optional[str]:
    """该拦就返回给用户看的一句话，不拦返回 None。读不到账本放行（模块头）。"""
    owner_id = str(owner_id or "").strip()
    if not owner_id:
        return None
    try:
        store = get_credit_store(project_store)
        options = store.options()
        if not options["enforcement_enabled"] or (superuser and options["superuser_exempt"]):
            return None
        quota = store.account(owner_id)["quota"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("credit check skipped (ledger unavailable): %s", type(exc).__name__)
        return None
    return exhausted_text(quota, stopping=stopping) if quota <= 0 else None


class CreditExhaustedError(ValueError):
    """额度用完、不许开新的工程操作。str 是机器码 credit_exhausted；hint 给模型看（project_tools 照 hint 回执）。"""

    def __init__(self, text: str):
        super().__init__(CREDIT_EXHAUSTED)
        self.text = text
        self.hint = ("这个账号的额度已经用完，平台不再为它开电脑或调用模型。这不是代码问题，重试、换命令都没有用。"
                     "停下手里的步骤，如实告诉用户：" + text)


def exhausted_detail(text: str) -> dict[str, str]:
    """HTTP 402 的 detail：前端认 code，照原话显示 message。"""
    return {"code": CREDIT_EXHAUSTED, "message": text}


def owner_is_superuser(owner_id: str) -> bool:
    return _owner_is_superuser(str(owner_id or "").strip())


def require_credit(owner_id: str, *, superuser: Optional[bool] = None, stopping: bool = False,
                   project_store: Any = None) -> None:
    """额度用完就抛 CreditExhaustedError。开工程操作、开控制回合之前调。"""
    flag = owner_is_superuser(owner_id) if superuser is None else bool(superuser)
    block = spend_block_reason(owner_id, superuser=flag, stopping=stopping, project_store=project_store)
    if block:
        raise CreditExhaustedError(block)


def record_llm(owner_id: str, model: str, usage: Mapping[str, Any] | None, *, project_store: Any = None) -> None:
    try:
        store = get_credit_store(project_store)
        quota = llm_quota(model, usage, store.options())
        if quota > 0:
            store.consume(owner_id, quota, model=model, tokens=usage_tokens(usage))
    except Exception as exc:  # noqa: BLE001 — 记账失败不许拖垮已经成功的调用
        logger.warning("credit record failed (llm %s): %s", model, type(exc).__name__)


def record_image(owner_id: str, model: str, *, project_store: Any = None) -> None:
    try:
        store = get_credit_store(project_store)
        quota = int(store.options()["image_quota"])
        if quota > 0:
            store.consume(owner_id, quota, model=model or "image", note="生图 1 张")
    except Exception as exc:  # noqa: BLE001
        logger.warning("credit record failed (image): %s", type(exc).__name__)


def charge_computer(owner_id: str, seconds: float, *, ref: str, project_store: Any = None) -> None:
    """一个工程操作用了 seconds 秒电脑。ref = 操作号：同一个操作结算两次只扣一次。"""
    try:
        store = get_credit_store(project_store)
        quota = computer_quota(seconds, store.options())
        if quota > 0:
            store.consume(owner_id, quota, seconds=round(float(seconds), 1), ref="computer:" + ref,
                          note=f"工程电脑 {max(1, round(seconds / 60))} 分钟")
    except Exception as exc:  # noqa: BLE001
        logger.warning("credit record failed (computer %s): %s", ref, type(exc).__name__)


class OwnerMeter:
    """后台执行用：花的是 owner_id 的钱。"""

    def __init__(self, owner_id: str, *, superuser: Optional[bool] = None, project_store: Any = None):
        self.owner_id = str(owner_id)
        self._superuser = superuser
        self.project_store = project_store

    @property
    def superuser(self) -> bool:
        if self._superuser is None:
            self._superuser = _owner_is_superuser(self.owner_id)
        return self._superuser

    def gate(self) -> Optional[str]:
        return spend_block_reason(self.owner_id, superuser=self.superuser, stopping=True,
                                  project_store=self.project_store)

    def record_llm(self, model: str, usage: Mapping[str, Any] | None) -> None:
        record_llm(self.owner_id, model, usage, project_store=self.project_store)

    def record_image(self, model: str) -> None:
        record_image(self.owner_id, model, project_store=self.project_store)


class RequestMeter:
    """HTTP 请求用：登录用户在依赖里解析出来以后才写进请求状态，所以每次用到时再读（模块头 1）。"""

    def __init__(self, state: dict):
        self._state = state

    def _user(self) -> Any:
        return self._state.get(REQUEST_USER_KEY)

    def gate(self) -> Optional[str]:
        user = self._user()
        if user is None or not _user_id(user):
            return None
        return spend_block_reason(_user_id(user), superuser=_is_superuser(user), stopping=True)

    def record_llm(self, model: str, usage: Mapping[str, Any] | None) -> None:
        user = self._user()
        if user is not None and _user_id(user):
            record_llm(_user_id(user), model, usage)

    def record_image(self, model: str) -> None:
        user = self._user()
        if user is not None and _user_id(user):
            record_image(_user_id(user), model)


@contextmanager
def metered_for(owner_id: str, *, project_store: Any = None) -> Iterator[None]:
    """这一段里的模型 / 生图调用花 owner_id 的钱、受 owner_id 的额度拦。"""
    owner_id = str(owner_id or "").strip()
    if not owner_id:
        yield
        return
    with usage_meter.metered(OwnerMeter(owner_id, project_store=project_store)):
        yield


class CreditMeterMiddleware:
    """纯 ASGI：每个 HTTP 请求挂一个 RequestMeter。流式响应的生成器也在这一层里跑完，上下文一路带到底。"""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        state = scope.setdefault("state", {})
        with usage_meter.metered(RequestMeter(state)):
            await self.app(scope, receive, send)


def account_view(account: Mapping[str, Any]) -> dict[str, Any]:
    """给前端：额度原值 + 换算好的积分。"""
    return {**account, "points": quota_to_points(account["quota"]),
            "usedPoints": quota_to_points(account["usedQuota"])}


__all__ = [
    "configure", "configured", "CREDIT_EXHAUSTED", "CreditExhaustedError", "exhausted_detail", "CreditMeterMiddleware", "owner_is_superuser", "require_credit", "CreditUnavailable", "OwnerMeter", "REQUEST_USER_KEY",
    "RequestMeter", "account_view", "charge_computer", "exhausted_text", "get_credit_store", "metered_for",
    "record_image", "record_llm", "reset_credit_store", "spend_block_reason",
]
