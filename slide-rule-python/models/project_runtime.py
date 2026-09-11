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

RuntimeStatus = Literal["provisioning", "syncing", "installing", "executing", "starting", "ready", "stopping", "stopped", "expired", "failed", "reconciling"]


class RuntimeInstance(ProjectContract):
    runtimeId: str
    workspaceId: str
    projectId: str
    revision: str
    status: RuntimeStatus
    port: int
    previewUrl: str | None = None
    processId: str | None = None
    health: str | None = None
    lastHeartbeat: str
    expiresAt: float | None = None
    errorCode: str | None = None


class PreviewDescriptor(ProjectContract):
    kind: Literal["project"] = "project"
    projectId: str
    runtimeId: str
    revision: str
    status: RuntimeStatus
    entryUrl: str | None = None
    expiresAt: str | None = None
    capabilities: list[str] = Field(default_factory=list)


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
    cancelRequested: bool = False
    lastAccessAt: float | None = None
    runtime: RuntimeInstance | None = None
    stateVersion: int = 0
    pendingEvent: dict[str, Any] | None = None
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


class ProjectOperationView(ProjectContract):
    """Public operation fields; lease, dispatch and outbox data stay private."""

    operationId: str
    projectId: str
    sessionId: str
    kind: str
    expectedRevision: str
    status: OperationStatus
    cancelRequested: bool
    lastAccessAt: float | None
    stateVersion: int
    createdAt: str
    updatedAt: str


class RuntimeView(ProjectContract):
    runtimeId: str
    workspaceId: str
    projectId: str
    revision: str
    status: RuntimeStatus
    port: int
    health: str | None
    lastHeartbeat: str
    expiresAt: float | None
    errorCode: str | None


class ProjectOperationSnapshot(ProjectContract):
    operation: ProjectOperationView
    runtime: RuntimeView | None
    lastSeq: int


class RuntimeEventView(ProjectContract):
    schemaVersion: Literal[1]
    sessionId: str
    projectId: str
    operationId: str
    seq: int
    type: str
    timestamp: str
    payload: dict[str, Any]


class RuntimeEventPage(ProjectContract):
    events: list[RuntimeEventView]
    nextSeq: int
    hasMore: bool
