"""Real runtime-boundary tests for skill.invoke.

These tests exercise the injectable SkillRuntime adapter contract without
calling real local commands, skill marketplaces, or external services.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.capability_maps import execute_mapped_capability  # noqa: E402
from services.skill_runtime import (  # noqa: E402
    SkillInvokeDeniedError,
    SkillInvokeRequest,
    SkillInvokeResult,
    SkillNotFoundError,
    SkillRuntimeAdapter,
    SkillRuntimeError,
    create_skill_runtime,
    set_skill_runtime,
)
from services.slide_rule_executor import execute_skill_invoke_with_runtime  # noqa: E402


class TrackingSkillAdapter(SkillRuntimeAdapter):
    def __init__(self, *, response: SkillInvokeResult | None = None, error: Exception | None = None):
        self.response = response
        self.error = error
        self.calls: list[SkillInvokeRequest] = []

    def invoke(self, request: SkillInvokeRequest) -> SkillInvokeResult:
        self.calls.append(request)
        if self.error is not None:
            raise self.error
        if self.response is None:
            raise AssertionError("test adapter response was not configured")
        return self.response


@pytest.fixture(autouse=True)
def _reset_skill_runtime():
    set_skill_runtime(None)
    yield
    set_skill_runtime(None)


def _state(**goal_overrides) -> V5SessionState:
    goal = {
        "text": "Invoke a runtime skill for migration evidence",
        "skillId": "runtime.summarize",
        "skillRuntime": "fixture-runtime",
        "skillArguments": {"topic": "migration boundaries"},
    }
    goal.update(goal_overrides)
    return V5SessionState(
        sessionId="skill-real-runtime",
        goal=goal,
        artifacts=[],
    )


def test_real_runtime_adapter_success_preserves_identity_runtime_and_payload():
    adapter = TrackingSkillAdapter(
        response=SkillInvokeResult(
            output="runtime summary for migration boundaries",
            response={"summary": "runtime:migration boundaries"},
            runtime="fixture-runtime",
            provenance="skill-runtime:fixture",
        )
    )
    set_skill_runtime(create_skill_runtime(adapter=adapter, runtime="fixture-runtime"))

    result = execute_mapped_capability(
        "skill.invoke",
        _state(),
        ["goal-1"],
        "grounding",
        "turn-skill-real-runtime",
    )

    assert result["degraded"] is False
    assert result["skillId"] == "runtime.summarize"
    assert result["runtime"] == "fixture-runtime"
    assert result["provenance"] == "skill-runtime:fixture"
    assert result["arguments"] == {"topic": "migration boundaries"}
    assert result["skillResult"] == {"summary": "runtime:migration boundaries"}
    assert result["content"] == "runtime summary for migration boundaries"
    assert result["sources"] == []
    assert adapter.calls == [
        SkillInvokeRequest(
            skill_id="runtime.summarize",
            runtime="fixture-runtime",
            arguments={"topic": "migration boundaries"},
            input="Invoke a runtime skill for migration evidence",
        )
    ]


def test_real_runtime_not_found_has_stable_error_classification():
    adapter = TrackingSkillAdapter(error=SkillNotFoundError("unknown skill"))
    runtime = create_skill_runtime(adapter=adapter, runtime="fixture-runtime")

    result = execute_skill_invoke_with_runtime(
        _state(skillId="missing.skill"),
        "grounding",
        "turn-skill-real-runtime",
        ["goal-1"],
        runtime=runtime,
    )

    assert result["degraded"] is True
    assert result["error"] == "skill_not_found"
    assert result["skillId"] == "missing.skill"
    assert result["runtime"] == "fixture-runtime"
    assert result["provenance"] == "skill-runtime:fixture-runtime"
    assert result["arguments"] == {"topic": "migration boundaries"}
    assert "skillResult" not in result


def test_real_runtime_denied_has_stable_error_classification():
    adapter = TrackingSkillAdapter(error=SkillInvokeDeniedError("permission denied"))
    runtime = create_skill_runtime(adapter=adapter, runtime="restricted-runtime")

    result = execute_skill_invoke_with_runtime(
        _state(skillRuntime="restricted-runtime"),
        "grounding",
        "turn-skill-real-runtime",
        ["goal-1"],
        runtime=runtime,
    )

    assert result["degraded"] is True
    assert result["error"] == "skill_invoke_denied"
    assert result["skillId"] == "runtime.summarize"
    assert result["runtime"] == "restricted-runtime"
    assert result["provenance"] == "skill-runtime:restricted-runtime"
    assert result["arguments"] == {"topic": "migration boundaries"}
    assert "skillResult" not in result


def test_real_runtime_error_has_stable_error_classification():
    adapter = TrackingSkillAdapter(error=SkillRuntimeError("runtime failed"))
    runtime = create_skill_runtime(adapter=adapter, runtime="fixture-runtime")

    result = execute_skill_invoke_with_runtime(
        _state(),
        "grounding",
        "turn-skill-real-runtime",
        ["goal-1"],
        runtime=runtime,
    )

    assert result["degraded"] is True
    assert result["error"] == "skill_runtime_error"
    assert result["skillId"] == "runtime.summarize"
    assert result["runtime"] == "fixture-runtime"
    assert result["provenance"] == "skill-runtime:fixture-runtime"
    assert result["arguments"] == {"topic": "migration boundaries"}
    assert "skillResult" not in result
