"""Parity tests for services/executor_dispatch_decisions.py.

Node sources of truth:
- server/routes/tasks.ts dispatchMissionToExecutor (~line 1163) +
  applyMissionDispatchPayload + buildServerBaseUrl
- server/routes/tasks.ts POST /:id/cancel (~lines 1934-2099) +
  normalizeCancelSource / toExecutorCancelSource / buildExecutorUrl
- shared/executor/api.ts EXECUTOR_API_ROUTES
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.executor_dispatch_decisions import (  # noqa: E402
    DEFAULT_EXECUTOR_BASE_URL,
    NO_EXECUTOR_JOBS_ERROR,
    apply_mission_dispatch_payload,
    build_executor_cancel_url,
    build_executor_dispatch_plan,
    build_execution_plan_inputs,
    build_server_base_url,
    compose_executor_callback_url,
    decide_executor_cancel,
    derive_dispatch_idempotency_key,
    derive_dispatch_request_id,
    derive_mission_source_text,
    interpret_executor_cancel_downstream,
    is_executor_terminal_status,
    normalize_cancel_source,
    resolve_execution_mode,
    to_executor_cancel_source,
)


# ---------------------------------------------------------------------------
# sourceText / plan inputs / execution mode
# ---------------------------------------------------------------------------


def test_source_text_prefers_trimmed_source_text_then_title():
    assert derive_mission_source_text({"sourceText": "  do it  ", "title": "T"}) == "do it"
    assert derive_mission_source_text({"sourceText": "   ", "title": "T"}) == "T"
    assert derive_mission_source_text({"title": "T"}) == "T"
    assert derive_mission_source_text({"sourceText": None, "title": "T"}) == "T"


def test_plan_inputs_hardcode_requested_by_brain_and_optional_topic():
    inputs = build_execution_plan_inputs(
        {"missionId": "m-1", "title": "Title", "topicId": " topic-9 "}, "src"
    )
    assert inputs == {
        "missionId": "m-1",
        "title": "Title",
        "sourceText": "src",
        "requestedBy": "brain",
        "topicId": "topic-9",
    }
    assert "topicId" not in build_execution_plan_inputs(
        {"missionId": "m-1", "title": "Title"}, "src"
    )


def test_execution_mode_only_mock_string_selects_mock():
    assert resolve_execution_mode("mock") == "mock"
    for value in ("real", "MOCK", "", None, True, 1):
        assert resolve_execution_mode(value) == "real"


# ---------------------------------------------------------------------------
# applyMissionDispatchPayload port
# ---------------------------------------------------------------------------


def test_mock_payload_strips_ai_fields_and_installs_mock_runner():
    payload = apply_mission_dispatch_payload(
        {
            "aiEnabled": True,
            "aiTaskType": "code",
            "runner": {"kind": "old"},
            "keep": "me",
            "env": {"A": "1"},
        },
        "m-1",
        "src",
        "mock",
    )
    assert payload == {
        "keep": "me",
        "env": {"A": "1"},
        "runner": {
            "kind": "mock",
            "outcome": "success",
            "steps": 3,
            "delayMs": 40,
            "summary": "Mock mission execution completed.",
        },
    }


def test_mock_payload_env_passthrough_matches_node_spread_semantics():
    # Node keeps `env: {}` via `...rest` (the conditional spread only decides
    # whether to RE-add it); an empty env therefore survives as-is.
    payload = apply_mission_dispatch_payload({"env": {}}, "m-1", "src", "mock")
    assert payload["env"] == {}
    payload = apply_mission_dispatch_payload(None, "m-1", "src", "mock")
    assert set(payload.keys()) == {"runner"}


def test_real_payload_forces_ai_and_injects_mission_env():
    payload = apply_mission_dispatch_payload(
        {"runner": {"kind": "mock"}, "keep": "me", "env": {"A": "1"}},
        "m-1",
        "the source",
        "real",
    )
    assert payload["aiEnabled"] is True
    assert payload["aiTaskType"] == "text-generation"
    assert payload["command"] == []
    assert payload["env"] == {"A": "1", "MISSION_ID": "m-1", "TASK_CONTENT": "the source"}
    assert payload["keep"] == "me"
    assert "runner" not in payload


def test_real_payload_keeps_trimmed_existing_ai_task_type():
    payload = apply_mission_dispatch_payload(
        {"aiTaskType": "  image-gen  "}, "m-1", "s", "real"
    )
    assert payload["aiTaskType"] == "image-gen"
    payload = apply_mission_dispatch_payload({"aiTaskType": "   "}, "m-1", "s", "real")
    assert payload["aiTaskType"] == "text-generation"


def test_env_must_be_a_plain_object_to_be_preserved():
    payload = apply_mission_dispatch_payload({"env": ["not", "a", "dict"]}, "m", "s", "real")
    assert payload["env"] == {"MISSION_ID": "m", "TASK_CONTENT": "s"}


# ---------------------------------------------------------------------------
# requestId / idempotencyKey derivation
# ---------------------------------------------------------------------------


def test_request_id_and_idempotency_key_derivation():
    assert derive_dispatch_request_id("m-1", 3) == "mission_m-1_attempt_3"
    assert derive_dispatch_idempotency_key("m-1", 3) == "mission:m-1:attempt:3"
    # ?? 1 fallback: only null/undefined fall back, 0 is kept.
    assert derive_dispatch_request_id("m-1", None) == "mission_m-1_attempt_1"
    assert derive_dispatch_request_id("m-1", 0) == "mission_m-1_attempt_0"
    # JSON floats that are integral render like JS numbers.
    assert derive_dispatch_request_id("m-1", 2.0) == "mission_m-1_attempt_2"


# ---------------------------------------------------------------------------
# callback URL composition
# ---------------------------------------------------------------------------


def test_server_base_url_prefers_first_forwarded_values():
    assert (
        build_server_base_url(
            {
                "forwardedProto": "https, http",
                "forwardedHost": "edge.example.com:8443, inner",
                "protocol": "http",
                "host": "127.0.0.1:3000",
            }
        )
        == "https://edge.example.com:8443"
    )
    assert (
        build_server_base_url({"protocol": "http", "host": "127.0.0.1:3000"})
        == "http://127.0.0.1:3000"
    )
    assert build_server_base_url({"protocol": "http"}) == "http://127.0.0.1"
    assert build_server_base_url({}) is None


def test_callback_url_is_events_path_on_the_origin():
    assert (
        compose_executor_callback_url("http://127.0.0.1:3000")
        == "http://127.0.0.1:3000/api/executor/events"
    )
    assert compose_executor_callback_url("not-a-url") is None


# ---------------------------------------------------------------------------
# dispatch plan envelope
# ---------------------------------------------------------------------------


def test_dispatch_plan_envelope_happy_path():
    envelope = build_executor_dispatch_plan(
        {
            "mission": {
                "missionId": "m-77",
                "title": "Build a report",
                "sourceText": "  Build the Q3 report  ",
                "attempt": 2,
            },
            "executionModeEnv": "mock",
            "hasFirstJob": True,
            "firstJobPayload": {"env": {"KEEP": "1"}},
            "server": {"protocol": "http", "host": "127.0.0.1:3000"},
        }
    )
    assert envelope["ok"] is True
    assert envelope["source"] == "python"
    assert envelope["provenance"] == "python-executor-dispatch-decisions"
    assert envelope["sourceText"] == "Build the Q3 report"
    assert envelope["executionMode"] == "mock"
    assert envelope["dispatch"] == {
        "requestId": "mission_m-77_attempt_2",
        "idempotencyKey": "mission:m-77:attempt:2",
    }
    assert envelope["callbackUrl"] == "http://127.0.0.1:3000/api/executor/events"
    assert envelope["jobPayload"]["runner"]["kind"] == "mock"
    assert envelope["jobPayload"]["env"] == {"KEEP": "1"}
    assert envelope["planInputs"]["requestedBy"] == "brain"
    assert "noJobs" not in envelope


def test_dispatch_plan_callback_url_passthrough_when_no_server_headers():
    envelope = build_executor_dispatch_plan(
        {
            "mission": {"missionId": "m-1", "title": "T"},
            "callbackUrl": " http://caller.example/api/executor/events ",
        }
    )
    assert envelope["callbackUrl"] == "http://caller.example/api/executor/events"


def test_dispatch_plan_no_jobs_decision():
    envelope = build_executor_dispatch_plan(
        {"mission": {"missionId": "m-1", "title": "T"}, "hasFirstJob": False}
    )
    assert envelope["noJobs"] == {"error": NO_EXECUTOR_JOBS_ERROR}
    assert "jobPayload" not in envelope


def test_dispatch_plan_fails_closed_on_malformed_mission():
    assert build_executor_dispatch_plan({})["ok"] is False
    assert build_executor_dispatch_plan({"mission": "nope"})["ok"] is False
    assert build_executor_dispatch_plan({"mission": {"missionId": "  "}})["ok"] is False


# ---------------------------------------------------------------------------
# cancel: source normalization / terminal / cancel URL
# ---------------------------------------------------------------------------


def test_normalize_cancel_source_table():
    for source in ("brain", "executor", "feishu", "mission-core", "user"):
        assert normalize_cancel_source(source) == source
    for source in ("robot", "", None, 42, True):
        assert normalize_cancel_source(source) == "user"


def test_to_executor_cancel_source_table():
    assert to_executor_cancel_source("user") == "user"
    assert to_executor_cancel_source("brain") == "brain"
    assert to_executor_cancel_source("feishu") == "feishu"
    assert to_executor_cancel_source("executor") == "system"
    assert to_executor_cancel_source("mission-core") == "system"


def test_is_executor_terminal_status():
    assert is_executor_terminal_status("completed")
    assert is_executor_terminal_status("failed")
    assert is_executor_terminal_status("cancelled")
    assert not is_executor_terminal_status("running")
    assert not is_executor_terminal_status(None)


def test_cancel_url_encodes_job_id_and_resolves_against_origin():
    assert (
        build_executor_cancel_url("http://127.0.0.1:3031", "job-1")
        == "http://127.0.0.1:3031/api/executor/jobs/job-1/cancel"
    )
    # encodeURIComponent semantics on the job id
    assert (
        build_executor_cancel_url("http://exec.local", "job/1 x")
        == "http://exec.local/api/executor/jobs/job%2F1%20x/cancel"
    )
    # new URL with an absolute path drops any base path prefix
    assert (
        build_executor_cancel_url("http://exec.local/nested/", "j")
        == "http://exec.local/api/executor/jobs/j/cancel"
    )
    assert build_executor_cancel_url("nope", "j") is None


# ---------------------------------------------------------------------------
# cancel decision envelope
# ---------------------------------------------------------------------------


def _cancel(payload):
    return decide_executor_cancel(payload)


def test_cancel_already_final_short_circuits_without_forwarding():
    for status in ("done", "failed", "cancelled"):
        envelope = _cancel(
            {
                "task": {"id": "m-1", "status": status, "executor": {"jobId": "job-1"}},
                "body": {"reason": "stop"},
            }
        )
        assert envelope["alreadyFinal"] is True
        assert envelope["forward"] is False
        assert "cancelUrl" not in envelope


def test_cancel_forwards_when_executor_job_id_present():
    envelope = _cancel(
        {
            "task": {
                "id": "m-1",
                "status": "running",
                "executor": {"jobId": "  job-9  ", "baseUrl": " http://exec.local "},
            },
            "body": {"reason": " because ", "requestedBy": " ops ", "source": "brain"},
        }
    )
    assert envelope["alreadyFinal"] is False
    assert envelope["forward"] is True
    assert envelope["executorJobId"] == "job-9"
    assert envelope["executorBaseUrl"] == "http://exec.local"
    assert envelope["cancelUrl"] == "http://exec.local/api/executor/jobs/job-9/cancel"
    assert envelope["reason"] == "because"
    assert envelope["requestedBy"] == "ops"
    assert envelope["cancelSource"] == "brain"
    assert envelope["executorCancelSource"] == "brain"
    assert envelope["requestBody"] == {
        "source": "brain",
        "reason": "because",
        "requestedBy": "ops",
    }


def test_cancel_request_body_drops_undefined_fields_like_json_stringify():
    envelope = _cancel(
        {
            "task": {"id": "m-1", "status": "running", "executor": {"jobId": "j"}},
            "body": {"source": "mission-core"},
        }
    )
    assert envelope["requestBody"] == {"source": "system"}
    assert "reason" not in envelope
    assert "requestedBy" not in envelope


def test_cancel_without_executor_job_does_not_forward():
    envelope = _cancel({"task": {"id": "m-1", "status": "running"}, "body": {}})
    assert envelope["forward"] is False
    assert "cancelUrl" not in envelope
    assert "executorJobId" not in envelope
    envelope = _cancel(
        {
            "task": {"id": "m-1", "status": "running", "executor": {"jobId": "   "}},
            "body": {},
        }
    )
    assert envelope["forward"] is False


def test_cancel_base_url_falls_back_to_default_chain():
    envelope = _cancel(
        {
            "task": {"id": "m-1", "status": "running", "executor": {"jobId": "j"}},
            "body": {},
            "defaultExecutorBaseUrl": "http://fallback.example",
        }
    )
    assert envelope["executorBaseUrl"] == "http://fallback.example"
    envelope = _cancel(
        {"task": {"id": "m-1", "status": "running", "executor": {"jobId": "j"}}, "body": {}}
    )
    assert envelope["executorBaseUrl"] == DEFAULT_EXECUTOR_BASE_URL


def test_cancel_fails_closed_on_malformed_task():
    assert _cancel({})["ok"] is False
    assert _cancel({"task": {"id": "", "status": "running"}})["ok"] is False
    assert _cancel({"task": {"id": "m-1"}})["ok"] is False


# ---------------------------------------------------------------------------
# downstream outcome interpretation
# ---------------------------------------------------------------------------


def test_downstream_2xx_marks_forwarded_even_when_terminal():
    outcome = interpret_executor_cancel_downstream(
        {"ok": True, "status": 200, "body": {"status": "completed"}}
    )
    # Node quirk ported as-is: forwarded stays true regardless of terminal.
    assert outcome["executorForwarded"] is True
    assert outcome["downstreamTerminal"] is True

    outcome = interpret_executor_cancel_downstream(
        {"ok": True, "status": 200, "body": {"status": "cancelling"}}
    )
    assert outcome["executorForwarded"] is True
    assert outcome["downstreamTerminal"] is False


def test_downstream_404_is_tolerated_without_forwarding():
    outcome = interpret_executor_cancel_downstream({"ok": False, "status": 404, "body": None})
    assert outcome == {"executorForwarded": False, "tolerated404": True}


def test_downstream_non_404_error_maps_to_502_with_body_error_message():
    outcome = interpret_executor_cancel_downstream(
        {"ok": False, "status": 500, "body": {"error": "executor exploded"}}
    )
    assert outcome["error"] == {"status": 502, "message": "executor exploded"}
    assert outcome["executorForwarded"] is False

    outcome = interpret_executor_cancel_downstream(
        {"ok": False, "status": 503, "body": {"error": 42}}
    )
    assert outcome["error"]["message"] == "Executor cancel request failed with HTTP 503"


def test_cancel_envelope_carries_downstream_outcome_phase():
    envelope = _cancel(
        {
            "task": {"id": "m-1", "status": "running", "executor": {"jobId": "j"}},
            "body": {},
            "downstream": {"ok": True, "status": 200, "body": {"status": "cancelling"}},
        }
    )
    assert envelope["outcome"]["executorForwarded"] is True

    malformed = _cancel(
        {
            "task": {"id": "m-1", "status": "running"},
            "body": {},
            "downstream": {"ok": "yes"},
        }
    )
    assert malformed["ok"] is False
