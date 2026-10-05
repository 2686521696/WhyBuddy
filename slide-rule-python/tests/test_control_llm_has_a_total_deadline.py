"""控制面单发 LLM 调用要有**总时长**上限，不只是「两次读之间」的上限。

⚠ 2026-10-05 真机 @office-skills 奶茶店 Excel sr-20261005070335-K7Q52TH3TK：规划第 4 发请求发出后
  20 多分钟没回、也没有一行重试日志；这一档（control-v3）单发 600 秒、回合墙钟 86400 秒。
  httpx 的 timeout 是**每次读**的上限：网关先回头、再隔一阵吐几个保活字节，每次读都不超时，
  这一发能挂到天荒地老——用户那边就是一直转圈，没有报错、没有重试。

判据起一个真 socket 的假网关：回 200 头，然后每 0.1 秒吐一个空格，永远不结束。
单发预算 0.8 秒：必须在预算附近以「可重试的超时」失败，而不是被外面 5 秒的看门狗掐断。
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from types import SimpleNamespace

import pytest

from sliderule_llm import control_client
from sliderule_llm.client import LlmError
from sliderule_llm.gateway_circuit import reset_gateway_circuit


def _trickling_gateway():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(4)
    stop = threading.Event()

    def serve():
        server.settimeout(0.2)
        while not stop.is_set():
            try:
                conn, _ = server.accept()
            except OSError:
                continue
            def trickle(c=conn):
                try:
                    c.recv(65536)
                    c.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n")
                    while not stop.is_set():
                        c.sendall(b"1\r\n \r\n")          # 一个空格的 chunk：保活，不是内容
                        time.sleep(0.1)
                except OSError:
                    pass
                finally:
                    c.close()
            threading.Thread(target=trickle, daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()
    return server.getsockname()[1], lambda: (stop.set(), server.close())


@pytest.fixture
def gateway(monkeypatch):
    port, close = _trickling_gateway()
    for name in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(control_client, "get_llm_config", lambda: SimpleNamespace(
        api_key="fixture-key", base_url=f"http://127.0.0.1:{port}/v1", model="fixture-model", timeout_ms=800))
    monkeypatch.setattr(control_client, "ensure_llm_proxy_bypass", lambda: None)
    reset_gateway_circuit()
    yield
    close()


def test_a_trickling_gateway_cannot_hold_one_sample_past_its_budget(gateway):
    started = time.monotonic()

    async def one_sample():
        return await asyncio.wait_for(
            control_client._call_control_llm_once([{"role": "user", "content": "hi"}], timeout_ms=800),
            timeout=5)                                  # 看门狗：没有总时长上限就是它来掐，判据红

    with pytest.raises(LlmError) as caught:
        asyncio.run(one_sample())
    waited = time.monotonic() - started
    assert caught.value.transient                      # 超时是可重试的那一类，跟读超时一样
    assert waited < 2.5, waited                        # 在预算附近失败，不是挂满看门狗
