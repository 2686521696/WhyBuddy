"""
AgentLoop worker bridge (SlideRule 108).

Python builds and (optionally) executes commands against the existing Node
AgentLoop queue runner / loop. Keeps execution in Node; Python drives.

Supports:
- queue run (via scripts/run-queue.mjs)
- single task run (via --only or direct loop script)
- timeout, cwd, env_overrides
- dry-run receipts (no node/npm assumption, no execution)
- redaction of env and credential-like arguments in receipts
"""

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from config.settings import get_settings
from models.agent_loop import AgentLoopCommandRequest, AgentLoopCommandReceipt

# 109: centralized redaction (reused)
try:
    from services.agent_loop_redaction import (
        redact_sensitive as _redact_sensitive_text,
        redact_env_dict,
        redact_command_receipt,
    )
except Exception:
    from agent_loop_redaction import (  # type: ignore
        redact_sensitive as _redact_sensitive_text,
        redact_env_dict,
        redact_command_receipt,
    )


def _resolve_repo_root() -> Path:
    """Resolve repository root containing agent-loop/ and tws-ai-slide-rule-python/."""
    here = Path(__file__).resolve()
    candidates = [
        here.parent.parent,  # services/ -> tws-ai-slide-rule-python/
        here.parent.parent.parent,  # ... -> repo root
    ]
    for cand in candidates:
        if (cand / "agent-loop").is_dir() or (cand / "tws-ai-slide-rule-python").is_dir():
            return cand
    return here.parent.parent


def _resolve_agent_loop_dir(s: Any) -> Path:
    root = Path(getattr(s, "AGENT_LOOP_ROOT", "agent-loop") or "agent-loop")
    if not root.is_absolute():
        root = _resolve_repo_root() / root
    return root.resolve()


def _redact_command(req: AgentLoopCommandRequest) -> str:
    """Build redacted command string using central redaction helper (109)."""
    parts: List[str] = [req.command or ""]
    for a in (req.args or []):
        parts.append(_redact_sensitive_text(a) if a else a)
    joined = " ".join(p for p in parts if p)
    return _redact_sensitive_text(joined)


def build_agent_loop_command(
    *,
    queue_run: bool = True,
    task: Optional[str] = None,
    timeout_ms: Optional[int] = None,
    cwd: Optional[str] = None,
    env_overrides: Optional[Dict[str, str]] = None,
    queue_path: Optional[str] = None,
) -> AgentLoopCommandRequest:
    """Build a command request for the Node AgentLoop queue runner.

    - queue_run=True: use scripts/run-queue.mjs (supports --only for single-task run)
    - queue_run=False: use src/loop.js directly (single task run with full flags)
    - cwd here is used as spawn cwd for the node process; also injected as --cwd for loop mode
    - env_overrides go into request env (for subprocess) and as --worker-env in loop mode
    - queue_path allows overriding the queue script (validated at endpoint)
    """
    s = get_settings()
    al_dir = _resolve_agent_loop_dir(s)
    node_cmd: str = getattr(s, "AGENT_LOOP_NODE_COMMAND", "node") or "node"

    args: List[str] = []
    if queue_run:
        q_name = getattr(s, "AGENT_LOOP_RUN_QUEUE", "scripts/run-queue.mjs") or "scripts/run-queue.mjs"
        if queue_path:
            q_name = queue_path
        script = Path(q_name)
        if not script.is_absolute():
            script = al_dir / script
        args = [str(script)]
        if task:
            args.extend(["--only", task])
    else:
        script = al_dir / (getattr(s, "AGENT_LOOP_LOOP_SCRIPT", "src/loop.js") or "src/loop.js")
        args = [str(script)]
        if cwd:
            args.extend(["--cwd", cwd])
        if task:
            args.extend(["--task", task])
        tms = timeout_ms if timeout_ms is not None else getattr(s, "AGENT_LOOP_DEFAULT_TIMEOUT_MS", 1800000)
        args.extend(["--timeout-ms", str(tms)])
        for k, v in (env_overrides or {}).items():
            args.extend(["--worker-env", f"{k}={v}"])

    # spawn cwd: prefer explicit, fall back to agent-loop dir (stable for queue scripts)
    spawn_cwd = cwd if cwd else str(al_dir)
    # ensure relative/absolute safe; resolve only if looks relative to avoid breaking tests
    spawn_path = Path(spawn_cwd)
    if not spawn_path.is_absolute():
        spawn_path = (al_dir / spawn_cwd).resolve() if cwd else al_dir
    else:
        spawn_path = spawn_path.resolve()

    tmo = timeout_ms if timeout_ms is not None else getattr(s, "AGENT_LOOP_DEFAULT_TIMEOUT_MS", 1800000)

    env_dict = dict(env_overrides) if env_overrides else None

    return AgentLoopCommandRequest(
        command=node_cmd,
        args=args,
        cwd=str(spawn_path),
        timeoutMs=tmo,
        env=env_dict,
    )


