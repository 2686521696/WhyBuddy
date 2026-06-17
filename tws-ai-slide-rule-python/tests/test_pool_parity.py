import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError, LlmResult  # noqa: E402
from sliderule_llm.config import PoolConfig  # noqa: E402
from sliderule_llm.pool import clear_pool_penalties  # noqa: E402


@pytest.fixture(autouse=True)
def reset_pool_penalties():
    clear_pool_penalties()
    yield
    clear_pool_penalties()


def test_pool_key_state_records_504_penalty():
    from sliderule_llm.pool import PoolKeyState

    state = PoolKeyState(key="k1", label="one")
    state.mark_http_failure(LlmError("upstream 504", status=504, transient=True))
    assert state.is_penalized() is True


def test_call_pool_defaults_to_sequential_under_proxy_env(monkeypatch):
    from sliderule_llm.pool import call_pool

    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:7890")
    captured = {}

    def fake_call_llm(messages, *, config, **kwargs):
        captured["api_key"] = config.api_key
        return LlmResult(
            content="ok",
            usage={"total_tokens": 1},
            finish_reason="stop",
            model=config.model,
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.pool.call_llm", fake_call_llm)

    result = call_pool(
        [{"role": "user", "content": "hi"}],
        pool=PoolConfig(
            keys=("k1", "k2"),
            labels=("one", "two"),
            base_url="https://pool.example.test/v1",
            model="gpt-5.5",
            timeout_ms=300000,
            wire_api="responses",
            race_mode="parallel",
            enabled=True,
        ),
    )

    assert result is not None
    assert captured["api_key"] == "k1"


def test_pool_key_states_keep_all_keys_when_labels_are_short():
    from sliderule_llm.pool import _pool_key_states

    states = _pool_key_states(
        PoolConfig(
            keys=("k1", "k2"),
            labels=("one",),
            base_url="https://pool.example.test/v1",
            model="gpt-5.5",
            timeout_ms=300000,
            wire_api="responses",
            race_mode="sequential",
            enabled=True,
        )
    )

    assert [state.key for state in states] == ["k1", "k2"]
    assert [state.label for state in states] == ["one", "1"]


def test_call_pool_skips_penalized_key_after_504(monkeypatch):
    from sliderule_llm.pool import call_pool

    attempts = []

    def fake_call_llm(messages, *, config, **kwargs):
        attempts.append(config.api_key)
        if config.api_key == "k1":
            raise LlmError("upstream 504", status=504, transient=True)
        return LlmResult(
            content="ok",
            usage={"total_tokens": 1},
            finish_reason="stop",
            model=config.model,
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.pool.call_llm", fake_call_llm)

    pool = PoolConfig(
        keys=("k1", "k2"),
        labels=("one", "two"),
        base_url="https://pool.example.test/v1",
        model="gpt-5.5",
        timeout_ms=300000,
        wire_api="responses",
        race_mode="sequential",
        enabled=True,
    )

    first = call_pool([{"role": "user", "content": "hi"}], pool=pool)
    assert first is not None
    assert attempts == ["k1", "k2"]

    attempts.clear()
    second = call_pool([{"role": "user", "content": "hi"}], pool=pool)
    assert second is not None
    assert attempts == ["k2"]