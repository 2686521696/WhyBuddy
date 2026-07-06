"""Parity tests for services/executor_event_projection.py.

Ports the Node property/golden suites:
- server/tests/executor-event-mapping.property.test.ts (Property 7 事件到状态映射)
- server/tests/executor-callback-python-contract.test.ts (dedup / routing goldens)
- server/tests/executor-callback-routing.test.ts semantics (terminal / ignoredTerminal)

plus the index.ts inline-branch apply plan (branch order, fallback chains) and
the fail-closed projection envelope.
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.executor_event_projection import (  # noqa: E402
    EXECUTOR_EVENT_TYPES,
    STATE_CHANGING_EXECUTOR_EVENT_TYPES,
    STREAMING_EXECUTOR_EVENT_TYPES,
    build_executor_apply_plan,
    is_blueprint_executor_mission_id,
    is_state_changing_executor_event,
    map_executor_event_to_action,
    normalize_executor_artifacts,
    project_executor_event,
    resolve_executor_callback_routing,
    resolve_executor_delivery_dedup,
    validate_artifact_path,
)

rng = random.Random(20260706)
NUM_RUNS = 100


def _arb_progress():
    if rng.random() < 0.5:
        return rng.randint(-500, 500)
    return rng.uniform(-1000, 1000)


def _arb_optional_text():
    if rng.random() < 0.3:
        return None
    text = "".join(rng.choice("abc XYZ-_.") for _ in range(rng.randint(1, 20)))
    return text.strip() or "fallback"


def _arb_optional_progress():
    return None if rng.random() < 0.3 else _arb_progress()


def _event(**fields):
    return {k: v for k, v in fields.items() if v is not None}


def _clamp(value):
    return max(0, min(100, value))


# ---------------------------------------------------------------------------
# Property 7a-7c: type -> action for the core lifecycle types
# ---------------------------------------------------------------------------


def test_job_started_always_maps_to_running():
    for _ in range(NUM_RUNS):
        result = map_executor_event_to_action(
            _event(
                type="job.started",
                progress=_arb_optional_progress(),
                summary=_arb_optional_text(),
                message=_arb_optional_text(),
            )
        )
        assert result["action"] == "running"


def test_job_completed_always_maps_to_done():
    for _ in range(NUM_RUNS):
        result = map_executor_event_to_action(
            _event(
                type="job.completed",
                progress=_arb_optional_progress(),
                summary=_arb_optional_text(),
                message=_arb_optional_text(),
            )
        )
        assert result["action"] == "done"


def test_job_failed_always_maps_to_failed():
    for _ in range(NUM_RUNS):
        result = map_executor_event_to_action(
            _event(
                type="job.failed",
                progress=_arb_optional_progress(),
                summary=_arb_optional_text(),
                message=_arb_optional_text(),
            )
        )
        assert result["action"] == "failed"


def test_job_cancelled_always_maps_to_cancelled():
    for _ in range(NUM_RUNS):
        result = map_executor_event_to_action(
            _event(
                type="job.cancelled",
                progress=_arb_optional_progress(),
                summary=_arb_optional_text(),
                message=_arb_optional_text(),
            )
        )
        assert result["action"] == "cancelled"


# ---------------------------------------------------------------------------
# Property 7d/7e/7g: progress clamping
# ---------------------------------------------------------------------------


def test_job_progress_clamps_progress_to_0_100():
    for _ in range(NUM_RUNS):
        progress = _arb_progress()
        result = map_executor_event_to_action(
            _event(type="job.progress", progress=progress, message=_arb_optional_text())
        )
        assert result["action"] == "progress"
        assert 0 <= result["progress"] <= 100
        assert result["progress"] == _clamp(progress)


def test_job_started_also_clamps_progress():
    for _ in range(NUM_RUNS):
        progress = _arb_progress()
        result = map_executor_event_to_action(_event(type="job.started", progress=progress))
        assert result["action"] == "running"
        assert result["progress"] == _clamp(progress)


def test_undefined_progress_defaults_to_zero():
    for event_type in ("job.started", "job.progress"):
        result = map_executor_event_to_action(_event(type=event_type, message="x"))
        assert result["progress"] == 0


def test_non_number_progress_defaults_to_zero():
    for bad in ("42", True, None, [1]):
        result = map_executor_event_to_action({"type": "job.progress", "progress": bad})
        assert result["progress"] == 0


# ---------------------------------------------------------------------------
# Property 7f: determinism (mock/real mode agnosticism)
# ---------------------------------------------------------------------------


def test_identical_inputs_produce_identical_mappings():
    core_types = ("job.started", "job.progress", "job.completed", "job.failed", "job.cancelled")
    for _ in range(NUM_RUNS):
        event = _event(
            type=rng.choice(core_types),
            progress=_arb_optional_progress(),
            summary=_arb_optional_text(),
            message=_arb_optional_text(),
        )
        assert map_executor_event_to_action(dict(event)) == map_executor_event_to_action(
            dict(event)
        )


# ---------------------------------------------------------------------------
# Property 7h + full enum: every event type -> expected action
# ---------------------------------------------------------------------------


def test_all_core_event_types_produce_non_unknown_actions():
    core_types = (
        "job.started",
        "job.progress",
        "job.completed",
        "job.failed",
        "job.cancelled",
        "job.log",
        "job.log_stream",
        "job.screenshot",
        "job.waiting",
    )
    for _ in range(NUM_RUNS):
        message = _arb_optional_text()
        result = map_executor_event_to_action(
            _event(
                type=rng.choice(core_types),
                progress=_arb_optional_progress(),
                message=message,
                log={"level": "info", "message": message or "test"},
            )
        )
        assert result["action"] != "unknown"


def test_decision_table_for_every_contract_event_type():
    """Golden decision table: event type -> action (no extra context)."""
    expected = {
        "job.accepted": "unknown",  # status fallback only
        "job.started": "running",
        "job.progress": "progress",
        "job.waiting": "waiting",
        "job.completed": "done",
        "job.failed": "failed",
        "job.cancelled": "cancelled",
        "job.log": "log",
        "job.heartbeat": "unknown",  # status fallback only
        "job.log_stream": "log_stream",
        "job.screenshot": "screenshot",
    }
    assert set(expected) == set(EXECUTOR_EVENT_TYPES)
    for event_type, action in expected.items():
        assert map_executor_event_to_action({"type": event_type})["action"] == action


def test_status_based_fallback_for_unmapped_types():
    assert map_executor_event_to_action(
        {"type": "job.heartbeat", "status": "completed", "summary": "done!"}
    ) == {"action": "done", "summary": "done!"}
    assert map_executor_event_to_action({"type": "job.heartbeat", "status": "failed"}) == {
        "action": "failed",
        "error": "unknown error",
    }
    assert map_executor_event_to_action({"type": "job.accepted", "status": "cancelled"}) == {
        "action": "cancelled",
        "reason": "cancelled",
    }
    assert map_executor_event_to_action({"type": "job.heartbeat", "status": "waiting"}) == {
        "action": "waiting"
    }
    assert map_executor_event_to_action({"type": "job.accepted", "status": "queued"}) == {
        "action": "unknown"
    }
    assert map_executor_event_to_action({"type": "totally.unknown"}) == {"action": "unknown"}


# ---------------------------------------------------------------------------
# Fallback chains (summary/detail/message, errorCode)
# ---------------------------------------------------------------------------


def test_summary_fallback_chain_summary_then_detail_then_message():
    assert map_executor_event_to_action(
        {"type": "job.completed", "summary": " s ", "detail": "d", "message": "m"}
    ) == {"action": "done", "summary": "s"}
    assert map_executor_event_to_action(
        {"type": "job.completed", "detail": " d ", "message": "m"}
    ) == {"action": "done", "summary": "d"}
    assert map_executor_event_to_action({"type": "job.completed", "message": " m "}) == {
        "action": "done",
        "summary": "m",
    }
    assert map_executor_event_to_action({"type": "job.completed"}) == {
        "action": "done",
        "summary": "",
    }


def test_failed_error_falls_back_to_error_code_then_unknown_error():
    assert map_executor_event_to_action(
        {"type": "job.failed", "errorCode": "E_BOOM"}
    ) == {"action": "failed", "error": "E_BOOM"}
    assert map_executor_event_to_action({"type": "job.failed"}) == {
        "action": "failed",
        "error": "unknown error",
    }
    # status fallback branch does NOT consult errorCode (Node parity)
    assert map_executor_event_to_action(
        {"type": "job.heartbeat", "status": "failed", "errorCode": "E_BOOM"}
    ) == {"action": "failed", "error": "unknown error"}


def test_cancelled_reason_falls_back_to_error_code_then_cancelled():
    assert map_executor_event_to_action(
        {"type": "job.cancelled", "errorCode": "E_STOP"}
    ) == {"action": "cancelled", "reason": "E_STOP"}
    assert map_executor_event_to_action({"type": "job.cancelled"}) == {
        "action": "cancelled",
        "reason": "cancelled",
    }


def test_log_message_prefers_log_payload_over_summary_text():
    assert map_executor_event_to_action(
        {"type": "job.log", "log": {"level": "info", "message": " from log "}, "message": "m"}
    ) == {"action": "log", "message": "from log"}
    assert map_executor_event_to_action({"type": "job.log", "message": " m "}) == {
        "action": "log",
        "message": "m",
    }


# ---------------------------------------------------------------------------
# Dedup verdicts (executor-callback-python-contract.test.ts goldens)
# ---------------------------------------------------------------------------

BASE_PYTHON_EVENT = {
    "version": "2026-03-28",
    "eventId": "py-evt-001",
    "missionId": "mission_python_callback_contract",
    "jobId": "job_python_callback_contract",
    "executor": "python-slide-rule",
    "type": "job.progress",
    "status": "running",
    "occurredAt": "2026-06-20T10:00:00.000Z",
    "message": "Python executor callback event",
    "progress": 42,
    "delivery": {"sequence": 1, "attempt": 1, "duplicate": False, "outOfOrder": False},
}


def test_python_progress_callback_maps_to_progress_action():
    event = {
        **BASE_PYTHON_EVENT,
        "eventId": "py-evt-progress",
        "progress": 64,
        "delivery": {"sequence": 7, "attempt": 1, "duplicate": False, "outOfOrder": False},
    }
    assert map_executor_event_to_action(event) == {"action": "progress", "progress": 64}


def test_python_success_and_error_callbacks_map_to_terminal_actions():
    success = {
        **BASE_PYTHON_EVENT,
        "type": "job.completed",
        "status": "completed",
        "progress": 100,
        "summary": "All callback work finished.",
    }
    failure = {
        **BASE_PYTHON_EVENT,
        "type": "job.failed",
        "status": "failed",
        "progress": 73,
        "detail": "Callback contract failure path.",
        "errorCode": "PY_CALLBACK_CONTRACT_FAILURE",
    }
    assert map_executor_event_to_action(success) == {
        "action": "done",
        "summary": "All callback work finished.",
    }
    assert map_executor_event_to_action(failure) == {
        "action": "failed",
        "error": "Callback contract failure path.",
    }


def test_duplicate_terminal_callback_cannot_forge_completion():
    event = {
        **BASE_PYTHON_EVENT,
        "type": "job.completed",
        "status": "completed",
        "progress": 100,
        "delivery": {"sequence": 8, "attempt": 2, "duplicate": True, "outOfOrder": False},
    }
    assert map_executor_event_to_action(event) == {"action": "duplicate", "reason": "duplicate"}


def test_out_of_order_terminal_callback_cannot_forge_completion():
    event = {
        **BASE_PYTHON_EVENT,
        "type": "job.completed",
        "status": "completed",
        "progress": 100,
        "delivery": {"sequence": 4, "attempt": 1, "duplicate": False, "outOfOrder": True},
    }
    assert map_executor_event_to_action(event) == {
        "action": "duplicate",
        "reason": "out_of_order",
    }


def test_dedup_wins_over_every_event_type():
    for event_type in EXECUTOR_EVENT_TYPES:
        result = map_executor_event_to_action(
            {"type": event_type, "delivery": {"duplicate": True}}
        )
        assert result == {"action": "duplicate", "reason": "duplicate"}


def test_non_boolean_delivery_flags_do_not_dedup():
    result = map_executor_event_to_action(
        {"type": "job.progress", "progress": 5, "delivery": {"duplicate": "yes", "outOfOrder": 1}}
    )
    assert result == {"action": "progress", "progress": 5}


# ---------------------------------------------------------------------------
# Blueprint-prefix routing + terminal/dedup routing verdicts
# ---------------------------------------------------------------------------


def test_blueprint_mission_id_prefixes():
    assert is_blueprint_executor_mission_id("blueprint:abc")
    assert is_blueprint_executor_mission_id("blueprint-job-2de22800-3b5f-403e-9089-5949cf0271f8")
    assert is_blueprint_executor_mission_id("  blueprint:padded  ")
    assert not is_blueprint_executor_mission_id("mission-blueprint:abc")
    assert not is_blueprint_executor_mission_id("blueprintjob-1")
    assert not is_blueprint_executor_mission_id("")
    assert not is_blueprint_executor_mission_id(None)


def test_blueprint_callback_routing_golden():
    event = {
        **BASE_PYTHON_EVENT,
        "missionId": "blueprint-job-2de22800-3b5f-403e-9089-5949cf0271f8",
        "eventId": "py-evt-blueprint",
        "callbackSource": "python",
    }
    assert resolve_executor_callback_routing(event) == {
        "route": "blueprint",
        "missionId": "blueprint-job-2de22800-3b5f-403e-9089-5949cf0271f8",
        "jobId": "job_python_callback_contract",
        "eventId": "py-evt-blueprint",
        "callbackSource": "python",
        "terminal": False,
        "ignoredTerminal": False,
    }


def test_routing_terminal_detection_by_type_and_status():
    for event_type in ("job.completed", "job.failed", "job.cancelled"):
        routing = resolve_executor_callback_routing(
            {"missionId": "m", "jobId": "j", "eventId": "e", "type": event_type}
        )
        assert routing["terminal"] is True
        assert routing["ignoredTerminal"] is False
    for status in ("completed", "failed", "cancelled"):
        routing = resolve_executor_callback_routing(
            {"missionId": "m", "jobId": "j", "eventId": "e", "type": "job.heartbeat", "status": status}
        )
        assert routing["terminal"] is True
    routing = resolve_executor_callback_routing(
        {"missionId": "m", "jobId": "j", "eventId": "e", "type": "job.progress", "status": "running"}
    )
    assert routing["terminal"] is False


def test_routing_ignored_terminal_for_duplicate_and_out_of_order():
    for delivery in ({"duplicate": True}, {"outOfOrder": True}):
        routing = resolve_executor_callback_routing(
            {
                "missionId": " m ",
                "jobId": " j ",
                "eventId": " e ",
                "type": "job.completed",
                "delivery": delivery,
            }
        )
        assert routing["ignoredTerminal"] is True
        assert routing["missionId"] == "m"
        assert routing["jobId"] == "j"
        assert routing["eventId"] == "e"
        assert routing["callbackSource"] == "node"


# ---------------------------------------------------------------------------
# State-changing predicate (delegation contract)
# ---------------------------------------------------------------------------


def test_state_changing_predicate_matches_delegated_set():
    for event_type in STATE_CHANGING_EXECUTOR_EVENT_TYPES:
        assert is_state_changing_executor_event(event_type)
    for event_type in STREAMING_EXECUTOR_EVENT_TYPES:
        assert not is_state_changing_executor_event(event_type)
        # Streaming stays inline even with a terminal status.
        assert not is_state_changing_executor_event(event_type, "completed")
    assert is_state_changing_executor_event("job.heartbeat", "completed")
    assert is_state_changing_executor_event("job.accepted", "waiting")
    assert not is_state_changing_executor_event("job.accepted")
    assert not is_state_changing_executor_event("job.heartbeat", "running")


# ---------------------------------------------------------------------------
# Apply plan (index.ts inline branch chain parity)
# ---------------------------------------------------------------------------

MISSION = {"currentProgress": 37, "stageLabel": "执行"}


def test_apply_plan_started_and_progress_mark_running():
    for event_type in ("job.started", "job.progress"):
        plan = build_executor_apply_plan(
            {"type": event_type, "progress": 150, "detail": "d"}, MISSION
        )
        assert plan["kind"] == "running"
        assert plan["progress"] == 100
        assert plan["detail"] == "d"
        assert plan["stateChanging"] is True
        assert plan["resetHeartbeat"] is True
        assert plan["clearHeartbeat"] is False


def test_apply_plan_progress_falls_back_to_current_mission_progress():
    plan = build_executor_apply_plan({"type": "job.progress"}, MISSION)
    assert plan["progress"] == 37
    plan = build_executor_apply_plan({"type": "job.progress"}, None)
    assert plan["progress"] == 0


def test_apply_plan_detail_fallback_chain():
    plan = build_executor_apply_plan({"type": "job.started", "message": " m "}, MISSION)
    assert plan["detail"] == "m"
    plan = build_executor_apply_plan({"type": "job.started"}, MISSION)
    assert plan["detail"] == "Executor event at 执行"
    plan = build_executor_apply_plan({"type": "job.started"}, {})
    assert plan["detail"] == "Executor event at execute"


def test_apply_plan_waiting_branch_and_waiting_for_fallback():
    plan = build_executor_apply_plan(
        {"type": "job.waiting", "waitingFor": " approval ", "detail": "d"}, MISSION
    )
    assert plan["kind"] == "waiting"
    assert plan["waitingFor"] == "approval"
    assert plan["clearHeartbeat"] is False
    plan = build_executor_apply_plan({"type": "job.waiting", "detail": "d"}, MISSION)
    assert plan["waitingFor"] == "d"


def test_apply_plan_inline_branch_order_waiting_beats_completed():
    # index.ts checks the waiting branch before the completed branch:
    # status "waiting" wins even when type is job.completed? No — type
    # job.completed matches the waiting branch only via status. Mirror:
    plan = build_executor_apply_plan(
        {"type": "job.heartbeat", "status": "waiting", "summary": "s"}, MISSION
    )
    assert plan["kind"] == "waiting"
    # job.completed + status waiting: inline waiting branch (status) fires first.
    plan = build_executor_apply_plan(
        {"type": "job.completed", "status": "waiting", "summary": "s"}, MISSION
    )
    assert plan["kind"] == "waiting"


def test_apply_plan_terminal_branches_clear_heartbeat():
    done = build_executor_apply_plan(
        {"type": "job.completed", "summary": " s ", "detail": "d"}, MISSION
    )
    assert done["kind"] == "done"
    assert done["message"] == "s"
    assert done["clearHeartbeat"] is True

    failed = build_executor_apply_plan({"type": "job.failed", "detail": "boom"}, MISSION)
    assert failed["kind"] == "failed"
    assert failed["error"] == "boom"
    assert failed["clearHeartbeat"] is True

    cancelled = build_executor_apply_plan({"type": "job.cancelled", "summary": "stop"}, MISSION)
    assert cancelled["kind"] == "cancelled"
    assert cancelled["reason"] == "stop"
    assert cancelled["clearHeartbeat"] is True


def test_apply_plan_inline_order_type_failed_with_status_cancelled_cancels():
    # Node inline branch: (type failed|cancelled or status failed|cancelled)
    # then cancel when type cancelled OR status cancelled.
    plan = build_executor_apply_plan(
        {"type": "job.failed", "status": "cancelled", "detail": "d"}, MISSION
    )
    assert plan["kind"] == "cancelled"
    assert plan["reason"] == "d"


def test_apply_plan_streaming_kinds_are_not_state_changing():
    log = build_executor_apply_plan(
        {"type": "job.log", "log": {"level": "warn", "message": " w "}}, MISSION
    )
    assert log["kind"] == "log"
    assert log["message"] == "w"
    assert log["level"] == "warn"
    assert log["stateChanging"] is False
    assert build_executor_apply_plan({"type": "job.log_stream"}, MISSION)["kind"] == "log_stream"
    assert build_executor_apply_plan({"type": "job.screenshot"}, MISSION)["kind"] == "screenshot"


def test_apply_plan_unknown_type_falls_back_to_running():
    plan = build_executor_apply_plan({"type": "job.heartbeat"}, MISSION)
    assert plan["kind"] == "running"
    assert plan["progress"] == 37


def test_apply_plan_ignores_delivery_envelope_like_the_inline_route():
    plan = build_executor_apply_plan(
        {"type": "job.completed", "summary": "s", "delivery": {"duplicate": True}}, MISSION
    )
    assert plan["kind"] == "done"  # inline route never dedups


# ---------------------------------------------------------------------------
# Projection envelope (fail-closed)
# ---------------------------------------------------------------------------

VALID_EVENT = {
    "missionId": "mission-1",
    "jobId": "job-1",
    "eventId": "evt-1",
    "type": "job.completed",
    "summary": "done",
}


def test_project_executor_event_success_envelope():
    envelope = project_executor_event(dict(VALID_EVENT), MISSION)
    assert envelope["ok"] is True
    assert envelope["source"] == "python"
    assert envelope["provenance"] == "python-executor-event-projection"
    assert envelope["missionId"] == "mission-1"
    assert envelope["jobId"] == "job-1"
    assert envelope["eventId"] == "evt-1"
    assert envelope["stateChanging"] is True
    assert envelope["action"] == {"action": "done", "summary": "done"}
    assert envelope["routing"]["route"] == "mission"
    assert envelope["routing"]["terminal"] is True
    assert envelope["apply"]["kind"] == "done"
    assert envelope["apply"]["clearHeartbeat"] is True


def test_project_executor_event_fail_closed_on_malformed_payloads():
    for bad in (None, "x", 5, []):
        envelope = project_executor_event(bad, MISSION)
        assert envelope["ok"] is False
        assert envelope["source"] == "python"
        assert "apply" not in envelope
    for missing in ("missionId", "jobId", "eventId", "type"):
        event = dict(VALID_EVENT)
        del event[missing]
        envelope = project_executor_event(event, MISSION)
        assert envelope["ok"] is False
        assert missing in envelope["error"]
        # Blank strings fail-closed too.
        event = dict(VALID_EVENT)
        event[missing] = "   "
        assert project_executor_event(event, MISSION)["ok"] is False


# ---------------------------------------------------------------------------
# Slice 2: dedup verdict (first-class envelope field)
# ---------------------------------------------------------------------------


def test_dedup_verdict_mirrors_the_mapper_delivery_checks():
    assert resolve_executor_delivery_dedup({}) == {"duplicate": False}
    assert resolve_executor_delivery_dedup({"delivery": {"duplicate": True}}) == {
        "duplicate": True,
        "reason": "duplicate",
    }
    assert resolve_executor_delivery_dedup({"delivery": {"outOfOrder": True}}) == {
        "duplicate": True,
        "reason": "out_of_order",
    }
    # duplicate wins over outOfOrder, matching the mapper branch order.
    assert resolve_executor_delivery_dedup(
        {"delivery": {"duplicate": True, "outOfOrder": True}}
    ) == {"duplicate": True, "reason": "duplicate"}
    # Truthy-but-not-True values do not trigger (JS === true).
    assert resolve_executor_delivery_dedup({"delivery": {"duplicate": 1}}) == {
        "duplicate": False
    }


def test_projection_envelope_carries_dedup_verdict():
    envelope = project_executor_event(
        {**VALID_EVENT, "delivery": {"duplicate": True}}, MISSION
    )
    assert envelope["dedup"] == {"duplicate": True, "reason": "duplicate"}
    assert envelope["action"] == {"action": "duplicate", "reason": "duplicate"}
    # The apply plan still mirrors the inline route (which never dedups).
    assert envelope["apply"]["kind"] == "done"

    envelope = project_executor_event(dict(VALID_EVENT), MISSION)
    assert envelope["dedup"] == {"duplicate": False}


# ---------------------------------------------------------------------------
# Slice 2: artifacts normalization (index.ts normalizeExecutorArtifacts +
# artifact-utils.ts validateArtifactPath)
# ---------------------------------------------------------------------------


def test_validate_artifact_path_rejects_any_dotdot():
    assert validate_artifact_path("reports/out.json")
    assert not validate_artifact_path("../secrets")
    assert not validate_artifact_path("a/../../b")
    assert not validate_artifact_path("..\\windows\\style")
    assert not validate_artifact_path("weird..name")  # Node is this strict too


def test_normalize_artifacts_non_array_returns_none():
    assert normalize_executor_artifacts(None) is None
    assert normalize_executor_artifacts({"kind": "file"}) is None
    assert normalize_executor_artifacts("nope") is None


def test_normalize_artifacts_field_trimming_and_filtering():
    normalized = normalize_executor_artifacts(
        [
            {
                "kind": "file",
                "id": " a1 ",
                "name": "  report.json  ",
                "path": " out/report.json ",
                "url": "",
                "mimeType": " application/json ",
                "previewType": "json",
                "size": 128,
                "description": " the report ",
            },
            {"kind": "hologram", "name": "bad kind"},
            {"kind": "file", "name": "   "},
            "not-an-object",
            {"kind": "log", "name": "run.log", "size": -5},
            {"kind": "url", "name": "link", "url": " http://x ", "previewType": "nope"},
        ]
    )
    assert normalized == [
        {
            "kind": "file",
            "name": "report.json",
            "id": "a1",
            "path": "out/report.json",
            "mimeType": "application/json",
            "previewType": "json",
            "size": 128,
            "description": "the report",
        },
        {"kind": "log", "name": "run.log"},
        {"kind": "url", "name": "link", "url": "http://x"},
    ]


def test_normalize_artifacts_drops_path_traversal_payloads():
    normalized = normalize_executor_artifacts(
        [
            {"kind": "file", "name": "evil", "path": "../../etc/passwd"},
            {"kind": "file", "name": "evil-win", "path": "..\\..\\secret"},
            {"kind": "file", "name": "evil-nested", "path": "ok/../../../etc/shadow"},
            {"kind": "file", "name": "good", "path": "artifacts/out.txt"},
        ]
    )
    assert normalized == [{"kind": "file", "name": "good", "path": "artifacts/out.txt"}]


def test_projection_envelope_artifacts_key_only_when_delivery_carries_array():
    envelope = project_executor_event(dict(VALID_EVENT), MISSION)
    assert "artifacts" not in envelope

    envelope = project_executor_event(
        {**VALID_EVENT, "artifacts": [{"kind": "file", "name": "a", "path": "x.txt"}]},
        MISSION,
    )
    assert envelope["artifacts"] == [{"kind": "file", "name": "a", "path": "x.txt"}]

    # All entries rejected -> explicit empty list (Node seam maps it to
    # "keep current artifacts" instead of falling back to raw event data).
    envelope = project_executor_event(
        {**VALID_EVENT, "artifacts": [{"kind": "file", "name": "e", "path": "../x"}]},
        MISSION,
    )
    assert envelope["artifacts"] == []
