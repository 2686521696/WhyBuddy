"""Evidence runtime wiring used by the Node thin proxy.

These tests exercise the Python route that Node calls. The LLM caller and
evidence runtime are patched so the suite stays network-free while still
proving retrieved, fallback, and degraded provenance shapes are returned to
Node without being relabeled.
"""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes.sliderule import router  # noqa: E402
from sliderule_llm.client import LlmResult  # noqa: E402
from sliderule_llm.evidence import (  # noqa: E402
    EvidenceRetrievalResult,
    EvidenceSource,
    degraded_evidence,
    fallback_evidence,
)


INTERNAL_KEY = "dev-slide-rule-internal"


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/sliderule")
    return TestClient(app, raise_server_exceptions=False)


def evidence_payload() -> dict:
    return {
        "capabilityId": "evidence.search",
        "state": {
            "sessionId": "node-runtime-evidence",
            "goal": {"text": "Find evidence for table progression pacing"},
            "artifacts": [],
            "capabilityRuns": [],
        },
        "inputArtifactIds": ["goal-1"],
        "roleId": "grounding",
        "turnId": "node-runtime-evidence",
        "userText": "ground the table pacing roadmap",
    }


def fake_llm(messages, **kwargs):
    joined = "\n".join(message["content"] for message in messages)
    assert "table progression pacing" in joined
    return LlmResult(
        content=(
            "## Grounding references\n"
            "- table assignment evidence from playtests\n"
            "## Why they matter\n"
            "- validates pacing assumptions\n"
            "## Gaps\n"
            "- live retention benchmark still missing"
        ),
        usage={"total_tokens": 37},
        finish_reason="stop",
        model="fake-node-runtime-evidence",
        latency_ms=1,
    )


def post_evidence(client: TestClient):
    return client.post(
        "/api/sliderule/execute-capability",
        json=evidence_payload(),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )


def test_node_runtime_route_returns_retrieved_evidence_provenance(monkeypatch):
    def retrieved_runtime(query: str):
        assert "Find evidence for table progression pacing" in query
        assert "ground the table pacing roadmap" in query
        return EvidenceRetrievalResult(
            provenance="retrieved",
            sources=[
                EvidenceSource(
                    title="Playtest notes",
                    snippet="table assignment evidence",
                    provenance="retrieved",
                    source_id="doc-1",
                    score=0.93,
                )
            ],
        )

    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_llm)
    monkeypatch.setattr("routes.sliderule.execute_evidence_runtime", retrieved_runtime)

    response = post_evidence(make_client())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provenance"] == "python-llm"
    assert body["model"] == "fake-node-runtime-evidence"
    assert body["evidenceProvenance"] == "retrieved"
    assert body["sources"][0]["provenance"] == "retrieved"
    assert body["sources"][0]["sourceId"] == "doc-1"
    assert body["sources"][0]["score"] == 0.93
    assert "fallbackReason" not in body
    assert "error" not in body


def test_node_runtime_route_returns_explicit_fallback_provenance(monkeypatch):
    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_llm)
    monkeypatch.setattr(
        "routes.sliderule.execute_evidence_runtime",
        lambda query: fallback_evidence(query, reason="no_retrieval_hits"),
    )

    response = post_evidence(make_client())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provenance"] == "python-llm"
    assert body["evidenceProvenance"] == "fallback"
    assert body["fallbackReason"] == "no_retrieval_hits"
    assert body["sources"][0]["provenance"] == "fallback"
    assert body["sources"][0]["fallbackReason"] == "no_retrieval_hits"
    assert body["evidenceProvenance"] != "retrieved"


def test_node_runtime_route_returns_degraded_error_without_fake_sources(monkeypatch):
    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_llm)
    monkeypatch.setattr(
        "routes.sliderule.execute_evidence_runtime",
        lambda query: degraded_evidence(
            query,
            error="retrieval_runtime_failed",
            reason="embedding_timeout",
        ),
    )

    response = post_evidence(make_client())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provenance"] == "python-llm"
    assert body["evidenceProvenance"] == "degraded"
    assert body["error"] == "retrieval_runtime_failed"
    assert body["fallbackReason"].startswith("embedding_timeout; query=")
    assert body["sources"] == []
    assert body["evidenceProvenance"] != "retrieved"
