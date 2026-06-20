"""Production wiring tests for real vector retrieval entry points.

The tests use fake transports and fake embeddings only. They prove config and
factory wiring can construct a vector runtime for evidence retrieval without
connecting to Qdrant or calling a real embedding service.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.config import get_vector_store_config  # noqa: E402
from sliderule_llm.evidence import retrieve_evidence  # noqa: E402
from sliderule_llm.vector import (  # noqa: E402
    VectorClientUnavailable,
    create_vector_runtime_from_config,
)


VECTOR_ENV_KEYS = (
    "SLIDERULE_VECTOR_RUNTIME",
    "RAG_VECTOR_RUNTIME",
    "SLIDERULE_REAL_VECTOR_RETRIEVAL_ENABLED",
    "RAG_VECTOR_RETRIEVAL_ENABLED",
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


class FakeEmbeddingProvider:
    def __init__(self, vector=None):
        self.vector = vector or [0.1, 0.2, 0.3]
        self.calls = []

    def embed_query(self, text):
        assert text.strip()
        self.calls.append(text)
        return self.vector


class FakeTransport:
    def __init__(self, response=None, error=None):
        self.response = response or {}
        self.error = error
        self.calls = []

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


def configure_qdrant_runtime_env():
    clear_vector_env()
    os.environ["SLIDERULE_VECTOR_RUNTIME"] = "qdrant"
    os.environ["QDRANT_URL"] = "http://qdrant.test:6333/"
    os.environ["QDRANT_API_KEY"] = "test-key"
    os.environ["QDRANT_COLLECTION"] = "prod_docs"
    os.environ["QDRANT_TIMEOUT_MS"] = "4321"
    os.environ["QDRANT_DIMENSION"] = "3"


def test_vector_store_config_exposes_disabled_runtime_by_default():
    clear_vector_env()

    config = get_vector_store_config()

    assert config.runtime == "disabled"
    assert config.enabled is False
    assert config.base_url == "http://localhost:6333"
    assert config.collection == "knowledge_base"


def test_configured_vector_runtime_hit_returns_retrieved_provenance():
    configure_qdrant_runtime_env()
    transport = FakeTransport(
        {
            "result": [
                {
                    "id": "chunk-prod-1",
                    "score": 0.88,
                    "payload": {
                        "content": "production wiring fixture evidence",
                        "sourceId": "doc-prod-1",
                        "title": "Production wiring notes",
                    },
                }
            ]
        }
    )
    embedding_provider = FakeEmbeddingProvider([0.1, 0.2, 0.3])
    runtime = create_vector_runtime_from_config(
        get_vector_store_config(),
        embedding_provider=embedding_provider,
        transport=transport,
    )

    result = retrieve_evidence(
        "production vector retrieval",
        vector_runtime=runtime,
        top_k=2,
    )

    assert embedding_provider.calls == ["production vector retrieval"]
    assert result.provenance == "retrieved"
    assert result.fallback_reason is None
    source = result.sources_as_dicts()[0]
    assert source["provenance"] == "retrieved"
    assert source["sourceId"] == "doc-prod-1"
    assert source["score"] == 0.88
    assert "fallbackReason" not in source

    call = transport.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "http://qdrant.test:6333/collections/prod_docs/points/search"
    assert call["headers"]["api-key"] == "test-key"
    assert call["timeout_ms"] == 4321
    assert call["body"]["vector"] == [0.1, 0.2, 0.3]
    assert call["body"]["limit"] == 2


def test_configured_vector_runtime_miss_returns_safe_fallback():
    configure_qdrant_runtime_env()
    embedding_provider = FakeEmbeddingProvider([0.1, 0.2, 0.3])
    runtime = create_vector_runtime_from_config(
        get_vector_store_config(),
        embedding_provider=embedding_provider,
        transport=FakeTransport({"result": []}),
    )

    result = retrieve_evidence("missing vector evidence", vector_runtime=runtime)

    assert result.provenance == "fallback"
    assert result.fallback_reason == "no_retrieval_hits"
    source = result.sources_as_dicts()[0]
    assert source["provenance"] == "fallback"
    assert source["fallbackReason"] == "no_retrieval_hits"
    assert "score" not in source
    assert "sourceId" not in source


def test_configured_vector_runtime_unavailable_returns_safe_fallback():
    configure_qdrant_runtime_env()
    embedding_provider = FakeEmbeddingProvider([0.1, 0.2, 0.3])
    runtime = create_vector_runtime_from_config(
        get_vector_store_config(),
        embedding_provider=embedding_provider,
        transport=FakeTransport(error=VectorClientUnavailable("offline")),
    )

    result = retrieve_evidence("unavailable vector evidence", vector_runtime=runtime)

    assert result.provenance == "fallback"
    assert result.fallback_reason == "vector_unavailable:VectorClientUnavailable"
    source = result.sources_as_dicts()[0]
    assert source["provenance"] == "fallback"
    assert source["fallbackReason"] == "vector_unavailable:VectorClientUnavailable"
    assert "score" not in source
    assert "sourceId" not in source


def test_disabled_vector_runtime_uses_fallback_without_embedding_or_transport_calls():
    clear_vector_env()
    embedding_provider = FakeEmbeddingProvider([0.1, 0.2, 0.3])
    transport = FakeTransport({"result": []})
    runtime = create_vector_runtime_from_config(
        get_vector_store_config(),
        embedding_provider=embedding_provider,
        transport=transport,
    )

    result = retrieve_evidence(
        "disabled vector runtime",
        vector_runtime=runtime,
        fallback_reason="vector_runtime_disabled",
    )

    assert runtime is None
    assert embedding_provider.calls == []
    assert transport.calls == []
    assert result.provenance == "fallback"
    assert result.fallback_reason == "vector_runtime_disabled"
    source = result.sources_as_dicts()[0]
    assert source["provenance"] == "fallback"
    assert source["fallbackReason"] == "vector_runtime_disabled"
