"""Bounded Python runtime bridge for Blueprint main state.

The bridge accepts a Node-owned job snapshot, projects the small main-state
contract, and returns an auditable envelope. It intentionally does not own the
Blueprint job store, event bus, ledger, preview, or prompt package runtime.
"""

from __future__ import annotations

from typing import Any, Mapping

from models.blueprint_state import (
    BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION,
    BlueprintMainStateReadEnvelope,
    BlueprintMainStateRuntimeBoundary,
    BlueprintMainStateRuntimeError,
    BlueprintMainStateRuntimeSuccess,
    BlueprintMainStateUpdateEnvelope,
)
from services.blueprint_state import project_blueprint_main_state


BLUEPRINT_MAIN_STATE_RUNTIME_PROVENANCE = "python-blueprint-state-runtime"
BLUEPRINT_MAIN_STATE_RUNTIME_OPERATIONS = {"read", "project", "update"}
NODE_OWNED_BOUNDARIES = {
    "jobStoreOwner": "node",
    "eventBusOwner": "node",
    "ledgerOwner": "node",
    "previewOwner": "node",
    "promptPackageOwner": "node",
}
UPDATE_NODE_OWNER_MESSAGE = (
    "Blueprint main state updates are audited by Python but applied by Node."
)


def execute_blueprint_state_runtime(payload: dict[str, Any]) -> dict[str, Any]:
    """Execute the bounded Blueprint main-state runtime bridge."""

    if not isinstance(payload, dict):
        return _status_error(
            "",
            "validation_error",
            "payload_not_object",
            "Blueprint main state runtime payload must be an object.",
            400,
        )

    operation = _clean_string(payload.get("operation"))
    if operation not in BLUEPRINT_MAIN_STATE_RUNTIME_OPERATIONS:
        return _status_error(
            operation,
            "invalid_operation",
            "unsupported_operation",
            "operation must be read, project, or update",
            400,
            job_id=_optional_string(payload.get("jobId")),
        )

    node_control_error = _validate_node_control(payload.get("nodeControl"))
    if node_control_error is not None:
        return _status_error(
            operation,
            "boundary_violation",
            "node_control_owner_mismatch",
            node_control_error,
            400,
            job_id=_optional_string(payload.get("jobId")),
        )

    raw_job = payload.get("job")
    if raw_job is None:
        return _status_error(
            operation,
            "not_found",
            "missing_node_job_snapshot",
            "Blueprint main state runtime requires a Node job snapshot.",
            404,
            job_id=_optional_string(payload.get("jobId")),
        )
    if not isinstance(raw_job, Mapping):
        return _status_error(
            operation,
            "validation_error",
            "job_snapshot_not_object",
            "Blueprint main state job snapshot must be an object.",
            400,
            job_id=_optional_string(payload.get("jobId")),
        )

    job_id = _optional_string(payload.get("jobId")) or _optional_string(raw_job.get("id"))
    if not job_id:
        return _status_error(
            operation,
            "validation_error",
            "missing_job_id",
            "Blueprint main state runtime requires jobId.",
            400,
        )
    if _optional_string(raw_job.get("id")) and raw_job.get("id") != job_id:
        return _status_error(
            operation,
            "validation_error",
            "job_id_mismatch",
            "Blueprint main state jobId must match the Node job snapshot id.",
            400,
            job_id=job_id,
        )

    try:
        projection = project_blueprint_main_state(raw_job)
    except Exception as error:
        return _status_error(
            operation,
            "projection_error",
            "projection_failed",
            str(error),
            422,
            job_id=job_id,
        )

    patch = payload.get("patch") if operation == "update" else None
    if patch is not None and not isinstance(patch, dict):
        return _status_error(
            operation,
            "validation_error",
            "patch_not_object",
            "Blueprint main state update patch must be an object.",
            400,
            job_id=job_id,
        )

    projected_at = _optional_string(payload.get("now")) or projection.updatedAt
    envelope = BlueprintMainStateRuntimeSuccess(
        operation=operation,
        runtime=BlueprintMainStateRuntimeBoundary(),
        jobId=job_id,
        projection=projection,
        read=BlueprintMainStateReadEnvelope(projectedAt=projected_at),
        update=BlueprintMainStateUpdateEnvelope(
            message=UPDATE_NODE_OWNER_MESSAGE,
            requestedPatch=patch if isinstance(patch, dict) else None,
        ),
    )
    return envelope.model_dump(exclude_none=True)


def _validate_node_control(value: Any) -> str | None:
    if not isinstance(value, Mapping):
        return "Blueprint main state runtime requires explicit Node-owned boundaries."
    for key, expected in NODE_OWNED_BOUNDARIES.items():
        if value.get(key) != expected:
            return "Blueprint main state runtime requires Node-owned boundaries."
    return None


def _status_error(
    operation: str,
    error: str,
    reason: str,
    message: str,
    status_code: int,
    *,
    job_id: str | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    envelope = BlueprintMainStateRuntimeError(
        operation=operation or "unknown",
        error=error,
        reason=reason,
        message=message,
        statusCode=status_code,
        jobId=job_id,
        retryable=retryable,
    )
    return envelope.model_dump(exclude_none=True)


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    clean = value.strip()
    return clean or None


def _clean_string(value: Any) -> str:
    return _optional_string(value) or ""


__all__ = [
    "BLUEPRINT_MAIN_STATE_RUNTIME_CONTRACT_VERSION",
    "BLUEPRINT_MAIN_STATE_RUNTIME_OPERATIONS",
    "BLUEPRINT_MAIN_STATE_RUNTIME_PROVENANCE",
    "execute_blueprint_state_runtime",
]
