import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmResult  # noqa: E402
from sliderule_llm.config import PoolConfig  # noqa: E402
from sliderule_llm.pool import call_pool, clear_pool_penalties  # noqa: E402


def test_call_pool_builds_key_config_with_pool_wire_api(monkeypatch):
    clear_pool_penalties()
    captured = {}

    def fake_call_llm(messages, *, config, **kwargs):
        captured["config"] = config
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
            keys=("k1",),
            labels=("one",),
            base_url="https://pool.example.test/v1",
            model="gpt-5.5",
            timeout_ms=300000,
            wire_api="responses",
            race_mode="sequential",
            enabled=True,
        ),
    )

    assert result is not None
    assert captured["config"].api_key == "k1"
    assert captured["config"].base_url == "https://pool.example.test/v1"
    assert captured["config"].model == "gpt-5.5"
    assert captured["config"].wire_api == "responses"

