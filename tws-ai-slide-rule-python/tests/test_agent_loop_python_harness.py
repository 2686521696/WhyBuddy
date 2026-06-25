"""
SlideRule AgentLoop 109: Python test harness rescue.

Provides deterministic, portable fixtures for run state, reports, logs,
artifacts, settings, and redaction tests. Usable without live workers
or .agent-loop/runs state.
"""

import json
import os
import sys
from pathlib import Path

import pytest

# Portable path resolution for Windows + pytest isolation
_HERE = Path(__file__).resolve().parent
FIXTURE_ROOT = _HERE / "fixtures" / "agent_loop_run"


def _load_fixture_json(name: str):
    p = FIXTURE_ROOT / name
    if not p.exists():
        raise FileNotFoundError(f"fixture missing: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def _load_fixture_text(name: str) -> str:
    p = FIXTURE_ROOT / name
    if not p.exists():
        raise FileNotFoundError(f"fixture missing: {p}")
    return p.read_text(encoding="utf-8")


# Direct imports with fallbacks so test runs standalone via pytest <thisfile>
try:
    from models.agent_loop import (
        AgentLoopArtifact,
        AgentLoopRunDetail,
        AgentLoopRunSummary,
    )
except Exception:
    from agent_loop import (  # type: ignore
        AgentLoopArtifact,
        AgentLoopRunDetail,
        AgentLoopRunSummary,
    )

try:
    from services.agent_loop_redaction import redact_sensitive
except Exception:
    from agent_loop_redaction import redact_sensitive  # type: ignore


def test_agentloop_python_harness_109_provides_deterministic_run_fixtures():
    """agentloop python harness 109 provides deterministic run fixtures

    Covers:
    - done, failed, running, no-diff, artifact, and redacted-secret cases
    - reusable fixtures under tests/fixtures/agent_loop_run/
    - fixture helper paths use pathlib (portable on Windows)
    - loads without .agent-loop/runs or live services
    - redaction applied to secret-containing fixture
    - model validation roundtrips on fixture payloads
    """
    # Ensure fixture root exists (portable)
    assert FIXTURE_ROOT.exists(), f"fixture root missing: {FIXTURE_ROOT}"
    assert FIXTURE_ROOT.is_dir()

    # done case
    done = _load_fixture_json("state-done.json")
    assert done.get("status") == "DONE_GATE_ONLY"
    assert "task" in str(done.get("options", {})) or done.get("options", {}).get("task")
    s = AgentLoopRunSummary.model_validate(
        {
            "runId": done.get("runId", "2026-06-25T12-00-00-000Z"),
            "status": done.get("status"),
            "task": done.get("options", {}).get("task"),
            "iterations": 0,
        }
    )
    assert s.status == "DONE_GATE_ONLY"

    # failed case
    failed = _load_fixture_json("state-failed.json")
    assert failed.get("status") == "HALT_BUDGET"
    assert len(failed.get("iterations", [])) > 0

    # running case
    running = _load_fixture_json("state-running.json")
    assert running.get("status") == "RUNNING"
    assert len(running.get("iterations", [])) >= 1

    # no-diff case
    nodiff = _load_fixture_json("state-no-diff.json")
    assert nodiff.get("status") == "DONE_REVIEWED_NO_DIFF"

    # artifact case
    art = _load_fixture_json("artifact-sample.json")
    a = AgentLoopArtifact.model_validate(art)
    assert a.id == "final-report.json"
    assert a.kind == "report"

    # redacted-secret case (raw fixture has secrets; redaction removes them)
    secret_text = _load_fixture_text("secret-fixture.txt")
    assert "sk-abc123def456SECRET" in secret_text  # raw has secret
    assert "proxysecretpass" in secret_text
    red = redact_sensitive(secret_text)
    assert "sk-abc123def456SECRET" not in red
    assert "proxysecretpass" not in red
    assert "***REDACTED***" in red
    # ids preserved
    assert "2026-06-25T09-00-00-000Z" in red
    assert "sliderule-agentloop-python-tests-109.md" in red

    # all fixtures are small and text (no binaries)
    for name in ("state-done.json", "state-failed.json", "state-running.json", "state-no-diff.json", "artifact-sample.json", "secret-fixture.txt"):
        p = FIXTURE_ROOT / name
        assert p.exists()
        assert p.stat().st_size < 4096

    # helper paths portable (no hardcoded os.sep assumptions beyond pathlib)
    assert str(FIXTURE_ROOT).endswith("agent_loop_run") or "agent_loop_run" in str(FIXTURE_ROOT)
    # can be joined cross platform
    assert (FIXTURE_ROOT / "state-done.json").exists()


# also expose a tiny helper for other harness users (importable)
def get_agent_loop_fixture_path(name: str) -> Path:
    """Return portable Path to named fixture under agent_loop_run/."""
    return FIXTURE_ROOT / name


def load_agent_loop_run_state(case: str) -> dict:
    """Return deterministic state fixture for case in {done,failed,running,no-diff}."""
    mapping = {
        "done": "state-done.json",
        "failed": "state-failed.json",
        "running": "state-running.json",
        "no-diff": "state-no-diff.json",
        "artifact": "artifact-sample.json",
    }
    fname = mapping.get(case)
    if not fname:
        raise KeyError(f"unknown fixture case: {case}")
    return _load_fixture_json(fname)
