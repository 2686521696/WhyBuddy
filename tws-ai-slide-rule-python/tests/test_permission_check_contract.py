from middlewares.auth import (
    PERMISSION_CHECK_CONTRACT_VERSION,
    evaluate_permission_check_contract,
)


def _request(matrix, action="read", context=None):
    return {
        "agentId": "agent-contract",
        "resourceType": "filesystem",
        "action": action,
        "resource": "/sandbox/agent_contract/workspace/file.txt",
        "context": context if context is not None else {"agentId": "agent-contract"},
        "policy": {"permissionMatrix": matrix},
    }


def test_permission_check_contract_allows_matching_allow_rule():
    result = evaluate_permission_check_contract(
        _request(
            [
                {
                    "resourceType": "filesystem",
                    "actions": ["read"],
                    "constraints": {"pathPatterns": ["/sandbox/agent_*/workspace/**"]},
                    "effect": "allow",
                }
            ]
        )
    )

    assert result["contractVersion"] == PERMISSION_CHECK_CONTRACT_VERSION
    assert result["source"] == "python_contract"
    assert result["allowed"] is True
    assert result["decision"] == "allow"
    assert result["reason"] == "Allowed by explicit allow rule for filesystem:read"
    assert result["matchedRule"] == {
        "resourceType": "filesystem",
        "action": "read",
        "constraints": {"pathPatterns": ["/sandbox/agent_*/workspace/**"]},
        "effect": "allow",
    }


def test_permission_check_contract_denies_explicit_deny_before_allow():
    result = evaluate_permission_check_contract(
        _request(
            [
                {
                    "resourceType": "filesystem",
                    "actions": ["write"],
                    "constraints": {},
                    "effect": "allow",
                },
                {
                    "resourceType": "filesystem",
                    "actions": ["write"],
                    "constraints": {},
                    "effect": "deny",
                },
            ],
            action="write",
        )
    )

    assert result["allowed"] is False
    assert result["decision"] == "deny"
    assert result["reason"] == "Denied by explicit deny rule for filesystem:write"
    assert result["error"]["code"] == "explicit_deny"
    assert result["matchedRule"]["effect"] == "deny"


def test_permission_check_contract_denies_missing_context():
    result = evaluate_permission_check_contract(_request([], context={}))

    assert result["allowed"] is False
    assert result["decision"] == "deny"
    assert result["reason"] == "Missing permission check context"
    assert result["error"]["code"] == "missing_context"


def test_permission_check_contract_denies_invalid_policy():
    result = evaluate_permission_check_contract(
        {
            "agentId": "agent-contract",
            "resourceType": "filesystem",
            "action": "read",
            "resource": "/sandbox/agent_contract/workspace/file.txt",
            "context": {"agentId": "agent-contract"},
            "policy": {
                "permissionMatrix": [
                    {
                        "resourceType": "filesystem",
                        "actions": ["read"],
                        "constraints": {},
                        "effect": "maybe",
                    }
                ]
            },
        }
    )

    assert result["allowed"] is False
    assert result["decision"] == "deny"
    assert result["reason"] == "Invalid permission policy"
    assert result["error"]["code"] == "invalid_policy"
