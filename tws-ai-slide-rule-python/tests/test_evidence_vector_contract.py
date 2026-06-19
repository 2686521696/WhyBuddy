"""Contract tests: sources[] presence does not imply real vector retrieval.

These tests lock the provenance boundary before wiring production Qdrant.
They use fake vector/embedding transports only — no external services or keys.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.evidence import (  # noqa: E402
    EvidenceRetriever,
    fallback_evidence,
    generated_sources_from_content,
)
from sliderule_llm.vector import QdrantVectorClient, VectorClientUnavailable, VectorConfig  # noqa: E402


class FakeEmbeddingProvider:
    def __init__(self, vector=None, error=None):
        self.vector = vector or [0.1, 0.2]
        self.error = error

    def embed_query(self, text):
        if self.error:
            raise self.error
        assert text
        return self.vector


class FakeTransport:
    def __init__(self, response=None, error=None):
        self.response = response or {}
        self.error = error

    def __call__(self, method, url, body, headers, timeout_ms):
        if self.error:
            raise self.error
        return self.response


def make_vector_client(response=None, error=None):
    return QdrantVectorClient(
        VectorConfig("http://qdrant.test", "knowledge", "", 1000, 2),
        transport=FakeTransport(response=response, error=error),
    )


def test_contract_retrieved_preserves_provenance_score_and_source_id():
    retriever = EvidenceRetriever(
        vector_client=make_vector_client(
            {
                "result": [
                    {
                        "id": "chunk-42",
                        "score": 0.91,
                        "payload": {
                            "content": "vector-backed snippet",
                            "sourceId": "doc-42",
                            "title": "Contract fixture",
                        },
                    }
                ]
            }
        ),
        embedding_provider=FakeEmbeddingProvider(),
    )

    result = retriever.retrieve("contract query")

    assert result.provenance == "retrieved"
    source_dict = result.sources_as_dicts()[0]
    assert source_dict["provenance"] == "retrieved"
    assert source_dict["sourceId"] == "doc-42"
    assert source_dict["score"] == 0.91
    assert "fallbackReason" not in source_dict


def test_contract_vector_unavailable_is_fallback_not_retrieved():
    retriever = EvidenceRetriever(
        vector_client=make_vector_client(error=VectorClientUnavailable("down")),
        embedding_provider=FakeEmbeddingProvider(),
    )

    result = retriever.retrieve("contract query")

    assert result.provenance == "fallback"
    source_dict = result.sources_as_dicts()[0]
    assert source_dict["provenance"] == "fallback"
    assert source_dict["fallbackReason"] == "vector_unavailable:VectorClientUnavailable"
    assert "score" not in source_dict
    assert "sourceId" not in source_dict


def test_contract_no_hits_is_fallback_not_fake_rag():
    retriever = EvidenceRetriever(
        vector_client=make_vector_client({"result": []}),
        embedding_provider=FakeEmbeddingProvider(),
    )

    result = retriever.retrieve("no-hit query")

    assert result.provenance == "fallback"
    assert result.fallback_reason == "no_retrieval_hits"
    source_dict = result.sources_as_dicts()[0]
    assert source_dict["provenance"] == "fallback"
    assert "not as real RAG retrieval" in source_dict["snippet"]


def test_contract_generated_sources_are_not_retrieved():
    sources = generated_sources_from_content(
        "- LLM prose citation about desk progression rules"
    )

    assert len(sources) >= 1
    source_dict = sources[0].to_dict()
    assert source_dict["provenance"] == "generated"
    assert source_dict["fallbackReason"] == "llm_prose_only"
    assert "score" not in source_dict
    assert "sourceId" not in source_dict


def test_contract_sources_presence_does_not_imply_vector_retrieval():
    """Consumers must read provenance, not infer retrieval from sources[]."""
    generated = generated_sources_from_content("generated line with enough length")
    fallback = fallback_evidence("query", reason="manual")

    assert generated[0].to_dict()["provenance"] == "generated"
    assert fallback.sources_as_dicts()[0]["provenance"] == "fallback"

    for payload in [generated[0].to_dict(), fallback.sources_as_dicts()[0]]:
        assert "title" in payload
        assert "snippet" in payload
        assert payload["provenance"] != "retrieved"