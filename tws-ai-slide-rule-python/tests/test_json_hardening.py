import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError  # noqa: E402


def test_parse_llm_json_shape_requires_keys():
    from sliderule_llm.client import parse_llm_json_shape

    with pytest.raises(LlmError):
        parse_llm_json_shape({}, required_keys=("title", "content"))


def test_parse_llm_json_shape_accepts_valid_payload():
    from sliderule_llm.client import parse_llm_json_shape

    parsed = parse_llm_json_shape(
        {"title": "Report", "content": "Body"},
        required_keys=("title", "content"),
    )
    assert parsed["title"] == "Report"


def test_call_llm_json_retries_empty_object_shape(monkeypatch):
    from sliderule_llm.client import LlmResult, call_llm_json_with_shape

    attempts = {"count": 0}

    def fake_call_llm(messages, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            return LlmResult(
                content="{}",
                usage={"total_tokens": 1},
                finish_reason="stop",
                model="fake",
                latency_ms=1,
            )
        return LlmResult(
            content='{"title":"ok","content":"filled"}',
            usage={"total_tokens": 2},
            finish_reason="stop",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    parsed, _meta = call_llm_json_with_shape(
        [{"role": "user", "content": "write report"}],
        required_keys=("title", "content"),
        max_shape_retries=1,
    )
    assert parsed["content"] == "filled"
    assert attempts["count"] == 2