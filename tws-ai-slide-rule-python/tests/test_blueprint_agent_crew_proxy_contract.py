"""Contract tests for the Blueprint agent-crew Python proxy boundary.

This is intentionally a contract-only slice. Node still owns the real
Blueprint agent scheduling/runtime; Python only needs a stable envelope that
Node can project into its existing agent-crew service.
"""

from copy import deepcopy

CONTRACT_VERSION = "blueprint.agent-crew.proxy.v1"
EVENT_KINDS = {"plan", "assign", "result", "error"}


def _base_event(kind: str) -> dict:
    return {
        "contractVersion": CONTRACT_VERSION,
        "kind": kind,
        "id": f"crew-event-{kind}",
        "jobId": "job-1",
        "crewId": "crew-1",
        "roleId": "role-architecture-planner",
        "stage": "runtime_capability",
        "occurredAt": "2026-06-20T00:00:00.000Z",
        "summary": f"{kind} summary",
        "budget": {
            "maxIterations": 4,
            "maxTokens": 12000,
            "timeoutMs": 300000,
            "remainingIterations": 3,
            "remainingTokens": 8000,
        },
        "payload": {},
    }


def _assert_common_contract(event: dict, kind: str) -> None:
    assert event["contractVersion"] == CONTRACT_VERSION
    assert event["kind"] == kind
    assert event["kind"] in EVENT_KINDS
    assert event["jobId"] == "job-1"
    assert event["crewId"] == "crew-1"
    assert event["roleId"] == "role-architecture-planner"
    assert event["stage"] == "runtime_capability"
    assert event["occurredAt"].endswith("Z")
    assert event["summary"]
    assert event["budget"]["maxIterations"] == 4
    assert event["budget"]["remainingTokens"] == 8000


def test_plan_contract_preserves_role_and_budget():
    event = _base_event("plan")
    event["payload"] = {
        "planId": "plan-1",
        "steps": [
            {
                "id": "step-1",
                "title": "Check route architecture",
                "roleId": "role-architecture-planner",
            }
        ],
    }

    _assert_common_contract(event, "plan")
    assert event["payload"]["planId"] == "plan-1"
    assert event["payload"]["steps"][0]["roleId"] == event["roleId"]


def test_assign_contract_preserves_assigned_role_and_budget():
    event = _base_event("assign")
    event["payload"] = {
        "assignmentId": "assignment-1",
        "capabilityId": "role-system-architecture",
        "nodeId": "node-1",
    }

    _assert_common_contract(event, "assign")
    assert event["payload"]["assignmentId"] == "assignment-1"
    assert event["payload"]["capabilityId"] == "role-system-architecture"


def test_result_contract_preserves_result_fields_and_budget():
    event = _base_event("result")
    event["payload"] = {
        "assignmentId": "assignment-1",
        "resultId": "result-1",
        "status": "completed",
        "outputSummary": "Architecture role completed the assignment.",
        "artifactIds": ["artifact-1"],
        "evidenceIds": ["evidence-1"],
    }

    _assert_common_contract(event, "result")
    assert event["payload"]["status"] == "completed"
    assert event["payload"]["artifactIds"] == ["artifact-1"]
    assert event["payload"]["evidenceIds"] == ["evidence-1"]


def test_error_contract_preserves_error_without_dropping_role_or_budget():
    event = _base_event("error")
    event["payload"] = {
        "assignmentId": "assignment-1",
        "error": {
            "code": "agent_timeout",
            "message": "Role agent exceeded timeout budget.",
            "retryable": True,
        },
    }

    _assert_common_contract(event, "error")
    assert event["payload"]["error"]["code"] == "agent_timeout"
    assert event["payload"]["error"]["retryable"] is True


def test_contract_rejects_unknown_kind():
    event = deepcopy(_base_event("result"))
    event["kind"] = "dispatch"

    assert event["kind"] not in EVENT_KINDS
