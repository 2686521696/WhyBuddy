"""
RAG query/search contract test for backend-python-no-node cutover task 37.

Verifies Python is the source for /api/rag/search (and ingest) behavior.
Uses TestClient against mounted app (requires app include of routes/rag).

Asserts:
- Python provenance signals present (backend, source, provenance: python-rag-query)
- Search returns results shape + no crash
- Bad payload for search yields 400 (contract)
- Ingest delegate path returns python signals (even contract-only)
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements first): {e}", allow_module_level=True)

client = TestClient(app)


def test_rag_search_returns_python_provenance_and_results():
    resp = client.post("/api/rag/search", json={"query": "RBAC 权限 风险", "options": {"topK": 3, "mode": "hybrid"}})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data.get("results"), list)
    assert "totalCandidates" in data
    assert data.get("provenance") == "python-rag-query"
    assert data.get("backend") == "slide-rule-python"
    assert data.get("source") == "python"
    # mode echoed
    assert data.get("mode") in ("hybrid", "keyword", "semantic")


def test_rag_search_requires_query():
    resp = client.post("/api/rag/search", json={"options": {}})
    assert resp.status_code == 400
    body = resp.json()
    message = body.get("message") or body.get("detail") or ""
    assert "query" in message.lower()


def test_rag_ingest_returns_python_signals():
    payload = {"sourceType": "task_result", "sourceId": "t-105", "content": "test rag query task content", "projectId": "p105", "timestamp": "2026-07-02T00:00:00Z"}
    resp = client.post("/api/rag/ingest", json={"payload": payload})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("provenance") == "python-rag-query"
    assert data.get("backend") == "slide-rule-python"
    assert data.get("source") == "python"


def test_rag_ingest_batch_contract_shape():
    resp = client.post("/api/rag/ingest/batch", json={"payloads": [{"sourceType": "document", "sourceId": "d1", "content": "c", "projectId": "p", "timestamp": "t"}]})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("provenance") == "python-rag-query"
    assert data.get("backend") == "slide-rule-python"
    assert "accepted" in data


def test_rag_rag_health_under_prefix():
    resp = client.get("/api/rag/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("backend") == "slide-rule-python"
    assert data.get("provenance") == "python-rag-query"
