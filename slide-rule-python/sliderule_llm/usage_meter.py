"""计量出口：模型 / 生图每真打一次服务商，就把「谁、哪个模型、用了多少」交给当前上下文里登记的计量器。

⚠ 2026-10-09 积分制（services.credit_ledger 头注）。真打服务商的地方只有四处：client._call_llm_once、
  client._call_llm_once_streaming、control_client._call_control_llm_once、image_client.generate_image_png——
  四处各报一次，tests/test_credits.py 逐个钉着（漏一处就是那条路免费）。

为什么不复用 client.result_hook：那个钩子一次只能挂一个，services.cost_ledger（老流水线按会话记用量）已经挂在上面，
  再挂会把它顶掉；而且它挂在 _finalize_result，拿到的用量已经归一化、缓存命中那一项丢了，控制面那条路也不经过它。

本包不许依赖 services（architecture.toml），所以这里只定义出口；账记在哪、额度够不够，由 services.credit_service
  用 metered(...) 在每次回合 / 工程操作开始时登记。没登记（脚本、系统任务）就什么都不做。

两件事、两种失败处理（CLAUDE.md 七）：
- report：记账自己炸了不许拖垮这次调用（钱已经花了，回答照给）→ 吞掉，交给计量器自己上报。
- gate：额度用完要真拦下，抛 CreditExhausted；计量器读余额时自己炸了由它决定放行（不因账本故障停掉所有人）。
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator, Mapping, Optional, Protocol


class CreditExhausted(Exception):
    """额度用完。消息是给用户看的人话；调用方把它包成不可重试的 LlmError。"""


class Meter(Protocol):
    def gate(self) -> Optional[str]:
        """返回 None 放行；返回一句人话表示额度用完、这一次不许打。"""

    def record_llm(self, model: str, usage: Mapping[str, Any] | None) -> None: ...

    def record_image(self, model: str) -> None: ...


_meter_var: ContextVar[Optional[Meter]] = ContextVar("sliderule_llm_usage_meter", default=None)


@contextmanager
def metered(meter: Meter) -> Iterator[None]:
    token = _meter_var.set(meter)
    try:
        yield
    finally:
        _meter_var.reset(token)


def current() -> Optional[Meter]:
    return _meter_var.get()


def gate() -> None:
    """打服务商之前调。额度用完抛 CreditExhausted；没登记计量器放行。"""
    meter = _meter_var.get()
    if meter is None:
        return
    blocked = meter.gate()
    if blocked:
        raise CreditExhausted(blocked)


def report_llm(model: str, usage: Mapping[str, Any] | None) -> None:
    meter = _meter_var.get()
    if meter is None:
        return
    try:
        meter.record_llm(str(model or ""), usage if isinstance(usage, Mapping) else None)
    except Exception:  # noqa: BLE001 — 记账失败不许拖垮已经成功的调用
        pass


def report_image(model: str) -> None:
    meter = _meter_var.get()
    if meter is None:
        return
    try:
        meter.record_image(str(model or ""))
    except Exception:  # noqa: BLE001
        pass
