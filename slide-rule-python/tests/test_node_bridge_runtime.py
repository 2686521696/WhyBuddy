"""Node-bridge adapter tests for skill.invoke / mcp.call.

Exercises the strangler bridge (services/node_bridge_runtime.py) with a fake
HTTP layer — no network, no real Node backend.
"""
import os
import sys

import pytest
from urllib import error as urllib_error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import settings  # noqa: E402
from models.v5_state import V5SessionState  # noqa: E402
from services.mcp_runtime import get_mcp_runtime, set_mcp_runtime  # noqa: E402
from services.node_bridge_runtime import (  # noqa: E402
    NODE_BRIDGE_MCP_PROVENANCE,
    NODE_BRIDGE_SKILL_PROVENANCE,
    NodeBridgeMcpAdapter,
    NodeBridgeMcpDenied,
    NodeBridgeSkillAdapter,
    configure_node_bridge_runtimes,
    create_node_bridge_mcp_runtime,
    create_node_bridge_skill_runtime,
)
from services.skill_runtime import (  # noqa: E402
    SkillInvokeRequest,
    SkillNotFoundError,
    SkillRuntimeUnavailable,
    get_skill_runtime,
    set_skill_runtime,
)
from services.mcp_runtime import (  # noqa: E402
    McpAdapterUnavailable,
    McpToolInvokeRequest,
    execute_mcp_call_with_runtime,
)
from services.slide_rule_executor import execute_skill_invoke_with_runtime  # noqa: E402


class FakePost:
    def __init__(self, *, status=200, body=None, error: Exception | None = None):
        self.status = status
        self.body = body if body is not None else {}
        self.error = error
        self.calls: list[tuple[str, dict, float]] = []

    def __call__(self, url, payload, timeout_s):
        self.calls.append((url, payload, timeout_s))
        if self.error is not None:
            raise self.error
        return self.status, self.body


@pytest.fixture(autouse=True)
def _reset_runtimes():
    set_skill_runtime(None)
    set_mcp_runtime(None)
    yield
    set_skill_runtime(None)
    set_mcp_runtime(None)


def _skill_request() -> SkillInvokeRequest:
    return SkillInvokeRequest(
        skill_id="runtime.summarize",
        arguments={"topic": "bridge"},
        input="summarize the bridge",
    )


def _mcp_request() -> McpToolInvokeRequest:
    return McpToolInvokeRequest(
        server_id="server-1",
        tool_name="search",
        arguments={"q": "bridge"},
        input="search the bridge",
        session_id="sess-1",
        role_id="role-1",
        turn_id="turn-1",
    )


def test_skill_adapter_posts_to_node_execute_endpoint_and_maps_result():
    post = FakePost(status=200, body={"output": "bridged result", "runId": "r1"})
    adapter = NodeBridgeSkillAdapter(base_url="http://node.test", post=post)

    result = adapter.invoke(_skill_request())

    url, payload, _ = post.calls[0]
    assert url == "http://node.test/api/skills/runtime.summarize/execute"
    assert payload["input"]["text"] == "summarize the bridge"
    assert payload["input"]["arguments"] == {"topic": "bridge"}
    assert result.output == "bridged result"
    assert result.provenance == NODE_BRIDGE_SKILL_PROVENANCE
    assert result.response == {"output": "bridged result", "runId": "r1"}


def test_skill_adapter_maps_404_to_not_found_and_5xx_to_unavailable():
    adapter_404 = NodeBridgeSkillAdapter(
        base_url="http://node.test", post=FakePost(status=404, body={"error": "no such skill"})
    )
    with pytest.raises(SkillNotFoundError):
        adapter_404.invoke(_skill_request())

    adapter_500 = NodeBridgeSkillAdapter(
        base_url="http://node.test", post=FakePost(status=500, body={"error": "boom"})
    )
    with pytest.raises(SkillRuntimeUnavailable):
        adapter_500.invoke(_skill_request())


def test_skill_adapter_maps_connection_failure_to_unavailable():
    adapter = NodeBridgeSkillAdapter(
        base_url="http://node.test",
        post=FakePost(error=urllib_error.URLError("connection refused")),
    )
    with pytest.raises(SkillRuntimeUnavailable):
        adapter.invoke(_skill_request())


