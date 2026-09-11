"""Server-owned contracts for persistent source projects and runtime operations.

The project revision is independent from a sandbox: an expired provider instance
must never erase the source or make evidence for an older tree look current.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ManifestFile(ProjectContract):
    path: str
    sha256: str
    sizeBytes: int


class ProjectManifest(ProjectContract):
    schemaVersion: Literal[1] = 1
    treeHash: str
    totalBytes: int
    files: list[ManifestFile]


class Project(ProjectContract):
    projectId: str
    sessionId: str
    ownerId: str
    runtimeKind: Literal["project"] = "project"
    currentRevision: str
    createdAt: str
    updatedAt: str
    revisionCount: int = 1
    sourceBytesStored: int = 0


class ProjectRevision(ProjectContract):
    revision: str
    projectId: str
    parentRevision: str | None = None
    treeHash: str
    manifest: ProjectManifest
    templateVersion: str
    planRef: str
    specRevision: str | None = None
    createdAt: str


class WorkspaceLease(ProjectContract):
    workspaceId: str
    projectId: str
    generation: int
    leaseOwner: str
    expiresAt: float
    sandboxId: str | None = None
    mountedRevision: str | None = None
    provider: Literal["e2b"] = "e2b"
    processRefs: dict[str, Any] = Field(default_factory=dict)


OperationStatus = Literal[
    "queued", "running", "waiting_user", "completed", "failed",
    "cancelling", "cancelled", "interrupted",
]


class ProjectOperation(ProjectContract):
    operationId: str
    projectId: str
    sessionId: str
    kind: str
    idempotencyKey: str
    requestHash: str
    expectedRevision: str
    approvalRef: str
    status: OperationStatus = "queued"
    input: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    leaseGeneration: int | None = None
    leaseOwner: str | None = None
    createdAt: str
    updatedAt: str


class RuntimeEvent(ProjectContract):
    schemaVersion: Literal[1] = 1
    eventId: str
    sessionId: str
    projectId: str
    operationId: str
    seq: int
    type: str
    timestamp: str
    payload: dict[str, Any] = Field(default_factory=dict)
