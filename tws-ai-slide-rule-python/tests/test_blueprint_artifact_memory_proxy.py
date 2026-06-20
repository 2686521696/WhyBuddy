"""Contract tests for the Blueprint artifact memory Python proxy."""

from fastapi.testclient import TestClient
import pytest

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)


client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"


def _ledger_entry(entry_id="entry-1"):
    return {
        "id": entry_id,
        "jobId": "job-1",
        "artifactId": "artifact-1",
        "artifactType": "requirements",
        "stage": "spec_docs",
        "title": "Requirements",
        "summary": "Requirement artifact",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "sourceIds": {
            "routeIds": ["route-1"],
            "specTreeNodeIds": ["node-1"],
            "specDocumentIds": ["doc-1"],
            "effectPreviewIds": [],
            "promptPackageIds": [],
            "capabilityIds": [],
            "roleIds": [],
            "crewIds": [],
        },
        "version": 1,
        "tags": ["requirements"],
        "payloadSummary": {"status": "draft"},
    }


def _event(event_id="event-1"):
    return {
        "id": event_id,
        "jobId": "job-1",
        "type": "evidence.recorded",
        "family": "evidence",
        "stage": "engineering_handoff",
        "status": "completed",
        "message": "evidence recorded",
        "occurredAt": "2026-06-20T00:01:00.000Z",
    }


def _replay():
    return {
        "id": "replay-1",
        "jobId": "job-1",
        "createdAt": "2026-06-20T00:02:00.000Z",
        "timelineEntries": [
            {
                "id": "timeline-1",
                "entryId": "entry-1",
                "artifactId": "artifact-1",
                "artifactType": "requirements",
                "stage": "spec_docs",
                "title": "Requirements",
                "summary": "Requirement artifact",
                "occurredAt": "2026-06-20T00:00:00.000Z",
                "tags": ["requirements"],
            }
        ],
        "stageCounts": {"spec_docs": 1},
        "lineageEdges": [],
    }


def _feedback():
    return {
        "id": "feedback-1",
        "jobId": "job-1",
        "entryId": "entry-1",
        "artifactId": "artifact-1",
        "artifactType": "requirements",
        "kind": "feedback",
        "message": "Looks good",
        "summary": "Feedback recorded",
        "createdAt": "2026-06-20T00:03:00.000Z",
        "tags": ["review"],
        "sourceIds": {
            "routeIds": [],
            "specTreeNodeIds": [],
            "specDocumentIds": ["doc-1"],
            "effectPreviewIds": [],
            "promptPackageIds": [],
            "capabilityIds": [],
            "roleIds": [],
            "crewIds": [],
        },
        "payloadSummary": {"review": "accepted"},
    }


def _payload(action="list", resource="ledger", **overrides):
    payload = {
        "jobId": "job-1",
        "action": action,
        "resource": resource,
        "ledger": [_ledger_entry()],
        "events": [_event()],
        "replays": [_replay()],
        "feedback": [_feedback()],
    }
    payload.update(overrides)
    return payload


def _post(payload):
    return client.post(
        "/api/blueprint/spec-documents/artifact-memory/contract",
        json=payload,
        headers={"X-Internal-Key": INTERNAL_KEY},
    )


def test_list_contract_returns_stable_read_shapes():
    response = _post(_payload(action="list", resource="all"))

    assert response.status_code == 200
    data = response.json()
    assert data["jobId"] == "job-1"
    assert data["action"] == "list"
    assert data["resource"] == "all"
    assert data["source"] == "node-artifact-store"
    assert data["ledger"][0]["id"] == "entry-1"
    assert data["events"][0]["id"] == "event-1"
    assert data["replays"][0]["id"] == "replay-1"
    assert data["feedback"][0]["id"] == "feedback-1"
    assert data["counts"] == {
        "ledger": 1,
        "events": 1,
        "replays": 1,
        "feedback": 1,
    }


def test_read_contract_can_select_a_single_resource_and_item():
    response = _post(_payload(action="read", resource="ledger", itemId="entry-1"))

    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "read"
    assert data["resource"] == "ledger"
    assert data["item"]["id"] == "entry-1"
    assert data["found"] is True
    assert data["ledger"][0]["id"] == "entry-1"


def test_write_contract_echoes_node_owned_payload_without_persisting():
    request = {"kind": "feedback", "message": "Please backfill rationale"}
    response = _post(
        _payload(action="write", resource="feedback", request=request, feedback=[])
    )

    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "write"
    assert data["resource"] == "feedback"
    assert data["request"] == request
    assert data["writeAccepted"] is True
    assert data["persistenceOwner"] == "node"
    assert data["feedback"] == []


def test_error_contract_rejects_invalid_resource():
    response = _post(_payload(resource="database"))

    assert response.status_code == 400
    data = response.json()
    assert data["detail"]["error"] == "invalid_resource"
    assert "ledger" in data["detail"]["allowedResources"]


def test_contract_requires_internal_key():
    response = client.post(
        "/api/blueprint/spec-documents/artifact-memory/contract",
        json=_payload(),
        headers={"X-Internal-Key": "wrong"},
    )

    assert response.status_code == 403
