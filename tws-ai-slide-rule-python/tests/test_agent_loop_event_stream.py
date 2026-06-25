"""
SlideRule AgentLoop 108: event stream API tests.

Covers normalized event snapshots and SSE frame formatting.
Stream helpers are exercised with finite generators only.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

try:
    from services.agent_loop_events import (
        build_event_snapshot,
        format_sse_frame,
        iter_agent_loop_sse_frames,
    )
except Exception as e:
    pytest.skip(f"services.agent_loop_events import failed: {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_event_stream_108_formats_state_changes_as_sse_frames(tmp_path):
    """agentloop event stream 108 formats state changes as sse frames

    Acceptance:
    - snapshots include status, phase, updatedAt, activeAgent, latestGateSummary (when present)
    - frames use event: and data: lines containing JSON
    - code tested via finite generator (no infinite, no long sleeps)
    """
    # state change 1: initial
    state1 = {"status": "START", "phase": "init", "activeAgentLog": {"agent": "grok"}}
    snap1 = build_event_snapshot(state1)
    assert "status" in snap1
    assert "phase" in snap1
    assert "updatedAt" in snap1
    assert "activeAgent" in snap1
    assert "latestGateSummary" in snap1
    assert snap1["status"] == "START"
    assert snap1["activeAgent"] == "grok"

    # state change 2: with gate
    state2 = {
        "status": "RUNNING",
        "phase": "gate",
        "updatedAt": "2026-06-25T14:01:00Z",
        "activeAgent": "codex",
        "iterations": [{"iteration": 0}, {"gate": {"ok": False, "failureCount": 1}}],
    }
    snap2 = build_event_snapshot(state2)
    assert snap2["status"] == "RUNNING"
    assert snap2["phase"] == "gate"
    assert snap2["updatedAt"] == "2026-06-25T14:01:00Z"
    assert snap2["activeAgent"] == "codex"
    assert snap2["latestGateSummary"] is not None
    assert snap2["latestGateSummary"].get("ok") is False

    # state without gate summary -> latestGateSummary may be falsy but key present
    snap_no_gate = build_event_snapshot({"status": "DONE"})
    assert "latestGateSummary" in snap_no_gate

    # format single frame
    frame = format_sse_frame("state", snap1)
    assert frame.startswith("event: state")
    assert "data: " in frame
    assert "\n\n" in frame
    # data must be valid json
    data_line = [ln for ln in frame.splitlines() if ln.startswith("data: ")][0]
    payload = json.loads(data_line[len("data: "):])
    assert payload["status"] == "START"

    # use finite generator for multiple state changes
    frames = list(iter_agent_loop_sse_frames([state1, state2, {"status": "DONE_GATE_ONLY"}]))
    assert len(frames) == 3
    for f in frames:
        assert "event: " in f
        assert "data: " in f
        # each data is json object
        dln = [ln for ln in f.splitlines() if ln.startswith("data: ")][0]
        json.loads(dln[len("data: "):])

    # direct snapshot pass-through in iterator
    direct = {"status": "x", "phase": "y", "updatedAt": "t", "activeAgent": "a", "latestGateSummary": None}
    frames2 = list(iter_agent_loop_sse_frames([direct]))
    assert len(frames2) == 1
    assert "event: state" in frames2[0]

    # === route coverage: exercise /runs/{run_id}/events/stream + get_agent_loop_run_detail returning model ===
    # this proves snapshot populated from real detail (status + iterations gate) not empty dict path
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    run_id = "2026-06-25T16-00-00-000Z"
    run_dir = runs_dir / run_id
    run_dir.mkdir()
    state = {
        "status": "RUNNING",
        "phase": "exec",  # present in raw state (though detail top-level may vary)
        "updatedAt": "2026-06-25T16:00:05Z",
        "activeAgent": "grok",
        "iterations": [
            {"iteration": 0},
            {"iteration": 1, "gate": {"ok": True, "failureCount": 0, "summary": "pass"}}
        ],
    }
    (run_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")

    orig = os.environ.get("AGENT_LOOP_RUNS_DIR")
    os.environ["AGENT_LOOP_RUNS_DIR"] = str(runs_dir)
    try:
        resp = client.get(f"/api/agent-loop/runs/{run_id}/events/stream")
        assert resp.status_code == 200
        text = resp.text
        assert "event: state" in text
        assert "data: " in text
        assert "\n\n" in text
        # find and parse the data payload
        data_lines = [ln for ln in text.splitlines() if ln.startswith("data: ")]
        assert len(data_lines) >= 1
        payload = json.loads(data_lines[0][len("data: "):])
        # required snapshot fields present
        assert "status" in payload
        assert "phase" in payload
        assert "updatedAt" in payload
        assert "activeAgent" in payload
        assert "latestGateSummary" in payload
        # values driven from the detail (status + gate from iterations)
        assert payload["status"] == "RUNNING"
        assert payload.get("latestGateSummary") is not None
        assert payload.get("latestGateSummary", {}).get("ok") is True
        # also test unknown run path (still produces frame with nulls, finite)
        resp_unknown = client.get("/api/agent-loop/runs/does-not-exist-404Z/events/stream")
        assert resp_unknown.status_code == 200
        utext = resp_unknown.text
        assert "event: state" in utext
        udlines = [ln for ln in utext.splitlines() if ln.startswith("data: ")]
        upayload = json.loads(udlines[0][len("data: "):])
        assert "status" in upayload
        assert "latestGateSummary" in upayload
    finally:
        if orig is None:
            os.environ.pop("AGENT_LOOP_RUNS_DIR", None)
        else:
            os.environ["AGENT_LOOP_RUNS_DIR"] = orig
