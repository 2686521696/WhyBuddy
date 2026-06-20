"""Blueprint stage-edit validate/preview contract helpers.

This slice is intentionally stateless. Node owns Blueprint stage persistence,
job storage, and apply semantics. Python mirrors the minimum validation and
preview envelope for the stage-edit proxy boundary.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


BLUEPRINT_STAGE_EDIT_PROXY_CONTRACT_VERSION = "blueprint.stage-edit.proxy.v1"

GRAPH: dict[str, list[str]] = {
    "input": ["clarification"],
    "clarification": ["route_generation"],
    "route_generation": ["spec_tree"],
    "spec_tree": ["spec_docs"],
    "spec_docs": ["preview", "effect_preview"],
    "preview": ["effect_preview"],
    "effect_preview": ["prompt_packaging"],
    "prompt_packaging": ["runtime_capability"],
    "runtime_capability": ["engineering_handoff"],
    "engineering_handoff": ["engineering_landing"],
    "engineering_landing": [],
}

ARTIFACT_STAGE_BY_TYPE = {
    "intake": "input",
    "github_source": "input",
    "clarification_session": "clarification",
    "project_context": "clarification",
    "route_set": "route_generation",
    "route_selection": "route_generation",
    "spec_tree": "spec_tree",
    "spec_tree_version": "spec_tree",
    "requirements": "spec_docs",
    "design": "spec_docs",
    "tasks": "spec_docs",
    "spec_document_version": "spec_docs",
    "preview": "preview",
    "effect_preview": "effect_preview",
    "prompt_pack": "prompt_packaging",
    "capability_registry": "runtime_capability",
    "agent_crew": "runtime_capability",
    "role_timeline": "runtime_capability",
    "capability_invocation": "runtime_capability",
    "capability_evidence": "runtime_capability",
    "sandbox_derivation_job": "runtime_capability",
    "engineering_plan": "engineering_handoff",
    "engineering_run": "engineering_landing",
}

TERMINAL_HANDOFF_STATES = {"confirmed", "reset", "failed", "idle"}


def validate_intake_patch(body: Any) -> dict[str, Any]:
    if not _is_record(body):
        return _invalid("Request body must be an object.")

    value: dict[str, Any] = {}
    if "targetText" in body:
        if not isinstance(body["targetText"], str):
            return _invalid("targetText must be a string when provided.")
        value["targetText"] = body["targetText"]

    if "githubUrls" in body:
        github_urls = body["githubUrls"]
        if not isinstance(github_urls, list) or not all(isinstance(url, str) for url in github_urls):
            return _invalid("githubUrls must be an array of strings when provided.")
        value["githubUrls"] = list(github_urls)

    if "reason" in body:
        if not isinstance(body["reason"], str):
            return _invalid("reason must be a string when provided.")
        if len(body["reason"]) > 1024:
            return _invalid("reason must be 1024 characters or fewer.")
        value["reason"] = body["reason"]

    return {"ok": True, "value": value}


def preview_intake_patch(payload: dict[str, Any]) -> dict[str, Any]:
    intake = _copy_record(payload.get("intake"))
    jobs = _copy_records(payload.get("jobs"))
    parsed = validate_intake_patch(payload.get("patch"))

    if not parsed["ok"]:
        return {
            **_base_result(),
            "ok": False,
            "outcome": "rejected",
            "status": 400,
            "error": parsed["error"],
            "message": parsed["message"],
            "intake": intake,
            "jobs": jobs,
        }

    patch = parsed["value"]
    if _is_noop(intake, patch):
        return {
            **_base_result(),
            "ok": True,
            "outcome": "noop",
            "status": 200,
            "intake": intake,
            "jobs": jobs,
        }

    for job in jobs:
        running_stage = _detect_running_downstream(job, "input")
        if running_stage is not None:
            return {
                **_base_result(),
                "ok": False,
                "outcome": "conflict",
                "status": 409,
                "error": "downstream_running",
                "runningStage": running_stage,
                "intake": intake,
                "jobs": jobs,
            }

    now = _clean_string(payload.get("now"), _clean_string(intake.get("updatedAt"), "1970-01-01T00:00:00.000Z"))
    updated_intake = {
        **intake,
        "targetText": patch["targetText"] if "targetText" in patch else intake.get("targetText"),
        "githubUrls": patch["githubUrls"] if "githubUrls" in patch else intake.get("githubUrls"),
        "updatedAt": now,
    }

    preview_jobs: list[dict[str, Any]] = []
    newly_stale_ids: list[str] = []
    stale_snapshot: list[str] = []
    for job in jobs:
        job_with_intake = _replace_intake_artifact(job, updated_intake)
        trigger = _find_triggering_intake_artifact(job_with_intake)
        invalidated = _invalidate_downstream(
            job_with_intake,
            "input",
            {
                "reason": "upstream_target_changed",
                "triggeringArtifactId": trigger["id"],
                "triggeringArtifactType": trigger["type"],
                "triggeredAt": now,
            },
        )
        preview_jobs.append(invalidated)
        for artifact_id in _newly_stale_ids(job_with_intake, invalidated):
            if artifact_id not in newly_stale_ids:
                newly_stale_ids.append(artifact_id)
        for artifact_id in invalidated.get("staleArtifactIds") or []:
            if isinstance(artifact_id, str) and artifact_id not in stale_snapshot:
                stale_snapshot.append(artifact_id)

    result: dict[str, Any] = {
        **_base_result(),
        "ok": True,
        "outcome": "accepted",
        "status": 200,
        "intake": updated_intake,
        "jobs": preview_jobs,
    }
    if newly_stale_ids:
        result["staleEdit"] = {
            "fromStage": "input",
            "newlyStaleArtifactIds": newly_stale_ids,
            "newlyStaleArtifactCount": len(newly_stale_ids),
            "staleArtifactIdsSnapshot": stale_snapshot,
        }
    return result


def _base_result() -> dict[str, Any]:
    return {
        "contractVersion": BLUEPRINT_STAGE_EDIT_PROXY_CONTRACT_VERSION,
        "kind": "blueprint.stage_edit.preview",
        "preview": {
            "stateAuthority": "node",
            "persistenceOwner": "node",
            "stateMutation": "none",
            "appliesMutation": False,
        },
    }


def _invalid(message: str) -> dict[str, Any]:
    return {"ok": False, "error": "invalid_intake_patch", "message": message}


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _copy_record(value: Any) -> dict[str, Any]:
    return deepcopy(value) if isinstance(value, dict) else {}


def _copy_records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [deepcopy(item) for item in value if isinstance(item, dict)]


def _clean_string(value: Any, fallback: str) -> str:
    return value if isinstance(value, str) and value else fallback


def _is_noop(intake: dict[str, Any], patch: dict[str, Any]) -> bool:
    if "targetText" in patch and patch["targetText"] != intake.get("targetText"):
        return False
    if "githubUrls" in patch and patch["githubUrls"] != intake.get("githubUrls"):
        return False
    return True


def _downstream_stages(from_stage: str) -> list[str]:
    if from_stage not in GRAPH:
        return []
    result: list[str] = []
    visited = {from_stage}
    queue = list(GRAPH[from_stage])
    while queue:
        stage = queue.pop(0)
        if stage in visited:
            continue
        visited.add(stage)
        result.append(stage)
        queue.extend(GRAPH.get(stage, []))
    return result


def _detect_running_downstream(job: dict[str, Any], from_stage: str) -> str | None:
    downstream = set(_downstream_stages(from_stage))
    stage = job.get("stage")
    if stage in downstream and job.get("status") == "running":
        return stage

    handoff_state = job.get("handoffState")
    if stage in downstream and isinstance(handoff_state, str) and handoff_state not in TERMINAL_HANDOFF_STATES:
        return stage

    next_action = job.get("nextAction")
    if isinstance(next_action, dict):
        next_stage = next_action.get("stage")
        next_type = next_action.get("type")
        if (
            next_stage in downstream
            and isinstance(next_type, str)
            and next_type != "none"
            and not next_type.startswith("review_")
        ):
            return next_stage

    return None


def _replace_intake_artifact(job: dict[str, Any], intake: dict[str, Any]) -> dict[str, Any]:
    artifacts = job.get("artifacts")
    if not isinstance(artifacts, list):
        return deepcopy(job)

    replaced = False
    next_artifacts: list[Any] = []
    for artifact in artifacts:
        if isinstance(artifact, dict) and artifact.get("type") == "intake":
            replaced = True
            next_artifacts.append(
                {
                    **artifact,
                    "summary": "Normalized target input and GitHub sources captured before route generation.",
                    "payload": deepcopy(intake),
                }
            )
        else:
            next_artifacts.append(deepcopy(artifact))

    if not replaced:
        return deepcopy(job)

    request = job.get("request") if isinstance(job.get("request"), dict) else {}
    return {
        **deepcopy(job),
        "request": {
            **deepcopy(request),
            "targetText": intake.get("targetText"),
            "githubUrls": intake.get("githubUrls"),
        },
        "updatedAt": intake.get("updatedAt"),
        "artifacts": next_artifacts,
    }


def _find_triggering_intake_artifact(job: dict[str, Any]) -> dict[str, str]:
    artifacts = job.get("artifacts")
    if isinstance(artifacts, list):
        for artifact in artifacts:
            if isinstance(artifact, dict) and artifact.get("type") == "intake" and isinstance(artifact.get("id"), str):
                return {"id": artifact["id"], "type": "intake"}

    request = job.get("request") if isinstance(job.get("request"), dict) else {}
    fallback = request.get("intakeId") if isinstance(request.get("intakeId"), str) else job.get("id")
    return {"id": _clean_string(fallback, ""), "type": "intake"}


def _invalidate_downstream(
    job: dict[str, Any],
    from_stage: str,
    options: dict[str, Any],
) -> dict[str, Any]:
    downstream = set(_downstream_stages(from_stage))
    artifacts = job.get("artifacts")
    if not downstream or not isinstance(artifacts, list):
        return deepcopy(job)

    any_changed = False
    next_artifacts: list[Any] = []
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            next_artifacts.append(deepcopy(artifact))
            continue
        stage = ARTIFACT_STAGE_BY_TYPE.get(artifact.get("type"))
        if stage not in downstream or artifact.get("staleSince") is not None:
            next_artifacts.append(deepcopy(artifact))
            continue
        any_changed = True
        next_artifacts.append(
            {
                **deepcopy(artifact),
                "staleSince": options["triggeredAt"],
                "invalidatedBy": {
                    "stage": from_stage,
                    "artifactId": options["triggeringArtifactId"],
                    "artifactType": options["triggeringArtifactType"],
                    "reason": options["reason"],
                    "triggeredAt": options["triggeredAt"],
                },
            }
        )

    if not any_changed:
        return deepcopy(job)

    return {
        **deepcopy(job),
        "artifacts": next_artifacts,
        "staleArtifactIds": [
            artifact["id"]
            for artifact in next_artifacts
            if isinstance(artifact, dict)
            and isinstance(artifact.get("id"), str)
            and artifact.get("staleSince") is not None
        ],
    }


def _newly_stale_ids(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    before_ids = set(before.get("staleArtifactIds") or [])
    after_ids = after.get("staleArtifactIds") or []
    return [artifact_id for artifact_id in after_ids if artifact_id not in before_ids]
