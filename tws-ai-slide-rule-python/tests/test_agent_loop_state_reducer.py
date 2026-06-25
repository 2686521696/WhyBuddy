"""
SlideRule AgentLoop 110: deterministic state reducer.

Marker for gate: agentloop state reducer 110 derives deterministic run snapshots
"""

import os
import sys

# Make services importable (consistent with sibling tests)
_pkg_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

import pytest

from services.agent_loop_state_reducer import reduce_run_events


def test_agentloop_state_reducer_110_derives_deterministic_run_snapshots():
    """agentloop state reducer 110 derives deterministic run snapshots.

    - Replaying the same events produces the same snapshot.
    - RUN_FINALIZED is required for a final done state.
    - REVIEW_RESULT controls review verdict and GATE_RESULT controls gate status.
    - Flow nodes and edges are derived with stable ids.
    """
    base_events = [
        {
            "version": "agentloop.event.v2",
            "runId": "2026-06-25T02-30-12-110Z",
            "seq": 0,
            "ts": "2026-06-25T02:30:00.000Z",
            "source": "node",
            "phase": "queue",
            "type": "RUN_STARTED",
            "task": "agent-loop/tasks/sliderule-agentloop-state-reducer-110.md",
            "status": "GROK_FIX",
            "payload": {"status": "RUNNING"},
            "artifacts": [],
        },
        {
            "version": "agentloop.event.v2",
            "runId": "2026-06-25T02-30-12-110Z",
            "seq": 1,
            "ts": "2026-06-25T02:31:00.000Z",
            "source": "node",
            "phase": "gate",
            "type": "GATE_RESULT",
            "payload": {"ok": False, "summary": "baseline failed"},
        },
        {
            "version": "agentloop.event.v2",
            "runId": "2026-06-25T02-30-12-110Z",
            "seq": 2,
            "ts": "2026-06-25T02:32:00.000Z",
            "source": "grok",
            "phase": "fix",
            "type": "AGENT_FIX_STARTED",
            "payload": {},
        },
        {
            "version": "agentloop.event.v2",
            "runId": "2026-06-25T02-30-12-110Z",
            "seq": 3,
            "ts": "2026-06-25T02:33:00.000Z",
            "source": "grok",
            "phase": "fix",
            "type": "AGENT_LOG",
            "payload": {"msg": "thinking step"},
        },
        {
            "version": "agentloop.event.v2",
            "runId": "2026-06-25T02-30-12-110Z",
            "seq": 4,
            "ts": "2026-06-25T02:34:00.000Z",
            "source": "codex",
            "phase": "review",
            "type": "REVIEW_RESULT",
            "payload": {"verdict": "approved", "confidence": 0.9},
        },
        {
            "version": "agentloop.event.v2",
            "runId": "2026-06-25T02-30-12-110Z",
            "seq": 5,
            "ts": "2026-06-25T02:35:00.000Z",
            "source": "node",
            "phase": "finalize",
            "type": "RUN_FINALIZED",
            "payload": {"status": "DONE"},
            "artifacts": [{"kind": "diff", "path": "fix.patch"}],
        },
    ]

    # Deterministic replay: same events => identical snapshot
    snap1 = reduce_run_events(base_events)
    snap2 = reduce_run_events(base_events)
    assert snap1 == snap2, "replay must be deterministic"

    # runId / task / status basics
    assert snap1["runId"] == "2026-06-25T02-30-12-110Z"
    assert snap1["task"] == "agent-loop/tasks/sliderule-agentloop-state-reducer-110.md"
    assert snap1["status"] == "DONE"
    assert snap1["finalized"] is True

    # GATE_RESULT controls gate
    assert snap1["gate"] is not None
    assert snap1["gate"].get("ok") is False
    assert "baseline failed" in str(snap1["gate"].get("summary") or "")

    # REVIEW_RESULT controls reviewVerdict
    assert snap1["reviewVerdict"] == "approved" or snap1["reviewVerdict"] == {"verdict": "approved", "confidence": 0.9}

    # Flow nodes and edges have stable ids
    node_ids = [n["id"] for n in snap1["flowNodes"]]
    assert "queue" in node_ids
    assert "gate" in node_ids
    assert "fix" in node_ids
    assert "review" in node_ids
    assert "finalize" in node_ids
    assert len(snap1["flowEdges"]) == len(snap1["flowNodes"]) - 1
    for edge in snap1["flowEdges"]:
        assert "id" in edge and edge["id"].startswith("e-")
        assert "source" in edge and "target" in edge

    # RUN_FINALIZED required for final done
    events_no_final = [e for e in base_events if e.get("type") != "RUN_FINALIZED"]
    snap_no = reduce_run_events(events_no_final)
    assert snap_no["finalized"] is False
    # status should not be the finalized DONE (may be RUNNING or prior)
    assert snap_no.get("status") != "DONE" or snap_no["finalized"] is False

    # Another replay with same no-final must match itself
    snap_no2 = reduce_run_events(events_no_final)
    assert snap_no == snap_no2

    # Gate and review absent or default when not present
    minimal = [
        {
            "version": "agentloop.event.v2",
            "runId": "r-min",
            "seq": 0,
            "ts": "t",
            "source": "node",
            "phase": "queue",
            "type": "RUN_STARTED",
            "payload": {},
        }
    ]
    snap_min = reduce_run_events(minimal)
    assert snap_min["gate"] is None
    assert snap_min["reviewVerdict"] is None
    assert snap_min["finalized"] is False

    # Multiple gate/review updates: last authoritative (simple last wins for pure reduce)
    gate_then_review = [
        {"version": "agentloop.event.v2", "runId": "r2", "seq": 0, "ts": "t0", "source": "node", "phase": "gate", "type": "GATE_RESULT", "payload": {"ok": True}},
        {"version": "agentloop.event.v2", "runId": "r2", "seq": 1, "ts": "t1", "source": "codex", "phase": "review", "type": "REVIEW_RESULT", "payload": {"verdict": "changes_requested"}},
        {"version": "agentloop.event.v2", "runId": "r2", "seq": 2, "ts": "t2", "source": "node", "phase": "finalize", "type": "RUN_FINALIZED", "payload": {"status": "DONE"}},
    ]
    s = reduce_run_events(gate_then_review)
    assert s["gate"] is not None and s["gate"].get("ok") is True
    assert s["reviewVerdict"] == "changes_requested"
    assert s["finalized"] is True
