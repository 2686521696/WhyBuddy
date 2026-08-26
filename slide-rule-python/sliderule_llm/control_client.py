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


def call_control_llm(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    timeout_ms: int | None = None,
) -> ControlLlmResult:
    """控制面专用。失败 raise LlmError；空正文但有 tool_calls 算成功。"""
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
        with httpx.Client(timeout=_http_timeout(timeout_s)) as client:
            response = client.post(url, headers=_headers(cfg.api_key), json=payload)
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
