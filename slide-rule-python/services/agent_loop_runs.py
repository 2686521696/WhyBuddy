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
    resolve_safe_path,
)
from services.agent_loop_process_registry import get_background_runtime_status
from services.agent_loop_settings import load_agent_loop_settings

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




def _safe_read_json(path_obj: Path) -> Optional[Dict[str, Any]]:
    try:
        if not path_obj.exists() or not path_obj.is_file():
            return None
        data = json.loads(path_obj.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _get_repo_root() -> Path:
    here = Path(__file__).resolve()
    for cand in [here.parent.parent, here.parent.parent.parent]:
        if (cand / "agent-loop").is_dir() or (cand / "slide-rule-python").is_dir():
            return cand
    return here.parent.parent


def _default_queue_file_path(repo: Optional[Path] = None) -> Path:
    root = repo or _get_repo_root()
    return root / "agent-loop" / "scripts" / "migration-queue.json"


def _default_queue_outcomes_path(repo: Optional[Path] = None) -> Path:
    root = repo or _get_repo_root()
    return root / ".agent-loop" / "queue-outcomes.json"


def _default_queue_landing_path(repo: Optional[Path] = None) -> Path:
    root = repo or _get_repo_root()
    return root / ".agent-loop" / "queue-landing.json"


def _default_latest_state_path(repo: Optional[Path] = None) -> Path:
    root = repo or _get_repo_root()
    return root / ".agent-loop" / "latest" / "state.json"


def _agent_loop_artifact_root(repo: Path) -> Path:
    return repo / ".agent-loop"


def _artifact_queue_outcomes_path(artifact_root: Path) -> Path:
    return artifact_root / "queue-outcomes.json"


def _artifact_queue_landing_path(artifact_root: Path) -> Path:
    return artifact_root / "queue-landing.json"


def _artifact_latest_state_path(artifact_root: Path) -> Path:
    return artifact_root / "latest" / "state.json"


def _normalize_task_path(value: Optional[str]) -> str:
    return str(value or "").replace("\\", "/").replace("./", "").removeprefix("agent-loop/")


def _read_latest_state(repo: Path) -> Optional[Dict[str, Any]]:
    latest_path = _default_latest_state_path(repo)
    return _safe_read_json(latest_path)


def _read_latest_state_from_artifacts(artifact_root: Path) -> Optional[Dict[str, Any]]:
    return _safe_read_json(_artifact_latest_state_path(artifact_root))


def _resolve_queue_file_path(repo: Path) -> Path:
    settings = load_agent_loop_settings()
    configured = str(settings.get("queuePath") or "").strip()
    if configured:
        try:
            resolved = resolve_safe_path(repo, configured)
            if resolved is not None:
                return resolved
        except Exception:
            pass
    return _default_queue_file_path(repo)


def _repo_relative_path(repo: Path, path_obj: Path) -> str:
    try:
        return path_obj.resolve(strict=False).relative_to(repo.resolve(strict=False)).as_posix()
    except Exception:
        return path_obj.name


def _queue_sequence(path_obj: Path) -> int:
    match = re.search(r"-(\d+)-queue\.json$", path_obj.name)
    return int(match.group(1)) if match else -1


def _discover_queue_files(repo: Path) -> List[Dict[str, Any]]:
    scripts_dir = repo / "agent-loop" / "scripts"
    if not scripts_dir.exists() or not scripts_dir.is_dir():
        return []

    queues: List[Dict[str, Any]] = []
    for path_obj in scripts_dir.glob("*queue*.json"):
        queue = _safe_read_json(path_obj) or {}
        tasks = queue.get("tasks")
        if not isinstance(tasks, list):
            continue
        try:
            mtime = path_obj.stat().st_mtime
        except Exception:
            mtime = 0.0
        queues.append(
            {
                "path": _repo_relative_path(repo, path_obj),
                "taskCount": len(tasks),
                "mtime": mtime,
                "_sequence": _queue_sequence(path_obj),
                "_name": path_obj.name,
            }
        )

    queues.sort(key=lambda item: (int(item.get("_sequence") or -1), float(item.get("mtime") or 0), str(item.get("_name") or "")), reverse=True)
    for item in queues:
        item.pop("_sequence", None)
        item.pop("_name", None)
    return queues


def _queue_file_contains_task(repo: Path, queue_path: Path, normalized_task_path: str) -> bool:
    if not normalized_task_path:
        return False
    queue = _safe_read_json(queue_path) or {}
    tasks = queue.get("tasks")
    if not isinstance(tasks, list):
        return False
    for task in tasks:
        if not isinstance(task, dict):
            continue
        if _normalize_task_path(str(task.get("task") or "")) == normalized_task_path:
            return True
    return False


def _find_queue_file_containing_task(repo: Path, available_queues: List[Dict[str, Any]], normalized_task_path: str) -> Optional[Path]:
    if not normalized_task_path:
        return None
    for queue_info in available_queues:
        rel_path = str(queue_info.get("path") or "").strip()
        if not rel_path:
            continue
        resolved = resolve_safe_path(repo, rel_path)
        if resolved is not None and _queue_file_contains_task(repo, resolved, normalized_task_path):
            return resolved
    return None


def _queue_artifact_worktree_root(repo: Path, queue_path: Path) -> Optional[Path]:
    queue = _safe_read_json(queue_path) or {}
    defaults = queue.get("defaults") if isinstance(queue.get("defaults"), dict) else {}
    use_worktree = defaults.get("useWorktree")
    scope = str(defaults.get("worktreeScope") or "queue").strip().lower()
    raw_name = str(defaults.get("queueWorktreeName") or "").strip()
    if not use_worktree or scope != "queue" or not raw_name:
        return None
    clean_name = _sanitize_overview_worktree_name(raw_name)
    if not clean_name:
        return None
    candidate = repo / ".worktrees" / clean_name / ".agent-loop"
    return candidate if candidate.exists() and candidate.is_dir() else None


def _artifact_root_mtime(artifact_root: Path) -> float:
    candidates = [
        _artifact_queue_outcomes_path(artifact_root),
        _artifact_queue_landing_path(artifact_root),
        _artifact_latest_state_path(artifact_root),
    ]
    mtimes: List[float] = []
    for path_obj in candidates:
        try:
            if path_obj.exists():
                mtimes.append(path_obj.stat().st_mtime)
        except Exception:
            continue
    return max(mtimes) if mtimes else 0.0


def _artifact_task_ids(artifact_root: Path) -> set:
    outcomes = _safe_read_json(_artifact_queue_outcomes_path(artifact_root)) or {}
    tasks = outcomes.get("tasks")
    if not isinstance(tasks, dict):
        return set()
    return {str(task_id) for task_id in tasks.keys() if str(task_id).strip()}


def _queue_task_ids(queue_path: Path) -> set:
    queue = _safe_read_json(queue_path) or {}
    tasks = queue.get("tasks")
    if not isinstance(tasks, list):
        return set()
    ids = set()
    for task in tasks:
        if not isinstance(task, dict):
            continue
        task_id = str(task.get("id") or task.get("task") or "").strip()
        if task_id:
            ids.add(task_id)
    return ids


def _select_queue_artifacts(
    repo: Path,
    queue_file: Path,
    available_queues: List[Dict[str, Any]],
) -> tuple[Path, Path]:
    """Return (queue_file, artifact_root) for queue overview.

    The main workbench runs in the repo root, but queue execution can happen in a
    queue-scoped worktree. Prefer the freshest matching queue worktree artifacts so
    the web overview follows the real queue checkpoint instead of stale root files.
    """
    root_artifacts = _agent_loop_artifact_root(repo)
    selected_queue = queue_file
    selected_artifacts = root_artifacts
    selected_mtime = _artifact_root_mtime(root_artifacts)

    for queue_info in available_queues:
        rel_path = str(queue_info.get("path") or "").strip()
        if not rel_path:
            continue
        candidate_queue = resolve_safe_path(repo, rel_path)
        if candidate_queue is None:
            continue
        artifact_root = _queue_artifact_worktree_root(repo, candidate_queue)
        if artifact_root is None:
            continue
        artifact_mtime = _artifact_root_mtime(artifact_root)
        if artifact_mtime <= 0:
            continue
        artifact_task_ids = _artifact_task_ids(artifact_root)
        queue_task_ids = _queue_task_ids(candidate_queue)
        if artifact_task_ids and queue_task_ids and not artifact_task_ids.intersection(queue_task_ids):
            continue
        if artifact_mtime > selected_mtime:
            selected_queue = candidate_queue
            selected_artifacts = artifact_root
            selected_mtime = artifact_mtime

    return selected_queue, selected_artifacts


def _task_id_from_path(task_path: str) -> str:
    name = Path(str(task_path or "")).name
    return name[:-3] if name.endswith(".md") else (name or str(task_path or ""))


def _discover_task_files(repo: Path) -> List[str]:
    tasks_dir = repo / "agent-loop" / "tasks"
    if not tasks_dir.exists() or not tasks_dir.is_dir():
        return []
    paths: List[str] = []
    for path_obj in tasks_dir.glob("*.md"):
        if path_obj.is_file():
            paths.append(_repo_relative_path(repo, path_obj))
    return sorted(paths, key=lambda value: Path(value).name.lower())


def _is_active_status(status: Optional[str]) -> bool:
    text = str(status or "").strip().upper()
    return text in {"CODEX_FIX", "GROK_FIX", "CODEX_REVIEW", "GROK_REVIEW", "BUDGET_LOOP_HEAD", "REVIEW_NEEDS_CHANGES"}


def _classify_triage_category(enabled: bool, auto_disabled: bool, running: bool, outcome_group: Optional[str], stale: bool = False) -> str:
    if running:
        return "running"
    if stale:
        return "attention"
    if not enabled and not auto_disabled:
        return "disabled"
    if auto_disabled or outcome_group in {"applyConflict", "rescuePatch", "human", "failed", "crashed", "quarantined", "stopped"}:
        return "attention"
    if outcome_group in {"applied", "reviewed", "noDiff", "manualRescueLanded"}:
        return "landed"
    return "pending"


def _classify_outcome_group(status: Optional[str], outcome: Optional[str], record: Optional[Dict[str, Any]]) -> Optional[str]:
    if outcome in {"quarantined", "failed", "crashed", "stopped"}:
        return outcome
    if status == "DONE_REVIEWED_NO_DIFF":
        return "noDiff"
    if status == "APPLY_CONFLICT":
        return "applyConflict"
    if record and (record.get("applyStatus") == "RESCUE_PATCH_AVAILABLE" or record.get("rescuePatchAvailable")):
        return "rescuePatch"
    if status in {"DIRTY_MAIN_NEEDS_COMMIT", "HALT_STOPPED"}:
        return "stopped"
    if status == "HALT_HUMAN":
        return "human"
    if outcome == "done":
        if status == "DONE_REVIEWED":
            return "reviewed"
        return "applied"
    return outcome


def _format_updated_text(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value.replace("T", " ").replace("Z", "")[:19]


def _sanitize_overview_worktree_name(value: Optional[str]) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip("-")[:80]


def _phase_label(status: Optional[str]) -> str:
    text = str(status or "").strip()
    labels = {
        "INIT": "初始化",
        "RESUMED": "恢复运行",
        "PROBED": "探测 agent",
        "WORKTREE_READY": "worktree 就绪",
        "BASELINE_GATE_RESULT": "基线 gate 完成",
        "BUDGET_LOOP_HEAD": "修复轮次开始",
        "GROK_FIX": "Grok 修复中",
        "CODEX_FIX": "Codex 修复中",
        "POST_FIX_GATE_RESULT": "修复后 gate 完成",
        "CODEX_REVIEW": "Codex review 中",
        "GROK_REVIEW": "Grok review 中",
        "DONE_REVIEWED": "已完成（已 review）",
        "DONE_FIXED": "已完成（已修复）",
        "DONE_GATE_ONLY": "已完成（仅 gate）",
        "MANUAL_RESCUE_LANDED": "人工救回",
        "HALT_HUMAN": "需人工接管",
        "HALT_NO_CHANGES": "修复无 diff",
        "HALT_NO_PROGRESS": "gate 无进展",
        "HALT_BUDGET": "达到最大轮次",
        "HALT_AGENT_NOT_FOUND": "缺少 agent",
        "HALT_NO_SUCCESS_CRITERIA": "缺少成功标准",
        "HALT_STOPPED": "已停止",
        "PAUSED_BEFORE_FIX": "修复前暂停",
        "PAUSED_AFTER_ITERATION": "迭代后暂停",
    }
    if not text:
        return "等待运行"
    if text == "STALE_INTERRUPTED":
        return "运行中断"
    if text.startswith("DONE_"):
        return labels.get(text, "已完成")
    if text.startswith("HALT_"):
        return labels.get(text, "已停止")
    return labels.get(text, text)


def _queue_overview_from_files(repo_root: Optional[str] = None) -> Dict[str, Any]:
    repo = Path(repo_root) if repo_root else _get_repo_root()
    queue_file = _resolve_queue_file_path(repo)
    available_queues = _discover_queue_files(repo)
    queue_file, artifact_root = _select_queue_artifacts(repo, queue_file, available_queues)
    outcomes_file = _artifact_queue_outcomes_path(artifact_root)
    landing_file = _artifact_queue_landing_path(artifact_root)
    latest_state = _read_latest_state_from_artifacts(artifact_root)
    latest_state_active = _is_active_status(latest_state.get("status") if isinstance(latest_state, dict) else None)
    background_runtime = get_background_runtime_status()
    has_background_runtime = bool(background_runtime.get("record"))
    queue_running = bool(background_runtime.get("running")) if has_background_runtime else False
    stale_run = bool(background_runtime.get("stale")) if has_background_runtime else latest_state_active
    running_task_path = _normalize_task_path(
        (latest_state.get("options") or {}).get("task") if isinstance(latest_state, dict) and isinstance(latest_state.get("options"), dict) else None
    )

    active_queue_file = _find_queue_file_containing_task(repo, available_queues, running_task_path) if latest_state_active else None
    if active_queue_file is not None:
        queue_file = active_queue_file
        active_artifact_root = _queue_artifact_worktree_root(repo, active_queue_file)
        if active_artifact_root is not None and _artifact_root_mtime(active_artifact_root) > 0:
            artifact_root = active_artifact_root
            outcomes_file = _artifact_queue_outcomes_path(artifact_root)
            landing_file = _artifact_queue_landing_path(artifact_root)
            latest_state = _read_latest_state_from_artifacts(artifact_root)

    queue_path = _repo_relative_path(repo, queue_file)
    discovered_latest_queue = available_queues[0] if available_queues else None
    discovered_latest_queue_path = discovered_latest_queue.get("path") if isinstance(discovered_latest_queue, dict) else None
    using_queue_worktree_artifacts = artifact_root.resolve(strict=False) != _agent_loop_artifact_root(repo).resolve(strict=False)
    latest_queue_path = queue_path if active_queue_file is not None or using_queue_worktree_artifacts else discovered_latest_queue_path
    queue_stale = bool(latest_queue_path and latest_queue_path != queue_path)

    queue = _safe_read_json(queue_file) or {}
    outcomes = _safe_read_json(outcomes_file) or {"tasks": {}}
    landing = _safe_read_json(landing_file)

    tasks_in = queue.get("tasks") if isinstance(queue.get("tasks"), list) else []
    queue_defaults = queue.get("defaults") if isinstance(queue.get("defaults"), dict) else {}
    outcome_map = outcomes.get("tasks") if isinstance(outcomes.get("tasks"), dict) else {}
    latest_options = latest_state.get("options") if isinstance(latest_state, dict) and isinstance(latest_state.get("options"), dict) else {}
    latest_profile = None
    if isinstance(latest_options, dict):
        latest_fix = latest_options.get("fixAgent") or queue_defaults.get("fixAgent")
        latest_review = None if latest_options.get("skipReview") is True else (latest_options.get("reviewAgent") or queue_defaults.get("reviewAgent"))
        if latest_review == "none":
            latest_review = None
        parts = [latest_fix, latest_review]
        profile_parts = [str(part) for part in parts if part and str(part).strip()]
        latest_profile = " / ".join(profile_parts) if profile_parts else None

    items: List[Dict[str, Any]] = []
    queued_task_paths = set()
    counts: Dict[str, int] = {
        "total": 0,
        "queueTotal": 0,
        "done": 0,
        "applied": 0,
        "reviewed": 0,
        "noDiff": 0,
        "manualRescueLanded": 0,
        "applyConflict": 0,
        "rescuePatch": 0,
        "human": 0,
        "failed": 0,
        "crashed": 0,
        "quarantined": 0,
        "stopped": 0,
        "running": 0,
        "pending": 0,
    }

    for index, task in enumerate(tasks_in):
        if not isinstance(task, dict):
            continue
        task_id = str(task.get("id") or task.get("task") or "").strip()
        task_path = str(task.get("task") or "").strip()
        if task_path:
            queued_task_paths.add(_normalize_task_path(task_path))
        record = outcome_map.get(task_id) if isinstance(outcome_map, dict) else None
        if not isinstance(record, dict):
            record = {}
        enabled = task.get("enabled") is not False
        if enabled:
            counts["queueTotal"] += 1
        same_as_running = bool(running_task_path) and _normalize_task_path(task_path) == running_task_path
        running = bool(queue_running) and same_as_running
        stale = bool(stale_run and same_as_running)
        manual_rescue_landed = False
        if task_path:
            task_text = ""
            try:
                task_text = (repo / task_path).read_text(encoding="utf-8")
            except Exception:
                task_text = ""
            manual_rescue_landed = bool(record.get("applyStatus") == "MANUAL_RESCUE_LANDED" or record.get("manualRescue") or record.get("manualRescueLanded")) and bool(task_text)
        outcome_group = "manualRescueLanded" if manual_rescue_landed else _classify_outcome_group(record.get("lastStatus"), record.get("lastOutcome"), record)
        item_status = "MANUAL_RESCUE_LANDED" if manual_rescue_landed else record.get("lastStatus")
        branch = None
        explicit_branch = str(record.get("branch") or task.get("branch") or "").strip()
        if explicit_branch:
            branch = explicit_branch.replace("refs/heads/", "")
        else:
            use_worktree = task.get("useWorktree")
            if use_worktree is None:
                use_worktree = queue_defaults.get("useWorktree")
            scope = str(task.get("worktreeScope") or queue_defaults.get("worktreeScope") or "queue").strip().lower()
            if bool(use_worktree):
                raw_name = queue_defaults.get("queueWorktreeName") if scope == "queue" else (task.get("worktreeName") or task_id or f"task-{index + 1}")
                clean_name = _sanitize_overview_worktree_name(raw_name)
                branch = f"agent-loop/{clean_name}" if clean_name else None
        item: Dict[str, Any] = {
            "id": task_id or task_path,
            "task": task_path,
            "enabled": enabled,
            "inQueue": True,
            "source": "queue",
            "agent": record.get("agent") or None,
            "fixAgent": record.get("fixAgent") or task.get("fixAgent") or queue_defaults.get("fixAgent") or "grok",
            "reviewAgent": None if task.get("skipReview") is True else (record.get("reviewAgent") or task.get("reviewAgent") or queue_defaults.get("reviewAgent") or "codex"),
            "branch": branch,
            "lastUpdatedAt": record.get("lastUpdatedAt"),
            "lastUpdatedText": _format_updated_text(record.get("lastUpdatedAt")),
            "outcome": record.get("lastOutcome"),
            "outcomeGroup": outcome_group,
            "status": item_status,
            "rawStatus": record.get("lastStatus"),
            "lastRunId": record.get("lastRunId"),
            "autoDisabled": bool(record.get("autoDisabled")),
            "running": running,
            "stale": stale,
            "applyStatus": record.get("applyStatus"),
            "rawApplyStatus": record.get("applyStatus"),
            "applyErrorKind": record.get("applyErrorKind"),
            "rawApplyErrorKind": record.get("applyErrorKind"),
            "applyErrorFiles": record.get("applyErrorFiles") if isinstance(record.get("applyErrorFiles"), list) else [],
            "applyError": record.get("applyError"),
            "rescuePatchAvailable": bool(record.get("rescuePatchAvailable")),
            "diffBytes": int(record.get("diffBytes") or 0),
            "worktreeErrorFiles": record.get("worktreeErrorFiles") if isinstance(record.get("worktreeErrorFiles"), list) else [],
        }
        item["category"] = _classify_triage_category(enabled, bool(record.get("autoDisabled")), running, outcome_group, stale)
        items.append(item)

        if running:
            counts["running"] += 1
        elif outcome_group == "applied":
            counts["applied"] += 1
            counts["done"] += 1
        elif outcome_group == "reviewed":
            counts["reviewed"] += 1
            counts["done"] += 1
        elif outcome_group == "noDiff":
            counts["noDiff"] += 1
        elif outcome_group == "manualRescueLanded":
            counts["manualRescueLanded"] += 1
            counts["done"] += 1
        elif outcome_group == "applyConflict":
            counts["applyConflict"] += 1
        elif outcome_group == "rescuePatch":
            counts["rescuePatch"] += 1
            counts["failed"] += 1
        elif outcome_group == "human":
            counts["human"] += 1
        elif outcome_group == "failed":
            counts["failed"] += 1
        elif outcome_group == "crashed":
            counts["crashed"] += 1
        elif outcome_group == "quarantined":
            counts["quarantined"] += 1
        elif outcome_group == "stopped":
            counts["stopped"] += 1
        else:
            counts["pending"] += 1

    for task_path in _discover_task_files(repo):
        normalized_task_path = _normalize_task_path(task_path)
        if normalized_task_path in queued_task_paths:
            continue
        task_id = _task_id_from_path(task_path)
        record = outcome_map.get(task_id) if isinstance(outcome_map, dict) else None
        if not isinstance(record, dict):
            record = {}
        same_as_running = bool(running_task_path) and normalized_task_path == running_task_path
        running = bool(queue_running) and same_as_running
        outcome_group = _classify_outcome_group(record.get("lastStatus"), record.get("lastOutcome"), record)
        item: Dict[str, Any] = {
            "id": task_id,
            "task": task_path,
            "enabled": True,
            "inQueue": False,
            "source": "taskFile",
            "agent": record.get("agent") or None,
            "fixAgent": record.get("fixAgent") or queue_defaults.get("fixAgent") or "grok",
            "reviewAgent": record.get("reviewAgent") or queue_defaults.get("reviewAgent") or "codex",
            "branch": None,
            "lastUpdatedAt": record.get("lastUpdatedAt"),
            "lastUpdatedText": _format_updated_text(record.get("lastUpdatedAt")),
            "outcome": record.get("lastOutcome"),
            "outcomeGroup": outcome_group,
            "status": record.get("lastStatus"),
            "rawStatus": record.get("lastStatus"),
            "lastRunId": record.get("lastRunId"),
            "autoDisabled": bool(record.get("autoDisabled")),
            "running": running,
            "stale": bool(stale_run and same_as_running),
            "applyStatus": record.get("applyStatus"),
            "rawApplyStatus": record.get("applyStatus"),
            "applyErrorKind": record.get("applyErrorKind"),
            "rawApplyErrorKind": record.get("applyErrorKind"),
            "applyErrorFiles": record.get("applyErrorFiles") if isinstance(record.get("applyErrorFiles"), list) else [],
            "applyError": record.get("applyError"),
            "rescuePatchAvailable": bool(record.get("rescuePatchAvailable")),
            "diffBytes": int(record.get("diffBytes") or 0),
            "worktreeErrorFiles": record.get("worktreeErrorFiles") if isinstance(record.get("worktreeErrorFiles"), list) else [],
        }
        item["category"] = _classify_triage_category(True, bool(record.get("autoDisabled")), running, outcome_group, bool(stale_run and same_as_running))
        items.append(item)

        if running:
            counts["running"] += 1
        elif outcome_group == "applied":
            counts["applied"] += 1
            counts["done"] += 1
        elif outcome_group == "reviewed":
            counts["reviewed"] += 1
            counts["done"] += 1
        elif outcome_group == "noDiff":
            counts["noDiff"] += 1
        elif outcome_group == "manualRescueLanded":
            counts["manualRescueLanded"] += 1
            counts["done"] += 1
        elif outcome_group == "applyConflict":
            counts["applyConflict"] += 1
        elif outcome_group == "rescuePatch":
            counts["rescuePatch"] += 1
            counts["failed"] += 1
        elif outcome_group == "human":
            counts["human"] += 1
        elif outcome_group == "failed":
            counts["failed"] += 1
        elif outcome_group == "crashed":
            counts["crashed"] += 1
        elif outcome_group == "quarantined":
            counts["quarantined"] += 1
        elif outcome_group == "stopped":
            counts["stopped"] += 1
        else:
            counts["pending"] += 1

    counts["total"] = len(items)

    current = None
    if (latest_state_active or has_background_runtime) and isinstance(latest_state, dict):
        latest_task = _normalize_task_path(
            (latest_state.get("options") or {}).get("task") if isinstance(latest_state.get("options"), dict) else latest_state.get("task")
        )
        if latest_task or has_background_runtime:
            current = {
                "taskLabel": latest_task.split("/")[-1].replace(".md", "") if latest_task else "queue",
                "phaseLabel": _phase_label(latest_state.get("status")),
                "status": latest_state.get("status"),
                "runId": latest_state.get("runId"),
                "backgroundRunId": background_runtime.get("runId"),
                "pid": background_runtime.get("pid"),
                "heartbeatAt": background_runtime.get("heartbeatAt"),
                "runtimeStatus": background_runtime.get("status"),
                "elapsedText": None,
                "staleRun": bool(stale_run),
                "profileName": latest_profile,
            }

    return {
        "tasks": items,
        "landing": landing,
        "counts": counts,
        "queueRunning": bool(queue_running),
        "current": current,
        "queuePath": queue_path,
        "latestQueuePath": latest_queue_path,
        "queueStale": queue_stale,
        "availableQueues": available_queues,
    }


def get_agent_loop_queue_overview(repo_root: Optional[str] = None) -> Dict[str, Any]:
    return _queue_overview_from_files(repo_root)


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

    reviewRounds = _sanitize_for_response(state.get("reviewRounds") or [])
    if not isinstance(reviewRounds, list):
        reviewRounds = []

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
        reviewRounds=reviewRounds,
        grokFix=_sanitize_for_response(state.get("grokFix")),
        agentFix=_sanitize_for_response(state.get("agentFix")),
        codexReview=_sanitize_for_response(state.get("codexReview")),
        grokReview=_sanitize_for_response(state.get("grokReview")),
    )
    return detail
