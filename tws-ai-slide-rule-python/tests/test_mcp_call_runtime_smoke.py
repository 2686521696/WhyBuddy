"""Runtime smoke tests for injectable fake MCP adapter wiring.

These tests prove mcp.call can reach a tool adapter through an injected runtime
entry point. Fakes stay outside production wiring; no real MCP server is used.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.capability_maps import execute_mapped_capability  # noqa: E402
from services.slide_rule_executor import (  # noqa: E402
    MCP_RUNTIME_NAME,
    MCP_RUNTIME_PROVENANCE,
    McpAdapterUnavailable,
    McpPermissionDecision,
    McpToolInvokeRequest,
    McpToolInvokeResult,
    McpToolNotFoundError,
    create_mcp_runtime,
    execute_mcp_call_with_runtime,
    set_mcp_runtime,
)


class FakeMcpAdapter:
    """Test fake only: exercises runtime wiring without network access."""

    def __init__(self, *, unavailable: bool = False, tools: dict | None = None):
        self._unavailable = unavailable
        self._tools = tools or {
            "search": lambda request: McpToolInvokeResult(
                output=f"fixture hit for {request.arguments.get('query', 'default')}",
                response={"hits": ["doc-runtime-1"], "serverId": request.server_id},
            )
        }
        self.calls: list[McpToolInvokeRequest] = []

    def invoke(self, request: McpToolInvokeRequest) -> McpToolInvokeResult:
        self.calls.append(request)
        if self._unavailable:
            raise McpAdapterUnavailable("fake adapter offline")
        handler = self._tools.get(request.tool_name)
        if handler is None:
            raise McpToolNotFoundError(f"unknown tool: {request.tool_name}")
        return handler(request)


class AllowMcpPermissionChecker:
    def __init__(self):
        self.calls = []

    def check(self, request):
        self.calls.append(request)
        return McpPermissionDecision(allowed=True, reason="test fixture allow")


@pytest.fixture(autouse=True)
def _reset_mcp_runtime():
    set_mcp_runtime(None)
    yield
    set_mcp_runtime(None)


def _state(**goal_overrides) -> V5SessionState:
    goal = {
        "text": "Collect migration evidence through a fake MCP tool call",
        "mcpServerId": "fake-server",
        "mcpToolName": "search",
        "mcpArguments": {"query": "migration boundaries"},
    }
    goal.update(goal_overrides)
    return V5SessionState(
        sessionId="mcp-runtime-smoke",
        goal=goal,
        artifacts=[],
    )


def test_runtime_smoke_fake_adapter_returns_explicit_tool_result():
    adapter = FakeMcpAdapter()
    permission_checker = AllowMcpPermissionChecker()
    set_mcp_runtime(
        create_mcp_runtime(
            adapter=adapter,
            permission_checker=permission_checker,
        )
    )

    result = execute_mapped_capability(
        "mcp.call",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-mcp-runtime",
    )

    assert result["runtime"] == MCP_RUNTIME_NAME
    assert result["runtimeProvenance"] == MCP_RUNTIME_PROVENANCE
    assert result["provenance"] == MCP_RUNTIME_PROVENANCE
    assert not result["provenance"].startswith("mcp:")
    assert result["degraded"] is False
    assert result["toolName"] == "search"
    assert result["serverId"] == "fake-server"
    assert result["arguments"] == {"query": "migration boundaries"}
    assert result["toolResult"] == {
        "hits": ["doc-runtime-1"],
        "serverId": "fake-server",
    }
    assert result["content"] == "fixture hit for migration boundaries"
    assert result["permission"]["allowed"] is True
    assert adapter.calls[0].tool_name == "search"
    assert adapter.calls[0].server_id == "fake-server"
    assert permission_checker.calls[0].tool_name == "search"


def test_runtime_smoke_adapter_unavailable_has_stable_degraded_shape():
    adapter = FakeMcpAdapter(unavailable=True)
    runtime = create_mcp_runtime(
        adapter=adapter,
        permission_checker=AllowMcpPermissionChecker(),
    )

    result = execute_mcp_call_with_runtime(
        _state(),
        "grounding",
        "turn-mcp-runtime",
        ["goal-1"],
        runtime=runtime,
    )

    assert result["runtime"] == MCP_RUNTIME_NAME
    assert result["runtimeProvenance"] == MCP_RUNTIME_PROVENANCE
    assert result["provenance"] == MCP_RUNTIME_PROVENANCE
    assert not result["provenance"].startswith("mcp:")
    assert result["degraded"] is True
    assert result["error"] == "mcp_adapter_unavailable"
    assert result["errorType"] == "adapter_unavailable"
    assert result["toolName"] == "search"
    assert result["serverId"] == "fake-server"
    assert "toolResult" not in result


def test_runtime_smoke_unknown_tool_has_stable_degraded_shape():
    adapter = FakeMcpAdapter(tools={})
    runtime = create_mcp_runtime(
        adapter=adapter,
        permission_checker=AllowMcpPermissionChecker(),
    )

    result = execute_mcp_call_with_runtime(
        _state(mcpToolName="missing-tool"),
        "grounding",
        "turn-mcp-runtime",
        ["goal-1"],
        runtime=runtime,
    )

    assert result["runtime"] == MCP_RUNTIME_NAME
    assert result["runtimeProvenance"] == MCP_RUNTIME_PROVENANCE
    assert result["provenance"] == MCP_RUNTIME_PROVENANCE
    assert not result["provenance"].startswith("mcp:")
    assert result["degraded"] is True
    assert result["error"] == "mcp_tool_not_found"
    assert result["errorType"] == "tool_not_found"
    assert result["toolName"] == "missing-tool"
    assert result["serverId"] == "fake-server"
    assert result["arguments"] == {"query": "migration boundaries"}
    assert "toolResult" not in result
