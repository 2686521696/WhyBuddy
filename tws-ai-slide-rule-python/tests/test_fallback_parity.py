import os
import sys
from dataclasses import replace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError, LlmResult  # noqa: E402
from sliderule_llm.config import FallbackLlmConfig, LlmConfig  # noqa: E402


def _config(
    *,
    api_key: str = "primary-key",
    base_url: str = "https://primary.example.test/v1",
    model: str = "primary-model",
    model_fallbacks: tuple[str, ...] = (),
    provider_name: str = "primary.example.test",
) -> LlmConfig:
    return LlmConfig(
        api_key=api_key,
        base_url=base_url,
        model=model,
        router_model=None,
        wire_api="chat_completions",
        reasoning_effort=None,
        timeout_ms=30_000,
        stream=False,
        unlimited_models=(),
        model_fallbacks=model_fallbacks,
        max_context=1_000_000,
        max_concurrent=9999,
        provider_name=provider_name,
        chat_thinking_type=None,
    )


def _fallback_config() -> FallbackLlmConfig:
    return FallbackLlmConfig(
        enabled=True,
        api_key="fallback-key",
        base_url="https://fallback.example.test/v1",
        model="fallback-provider-model",
        wire_api="chat_completions",
        timeout_ms=60_000,
        reasoning_effort=None,
        force_model=True,
        stream=False,
        chat_thinking_type=None,
        retries=3,
        cooldown_ms=30_000,
    )


def test_provider_chain_orders_primary_model_fallbacks_before_fallback_provider(monkeypatch):
    from sliderule_llm.client import build_provider_configs

    monkeypatch.setattr(
        "sliderule_llm.client.get_llm_config",
        lambda: _config(model="primary-model", model_fallbacks=("fallback-model-a", "fallback-model-b")),
    )
    monkeypatch.setattr("sliderule_llm.client.get_fallback_llm_config", _fallback_config)

    providers = build_provider_configs()

    assert [(name, cfg.model) for name, cfg in providers] == [
        ("primary", "primary-model"),
        ("primary:fallback-model-a", "fallback-model-a"),
        ("primary:fallback-model-b", "fallback-model-b"),
        ("fallback", "fallback-provider-model"),
    ]


def test_call_llm_tries_model_fallback_before_fallback_provider(monkeypatch):
    from sliderule_llm.client import call_llm

    primary = _config(model="primary-model")
    model_fallback = replace(primary, model="primary-fallback-model")
    fallback_provider = _config(
        api_key="fallback-key",
        base_url="https://fallback.example.test/v1",
        model="fallback-provider-model",
        provider_name="fallback.example.test",
    )
    calls: list[str] = []

    def fake_once(messages, *, cfg, **kwargs):
        calls.append(cfg.model)
        if cfg.model != "fallback-provider-model":
            raise LlmError("upstream 503", status=503, transient=True)
        return LlmResult(
            content="ok",
            usage={"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
            finish_reason="stop",
            model=cfg.model,
            latency_ms=7,
            provider=cfg.provider_name,
        )

    monkeypatch.setattr(
        "sliderule_llm.client.build_provider_configs",
        lambda explicit=None: [
            ("primary", primary),
            ("primary:primary-fallback-model", model_fallback),
            ("fallback", fallback_provider),
        ],
    )
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    result = call_llm([{"role": "user", "content": "hi"}])

    assert calls == ["primary-model", "primary-fallback-model", "fallback-provider-model"]
    assert result.content == "ok"
    assert result.model == "fallback-provider-model"
    assert result.provider == "fallback.example.test"
    assert result.usage == {
        "total_tokens": 5,
        "prompt_tokens": 2,
        "completion_tokens": 3,
    }


def test_call_llm_does_not_fallback_on_auth_error(monkeypatch):
    from sliderule_llm.client import call_llm

    primary = _config(model="primary-model")
    fallback_provider = _config(
        api_key="fallback-key",
        base_url="https://fallback.example.test/v1",
        model="fallback-provider-model",
        provider_name="fallback.example.test",
    )
    calls: list[str] = []

    def fake_once(messages, *, cfg, **kwargs):
        calls.append(cfg.model)
        raise LlmError("auth failed (401): check API key", status=401, transient=False)

    monkeypatch.setattr(
        "sliderule_llm.client.build_provider_configs",
        lambda explicit=None: [("primary", primary), ("fallback", fallback_provider)],
    )
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    with pytest.raises(LlmError, match="auth failed"):
        call_llm([{"role": "user", "content": "hi"}])

    assert calls == ["primary-model"]


def test_call_llm_falls_back_on_model_not_found(monkeypatch):
    from sliderule_llm.client import call_llm

    primary = _config(model="missing-model")
    fallback_provider = _config(
        api_key="fallback-key",
        base_url="https://fallback.example.test/v1",
        model="fallback-provider-model",
        provider_name="fallback.example.test",
    )
    calls: list[str] = []

    def fake_once(messages, *, cfg, **kwargs):
        calls.append(cfg.model)
        if cfg.model == "missing-model":
            raise LlmError("404: check base URL / model id", status=404, transient=False)
        return LlmResult(
            content="fallback-ok",
            usage={"input_tokens": 1, "output_tokens": 2},
            finish_reason="STOP",
            model=cfg.model,
            latency_ms=4,
            provider=cfg.provider_name,
        )

    monkeypatch.setattr(
        "sliderule_llm.client.build_provider_configs",
        lambda explicit=None: [("primary", primary), ("fallback", fallback_provider)],
    )
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    result = call_llm([{"role": "user", "content": "hi"}])

    assert calls == ["missing-model", "fallback-provider-model"]
    assert result.content == "fallback-ok"
    assert result.finish_reason == "stop"
    assert result.provider == "fallback.example.test"


def test_explicit_config_disables_provider_chain_fallback(monkeypatch):
    from sliderule_llm.client import call_llm

    primary = _config(model="explicit-model")
    calls: list[str] = []

    def fake_once(messages, *, cfg, **kwargs):
        calls.append(cfg.model)
        raise LlmError("upstream 503", status=503, transient=True)

    monkeypatch.setattr(
        "sliderule_llm.client.build_provider_configs",
        lambda explicit=None: [("explicit", primary), ("fallback", replace(primary, model="fallback-model"))],
    )
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    with pytest.raises(LlmError, match="upstream 503"):
        call_llm([{"role": "user", "content": "hi"}], config=primary)

    assert calls == ["explicit-model"]
