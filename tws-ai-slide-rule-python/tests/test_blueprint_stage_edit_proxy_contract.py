"""Contract tests for the Blueprint stage-edit Python preview boundary."""

from copy import deepcopy

from services.blueprint_stage_edit import (
    BLUEPRINT_STAGE_EDIT_PROXY_CONTRACT_VERSION,
    preview_intake_patch,
    validate_intake_patch,
)


FIXED_NOW = "2026-06-20T00:00:00.000Z"


def _intake():
    return {
        "id": "intake-1",
        "targetText": "Original target",
        "githubUrls": ["https://github.com/example/original"],
        "createdAt": "2026-06-19T00:00:00.000Z",
        "updatedAt": "2026-06-19T00:00:00.000Z",
    }


def _artifact(artifact_id, artifact_type, **overrides):
    artifact = {
        "id": artifact_id,
        "type": artifact_type,
        "title": artifact_id,
        "summary": artifact_id,
        "createdAt": "2026-06-19T00:00:00.000Z",
    }
    artifact.update(overrides)
    return artifact


def _job(**overrides):
    job = {
        "id": "job-1",
        "request": {
            "intakeId": "intake-1",
            "targetText": "Original target",
            "githubUrls": ["https://github.com/example/original"],
        },
        "status": "completed",
        "stage": "engineering_landing",
        "version": "v1",
        "createdAt": "2026-06-19T00:00:00.000Z",
        "updatedAt": "2026-06-19T00:00:00.000Z",
        "artifacts": [
            _artifact("artifact-input", "intake", payload=_intake()),
            _artifact("artifact-route", "route_set"),
            _artifact(
                "artifact-spec",
                "requirements",
                staleSince="2026-06-19T01:00:00.000Z",
                invalidatedBy={
                    "stage": "route_generation",
                    "artifactId": "artifact-route",
                    "artifactType": "route_set",
                    "reason": "upstream_route_changed",
                    "triggeredAt": "2026-06-19T01:00:00.000Z",
                },
            ),
        ],
        "events": [],
        "staleArtifactIds": ["artifact-spec"],
    }
    job.update(overrides)
    return job


def test_validate_intake_patch_accepts_node_patch_shape_and_rejects_bad_fields():
    assert validate_intake_patch(
        {
            "targetText": "Updated target",
            "githubUrls": ["https://github.com/example/updated"],
            "reason": "correct upstream target",
        }
    ) == {
        "ok": True,
        "value": {
            "targetText": "Updated target",
            "githubUrls": ["https://github.com/example/updated"],
            "reason": "correct upstream target",
        },
    }

    assert validate_intake_patch({"githubUrls": "not-an-array"}) == {
        "ok": False,
        "error": "invalid_intake_patch",
        "message": "githubUrls must be an array of strings when provided.",
    }


def test_preview_accepted_patch_marks_downstream_stale_without_mutating_inputs():
    intake = _intake()
    job = _job()
    original_intake = deepcopy(intake)
    original_job = deepcopy(job)

    result = preview_intake_patch(
        {
            "intake": intake,
            "patch": {"targetText": "Updated target"},
            "jobs": [job],
            "now": FIXED_NOW,
        }
    )

    assert intake == original_intake
    assert job == original_job
    assert result["contractVersion"] == BLUEPRINT_STAGE_EDIT_PROXY_CONTRACT_VERSION
    assert result["kind"] == "blueprint.stage_edit.preview"
    assert result["ok"] is True
    assert result["outcome"] == "accepted"
    assert result["status"] == 200
    assert result["preview"] == {
        "stateAuthority": "node",
        "persistenceOwner": "node",
        "stateMutation": "none",
        "appliesMutation": False,
    }
    assert result["intake"]["targetText"] == "Updated target"
    assert result["intake"]["updatedAt"] == FIXED_NOW
    assert result["staleEdit"] == {
        "fromStage": "input",
        "newlyStaleArtifactIds": ["artifact-route"],
        "newlyStaleArtifactCount": 1,
        "staleArtifactIdsSnapshot": ["artifact-route", "artifact-spec"],
    }

    preview_job = result["jobs"][0]
    assert preview_job["request"]["targetText"] == "Updated target"
    route_artifact = preview_job["artifacts"][1]
    assert route_artifact["staleSince"] == FIXED_NOW
    assert route_artifact["invalidatedBy"] == {
        "stage": "input",
        "artifactId": "artifact-input",
        "artifactType": "intake",
        "reason": "upstream_target_changed",
        "triggeredAt": FIXED_NOW,
    }
    spec_artifact = preview_job["artifacts"][2]
    assert spec_artifact["staleSince"] == "2026-06-19T01:00:00.000Z"
    assert spec_artifact["invalidatedBy"]["reason"] == "upstream_route_changed"


def test_preview_rejected_patch_uses_node_error_shape():
    result = preview_intake_patch(
        {
            "intake": _intake(),
            "patch": {"targetText": 42},
            "jobs": [_job()],
            "now": FIXED_NOW,
        }
    )

    assert result["ok"] is False
    assert result["outcome"] == "rejected"
    assert result["status"] == 400
    assert result["error"] == "invalid_intake_patch"
    assert result["message"] == "targetText must be a string when provided."


def test_preview_conflict_reports_running_downstream_without_applying_patch():
    result = preview_intake_patch(
        {
            "intake": _intake(),
            "patch": {"targetText": "Updated target"},
            "jobs": [_job(stage="spec_tree", status="running")],
            "now": FIXED_NOW,
        }
    )

    assert result["ok"] is False
    assert result["outcome"] == "conflict"
    assert result["status"] == 409
    assert result["error"] == "downstream_running"
    assert result["runningStage"] == "spec_tree"
    assert result["intake"]["targetText"] == "Original target"
    assert result["jobs"][0]["request"]["targetText"] == "Original target"
    assert "staleEdit" not in result


def test_preview_noop_does_not_conflict_or_emit_stale_edit():
    result = preview_intake_patch(
        {
            "intake": _intake(),
            "patch": {
                "targetText": "Original target",
                "githubUrls": ["https://github.com/example/original"],
            },
            "jobs": [_job(stage="spec_tree", status="running")],
            "now": FIXED_NOW,
        }
    )

    assert result["ok"] is True
    assert result["outcome"] == "noop"
    assert result["status"] == 200
    assert result["intake"]["updatedAt"] == "2026-06-19T00:00:00.000Z"
    assert "staleEdit" not in result
