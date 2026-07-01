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
    A2A_RUNTIME_CONTRACT_VERSION,
    create_a2a_error,
    project_a2a_runtime_contract,
    start_a2a_stream_session,
    emit_a2a_stream_chunk,
    cancel_a2a_transport,
    check_a2a_stream_timeout,
    get_a2a_retry_envelope,
    handle_malformed_a2a_chunk,
    get_a2a_session,
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


# --- 105 transport takeover tests: exercise Python-owned stream chunks, cancel, timeout, malformed ---
# These lock ordering, idempotency, timeout, malformed directly on runtime funcs (Node is thin proxy).
import time as _time


def _mk_stream_envelope(sid: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "method": "a2a.stream",
        "id": sid,
        "params": {
            "targetAgent": "transport-105-agent",
            "task": "stream test",
            "context": "",
            "capabilities": [],
            "streamMode": True,
        },
        "auth": None,
    }


def test_emit_stream_chunks_ordering_and_done_status():
    sid = f"stream-order-105-{_time.time_ns()}"
    start_a2a_stream_session(_mk_stream_envelope(sid))
    r1 = emit_a2a_stream_chunk(sid, "first")
    r2 = emit_a2a_stream_chunk(sid, "second")
    r3 = emit_a2a_stream_chunk(sid, "", done=True)
    assert r1["ok"] is True and r1["status"] == "streaming"
    assert r2["ok"] is True and r2["status"] == "streaming"
    assert r3["ok"] is True and r3["status"] == "completed"
    # Python provenance for task 47 stream/event transport (PYTHON_FIRST_COMPAT)
    assert r1.get("runtime") == "python-contract" and r1.get("contractVersion") == "a2a.runtime.v1"
    assert r3.get("runtime") == "python-contract"
    sess = get_a2a_session(sid)
    assert sess is not None
    assert len(sess.get("streamChunks", [])) == 3
    assert sess["streamChunks"][0]["chunk"] == "first"
    assert sess["streamChunks"][1]["chunk"] == "second"
    assert sess["streamChunks"][2]["done"] is True
    assert sess["status"] == "completed"


def test_cancel_idempotency_no_reupdate():
    sid = f"cancel-idem-105-{_time.time_ns()}"
    start_a2a_stream_session(_mk_stream_envelope(sid))
    c1 = cancel_a2a_transport(sid)
    t1 = (c1.get("session") or {}).get("completedAt")
    c2 = cancel_a2a_transport(sid)
    assert c1["status"] == "cancelled" and c2["status"] == "cancelled"
    assert c1.get("runtime") == "python-contract" and c1.get("contractVersion") == "a2a.runtime.v1"
    t2 = (c2.get("session") or {}).get("completedAt")
    assert t2 == t1  # idempotent: no side-effect re-update
    sess = get_a2a_session(sid)
    assert sess["status"] == "cancelled"


def test_timeout_check_and_malformed_chunk():
    sid = f"timeout-mal-105-{_time.time_ns()}"
    start_a2a_stream_session(_mk_stream_envelope(sid))
    # timeout on active returns active (or may timeout if artificial now)
    to = check_a2a_stream_timeout(sid, 60000)
    assert "ok" in to and to["status"] in ("active", "failed")
    assert to.get("runtime") == "python-contract"
    # malformed non-str chunk
    bad = emit_a2a_stream_chunk(sid, 12345)  # type: ignore[arg-type]
    assert bad["ok"] is False
    assert "Malformed stream chunk" in (bad.get("error") or {}).get("message", "")
    assert bad.get("runtime") == "python-contract"
    # explicit malformed handler
    m = handle_malformed_a2a_chunk(sid, "test malformed")
    assert m["ok"] is False and m["status"] == "failed"
    assert m.get("runtime") == "python-contract"
    sess = get_a2a_session(sid)
    assert sess is not None and sess.get("status") == "failed"
    # retry envelope
    ret = get_a2a_retry_envelope(sid, 2)
    assert ret["ok"] is True and ret["retry"]["attempt"] == 2
    assert ret.get("runtime") == "python-contract"


def test_create_a2a_error_central_factory_task48():
    """Direct coverage for task 48: Python-owned central error factory used by cancel/retry/malformed/timeout."""
    err_cancel = create_a2a_error(A2A_ERROR_CANCELLED, "A2A session cancelled.")
    assert err_cancel == {"code": A2A_ERROR_CANCELLED, "message": "A2A session cancelled."}
    err_with_data = create_a2a_error(A2A_ERROR_FRAMEWORK, "Session timed out", {"timeoutMs": 60000})
    assert err_with_data["code"] == A2A_ERROR_FRAMEWORK
    assert err_with_data["message"] == "Session timed out"
    assert err_with_data["data"] == {"timeoutMs": 60000}

    # Verify transport funcs use factory shape (task 48 error/retry/cancel)
    sid = f"err-factory-105-{_time.time_ns()}"
    start_a2a_stream_session(_mk_stream_envelope(sid))
    c = cancel_a2a_transport(sid)
    assert c.get("error") == err_cancel or c.get("error") == {"code": A2A_ERROR_CANCELLED, "message": "A2A session cancelled."}
    assert c.get("runtime") == "python-contract"
    assert c.get("contractVersion") == A2A_RUNTIME_CONTRACT_VERSION

    m = handle_malformed_a2a_chunk(sid, "factory test")
    assert m.get("error", {}).get("code") == A2A_ERROR_FRAMEWORK
    assert "Malformed A2A chunk" in m.get("error", {}).get("message", "")
    assert m.get("runtime") == "python-contract"
