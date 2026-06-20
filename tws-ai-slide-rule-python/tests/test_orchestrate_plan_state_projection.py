import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import CapabilityRun, V5SessionState  # noqa: E402
from services.slide_rule_orchestrator import (  # noqa: E402
    build_plan_state_projection,
    orchestrate_plan,
)


def _state() -> V5SessionState:
    return V5SessionState(
        sessionId="orch-projection",
        goal={"text": "Create a migration handoff plan with evidence and risks."},
        artifacts=[],
        capabilityRuns=[],
    )


def test_orchestrate_plan_returns_stable_read_side_projection():
    result = orchestrate_plan(_state(), "turn-projection", "Plan evidence, risks, and handoff").model_dump()

    projection = result["planStateProjection"]
    assert projection["kind"] == "orchestrate.plan.state_projection"
    assert projection["schemaVersion"] == 1
    assert projection["stateAuthority"] == "node"
    assert projection["stateMutation"] == "none"
    assert projection["status"] == "partial"
    assert projection["partial"] is True
    assert projection["phase"] == "planning"

    assert projection["phases"], "projection should expose plan phases"
    assert projection["steps"], "projection should expose selected plan steps"
    assert projection["risks"], "projection should expose boundary or execution risks"
    assert projection["recoveryPoints"], "projection should expose replan/resume recovery points"
    assert [step["capabilityId"] for step in projection["steps"]] == [
        item["capabilityId"] for item in result["selected"]
    ]

    forbidden_state_keys = {"state", "artifacts", "capabilityRuns", "coverageGate"}
    assert forbidden_state_keys.isdisjoint(projection.keys())


def test_partial_projection_does_not_masquerade_as_complete():
    result = orchestrate_plan(_state(), "turn-partial", "Plan the next migration slice").model_dump()

    assert result["selected"], "test requires a non-empty partial plan"
    projection = result["planStateProjection"]
    assert projection["status"] == "partial"
    assert projection["partial"] is True
    assert projection["error"] is None


def test_converged_projection_has_complete_empty_step_shape():
    completed = [
        CapabilityRun(
            id=f"run-{capability_id}",
            capabilityId=capability_id,
            turnId="previous-turn",
            outputs=[f"artifact-{capability_id}"],
        )
        for capability_id in [
            "evidence.search",
            "risk.analyze",
            "mcp.call",
            "skill.invoke",
            "report.write",
        ]
    ]
    state = V5SessionState(
        sessionId="orch-projection-complete",
        goal={"text": "Plan a bounded migration slice."},
        artifacts=[],
        capabilityRuns=completed,
    )

    result = orchestrate_plan(state, "turn-complete", "Any next step?").model_dump()

    assert result["selected"] == []
    assert result["converged"] is True
    projection = result["planStateProjection"]
    assert projection["status"] == "complete"
    assert projection["partial"] is False
    assert projection["steps"] == []
    assert projection["error"] is None


def test_error_projection_has_explicit_error_and_recovery_shape():
    projection = build_plan_state_projection(
        [],
        converged=False,
        error={
            "code": "planner_error",
            "reason": "runtime_error",
            "message": "planner exploded while ranking candidates",
        },
    ).model_dump()

    assert projection["status"] == "error"
    assert projection["partial"] is False
    assert projection["error"]["code"] == "planner_error"
    assert projection["error"]["reason"] == "runtime_error"
    assert projection["steps"] == []
    assert projection["recoveryPoints"]
    assert projection["status"] != "complete"
