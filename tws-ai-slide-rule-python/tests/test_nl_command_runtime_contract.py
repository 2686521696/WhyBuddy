"""Contract tests for the Python-side NL command runtime boundary.

This slice only defines deterministic analyze/clarify/plan/approval/report
result shapes. It must not execute commands or migrate the mission/task runtime.
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.nl_command_runtime import (  # noqa: E402
    NL_COMMAND_RUNTIME_CONTRACT_VERSION,
    NLCommandRuntimeCompletedResult,
    execute_nl_command_runtime_contract,
)


def _base_payload(operation: str) -> dict:
    return {
        "operation": operation,
        "commandId": "cmd-contract-1",
        "planId": "plan-contract-1",
        "userId": "user-contract",
        "commandText": "Plan the migration contract without running commands",
        "permission": {
            "allowed": True,
            "reason": "contract test grant",
            "auditId": "audit-permission-1",
        },
        "audit": {
            "eventId": "audit-event-1",
            "actorId": "user-contract",
            "entityId": "cmd-contract-1",
            "entityType": "command",
            "timestamp": 1710000000000,
            "metadata": {"source": "contract-test"},
        },
    }


@pytest.mark.parametrize(
    ("operation", "field"),
    [
        ("analyze", "analysis"),
        ("clarify", "clarification"),
        ("plan", "plan"),
        ("approval", "approval"),
        ("report", "report"),
    ],
)
def test_contract_expresses_each_nl_command_runtime_result(operation: str, field: str):
    result = execute_nl_command_runtime_contract(_base_payload(operation)).model_dump(
        exclude_none=True
    )

    assert result["contractVersion"] == NL_COMMAND_RUNTIME_CONTRACT_VERSION
    assert result["runtime"] == "python-contract"
    assert result["operation"] == operation
    assert result["ok"] is True
    assert result["status"] == "completed"
    assert field in result
    assert result["permission"] == {
        "allowed": True,
        "reason": "contract test grant",
        "auditId": "audit-permission-1",
    }
    assert result["audit"]["eventId"] == "audit-event-1"
    assert result["audit"]["operationType"] == f"nl_command_{operation}"
    assert result["audit"]["result"] == "success"


def test_permission_denied_preserves_permission_and_audit_without_success_fallback():
    payload = _base_payload("plan")
    payload["permission"] = {
        "allowed": False,
        "reason": "viewer cannot plan",
        "auditId": "audit-denied-1",
    }

    result = execute_nl_command_runtime_contract(payload).model_dump(exclude_none=True)

    assert result["ok"] is False
    assert result["status"] == "permission_denied"
    assert result["status"] != "completed"
    assert result["permission"] == {
        "allowed": False,
        "reason": "viewer cannot plan",
        "auditId": "audit-denied-1",
    }
    assert result["audit"]["eventId"] == "audit-event-1"
    assert result["audit"]["result"] == "failure"
    assert result["error"] == {
        "code": "permission_denied",
        "message": "NL command runtime denied by permission guard.",
    }
    assert "plan" not in result


def test_completed_contract_rejects_denied_permission():
    payload = execute_nl_command_runtime_contract(_base_payload("analyze")).model_dump(
        exclude_none=True
    )
    payload["permission"] = {
        "allowed": False,
        "reason": "mutated denial",
        "auditId": "audit-mutated-denied",
    }

    with pytest.raises(ValidationError):
        NLCommandRuntimeCompletedResult(**payload)


def test_contract_rejects_unknown_operation_before_runtime_work():
    with pytest.raises(ValueError, match="operation must be"):
        execute_nl_command_runtime_contract(_base_payload("execute"))
