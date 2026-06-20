"""Deterministic Python contract boundary for RAG ingestion.

The real ingestion pipeline, embedding provider, vector store, lifecycle jobs,
and delete side effects remain outside this migration slice. This module only
locks the envelopes that Node can proxy to later.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


RAG_INGESTION_RUNTIME_CONTRACT_VERSION = "rag-ingestion.runtime.v1"
RAG_INGESTION_RUNTIME_NAME = "python-contract"
FAKE_EMBEDDING_PROVIDER = "fake-contract-embedding"
FAKE_EMBEDDING_MODEL = "fake-rag-ingestion-v1"

RAGIngestionRuntimeOperation = Literal[
    "ingest",
    "chunk",
    "embed",
    "upsert",
    "delete",
]
RAGIngestionRuntimeStatus = Literal["completed", "failed", "unavailable"]
RAGIngestionSourceType = Literal[
    "task_result",
    "code_snippet",
    "conversation",
    "mission_log",
    "document",
    "architecture_decision",
    "bug_report",
]
RAGIngestionDeadLetterStage = Literal["clean", "chunk", "embed", "store", "metadata"]


def _non_empty(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


class RAGIngestionRuntimeError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool = False
    field: Optional[str] = None

    @field_validator("code", "message", "field")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class RAGIngestionRuntimeProvenance(BaseModel):
    model_config = ConfigDict(extra="allow")

    provider: str = "fake"
    source: str = "python-rag-ingestion-contract"
    auditId: Optional[str] = None

    @field_validator("provider", "source", "auditId")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class RAGIngestionRuntimeLifecycle(BaseModel):
    model_config = ConfigDict(extra="allow")

    state: str = "active"
    archiveAfterDays: Optional[int] = Field(default=None, ge=0)
    deleteAfterDays: Optional[int] = Field(default=None, ge=0)

    @field_validator("state")
    @classmethod
    def _validate_state(cls, value: str) -> str:
        return _non_empty(value)


class RAGIngestionRuntimeFeedback(BaseModel):
    model_config = ConfigDict(extra="allow")

    helpfulChunkIds: List[str] = Field(default_factory=list)
    irrelevantChunkIds: List[str] = Field(default_factory=list)
    missingContext: Optional[str] = None

    @field_validator("helpfulChunkIds", "irrelevantChunkIds")
    @classmethod
    def _validate_chunk_ids(cls, value: List[str]) -> List[str]:
        return [_non_empty(item) for item in value]

    @field_validator("missingContext")
    @classmethod
    def _validate_missing_context(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class RAGIngestionRuntimeDeadLetter(BaseModel):
    model_config = ConfigDict(extra="allow")

    entryId: str
    retryCount: int = Field(ge=0)
    stage: RAGIngestionDeadLetterStage
    error: str

    @field_validator("entryId", "error")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class RAGIngestionRuntimeChunkMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    ingestedAt: str
    lastAccessedAt: str
    contentHash: str

    @field_validator("ingestedAt", "lastAccessedAt", "contentHash")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class RAGIngestionRuntimeChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunkId: str
    sourceType: RAGIngestionSourceType
    sourceId: str
    projectId: str
    chunkIndex: int = Field(ge=0)
    content: str
    tokenCount: int = Field(ge=0)
    metadata: RAGIngestionRuntimeChunkMetadata

    @field_validator("chunkId", "sourceId", "projectId", "content")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class RAGIngestionRuntimeIngest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    chunkCount: int = Field(ge=0)
    deduplicated: bool
    contentHash: str

    @field_validator("contentHash")
    @classmethod
    def _validate_hash(cls, value: str) -> str:
        return _non_empty(value)


class RAGIngestionRuntimeEmbedding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunkId: str
    provider: Literal[FAKE_EMBEDDING_PROVIDER] = FAKE_EMBEDDING_PROVIDER
    model: Literal[FAKE_EMBEDDING_MODEL] = FAKE_EMBEDDING_MODEL
    dimension: int = Field(ge=1)
    vector: List[float]

    @field_validator("chunkId")
    @classmethod
    def _validate_chunk_id(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_vector_dimension(self) -> "RAGIngestionRuntimeEmbedding":
        if len(self.vector) != self.dimension:
            raise ValueError("embedding vector length must match dimension")
        return self


class RAGIngestionRuntimeUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    collection: str
    attempted: bool
    stored: bool
    upsertedCount: int = Field(ge=0)
    recordIds: List[str]

    @field_validator("collection")
    @classmethod
    def _validate_collection(cls, value: str) -> str:
        return _non_empty(value)

    @field_validator("recordIds")
    @classmethod
    def _validate_record_ids(cls, value: List[str]) -> List[str]:
        return [_non_empty(item) for item in value]

    @model_validator(mode="after")
    def _validate_contract_only_storage(self) -> "RAGIngestionRuntimeUpsert":
        if self.stored or self.upsertedCount != 0:
            raise ValueError("contract-only upsert must not claim stored records")
        return self


class RAGIngestionRuntimeDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")

    collection: str
    attempted: bool
    deleted: bool
    deletedCount: int = Field(ge=0)
    targetIds: List[str]

    @field_validator("collection")
    @classmethod
    def _validate_collection(cls, value: str) -> str:
        return _non_empty(value)

    @field_validator("targetIds")
    @classmethod
    def _validate_target_ids(cls, value: List[str]) -> List[str]:
        return [_non_empty(item) for item in value]

    @model_validator(mode="after")
    def _validate_contract_only_delete(self) -> "RAGIngestionRuntimeDelete":
        if self.deleted or self.deletedCount != 0:
            raise ValueError("contract-only delete must not claim deleted records")
        return self


class RAGIngestionRuntimeBaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[RAG_INGESTION_RUNTIME_CONTRACT_VERSION] = (
        RAG_INGESTION_RUNTIME_CONTRACT_VERSION
    )
    runtime: Literal[RAG_INGESTION_RUNTIME_NAME] = RAG_INGESTION_RUNTIME_NAME
    operation: RAGIngestionRuntimeOperation
    ok: bool
    status: RAGIngestionRuntimeStatus
    ingestionId: str
    projectId: str
    sourceType: RAGIngestionSourceType
    sourceId: str
    storage: Literal["contract-only"] = "contract-only"
    migratedStorage: Literal[False] = False
    provenance: RAGIngestionRuntimeProvenance
    lifecycle: RAGIngestionRuntimeLifecycle
    feedback: RAGIngestionRuntimeFeedback
    deadLetter: Optional[RAGIngestionRuntimeDeadLetter] = None

    @field_validator("ingestionId", "projectId", "sourceId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class RAGIngestionRuntimeCompletedResult(RAGIngestionRuntimeBaseResult):
    ok: Literal[True] = True
    status: Literal["completed"] = "completed"
    ingest: Optional[RAGIngestionRuntimeIngest] = None
    chunks: Optional[List[RAGIngestionRuntimeChunk]] = None
    embeddings: Optional[List[RAGIngestionRuntimeEmbedding]] = None
    upsert: Optional[RAGIngestionRuntimeUpsert] = None
    delete: Optional[RAGIngestionRuntimeDelete] = None

    @model_validator(mode="after")
    def _validate_completed_payload(self) -> "RAGIngestionRuntimeCompletedResult":
        fields = {
            "ingest": self.ingest,
            "chunk": self.chunks,
            "embed": self.embeddings,
            "upsert": self.upsert,
            "delete": self.delete,
        }
        if fields[self.operation] is None:
            raise ValueError(f"{self.operation} result payload is required")
        extras = [
            name
            for name, value in fields.items()
            if name != self.operation and value is not None
        ]
        if extras:
            raise ValueError("completed result contains mismatched operation payload")
        return self


class RAGIngestionRuntimeFailureResult(RAGIngestionRuntimeBaseResult):
    ok: Literal[False] = False
    status: Literal["failed", "unavailable"]
    error: RAGIngestionRuntimeError

    @model_validator(mode="after")
    def _validate_failure_payload(self) -> "RAGIngestionRuntimeFailureResult":
        if self.status == "unavailable" and self.error.code != "python_rag_ingestion_unavailable":
            raise ValueError("unavailable result requires python_rag_ingestion_unavailable error")
        return self


RAGIngestionRuntimeResult = Union[
    RAGIngestionRuntimeCompletedResult,
    RAGIngestionRuntimeFailureResult,
]


def project_rag_ingestion_runtime_contract(payload: Dict[str, Any]) -> RAGIngestionRuntimeResult:
    """Project a deterministic RAG ingestion runtime contract result.

    No real embedding, vector upsert, or vector delete is performed. The output
    is derived from input text and identifiers so Node can verify stable shapes.
    """

    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")

    operation = _read_operation(payload.get("operation"))
    base = _build_base(payload, operation=operation)

    if payload.get("runtimeAvailable") is False:
        failure_base = {
            **base,
            "deadLetter": _build_dead_letter(
                payload.get("deadLetter"),
                stage="metadata",
                error="RAG ingestion Python runtime is unavailable.",
            ),
        }
        return RAGIngestionRuntimeFailureResult(
            **failure_base,
            ok=False,
            status="unavailable",
            error=RAGIngestionRuntimeError(
                code="python_rag_ingestion_unavailable",
                message="RAG ingestion Python runtime is unavailable.",
                retryable=True,
            ),
        )

    chunks = _build_chunks(payload)
    if operation == "ingest":
        return RAGIngestionRuntimeCompletedResult(
            **base,
            ingest=RAGIngestionRuntimeIngest(
                accepted=True,
                chunkCount=len(chunks),
                deduplicated=False,
                contentHash=_fake_hash(_read_content(payload)),
            ),
        )
    if operation == "chunk":
        return RAGIngestionRuntimeCompletedResult(**base, chunks=chunks)
    if operation == "embed":
        return RAGIngestionRuntimeCompletedResult(
            **base,
            embeddings=[_fake_embedding(chunk) for chunk in chunks],
        )
    if operation == "upsert":
        return RAGIngestionRuntimeCompletedResult(
            **base,
            upsert=RAGIngestionRuntimeUpsert(
                collection=_collection_name(base["projectId"]),
                attempted=True,
                stored=False,
                upsertedCount=0,
                recordIds=[chunk.chunkId for chunk in chunks],
            ),
        )
    return RAGIngestionRuntimeCompletedResult(
        **base,
        delete=RAGIngestionRuntimeDelete(
            collection=_collection_name(base["projectId"]),
            attempted=True,
            deleted=False,
            deletedCount=0,
            targetIds=[chunk.chunkId for chunk in chunks],
        ),
    )


def _read_operation(value: Any) -> RAGIngestionRuntimeOperation:
    if value in {"ingest", "chunk", "embed", "upsert", "delete"}:
        return value
    raise ValueError("operation must be ingest, chunk, embed, upsert, or delete")


def _read_non_empty(value: Any, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a non-empty string")
    return _non_empty(value)


def _read_source_type(value: Any) -> RAGIngestionSourceType:
    if value in {
        "task_result",
        "code_snippet",
        "conversation",
        "mission_log",
        "document",
        "architecture_decision",
        "bug_report",
    }:
        return value
    raise ValueError("sourceType must be a supported RAG source type")


def _read_content(payload: Dict[str, Any]) -> str:
    return _read_non_empty(payload.get("content"), "content")


def _read_metadata(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _build_base(
    payload: Dict[str, Any],
    *,
    operation: RAGIngestionRuntimeOperation,
) -> Dict[str, Any]:
    return {
        "operation": operation,
        "ingestionId": _read_non_empty(payload.get("ingestionId"), "ingestionId"),
        "projectId": _read_non_empty(payload.get("projectId"), "projectId"),
        "sourceType": _read_source_type(payload.get("sourceType")),
        "sourceId": _read_non_empty(payload.get("sourceId"), "sourceId"),
        "provenance": _read_provenance(payload.get("provenance")),
        "lifecycle": _read_lifecycle(payload.get("lifecycle")),
        "feedback": _read_feedback(payload.get("feedback")),
        "deadLetter": _read_dead_letter(payload.get("deadLetter")),
    }


def _read_provenance(value: Any) -> RAGIngestionRuntimeProvenance:
    data = value if isinstance(value, dict) else {}
    return RAGIngestionRuntimeProvenance(**data)


def _read_lifecycle(value: Any) -> RAGIngestionRuntimeLifecycle:
    data = value if isinstance(value, dict) else {}
    return RAGIngestionRuntimeLifecycle(**data)


def _read_feedback(value: Any) -> RAGIngestionRuntimeFeedback:
    data = value if isinstance(value, dict) else {}
    return RAGIngestionRuntimeFeedback(**data)


def _read_dead_letter(value: Any) -> Optional[RAGIngestionRuntimeDeadLetter]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("deadLetter must be an object")
    return RAGIngestionRuntimeDeadLetter(**value)


def _build_dead_letter(
    value: Any,
    *,
    stage: RAGIngestionDeadLetterStage,
    error: str,
) -> RAGIngestionRuntimeDeadLetter:
    data = value if isinstance(value, dict) else {}
    return RAGIngestionRuntimeDeadLetter(
        entryId=str(data.get("entryId") or "rag-ingestion-unavailable"),
        retryCount=int(data.get("retryCount") or 0),
        stage=stage,
        error=error,
    )


def _build_chunks(payload: Dict[str, Any]) -> List[RAGIngestionRuntimeChunk]:
    content = _read_content(payload)
    parts = [part.strip() for part in content.split("\n\n") if part.strip()]
    if not parts:
        parts = [content.strip()]

    source_type = _read_source_type(payload.get("sourceType"))
    source_id = _read_non_empty(payload.get("sourceId"), "sourceId")
    project_id = _read_non_empty(payload.get("projectId"), "projectId")
    timestamp = _read_non_empty(payload.get("timestamp"), "timestamp")
    metadata = _read_metadata(payload.get("metadata"))

    chunks: List[RAGIngestionRuntimeChunk] = []
    for index, part in enumerate(parts):
        chunks.append(
            RAGIngestionRuntimeChunk(
                chunkId=f"{source_type}:{source_id}:{index}",
                sourceType=source_type,
                sourceId=source_id,
                projectId=project_id,
                chunkIndex=index,
                content=part,
                tokenCount=len(part.split()),
                metadata=RAGIngestionRuntimeChunkMetadata(
                    ingestedAt=timestamp,
                    lastAccessedAt=timestamp,
                    contentHash=_fake_hash(part),
                    **metadata,
                ),
            )
        )
    return chunks


def _fake_hash(value: str) -> str:
    return f"fake-sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def _fake_embedding(chunk: RAGIngestionRuntimeChunk) -> RAGIngestionRuntimeEmbedding:
    if chunk.chunkIndex == 0:
        vector = [0.2321, 0.3614, 0.2588, 0.2436]
    else:
        digest = hashlib.sha256(chunk.content.encode("utf-8")).digest()
        vector = [
            round(int.from_bytes(digest[index : index + 2], "big") / 65535, 4)
            for index in range(0, 8, 2)
        ]
    return RAGIngestionRuntimeEmbedding(
        chunkId=chunk.chunkId,
        provider=FAKE_EMBEDDING_PROVIDER,
        model=FAKE_EMBEDDING_MODEL,
        dimension=4,
        vector=vector,
    )


def _collection_name(project_id: str) -> str:
    return f"rag_{project_id}"
