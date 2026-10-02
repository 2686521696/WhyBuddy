"""控制面一发卡住：过了门槛补发一份，先回的算数，另一份真的掐断（control_client._hedged 头注）。

⚠ 2026-10-02 隔离真机第 182 / 183 轮：in 1 万 token、out 几十 token 的请求一发 305 秒、一发 603 秒——
  网关整 300 秒地卡，用户 5～10 分钟看不到动静。走真 call_control_llm + 真 httpx.AsyncClient，
  只把传输层换成会卡住的假网关（第一发挂着不回，第二发立刻回），门槛用环境变量调到 0.3 秒。

变异（逐条实测过）：
  call_control_llm 里不包 _hedged → 第一、四条红（等满卡住那一发；停止时没有第二份可掐）；
  finally 里不 cancel 剩下那份 → 第一、四条红（返回时卡住那一发还挂在网关上）；
  不看 charge_retry → 第三条红（回合重试预算用完还补发）。
"""

from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pytest

from sliderule_llm import control_client
from sliderule_llm.gateway_circuit import reset_gateway_circuit
from sliderule_llm.retry_budget import MAX_RETRIES_PER_TURN, RetryBudget, retry_budget_scope

STALL_S = 8.0


def _reply(text):
    return {"model": "fixture-model", "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10772, "completion_tokens": 68}}


@pytest.fixture
def gateway(monkeypatch):
    """第 n 发怎么回由 plan[n] 决定："stall" 挂着不回（被掐断要记下来），否则立刻回那句话。"""
    state = SimpleNamespace(plan=[], seen=[], aborted=[])

    async def handle(request):
        index = len(state.seen)
        state.seen.append(time.monotonic())
        step = state.plan[index] if index < len(state.plan) else "ok"
        if step == "stall":
            try:
                await asyncio.sleep(STALL_S)
            except asyncio.CancelledError:
                state.aborted.append(index)
                raise
            return httpx.Response(200, json=_reply("卡了很久才回"))
        return httpx.Response(200, json=_reply(step))

    original = httpx.AsyncClient
    monkeypatch.setattr(control_client.httpx, "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    monkeypatch.setattr(control_client, "get_llm_config", lambda: SimpleNamespace(
        api_key="fixture-key", base_url="https://gateway.invalid/v1", model="fixture-model", timeout_ms=60000))
    monkeypatch.setattr(control_client, "ensure_llm_proxy_bypass", lambda: None)
    monkeypatch.setenv("SLIDERULE_CONTROL_HEDGE_SECONDS", "0.3")
    reset_gateway_circuit()
    return state


def _call():
    return control_client.call_control_llm([{"role": "user", "content": "按已批准的计划执行"}], timeout_ms=60000)


def test_a_stalled_call_is_answered_by_the_hedge_and_the_stall_is_cut(gateway):
    gateway.plan = ["stall", "第二发回来了"]
    started = time.monotonic()

    async def run():
        result = await _call()
        # 在事件循环收尾之前看：asyncio.run 退出时会替我们取消剩下的任务，那不算数
        return result, list(gateway.aborted)

    result, aborted_on_return = asyncio.run(run())
    assert result.content == "第二发回来了"
    assert time.monotonic() - started < STALL_S / 2          # 没等满卡住那一发
    assert len(gateway.seen) == 2 and gateway.seen[1] - gateway.seen[0] >= 0.3
    assert aborted_on_return == [0]                          # 返回时卡住那一发已经掐断，不是留在后台烧


def test_a_normal_call_is_never_sent_twice(gateway):
    """反向：没卡就不补发——p99 135 秒以内的正常请求一份都不多花。"""
    gateway.plan = ["很快就回"]
    assert asyncio.run(_call()).content == "很快就回"
    assert len(gateway.seen) == 1


def test_no_hedge_once_the_turn_retry_budget_is_spent(gateway):
    """反向：补发记进回合重试预算；预算用完就老老实实等第一发。"""
    gateway.plan = ["stall"]

    async def run():
        with retry_budget_scope(RetryBudget(spent=MAX_RETRIES_PER_TURN)):
            return await _call()

    assert asyncio.run(run()).content == "卡了很久才回"
    assert len(gateway.seen) == 1


def test_stopping_the_turn_cuts_both(gateway):
    """取消穿透两份：用户点停止，卡住的和补发的都要在网关那头断掉。"""
    gateway.plan = ["stall", "stall"]

    async def run():
        task = asyncio.ensure_future(_call())
        await asyncio.sleep(0.6)                              # 已经补发
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return sorted(gateway.aborted)

    assert asyncio.run(run()) == [0, 1]
    assert len(gateway.seen) == 2
