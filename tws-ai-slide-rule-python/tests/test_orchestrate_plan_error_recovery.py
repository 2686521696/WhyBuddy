import os
import sys
import time

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402
from sliderule_llm.client import LlmError  # noqa: E402


client = TestClient(app, raise_server_exceptions=False)
INTERNAL_KEY = "dev-slide-rule-internal"


def _valid_payload() -> dict:
    return {
        "state": {
            "sessionId": "orch-error-recovery",
            "goal": {"text": "Plan one migration boundary slice"},
            "artifacts": [],
            "capabilityRuns": [],
        },
        "turnId": "turn-orch-error",
        "userText": "plan the next migration capability",
    }


def _post_plan(payload: dict) -> tuple[int, dict]:
    response = client.post(
        "/api/sliderule/orchestrate-plan",
        json=payload,
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    return response.status_code, response.json()


def test_orchestrate_plan_bad_input_returns_explicit_bad_input():
    status, body = _post_plan({"turnId": "turn-bad-input", "userText": "missing state"})

    assert status == 400
    assert body["error"] == "invalid_request"
    assert body["reason"] == "bad_input"
    assert "state" in body["message"]


def test_orchestrate_plan_planner_exception_is_runtime_error_not_no_api_key(monkeypatch):
    def raise_planner_error(state, turn_id, user_text):
        raise RuntimeError("planner exploded while ranking candidates")

    monkeypatch.setattr("routes.sliderule_full.orchestrate_plan", raise_planner_error)

    status, body = _post_plan(_valid_payload())

    assert status == 200
    assert body["degraded"] is True
    assert body["error"] == "planner_error"
    assert body["reason"] == "runtime_error"
    assert body["fallbackAvailable"] is False
    assert body["selected"] == []
    assert body["source"] == "python-rag"
    assert body["reason"] != "no_api_key"


def test_orchestrate_plan_config_missing_stays_separate_from_runtime_error(monkeypatch):
    def raise_config_missing(state, turn_id, user_text):
        raise LlmError("LLM not configured (no api_key)", transient=False)

    monkeypatch.setattr("routes.sliderule_full.orchestrate_plan", raise_config_missing)

    status, body = _post_plan(_valid_payload())

    assert status == 200
    assert body["degraded"] is True
    assert body["error"] == "planner_config_missing"
    assert body["reason"] == "config_missing"
    assert body["fallbackAvailable"] is False


def test_orchestrate_plan_timeout_returns_degraded_timeout(monkeypatch):
    monkeypatch.setenv("SLIDERULE_ORCHESTRATE_PLAN_TIMEOUT_MS", "1")

    def slow_planner(state, turn_id, user_text):
        time.sleep(0.05)
        raise AssertionError("timeout should return before planner finishes")

    monkeypatch.setattr("routes.sliderule_full.orchestrate_plan", slow_planner)

    status, body = _post_plan(_valid_payload())

    assert status == 200
    assert body["degraded"] is True
    assert body["error"] == "planner_timeout"
    assert body["reason"] == "timeout"
    assert body["fallbackAvailable"] is False
    assert body["selected"] == []
