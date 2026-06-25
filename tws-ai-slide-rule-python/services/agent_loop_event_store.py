"""Append-only redacted JSONL event store for AgentLoop v2 runtime events (SlideRule AgentLoop 110).

- Events written ONLY under documented event root via paths (never user-supplied abs paths).
- Payloads (and sensitive strings) redacted before persistence and on readback.
- Appends preserve append order; seq assigned monotonically (starting at 0) or validated.
- Uses envelope schema; state.json is never mutated as authority.
- No live Node runner required.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .agent_loop_event_schema import validate_event_envelope
from .agent_loop_paths import resolve_event_log_path
from .agent_loop_redaction import redact_sensitive


def _iso_ts() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _redact_payload(payload: Any) -> Dict[str, Any]:
    """Recursively redact secrets from any payload structure before write/read.

    Redacts string values via redact_sensitive (patterns) and also redacts
    entire values for keys whose names indicate secrets (password, token, etc.)
    even if the value itself carries no recognizable secret pattern.
    """
    if not isinstance(payload, dict):
        payload = {}
    secret_hints = ("key", "secret", "token", "password", "auth", "credential", "cred", "proxy", "pass", "bearer")
    def _is_sensitive_key(k: Any) -> bool:
        if not isinstance(k, str):
            return False
        kl = str(k).lower().replace("_", "").replace("-", "")
        return any(h in kl for h in secret_hints)
    def _walk(o: Any) -> Any:
        if isinstance(o, str):
            return redact_sensitive(o)
        if isinstance(o, dict):
            return {
                k: ("***REDACTED***" if _is_sensitive_key(k) else _walk(v))
                for k, v in o.items()
            }
        if isinstance(o, list):
            return [_walk(x) for x in o]
        return o
    return _walk(dict(payload))


def append_event(
    run_id: str,
    event: Dict[str, Any],
    *,
    events_root: Optional[str] = None,
    assign_seq: bool = True,
) -> Optional[Dict[str, Any]]:
    """Append one redacted event as JSONL line under the documented event root.

    Returns the persisted event dict (with assigned/validated seq) or None if
    path unsafe or write failed. Never accepts user absolute paths.
    """
    if not isinstance(event, dict) or not run_id:
        return None

    log_path = resolve_event_log_path(run_id, events_root)
    if log_path is None:
        return None

    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)

        # read prior lines to determine last seq (bounded by nature of appends)
        last_seq = -1
        if log_path.exists():
            raw = log_path.read_text(encoding="utf-8", errors="replace")
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    prev = json.loads(line)
                    if isinstance(prev, dict) and isinstance(prev.get("seq"), int):
                        last_seq = prev["seq"]
                except Exception:
                    continue

        ev = dict(event)  # shallow copy; will overwrite keys safely

        if ev.get("version") != "agentloop.event.v2":
            ev["version"] = "agentloop.event.v2"
        if not ev.get("runId"):
            ev["runId"] = run_id
        if not ev.get("ts"):
            ev["ts"] = _iso_ts()
        if "source" not in ev:
            ev["source"] = "python"
        if "phase" not in ev:
            ev["phase"] = "fix"
        if "type" not in ev:
            ev["type"] = "AGENT_LOG"

        provided_seq = ev.get("seq")
        if assign_seq or provided_seq is None or not isinstance(provided_seq, int):
            ev["seq"] = last_seq + 1
        else:
            # validate monotonic
            if provided_seq != last_seq + 1:
                return None
            ev["seq"] = provided_seq

        # always redact payload
        ev["payload"] = _redact_payload(ev.get("payload"))

        # ensure redaction metadata
        if not isinstance(ev.get("redaction"), dict):
            ev["redaction"] = {}
        ev["redaction"] = dict(ev["redaction"])
        ev["redaction"]["applied"] = True

        # full validation
        validated = validate_event_envelope(ev)
        dumped = validated.model_dump()

        # append exactly one line, preserving order
        with open(log_path, "a", encoding="utf-8", newline="") as f:
            f.write(json.dumps(dumped, separators=(",", ":")) + "\n")

        return dumped
    except Exception:
        return None


def read_events(
    run_id: str,
    *,
    events_root: Optional[str] = None,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Read back events for run (redacted on readback too). Order preserved.

    Returns validated envelopes as dicts. Empty list on any error or missing.
    """
    log_path = resolve_event_log_path(run_id, events_root)
    if log_path is None or not log_path.exists():
        return []

    out: List[Dict[str, Any]] = []
    try:
        raw = log_path.read_text(encoding="utf-8", errors="replace")
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                raw_ev = json.loads(line)
                if isinstance(raw_ev, dict):
                    if isinstance(raw_ev.get("payload"), dict):
                        raw_ev["payload"] = _redact_payload(raw_ev["payload"])
                    validated = validate_event_envelope(raw_ev)
                    out.append(validated.model_dump())
            except Exception:
                continue
        if limit is not None and limit >= 0:
            out = out[-limit:]
        return out
    except Exception:
        return []


__all__ = [
    "append_event",
    "read_events",
    "resolve_event_log_path",
]
