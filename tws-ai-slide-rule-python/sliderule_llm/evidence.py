"""Evidence retrieval boundary for Python SlideRule capabilities.

This layer separates real retrieval hits from fallback/generated/degraded shapes so
`sources` never pretend to be vector-backed when they are not.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Protocol

RETRIEVED_PROVENANCE: Final = "retrieved"
FALLBACK_PROVENANCE: Final = "fallback"
GENERATED_PROVENANCE: Final = "generated"
DEGRADED_PROVENANCE: Final = "degraded"

EVIDENCE_RUNTIME_PROVENANCE: Final = frozenset(
    {
        RETRIEVED_PROVENANCE,
        FALLBACK_PROVENANCE,
        GENERATED_PROVENANCE,
        DEGRADED_PROVENANCE,
    }
)

from .vector import (
    QdrantVectorClient,
    VectorClientError,
    VectorRuntime,
    VectorSearchHit,
)


class EmbeddingProvider(Protocol):
    def embed_query(self, text: str) -> list[float]:
        ...


@dataclass(frozen=True)
class EvidenceSource:
    title: str
    snippet: str
    provenance: str
    source_id: str | None = None
    score: float | None = None
    metadata: dict[str, Any] | None = None
    fallback_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "title": self.title,
            "snippet": self.snippet,
            "provenance": self.provenance,
        }
        if self.source_id:
            data["sourceId"] = self.source_id
        if self.score is not None:
            data["score"] = self.score
        if self.metadata:
            data["metadata"] = self.metadata
        if self.fallback_reason:
            data["fallbackReason"] = self.fallback_reason
        return data


@dataclass(frozen=True)
class EvidenceRetrievalResult:
    sources: list[EvidenceSource]
    provenance: str
    fallback_reason: str | None = None
    error: str | None = None

    def sources_as_dicts(self) -> list[dict[str, Any]]:
        return [source.to_dict() for source in self.sources]

    def to_payload_fields(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "evidenceProvenance": self.provenance,
            "sources": self.sources_as_dicts(),
        }
        if self.fallback_reason:
            payload["fallbackReason"] = self.fallback_reason
        if self.error:
            payload["error"] = self.error
        return payload


class EvidenceRetriever:
    def __init__(
        self,
        *,
        vector_client: QdrantVectorClient,
        embedding_provider: EmbeddingProvider,
    ) -> None:
        self.vector_client = vector_client
        self.embedding_provider = embedding_provider

    @classmethod
    def from_runtime(cls, runtime: VectorRuntime) -> EvidenceRetriever:
        return cls(
            vector_client=runtime.vector_client,
            embedding_provider=runtime.embedding_provider,
        )

    def retrieve(self, query: str, *, top_k: int = 4) -> EvidenceRetrievalResult:
        try:
            query_vector = self.embedding_provider.embed_query(query)
            hits = self.vector_client.search(query_vector, top_k=top_k)
        except VectorClientError as exc:
            return fallback_evidence(
                query,
                reason=f"vector_unavailable:{exc.__class__.__name__}",
            )
        except Exception as exc:  # noqa: BLE001
            return fallback_evidence(
                query,
                reason=f"retrieval_failed:{exc.__class__.__name__}",
            )

        if not hits:
            return fallback_evidence(query, reason="no_retrieval_hits")
        return EvidenceRetrievalResult(
            sources=[source_from_vector_hit(hit) for hit in hits],
            provenance=RETRIEVED_PROVENANCE,
        )


def retrieve_evidence(
    query: str,
    *,
    vector_runtime: VectorRuntime | None = None,
    top_k: int = 4,
    fallback_reason: str = "vector_runtime_unavailable",
) -> EvidenceRetrievalResult:
    """Select configured vector retrieval or an explicit safe fallback."""
    if vector_runtime is None:
        return fallback_evidence(query, reason=fallback_reason)
    return EvidenceRetriever.from_runtime(vector_runtime).retrieve(query, top_k=top_k)


def source_from_vector_hit(hit: VectorSearchHit) -> EvidenceSource:
    title = str(hit.metadata.get("title") or hit.metadata.get("sourceId") or hit.id)
    return EvidenceSource(
        title=title[:120],
        snippet=hit.content[:500],
        provenance=RETRIEVED_PROVENANCE,
        source_id=str(hit.metadata.get("sourceId") or hit.id),
        score=hit.score,
        metadata=hit.metadata,
    )


def generated_sources_from_content(content: str, *, limit: int = 4) -> list[EvidenceSource]:
    """Generated citations derived from LLM prose. Honest, but not retrieval."""
    sources: list[EvidenceSource] = []
    for line in content.splitlines():
        snippet = line.strip().lstrip("-*#").strip()
        if len(snippet) < 12:
            continue
        sources.append(
            EvidenceSource(
                title=snippet[:80],
                snippet=snippet[:240],
                provenance=GENERATED_PROVENANCE,
                fallback_reason="llm_prose_only",
            )
        )
        if len(sources) >= limit:
            break
    if not sources:
        sources.append(
            EvidenceSource(
                title="Generated reasoning",
                snippet=content[:240],
                provenance=GENERATED_PROVENANCE,
                fallback_reason="llm_prose_only",
            )
        )
    return sources


def fallback_evidence(query: str, *, reason: str) -> EvidenceRetrievalResult:
    snippet = (
        "No vector-backed evidence was retrieved. Treat this as an explicit "
        "fallback source, not as real RAG retrieval."
    )
    if query.strip():
        snippet += f" Query: {query.strip()[:180]}"
    return EvidenceRetrievalResult(
        sources=[
            EvidenceSource(
                title="Fallback evidence",
                snippet=snippet,
                provenance=FALLBACK_PROVENANCE,
                fallback_reason=reason,
            )
        ],
        provenance=FALLBACK_PROVENANCE,
        fallback_reason=reason,
    )


def degraded_evidence(query: str, *, error: str, reason: str | None = None) -> EvidenceRetrievalResult:
    """Hard runtime failure — no sources masquerading as retrieval."""
    detail = reason or error
    if query.strip():
        detail = f"{detail}; query={query.strip()[:120]}"
    return EvidenceRetrievalResult(
        sources=[],
        provenance=DEGRADED_PROVENANCE,
        fallback_reason=detail,
        error=error,
    )


def execute_evidence_runtime(query: str) -> EvidenceRetrievalResult:
    """Minimal Node-facing evidence runtime boundary.

    This slice intentionally does not connect a production vector store. Until
    real retrieval dependencies are injected by a later slice, the runtime
    returns an explicit fallback provenance instead of pretending retrieval
    succeeded.
    """
    return fallback_evidence(query, reason="vector_runtime_not_configured")
