"""Runtime boundary tests for Blueprint review/export service."""

from services.blueprint_review_export import (
    build_blueprint_review_export_boundary,
)


FIXED_NOW = "2026-06-20T00:00:00.000Z"


def _artifact(
    artifact_id="artifact-doc-1",
    artifact_type="requirements",
    title="Requirements Authentication Module",
    status="draft",
):
    return {
        "id": artifact_id,
        "type": artifact_type,
        "title": title,
        "summary": "Spec document summary",
        "createdAt": "2026-06-19T00:00:00.000Z",
        "payload": {
            "id": "doc-1",
            "jobId": "job-1",
            "nodeId": "node-1",
            "type": artifact_type,
            "status": status,
            "title": title,
            "summary": "Spec document summary",
            "content": "# Requirements Authentication Module\n\nContract body\n",
            "format": "markdown",
            "createdAt": "2026-06-19T00:00:00.000Z",
        },
    }


def _request(**overrides):
    request = {
        "jobId": "job-1",
        "actor": {"id": "reviewer-1", "roles": ["blueprint.export"]},
        "trace": {"traceId": "trace-1", "spanId": "span-1"},
        "artifacts": [_artifact()],
        "reviewItems": [
            {
                "id": "review-1",
                "artifactId": "artifact-doc-1",
                "status": "accepted",
                "severity": "info",
                "message": "Ready",
            }
        ],
        "exportRequest": {"granularity": "single", "nodeId": "node-1", "type": "requirements"},
        "now": FIXED_NOW,
    }
    request.update(overrides)
    return request


def test_review_summary_and_export_manifest_are_stable():
    result = build_blueprint_review_export_boundary(_request())

    assert result["status"] == "exported"
    assert result["degraded"] is False
    assert result["trace"] == {"traceId": "trace-1", "spanId": "span-1"}
    assert result["summary"] == {
        "jobId": "job-1",
        "totalArtifacts": 1,
        "reviewedItems": 1,
        "accepted": 1,
        "rejected": 0,
        "needsChanges": 0,
        "warnings": [],
    }
    assert result["manifest"] == {
        "jobId": "job-1",
        "exportedAt": FIXED_NOW,
        "granularity": "single",
        "artifactCount": 1,
        "documents": [
            {
                "artifactId": "artifact-doc-1",
                "documentId": "doc-1",
                "nodeId": "node-1",
                "type": "requirements",
                "title": "Requirements Authentication Module",
                "status": "draft",
            }
        ],
    }
    assert "error" not in result


def test_warnings_mark_boundary_degraded_without_export_success_masking():
    result = build_blueprint_review_export_boundary(
        _request(
            reviewItems=[
                {
                    "id": "review-1",
                    "artifactId": "missing-artifact",
                    "status": "needs_changes",
                    "severity": "warning",
                    "message": "No artifact for review",
                }
            ],
        )
    )

    assert result["status"] == "degraded"
    assert result["degraded"] is True
    assert result["warnings"] == [
        {
            "code": "review_item_artifact_missing",
            "message": "Review item review-1 references missing artifact missing-artifact.",
            "artifactId": "missing-artifact",
        }
    ]
    assert result["summary"]["warnings"] == result["warnings"]
    assert result["manifest"]["artifactCount"] == 1


def test_permission_denied_preserves_trace_and_has_no_manifest():
    result = build_blueprint_review_export_boundary(
        _request(actor={"id": "viewer-1", "roles": ["blueprint.read"]})
    )

    assert result == {
        "status": "denied",
        "degraded": False,
        "trace": {"traceId": "trace-1", "spanId": "span-1"},
        "error": {
            "code": "permission_denied",
            "message": "Blueprint review/export requires blueprint.export permission.",
        },
    }


def test_runtime_error_uses_failed_envelope_without_exported_manifest():
    result = build_blueprint_review_export_boundary(
        _request(artifacts="not-a-list")
    )

    assert result["status"] == "failed"
    assert result["degraded"] is False
    assert result["trace"] == {"traceId": "trace-1", "spanId": "span-1"}
    assert result["error"] == {
        "code": "invalid_artifacts",
        "message": "artifacts must be a list",
    }
    assert "manifest" not in result
    assert "summary" not in result
