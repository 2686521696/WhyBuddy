import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.capability_maps import execute_mapped_capability  # noqa: E402
from services.mcp_runtime import set_mcp_runtime  # noqa: E402


@pytest.fixture(autouse=True)
def _no_mcp_runtime():
    set_mcp_runtime(None)
    yield
    set_mcp_runtime(None)


def _state() -> V5SessionState:
    return V5SessionState(
        sessionId="mcp-contract",
        goal={"text": "Collect grounding evidence for migration boundaries"},
        artifacts=[],
    )


def test_mcp_call_contract_is_explicit_unavailable_without_runtime():
    """PYTHON_AUTHORITY 契约：runtime 未配置时显式 unavailable，不做静默 RAG 冒充。"""
    result = execute_mapped_capability(
        "mcp.call",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-mcp",
    )

    assert result["toolName"] == "mcp.call"
    assert result["degraded"] is True
    assert result["error"] == "mcp_runtime_unavailable"
    assert result["degradedReason"] == "runtime_unavailable"
    assert result["provenance"] == "python-mcp-runtime"
    assert not result["provenance"].startswith("mcp:")
    assert result["sources"] == []


def test_mcp_call_contract_does_not_invent_runtime_result_fields():
    result = execute_mapped_capability(
        "mcp.call",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-mcp",
    )

    assert "toolResult" not in result
    assert "permission" not in result
