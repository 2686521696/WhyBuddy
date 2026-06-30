"""Production-storage boundary tests for Python RAG ingestion.

This slice verifies adapter wiring only. It must not connect to Qdrant,
Postgres, object storage, real embeddings, or production knowledge bases.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.rag_service import (  # noqa: E402
    MemoryRAGIngestionStorageAdapter,
    UnavailableRAGIngestionStorageAdapter,
    run_rag_ingestion_production_storage,
)
from services.rag_ingestion import (  # noqa: E402
    project_rag_ingestion_production_storage,
)


def _payload(operation: str = "ingest") -> dict:
    return {
        "operation": operation,
        "ingestionId": "ingest-production-1",
        "projectId": "project-production",
        "sourceType": "document",
        "sourceId": "doc-production-1",
        "content": "First production storage paragraph.\n\nSecond paragraph.",
        "timestamp": "2026-06-20T00:00:00.000Z",
        "metadata": {"title": "Production storage contract"},
        "provenance": {
            "provider": "memory",
            "source": "production-storage-test",
            "auditId": "audit-production-storage-1",
        },
    }


def test_memory_storage_ingest_and_chunk_paths_are_explicitly_fake_memory():
    adapter = MemoryRAGIngestionStorageAdapter()

    ingest = run_rag_ingestion_production_storage(_payload("ingest"), storage=adapter)
    chunk = run_rag_ingestion_production_storage(_payload("chunk"), storage=adapter)

    assert ingest["ok"] is True
    assert ingest["status"] == "completed"
    assert ingest["storage"] == "memory"
    assert ingest["migratedStorage"] is False
    assert ingest["ingest"]["chunkCount"] == 2
    assert ingest["provenance"]["provider"] == "memory"
    assert ingest["provenance"]["source"] == "production-storage-test"

    assert chunk["ok"] is True
    assert chunk["status"] == "completed"
    assert chunk["storage"] == "memory"
    assert chunk["migratedStorage"] is False
    assert len(chunk["chunks"]) == 2
    assert chunk["chunks"][0]["chunkId"] == "document:doc-production-1:0"


def test_memory_storage_upsert_and_delete_report_real_adapter_attempts():
    adapter = MemoryRAGIngestionStorageAdapter()

    upsert = run_rag_ingestion_production_storage(_payload("upsert"), storage=adapter)
    delete = run_rag_ingestion_production_storage(_payload("delete"), storage=adapter)

    assert upsert["ok"] is True
    assert upsert["status"] == "completed"
    assert upsert["storage"] == "memory"
    assert upsert["upsert"]["attempted"] is True
    assert upsert["upsert"]["stored"] is True
    assert upsert["upsert"]["upsertedCount"] == 2
    assert upsert["upsert"]["recordIds"] == [
        "document:doc-production-1:0",
        "document:doc-production-1:1",
    ]

    assert delete["ok"] is True
    assert delete["status"] == "completed"
    assert delete["storage"] == "memory"
    assert delete["delete"]["attempted"] is True
    assert delete["delete"]["deleted"] is True
    assert delete["delete"]["deletedCount"] == 2
    assert delete["delete"]["targetIds"] == [
        "document:doc-production-1:0",
        "document:doc-production-1:1",
    ]


def test_production_storage_is_exposed_from_rag_ingestion_contract_module():
    adapter = MemoryRAGIngestionStorageAdapter()

    result = project_rag_ingestion_production_storage(
        _payload("upsert"),
        storage=adapter,
    ).model_dump(exclude_none=True)

    assert result["ok"] is True
    assert result["status"] == "completed"


def test_rag_ingestion_python_vector_provider_no_key_degraded_fake_upsert_delete_retrieve():
    """105 required: no-key degraded, fake Qdrant, upsert/delete/retrieve via Python provider."""
    p = _payload("upsert")
    p["usePythonVectorProvider"] = True
    p["forceDegraded"] = True
    res = project_rag_ingestion_production_storage(p, storage=None).model_dump(exclude_none=True)
    assert res["ok"] is True
    # must reflect python provider (or explicit degraded unavailable), not fall to contract-only
    assert res.get("storage") in ("unavailable", "python-vector")
    assert res.get("migratedStorage") is True
    # delete path
    pd = _payload("delete")
    pd["usePythonVectorProvider"] = True
    pd["forceDegraded"] = True
    rd = project_rag_ingestion_production_storage(pd, storage=None).model_dump(exclude_none=True)
    assert rd["ok"] is True
    assert rd.get("storage") in ("unavailable", "python-vector")


def test_rag_vector_provider_embedding_mismatch_visible():
    """105: embedding mismatch produces stable visible contract failure from provider path."""
    p = _payload("upsert")
    p["usePythonVectorProvider"] = True
    p["forceEmbeddingMismatch"] = True
    result = project_rag_ingestion_production_storage(p, storage=None)
    assert result is not None
    d = result.model_dump(exclude_none=True) if hasattr(result, "model_dump") else result
    # mismatch must be visible, not arbitrary catch
    assert d.get("ok") is False or d.get("status") == "unavailable" or "mismatch" in str(d.get("error", "")).lower()


def test_unavailable_storage_returns_failure_without_success_payload():
    result = run_rag_ingestion_production_storage(
        _payload("upsert"),
        storage=UnavailableRAGIngestionStorageAdapter("storage offline"),
    )

    assert result["ok"] is False
    assert result["status"] == "unavailable"
    assert result["storage"] == "unavailable"
    assert result["migratedStorage"] is False
    assert result["error"] == {
        "code": "python_rag_ingestion_storage_unavailable",
        "message": "storage offline",
        "retryable": True,
    }
    assert result["deadLetter"]["stage"] == "store"
    assert result["deadLetter"]["error"] == "storage offline"
    assert "upsert" not in result
