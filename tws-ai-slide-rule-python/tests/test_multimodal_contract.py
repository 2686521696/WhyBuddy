import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError  # noqa: E402
from sliderule_llm.config import LlmConfig  # noqa: E402


def _config(
    *,
    wire_api: str = "chat_completions",
    supports_image_content_parts: bool = False,
) -> LlmConfig:
    return LlmConfig(
        api_key="test-key",
        base_url="https://llm.example.test/v1",
        model="test-model",
        router_model=None,
        wire_api=wire_api,
        reasoning_effort=None,
        timeout_ms=30_000,
        stream=False,
        unlimited_models=(),
        model_fallbacks=(),
        max_context=1_000_000,
        max_concurrent=9999,
        provider_name="llm.example.test",
        chat_thinking_type=None,
        supports_image_content_parts=supports_image_content_parts,
    )


def _install_fake_httpx(monkeypatch, response_payload: dict):
    captured: dict = {"post_count": 0}

    class FakeResponse:
        status_code = 200
        text = "{}"

        def json(self):
            return response_payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers, json):
            captured["post_count"] += 1
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("sliderule_llm.client.httpx.Client", FakeClient)
    return captured


def test_chat_completions_accepts_text_only_messages(monkeypatch):
    from sliderule_llm.client import _call_llm_once

    captured = _install_fake_httpx(
        monkeypatch,
        {
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            "model": "test-model",
        },
    )

    result = _call_llm_once(
        [{"role": "user", "content": "hello"}],
        cfg=_config(),
    )

    assert result.content == "ok"
    assert captured["url"] == "https://llm.example.test/v1/chat/completions"
    assert captured["json"]["messages"] == [{"role": "user", "content": "hello"}]


def test_chat_completions_preserves_text_and_image_parts(monkeypatch):
    from sliderule_llm.client import _call_llm_once

    content_parts = [
        {"type": "text", "text": "describe this"},
        {
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,abc123", "detail": "low"},
        },
    ]
    captured = _install_fake_httpx(
        monkeypatch,
        {
            "choices": [{"message": {"content": "image summary"}, "finish_reason": "stop"}],
            "model": "test-model",
        },
    )

    result = _call_llm_once(
        [{"role": "user", "content": content_parts}],
        cfg=_config(supports_image_content_parts=True),
    )

    assert result.content == "image summary"
    assert captured["json"]["messages"][0]["content"] == content_parts


def test_responses_payload_converts_text_and_image_parts(monkeypatch):
    from sliderule_llm.client import _call_llm_once

    captured = _install_fake_httpx(
        monkeypatch,
        {
            "output_text": "image summary",
            "usage": {"input_tokens": 3, "output_tokens": 4, "total_tokens": 7},
            "model": "test-model",
            "status": "completed",
        },
    )

    result = _call_llm_once(
        [
            {"role": "system", "content": [{"type": "text", "text": "be concise"}]},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe this"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64,abc123", "detail": "high"},
                    },
                ],
            },
        ],
        cfg=_config(wire_api="responses", supports_image_content_parts=True),
    )

    assert result.content == "image summary"
    assert captured["url"] == "https://llm.example.test/v1/responses"
    assert captured["json"]["instructions"] == "be concise"
    assert captured["json"]["input"] == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "describe this"},
                {"type": "input_image", "image_url": "data:image/png;base64,abc123"},
            ],
        }
    ]


def test_image_parts_raise_for_unsupported_provider_before_http(monkeypatch):
    from sliderule_llm.client import _call_llm_once

    captured = _install_fake_httpx(
        monkeypatch,
        {
            "choices": [{"message": {"content": "should not happen"}, "finish_reason": "stop"}],
            "model": "test-model",
        },
    )

    with pytest.raises(LlmError, match="does not support image content parts"):
        _call_llm_once(
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "describe this"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc123"}},
                    ],
                }
            ],
            cfg=_config(),
        )

    assert captured["post_count"] == 0


def test_provider_chain_downgrades_to_image_capable_provider(monkeypatch):
    from sliderule_llm.client import call_llm

    primary = _config(supports_image_content_parts=False)
    fallback = _config(supports_image_content_parts=True)
    captured = _install_fake_httpx(
        monkeypatch,
        {
            "choices": [{"message": {"content": "fallback image summary"}, "finish_reason": "stop"}],
            "model": "test-model",
        },
    )

    monkeypatch.setattr(
        "sliderule_llm.client.build_provider_configs",
        lambda explicit=None: [("primary", primary), ("fallback", fallback)],
    )

    result = call_llm(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe this"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc123"}},
                ],
            }
        ]
    )

    assert result.content == "fallback image summary"
    assert captured["post_count"] == 1
    assert captured["json"]["messages"][0]["content"][1]["image_url"]["url"] == "data:image/png;base64,abc123"
