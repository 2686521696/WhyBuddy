import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError, LlmResult  # noqa: E402
from sliderule_llm.config import LlmConfig, PoolConfig  # noqa: E402
from sliderule_llm.pool import clear_pool_penalties, get_last_pool_events, get_last_pool_failures  # noqa: E402


SECRET_ONE = "sk-runtime-accounting-secret-one"
SECRET_TWO = "sk-runtime-accounting-secret-two"


def _config(*, model: str = "gpt-4o-mini") -> LlmConfig:
    return LlmConfig(
        api_key="test-key",
        base_url="https://llm.example.test/v1",
        model=model,
        router_model=None,
        wire_api="chat_completions",
        reasoning_effort=None,
        timeout_ms=30_000,
        stream=False,
        unlimited_models=(),
        model_fallbacks=(),
        max_context=1_000_000,
        max_concurrent=9999,
        provider_name="llm.example.test",
        chat_thinking_type=None,
    )


def _pool(*, model: str = "gpt-4o-mini") -> PoolConfig:
    return PoolConfig(
        keys=(SECRET_ONE, SECRET_TWO),
        labels=("primary-alias", "backup-alias"),
        base_url="https://pool.example.test/v1",
        model=model,
        timeout_ms=30_000,
        wire_api="chat_completions",
        race_mode="sequential",
        enabled=True,
    )


@pytest.fixture(autouse=True)
def reset_pool_state():
    clear_pool_penalties()
    yield
    clear_pool_penalties()


def _assert_no_raw_secret(value) -> None:
    serialized = json.dumps(value, sort_keys=True)
    assert SECRET_ONE not in serialized
    assert SECRET_TWO not in serialized


def test_known_model_runtime_accounting_uses_static_pricing(monkeypatch):
    from sliderule_llm.client import call_llm

    def fake_once(messages, *, cfg, **kwargs):
        return LlmResult(
            content="ok",
            usage={"prompt_tokens": 1000, "completion_tokens": 500},
            finish_reason="stop",
            model=cfg.model,
            latency_ms=12,
            provider=cfg.provider_name,
        )

    monkeypatch.setattr("sliderule_llm.client.build_provider_configs", lambda explicit=None: [("primary", _config())])
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    result = call_llm([{"role": "user", "content": "hi"}])

    assert result.usage == {"total_tokens": 1500, "prompt_tokens": 1000, "completion_tokens": 500}
    assert result.telemetry["estimated_cost_usd"] == pytest.approx(0.00045)
    assert result.telemetry["cost"] == {
        "estimated_usd": pytest.approx(0.00045),
        "currency": "USD",
        "is_estimate": True,
        "pricing_source": "known",
        "pricing_model": "gpt-4o-mini",
        "pricing_unit": "usd_per_1k_tokens",
        "billing_source": "static_pricing_table",
    }


def test_unknown_model_runtime_accounting_uses_safe_fallback(monkeypatch):
    from sliderule_llm.client import call_llm

    def fake_once(messages, *, cfg, **kwargs):
        return LlmResult(
            content="ok",
            usage={"input_tokens": 1000, "output_tokens": 1000},
            finish_reason="stop",
            model=cfg.model,
            latency_ms=7,
            provider=cfg.provider_name,
        )

    config = _config(model="unlisted-runtime-model")
    monkeypatch.setattr("sliderule_llm.client.build_provider_configs", lambda explicit=None: [("primary", config)])
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    result = call_llm([{"role": "user", "content": "hi"}], config=config)

    assert result.usage == {"total_tokens": 2000, "prompt_tokens": 1000, "completion_tokens": 1000}
    assert result.telemetry["estimated_cost_usd"] == pytest.approx(0.003)
    assert result.telemetry["cost"]["pricing_source"] == "fallback"
    assert result.telemetry["cost"]["pricing_model"] == "default"
    assert result.telemetry["cost"]["is_estimate"] is True
    assert result.telemetry["cost"]["billing_source"] == "static_pricing_table"


def test_pool_runtime_summary_aggregates_safe_accounting_fields(monkeypatch):
    from sliderule_llm.pool import call_pool

    def fake_call_llm(messages, *, config, **kwargs):
        if config.api_key == SECRET_ONE:
            raise LlmError(f"upstream 503 for {config.api_key}", status=503, transient=True)
        return LlmResult(
            content="ok",
            usage={"prompt_tokens": 2000, "completion_tokens": 1000},
            finish_reason="stop",
            model=config.model,
            latency_ms=15,
            provider=config.provider_name,
        )

    monkeypatch.setattr("sliderule_llm.pool.call_llm", fake_call_llm)

    result = call_pool([{"role": "user", "content": "hi"}], pool=_pool())

    assert result is not None
    assert result.telemetry["estimated_cost_usd"] == pytest.approx(0.0009)
    summary = result.telemetry["pool_summary"]
    assert summary["pool_model"] == "gpt-4o-mini"
    assert summary["pool_key_count"] == 2
    assert summary["selected_pool_label"] == "backup-alias"
    assert summary["selected_pool_key_id"] == result.telemetry["pool_key_id"]
    assert summary["usage"] == {"total_tokens": 3000, "prompt_tokens": 2000, "completion_tokens": 1000}
    assert summary["estimated_cost_usd"] == pytest.approx(0.0009)
    assert summary["cost_pricing_source"] == "known"
    assert summary["cost_is_estimate"] is True

    _assert_no_raw_secret(result.telemetry)
    _assert_no_raw_secret(get_last_pool_failures())
    _assert_no_raw_secret(get_last_pool_events())
