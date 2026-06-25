"""
Centralized safe path resolution for AgentLoop run and artifact readers (SlideRule 109).

Enforces bounded filesystem access:
- Only documented run/artifact roots.
- Rejects absolute user-supplied paths (incl. drive prefixes).
- Rejects traversal escapes.
- Rejects symlink escapes outside allowed root.
- Never exposes raw FS errors to callers (returns None on any issue).
- Readers must use these instead of open-coded joins.
"""

import os
import re
from pathlib import Path, PurePath
from typing import Optional, Union, List


def _get_default_runs_root() -> str:
    return os.environ.get("AGENT_LOOP_RUNS_DIR") or ".agent-loop/runs"


def get_agent_loop_runs_root(runs_root: Optional[str] = None) -> Path:
    """Return the (resolved) documented runs root. Root is trusted (env/default), not arbitrary user input."""
    if runs_root is None:
        runs_root = _get_default_runs_root()
    try:
        return Path(runs_root).resolve(strict=False)
    except Exception:
        return Path(runs_root).absolute()


def _is_absolute_like(s: str) -> bool:
    """Detect absolute paths or drive-prefix escapes supplied by user input."""
    if not isinstance(s, str):
        return False
    st = s.strip()
    if not st:
        return False
    if os.path.isabs(st):
        return True
    # windows drive letter, UNC, embedded
    if re.match(r"^[a-zA-Z]:", st):
        return True
    if st.startswith("\\\\") or st.startswith("//"):
        return True
    if ":\\" in st or ":/" in st:
        return True
    if st.startswith("/") or st.startswith("\\"):
        return True
    return False


def _has_traversal(s: str) -> bool:
    """Detect .. traversal before joining."""
    if not isinstance(s, str) or not s:
        return False
    if ".." in PurePath(s).parts:
        return True
    norm = s.replace("\\", "/")
    if norm == ".." or norm.startswith("../") or norm.endswith("/..") or "/../" in norm:
        return True
    return False


def resolve_safe_path(
    base: Union[str, Path, os.PathLike],
    *parts: Union[str, os.PathLike],
    must_exist: bool = False,
) -> Optional[Path]:
    """Resolve candidate under base with full security checks.

    Rejects:
      - absolute or drive-prefixed parts
      - traversal components
      - results that escape base after resolve (incl. via symlinks)
    Returns None on any failure or escape (no raw errors surfaced).
    """
    if base is None:
        return None
    try:
        root = Path(base).resolve(strict=False)
    except Exception:
        return None

    safe_parts: List[str] = []
    for part in parts:
        if part is None:
            continue
        ps = str(part).strip()
        if not ps:
            continue
        if _is_absolute_like(ps):
            return None
        if _has_traversal(ps):
            return None
        if "\0" in ps:
            return None
        safe_parts.append(ps)

    if not safe_parts:
        return root

    try:
        candidate = root.joinpath(*safe_parts)

        # Stepwise check to catch symlink escapes (follow only existing components)
        current = root
        try:
            rel = candidate.relative_to(root)
            rel_parts = rel.parts
        except Exception:
            return None

        for rp in rel_parts:
            if not rp:
                continue
            next_p = current / rp
            if next_p.exists():
                try:
                    res = next_p.resolve(strict=False)
                    res.relative_to(root)
                except Exception:
                    return None
            current = next_p

        resolved = candidate.resolve(strict=False)
        resolved.relative_to(root)

        if must_exist and not resolved.exists():
            return None
        return resolved
    except Exception:
        # swallow all FS/parse errors; never leak to API
        return None


def resolve_run_dir(
    run_id: str, runs_root: Optional[str] = None
) -> Optional[Path]:
    """Safely resolve a run directory under the documented runs root.

    run_id must be a plain identifier; absolute, traversal, drive, or path chars are rejected.
    """
    if not run_id or not isinstance(run_id, str):
        return None
    if any(c in run_id for c in ("/", "\\", "\0")):
        return None
    if _is_absolute_like(run_id) or _has_traversal(run_id):
        return None
    root = get_agent_loop_runs_root(runs_root)
    return resolve_safe_path(root, run_id)


def resolve_artifact_path(
    run_id: str, artifact: str, runs_root: Optional[str] = None
) -> Optional[Path]:
    """Safely resolve an artifact (basename) inside a resolved run dir.

    Only flat basenames allowed for artifacts (no subdirs from input).
    """
    run_dir = resolve_run_dir(run_id, runs_root)
    if run_dir is None:
        return None
    if not artifact or not isinstance(artifact, str):
        return None
    if _is_absolute_like(artifact) or _has_traversal(artifact):
        return None
    if "/" in artifact or "\\" in artifact:
        return None
    return resolve_safe_path(run_dir, artifact)


def _get_default_events_root() -> str:
    """Documented default for append-only event JSONL root (per SSOT for v2)."""
    return os.environ.get("AGENT_LOOP_EVENTS_DIR") or ".agent-loop/events"


def get_agent_loop_events_root(events_root: Optional[str] = None) -> Path:
    """Return the (resolved) documented events root for runtime event store.

    Root is trusted (env or default), not from arbitrary user input.
    """
    if events_root is None:
        events_root = _get_default_events_root()
    try:
        return Path(events_root).resolve(strict=False)
    except Exception:
        return Path(events_root).absolute()


def resolve_event_log_path(
    run_id: str, events_root: Optional[str] = None
) -> Optional[Path]:
    """Safely resolve the append-only events JSONL path under documented event root only.

    Layout: <event-root>/<runId>.jsonl
    Rejects absolute user paths, traversal, drive prefixes, bad chars on run_id.
    Uses the same safe resolution as runs.
    """
    if not run_id or not isinstance(run_id, str):
        return None
    if any(c in run_id for c in ("/", "\\", "\0")):
        return None
    if _is_absolute_like(run_id) or _has_traversal(run_id):
        return None
    root = get_agent_loop_events_root(events_root)
    # events file is flat <runId>.jsonl under the root (no subdir from run_id)
    log_name = f"{run_id}.jsonl"
    if _is_absolute_like(log_name) or _has_traversal(log_name):
        return None
    return resolve_safe_path(root, log_name)


__all__ = [
    "get_agent_loop_runs_root",
    "resolve_safe_path",
    "resolve_run_dir",
    "resolve_artifact_path",
    "get_agent_loop_events_root",
    "resolve_event_log_path",
]
