"""Real runtime boundary tests for mcp.call.

The fake adapter here is only a local test double. These tests verify the
Python runtime boundary shape without opening a real external MCP connection.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.capability_maps import execute_mapped_capability  # noqa: E402
from services.mcp_runtime import (  # noqa: E402
    MCP_RUNTIME_NAME,
    MCP_RUNTIME_PROVENANCE,
    PERMISSION_PROVENANCE,
    McpAdapterUnavailable,
    McpPermissionDecision,
    McpToolInvokeRequest,
    McpToolInvokeResult,
    create_mcp_runtime,
    execute_mcp_call_with_runtime,
    set_mcp_runtime,
)


class RecordingMcpAdapter:
    def __init__(self, *, error=None):
        self.error = error
        self.calls: list[McpToolInvokeRequest] = []

    def invoke(self, request: McpToolInvokeRequest) -> McpToolInvokeResult:
        self.calls.append(request)
        if self.error:
            raise self.error
        return McpToolInvokeResult(
            output=f"adapter result for {request.arguments['query']}",
            response={
                "serverId": request.server_id,
                "toolName": request.tool_name,
                "query": request.arguments["query"],
            },
        )


class FixedPermissionChecker:
    def __init__(self, decision: McpPermissionDecision):
        self.decision = decision
        self.calls = []

    def check(self, request):
        self.calls.append(request)
        return self.decision


@pytest.fixture(autouse=True)
def _reset_mcp_runtime():
    set_mcp_runtime(None)
    yield
    set_mcp_runtime(None)


def _state(**goal_overrides) -> V5SessionState:
    goal = {
        "text": "Call a replaceable MCP runtime adapter",
        "mcpServerId": "runtime-server",
        "mcpToolName": "knowledge.search",
        "mcpArguments": {"query": "runtime adapter boundary"},
    }
    goal.update(goal_overrides)
    return V5SessionState(
        sessionId="mcp-real-runtime",
        goal=goal,
        artifacts=[],
    )


def _runtime(adapter, decision):
    permission_checker = FixedPermissionChecker(decision)
    return (
        create_mcp_runtime(
            adapter=adapter,
            permission_checker=permission_checker,
        ),
        permission_checker,
    )


def test_real_runtime_success_returns_python_runtime_and_provenance_shape():
    adapter = RecordingMcpAdapter()
    runtime, permission_checker = _runtime(
        adapter,
        McpPermissionDecision(allowed=True, reason="fixture permission grant"),
    )
    set_mcp_runtime(runtime)

    result = execute_mapped_capability(
        "mcp.call",
        _state(),
        ["artifact-1"],
        "grounding",
        "turn-real-runtime",
    )

    assert result["runtime"] == MCP_RUNTIME_NAME
    assert result["runtimeProvenance"] == MCP_RUNTIME_PROVENANCE
    assert result["provenance"] == MCP_RUNTIME_PROVENANCE
    assert result["degraded"] is False
    assert result["toolName"] == "knowledge.search"
    assert result["serverId"] == "runtime-server"
    assert result["arguments"] == {"query": "runtime adapter boundary"}
    assert result["toolResult"] == {
        "serverId": "runtime-server",
        "toolName": "knowledge.search",
        "query": "runtime adapter boundary",
    }
    assert result["permission"] == {
        "allowed": True,
        "provenance": PERMISSION_PROVENANCE,
        "reason": "fixture permission grant",
    }
    assert result["sources"] == []
    assert not result["provenance"].startswith("mcp:")

    assert len(permission_checker.calls) == 1
    assert len(adapter.calls) == 1
    permission_request = permission_checker.calls[0]
    adapter_request = adapter.calls[0]
    assert permission_request.session_id == "mcp-real-runtime"
    assert permission_request.role_id == "grounding"
    assert permission_request.turn_id == "turn-real-runtime"
    assert permission_request.input_artifact_ids == ("artifact-1",)
    assert adapter_request.session_id == "mcp-real-runtime"
    assert adapter_request.role_id == "grounding"
    assert adapter_request.turn_id == "turn-real-runtime"
    assert adapter_request.input_artifact_ids == ("artifact-1",)


def test_real_runtime_permission_denied_never_invokes_adapter():
    adapter = RecordingMcpAdapter()
    runtime, permission_checker = _runtime(
        adapter,
        McpPermissionDecision(
            allowed=False,
            reason="role cannot call knowledge.search",
            details={"policy": "mcp.call:deny"},
        ),
    )

    result = execute_mcp_call_with_runtime(
        _state(),
        "grounding",
        "turn-denied",
        ["artifact-1"],
        runtime=runtime,
    )

    assert result["runtime"] == MCP_RUNTIME_NAME
    assert result["runtimeProvenance"] == MCP_RUNTIME_PROVENANCE
    assert result["provenance"] == PERMISSION_PROVENANCE
    assert result["degraded"] is True
    assert result["error"] == "mcp_permission_denied"
    assert result["errorType"] == "permission_denied"
    assert result["toolName"] == "knowledge.search"
    assert result["serverId"] == "runtime-server"
    assert result["arguments"] == {"query": "runtime adapter boundary"}
    assert result["permission"] == {
        "allowed": False,
        "provenance": PERMISSION_PROVENANCE,
        "reason": "role cannot call knowledge.search",
        "details": {"policy": "mcp.call:deny"},
    }
    assert "toolResult" not in result
    assert len(permission_checker.calls) == 1
    assert adapter.calls == []


def test_real_runtime_adapter_error_has_stable_error_type():
    adapter = RecordingMcpAdapter(error=McpAdapterUnavailable("runtime adapter offline"))
    runtime, permission_checker = _runtime(
        adapter,
        McpPermissionDecision(allowed=True, reason="fixture permission grant"),
    )

    result = execute_mcp_call_with_runtime(
        _state(),
        "grounding",
        "turn-error",
        ["artifact-1"],
        runtime=runtime,
    )

    assert result["runtime"] == MCP_RUNTIME_NAME
    assert result["runtimeProvenance"] == MCP_RUNTIME_PROVENANCE
    assert result["provenance"] == MCP_RUNTIME_PROVENANCE
    assert result["degraded"] is True
    assert result["error"] == "mcp_adapter_unavailable"
    assert result["errorType"] == "adapter_unavailable"
    assert result["content"] == "runtime adapter offline"
    assert result["permission"]["allowed"] is True
    assert "toolResult" not in result
    assert len(permission_checker.calls) == 1
    assert len(adapter.calls) == 1
