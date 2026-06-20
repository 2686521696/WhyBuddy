"""Contract tests for the Python-side RAG ingestion runtime boundary.

This slice only locks deterministic ingest/chunk/embed/upsert/delete/error
shapes. It must not call a real embedding provider, connect to Qdrant, or
delete real vector records.
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.rag_ingestion import (  # noqa: E402
    RAG_INGESTION_RUNTIME_CONTRACT_VERSION,
    RAGIngestionRuntimeCompletedResult,
    project_rag_ingestion_runtime_contract,
)


def _payload(operation: str) -> dict:
    return {
        "operation": operation,
        "ingestionId": "ingest-contract-1",
        "projectId": "project-contract",
        "sourceType": "document",
        "sourceId": "doc-contract-1",
        "content": "First paragraph for ingestion.\n\nSecond paragraph for ingestion.",
        "timestamp": "2026-06-20T00:00:00.000Z",
        "metadata": {
            "title": "Contract document",
            "tags": ["contract", "fake-runtime"],
        },
        "lifecycle": {
            "state": "active",
            "archiveAfterDays": 90,
            "deleteAfterDays": 365,
        },
        "feedback": {
            "helpfulChunkIds": ["document:doc-contract-1:0"],
            "irrelevantChunkIds": [],
            "missingContext": "none",
        },
        "deadLetter": {
            "entryId": "dlq-contract-1",
            "retryCount": 2,
            "stage": "embed",
            "error": "previous fake failure",
        },
        "provenance": {
            "provider": "fake",
            "source": "contract-test",
            "auditId": "audit-rag-ingest-1",
        },
    }


@pytest.mark.parametrize(
    ("operation", "field"),
    [
        ("ingest", "ingest"),
        ("chunk", "chunks"),
        ("embed", "embeddings"),
        ("upsert", "upsert"),
        ("delete", "delete"),
    ],
)
def test_contract_expresses_each_ingestion_operation(operation: str, field: str):
    result = project_rag_ingestion_runtime_contract(_payload(operation)).model_dump(
        exclude_none=True
    )

    assert result["contractVersion"] == RAG_INGESTION_RUNTIME_CONTRACT_VERSION
    assert result["runtime"] == "python-contract"
    assert result["operation"] == operation
    assert result["ok"] is True
    assert result["status"] == "completed"
    assert result["storage"] == "contract-only"
    assert result["migratedStorage"] is False
    assert field in result

    assert result["provenance"] == {
        "provider": "fake",
        "source": "contract-test",
        "auditId": "audit-rag-ingest-1",
    }
    assert result["lifecycle"] == {
        "state": "active",
        "archiveAfterDays": 90,
        "deleteAfterDays": 365,
    }
    assert result["feedback"] == {
        "helpfulChunkIds": ["document:doc-contract-1:0"],
        "irrelevantChunkIds": [],
        "missingContext": "none",
    }
    assert result["deadLetter"] == {
        "entryId": "dlq-contract-1",
        "retryCount": 2,
        "stage": "embed",
        "error": "previous fake failure",
    }


def test_chunk_and_embed_contract_are_deterministic_without_real_embedding_calls():
    chunk_result = project_rag_ingestion_runtime_contract(_payload("chunk")).model_dump(
        exclude_none=True
    )
    embed_result = project_rag_ingestion_runtime_contract(_payload("embed")).model_dump(
        exclude_none=True
    )

    chunks = chunk_result["chunks"]
    assert len(chunks) == 2
    assert chunks[0]["chunkId"] == "document:doc-contract-1:0"
    assert chunks[0]["metadata"]["contentHash"].startswith("fake-sha256:")
    assert chunks[0]["metadata"]["title"] == "Contract document"

    embeddings = embed_result["embeddings"]
    assert len(embeddings) == 2
    assert embeddings[0]["chunkId"] == chunks[0]["chunkId"]
    assert embeddings[0]["provider"] == "fake-contract-embedding"
    assert embeddings[0]["dimension"] == 4
    assert embeddings[0]["vector"] == [0.2321, 0.3614, 0.2588, 0.2436]


def test_upsert_and_delete_do_not_claim_real_storage_mutation():
    upsert = project_rag_ingestion_runtime_contract(_payload("upsert")).model_dump(
        exclude_none=True
    )
    delete = project_rag_ingestion_runtime_contract(_payload("delete")).model_dump(
        exclude_none=True
    )

    assert upsert["upsert"] == {
        "collection": "rag_project-contract",
        "attempted": True,
        "stored": False,
        "upsertedCount": 0,
        "recordIds": ["document:doc-contract-1:0", "document:doc-contract-1:1"],
    }
    assert delete["delete"] == {
        "collection": "rag_project-contract",
        "attempted": True,
        "deleted": False,
        "deletedCount": 0,
        "targetIds": ["document:doc-contract-1:0", "document:doc-contract-1:1"],
    }


def test_unavailable_runtime_returns_safe_failure_without_success_payload():
    payload = _payload("ingest")
    payload["runtimeAvailable"] = False
    result = project_rag_ingestion_runtime_contract(payload).model_dump(exclude_none=True)

    assert result["ok"] is False
    assert result["status"] == "unavailable"
    assert result["error"] == {
        "code": "python_rag_ingestion_unavailable",
        "message": "RAG ingestion Python runtime is unavailable.",
        "retryable": True,
    }
    assert result["deadLetter"]["stage"] == "metadata"
    assert result["deadLetter"]["error"] == "RAG ingestion Python runtime is unavailable."
    assert "ingest" not in result
    assert result["provenance"]["source"] == "contract-test"
    assert result["lifecycle"]["state"] == "active"
    assert result["feedback"]["helpfulChunkIds"] == ["document:doc-contract-1:0"]


def test_completed_contract_rejects_failed_status_mutation():
    result = project_rag_ingestion_runtime_contract(_payload("upsert")).model_dump(
        exclude_none=True
    )
    result["status"] = "failed"
    result["ok"] = False

    with pytest.raises(ValidationError):
        RAGIngestionRuntimeCompletedResult(**result)


def test_contract_rejects_unknown_operation_before_runtime_work():
    with pytest.raises(ValueError, match="operation must be"):
        project_rag_ingestion_runtime_contract(_payload("store"))
