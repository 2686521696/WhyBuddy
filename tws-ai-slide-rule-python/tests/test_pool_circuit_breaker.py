import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError, LlmResult  # noqa: E402
from sliderule_llm.config import PoolConfig  # noqa: E402
from sliderule_llm.pool import (  # noqa: E402
    POOL_CIRCUIT_COOLDOWN_MS,
    clear_pool_penalties,
    get_last_pool_events,
)

SECRET_ONE = "circuit-test-secret-one"
SECRET_TWO = "circuit-test-secret-two"


def _sample_pool(**overrides) -> PoolConfig:
    base = dict(
        keys=(SECRET_ONE, SECRET_TWO),
        labels=("primary-alias", "backup-alias"),
        base_url="https://pool.example.test/v1",
        model="gpt-5.5",
        timeout_ms=300000,
        wire_api="responses",
        race_mode="sequential",
        enabled=True,
    )
    base.update(overrides)
    return PoolConfig(**base)


def _ok_result(*, model: str = "gpt-5.5", content: str = "ok") -> LlmResult:
    return LlmResult(
        content=content,
        usage={"total_tokens": 1},
        finish_reason="stop",
        model=model,
        latency_ms=1,
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


def test_consecutive_failures_open_circuit_and_skip_key_until_cooldown(monkeypatch):
    import sliderule_llm.pool as pool_mod
    from sliderule_llm.pool import call_pool

    now = {"value": 1000.0}
    attempts = []
    monkeypatch.setattr(pool_mod.time, "time", lambda: now["value"])

    def fake_call_llm(messages, *, config, **kwargs):
        attempts.append(config.api_key)
        if config.api_key == SECRET_ONE:
            raise LlmError(f"timeout for {config.api_key}", transient=True)
        return _ok_result(model=config.model, content="backup")

    monkeypatch.setattr("sliderule_llm.pool.call_llm", fake_call_llm)

    first = call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    second = call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    assert first is not None
    assert second is not None
    assert attempts == [SECRET_ONE, SECRET_TWO, SECRET_ONE, SECRET_TWO]

    attempts.clear()
    third = call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())

    assert third is not None
    assert attempts == [SECRET_TWO]
    events = get_last_pool_events()
    assert any(
        event["event"] == "circuit_opened"
        and event["pool_label"] == "primary-alias"
        and event["failure_count"] == 2
        for event in events
    )
    assert any(
        event["event"] == "skipped"
        and event["pool_label"] == "primary-alias"
        and event["reason"] == "circuit_open"
        for event in events
    )
    _assert_no_raw_secret(events)


def test_cooldown_allows_half_open_probe_and_success_closes_circuit(monkeypatch):
    import sliderule_llm.pool as pool_mod
    from sliderule_llm.pool import call_pool

    now = {"value": 1000.0}
    primary_attempts = {"count": 0}
    monkeypatch.setattr(pool_mod.time, "time", lambda: now["value"])

    def fake_call_llm(messages, *, config, **kwargs):
        if config.api_key == SECRET_ONE:
            primary_attempts["count"] += 1
            if primary_attempts["count"] <= 2:
                raise LlmError("upstream 503", status=503, transient=True)
            return _ok_result(model=config.model, content="primary-recovered")
        return _ok_result(model=config.model, content="backup")

    monkeypatch.setattr("sliderule_llm.pool.call_llm", fake_call_llm)

    call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    assert primary_attempts["count"] == 2

    now["value"] += POOL_CIRCUIT_COOLDOWN_MS / 1000.0 + 0.001
    recovered = call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())

    assert recovered is not None
    assert recovered.content == "primary-recovered"
    assert recovered.telemetry["pool_label"] == "primary-alias"
    events = get_last_pool_events()
    assert any(
        event["event"] == "circuit_half_open"
        and event["pool_label"] == "primary-alias"
        for event in events
    )
    assert any(
        event["event"] == "circuit_closed"
        and event["pool_label"] == "primary-alias"
        for event in events
    )
    _assert_no_raw_secret(recovered.telemetry)
    _assert_no_raw_secret(events)


def test_half_open_failure_reopens_circuit_without_changing_penalty_window(monkeypatch):
    import sliderule_llm.pool as pool_mod
    from sliderule_llm.pool import call_pool

    now = {"value": 1000.0}
    attempts = []
    monkeypatch.setattr(pool_mod.time, "time", lambda: now["value"])

    def fake_call_llm(messages, *, config, **kwargs):
        attempts.append(config.api_key)
        if config.api_key == SECRET_ONE:
            raise LlmError("upstream 503", status=503, transient=True)
        return _ok_result(model=config.model, content="backup")

    monkeypatch.setattr("sliderule_llm.pool.call_llm", fake_call_llm)

    call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    attempts.clear()

    now["value"] += POOL_CIRCUIT_COOLDOWN_MS / 1000.0 + 0.001
    reopened = call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    assert reopened is not None
    assert attempts == [SECRET_ONE, SECRET_TWO]

    attempts.clear()
    skipped = call_pool([{"role": "user", "content": "hi"}], pool=_sample_pool())
    assert skipped is not None
    assert attempts == [SECRET_TWO]

    events = get_last_pool_events()
    opened_events = [
        event
        for event in events
        if event["event"] == "circuit_opened"
        and event["pool_label"] == "primary-alias"
    ]
    assert len(opened_events) >= 2
    assert opened_events[-1]["failure_count"] == 2
    _assert_no_raw_secret(events)
