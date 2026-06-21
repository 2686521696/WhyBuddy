from services.permission_management import (
    PERMISSION_MANAGEMENT_CONTRACT_VERSION,
    evaluate_permission_management_boundary,
)


def _request(operation, payload=None):
    return {
        "operation": operation,
        "payload": payload if payload is not None else {"agentId": "agent-route"},
    }


def test_permission_route_management_boundary_marks_role_management_unsupported():
    result = evaluate_permission_management_boundary(
        _request(
            "role.create",
            {
                "roleId": "auditor",
                "roleName": "Auditor",
                "permissions": [],
            },
        )
    )

    assert result["contractVersion"] == PERMISSION_MANAGEMENT_CONTRACT_VERSION
    assert result["source"] == "python_boundary"
    assert result["operation"] == "role.create"
    assert result["domain"] == "role"
    assert result["ok"] is False
    assert result["status"] == "unsupported"
    assert result["error"]["code"] == "node_owned"
    assert "check engine" not in result["reason"].lower()


def test_permission_route_management_boundary_marks_policy_management_unsupported():
    result = evaluate_permission_management_boundary(
        _request(
            "policy.assign",
            {
                "agentId": "agent-route",
                "assignedRoles": ["reader"],
                "deniedPermissions": [
                    {
                        "resourceType": "network",
                        "action": "connect",
                        "constraints": {},
                        "effect": "deny",
                    }
                ],
            },
        )
    )

    assert result["source"] == "python_boundary"
    assert result["operation"] == "policy.assign"
    assert result["domain"] == "policy"
    assert result["ok"] is False
    assert result["status"] == "unsupported"
    assert result["error"]["code"] == "node_owned"


def test_permission_route_management_boundary_marks_token_management_unsupported():
    result = evaluate_permission_management_boundary(
        _request("token.verify", {"token": "bad.token.here"})
    )

    assert result["source"] == "python_boundary"
    assert result["operation"] == "token.verify"
    assert result["domain"] == "token"
    assert result["ok"] is False
    assert result["status"] == "unsupported"
    assert result["error"]["code"] == "node_owned"


def test_permission_route_management_boundary_rejects_check_engine_operations():
    result = evaluate_permission_management_boundary(
        _request(
            "check.evaluate",
            {
                "agentId": "agent-route",
                "resourceType": "filesystem",
                "action": "read",
            },
        )
    )

    assert result["source"] == "python_boundary"
    assert result["operation"] == "check.evaluate"
    assert result["domain"] == "unknown"
    assert result["ok"] is False
    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_operation"
    assert "route management" in result["reason"]


def test_permission_route_management_boundary_rejects_malformed_request():
    result = evaluate_permission_management_boundary(None)

    assert result["source"] == "python_boundary"
    assert result["operation"] is None
    assert result["domain"] == "unknown"
    assert result["ok"] is False
    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_request"
