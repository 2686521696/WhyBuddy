"""Deterministic Python contract boundary for workflow runtime.

The real workflow engine, node adapters, persistence, and permission checks
remain Node-owned in this migration slice. This module only locks graph, run,
node-result, and error envelopes that a Python runtime must preserve later.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Tuple, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


WORKFLOW_RUNTIME_CONTRACT_VERSION = "workflow.runtime.v1"
WORKFLOW_RUNTIME_NAME = "python-contract"

WorkflowRuntimeOperation = Literal[
    "graph_validation",
    "run_start",
    "node_result",
    "error",
]
WorkflowRuntimeNodeStatus = Literal[
    "pending",
    "running",
    "waiting",
    "done",
    "failed",
    "cancelled",
    "skipped",
]
WorkflowRuntimeFailureStatus = Literal["failed", "cancelled"]
WorkflowRuntimeEdgeKind = Literal["success", "failure", "conditional", "loop", "jump"]
WorkflowRuntimeEdgeStatus = Literal["known", "traversed", "blocked"]


def _non_empty(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


class WorkflowRuntimeError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    field: Optional[str] = None
    retryable: Optional[bool] = None

    @field_validator("code", "message", "field")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class WorkflowRuntimeNodePermission(BaseModel):
    model_config = ConfigDict(extra="allow")

    required: bool = False
    guardId: Optional[str] = None

    @field_validator("guardId")
    @classmethod
    def _validate_guard_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class WorkflowRuntimeGraphNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    nodeId: str
    type: str
    title: str
    permission: Optional[WorkflowRuntimeNodePermission] = None

    @field_validator("nodeId", "type", "title")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class WorkflowRuntimeGraphEdge(BaseModel):
    model_config = ConfigDict(extra="allow")

    edgeId: str
    fromNodeId: str
    toNodeId: str
    kind: WorkflowRuntimeEdgeKind

    @field_validator("edgeId", "fromNodeId", "toNodeId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class WorkflowRuntimeGraph(BaseModel):
    model_config = ConfigDict(extra="allow")

    workflowId: str
    entryNodeId: str
    nodes: List[WorkflowRuntimeGraphNode]
    edges: List[WorkflowRuntimeGraphEdge] = Field(default_factory=list)

    @field_validator("workflowId", "entryNodeId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_graph_references(self) -> "WorkflowRuntimeGraph":
        if len(self.nodes) == 0:
            raise ValueError("graph.nodes must contain at least one node")

        node_ids: set[str] = set()
        for index, node in enumerate(self.nodes):
            if node.nodeId in node_ids:
                raise ValueError(f"graph.nodes[{index}].nodeId duplicates another node")
            node_ids.add(node.nodeId)

        if self.entryNodeId not in node_ids:
            raise ValueError("graph.entryNodeId references unknown node")

        edge_ids: set[str] = set()
        for index, edge in enumerate(self.edges):
            if edge.edgeId in edge_ids:
                raise ValueError(f"graph.edges[{index}].edgeId duplicates another edge")
            edge_ids.add(edge.edgeId)
            if edge.fromNodeId not in node_ids:
                raise ValueError("edge.fromNodeId references unknown node")
            if edge.toNodeId not in node_ids:
                raise ValueError("edge.toNodeId references unknown node")
        return self


class WorkflowRuntimeNodeResultEdge(BaseModel):
    model_config = ConfigDict(extra="allow")

    edgeId: str
    fromNodeId: str
    toNodeId: str
    status: WorkflowRuntimeEdgeStatus
    kind: Optional[WorkflowRuntimeEdgeKind] = None

    @field_validator("edgeId", "fromNodeId", "toNodeId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class WorkflowRuntimeNodeResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodeId: str
    status: WorkflowRuntimeNodeStatus
    attempts: int = Field(default=0, ge=0)
    startedAt: Optional[str] = None
    completedAt: Optional[str] = None
    output: Optional[Dict[str, Any]] = None
    edge: Optional[WorkflowRuntimeNodeResultEdge] = None
    error: Optional[WorkflowRuntimeError] = None

    @field_validator("nodeId", "startedAt", "completedAt")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class WorkflowRuntimeRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runId: str
    workflowId: str
    status: Literal["running", "done", "failed", "cancelled"]
    currentNodeId: Optional[str] = None
    startedAt: Optional[str] = None
    completedAt: Optional[str] = None
    nodeResults: List[WorkflowRuntimeNodeResult] = Field(default_factory=list)
    edgeTransitions: List[WorkflowRuntimeNodeResultEdge] = Field(default_factory=list)

    @field_validator("runId", "workflowId", "currentNodeId", "startedAt", "completedAt")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class WorkflowRuntimeBaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[WORKFLOW_RUNTIME_CONTRACT_VERSION] = (
        WORKFLOW_RUNTIME_CONTRACT_VERSION
    )
    runtime: Literal[WORKFLOW_RUNTIME_NAME] = WORKFLOW_RUNTIME_NAME
    operation: WorkflowRuntimeOperation
    ok: bool
    status: str


class WorkflowRuntimeGraphValidationResult(WorkflowRuntimeBaseResult):
    operation: Literal["graph_validation"] = "graph_validation"
    ok: Literal[True] = True
    status: Literal["validated"] = "validated"
    graph: WorkflowRuntimeGraph


class WorkflowRuntimeGraphValidationErrorResult(WorkflowRuntimeBaseResult):
    operation: Literal["graph_validation"] = "graph_validation"
    ok: Literal[False] = False
    status: Literal["failed"] = "failed"
    error: WorkflowRuntimeError


class WorkflowRuntimeRunStartResult(WorkflowRuntimeBaseResult):
    operation: Literal["run_start"] = "run_start"
    ok: Literal[True] = True
    status: Literal["running"] = "running"
    workflowId: str
    run: WorkflowRuntimeRun

    @field_validator("workflowId")
    @classmethod
    def _validate_workflow_id(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_run_workflow_id(self) -> "WorkflowRuntimeRunStartResult":
        if self.run.workflowId != self.workflowId:
            raise ValueError("run.workflowId must match workflowId")
        if self.run.status != "running":
            raise ValueError("run_start result requires running run status")
        return self


class WorkflowRuntimeNodeResultResult(WorkflowRuntimeBaseResult):
    operation: Literal["node_result"] = "node_result"
    ok: Literal[True] = True
    status: WorkflowRuntimeNodeStatus
    workflowId: str
    runId: str
    nodeResult: WorkflowRuntimeNodeResult

    @field_validator("workflowId", "runId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_node_status(self) -> "WorkflowRuntimeNodeResultResult":
        if self.nodeResult.status in {"failed", "cancelled"}:
            raise ValueError("failed or cancelled node results must use error result")
        if self.status != self.nodeResult.status:
            raise ValueError("nodeResult.status must match result status")
        return self


class WorkflowRuntimeFailureResult(WorkflowRuntimeBaseResult):
    operation: Literal["error"] = "error"
    ok: Literal[False] = False
    status: WorkflowRuntimeFailureStatus
    workflowId: str
    runId: Optional[str] = None
    nodeId: Optional[str] = None
    error: WorkflowRuntimeError

    @field_validator("workflowId", "runId", "nodeId")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


WorkflowRuntimeResult = Union[
    WorkflowRuntimeGraphValidationResult,
    WorkflowRuntimeGraphValidationErrorResult,
    WorkflowRuntimeRunStartResult,
    WorkflowRuntimeNodeResultResult,
    WorkflowRuntimeFailureResult,
]


def project_workflow_runtime_contract(payload: Dict[str, Any]) -> WorkflowRuntimeResult:
    """Project a deterministic workflow runtime contract result.

    No workflow node is executed. Inputs are only validated and copied into the
    stable Python contract envelope.
    """

    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")

    operation = _read_operation(payload.get("operation"))
    if operation == "graph_validation":
        graph, error = _read_graph(payload.get("graph"))
        if error:
            return WorkflowRuntimeGraphValidationErrorResult(error=error)
        return WorkflowRuntimeGraphValidationResult(graph=graph)

    if operation == "run_start":
        graph, error = _read_graph(payload.get("graph"))
        if error:
            workflow_id = _read_optional_non_empty(payload.get("workflowId"), "workflowId")
            return WorkflowRuntimeFailureResult(
                workflowId=workflow_id or "unknown-workflow",
                status="failed",
                error=error,
            )
        run_id = _read_non_empty(payload.get("runId"), "runId")
        started_at = _read_optional_non_empty(payload.get("startedAt"), "startedAt")
        return WorkflowRuntimeRunStartResult(
            workflowId=graph.workflowId,
            run=WorkflowRuntimeRun(
                runId=run_id,
                workflowId=graph.workflowId,
                status="running",
                currentNodeId=graph.entryNodeId,
                startedAt=started_at,
                nodeResults=[],
                edgeTransitions=[],
            ),
        )

    if operation == "node_result":
        workflow_id = _read_non_empty(payload.get("workflowId"), "workflowId")
        run_id = _read_non_empty(payload.get("runId"), "runId")
        node_result = WorkflowRuntimeNodeResult(**_read_object(payload.get("nodeResult"), "nodeResult"))
        return WorkflowRuntimeNodeResultResult(
            workflowId=workflow_id,
            runId=run_id,
            status=node_result.status,
            nodeResult=node_result,
        )

    workflow_id = _read_non_empty(payload.get("workflowId"), "workflowId")
    status = _read_failure_status(payload.get("status"))
    return WorkflowRuntimeFailureResult(
        workflowId=workflow_id,
        runId=_read_optional_non_empty(payload.get("runId"), "runId"),
        nodeId=_read_optional_non_empty(payload.get("nodeId"), "nodeId"),
        status=status,
        error=WorkflowRuntimeError(**_read_object(payload.get("error"), "error")),
    )


def _read_operation(value: Any) -> WorkflowRuntimeOperation:
    if value in {"graph_validation", "run_start", "node_result", "error"}:
        return value
    raise ValueError("operation must be graph_validation, run_start, node_result, or error")


def _read_failure_status(value: Any) -> WorkflowRuntimeFailureStatus:
    if value in {"failed", "cancelled"}:
        return value
    raise ValueError("status must be failed or cancelled")


def _read_non_empty(value: Any, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a non-empty string")
    return _non_empty(value)


def _read_optional_non_empty(value: Any, field_name: str) -> Optional[str]:
    if value is None:
        return None
    return _read_non_empty(value, field_name)


def _read_object(value: Any, field_name: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return value


def _read_graph(value: Any) -> Tuple[WorkflowRuntimeGraph, Optional[WorkflowRuntimeError]]:
    if not isinstance(value, dict):
        return (
            _fallback_graph(),
            WorkflowRuntimeError(
                code="graph_validation_failed",
                message="graph must be an object",
                field="graph",
            ),
        )

    try:
        graph = WorkflowRuntimeGraph(**value)
    except ValueError as error:
        return (
            _fallback_graph(value),
            _to_graph_validation_error(error),
        )
    return graph, None


def _fallback_graph(value: Optional[Dict[str, Any]] = None) -> WorkflowRuntimeGraph:
    workflow_id = value.get("workflowId") if isinstance(value, dict) else None
    return WorkflowRuntimeGraph(
        workflowId=workflow_id if isinstance(workflow_id, str) and workflow_id.strip() else "unknown-workflow",
        entryNodeId="unknown-node",
        nodes=[
            WorkflowRuntimeGraphNode(
                nodeId="unknown-node",
                type="unknown",
                title="Unknown",
            )
        ],
        edges=[],
    )


def _to_graph_validation_error(error: ValueError) -> WorkflowRuntimeError:
    message = str(error)
    if "edge.toNodeId references unknown node" in message:
        return WorkflowRuntimeError(
            code="graph_validation_failed",
            message="edge.toNodeId references unknown node",
            field=_find_edge_reference_field(message, "toNodeId"),
        )
    if "edge.fromNodeId references unknown node" in message:
        return WorkflowRuntimeError(
            code="graph_validation_failed",
            message="edge.fromNodeId references unknown node",
            field=_find_edge_reference_field(message, "fromNodeId"),
        )
    if "graph.entryNodeId references unknown node" in message:
        return WorkflowRuntimeError(
            code="graph_validation_failed",
            message="graph.entryNodeId references unknown node",
            field="graph.entryNodeId",
        )
    return WorkflowRuntimeError(
        code="graph_validation_failed",
        message="invalid graph shape",
        field="graph",
    )


def _find_edge_reference_field(message: str, field_name: str) -> str:
    # Pydantic includes the edge list index in validation errors. Keep this
    # small parser local to error projection so graph data is still model-based.
    for line in message.splitlines():
        line = line.strip()
        if line.startswith("Value error, edge."):
            continue
        if line.startswith("edges.") and "." in line:
            parts = line.split(".")
            if len(parts) >= 2 and parts[1].isdigit():
                return f"graph.edges[{parts[1]}].{field_name}"
    return f"graph.edges[0].{field_name}"
