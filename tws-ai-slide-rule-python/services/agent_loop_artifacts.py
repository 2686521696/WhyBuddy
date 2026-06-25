"""
AgentLoop artifact index (SlideRule 110).

Exposes stable, event-referenced artifact metadata (kind, safe name, size, optional event ref).
- Artifact ids are deterministic (name-sorted collection).
- Never selects active logs by mtime; uses explicit event refs from events.jsonl when present.
- Reuses path helpers (109) and redaction (109).
- No absolute paths exposed.
- Bounded: only flat basenames under resolved run dir.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from models.agent_loop import AgentLoopArtifact

# 109 path security (centralized)
import sys
from pathlib import Path as _P
_pkg_root = _P(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))
from services.agent_loop_paths import (
    resolve_run_dir,
    resolve_artifact_path,
)

# 109 redaction reuse (central)
try:
    from services.agent_loop_redaction import redact_sensitive
except Exception:
    from agent_loop_redaction import redact_sensitive  # type: ignore


def _safe_file_size(p: Path) -> int:
    try:
        if p.exists() and p.is_file():
            return p.stat().st_size
    except Exception:
        pass
    return 0


def _infer_kind(name: str) -> str:
    lname = name.lower()
    if name == "state.json":
        return "state"
    if "final-report" in lname or "report" in lname:
        return "report"
    if lname.endswith(".patch") or name.startswith("diff."):
        return "diff"
    if "landing" in lname:
        return "landing"
    if lname.endswith(".log") or "output" in lname or "log" in lname:
        return "log"
    return "file"


def _collect_artifact_names(run_dir: Path) -> List[str]:
    """Deterministic collection: only candidate artifact files, sorted by name for stable ids."""
    names: List[str] = []
    try:
        for entry in sorted(run_dir.iterdir(), key=lambda e: e.name):
            if entry.is_file():
                name = entry.name
                lname = name.lower()
                # include core artifacts + logs/reports/diffs (no unbounded, no dirs, no abs)
                if (
                    name in ("state.json",)
                    or name.endswith((".json", ".md", ".log", ".patch"))
                    or "report" in lname
                    or "diff" in lname
                    or "output" in lname
                    or "log" in lname
                    or "landing" in lname
                ):
                    names.append(name)
    except Exception:
        pass
    # ensure lexical stable order (already sorted above)
    return names


def _find_event_reference(run_id: str, artifact_name: str, runs_root: Optional[str] = None) -> Optional[str]:
    """Scan events.jsonl for ARTIFACT_INDEXED / AGENT_LOG / payload refs to this artifact name.
    Returns a stable reference string (prefer seq, fallback ts) or None.
    Used for active log selection and event-referenced metadata.
    """
    ev_path = resolve_artifact_path(run_id, "events.jsonl", runs_root)
    if ev_path is None or not ev_path.exists() or not ev_path.is_file():
        return None
    try:
        raw = ev_path.read_text(encoding="utf-8", errors="replace")
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
                seq = ev.get("seq")
                ts = ev.get("ts")
                ref = seq if seq is not None else ts
                typ = ev.get("type") or ""
                payload = ev.get("payload") or {}
                # direct envelope artifacts list (as used in reducer)
                for art in (ev.get("artifacts") or []):
                    if isinstance(art, str) and art == artifact_name:
                        return str(ref) if ref is not None else "ref"
                    if isinstance(art, dict):
                        if art.get("id") == artifact_name or art.get("name") == artifact_name or art.get("artifactId") == artifact_name:
                            return str(ref) if ref is not None else "ref"
                # payload refs (AGENT_LOG logFile, ARTIFACT_INDEXED etc)
                for key in ("id", "name", "artifactId", "logFile", "file", "path"):
                    val = payload.get(key)
                    if isinstance(val, str) and val == artifact_name:
                        return str(ref) if ref is not None else "ref"
                    if isinstance(val, dict):
                        if val.get("id") == artifact_name or val.get("name") == artifact_name:
                            return str(ref) if ref is not None else "ref"
                if typ == "ARTIFACT_INDEXED":
                    if payload.get("name") == artifact_name or payload.get("id") == artifact_name:
                        return str(ref) if ref is not None else "ref"
                # also inspect stringified for loose match
                if artifact_name in json.dumps(payload):
                    return str(ref) if ref is not None else "ref"
            except Exception:
                continue
    except Exception:
        pass
    return None


def list_agent_loop_artifacts(run_id: str, runs_root: Optional[str] = None) -> List[AgentLoopArtifact]:
    """Stable artifact index for a run.

    - ids stable (sorted name order, same on every call)
    - includes: id, kind, title (safe name), path (safe), metadata.size, metadata.eventRef (when present)
    - never absolute paths (delegates to resolve helpers)
    - event refs derived from events.jsonl when present
    """
    run_dir = resolve_run_dir(run_id, runs_root)
    if run_dir is None or not run_dir.is_dir():
        return []

    names = _collect_artifact_names(run_dir)
    result: List[AgentLoopArtifact] = []
    for name in names:
        p = resolve_artifact_path(run_id, name, runs_root)
        if p is None or not p.exists() or not p.is_file():
            continue
        size = _safe_file_size(p)
        kind = _infer_kind(name)
        event_ref = _find_event_reference(run_id, name, runs_root)

        meta: Dict[str, Any] = {"size": size}
        if event_ref is not None:
            meta["eventRef"] = event_ref

        # title is the safe name
        art = AgentLoopArtifact(
            id=name,
            kind=kind,
            title=name,
            path=name,
            metadata=meta,
        )
        result.append(art)

    return result


def get_active_log_artifact(run_id: str, runs_root: Optional[str] = None) -> Optional[AgentLoopArtifact]:
    """Select active log artifact.

    Prefers one carrying explicit event reference (from ARTIFACT_INDEXED etc) .
    Falls back to first stable (name-sorted) log. Never uses mtime.
    """
    arts = list_agent_loop_artifacts(run_id, runs_root)
    # prefer event-referenced log
    for a in arts:
        if a.kind == "log":
            meta = getattr(a, "metadata", {}) or {}
            if meta.get("eventRef"):
                return a
    # first stable log (name order)
    for a in arts:
        if a.kind == "log":
            return a
    return None


__all__ = [
    "list_agent_loop_artifacts",
    "get_active_log_artifact",
]
