"""
Low-level key pool — port of server/sliderule/pool-json-llm.ts.

Multiple keys against one endpoint; race_mode 'parallel' (first success wins) or 'sequential'.
The pool always uses the chat_completions wire (matches the Node pool + the su8 pool config).
Returns None when the pool is disabled / unconfigured / fully exhausted (caller then falls back),
exactly like callPoolJsonLlm.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .client import LlmError, LlmResult, call_llm, call_llm_json
from .config import LlmConfig, PoolConfig, get_pool_config


def _key_config(pool: PoolConfig, key: str) -> LlmConfig:
    return LlmConfig(
        api_key=key,
        base_url=pool.base_url,
        model=pool.model,
        wire_api="chat_completions",
        reasoning_effort=None,
        timeout_ms=pool.timeout_ms,
        stream=False,
        unlimited_models=(),
    )


def call_pool(
    messages: list[dict[str, str]],
    *,
    pool: PoolConfig | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2000,
) -> LlmResult | None:
    """Run the request across pool keys. None if disabled/unconfigured/exhausted."""
    p = pool or get_pool_config()
    if not p.enabled or not p.keys or not p.base_url:
        return None

    def one(key: str) -> LlmResult:
        return call_llm(messages, config=_key_config(p, key), temperature=temperature, max_tokens=max_tokens)

    if p.race_mode == "sequential":
        for key in p.keys:
            try:
                return one(key)
            except LlmError:
                continue
        return None

    # parallel: first successful result wins; cancel the rest
    with ThreadPoolExecutor(max_workers=len(p.keys)) as ex:
        futures = {ex.submit(one, key): key for key in p.keys}
        try:
            for fut in as_completed(futures):
                try:
                    return fut.result()
                except LlmError:
                    continue
        finally:
            for fut in futures:
                fut.cancel()
    return None


def call_pool_json(
    messages: list[dict[str, str]],
    *,
    pool: PoolConfig | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2000,
) -> tuple[dict[str, Any], LlmResult] | None:
    """call_pool variant that parses JSON. None if pool produced nothing parseable."""
    p = pool or get_pool_config()
    if not p.enabled or not p.keys or not p.base_url:
        return None

    def one(key: str) -> tuple[dict[str, Any], LlmResult]:
        return call_llm_json(messages, config=_key_config(p, key), temperature=temperature, max_tokens=max_tokens)

    if p.race_mode == "sequential":
        for key in p.keys:
            try:
                return one(key)
            except LlmError:
                continue
        return None

    with ThreadPoolExecutor(max_workers=len(p.keys)) as ex:
        futures = {ex.submit(one, key): key for key in p.keys}
        try:
            for fut in as_completed(futures):
                try:
                    return fut.result()
                except LlmError:
                    continue
        finally:
            for fut in futures:
                fut.cancel()
    return None
