"""
SlideRule AgentLoop 108: worker bridge tests.
Bridge builds deterministic node queue/loop commands and supports dry-run receipts.
"""

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.agent_loop_bridge import (  # noqa: E402
    build_agent_loop_command,
    execute_agent_loop_command,
)
from models.agent_loop import AgentLoopCommandRequest, AgentLoopCommandReceipt  # noqa: E402


def test_agentloop_worker_bridge_108_builds_node_queue_command_without_executing_in_dry_run():
    """agentloop worker bridge 108 builds node queue command without executing in dry run

    - Builds node + run-queue.mjs command (queue run)
    - Supports single task via --only on queue runner
    - Supports timeout, cwd, env_overrides
    - Dry-run produces receipt without executing (exitCode None, dryRun marker, no node assumed)
    - Command receipts redact env/credential-like arguments (e.g. keys in --worker-env)
    """
    # queue run
    req = build_agent_loop_command(queue_run=True)
    assert isinstance(req, AgentLoopCommandRequest)
    cmdline = (req.command or "") + " " + " ".join(req.args or [])
    assert "node" in cmdline
    assert "run-queue.mjs" in cmdline or "run-queue" in cmdline

    receipt = execute_agent_loop_command(req, dry_run=True)
    assert isinstance(receipt, AgentLoopCommandReceipt)
    assert receipt.exitCode is None
    assert receipt.timedOut is False
    meta = getattr(receipt, "metadata", {}) or {}
    assert meta.get("dryRun") is True or meta.get("wouldExecute") is False

    # single task run (via queue --only)
    req_single = build_agent_loop_command(queue_run=True, task="agent-loop/tasks/sliderule-agentloop-worker-bridge-108.md")
    cmd_single = " ".join([req_single.command] + (req_single.args or []))
    assert "--only" in cmd_single
    assert "worker-bridge-108" in cmd_single

    # timeout, cwd, env overrides
    req_opts = build_agent_loop_command(
        queue_run=False,  # exercise loop script path for single-task style
        task="some-task.md",
        timeout_ms=123456,
        cwd="some/cwd",
        env_overrides={"TIMEOUT_VAR": "1", "SAFE": "ok"},
    )
    assert req_opts.timeoutMs == 123456
    assert req_opts.cwd is not None
    opts_cmd = " ".join([req_opts.command] + (req_opts.args or []))
    assert "--timeout-ms" in opts_cmd or "123456" in opts_cmd
    assert "--cwd" in opts_cmd
    assert "--worker-env" in opts_cmd or "SAFE=ok" in opts_cmd

    # redaction of credential-like args/env
    req_secret = build_agent_loop_command(
        queue_run=False,
        task="t.md",
        env_overrides={"OPENAI_API_KEY": "sk-FAKESECRET1234567890", "NORMAL": "val"},
    )
    rec_secret = execute_agent_loop_command(req_secret, dry_run=True)
    redacted_cmd = rec_secret.command or ""
    assert "sk-FAKESECRET1234567890" not in redacted_cmd
    assert "REDACTED" in redacted_cmd or "***" in redacted_cmd
    assert "OPENAI_API_KEY" in redacted_cmd  # key name kept, value redacted

    # dry run never executes (receipt signals no run)
    assert rec_secret.exitCode is None
    assert "dryRun" in str(getattr(rec_secret, "metadata", {}))

    # also queue with overrides (env passed to spawn, not leaked to receipt)
    req_q = build_agent_loop_command(
        queue_run=True,
        task=None,
        timeout_ms=99999,
        cwd=None,
        env_overrides={"CRED_TOKEN": "super-secret-xyz"},
    )
    rec_q = execute_agent_loop_command(req_q, dry_run=True)
    assert "super-secret-xyz" not in (rec_q.command or "")
    assert rec_q.exitCode is None

    # stdout secret redaction coverage on real execution path (mocked subprocess; no node)
    secret_stdout = 'log start\nOPENAI_API_KEY=sk-LEAKED9876543210FAKE\nmore output\n'
    mock_res = MagicMock()
    mock_res.returncode = 0
    mock_res.stdout = secret_stdout
    mock_res.stderr = 'err: TOKEN=leaky-xyz\n'
    with patch("services.agent_loop_bridge.subprocess.run", return_value=mock_res):
        rec_exec = execute_agent_loop_command(req_secret, dry_run=False)
        assert rec_exec.exitCode == 0
        assert rec_exec.stdout is not None
        assert "sk-LEAKED9876543210FAKE" not in rec_exec.stdout
        assert "REDACTED" in rec_exec.stdout
        assert "leaky-xyz" not in (rec_exec.stderr or "")
        assert "REDACTED" in (rec_exec.stderr or "")

    # stdout redaction on timeout path (partial output may contain secrets)
    te = subprocess.TimeoutExpired(cmd="node", timeout=0.1)
    te.stdout = 'partial before fail\nPASSWORD=super-leak-999\n'
    te.stderr = ''
    with patch("services.agent_loop_bridge.subprocess.run", side_effect=te):
        rec_to = execute_agent_loop_command(req_secret, dry_run=False)
        assert rec_to.timedOut is True
        assert "super-leak-999" not in (rec_to.stdout or "")
        assert "REDACTED" in (rec_to.stdout or "")
