import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError  # noqa: E402


def test_classify_llm_failure_kind_maps_rate_limit():
    from sliderule_llm.client import classify_llm_failure_kind

    assert classify_llm_failure_kind(LlmError("429: rate limited", status=429, transient=True)) == "rate_limit"


def test_call_llm_retries_transient_errors(monkeypatch):
    from sliderule_llm.client import call_llm_with_retry

    attempts = {"count": 0}

    def flaky_call(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] < 2:
            raise LlmError("upstream 503", status=503, transient=True)
        from sliderule_llm.client import LlmResult
        return LlmResult(
            content="ok",
            usage={"total_tokens": 1},
            finish_reason="stop",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", flaky_call)
    result = call_llm_with_retry([{"role": "user", "content": "hi"}], max_attempts=3)
    assert result.content == "ok"
    assert attempts["count"] == 2


def test_normalize_usage_includes_standard_token_fields():
    from sliderule_llm.client import normalize_usage

    normalized = normalize_usage({"total_tokens": 9, "prompt_tokens": 4, "completion_tokens": 5})
    assert normalized["total_tokens"] == 9
    assert normalized["prompt_tokens"] == 4
    assert normalized["completion_tokens"] == 5


def test_normalize_usage_maps_responses_api_token_fields():
    from sliderule_llm.client import normalize_usage

    normalized = normalize_usage({"input_tokens": 11, "output_tokens": 7, "total_tokens": 18})
    assert normalized["prompt_tokens"] == 11
    assert normalized["completion_tokens"] == 7
    assert normalized["total_tokens"] == 18