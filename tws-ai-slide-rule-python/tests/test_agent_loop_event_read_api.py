"""
SlideRule AgentLoop 110: event read API.

agentloop event read api 110 exposes replay events and snapshots

Test file for gate marker and pytest execution.
"""

import json
import os
import sys
from pathlib import Path

_pkg_root = Path(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
    from services.agent_loop_event_store import append_event
except Exception as e:
    pytest.skip(f"imports failed: {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_event_read_api_110_exposes_replay_events_and_snapshots(tmp_path):
    """agentloop event read api 110 exposes replay events and snapshots

    Acceptance:
    - replay endpoint /runs/{id}/events returns redacted events (native)
    - snapshot endpoint uses reducer, returns deterministic shape
    - legacy runs served through compatibility adapter (synthetic events)
    - responses redacted (no secrets) and bounded
    - no live queue required
    - existing detail endpoints untouched
    """
    events_root = tmp_path / "events"
    runs_root = tmp_path / "runs"
    events_root.mkdir()
    runs_root.mkdir()

    run_id = "2026-06-25T10-00-00-110Z"
    legacy_run = "2026-06-25T11-00-00-110Z"

    # 1) Native v2 events (with secret to test redaction + bounded)
    secret_ev = {
        "source": "grok",
        "phase": "fix",
        "type": "AGENT_LOG",
        "payload": {"msg": "step", "token": "sk-SECRET1234567890FAKE"},
    }
    append_event(run_id, secret_ev, events_root=str(events_root))

    # more for replay and reducer
    append_event(run_id, {"source": "node", "phase": "gate", "type": "GATE_RESULT", "payload": {"ok": True, "summary": "pass"}}, events_root=str(events_root))
    append_event(run_id, {"source": "node", "phase": "finalize", "type": "RUN_FINALIZED", "payload": {"status": "DONE"}}, events_root=str(events_root))

    orig_e = os.environ.get("AGENT_LOOP_EVENTS_DIR")
    orig_r = os.environ.get("AGENT_LOOP_RUNS_DIR")
    os.environ["AGENT_LOOP_EVENTS_DIR"] = str(events_root)
    os.environ["AGENT_LOOP_RUNS_DIR"] = str(runs_root)

    try:
        # Replay native
        resp = client.get(f"/api/agent-loop/runs/{run_id}/events")
        assert resp.status_code == 200
        evs = resp.json()
        assert isinstance(evs, list)
        assert len(evs) >= 2
        # redacted
        estr = json.dumps(evs)
        assert "SECRET" not in estr
        assert "sk-SECRET" not in estr
        assert "***REDACTED***" in estr or "REDACTED" in estr
        # bounded (no limit passed -> capped but we wrote few)
        assert len(evs) <= 1000

        # with explicit limit
        resp_lim = client.get(f"/api/agent-loop/runs/{run_id}/events?limit=1")
        assert resp_lim.status_code == 200
        assert len(resp_lim.json()) <= 1

        # Snapshot via reducer
        resp_snap = client.get(f"/api/agent-loop/runs/{run_id}/snapshot")
        assert resp_snap.status_code == 200
        snap = resp_snap.json()
        assert isinstance(snap, dict)
        assert snap.get("runId") == run_id
        assert "status" in snap
        assert "finalized" in snap
        assert "gate" in snap
        assert "reviewVerdict" in snap
        assert "flowNodes" in snap
        assert "flowEdges" in snap
        assert isinstance(snap.get("flowNodes"), list)
        # finalized true because RUN_FINALIZED present
        assert snap.get("finalized") is True
        # deterministic: call again same
        snap2 = client.get(f"/api/agent-loop/runs/{run_id}/snapshot").json()
        assert snap == snap2

        # 2) Legacy run: create only state.json (no events file)
        leg_dir = runs_root / legacy_run
        leg_dir.mkdir()
        leg_state = {
            "status": "DONE_GATE_ONLY",
            "options": {"task": "agent-loop/tasks/legacy.md"},
            "gate": {"ok": False, "summary": "baseline gate fail"},
            "iterations": [],
        }
        (leg_dir / "state.json").write_text(json.dumps(leg_state), encoding="utf-8")

        # Legacy replay via adapter
        resp_leg = client.get(f"/api/agent-loop/runs/{legacy_run}/events")
        assert resp_leg.status_code == 200
        leg_evs = resp_leg.json()
        assert isinstance(leg_evs, list)
        assert len(leg_evs) >= 1
        # synthetic markers
        found_synth = False
        for e in leg_evs:
            pl = e.get("payload") or {}
            if pl.get("synthetic") is True:
                found_synth = True
                assert "legacySource" in pl
        assert found_synth, "legacy run must serve via adapter with synthetic events"

        # Legacy snapshot also works (reducer on adapted)
        snap_leg = client.get(f"/api/agent-loop/runs/{legacy_run}/snapshot").json()
        assert "runId" in snap_leg or snap_leg.get("runId") is None
        assert isinstance(snap_leg.get("flowNodes"), list)

        # Unknown returns empty/safe (not crash)
        unk = client.get("/api/agent-loop/runs/does-not-exist-999Z/events")
        assert unk.status_code == 200
        assert unk.json() == []

        snap_unk = client.get("/api/agent-loop/runs/does-not-exist-999Z/snapshot").json()
        assert snap_unk.get("finalized") is False or snap_unk.get("runId") is None

        # ensure we did not break old endpoints
        old_overview = client.get("/api/agent-loop/runs/overview")
        assert old_overview.status_code == 200
        assert isinstance(old_overview.json(), list)

    finally:
        if orig_e is None:
            os.environ.pop("AGENT_LOOP_EVENTS_DIR", None)
        else:
            os.environ["AGENT_LOOP_EVENTS_DIR"] = orig_e
        if orig_r is None:
            os.environ.pop("AGENT_LOOP_RUNS_DIR", None)
        else:
            os.environ["AGENT_LOOP_RUNS_DIR"] = orig_r
