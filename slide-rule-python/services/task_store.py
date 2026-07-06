"""Durable task (mission) store for the /api/tasks surface.

First honest slice of the Node ``server/tasks/mission-store.ts`` takeover.
The on-disk contract mirrors the sliderule session store proven in
``services/persistence.py``: a JSON array of ``[taskId, record]`` entries,
written atomically (tmp file + ``os.replace``) under a module lock that
serializes every read-modify-write.

Record shape follows the Node ``MissionRecord`` contract
(``shared/mission/contracts.ts``): id / kind / title / sourceText / topicId /
projection / status / progress / stages / operatorState / operatorActions /
attempt / createdAt / updatedAt (epoch millis) / events.

Differences from the sliderule session store, on purpose:
- No same-turn progress guard: tasks have no ``lastTurnId``; the module lock
  plus status-transition validation is the concurrency story.
- Corrupt-record isolation is per entry: one malformed ``[taskId, record]``
  entry is skipped (and reported) instead of poisoning the whole store read.
  Only unreadable/invalid JSON fails the store as a whole.
"""

from __future__ import annotations

import json
import os
import random
import string
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

STORE_FILE = "data/tasks.json"
STORE_FILE_ENV = "TASK_STORE_FILE"

StorePath = Union[str, os.PathLike[str]]
StoreError = Dict[str, Any]

TASK_STATUSES = ("queued", "running", "waiting", "done", "failed", "cancelled")
FINAL_TASK_STATUSES = frozenset({"done", "failed", "cancelled"})

# Mirrors Node mission semantics: any live status may move to any live or
# final status (markRunning/markWaiting/markDone/markFailed/markCancelled all
# operate on live missions); final statuses are terminal.
_LIVE_STATUSES = frozenset({"queued", "running", "waiting"})

TASK_EVENT_TYPES = frozenset(
    {
        "created",
        "progress",
        "log",
        "waiting",
        "done",
        "failed",
        "cancelled",
        "role_switch",
        "collaboration_result",
    }
)
TASK_EVENT_LEVELS = frozenset({"info", "warn", "error"})
TASK_EVENT_SOURCES = frozenset({"mission-core", "executor", "feishu", "brain", "user"})

# Mirrors MISSION_CORE_STAGE_BLUEPRINT in shared/mission/contracts.ts.
TASK_CORE_STAGE_BLUEPRINT = (
    {"key": "receive", "label": "Receive task"},
    {"key": "understand", "label": "Understand request"},
    {"key": "plan", "label": "Build execution plan"},
    {"key": "provision", "label": "Provision execution runtime"},
    {"key": "execute", "label": "Run execution"},
    {"key": "finalize", "label": "Finalize mission"},
)

_lock = threading.Lock()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _resolve_store_file(store_file: Optional[StorePath] = None) -> Path:
    if store_file is not None:
        return Path(store_file)
    env_file = os.getenv(STORE_FILE_ENV)
    if env_file:
        return Path(env_file)
    try:
        from config.settings import settings

        configured = getattr(settings, "TASK_STORE_FILE", None)
        if configured:
            return Path(configured)
    except Exception:
        pass
    return Path(STORE_FILE)


def _store_error(reason: str, message: str) -> StoreError:
    return {"ok": False, "error": "store_corrupt", "reason": reason, "message": message}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _base36(value: int) -> str:
    if value == 0:
        return "0"
    digits = string.digits + string.ascii_lowercase
    out = []
    while value:
        value, rem = divmod(value, 36)
        out.append(digits[rem])
    return "".join(reversed(out))


def _create_task_id(created_at: int) -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"mission_{_base36(created_at)}_{suffix}"


