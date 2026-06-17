"""
LLM HTTP client — port of server/core/llm-client.ts (createChatCompletion / createResponse).

Real httpx calls. NO custom proxy dispatcher needed: httpx.Client(trust_env=True) (the default)
reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the environment, so the Clash proxy works without
the undici version-skew bug that plagued Node.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import LlmConfig, get_llm_config

Message = dict[str, str]


class LlmError(Exception):
    def __init__(self, message: str, *, status: int | None = None, transient: bool = False):
        super().__init__(message)
        self.status = status
        self.transient = transient


@dataclass
class LlmResult:
    content: str
    usage: dict[str, Any] | None
    finish_reason: str | None
    model: str
    latency_ms: int


def _headers(api_key: str) -> dict[str, str]:
    return {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}


def _normalize_error(status: int, body: str) -> LlmError:
    """Port of normalizeLLMError status mapping."""
    snippet = (body or "")[:200]
    if status in (401, 403):
        return LlmError(f"auth failed ({status}): check API key", status=status, transient=False)
    if status == 404:
        return LlmError("404: check base URL / model id", status=status, transient=False)
    if status == 429:
        return LlmError("429: rate limited or out of quota", status=status, transient=True)
    if 500 <= status < 600:
        return LlmError(f"upstream {status}: {snippet}", status=status, transient=True)
    return LlmError(f"HTTP {status}: {snippet}", status=status, transient=False)


# ── payload builders ──────────────────────────────────────────────────────────

def _chat_payload(messages, model, temperature, max_tokens, reasoning, stream) -> dict[str, Any]:
    p: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    if reasoning and reasoning.strip().lower() != "none":
        p["reasoning_effort"] = reasoning
    return p


def _responses_payload(messages, model, temperature, max_tokens, reasoning, stream) -> dict[str, Any]:
    instructions = "\n".join(m["content"] for m in messages if m.get("role") == "system")
    input_items = [
        {"role": m["role"], "content": [{"type": "input_text", "text": m["content"]}]}
        for m in messages
        if m.get("role") != "system"
    ]
    p: dict[str, Any] = {
        "model": model,
        "input": input_items,
        "max_output_tokens": max_tokens,
        "stream": stream,
        "store": False,
    }
    if instructions:
        p["instructions"] = instructions
    if reasoning and reasoning.strip().lower() != "none":
        p["reasoning"] = {"effort": reasoning}
    return p


# ── response extraction (chat + responses shapes) ─────────────────────────────

def _extract(data: dict[str, Any], wire: str) -> tuple[str, dict | None, str | None]:
    if wire == "responses":
        # Responses API: prefer output_text, else walk output[].content[].text
        text = data.get("output_text")
        if not text:
            parts: list[str] = []
            for item in data.get("output", []) or []:
                for c in item.get("content", []) or []:
                    if isinstance(c, dict) and c.get("text"):
                        parts.append(c["text"])
            text = "".join(parts)
        return text or "", data.get("usage"), data.get("status")
    # chat.completions
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    return (msg.get("content") or ""), data.get("usage"), choice.get("finish_reason")


def call_llm(
    messages: list[Message],
    *,
    config: LlmConfig | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 2000,
    reasoning_effort: str | None = None,
    timeout_ms: int | None = None,
) -> LlmResult:
    """Single real LLM call. Raises LlmError on any failure (never returns a stub)."""
    cfg = config or get_llm_config()
    if not cfg.api_key:
        raise LlmError("LLM not configured (no api_key)", transient=False)
    model = model or cfg.model
    reasoning = reasoning_effort if reasoning_effort is not None else cfg.reasoning_effort
    timeout_s = (timeout_ms or cfg.timeout_ms) / 1000.0

    if cfg.wire_api == "responses":
        url = f"{cfg.base_url}/responses"
        payload = _responses_payload(messages, model, temperature, max_tokens, reasoning, cfg.stream)
    else:
        url = f"{cfg.base_url}/chat/completions"
        payload = _chat_payload(messages, model, temperature, max_tokens, reasoning, cfg.stream)

    started = time.time()
    try:
        # trust_env=True (default) → honors HTTP_PROXY/HTTPS_PROXY/NO_PROXY (Clash) natively.
        with httpx.Client(timeout=timeout_s) as client:
            r = client.post(url, headers=_headers(cfg.api_key), json=payload)
    except httpx.TimeoutException as e:
        raise LlmError(f"timeout after {timeout_s:.0f}s", transient=True) from e
    except httpx.HTTPError as e:
        raise LlmError(f"cannot reach {url}: {e}", transient=True) from e

    latency = int((time.time() - started) * 1000)
    if r.status_code >= 400:
        raise _normalize_error(r.status_code, r.text)

    try:
        data = r.json()
    except json.JSONDecodeError as e:
        raise LlmError(f"non-JSON response: {r.text[:200]}", transient=False) from e

    content, usage, finish = _extract(data, cfg.wire_api)
    if not content.strip():
        raise LlmError("empty content from LLM", status=r.status_code, transient=False)
    return LlmResult(
        content=content,
        usage=usage,
        finish_reason=finish,
        model=str(data.get("model") or model),
        latency_ms=latency,
    )


# ── JSON helper (port of callLLMJson: strip ```json fences, parse) ────────────

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = _FENCE_RE.sub("", t).strip()
    return t


def classify_llm_failure_kind(error: LlmError) -> str:
    """Align Python failure labels with Node llm-client semantics."""
    status = error.status
    message = str(error).lower()
    if status == 429 or "rate limit" in message or "rate_limit" in message:
        return "rate_limit"
    if status in (401, 403) or "auth" in message:
        return "auth"
    if status == 404:
        return "not_found"
    if "timeout" in message:
        return "timeout"
    if status is not None and 500 <= status < 600:
        return "upstream"
    if error.transient:
        return "transient"
    return "unknown"


def normalize_usage(usage: dict[str, Any] | None) -> dict[str, int]:
    data = usage or {}
    prompt_tokens = int(data.get("prompt_tokens") or data.get("input_tokens") or 0)
    completion_tokens = int(data.get("completion_tokens") or data.get("output_tokens") or 0)
    total_tokens = int(data.get("total_tokens") or (prompt_tokens + completion_tokens))
    return {
        "total_tokens": total_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }


def call_llm_with_retry(
    messages: list[Message],
    *,
    max_attempts: int = 3,
    backoff_ms: int = 200,
    **kwargs: Any,
) -> LlmResult:
    last_error: LlmError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return call_llm(messages, **kwargs)
        except LlmError as error:
            last_error = error
            if not error.transient or attempt >= max_attempts:
                raise
            time.sleep(backoff_ms / 1000.0)
    if last_error is not None:
        raise last_error
    raise LlmError("call_llm_with_retry exhausted without result", transient=False)


def parse_llm_json_shape(
    payload: dict[str, Any],
    *,
    required_keys: tuple[str, ...],
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise LlmError("JSON shape is not an object", transient=False)
    missing = [key for key in required_keys if not payload.get(key)]
    if missing:
        raise LlmError(f"JSON missing required keys: {', '.join(missing)}", transient=False)
    return payload


def call_llm_json_with_shape(
    messages: list[Message],
    *,
    required_keys: tuple[str, ...],
    max_shape_retries: int = 0,
    **kwargs: Any,
) -> tuple[dict[str, Any], LlmResult]:
    last_error: LlmError | None = None
    for attempt in range(max_shape_retries + 1):
        parsed, result = call_llm_json(messages, **kwargs)
        try:
            return parse_llm_json_shape(parsed, required_keys=required_keys), result
        except LlmError as error:
            last_error = error
            if attempt >= max_shape_retries:
                raise
    if last_error is not None:
        raise last_error
    raise LlmError("JSON shape validation failed", transient=False)


def call_llm_json(messages: list[Message], **kwargs: Any) -> tuple[dict[str, Any], LlmResult]:
    """call_llm_with_retry + parse the content as a JSON object. Raises LlmError if not parseable."""
    max_attempts = int(kwargs.pop("max_attempts", 3))
    result = call_llm_with_retry(messages, max_attempts=max_attempts, **kwargs)
    raw = _strip_fences(result.content)
    # tolerate leading/trailing prose: extract the first {...} block
    if not raw.startswith("{"):
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            raw = m.group(0)
    try:
        return json.loads(raw), result
    except json.JSONDecodeError as e:
        raise LlmError(f"LLM JSON parse failed: {result.content[:200]}", transient=False) from e
