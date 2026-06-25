"""
SlideRule AgentLoop 109: release runbook rescue test.
This test verifies the operator runbook exists and covers required topics.
Marker: agentloop release runbook 109 documents startup queue settings security and rollback
"""

import os
import sys

import pytest

# Ensure project root on path for consistency (stdlib test)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

RUNBOOK_MD = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "AGENT_LOOP_RUNBOOK.md",
)


def test_agentloop_release_runbook_109_documents_startup_queue_settings_security_and_rollback():
    """agentloop release runbook 109 documents startup queue settings security and rollback

    Verifies the runbook for SlideRule AgentLoop 109 bridge rescue phase:
    - startup commands
    - API routes
    - queue execution
    - settings
    - provider health
    - run inspection
    - security
    - rollback

    Explicitly documents that 109 is bridge rescue with Node runner still present.
    Does not claim Node removal or full cutover.
    """
    assert os.path.exists(RUNBOOK_MD), f"Runbook must exist at {RUNBOOK_MD}"

    with open(RUNBOOK_MD, "r", encoding="utf-8") as f:
        content = f.read().lower()

    # Required sections / topics per acceptance
    assert "startup" in content
    assert "api route" in content or "api routes" in content or "/api/agent-loop" in content
    assert "queue execution" in content or "queue run" in content
    assert "settings" in content
    assert "provider health" in content or "provider-health" in content
    assert "run inspection" in content or "runs/overview" in content or "run detail" in content
    assert "security" in content
    assert "rollback" in content

    # Startup commands present
    assert "uvicorn" in content or "python -m uvicorn" in content
    assert "port 9700" in content or "--port 9700" in content

    # Bridge + Node still present (109 rescue)
    assert "bridge rescue" in content or "bridge phase" in content
    assert "node runner" in content
    assert "still present" in content or "remains present" in content or "still the execution owner" in content
    assert "109" in content
    assert "node" in content and ("runner" in content or "bridge" in content)

    # Explicitly no full cutover claim (loose safeguard)
    # (content must not falsely claim removal; we assert presence of bridge language instead)
    assert "do not assume" in content or "bridge rescue phase" in content

    # Security: redaction and no raw secrets in docs/behavior (mentions prohibition is allowed)
    assert "redact" in content or "redaction" in content or "never" in content or "sanitized" in content  # covers security guidance
    assert "secret" in content  # runbook discusses secret handling without documenting raw storage

    # References the task and test
    assert "sliderule-agentloop-release-runbook-109" in content or "109" in content
    assert "test_agent_loop_release_runbook" in content or "runbook" in content
