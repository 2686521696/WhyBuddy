"""Read-only Blueprint main state contract models.

Python exposes the minimum state projection needed for staged migration. The
full Blueprint and Autopilot state machines remain Node-owned.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

BLUEPRINT_MAIN_STATE_CONTRACT_VERSION = "blueprint.main.state.v1"
BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION = "blueprint.main-state.runtime.v1"

BlueprintGenerationStage = Literal[
    "input",
    "clarification",
    "route_generation",
    "spec_tree",
    "spec_docs",
    "preview",
    "effect_preview",
    "prompt_packaging",
    "runtime_capability",
    "engineering_handoff",
    "engineering_landing",
]

BlueprintNodeGenerationStatus = Literal[
    "pending",
    "running",
    "waiting",
    "reviewing",
    "completed",
    "failed",
]

BlueprintMainStateStatus = Literal["pending", "running", "done", "failed", "stale"]

BlueprintGenerationArtifactType = Literal[
    "intake",
    "github_source",
    "clarification_session",
    "project_context",
    "route_set",
    "route_selection",
    "spec_tree",
    "spec_tree_version",
    "requirements",
    "design",
    "tasks",
    "spec_document_version",
    "brainstorm_reasoning_graph",
    "preview",
    "effect_preview",
    "prompt_pack",
    "capability_registry",
    "agent_crew",
    "role_timeline",
    "capability_invocation",
    "capability_evidence",
    "sandbox_derivation_job",
    "engineering_plan",
    "engineering_run",
    "replay",
    "feedback",
]

BlueprintStaleReason = Literal[
    "upstream_target_changed",
    "upstream_clarification_changed",
    "upstream_route_changed",
    "upstream_route_selection_changed",
    "upstream_explicit_invalidation",
]


def _non_empty(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


class BlueprintStaleSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: BlueprintGenerationStage
    artifactId: str
    artifactType: BlueprintGenerationArtifactType
    reason: BlueprintStaleReason
    triggeredAt: str

    @field_validator("artifactId", "triggeredAt")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class BlueprintMainStateArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: BlueprintGenerationArtifactType
    title: str
    summary: str
    createdAt: str
    payload: Optional[Any] = None
    stale: bool = False
    staleSince: Optional[str] = None
    invalidatedBy: Optional[BlueprintStaleSource] = None

    @field_validator("id", "title", "summary", "createdAt")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_stale_shape(self) -> "BlueprintMainStateArtifact":
        if self.stale and not self.staleSince:
            raise ValueError("stale artifacts must include staleSince")
        if not self.stale and self.staleSince:
            raise ValueError("staleSince requires stale=true")
        return self


class BlueprintMainStateError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    stage: BlueprintGenerationStage
    retryable: Optional[bool] = None

    @field_validator("code", "message")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class BlueprintMainStateProjection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[BLUEPRINT_MAIN_STATE_CONTRACT_VERSION] = BLUEPRINT_MAIN_STATE_CONTRACT_VERSION
    kind: Literal["blueprint.main.state_projection"] = "blueprint.main.state_projection"
    stateAuthority: Literal["node"] = "node"
    stateMutation: Literal["none"] = "none"
    jobId: str
    projectId: Optional[str] = None
    sourceId: Optional[str] = None
    version: Optional[str] = None
    stage: BlueprintGenerationStage
    status: BlueprintMainStateStatus
    nodeStatus: BlueprintNodeGenerationStatus
    createdAt: Optional[str] = None
    updatedAt: str
    completedAt: Optional[str] = None
    artifacts: List[BlueprintMainStateArtifact] = Field(default_factory=list)
    stale: bool = False
    staleArtifactIds: List[str] = Field(default_factory=list)
    error: Optional[BlueprintMainStateError] = None
    errors: List[BlueprintMainStateError] = Field(default_factory=list)

    @field_validator("jobId", "updatedAt")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_contract_consistency(self) -> "BlueprintMainStateProjection":
        if self.error is not None and not self.errors:
            self.errors = [self.error]
        if self.errors and self.error is None:
            self.error = self.errors[0]

        artifact_ids = {artifact.id for artifact in self.artifacts}
        unknown_stale_ids = [artifact_id for artifact_id in self.staleArtifactIds if artifact_id not in artifact_ids]
        if unknown_stale_ids:
            raise ValueError("staleArtifactIds must reference projected artifacts")

        if self.status == "failed":
            if self.nodeStatus != "failed":
                raise ValueError("failed projection requires nodeStatus=failed")
            if not self.errors:
                raise ValueError("failed projection requires error details")
            return self

        if self.nodeStatus == "failed" or self.errors or self.error is not None:
            raise ValueError("error details require failed status")

        if self.status == "done" and self.nodeStatus != "completed":
            raise ValueError("done projection requires nodeStatus=completed")

        if self.status == "stale":
            if self.nodeStatus == "failed":
                raise ValueError("stale projection cannot mask nodeStatus=failed")
            if not self.stale or not self.staleArtifactIds:
                raise ValueError("stale projection requires stale marker and staleArtifactIds")
            return self

        if self.status == "pending" and self.nodeStatus != "pending":
            raise ValueError("pending projection requires nodeStatus=pending")

        if self.status == "running" and self.nodeStatus not in {"running", "waiting", "reviewing"}:
            raise ValueError("running projection requires active Node status")

        return self


def parse_blueprint_main_state_projection(payload: Dict[str, Any]) -> BlueprintMainStateProjection:
    try:
        return BlueprintMainStateProjection(**payload)
    except ValidationError:
        raise


class BlueprintMainStateRuntimeBoundary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner: Literal["python"] = "python"
    mode: Literal["runtime_bridge"] = "runtime_bridge"
    stateAuthority: Literal["node"] = "node"
    stateMutation: Literal["none"] = "none"
    jobStoreOwner: Literal["node"] = "node"
    eventBusOwner: Literal["node"] = "node"
    ledgerOwner: Literal["node"] = "node"
    previewOwner: Literal["node"] = "node"
    promptPackageOwner: Literal["node"] = "node"


class BlueprintMainStateReadEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["node-job-snapshot"] = "node-job-snapshot"
    projectedAt: str

    @field_validator("projectedAt")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class BlueprintMainStateUpdateEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: Literal[False] = False
    reason: Literal["node_state_owner"] = "node_state_owner"
    message: str
    requestedPatch: Optional[Dict[str, Any]] = None

    @field_validator("message")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class BlueprintMainStateRuntimeSuccess(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: Literal[True] = True
    operation: Literal["read", "project", "update"]
    contractVersion: Literal[BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION] = (
        BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION
    )
    runtime: BlueprintMainStateRuntimeBoundary
    jobId: str
    projection: BlueprintMainStateProjection
    read: BlueprintMainStateReadEnvelope
    update: BlueprintMainStateUpdateEnvelope
    provenance: Literal["python-blueprint-state-runtime"] = "python-blueprint-state-runtime"

    @field_validator("jobId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class BlueprintMainStateRuntimeError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: Literal[False] = False
    operation: str
    contractVersion: Literal[BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION] = (
        BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION
    )
    error: Literal[
        "invalid_operation",
        "validation_error",
        "not_found",
        "projection_error",
        "boundary_violation",
    ]
    reason: str
    message: str
    statusCode: int
    jobId: Optional[str] = None
    retryable: bool = False
    provenance: Literal["python-blueprint-state-runtime"] = "python-blueprint-state-runtime"

    @field_validator("operation", "reason", "message")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)
