"""结构化输出「错误回喂」通道（P3，2026-07-15）。

裁决修订（原 OSS_GAP_ANALYSIS 判「引库 instructor」，真机撞墙后改「借语义」）：
本仓网关对 OpenAI SDK 栈不友好——实测两堵墙：
  ① WAF 按 User-Agent 拦：UA 含 "OpenAI/Python" 直接 403 "Your request
     was blocked"（X-Stainless 系头无害）；
  ② Cloudflare 524：非流式请求 120 秒硬顶，五系统生成常超时——SDK 默认
     非流式，必撞；自研客户端的流式传输（字节持续流动）天然免疫。
所以把 instructor 的核心语义（reask：校验失败时把「上次输出 + 具体报错」
拼回消息让模型自我修正）移植到自研流式客户端上，SDK 栈不引入。

治的病（F2 评测实锤）：call_llm_json_with_shape 是「盲重采样」——校验
失败同一份 prompt 再抽一次奖，模型永远看不到自己错在哪；空正文/形状
失败让整场推演 fail-closed 成 0/6。

分层不变：本通道管 schema 级（JSON 可解析 + required 段非空）
  → v5_model_repair 确定性修复 → v5_model_gate 业务语义门 → 内容门。
fail-open：任何失败抛 StructuredLlmError，调用方回落旧路径。
停用开关：SLIDERULE_STRUCTURED_LLM=off。
"""

from __future__ import annotations

import json
import os
import re
from typing import Any


class StructuredLlmError(RuntimeError):
    """结构化通道失败（调用方应回落旧路径）。"""


def structured_llm_enabled() -> bool:
    return str(os.getenv("SLIDERULE_STRUCTURED_LLM", "on")).strip().lower() not in (
        "off",
        "0",
        "false",
    )


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _extract_json(content: str) -> dict[str, Any]:
    """围栏剥离 + 贪婪对象提取 + 宽松解析（借 instructor 的健壮性思路）。"""
    text = _FENCE_RE.sub("", content or "").strip()
    if not text.startswith("{"):
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("no JSON object found in response")
        text = match.group(0)
    return json.loads(text, strict=False)  # strict=False 容忍字符串内控制字符


def _shape_error(payload: Any, required_keys: tuple[str, ...]) -> str | None:
    if not isinstance(payload, dict):
        return f"top-level must be a JSON object, got {type(payload).__name__}"
    missing = [k for k in required_keys if not payload.get(k)]
    if missing:
        return (
            f"missing or empty required sections: {', '.join(missing)}; "
            "every required section must be present and non-empty"
        )
    return None


def structured_llm_json(
    messages: list[dict[str, str]],
    *,
    required_keys: tuple[str, ...],
    temperature: float = 0.2,
    max_tokens: int = 8000,
    max_retries: int = 2,
    reasoning_effort: str | None = None,
) -> dict[str, Any]:
    """错误回喂式结构化取数（instructor reask 语义 · 自研流式传输）。

    每次尝试：流式调用（no-op on_delta 强制流式——绕开 Cloudflare 对
    非流式响应的 120s 硬顶）→ 解析 → 形状校验；失败时把«上次的输出 +
    具体报错»作为 assistant/user 消息对拼进对话再试。耗尽抛
    StructuredLlmError（调用方回落旧路径）。"""
    if not structured_llm_enabled():
        raise StructuredLlmError("structured llm disabled by env")
    try:
        from .client import LlmError, call_llm_with_retry
    except Exception as exc:
        raise StructuredLlmError(f"llm client unavailable: {exc}") from exc

    convo = list(messages)
    last_error = "unknown"
    for _attempt in range(max_retries + 1):
        try:
            result = call_llm_with_retry(
                convo,
                max_attempts=2,  # 瞬时错误（502/524/超时）的网络层重试
                backoff_ms=2000,
                temperature=temperature,
                max_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
                on_delta=lambda _chunk: None,  # 强制流式传输，免疫 CF 524
            )
        except LlmError as exc:
            # 网络层耗尽：换一发采样重试（不回喂——没有产出可喂）
            last_error = f"llm error: {str(exc)[:160]}"
            continue
        try:
            payload = _extract_json(result.content)
            problem = _shape_error(payload, tuple(required_keys))
            if problem is None:
                return payload
            last_error = problem
        except (ValueError, json.JSONDecodeError) as exc:
            problem = f"invalid JSON: {str(exc)[:160]}"
            last_error = problem
        # instructor reask 语义：让模型看见自己上次错在哪，自我修正
        convo = convo + [
            {"role": "assistant", "content": (result.content or "")[:6000]},
            {
                "role": "user",
                "content": (
                    f"Validation error found:\n{problem}\n"
                    "Correct your JSON ONLY response, fix the errors. "
                    "Output the complete JSON object again."
                ),
            },
        ]
    raise StructuredLlmError(f"exhausted retries: {last_error}")
