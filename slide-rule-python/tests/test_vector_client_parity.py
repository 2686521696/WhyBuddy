"""Network-free tests for the Python vector client parity slice."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.vector import (  # noqa: E402
    QdrantVectorClient,
    VectorClientTimeout,
    VectorClientUnavailable,
    VectorConfig,
    get_vector_config,
)


VECTOR_ENV_KEYS = (
    "QDRANT_URL",
    "QDRANT_API_KEY",
    "QDRANT_COLLECTION",
    "QDRANT_TIMEOUT_MS",
    "QDRANT_DIMENSION",
    "RAG_VECTOR_STORE_URL",
    "RAG_VECTOR_STORE_API_KEY",
    "RAG_VECTOR_COLLECTION",
    "RAG_VECTOR_TIMEOUT_MS",
    "RAG_EMBEDDING_DIMENSION",
)


def clear_vector_env():
    for key in VECTOR_ENV_KEYS:
        os.environ.pop(key, None)


class FakeTransport:
    def __init__(self, response=None, error=None):
        self.calls = []
        self.response = response or {}
        self.error = error

    def __call__(self, method, url, body, headers, timeout_ms):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "body": body,
                "headers": dict(headers),
                "timeout_ms": timeout_ms,
            }
        )
        if self.error:
            raise self.error
        return self.response


def test_get_vector_config_reads_qdrant_env():
    clear_vector_env()
    os.environ["QDRANT_URL"] = "http://qdrant.local:6333/"
    os.environ["QDRANT_API_KEY"] = "test-key"
    os.environ["QDRANT_COLLECTION"] = "sliderule"
    os.environ["QDRANT_TIMEOUT_MS"] = "1234"
    os.environ["QDRANT_DIMENSION"] = "768"

    cfg = get_vector_config()

    assert cfg.base_url == "http://qdrant.local:6333"
    assert cfg.api_key == "test-key"
    assert cfg.collection == "sliderule"
    assert cfg.timeout_ms == 1234
    assert cfg.dimension == 768


def test_get_vector_config_falls_back_to_rag_env_and_defaults():
    clear_vector_env()
    os.environ["RAG_VECTOR_STORE_URL"] = "http://rag-qdrant:6333"
    os.environ["RAG_VECTOR_COLLECTION"] = "rag_docs"
    os.environ["RAG_EMBEDDING_DIMENSION"] = "384"

    cfg = get_vector_config()

    assert cfg.base_url == "http://rag-qdrant:6333"
    assert cfg.collection == "rag_docs"
    assert cfg.dimension == 384
    assert cfg.timeout_ms == 10000


def test_search_shapes_qdrant_request_and_parses_hits():
    transport = FakeTransport(
        {
            "result": [
                {
                    "id": "doc-1",
                    "score": 0.91,
                    "payload": {
                        "content": "retrieved evidence",
                        "sourceType": "document",
                        "sourceId": "source-1",
                    },
                }
            ]
        }
    )
    client = QdrantVectorClient(
        VectorConfig(
            base_url="http://qdrant.test",
            collection="knowledge",
            api_key="api-key",
            timeout_ms=500,
            dimension=3,
        ),
        transport=transport,
    )

    hits = client.search([0.1, 0.2, 0.3], top_k=2, min_score=0.5, filter={"sourceType": ["document"]})

    assert len(hits) == 1
    assert hits[0].id == "doc-1"
    assert hits[0].score == 0.91
    assert hits[0].content == "retrieved evidence"
    call = transport.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "http://qdrant.test/collections/knowledge/points/search"
    assert call["timeout_ms"] == 500
    assert call["headers"]["api-key"] == "api-key"
    assert call["body"]["vector"] == [0.1, 0.2, 0.3]
    assert call["body"]["limit"] == 2
    assert call["body"]["score_threshold"] == 0.5
    assert call["body"]["filter"] == {"must": [{"key": "sourceType", "match": {"any": ["document"]}}]}


def test_upsert_and_delete_use_qdrant_points_endpoints():
    transport = FakeTransport()
    client = QdrantVectorClient(
        VectorConfig("http://qdrant.test", "knowledge", "", 1000, 2),
        transport=transport,
    )

    client.upsert(
        [
            {
                "id": "chunk-1",
                "vector": [0.2, 0.4],
                "content": "hello",
                "metadata": {"sourceType": "document"},
            }
        ]
    )
    client.delete(["chunk-1"])

    assert transport.calls[0]["method"] == "PUT"
    assert transport.calls[0]["url"] == "http://qdrant.test/collections/knowledge/points"
    assert transport.calls[0]["body"]["points"][0]["payload"]["content"] == "hello"
    assert transport.calls[1]["method"] == "POST"
    assert transport.calls[1]["url"] == "http://qdrant.test/collections/knowledge/points/delete"
    assert transport.calls[1]["body"] == {"points": ["chunk-1"]}


def test_timeout_is_classified():
    client = QdrantVectorClient(
        VectorConfig("http://qdrant.test", "knowledge", "", 1000, 2),
        transport=FakeTransport(error=TimeoutError("slow")),
    )

    try:
        client.search([0.1, 0.2])
    except VectorClientTimeout:
        pass
    else:
        raise AssertionError("expected VectorClientTimeout")


def test_transport_error_is_classified_as_unavailable():
    client = QdrantVectorClient(
        VectorConfig("http://qdrant.test", "knowledge", "", 1000, 2),
        transport=FakeTransport(error=RuntimeError("boom")),
    )

    try:
        client.search([0.1, 0.2])
    except VectorClientUnavailable as exc:
        assert "boom" in str(exc)
    else:
        raise AssertionError("expected VectorClientUnavailable")


def test_health_check_returns_false_for_unavailable_backend():
    client = QdrantVectorClient(
        VectorConfig("http://qdrant.test", "knowledge", "", 1000, 2),
        transport=FakeTransport(error=RuntimeError("down")),
    )

    assert client.health_check() == {"connected": False, "backend": "qdrant"}


# --- Additional coverage required by 105 review: no-key degraded, fake Qdrant via provider, embedding mismatch, retrieve ---
from sliderule_llm.vector import RAGVectorStoreProvider, create_rag_vector_provider  # noqa: E402


def test_rag_vector_provider_no_key_degraded():
    clear_vector_env()
    prov = RAGVectorStoreProvider(config=VectorConfig("http://f", "c", "", 100, 2), force_degraded=True)
    assert prov.is_degraded() is True
    res = prov.upsert([{"id": "x", "vector": [0.1, 0.2], "content": "c"}], "coll")
    assert res.get("attempted") is True
    assert res.get("stored") in (False, None) or res.get("degraded")


def test_rag_vector_provider_fake_qdrant_upsert_delete_retrieve():
    clear_vector_env()
    transport = FakeTransport({"result": [{"id": "h1", "score": 0.8, "payload": {"content": "hit"}}]})
    prov = RAGVectorStoreProvider(
        config=VectorConfig("http://f", "c", "", 100, 2),
        transport=transport,
    )
    up = prov.upsert([{"id": "id1", "vector": [0.1, 0.2], "content": "hi"}], "c")
    assert up["stored"] is True
    assert up["upsertedCount"] == 1
    hits = prov.search([0.1, 0.2], top_k=1)
    assert len(hits) == 1
    d = prov.delete(["id1"], "c")
    assert d["deleted"] is True


def test_rag_vector_provider_embedding_mismatch_raises():
    clear_vector_env()
    prov = RAGVectorStoreProvider(
        config=VectorConfig("http://f", "c", "k", 100, 4),
        transport=FakeTransport(),
    )
    try:
        prov.upsert([{"id": "bad", "vector": [0.1, 0.2], "content": "x"}], "c")
    except Exception as exc:  # noqa: BLE001
        assert "mismatch" in str(exc).lower() or "dim" in str(exc).lower()
    else:
        raise AssertionError("expected embedding mismatch")


def test_create_rag_vector_provider_fallback_degraded():
    clear_vector_env()
    p = create_rag_vector_provider(force_degraded=True)
    assert p.is_degraded()


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        clear_vector_env()
        try:
            fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {fn.__name__}: {exc!r}")
    print(f"\n{passed}/{len(fns)} passed")
    sys.exit(0 if passed == len(fns) else 1)
