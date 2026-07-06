import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402


client = TestClient(app, raise_server_exceptions=False)
INTERNAL_KEY = "dev-slide-rule-internal"


def _runtime_payload() -> dict:
    # Mirrors tests/fixtures/orchestrate_plan_golden.json: selected is now PYTHON_AUTHORITY
    # pick_next_capabilities output (keyword/state driven), not the planner's old fixed list.
    return {
        "state": {
            "sessionId": "orch-runtime-route",
            "goal": {
                "text": "Create a migration handoff plan with evidence and risks.",
                "status": "needs_refinement",
            },
            "artifacts": [],
            "capabilityRuns": [],
        },
        "turnId": "turn-orch-runtime-route",
        "userText": "Create a migration handoff plan with evidence and risks.",
    }


def test_orchestrate_plan_runtime_route_returns_contract_compatible_shape():
    response = client.post(
        "/api/sliderule/orchestrate-plan",
        json=_runtime_payload(),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 200
    body = response.json()

    assert body["source"] == "python-rag"
    assert body["converged"] is False
    assert isinstance(body["rationale"], str)
    assert body["rationale"]
    assert isinstance(body["selected"], list)
    assert body["selected"]

    # required ids per the golden pick contract (orchestrate_plan_golden.json):
    # cold-session pick semantics must ground with evidence and cover risk.
    capability_ids = [item["capabilityId"] for item in body["selected"]]
    assert "evidence.search" in capability_ids
    assert "risk.analyze" in capability_ids

    for item in body["selected"]:
        assert isinstance(item["capabilityId"], str)
        assert item["capabilityId"]
        assert isinstance(item["roleId"], str)
        assert item["roleId"]

    for node_owned_key in [
        "state",
        "artifacts",
        "capabilityRuns",
        "coverageGate",
        "coverageContract",
        "coverageGaps",
    ]:
        assert node_owned_key not in body
