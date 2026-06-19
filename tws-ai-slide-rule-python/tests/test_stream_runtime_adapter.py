import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import (  # noqa: E402
    LlmStreamEvent,
    SSEEvent,
    iter_stream_events_from_sse_source,
)


def _fake_sse_source(*events: SSEEvent):
    for event in events:
        yield event


def test_runtime_adapter_maps_fake_sse_source_to_chunks_and_done(monkeypatch):
    def fail_on_network(*args, **kwargs):
        raise AssertionError("runtime adapter must not open an HTTP client")

    monkeypatch.setattr("sliderule_llm.client.httpx.Client", fail_on_network)

    events = list(
        iter_stream_events_from_sse_source(
            _fake_sse_source(
                SSEEvent(
                    event="response.output_text.delta",
                    data='{"type":"response.output_text.delta","delta":"Hello ","model":"gpt-test"}',
                ),
                SSEEvent(
                    event="response.output_text.delta",
                    data='{"type":"response.output_text.delta","delta":"runtime"}',
                ),
                SSEEvent(
                    event="response.completed",
                    data=(
                        '{"type":"response.completed",'
                        '"response":{"status":"completed","usage":{"input_tokens":4,"output_tokens":5}}}'
                    ),
                ),
                SSEEvent(event=None, data="[DONE]"),
            ),
            wire="responses",
            model="gpt-test",
            provider="fake-provider",
            started=10.0,
            now=lambda: 10.025,
        )
    )

    assert [event.kind for event in events] == ["chunk", "chunk", "done"]
    assert [event.delta for event in events[:2]] == ["Hello ", "runtime"]

    done = events[-1]
    assert isinstance(done, LlmStreamEvent)
    assert done.delta == ""
    assert done.error is None
    assert done.result is not None
    assert done.result.content == "Hello runtime"
    assert done.result.usage == {"total_tokens": 9, "prompt_tokens": 4, "completion_tokens": 5}
    assert done.result.provider == "fake-provider"
    assert done.result.telemetry["latency_ms"] == 25


def test_runtime_adapter_emits_error_event_without_converting_it_to_chunk():
    events = list(
        iter_stream_events_from_sse_source(
            _fake_sse_source(
                SSEEvent(
                    event="error",
                    data='{"error":{"message":"rate limit exceeded","status":429}}',
                ),
                SSEEvent(
                    event="response.output_text.delta",
                    data='{"type":"response.output_text.delta","delta":"should not appear"}',
                ),
            ),
            wire="responses",
            model="gpt-test",
            provider="fake-provider",
            started=20.0,
            now=lambda: 20.0,
        )
    )

    assert len(events) == 1
    event = events[0]
    assert event.kind == "error"
    assert event.delta == ""
    assert event.result is None
    assert event.error is not None
    assert str(event.error) == "rate limit exceeded"
    assert event.error.status == 429
    assert event.failure_kind == "rate_limit"


def test_runtime_adapter_preserves_completed_response_error_shape():
    events = list(
        iter_stream_events_from_sse_source(
            _fake_sse_source(
                SSEEvent(
                    event="response.completed",
                    data='{"type":"response.completed","response":{"error":{"message":"bad auth"}}}',
                )
            ),
            wire="responses",
            model="gpt-test",
            provider="fake-provider",
            started=30.0,
            now=lambda: 30.0,
        )
    )

    assert len(events) == 1
    assert events[0].kind == "error"
    assert events[0].delta == ""
    assert events[0].result is None
    assert events[0].error is not None
    assert "bad auth" in str(events[0].error)
    assert events[0].failure_kind == "auth"
