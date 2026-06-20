"""Contract tests for web AIGC search adapter result shapes.

This slice deliberately uses a fake provider. It proves that Python can
describe web/graph/image/static-page search outcomes without making real
external search or webpage requests.
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.web_aigc_search_adapter import (  # noqa: E402
    SEARCH_ADAPTER_CONTRACT_VERSION,
    SearchAdapterErrorResponse,
    StaticWebpageReadSuccessResponse,
    execute_fake_search_adapter,
)


def test_web_search_success_preserves_query_and_provenance():
    response = execute_fake_search_adapter(
        {
            "kind": "web_search",
            "query": "slide rule migration",
            "scenario": "success",
            "permission": {"allowed": True, "auditId": "audit-web-1"},
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is True
    assert response["contractVersion"] == SEARCH_ADAPTER_CONTRACT_VERSION
    assert response["kind"] == "web_search"
    assert response["query"] == "slide rule migration"
    assert response["status"] == "success"
    assert response["provenance"] == {
        "provider": "fake",
        "source": "fake-web-search",
        "query": "slide rule migration",
        "auditId": "audit-web-1",
        "permission": {"allowed": True, "auditId": "audit-web-1"},
    }
    assert response["results"][0]["title"] == "Fake web result for slide rule migration"
    assert response["results"][0]["source"] == "fake-web-search"


def test_graph_search_success_has_nodes_edges_metrics_and_stable_provenance():
    response = execute_fake_search_adapter(
        {
            "kind": "graph_search",
            "query": "knowledge graph path",
            "scenario": "success",
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is True
    assert response["kind"] == "graph_search"
    assert response["query"] == "knowledge graph path"
    assert response["status"] == "success"
    assert response["graph"]["nodes"][0]["entityId"] == "fake-entity-1"
    assert response["graph"]["edges"][0]["relationType"] == "supports"
    assert response["metrics"] == {"nodeCount": 2, "edgeCount": 1, "pathLength": 2}
    assert response["provenance"]["query"] == "knowledge graph path"
    assert response["provenance"]["source"] == "fake-graph-search"


def test_image_search_success_preserves_query_results_and_provenance():
    response = execute_fake_search_adapter(
        {
            "kind": "image_search",
            "query": "dashboard preview",
            "scenario": "success",
            "permission": {"allowed": True, "policy": "internal-preview"},
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is True
    assert response["kind"] == "image_search"
    assert response["query"] == "dashboard preview"
    assert response["status"] == "success"
    assert response["results"][0]["imageId"] == "fake-image-1"
    assert response["results"][0]["availability"] == "preview_only"
    assert response["results"][0]["source"] == "fake-image-search"
    assert response["provenance"]["permission"] == {
        "allowed": True,
        "policy": "internal-preview",
    }


def test_static_page_success_uses_inline_fake_content_without_fetching_real_page():
    response = execute_fake_search_adapter(
        {
            "kind": "static_webpage_read",
            "query": "https://example.test/fake-page",
            "scenario": "success",
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is True
    assert response["kind"] == "static_webpage_read"
    assert response["query"] == "https://example.test/fake-page"
    assert response["status"] == "success"
    assert response["page"]["url"] == "https://example.test/fake-page"
    assert response["page"]["contentSource"] == "fake_static_page"
    assert "Fake static page content" in response["page"]["content"]
    assert response["provenance"]["source"] == "fake-static-webpage-read"


@pytest.mark.parametrize(
    "kind",
    ["web_search", "graph_search", "image_search", "static_webpage_read"],
)
def test_empty_result_is_explicit_and_not_success(kind: str):
    response = execute_fake_search_adapter(
        {"kind": kind, "query": "empty search", "scenario": "empty"}
    ).model_dump(exclude_none=True)

    assert response["ok"] is True
    assert response["kind"] == kind
    assert response["query"] == "empty search"
    assert response["status"] == "empty"
    assert response["status"] != "success"
    assert response["provenance"]["query"] == "empty search"


@pytest.mark.parametrize(
    "kind",
    ["web_search", "graph_search", "image_search", "static_webpage_read"],
)
def test_error_result_is_explicit_and_not_success(kind: str):
    response = execute_fake_search_adapter(
        {"kind": kind, "query": "error search", "scenario": "error"}
    ).model_dump(exclude_none=True)

    assert response["ok"] is False
    assert response["kind"] == kind
    assert response["query"] == "error search"
    assert response["status"] == "error"
    assert response["status"] != "success"
    assert response["error"]["code"] == "fake_provider_error"
    assert response["provenance"]["query"] == "error search"


@pytest.mark.parametrize(
    "kind",
    ["web_search", "graph_search", "image_search", "static_webpage_read"],
)
def test_permission_denied_result_preserves_permission_and_audit(kind: str):
    response = execute_fake_search_adapter(
        {
            "kind": kind,
            "query": "blocked search",
            "scenario": "success",
            "permission": {
                "allowed": False,
                "reason": "policy_denied",
                "auditId": "audit-denied-1",
            },
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is False
    assert response["kind"] == kind
    assert response["query"] == "blocked search"
    assert response["status"] == "permission_denied"
    assert response["status"] != "success"
    assert response["error"] == {
        "code": "permission_denied",
        "message": "Search adapter execution denied by permission policy.",
    }
    assert response["provenance"]["auditId"] == "audit-denied-1"
    assert response["provenance"]["permission"] == {
        "allowed": False,
        "reason": "policy_denied",
        "auditId": "audit-denied-1",
    }


def test_contract_rejects_static_page_success_without_page_payload():
    with pytest.raises(ValidationError):
        StaticWebpageReadSuccessResponse(
            kind="static_webpage_read",
            query="https://example.test/missing-page",
            status="success",
            provenance={
                "provider": "fake",
                "source": "fake-static-webpage-read",
                "query": "https://example.test/missing-page",
            },
        )


def test_error_contract_rejects_success_status():
    with pytest.raises(ValidationError):
        SearchAdapterErrorResponse(
            kind="web_search",
            query="bad status",
            status="success",
            error={"code": "fake_provider_error", "message": "Fake provider failed."},
            provenance={
                "provider": "fake",
                "source": "fake-web-search",
                "query": "bad status",
            },
        )
