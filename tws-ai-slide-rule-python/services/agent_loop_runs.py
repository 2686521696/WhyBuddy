"""
AgentLoop runs overview service (SlideRule 108).

Reads .agent-loop/runs/<runId>/state.json safely to produce stable AgentLoopRunSummary list.
- Never mutates run store.
- Missing/empty dir -> []
- Corrupt state.json (read or parse fail, or bad content) -> degraded item (response continues)
- Returns summaries sorted newest-first by runId timestamp.
- Only reads bounded state files (no unbounded logs).
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from models.agent_loop import (
    AgentLoopArtifact,
    AgentLoopEvent,
    AgentLoopRunDetail,
    AgentLoopRunSummary,
    AgentLoopTaskEntry,
)

# Use centralized path helper for all run/artifact resolution (109 path security)
import sys
from pathlib import Path as _P
_pkg_root = _P(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))
from services.agent_loop_paths import (
    get_agent_loop_runs_root,
    resolve_run_dir,
    resolve_artifact_path,
)

# 110: central stable artifact index (event refs + size + no-mtime active selection)
try:
    from services.agent_loop_artifacts import list_agent_loop_artifacts
except Exception:
    from agent_loop_artifacts import list_agent_loop_artifacts  # type: ignore

# 110: legacy 108/109 runs are projected to synthetic v2 events for replay/detail.
try:
    from services.agent_loop_legacy_adapter import read_legacy_events
except Exception:
    from agent_loop_legacy_adapter import read_legacy_events  # type: ignore

# 109: reuse central redaction helper
try:
    from services.agent_loop_redaction import redact_sensitive as _central_redact_sensitive
except Exception:
    from agent_loop_redaction import redact_sensitive as _central_redact_sensitive  # type: ignore


def _parse_run_id_date(run_id: str) -> Optional[datetime]:
    """Parse AgentLoop runId like 2026-06-25T14-00-00-000Z into UTC datetime."""
    if not run_id:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$", str(run_id))
    if not m:
        return None
    y, mo, d, h, mi, s, ms = m.groups()
    try:
        return datetime(
            int(y), int(mo), int(d), int(h), int(mi), int(s),
            int(ms or 0) * 1000, tzinfo=timezone.utc
        )
    except Exception:
        return None


def _classify_run_mode(
    status: Optional[str] = None,
    iterations: Optional[List[Dict[str, Any]]] = None,
    grokFix: Any = None,
    agentFix: Any = None,
    codexReview: Any = None,
    grokReview: Any = None,
    agentReview: Any = None,
    fixAgent: str = "grok",
    reviewAgent: Optional[str] = "grok",
) -> str:
    """Minimal port of classifyRunMode for stable runMode in summaries."""
    s = str(status or "").upper().strip()
    iters = iterations or []
    fix_ran = bool(grokFix or agentFix) or any(
        bool((it or {}).get("grokFix") or (it or {}).get("agentFix")) for it in iters if isinstance(it, dict)
    )
    eff_review = reviewAgent or ("codex" if codexReview else ("grok" if grokReview else None))

    if s == "DONE_GATE_ONLY":
        return "gate-only"
    if s == "DONE_FIXED":
        return f"{fixAgent}-fix"
    if s == "DONE_REVIEWED":
        if fix_ran and eff_review:
            return f"{fixAgent}-fix+{eff_review}-review"
        if eff_review:
            return f"{eff_review}-review"
        return "codex-review" if fix_ran else "reviewed"
    if s == "DONE_REVIEWED_NO_DIFF":
        return "reviewed-no-diff"
    if s == "PAUSED_BEFORE_FIX":
        return "paused-before-fix"
    if s == "PAUSED_AFTER_ITERATION":
        return "paused-after-iteration"
    if s == "HALT_BUDGET":
        return "halt-budget"
    if s == "HALT_NO_CHANGES":
        return "halt-no-changes"
    if s == "HALT_NO_PROGRESS":
        return "halt-no-progress"
    if s == "HALT_AGENT_NOT_FOUND":
        return "agent-missing"
    if s == "HALT_NO_SUCCESS_CRITERIA":
        return "no-success-criteria"
    if s == "HALT_STOPPED":
        return "stopped"
    if s == "APPLY_CONFLICT":
        return "apply-conflict"
    if s == "HALT_APPLY_FAILED":
        return "halt-apply-failed"
    if s:
        return s.lower().replace("_", "-")
    if iters:
        return "in-progress"
    return "unknown"


def _build_summary_dict(state: Dict[str, Any], run_id: str) -> Dict[str, Any]:
    """Build summary payload from raw state (mirrors Node summarizeRunRecord fields)."""
    opts = state.get("options") or {}
    iterations = state.get("iterations") or []
    iter_count = len(iterations) if isinstance(iterations, list) else (int(iterations) if iterations else 0)

    task = opts.get("task") or state.get("task")
    status = state.get("status")

    fix_agent = opts.get("fixAgent") or state.get("fixAgent") or "grok"
    skip_review = bool(opts.get("skipReview"))
    review_agent = None if skip_review else (opts.get("reviewAgent") or state.get("reviewAgent") or "grok")

    grok_fix = state.get("grokFix")
    agent_fix = state.get("agentFix")
    codex_rev = state.get("codexReview")
    grok_rev = state.get("grokReview")
    agent_rev = state.get("agentReview")

    # grokRan / codexRan / reviewAgentRan (minimal faithful logic)
    grok_ran = False
    codex_ran = False
    review_ran = bool(agent_rev or codex_rev or grok_rev)

    if fix_agent == "grok" and (grok_fix or any("grokFix" in str(it) for it in iterations if isinstance(it, (dict, str)))):
        grok_ran = True
    if fix_agent == "codex" and agent_fix:
        codex_ran = True
    if review_agent == "grok" and grok_rev:
        grok_ran = True
    if review_agent == "codex" and codex_rev:
        codex_ran = True

    run_mode = _classify_run_mode(
        status=status,
        iterations=iterations if isinstance(iterations, list) else [],
        grokFix=grok_fix,
        agentFix=agent_fix,
        codexReview=codex_rev,
        grokReview=grok_rev,
        agentReview=agent_rev,
        fixAgent=fix_agent,
        reviewAgent=review_agent,
    )

    # times derived from runId (stable, matching Node intent)
    d = _parse_run_id_date(run_id)
    if d:
        run_time_utc = d.strftime("%Y-%m-%d %H:%M:%S (UTC)")
        run_time_local = d.strftime("%Y-%m-%d %H:%M:%S (Asia/Shanghai)")
    else:
        run_time_utc = ""
        run_time_local = ""

    payload = {
        "runId": run_id,
        "status": status,
        "task": task,
        "runMode": run_mode,
        "iterations": iter_count,
        "grokRan": grok_ran,
        "codexRan": codex_ran,
        "reviewAgentRan": review_ran,
        "fixAgent": fix_agent,
        "reviewAgent": review_agent,
        "runTimeLocal": run_time_local,
        "runTimeUtc": run_time_utc,
    }
    # extras from state (if any) go to metadata via AgentLoopBase validator
    return payload


def list_agent_loop_run_summaries(runs_root: Optional[str] = None) -> List[AgentLoopRunSummary]:
    """Return list of run summaries from state files.

    - If runs dir missing or empty: return []
    - For any dir where state.json missing, unreadable or unparsable: emit degraded summary (do not raise)
    - Always sort newest first (by runId date, fallback lexical desc)
    """
    root_path = get_agent_loop_runs_root(runs_root)
    if not root_path.exists() or not root_path.is_dir():
        return []

    items: List[AgentLoopRunSummary] = []
    for entry in root_path.iterdir():
        if not entry.is_dir():
            continue
        run_id = entry.name
        # readers must use path helper (no open-coded join on run_id)
        state_path = resolve_artifact_path(run_id, "state.json", runs_root)
        state: Optional[Dict[str, Any]] = None
        degrade_reason: Optional[str] = None

        if state_path is None or not state_path.exists():
            degrade_reason = "missing state.json"
        else:
            try:
                raw = state_path.read_text(encoding="utf-8")
                state = json.loads(raw)
                if not isinstance(state, dict):
                    raise ValueError("state.json is not a JSON object")
            except Exception as exc:
                degrade_reason = f"corrupt state.json: {type(exc).__name__}"

        if degrade_reason or state is None:
            deg = AgentLoopRunSummary(
                runId=run_id,
                status="degraded",
                task=None,
                iterations=0,
                grokRan=False,
                codexRan=False,
                reviewAgentRan=False,
                fixAgent="grok",
                reviewAgent=None,
                metadata={"degraded": True, "reason": degrade_reason or "corrupt run record"},
            )
            items.append(deg)
            continue

        # valid state: try build summary
        try:
            payload = _build_summary_dict(state, run_id)
            summary = AgentLoopRunSummary.model_validate(payload)
            items.append(summary)
        except Exception as exc:
            deg = AgentLoopRunSummary(
                runId=run_id,
                status="degraded",
                task=None,
                iterations=0,
                grokRan=False,
                codexRan=False,
                reviewAgentRan=False,
                fixAgent="grok",
                reviewAgent=None,
                metadata={"degraded": True, "reason": "invalid state content", "error": str(exc)[:200]},
            )
            items.append(deg)

    # sort newest first (stable)
    def sort_key(s: AgentLoopRunSummary):
        dt = _parse_run_id_date(s.runId)
        # use max future for None to put invalid last? but None treated oldest
        return (dt.timestamp() if dt else -1, s.runId)

    items.sort(key=sort_key, reverse=True)
    return items


# --- Run detail (task 108) ---

def _safe_read_json(p: Path) -> Optional[Dict[str, Any]]:
    try:
        if p.exists() and p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    return None


def _redact_sensitive(text: str) -> str:
    """Delegate to central redaction helper (109 reuse by run readers)."""
    return _central_redact_sensitive(text)


def _read_text_tail(p: Path, max_lines: int = 20, max_chars: int = 2000) -> str:
    """Bounded tail for logs and text artifacts. Documented bound in tests.

    Guarantees:
    - never loads entire file (reads trailing byte chunk only)
    - result length <= max_chars (hard byte/char bound for unbounded log safety)
    - <= max_lines trailing non-blank lines
    - sensitive values (env, keys, tokens, auth) are redacted

    Used for report and log artifact .content to meet "Text tails are bounded"
    and "Do not leak raw environment variables or keys from artifacts".
    """
    try:
        if not p.exists() or not p.is_file():
            return ""
        # Bounded tail read: only last chunk from end, prevents full-file load for large logs/reports
        max_read = max(4096, max_chars * 2)
        with open(p, "rb") as f:
            f.seek(0, 2)
            fsize = f.tell()
            to_read = min(fsize, max_read)
            f.seek(fsize - to_read if fsize > to_read else 0)
            chunk = f.read(to_read)
        raw = chunk.decode("utf-8", errors="replace")
        # drop leading partial line when reading suffix only
        if fsize > to_read and "\n" in raw:
            parts = raw.split("\n", 1)
            raw = parts[1] if len(parts) > 1 else ""
        lines = [line.rstrip("\r\n") for line in raw.splitlines()]
        tail_lines = [ln for ln in lines if ln.strip()][-max_lines:]
        tail = "\n".join(tail_lines)
        if len(tail) > max_chars:
            tail = tail[-max_chars:]
        return _redact_sensitive(tail)
    except Exception:
        return ""


def _read_events_tail(p: Path, max_events: int = 60) -> List[AgentLoopEvent]:
    """Read events.jsonl , bounded tail of events (mirrors Node readRunEvents limit)."""
    events: List[AgentLoopEvent] = []
    try:
        if not p.exists() or not p.is_file():
            return []
        raw = p.read_text(encoding="utf-8")
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
                if isinstance(parsed, dict) and parsed.get("status"):
                    events.append(
                        AgentLoopEvent(
                            ts=parsed.get("ts"),
                            status=str(parsed.get("status")),
                            iteration=parsed.get("iteration"),
                        )
                    )
            except Exception:
                continue
    except Exception:
        pass
    return events[-max_events:]


def _read_detail_events(run_id: str, events_path: Optional[Path], runs_root: Optional[str], max_events: int = 60) -> List[AgentLoopEvent]:
    """Read detail events, preserving synthetic v2 envelopes for legacy runs.

    Native run-directory events.jsonl keeps the historical status-only detail
    timeline shape. Legacy runs without native events fallback to the v2 adapter
    so web replay/detail can see payload.synthetic and legacySource.
    """
    if events_path and events_path.exists() and events_path.is_file():
        return _read_events_tail(events_path, max_events)

    try:
        legacy_events = read_legacy_events(run_id, runs_root=runs_root, limit=max_events)
    except Exception:
        legacy_events = []

    out: List[AgentLoopEvent] = []
    for raw in legacy_events[-max_events:]:
        try:
            if isinstance(raw, dict):
                out.append(AgentLoopEvent.model_validate(raw))
        except Exception:
            continue
    return out


def _looks_like_abs_path(s: Any) -> bool:
    """Detect strings that are absolute local FS paths (windows/unix) to enforce no-abs-path in responses."""
    if not isinstance(s, str):
        return False
    st = s.strip()
    if not st:
        return False
    # Windows: C:\foo , c:/bar , UNC \\srv\share
    if re.match(r"^[a-zA-Z]:[\\/]", st) or st.startswith("\\\\") or st.startswith("//"):
        return True
    # Unix root /
    if st.startswith("/") and len(st) > 1:
        return True
    # embedded drive or common abs markers
    if ":\\" in st or ":/" in st:
        return True
    return False


def _sanitize_for_response(obj: Any) -> Any:
    """Recursively replace absolute paths in state-derived payloads (options, task, iterations, fix/review) with basename.

    Ensures "Do not expose absolute local paths in API responses" for task/options/iterations/grokFix etc.
    Safe relative basenames are allowed (as used for artifacts).
    Non-path strings and structures preserved.
    """
    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for k, v in obj.items():
            kl = str(k).lower()
            # keys that typically hold paths: always sanitize their string value if abs
            if kl in ("cwd", "reporoot", "worktree", "root", "workdir", "logpath", "filepath", "dir", "basedir") or "path" in kl or "dir" in kl or "file" in kl:
                if isinstance(v, str) and _looks_like_abs_path(v):
                    try:
                        bn = Path(v).name
                        out[k] = bn if bn else "[redacted-path]"
                    except Exception:
                        out[k] = "[redacted-path]"
                    continue
            out[k] = _sanitize_for_response(v)
        return out
    if isinstance(obj, list):
        return [_sanitize_for_response(item) for item in obj]
    if isinstance(obj, str):
        if _looks_like_abs_path(obj):
            try:
                bn = Path(obj).name
                return bn if bn else "[redacted-path]"
            except Exception:
                return "[redacted-path]"
        return obj
    return obj


def get_agent_loop_run_detail(run_id: str, runs_root: Optional[str] = None) -> Optional[AgentLoopRunDetail]:
    """Load single run detail from run dir artifacts.

    - Returns None (caller -> 404) if run dir or state.json missing/unreadable.
    - Never returns absolute paths; only relative identifiers (basename) for artifacts.
    - State-derived fields (options, task.path, iterations, grokFix/agentFix/codexReview/grokReview) are sanitized:
      absolute local paths (cwd, repoRoot, worktree, task abs paths etc.) are replaced by basename only.
      This guarantees "Do not expose absolute local paths in API responses" for the entire detail.
    - Text content (logs, reports) are bounded tails (line+char limited + redacted).
    - No raw env/keys leaked: _redact_sensitive applied to all report/log .content .
    """
    # 109: delegate to path helper (replaces previous open-coded check and join)
    run_dir = resolve_run_dir(run_id, runs_root)
    if run_dir is None or not run_dir.is_dir():
        return None

    state_p = resolve_artifact_path(run_id, "state.json", runs_root)
    state = _safe_read_json(state_p) if state_p else None
    if state is None or not isinstance(state, dict):
        return None

    status = state.get("status")
    opts = _sanitize_for_response(state.get("options") or {})
    raw_task_path = opts.get("task") if isinstance(opts, dict) else None
    if not raw_task_path:
        raw_task_path = state.get("task")
    task_entry = None
    if raw_task_path:
        tp = str(raw_task_path)
        safe_tp = _sanitize_for_response(tp) if _looks_like_abs_path(tp) else tp
        task_entry = AgentLoopTaskEntry(path=safe_tp)

    iterations = _sanitize_for_response(state.get("iterations") or [])
    if not isinstance(iterations, list):
        iterations = []

    # events bounded
    events_p = resolve_artifact_path(run_id, "events.jsonl", runs_root)
    events = _read_detail_events(run_id, events_p, runs_root, 60)

    # 110: delegate to central artifact index for stable ids, kind, safe name (title), size, eventRef
    # (no mtime selection; explicit event refs preferred for active logs)
    artifacts: List[AgentLoopArtifact] = []
    try:
        base_arts = list_agent_loop_artifacts(run_id, runs_root) or []
        for ba in base_arts:
            fname = ba.id
            fp = resolve_artifact_path(run_id, fname, runs_root)
            content = None
            if fp and fp.exists() and fp.is_file():
                if fname.endswith((".json", ".md")):
                    content = _read_text_tail(fp, 50, 2000)
                elif ba.kind == "log":
                    content = _read_text_tail(fp, 20, 2000)
            meta = dict(getattr(ba, "metadata", {}) or {})
            art = AgentLoopArtifact(
                id=ba.id,
                kind=ba.kind,
                title=ba.title or ba.id,
                path=ba.id,
                content=content,
                metadata=meta,
            )
            artifacts.append(art)
    except Exception:
        # fallback ensures detail never breaks
        artifacts.append(
            AgentLoopArtifact(id="state.json", kind="state", title="state.json", path="state.json")
        )

    detail = AgentLoopRunDetail(
        runId=run_id,
        status=status,
        task=task_entry,
        options=opts if opts else None,
        iterations=iterations,
        events=events,
        artifacts=artifacts,
        grokFix=_sanitize_for_response(state.get("grokFix")),
        agentFix=_sanitize_for_response(state.get("agentFix")),
        codexReview=_sanitize_for_response(state.get("codexReview")),
        grokReview=_sanitize_for_response(state.get("grokReview")),
    )
    return detail
