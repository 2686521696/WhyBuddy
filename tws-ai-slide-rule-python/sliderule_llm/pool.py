"""
Low-level key pool — port of server/sliderule/pool-json-llm.ts.

Multiple keys against one endpoint; race_mode 'parallel' (first success wins) or 'sequential'.
The pool uses the configured pool wire API, matching the Node pool env contract.
Returns None when the pool is disabled / unconfigured / fully exhausted (caller then falls back),
exactly like callPoolJsonLlm.
"""
from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, replace
from typing import Any

from .client import LlmError, LlmResult, build_llm_telemetry, call_llm, call_llm_json
from .config import LlmConfig, PoolConfig, get_pool_config

POOL_504_PENALTY_MS = 8000
_recent_504_penalty_until: dict[str, float] = {}


def clear_pool_penalties() -> None:
    _recent_504_penalty_until.clear()


def _record_504_penalty(label: str) -> None:
    until = time.time() + (POOL_504_PENALTY_MS / 1000.0)
    _recent_504_penalty_until[label] = until
    expired = [key for key, value in _recent_504_penalty_until.items() if value < time.time()]
    for key in expired:
        _recent_504_penalty_until.pop(key, None)


def _is_label_penalized(label: str) -> bool:
    until = _recent_504_penalty_until.get(label, 0.0)
    if until and time.time() >= until:
        _recent_504_penalty_until.pop(label, None)
        return False
    return until > time.time()


@dataclass
class PoolKeyState:
    key: str
    label: str
    _penalized_until: float = field(default=0.0, repr=False)

    def mark_http_failure(self, error: LlmError) -> None:
        message = str(error).lower()
        if error.status == 504 or "504" in message:
            _record_504_penalty(self.label)
            self._penalized_until = _recent_504_penalty_until[self.label]

    def is_penalized(self) -> bool:
        return _is_label_penalized(self.label)


def _proxy_env_active() -> bool:
    return any(os.environ.get(name) for name in (
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
        "http_proxy", "https_proxy", "all_proxy",
    ))


def resolve_pool_race_mode(pool: PoolConfig) -> str:
    override = (os.environ.get("SLIDERULE_POOL_RACE_MODE") or "").strip().lower()
    if override in ("parallel", "sequential"):
        return override
    if _proxy_env_active():
        return "sequential"
    return pool.race_mode


def _pool_key_label(pool: PoolConfig, index: int) -> str:
    labels = pool.labels or ()
    if index < len(labels) and labels[index]:
        return str(labels[index])
    return str(index)


def _pool_key_states(pool: PoolConfig) -> list[PoolKeyState]:
    return [
        PoolKeyState(key=key, label=_pool_key_label(pool, index))
        for index, key in enumerate(pool.keys)
    ]


def _active_key_states(states: list[PoolKeyState]) -> list[PoolKeyState]:
    return [state for state in states if not state.is_penalized()]


def _annotate_pool_result(result: LlmResult, pool: PoolConfig, label: str) -> LlmResult:
    usage = dict(result.usage or {})
    usage["model"] = f"{pool.model}@{label}"
    annotated = replace(result, model=pool.model, provider=pool.base_url, usage=usage)
    return replace(
        annotated,
        telemetry=build_llm_telemetry(
            annotated,
            extra={
                "pool_label": label,
                "pool_model": pool.model,
                "pool_key_count": len(pool.keys),
            },
        ),
    )


def _run_pool_attempts(
    states: list[PoolKeyState],
    *,
    race_mode: str,
    runner,
):
    active = _active_key_states(states)
    if not active:
        return None

    if race_mode == "sequential":
        for state in active:
            try:
                return runner(state)
            except LlmError as error:
                state.mark_http_failure(error)
                continue
        return None

    with ThreadPoolExecutor(max_workers=len(active)) as ex:
        futures = {ex.submit(runner, state): state for state in active}
        try:
            for fut in as_completed(futures):
                state = futures[fut]
                try:
                    return fut.result()
                except LlmError as error:
                    state.mark_http_failure(error)
                    continue
        finally:
            for fut in futures:
                fut.cancel()
    return None


def _key_config(pool: PoolConfig, key: str) -> LlmConfig:
    return LlmConfig(
        api_key=key,
        base_url=pool.base_url,
        model=pool.model,
        router_model=None,
        wire_api=pool.wire_api,
        reasoning_effort=None,
        timeout_ms=pool.timeout_ms,
        stream=False,
        unlimited_models=(),
        model_fallbacks=(),
        max_context=1_000_000,
        max_concurrent=9999,
        provider_name=pool.base_url,
        chat_thinking_type=None,
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

    states = _pool_key_states(p)
    race_mode = resolve_pool_race_mode(p)

    def one(state: PoolKeyState) -> LlmResult:
        result = call_llm(
            messages,
            config=_key_config(p, state.key),
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return _annotate_pool_result(result, p, state.label)

    return _run_pool_attempts(states, race_mode=race_mode, runner=one)


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

    states = _pool_key_states(p)
    race_mode = resolve_pool_race_mode(p)

    def one(state: PoolKeyState) -> tuple[dict[str, Any], LlmResult]:
        parsed, result = call_llm_json(
            messages,
            config=_key_config(p, state.key),
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return parsed, _annotate_pool_result(result, p, state.label)

    return _run_pool_attempts(states, race_mode=race_mode, runner=one)
