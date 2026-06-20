import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmResult  # noqa: E402
from sliderule_llm.config import LlmConfig, PoolConfig  # noqa: E402
from sliderule_llm.pool import clear_pool_penalties  # noqa: E402


def _config() -> LlmConfig:
    return LlmConfig(
        api_key="test-key",
        base_url="https://llm.example.test/v1",
        model="primary-model",
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


def _pool() -> PoolConfig:
    return PoolConfig(
        keys=("k1", "k2"),
        labels=("alpha", "beta"),
        base_url="https://pool.example.test/v1",
        model="pool-model",
        timeout_ms=300_000,
        wire_api="chat_completions",
        race_mode="sequential",
        enabled=True,
    )


def test_chat_call_returns_normalized_telemetry(monkeypatch):
    from sliderule_llm.client import call_llm

    def fake_once(messages, *, cfg, **kwargs):
        return LlmResult(
            content="ok",
            usage={"input_tokens": 4, "output_tokens": 6},
            finish_reason="STOP",
            model=cfg.model,
            latency_ms=15,
            provider=cfg.provider_name,
        )

    monkeypatch.setattr("sliderule_llm.client.build_provider_configs", lambda explicit=None: [("primary", _config())])
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    result = call_llm([{"role": "user", "content": "hi"}])

    assert result.usage == {
        "total_tokens": 10,
        "prompt_tokens": 4,
        "completion_tokens": 6,
    }
    assert result.telemetry == {
        "model": "primary-model",
        "provider": "llm.example.test",
        "usage": {
            "total_tokens": 10,
            "prompt_tokens": 4,
            "completion_tokens": 6,
        },
        "latency_ms": 15,
        "finish_reason": "stop",
        "estimated_cost_usd": 0.000016,
        "cost": {
            "estimated_usd": 0.000016,
            "currency": "USD",
            "is_estimate": True,
            "pricing_source": "fallback",
            "pricing_model": "default",
            "pricing_unit": "usd_per_1k_tokens",
            "billing_source": "static_pricing_table",
        },
    }


def test_json_call_reuses_result_telemetry(monkeypatch):
    from sliderule_llm.client import call_llm_json

    def fake_retry(messages, **kwargs):
        return LlmResult(
            content='{"ok": true}',
            usage={"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
            finish_reason="stop",
            model="json-model",
            latency_ms=8,
            provider="json.example.test",
            telemetry={
                "model": "json-model",
                "provider": "json.example.test",
                "usage": {"total_tokens": 5, "prompt_tokens": 2, "completion_tokens": 3},
                "latency_ms": 8,
                "finish_reason": "stop",
                "estimated_cost_usd": None,
            },
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm_with_retry", fake_retry)

    parsed, result = call_llm_json([{"role": "user", "content": "hi"}])

    assert parsed == {"ok": True}
    assert result.telemetry["model"] == "json-model"
    assert result.telemetry["usage"]["total_tokens"] == 5
    assert result.telemetry["estimated_cost_usd"] is None


def test_pool_call_adds_pool_telemetry(monkeypatch):
    from sliderule_llm.pool import call_pool

    clear_pool_penalties()

    def fake_call_llm(messages, *, config, **kwargs):
        return LlmResult(
            content="ok",
            usage={"total_tokens": 7},
            finish_reason="stop",
            model=config.model,
            latency_ms=11,
            provider=config.provider_name,
            telemetry={
                "model": config.model,
                "provider": config.provider_name,
                "usage": {"total_tokens": 7, "prompt_tokens": 0, "completion_tokens": 0},
                "latency_ms": 11,
                "finish_reason": "stop",
                "estimated_cost_usd": None,
            },
        )

    monkeypatch.setattr("sliderule_llm.pool.call_llm", fake_call_llm)

    result = call_pool([{"role": "user", "content": "hi"}], pool=_pool())

    assert result is not None
    assert result.model == "pool-model"
    assert result.provider == "https://pool.example.test/v1"
    assert result.telemetry["model"] == "pool-model"
    assert result.telemetry["provider"] == "https://pool.example.test/v1"
    assert result.telemetry["pool_label"] == "alpha"
    assert result.telemetry["pool_model"] == "pool-model"
    assert result.telemetry["pool_key_count"] == 2
    assert result.telemetry["usage"]["total_tokens"] == 7
    assert result.telemetry["estimated_cost_usd"] == 0
    assert result.telemetry["cost"]["pricing_source"] == "fallback"
    assert result.telemetry["pool_summary"]["selected_pool_label"] == "alpha"
    assert result.telemetry["pool_summary"]["selected_pool_key_id"] == result.telemetry["pool_key_id"]
    assert result.telemetry["pool_summary"]["estimated_cost_usd"] == 0


def test_pool_json_call_adds_pool_telemetry(monkeypatch):
    from sliderule_llm.pool import call_pool_json

    clear_pool_penalties()

    def fake_call_llm_json(messages, *, config, **kwargs):
        return (
            {"ok": True},
            LlmResult(
                content='{"ok": true}',
                usage={"input_tokens": 3, "output_tokens": 4},
                finish_reason="STOP",
                model=config.model,
                latency_ms=9,
                provider=config.provider_name,
            ),
        )

    monkeypatch.setattr("sliderule_llm.pool.call_llm_json", fake_call_llm_json)

    parsed, result = call_pool_json([{"role": "user", "content": "hi"}], pool=_pool())

    assert parsed == {"ok": True}
    assert result is not None
    assert result.telemetry["finish_reason"] == "stop"
    assert result.telemetry["pool_label"] == "alpha"
    assert result.telemetry["usage"] == {
        "total_tokens": 7,
        "prompt_tokens": 3,
        "completion_tokens": 4,
    }
    assert result.telemetry["estimated_cost_usd"] == 0.000011
    assert result.telemetry["cost"]["pricing_source"] == "fallback"
