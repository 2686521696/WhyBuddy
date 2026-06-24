"""Python tests for task project auth runtime takeover 104.

Covers:
- Python returns allow/deny/degraded classification for project resource auth.
- denied/allowed/error-path tests required before marking python-owned decision.
- Node retains enforcement; python provides decision envelope only.
- Explicit node fallback in all paths.
"""

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.task_project_auth_runtime_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    decide_task_project_auth_runtime_takeover,
)


def _base_payload(**overrides: Any) -> dict:
    base: dict[str, Any] = {
        "missionId": "mission-auth-104",
        "projectId": "project-auth-104",
        "resourceId": "resource-auth-104",
    }
    base.update(overrides)
    return base


def test_default_allow_classification():
    result = decide_task_project_auth_runtime_takeover(_base_payload())
    assert result["ok"] is True
    assert result["decision"] == "allow"
    assert result["classification"] == "allow"
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["ownership"]["projectResourceAuth"] == "node-retained"
    assert result.get("denied") is not True
    assert result.get("fallback") == "node"
    assert result["runtime"]["authEnforcementOwner"] == "node"


def test_deny_classification():
    result = decide_task_project_auth_runtime_takeover(
        _base_payload(simulate={"deny": True}, projectId="denied-proj")
    )
    assert result["decision"] == "deny"
    assert result["classification"] == "deny"
    assert result["ok"] is False
    assert result.get("denied") is True
    assert result["ownership"]["projectResourceAuth"] == "node-retained"
    assert result.get("fallback") == "node"


def test_degraded_classification_error_path():
    result = decide_task_project_auth_runtime_takeover(_base_payload(simulate={"degrade": True}))
    assert result["decision"] == "degraded"
    assert result["classification"] == "degraded"
    assert result.get("degraded") is True
    assert result["ok"] is True  # allows node fallback
    assert result["ownership"]["projectResourceAuth"] == "node-retained"
    assert result.get("fallback") == "node"


def test_unsupported_payload_is_error_path():
    result = decide_task_project_auth_runtime_takeover("not-a-dict")  # type: ignore[arg-type]
    assert result.get("ok") is False
    assert result["decision"] == "unsupported"
    assert result["classification"] == "degraded"
    assert "error" in result


def test_node_retained_fallback_explicit():
    result = decide_task_project_auth_runtime_takeover(_base_payload())
    assert result["runtime"]["authEnforcementOwner"] == "node"
    assert result.get("fallback") == "node"
    # decision can be python but enforcement node
    assert "node" in str(result.get("runtime", {})).lower() or result.get("fallback") == "node"


def test_area_or_action_preserved():
    result = decide_task_project_auth_runtime_takeover(
        _base_payload(action="create", area="projectResourceAuth")
    )
    assert result["decision"] == "allow"
    assert result.get("projectId") is not None