def execute_agent_loop_command(
    req: AgentLoopCommandRequest, *, dry_run: bool = False
) -> AgentLoopCommandReceipt:
    """Execute (or dry-run) the bridged AgentLoop command.

    Returns redacted receipt. In dry_run: never shells out, never assumes node/npm exists.
    """
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    redacted = _redact_command(req)

    if dry_run or getattr(get_settings(), "AGENT_LOOP_BRIDGE_DRY_RUN", False):
        rec = {
            "command": redacted,
            "exitCode": None,
            "stdout": None,
            "stderr": None,
            "timedOut": False,
            "startedAt": now,
            "endedAt": now,
            "metadata": {"dryRun": True, "wouldExecute": False},
        }
        red_rec = redact_command_receipt(rec)
        return AgentLoopCommandReceipt(**red_rec)

    # real execution path (caller must ensure node exists)
    try:
        env = os.environ.copy()
        if req.env:
            # only string values
            for k, v in req.env.items():
                if isinstance(v, str):
                    env[k] = v

        timeout_sec = None
        if req.timeoutMs is not None:
            timeout_sec = max(0.1, req.timeoutMs / 1000.0)

        result = subprocess.run(
            [req.command] + (req.args or []),
            cwd=req.cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        ended = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        rec = {
            "command": redacted,
            "exitCode": result.returncode,
            "stdout": _redact_sensitive_text(result.stdout or ""),
            "stderr": _redact_sensitive_text(result.stderr or ""),
            "timedOut": False,
            "startedAt": now,
            "endedAt": ended,
            "metadata": {},
        }
        red_rec = redact_command_receipt(rec)
        return AgentLoopCommandReceipt(**red_rec)
    except subprocess.TimeoutExpired as te:
        ended = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        stdout_val = _redact_sensitive_text((te.stdout or "") if isinstance(getattr(te, "stdout", None), str) else "") if isinstance(getattr(te, "stdout", None), str) else None
        stderr_val = _redact_sensitive_text((te.stderr or "") if isinstance(getattr(te, "stderr", None), str) else "")
        rec = {
            "command": redacted,
            "exitCode": None,
            "stdout": stdout_val,
            "stderr": stderr_val,
            "timedOut": True,
            "startedAt": now,
            "endedAt": ended,
            "metadata": {"reason": "timeout"},
        }
        red_rec = redact_command_receipt(rec)
        return AgentLoopCommandReceipt(**red_rec)
    except Exception as exc:
        ended = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        rec = {
            "command": redacted,
            "exitCode": 1,
            "stdout": None,
            "stderr": _redact_sensitive_text(str(exc)),
            "timedOut": False,
            "startedAt": now,
            "endedAt": ended,
            "metadata": {"error": "spawn_failed"},
        }
        red_rec = redact_command_receipt(rec)
        return AgentLoopCommandReceipt(**red_rec)