def _clean_string(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _clamp_progress(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number != number or number in (float("inf"), float("-inf")):
        return 0
    return max(0, min(100, round(number)))


def build_task_title(title: Any, source_text: Any) -> Optional[str]:
    """Port of Node buildTaskTitle (routes/tasks.ts)."""
    cleaned = _clean_string(title)
    if cleaned:
        return cleaned
    source = _clean_string(source_text)
    if source:
        compact = " ".join(source.split())
        return f"{compact[:48]}..." if len(compact) > 48 else compact
    return None


def _is_valid_record(task_id: Any, record: Any) -> bool:
    return (
        isinstance(task_id, str)
        and bool(task_id)
        and isinstance(record, dict)
        and _clean_string(record.get("id")) is not None
        and record.get("status") in TASK_STATUSES
        and isinstance(record.get("events"), list)
    )


# ---------------------------------------------------------------------------
# disk I/O
# ---------------------------------------------------------------------------


def _read_store(
    store_file: Optional[StorePath] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Optional[StoreError], int]:
    """Return (tasks, fatal_error, skipped_count).

    Malformed entries are isolated (skipped, counted) so one corrupt record
    does not take the whole task surface down; invalid JSON is fatal.
    """
    path = _resolve_store_file(store_file)
    if not path.exists():
        return {}, None, 0

    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else []
    except json.JSONDecodeError as error:
        return {}, _store_error("invalid_json", error.msg), 0
    except OSError as error:
        return {}, _store_error("read_failed", str(error)), 0

    if not isinstance(data, list):
        return {}, _store_error("invalid_shape", "expected array of [taskId, record] entries"), 0

    tasks: Dict[str, Dict[str, Any]] = {}
    skipped = 0
    for entry in data:
        if (
            not isinstance(entry, list)
            or len(entry) != 2
            or not _is_valid_record(entry[0], entry[1])
        ):
            skipped += 1
            continue
        tasks[entry[0]] = entry[1]
    return tasks, None, skipped


def _write_store(
    tasks: Dict[str, Dict[str, Any]], store_file: Optional[StorePath] = None
) -> StoreError:
    path = _resolve_store_file(store_file)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.tmp")
        payload = [[task_id, record] for task_id, record in tasks.items()]
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as error:
        return {"ok": False, "error": "persist_failed", "reason": "write_failed", "message": str(error)}
    return {"ok": True, "count": len(tasks)}


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------


def create_task(
    *,
    kind: str = "chat",
    title: str,
    source_text: Optional[str] = None,
    topic_id: Optional[str] = None,
    projection: Optional[Dict[str, Any]] = None,
    stage_labels: Optional[List[Dict[str, str]]] = None,
    store_file: Optional[StorePath] = None,
) -> StoreError:
    """Create a queued MissionRecord (Node MissionStore.create parity)."""
    labels = stage_labels if stage_labels else [dict(stage) for stage in TASK_CORE_STAGE_BLUEPRINT]
    source_text = _clean_string(source_text)
    topic_id = _clean_string(topic_id)
    with _lock:
        tasks, error, _ = _read_store(store_file)
        if error:
            return error
        created_at = _now_ms()
        task: Dict[str, Any] = {
            "id": _create_task_id(created_at),
            "kind": kind,
            "title": title,
            "status": "queued",
            "progress": 0,
            "stages": [
                {"key": stage.get("key"), "label": stage.get("label"), "status": "pending"}
                for stage in labels
            ],
            "operatorState": "active",
            "operatorActions": [],
            "attempt": 1,
            "createdAt": created_at,
            "updatedAt": created_at,
            "events": [
                {
                    "type": "created",
                    "message": f"Mission created: {title}",
                    "time": created_at,
                    "source": "mission-core",
                }
            ],
        }
        if source_text:
            task["sourceText"] = source_text
        if topic_id:
            task["topicId"] = topic_id
        if isinstance(projection, dict) and projection:
            task["projection"] = projection

        tasks[task["id"]] = task
        result = _write_store(tasks, store_file)
        if not result.get("ok"):
            return result
        return {"ok": True, "task": task}


def get_task(task_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    tasks, error, _ = _read_store(store_file)
    if error:
        return {**error, "taskId": task_id}
    task = tasks.get(task_id)
    if task is None:
        return {"ok": False, "error": "not_found", "taskId": task_id}
    return {"ok": True, "task": task}


def list_tasks(limit: int = 20, store_file: Optional[StorePath] = None) -> StoreError:
    tasks, error, skipped = _read_store(store_file)
    if error:
        return error
    ordered = sorted(tasks.values(), key=lambda task: task.get("updatedAt") or 0, reverse=True)
    return {"ok": True, "tasks": ordered[: max(1, limit)], "skipped": skipped}


def list_task_events(
    task_id: str, limit: int = 20, store_file: Optional[StorePath] = None
) -> StoreError:
    result = get_task(task_id, store_file)
    if not result.get("ok"):
        return result
    events = sorted(
        list(result["task"].get("events") or []),
        key=lambda event: event.get("time") or 0,
        reverse=True,
    )
    return {"ok": True, "taskId": task_id, "events": events[: max(1, limit)]}


def is_legal_status_transition(current: str, target: str) -> bool:
    if current == target:
        return True
    return current in _LIVE_STATUSES and target in TASK_STATUSES


def update_task_status(
    task_id: str,
    status: str,
    *,
    message: Optional[str] = None,
    summary: Optional[str] = None,
    progress: Optional[Any] = None,
    stage_key: Optional[str] = None,
    source: str = "mission-core",
    store_file: Optional[StorePath] = None,
) -> StoreError:
    """Apply a mission status transition (markRunning/markWaiting/markDone/markFailed parity)."""
    if status not in TASK_STATUSES:
        return {
            "ok": False,
            "error": "invalid_status",
            "taskId": task_id,
            "message": f"Unsupported task status: {status}",
        }
    if status == "cancelled":
        # Cancellation carries its own idempotency contract; keep it on one path.
        return cancel_task(task_id, reason=message, source=source, store_file=store_file)

    event_source = source if source in TASK_EVENT_SOURCES else "mission-core"

    with _lock:
        tasks, error, _ = _read_store(store_file)
        if error:
            return {**error, "taskId": task_id}
        task = tasks.get(task_id)
        if task is None:
            return {"ok": False, "error": "not_found", "taskId": task_id}

        current = task.get("status")
        if not is_legal_status_transition(current, status):
            return {
                "ok": False,
                "error": "invalid_transition",
                "taskId": task_id,
                "from": current,
                "to": status,
                "message": f"Illegal task status transition: {current} -> {status}",
            }

        now = _now_ms()
        task["status"] = status
        if progress is not None:
            task["progress"] = _clamp_progress(progress)
        if stage_key:
            task["currentStageKey"] = stage_key

        event: Dict[str, Any] = {
            "type": "progress",
            "message": message or f"Task status: {status}",
            "progress": task.get("progress", 0),
            "time": now,
            "source": event_source,
        }
        if task.get("currentStageKey"):
            event["stageKey"] = task["currentStageKey"]

        if status == "running":
            task.pop("waitingFor", None)
            task.pop("decision", None)
        elif status == "waiting":
            task["waitingFor"] = message or "operator input"
            event["type"] = "waiting"
            event["message"] = message or "Waiting for operator input"
        elif status == "done":
            task["progress"] = 100
            event["progress"] = 100
            if summary:
                task["summary"] = summary
            task.pop("waitingFor", None)
            task.pop("decision", None)
            task["completedAt"] = now
            event["type"] = "done"
            event["message"] = summary or message or "Mission completed"
        elif status == "failed":
            task.pop("waitingFor", None)
            task.pop("decision", None)
            task["completedAt"] = now
            event["type"] = "failed"
            event["level"] = "error"
            event["message"] = message or "Mission failed"

        task["events"].append(event)
        task["updatedAt"] = now
        result = _write_store(tasks, store_file)
        if not result.get("ok"):
            return result
        return {"ok": True, "task": task}


def cancel_task(
    task_id: str,
    *,
    reason: Optional[str] = None,
    requested_by: Optional[str] = None,
    source: str = "user",
    store_file: Optional[StorePath] = None,
) -> StoreError:
    """Cancel a task (Node MissionStore.markCancelled parity, idempotent on final)."""
    event_source = source if source in TASK_EVENT_SOURCES else "user"
    with _lock:
        tasks, error, _ = _read_store(store_file)
        if error:
            return {**error, "taskId": task_id}
        task = tasks.get(task_id)
        if task is None:
            return {"ok": False, "error": "not_found", "taskId": task_id}

        if task.get("status") in FINAL_TASK_STATUSES:
            return {"ok": True, "task": task, "alreadyFinal": True}

        cancelled_at = _now_ms()
        task["status"] = "cancelled"
        task.pop("waitingFor", None)
        task.pop("decision", None)
        task["completedAt"] = cancelled_at
        task["cancelledAt"] = cancelled_at
        if requested_by:
            task["cancelledBy"] = requested_by
        if reason:
            task["cancelReason"] = reason
        task["events"].append(
            {
                "type": "cancelled",
                "message": reason or "Mission cancelled",
                "level": "warn",
                "progress": task.get("progress", 0),
                "time": cancelled_at,
                "source": event_source,
                **({"stageKey": task["currentStageKey"]} if task.get("currentStageKey") else {}),
            }
        )
        task["updatedAt"] = cancelled_at
        result = _write_store(tasks, store_file)
        if not result.get("ok"):
            return result
        return {"ok": True, "task": task, "alreadyFinal": False}


def append_task_event(
    task_id: str,
    *,
    event_type: str = "log",
    message: str,
    level: Optional[str] = None,
    progress: Optional[Any] = None,
    stage_key: Optional[str] = None,
    source: str = "mission-core",
    store_file: Optional[StorePath] = None,
) -> StoreError:
    """Append a MissionEvent (Node MissionStore.log parity, generalized by type)."""
    if event_type not in TASK_EVENT_TYPES:
        return {
            "ok": False,
            "error": "invalid_event_type",
            "taskId": task_id,
            "message": f"Unsupported task event type: {event_type}",
        }
    with _lock:
        tasks, error, _ = _read_store(store_file)
        if error:
            return {**error, "taskId": task_id}
        task = tasks.get(task_id)
        if task is None:
            return {"ok": False, "error": "not_found", "taskId": task_id}

        now = _now_ms()
        if progress is not None:
            task["progress"] = _clamp_progress(progress)
        event: Dict[str, Any] = {
            "type": event_type,
            "message": message,
            "progress": task.get("progress", 0),
            "time": now,
            "source": source if source in TASK_EVENT_SOURCES else "mission-core",
        }
        if level in TASK_EVENT_LEVELS:
            event["level"] = level
        resolved_stage = stage_key or task.get("currentStageKey")
        if resolved_stage:
            event["stageKey"] = resolved_stage

        task["events"].append(event)
        task["updatedAt"] = now
        result = _write_store(tasks, store_file)
        if not result.get("ok"):
            return result
        return {"ok": True, "taskId": task_id, "event": event, "task": task}
