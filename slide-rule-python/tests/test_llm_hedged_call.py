"""慢请求对冲（2026-08-04）——治的是"没失败但很慢"，重试治不了它。

## 为什么加

真机日志（社区消防巡检那次，6 轮 6.4 分钟）：同一个能力自己跟自己差 3~6 倍——

    critique.generate   74.8s（loop-1）  vs  22.6s（loop-4）
    synthesis.merge     69.0s（loop-2）  vs  11.3s（loop-1）

这类请求**从不报错**，所以 max_attempts 那套重试一次都不会触发；它只是排在
网关队列后面。而这两条离群值吃掉 143.8s，占全部能力时间的 41%。

## 语义照抄 gRPC hedgingPolicy

只对冲一次、谁先回用谁、副本失败不算数。三条各一个用例；另外钉住"没超时的
正常请求走的还是老路径"——对冲不该给正常请求加任何开销。
"""

import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm import client as C  # noqa: E402


@pytest.fixture(autouse=True)
def _fast_hedge(monkeypatch):
    """把阈值压到 50ms，用例才跑得动（默认 30s 是给真实网关的）。"""
    monkeypatch.setenv("LLM_HEDGE_DELAY_MS", "50")


def test_fast_call_never_spawns_a_hedge():
    """正常请求（没到阈值）只发一次——对冲不能给主路径加开销。"""
    calls = []

    def fake(_messages, **_kw):
        calls.append(1)
        return "fast"

    assert C._call_llm_hedged.__module__  # 存在性，防重命名后用例静默失效
    orig = C.call_llm
    try:
        C.call_llm = fake
        assert C._call_llm_hedged([], 50) == "fast"
    finally:
        C.call_llm = orig
    assert len(calls) == 1


def test_slow_call_gets_hedged_and_the_faster_copy_wins():
    """慢到超过阈值 → 补发一份；先回的那份赢，慢的那份丢掉。"""
    order = []

    def fake(_messages, **_kw):
        n = len(order)
        order.append(n)
        if n == 0:
            time.sleep(0.6)      # 原始那份：慢
            return "slow"
        return "hedge"           # 副本：立刻回

    orig = C.call_llm
    try:
        C.call_llm = fake
        t0 = time.time()
        got = C._call_llm_hedged([], 50)
        elapsed = time.time() - t0
    finally:
        C.call_llm = orig
    assert got == "hedge"
    assert len(order) == 2, "应当正好补发一份，不是每次都发或发很多份"
    # 关键：不等慢的那份跑完就返回了（0.6s 是慢的那份的时长）
    assert elapsed < 0.5, f"取到快的那份就该立刻返回，实际等了 {elapsed:.2f}s"


def test_hedge_failure_does_not_poison_a_call_that_would_have_succeeded():
    """副本失败不算数——否则"为了更快"把本来会成功的调用变成失败。"""
    order = []

    def fake(_messages, **_kw):
        n = len(order)
        order.append(n)
        if n == 0:
            time.sleep(0.3)
            return "primary-ok"
        raise C.LlmError("hedge blew up", transient=True)

    orig = C.call_llm
    try:
        C.call_llm = fake
        assert C._call_llm_hedged([], 50) == "primary-ok"
    finally:
        C.call_llm = orig


def test_hedging_can_be_switched_off_entirely(monkeypatch):
    """阈值 <= 0 → 完全走老路径，连线程池都不建。"""
    monkeypatch.setenv("LLM_HEDGE_DELAY_MS", "0")
    assert C._hedge_delay_ms() == 0

    threads_before = threading.active_count()
    calls = []

    def fake(_messages, **_kw):
        calls.append(1)
        time.sleep(0.2)          # 远超"阈值"，但阈值关了就不该有副本
        return "only-one"

    orig = C.call_llm
    try:
        C.call_llm = fake
        assert C._call_llm_hedged([], C._hedge_delay_ms()) == "only-one"
    finally:
        C.call_llm = orig
    assert len(calls) == 1
    assert threading.active_count() <= threads_before + 1


def test_default_threshold_sits_between_the_observed_fast_and_slow_runs():
    """默认阈值必须落在实测的"正常"和"离群"之间，否则形同虚设。

    实测：正常 11.3~22.6s，离群 69.0~74.8s。阈值太小 → 每个请求都裂变成两个，
    白烧配额；太大 → 慢的那份都快回来了才补发，等于没开。
    """
    monkeypatch_free = C._HEDGE_DELAY_MS_DEFAULT / 1000.0
    assert 22.6 < monkeypatch_free < 69.0
