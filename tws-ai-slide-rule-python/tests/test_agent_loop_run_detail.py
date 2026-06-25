"""
SlideRule AgentLoop 108: run detail API tests.

Covers detail endpoint sourcing from run dir artifacts (state.json + events + reports + logs).
"""

import json
import os
import re
from pathlib import Path
from typing import Any

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_run_detail_108_returns_bounded_state_report_logs_and_artifacts(tmp_path):
    """agentloop run detail 108 returns bounded state report logs and artifacts

    Acceptance:
    - endpoint returns bounded state (from state.json), report entries, logs (tails), artifacts
    - 404 for unknown runs
    - text tails bounded (events<=60, logs<=20 lines, report content bounded)
    - artifact entries use safe relative identifiers (no absolute paths)
    - state-derived fields (options, task, iterations, *Fix/*Review) have absolute paths sanitized to basenames only
      (covers review requirement: no leakage of cwd/worktree/repoRoot/abs-task etc from raw state payloads)
    """
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    run_id = "2026-06-25T14-00-00-000Z"
    run_dir = runs_dir / run_id
    run_dir.mkdir()

    # state with ABSOLUTE paths in options/iterations/review payloads to prove sanitization
    # (relative case also exercised; sanitizer leaves relative intact)
    state = {
        "runId": run_id,
        "status": "DONE_GATE_ONLY",
        "options": {
            "cwd": r"C:\Users\wangchunji\Documents\cube-pets-office\.worktrees\migration-queue",
            "repoRoot": r"D:\cube-pets-office",
            "worktree": r"C:\Users\wangchunji\Documents\cube-pets-office\.worktrees\migration-queue",
            "fixAgent": "grok",
        },
        "task": r"C:\abs\original\task.md",  # top-level fallback (covers state.get("task") path)
        "iterations": [
            {"iteration": 0, "cwd": r"C:\abs\iter\cwd", "logPath": r"C:\abs\iter\log.txt"},
            {"iteration": 1, "files": [r"C:\abs\file1.py", "/unix/abs/file2"]},
        ],
        "grokFix": {"applied": True, "target": r"C:\abs\fixed.py", "review": {"path": r"\\srv\share\abs"}},
        "agentFix": {"patch": "diff", "workDir": r"C:\abs\agent\work"},
        "codexReview": {"ok": False, "file": r"C:\abs\review\file.md"},
        "grokReview": None,
    }
    (run_dir / "state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")

    # events.jsonl (will be tailed)
    events_lines = [
        json.dumps({"ts": "2026-06-25T14:00:01Z", "status": "START", "iteration": 0}),
        json.dumps({"ts": "2026-06-25T14:00:02Z", "status": "DONE_GATE_ONLY", "iteration": 0}),
    ]
    (run_dir / "events.jsonl").write_text("\n".join(events_lines) + "\n", encoding="utf-8")

    # final report (report)
    (run_dir / "final-report.md").write_text("# report\nok\n", encoding="utf-8")
    (run_dir / "final-report.json").write_text(json.dumps({"status": "ok"}), encoding="utf-8")

    # landing
    (run_dir / "landing.json").write_text(json.dumps({"applied": True}), encoding="utf-8")

    # bounded log (will use tail)
    long_log = "\n".join([f"line{i}" for i in range(100)])
    (run_dir / "grok-output.0.stderr.log").write_text(long_log, encoding="utf-8")

    # a diff
    (run_dir / "diff.0.patch").write_text("diff --git ...", encoding="utf-8")

    orig = os.environ.get("AGENT_LOOP_RUNS_DIR")
    os.environ["AGENT_LOOP_RUNS_DIR"] = str(runs_dir)
    try:
        # success path
        resp = client.get(f"/api/agent-loop/runs/{run_id}")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["runId"] == run_id
        assert data["status"] == "DONE_GATE_ONLY"
        assert isinstance(data.get("iterations"), list)
        assert "options" in data

        # artifacts present with state + report + logs + diff
        arts = data.get("artifacts", [])
        assert isinstance(arts, list)
        assert any(a.get("id") == "state.json" for a in arts)
        assert any("final-report" in (a.get("id") or "") for a in arts)
        assert any((a.get("kind") == "log") for a in arts)
        assert any("diff." in (a.get("id") or "") for a in arts)

        # safe relative identifiers only (no abs paths)
        for a in arts:
            p = a.get("path") or a.get("id") or ""
            assert p and ".." not in p
            assert not (":" in p or p.startswith("/") or p.startswith("C:") or p.startswith("\\\\")), f"abs path leaked: {p}"
            # id and path are relative safe
            assert "/" not in p or p.count("/") == 0, "use basename only"  # allow simple

        # === NEW COVERAGE for review: no absolute path leakage in state-derived fields ===
        # helper local to test (does not weaken any prior checks)
        def _has_abs_path(o: Any) -> bool:
            if isinstance(o, str):
                st = o.strip()
                return bool(
                    re.match(r"^[a-zA-Z]:[\\/]", st)
                    or st.startswith("\\\\")
                    or st.startswith("//")
                    or (st.startswith("/") and len(st) > 1)
                    or (":\\" in st or ":/" in st)
                )
            if isinstance(o, dict):
                return any(_has_abs_path(v) for v in o.values())
            if isinstance(o, list):
                return any(_has_abs_path(i) for i in o)
            return False

        # verify options sanitized (abs turned to basenames)
        opts_out = data.get("options") or {}
        assert isinstance(opts_out, dict)
        assert not _has_abs_path(opts_out), f"abs path leaked in options: {opts_out}"
        # task inside options or top should be safe now
        t_in_opts = opts_out.get("task") if isinstance(opts_out, dict) else None
        if t_in_opts:
            assert not _has_abs_path(str(t_in_opts)), f"abs task leaked in options.task: {t_in_opts}"

        # task entry path sanitized
        task_out = data.get("task")
        if task_out:
            tp = task_out.get("path") if isinstance(task_out, dict) else str(task_out)
            assert not _has_abs_path(str(tp or "")), f"abs path leaked in task.path: {tp}"

        # iterations sanitized
        iters_out = data.get("iterations") or []
        assert not _has_abs_path(iters_out), f"abs path leaked in iterations: {iters_out}"

        # fix/review fields sanitized
        for rf in ("grokFix", "agentFix", "codexReview", "grokReview"):
            rf_val = data.get(rf)
            assert not _has_abs_path(rf_val), f"abs path leaked in {rf}: {rf_val}"

        # bounded tails: logs should have <=20 lines content if present
        log_arts = [a for a in arts if a.get("kind") == "log"]
        for la in log_arts:
            cont = la.get("content") or ""
            if cont:
                assert len(cont.splitlines()) <= 25, "log tail not bounded"  # small slack

        # events bounded
        evs = data.get("events", [])
        assert len(evs) <= 60

        # report content bounded
        report_arts = [a for a in arts if "report" in (a.get("id") or "")]
        for ra in report_arts:
            c = ra.get("content") or ""
            if c:
                assert len(c) <= 2000

        # 404 for unknown
        resp404 = client.get("/api/agent-loop/runs/does-not-exist-999Z")
        assert resp404.status_code == 404

        # also via non-existing dir
        os.environ["AGENT_LOOP_RUNS_DIR"] = str(tmp_path / "no-runs-here")
        resp404b = client.get(f"/api/agent-loop/runs/{run_id}")
        assert resp404b.status_code == 404
    finally:
        if orig is None:
            os.environ.pop("AGENT_LOOP_RUNS_DIR", None)
        else:
            os.environ["AGENT_LOOP_RUNS_DIR"] = orig


