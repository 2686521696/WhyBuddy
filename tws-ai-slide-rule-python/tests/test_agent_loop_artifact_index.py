"""
SlideRule AgentLoop 110: artifact index

Covers stable event-referenced artifact metadata.
"""

import json
import os
from pathlib import Path

import pytest

# Direct imports (services first, fallback for isolated runs)
try:
    from services.agent_loop_artifacts import (
        list_agent_loop_artifacts,
        get_active_log_artifact,
    )
except Exception:
    from agent_loop_artifacts import (  # type: ignore
        list_agent_loop_artifacts,
        get_active_log_artifact,
    )

try:
    from services.agent_loop_redaction import redact_sensitive
except Exception:
    from agent_loop_redaction import redact_sensitive  # type: ignore


def test_agentloop_artifact_index_110_exposes_stable_event_referenced_artifacts(tmp_path):
    """agentloop artifact index 110 exposes stable event referenced artifacts

    Acceptance:
    - Artifact ids are stable across repeated reads.
    - Artifacts include kind, safe name, size, and optional event reference.
    - Active log selection can use explicit event references when present.
    - Secret-like output is redacted.
    """
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    run_id = "2026-06-25T14-00-00-000Z"
    run_dir = runs_dir / run_id
    run_dir.mkdir()

    # state
    state = {"status": "DONE_FIXED", "runId": run_id, "options": {"task": "task.md"}, "iterations": []}
    (run_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")

    # reports
    (run_dir / "final-report.json").write_text(json.dumps({"ok": True}), encoding="utf-8")
    (run_dir / "final-report.md").write_text("# done\n", encoding="utf-8")

    # diff
    (run_dir / "diff.0.patch").write_text("diff --git a/b b/b\n", encoding="utf-8")

    # two logs: one will be event-referenced
    log1 = "grok-output.0.stderr.log"
    log2 = "agent-output.1.stdout.log"
    long_log_secret = "line1\nOPENAI_API_KEY=sk-REALSECRET123\nline3\n"
    (run_dir / log1).write_text(long_log_secret, encoding="utf-8")
    (run_dir / log2).write_text("normal log output here\n", encoding="utf-8")

    # events.jsonl with ARTIFACT_INDEXED and AGENT_LOG referencing one log explicitly (for event ref + active selection)
    events = [
        json.dumps({"ts": "2026-06-25T14:00:10Z", "seq": 5, "source": "grok", "phase": "fix", "type": "AGENT_LOG", "status": "LOG", "payload": {"logFile": log1}}),
        json.dumps({"ts": "2026-06-25T14:00:11Z", "seq": 6, "source": "grok", "phase": "fix", "type": "ARTIFACT_INDEXED", "payload": {"id": log1, "kind": "log"}}),
        # log2 intentionally NOT referenced by event, to verify prefer event-ref over name order
    ]
    (run_dir / "events.jsonl").write_text("\n".join(events) + "\n", encoding="utf-8")

    # point env
    orig = os.environ.get("AGENT_LOOP_RUNS_DIR")
    os.environ["AGENT_LOOP_RUNS_DIR"] = str(runs_dir)
    try:
        arts1 = list_agent_loop_artifacts(run_id)
        arts2 = list_agent_loop_artifacts(run_id)

        # ids stable across repeated reads
        ids1 = [a.id for a in arts1]
        ids2 = [a.id for a in arts2]
        assert ids1 == ids2, "artifact ids must be stable across repeated reads"
        assert len(ids1) >= 4  # state + reports + diff + logs at least

        # must include expected
        id_set = set(ids1)
        assert "state.json" in id_set
        assert "final-report.json" in id_set
        assert "diff.0.patch" in id_set
        assert log1 in id_set
        assert log2 in id_set

        # each has kind, safe name (title or id), size (in metadata), optional eventRef
        for a in arts1:
            assert isinstance(a.id, str) and a.id
            assert isinstance(a.kind, str) and a.kind
            # safe name via title or id
            safe_name = a.title or a.id
            assert isinstance(safe_name, str) and safe_name
            # size present in metadata
            meta = getattr(a, "metadata", {}) or {}
            assert "size" in meta, f"missing size for {a.id}"
            assert isinstance(meta["size"], int) and meta["size"] >= 0
            # eventRef optional (some will have)
            if "eventRef" in meta:
                assert meta["eventRef"] is not None

        # at least one has eventRef (from the indexed log)
        has_event_ref = any( (getattr(a, "metadata", {}) or {}).get("eventRef") for a in arts1 )
        assert has_event_ref, "expected at least one artifact with event reference"

        # Active log selection uses explicit event references when present
        active = get_active_log_artifact(run_id)
        assert active is not None
        assert active.kind == "log"
        # must pick the explicitly referenced one (log1), not the other even if "newer" name wise
        assert active.id == log1, f"active log should prefer event ref; got {active.id}"

        # Secret-like output is redacted (via reuse of central redaction on any secret samples)
        secret_samples = [
            "sk-REALSECRET123",
            "OPENAI_API_KEY=sk-REALSECRET123",
        ]
        for s in secret_samples:
            red = redact_sensitive(s)
            assert s not in red
            assert "***REDACTED***" in red or red != s

        # also ensure no secret leaks into artifact metadata (names/refs only)
        for a in arts1:
            meta = getattr(a, "metadata", {}) or {}
            dumped = json.dumps(meta)
            assert "sk-REALSECRET123" not in dumped
            assert "REALSECRET" not in dumped

    finally:
        if orig is None:
            os.environ.pop("AGENT_LOOP_RUNS_DIR", None)
        else:
            os.environ["AGENT_LOOP_RUNS_DIR"] = orig
