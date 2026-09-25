"""控制面的同步重活不许坐在事件循环上。

2026-08-27 评审：`call_control_llm` 是**同步** httpx（超时最长 45s），
`save_session` 在这台机器上是一次同步 HTTPS SQL 调用，两者都直接在 async
SSE 生成器里调。单人开发看不出来——**两个人同时推演就互相卡**：对方的流
一个字都不出，看起来像"服务挂了"。

判据是**真并发**：两条控制面流一起发，两次阻塞调用的区间必须重叠。
不数调用次数、不 grep 源码里有没有 run_in_threadpool——那两种写法把
`run_in_threadpool` 写进注释就能养绿。

⚠ 夹具里的 LLM 用 `time.sleep`（**阻塞**）而不是 `asyncio.sleep`：要复现的
  正是"同步调用"这件事。换成 asyncio.sleep 的话，不管有没有挪出事件循环
  都会并发，判据直接打空。
"""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest

from control_turn_support import (
    KEY,
    CONTROL_URL,
    ControlHarness,
    llm_text,
    new_sid,
    seed_session,
    six_fields,
)
from app import app

pytest.importorskip("fastapi")

BLOCK_S = 0.6


@pytest.fixture
def harness(monkeypatch):
    h = ControlHarness(monkeypatch)
    h.llm_spans = []

    def slow_blocking_llm(messages, **kwargs):
        started = time.monotonic()
        time.sleep(BLOCK_S)
        h.llm_spans.append((started, time.monotonic()))
        return llm_text("想好了")

    h.llm_impl = slow_blocking_llm
    return h


def _post_twice() -> float:
    sid_a = new_sid("loop-a")
    sid_b = new_sid("loop-b")
    for sid in (sid_a, sid_b):
        seed_session(sid, goal={"text": "请假系统", "status": "clear"})

    async def run() -> float:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test", timeout=30.0
        ) as client:
            started = time.monotonic()
            await asyncio.gather(
                client.post(CONTROL_URL, json=six_fields(sid_a, "聊两句"), headers=KEY),
                client.post(CONTROL_URL, json=six_fields(sid_b, "聊两句"), headers=KEY),
            )
            return time.monotonic() - started

    return asyncio.run(run())


def test_two_streams_do_not_serialize_on_the_blocking_llm(harness):
    """两次阻塞 LLM 调用必须**同时在跑**。

    ⚠ 2026-09-25：上一版量的是两条流的总墙钟（< 1.7×BLOCK_S）。单独跑这个
      文件时进程是冷的，第一发请求进 LLM 之前要 0.45s 初始化，总墙钟 1.06s
      超线——而探针显示两次调用都在 0.45s 开始、1.05s 结束，完全重叠。
      全量里进程已热才碰巧绿；main 上单独跑一直红。冷启动开销不是本条要测
      的东西，所以直接量「两段调用区间重叠」：同步调用坐在事件循环上时，
      第二次要等第一次返回才开始，区间不相交。
    """
    _post_twice()
    spans = sorted(harness.llm_spans)
    assert len(spans) == 2, spans
    (first_start, first_end), (second_start, _second_end) = spans
    overlap = first_end - second_start
    assert overlap > BLOCK_S * 0.5, (
        f"两次 LLM 调用几乎没有重叠（{overlap:.2f}s）：第二次在第一次结束后才开始。"
        "同步调用还坐在事件循环上——第二个人的推演要等第一个人跑完。"
    )


def test_the_fixture_itself_really_blocks(harness):
    """反向：确认夹具真的是**阻塞**的。

    这条防的是判据自己打空：哪天有人把 time.sleep 改成 asyncio.sleep，
    上面那条会永远绿（不管有没有挪出事件循环），而它本来该测的东西没了。
    """
    started = time.monotonic()
    harness.llm_impl([], tools=None)
    assert time.monotonic() - started >= BLOCK_S * 0.8
