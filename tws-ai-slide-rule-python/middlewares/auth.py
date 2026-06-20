'''
Author: wangchunji
Date: 2026-06-16 04:13:12
LastEditors: wangchunji
LastEditTime: 2026-06-16 15:05:59
Description:
'''
"""
Auth middleware, ported from Node auth and Python's authenticate.

For internal SlideRule calls, use key. For full, integrate with existing Python auth.
"""

from typing import Any

from fastapi import Header, HTTPException
from config.settings import settings


SESSION_ERROR_MESSAGES = {
    "missing": "Authentication required",
    "expired": "Session expired",
    "invalid": "Invalid session",
}

SECRET_KEY_PARTS = ("token", "cookie", "password", "secret")


def _session_error(error: str) -> dict[str, Any]:
    normalized = error if error in SESSION_ERROR_MESSAGES else "invalid"
    return {
        "valid": False,
        "error": normalized,
        "status": 401,
        "message": SESSION_ERROR_MESSAGES[normalized],
    }


def _contains_secret_key(value: Any) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key).lower()
            if any(part in key_text for part in SECRET_KEY_PARTS):
                return True
            if _contains_secret_key(child):
                return True
    elif isinstance(value, list):
        return any(_contains_secret_key(item) for item in value)
    return False


def _is_current_user(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    required = {
        "id": str,
        "email": str,
        "role": str,
        "status": str,
        "emailVerified": bool,
        "createdAt": str,
    }
    return all(isinstance(value.get(key), expected_type) for key, expected_type in required.items())


def validate_session_contract(payload: Any) -> dict[str, Any]:
    """Validate the Python auth-session boundary without handling real tokens."""
    if payload is None:
        return _session_error("missing")

    if not isinstance(payload, dict):
        return _session_error("invalid")

    if payload.get("error") in SESSION_ERROR_MESSAGES:
        return _session_error(str(payload["error"]))

    if _contains_secret_key(payload):
        return _session_error("invalid")

    session_id = payload.get("sessionId")
    user = payload.get("user")
    if not isinstance(session_id, str) or not session_id or not _is_current_user(user):
        return _session_error("invalid")

    return {
        "valid": True,
        "sessionId": session_id,
        "user": user,
    }

async def verify_internal_key(x_internal_key: str = Header(None)):
    if x_internal_key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid internal key")
    return True


PERMISSION_CHECK_CONTRACT_VERSION = "permission-check.v1"
PERMISSION_CHECK_CONTRACT_SOURCE = "python_contract"
PERMISSION_CHECK_RUNTIME_SOURCE = "python_runtime"

_VALID_RESOURCE_TYPES = {"filesystem", "network", "api", "database", "mcp_tool"}
_VALID_ACTIONS = {
    "read",
    "write",
    "execute",
    "delete",
    "connect",
    "call",
    "select",
    "insert",
    "update",
}


def evaluate_permission_check_contract(request):
    """Contract-only permission evaluator used by migration tests.

    Production permission enforcement remains in the Node PermissionCheckEngine.
    This function locks the Python-side input/output shape and deny semantics for
    future runtime migration work.
    """
    if not isinstance(request, dict):
        return _deny("invalid_policy", "Invalid permission check contract request")

    context = request.get("context")
    if not isinstance(context, dict) or not context.get("agentId"):
        return _deny("missing_context", "Missing permission check context")

    agent_id = request.get("agentId")
    if context.get("agentId") != agent_id:
        return _deny("agent_mismatch", "Permission context agentId mismatch")

    resource_type = request.get("resourceType")
    action = request.get("action")
    if resource_type not in _VALID_RESOURCE_TYPES or action not in _VALID_ACTIONS:
        return _deny("invalid_policy", "Invalid permission policy")

    policy = request.get("policy")
    if not isinstance(policy, dict):
        return _deny("invalid_policy", "Invalid permission policy")

    matrix = policy.get("permissionMatrix")
    if not isinstance(matrix, list):
        return _deny("invalid_policy", "Invalid permission policy")

    for entry in matrix:
        if not _is_valid_matrix_entry(entry):
            return _deny("invalid_policy", "Invalid permission policy")

    for entry in matrix:
        if _matches_entry(entry, resource_type, action) and entry["effect"] == "deny":
            return _deny(
                "explicit_deny",
                f"Denied by explicit deny rule for {resource_type}:{action}",
                matched_rule=_matched_rule(entry, action),
            )

    for entry in matrix:
        if _matches_entry(entry, resource_type, action) and entry["effect"] == "allow":
            return {
                "contractVersion": PERMISSION_CHECK_CONTRACT_VERSION,
                "source": PERMISSION_CHECK_CONTRACT_SOURCE,
                "allowed": True,
                "decision": "allow",
                "reason": f"Allowed by explicit allow rule for {resource_type}:{action}",
                "matchedRule": _matched_rule(entry, action),
            }

    return _deny("no_allow", f"No allow rule found for {resource_type}:{action}")


def evaluate_permission_check_runtime_boundary(request):
    """Runtime boundary for Node-facing permission checks.

    This intentionally uses the same deny-first policy evaluator as the contract
    boundary. Production enforcement remains owned by the Node permission engine
    until the migration reviewer approves a broader cutover.
    """
    return _with_permission_check_source(
        evaluate_permission_check_contract(request),
        PERMISSION_CHECK_RUNTIME_SOURCE,
    )


def _deny(code, reason, matched_rule=None):
    response = {
        "contractVersion": PERMISSION_CHECK_CONTRACT_VERSION,
        "source": PERMISSION_CHECK_CONTRACT_SOURCE,
        "allowed": False,
        "decision": "deny",
        "reason": reason,
        "error": {
            "code": code,
            "message": reason,
        },
    }
    if matched_rule is not None:
        response["matchedRule"] = matched_rule
    return response


def _with_permission_check_source(response, source):
    if isinstance(response, dict):
        return {**response, "source": source}
    return response


def _is_valid_matrix_entry(entry):
    if not isinstance(entry, dict):
        return False
    if entry.get("resourceType") not in _VALID_RESOURCE_TYPES:
        return False
    if entry.get("effect") not in {"allow", "deny"}:
        return False
    actions = entry.get("actions")
    if not isinstance(actions, list) or not actions:
        return False
    if any(action not in _VALID_ACTIONS for action in actions):
        return False
    constraints = entry.get("constraints")
    return isinstance(constraints, dict)


def _matches_entry(entry, resource_type, action):
    return entry["resourceType"] == resource_type and action in entry["actions"]


def _matched_rule(entry, action):
    return {
        "resourceType": entry["resourceType"],
        "action": action,
        "constraints": entry.get("constraints", {}),
        "effect": entry["effect"],
    }
