"""Runtime wiring tests for vector-backed evidence retrieval.

These tests prove evidence retrieval reaches vector search through an injected
VectorRuntime entry point. Fakes stay outside production wiring; no real Qdrant,
embedding keys, or LLM calls are used.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.evidence import EvidenceRetriever  # noqa: E402
from sliderule_llm.vector import (  # noqa: E402
    VectorClientUnavailable,
    VectorSearchHit,
    create_vector_runtime,
)


class TrackingEmbeddingProvider:
    def __init__(self, vector: list[float] | None = None):
        self.vector = vector or [1.0, 0.0, 0.0, 0.0]
        self.calls: list[str] = []

    def embed_query(self, text: str) -> list[float]:
        assert text.strip()
        self.calls.append(text)
        return self.vector


def _cosine_similarity(left, right):
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sum(value * value for value in left) ** 0.5
    right_norm = sum(value * value for value in right) ** 0.5
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


class InMemoryVectorClient:
    """Test fake only: exercises runtime wiring without network access."""

    def __init__(self, *, unavailable: bool = False):
        self._records = {}
        self._unavailable = unavailable

    def upsert(self, records):
        if self._unavailable:
            raise VectorClientUnavailable("in-memory vector store unavailable")
        for record in records:
            self._records[str(record["id"])] = {
                "vector": [float(value) for value in record["vector"]],
                "content": str(record.get("content") or ""),
                "metadata": dict(record.get("metadata") or {}),
            }

    def search(self, query_vector, *, top_k=10):
        if self._unavailable:
            raise VectorClientUnavailable("in-memory vector store unavailable")

        scored = []
        query = [float(value) for value in query_vector]
        for record_id, record in self._records.items():
            scored.append((_cosine_similarity(query, record["vector"]), record_id))
        scored.sort(key=lambda item: item[0], reverse=True)

        hits = []
        for score, record_id in scored[:top_k]:
            record = self._records[record_id]
            hits.append(
                VectorSearchHit(
                    id=record_id,
                    score=score,
                    content=record["content"],
                    metadata=record["metadata"],
                )
            )
        return hits


def _seed_store(client: InMemoryVectorClient) -> None:
    client.upsert(
        [
            {
                "id": "chunk-runtime-1",
                "vector": [1.0, 0.0, 0.0, 0.0],
                "content": "runtime wiring fixture evidence for vector retrieval",
                "metadata": {
                    "sourceId": "doc-runtime-1",
                    "title": "Runtime fixture notes",
                    "sourceType": "document",
                },
            }
        ]
    )


def _retriever_from_runtime(vector_client, embedding_provider) -> EvidenceRetriever:
    runtime = create_vector_runtime(
        vector_client=vector_client,
        embedding_provider=embedding_provider,
    )
    return EvidenceRetriever.from_runtime(runtime)


def test_runtime_injected_vector_store_returns_retrieved_provenance():
    vector_client = InMemoryVectorClient()
    _seed_store(vector_client)
    embedding_provider = TrackingEmbeddingProvider([1.0, 0.0, 0.0, 0.0])
    retriever = _retriever_from_runtime(vector_client, embedding_provider)

    result = retriever.retrieve("runtime vector evidence")

    assert embedding_provider.calls == ["runtime vector evidence"]
    assert result.provenance == "retrieved"
    assert result.fallback_reason is None

    source_dict = result.sources_as_dicts()[0]
    assert source_dict["provenance"] == "retrieved"
    assert source_dict["sourceId"] == "doc-runtime-1"
    assert source_dict["score"] > 0.99
    assert "runtime wiring fixture evidence" in source_dict["snippet"]
    assert "fallbackReason" not in source_dict


def test_runtime_empty_vector_store_returns_honest_fallback():
    vector_client = InMemoryVectorClient()
    embedding_provider = TrackingEmbeddingProvider([1.0, 0.0, 0.0, 0.0])
    retriever = _retriever_from_runtime(vector_client, embedding_provider)

    result = retriever.retrieve("unknown runtime evidence")

    assert embedding_provider.calls == ["unknown runtime evidence"]
    assert result.provenance == "fallback"
    assert result.fallback_reason == "no_retrieval_hits"

    source_dict = result.sources_as_dicts()[0]
    assert source_dict["provenance"] == "fallback"
    assert source_dict["fallbackReason"] == "no_retrieval_hits"
    assert "not as real RAG retrieval" in source_dict["snippet"]
    assert "score" not in source_dict
    assert "sourceId" not in source_dict


def test_runtime_unavailable_vector_store_returns_honest_fallback():
    vector_client = InMemoryVectorClient(unavailable=True)
    embedding_provider = TrackingEmbeddingProvider([1.0, 0.0, 0.0, 0.0])
    retriever = _retriever_from_runtime(vector_client, embedding_provider)

    result = retriever.retrieve("runtime vector evidence")

    assert embedding_provider.calls == ["runtime vector evidence"]
    assert result.provenance == "fallback"
    assert result.fallback_reason == "vector_unavailable:VectorClientUnavailable"

    source_dict = result.sources_as_dicts()[0]
    assert source_dict["provenance"] == "fallback"
    assert source_dict["fallbackReason"] == "vector_unavailable:VectorClientUnavailable"
    assert "score" not in source_dict
    assert "sourceId" not in source_dict
