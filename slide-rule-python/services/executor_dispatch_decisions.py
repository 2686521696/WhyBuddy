"""Executor dispatch / cancel decision surface (Python port).

Faithful port of the PURE decision parts of the Node executor dispatch and
cancel-forwarding paths. Node sources of truth:

- server/routes/tasks.ts ``dispatchMissionToExecutor`` (~line 1163):
  sourceText derivation, buildExecutionPlan inputs, execution-mode
  resolution (LOBSTER_EXECUTION_MODE), first-job payload patching
  (``applyMissionDispatchPayload``), requestId / idempotencyKey derivation,
  and the no-jobs failure decision.
- server/routes/tasks.ts ``buildServerBaseUrl`` + EXECUTOR_API_ROUTES.events
  (shared/executor/api.ts): callback URL composition.
- server/routes/tasks.ts POST /:id/cancel (~lines 1934-2099): already-final
  short-circuit, reason/requestedBy/source normalization
  (``normalizeCancelSource`` / ``toExecutorCancelSource``), the
  forward-to-executor decision (trimmed executor jobId), cancel URL
  composition (``buildExecutorUrl`` + EXECUTOR_API_ROUTES.cancelJob with an
  encodeURIComponent-encoded job id), the downstream cancel request body,
  and the downstream outcome interpretation (404 tolerated, other non-2xx
  -> 502 with the body error message, 2xx -> executorForwarded).

DECISIONS only. Deliberately NOT ported (Node-owned): buildExecutionPlan
itself (LLM planning), the ExecutorClient HTTP transport/retries/timeouts,
traceId generation (randomUUID at the call site), heartbeat monitoring,
missionRuntime stage progression writes, and the task-lifecycle /
mission-store / scheduler advisory calls surrounding cancel.

Node quirk ported as-is: on a 2xx downstream cancel response the route sets
``executorForwarded = true`` and then re-sets it to ``true`` inside the
non-terminal branch, so the terminal check never changes the outcome. The
verdict exposes ``downstreamTerminal`` for observability but keeps
``executorForwarded`` unconditionally true, matching Node.
"""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote, urlsplit

EXECUTOR_DISPATCH_DECISIONS_PROVENANCE = "python-executor-dispatch-decisions"

# server/routes/tasks.ts
DEFAULT_EXECUTOR_BASE_URL = "http://127.0.0.1:3031"
FINAL_MISSION_STATUSES = ("done", "failed", "cancelled")

# shared/executor/api.ts EXECUTOR_API_ROUTES
EXECUTOR_EVENTS_CALLBACK_PATH = "/api/executor/events"
EXECUTOR_CANCEL_JOB_PATH_TEMPLATE = "/api/executor/jobs/:id/cancel"

MISSION_EVENT_SOURCES = ("brain", "executor", "feishu", "mission-core", "user")

NO_EXECUTOR_JOBS_ERROR = "Execution plan did not produce any executor jobs."


# ── Small helpers (JS semantics) ─────────────────────────────────────────────