def test_mcp_adapter_posts_node_adapter_contract_and_maps_result():
    post = FakePost(
        status=200,
        body={"output": {"status": "succeeded", "text": "tool says hi"}},
    )
    adapter = NodeBridgeMcpAdapter(base_url="http://node.test", post=post)

    result = adapter.invoke(_mcp_request())

    url, payload, _ = post.calls[0]
    assert url == "http://node.test/api/mcp/nodes/execute"
    assert payload["nodeType"] == "mcp"
    assert payload["input"]["serverId"] == "server-1"
    assert payload["input"]["toolName"] == "search"
    assert isinstance(payload["input"]["input"], str) and payload["input"]["input"]
    assert result.output == "tool says hi"
    assert result.provenance == NODE_BRIDGE_MCP_PROVENANCE


def test_mcp_adapter_translates_node_denial_to_permission_denied_error():
    post = FakePost(
        status=403,
        body={"output": {"status": "denied", "reason": "policy blocked"}},
    )
    adapter = NodeBridgeMcpAdapter(base_url="http://node.test", post=post)

    with pytest.raises(NodeBridgeMcpDenied) as exc_info:
        adapter.invoke(_mcp_request())
    assert exc_info.value.error_type == "permission_denied"
    assert "policy blocked" in str(exc_info.value)


def test_mcp_adapter_maps_connection_failure_to_unavailable():
    adapter = NodeBridgeMcpAdapter(
        base_url="http://node.test",
        post=FakePost(error=urllib_error.URLError("connection refused")),
    )
    with pytest.raises(McpAdapterUnavailable):
        adapter.invoke(_mcp_request())


def test_configure_installs_runtimes_and_respects_disable_flag(monkeypatch):
    monkeypatch.setattr(settings, "NODE_BRIDGE_RUNTIME_ENABLED", False)
    assert configure_node_bridge_runtimes() is False
    assert get_skill_runtime() is None
    assert get_mcp_runtime() is None

    monkeypatch.setattr(settings, "NODE_BRIDGE_RUNTIME_ENABLED", True)
    assert configure_node_bridge_runtimes() is True
    assert get_skill_runtime() is not None
    assert get_mcp_runtime() is not None


def test_configure_does_not_override_existing_runtime_unless_forced():
    marker = create_node_bridge_skill_runtime(base_url="http://custom.test")
    set_skill_runtime(marker)

    configure_node_bridge_runtimes()
    assert get_skill_runtime() is marker  # untouched

    configure_node_bridge_runtimes(force=True)
    assert get_skill_runtime() is not marker


def _skill_state() -> V5SessionState:
    return V5SessionState(
        sessionId="bridge-skill",
        goal={
            "text": "invoke a bridged skill",
            "skillId": "runtime.summarize",
            "skillArguments": {"topic": "bridge"},
        },
        artifacts=[],
    )


def _mcp_state() -> V5SessionState:
    return V5SessionState(
        sessionId="bridge-mcp",
        goal={
            "text": "call a bridged tool",
            "mcpServerId": "server-1",
            "mcpToolName": "search",
            "mcpArguments": {"q": "bridge"},
        },
        artifacts=[],
    )


def test_executor_skill_invoke_through_bridge_is_not_degraded():
    post = FakePost(status=200, body={"output": "bridged summary"})
    runtime = create_node_bridge_skill_runtime(base_url="http://node.test", post=post)

    result = execute_skill_invoke_with_runtime(
        _skill_state(), "role-1", "turn-1", ["goal-1"], runtime=runtime
    )

    assert result.get("degraded") in (False, None)
    assert result.get("provenance") == NODE_BRIDGE_SKILL_PROVENANCE
    assert "bridged summary" in str(result.get("content") or result)


def test_executor_mcp_call_through_bridge_is_not_degraded():
    post = FakePost(status=200, body={"output": {"status": "succeeded", "text": "tool ok"}})
    runtime = create_node_bridge_mcp_runtime(base_url="http://node.test", post=post)

    result = execute_mcp_call_with_runtime(
        _mcp_state(), "role-1", "turn-1", ["goal-1"], runtime=runtime
    )

    assert result.get("degraded") is False
    assert result.get("provenance") == NODE_BRIDGE_MCP_PROVENANCE
    assert result.get("toolName") == "search"
