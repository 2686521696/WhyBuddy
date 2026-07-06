import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.capability_maps import execute_mapped_capability  # noqa: E402
from services.skill_runtime import set_skill_runtime  # noqa: E402


@pytest.fixture(autouse=True)
def _no_skill_runtime():
    set_skill_runtime(None)
    yield
    set_skill_runtime(None)


def _state() -> V5SessionState:
    return V5SessionState(
        sessionId="skill-contract",
        goal={"text": "Run a skill-like synthesis boundary check"},
        artifacts=[],
    )


def test_skill_invoke_contract_is_explicit_unavailable_without_runtime():
    """PYTHON_AUTHORITY 契约：runtime 未配置时显式 unavailable，不做静默 RAG 冒充。"""
    result = execute_mapped_capability(
        "skill.invoke",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-skill",
    )

    assert result["skillId"] == "skill.invoke"
    assert result["degraded"] is True
    assert result["error"] == "skill_runtime_unavailable"
    assert result["degradedReason"] == "runtime_unavailable"
    assert result["provenance"] == "python-fake-skill"
    assert not result["provenance"].startswith("skill:")
    assert result["sources"] == []


def test_skill_invoke_contract_does_not_invent_runtime_result_fields():
    result = execute_mapped_capability(
        "skill.invoke",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-skill",
    )

    assert "skillResult" not in result
    assert "registryResult" not in result
