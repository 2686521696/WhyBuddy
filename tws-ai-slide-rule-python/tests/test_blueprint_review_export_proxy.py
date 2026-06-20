"""Contract tests for Blueprint review/export Python proxy endpoints."""

from fastapi.testclient import TestClient
import pytest

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)


client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"
FIXED_NOW = "2026-06-20T00:00:00.000Z"


def _spec_tree():
    return {
        "id": "tree-1",
        "jobId": "job-1",
        "rootNodeId": "node-1",
        "version": 1,
        "nodes": [
            {
                "id": "node-1",
                "title": "Authentication Module",
                "summary": "Handles login and session management",
                "type": "route_step",
                "status": "draft",
                "priority": 1,
                "dependencies": [],
                "outputs": [],
                "children": [],
            }
        ],
        "provenance": {"jobId": "job-1", "githubUrls": []},
    }


def _document(doc_type="requirements", doc_id="doc-1"):
    return {
        "id": doc_id,
        "jobId": "job-1",
        "treeId": "tree-1",
        "nodeId": "node-1",
        "type": doc_type,
        "status": "draft",
        "version": 1,
        "sourceDocumentId": doc_id,
        "title": f"{doc_type.title()} Authentication Module",
        "summary": "Spec document summary",
        "content": f"# {doc_type.title()} Authentication Module\n\nContract body\n",
        "format": "markdown",
        "createdAt": "2026-06-19T00:00:00.000Z",
        "provenance": {
            "jobId": "job-1",
            "githubUrls": [],
            "treeVersion": 1,
            "nodeType": "route_step",
            "nodeTitle": "Authentication Module",
            "nodeSummary": "Handles login and session management",
            "dependencies": [],
            "outputs": [],
            "generationSource": "template",
        },
    }


def _job(documents=None):
    documents = documents if documents is not None else [_document()]
    return {
        "id": "job-1",
        "request": {
            "projectId": "project-1",
            "sourceId": "source-1",
            "targetText": "Build authentication",
            "githubUrls": [],
        },
        "status": "reviewing",
        "stage": "spec_docs",
        "version": "v1",
        "createdAt": "2026-06-19T00:00:00.000Z",
        "updatedAt": "2026-06-19T00:00:00.000Z",
        "artifacts": [
            {
                "id": "artifact-tree",
                "type": "spec_tree",
                "title": "SPEC tree",
                "summary": "Tree",
                "createdAt": "2026-06-19T00:00:00.000Z",
                "payload": _spec_tree(),
            },
            *[
                {
                    "id": f"artifact-{document['id']}",
                    "type": document["type"],
                    "title": document["title"],
                    "summary": document["summary"],
                    "createdAt": document["createdAt"],
                    "payload": document,
                }
                for document in documents
            ],
        ],
        "events": [],
    }


def _headers():
    return {"X-Internal-Key": INTERNAL_KEY}


def test_review_document_success_returns_stable_shape():
    response = client.post(
        "/api/blueprint/spec-documents/review",
        json={
            "job": _job(),
            "specTree": _spec_tree(),
            "documentId": "doc-1",
            "request": {
                "status": "accepted",
                "reviewedBy": "reviewer-1",
                "reviewNote": "Ready",
            },
            "now": FIXED_NOW,
        },
        headers=_headers(),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["document"]["status"] == "accepted"
    assert data["document"]["reviewedAt"] == FIXED_NOW
    assert data["document"]["acceptedAt"] == FIXED_NOW
    assert "rejectedAt" not in data["document"]
    assert data["document"]["reviewedBy"] == "reviewer-1"
    assert data["document"]["reviewNote"] == "Ready"
    assert data["job"]["status"] == "reviewing"
    assert data["job"]["stage"] == "spec_docs"
    assert data["job"]["events"][0]["payload"]["status"] == "accepted"
    assert data["specTree"]["id"] == "tree-1"


def test_export_document_success_and_empty_shapes_are_stable():
    ok_response = client.post(
        "/api/blueprint/spec-documents/export",
        json={
            "job": _job(),
            "documents": [_document()],
            "request": {
                "jobId": "job-1",
                "granularity": "single",
                "nodeId": "node-1",
                "type": "requirements",
            },
            "now": FIXED_NOW,
        },
        headers=_headers(),
    )

    assert ok_response.status_code == 200
    ok_data = ok_response.json()
    assert ok_data["kind"] == "ok"
    assert ok_data["archive"]["contentType"] == "text/markdown; charset=utf-8"
    assert ok_data["archive"]["filename"] == "Authentication-Module-requirements.md"
    assert ok_data["archive"]["encoding"] == "utf8"
    assert ok_data["archive"]["body"].startswith("# Requirements Authentication Module")

    empty_response = client.post(
        "/api/blueprint/spec-documents/export",
        json={
            "job": _job(documents=[]),
            "documents": [],
            "request": {"jobId": "job-1", "granularity": "tree"},
            "now": FIXED_NOW,
        },
        headers=_headers(),
    )

    assert empty_response.status_code == 200
    empty_data = empty_response.json()
    assert empty_data == {
        "kind": "not_found",
        "message": "no spec documents to export",
        "details": {"jobId": "job-1"},
    }


def test_review_export_permission_and_error_shapes_do_not_masquerade_as_success():
    forbidden = client.post(
        "/api/blueprint/spec-documents/export",
        json={
            "job": _job(),
            "documents": [_document()],
            "request": {"jobId": "job-1", "granularity": "tree"},
        },
        headers={"X-Internal-Key": "wrong"},
    )
    assert forbidden.status_code == 403
    assert "archive" not in forbidden.text

    bad_review = client.post(
        "/api/blueprint/spec-documents/review",
        json={
            "job": _job(),
            "specTree": _spec_tree(),
            "documentId": "missing-doc",
            "request": {"status": "accepted"},
            "now": FIXED_NOW,
        },
        headers=_headers(),
    )
    assert bad_review.status_code == 200
    bad_data = bad_review.json()
    assert bad_data["ok"] is False
    assert bad_data["status"] == 404
    assert bad_data["error"] == "Blueprint SPEC document not found."

    bad_export = client.post(
        "/api/blueprint/spec-documents/export",
        json={
            "job": _job(),
            "documents": [_document()],
            "request": {"jobId": "job-1", "granularity": "single"},
        },
        headers=_headers(),
    )
    assert bad_export.status_code == 200
    bad_export_data = bad_export.json()
    assert bad_export_data == {
        "kind": "invalid_request",
        "message": "single export requires nodeId and type",
    }
