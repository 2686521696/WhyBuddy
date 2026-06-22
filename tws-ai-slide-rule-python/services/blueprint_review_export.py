"""Blueprint review/export runtime boundary.

This service is intentionally pure: it builds the review summary/export manifest
contract that Node can map, without writing archives or touching external
storage.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping


EXPORT_PERMISSION = "blueprint.export"


def build_blueprint_review_export_boundary(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Build a stable review/export boundary envelope."""

    trace = _as_dict(payload.get("trace"))
    try:
        _ensure_permission(payload.get("actor"))
        artifacts = _require_list(payload.get("artifacts"), "artifacts")
        review_items = _require_list(payload.get("reviewItems"), "reviewItems")
        export_request = _as_dict(payload.get("exportRequest"))
        now = _string_or_default(payload.get("now"), "")
        job_id = _string_or_default(payload.get("jobId"), "")

        warnings = _build_warnings(artifacts, review_items)
        summary = _build_summary(job_id, artifacts, review_items, warnings)
        manifest = _build_manifest(job_id, now, export_request, artifacts)
        degraded = len(warnings) > 0

        return {
            "status": "degraded" if degraded else "exported",
            "degraded": degraded,
            "trace": trace,
            "summary": summary,
            "manifest": manifest,
            "warnings": warnings,
        }
    except PermissionError as error:
        return {
            "status": "denied",
            "degraded": False,
            "trace": trace,
            "error": {
                "code": "permission_denied",
                "message": str(error),
            },
        }
    except ValueError as error:
        return {
            "status": "failed",
            "degraded": False,
            "trace": trace,
            "error": {
                "code": getattr(error, "code", "runtime_error"),
                "message": str(error),
            },
        }
    except Exception as error:  # pragma: no cover - defensive envelope hardening
        return {
            "status": "failed",
            "degraded": False,
            "trace": trace,
            "error": {
                "code": "runtime_error",
                "message": str(error),
            },
        }


def _ensure_permission(actor: Any) -> None:
    actor_dict = _as_dict(actor)
    roles = actor_dict.get("roles")
    if not isinstance(roles, list) or EXPORT_PERMISSION not in roles:
        raise PermissionError(
            "Blueprint review/export requires blueprint.export permission."
        )


def _require_list(value: Any, name: str) -> List[Any]:
    if isinstance(value, list):
        return value
    error = ValueError(f"{name} must be a list")
    error.code = f"invalid_{name}"  # type: ignore[attr-defined]
    raise error


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _string_or_default(value: Any, default: str) -> str:
    return value if isinstance(value, str) else default


def _build_summary(
    job_id: str,
    artifacts: List[Any],
    review_items: List[Any],
    warnings: List[Dict[str, Any]],
) -> Dict[str, Any]:
    counts = {"accepted": 0, "rejected": 0, "needsChanges": 0}
    for item in review_items:
        item_dict = _as_dict(item)
        status = item_dict.get("status")
        if status == "accepted":
            counts["accepted"] += 1
        elif status == "rejected":
            counts["rejected"] += 1
        elif status in {"needs_changes", "needsChanges"}:
            counts["needsChanges"] += 1

    return {
        "jobId": job_id,
        "totalArtifacts": len(artifacts),
        "reviewedItems": len(review_items),
        "accepted": counts["accepted"],
        "rejected": counts["rejected"],
        "needsChanges": counts["needsChanges"],
        "warnings": warnings,
    }


def _build_warnings(
    artifacts: List[Any],
    review_items: List[Any],
) -> List[Dict[str, Any]]:
    artifact_ids = {
        artifact.get("id")
        for artifact in artifacts
        if isinstance(artifact, dict) and isinstance(artifact.get("id"), str)
    }
    warnings: List[Dict[str, Any]] = []

    for item in review_items:
        item_dict = _as_dict(item)
        artifact_id = item_dict.get("artifactId")
        if isinstance(artifact_id, str) and artifact_id not in artifact_ids:
            item_id = _string_or_default(item_dict.get("id"), "unknown")
            warnings.append(
                {
                    "code": "review_item_artifact_missing",
                    "message": (
                        f"Review item {item_id} references missing artifact {artifact_id}."
                    ),
                    "artifactId": artifact_id,
                }
            )

    return warnings


def _build_manifest(
    job_id: str,
    exported_at: str,
    export_request: Dict[str, Any],
    artifacts: List[Any],
) -> Dict[str, Any]:
    return {
        "jobId": job_id,
        "exportedAt": exported_at,
        "granularity": _string_or_default(export_request.get("granularity"), "tree"),
        "artifactCount": len(artifacts),
        "documents": [_manifest_document(artifact) for artifact in artifacts],
    }


def _manifest_document(artifact: Any) -> Dict[str, Any]:
    artifact_dict = _as_dict(artifact)
    payload = _as_dict(artifact_dict.get("payload"))
    return {
        "artifactId": _string_or_default(artifact_dict.get("id"), ""),
        "documentId": _string_or_default(payload.get("id"), ""),
        "nodeId": _string_or_default(payload.get("nodeId"), ""),
        "type": _string_or_default(payload.get("type"), artifact_dict.get("type") or ""),
        "title": _string_or_default(payload.get("title"), artifact_dict.get("title") or ""),
        "status": _string_or_default(payload.get("status"), ""),
    }
