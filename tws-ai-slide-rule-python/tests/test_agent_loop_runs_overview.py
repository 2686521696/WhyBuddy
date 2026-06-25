"""
SlideRule AgentLoop 108: runs overview API tests.

Covers listing run summaries sourced from .agent-loop/runs/*/state.json files.
"""

import json
import os
from pathlib import Path

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_runs_overview_108_lists_run_summaries_from_state_files(tmp_path):
    """agentloop runs overview 108 lists run summaries from state files

    - returns stable summaries sorted newest first
    - missing or empty run directories return empty list (no error)
    - corrupt run records are reported as degraded items without breaking the response
    """
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    # Newest good run (DONE_GATE_ONLY)
    run_new = runs_dir / "2026-06-25T14-00-00-000Z"
    run_new.mkdir()
    state_new = {
        "runId": "2026-06-25T14-00-00-000Z",
        "status": "DONE_GATE_ONLY",
        "options": {"task": "agent-loop/tasks/sliderule-agentloop-runs-overview-api-108.md", "fixAgent": "grok"},
        "iterations": [],
        "grokFix": None,
        "agentFix": None,
        "codexReview": None,
        "grokReview": None,
    }
    (run_new / "state.json").write_text(json.dumps(state_new, indent=2), encoding="utf-8")

    # Older good run
    run_old = runs_dir / "2026-06-25T10-00-00-000Z"
    run_old.mkdir()
    state_old = {
        "runId": "2026-06-25T10-00-00-000Z",
        "status": "DONE_FIXED",
        "options": {"task": "agent-loop/tasks/example.md", "fixAgent": "grok"},
        "iterations": [{"iteration": 0}],
        "grokFix": {"exitCode": 0},
        "agentFix": None,
        "codexReview": None,
        "grokReview": None,
    }
    (run_old / "state.json").write_text(json.dumps(state_old, indent=2), encoding="utf-8")

    # Corrupt (bad JSON) - must appear as degraded but not break list
    run_bad = runs_dir / "2026-06-25T12-00-00-000Z"
    run_bad.mkdir()
    (run_bad / "state.json").write_text("{ this is not valid json : true ", encoding="utf-8")

    # Point service at our temp runs (via env the impl will honor)
    orig = os.environ.get("AGENT_LOOP_RUNS_DIR")
    os.environ["AGENT_LOOP_RUNS_DIR"] = str(runs_dir)
    try:
        resp = client.get("/api/agent-loop/runs/overview")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 3

        # newest first by runId timestamp
        assert data[0]["runId"] == "2026-06-25T14-00-00-000Z"
        assert data[1]["runId"] == "2026-06-25T12-00-00-000Z"
        assert data[2]["runId"] == "2026-06-25T10-00-00-000Z"

        # corrupt reported as degraded, response intact
        bad = data[1]
        assert bad["status"] == "degraded"
        meta = bad.get("metadata", {})
        assert meta.get("degraded") is True or "degraded" in str(bad).lower()

        # good items have expected fields from state
        assert data[0]["status"] == "DONE_GATE_ONLY"
        assert data[2]["status"] == "DONE_FIXED"
        assert "runMode" in data[0]
        assert isinstance(data[0].get("iterations"), int)
        assert "grokRan" in data[0]

        # empty dir -> []
        empty_dir = tmp_path / "empty-runs"
        empty_dir.mkdir()
        os.environ["AGENT_LOOP_RUNS_DIR"] = str(empty_dir)
        resp_empty = client.get("/api/agent-loop/runs/overview")
        assert resp_empty.status_code == 200
        assert resp_empty.json() == []

        # missing dir -> []
        os.environ["AGENT_LOOP_RUNS_DIR"] = str(tmp_path / "does-not-exist-xyz123")
        resp_missing = client.get("/api/agent-loop/runs/overview")
        assert resp_missing.status_code == 200
        assert resp_missing.json() == []
    finally:
        if orig is None:
            os.environ.pop("AGENT_LOOP_RUNS_DIR", None)
        else:
            os.environ["AGENT_LOOP_RUNS_DIR"] = orig
