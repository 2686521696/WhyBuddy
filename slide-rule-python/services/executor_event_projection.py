"""Executor callback event -> mission action projection (Python port).

Faithful port of the pure decision chain that turns an executor callback
delivery into a mission action. Node sources of truth:

- server/core/executor-event-mapper.ts   (mapExecutorEventToAction)
- server/core/executor-callback-routing.ts
  (isBlueprintExecutorMissionId / resolveExecutorCallbackRouting)
- server/index.ts POST /api/executor/events inline branch chain
  (~lines 1925-2098: effective progress / detail fallback / branch order /
  heartbeat reset+clear), exported here as the "apply plan".

Event type enum from shared/executor/contracts.ts (EXECUTOR_EVENT_TYPES).

Two deliberately distinct decision surfaces are exposed, matching Node:

- ``map_executor_event_to_action`` mirrors the pure mapper *including*
  delivery dedup (duplicate / out-of-order verdicts).
- ``build_executor_apply_plan`` mirrors the index.ts inline route branches,
  which do NOT consult the delivery envelope and whose branch order differs
  from the mapper in documented edge cases (e.g. ``job.completed`` with
  status "waiting" waits; ``job.failed`` with status "cancelled" cancels).

No invented behavior: every fallback chain is a line-for-line port.
"""

from __future__ import annotations

import math
from typing import Any, Optional

# ── Contract constants (shared/executor/contracts.ts) ───────────────────────

EXECUTOR_EVENT_TYPES = (
    "job.accepted",
    "job.started",
    "job.progress",
    "job.waiting",
    "job.completed",
    "job.failed",
    "job.cancelled",
    "job.log",
    "job.heartbeat",
    "job.log_stream",
    "job.screenshot",
)

# State-changing types delegated by the Node route (progress/waiting/terminal
# decisions). High-frequency streaming types must stay inline in Node.
STATE_CHANGING_EXECUTOR_EVENT_TYPES = (
    "job.started",
    "job.progress",
    "job.waiting",
    "job.completed",
    "job.failed",
    "job.cancelled",
)

STREAMING_EXECUTOR_EVENT_TYPES = ("job.log", "job.log_stream", "job.screenshot")

TERMINAL_EXECUTOR_STATUSES = ("completed", "failed", "cancelled")

EXECUTOR_EVENT_PROJECTION_PROVENANCE = "python-executor-event-projection"


# ── Small helpers (JS semantics) ─────────────────────────────────────────────


