"""
SlideRule AgentLoop 110: append-only event store.

Events under documented event root only (via paths), appends are redacted JSONL,
monotonic seq per run, order preserved, redaction on persist and readback.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

# Make services importable (matches other tests)
_pkg_root = Path(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

import pytest

from services.agent_loop_event_store import append_event, read_events
from services.agent_loop_paths import get_agent_loop_events_root, resolve_event_log_path


def test_agentloop_event_store_110_appends_redacted_jsonl_events():
    """agentloop event store 110 appends redacted jsonl events.

    - Creates test under documented event root override only.
    - Appends preserve order, assign monotonic seq (0,1,...).
    - Payloads containing secrets are redacted before write and on readback.
    - Rejects user-supplied absolute paths (no escape).
    - Does not touch state.json or runs layout.
    """
    with tempfile.TemporaryDirectory() as tmp:
        event_root = str(Path(tmp) / "events-root")

        run_id = "2026-06-25T10-00-00-110Z"

        # basic append assigns seq
        e0 = {
            "version": "agentloop.event.v2",
            "runId": run_id,
            "seq": None,
            "ts": "2026-06-25T10:00:00.000Z",
            "source": "python",
            "phase": "fix",
            "type": "AGENT_LOG",
            "payload": {"msg": "start", "token": "sk-FAKE1234567890ABC"},
        }
        written0 = append_event(run_id, e0, events_root=event_root)
        assert written0 is not None
        assert written0["seq"] == 0
        assert written0["redaction"].get("applied") is True
        # secret redacted in returned
        assert "FAKE" not in str(written0["payload"])
        assert "***REDACTED***" in str(written0["payload"]) or "REDACTED" in str(written0)

        # second append gets seq 1, order
        e1 = {
            "source": "grok",
            "phase": "fix",
            "type": "AGENT_LOG",
            "payload": {"msg": "step2", "token": "sk-XYZREDACTTEST890"},
        }
        written1 = append_event(run_id, e1, events_root=event_root)
        assert written1 is not None
        assert written1["seq"] == 1
        assert written1["runId"] == run_id

        # read back
        events = read_events(run_id, events_root=event_root)
        assert len(events) == 2
        assert events[0]["seq"] == 0
        assert events[1]["seq"] == 1
        # readback also redacted
        assert "XYZ" not in str(events[1]["payload"])
        assert "secret" not in str(events[1]["payload"]).lower() or "***" in str(events[1])

        # explicit seq assign path: continue monotonic
        e2 = {"phase": "gate", "type": "GATE_RESULT", "payload": {"ok": True}}
        written2 = append_event(run_id, e2, events_root=event_root, assign_seq=True)
        assert written2["seq"] == 2

        # bad seq validation when not assigning
        e_bad = {"phase": "fix", "type": "AGENT_LOG", "seq": 99, "payload": {}}
        bad = append_event(run_id, e_bad, events_root=event_root, assign_seq=False)
        assert bad is None  # validation reject

        # key-name redaction coverage (review case: fields like password/token with plain non-pattern values)
        e_key = {
            "phase": "fix",
            "type": "AGENT_LOG",
            "payload": {"password": "hunter2", "token": "plain-token", "api_key": "abc123", "msg": "ok"},
        }
        written_key = append_event(run_id, e_key, events_root=event_root, assign_seq=True)
        assert written_key is not None
        assert written_key["seq"] == 3
        pstr = str(written_key.get("payload", {}))
        assert "hunter2" not in pstr
        assert "plain-token" not in pstr
        assert "abc123" not in pstr
        assert "***REDACTED***" in pstr or "REDACTED" in pstr

        # file exists under event root only
        log_p = resolve_event_log_path(run_id, event_root)
        assert log_p is not None
        assert log_p.exists()
        assert str(log_p).startswith(str(Path(event_root).resolve()))
        content = log_p.read_text(encoding="utf-8")
        assert "agentloop.event.v2" in content
        # raw secret must not be persisted
        assert "sk-FAKE" not in content
        assert "secret-value-XYZ" not in content
        assert "hunter2" not in content
        assert "plain-token" not in content
        assert "abc123" not in content

        # order preserved in file lines
        lines = [ln for ln in content.splitlines() if ln.strip()]
        assert len(lines) == 4
        assert json.loads(lines[0])["seq"] == 0
        assert json.loads(lines[1])["seq"] == 1
        assert json.loads(lines[2])["seq"] == 2
        assert json.loads(lines[3])["seq"] == 3

        # absolute path rejection (do not allow user-supplied abs)
        abs_run = "C:\\evil\\run" if os.name == "nt" else "/etc/evil"
        res = append_event(abs_run, {"phase": "queue", "type": "RUN_STARTED", "payload": {}}, events_root=event_root)
        assert res is None
        # no file created for bad id
        bad_log = resolve_event_log_path(abs_run, event_root)
        assert bad_log is None

        # different run independent seq
        run_b = "run-B-110"
        wb = append_event(run_b, {"phase": "probe", "type": "TASK_STARTED", "payload": {"a": 1}}, events_root=event_root)
        assert wb is not None
        assert wb["seq"] == 0

        # events root documented
        root_p = get_agent_loop_events_root(event_root)
        assert root_p is not None

        # ensure we did not write to legacy state.json authority (temp has none)
        state_any = list(Path(tmp).rglob("state.json"))
        assert len(state_any) == 0
