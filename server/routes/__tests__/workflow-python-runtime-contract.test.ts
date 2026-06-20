import { describe, expect, it } from "vitest";

import {
  WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
  isWorkflowPythonRuntimeResult,
  validateWorkflowPythonRuntimeGraph,
} from "../../../shared/workflow-domain.js";

function graph() {
  return {
    workflowId: "workflow-contract-1",
    entryNodeId: "node-start",
    nodes: [
      {
        nodeId: "node-start",
        type: "root",
        title: "Start",
        permission: { required: true, guardId: "workflow.run" },
      },
      {
        nodeId: "node-review",
        type: "review",
        title: "Review",
      },
    ],
    edges: [
      {
        edgeId: "edge-start-review",
        fromNodeId: "node-start",
        toNodeId: "node-review",
        kind: "success",
      },
    ],
  };
}

describe("workflow Python runtime contract", () => {
  it("validates graph shape and preserves workflow/node/edge identifiers", () => {
    const result = validateWorkflowPythonRuntimeGraph(graph());

    expect(result).toEqual({
      contractVersion: WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
      runtime: "python-contract",
      operation: "graph_validation",
      ok: true,
      status: "validated",
      graph: graph(),
    });
    expect(isWorkflowPythonRuntimeResult(result)).toBe(true);
  });

  it("returns a stable graph validation error shape", () => {
    const invalid = graph();
    invalid.edges[0].toNodeId = "node-missing";

    const result = validateWorkflowPythonRuntimeGraph(invalid);

    expect(result).toEqual({
      contractVersion: WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
      runtime: "python-contract",
      operation: "graph_validation",
      ok: false,
      status: "failed",
      error: {
        code: "graph_validation_failed",
        message: "edge.toNodeId references unknown node",
        field: "graph.edges[0].toNodeId",
      },
    });
    expect(isWorkflowPythonRuntimeResult(result)).toBe(true);
  });

  it("accepts run start and node result envelopes without executing nodes", () => {
    const runStart = {
      contractVersion: WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
      runtime: "python-contract",
      operation: "run_start",
      ok: true,
      status: "running",
      workflowId: "workflow-contract-1",
      run: {
        runId: "run-contract-1",
        workflowId: "workflow-contract-1",
        status: "running",
        currentNodeId: "node-start",
        startedAt: "2026-06-20T00:00:00.000Z",
        nodeResults: [],
        edgeTransitions: [],
      },
    };
    const nodeResult = {
      contractVersion: WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
      runtime: "python-contract",
      operation: "node_result",
      ok: true,
      status: "done",
      workflowId: "workflow-contract-1",
      runId: "run-contract-1",
      nodeResult: {
        nodeId: "node-start",
        status: "done",
        attempts: 1,
        startedAt: "2026-06-20T00:00:00.000Z",
        completedAt: "2026-06-20T00:00:01.000Z",
        output: { answer: 42 },
        edge: {
          edgeId: "edge-start-review",
          fromNodeId: "node-start",
          toNodeId: "node-review",
          status: "traversed",
        },
      },
    };

    expect(isWorkflowPythonRuntimeResult(runStart)).toBe(true);
    expect(isWorkflowPythonRuntimeResult(nodeResult)).toBe(true);
  });

  it("keeps failed and cancelled results out of done node-result envelopes", () => {
    const failed = {
      contractVersion: WORKFLOW_PYTHON_RUNTIME_CONTRACT_VERSION,
      runtime: "python-contract",
      operation: "error",
      ok: false,
      status: "failed",
      workflowId: "workflow-contract-1",
      runId: "run-contract-1",
      nodeId: "node-start",
      error: {
        code: "node_failed",
        message: "Workflow runtime failed",
        retryable: false,
      },
    };
    const cancelled = {
      ...failed,
      status: "cancelled",
      error: {
        code: "run_cancelled",
        message: "Workflow runtime cancelled",
        retryable: false,
      },
    };
    const failedAsDone = {
      ...failed,
      operation: "node_result",
      ok: true,
      status: "done",
      nodeResult: {
        nodeId: "node-start",
        status: "failed",
        attempts: 1,
      },
    };
    const cancelledAsDone = {
      ...failedAsDone,
      nodeResult: {
        nodeId: "node-start",
        status: "cancelled",
        attempts: 1,
      },
    };

    expect(isWorkflowPythonRuntimeResult(failed)).toBe(true);
    expect(isWorkflowPythonRuntimeResult(cancelled)).toBe(true);
    expect(isWorkflowPythonRuntimeResult(failedAsDone)).toBe(false);
    expect(isWorkflowPythonRuntimeResult(cancelledAsDone)).toBe(false);
  });
});