def _is_number(value: Any) -> bool:
    """JS ``typeof value === "number"`` (finite; JSON cannot carry NaN/Inf,
    and Python bools are excluded because JSON booleans are not numbers)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _trimmed(value: Any) -> str:
    """JS ``value?.trim() || ""`` for optional string fields."""
    return value.strip() if isinstance(value, str) else ""


def _clamp_progress(value: Any) -> float:
    """JS ``Math.max(0, Math.min(100, value))`` with non-number -> 0."""
    if not _is_number(value):
        return 0
    return max(0, min(100, value))


def _delivery(event: dict[str, Any]) -> dict[str, Any]:
    delivery = event.get("delivery")
    return delivery if isinstance(delivery, dict) else {}


# ── Pure mapper port (server/core/executor-event-mapper.ts) ─────────────────


def map_executor_event_to_action(event: dict[str, Any]) -> dict[str, Any]:
    """Port of ``mapExecutorEventToAction``: same action outputs for the same
    inputs (statuses, progress clamping, summary/error fallback chains,
    dedup verdicts, status-based fallback for unknown types)."""
    delivery = _delivery(event)
    if delivery.get("duplicate") is True:
        return {"action": "duplicate", "reason": "duplicate"}
    if delivery.get("outOfOrder") is True:
        return {"action": "duplicate", "reason": "out_of_order"}

    clamped_progress = _clamp_progress(event.get("progress"))

    summary_text = (
        _trimmed(event.get("summary"))
        or _trimmed(event.get("detail"))
        or _trimmed(event.get("message"))
        or ""
    )

    event_type = event.get("type")
    error_code = _trimmed(event.get("errorCode"))

    if event_type == "job.started":
        return {"action": "running", "progress": clamped_progress}

    if event_type == "job.progress":
        return {"action": "progress", "progress": clamped_progress}

    if event_type == "job.completed":
        return {"action": "done", "summary": summary_text}

    if event_type == "job.failed":
        return {"action": "failed", "error": summary_text or error_code or "unknown error"}

    if event_type == "job.cancelled":
        return {"action": "cancelled", "reason": summary_text or error_code or "cancelled"}

    if event_type == "job.log":
        log = event.get("log") if isinstance(event.get("log"), dict) else {}
        return {"action": "log", "message": _trimmed(log.get("message")) or summary_text}

    if event_type == "job.log_stream":
        return {"action": "log_stream"}

    if event_type == "job.screenshot":
        return {"action": "screenshot"}

    if event_type == "job.waiting":
        return {"action": "waiting"}

    # Status-based fallback (job.accepted, job.heartbeat, unknown types).
    status = event.get("status")
    if status == "completed":
        return {"action": "done", "summary": summary_text}
    if status == "failed":
        return {"action": "failed", "error": summary_text or "unknown error"}
    if status == "cancelled":
        return {"action": "cancelled", "reason": summary_text or "cancelled"}
    if status == "waiting":
        return {"action": "waiting"}
    return {"action": "unknown"}


# ── Routing port (server/core/executor-callback-routing.ts) ─────────────────


def is_blueprint_executor_mission_id(mission_id: Any) -> bool:
    normalized = mission_id.strip() if isinstance(mission_id, str) else ""
    return normalized.startswith("blueprint:") or normalized.startswith("blueprint-job-")


def resolve_executor_callback_routing(event: dict[str, Any]) -> dict[str, Any]:
    event_type = event.get("type")
    status = event.get("status")
    terminal = (
        event_type in ("job.completed", "job.failed", "job.cancelled")
        or status in TERMINAL_EXECUTOR_STATUSES
    )
    delivery = _delivery(event)
    duplicate_or_out_of_order = (
        delivery.get("duplicate") is True or delivery.get("outOfOrder") is True
    )

    return {
        "route": "blueprint" if is_blueprint_executor_mission_id(event.get("missionId")) else "mission",
        "missionId": _trimmed(event.get("missionId")),
        "jobId": _trimmed(event.get("jobId")),
        "eventId": _trimmed(event.get("eventId")),
        "callbackSource": "python" if event.get("callbackSource") == "python" else "node",
        "terminal": terminal,
        "ignoredTerminal": terminal and duplicate_or_out_of_order,
    }


# ── State-changing predicate (Node delegation contract) ─────────────────────


def is_state_changing_executor_event(event_type: Any, status: Any = None) -> bool:
    """True when the event drives a mission state decision (delegated to this
    projection); streaming types stay inline in Node regardless of status."""
    normalized_type = _trimmed(event_type)
    if normalized_type in STATE_CHANGING_EXECUTOR_EVENT_TYPES:
        return True
    if normalized_type in STREAMING_EXECUTOR_EVENT_TYPES:
        return False
    normalized_status = _trimmed(status)
    return normalized_status in ("waiting",) + TERMINAL_EXECUTOR_STATUSES


# ── Apply plan port (server/index.ts inline branch chain) ────────────────────


def build_executor_apply_plan(
    event: dict[str, Any], mission: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """Port of the index.ts POST /api/executor/events inline branches.

    ``mission`` is the minimal mission context Node already holds:
    - ``currentProgress``: current mission progress (progress fallback when
      the event carries no numeric progress — index.ts line ~1925)
    - ``stageLabel``: resolved executor stage label used by the detail
      fallback ``Executor event at <label>`` (index.ts line ~1933)

    The plan intentionally ignores the delivery envelope (the inline route
    does not dedup) and follows the inline branch order exactly.
    """
    context = mission if isinstance(mission, dict) else {}
    current_progress = (
        context.get("currentProgress") if _is_number(context.get("currentProgress")) else 0
    )
    stage_label = _trimmed(context.get("stageLabel")) or "execute"

    raw_progress = event.get("progress")
    progress = _clamp_progress(raw_progress) if _is_number(raw_progress) else current_progress
    detail = (
        _trimmed(event.get("detail"))
        or _trimmed(event.get("message"))
        or f"Executor event at {stage_label}"
    )
    summary_or_detail = _trimmed(event.get("summary")) or detail

    event_type = event.get("type")
    status = event.get("status")

    plan: dict[str, Any] = {
        "progress": progress,
        "detail": detail,
        # HeartbeatMonitor: reset on every processed event (index.ts ~1965).
        "resetHeartbeat": True,
        "clearHeartbeat": False,
    }

    if event_type in ("job.started", "job.progress"):
        # Both branches perform the identical markMissionRunning call.
        plan["kind"] = "running"
    elif event_type == "job.log":
        log = event.get("log") if isinstance(event.get("log"), dict) else {}
        level = log.get("level")
        plan["kind"] = "log"
        plan["message"] = _trimmed(log.get("message")) or detail
        plan["level"] = level if level in ("error", "warn") else "info"
    elif event_type == "job.log_stream":
        plan["kind"] = "log_stream"
    elif event_type == "job.screenshot":
        plan["kind"] = "screenshot"
    elif event_type == "job.waiting" or status == "waiting":
        plan["kind"] = "waiting"
        plan["waitingFor"] = _trimmed(event.get("waitingFor")) or detail
    elif event_type == "job.completed" or status == "completed":
        plan["kind"] = "done"
        plan["message"] = summary_or_detail
        plan["clearHeartbeat"] = True
    elif event_type in ("job.failed", "job.cancelled") or status in ("failed", "cancelled"):
        if event_type == "job.cancelled" or status == "cancelled":
            plan["kind"] = "cancelled"
            plan["reason"] = summary_or_detail
        else:
            plan["kind"] = "failed"
            plan["error"] = summary_or_detail
        plan["clearHeartbeat"] = True
    else:
        # Inline fallback: unknown types still markMissionRunning.
        plan["kind"] = "running"

    plan["stateChanging"] = plan["kind"] in ("running", "waiting", "done", "failed", "cancelled")
    return plan


# ── Envelope (route surface) ─────────────────────────────────────────────────


def _fail_closed(error: str) -> dict[str, Any]:
    return {
        "ok": False,
        "error": error,
        "source": "python",
        "provenance": EXECUTOR_EVENT_PROJECTION_PROVENANCE,
    }


def project_executor_event(
    event: Any, mission: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """Full projection envelope for one executor callback delivery.

    Fail-closed: malformed deliveries (missing/blank missionId, jobId,
    eventId or type) never produce an action envelope.
    """
    if not isinstance(event, dict):
        return _fail_closed("event must be an object")

    for field in ("missionId", "jobId", "eventId", "type"):
        if not _trimmed(event.get(field)):
            return _fail_closed(f"event.{field} must be a non-empty string")

    routing = resolve_executor_callback_routing(event)
    action = map_executor_event_to_action(event)
    apply_plan = build_executor_apply_plan(event, mission)

    return {
        "ok": True,
        "source": "python",
        "provenance": EXECUTOR_EVENT_PROJECTION_PROVENANCE,
        "missionId": routing["missionId"],
        "jobId": routing["jobId"],
        "eventId": routing["eventId"],
        "stateChanging": is_state_changing_executor_event(event.get("type"), event.get("status")),
        "routing": routing,
        "action": action,
        "apply": apply_plan,
    }
