"""Contract tests for the Python Blueprint spec-docs proxy endpoint."""

from fastapi.testclient import TestClient
import pytest

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)


client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"


def _payload(doc_type="requirements"):
    return {
        "jobId": "job-1",
        "targetDocumentType": doc_type,
        "specTreeNode": {
            "id": "node-1",
            "title": "Authentication Module",
            "summary": "Handles login and session management",
            "type": "route_step",
            "priority": 1,
            "dependencies": [],
            "outputs": [],
        },
        "request": {
            "targetText": "Build a user authentication system",
            "githubUrls": [],
        },
        "locale": "en-US",
    }


def test_generate_one_returns_stable_contract_shape():
    response = client.post(
        "/api/blueprint/spec-documents/generate-one",
        json=_payload("requirements"),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["generationSource"] == "llm"
    assert data["title"] == "Requirements: Authentication Module"
    assert data["summary"]
    assert data["content"].startswith("# Requirements: Authentication Module")
    assert "## Context" in data["content"]
    assert data["status"] == "draft"
    assert data["promptId"] == "blueprint.spec-documents.v1"
    assert data["model"] == "python-blueprint-spec-docs-contract"
    assert data["promptFingerprint"].startswith("sha256:")
    assert data["responseDigest"].startswith("sha256:")


def test_generate_one_supports_all_document_types():
    for doc_type, expected in [
        ("requirements", "Requirements"),
        ("design", "Design"),
        ("tasks", "Tasks"),
    ]:
        response = client.post(
            "/api/blueprint/spec-documents/generate-one",
            json=_payload(doc_type),
            headers={"X-Internal-Key": INTERNAL_KEY},
        )
        assert response.status_code == 200
        assert response.json()["title"].startswith(f"{expected}:")


def test_generate_one_rejects_bad_document_type():
    response = client.post(
        "/api/blueprint/spec-documents/generate-one",
        json=_payload("memo"),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 400


def test_generate_one_requires_internal_key():
    response = client.post(
        "/api/blueprint/spec-documents/generate-one",
        json=_payload("requirements"),
        headers={"X-Internal-Key": "wrong"},
    )

    assert response.status_code == 403
