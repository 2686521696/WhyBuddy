"""Runtime bridge tests for the Python-side Blueprint main state slice.

This bridge is intentionally bounded to a Node-supplied main-state snapshot:
Python can read, project, and return an audit envelope, but Node still owns the
job store, event bus, ledger, preview, and prompt package runtime.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.blueprint_state import BLUEPRINT_MAIN_STATE_CONTRACT_VERSION  # noqa: E402
from services.blueprint_state_runtime import (  # noqa: E402
    BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION,
    execute_blueprint_state_runtime,
)


def _job(status: str = "running") -> dict:
    return {
        "id": "job-blueprint-main-state",
        "projectId": "project-runtime",
        "sourceId": "source-runtime",
        "status": status,
        "stage": "spec_tree",
        "version": "2026-06-22.runtime",
        "createdAt": "2026-06-22T00:00:00.000Z",
        "updatedAt": "2026-06-22T00:00:01.000Z",
        "artifacts": [
            {
                "id": "artifact-route-set",
                "type": "route_set",
                "title": "Route set",
                "summary": "Candidate Blueprint routes.",
                "createdAt": "2026-06-22T00:00:00.000Z",
            },
            {
                "id": "artifact-spec-tree",
                "type": "spec_tree",
                "title": "SPEC tree",
                "summary": "Generated tree awaiting review.",
                "createdAt": "2026-06-22T00:00:01.000Z",
                "staleSince": "2026-06-22T00:00:02.000Z",
                "invalidatedBy": {
                    "stage": "route_generation",
                    "artifactId": "artifact-route-set",
                    "artifactType": "route_set",
                    "reason": "upstream_route_selection_changed",
                    "triggeredAt": "2026-06-22T00:00:02.000Z",
                },
            },
        ],
        "events": [{"id": "event-node-owned"}],
        "staleArtifactIds": ["artifact-spec-tree"],
        "stageState": {"must": "stay-node-owned"},
        "nextAction": {"must": "stay-node-owned"},
        "checksLedger": [{"must": "stay-node-owned"}],
    }


def _payload(operation: str, **overrides: object) -> dict:
    payload = {
        "operation": operation,
        "jobId": "job-blueprint-main-state",
        "job": _job(),
        "now": "2026-06-22T00:00:03.000Z",
        "nodeControl": {
            "jobStoreOwner": "node",
            "eventBusOwner": "node",
            "ledgerOwner": "node",
            "previewOwner": "node",
            "promptPackageOwner": "node",
        },
    }
    payload.update(overrides)
    return payload


def test_runtime_read_projects_node_supplied_state_without_runtime_ownership():
    result = execute_blueprint_state_runtime(_payload("read"))

    assert result["ok"] is True
    assert result["operation"] == "read"
    assert result["contractVersion"] == BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION
    assert result["runtime"] == {
        "owner": "python",
        "mode": "runtime_bridge",
        "stateAuthority": "node",
        "stateMutation": "none",
        "jobStoreOwner": "node",
        "eventBusOwner": "node",
        "ledgerOwner": "node",
        "previewOwner": "node",
        "promptPackageOwner": "node",
    }
    assert result["provenance"] == "python-blueprint-state-runtime"
    assert result["jobId"] == "job-blueprint-main-state"
    assert result["projection"]["contractVersion"] == BLUEPRINT_MAIN_STATE_CONTRACT_VERSION
    assert result["projection"]["status"] == "running"
    assert result["projection"]["staleArtifactIds"] == ["artifact-spec-tree"]
    assert result["read"]["source"] == "node-job-snapshot"
    assert result["update"]["accepted"] is False

    forbidden_keys = {"events", "stageState", "nextAction", "checksLedger"}
    assert forbidden_keys.isdisjoint(result["projection"].keys())


def test_runtime_project_accepts_explicit_state_projection_payload():
    result = execute_blueprint_state_runtime(_payload("project"))

    assert result["ok"] is True
    assert result["operation"] == "project"
    assert result["projection"]["jobId"] == "job-blueprint-main-state"
    assert result["projection"]["artifacts"][1]["stale"] is True
    assert result["read"]["source"] == "node-job-snapshot"


def test_runtime_update_returns_non_mutating_audit_envelope():
    result = execute_blueprint_state_runtime(
        _payload(
            "update",
            patch={
                "status": "completed",
                "stageState": {"must": "not-migrate"},
            },
        )
    )

    assert result["ok"] is True
    assert result["operation"] == "update"
    assert result["update"] == {
        "accepted": False,
        "reason": "node_state_owner",
        "message": "Blueprint main state updates are audited by Python but applied by Node.",
        "requestedPatch": {
            "status": "completed",
            "stageState": {"must": "not-migrate"},
        },
    }
    assert result["projection"]["nodeStatus"] == "running"
    assert result["runtime"]["stateMutation"] == "none"


def test_runtime_validation_errors_are_auditable_and_not_success_payloads():
    missing_job = execute_blueprint_state_runtime(
        {
            "operation": "read",
            "jobId": "missing",
            "nodeControl": {
                "jobStoreOwner": "node",
                "eventBusOwner": "node",
                "ledgerOwner": "node",
                "previewOwner": "node",
                "promptPackageOwner": "node",
            },
        }
    )
    bad_operation = execute_blueprint_state_runtime(_payload("delete"))
    forbidden_owner = execute_blueprint_state_runtime(
        _payload(
            "read",
            nodeControl={
                "jobStoreOwner": "python",
                "eventBusOwner": "node",
                "ledgerOwner": "node",
                "previewOwner": "node",
                "promptPackageOwner": "node",
            },
        )
    )

    assert missing_job["ok"] is False
    assert missing_job["operation"] == "read"
    assert missing_job["error"] == "not_found"
    assert missing_job["reason"] == "missing_node_job_snapshot"
    assert missing_job["statusCode"] == 404
    assert "projection" not in missing_job

    assert bad_operation["ok"] is False
    assert bad_operation["error"] == "invalid_operation"
    assert bad_operation["statusCode"] == 400

    assert forbidden_owner["ok"] is False
    assert forbidden_owner["error"] == "boundary_violation"
    assert forbidden_owner["reason"] == "node_control_owner_mismatch"
    assert forbidden_owner["statusCode"] == 400
