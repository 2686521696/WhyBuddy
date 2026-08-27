"""Control-plane LLM client — separate payload, MAY include tools.

Q1=A：工具调用只活在这一份 payload 里。factory sliderule_llm/client.py 的
`_chat_payload` 禁止长 tools 字段——生成器路径保持无工具。

空 content **带着 tool_calls** 是合法回复（模型经常把话全放进工具参数）。
factory 客户端把空 content 当失败，所以控制面不能复用那条提取。
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from .client import (
    LlmError,
    _headers,
    _http_timeout,
    _normalize_error,
    _normalize_messages,
    _describe_http_error,
    _describe_timeout,
)
from .config import clamp_max_tokens, default_max_tokens, get_llm_config


@dataclass
class ControlLlmResult:
    content: str
    tool_calls: list[dict[str, Any]]
    usage: dict[str, Any] | None
    finish_reason: str | None
    model: str
    latency_ms: int


def _control_chat_payload(
    messages: list[dict[str, Any]],
    model: str,
    temperature: float,
    max_tokens: int,
    tools: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    return payload


def _parse_tool_calls(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        fn = item.get("function") if isinstance(item.get("function"), dict) else {}
        args: Any = fn.get("arguments") if fn else item.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args) if args.strip() else {}
            except json.JSONDecodeError:
                args = {"_raw": args}
        if not isinstance(args, dict):
            args = {}
        name = str((fn or {}).get("name") or item.get("name") or "")
        if not name:
            continue
        out.append(
            {
                "id": str(item.get("id") or ""),
                "name": name,
                "arguments": args,
            }
        )
    return out


def _extract_control(data: dict[str, Any]) -> tuple[str, list[dict[str, Any]], dict | None, str | None]:
    choice = (data.get("choices") or [{}])[0] or {}
    msg = choice.get("message") or {}
    content = msg.get("content") or ""
    if not isinstance(content, str):
        content = str(content or "")
    tool_calls = _parse_tool_calls(msg.get("tool_calls"))
    return content, tool_calls, data.get("usage"), choice.get("finish_reason")


async def call_control_llm(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    timeout_ms: int | None = None,
) -> ControlLlmResult:
    """控制面专用。失败 raise LlmError；空正文但有 tool_calls 算成功。

    ⚠ **必须是 async 且用 AsyncClient**——这不是风格问题，是取消能不能穿透
      到 socket 的问题。2026-08-27 真机实测（社区养老/连锁餐饮两趟）：

          272.290  发起
          273.131  LLM 调用开始
          275.319  ← 客户端断开（用户点了停 / 关了页面）
          278.427  LLM 调用才返回     ← 客户端走后又跑了 3.1 秒

      老写法是同步 httpx 塞进 `run_in_threadpool`。Starlette 在客户端断开时
      **确实**把生成器协程取消掉了（实测：不进第 2 轮、不 yield、不落盘），
      但 `Task.cancel()` 打不断已经在线程里阻塞的 socket 读——线程照跑到底，
      钱照烧，线程池的槽照占（池子 64 槽，一组流式推演占 5 槽）。
      这跟 services/run_cancel.py 头注记的是同一个病。

      试过的死路，别再试一遍：从外部调 `client.close()` **打不断**在飞的
      同步请求（实测：慢 10s 的服务端，1s 时 close，线程仍跑满 10.00s 才
      拿到 ReadError）。同步 httpx 没有可中断的口子。

      抄的标准答案：grok-build `xai-grok-sampler/src/actor/request_task.rs`

          tokio::select! {
              biased;
              _ = cancel_token.cancelled() => return AttemptOutcome::Cancelled,
              next = l2.next() => ...
          }

      要点不是那个 `supports_cancel` 字段（那东西在 grok 自己代码里只声明、
      零消费者，照抄等于抄了个摆设），而是**取消赢了 race 之后请求的 future
      被 drop，tokio/reqwest 会真的关掉 socket**。Python 里的等价物只有一个：
      让请求本身跑在事件循环上，靠 asyncio 取消传导下去。
      实测 AsyncClient 这条真的通——取消 1.00s 生效，服务端写回时收到
      BrokenPipe，证明 socket 确实被关了。
    """
    cfg = get_llm_config()
    if not cfg.api_key or not cfg.base_url:
        raise LlmError("LLM not configured (no api_key)", transient=False)
    max_tokens = clamp_max_tokens(max_tokens or min(default_max_tokens(), 2048))
    messages = _normalize_messages(messages)
    model_name = (
        model
        or os.environ.get("SLIDERULE_CONTROL_MODEL")
        or cfg.model
    )
    timeout_s = (timeout_ms or min(int(cfg.timeout_ms or 60000), 45_000)) / 1000.0
    url = f"{cfg.base_url}/chat/completions"
    payload = _control_chat_payload(
        messages, model_name, temperature, max_tokens, tools
    )
    started = time.time()
    try:
        # ⚠ AsyncClient + await：取消要靠 asyncio 传导到 socket（见函数头注）。
        #   换回 httpx.Client 不会报错、测试也不一定红——只会让"停止"重新
        #   变成"看起来停了"。别改。
        async with httpx.AsyncClient(timeout=_http_timeout(timeout_s)) as client:
            response = await client.post(
                url, headers=_headers(cfg.api_key), json=payload
            )
    except httpx.TimeoutException as exc:
        raise LlmError(
            _describe_timeout(exc, timeout_s, time.time() - started), transient=True
        ) from exc
    except httpx.HTTPError as exc:
        raise LlmError(
            f"cannot reach {url}: {_describe_http_error(exc)}", transient=True
        ) from exc

    latency = int((time.time() - started) * 1000)
    if response.status_code >= 400:
        raise _normalize_error(response.status_code, response.text)
    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise LlmError(
            f"non-JSON response: {response.text[:200]}", transient=False
        ) from exc

    content, tool_calls, usage, finish = _extract_control(data)
    if not content.strip() and not tool_calls:
        raise LlmError("empty content from control LLM", transient=False)
    return ControlLlmResult(
        content=content,
        tool_calls=tool_calls,
        usage=usage,
        finish_reason=finish,
        model=str(data.get("model") or model_name),
        latency_ms=latency,
    )