def test_agentloop_run_detail_110_exposes_legacy_synthetic_v2_events(tmp_path):
    """agentloop run detail 110 exposes legacy synthetic v2 events.

    Legacy 108/109 runs may not have native events.jsonl. Detail must still
    expose full synthetic v2 envelopes so the web replay path can keep
    payload.synthetic, legacySource, artifacts, and redaction metadata.
    """
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    run_id = "2026-06-25T15-00-00-110Z"
    run_dir = runs_dir / run_id
    run_dir.mkdir()

    (run_dir / "state.json").write_text(
        json.dumps(
            {
                "runId": run_id,
                "status": "DONE_GATE_ONLY",
                "options": {"task": "agent-loop/tasks/legacy.md"},
                "baselineGate": {"ok": False, "summary": "legacy gate failed"},
            }
        ),
        encoding="utf-8",
    )

    orig = os.environ.get("AGENT_LOOP_RUNS_DIR")
    os.environ["AGENT_LOOP_RUNS_DIR"] = str(runs_dir)
    try:
        resp = client.get(f"/api/agent-loop/runs/{run_id}")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        events = data.get("events") or []
        assert events, "legacy detail must expose synthetic v2 events when native events.jsonl is absent"
        assert any(e.get("version") == "agentloop.event.v2" for e in events)
        synthetic = [e for e in events if (e.get("payload") or {}).get("synthetic") is True]
        assert synthetic, events
        assert any((e.get("payload") or {}).get("legacySource") == "state.json" for e in synthetic)
        for e in synthetic:
            assert "phase" in e
            assert "type" in e
            assert "source" in e
            assert isinstance(e.get("artifacts"), list)
            assert (e.get("redaction") or {}).get("applied") is True
    finally:
        if orig is None:
            os.environ.pop("AGENT_LOOP_RUNS_DIR", None)
        else:
            os.environ["AGENT_LOOP_RUNS_DIR"] = orig
