"""Python boundary for /api/permissions route management.

This module intentionally does not implement the Node-owned role, policy, token,
dynamic permission, or conflict stores. It gives migration tests a stable
boundary envelope so permission check runtime coverage is not mistaken for a
full management-plane migration.
"""

from typing import Any


PERMISSION_MANAGEMENT_CONTRACT_VERSION = "permission-management.v1"
PERMISSION_MANAGEMENT_SOURCE = "python_boundary"

_SUPPORTED_MANAGEMENT_DOMAINS = {
    "role": {
        "role.list",
        "role.get",
        "role.create",
        "role.update",
    },
    "policy": {
        "policy.get",
        "policy.assign",
        "policy.update",
    },
    "token": {
        "token.issue",
        "token.verify",
    },
}

_ALL_MANAGEMENT_OPERATIONS = {
    operation
    for operations in _SUPPORTED_MANAGEMENT_DOMAINS.values()
    for operation in operations
}


def evaluate_permission_management_boundary(request: Any) -> dict[str, Any]:
    """Return the explicit Python management-plane boundary envelope.

    Role, policy, and token management are still owned by Node. Returning an
    unsupported envelope here prevents callers from treating Python check-engine
    runtime evidence as route-management migration coverage.
    """
    if not isinstance(request, dict):
        return _error(None, "unknown", "invalid_request", "Invalid permission management request")

    operation = request.get("operation")
    if not isinstance(operation, str) or not operation:
        return _error(None, "unknown", "invalid_request", "operation is required")

    domain = _domain_for_operation(operation)
    if operation not in _ALL_MANAGEMENT_OPERATIONS:
        return _error(
            operation,
            domain,
            "invalid_operation",
            "Unsupported permission route management operation",
        )

    return {
        "contractVersion": PERMISSION_MANAGEMENT_CONTRACT_VERSION,
        "source": PERMISSION_MANAGEMENT_SOURCE,
        "operation": operation,
        "domain": domain,
        "ok": False,
        "status": "unsupported",
        "reason": (
            "/api/permissions role, policy, and token management remain Node-owned; "
            "Python only exposes an explicit route management boundary."
        ),
        "error": {
            "code": "node_owned",
            "message": "Permission route management is owned by Node for this migration slice",
        },
    }


def _domain_for_operation(operation: str) -> str:
    prefix = operation.split(".", 1)[0]
    return prefix if prefix in _SUPPORTED_MANAGEMENT_DOMAINS else "unknown"


def _error(
    operation: str | None,
    domain: str,
    code: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "contractVersion": PERMISSION_MANAGEMENT_CONTRACT_VERSION,
        "source": PERMISSION_MANAGEMENT_SOURCE,
        "operation": operation,
        "domain": domain,
        "ok": False,
        "status": "error",
        "reason": reason,
        "error": {
            "code": code,
            "message": reason,
        },
    }
