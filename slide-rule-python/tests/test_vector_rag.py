"""Vector RAG tests: embedding retrieval, honest fallback, ingest storage.

All vector-path tests inject a fake embedder — no network, no real endpoint.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import settings  # noqa: E402
from services.rag_service import (  # noqa: E402
    KNOWLEDGE_BASE,
    rag_ingest_contract,
    rag_query_search,
    retrieve_evidence,
)
from services.vector_rag import (  # noqa: E402
    EmbeddingUnavailable,
    LocalVectorIndex,
    OpenAICompatEmbedder,
    VectorRagStore,
    set_vector_store,
)

# 语义维度按主题词构造，确保排序与关键词打分器可区分且确定
_TOPICS = ("rbac", "audit", "mvp", "risk", "tool")


class FakeEmbedder:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[list[str]] = []

    def available(self) -> bool:
        return True

    def embed(self, texts):
        self.calls.append(list(texts))
        if self.fail:
            raise EmbeddingUnavailable("fake embed failure")
        vectors = []
        for text in texts:
            lowered = str(text).lower()
            vectors.append([1.0 if topic in lowered else 0.0 for topic in _TOPICS])
        return vectors


@pytest.fixture(autouse=True)
def _reset_store(monkeypatch):
    set_vector_store(None)
    monkeypatch.setattr(settings, "LLM_API_KEY", None)
    yield
    set_vector_store(None)


def _store(tmp_path, *, embedder=None):
    return VectorRagStore(
        embedder=embedder or FakeEmbedder(),
        index=LocalVectorIndex(str(tmp_path / "index.json")),
        seed_corpus=KNOWLEDGE_BASE,
    )


def test_local_index_upsert_search_and_persist_roundtrip(tmp_path):
    path = str(tmp_path / "idx.json")
    index = LocalVectorIndex(path)
    index.upsert(
        [
            {"id": "a", "content": "alpha", "source": "s1", "vector": [1.0, 0.0]},
            {"id": "b", "content": "beta", "source": "s2", "vector": [0.0, 1.0]},
        ]
    )

    top = index.search([1.0, 0.1], top_k=1)
    assert top[0]["id"] == "a"
    assert top[0]["retrieval"] == "vector"
    assert 0.0 <= top[0]["score"] <= 1.0

    reloaded = LocalVectorIndex(path)
    assert reloaded.count() == 2
    assert reloaded.search([0.1, 1.0], top_k=1)[0]["id"] == "b"


def test_store_seeds_corpus_lazily_and_ranks_semantically(tmp_path):
    store = _store(tmp_path)

    results = store.search("audit compliance 日志 audit", top_k=3)

    assert results, "seeded store must return results"
    assert results[0]["id"] == "audit1"
    assert all(r["retrieval"] == "vector" for r in results)


def test_retrieve_evidence_uses_injected_vector_store(tmp_path):
    set_vector_store(_store(tmp_path))

    results = retrieve_evidence("rbac 权限 rbac", top_k=3)

    assert results
    assert all(r.get("retrieval") == "vector" for r in results)


def test_retrieve_evidence_falls_back_to_keyword_without_store():
    results = retrieve_evidence("rbac 权限", top_k=3)

    assert results
    assert all(r.get("retrieval") == "keyword" for r in results)


def test_retrieve_evidence_falls_back_when_embedding_fails(tmp_path):
    set_vector_store(_store(tmp_path, embedder=FakeEmbedder(fail=True)))

    results = retrieve_evidence("rbac 权限", top_k=3)

    assert results
    assert all(r.get("retrieval") == "keyword" for r in results)


def test_rag_query_search_reports_semantic_mode_with_vector_store(tmp_path):
    set_vector_store(_store(tmp_path))

    data = rag_query_search("audit compliance", {"topK": 3})

    assert data["mode"] == "semantic"
    assert data["retrieval"] == "vector"
    assert data["provenance"] == "python-rag-query"
    assert data["results"] and data["results"][0]["retrieval"] == "vector"


def test_rag_query_search_reports_keyword_mode_without_store():
    data = rag_query_search("audit compliance 审计", {"topK": 3, "mode": "hybrid"})

    assert data["mode"] == "keyword"
    assert data["retrieval"] == "keyword"
    assert data["provenance"] == "python-rag-query"


def test_ingest_stores_into_vector_index_when_available(tmp_path):
    store = _store(tmp_path)
    set_vector_store(store)

    payload = {
        "operation": "ingest",
        "ingestionId": "ing-1",
        "projectId": "p1",
        "sourceType": "document",
        "sourceId": "doc-1",
        "timestamp": "2026-07-06T00:00:00Z",
        "content": "New tool integration evidence for mcp tool audits.",
    }
    result = rag_ingest_contract(payload)

    assert result["success"] is True
    assert result["migratedStorage"] is True
    assert result["storage"] == "python-rag-vector-index"
    assert result["chunkCount"] == 1
    hits = store.search("tool audits", top_k=8)
    assert any(h["id"] == "document:doc-1:0" for h in hits)


def test_ingest_stays_contract_only_without_vector_store():
    payload = {
        "operation": "ingest",
        "ingestionId": "ing-2",
        "projectId": "p1",
        "sourceType": "document",
        "sourceId": "doc-2",
        "timestamp": "2026-07-06T00:00:00Z",
        "content": "content",
    }
    result = rag_ingest_contract(payload)

    assert result["migratedStorage"] is False
    assert result["storage"] == "python-rag-ingest-contract"


class FakePost:
    def __init__(self, *, body=None, error=None):
        self.body = body
        self.error = error
        self.calls = []

    def __call__(self, url, payload, headers, timeout_s):
        self.calls.append((url, payload, headers))
        if self.error is not None:
            raise self.error
        return self.body


def test_openai_compat_embedder_parses_vectors_and_sends_auth():
    post = FakePost(body={"data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]})
    embedder = OpenAICompatEmbedder(
        base_url="http://llm.test/v1", api_key="k-1", model="emb-1", post=post
    )

    vectors = embedder.embed(["a", "b"])

    assert vectors == [[0.1, 0.2], [0.3, 0.4]]
    url, payload, headers = post.calls[0]
    assert url == "http://llm.test/v1/embeddings"
    assert payload == {"model": "emb-1", "input": ["a", "b"]}
    assert headers["Authorization"] == "Bearer k-1"


def test_openai_compat_embedder_unavailable_without_key_or_bad_shape():
    embedder = OpenAICompatEmbedder(base_url="http://llm.test", api_key="", model="m")
    assert embedder.available() is False
    with pytest.raises(EmbeddingUnavailable):
        embedder.embed(["a"])

    bad_shape = OpenAICompatEmbedder(
        base_url="http://llm.test",
        api_key="k",
        model="m",
        post=FakePost(body={"data": [{"no_embedding": True}]}),
    )
    with pytest.raises(EmbeddingUnavailable):
        bad_shape.embed(["a"])
