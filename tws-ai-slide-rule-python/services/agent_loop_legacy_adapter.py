"""Legacy compatibility adapter (SlideRule AgentLoop 110).

Converts 108/109 run artifacts (state.json + bounded reports) into synthetic v2 events.
- Synthetic events carry payload.synthetic=true and legacySource.
- Uses only documented path helpers; never raw FS paths in output.
- Bounded: never reads full unbounded artifacts.
- Safe degradation on corrupt data (returns [] or partial).
- Phases/types kept within allowed set for schema validation.
- Used by read API to serve legacy runs via same replay/reducer path.
"""

import json
from typing import Any, Dict, List, Optional

from .agent_loop_paths import resolve_run_dir, resolve_artifact_path
from .agent_loop_event_schema import validate_event_envelope
from .agent_loop_redaction import redact_sensitive


def _safe_read_json(p: Optional[Any]) -> Optional[Dict[str, Any]]:
    try:
        if p and hasattr(p, "exists") and p.exists():
            raw = p.read_text(encoding="utf-8", errors="replace")
            data = json.loads(raw)
            if isinstance(data, dict):
                return data
    except Exception:
        return None
    return None


def _redact_payload(p: Any) -> Dict[str, Any]:
    """Recursively redact secrets from payload.

    Redacts string values via redact_sensitive and also redacts
    entire values for keys whose names indicate secrets (password, token, etc.)
    even if the value itself carries no recognizable secret pattern.
    Matches redaction contract used by the v2 event store.
    """
    if not isinstance(p, dict):
        p = {}
    try:
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
        return _walk(dict(p))
    except Exception:
        return {}


def _synthetic_event(
    run_id: str,
    seq: int,
    ev_type: str,
    phase: str,
    payload: Dict[str, Any],
    source: str = "system",
    task: Optional[str] = None,
    legacy_source: str = "state.json",
) -> Optional[Dict[str, Any]]:
    """Build a validated synthetic v2 envelope. Returns dict or None on failure."""
    pl = dict(_redact_payload(payload or {}))
    pl["synthetic"] = True
    pl["legacySource"] = legacy_source
    ev: Dict[str, Any] = {
        "version": "agentloop.event.v2",
        "runId": run_id,
        "seq": int(seq),
        "ts": "2026-01-01T00:00:00.000Z",
        "source": source,
        "phase": phase,
        "type": ev_type,
        "task": task,
        "payload": pl,
        "artifacts": [],
        "redaction": {"applied": True, "synthetic": True},
    }
    try:
        validated = validate_event_envelope(ev)
        return validated.model_dump()
    except Exception:
        # degrade gracefully: drop invalid, do not crash replay
        return None


def read_legacy_events(
    run_id: str,
    *,
    runs_root: Optional[str] = None,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Return synthetic v2 events derived from legacy 108/109 artifacts.

    - Prefers state.json for status/task/gate/review signals.
    - Marks all as synthetic.
    - Bounded output (small fixed number of derived events).
    - Returns [] for missing/corrupt run.
    - Never leaks abs paths (path helpers guarantee).
    """
    if not run_id or not isinstance(run_id, str):
        return []
    run_dir = resolve_run_dir(run_id, runs_root)
    if run_dir is None or not run_dir.is_dir():
        return []

    out: List[Dict[str, Any]] = []
    seq = 0

    state_p = resolve_artifact_path(run_id, "state.json", runs_root)
    state = _safe_read_json(state_p)
    task = None
    status = None
    if state:
        opts = state.get("options") or {}
        raw_task = state.get("task") or opts.get("task")
        task = redact_sensitive(raw_task) if isinstance(raw_task, str) else raw_task
        raw_status = state.get("status")
        status = redact_sensitive(raw_status) if isinstance(raw_status, str) else raw_status

    # Always emit a start for legacy runs we can read
    ev0 = _synthetic_event(run_id, seq, "RUN_STARTED", "queue", {"status": "RUNNING"}, "system", task, "state.json")
    if ev0:
        out.append(ev0)
        seq += 1

    # Gate if visible in state or last iter
    gate_info = None
    if state:
        gate_info = state.get("gate") or state.get("latestGateSummary") or state.get("baselineGate")
        iters = state.get("iterations") or []
        if not gate_info and isinstance(iters, list) and iters:
            last = iters[-1]
            if isinstance(last, dict):
                gate_info = last.get("gate") or last.get("gateSummary")
    if gate_info:
        okv = None
        summ = None
        if isinstance(gate_info, dict):
            okv = gate_info.get("ok")
            raw_summ = gate_info.get("summary") or gate_info.get("message")
            summ = redact_sensitive(raw_summ) if isinstance(raw_summ, str) else raw_summ
        elif isinstance(gate_info, bool):
            okv = gate_info
        summary_val = summ if summ is not None else (redact_sensitive(str(gate_info)) if gate_info is not None else None)
        evg = _synthetic_event(
            run_id, seq, "GATE_RESULT", "gate", {"ok": okv, "summary": summary_val},
            "system", task, "state.json"
        )
        if evg:
            out.append(evg)
            seq += 1

    # Review if present
    if state and (state.get("grokReview") or state.get("codexReview") or state.get("agentReview")):
        evr = _synthetic_event(
            run_id, seq, "REVIEW_RESULT", "review", {"verdict": "reviewed"},
            "system", task, "state.json"
        )
        if evr:
            out.append(evr)
            seq += 1

    # Finalized only when status indicates terminal
    if state and isinstance(status, str):
        su = status.upper()
        if "DONE" in su or "FINAL" in su or su in ("HALT_BUDGET", "HALT_NO_CHANGES"):
            evf = _synthetic_event(
                run_id, seq, "RUN_FINALIZED", "finalize", {"status": status},
                "system", task, "state.json"
            )
            if evf:
                out.append(evf)
                seq += 1
        elif "FAIL" in su:
            evf = _synthetic_event(
                run_id, seq, "RUN_FAILED", "finalize", {"status": status},
                "system", task, "state.json"
            )
            if evf:
                out.append(evf)
                seq += 1

    # Bounded
    if limit is not None and limit >= 0:
        out = out[-limit:]
    return out


__all__ = ["read_legacy_events"]
