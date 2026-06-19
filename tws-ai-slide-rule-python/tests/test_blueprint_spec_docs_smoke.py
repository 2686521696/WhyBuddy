"""Smoke tests for the Blueprint spec-docs Python proxy surface.

These stay network-free by using FastAPI TestClient, but they exercise the
mounted app route instead of only importing the route module.
"""

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
        "jobId": "job-smoke",
        "targetDocumentType": doc_type,
        "specTreeNode": {
            "id": "node-smoke",
            "title": "Checkout Flow",
            "summary": "Captures checkout requirements and handoff boundaries",
            "type": "route_step",
            "priority": 1,
            "dependencies": [],
            "outputs": [],
        },
        "request": {
            "targetText": "Build a checkout flow with confirmation and error states",
            "githubUrls": [],
        },
    }


def test_python_health_path_identifies_backend():
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["backend"] == "tws-ai-slide-rule-python"


def test_generate_one_smoke_returns_response_shape_from_mounted_app():
    response = client.post(
        "/api/blueprint/spec-documents/generate-one",
        json=_payload("design"),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["generationSource"] == "llm"
    assert data["status"] == "draft"
    assert data["title"] == "Design: Checkout Flow"
    assert data["summary"] == "Design document for Checkout Flow."
    assert data["content"].startswith("# Design: Checkout Flow")
    assert "## Context" in data["content"]
    assert data["promptId"] == "blueprint.spec-documents.v1"
    assert data["model"] == "python-blueprint-spec-docs-contract"
    assert data["promptFingerprint"].startswith("sha256:")
    assert data["responseDigest"].startswith("sha256:")


def test_generate_one_smoke_reports_contract_errors():
    response = client.post(
        "/api/blueprint/spec-documents/generate-one",
        json=_payload("memo"),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 400
    assert "targetDocumentType" in response.text


def test_generate_one_smoke_reports_auth_errors():
    response = client.post(
        "/api/blueprint/spec-documents/generate-one",
        json=_payload("requirements"),
        headers={"X-Internal-Key": "wrong"},
    )

    assert response.status_code == 403
    assert "Invalid key" in response.text
