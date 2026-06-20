"""Contract tests for the Python Blueprint spec-docs batch proxy endpoint."""

from fastapi.testclient import TestClient
import pytest

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)


client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"


def _item(doc_type="requirements", node_id="node-1", title="Authentication Module"):
    return {
        "jobId": "job-1",
        "targetDocumentType": doc_type,
        "specTreeNode": {
            "id": node_id,
            "title": title,
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


def test_generate_batch_returns_stable_success_shape():
    response = client.post(
        "/api/blueprint/spec-documents/generate-batch",
        json={
            "jobId": "job-1",
            "items": [
                _item("requirements", "node-1", "Authentication Module"),
                _item("design", "node-2", "Session Store"),
            ],
        },
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["jobId"] == "job-1"
    assert data["overallSource"] == "llm"
    assert len(data["results"]) == 2
    assert data["results"][0]["ok"] is True
    assert data["results"][0]["nodeId"] == "node-1"
    assert data["results"][0]["targetDocumentType"] == "requirements"
    assert data["results"][0]["document"]["title"] == "Requirements: Authentication Module"
    assert data["results"][0]["document"]["content"].startswith("# Requirements: Authentication Module")
    assert data["results"][0]["document"]["model"] == "python-blueprint-spec-docs-contract"
    assert data["results"][0]["document"]["promptFingerprint"].startswith("sha256:")
    assert data["results"][0]["document"]["responseDigest"].startswith("sha256:")
    assert data["results"][1]["ok"] is True
    assert data["results"][1]["document"]["title"] == "Design: Session Store"


def test_generate_batch_reports_partial_failure_per_item():
    response = client.post(
        "/api/blueprint/spec-documents/generate-batch",
        json={
            "jobId": "job-1",
            "items": [
                _item("requirements", "node-1", "Authentication Module"),
                _item("memo", "node-2", "Bad Document"),
            ],
        },
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["overallSource"] == "partial"
    assert data["results"][0]["ok"] is True
    assert data["results"][1] == {
        "ok": False,
        "nodeId": "node-2",
        "targetDocumentType": "memo",
        "error": "targetDocumentType must be requirements, design, or tasks",
    }


def test_generate_batch_rejects_invalid_top_level_payload():
    response = client.post(
        "/api/blueprint/spec-documents/generate-batch",
        json={"jobId": "job-1", "items": []},
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 400
    assert "items must be a non-empty array" in response.text


def test_generate_batch_requires_internal_key():
    response = client.post(
        "/api/blueprint/spec-documents/generate-batch",
        json={"jobId": "job-1", "items": [_item()]},
        headers={"X-Internal-Key": "wrong"},
    )

    assert response.status_code == 403
