from middlewares.auth import (
    PERMISSION_CHECK_CONTRACT_VERSION,
    evaluate_permission_check_runtime_boundary,
)


def _request(matrix, action="read", context=None, policy=None):
    return {
        "agentId": "agent-runtime",
        "resourceType": "filesystem",
        "action": action,
        "resource": "/sandbox/agent_runtime/workspace/file.txt",
        "context": context if context is not None else {"agentId": "agent-runtime"},
        "policy": policy if policy is not None else {"permissionMatrix": matrix},
    }


def _allow_rule(action="read"):
    return {
        "resourceType": "filesystem",
        "actions": [action],
        "constraints": {"pathPatterns": ["/sandbox/agent_*/workspace/**"]},
        "effect": "allow",
    }


def _deny_rule(action="write"):
    return {
        "resourceType": "filesystem",
        "actions": [action],
        "constraints": {},
        "effect": "deny",
    }


def test_permission_check_runtime_boundary_allows_matching_allow_rule():
    result = evaluate_permission_check_runtime_boundary(_request([_allow_rule()]))

    assert result["contractVersion"] == PERMISSION_CHECK_CONTRACT_VERSION
    assert result["source"] == "python_runtime"
    assert result["allowed"] is True
    assert result["decision"] == "allow"
    assert result["reason"] == "Allowed by explicit allow rule for filesystem:read"
    assert result["matchedRule"] == {
        "resourceType": "filesystem",
        "action": "read",
        "constraints": {"pathPatterns": ["/sandbox/agent_*/workspace/**"]},
        "effect": "allow",
    }
    assert "error" not in result


def test_permission_check_runtime_boundary_denies_explicit_deny_before_allow():
    result = evaluate_permission_check_runtime_boundary(
        _request([_allow_rule("write"), _deny_rule("write")], action="write")
    )

    assert result["source"] == "python_runtime"
    assert result["allowed"] is False
    assert result["decision"] == "deny"
    assert result["reason"] == "Denied by explicit deny rule for filesystem:write"
    assert result["error"]["code"] == "explicit_deny"
    assert result["matchedRule"] == {
        "resourceType": "filesystem",
        "action": "write",
        "constraints": {},
        "effect": "deny",
    }


def test_permission_check_runtime_boundary_denies_missing_context():
    result = evaluate_permission_check_runtime_boundary(_request([_allow_rule()], context={}))

    assert result["source"] == "python_runtime"
    assert result["allowed"] is False
    assert result["decision"] == "deny"
    assert result["reason"] == "Missing permission check context"
    assert result["error"]["code"] == "missing_context"


def test_permission_check_runtime_boundary_denies_invalid_policy():
    result = evaluate_permission_check_runtime_boundary(
        _request(
            [],
            policy={
                "permissionMatrix": [
                    {
                        "resourceType": "filesystem",
                        "actions": ["read"],
                        "constraints": {},
                        "effect": "maybe",
                    }
                ]
            },
        )
    )

    assert result["source"] == "python_runtime"
    assert result["allowed"] is False
    assert result["decision"] == "deny"
    assert result["reason"] == "Invalid permission policy"
    assert result["error"]["code"] == "invalid_policy"
