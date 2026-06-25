"""
SlideRule AgentLoop 110: legacy event adapter.

Marker: agentloop legacy event adapter 110 converts 108 and 109 artifacts to v2 events
"""

import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.agent_loop_event_schema import validate_event_envelope  # noqa: E402
from services.agent_loop_legacy_adapter import read_legacy_events  # noqa: E402
from services.agent_loop_state_reducer import reduce_run_events  # noqa: E402


def _has_abs_path(obj: Any) -> bool:
    if isinstance(obj, str):
        text = obj.strip()
        return (
            text.startswith("/")
            or text.startswith("\\\\")
            or text.startswith("//")
            or (len(text) > 2 and text[1:3] in (":\\", ":/"))
            or ":\\" in text
            or ":/" in text
        )
    if isinstance(obj, dict):
        return any(_has_abs_path(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_abs_path(v) for v in obj)
    return False


def test_agentloop_legacy_event_adapter_110_converts_108_and_109_artifacts_to_v2_events(tmp_path):
    """agentloop legacy event adapter 110 converts 108 and 109 artifacts to v2 events.

    Covers legacy state, final reports, reviews, diffs, and bounded logs.
    Corrupt artifacts degrade safely and all output remains synthetic/redacted.
    """
    runs_root = tmp_path / "runs"
    runs_root.mkdir()
    run_id = "2026-06-25T16-00-00-110Z"
    run_dir = runs_root / run_id
    run_dir.mkdir()

    (run_dir / "state.json").write_text(
        json.dumps(
            {
                "runId": run_id,
                "status": "DONE_REVIEWED",
                "options": {
                    "task": r"C:\Users\me\repo\agent-loop\tasks\legacy.md",
                    "cwd": r"C:\Users\me\repo\.worktrees\migration-queue",
                    "token": "sk-state-secret-123456",
                },
                "baselineGate": {
                    "ok": False,
                    "summary": r"gate failed in C:\Users\me\repo\secret.log",
                },
                "codexReview": {"verdict": "pass"},
            }
        ),
        encoding="utf-8",
    )
    (run_dir / "final-report.json").write_text(
        json.dumps({"status": "DONE_REVIEWED", "path": r"C:\Users\me\repo\final-report.json"}),
        encoding="utf-8",
    )
    (run_dir / "codex-review.json").write_text(
        json.dumps({"verdict": "pass", "message": "token=sk-review-secret-123456"}),
        encoding="utf-8",
    )
    (run_dir / "diff.1.patch").write_text(
        "diff --git a/service.py b/service.py\n+print('ok')\n",
        encoding="utf-8",
    )
    huge_log = "BEGIN-OF-FILE-SHOULD-NOT-BE-READ\n" + ("old line\n" * 6000) + "tail line with OPENAI_API_KEY=sk-log-secret-123456\n"
    (run_dir / "grok-output.1.stderr.log").write_text(huge_log, encoding="utf-8")
    (run_dir / "broken-review.json").write_text("{not-json", encoding="utf-8")

    events = read_legacy_events(run_id, runs_root=str(runs_root), limit=100)
    assert events
    for event in events:
        validate_event_envelope(event)
        payload = event.get("payload") or {}
        assert payload.get("synthetic") is True
        assert payload.get("legacySource")
        assert (event.get("redaction") or {}).get("applied") is True

    event_types = {event["type"] for event in events}
    assert "RUN_STARTED" in event_types
    assert "GATE_RESULT" in event_types
    assert "REVIEW_RESULT" in event_types
    assert "ARTIFACT_INDEXED" in event_types
    assert "AGENT_LOG" in event_types
    assert "RUN_FINALIZED" in event_types

    dumped = json.dumps(events)
    assert "sk-state-secret" not in dumped
    assert "sk-review-secret" not in dumped
    assert "sk-log-secret" not in dumped
    assert "BEGIN-OF-FILE-SHOULD-NOT-BE-READ" not in dumped
    assert "tail line" in dumped
    assert not _has_abs_path(events)

    sources = {(event.get("payload") or {}).get("legacySource") for event in events}
    assert "state.json" in sources
    assert "final-report.json" in sources
    assert "codex-review.json" in sources
    assert "diff.1.patch" in sources
    assert "grok-output.1.stderr.log" in sources
    assert "broken-review.json" in sources

    snapshot = reduce_run_events(events)
    assert snapshot["runId"] == run_id
    assert snapshot["finalized"] is True
    assert isinstance(snapshot["flowNodes"], list)
