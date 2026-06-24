import pytest

# Import after ensuring package path; tests run from tws-ai-slide-rule-python
from services.task_scheduler_runtime_takeover import (
    compute_mission_scheduler_decision,
    decide_on_replay,
)


def test_python_computes_scheduler_decision_for_realistic_mission():
    """Python computes a scheduler decision for a realistic mission state."""
    realistic_mission_state = {
        "id": "m-104-retry",
        "status": "failed",
        "retries": 1,
        "max_retries": 5,
        "cancelled": False,
        "last_error": "transient",
        "payload": {"type": "ingest", "priority": "high"},
    }
    decision = compute_mission_scheduler_decision(realistic_mission_state)
    assert isinstance(decision, dict)
    assert decision.get("owner") == "python-slice"
    assert decision.get("decision") in {"retry", "cancelled", "continue", "complete"}
    # Denominator evidence: slice, not full ownership
    assert "slice" in decision.get("note", "") or decision.get("denominator") == "decision-slice"


def test_cancel_retry_replay_interactions():
    """Tests for cancel/retry/replay interactions in the Python decision slice."""
    # cancel case
    cancel_state = {"status": "running", "cancelled": True, "retries": 0}
    d = compute_mission_scheduler_decision(cancel_state)
    assert d["decision"] == "cancelled"
    assert "node retains" in d.get("note", "")

    # retry case
    retry_state = {"status": "failed", "retries": 2, "max_retries": 5, "cancelled": False}
    d = compute_mission_scheduler_decision(retry_state)
    assert d["decision"] == "retry"
    assert d.get("retries") == 3

    # replay interaction
    replay_state = {"status": "running", "id": "m-replay"}
    r = decide_on_replay(replay_state, {"type": "replay_event", "seq": 42})
    assert r["decision"] == "replay_safe"
    assert r.get("owner") == "python-slice"


def test_retained_scheduler_responsibilities_named():
    """Retained scheduler responsibilities are explicitly named (denominator)."""
    decision = compute_mission_scheduler_decision({"status": "pending"})
    note = decision.get("note", "")
    # Evidence that this is slice only
    assert "node retains" in note or "full scheduler" in note.lower() or decision.get("denominator") == "decision-slice-only"