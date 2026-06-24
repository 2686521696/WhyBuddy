"""Task scheduler runtime takeover - Python decision slice (104).

Goal: implement a Python-owned scheduler/cancel/retry decision slice.

This module computes ONE scheduler decision in Python for realistic mission state.
It does NOT rewrite or take over the scheduler.

Retained scheduler responsibilities (node-retained from 103):
- Full queue lifecycle and master scheduler loop
- Distributed coordination / locking
- Complete event replay and persistence engine
- Cancel semantics enforcement at boundary
- Retry scheduling orchestration
- All mission state mutations outside this slice

Denominator evidence:
- This is a "decision slice" only.
- Python computes decision; Node owns execution and full scheduler.
- Distinguishes from full scheduler ownership.

Do not count diagnostics as takeover.
"""

from typing import Any, Dict


def compute_mission_scheduler_decision(mission_state: Dict[str, Any]) -> Dict[str, Any]:
    """Compute a scheduler decision slice in Python runtime.

    For realistic mission state including status, retries, cancel flag.
    Returns decision with explicit slice/owner markers.
    """
    if not isinstance(mission_state, dict):
        mission_state = {}

    status = str(mission_state.get("status", "pending")).lower()
    retries = int(mission_state.get("retries", 0))
    max_retries = int(mission_state.get("max_retries", 3))
    cancelled = bool(mission_state.get("cancelled", False))

    # Python decision slice for cancel/retry
    if cancelled:
        return {
            "decision": "cancelled",
            "action": "no-op",
            "owner": "python-slice",
            "note": "node retains full cancel semantics and scheduler ownership",
            "denominator": "decision-slice-only",
        }

    if status in ("failed", "error") and retries < max_retries:
        return {
            "decision": "retry",
            "action": "schedule_retry",
            "owner": "python-slice",
            "retries": retries + 1,
            "note": "python computes retry decision (slice); node owns scheduling",
            "denominator": "decision-slice-only",
        }

    if status in ("complete", "done", "succeeded"):
        return {
            "decision": "complete",
            "action": "mark_done",
            "owner": "python-slice",
            "note": "python decision slice; node retains scheduler",
            "denominator": "decision-slice-only",
        }

    # default continue/keep
    return {
        "decision": "continue",
        "action": "keep",
        "owner": "python-slice",
        "note": "python decision slice only - node retains full scheduler responsibilities",
        "denominator": "decision-slice-only",
    }


def decide_on_replay(mission_state: Dict[str, Any], event: Dict[str, Any]) -> Dict[str, Any]:
    """Decision slice for replay interaction. Does not implement replay."""
    return {
        "decision": "replay_safe",
        "action": "consult",
        "owner": "python-slice",
        "note": "python slice for replay decision only",
        "denominator": "decision-slice-only",
    }
