"""建连不许傻等十分钟，而读响应必须能等（2026-08-14）。

## 真机形状

收尾那 821 秒的黑洞，埋点补上之后一行说清：

    [llm-retry] 第 1/3 次失败（可重试，耗时 331.0s）：
        cannot reach …: Server disconnected without sending a response.

**一次调用挂了 331 秒才失败**，三次重试就是十几分钟。

根因：此前给 httpx 传的是一个**裸数字**，而它会被同时用在四个阶段上
（connect / read / write / pool）。于是 `LLM_TIMEOUT_MS=600000` 不只是
"读响应最多等 10 分钟"，连"建连最多等 10 分钟"也一起给了。

## 抄的是 openai SDK 的默认

    openai/_constants.py:9
    DEFAULT_TIMEOUT = httpx.Timeout(timeout=600, connect=5.0)

整体 600 秒、连接单独压到 5 秒。这不是拍的数，是官方 SDK 的默认形状。

## read 那 600 秒**不能动**

一次页面生成实测 149~200s、bind 单页 185s、spec 起草 64~93s。缩短读超时
会当场误杀正常的长生成——那比多等 331 秒糟得多。所以这条用例是**双向**的：
既钉住 connect 要短，也钉住 read 不许被顺手改短。
"""

import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import _describe_http_error, _http_timeout  # noqa: E402


class Test四个阶段不再共用一个数:
    def test_connect_短_read_长(self):
        t = _http_timeout(600.0)
        assert t.connect == 5.0, "建连还在等 10 分钟——裸数字又传回去了？"
        assert t.read == 600.0, (
            "读超时被改短了。⚠ 一次页面生成实测 149~200s、bind 单页 185s，"
            "缩短它会当场误杀正常的长生成"
        )

    def test_形状与_openai_sdk_一致(self):
        """⚠ 判据钉在**参照实现**上，不钉在我写下的数字上。

        openai SDK 换了默认值时这条会红——那时该跟着想一遍，
        而不是让我们的值和业界默认悄悄分叉。
        """
        from openai._constants import DEFAULT_TIMEOUT as SDK

        ours = _http_timeout(600.0)
        assert ours.connect == SDK.connect, (
            f"connect 与 openai SDK 分叉了：我们 {ours.connect} vs SDK {SDK.connect}"
        )

    def test_整体超时仍然跟着调用方走(self):
        """connect 是固定的，其余三档要跟着 timeout_ms 走——
        否则 LLM_TIMEOUT_MS 这个配置就名存实亡了。"""
        t = _http_timeout(30.0)
        assert t.read == 30.0 and t.write == 30.0 and t.pool == 30.0
        assert t.connect == 5.0, "connect 不该被调用方的整体超时带走"


class Test错误类型不许被吞掉:
    """⚑ 此前 ConnectError / RemoteProtocolError / ReadError 全被
    `except httpx.HTTPError` 一把捞走，消息里只有 "cannot reach …"。

    于是「连不上」和「连上了但对面中途断开」在日志里长得一模一样——
    而这两者要的修法不同：前者靠短 connect 超时，后者得靠首字节超时或对冲。
    331 秒那次就卡在分不出是哪一种。
    """

    @pytest.mark.parametrize(
        "exc,name",
        [
            (httpx.ConnectError("refused"), "ConnectError"),
            (httpx.RemoteProtocolError("Server disconnected without sending a response."),
             "RemoteProtocolError"),
            (httpx.ReadError("boom"), "ReadError"),
        ],
    )
    def test_类型名进了消息(self, exc, name):
        out = _describe_http_error(exc)
        assert out.startswith(f"{name}: "), f"类型名没带出来：{out}"

    def test_原始消息不许被类型名挤掉(self):
        """两样都要：类型定位「哪一层」，原文定位「具体怎么了」。"""
        out = _describe_http_error(
            httpx.RemoteProtocolError("Server disconnected without sending a response.")
        )
        assert "Server disconnected" in out
