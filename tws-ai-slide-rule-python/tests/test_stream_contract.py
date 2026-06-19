import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import (  # noqa: E402
    LlmStreamEvent,
    iter_stream_events_from_sse,
    parse_sse,
)


def test_parse_sse_groups_event_and_multiline_data():
    events = parse_sse("event: delta\ndata: hello\ndata: world\n\n")

    assert len(events) == 1
    assert events[0].event == "delta"
    assert events[0].data == "hello\nworld"


def test_responses_stream_contract_emits_chunks_and_done_with_telemetry():
    raw = "\n\n".join(
        [
            'data: {"type":"response.output_text.delta","delta":"Hello ","model":"gpt-test"}',
            'data: {"type":"response.output_text.delta","delta":"world"}',
            'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3},"status":"completed"}}',
            "data: [DONE]",
        ]
    )

    events = list(
        iter_stream_events_from_sse(
            raw,
            wire="responses",
            model="gpt-test",
            provider="fake-provider",
            started=1000.0,
            now=lambda: 1000.042,
        )
    )

    assert [event.kind for event in events] == ["chunk", "chunk", "done"]
    assert [event.delta for event in events[:2]] == ["Hello ", "world"]
    done = events[-1]
    assert done.result is not None
    assert done.result.content == "Hello world"
    assert done.result.usage == {"total_tokens": 5, "prompt_tokens": 2, "completion_tokens": 3}
    assert done.result.provider == "fake-provider"
    assert done.result.telemetry["latency_ms"] == 42


def test_chat_stream_contract_emits_chunks_and_finish_reason():
    raw = "\n\n".join(
        [
            'data: {"choices":[{"delta":{"content":"Hi "}}],"model":"chat-test"}',
            'data: {"choices":[{"delta":{"content":"there"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}',
            "data: [DONE]",
        ]
    )

    events = list(
        iter_stream_events_from_sse(
            raw,
            wire="chat",
            model="chat-test",
            provider="fake-provider",
            started=2000.0,
            now=lambda: 2000.01,
        )
    )

    assert [event.kind for event in events] == ["chunk", "chunk", "done"]
    assert events[-1].result is not None
    assert events[-1].result.content == "Hi there"
    assert events[-1].result.finish_reason == "stop"


def test_stream_contract_emits_error_on_empty_content():
    events = list(
        iter_stream_events_from_sse(
            "data: [DONE]",
            wire="responses",
            model="gpt-test",
            provider="fake-provider",
            started=1.0,
            now=lambda: 1.0,
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], LlmStreamEvent)
    assert events[0].kind == "error"
    assert events[0].failure_kind == "unknown"
    assert events[0].error is not None
    assert "empty content" in str(events[0].error)


def test_stream_contract_emits_error_on_responses_completed_error():
    raw = 'data: {"type":"response.completed","response":{"error":{"message":"bad auth"}}}'

    events = list(
        iter_stream_events_from_sse(
            raw,
            wire="responses",
            model="gpt-test",
            provider="fake-provider",
            started=1.0,
            now=lambda: 1.0,
        )
    )

    assert len(events) == 1
    assert events[0].kind == "error"
    assert events[0].failure_kind == "auth"
