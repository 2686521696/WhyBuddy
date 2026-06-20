from __future__ import annotations

from copy import deepcopy


CONTRACT_VERSION = "2026-03-28"
BASE_EVENT = {
    "version": CONTRACT_VERSION,
    "eventId": "py-evt-001",
    "missionId": "mission_python_callback_contract",
    "jobId": "job_python_callback_contract",
    "executor": "python-slide-rule",
    "type": "job.progress",
    "status": "running",
    "occurredAt": "2026-06-20T10:00:00.000Z",
    "message": "Python executor callback event",
    "progress": 42,
    "delivery": {
        "sequence": 1,
        "attempt": 1,
        "duplicate": False,
        "outOfOrder": False,
    },
}


def callback_event(**overrides: object) -> dict[str, object]:
    event = deepcopy(BASE_EVENT)
    event.update(overrides)
    return event


def assert_required_callback_shape(event: dict[str, object]) -> None:
    assert event["version"] == CONTRACT_VERSION
    assert isinstance(event["eventId"], str) and event["eventId"]
    assert isinstance(event["missionId"], str) and event["missionId"]
    assert isinstance(event["jobId"], str) and event["jobId"]
    assert isinstance(event["executor"], str) and event["executor"]
    assert isinstance(event["occurredAt"], str) and event["occurredAt"]
    assert event["type"] in {
        "job.started",
        "job.progress",
        "job.completed",
        "job.failed",
        "job.cancelled",
        "job.waiting",
        "job.log",
    }
    assert event["status"] in {
        "queued",
        "running",
        "waiting",
        "completed",
        "failed",
        "cancelled",
    }
    assert isinstance(event["message"], str)


def test_python_callback_success_event_contract() -> None:
    event = callback_event(
        eventId="py-evt-success",
        type="job.completed",
        status="completed",
        progress=100,
        message="Python executor completed",
        summary="All callback work finished.",
        artifacts=[
            {
                "kind": "report",
                "name": "executor-callback-summary.md",
                "path": "artifacts/executor-callback-summary.md",
            }
        ],
    )

    assert_required_callback_shape(event)
    assert event["type"] == "job.completed"
    assert event["status"] == "completed"
    assert event["progress"] == 100
    assert event["summary"] == "All callback work finished."


def test_python_callback_progress_event_contract() -> None:
    event = callback_event(
        eventId="py-evt-progress",
        type="job.progress",
        status="running",
        progress=64,
        message="Python executor is still running",
        delivery={
            "sequence": 7,
            "attempt": 1,
            "duplicate": False,
            "outOfOrder": False,
        },
    )

    assert_required_callback_shape(event)
    assert event["type"] == "job.progress"
    assert event["status"] == "running"
    assert event["progress"] == 64
    assert event["delivery"] == {
        "sequence": 7,
        "attempt": 1,
        "duplicate": False,
        "outOfOrder": False,
    }


def test_python_callback_error_event_contract() -> None:
    event = callback_event(
        eventId="py-evt-error",
        type="job.failed",
        status="failed",
        progress=73,
        message="Python executor failed",
        detail="Callback contract failure path.",
        errorCode="PY_CALLBACK_CONTRACT_FAILURE",
    )

    assert_required_callback_shape(event)
    assert event["type"] == "job.failed"
    assert event["status"] == "failed"
    assert event["errorCode"] == "PY_CALLBACK_CONTRACT_FAILURE"
    assert event["detail"] == "Callback contract failure path."


def test_python_callback_duplicate_event_contract_is_non_terminal() -> None:
    event = callback_event(
        eventId="py-evt-progress",
        type="job.completed",
        status="completed",
        progress=100,
        message="Duplicate terminal callback replay",
        delivery={
            "sequence": 8,
            "attempt": 2,
            "duplicate": True,
            "outOfOrder": False,
        },
    )

    assert_required_callback_shape(event)
    delivery = event["delivery"]
    assert isinstance(delivery, dict)
    assert delivery["duplicate"] is True
    assert delivery["attempt"] == 2
    assert event["type"] == "job.completed"
    assert event["status"] == "completed"
    assert delivery["duplicate"] is True


def test_python_callback_out_of_order_event_contract_is_explicit() -> None:
    event = callback_event(
        eventId="py-evt-late-progress",
        type="job.progress",
        status="running",
        progress=55,
        message="Late progress callback",
        delivery={
            "sequence": 4,
            "attempt": 1,
            "duplicate": False,
            "outOfOrder": True,
        },
    )

    assert_required_callback_shape(event)
    delivery = event["delivery"]
    assert isinstance(delivery, dict)
    assert delivery["duplicate"] is False
    assert delivery["outOfOrder"] is True
    assert event["type"] == "job.progress"
    assert event["status"] == "running"
