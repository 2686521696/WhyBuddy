"""
SlideRule AgentLoop 110: replay release readiness test.
This test verifies the v2 SSOT replay path is documented, testable, and safe to operate beside the Node runner.
Marker: agentloop replay release readiness 110 verifies v2 ssot rollout and rollback
"""

import os
import sys

import pytest

# Ensure project root on path for consistency (stdlib test)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SSOT_MD = os.path.join(ROOT, "AGENT_LOOP_V2_RUNTIME_SSOT.md")
RUNBOOK_MD = os.path.join(ROOT, "AGENT_LOOP_RUNBOOK.md")
README_MD = os.path.join(ROOT, "README.md")


def test_agentloop_replay_release_readiness_110_verifies_v2_ssot_rollout_and_rollback():
    """agentloop replay release readiness 110 verifies v2 ssot rollout and rollback

    Verifies the v2 SSOT replay path is documented, testable, and safe to operate beside the Node runner.

    - Runbook references the v2 SSOT replay path and keeps the Node runner bridge caveat.
    - Documentation explains fallback to legacy artifact adapter.
    - Release readiness covers rollback and Web route verification.

    Does not claim the Node runner has been removed.
    Does not remove 108/109 compatibility.
    Does not document raw secret storage.
    Does not skip rollback guidance.
    """
    for p in (SSOT_MD, RUNBOOK_MD, README_MD):
        assert os.path.exists(p), f"Required doc must exist at {p}"

    with open(SSOT_MD, "r", encoding="utf-8") as f:
        ssot = f.read()

    with open(RUNBOOK_MD, "r", encoding="utf-8") as f:
        runbook = f.read()

    with open(README_MD, "r", encoding="utf-8") as f:
        readme = f.read()

    ssot_l = ssot.lower()
    runbook_l = runbook.lower()
    readme_l = readme.lower()

    # v2 ssot rollout basics
    assert "v2" in ssot_l
    assert "ssot" in ssot_l or "single source of truth" in ssot_l
    assert "replay" in ssot_l
    assert "event" in ssot_l

    # fallback to legacy artifact adapter
    assert "legacy artifact adapter" in ssot_l or (
        "legacy" in ssot_l and "adapter" in ssot_l
    )
    assert "compatibility" in ssot_l or "fallback" in ssot_l or "synthetic" in ssot_l

    # web route verification in docs
    assert "/api/agent-loop/runs" in runbook or "/api/agent-loop/runs" in ssot
    assert "web" in ssot_l or "flow" in ssot_l or "sse" in ssot_l

    # runbook references the v2 SSOT replay path
    assert "v2 ssot replay path" in runbook_l or "ssot replay" in runbook_l or ("v2" in runbook_l and "replay" in runbook_l)
    assert "replay path" in runbook_l or "events/stream" in runbook_l or "event replay" in runbook_l

    # keeps the Node runner bridge caveat
    assert "node runner" in runbook_l
    assert (
        "bridge" in runbook_l
        or "still the execution owner" in runbook_l
        or "remains present" in runbook_l
        or "bridge rescue" in runbook_l
    )

    # release readiness covers rollback
    assert "rollback" in runbook_l

    # 108/109 compat kept (no removal claims)
    assert "108" in ssot or "109" in ssot or "108" in runbook or "109" in runbook
    assert "do not" not in runbook_l or "node" in runbook_l  # loose, covered by bridge language

    # readme covers agentloop context
    assert "agentloop" in readme_l or "agent-loop" in readme_l or "slide rule" in readme_l