def _trimmed(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _optional_trimmed(value: Any) -> Optional[str]:
    trimmed = _trimmed(value)
    return trimmed or None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _js_number_text(value: Any) -> str:
    """JS template-literal rendering for the attempt counter (integers render
    without a trailing ``.0``)."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _encode_uri_component(value: str) -> str:
    """JS ``encodeURIComponent`` (unreserved: A-Za-z0-9 - _ . ! ~ * ' ( ))."""
    return quote(value, safe="!~*'()")


# ── Dispatch plan decisions (dispatchMissionToExecutor) ─────────────────────


def derive_mission_source_text(mission: dict[str, Any]) -> str:
    """``mission.sourceText?.trim() || mission.title``."""
    return _trimmed(mission.get("sourceText")) or _trimmed(mission.get("title"))


def build_execution_plan_inputs(mission: dict[str, Any], source_text: str) -> dict[str, Any]:
    """The exact ``buildExecutionPlan`` inputs Node passes (requestedBy is
    hard-coded to "brain" on the dispatch path)."""
    inputs: dict[str, Any] = {
        "missionId": _trimmed(mission.get("missionId")),
        "title": _trimmed(mission.get("title")),
        "sourceText": source_text,
        "requestedBy": "brain",
    }
    topic_id = _optional_trimmed(mission.get("topicId"))
    if topic_id is not None:
        inputs["topicId"] = topic_id
    return inputs


def resolve_execution_mode(execution_mode_env: Any) -> str:
    """``process.env.LOBSTER_EXECUTION_MODE === 'mock' ? 'mock' : 'real'``."""
    return "mock" if execution_mode_env == "mock" else "real"


def apply_mission_dispatch_payload(
    existing_payload: Any,
    mission_id: str,
    source_text: str,
    execution_mode: str,
) -> dict[str, Any]:
    """Port of ``applyMissionDispatchPayload`` (returns the new payload
    instead of mutating the job in place)."""
    existing = existing_payload if isinstance(existing_payload, dict) else {}
    existing_env = existing.get("env") if isinstance(existing.get("env"), dict) else {}

    if execution_mode == "mock":
        rest = {
            key: value
            for key, value in existing.items()
            if key not in ("aiEnabled", "aiTaskType", "runner")
        }
        payload: dict[str, Any] = dict(rest)
        if existing_env:
            payload["env"] = existing_env
        payload["runner"] = {
            "kind": "mock",
            "outcome": "success",
            "steps": 3,
            "delayMs": 40,
            "summary": "Mock mission execution completed.",
        }
        return payload

    rest = {key: value for key, value in existing.items() if key != "runner"}
    ai_task_type = existing.get("aiTaskType")
    payload = dict(rest)
    payload["aiEnabled"] = True
    payload["aiTaskType"] = (
        ai_task_type.strip()
        if isinstance(ai_task_type, str) and ai_task_type.strip()
        else "text-generation"
    )
    payload["command"] = []
    payload["env"] = {
        **existing_env,
        "MISSION_ID": mission_id,
        "TASK_CONTENT": source_text,
    }
    return payload


def _attempt_number(attempt: Any) -> Any:
    """``mission.attempt ?? 1`` (only null/undefined fall back; 0 is kept)."""
    return attempt if _is_number(attempt) else 1


def derive_dispatch_request_id(mission_id: str, attempt: Any) -> str:
    return f"mission_{mission_id}_attempt_{_js_number_text(_attempt_number(attempt))}"


def derive_dispatch_idempotency_key(mission_id: str, attempt: Any) -> str:
    return f"mission:{mission_id}:attempt:{_js_number_text(_attempt_number(attempt))}"


def build_server_base_url(server: dict[str, Any]) -> Optional[str]:
    """Port of ``buildServerBaseUrl``: x-forwarded-proto / x-forwarded-host
    (first comma-separated entry) win over the direct protocol/host, host
    falls back to 127.0.0.1."""

    def first_forwarded(value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return value.split(",")[0].strip()

    protocol = first_forwarded(server.get("forwardedProto")) or _trimmed(
        server.get("protocol")
    )
    host = first_forwarded(server.get("forwardedHost")) or _trimmed(server.get("host")) or "127.0.0.1"
    if not protocol:
        return None
    return f"{protocol}://{host}"


def compose_executor_callback_url(server_base_url: str) -> Optional[str]:
    """``new URL(EXECUTOR_API_ROUTES.events, buildServerBaseUrl(req))``:
    an absolute path against the base origin."""
    parts = urlsplit(server_base_url)
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}{EXECUTOR_EVENTS_CALLBACK_PATH}"


def _fail_closed(error: str) -> dict[str, Any]:
    return {
        "ok": False,
        "error": error,
        "source": "python",
        "provenance": EXECUTOR_DISPATCH_DECISIONS_PROVENANCE,
    }


def build_executor_dispatch_plan(payload: Any) -> dict[str, Any]:
    """Full dispatch-plan decision envelope.

    Payload contract (all decision inputs Node already holds):
    - ``mission``: {missionId, title, sourceText?, attempt?, topicId?}
    - ``executionModeEnv``: raw LOBSTER_EXECUTION_MODE value (Node env)
    - ``hasFirstJob``: whether plan.jobs[0] exists (default True)
    - ``firstJobPayload``: plan.jobs[0].payload (object or absent)
    - ``server``: {forwardedProto?, forwardedHost?, protocol?, host?} to
      compose the callback URL, or ``callbackUrl`` passthrough when Node
      already composed it.
    """
    body = payload if isinstance(payload, dict) else {}
    mission = body.get("mission")
    if not isinstance(mission, dict):
        return _fail_closed("mission must be an object")
    mission_id = _trimmed(mission.get("missionId"))
    if not mission_id:
        return _fail_closed("mission.missionId must be a non-empty string")

    source_text = derive_mission_source_text(mission)
    execution_mode = resolve_execution_mode(body.get("executionModeEnv"))

    has_first_job = body.get("hasFirstJob")
    if not isinstance(has_first_job, bool):
        has_first_job = True

    callback_url: Optional[str] = None
    server = body.get("server")
    if isinstance(server, dict):
        base = build_server_base_url(server)
        callback_url = compose_executor_callback_url(base) if base else None
    if callback_url is None:
        callback_url = _optional_trimmed(body.get("callbackUrl"))

    envelope: dict[str, Any] = {
        "ok": True,
        "source": "python",
        "provenance": EXECUTOR_DISPATCH_DECISIONS_PROVENANCE,
        "missionId": mission_id,
        "sourceText": source_text,
        "planInputs": build_execution_plan_inputs(mission, source_text),
        "executionMode": execution_mode,
        "dispatch": {
            "requestId": derive_dispatch_request_id(mission_id, mission.get("attempt")),
            "idempotencyKey": derive_dispatch_idempotency_key(
                mission_id, mission.get("attempt")
            ),
        },
        "hasFirstJob": has_first_job,
    }
    if callback_url is not None:
        envelope["callbackUrl"] = callback_url

    if has_first_job:
        envelope["jobPayload"] = apply_mission_dispatch_payload(
            body.get("firstJobPayload"), mission_id, source_text, execution_mode
        )
    else:
        envelope["noJobs"] = {"error": NO_EXECUTOR_JOBS_ERROR}

    return envelope


# ── Cancel forwarding decisions (POST /api/tasks/:id/cancel) ────────────────


def normalize_cancel_source(value: Any) -> str:
    """Port of ``normalizeCancelSource`` (unknown values become "user")."""
    return value if value in MISSION_EVENT_SOURCES else "user"


def to_executor_cancel_source(source: str) -> str:
    """Port of ``toExecutorCancelSource``."""
    if source in ("user", "brain", "feishu"):
        return source
    return "system"


def is_executor_terminal_status(value: Any) -> bool:
    return value in ("completed", "failed", "cancelled")


def build_executor_cancel_url(base_url: str, job_id: str) -> Optional[str]:
    """``buildExecutorUrl(baseUrl, EXECUTOR_API_ROUTES.cancelJob.replace(':id',
    encodeURIComponent(jobId)))`` — an absolute path resolved against the
    base origin (a base path prefix is dropped, matching ``new URL``)."""
    parts = urlsplit(base_url)
    if not parts.scheme or not parts.netloc:
        return None
    path = EXECUTOR_CANCEL_JOB_PATH_TEMPLATE.replace(":id", _encode_uri_component(job_id))
    return f"{parts.scheme}://{parts.netloc}{path}"


def interpret_executor_cancel_downstream(downstream: dict[str, Any]) -> dict[str, Any]:
    """Outcome interpretation for the downstream executor cancel response
    (Node lines ~2067-2099). Transport failures (fetch threw) stay in Node
    (503 before any body exists)."""
    ok = downstream.get("ok") is True
    status = downstream.get("status")
    parsed_body = downstream.get("body") if isinstance(downstream.get("body"), dict) else None

    if not ok:
        error_value = parsed_body.get("error") if parsed_body else None
        message = (
            error_value
            if isinstance(error_value, str)
            else f"Executor cancel request failed with HTTP {status}"
        )
        if status != 404:
            return {
                "executorForwarded": False,
                "tolerated404": False,
                "error": {"status": 502, "message": message},
            }
        # 404: the executor no longer knows the job; cancel proceeds locally.
        return {"executorForwarded": False, "tolerated404": True}

    downstream_status = parsed_body.get("status") if parsed_body else None
    return {
        # Node quirk (ported as-is): forwarded is true regardless of the
        # downstream terminal check — the non-terminal branch re-assigns true.
        "executorForwarded": True,
        "tolerated404": False,
        "downstreamTerminal": is_executor_terminal_status(downstream_status),
    }


def decide_executor_cancel(payload: Any) -> dict[str, Any]:
    """Full cancel-forwarding decision envelope.

    Payload contract:
    - ``task``: {id, status, executor?: {jobId?, baseUrl?}}
    - ``body``: the cancel request body ({reason?, requestedBy?, source?})
    - ``defaultExecutorBaseUrl``: Node's resolved default executor base URL
    - ``downstream``: optional {ok, status, body} — when present, the
      envelope also carries the downstream ``outcome`` verdict.
    """
    body = payload if isinstance(payload, dict) else {}
    task = body.get("task")
    if not isinstance(task, dict):
        return _fail_closed("task must be an object")
    task_id = _trimmed(task.get("id"))
    if not task_id:
        return _fail_closed("task.id must be a non-empty string")
    status = task.get("status")
    if not isinstance(status, str) or not status:
        return _fail_closed("task.status must be a non-empty string")

    request_body = body.get("body") if isinstance(body.get("body"), dict) else {}

    already_final = status in FINAL_MISSION_STATUSES

    reason = _optional_trimmed(request_body.get("reason"))
    requested_by = _optional_trimmed(request_body.get("requestedBy"))
    cancel_source = normalize_cancel_source(request_body.get("source"))
    executor_cancel_source = to_executor_cancel_source(cancel_source)

    executor = task.get("executor") if isinstance(task.get("executor"), dict) else {}
    executor_job_id = _optional_trimmed(executor.get("jobId"))
    forward = bool(executor_job_id) and not already_final

    executor_base_url = (
        _optional_trimmed(executor.get("baseUrl"))
        or _optional_trimmed(body.get("defaultExecutorBaseUrl"))
        or DEFAULT_EXECUTOR_BASE_URL
    )

    envelope: dict[str, Any] = {
        "ok": True,
        "source": "python",
        "provenance": EXECUTOR_DISPATCH_DECISIONS_PROVENANCE,
        "missionId": task_id,
        "alreadyFinal": already_final,
        "forward": forward,
        "cancelSource": cancel_source,
        "executorCancelSource": executor_cancel_source,
    }
    if reason is not None:
        envelope["reason"] = reason
    if requested_by is not None:
        envelope["requestedBy"] = requested_by
    if executor_job_id is not None:
        envelope["executorJobId"] = executor_job_id

    if forward and executor_job_id:
        cancel_url = build_executor_cancel_url(executor_base_url, executor_job_id)
        if cancel_url is None:
            return _fail_closed(
                f"executor base URL is not a valid absolute URL: {executor_base_url}"
            )
        envelope["executorBaseUrl"] = executor_base_url
        envelope["cancelUrl"] = cancel_url
        # JSON.stringify drops undefined fields; only send what Node sends.
        downstream_request_body: dict[str, Any] = {"source": executor_cancel_source}
        if reason is not None:
            downstream_request_body["reason"] = reason
        if requested_by is not None:
            downstream_request_body["requestedBy"] = requested_by
        envelope["requestBody"] = downstream_request_body

    downstream = body.get("downstream")
    if downstream is not None:
        if not isinstance(downstream, dict) or not isinstance(downstream.get("ok"), bool):
            return _fail_closed("downstream must be an object with a boolean ok field")
        if not _is_number(downstream.get("status")):
            return _fail_closed("downstream.status must be a number")
        envelope["outcome"] = interpret_executor_cancel_downstream(downstream)

    return envelope
