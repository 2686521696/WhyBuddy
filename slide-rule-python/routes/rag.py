"""
RAG query/search API router for Python backend cutover (task 37).

Exposes /api/rag/search and /api/rag/ingest (and batch) so that Node's
server/routes/rag.ts delegate can prefer Python as the source of truth
for RAG query/search behavior.

Classification: PYTHON_FIRST_COMPAT for query/search.
Node route becomes explicit thin proxy/compat shell (delegate drives; fallback only on connect/404).
Python responses include provenance signals for verification.

Uses rag_service for the search impl (keyword baseline consistent with other python-rag).
"""

from fastapi import APIRouter, HTTPException
from typing import Any, Dict, List, Optional

from services.rag_service import (
    rag_query_search,
    rag_ingest_contract,
    RAG_QUERY_PROVENANCE,
    RAG_QUERY_BACKEND,
)

router = APIRouter()


@router.post("/search")
def search_rag(body: Dict[str, Any]) -> Dict[str, Any]:
    """POST /api/rag/search

    Body may be { "query": "...", "options": { ... } } or wrapped.
    Returns results with explicit python provenance.
    """
    query = body.get("query") or (body.get("payload", {}) or {}).get("query")
    options = body.get("options") or (body.get("payload", {}) or {}).get("options") or body.get("payload") or {}
    if not query or not isinstance(query, str):
        raise HTTPException(status_code=400, detail="query is required")
    result = rag_query_search(query, options if isinstance(options, dict) else {})
    # ensure signals (defense in depth)
    result.setdefault("provenance", RAG_QUERY_PROVENANCE)
    result.setdefault("backend", RAG_QUERY_BACKEND)
    result.setdefault("source", "python")
    return result


@router.post("/ingest")
def ingest_rag(body: Dict[str, Any]) -> Dict[str, Any]:
    """POST /api/rag/ingest (compat for delegate)

    Accepts { "payload": <IngestionPayload> } or direct.
    Returns contract result (storage contract only in this slice).
    """
    payload = body.get("payload") or body
    if not isinstance(payload, dict) or not payload.get("sourceType") or not payload.get("sourceId") or not payload.get("content"):
        # Still return python-shaped error so delegate treats as delegated result (visible failure)
        return {
            "success": False,
            "ok": False,
            "status": "unavailable",
            "error": {"code": "python_rag_ingest_bad_payload", "message": "Missing required fields", "retryable": False},
            "provenance": RAG_QUERY_PROVENANCE,
            "backend": RAG_QUERY_BACKEND,
            "source": "python",
        }
    res = rag_ingest_contract(payload)
    return res


@router.post("/ingest/batch")
def ingest_batch(body: Dict[str, Any]) -> Dict[str, Any]:
    payloads = body.get("payloads") or []
    if not isinstance(payloads, list):
        return {"error": "payloads must be an array", "provenance": RAG_QUERY_PROVENANCE, "backend": RAG_QUERY_BACKEND, "source": "python"}
    # For contract slice, accept batch by returning aggregated contract (no full batch impl yet)
    return {
        "success": True,
        "accepted": len(payloads),
        "operation": "batch",
        "provenance": RAG_QUERY_PROVENANCE,
        "backend": RAG_QUERY_BACKEND,
        "source": "python",
        "migratedStorage": False,
    }


# GET health alias under rag for direct probe
@router.get("/health")
def rag_health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "backend": RAG_QUERY_BACKEND,
        "source": "python",
        "provenance": RAG_QUERY_PROVENANCE,
    }
