"""Focused Python runtime boundary tests for A2A stream envelopes.

This slice validates deterministic projection only. It must not start CrewAI,
LangGraph, Claude, external HTTP agents, registry persistence, or real stream
transport.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.a2a_runtime import (  # noqa: E402
    A2A_ERROR_CANCELLED,
    A2A_ERROR_FRAMEWORK,
    project_a2a_runtime_contract,
)


def _params() -> dict:
    return {
        "targetAgent": "stream-boundary-agent",
        "task": "Project a stream runtime envelope",
        "context": "Runtime boundary only.",
        "capabilities": ["stream"],
        "streamMode": True,
    }


def _envelope(method: str = "a2a.stream") -> dict:
    return {
        "jsonrpc": "2.0",
        "method": method,
        "id": "a2a-stream-boundary-1",
        "params": _params(),
        "auth": "stream-token",
    }


def test_running_stream_chunk_stays_running_and_preserves_identity():
    result = project_a2a_runtime_contract(
        {
            "operation": "stream_chunk",
            "envelope": _envelope(),
            "frameworkType": "custom",
            "chunk": "first partial chunk",
            "done": False,
            "startedAt": 1710000000000,
        }
    ).model_dump(exclude_none=True)

    assert result["operation"] == "stream_chunk"
    assert result["ok"] is True
    assert result["status"] == "streaming"
    assert result["status"] != "completed"
    assert result["envelope"]["id"] == "a2a-stream-boundary-1"
    assert result["streamChunk"] == {
        "jsonrpc": "2.0",
        "id": "a2a-stream-boundary-1",
        "chunk": "first partial chunk",
        "done": False,
    }
    assert result["session"]["sessionId"] == "a2a-stream-boundary-1"
    assert result["session"]["requestEnvelope"]["id"] == "a2a-stream-boundary-1"
    assert result["session"]["status"] == "running"
    assert "completedAt" not in result["session"]
    assert result["session"]["streamChunks"] == [result["streamChunk"]]


def test_done_stream_chunk_completes_session_without_response_envelope():
    result = project_a2a_runtime_contract(
        {
            "operation": "stream_chunk",
            "envelope": _envelope(),
            "frameworkType": "custom",
            "chunk": "",
            "done": True,
            "startedAt": 1710000000000,
            "completedAt": 1710000000002,
        }
    ).model_dump(exclude_none=True)

    assert result["operation"] == "stream_chunk"
    assert result["ok"] is True
    assert result["status"] == "completed"
    assert result["streamChunk"]["done"] is True
    assert result["streamChunk"]["id"] == "a2a-stream-boundary-1"
    assert result["session"]["sessionId"] == "a2a-stream-boundary-1"
    assert result["session"]["status"] == "completed"
    assert result["session"]["completedAt"] == 1710000000002
    assert "response" not in result["session"]


def test_failed_stream_chunk_projects_error_response_and_failed_session():
    error = {
        "code": A2A_ERROR_FRAMEWORK,
        "message": "Python stream runtime boundary failed.",
        "data": {"phase": "stream"},
    }
    result = project_a2a_runtime_contract(
        {
            "operation": "stream_chunk",
            "envelope": _envelope(),
            "frameworkType": "custom",
            "status": "failed",
            "error": error,
            "startedAt": 1710000000000,
            "completedAt": 1710000000003,
        }
    ).model_dump(exclude_none=True)

    assert result["operation"] == "stream_chunk"
    assert result["ok"] is False
    assert result["status"] == "failed"
    assert result["status"] != "completed"
    assert result["error"] == error
    assert result["response"] == {
        "jsonrpc": "2.0",
        "id": "a2a-stream-boundary-1",
        "error": error,
    }
    assert result["session"]["sessionId"] == "a2a-stream-boundary-1"
    assert result["session"]["requestEnvelope"]["id"] == "a2a-stream-boundary-1"
    assert result["session"]["status"] == "failed"
    assert result["session"]["response"] == result["response"]
    assert result["session"]["streamChunks"] == []


def test_cancelled_stream_boundary_uses_cancel_error_and_never_completes():
    result = project_a2a_runtime_contract(
        {
            "operation": "cancel",
            "sessionId": "a2a-stream-boundary-1",
            "envelope": _envelope("a2a.cancel"),
            "frameworkType": "custom",
            "startedAt": 1710000000000,
            "completedAt": 1710000000004,
        }
    ).model_dump(exclude_none=True)

    assert result["operation"] == "cancel"
    assert result["ok"] is False
    assert result["status"] == "cancelled"
    assert result["status"] != "completed"
    assert result["error"] == {
        "code": A2A_ERROR_CANCELLED,
        "message": "A2A session cancelled.",
    }
    assert result["response"] == {
        "jsonrpc": "2.0",
        "id": "a2a-stream-boundary-1",
        "error": result["error"],
    }
    assert result["session"]["sessionId"] == "a2a-stream-boundary-1"
    assert result["session"]["requestEnvelope"]["id"] == "a2a-stream-boundary-1"
    assert result["session"]["status"] == "cancelled"
    assert result["session"]["response"] == result["response"]
