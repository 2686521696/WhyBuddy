"""Contract tests for the Python-side workflow runtime boundary.

This slice only locks graph/run/node-result/error shapes. It must not execute
workflow nodes, persist workflow state, or bypass Node permission checks.
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.workflow_runtime import (  # noqa: E402
    WORKFLOW_RUNTIME_CONTRACT_VERSION,
    WorkflowRuntimeNodeResultResult,
    project_workflow_runtime_contract,
)


def _graph() -> dict:
    return {
        "workflowId": "workflow-contract-1",
        "entryNodeId": "node-start",
        "nodes": [
            {
                "nodeId": "node-start",
                "type": "root",
                "title": "Start",
                "permission": {"required": True, "guardId": "workflow.run"},
            },
            {
                "nodeId": "node-review",
                "type": "review",
                "title": "Review",
            },
        ],
        "edges": [
            {
                "edgeId": "edge-start-review",
                "fromNodeId": "node-start",
                "toNodeId": "node-review",
                "kind": "success",
            }
        ],
    }


def test_graph_validation_contract_accepts_stable_graph_shape():
    result = project_workflow_runtime_contract(
        {"operation": "graph_validation", "graph": _graph()}
    ).model_dump(exclude_none=True)

    assert result["contractVersion"] == WORKFLOW_RUNTIME_CONTRACT_VERSION
    assert result["runtime"] == "python-contract"
    assert result["operation"] == "graph_validation"
    assert result["ok"] is True
    assert result["status"] == "validated"
    assert result["graph"]["workflowId"] == "workflow-contract-1"
    assert result["graph"]["entryNodeId"] == "node-start"
    assert result["graph"]["nodes"][0]["nodeId"] == "node-start"
    assert result["graph"]["nodes"][0]["permission"] == {
        "required": True,
        "guardId": "workflow.run",
    }
    assert result["graph"]["edges"][0] == {
        "edgeId": "edge-start-review",
        "fromNodeId": "node-start",
        "toNodeId": "node-review",
        "kind": "success",
    }


def test_graph_validation_error_shape_is_stable():
    graph = _graph()
    graph["edges"][0]["toNodeId"] = "node-missing"

    result = project_workflow_runtime_contract(
        {"operation": "graph_validation", "graph": graph}
    ).model_dump(exclude_none=True)

    assert result == {
        "contractVersion": WORKFLOW_RUNTIME_CONTRACT_VERSION,
        "runtime": "python-contract",
        "operation": "graph_validation",
        "ok": False,
        "status": "failed",
        "error": {
            "code": "graph_validation_failed",
            "message": "edge.toNodeId references unknown node",
            "field": "graph.edges[0].toNodeId",
        },
    }


def test_run_start_contract_projects_run_without_executing_nodes():
    result = project_workflow_runtime_contract(
        {
            "operation": "run_start",
            "graph": _graph(),
            "runId": "run-contract-1",
            "startedAt": "2026-06-20T00:00:00.000Z",
        }
    ).model_dump(exclude_none=True)

    assert result["ok"] is True
    assert result["status"] == "running"
    assert result["workflowId"] == "workflow-contract-1"
    assert result["run"] == {
        "runId": "run-contract-1",
        "workflowId": "workflow-contract-1",
        "status": "running",
        "currentNodeId": "node-start",
        "startedAt": "2026-06-20T00:00:00.000Z",
        "nodeResults": [],
        "edgeTransitions": [],
    }


def test_node_result_contract_preserves_node_edge_and_status_fields():
    result = project_workflow_runtime_contract(
        {
            "operation": "node_result",
            "workflowId": "workflow-contract-1",
            "runId": "run-contract-1",
            "nodeResult": {
                "nodeId": "node-start",
                "status": "done",
                "attempts": 1,
                "startedAt": "2026-06-20T00:00:00.000Z",
                "completedAt": "2026-06-20T00:00:01.000Z",
                "output": {"answer": 42},
                "edge": {
                    "edgeId": "edge-start-review",
                    "fromNodeId": "node-start",
                    "toNodeId": "node-review",
                    "status": "traversed",
                },
            },
        }
    ).model_dump(exclude_none=True)

    assert result["ok"] is True
    assert result["status"] == "done"
    assert result["workflowId"] == "workflow-contract-1"
    assert result["runId"] == "run-contract-1"
    assert result["nodeResult"]["nodeId"] == "node-start"
    assert result["nodeResult"]["status"] == "done"
    assert result["nodeResult"]["edge"] == {
        "edgeId": "edge-start-review",
        "fromNodeId": "node-start",
        "toNodeId": "node-review",
        "status": "traversed",
    }


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_failed_or_cancelled_node_result_cannot_masquerade_as_done(status: str):
    with pytest.raises(ValidationError):
        WorkflowRuntimeNodeResultResult(
            operation="node_result",
            workflowId="workflow-contract-1",
            runId="run-contract-1",
            status="done",
            nodeResult={
                "nodeId": "node-start",
                "status": status,
                "attempts": 1,
            },
        )


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_failure_contract_preserves_failure_status(status: str):
    result = project_workflow_runtime_contract(
        {
            "operation": "error",
            "workflowId": "workflow-contract-1",
            "runId": "run-contract-1",
            "nodeId": "node-start",
            "status": status,
            "error": {
                "code": "node_failed" if status == "failed" else "run_cancelled",
                "message": f"Workflow runtime {status}",
                "retryable": False,
            },
        }
    ).model_dump(exclude_none=True)

    assert result["ok"] is False
    assert result["status"] == status
    assert result["status"] != "done"
    assert result["error"]["message"] == f"Workflow runtime {status}"
