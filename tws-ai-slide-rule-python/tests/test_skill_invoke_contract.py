import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.capability_maps import execute_mapped_capability  # noqa: E402


def _state() -> V5SessionState:
    return V5SessionState(
        sessionId="skill-contract",
        goal={"text": "Run a skill-like synthesis boundary check"},
        artifacts=[],
    )


def test_skill_invoke_contract_marks_current_path_as_python_rag_fallback_not_real_skill():
    result = execute_mapped_capability(
        "skill.invoke",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-skill",
    )

    assert result["skillName"] == "skill.invoke"
    assert result["provenance"] == "python-rag"
    assert not result["provenance"].startswith("skill:")
    assert result.get("degraded") in (False, None)
    assert isinstance(result.get("sources"), list)
    assert result["sources"], "fallback path should expose its keyword/RAG sources honestly"


def test_skill_invoke_contract_does_not_invent_registry_runtime_fields():
    result = execute_mapped_capability(
        "skill.invoke",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-skill",
    )

    assert "skillId" not in result
    assert "skillResult" not in result
    assert "registryResult" not in result
