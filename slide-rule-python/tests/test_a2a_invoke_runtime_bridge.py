"""Runtime bridge tests for the Python-side A2A invoke/list/cancel slice."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.a2a_runtime import (  # noqa: E402
    A2A_ERROR_CANCELLED,
    A2A_RUNTIME_CONTRACT_VERSION,
    cancel_a2a_runtime_bridge,
    invoke_a2a_runtime_bridge,
    invoke_external_a2a_agent,
    list_a2a_runtime_agents,
)


def _params() -> dict:
    return {
        "targetAgent": "bridge-agent",
        "task": "Bridge the A2A invoke result",
        "context": "Runtime bridge test.",
        "capabilities": ["summarize"],
        "streamMode": False,
    }


def _envelope(method: str = "a2a.invoke") -> dict:
    return {
        "jsonrpc": "2.0",
        "method": method,
        "id": "a2a-bridge-1",
        "params": _params(),
        "auth": "bridge-token",
    }


def _agent() -> dict:
    return {
        "id": "bridge-agent",
        "name": "Bridge Agent",
        "capabilities": ["summarize"],
        "description": "Deterministic A2A bridge fixture, not a real agent.",
    }


def test_invoke_bridge_returns_completed_session_without_external_agent():
    result = invoke_a2a_runtime_bridge(
        envelope=_envelope(),
        output="Bridge response.",
        framework_type="custom",
        metadata={"source": "bridge-test"},
        started_at=1710000000000,
        completed_at=1710000000001,
    ).model_dump(exclude_none=True)

    assert result["contractVersion"] == A2A_RUNTIME_CONTRACT_VERSION
    assert result["runtime"] == "python-contract"
    assert result["operation"] == "invoke"
    assert result["ok"] is True
    assert result["status"] == "completed"
    assert result["response"]["result"]["output"] == "Bridge response."
    assert result["response"]["result"]["metadata"] == {"source": "bridge-test"}
    assert result["session"]["status"] == "completed"
    assert result["session"]["requestEnvelope"] == result["envelope"]
    assert result["session"]["response"] == result["response"]


def test_invoke_bridge_preserves_failure_as_failed_not_completed():
    result = invoke_a2a_runtime_bridge(
        envelope=_envelope(),
        framework_type="custom",
        error={
            "code": -32006,
            "message": "Python A2A bridge failed.",
            "data": {"retryable": False},
        },
    ).model_dump(exclude_none=True)

    assert result["ok"] is False
    assert result["status"] == "failed"
    assert "result" not in result["response"]
    assert result["response"]["error"]["message"] == "Python A2A bridge failed."
    assert result["session"]["status"] == "failed"


def test_list_agents_bridge_returns_completed_agent_inventory():
    result = list_a2a_runtime_agents([_agent()]).model_dump(exclude_none=True)

    assert result == {
        "contractVersion": A2A_RUNTIME_CONTRACT_VERSION,
        "runtime": "python-contract",
        "operation": "list_agents",
        "ok": True,
        "status": "completed",
        "agents": [_agent()],
    }


def test_cancel_bridge_returns_cancelled_error_not_completed():
    result = cancel_a2a_runtime_bridge(
        envelope=_envelope("a2a.cancel"),
        session_id="a2a-bridge-1",
        framework_type="custom",
    ).model_dump(exclude_none=True)

    assert result["ok"] is False
    assert result["status"] == "cancelled"
    assert result["error"]["code"] == A2A_ERROR_CANCELLED
    assert result["response"]["error"] == result["error"]
    assert result["session"]["status"] == "cancelled"
    assert "result" not in result["response"]


# --- Tests for Python external agent invoke provider (105) ---
# Covers required: missing endpoint, provider failure, success, permission metadata, no-key degraded mode.


def test_external_invoke_missing_endpoint_returns_error():
    env = _envelope()
    res = invoke_external_a2a_agent(env, endpoint=None, auth="k", framework_type="custom")
    assert res.get("ok") is False
    err = (res.get("response") or {}).get("error") or {}
    assert err.get("message") == "Missing external agent endpoint"
    assert (err.get("data") or {}).get("missing_endpoint") is True


def test_external_invoke_no_key_degraded_mode():
    env = _envelope()
    res = invoke_external_a2a_agent(env, endpoint="http://example.invalid/a2a", auth=None, framework_type="custom")
    assert res.get("ok") is True
    assert res.get("degraded") is True
    result = (res.get("response") or {}).get("result") or {}
    meta = result.get("metadata") or {}
    assert meta.get("degraded") is True
    assert meta.get("mode") == "no-key"
    assert meta.get("permission") == "limited"
    assert "permissionMetadata" in res or "permission" in meta


def test_external_invoke_success_path_has_permission_metadata(monkeypatch):
    """Stub the urllib call to prove success path + permission metadata under Python-owned contract."""
    import json as _json
    import urllib.request as _urllib_request

    class _FakeResponse:
        def __init__(self, data: bytes):
            self._data = data
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def read(self):
            return self._data

    def _fake_urlopen(req, timeout=30):
        # simulate external A2A success payload
        payload = {"result": "external success output", "meta": "ok"}
        return _FakeResponse(_json.dumps(payload).encode("utf-8"))

    monkeypatch.setattr(_urllib_request, "urlopen", _fake_urlopen)

    env = _envelope()
    res = invoke_external_a2a_agent(env, endpoint="http://stub.local/a2a", auth="tok", framework_type="custom")
    assert res.get("ok") is True
    resp = res.get("response") or {}
    result = resp.get("result") or {}
    assert "external success output" in result.get("output", "")
    meta = result.get("metadata") or {}
    assert meta.get("permission") == "granted"
    assert meta.get("framework") == "custom"
    # no degraded on real success
    assert res.get("degraded") is not True


def test_external_invoke_provider_failure_is_visible():
    env = _envelope()
    res = invoke_external_a2a_agent(env, endpoint="http://127.0.0.1:1/bad", auth="k", framework_type="crewai")
    assert res.get("ok") is False
    resp_err = (res.get("response") or {}).get("error") or {}
    assert resp_err.get("code") == -32006 or "provider_failure" in str((resp_err.get("data") or {}))
    assert res.get("degraded") is True or "degraded" in str(res)
